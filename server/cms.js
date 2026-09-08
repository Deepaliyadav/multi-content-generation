/**
 * CMS adapter for the "Already Filed" check.
 *
 * Two backends behind one interface, so swapping in the real newsroom CMS is a
 * config change rather than a rewrite:
 *
 *   mock  (default) a local JSON store of filed stories. The STORE is simulated;
 *                   the retrieval and the duplicate judgement running against it
 *                   are real.
 *   http            a real CMS search endpoint, configured by env.
 *
 * Set CMS_SEARCH_URL to switch. {query} in the URL is replaced with the
 * URL-encoded query; CMS_AUTH_HEADER / CMS_AUTH_VALUE add auth if needed, and
 * CMS_RESULTS_PATH / CMS_FIELD_* map an arbitrary response shape onto ours.
 */
import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(here, '..', 'data', 'cms-filed.json');

/* ── shared text utilities ────────────────────────────────────────────── */

// Hindi stop words plus English ones — a headline overlap score that counts
// "में" and "के" as signal would match everything against everything.
const STOP = new Set([
  'the','a','an','of','in','on','for','to','and','is','are','at','with','from','by','as','it','its','after','over',
  'में','के','की','का','को','से','पर','और','है','हैं','था','थे','थी','कि','ने','इस','उस','एक','भी','तक','हो','कर','लिए','साथ','नहीं','क्या','अब',
]);

export function tokens(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Jaccard-ish overlap, weighted toward the shorter (query) side. */
export function overlapScore(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size);
}

/* ── mock store ───────────────────────────────────────────────────────── */

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return [];
  }
}

function writeStore(rows) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(rows, null, 2));
}

const mock = {
  id: 'mock',
  label: 'Mock CMS (local store — swap for the real endpoint)',
  simulated: true,
  ready: () => true,
  async search({ query, limit = 6 }) {
    const rows = readStore();
    return rows
      .map((r) => ({ ...r, _score: Math.max(overlapScore(query, r.headline), overlapScore(query, r.summary || '')) }))
      .filter((r) => r._score > 0.14)
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
  },
  /** Demo affordance: file a recommended story so the next sweep sees it. */
  async file(article) {
    const rows = readStore();
    const row = {
      id: `cms-${Date.now().toString(36)}`,
      headline: article.headline,
      summary: article.summary || '',
      section: article.section || 'India',
      filedAt: new Date().toISOString(),
      url: article.url || null,
    };
    rows.unshift(row);
    writeStore(rows.slice(0, 500));
    return row;
  },
  async count() {
    return readStore().length;
  },
};

/* ── real HTTP CMS ────────────────────────────────────────────────────── */

const dig = (obj, dotted) =>
  dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const http = {
  id: 'http',
  label: `CMS API (${process.env.CMS_SEARCH_URL || 'unconfigured'})`,
  simulated: false,
  ready: () => !!process.env.CMS_SEARCH_URL,
  async search({ query, limit = 6 }) {
    const url = process.env.CMS_SEARCH_URL.includes('{query}')
      ? process.env.CMS_SEARCH_URL.replace('{query}', encodeURIComponent(query))
      : `${process.env.CMS_SEARCH_URL}${process.env.CMS_SEARCH_URL.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`;
    const headers = { accept: 'application/json' };
    if (process.env.CMS_AUTH_HEADER && process.env.CMS_AUTH_VALUE)
      headers[process.env.CMS_AUTH_HEADER] = process.env.CMS_AUTH_VALUE;

    const res = await fetch(url, { headers });
    const body = await res.text();
    if (!res.ok) throw new Error(`CMS HTTP ${res.status}: ${body.slice(0, 200)}`);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`CMS returned non-JSON: ${body.slice(0, 200)}`);
    }
    const rows = process.env.CMS_RESULTS_PATH ? dig(data, process.env.CMS_RESULTS_PATH) : data;
    if (!Array.isArray(rows)) throw new Error('CMS results were not an array — set CMS_RESULTS_PATH.');
    const F = {
      id: process.env.CMS_FIELD_ID || 'id',
      headline: process.env.CMS_FIELD_HEADLINE || 'title',
      summary: process.env.CMS_FIELD_SUMMARY || 'summary',
      filedAt: process.env.CMS_FIELD_DATE || 'publishedAt',
      url: process.env.CMS_FIELD_URL || 'url',
    };
    return rows.slice(0, limit).map((r) => ({
      id: String(dig(r, F.id) ?? ''),
      headline: String(dig(r, F.headline) ?? ''),
      summary: String(dig(r, F.summary) ?? ''),
      filedAt: dig(r, F.filedAt) ?? null,
      url: dig(r, F.url) ?? null,
    }));
  },
  async file() {
    throw new Error('Filing into a live CMS is not something this tool does — it recommends only.');
  },
  async count() {
    return null;
  },
};

export const cms = http.ready() ? http : mock;
export const cmsSimulated = cms.simulated;
export const cmsLabel = cms.label;
