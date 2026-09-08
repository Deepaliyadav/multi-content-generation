/**
 * Draw an Instagram card to a PNG data URI, in the browser.
 *
 * The server has no rasteriser, and both halves of the card — the generated
 * backdrop and the copy — are already here, so composing client-side avoids
 * shipping a headless browser just to burn text onto an image.
 *
 * The wash under the text is not decoration: the backdrop comes back from an
 * image model and we cannot know how bright it is, so white type needs its own
 * ground or a pale image will make the copy unreadable.
 */

const SERIF = "'Newsreader', Georgia, 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the backdrop image.'));
    img.src = src;
  });

/** Greedy wrap against the real measured width of the chosen face. */
function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Cover-fit, so a 9:16 backdrop in a 1:1 card crops rather than squashes. */
function drawCover(ctx, img, W, H) {
  const scale = Math.max(W / img.width, H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/**
 * @param {object} card
 * @param {string} [card.background]  data: URI of the generated backdrop
 * @param {string} card.headline      the hook / slide headline
 * @param {string} [card.caption]     optional supporting line
 * @param {'square'|'story'} [card.shape]
 * @returns {Promise<string>} a PNG data URI
 */
export async function renderInstaCard({ background, headline, caption, shape = 'square' }) {
  const W = 1080;
  const H = shape === 'story' ? 1920 : 1080;
  const M = 96;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0F1215';
  ctx.fillRect(0, 0, W, H);

  let hasBg = false;
  if (background) {
    try {
      drawCover(ctx, await loadImage(background), W, H);
      hasBg = true;
    } catch {
      /* a card without its backdrop is still a usable card */
    }
  }

  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0, hasBg ? 'rgba(15,18,21,0.58)' : 'rgba(15,18,21,0.96)');
  wash.addColorStop(0.55, hasBg ? 'rgba(15,18,21,0.76)' : 'rgba(15,18,21,1)');
  wash.addColorStop(1, hasBg ? 'rgba(15,18,21,0.92)' : 'rgba(15,18,21,1)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // Copy sits on the optical centre line, headline first.
  const headSize = shape === 'story' ? 82 : 74;
  ctx.font = `500 ${headSize}px ${SERIF}`;
  ctx.textAlign = 'center';
  const headLines = wrap(ctx, headline, W - M * 2).slice(0, 5);

  ctx.font = `400 34px ${MONO}`;
  const capLines = caption ? wrap(ctx, caption, W - M * 2).slice(0, 3) : [];

  const headLead = headSize * 1.22;
  const capLead = 50;
  const blockH = headLines.length * headLead + (capLines.length ? 34 + capLines.length * capLead : 0);
  let y = (H - blockH) / 2 + headSize * 0.82;

  ctx.fillStyle = '#ffffff';
  ctx.font = `500 ${headSize}px ${SERIF}`;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 18;
  for (const line of headLines) {
    ctx.fillText(line, W / 2, y);
    y += headLead;
  }

  if (capLines.length) {
    y += 34;
    ctx.fillStyle = '#d8d5cd';
    ctx.font = `400 34px ${MONO}`;
    for (const line of capLines) {
      ctx.fillText(line, W / 2, y);
      y += capLead;
    }
  }
  ctx.shadowBlur = 0;

  // Accent rule — the one piece of desk furniture on the card.
  ctx.fillStyle = '#E14B36';
  ctx.fillRect(W / 2 - 60, H - M - 46, 120, 6);

  // The disclosure is burned into the artwork, because a UI chip does not
  // survive the moment this image leaves the app and gets posted.
  if (hasBg) {
    ctx.textAlign = 'center';
    ctx.font = `600 22px ${MONO}`;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText('AI-GENERATED IMAGE', W / 2, H - M + 14);
  }

  return canvas.toDataURL('image/png');
}
