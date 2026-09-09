/**
 * Rundown store.
 *
 * One JSON file per rundown plus a small index, so the desk can be restarted
 * without losing the night's work and the dashboard can list hundreds of
 * rundowns without parsing every one.
 *
 * Deliberately not a database: a hackathon desk that survives a restart and can
 * be inspected with `cat` is worth more than a schema.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, '..', 'data', 'rundowns');
const INDEX = path.join(DIR, '_index.json');
export const MEDIA_DIR = path.join(here, '..', 'data', 'media');

fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * Pull generated images out of the record and onto disk.
 *
 * A rundown with imagery was 25MB of JSON, 24MB of it base64 — and the same
 * picture stored twice, once as `background` and again as `backgrounds[0]`.
 * Every status change re-read and rewrote all of it. Images are content-hashed,
 * so duplicates collapse to one file and re-saving costs nothing.
 */
function externaliseMedia(node, dir, urlBase) {
  if (typeof node === 'string') {
    if (!node.startsWith('data:image/')) return node;
    const m = /^data:([^;]+);base64,(.*)$/s.exec(node);
    if (!m) return node;
    const buf = Buffer.from(m[2], 'base64');
    const name = `${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${EXT[m[1]] || 'bin'}`;
    const dest = path.join(dir, name);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest, buf);
    }
    return `${urlBase}/${name}`;
  }
  if (Array.isArray(node)) return node.map((v) => externaliseMedia(v, dir, urlBase));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = externaliseMedia(v, dir, urlBase);
    return out;
  }
  return node;
}

/** Statuses a rundown moves through. Nothing is ever auto-published. */
export const STATUS = {
  GENERATING: 'generating',
  REVIEW: 'awaiting_review',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  FAILED: 'failed',
  DISCARDED: 'discarded',
};

const file = (id) => path.join(DIR, `${id}.json`);

export function newId() {
  return `rd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  } catch {
    return [];
  }
}

/** Written whole each time — the index is small and a torn write is worse. */
async function writeIndex(rows) {
  const tmp = `${INDEX}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(rows, null, 2));
  await fsp.rename(tmp, INDEX);
}

/**
 * Index updates are serialised.
 *
 * Producing rundowns in parallel meant two saves read the same index, each
 * added its own row, and the second write erased the first — two of five
 * rundowns simply vanished from the dashboard while their files sat on disk.
 * A promise chain is enough: writes are small and rare.
 */
let indexQueue = Promise.resolve();
function queueIndexUpdate(fn) {
  indexQueue = indexQueue.then(fn, fn);
  return indexQueue;
}

/** The dashboard row for one rundown: enough to list it, not the whole thing. */
function summarise(r) {
  const outputs = r.outputs || {};
  const ids = Object.keys(outputs);
  return {
    id: r.id,
    headline: r.story?.headline || r.cluster?.headline || 'Untitled',
    // The wording selection matched on. The brief rewrites the headline, so
    // comparing only the rewritten one let the same story through repeatedly.
    clusterHeadline: r.cluster?.headline || null,
    beat: r.cluster?.beat || null,
    origin: r.cluster?.origin || 'manual',
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    formats: ids.length,
    approved: ids.filter((k) => r.approvals?.[k]).length,
    factCount: (r.facts || []).length,
    pickReason: r.pickReason || null,
    score: r.score ?? null,
    sources: (r.cluster?.sources || []).map((s) => s.source),
    genMs: r.genMs ?? null,
    error: r.error || null,
  };
}

export async function saveRundown(r) {
  const now = new Date().toISOString();
  const withFiles = externaliseMedia(r, path.join(MEDIA_DIR, r.id), `/api/media/${r.id}`);
  const rec = { ...withFiles, updatedAt: now, createdAt: r.createdAt || now };
  const tmp = `${file(rec.id)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(rec, null, 2));
  await fsp.rename(tmp, file(rec.id));

  await queueIndexUpdate(async () => {
    const rows = readIndex().filter((x) => x.id !== rec.id);
    rows.unshift(summarise(rec));
    await writeIndex(rows.slice(0, 1000));
  });
  return rec;
}

export async function getRundown(id) {
  try {
    return JSON.parse(await fsp.readFile(file(id), 'utf8'));
  } catch {
    return null;
  }
}

export async function updateRundown(id, patch) {
  const cur = await getRundown(id);
  if (!cur) return null;
  return saveRundown({ ...cur, ...patch });
}

export function listRundowns({ status, limit = 200 } = {}) {
  const rows = readIndex();
  const filtered = status ? rows.filter((r) => r.status === status) : rows;
  return filtered
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export function counts() {
  const rows = readIndex();
  const by = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  return { total: rows.length, ...by };
}

/** Have we already made a rundown for this story? Keeps the loop from looping. */
export function alreadyCovered(headline, withinHours = 24) {
  const cutoff = Date.now() - withinHours * 3600_000;
  const norm = (s) =>
    String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);
  const a = new Set(norm(headline));
  if (!a.size) return null;
  for (const r of readIndex()) {
    if (new Date(r.createdAt).getTime() < cutoff) continue;
    if (r.status === STATUS.DISCARDED || r.status === STATUS.FAILED) continue;
    for (const candidate of [r.clusterHeadline, r.headline]) {
      if (!candidate) continue;
      const b = new Set(norm(candidate));
      let hit = 0;
      for (const t of a) if (b.has(t)) hit++;
      if (hit >= Math.min(3, a.size, b.size) && hit / Math.min(a.size, b.size) >= 0.5) return r;
    }
  }
  return null;
}

/**
 * Anything left mid-production by a restart is not coming back — the work was
 * in memory. Mark it failed on boot so the dashboard shows the truth instead of
 * a spinner that never resolves.
 */
export async function recoverOrphans({ olderThanMs = 10 * 60_000 } = {}) {
  const stuck = readIndex().filter(
    (r) => r.status === STATUS.GENERATING && Date.now() - new Date(r.updatedAt || r.createdAt).getTime() > olderThanMs
  );
  for (const r of stuck) {
    await updateRundown(r.id, {
      status: STATUS.FAILED,
      error: 'Interrupted — the desk restarted while this was still generating.',
    });
  }
  return stuck.length;
}

/**
 * Rebuild the index from the files on disk.
 *
 * The files are the record; the index is a convenience. If they disagree —
 * after a crash, or the write race above — the files win.
 */
export async function rebuildIndex() {
  const files = (await fsp.readdir(DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const rows = [];
  for (const f of files) {
    try {
      rows.push(summarise(JSON.parse(await fsp.readFile(path.join(DIR, f), 'utf8'))));
    } catch {
      /* a corrupt record should not take the index with it */
    }
  }
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  await queueIndexUpdate(() => writeIndex(rows.slice(0, 1000)));
  return rows.length;
}
