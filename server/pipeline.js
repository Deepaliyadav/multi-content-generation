/**
 * Orchestration: extract → generate → validate/repair → diff → scan → patch.
 */
import { completeJson } from './llm.js';
import { FORMAT_BY_ID, TWEET_TEXT_MAX } from './formats.js';
import {
  FACT_SYSTEM, factPrompt,
  generateSystem, generatePrompt, repairPrompt,
  DIFF_SYSTEM, diffPrompt,
  PATCH_SYSTEM, patchPrompt,
} from './prompts.js';
import { iterLines, setLine, verifyFactUsage, textCarriesValue } from './facts.js';
import { renderVisual } from './visuals.js';
import { generateBackground, coverPrompt, imageProviderId } from './images.js';
import { directSlides } from './artdirector.js';

/* ── fact ledger ──────────────────────────────────────────────────────── */

export async function extractFacts(story) {
  const res = await completeJson({
    system: FACT_SYSTEM,
    user: factPrompt(story),
    maxTokens: 3000,
    effort: 'high', // correctness-critical: everything downstream is held to this
  });
  const facts = (res.facts || [])
    .filter((f) => f && f.label && f.value !== undefined)
    .slice(0, 14)
    .map((f, i) => ({
      id: f.id || `f${i + 1}`,
      label: String(f.label).trim(),
      value: String(f.value).trim(),
      type: f.type || 'other',
      evidence: String(f.evidence || '').trim(),
      // A fact whose evidence really appears in the copy is provably grounded.
      grounded: !!f.evidence && `${story.headline}\n${story.body}`.includes(String(f.evidence).trim()),
    }));
  if (!facts.length) throw new Error('No facts could be extracted from this story.');
  return facts;
}

/* ── generation ───────────────────────────────────────────────────────── */

/** Hard, non-negotiable ceilings applied in code after the model has spoken. */
function enforceLimits(formatId, output) {
  const clip = (s, n) => {
    const chars = [...String(s)];
    if (chars.length <= n) return String(s);
    let cut = chars.slice(0, n - 1).join('');
    const sp = cut.lastIndexOf(' ');
    if (sp > n * 0.6) cut = cut.slice(0, sp);
    return `${cut.replace(/[\s,;:.-]+$/, '')}…`;
  };
  const enforced = [];
  const blocks = (output.blocks || []).map((b) => {
    const label = String(b.label || '').toLowerCase();
    let lines = b.lines || [];
    if (formatId === 'twitter') {
      lines = lines.map((l) => {
        if ([...l].length <= TWEET_TEXT_MAX) return l;
        enforced.push(`Post trimmed to the ${TWEET_TEXT_MAX}-character ceiling.`);
        return clip(l, TWEET_TEXT_MAX);
      });
    }
    if (formatId === 'push' && label.includes('title')) {
      lines = lines.map((l) => {
        if ([...l].length <= 40) return l;
        enforced.push('Title trimmed to 40 characters.');
        return clip(l, 40);
      });
    }
    if (formatId === 'push' && label.includes('body')) {
      lines = lines.map((l) => {
        if ([...l].length <= 120) return l;
        enforced.push('Body trimmed to 120 characters.');
        return clip(l, 120);
      });
    }
    return { ...b, lines };
  });
  return { output: { ...output, blocks }, enforced };
}

/**
 * Grounding check, enforced in code rather than only asked for in the prompt.
 *
 * Every figure an output states must trace back to the source story. The check
 * is cross-script and word-aware, so a Hindi card writing "आठ" or an English one
 * writing "twelve" both resolve against the original copy; only a figure the
 * story never stated is reported.
 */
const FIGURE_RE = /[\d०-९০-৯][\d०-९০-৯.,]*/g;

function groundingViolations(output, story) {
  const src = `${story.headline}\n${story.body}`;
  const text = [
    ...iterLines(output).map((l) => l.text),
    output.visual ? JSON.stringify(output.visual) : '',
  ].join(' ');
  const figures = [
    ...new Set((text.match(FIGURE_RE) || []).map((n) => n.replace(/[.,]+$/, '')).filter(Boolean)),
  ];
  return figures
    .filter((n) => !textCarriesValue(src, n))
    .map((n) => `Ungrounded figure "${n}" — it does not appear in the source story. Remove it or write around it.`);
}

function shape(raw) {
  const blocks = (Array.isArray(raw?.blocks) ? raw.blocks : [])
    .map((b) => ({
      label: String(b?.label ?? '').trim() || 'Untitled',
      lines: (Array.isArray(b?.lines) ? b.lines : [b?.lines])
        .filter((l) => l !== undefined && l !== null && String(l).trim() !== '')
        .map((l) => String(l).trim()),
    }))
    .filter((b) => b.lines.length);
  return {
    blocks,
    meta: raw?.meta && typeof raw.meta === 'object' ? raw.meta : {},
    visual: raw?.visual && typeof raw.visual === 'object' ? raw.visual : null,
    factsUsed: Array.isArray(raw?.factsUsed) ? raw.factsUsed.map(String) : [],
  };
}

/**
 * The text each slide's picture should be about. A carousel slide is
 * headline + caption; a story card is one line; a post is its hook, with the
 * caption as extra colour for the director.
 */
function slideCopy(formatId, output) {
  const blocks = output.blocks || [];
  if (formatId === 'insta_post') {
    const hook = blocks.find((b) => /hook/i.test(b.label));
    const caption = blocks.find((b) => /caption/i.test(b.label));
    const text = [hook?.lines?.[0], caption?.lines?.[0]].filter(Boolean).join(' — ');
    return text ? [text] : [];
  }
  // Carousel and story are one block per slide.
  return blocks.map((b) => (b.lines || []).join(' — ')).filter(Boolean);
}

const SOCIAL_BACKDROP_ASPECT = {
  insta_carousel: '1:1',
  insta_post: '1:1',
  insta_story: '9:16',
};

export async function generateOne({ formatId, story, facts, language, steer }) {
  const f = FORMAT_BY_ID[formatId];
  const started = Date.now();

  let out = shape(
    await completeJson({
      system: generateSystem(),
      user: generatePrompt({ formatId, story, facts, language, steer }),
      maxTokens: f.maxTokens,
      effort: 'medium',
    })
  );

  // One repair round if the format contract was broken or a figure is ungrounded.
  let violations = [...f.validate(out), ...groundingViolations(out, story)];
  if (violations.length) {
    try {
      const fixed = shape(
        await completeJson({
          system: generateSystem(),
          user: repairPrompt({ formatId, previous: out, violations, language }),
          maxTokens: f.maxTokens,
          effort: 'medium',
        })
      );
      const after = [...f.validate(fixed), ...groundingViolations(fixed, story)];
      if (after.length <= violations.length) {
        out = fixed;
        violations = after;
      }
    } catch {
      /* keep the first attempt rather than failing the card */
    }
  }

  const { output, enforced } = enforceLimits(formatId, out);
  const finished = { ...output };
  if (f.meta) finished.meta = { ...finished.meta, ...f.meta(finished) };

  // Only the cover takes a generated backdrop, and only as atmosphere — the
  // headline and figures on top of it are still drawn by us, so they stay exact.
  if (finished.visual?.kind === 'cover' && imageProviderId) {
    finished.background = await generateBackground({
      prompt: coverPrompt(finished.visual, story),
      aspect: '9:16',
    });
    finished.backgroundSource = finished.background ? imageProviderId : null;
  }
  // The Instagram formats have no code-rendered visual — their slides are DOM,
  // so backdrops are handed to the browser and the copy is laid over them there.
  // One image PER SLIDE, art-directed from that slide's own copy: a single
  // shared backdrop had nothing to do with the words on top of it, which is what
  // made the cards read as stock wallpaper.
  const socialAspect = SOCIAL_BACKDROP_ASPECT[formatId];
  if (socialAspect && imageProviderId) {
    const slideTexts = slideCopy(formatId, finished);
    if (slideTexts.length) {
      const prompts = await directSlides({ story, slideTexts, aspect: socialAspect });
      finished.backgrounds = await Promise.all(
        prompts.map((prompt) => generateBackground({ prompt, aspect: socialAspect }))
      );
      // The first successful image also serves as the single-image fallback for
      // any renderer that wants one.
      finished.background = finished.backgrounds.find(Boolean) || null;
      finished.backgroundSource = finished.background ? imageProviderId : null;
      finished.imagePrompts = prompts;
    }
  }

  finished.svg = renderVisual(finished.visual, { background: finished.background });
  return {
    formatId,
    ...finished,
    factUsage: verifyFactUsage(finished, facts),
    warnings: [...f.validate(finished), ...groundingViolations(finished, story), ...enforced],
    ms: Date.now() - started,
  };
}

/**
 * Guard against extraction drift: the two ledgers are produced by separate
 * calls, so one run may word a slot more specifically than the other. If one
 * value's tokens are a subset of the other's, nothing a reader would act on has
 * actually changed — flagging it would send an editor to re-check copy that is
 * still correct, which is exactly the false alarm this tool exists to avoid.
 * Token-aware (not substring) so "5" -> "50" is still a real change.
 */
const HEDGES = ['about', 'around', 'approximately', 'a', 'an', 'the', 'of'];

const driftTokens = (v) =>
  new Set(
    String(v ?? '')
      .toLowerCase()
      .replace(/[.,;:'"()]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !HEDGES.includes(t))
  );

export function isDrift(a, b) {
  const A = driftTokens(a);
  const B = driftTokens(b);
  if (!A.size || !B.size) return false;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  return [...small].every((t) => large.has(t));
}

/* ── ledger diff ──────────────────────────────────────────────────────── */

export async function diffLedgers({ oldFacts, newFacts, story }) {
  const res = await completeJson({
    system: DIFF_SYSTEM,
    user: diffPrompt({ oldFacts, newFacts }),
    maxTokens: 3000,
    effort: 'high',
  });
  const byOld = Object.fromEntries(oldFacts.map((f) => [f.id, f]));
  const byNew = Object.fromEntries(newFacts.map((f) => [f.id, f]));
  const changed = (res.changed || [])
    .map((c) => ({
      oldId: c.oldId,
      newId: c.newId,
      label: c.label || byNew[c.newId]?.label || byOld[c.oldId]?.label || 'Fact',
      oldValue: String(c.oldValue ?? byOld[c.oldId]?.value ?? ''),
      newValue: String(c.newValue ?? byNew[c.newId]?.value ?? ''),
      why: c.why || '',
    }))
    .filter((c) => c.oldValue && c.newValue && c.oldValue !== c.newValue && !isDrift(c.oldValue, c.newValue));
  reconcileChanges({ changed, oldFacts, newFacts, story });

  return {
    changed,
    unchanged: res.unchanged || [],
    added: (res.added || []).map((a) => ({ ...a, value: String(a.value ?? byNew[a.newId]?.value ?? '') })),
    removed: (res.removed || []).map((r) => ({ ...r, value: String(r.value ?? byOld[r.oldId]?.value ?? '') })),
  };
}

/* ── targeted patching ────────────────────────────────────────────────── */

/**
 * Rewrites only the named lines. Everything else in the output is carried over
 * byte-for-byte, which is what makes this a patch rather than a regeneration.
 */
export async function patchLines({ formatId, output, keys, changes, facts, story, language }) {
  const lines = iterLines(output);
  const targets = lines.filter((l) => keys.includes(l.key));
  if (!targets.length) return { output, patches: [] };

  const res = await completeJson({
    system: PATCH_SYSTEM,
    user: patchPrompt({ formatId, targets, changes, facts, story, language }),
    maxTokens: 2500,
    effort: 'high',
  });

  const patches = [];
  let next = output;
  for (const p of res.patched || []) {
    const before = targets.find((t) => t.key === p.key);
    if (!before || !p.text) continue;
    const after = String(p.text).trim();
    if (after === before.text) continue;
    next = setLine(next, p.key, after);
    patches.push({ key: p.key, blockLabel: before.blockLabel, before: before.text, after });
  }

  const f = FORMAT_BY_ID[formatId];
  const { output: limited, enforced } = enforceLimits(formatId, next);
  const finished = { ...limited };
  if (f.meta) finished.meta = { ...finished.meta, ...f.meta(finished) };
  // Reuse the existing backdrop: only the wording changed, and a fresh image
  // would make the patch look like a redesign rather than a correction.
  finished.svg = renderVisual(finished.visual, { background: finished.background });
  return {
    output: {
      ...finished,
      factUsage: verifyFactUsage(finished, facts),
      warnings: [...f.validate(finished), ...groundingViolations(finished, story), ...enforced],
    },
    patches,
  };
}

/** Re-derive just the visual spec for an image output, then re-render it. */
export async function patchVisual({ formatId, output, changes, facts, story, language }) {
  const f = FORMAT_BY_ID[formatId];
  const res = await completeJson({
    system: PATCH_SYSTEM,
    user: `FORMAT: ${f.label} — you are correcting ONLY the image.

FACTS THAT CHANGED IN THE SOURCE:
${changes.map((c) => `- ${c.label}: "${c.oldValue}" → "${c.newValue}"`).join('\n')}

CURRENT FACT LEDGER (authoritative):
${facts.map((x) => `${x.id} · ${x.label}: ${x.value}`).join('\n')}

THE PUBLISHED VISUAL SPEC:
${JSON.stringify(output.visual, null, 2)}

Update only the fields that carry an outdated value. Keep the same structure, the same number of stats and series, the same wording everywhere else.

SOURCE STORY (updated)
Headline: ${story.headline}

${story.body}

Return JSON: { "visual": { ...the corrected spec, same shape... } }`,
    maxTokens: 1600,
    effort: 'high',
  });

  const before = output.visual;
  const visual = res.visual && typeof res.visual === 'object' ? res.visual : before;
  const finished = { ...output, visual, svg: renderVisual(visual, { background: output.background }) };
  if (f.meta) finished.meta = { ...finished.meta, ...f.meta(finished) };
  return {
    output: {
      ...finished,
      factUsage: verifyFactUsage(finished, facts),
      warnings: [...f.validate(finished), ...groundingViolations(finished, story)],
    },
    visualBefore: before,
  };
}

/**
 * Narrow fallback: the model reported using a fact but we could not prove which
 * line carries it (translated copy, transliterated names). One small call finds
 * the line so we still highlight a line rather than condemning the whole card.
 */
export async function locateStaleLines({ formatId, output, changes }) {
  const lines = iterLines(output);
  const res = await completeJson({
    system: PATCH_SYSTEM,
    user: `These facts changed in the source story:
${changes.map((c) => `- ${c.label}: "${c.oldValue}" → "${c.newValue}"`).join('\n')}

Below are the numbered lines of an already-published ${FORMAT_BY_ID[formatId].label}. The text may be in another language or may spell numbers out in words.

${lines.map((l) => `[${l.key}] ${l.text}`).join('\n')}

Identify ONLY the lines that carry one of the OLD values above and would therefore now be factually wrong. Be conservative: if a line does not actually state the outdated value, leave it out. Return an empty array if none do.

Return JSON: { "lines": [ { "key": "b0l1", "label": "the fact label it carries" } ] }`,
    maxTokens: 1200,
    effort: 'high',
  });
  const valid = new Set(lines.map((l) => l.key));
  return (res.lines || []).filter((r) => valid.has(r.key));
}

/**
 * Deterministic staleness backstop, applied on top of the model's alignment.
 *
 * The aligner occasionally splits a single correction into a "removed" plus an
 * "added" row, after which nothing downstream is flagged — the worst possible
 * failure for this tool, because it reports all-clear on copy that is now wrong.
 * So each old fact is also checked against the UPDATED SOURCE TEXT directly: if
 * a concrete value is no longer anywhere in the story, published copy carrying
 * it is stale, whatever the aligner decided.
 *
 * Restricted to concrete fact types — status/other values are usually
 * paraphrases ("no arrests so far") and would raise false alarms.
 *
 * Mutates and returns `changed`.
 */
const CONCRETE_TYPES = new Set(['number', 'name', 'location', 'date', 'time', 'amount']);

export function reconcileChanges({ changed, oldFacts, newFacts, story }) {
  if (!story) return changed;
  const srcNew = `${story.headline}\n${story.body}`;
  const claimedOld = new Set(changed.map((c) => c.oldId));
  const claimedNew = new Set(changed.map((c) => c.newId));
  const slug = (l) => String(l ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const overlap = (a, b) => {
    const A = new Set(slug(a).split(/\s+/).filter(Boolean));
    return slug(b).split(/\s+/).some((t) => t && A.has(t));
  };

  for (const of of oldFacts) {
    if (claimedOld.has(of.id)) continue;
    if (!CONCRETE_TYPES.has(of.type)) continue;
    if (textCarriesValue(srcNew, of.value)) continue; // still supported by the copy

    const cand =
      newFacts.find((nf) => !claimedNew.has(nf.id) && slug(nf.label) === slug(of.label)) ||
      newFacts.find((nf) => !claimedNew.has(nf.id) && overlap(nf.label, of.label)) ||
      newFacts.find((nf) => !claimedNew.has(nf.id) && nf.type === of.type);
    if (!cand) continue;
    if (cand.value === of.value || isDrift(of.value, cand.value)) continue;

    claimedOld.add(of.id);
    claimedNew.add(cand.id);
    changed.push({
      oldId: of.id,
      newId: cand.id,
      label: of.label,
      oldValue: of.value,
      newValue: cand.value,
      why: 'no longer stated in the source',
    });
  }
  return changed;
}
