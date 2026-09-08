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
