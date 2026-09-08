/**
 * A tiny public media shelf.
 *
 * Zernio fetches images over HTTP rather than accepting an upload, so a
 * composed card has to sit at a real URL for the few seconds it takes them to
 * pull it. This keeps those bytes in memory, hands back an absolute URL, and
 * forgets them again after a while — there is no reason for a published card to
 * outlive the request that made it, and writing them to disk would quietly
 * accumulate news imagery on someone's laptop.
 *
 * In-memory means a restart drops them. That is fine: Zernio fetches within
 * seconds of the call, and anything older has already been published.
 */
import { randomUUID } from 'node:crypto';

const TTL_MS = 30 * 60 * 1000; // half an hour is far longer than a fetch needs
const MAX_ITEMS = 40;

const shelf = new Map(); // id -> { buffer, contentType, expires }

function sweep() {
  const now = Date.now();
  for (const [id, item] of shelf) if (item.expires <= now) shelf.delete(id);
  // Hard cap as well as a TTL, so a burst cannot grow the process unbounded.
  while (shelf.size > MAX_ITEMS) shelf.delete(shelf.keys().next().value);
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Accepts a data: URI, stores the bytes, returns { id, path }. */
export function shelveDataUrl(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('Expected a base64 data: URI.');
  const [, contentType, b64] = m;
  if (!EXT[contentType]) throw new Error(`Unsupported image type: ${contentType}`);

  sweep();
  const id = `${randomUUID()}.${EXT[contentType]}`;
  shelf.set(id, {
    buffer: Buffer.from(b64, 'base64'),
    contentType,
    expires: Date.now() + TTL_MS,
  });
  return { id, path: `/media/${id}` };
}

export function readShelved(id) {
  const item = shelf.get(id);
  if (!item || item.expires <= Date.now()) return null;
  return item;
}

/**
 * The absolute URL Zernio will fetch.
 *
 * A localhost address is refused rather than sent: Zernio would accept the
 * request and then fail to fetch it from their own network, which surfaces as a
 * confusing post-that-never-appears instead of an error you can act on.
 */
export function publicBase() {
  const raw = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const { hostname, protocol } = new URL(raw);
    if (!/^https?:$/.test(protocol)) return null;
    if (/^(localhost|127\.|0\.0\.0\.0|\[?::1\]?|.*\.local)$/i.test(hostname)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function publicUrlHint() {
  const raw = (process.env.PUBLIC_BASE_URL || '').trim();
  if (!raw)
    return 'PUBLIC_BASE_URL is not set. Instagram publishing needs this server reachable from the internet, because Zernio fetches the image itself rather than accepting an upload. Expose it (e.g. `cloudflared tunnel --url http://localhost:8787` or `ngrok http 8787`) and set PUBLIC_BASE_URL to the https URL you get back.';
  return `PUBLIC_BASE_URL is "${raw}", which Zernio cannot reach from their network. It must be a public https address, not localhost.`;
}
