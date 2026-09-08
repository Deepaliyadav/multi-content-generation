/**
 * Story discovery.
 *
 * Two intake lanes feed one recommendation list:
 *
 *   1. Competitor RSS  — what rival desks have published in the last hours.
 *   2. Trending topics — what is moving on social/search, via the Anthropic
 *                        web_search server tool.
 *
 * Both are clustered into distinct stories, then checked against the CMS. A
 * story we already have is marked "Already filed"; anything else is recommended.
 *
 * Editorial line: this recommends WHAT TO COVER. It never reproduces a
 * competitor's copy — cluster headlines are written fresh as desk descriptions,
 * and the body a journalist starts from is their own.
 */
import './env.js';
import Anthropic from '@anthropic-ai/sdk';
import { completeJson } from './llm.js';
import { fetchAll } from './rss.js';
import { configuredFeeds } from './feeds.js';
import { cms, cmsLabel, cmsSimulated, overlapScore } from './cms.js';

const SWEEP_LIMIT = Number(process.env.LSS_SWEEP_LIMIT || 45);

/* ── 1. clustering ────────────────────────────────────────────────────── */

const CLUSTER_SYSTEM = `You are the intake editor on a national news desk. You read the competitor wires and tell the desk which distinct stories are running.

Rules you never break:
- Group items that are the SAME underlying story, even across outlets and languages.
- Write each cluster's headline yourself, in neutral desk English. Never copy a competitor's headline; you are describing what the story is, not republishing it.
- Never invent detail that is not in the items you were given.`;

export async function clusterItems(items) {
  const list = items
    .map((it, i) => `[${i}] (${it.source}) ${it.title}${it.summary ? `\n     ${it.summary.slice(0, 180)}` : ''}`)
    .join('\n');

  const res = await completeJson({
    system: CLUSTER_SYSTEM,
    user: `Here are the newest items from competitor wires. Group them into distinct stories.

${list}

Return the 10-16 most newsworthy distinct clusters, most significant first. Drop listicles, horoscopes, sponsored posts and pure entertainment gossip.

For each cluster:
- "headline": your own neutral English description of the story, max 14 words.
- "summary": 1-2 sentences, only what the items actually say.
- "beat": one of India, World, Politics, Business, Sport, Crime, Health, Tech, Entertainment.
- "topics": 2-4 short keyword tags (use the language the story is reported in where that is a proper noun).
- "items": the [index] numbers belonging to this cluster.

Return JSON: {"clusters":[{"headline":"...","summary":"...","beat":"...","topics":["..."],"items":[0,4]}]}`,
    maxTokens: 6000,
    effort: 'medium',
  });

  return (res.clusters || [])
    .map((c) => {
      const idx = (c.items || []).filter((i) => Number.isInteger(i) && items[i]);
      return {
        headline: String(c.headline || '').trim(),
        summary: String(c.summary || '').trim(),
        beat: String(c.beat || 'India').trim(),
        topics: (c.topics || []).map(String).slice(0, 4),
        sources: idx.map((i) => ({
          source: items[i].source,
          title: items[i].title,
          link: items[i].link,
          published: items[i].published,
        })),
        origin: 'rss',
      };
    })
    .filter((c) => c.headline && c.sources.length);
}

/* ── 2. trending topics via web search ────────────────────────────────── */

export const trendsReady = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function trendingTopics({ maxUses = 4 } = {}) {
  if (!trendsReady)
    throw new Error('Trending topics need ANTHROPIC_API_KEY (the web_search tool runs on the Messages API).');

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    max_tokens: 6000,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }],
    system: `${CLUSTER_SYSTEM}

You have a web search tool. Use it to find what is genuinely trending in India right now on social platforms and search.`,
    messages: [
      {
        role: 'user',
        content: `Find the news topics trending in India in the last few hours — X/Twitter trends, what is being discussed heavily, and breaking stories getting search traffic.

Search, then report 6-10 distinct topics a national Hindi/English news desk should consider covering. Skip pure entertainment gossip, promotional hashtags and anything you cannot corroborate.

For each: "headline" (your own neutral English description, max 14 words), "summary" (1-2 sentences of what is actually established), "beat", "topics" (2-4 tags), and "evidence" (max 12 words on where you saw it trending).

End your reply with ONLY this JSON object and nothing after it:
{"topics":[{"headline":"...","summary":"...","beat":"...","topics":["..."],"evidence":"..."}]}`,
      },
    ],
  });

  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const searches = msg.content.filter((b) => b.type === 'web_search_tool_result').length;

  const start = text.lastIndexOf('{"topics"');
  const raw = start === -1 ? text.slice(text.lastIndexOf('{')) : text.slice(start);
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(0, raw.lastIndexOf('}') + 1));
  } catch {
    throw new Error(`Could not parse trending topics from the search agent: ${text.slice(-200)}`);
  }

  return {
    searches,
    clusters: (parsed.topics || []).map((t) => ({
      headline: String(t.headline || '').trim(),
      summary: String(t.summary || '').trim(),
      beat: String(t.beat || 'India').trim(),
      topics: (t.topics || []).map(String).slice(0, 4),
      evidence: String(t.evidence || '').trim(),
      sources: [],
      origin: 'trending',
    })).filter((c) => c.headline),
  };
}

/* ── 3. the Already Filed check ───────────────────────────────────────── */

const FILED_SYSTEM = `You are the desk editor deciding whether a story has already been filed by your own newsroom.

You are shown a candidate story and the closest matches from the CMS. Decide whether the CMS already covers it.

Be strict in both directions:
- "already_filed" only when the CMS story is the SAME event, not merely the same topic. Two different road accidents are not the same story. A follow-up with materially new facts (a rising toll, an arrest, a verdict) is NOT already filed — it is a fresh angle.
- "recommend" when nothing in the CMS covers this event.
A false "already filed" means the desk misses a story. A false "recommend" wastes a reporter. Neither is free.`;

export async function checkFiled(clusters) {
  // Cheap retrieval first: only clusters with a plausible CMS neighbour cost a
  // judgement call. Everything else is unambiguously new.
  const withCandidates = [];
  for (const c of clusters) {
    const query = [c.headline, ...(c.topics || [])].join(' ');
    let hits = [];
    try {
      hits = await cms.search({ query, limit: 5 });
    } catch (e) {
      c.cmsError = String(e.message || e);
    }
    // Keep the retrieval honest: drop weak lexical noise before the model sees it.
    c.candidates = (hits || []).filter(
      (h) => Math.max(overlapScore(c.headline, h.headline), overlapScore(c.summary || '', h.headline)) > 0.12
    );
    if (c.candidates.length) withCandidates.push(c);
  }

  for (const c of clusters) {
    if (!c.candidates?.length) {
      c.status = c.cmsError ? 'unknown' : 'recommend';
      c.reason = c.cmsError ? `CMS lookup failed: ${c.cmsError}` : 'Nothing close to this in the CMS.';
      c.match = null;
    }
  }

  if (!withCandidates.length) return clusters;

  const res = await completeJson({
    system: FILED_SYSTEM,
    user: `For each candidate story, decide whether the CMS already covers that same event.

${withCandidates
  .map(
    (c, i) => `--- CANDIDATE ${i} ---
Story: ${c.headline}
Detail: ${c.summary}
CMS matches:
${c.candidates.map((h, j) => `  (${j}) ${h.headline}${h.summary ? `\n      ${h.summary.slice(0, 160)}` : ''}`).join('\n')}`
  )
  .join('\n\n')}

Return JSON:
{"verdicts":[{"candidate":0,"status":"already_filed"|"recommend","match":0,"confidence":"high"|"medium"|"low","reason":"max 16 words"}]}

"match" is the index of the CMS story that covers it, or null when status is "recommend".`,
    maxTokens: 4000,
    effort: 'high',
  });

  for (const v of res.verdicts || []) {
    const c = withCandidates[v.candidate];
    if (!c) continue;
    c.status = v.status === 'already_filed' ? 'already_filed' : 'recommend';
    c.confidence = v.confidence || 'medium';
    c.reason = String(v.reason || '').trim();
    c.match = v.status === 'already_filed' && c.candidates[v.match] ? c.candidates[v.match] : null;
  }
  // Anything the model skipped is not silently dropped.
  for (const c of withCandidates)
    if (!c.status) {
      c.status = 'recommend';
      c.reason = 'No verdict returned for this candidate; treated as unfiled.';
    }

  return clusters;
}

/* ── orchestration ────────────────────────────────────────────────────── */

export async function discover({ useRss = true, useTrending = true } = {}) {
  const started = Date.now();
  const out = { sources: [], clusters: [], cms: { label: cmsLabel, simulated: cmsSimulated }, errors: [] };

  let rssClusters = [];
  let trendClusters = [];

  const jobs = [];
  if (useRss)
    jobs.push(
      (async () => {
        const { sources, items } = await fetchAll(configuredFeeds());
        out.sources = sources;
        out.swept = items.length;
        if (!items.length) return;
        rssClusters = await clusterItems(items.slice(0, SWEEP_LIMIT));
      })().catch((e) => out.errors.push(`RSS sweep: ${e.message}`))
    );

  if (useTrending && trendsReady)
    jobs.push(
      (async () => {
        const t = await trendingTopics();
        out.searches = t.searches;
        trendClusters = t.clusters;
      })().catch((e) => out.errors.push(`Trending: ${e.message}`))
    );
  else if (useTrending) out.errors.push('Trending topics need ANTHROPIC_API_KEY.');

  await Promise.all(jobs);

  const all = [...rssClusters, ...trendClusters];
  out.clusters = await checkFiled(all);
  out.ms = Date.now() - started;
  out.counts = {
    total: out.clusters.length,
    recommend: out.clusters.filter((c) => c.status === 'recommend').length,
    alreadyFiled: out.clusters.filter((c) => c.status === 'already_filed').length,
  };
  return out;
}

/* ── 4. starter brief ─────────────────────────────────────────────────── */

const BRIEF_SYSTEM = `You are a rewrite-desk journalist turning an intake note into a starter brief for a reporter.

This is NOT a publishable story and you must not pretend otherwise. It is a working draft the reporter will verify and rewrite.

Absolute rules:
- Use ONLY what the intake note and the listed source items actually say. Invent nothing — no quotes, no numbers, no causes, no names that are not there.
- Attribute every claim to the outlet that reported it ("NDTV Hindi reported", "according to News18 Hindi"). Never assert a competitor's reporting as established fact.
- Do not reproduce a competitor's sentences. Write it fresh, in your own words.
- Where a detail a story would normally carry is missing, say plainly that it is not yet confirmed rather than filling the gap.`;

export async function draftBrief(cluster) {
  const sources = (cluster.sources || [])
    .map((s) => `- ${s.source}: ${s.title}${s.published ? ` (${s.published})` : ''}`)
    .join('\n');

  const res = await completeJson({
    system: BRIEF_SYSTEM,
    user: `Write a starter brief for this story.

INTAKE NOTE
Headline: ${cluster.headline}
Detail: ${cluster.summary}
Beat: ${cluster.beat}
${cluster.evidence ? `Trending signal: ${cluster.evidence}` : ''}

SOURCE ITEMS SEEN ON THE WIRE
${sources || '- (no wire items — this came from a trending-topic search)'}

Produce:
- "headline": a straight news headline in English, max 14 words, no hype.
- "body": 4-6 short paragraphs, separated by blank lines. Attribute throughout. The final paragraph must state explicitly what still needs to be confirmed by the desk before publication.

Return JSON: {"headline":"...","body":"..."}`,
    maxTokens: 3000,
    effort: 'medium',
  });

  const headline = String(res.headline || cluster.headline).trim();
  const body = String(res.body || '').trim();
  if (!body) throw new Error('The brief came back empty.');
  return {
    headline,
    body,
    unverified: true,
    sourcedFrom: [...new Set((cluster.sources || []).map((s) => s.source))],
  };
}
