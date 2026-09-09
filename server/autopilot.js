/**
 * The autopilot.
 *
 * Every cycle: sweep the wires, decide what is worth running, and produce a
 * full rundown for the top few. Nothing it makes is published — every rundown
 * lands in "awaiting review" for an editor to check and push. The machine
 * decides what to work on; a person decides what goes out.
 *
 * The guard that matters more than the feature: it never runs a story the desk
 * already produced (the store's own check).
 */
import './env.js';
import { discover } from './discover.js';
import { freshEnough } from './sweeper.js';
import { draftBrief } from './discover.js';
import { selectStories } from './rank.js';
import { extractFacts, generateOne } from './pipeline.js';
import { FORMATS } from './formats.js';
import { saveRundown, updateRundown, newId, listRundowns, STATUS } from './store.js';

const DEFAULTS = {
  count: Number(process.env.LSS_AUTOPILOT_COUNT || 3),
  intervalMs: Number(process.env.LSS_AUTOPILOT_INTERVAL_MS || 5 * 60_000),
  // A restart used to cost a full idle interval before anything ran, which on a
  // dev machine that restarts every few minutes meant no cycle ever fired. The
  // first cycle of a session starts here instead; the sweeper already does the
  // same for the same reason.
  firstDelayMs: Number(process.env.LSS_AUTOPILOT_FIRST_DELAY_MS || 30_000),
  language: process.env.LSS_AUTOPILOT_LANGUAGE || 'Hindi',
  concurrency: Number(process.env.LSS_CONCURRENCY || 13),
  // Rundowns produced at once. Total in-flight model calls is this times the
  // format fan-out, so raising it is the fastest way to hit a rate limit.
  parallel: Number(process.env.LSS_AUTOPILOT_PARALLEL || 2),
};

const state = {
  on: false,
  ...DEFAULTS,
  running: false,
  lastRunAt: null,
  // When the cycle now in flight began. The board used to read "not swept yet
  // this session" through eight minutes of visible work, because lastRunAt is
  // only written once a cycle lands.
  startedAt: null,
  nextRunAt: null,
  lastResult: null,
  produced: 0,
  cycles: 0,
  errors: [],
};

let timer = null;
const listeners = new Set();

/**
 * Schedule the next cycle, `delayMs` from now.
 *
 * A fixed setInterval was wrong twice over: a cycle takes longer than the
 * interval it runs on (a sweep plus three rundowns is 7-8 minutes against a
 * 5-minute tick), so every tick landing mid-cycle hit the "already running"
 * guard and was thrown away — the real cadence was double the advertised one —
 * and nextRunAt, recomputed separately, spent most of a cycle pointing at a
 * time already past, which the board renders as "due now" forever.
 *
 * One self-rescheduling timeout, set when the previous cycle finishes, makes
 * the interval mean "gap between cycles" and makes nextRunAt true by
 * construction.
 */
function scheduleNext(delayMs = state.intervalMs) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!state.on) {
    state.nextRunAt = null;
    return;
  }
  state.nextRunAt = new Date(Date.now() + delayMs).toISOString();
  timer = setTimeout(() => {
    runCycle()
      .catch(() => {})
      .finally(() => scheduleNext());
  }, delayMs);
  // Node should still be allowed to exit on its own.
  timer.unref?.();
}

/**
 * Per-format progress for rundowns currently being written.
 *
 * Kept in memory rather than written to disk on every format: an editor opening
 * a story mid-production needs to see it working, and thirteen extra full-record
 * writes per rundown buys nothing once it has finished. Cleared when the
 * rundown lands, because the record itself then tells the whole story.
 */
const live = new Map();

export function liveProgress(id) {
  return live.get(id) || null;
}

export function onAutopilot(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (ev) => {
  for (const fn of listeners) {
    try {
      fn(ev);
    } catch {
      /* a bad listener must not stop the desk */
    }
  }
};

export function autopilotStatus() {
  return {
    ...state,
    producedLastHour: producedLastHour(),
  };
}

/** Rundowns this autopilot has produced in the trailing hour. */
function producedLastHour() {
  const cutoff = Date.now() - 3_600_000;
  return listRundowns({ limit: 200 }).filter(
    (r) => r.origin !== 'manual' && new Date(r.createdAt).getTime() >= cutoff
  ).length;
}

async function pooled(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

/**
 * Start a rundown and hand back its id straight away.
 *
 * Production takes a minute or more. Holding the HTTP response open for all of
 * it left the caller staring at a spinning button with no way to watch the work
 * that was already visibly happening. The record exists before this returns, so
 * the desk can open it and follow the progress screen; `done` resolves when the
 * writing finishes, for callers that need to wait.
 *
 * Pass an existing `id` to rewrite that record in place — how a failed rundown
 * is retried without leaving a dead card behind next to its replacement.
 */
export async function beginProduce(cluster, { id: reuseId } = {}) {
  const id = reuseId || newId();
  const started = Date.now();
  await saveRundown({
    id,
    status: STATUS.GENERATING,
    cluster,
    pickReason: cluster.pickReason,
    score: cluster.signals?.demand ?? null,
    story: { headline: cluster.headline, body: '' },
    facts: [],
    outputs: {},
    approvals: {},
    createdAt: new Date().toISOString(),
  });
  emit({ type: 'rundown:start', id, headline: cluster.headline });

  const done = (async () => {
  try {
    const brief = await draftBrief(cluster);
    const story = { headline: brief.headline, body: brief.body };
    const facts = await extractFacts(story);
    await updateRundown(id, { story, facts, brief });
    live.set(id, { facts: facts.length, formats: {}, times: {}, startedAt: Date.now() });
    emit({ type: 'rundown:facts', id, facts: facts.length });

    const outputs = {};
    const errors = {};
    const progress = { facts: facts.length, formats: {}, times: {}, startedAt: Date.now() };
    live.set(id, progress);

    await pooled(FORMATS.map((f) => f.id), state.concurrency, async (formatId) => {
      progress.formats[formatId] = 'running';
      emit({ type: 'rundown:format', id, formatId, state: 'running' });
      const t = Date.now();
      try {
        outputs[formatId] = await generateOne({ formatId, story, facts, language: state.language });
        progress.formats[formatId] = 'done';
        progress.times[formatId] = Date.now() - t;
        emit({ type: 'rundown:format', id, formatId, state: 'done', ms: Date.now() - t });
      } catch (e) {
        errors[formatId] = String(e?.message || e);
        progress.formats[formatId] = 'error';
        emit({ type: 'rundown:format', id, formatId, state: 'error', error: errors[formatId] });
      }
    });

    const rec = await updateRundown(id, {
      status: STATUS.REVIEW,
      outputs,
      errors: Object.keys(errors).length ? errors : undefined,
      genMs: Date.now() - started,
    });
    state.produced += 1;
    live.delete(id);
    emit({ type: 'rundown:done', id, formats: Object.keys(outputs).length, ms: Date.now() - started });
    return rec;
  } catch (e) {
    live.delete(id);
    await updateRundown(id, { status: STATUS.FAILED, error: String(e?.message || e) });
    emit({ type: 'rundown:error', id, error: String(e?.message || e) });
    return null;
  }
  })();

  return { id, done };
}

/** Produce and wait for it — what the autopilot's own cycle uses. */
export async function produce(cluster) {
  const { done } = await beginProduce(cluster);
  return done;
}

/** One full cycle. Safe to call directly — the UI's "Run now" uses it too. */
export async function runCycle({ count = state.count } = {}) {
  if (state.running) return { skipped: 'a cycle is already running' };

  state.running = true;
  state.cycles += 1;
  const started = Date.now();
  state.startedAt = new Date(started).toISOString();
  emit({ type: 'cycle:start', count });

  try {
    // The standing sweep already runs every five minutes; reuse its result
    // rather than paying for a second identical one.
    const cached = freshEnough();
    // discover() already narrates itself; the autopilot was throwing that away
    // and reporting one flat "working" for a minute of real work. Re-emit each
    // phase so the board can show what the agent is actually doing.
    const step = (text, extra = {}) => emit({ type: 'cycle:step', step: text, ...extra });
    const sweep =
      cached ||
      (await discover({ useRss: true, useTrending: true }, (ev) => {
        if (ev.type === 'phase') step(ev.phase);
        else if (ev.type === 'sources') {
          for (const src of ev.sources || []) {
            step(
              src.ok
                ? `${src.name} — ${src.count} headlines`
                : `${src.name} — unreachable`,
              src.ok ? {} : { level: 'warn' }
            );
          }
        } else if (ev.type === 'clustered') {
          step(`${ev.count} distinct stories from ${ev.origin === 'rss' ? 'the wires' : 'search'}`);
        } else if (ev.type === 'checked') {
          step(`Checked ${ev.clusters.length} against the CMS`);
        } else if (ev.type === 'error') {
          step(`${ev.scope} failed — ${ev.error}`, { level: 'warn' });
        }
      }));
    if (cached) step('Reusing the standing sweep — it is still fresh');
    emit({ type: 'cycle:swept', clusters: sweep.clusters.length, reused: !!cached });

    const { picks, ranked, skipped, rejected } = await selectStories(sweep.clusters, {
      count,
    });
    emit({ type: 'cycle:picked', picks: picks.map((p) => ({ headline: p.headline, reason: p.pickReason })) });

    // Sequential production overran the interval: a sweep plus three rundowns
    // took 7.7 minutes against a 5-minute cycle. Producing them in a small pool
    // brings a full cycle back inside its own window.
    const made = [];
    await pooled(picks, state.parallel, async (p) => {
      const rec = await produce(p);
      if (rec) made.push(rec.id);
    });

    state.lastResult = {
      at: new Date().toISOString(),
      swept: sweep.clusters.length,
      picked: picks.length,
      produced: made,
      ranked: ranked?.slice(0, 12),
      rejected,
      skipped,
      ms: Date.now() - started,
    };
    emit({ type: 'cycle:done', ...state.lastResult });
    return state.lastResult;
  } catch (e) {
    const err = String(e?.message || e);
    state.errors.unshift({ at: new Date().toISOString(), error: err });
    state.errors = state.errors.slice(0, 10);
    emit({ type: 'cycle:error', error: err });
    return { error: err };
  } finally {
    state.running = false;
    state.startedAt = null;
    // Set here, not on the success path: a cycle that errored still swept, and
    // "not swept yet this session" after four failed attempts is a lie.
    state.lastRunAt = new Date().toISOString();
  }
}

export function startAutopilot(opts = {}) {
  Object.assign(state, {
    count: opts.count ?? state.count,
    intervalMs: opts.intervalMs ?? state.intervalMs,
    language: opts.language ?? state.language,
  });
  if (state.on) {
    // Already on — a changed count applies to the next cycle, and the pending
    // timer stays as it is rather than being pushed back by every edit.
    return autopilotStatus();
  }

  state.on = true;
  // Nothing has run yet this process, so start soon rather than after a full
  // interval of an empty board.
  scheduleNext(state.cycles ? state.intervalMs : state.firstDelayMs);
  emit({ type: 'autopilot:on', ...autopilotStatus() });
  return autopilotStatus();
}

export function stopAutopilot() {
  state.on = false;
  state.nextRunAt = null;
  if (timer) clearTimeout(timer);
  timer = null;
  emit({ type: 'autopilot:off' });
  return autopilotStatus();
}
