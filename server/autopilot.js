/**
 * The autopilot.
 *
 * Every cycle: sweep the wires, decide what is worth running, and produce a
 * full rundown for the top few. Nothing it makes is published — every rundown
 * lands in "awaiting review" for an editor to check and push. The machine
 * decides what to work on; a person decides what goes out.
 *
 * Two guards matter more than the feature:
 *   - it never runs a story the desk already produced (the store's own check);
 *   - it stops at an hourly ceiling, because 3 rundowns x 13 formats every 5
 *     minutes is 468 generations an hour and that is real money.
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
  maxPerHour: Number(process.env.LSS_AUTOPILOT_MAX_PER_HOUR || 12),
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
  nextRunAt: null,
  lastResult: null,
  produced: 0,
  cycles: 0,
  errors: [],
};

let timer = null;
const listeners = new Set();

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
    capReached: producedLastHour() >= state.maxPerHour,
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

/** Produce one full rundown from a selected story. Never publishes. */
export async function produce(cluster) {
  const id = newId();
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
}

/** One full cycle. Safe to call directly — the UI's "Run now" uses it too. */
export async function runCycle({ count = state.count } = {}) {
  if (state.running) return { skipped: 'a cycle is already running' };

  const room = state.maxPerHour - producedLastHour();
  if (room <= 0) {
    const msg = `Hourly ceiling reached (${state.maxPerHour}/hr). Skipping this cycle.`;
    state.lastResult = { at: new Date().toISOString(), skipped: msg };
    emit({ type: 'cycle:skipped', reason: msg });
    return state.lastResult;
  }

  state.running = true;
  state.cycles += 1;
  const started = Date.now();
  emit({ type: 'cycle:start', count: Math.min(count, room) });

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
      count: Math.min(count, room),
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

    state.lastRunAt = new Date().toISOString();
    state.lastResult = {
      at: state.lastRunAt,
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
    state.nextRunAt = state.on ? new Date(Date.now() + state.intervalMs).toISOString() : null;
  }
}

export function startAutopilot(opts = {}) {
  Object.assign(state, {
    count: opts.count ?? state.count,
    intervalMs: opts.intervalMs ?? state.intervalMs,
    maxPerHour: opts.maxPerHour ?? state.maxPerHour,
    language: opts.language ?? state.language,
  });
  if (state.on) return autopilotStatus();

  state.on = true;
  state.nextRunAt = new Date(Date.now() + state.intervalMs).toISOString();
  timer = setInterval(() => {
    runCycle().catch(() => {});
  }, state.intervalMs);
  // Node should still be allowed to exit on its own.
  timer.unref?.();
  emit({ type: 'autopilot:on', ...autopilotStatus() });
  return autopilotStatus();
}

export function stopAutopilot() {
  state.on = false;
  state.nextRunAt = null;
  if (timer) clearInterval(timer);
  timer = null;
  emit({ type: 'autopilot:off' });
  return autopilotStatus();
}
