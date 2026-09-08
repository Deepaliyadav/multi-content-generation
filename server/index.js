import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { backend, backendLabel, backendReady, backendHint, cliPath, backendConcurrency } from './llm.js';
import { envFileLoaded, envFilePath, envFileKeys } from './env.js';
import { imageProviderId, imageProviderLabel } from './images.js';
import { FORMATS, GROUPS, PROGRESS_VERB } from './formats.js';
import { SAMPLES } from './samples.js';
import {
  extractFacts, generateOne, diffLedgers,
  patchLines, patchVisual, locateStaleLines,
} from './pipeline.js';
import { scanOutput, iterLines } from './facts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
// Each backend declares its own sensible fan-out (the CLI one spawns a process
// per call, so it gets a smaller one).
const CONCURRENCY = Number(process.env.LSS_CONCURRENCY || backendConcurrency);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

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
    languages: LANGUAGES,
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
  const { story, facts, language, only } = req.body;
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
        const output = await generateOne({ formatId, story, facts, language });
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
