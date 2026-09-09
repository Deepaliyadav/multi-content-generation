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
import { fetchAll } from './rss.js';
import { ownFeeds } from './feeds.js';

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

/**
 * Is this published story a plausible match for the query, worth the cost of a
 * model verdict?
 *
 * A ratio alone is far too loose on Hindi headlines: short token sets make the
 * score spike on coincidence, and measured against real feeds a 0.14 ratio
 * matched 60 of 60 unrelated competitor headlines — "archery series" against
 * "school complaint". The number of shared meaningful words is what actually
 * separates them. At three shared words the same sample dropped to 3 of 60
 * while still finding 38 of 40 of our own stories.
 *
 * The floor adapts so a genuinely short headline can still match on everything
 * it has.
 */
export function isCandidate(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return false;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const need = Math.min(3, A.size, B.size);
  return shared >= need && shared / Math.min(A.size, B.size) >= 0.25;
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

/**
 * What we have already published, read from our own public feeds.
 *
 * Not a CMS query — a recency window over Aaj Tak and India Today's own RSS.
 * That is a real answer to "have we run this?", but only for the last few
 * hundred stories; anything older than the feed window looks unfiled. A real
 * CMS_SEARCH_URL searches the whole archive and should replace this in
 * production.
 */
let publishedCache = { at: 0, rows: [] };
const PUBLISHED_TTL_MS = 5 * 60_000;

async function publishedIndex() {
  if (Date.now() - publishedCache.at < PUBLISHED_TTL_MS && publishedCache.rows.length)
    return publishedCache.rows;

  const { items } = await fetchAll(ownFeeds());
  const rows = items.map((it, i) => ({
    id: `own-${i}`,
    headline: it.title,
    summary: it.summary?.slice(0, 300) || '',
    section: it.categories?.[0] || 'India',
    filedAt: it.published,
    url: it.link,
    outlet: it.source,
  }));
  // Anything the desk filed by hand during a demo sits alongside the live feed.
  const manual = readStore();
  publishedCache = { at: Date.now(), rows: [...manual, ...rows] };
  return publishedCache.rows;
}

const own = {
  id: 'own-feeds',
  label: `Published index · ${ownFeeds().map((f) => f.name).join(', ')}`,
  simulated: false,
  // Real data, but a recency window rather than the archive — and it accepts a
  // local "we filed this" marker, which a live CMS must not.
  partial: true,
  canFile: true,
  ready: () => true,
  async search({ query, limit = 6 }) {
    const rows = await publishedIndex();
    return rows
      // Headline against headline only. A 300-character summary shares three
      // common words with almost anything, which is how a paddy-farming tip
      // matched a horoscope; the headline is what identifies the story.
      .filter((r) => isCandidate(query, r.headline))
      .map((r) => ({ ...r, _score: Math.max(overlapScore(query, r.headline), overlapScore(query, r.summary || '')) }))
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
  },
  /** Demo affordance: record a story as filed so the next sweep sees it. */
  async file(article) {
    const rows = readStore();
    const row = {
      id: `filed-${Date.now().toString(36)}`,
      headline: article.headline,
      summary: article.summary || '',
      section: article.section || 'India',
      filedAt: new Date().toISOString(),
      url: article.url || null,
      outlet: 'filed here',
    };
    rows.unshift(row);
    writeStore(rows.slice(0, 500));
    publishedCache = { at: 0, rows: [] }; // force a rebuild on the next search
    return row;
  },
  async count() {
    return (await publishedIndex()).length;
  },
};

/* ── real HTTP CMS ────────────────────────────────────────────────────── */

const dig = (obj, dotted) =>
  dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

const http = {
  id: 'http',
  label: `CMS API (${process.env.CMS_SEARCH_URL || 'unconfigured'})`,
  simulated: false,
  partial: false,
  canFile: false,
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

export const cms = http.ready() ? http : own;
export const cmsSimulated = cms.simulated;
export const cmsCanFile = !!cms.canFile;
export const cmsPartial = !!cms.partial;
export const cmsLabel = cms.label;
