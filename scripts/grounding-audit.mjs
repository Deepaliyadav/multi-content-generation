/**
 * Grounding audit: every number that appears in a generated output must trace
 * back to the source story (allowing spelled-out and cross-script forms).
 */
import { SAMPLES } from '../server/samples.js';
import { extractFacts, generateOne } from '../server/pipeline.js';
import { FORMAT_IDS } from '../server/formats.js';
import { iterLines, textCarriesValue } from '../server/facts.js';

const s = SAMPLES[0];
const story = { headline: s.headline, body: s.body };
const facts = await extractFacts(story);
const src = `${story.headline}\n${story.body}`;

const outs = [];
const ids = [...FORMAT_IDS];
const pool = Array.from({ length: 4 }, async () => {
  for (;;) {
    const id = ids.shift();
    if (!id) return;
    outs.push(await generateOne({ formatId: id, story, facts, language: 'Hindi' }));
  }
});
await Promise.all(pool);

let flagged = 0;
for (const o of outs) {
  const text = [...iterLines(o).map((l) => l.text), JSON.stringify(o.visual || '')].join(' ');
  // Numbers the output states, normalised across scripts.
  const nums = [...new Set((text.match(/[\d०-९০-৯][\d०-९০-৯.,]*/g) || [])
    .map((n) => n.replace(/[.,]$/, ''))
    .filter((n) => n.length))];
  const unsupported = nums.filter((n) => !textCarriesValue(src, n));
  if (unsupported.length) {
    flagged++;
    console.log(`  ${o.formatId}: numbers not found in source → ${unsupported.join(', ')}`);
  }
}
console.log(`\nGROUNDING AUDIT: ${outs.length} outputs checked, ${flagged} with an unsupported number.`);
const warned = outs.filter((o) => (o.warnings || []).length);
console.log(`Outputs still carrying a warning after repair: ${warned.length ? warned.map((o) => `${o.formatId} [${o.warnings.join('; ')}]`).join(' | ') : 'none'}`);

// Also: nobody may invent a quotation.
const quoted = outs.filter((o) => /["“”][^"“”]{25,}["“”]/.test(iterLines(o).map((l) => l.text).join(' ')));
console.log(`Outputs containing a long quoted string: ${quoted.map((o) => o.formatId).join(', ') || 'none'}`);
