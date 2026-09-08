import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { backend, backendLabel, backendReady, backendHint, cliPath, backendConcurrency } from './llm.js';
import { envFileLoaded, envFilePath, envFileKeys } from './env.js';
import { imageProviderId, imageProviderLabel } from './images.js';
import { discover, draftBrief, trendsReady } from './discover.js';
import { cms, cmsLabel, cmsSimulated } from './cms.js';
import { configuredFeeds } from './feeds.js';
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

export const LANGUAGES = ['Hindi', 'Bangla', 'English', 'Marathi', 'Tamil', 'Telugu', 'Gujarati', 'Urdu'];

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

/* ── story discovery (competitor wires + trending topics) ─────────────── */

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
    if (!cmsSimulated)
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
