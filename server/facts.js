/**
 * Fact-reference detection.
 *
 * The fact ledger is structured data, so "does this output reference this fact"
 * is a real, checkable operation rather than a vibe. Detection runs in three
 * layers, cheapest first:
 *
 *   1. Literal match  — the fact's value appears in the line.
 *   2. Script/word-form match — the same number written in Devanagari or Bengali
 *      digits, or spelled out in English/Hindi/Bangla. This is what makes the
 *      check survive the Translation output.
 *   3. Model-reported `factsUsed` — the backstop for transliterated names and
 *      paraphrase, used to decide staleness and to trigger a narrow LLM
 *      line-locate call so we still highlight one line, not the whole card.
 */

/* ── numerals across the three demo languages ─────────────────────────── */

const DIGIT_SETS = [
  '0123456789',
  '०१२३४५६७८९', // Devanagari
  '০১২৩৪৫৬৭৮৯', // Bengali
];

const NUMBER_WORDS = {
  0: ['zero', 'शून्य', 'শূন্য'],
  1: ['one', 'एक', 'এক'],
  2: ['two', 'दो', 'দুই'],
  3: ['three', 'तीन', 'তিন'],
  4: ['four', 'चार', 'চার'],
  5: ['five', 'पांच', 'पाँच', 'পাঁচ'],
  6: ['six', 'छह', 'छः', 'ছয়'],
  7: ['seven', 'सात', 'সাত'],
  8: ['eight', 'आठ', 'আট'],
  9: ['nine', 'नौ', 'নয়'],
  10: ['ten', 'दस', 'দশ'],
  11: ['eleven', 'ग्यारह', 'এগারো'],
  12: ['twelve', 'बारह', 'বারো'],
  13: ['thirteen', 'तेरह', 'তেরো'],
  14: ['fourteen', 'चौदह', 'চৌদ্দ'],
  15: ['fifteen', 'पंद्रह', 'পনেরো'],
  16: ['sixteen', 'सोलह', 'ষোলো'],
  17: ['seventeen', 'सत्रह', 'সতেরো'],
  18: ['eighteen', 'अठारह', 'আঠারো'],
  19: ['nineteen', 'उन्नीस', 'উনিশ'],
  20: ['twenty', 'बीस', 'বিশ'],
};

/** Map any supported digit script to ASCII so numbers compare across scripts. */
function asciiDigits(s) {
  let out = '';
  for (const ch of String(s)) {
    let mapped = ch;
    for (const set of DIGIT_SETS) {
      const i = set.indexOf(ch);
      if (i !== -1) { mapped = String(i); break; }
    }
    out += mapped;
  }
  return out;
}

const norm = (s) =>
  asciiDigits(String(s ?? ''))
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** word form -> integer, across all three languages ("five", "पांच", "পাঁচ" -> 5) */
const WORD_TO_INT = (() => {
  const m = new Map();
  for (const [n, words] of Object.entries(NUMBER_WORDS))
    for (const w of words) m.set(norm(w), Number(n));
  return m;
})();

/** Every surface form a fact value might take in generated copy. */
export function valueVariants(value) {
  const v = String(value ?? '').trim();
  if (!v) return [];
  const out = new Set([norm(v)]);

  // A spelled-out number is the same fact as its numeral, in any of the three
  // scripts — this is what lets the Translation card be checked without an LLM.
  const spelled = new Set();
  for (const tok of norm(v).split(/[\s,]+/)) {
    const n = WORD_TO_INT.get(tok);
    if (n !== undefined) spelled.add(n);
  }
  for (const n of spelled) {
    out.add(String(n));
    for (const w of NUMBER_WORDS[n] || []) out.add(norm(w));
  }

  const nums = norm(v).match(/\d+(?:[.,]\d+)?/g) || [];
  for (const n of nums) {
    out.add(n);
    // 1,200 and 1200 are the same fact.
    const plain = n.replace(/,/g, '');
    out.add(plain);
    const asInt = Number(plain);
    if (Number.isInteger(asInt) && NUMBER_WORDS[asInt])
      for (const w of NUMBER_WORDS[asInt]) out.add(norm(w));
    if (Number.isInteger(asInt) && asInt >= 1000)
      out.add(norm(asInt.toLocaleString('en-IN'))); // 1,20,000
  }
  return [...out].filter(Boolean);
}

/** Does `text` carry `value`? Whole-token match so "5" never matches "1,529". */
export function textCarriesValue(text, value) {
  const hay = norm(text);
  if (!hay) return false;
  for (const variant of valueVariants(value)) {
    if (!variant) continue;
    if (/^[\d.,]+$/.test(variant)) {
      // Numeric: must not sit inside a larger number. A bare separator on
      // either side is fine ("Sector 62, Noida"); a separator BETWEEN digits is
      // not, so "5" never matches inside "1,529" and "15" never inside "6.15".
      const re = new RegExp(
        `(?<!\\d)(?<!\\d[.,])${escapeRe(variant)}(?!\\d)(?![.,]\\d)`
      );
      if (re.test(hay)) return true;
    } else if (
      // Word form: require letter boundaries rather than a minimum length, so a
      // two-character numeral word like "আট" (eight) still matches while "five"
      // never matches inside "fives".
      new RegExp(`(?<!\\p{L})${escapeRe(variant)}(?!\\p{L})`, 'u').test(hay)
    ) {
      return true;
    }
  }
  // Multi-word proper nouns: every significant token must be present, and any
  // number inside the value is mandatory — otherwise "the Noida sector" would
  // match "Sector 62, Noida" and we would flag a card that never carried the
  // outdated specificity.
  const parts = norm(value).split(/[\s,]+/).filter(Boolean);
  const numeric = parts.filter((t) => /^\d+$/.test(t));
  const words = parts.filter((t) => t.length >= 4 && !/^\d+$/.test(t));
  if (words.length >= 2 || (words.length >= 1 && numeric.length >= 1)) {
    const wordsOk = words.every((t) => hay.includes(t));
    const numsOk = numeric.every((n) =>
      new RegExp(`(?<!\\d)(?<!\\d[.,])${escapeRe(n)}(?!\\d)(?![.,]\\d)`).test(hay)
    );
    if (wordsOk && numsOk) return true;
  }
  return false;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ── line addressing ──────────────────────────────────────────────────── */

/** Stable address for every line in an output, used for highlight + patch. */
export function iterLines(output) {
  const rows = [];
  (output.blocks || []).forEach((b, bi) =>
    (b.lines || []).forEach((text, li) =>
      rows.push({ key: `b${bi}l${li}`, blockIdx: bi, lineIdx: li, blockLabel: b.label, text })
    )
  );
  return rows;
}

export function setLine(output, key, text) {
  const m = /^b(\d+)l(\d+)$/.exec(key);
  if (!m) return output;
  const [, bi, li] = m;
  const blocks = output.blocks.map((b, i) =>
    i !== Number(bi) ? b : { ...b, lines: b.lines.map((l, j) => (j === Number(li) ? text : l)) }
  );
  return { ...output, blocks };
}

/* ── fact usage verification (the card badges) ────────────────────────── */

/**
 * Which ledger facts does this output actually carry?
 * `verified` = provable from the text. `claimed` = model-reported only.
 */
export function verifyFactUsage(output, facts) {
  const lines = iterLines(output);
  const visualText = output.visual ? JSON.stringify(output.visual) : '';
  const claimed = new Set(output.factsUsed || []);
  const used = [];
  for (const f of facts) {
    const hitLine = lines.find((l) => textCarriesValue(l.text, f.value));
    const inVisual = visualText && textCarriesValue(visualText, f.value);
    if (hitLine || inVisual) used.push({ id: f.id, label: f.label, verified: true });
    else if (claimed.has(f.id)) used.push({ id: f.id, label: f.label, verified: false });
  }
  return used;
}

/* ── stale scanning (the differentiator) ──────────────────────────────── */

/**
 * Given one output and the ledger diff, decide whether it went stale and
 * exactly which lines carry the outdated value.
 *
 * Returns { stale, staleLines: [{key, changeLabels[]}], staleVisual, needsLocate }.
 * `needsLocate` means the model said it used the fact but we could not prove
 * which line — the caller resolves that with a narrow LLM call rather than
 * flagging the whole card.
 */
export function scanOutput(output, changes) {
  const lines = iterLines(output);
  const visualText = output.visual ? JSON.stringify(output.visual) : '';
  const claimed = new Set(output.factsUsed || []);

  const byKey = new Map();
  let staleVisual = false;
  const visualChangeLabels = [];
  const unlocated = [];

  for (const c of changes) {
    let located = false;
    for (const l of lines) {
      if (textCarriesValue(l.text, c.oldValue)) {
        located = true;
        if (!byKey.has(l.key)) byKey.set(l.key, { key: l.key, changeLabels: [] });
        byKey.get(l.key).changeLabels.push(c.label);
      }
    }
    if (visualText && textCarriesValue(visualText, c.oldValue)) {
      staleVisual = true;
      visualChangeLabels.push(c.label);
      located = true;
    }
    // The model said it used this fact but we can't see the old value —
    // typical for the translated card or a transliterated name.
    if (!located && c.oldId && claimed.has(c.oldId)) unlocated.push(c);
  }

  const staleLines = [...byKey.values()];
  return {
    stale: staleLines.length > 0 || staleVisual || unlocated.length > 0,
    staleLines,
    staleVisual,
    visualChangeLabels,
    needsLocate: unlocated,
  };
}
