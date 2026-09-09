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
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(here, '..', 'data', 'rundowns');
const INDEX = path.join(DIR, '_index.json');

fs.mkdirSync(DIR, { recursive: true });

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

/** The dashboard row for one rundown: enough to list it, not the whole thing. */
function summarise(r) {
  const outputs = r.outputs || {};
  const ids = Object.keys(outputs);
  return {
    id: r.id,
    headline: r.story?.headline || r.cluster?.headline || 'Untitled',
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
  const rec = { ...r, updatedAt: now, createdAt: r.createdAt || now };
  const tmp = `${file(rec.id)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(rec, null, 2));
  await fsp.rename(tmp, file(rec.id));

  const rows = readIndex().filter((x) => x.id !== rec.id);
  rows.unshift(summarise(rec));
  await writeIndex(rows.slice(0, 1000));
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
    const b = new Set(norm(r.headline));
    let hit = 0;
    for (const t of a) if (b.has(t)) hit++;
    if (hit >= Math.min(3, a.size, b.size) && hit / Math.min(a.size, b.size) >= 0.5) return r;
  }
  return null;
}
