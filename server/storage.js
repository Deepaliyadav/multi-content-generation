/**
 * Supabase Storage — public hosting for the cards we hand to Zernio.
 *
 * Zernio fetches media server-side from a URL; it accepts neither uploads nor
 * base64. So a composed card has to exist at a publicly reachable address
 * before the publish call is made, and a bucket is the honest way to do that
 * rather than requiring this laptop to be exposed to the internet.
 *
 * Deliberately no @supabase/supabase-js: we use two REST calls, and
 * `getPublicUrl` in that SDK only string-builds the pattern below. Adding a
 * dependency to concatenate a URL is not a trade worth making.
 *
 * The service-role key bypasses row-level security, so it lives on the server
 * only and is never sent to the browser.
 */
import './env.js';

const BUCKET = process.env.SUPABASE_BUCKET || 'instagram-carousel';

const baseUrl = () => (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');

export const supabaseBucket = BUCKET;
export const supabaseReady = () =>
  !!(baseUrl() && (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());

export function supabaseHint() {
  if (!baseUrl()) return 'SUPABASE_URL is not set.';
  if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim())
    return 'SUPABASE_SERVICE_ROLE_KEY is not set.';
  return null;
}

/**
 * Run id, matching the convention the carousel project already writes:
 * <YYYY-MM-DD>_<epoch_ms>. Keeping the shape identical means both projects'
 * uploads sort together and are recognisable in the bucket.
 */
export function newRunId(prefix) {
  const day = new Date().toISOString().slice(0, 10);
  return prefix ? `${prefix}_${Date.now()}` : `${day}_${Date.now()}`;
}

export const publicUrlFor = (path) =>
  `${baseUrl()}/storage/v1/object/public/${BUCKET}/${encodeURI(path)}`;

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function parseDataUrl(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('Expected a base64 data: URI.');
  const [, contentType, b64] = m;
  if (!EXT[contentType]) throw new Error(`Unsupported image type: ${contentType}`);
  return { contentType, buffer: Buffer.from(b64, 'base64') };
}

/** Upload raw bytes to `path` in the bucket. Returns the public URL. */
export async function uploadBuffer(path, buffer, contentType) {
  if (!supabaseReady()) throw new Error(supabaseHint() || 'Supabase is not configured.');

  const res = await fetch(`${baseUrl()}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      // Matches the carousel project's { upsert: true }: a regenerate that
      // reuses a path should replace the old card, not fail on a conflict.
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!res.ok) {
    const body = await res.text();
    let msg = body.slice(0, 200);
    try {
      const j = JSON.parse(body);
      msg = j.message || j.error || msg;
    } catch {
      /* non-JSON error body — the raw text is more useful than nothing */
    }
    throw new Error(`Supabase Storage HTTP ${res.status}: ${msg}`);
  }
  return publicUrlFor(path);
}

/**
 * Upload the composed slides of one run.
 *
 * Only the `slide_<n>.png` URLs go to Zernio. The raw backdrops are archived
 * alongside them as `slide_<n>_bg.jpg`, matching the carousel project's
 * convention, for a future regenerate flow.
 */
export async function uploadSlides(images, { runId = newRunId(), backgrounds = [] } = {}) {
  // Slides upload in parallel: they are independent, and a seven-slide carousel
  // done one at a time is fifteen seconds of nothing happening.
  const urls = await Promise.all(
    images.map((dataUrl, i) => {
      const { buffer, contentType } = parseDataUrl(dataUrl);
      return uploadBuffer(`${runId}/slide_${i}.${EXT[contentType]}`, buffer, contentType);
    })
  );

  // Best effort, and never fatal: a failed archive must not sink a post whose
  // slides already uploaded fine. Deduplicated, because a run where only one
  // image came back reuses it across slides.
  const seen = new Set();
  await Promise.all(
    backgrounds.map(async (bg, i) => {
      if (!bg || seen.has(bg)) return;
      seen.add(bg);
      try {
        const { buffer, contentType } = parseDataUrl(bg);
        await uploadBuffer(`${runId}/slide_${i}_bg.${EXT[contentType]}`, buffer, contentType);
      } catch (e) {
        console.error('[lss] backdrop archive failed:', e.message);
      }
    })
  );

  return { runId, urls };
}

/** Used by the health check to clean up after itself. */
export async function remove(path) {
  const res = await fetch(`${baseUrl()}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  return res.ok;
}
