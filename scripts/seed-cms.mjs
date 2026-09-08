/**
 * Seed the mock CMS.
 *
 * Takes a spread of stories currently on the competitor wires and records them
 * as already filed, so a sweep returns a realistic mix of "Already filed" and
 * "Recommend filing" rather than flagging everything as new.
 *
 * This is demo scaffolding and says so in the data. Point CMS_SEARCH_URL at the
 * real CMS and this file is ignored entirely.
 *
 *   npm run seed:cms [-- --every 3]
 */
import '../server/env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAll } from '../server/rss.js';
import { configuredFeeds } from '../server/feeds.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.join(here, '..', 'data', 'cms-filed.json');
const everyArg = process.argv.indexOf('--every');
const EVERY = everyArg > -1 ? Number(process.argv[everyArg + 1]) || 3 : 3;

const { sources, items } = await fetchAll(configuredFeeds());
for (const s of sources) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name} — ${s.count} items ${s.error || ''}`);

const filed = items
  .filter((_, i) => i % EVERY === 0)
  .slice(0, 60)
  .map((it, i) => ({
    id: `cms-seed-${i + 1}`,
    headline: it.title,
    summary: it.summary.slice(0, 300),
    section: it.categories[0] || 'India',
    filedAt: it.published,
    url: null,
    simulated: true,
    note: 'Demo seed — stands in for a story already filed in the newsroom CMS.',
  }));

fs.mkdirSync(path.dirname(STORE), { recursive: true });
fs.writeFileSync(STORE, JSON.stringify(filed, null, 2));
console.log(`\nSeeded ${filed.length} filed stories (every ${EVERY}th wire item) -> data/cms-filed.json`);
