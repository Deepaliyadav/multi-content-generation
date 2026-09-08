/**
 * The 13 output formats.
 *
 * Every format shares one structural contract so the app can do line-level
 * staleness highlighting and line-level patching uniformly:
 *
 *   { blocks: [{ label, lines: [string] }], meta: {}, factsUsed: [factId], visual?: {} }
 *
 * What makes each format itself is `rules` (hard constraints, injected into the
 * prompt AND shown in the UI) plus `validate()` — a real check that runs on the
 * returned object, so limits are enforced rather than merely requested.
 */

export const GROUPS = [
  { id: 'article', label: 'Article & Text' },
  { id: 'social', label: 'Social' },
  { id: 'broadcast', label: 'Broadcast' },
  { id: 'visual', label: 'Visual' },
  { id: 'distribution', label: 'Distribution' },
];

/** Twitter counts any link as 23 chars, so usable text is 280 - 23. */
export const TWEET_LINK_COST = 23;
export const TWEET_TEXT_MAX = 280 - TWEET_LINK_COST;

const len = (s) => [...String(s ?? '')].length;
const blockByLabel = (o, label) =>
  (o.blocks || []).find((b) => String(b.label).toLowerCase().includes(label.toLowerCase()));
const allLines = (o) => (o.blocks || []).flatMap((b) => b.lines || []);

export const FORMATS = [
  {
    id: 'translation',
    label: 'Translation',
    group: 'article',
    kind: 'text',
    blurb: 'Full article in the selected language',
    maxTokens: 8000,
    rules: (ctx) => [
      `Translate the ENTIRE article into ${ctx.language}.`,
      'Newsroom-quality translation, not literal machine translation: idiomatic, publishable prose.',
      'Keep proper nouns and official designations in the form that language’s press actually uses.',
      'Do not summarise, shorten, add or drop any fact.',
    ],
    blockContract:
      'Exactly two blocks: {"label":"Headline","lines":[one translated headline]} and {"label":"Body","lines":[one string PER PARAGRAPH of the translated article]}.',
    validate: (o) => {
      const errs = [];
      const body = blockByLabel(o, 'Body');
      if (!blockByLabel(o, 'Headline')) errs.push('Missing Headline block.');
      if (!body || (body.lines || []).length < 2)
        errs.push('Body must contain one line per paragraph (at least 2).');
      return errs;
    },
  },

  {
    id: 'highlights',
    label: 'Article highlights',
    group: 'article',
    kind: 'text',
    blurb: '5–7 key points for a quick-read box',
    maxTokens: 2000,
    rules: () => [
      'Exactly 5 to 7 bullets.',
      'Each bullet is ONE line, max 18 words, and carries a concrete fact — not a theme.',
      'Front-load the number or name in each bullet.',
      'No bullet may repeat another bullet’s primary fact.',
    ],
    blockContract: 'One block: {"label":"Key points","lines":[5 to 7 bullet strings]}.',
    validate: (o) => {
      const n = allLines(o).length;
      return n >= 5 && n <= 7 ? [] : [`Needs 5–7 bullets, got ${n}.`];
    },
  },

  {
    id: 'insta_story',
    label: 'Insta story',
    group: 'social',
    kind: 'text',
    blurb: '1–3 vertical tap-through cards',
    maxTokens: 1200,
    rules: () => [
      'Exactly 1 to 3 cards. Fewer is better — this is the shortest format of the 13.',
      'Each card is a MAXIMUM of 10 words. Fragments, not sentences.',
      'All-caps or sentence-case punch lines sized for a phone screen held at arm’s length.',
      'No hashtags, no caption prose, no CTA paragraph — this is not the Insta post.',
    ],
    blockContract:
      'One block per card: {"label":"Card 1","lines":[one very short string]}. 1–3 blocks total.',
    validate: (o) => {
      const errs = [];
      const cards = (o.blocks || []).length;
      if (cards < 1 || cards > 3) errs.push(`Needs 1–3 cards, got ${cards}.`);
      for (const l of allLines(o))
        if (l.trim().split(/\s+/).length > 10)
          errs.push(`Card over 10 words: "${l.slice(0, 40)}…"`);
      return errs;
    },
  },

  {
    id: 'insta_post',
    label: 'Insta post',
    group: 'social',
    kind: 'text',
    blurb: 'Single-image caption + hashtags',
    maxTokens: 1600,
    rules: () => [
      'Structure: one hook line, then 2–4 short body lines, then one hashtag line.',
      'Hook line max 12 words and must make someone stop scrolling without overstating the story.',
      'Hashtag line: 4–7 hashtags, space separated, relevant to the actual story.',
      'Feed-appropriate length overall — under 120 words excluding hashtags.',
    ],
    blockContract:
      'Three blocks: {"label":"Hook","lines":[1 string]}, {"label":"Caption","lines":[2–4 strings]}, {"label":"Hashtags","lines":[1 string of space-separated hashtags]}.',
    validate: (o) => {
      const errs = [];
      const tags = blockByLabel(o, 'Hashtag');
      if (!blockByLabel(o, 'Hook')) errs.push('Missing Hook block.');
      if (!tags) errs.push('Missing Hashtags block.');
      else {
        const n = (tags.lines?.[0] || '').split(/\s+/).filter((t) => t.startsWith('#')).length;
        if (n < 4 || n > 7) errs.push(`Needs 4–7 hashtags, got ${n}.`);
      }
      return errs;
    },
  },

  {
    id: 'insta_carousel',
    label: 'Insta carousel',
    group: 'social',
    kind: 'text',
    blurb: '5–7 swipe slides, hook first, CTA last',
    maxTokens: 2400,
    rules: () => [
      'Exactly 5 to 7 slides.',
      'Each slide has TWO lines: line 1 is a short slide headline (max 8 words), line 2 is a one-line supporting caption (max 20 words).',
      'Slide 1 must be a scroll-stopping hook.',
      'The LAST slide must be a clear takeaway or call to action.',
      'This is social-hook driven — do not write it as a sequential photo narrative.',
    ],
    blockContract:
      'One block per slide: {"label":"Slide 1","lines":[headline, caption]}. 5–7 blocks.',
    validate: (o) => {
      const errs = [];
      const n = (o.blocks || []).length;
      if (n < 5 || n > 7) errs.push(`Needs 5–7 slides, got ${n}.`);
      for (const b of o.blocks || [])
        if ((b.lines || []).length !== 2)
          errs.push(`${b.label} must have exactly 2 lines (headline + caption).`);
      return errs;
    },
  },

  {
    id: 'twitter',
    label: 'Twitter / X post',
    group: 'social',
    kind: 'text',
    blurb: `≤${TWEET_TEXT_MAX} chars + link`,
    maxTokens: 900,
    rules: () => [
      `The post text must be at most ${TWEET_TEXT_MAX} characters — a link costs ${TWEET_LINK_COST} of the 280, so ${TWEET_TEXT_MAX} is the hard ceiling for your text.`,
      'Do NOT include a URL — the link is appended automatically.',
      'One post only. Lead with the most newsworthy fact.',
      'At most 2 hashtags, at the end.',
    ],
    blockContract: 'One block: {"label":"Post","lines":[one string]}.',
    validate: (o) => {
      const text = allLines(o).join(' ');
      const n = len(text);
      const errs = [];
      if (n > TWEET_TEXT_MAX) errs.push(`${n} chars — over the ${TWEET_TEXT_MAX} limit.`);
      if (/https?:\/\//.test(text)) errs.push('Must not contain a URL.');
      return errs;
    },
    meta: (o) => {
      const n = len(allLines(o).join(' '));
      return { chars: n, limit: TWEET_TEXT_MAX, total: n + TWEET_LINK_COST };
    },
  },

  {
    id: 'video_script',
    label: 'Video script',
    group: 'broadcast',
    kind: 'text',
    blurb: 'Intro / body / outro, spoken pacing',
    maxTokens: 3000,
    rules: () => [
      'Three labelled parts: Intro, Body, Outro.',
      'Written to be SPOKEN: short sentences, natural breath breaks, no sub-clauses that a presenter would stumble on.',
      'Body carries 3–5 lines, each advancing the story with a new fact.',
      'Include an approximate spoken runtime in meta.runtimeSeconds (140 words ≈ 60 seconds).',
      'This is a general video script — not the 30-45s reel and not the TV broadcast package.',
    ],
    blockContract:
      'Three blocks: {"label":"Intro","lines":[1–2]}, {"label":"Body","lines":[3–5]}, {"label":"Outro","lines":[1–2]}. Also return meta.runtimeSeconds as a number.',
    validate: (o) => {
      const errs = [];
      for (const l of ['Intro', 'Body', 'Outro'])
        if (!blockByLabel(o, l)) errs.push(`Missing ${l} block.`);
      const body = blockByLabel(o, 'Body');
      if (body && ((body.lines || []).length < 3 || (body.lines || []).length > 5))
        errs.push(`Body needs 3–5 lines, got ${(body.lines || []).length}.`);
      return errs;
    },
  },

  {
    id: 'tv_script',
    label: 'TV script',
    group: 'broadcast',
    kind: 'text',
    blurb: 'Breaking strap · ticker · highlights · anchor read',
    maxTokens: 3200,
    rules: () => [
      'FOUR distinct parts, in this order, labelled exactly: "Breaking strap", "Ticker", "On-screen highlights", "Anchor script".',
      'Breaking strap: ONE line, ALL CAPS, max 9 words — the red flash band.',
      'Ticker: 2–3 lines, each a self-contained scrolling sentence under 90 characters, written in wire style.',
      'On-screen highlights: 3–4 lower-third strings, max 6 words each, ALL CAPS.',
      'Anchor script: 4–7 short broadcast sentences the anchor reads to camera. Punchy, present tense where accurate.',
      'The four parts must be genuinely different registers — a judge will check that the ticker does not read like the anchor script.',
    ],
    blockContract:
      'Exactly four blocks with labels "Breaking strap", "Ticker", "On-screen highlights", "Anchor script".',
    validate: (o) => {
      const errs = [];
      const need = ['Breaking strap', 'Ticker', 'On-screen highlights', 'Anchor script'];
      for (const l of need) if (!blockByLabel(o, l)) errs.push(`Missing "${l}" part.`);
      const strap = blockByLabel(o, 'Breaking strap');
      if (strap && (strap.lines || []).length !== 1) errs.push('Breaking strap must be exactly 1 line.');
      const tick = blockByLabel(o, 'Ticker');
      if (tick) for (const l of tick.lines || [])
        if (len(l) > 90) errs.push(`Ticker line over 90 chars: "${l.slice(0, 40)}…"`);
      const hi = blockByLabel(o, 'On-screen highlights');
      if (hi && ((hi.lines || []).length < 3 || (hi.lines || []).length > 4))
        errs.push(`Highlights need 3–4 lines, got ${(hi.lines || []).length}.`);
      const anchor = blockByLabel(o, 'Anchor script');
      if (anchor && ((anchor.lines || []).length < 4 || (anchor.lines || []).length > 7))
        errs.push(`Anchor script needs 4–7 sentences, got ${(anchor.lines || []).length}.`);
      return errs;
    },
  },

  {
    id: 'reel',
    label: 'Reel script + cover',
    group: 'visual',
    kind: 'text+image',
    blurb: '30–45s vertical script with generated cover',
    maxTokens: 2600,
    rules: () => [
      'Total spoken length 30–45 seconds (roughly 75–110 words). Put the word count in meta.words.',
      'Block "Hook (0–3s)" is ONE line that lands the most arresting true fact immediately.',
      'Block "Script" is 4–6 lines of punchy spoken pacing, each line one breath.',
      'Block "End card" is ONE line.',
      'Also return a `visual` object for the cover image (see the visual contract).',
    ],
    blockContract:
      'Three blocks: {"label":"Hook (0–3s)","lines":[1]}, {"label":"Script","lines":[4–6]}, {"label":"End card","lines":[1]}. Also meta.words (number).',
    visualContract: `"visual": {
    "kind": "cover",
    "kicker": "one or two words, ALL CAPS, e.g. BREAKING or EXPLAINER",
    "headline": "max 8 words, the cover's main line",
    "standfirst": "max 14 words of supporting context",
    "stat": { "value": "the single most striking number from the story, or empty string", "label": "max 3 words naming it" },
    "tone": "urgent" | "somber" | "neutral"
  }`,
    validate: (o) => {
      const errs = [];
      const hook = blockByLabel(o, 'Hook');
      if (!hook) errs.push('Missing Hook (0–3s) block.');
      else if ((hook.lines || []).length !== 1) errs.push('Hook must be exactly 1 line.');
      const s = blockByLabel(o, 'Script');
      if (!s) errs.push('Missing Script block.');
      else if ((s.lines || []).length < 4 || (s.lines || []).length > 6)
        errs.push(`Script needs 4–6 lines, got ${(s.lines || []).length}.`);
      const words = allLines(o).join(' ').trim().split(/\s+/).length;
      if (words > 130) errs.push(`~${words} words is over a 45-second read.`);
      if (!o.visual || o.visual.kind !== 'cover') errs.push('Missing cover visual spec.');
      return errs;
    },
  },

  {
    id: 'photostory',
    label: 'Photostory',
    group: 'visual',
    kind: 'text',
    blurb: '5–8 sequential caption cards',
    maxTokens: 2600,
    rules: () => [
      'Exactly 5 to 8 frames, told in narrative sequence — frame 1 opens the scene, the last frame closes it.',
      'Each frame has TWO lines: line 1 is the photo direction in square brackets, e.g. "[Wide: the collapsed stairwell at dawn]"; line 2 is the caption a reader sees under that photograph.',
      'Captions are declarative, past or present tense, 15–30 words — the register of a picture desk, not a social hook.',
      'The frames must have narrative continuity: each one moves the story forward in time or scope.',
      'Only describe photographs that could plausibly exist given the facts. Never invent a person or a scene the source does not support.',
      'This must NOT read like the Insta carousel — no hooks, no CTA, no slide headlines.',
    ],
    blockContract:
      'One block per frame: {"label":"Frame 1","lines":["[photo direction]", "caption"]}. 5–8 blocks.',
    validate: (o) => {
      const errs = [];
      const n = (o.blocks || []).length;
      if (n < 5 || n > 8) errs.push(`Needs 5–8 frames, got ${n}.`);
      for (const b of o.blocks || []) {
        if ((b.lines || []).length !== 2) errs.push(`${b.label} needs a direction line and a caption.`);
        else if (!/^\s*\[/.test(b.lines[0])) errs.push(`${b.label} direction must be in [brackets].`);
      }
      return errs;
    },
  },

  {
    id: 'infographic',
    label: 'Infographic',
    group: 'visual',
    kind: 'image+data',
    blurb: 'Rendered stat graphic + structured data',
    maxTokens: 2000,
    rules: () => [
      'Pick the 3–5 most visually communicable facts — numbers, counts, times, magnitudes.',
      'Every stat value must appear in the source story. Never compute a percentage or total the story does not state.',
      'Choose chart.type "bar" when you have 2+ comparable numeric quantities, "donut" for parts of one stated whole, "none" when the story has no comparable series.',
      'If chart.type is not "none", every series value must be a number stated in the story.',
      'Title max 9 words. Keep stat labels under 4 words.',
    ],
    blockContract:
      'One block: {"label":"Infographic data","lines":[one summary line per stat, e.g. "Deaths — 5"]}.',
    visualContract: `"visual": {
    "kind": "infographic",
    "title": "max 9 words",
    "subtitle": "max 14 words of context",
    "stats": [ { "label": "max 3 words", "value": "the figure as it appears in the story", "note": "max 5 words qualifier, or empty string" } ],
    "chart": { "type": "bar" | "donut" | "none", "caption": "max 10 words", "series": [ { "label": "max 3 words", "value": <number> } ] },
    "source": "the attribution named in the story, or empty string"
  }`,
    validate: (o) => {
      const errs = [];
      const v = o.visual;
      if (!v || v.kind !== 'infographic') return ['Missing infographic visual spec.'];
      const n = (v.stats || []).length;
      if (n < 3 || n > 5) errs.push(`Needs 3–5 stats, got ${n}.`);
      if (v.chart && v.chart.type !== 'none') {
        const bad = (v.chart.series || []).filter((s) => typeof s.value !== 'number');
        if ((v.chart.series || []).length < 2) errs.push('A chart needs at least 2 series points.');
        if (bad.length) errs.push('Chart series values must be numbers.');
      }
      return errs;
    },
  },

  {
    id: 'push',
    label: 'Push notification',
    group: 'distribution',
    kind: 'text',
    blurb: 'Title ≤40 · body ≤120',
    maxTokens: 700,
    rules: () => [
      'Title: at most 40 characters. Hard limit — it is truncated on a lock screen.',
      'Body: at most 120 characters. Hard limit.',
      'The title must carry the news, not tease it. No "Read more", no clickbait.',
      'Count characters, including spaces and punctuation, before you answer.',
    ],
    blockContract:
      'Two blocks: {"label":"Title","lines":[1 string]} and {"label":"Body","lines":[1 string]}.',
    validate: (o) => {
      const errs = [];
      const t = blockByLabel(o, 'Title')?.lines?.[0] ?? '';
      const b = blockByLabel(o, 'Body')?.lines?.[0] ?? '';
      if (!t) errs.push('Missing Title.');
      if (!b) errs.push('Missing Body.');
      if (len(t) > 40) errs.push(`Title is ${len(t)} chars — limit 40.`);
      if (len(b) > 120) errs.push(`Body is ${len(b)} chars — limit 120.`);
      return errs;
    },
    meta: (o) => ({
      titleChars: len(blockByLabel(o, 'Title')?.lines?.[0] ?? ''),
      bodyChars: len(blockByLabel(o, 'Body')?.lines?.[0] ?? ''),
    }),
  },

  {
    id: 'newsletter',
    label: 'Newsletter blurb',
    group: 'distribution',
    kind: 'text',
    blurb: '2–4 sentences for an email digest',
    maxTokens: 1200,
    rules: () => [
      'A digest slot: one short standfirst line, then a blurb of 2–4 sentences.',
      'The final sentence must set up the click without ever promising a fact the story does not contain.',
      'Separate block for the read-more label, max 5 words.',
      'Measured, subscriber-facing register — calmer than the social formats.',
    ],
    blockContract:
      'Three blocks: {"label":"Standfirst","lines":[1]}, {"label":"Blurb","lines":[2–4 sentences, one per line]}, {"label":"Read more","lines":[1 short label]}.',
    validate: (o) => {
      const errs = [];
      const b = blockByLabel(o, 'Blurb');
      if (!b) errs.push('Missing Blurb block.');
      else if ((b.lines || []).length < 2 || (b.lines || []).length > 4)
        errs.push(`Blurb needs 2–4 sentences, got ${(b.lines || []).length}.`);
      if (!blockByLabel(o, 'Read more')) errs.push('Missing Read more block.');
      return errs;
    },
  },
];

export const FORMAT_BY_ID = Object.fromEntries(FORMATS.map((f) => [f.id, f]));
export const FORMAT_IDS = FORMATS.map((f) => f.id);

/** What the loading state says while each one is in flight. */
export const PROGRESS_VERB = {
  translation: 'Translating the article',
  highlights: 'Pulling key points',
  insta_story: 'Cutting story cards',
  insta_post: 'Writing the feed caption',
  insta_carousel: 'Building the carousel',
  twitter: 'Fitting the post to 280',
  video_script: 'Writing the video script',
  tv_script: 'Writing the TV script',
  reel: 'Writing the reel + cover art',
  photostory: 'Sequencing the photostory',
  infographic: 'Rendering the infographic',
  push: 'Trimming the push alert',
  newsletter: 'Drafting the newsletter blurb',
};
