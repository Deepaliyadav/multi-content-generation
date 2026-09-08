/**
 * Image rendering for the two visual formats.
 *
 * The model produces a structured `visual` spec (grounded in the fact ledger);
 * this module renders it into a real SVG image. Doing the layout in code rather
 * than asking the model for raw SVG keeps the graphic typographically sound and
 * makes regeneration deterministic — and the spec, being structured data, is
 * itself checkable against the fact ledger.
 *
 * Palette: validated dataviz reference values on a light surface.
 * Single data series, so identity is never carried by colour alone —
 * every bar and donut segment is directly labelled.
 */

const INK = '#0b0b0b';
const INK_2 = '#52514e';
const INK_3 = '#8a8880';
const SURFACE = '#fcfcfb';
const RULE = '#dedcd4';
const SERIES = '#2a78d6'; // categorical slot 1, light mode
const SERIES_SOFT = '#cde2fb'; // sequential step 100, for donut remainder
const ACCENT = '#c8102e';

const SANS = "'Inter','Helvetica Neue',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Iowan Old Style','Times New Roman',serif";

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Greedy wrap using an average-advance estimate per family. */
function wrap(text, maxWidth, fontSize, family = SANS, maxLines = 4) {
  const factor = family === SERIF ? 0.5 : 0.54;
  const perLine = Math.max(6, Math.floor(maxWidth / (fontSize * factor)));
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= perLine) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length)
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:]$/, '')}…`;
  return lines;
}

function textBlock(lines, x, y, size, { family = SANS, fill = INK, weight = 400, lh = 1.18, anchor = 'start', spacing = '0' } = {}) {
  return lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${y + i * size * lh}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${spacing}">${esc(l)}</text>`
    )
    .join('');
}

/* ── Infographic: 1080×1080 stat graphic ──────────────────────────────── */

export function renderInfographic(v = {}) {
  const W = 1080;
  const H = 1080;
  const M = 72;
  const stats = (v.stats || []).slice(0, 5);
  const chart = v.chart && v.chart.type !== 'none' ? v.chart : null;
  const parts = [];

  parts.push(`<rect width="${W}" height="${H}" fill="${SURFACE}"/>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="10" fill="${ACCENT}"/>`);

  // Kicker
  let y = M + 46;
  parts.push(
    textBlock(['NEWS GRAPHIC'], M, y, 20, { weight: 700, fill: ACCENT, spacing: '2.4' })
  );

  // Title — serif, the reading face
  y += 42;
  const titleLines = wrap(v.title || 'Untitled', W - M * 2, 58, SERIF, 3);
  parts.push(textBlock(titleLines, M, y + 44, 58, { family: SERIF, weight: 700, lh: 1.1 }));
  y += 44 + (titleLines.length - 1) * 58 * 1.1;

  // Subtitle
  if (v.subtitle) {
    y += 44;
    const sub = wrap(v.subtitle, W - M * 2, 26, SANS, 2);
    parts.push(textBlock(sub, M, y, 26, { fill: INK_2, lh: 1.35 }));
    y += (sub.length - 1) * 26 * 1.35;
  }

  y += 46;
  parts.push(`<line x1="${M}" y1="${y}" x2="${W - M}" y2="${y}" stroke="${RULE}" stroke-width="2"/>`);
  y += 52;

  // Stat tiles — value in the sans, proportional figures (no tabular-nums:
  // these are standalone display numbers, not a column).
  //
  // The chart's height is reserved BEFORE the tiles are sized, so a story with
  // five stats cannot squeeze the chart off the canvas and leave a dead band.
  const cols = stats.length <= 2 ? stats.length || 1 : stats.length === 4 ? 2 : 3;
  const rows = Math.ceil(stats.length / cols);
  const gap = 24;
  const tileW = (W - M * 2 - gap * (cols - 1)) / cols;
  const footTop = H - 108;
  const chartH = chart
    ? 34 + (chart.type === 'donut' ? 260 : 58 * Math.min(5, (chart.series || []).length))
    : 0;
  const tileArea = footTop - y - (chart ? chartH + 48 : 0);
  const tileH = Math.max(122, Math.min(214, (tileArea - (rows - 1) * gap) / rows));
  stats.forEach((s, i) => {
    const cx = M + (i % cols) * (tileW + gap);
    const cy = y + Math.floor(i / cols) * (tileH + gap);
    parts.push(
      `<rect x="${cx}" y="${cy}" width="${tileW}" height="${tileH}" rx="4" fill="#ffffff" stroke="${RULE}" stroke-width="2"/>`
    );
    parts.push(`<rect x="${cx}" y="${cy}" width="4" height="${tileH}" fill="${SERIES}"/>`);
    const val = String(s.value ?? '');
    const vSize = val.length > 9 ? 40 : val.length > 5 ? 52 : 66;
    const vBase = cy + tileH / 2 + (s.note ? 2 : 10);
    parts.push(textBlock([val], cx + 26, vBase, vSize, { weight: 700 }));
    parts.push(
      textBlock(wrap(s.label || '', tileW - 44, 21, SANS, 2), cx + 26, vBase + 32, 21, {
        fill: INK_2,
        weight: 600,
      })
    );
    if (s.note)
      parts.push(
        textBlock(wrap(s.note, tileW - 44, 17, SANS, 1), cx + 26, vBase + 60, 17, { fill: INK_3 })
      );
  });
  y += rows * tileH + (rows - 1) * gap;

  // Chart — occupies the height reserved for it above.
  if (chart && (chart.series || []).length >= 2) {
    const cy0 = y + 48;
    parts.push(
      textBlock(wrap(chart.caption || '', W - M * 2, 22, SANS, 1), M, cy0, 22, {
        weight: 700,
        fill: INK_2,
      })
    );
    parts.push(
      chart.type === 'donut'
        ? donut(chart.series, M, cy0 + 34, W - M * 2, chartH - 34)
        : bars(chart.series, M, cy0 + 34, W - M * 2, chartH - 34)
    );
  }

  // Footer
  parts.push(`<line x1="${M}" y1="${H - 76}" x2="${W - M}" y2="${H - 76}" stroke="${RULE}" stroke-width="2"/>`);
  if (v.source)
    parts.push(
      textBlock(wrap(`Source: ${v.source}`, W - M * 2 - 260, 19, SANS, 1), M, H - 44, 19, {
        fill: INK_3,
      })
    );
  parts.push(
    textBlock(['LIVING STORY SYNC'], W - M, H - 44, 17, {
      anchor: 'end',
      fill: INK_3,
      weight: 700,
      spacing: '1.6',
    })
  );

  return svg(W, H, parts.join(''));
}

/** Horizontal bars: 4px rounded data-end, 2px surface gap, direct labels. */
function bars(series, x, y, w, h) {
  const list = series.slice(0, 5);
  const max = Math.max(...list.map((s) => Number(s.value) || 0), 1);
  const rowH = h / list.length;
  const barH = Math.max(16, Math.min(46, rowH - 20));
  const labelW = Math.min(240, w * 0.3);
  const trackX = x + labelW + 16;
  const trackW = w - labelW - 16 - 90;
  return list
    .map((s, i) => {
      const cy = y + i * rowH;
      const val = Number(s.value) || 0;
      const bw = Math.max(3, (val / max) * trackW);
      return (
        textBlock(wrap(s.label || '', labelW, 20, SANS, 1), x + labelW, cy + barH - 2, 20, {
          anchor: 'end',
          fill: INK_2,
        }) +
        `<rect x="${trackX}" y="${cy}" width="${bw}" height="${barH}" rx="4" fill="${SERIES}"/>` +
        textBlock([formatNum(val)], trackX + bw + 12, cy + barH - 2, 22, { weight: 700 })
      );
    })
    .join('');
}

/** Donut for parts of one stated whole; every segment directly labelled. */
function donut(series, x, y, w, h) {
  const list = series.slice(0, 5);
  const total = list.reduce((a, s) => a + (Number(s.value) || 0), 0) || 1;
  const r = Math.min(h, 220) / 2;
  const cx = x + r + 8;
  const cy = y + r;
  const inner = r * 0.6;
  const shades = [SERIES, '#5598e7', '#86b6ef', '#b7d3f6', SERIES_SOFT];
  let angle = -Math.PI / 2;
  const arcs = list
    .map((s, i) => {
      const frac = (Number(s.value) || 0) / total;
      const sweep = frac * Math.PI * 2;
      const d = arcPath(cx, cy, r, inner, angle, angle + sweep);
      angle += sweep;
      // 2px surface ring keeps adjacent fills from touching.
      return `<path d="${d}" fill="${shades[i % shades.length]}" stroke="${SURFACE}" stroke-width="2"/>`;
    })
    .join('');
  const legend = list
    .map((s, i) => {
      const ly = y + 16 + i * 34;
      const lx = cx + r + 40;
      return (
        `<rect x="${lx}" y="${ly - 13}" width="14" height="14" rx="3" fill="${shades[i % shades.length]}"/>` +
        textBlock(
          [`${s.label} — ${formatNum(Number(s.value) || 0)}`],
          lx + 24,
          ly,
          21,
          { fill: INK_2 }
        )
      );
    })
    .join('');
  return arcs + legend;
}

function arcPath(cx, cy, r, ir, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
  return `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(ir, a1)} A ${ir} ${ir} 0 ${large} 0 ${p(ir, a0)} Z`;
}

const formatNum = (n) =>
  Math.abs(n) >= 1000 ? n.toLocaleString('en-IN') : String(Math.round(n * 100) / 100);

/* ── Reel cover: 1080×1920 vertical ───────────────────────────────────── */

const TONES = {
  urgent: { bg: '#14100f', accent: '#e8442f', wash: '#3a1410' },
  somber: { bg: '#111417', accent: '#7f97ad', wash: '#1b2530' },
  neutral: { bg: '#0f1114', accent: '#2a78d6', wash: '#12233a' },
};

export function renderReelCover(v = {}, opts = {}) {
  const W = 1080;
  const H = 1920;
  const M = 88;
  const t = TONES[v.tone] || TONES.neutral;
  const bg = opts.background; // optional generated backdrop (data: URI)
  const parts = [];

  // Over a photographic backdrop the wash has to work harder, or white type on
  // a bright frame becomes unreadable.
  const washTop = bg ? 0.55 : 0.95;
  const washMid = bg ? 0.82 : 1;
  const washBot = bg ? 0.97 : 1;

  parts.push(`<defs>
    <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${t.wash}" stop-opacity="${washTop}"/>
      <stop offset="55%" stop-color="${t.bg}" stop-opacity="${washMid}"/>
      <stop offset="100%" stop-color="${t.bg}" stop-opacity="${washBot}"/>
    </linearGradient>
  </defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="${t.bg}"/>`);
  if (bg)
    parts.push(
      `<image href="${bg}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    );
  parts.push(`<rect width="${W}" height="${H}" fill="url(#wash)"/>`);

  // Faint desk grid — texture, not decoration.
  if (!bg)
    for (let gy = 0; gy < H; gy += 60)
      parts.push(`<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>`);

  // Kicker chip
  const kicker = String(v.kicker || 'NEWS').toUpperCase().slice(0, 18);
  const chipW = kicker.length * 17 + 52;
  parts.push(`<rect x="${M}" y="${M + 40}" width="${chipW}" height="58" rx="4" fill="${t.accent}"/>`);
  parts.push(
    textBlock([kicker], M + 26, M + 79, 25, { weight: 700, fill: '#ffffff', spacing: '2.2' })
  );

  // Stat — the arresting number, if the story has one
  let y = 700;
  if (v.stat && String(v.stat.value ?? '').trim()) {
    const val = String(v.stat.value).trim();
    const size = val.length > 6 ? 150 : val.length > 3 ? 210 : 260;
    parts.push(textBlock([val], M, y, size, { weight: 700, fill: t.accent, family: SANS }));
    parts.push(
      textBlock(wrap(v.stat.label || '', W - M * 2, 34, SANS, 1), M, y + 54, 34, {
        weight: 600,
        fill: '#ffffff',
        spacing: '1.2',
      })
    );
    y += 130;
  } else {
    y = 620;
  }

  // Headline — serif, the reading face
  const head = wrap(v.headline || '', W - M * 2, 82, SERIF, 4);
  parts.push(textBlock(head, M, y + 100, 82, { family: SERIF, weight: 700, fill: '#ffffff', lh: 1.1 }));
  y += 100 + (head.length - 1) * 82 * 1.1;

  // Standfirst
  if (v.standfirst) {
    const sf = wrap(v.standfirst, W - M * 2, 34, SANS, 3);
    parts.push(textBlock(sf, M, y + 78, 34, { fill: '#c9c7c0', lh: 1.35 }));
  }

  // Disclosure, burned into the artwork.
  //
  // A UI chip disappears the moment someone exports the PNG and posts it, so the
  // mark has to live in the image itself.
  if (bg) {
    const chipY = H - 268;
    parts.push(
      `<rect x="${M}" y="${chipY}" width="316" height="46" rx="3" fill="#000000" fill-opacity="0.55" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2"/>`
    );
    parts.push(
      textBlock(['AI-GENERATED IMAGE'], M + 18, chipY + 31, 21, {
        fill: '#ffffff',
        weight: 700,
        spacing: '1.8',
      })
    );
  }

  // Foot rule + mark
  parts.push(`<rect x="${M}" y="${H - 190}" width="120" height="6" fill="${t.accent}"/>`);
  parts.push(
    textBlock([bg ? 'REEL COVER · ILLUSTRATIVE, NOT DOCUMENTARY' : 'REEL COVER · LIVING STORY SYNC'], M, H - 130, 22, {
      fill: '#8b8880',
      weight: 700,
      spacing: '2',
    })
  );
  return svg(W, H, parts.join(''));
}

function svg(w, h, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${inner}</svg>`;
}

/** Render whichever visual an output carries. Returns an SVG string or null. */
export function renderVisual(visual, opts = {}) {
  if (!visual) return null;
  // The infographic is never handed to an image model: its figures must be exact.
  if (visual.kind === 'infographic') return renderInfographic(visual);
  if (visual.kind === 'cover') return renderReelCover(visual, opts);
  return null;
}
