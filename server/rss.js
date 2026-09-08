/**
 * RSS / Atom ingestion for competitor monitoring.
 *
 * Deliberately dependency-free. Feeds are small, well-formed XML documents and a
 * focused parser avoids pulling an XML stack into the project — but it does have
 * to handle the things real newsroom feeds actually contain: CDATA, namespaced
 * tags (media:content, content:encoded, dc:date), HTML inside descriptions, and
 * numeric/named entities in Devanagari copy.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', hellip: '…',
};

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

const stripCdata = (s) =>
  String(s ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');

const stripHtml = (s) =>
  decodeEntities(stripCdata(s).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** First matching child tag inside one item block. Namespace-aware. */
function tag(block, name) {
  // Escape the namespace colon for the character class, then match <name ...>…</name>
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(stripCdata(m[1])).trim() : null;
}

/** Attribute off a self-closing tag, e.g. <media:content url="..."/>. */
function attr(block, name, key) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?\\b${key}=["']([^"']+)["']`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

/** Parse an RSS 2.0 or Atom document into normalised items. */
export function parseFeed(xml, source = '') {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = isAtom
    ? [...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)].map((m) => m[1])
    : [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)].map((m) => m[1]);

  return blocks
    .map((b) => {
      const title = tag(b, 'title');
      const link = isAtom ? attr(b, 'link', 'href') || tag(b, 'id') : tag(b, 'link') || tag(b, 'guid');
      const rawSummary =
        tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content') || '';
      const published =
        tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
      const image =
        attr(b, 'media:content', 'url') || attr(b, 'media:thumbnail', 'url') || attr(b, 'enclosure', 'url');
      const categories = [...b.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((m) =>
        stripHtml(m[1])
      );
      const ts = published ? Date.parse(published) : NaN;
      return {
        source,
        title: stripHtml(title || ''),
        link: (link || '').trim(),
        summary: stripHtml(rawSummary).slice(0, 900),
        published: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
        publishedTs: Number.isNaN(ts) ? 0 : ts,
        image: image || null,
        categories: categories.filter(Boolean).slice(0, 6),
      };
    })
    .filter((i) => i.title && i.link);
}

/** Browser-ish headers: several Indian publishers' CDNs reject unknown agents. */
const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.7',
  'accept-language': 'hi-IN,hi;q=0.9,en-IN;q=0.8,en;q=0.7',
};

export async function fetchFeed({ name, url }, { timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS, redirect: 'follow' });
    const body = await res.text();
    if (!res.ok) {
      return { name, url, ok: false, ms: Date.now() - started, error: `HTTP ${res.status}`, items: [] };
    }
    const items = parseFeed(body, name);
    return { name, url, ok: true, ms: Date.now() - started, items, error: items.length ? null : 'no items parsed' };
  } catch (e) {
    return { name, url, ok: false, ms: Date.now() - started, error: `${e.name}: ${e.message}`, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch every feed in parallel; one failing source never sinks the sweep. */
export async function fetchAll(feeds, opts) {
  const results = await Promise.all(feeds.map((f) => fetchFeed(f, opts)));
  const items = results
    .flatMap((r) => r.items)
    .sort((a, b) => b.publishedTs - a.publishedTs);
  return { sources: results.map(({ items: _i, ...rest }) => ({ ...rest, count: _i.length })), items };
}
