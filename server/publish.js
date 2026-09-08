/**
 * Publishing to Instagram, via Zernio.
 *
 * Two things about this integration shape everything below.
 *
 * 1. Zernio fetches media SERVER-SIDE from a URL. It accepts neither uploads
 *    nor base64, so the image has to be reachable from the public internet
 *    before the call is made. Our generated backdrops live in memory as data
 *    URIs, so `media.js` parks the composed card at a URL and we hand Zernio
 *    that. This is why PUBLIC_BASE_URL is mandatory: on localhost the call
 *    would be accepted and then fail opaquely inside Zernio, which is a much
 *    worse failure than refusing up front.
 *
 * 2. There is no error taxonomy — any non-2xx just gets one retry. The retry
 *    MUST reuse the same x-request-id: it is the idempotency key, and a retry
 *    after a slow success would otherwise double-post to a real account.
 */
import './env.js';
import { randomUUID } from 'node:crypto';

const ZERNIO_POSTS_URL = 'https://zernio.com/api/v1/posts';

/** Instagram's own ceiling on a carousel. */
export const MAX_MEDIA_ITEMS = 10;

export const zernioAccountId = process.env.ZERNIO_IG_ACCOUNT_ID || null;
export const zernioReady = () => !!(process.env.ZERNIO_API_KEY && zernioAccountId);

export function zernioHint() {
  if (!process.env.ZERNIO_API_KEY) return 'ZERNIO_API_KEY is not set.';
  if (!zernioAccountId) return 'ZERNIO_IG_ACCOUNT_ID is not set.';
  return null;
}

/**
 * Caption and hashtags are a single `content` field for Zernio — there is no
 * separate tags parameter — so they are normalised and joined here.
 */
export function composeCaption(caption, hashtags = []) {
  const tags = []
    .concat(hashtags)
    .flatMap((h) => String(h ?? '').split(/\s+/))
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));

  return [String(caption ?? '').trim(), tags.join(' ')].filter(Boolean).join('\n\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const CONTENT_TYPES = ['post', 'story'];

/**
 * Post to Instagram. One image is a single post; several make a carousel.
 * `contentType: 'story'` publishes to Stories instead — same endpoint, same
 * credentials, and the only difference on the wire is platformSpecificData.
 * Returns the ids Zernio hands back, or throws with whatever it said.
 */
export async function publishToInstagram({
  content,
  imageUrls,
  contentType = 'post',
  requestId = randomUUID(),
}) {
  if (!zernioReady()) throw new Error(zernioHint() || 'Zernio is not configured.');
  if (!imageUrls?.length) throw new Error('No image to post.');
  if (!CONTENT_TYPES.includes(contentType))
    throw new Error(`Unknown Instagram content type: ${contentType}`);

  // A Story is one image. Instagram has no such thing as a multi-image story
  // container — a three-card story is three consecutive stories — so sending
  // three mediaItems in one call publishes only the first and silently drops
  // the rest. Split them into one call per frame instead, in order, each with
  // its own idempotency key.
  if (contentType === 'story' && imageUrls.length > 1) {
    const posts = [];
    for (const url of imageUrls.slice(0, MAX_MEDIA_ITEMS)) {
      posts.push(await publishToInstagram({ content, imageUrls: [url], contentType }));
    }
    return { ...posts[0], frames: posts.length, posts };
  }

  const platform = { platform: 'instagram', accountId: zernioAccountId };
  // Feed posts carry no platformSpecificData at all — the key is added only for
  // stories, so the default request stays byte-identical to what already works.
  if (contentType === 'story') platform.platformSpecificData = { contentType: 'story' };

  const body = {
    content,
    mediaItems: imageUrls.slice(0, MAX_MEDIA_ITEMS).map((url) => ({ type: 'image', url })),
    platforms: [platform],
    publishNow: true,
  };

  const attempt = () =>
    fetch(ZERNIO_POSTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ZERNIO_API_KEY}`,
        // Idempotency key — deliberately identical across both attempts.
        'x-request-id': requestId,
      },
      body: JSON.stringify(body),
    });

  let res = await attempt();
  if (!res.ok) {
    await sleep(5000);
    res = await attempt();
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Zernio returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`Zernio HTTP ${res.status}: ${data?.message || data?.error || text.slice(0, 200)}`);
  }

  const post = data.post || data;
  const ig = (post.platforms || []).find((p) => p.platform === 'instagram') || {};
  return {
    postId: post._id ?? null,
    platformPostId: ig.platformPostId ?? null,
    platformPostUrl: ig.platformPostUrl ?? null,
    contentType,
    frames: 1,
    requestId,
  };
}
