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

function parseClusters(res, items, offset) {
  return (res.clusters || [])
    .map((c) => {
      const idx = (c.items || [])
        .map((i) => i - offset)
        .filter((i) => Number.isInteger(i) && items[i]);
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

async function clusterBatch(items, offset, want) {
  const list = items
    .map((it, i) => `[${i + offset}] (${it.source}) ${it.title}${it.summary ? `\n     ${it.summary.slice(0, 160)}` : ''}`)
    .join('\n');

  const res = await completeJson({
    system: CLUSTER_SYSTEM,
    user: `Here are items from competitor wires. Group them into distinct stories.

${list}

Return the ${want} most newsworthy distinct clusters, most significant first. Drop listicles, horoscopes, sponsored posts and pure entertainment gossip.

For each cluster:
- "headline": your own neutral English description of the story, max 14 words.
- "summary": 1-2 sentences, only what the items actually say.
- "beat": one of India, World, Politics, Business, Sport, Crime, Health, Tech, Entertainment.
- "topics": 2-4 short keyword tags.
- "items": the [index] numbers belonging to this cluster, exactly as numbered above.

Return JSON: {"clusters":[{"headline":"...","summary":"...","beat":"...","topics":["..."],"items":[0,4]}]}`,
    maxTokens: 4000,
    effort: 'medium',
  });
  return parseClusters(res, items, offset);
}

/**
 * Cluster the sweep.
 *
 * Split across parallel calls rather than one long one: a single request over
 * the whole sweep was the dominant cost in a 110-second round trip, because the
 * output is large and generated serially. Two half-size calls overlap.
 */
export async function clusterItems(items) {
  const BATCH = Number(process.env.LSS_CLUSTER_BATCH || 22);
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push({ slice: items.slice(i, i + BATCH), offset: i });

  const perBatch = Math.max(5, Math.ceil(14 / batches.length));
  const results = await Promise.all(
    batches.map((b) =>
      clusterBatch(b.slice, b.offset, perBatch).catch(() => [])
    )
  );

  // Same story can surface in more than one batch; fold those together.
  const merged = [];
  for (const c of results.flat()) {
    const dup = merged.find(
      (m) => overlapScore(m.headline, c.headline) > 0.55 || overlapScore(m.summary, c.summary) > 0.6
    );
    if (dup) dup.sources.push(...c.sources);
    else merged.push(c);
  }
  return merged;
}

/* ── 2. trending topics via web search ────────────────────────────────── */

export const trendsReady = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * Trending topics, in two passes.
 *
 * One pass asking a tool-using agent to both search AND close on a JSON object
 * is unreliable — it finishes in prose often enough that the parse fails and
 * trending silently vanishes from the sweep. So the search agent just reports
 * what it found, and a second, tool-free call turns those notes into JSON.
 */
export async function trendingTopics({ maxUses = 3 } = {}) {
  if (!trendsReady)
    throw new Error('Trending topics need ANTHROPIC_API_KEY (the web_search tool runs on the Messages API).');

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    max_tokens: 5000,
    output_config: { effort: 'low' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxUses }],
    system: `${CLUSTER_SYSTEM}

You have a web search tool. Use it to find what is genuinely trending in India right now.`,
    messages: [
      {
        role: 'user',
        content: `Find the news topics trending in India in the last few hours — X/Twitter trends, heavily discussed stories, and breaking news getting search traffic.

Search, then write up the 6-10 distinct topics a national Hindi/English news desk should consider covering. Skip pure entertainment gossip, promotional hashtags and anything you cannot corroborate.

For each topic write a short paragraph: what the story is, what is actually established, which beat it belongs to, and where you saw it trending. Plain prose is fine — you do not need to format it as data.`,
      },
    ],
  });

  const notes = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const searches = msg.content.filter((b) => b.type === 'web_search_tool_result').length;
  if (!notes.trim()) return { searches, clusters: [] };

  const res = await completeJson({
    system: CLUSTER_SYSTEM,
    user: `Turn these research notes into structured entries. Use only what the notes say — add nothing.

NOTES
${notes}

Return JSON:
{"topics":[{"headline":"neutral English description, max 14 words","summary":"1-2 sentences of what is established","beat":"India|World|Politics|Business|Sport|Crime|Health|Tech|Entertainment","topics":["tag"],"evidence":"max 12 words on where it was trending"}]}`,
    maxTokens: 4000,
    effort: 'low',
  });

  return {
    searches,
    clusters: (res.topics || [])
      .map((t) => ({
        headline: String(t.headline || '').trim(),
        summary: String(t.summary || '').trim(),
        beat: String(t.beat || 'India').trim(),
        topics: (t.topics || []).map(String).slice(0, 4),
        evidence: String(t.evidence || '').trim(),
        sources: [],
        origin: 'trending',
      }))
      .filter((c) => c.headline),
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
  await Promise.all(
    clusters.map(async (c) => {
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
    })
  );
  const withCandidates = clusters.filter((c) => c.candidates?.length);

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

/**
 * Run a sweep, reporting progress as it goes.
 *
 * This streams rather than returning once, because the whole job takes long
 * enough that a single response times out in the browser and reads as a dead
 * endpoint. Sources land in about a second, the story list as soon as clustering
 * finishes, and the filed/unfiled verdicts after that — so the desk sees work
 * happening instead of a spinner.
 *
 * `onEvent` is optional; without it this resolves to the same final object as
 * before.
 */
export async function discover({ useRss = true, useTrending = true } = {}, onEvent = () => {}) {
  const started = Date.now();
  const out = { sources: [], clusters: [], cms: { label: cmsLabel, simulated: cmsSimulated }, errors: [] };

  const jobs = [];
  const checkedAll = [];

  /**
   * Publish a lane the moment it is ready.
   *
   * The wires cluster in about 13 seconds; the search agent takes far longer.
   * Holding the wire stories back until search finishes made the desk stare at
   * an empty list for a minute and a half for no reason.
   */
  const publish = async (clusters, origin) => {
    if (!clusters.length) return;
    onEvent({ type: 'preliminary', origin, clusters: clusters.map((c) => ({ ...c, status: 'checking' })) });
    const checked = await checkFiled(clusters);
    checkedAll.push(...checked);
    onEvent({ type: 'checked', origin, clusters: checked });
  };

  if (useRss)
    jobs.push(
      (async () => {
        onEvent({ type: 'phase', phase: 'Reading competitor wires…' });
        const { sources, items } = await fetchAll(configuredFeeds());
        out.sources = sources;
        out.swept = items.length;
        onEvent({ type: 'sources', sources, swept: items.length });
        if (!items.length) return;
        onEvent({ type: 'phase', phase: `Clustering ${Math.min(items.length, SWEEP_LIMIT)} wire items into distinct stories…` });
        const rssClusters = await clusterItems(items.slice(0, SWEEP_LIMIT));
        onEvent({ type: 'clustered', origin: 'rss', count: rssClusters.length });
        await publish(rssClusters, 'rss');
      })().catch((e) => {
        out.errors.push(`RSS sweep: ${e.message}`);
        onEvent({ type: 'error', scope: 'rss', error: e.message });
      })
    );

  if (useTrending && trendsReady)
    jobs.push(
      (async () => {
        onEvent({ type: 'phase', phase: 'Searching for what is trending…' });
        const t = await trendingTopics();
        out.searches = t.searches;
        onEvent({ type: 'clustered', origin: 'trending', count: t.clusters.length, searches: t.searches });
        await publish(t.clusters, 'trending');
      })().catch((e) => {
        out.errors.push(`Trending: ${e.message}`);
        onEvent({ type: 'error', scope: 'trending', error: e.message });
      })
    );
  else if (useTrending) out.errors.push('Trending topics need ANTHROPIC_API_KEY.');

  await Promise.all(jobs);

  out.clusters = checkedAll;
  out.ms = Date.now() - started;
  out.counts = {
    total: out.clusters.length,
    recommend: out.clusters.filter((c) => c.status === 'recommend').length,
    alreadyFiled: out.clusters.filter((c) => c.status === 'already_filed').length,
  };
  onEvent({ type: 'done', ...out });
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
