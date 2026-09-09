import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { backend, backendLabel, backendReady, backendHint, cliPath, backendConcurrency } from './llm.js';
import { envFileLoaded, envFilePath, envFileKeys } from './env.js';
import { imageProviderId, imageProviderLabel } from './images.js';
import { discover, draftBrief, trendsReady } from './discover.js';
import { cms, cmsLabel, cmsSimulated, cmsCanFile, cmsPartial } from './cms.js';
import { configuredFeeds } from './feeds.js';
import { fetchAll } from './rss.js';
import { startSweeper, runSweep, sweeperStatus, setSweeperAuto, lastDiscovery } from './sweeper.js';
import { startAutopilot, stopAutopilot, autopilotStatus, runCycle, onAutopilot, liveProgress } from './autopilot.js';
import { listRundowns, getRundown, updateRundown, counts as rundownCounts, STATUS, MEDIA_DIR, recoverOrphans, rebuildIndex } from './store.js';
import crypto from 'node:crypto';
import { FORMATS, GROUPS, PROGRESS_VERB } from './formats.js';
import { SAMPLES } from './samples.js';
import {
  extractFacts, generateOne, diffLedgers,
  patchLines, patchVisual, locateStaleLines,
} from './pipeline.js';
import { scanOutput, iterLines } from './facts.js';
import { publishToInstagram, composeCaption, zernioReady, zernioHint, MAX_MEDIA_ITEMS, CONTENT_TYPES } from './publish.js';
import { shelveDataUrl, readShelved, publicBase, publicUrlHint } from './media.js';
import { uploadSlides, supabaseReady, supabaseHint, supabaseBucket, newRunId } from './storage.js';
import { speak, listVoices, voiceReady, voiceHint, voiceId, voiceModel, MAX_CHARS as VOICE_MAX_CHARS } from './voice.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
// Each backend declares its own sensible fan-out (the CLI one spawns a process
// per call, so it gets a smaller one).
const CONCURRENCY = Number(process.env.LSS_CONCURRENCY || backendConcurrency);

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

/**
 * Translation targets.
 *
 * Ordered by who this desk actually files for: the Indian languages first, then
 * the international ones. Every entry here must have a font and a text
 * direction behind it in the UI — offering a language the browser renders as
 * empty boxes is worse than not offering it.
 */
export const LANGUAGES = [
  // Indian languages
  'Hindi', 'Bangla', 'Marathi', 'Telugu', 'Tamil', 'Gujarati', 'Urdu', 'Kannada',
  'Malayalam', 'Punjabi', 'Odia', 'Assamese', 'Maithili', 'Bhojpuri', 'Konkani',
  'Nepali', 'Sindhi', 'Kashmiri', 'Sanskrit',
  // International
  'English', 'Arabic', 'Chinese (Simplified)', 'Spanish', 'French', 'German',
  'Portuguese', 'Russian', 'Japanese', 'Korean', 'Indonesian', 'Vietnamese',
  'Thai', 'Turkish', 'Persian', 'Italian', 'Dutch', 'Swahili',
];

/** Run tasks with a fan-out cap, reporting each as it lands. */
async function pooled(items, limit, worker) {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await worker(next[1], next[0]);
    }
  });
  await Promise.all(runners);
}

const fail = (res, e) => {
  console.error('[lss]', e);
  res.status(500).json({ error: String(e?.message || e) });
};

/* ── metadata ─────────────────────────────────────────────────────────── */

app.get('/api/meta', (_req, res) => {
  res.json({
    backend,
    backendLabel,
    backendReady,
    backendHint,
    imageProvider: imageProviderId,
    imageProviderLabel,
    discovery: {
      feeds: configuredFeeds(),
      trendsReady,
      cmsLabel,
      cmsSimulated,
      cmsCanFile,
      cmsPartial,
    },
    languages: LANGUAGES,
    voice: {
      ready: voiceReady(),
      hint: voiceHint(),
      voiceId: voiceReady() ? voiceId() : null,
      model: voiceReady() ? voiceModel() : null,
      maxChars: VOICE_MAX_CHARS,
    },
    publish: {
      instagram: {
        ready: zernioReady() && (supabaseReady() || !!publicBase()),
        hint: !zernioReady()
          ? zernioHint()
          : supabaseReady() || publicBase()
          ? null
          : `${supabaseHint()} ${publicUrlHint()}`,
        host: supabaseReady() ? `Supabase · ${supabaseBucket}` : publicBase() ? 'this server' : null,
        maxMedia: MAX_MEDIA_ITEMS,
      },
    },
    groups: GROUPS,
    samples: SAMPLES,
    formats: FORMATS.map((f) => ({
      id: f.id,
      label: f.label,
      group: f.group,
      kind: f.kind,
      blurb: f.blurb,
      verb: PROGRESS_VERB[f.id],
      rules: f.rules({ language: 'the selected language' }),
    })),
  });
});

/* ── autopilot & rundowns ─────────────────────────────────────────────── */

// Generated imagery, served from disk rather than inlined in every payload.
app.use('/api/media', express.static(MEDIA_DIR, { maxAge: '1h', immutable: true }));

app.get('/api/autopilot', (_req, res) => res.json(autopilotStatus()));

app.post('/api/autopilot', (req, res) => {
  const { on, count, intervalMs, maxPerHour, language } = req.body || {};
  res.json(on === false ? stopAutopilot() : startAutopilot({ count, intervalMs, maxPerHour, language }));
});

/** Run one cycle immediately, without waiting for the timer. */
app.post('/api/autopilot/run', async (req, res) => {
  try {
    res.json(await runCycle({ count: req.body?.count }));
  } catch (e) { fail(res, e); }
});

/** Live progress, so the dashboard reflects work as it happens. */
app.get('/api/autopilot/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'hello', ...autopilotStatus() })}\n\n`);
  const off = onAutopilot((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
  // A comment frame every 25s keeps proxies from closing an idle stream.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    off();
    clearInterval(ping);
  });
});

app.get('/api/rundowns', (req, res) => {
  const { status, limit } = req.query;
  res.json({
    rundowns: listRundowns({ status, limit: limit ? Number(limit) : undefined }),
    counts: rundownCounts(),
    autopilot: autopilotStatus(),
  });
});

app.get('/api/rundowns/:id', async (req, res) => {
  const r = await getRundown(req.params.id);
  if (!r) return res.status(404).json({ error: 'No such rundown.' });
  // A rundown still being written carries its live progress, so opening it
  // mid-flight shows the desk working rather than an empty pane.
  res.json({ ...r, progress: liveProgress(req.params.id) });
});

/** Editor approves one format, or all of them. */
app.post('/api/rundowns/:id/approve', async (req, res) => {
  try {
    const r = await getRundown(req.params.id);
    if (!r) return res.status(404).json({ error: 'No such rundown.' });
    const { formatId, approved = true } = req.body || {};
    const approvals = { ...(r.approvals || {}) };
    if (formatId) approvals[formatId] = approved ? new Date().toISOString() : undefined;
    else for (const k of Object.keys(r.outputs || {})) approvals[k] = approved ? new Date().toISOString() : undefined;
    const done = Object.keys(r.outputs || {}).every((k) => approvals[k]);
    res.json(await updateRundown(req.params.id, {
      approvals,
      status: done ? STATUS.APPROVED : r.status === STATUS.APPROVED ? STATUS.REVIEW : r.status,
    }));
  } catch (e) { fail(res, e); }
});

/** Move a rundown along: published (simulated) or discarded. */
app.post('/api/rundowns/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!Object.values(STATUS).includes(status))
      return res.status(400).json({ error: `Unknown status "${status}".` });
    const r = await updateRundown(req.params.id, { status });
    if (!r) return res.status(404).json({ error: 'No such rundown.' });
    res.json(r);
  } catch (e) { fail(res, e); }
});

/** Editor edits one line of one output, same shape the review pane already uses. */
app.post('/api/rundowns/:id/output', async (req, res) => {
  try {
    const { formatId, output } = req.body || {};
    const r = await getRundown(req.params.id);
    if (!r) return res.status(404).json({ error: 'No such rundown.' });
    if (!formatId || !output) return res.status(400).json({ error: 'formatId and output are required.' });
    res.json(await updateRundown(req.params.id, {
      outputs: { ...r.outputs, [formatId]: output },
      // An edit un-approves that format: it is no longer the thing that was signed off.
      approvals: { ...(r.approvals || {}), [formatId]: undefined },
    }));
  } catch (e) { fail(res, e); }
});

/* ── the wire ─────────────────────────────────────────────────────────── */

/**
 * Raw competitor headlines. No model call, so it is cheap enough to poll.
 *
 * Also returns a fingerprint of the current wire, which lets the client tell
 * "nothing has moved" from "there is new copy" without paying for a sweep to
 * find out. Cached briefly so several clients polling do not hammer the feeds.
 */
let wireCache = { at: 0, payload: null };
const WIRE_TTL_MS = 30_000;

app.get('/api/wire', async (_req, res) => {
  try {
    if (wireCache.payload && Date.now() - wireCache.at < WIRE_TTL_MS)
      return res.json({ ...wireCache.payload, cached: true });

    const t = Date.now();
    const { sources, items } = await fetchAll(configuredFeeds());
    const top = items.slice(0, 40).map((i) => ({
      source: i.source,
      title: i.title,
      link: i.link,
      published: i.published,
    }));
    const payload = {
      items: top,
      sources: sources.map((s) => ({ name: s.name, ok: s.ok, count: s.count, error: s.error })),
      // Identity of the wire right now: if this is unchanged, so is the news.
      fingerprint: crypto.createHash('sha1').update(top.map((i) => i.link).join('|')).digest('hex').slice(0, 12),
      fetchedAt: new Date().toISOString(),
      ms: Date.now() - t,
    };
    wireCache = { at: Date.now(), payload };
    res.json({ ...payload, cached: false });
  } catch (e) { fail(res, e); }
});

/* ── story discovery (competitor wires + trending topics) ─────────────── */

/**
 * The last completed sweep plus the schedule that produced it, so the panel can
 * show both what it found and when it will look again.
 */
app.get('/api/discover/last', (_req, res) => {
  const last = lastDiscovery();
  res.json({ ...(last || { empty: true }), sweeper: sweeperStatus() });
});

/** Turn the standing sweep on or off, or force one immediately. */
app.post('/api/discover/auto', (req, res) => res.json(setSweeperAuto(req.body?.on !== false)));

app.post('/api/discover/now', async (req, res) => {
  try {
    res.json(await runSweep({ force: true, ...(req.body || {}) }));
  } catch (e) { fail(res, e); }
});

app.post('/api/discover', async (req, res) => {
  const { useRss = true, useTrending = true } = req.body || {};
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (o) => res.write(`${JSON.stringify(o)}\n`);
  try {
    await discover({ useRss, useTrending }, send);
  } catch (e) {
    send({ type: 'fatal', error: String(e?.message || e) });
  }
  res.end();
});

/** Turn a recommendation into an attributed starter draft the desk can edit. */
app.post('/api/discover/brief', async (req, res) => {
  try {
    const t = Date.now();
    const brief = await draftBrief(req.body?.cluster || req.body || {});
    res.json({ ...brief, ms: Date.now() - t });
  } catch (e) { fail(res, e); }
});

/**
 * Demo affordance for the mock CMS: record a recommended story as filed, so the
 * next sweep legitimately reports it as already covered. Refused against a real
 * CMS — this tool recommends, it does not publish.
 */
app.post('/api/cms/file', async (req, res) => {
  try {
    if (!cmsCanFile)
      return res.status(400).json({ error: 'Filing is disabled against a live CMS. This tool recommends only.' });
    res.json({ filed: await cms.file(req.body || {}), count: await cms.count() });
  } catch (e) { fail(res, e); }
});

/* ── fact ledger ──────────────────────────────────────────────────────── */

app.post('/api/facts', async (req, res) => {
  try {
    const t = Date.now();
    const facts = await extractFacts(req.body.story);
    res.json({ facts, ms: Date.now() - t });
  } catch (e) { fail(res, e); }
});

/* ── generation (streamed, one JSON object per line) ──────────────────── */

app.post('/api/generate', async (req, res) => {
  const { story, facts, language, only, steer } = req.body;
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (o) => res.write(`${JSON.stringify(o)}\n`);
  const ids = only?.length ? only : FORMATS.map((f) => f.id);
  const t0 = Date.now();
  send({ type: 'start', total: ids.length, concurrency: CONCURRENCY });

  try {
    await pooled(ids, CONCURRENCY, async (formatId) => {
      send({ type: 'format:start', formatId, verb: PROGRESS_VERB[formatId] });
      try {
        const output = await generateOne({ formatId, story, facts, language, steer });
        send({ type: 'format:done', formatId, output });
      } catch (e) {
        send({ type: 'format:error', formatId, error: String(e?.message || e) });
      }
    });
    send({ type: 'done', ms: Date.now() - t0 });
  } catch (e) {
    send({ type: 'fatal', error: String(e?.message || e) });
  }
  res.end();
});

/* ── edit propagation ─────────────────────────────────────────────────── */

/** Re-extract the ledger from the edited story and diff it against the old one. */
app.post('/api/rediff', async (req, res) => {
  try {
    const t = Date.now();
    const { story, oldFacts } = req.body;
    const facts = await extractFacts(story);
    const diff = await diffLedgers({ oldFacts, newFacts: facts, story });
    res.json({ facts, diff, ms: Date.now() - t });
  } catch (e) { fail(res, e); }
});

/**
 * Scan published outputs against the changed facts.
 * Deterministic first; the LLM locate call runs only for outputs whose usage
 * could not be proven from the text (translated copy, transliterated names).
 */
app.post('/api/scan', async (req, res) => {
  try {
    const t = Date.now();
    const { outputs = [], changes = [] } = req.body;
    const report = {};
    const needsLocate = [];

    for (const o of outputs) {
      const scan = scanOutput(o, changes);
      report[o.formatId] = {
        stale: scan.stale,
        staleLines: scan.staleLines,
        staleVisual: scan.staleVisual,
        changeLabels: [
          ...new Set([
            ...scan.staleLines.flatMap((l) => l.changeLabels),
            ...(scan.visualChangeLabels || []),
          ]),
        ],
        method: scan.staleLines.length || scan.staleVisual ? 'text-match' : null,
      };
      if (scan.needsLocate.length) needsLocate.push({ output: o, changes: scan.needsLocate });
    }

    await pooled(needsLocate, Math.min(4, CONCURRENCY), async ({ output, changes: cs }) => {
      try {
        const found = await locateStaleLines({ formatId: output.formatId, output, changes: cs });
        const r = report[output.formatId];
        if (found.length) {
          const existing = new Map(r.staleLines.map((l) => [l.key, l]));
          for (const l of found) {
            if (!existing.has(l.key)) existing.set(l.key, { key: l.key, changeLabels: [] });
            existing.get(l.key).changeLabels.push(l.label || cs[0].label);
          }
          r.staleLines = [...existing.values()];
          r.changeLabels = [...new Set(r.staleLines.flatMap((x) => x.changeLabels))];
          r.method = r.method || 'model-located';
          r.stale = true;
        } else if (!r.staleLines.length && !r.staleVisual) {
          // The model could not point at a line either — nothing is provably
          // outdated, so leave the card alone. Precision over brute force.
          r.stale = false;
        }
      } catch {
        /* leave the deterministic verdict in place */
      }
    });

    const staleCount = Object.values(report).filter((r) => r.stale).length;
    // Line-level precision: how much of the published body actually has to be
    // rewritten. This is the number the whole approach turns on.
    const totalLines = outputs.reduce((n, o) => n + iterLines(o).length, 0);
    const staleLines = Object.values(report).reduce((n, r) => n + (r.staleLines?.length || 0), 0);
    res.json({
      report,
      staleCount,
      total: outputs.length,
      totalLines,
      staleLines,
      ms: Date.now() - t,
    });
  } catch (e) { fail(res, e); }
});

app.post('/api/patch', async (req, res) => {
  try {
    const t = Date.now();
    const out = await patchLines(req.body);
    res.json({ ...out, ms: Date.now() - t });
  } catch (e) { fail(res, e); }
});

app.post('/api/patch-visual', async (req, res) => {
  try {
    const t = Date.now();
    const out = await patchVisual(req.body);
    res.json({ ...out, ms: Date.now() - t });
  } catch (e) { fail(res, e); }
});

/* ── anchor voice ─────────────────────────────────────────────────────── */

/**
 * Read a script aloud. Returns mp3 bytes, which the browser plays directly —
 * nothing is stored, uploaded or published.
 */
app.get('/api/voices', async (_req, res) => {
  try {
    if (!voiceReady()) return res.status(400).json({ error: voiceHint() });
    res.json({ voices: await listVoices(), defaultVoiceId: voiceId() });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.post('/api/voice', async (req, res) => {
  try {
    if (!voiceReady()) return res.status(400).json({ error: voiceHint() });
    const { text, voiceId: chosen } = req.body;
    const audio = await speak(text, chosen);
    res.json({
      audio: `data:${audio.contentType};base64,${audio.audioBase64}`,
      alignment: audio.alignment,
      cached: !!audio.cached,
    });
  } catch (e) {
    // A read-through failing is a nuisance, not a server fault — say why in a
    // shape the button can render.
    console.error('[lss] voice:', e.message);
    res.status(400).json({ error: String(e?.message || e) });
  }
});

/* ── publishing ───────────────────────────────────────────────────────── */

/** The shelf Zernio fetches from. Public on purpose — see media.js. */
app.get('/media/:id', (req, res) => {
  const item = readShelved(req.params.id);
  if (!item) return res.status(404).send('Not found');
  res.set('Content-Type', item.contentType);
  res.set('Cache-Control', 'public, max-age=1800');
  res.send(item.buffer);
});

/**
 * Publish one Instagram post or carousel.
 *
 * The caller sends already-composed cards as data: URIs — the browser draws
 * them, because the backdrop and the copy are both already there and the server
 * has no rasteriser. We park them at a public URL and hand Zernio the links.
 */
app.post('/api/publish/instagram', async (req, res) => {
  try {
    const { images, caption, hashtags, contentType = 'post', backgrounds = [] } = req.body;

    if (!zernioReady()) return res.status(400).json({ error: zernioHint() });
    // Supabase is the real answer here; the in-process shelf is only a fallback
    // for a machine that is already publicly reachable.
    const base = publicBase();
    if (!supabaseReady() && !base)
      return res.status(400).json({ error: `${supabaseHint()} ${publicUrlHint()}` });
    if (!Array.isArray(images) || !images.length)
      return res.status(400).json({ error: 'No image to post.' });
    if (images.length > MAX_MEDIA_ITEMS)
      return res.status(400).json({ error: `Instagram allows at most ${MAX_MEDIA_ITEMS} images per post.` });
    if (!CONTENT_TYPES.includes(contentType))
      return res.status(400).json({ error: `Unknown Instagram content type: ${contentType}` });

    const content = composeCaption(caption, hashtags);
    if (!content.trim()) return res.status(400).json({ error: 'The caption is empty.' });

    let imageUrls;
    let runId = null;
    if (supabaseReady()) {
      ({ runId, urls: imageUrls } = await uploadSlides(images, {
        runId: newRunId(contentType === 'story' ? 'story' : undefined),
        backgrounds,
      }));
      console.log(`[lss] uploaded ${imageUrls.length} slide(s) to ${supabaseBucket}/${runId}`);
    } else {
      imageUrls = images.map((d) => `${base}${shelveDataUrl(d).path}`);
    }

    const result = await publishToInstagram({ content, imageUrls, contentType });
    console.log(`[lss] published to instagram ${contentType}: ${result.platformPostUrl || result.postId}`);
    res.json({ ...result, runId, imageUrls });
  } catch (e) { fail(res, e); }
});

/* ── static (production build) ────────────────────────────────────────── */

const dist = path.join(here, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Files are the record; reconcile the index to them before serving.
rebuildIndex()
  .then((n) => recoverOrphans().then((k) => ({ n, k })))
  .then(({ n, k }) => {
    if (k) console.log(`  recovered ${k} rundown(s) interrupted by a restart`);
    if (n) console.log(`  rundown index rebuilt from ${n} file(s)`);
  })
  .catch(() => {});

startSweeper();

app.listen(PORT, () => {
  console.log(`\n  Living Story Sync — API on http://localhost:${PORT}`);
  // Names only — a value is never printed, logged, or sent to the browser.
  if (envFileLoaded)
    console.log(`  config: .env loaded (${envFileKeys.join(', ') || 'no entries'})`);
  else console.log(`  config: no .env at ${envFilePath} — using shell environment`);
  console.log(`  LLM backend: ${backendLabel}  ·  fan-out ${CONCURRENCY}`);
  console.log(`  Images: ${imageProviderLabel}`);
  console.log(`  Anchor voice: ${voiceReady() ? `ElevenLabs · ${voiceModel()}` : `off — ${voiceHint()}`}`);
  console.log(`  Discovery: ${configuredFeeds().length} competitor feeds · trending ${trendsReady ? 'on' : 'off'} · ${cmsLabel}`);
  const sw = sweeperStatus();
  console.log(`  Standing sweep: ${sw.auto ? `every ${Math.round(sw.intervalMs / 60000)} min` : 'off'} (server-side)`);
  console.log(
    `  Instagram publishing: ${
      !zernioReady()
        ? `off — ${zernioHint()}`
        : supabaseReady()
        ? `ready via Zernio · media → Supabase bucket "${supabaseBucket}"`
        : publicBase()
        ? `ready via Zernio · media → ${publicBase()}`
        : 'off — no public media host (set SUPABASE_SERVICE_ROLE_KEY or PUBLIC_BASE_URL)'
    }`
  );
  if (backend === 'claude-cli' && backendReady) {
    console.log('  (no API key set — using your local Claude Code login)');
    console.log(`  claude binary: ${cliPath}\n`);
  } else if (!backendReady) {
    // Fail loudly at boot rather than on the first click of Generate.
    console.error(`\n  ✗ NO MODEL BACKEND — the app will load but cannot generate.`);
    console.error(`    ${backendHint}\n`);
  } else {
    console.log('');
  }
});
