/**
 * Which stories the desk should run, and in what order.
 *
 * Two stages, deliberately. Measurable signals are computed in code so the
 * ranking can be explained and argued with — an editor asking "why did it pick
 * that?" gets numbers, not a shrug. The model then reads those signals and
 * applies news judgement, which is the part code cannot do.
 */
import './env.js';
import { completeJson } from './llm.js';
import { alreadyCovered } from './store.js';

/**
 * How much each beat matters to a national Indian desk. Edit freely — this is
 * an editorial preference, not a fact, and it is the first dial to turn if the
 * autopilot keeps choosing the wrong kind of story.
 */
export const BEAT_WEIGHT = {
  India: 1.0,
  Politics: 0.95,
  Crime: 0.85,
  World: 0.8,
  Business: 0.8,
  Health: 0.75,
  Sport: 0.65,
  Tech: 0.6,
  Entertainment: 0.4,
};

/** Demand signals for one cluster, all in 0..1. */
export function signals(cluster) {
  const outlets = new Set((cluster.sources || []).map((s) => s.source));
  // More outlets running it is the closest thing we have to measured demand.
  const corroboration = Math.min(outlets.size, 3) / 3;

  const newest = (cluster.sources || [])
    .map((s) => (s.published ? Date.parse(s.published) : NaN))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => b - a)[0];
  const ageHours = newest ? (Date.now() - newest) / 3_600_000 : null;
  // Full marks under an hour old, nothing left after twelve.
  const recency = ageHours == null ? 0.5 : Math.max(0, Math.min(1, 1 - ageHours / 12));

  const trending = cluster.origin === 'trending' ? 1 : 0;
  const beat = BEAT_WEIGHT[cluster.beat] ?? 0.7;

  const demand = 0.35 * corroboration + 0.25 * recency + 0.15 * trending + 0.25 * beat;

  return {
    outlets: outlets.size,
    items: (cluster.sources || []).length,
    ageHours: ageHours == null ? null : Number(ageHours.toFixed(1)),
    corroboration: Number(corroboration.toFixed(2)),
    recency: Number(recency.toFixed(2)),
    trending,
    beatWeight: beat,
    demand: Number(demand.toFixed(3)),
  };
}

const SYSTEM = `You are the output editor on a national Indian news desk, deciding which stories the desk runs next.

You are given candidate stories with measured signals: how many rival outlets are carrying it, how fresh it is, whether it is trending, and how much the beat matters to this desk.

Judge like an editor, not a scoreboard:
- Signals are evidence, not the verdict. A single-outlet story of real consequence beats three outlets chasing a celebrity's dinner.
- Prefer stories with consequence for readers: lives, money, rights, safety, power.
- Prefer stories the desk can actually produce well from what is known. A story with no established facts yet is a poor use of the desk.
- Avoid near-duplicates of each other: pick a spread, not three angles on one event.
- Reject listicles, horoscopes, promotional copy and pure gossip outright, however well they score.`;

/**
 * Pick the stories to run.
 *
 * Only unfiled candidates are eligible, and anything the desk already made a
 * rundown for in the last day is dropped before the model sees it — otherwise
 * a story that stays on the wire gets produced again every cycle.
 */
export async function selectStories(clusters, { count = 3 } = {}) {
  const eligible = [];
  const skipped = [];

  for (const c of clusters) {
    if (c.status !== 'recommend') {
      skipped.push({ headline: c.headline, why: 'already filed' });
      continue;
    }
    const dup = alreadyCovered(c.headline);
    if (dup) {
      skipped.push({ headline: c.headline, why: `already produced (${dup.id})` });
      continue;
    }
    eligible.push({ ...c, signals: signals(c) });
  }

  if (!eligible.length) return { picks: [], ranked: [], skipped };

  const ordered = eligible.sort((a, b) => b.signals.demand - a.signals.demand);

  const res = await completeJson({
    system: SYSTEM,
    user: `Choose the ${count} stories this desk should produce next, in priority order.

CANDIDATES
${ordered
  .map(
    (c, i) =>
      `[${i}] ${c.headline}
     ${c.summary}
     beat=${c.beat} · outlets=${c.signals.outlets} · age=${c.signals.ageHours ?? '?'}h · trending=${c.signals.trending ? 'yes' : 'no'} · demand=${c.signals.demand}`
  )
  .join('\n')}

Return exactly ${count} picks (fewer only if fewer are genuinely worth producing).

Return JSON:
{"picks":[{"candidate":0,"reason":"max 18 words on why this one, referencing the signals or the news value","priority":1}],
 "rejected":[{"candidate":3,"reason":"max 12 words"}]}`,
    maxTokens: 2500,
    effort: 'high',
  });

  const picks = (res.picks || [])
    .map((p) => {
      const c = ordered[p.candidate];
      if (!c) return null;
      return { ...c, pickReason: String(p.reason || '').trim(), priority: p.priority ?? 99 };
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, count);

  return {
    picks,
    ranked: ordered.map((c) => ({ headline: c.headline, beat: c.beat, ...c.signals })),
    rejected: res.rejected || [],
    skipped,
  };
}
