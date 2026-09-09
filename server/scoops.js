/**
 * The unclaimed board.
 *
 * Topics moving on social that no publisher has filed yet — the gap the desk
 * can be first into. Priority is how many platforms carry it: one platform is
 * noise, four at once is a story about to break everywhere.
 *
 * The TOPICS below are seeded sample data (there is no social firehose wired
 * in). The "still unclaimed" check is NOT seeded — every topic is matched live
 * against the competitor wires and our own published feeds, so anything a
 * publisher picks up drops off the board on the next refresh. That is the part
 * that has to be real for the board to mean anything.
 */
import './env.js';
import { fetchAll } from './rss.js';
import { configuredFeeds, ownFeeds } from './feeds.js';
import { isCandidate } from './cms.js';

export const PLATFORMS = ['X', 'Instagram', 'YouTube', 'Reddit', 'WhatsApp'];

/** Seeded until a social listening source is connected. */
const TOPICS = [
  {
    id: 'sc1',
    headline: 'Bengaluru apartment towers reportedly running dry as tanker cartel doubles rates',
    summary:
      'Residents across Whitefield and Sarjapur are posting tanker invoices showing rates doubling in a week. Several RWAs say supply was cut without notice.',
    beat: 'India',
    platforms: ['X', 'Instagram', 'Reddit', 'WhatsApp'],
    signal: 'RWA groups circulating invoices; local handles amplifying',
    firstSeen: '2h ago',
    keywords: ['bengaluru', 'water', 'tanker', 'whitefield', 'sarjapur'],
  },
  {
    id: 'sc2',
    headline: 'Coaching centre in Kota accused of withholding student records after fee dispute',
    summary:
      'Parents say transfer certificates are being held back over disputed refunds. Screenshots of the centre’s messages are circulating widely.',
    beat: 'Education',
    platforms: ['X', 'Reddit', 'WhatsApp'],
    signal: 'Parent groups sharing screenshots; student subreddits picking it up',
    firstSeen: '4h ago',
    keywords: ['kota', 'coaching', 'refund', 'transfer certificate'],
  },
  {
    id: 'sc3',
    headline: 'Video appears to show railway gate left unmanned at busy Ghaziabad crossing',
    summary:
      'A clip shot from a stopped car appears to show a level crossing operating without a gateman during peak traffic. Location and date are unverified.',
    beat: 'India',
    platforms: ['X', 'Instagram', 'YouTube', 'Reddit', 'WhatsApp'],
    signal: 'Clip reposted across regional pages; no outlet has geolocated it',
    firstSeen: '90m ago',
    keywords: ['ghaziabad', 'railway', 'crossing', 'gateman'],
  },
  {
    id: 'sc4',
    headline: 'Small traders in Surat say a payments app froze settlements without explanation',
    summary:
      'Textile market traders report settlement holds running into lakhs. The company has not commented publicly.',
    beat: 'Business',
    platforms: ['X', 'WhatsApp'],
    signal: 'Trade association groups; a few local handles',
    firstSeen: '6h ago',
    keywords: ['surat', 'payments', 'settlement', 'traders'],
  },
  {
    id: 'sc5',
    headline: 'Hostel students in Pune post images of flooded rooms after overnight rain',
    summary:
      'Students at two colleges are posting images of waterlogged ground-floor rooms and say facilities staff have not responded.',
    beat: 'India',
    platforms: ['Instagram', 'X', 'Reddit'],
    signal: 'Campus accounts; images geotagged to two hostels',
    firstSeen: '3h ago',
    keywords: ['pune', 'hostel', 'flood', 'college'],
  },
];

/** Cheap-ish and cached: both feed sets, reused across a refresh. */
let published = { at: 0, items: [] };
const TTL_MS = 3 * 60_000;

async function publishedHeadlines() {
  if (Date.now() - published.at < TTL_MS && published.items.length) return published.items;
  const [rivals, ours] = await Promise.all([
    fetchAll(configuredFeeds()).catch(() => ({ items: [] })),
    fetchAll(ownFeeds()).catch(() => ({ items: [] })),
  ]);
  const items = [
    ...rivals.items.map((i) => ({ ...i, side: 'rival' })),
    ...ours.items.map((i) => ({ ...i, side: 'ours' })),
  ];
  published = { at: Date.now(), items };
  return items;
}

/**
 * Has anyone filed this yet?
 *
 * Matched on the topic's headline and its keywords against every headline on
 * the wires and on our own feeds. A keyword hit alone is not enough — two
 * unrelated Bengaluru stories share "bengaluru" — so a claim needs the same
 * headline test the CMS check uses.
 */
function claimedBy(topic, headlines) {
  for (const h of headlines) {
    if (isCandidate(topic.headline, h.title)) {
      return { outlet: h.source, side: h.side, headline: h.title, link: h.link };
    }
  }
  return null;
}

export async function scoops() {
  const headlines = await publishedHeadlines();

  const rows = TOPICS.map((t) => {
    const claim = claimedBy(t, headlines);
    return {
      ...t,
      platformCount: t.platforms.length,
      // Priority is platform spread first, then how long it has been sitting
      // there unclaimed — a story on four platforms that nobody has touched is
      // the one to take.
      priority: t.platforms.length >= 4 ? 'high' : t.platforms.length === 3 ? 'medium' : 'low',
      claimed: claim,
    };
  });

  const open = rows.filter((r) => !r.claimed).sort((a, b) => b.platformCount - a.platformCount);
  const taken = rows.filter((r) => r.claimed);

  return {
    scoops: open,
    claimed: taken,
    checkedAgainst: headlines.length,
    seeded: true,
    checkedAt: new Date().toISOString(),
  };
}

/** Shape a topic like a discovery cluster so the desk can produce it. */
export function asCluster(topic) {
  return {
    headline: topic.headline,
    summary: topic.summary,
    beat: topic.beat,
    topics: topic.keywords || [],
    origin: 'social',
    evidence: `Trending on ${topic.platforms.join(', ')} — ${topic.signal}`,
    sources: [],
    status: 'recommend',
    pickReason: `Unclaimed on ${topic.platforms.length} platforms — no publisher has filed it`,
  };
}

export const topicById = (id) => TOPICS.find((t) => t.id === id) || null;
