/**
 * Competitor feeds to monitor. Override with COMPETITOR_FEEDS in .env as
 * "Name|url, Name|url".
 */
export const DEFAULT_FEEDS = [
  { name: 'NDTV Hindi', url: 'https://feeds.feedburner.com/ndtvkhabar-latest' },
  { name: 'News18 Hindi', url: 'https://hindi.news18.com/commonfeeds/v1/hin/rss/latest.xml' },
];

export function configuredFeeds() {
  const raw = process.env.COMPETITOR_FEEDS;
  if (!raw) return DEFAULT_FEEDS;
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [name, url] = pair.split('|').map((x) => x.trim());
      return url ? { name, url } : null;
    })
    .filter(Boolean);
}

/**
 * Our own published output — what the desk has already put out.
 *
 * This is what "Already filed" is checked against. It must never be the
 * competitor list: matching a story against a rival's wire would tell the desk
 * it had covered something precisely because someone else had.
 *
 * Override with OWN_FEEDS in .env as "Name|url, Name|url".
 */
export const DEFAULT_OWN_FEEDS = [
  { name: 'Aaj Tak', url: 'https://www.aajtak.in/rssfeeds/?id=home' },
  { name: 'India Today', url: 'https://www.indiatoday.in/rss/1206578' },
  { name: 'India Today — Nation', url: 'https://www.indiatoday.in/rss/1206514' },
];

export function ownFeeds() {
  const raw = process.env.OWN_FEEDS;
  if (!raw) return DEFAULT_OWN_FEEDS;
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [name, url] = pair.split('|').map((x) => x.trim());
      return url ? { name, url } : null;
    })
    .filter(Boolean);
}
