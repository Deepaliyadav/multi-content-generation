/**
 * Every prompt in the app. One grounding contract, reused everywhere.
 */
import { FORMAT_BY_ID } from './formats.js';

/** The non-negotiable rule shared by every generation call. */
export const GROUNDING = `You are a senior desk editor at a wire agency. You repackage a reporter's copy into publication formats.

GROUNDING DISCIPLINE — this is absolute:
- Use ONLY facts present in the source story and its fact ledger.
- Never invent a number, name, date, location, quote, cause, or attribution.
- Never sharpen a hedge: "police suspect" must not become "police confirmed".
- If a format would normally carry a detail the story does not contain, omit that detail and write around it. Omission is always correct; fabrication never is.
- Never state a total, percentage, or trend the story does not state.
- Attribute anything the story attributes ("police said") rather than asserting it directly.`;

export const FACT_SYSTEM = `${GROUNDING}

Right now you are doing fact extraction only. You are building the ledger the rest of the desk will be held to.`;

export function factPrompt({ headline, body }) {
  return `Extract the atomic, checkable facts from this story.

An atomic fact is a single value a correction could later change: a count, a name, a date or time, a place, an attributed claim, a status, an amount.

Rules:
- 5 to 12 facts. Prefer the ones a follow-up story would most likely update.
- "label" is a short human name for the slot (e.g. "Deaths", "Location", "Official quoted"). Sentence case. Max 3 words. Never join two ideas with a slash.
- "value" is the bare value, without hedges or articles. Write numbers as numerals even when the story spells them out ("5", not "Five"). Drop "about", "around", "a", "an", "the" — those belong in evidence. Good: "5", "Sector 62, Noida", "Delhi Police spokesperson", "6.15 am", "two arrested".
- "type" is one of: number, name, date, time, location, attribution, status, amount, other.
- "evidence" is the shortest verbatim span from the story that carries this fact. It MUST appear character-for-character in the story.
- One fact per slot. Do not emit two facts with the same label.
- Do not extract facts the story does not state.

Return JSON:
{"facts":[{"id":"f1","label":"Deaths","value":"5","type":"number","evidence":"Five people were killed"}]}

Ids must be f1, f2, f3 … in order.

SOURCE STORY
Headline: ${headline}

${body}`;
}

export function generateSystem() {
  return `${GROUNDING}

You are producing ONE named output format. Formats on this desk are not interchangeable — a judge will read all thirteen side by side, and any two that read alike is a failure. Obey the format's hard rules exactly, including every count and character limit.`;
}

export function generatePrompt({ formatId, story, facts, language }) {
  const f = FORMAT_BY_ID[formatId];
  const rules = f.rules({ language });
  return `FORMAT: ${f.label} — ${f.blurb}

HARD RULES for this format:
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

STRUCTURE:
${f.blockContract}

FACT LEDGER (the only facts you may use):
${facts.map((x) => `${x.id} · ${x.label}: ${x.value}`).join('\n')}

SOURCE STORY
Headline: ${story.headline}

${story.body}

Return JSON of exactly this shape:
{
  "blocks": [ { "label": "...", "lines": ["..."] } ],
  "meta": {},${f.visualContract ? `\n  ${f.visualContract},` : ''}
  "factsUsed": ["f1", "f3"]
}

"factsUsed" must list the ledger ids whose value this output actually carries — including facts you expressed in words or in another language rather than as digits. Be exact: do not list a fact you did not use, and do not omit one you did.`;
}

/** Re-run after an edit: align the two ledgers and classify each slot. */
export const DIFF_SYSTEM = `${GROUNDING}

You are comparing two versions of a fact ledger for the same developing story, to decide what a correction desk must act on.`;

export function diffPrompt({ oldFacts, newFacts }) {
  return `The source story was edited. Align the OLD ledger against the NEW ledger and classify every slot.

Match slots by what they MEAN, not by id or by exact label wording — "Deaths" and "Death toll" are the same slot.

Classify each matched pair as:
- "changed" if the value is materially different (5 → 8, "Sector 62" → "Sector 63", "suspected" → "confirmed")
- "unchanged" if it means the same thing even if worded differently

Then list slots present only in OLD ("removed") and only in NEW ("added").

Be strict about "changed". Treat a slot as UNCHANGED when:
- it is the same value worded differently ("5" vs "five", "police" vs "the police");
- one version is simply more or less specific than the other but does not contradict it ("6.15 am" vs "6.15 am Tuesday", "Noida" vs "Sector 62, Noida", "March" vs "March 2026");
- only a hedge or article moved ("about 1,200" vs "1,200").

Treat a slot as CHANGED only when a reader acting on the old value would now be wrong: a different number, a different person or body, a different place, a different date, a different status.

These two ledgers were extracted independently, so harmless wording drift between them is expected. Do not report drift as a change — a false alarm sends an editor to re-check copy that is still correct.

OLD LEDGER
${oldFacts.map((f) => `${f.id} · ${f.label}: ${f.value}`).join('\n')}

NEW LEDGER
${newFacts.map((f) => `${f.id} · ${f.label}: ${f.value}`).join('\n')}

"label" on each row must be a short slot name of at most 3 words — never two ideas joined by a slash. "oldValue" and "newValue" must be the bare values, as short as they can be while still being accurate.

Return JSON:
{
  "changed": [ { "oldId": "f1", "newId": "f1", "label": "Deaths", "oldValue": "5", "newValue": "8", "why": "max 12 words" } ],
  "unchanged": [ { "oldId": "f2", "newId": "f2", "label": "Location" } ],
  "added": [ { "newId": "f7", "label": "...", "value": "..." } ],
  "removed": [ { "oldId": "f6", "label": "...", "value": "..." } ]
}`;
}

/**
 * Targeted repair. The model sees ONLY the lines that carry a stale fact and
 * rewrites those lines in place — everything else in the output is untouched.
 */
export const PATCH_SYSTEM = `${GROUNDING}

You are issuing a surgical correction to an ALREADY PUBLISHED output. You are given only the specific lines that carry an outdated fact. Rewrite exactly those lines and nothing else.`;

export function patchPrompt({ formatId, targets, changes, facts, story, language }) {
  const f = FORMAT_BY_ID[formatId];
  return `FORMAT: ${f.label}

FACTS THAT CHANGED IN THE SOURCE:
${changes.map((c) => `- ${c.label}: "${c.oldValue}" → "${c.newValue}"`).join('\n')}

CURRENT FACT LEDGER (authoritative):
${facts.map((x) => `${x.id} · ${x.label}: ${x.value}`).join('\n')}

HARD RULES still binding on this format:
${f.rules({ language }).map((r, i) => `${i + 1}. ${r}`).join('\n')}

LINES TO CORRECT — these are the only lines you may touch:
${targets.map((t) => `[${t.key}] (${t.blockLabel}) ${t.text}`).join('\n')}

Rewrite each line so it carries the NEW value. Rules for the rewrite:
- Change as little as possible. Ideally only the outdated value itself changes.
- Keep the line's language, register, length discipline and punctuation style identical.
- If the line is in a language other than English, keep it in that language.
- Do not add commentary such as "updated" or "correction".
- Keep every character limit the format imposes.

SOURCE STORY (updated)
Headline: ${story.headline}

${story.body}

Return JSON:
{ "patched": [ { "key": "<the same key>", "text": "the corrected line" } ] }`;
}

/** One repair round when a validator rejects a generated output. */
export function repairPrompt({ formatId, previous, violations, language }) {
  const f = FORMAT_BY_ID[formatId];
  return `Your previous ${f.label} output broke its format contract:
${violations.map((v) => `- ${v}`).join('\n')}

HARD RULES:
${f.rules({ language }).map((r, i) => `${i + 1}. ${r}`).join('\n')}

STRUCTURE:
${f.blockContract}

YOUR PREVIOUS OUTPUT:
${JSON.stringify(previous, null, 2)}

Fix ONLY what the violations name. Keep everything else, including factsUsed${f.visualContract ? ' and the visual object' : ''}. Return the corrected JSON object in the same shape.`;
}
