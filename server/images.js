/**
 * Image generation.
 *
 * Deliberately narrow in scope. A diffusion model cannot render exact numbers or
 * names — "8 dead" comes back as "B dead" often enough that using one for the
 * infographic would break the single guarantee this tool exists to provide. So:
 *
 *   - The INFOGRAPHIC stays code-rendered. Every figure on it is exact.
 *   - The REEL COVER gets a generated *background*, with the headline, kicker and
 *     statistic drawn over it by the same code path as before. Real generated
 *     imagery, still-correct text.
 *
 * The background is illustrative, never documentary — the prompt describes mood
 * and setting only, and the card says so.
 *
 * Providers: openai (gpt-image-1), gemini (Imagen). Default: none, and the
 * cover falls back to its designed gradient.
 */
import './env.js';

const OPENAI_SIZES = { '9:16': '1024x1536', '1:1': '1024x1024', '16:9': '1536x1024' };

async function openaiImage({ prompt, aspect }) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || process.env.LSS_IMAGE_MODEL || 'gpt-image-1',
      prompt,
      size: OPENAI_SIZES[aspect] || '1024x1024',
      n: 1,
    }),
  });
  const data = await readJson(res, 'OpenAI images');
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error(`OpenAI images returned no image: ${JSON.stringify(data).slice(0, 200)}`);
  return `data:image/png;base64,${b64}`;
}

async function geminiImage({ prompt, aspect }) {
  // Gemini's image models generate through generateContent and return the image
  // as an inlineData part. (The instances/parameters :predict shape belongs to
  // Vertex Imagen, which these API keys do not expose.)
  const model = process.env.GEMINI_IMAGE_MODEL || process.env.LSS_IMAGE_MODEL || 'gemini-3.1-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { imageConfig: { aspectRatio: aspect || '1:1' } },
    }),
  });
  const data = await readJson(res, 'Gemini images');
  const parts = data.candidates?.[0]?.content?.parts || [];
  const inline = parts.map((p) => p.inlineData || p.inline_data).find(Boolean);
  if (!inline?.data) {
    const why = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'no inlineData part';
    throw new Error(`Gemini images returned no image (${why})`);
  }
  return `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`;
}

async function readJson(res, label) {
  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`${label} returned non-JSON (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data).slice(0, 200)}`);
  return data;
}

export const IMAGE_PROVIDERS = {
  openai: { label: `OpenAI ${process.env.OPENAI_IMAGE_MODEL || process.env.LSS_IMAGE_MODEL || 'gpt-image-1'}`, envKey: 'OPENAI_API_KEY', ready: () => !!process.env.OPENAI_API_KEY, generate: openaiImage },
  gemini: { label: `Gemini ${process.env.GEMINI_IMAGE_MODEL || process.env.LSS_IMAGE_MODEL || 'gemini-3.1-flash-image'}`, envKey: 'GEMINI_API_KEY', ready: () => !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY), generate: geminiImage },
};

function choose() {
  const asked = (process.env.LSS_IMAGE_PROVIDER || '').trim().toLowerCase();
  if (asked && asked !== 'none' && asked !== 'svg') return asked;
  if (asked) return null; // explicitly turned off
  for (const id of ['openai', 'gemini']) if (IMAGE_PROVIDERS[id].ready()) return id;
  return null;
}

const chosen = choose();
const provider = chosen ? IMAGE_PROVIDERS[chosen] : null;

export const imageProviderId = provider?.ready() ? chosen : null;
export const imageProviderLabel = imageProviderId
  ? provider.label
  : 'none — covers use the designed gradient';

/**
 * Build a background prompt from the cover spec.
 *
 * Default style is deliberately NON-photographic.
 *
 * A photoreal backdrop of a real casualty event is synthetic documentary
 * imagery of something nobody photographed — a picture that looks like evidence
 * and is not. Newsrooms get burned by exactly that. So the default asks for an
 * abstract, obviously-illustrative treatment, and the photoreal mode is an
 * explicit opt-in via LSS_IMAGE_STYLE=photographic. Either way the rendered
 * cover carries a visible AI-GENERATED IMAGE mark.
 */
export const imageStyle = (process.env.LSS_IMAGE_STYLE || 'abstract').toLowerCase();

export function coverPrompt(visual, story) {
  const mood =
    visual?.tone === 'urgent' ? 'tense, high-contrast, deep shadows'
    : visual?.tone === 'somber' ? 'muted, restrained, overcast'
    : 'clean, neutral, calm';

  const common = [
    `Mood: ${mood}.`,
    'Vertical 9:16. Keep the lower two thirds visually quiet and dark for text overlay.',
    'ABSOLUTELY NO text, letters, numbers, logos, watermarks or captions.',
  ];

  if (imageStyle === 'photographic') {
    return [
      'Abstract editorial background image for a news video cover.',
      `Subject matter, for atmosphere only: ${story?.headline || ''}.`,
      ...common,
      'Cinematic, desaturated, slightly out of focus.',
      'No recognisable faces, no identifiable individuals, no depiction of casualties.',
    ].join(' ');
  }

  // Abstract default: evokes the subject without pretending to document it.
  return [
    'Abstract, non-photographic graphic background for a news video cover.',
    'Style: editorial illustration — flat geometric shapes, coarse halftone and paper grain, torn-paper edges, limited palette.',
    'It must be obviously an illustration and must NOT resemble a photograph.',
    `Loose thematic reference only, no literal scene: ${visual?.kicker || 'news'}.`,
    ...common,
    'No people, no faces, no vehicles, no buildings, no rubble, no depiction of any real event or its aftermath.',
  ].join(' ');
}

/**
 * Background for the Instagram formats — carousel, post and story.
 *
 * One image serves every slide of a carousel. A carousel is read as a set, so a
 * single backdrop is what makes it look designed rather than assembled; it is
 * also one image call instead of six. Same rule as the cover: mood only, no
 * text — the copy is laid over it by the browser, so it stays exact.
 */
export function socialPrompt(story, aspect = '1:1') {
  const common = [
    aspect === '9:16' ? 'Vertical 9:16 composition.' : 'Square 1:1 composition.',
    'Keep the centre calm, dark and low-contrast — the copy is laid over it.',
    'ABSOLUTELY NO text, letters, numbers, logos, watermarks or captions.',
  ];

  if (imageStyle === 'photographic') {
    return [
      'Abstract editorial background image for a social media post.',
      `Subject matter, for atmosphere only: ${story?.headline || ''}.`,
      ...common,
      'Cinematic, desaturated, shallow depth of field.',
      'No recognisable faces, no identifiable individuals, no depiction of casualties.',
    ].join(' ');
  }

  return [
    'Abstract, non-photographic graphic background for a social media post.',
    'Style: editorial illustration — flat geometric shapes, coarse halftone and paper grain, torn-paper edges, limited palette.',
    'It must be obviously an illustration and must NOT resemble a photograph.',
    `Loose thematic reference only, no literal scene: ${story?.headline || 'news'}.`,
    ...common,
    'No people, no faces, no vehicles, no buildings, no rubble, no depiction of any real event or its aftermath.',
  ].join(' ');
}

/** Returns a data: URI, or null if imaging is off or the call failed. */
export async function generateBackground({ prompt, aspect = '9:16' }) {
  if (!imageProviderId) return null;
  try {
    return await provider.generate({ prompt, aspect });
  } catch (e) {
    // A cover without its background is still a usable cover — never fail the
    // whole format because the image service was unhappy.
    console.error('[lss] image generation failed:', e.message);
    return null;
  }
}
