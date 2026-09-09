/**
 * Translate a finished output without re-writing it.
 *
 * This is deliberately not "generate the format again in another language". A
 * translated push alert must still fit 40 characters, a translated carousel
 * must still have the same slide count, and an editor comparing the two needs
 * line 3 to be line 3 in both. So the model is given the finished output and
 * asked to return the same shape with the words changed — structure is held by
 * the same validators that held it the first time.
 */
import './env.js';
import { completeJson } from './llm.js';
import { FORMAT_BY_ID } from './formats.js';
import { GROUNDING } from './prompts.js';

const SYSTEM = `${GROUNDING}

You are translating an already-published output into another language for the same newsroom. You are not rewriting it and not re-reporting it.

- Keep every fact exactly as it stands. A translation that changes a number is a correction, and you are not authorised to make one.
- Newsroom-quality prose in the target language, not literal machine translation.
- Proper nouns, place names and official designations take the form that language's press actually uses.
- Keep the register of the format: a broadcast strap stays a strap, a caption stays a caption.`;

export async function translateOutput({ formatId, output, language, story }) {
  const f = FORMAT_BY_ID[formatId];
  const blocks = output?.blocks || [];
  if (!blocks.length) return output;

  const shape = blocks.map((b, i) => `[${i}] ${b.label} — ${(b.lines || []).length} line(s)`).join('\n');

  const res = await completeJson({
    system: SYSTEM,
    user: `Translate this ${f?.label || formatId} into ${language}.

STRUCTURE YOU MUST RETURN UNCHANGED — same blocks, same order, same number of lines in each:
${shape}

LIMITS STILL BINDING IN THE TARGET LANGUAGE:
${(f?.rules?.({ language }) || []).map((r, i) => `${i + 1}. ${r}`).join('\n') || 'none'}

Leave every block LABEL exactly as it is, in English. Labels are production scaffolding — "Ticker", "Anchor script", "Hook" — not published copy, and the desk's own checks read them. Translate only the lines.

THE OUTPUT TO TRANSLATE
${JSON.stringify({ blocks }, null, 2)}

${story?.headline ? `For context only, the source headline: ${story.headline}` : ''}

Return JSON of exactly the same shape:
{"blocks":[{"label":"...","lines":["..."]}]}`,
    // Not the format's own budget. Push is generated within 700 tokens, but a
    // translation also pays for reasoning and a JSON envelope, and at 700 the
    // answer came back empty — the format vanished from the edition entirely.
    maxTokens: Math.max((f?.maxTokens || 4000) * 2, 4000),
    effort: 'medium',
  });

  const out = Array.isArray(res.blocks) ? res.blocks : null;
  if (!out) throw new Error('Translation did not come back in the expected shape.');

  // Hold the shape: a translation that loses a slide is not a translation.
  const fixed = blocks.map((b, i) => {
    const t = out[i] || {};
    const lines = Array.isArray(t.lines) ? t.lines : [];
    return {
      // The label is always the original: the format validators match on it,
      // and a translated "Breaking strap" reads to them as a missing part.
      label: b.label,
      lines: (b.lines || []).map((orig, j) => String(lines[j] ?? orig)),
    };
  });

  const translated = { ...output, blocks: fixed, translatedTo: language };
  return {
    ...translated,
    // Re-run the format's own validator so a translation that broke a character
    // ceiling is reported rather than shipped.
    warnings: f?.validate ? f.validate(translated) : [],
  };
}
