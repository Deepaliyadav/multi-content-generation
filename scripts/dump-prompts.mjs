/**
 * Extract every prompt the app sends to a model, verbatim from source.
 *
 * Prompts are template literals, so they are pulled out by locating a known
 * opening line and reading to the literal's matching close. Re-run this after
 * editing any prompt so the shared reference never drifts from the code.
 *
 *   npm run prompts:dump          -> writes prompts.json + PROMPTS.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grabTemplate } from './lib/grab-template.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(root, 'server', f), 'utf8');
const FILES = Object.fromEntries(
  ['prompts.js', 'discover.js', 'pipeline.js', 'artdirector.js'].map((f) => [f, src(f)])
);

const grab = (file, anchor) => grabTemplate(FILES[file], anchor);

const SPEC = [
  ['grounding', 'Grounding contract', 'prompts.js', 'You are a senior desk editor at a wire agency.', 'shared', 'Generation', 'Prepended to every generation, diff and patch system prompt. The most load-bearing block in the app.'],
  ['fact-system', 'Fact extraction — system', 'prompts.js', 'Right now you are doing fact extraction only.', 'system', 'Ledger', ''],
  ['fact-user', 'Fact extraction — user', 'prompts.js', 'Extract the atomic, checkable facts', 'user', 'Ledger', 'Builds the Fact Ledger every other output is held to. Tuning here changes everything downstream.'],
  ['gen-system', 'Format generation — system', 'prompts.js', 'You are producing ONE named output format.', 'system', 'Generation', ''],
  ['gen-user', 'Format generation — user', 'prompts.js', 'FORMAT: ${f.label} — ${f.blurb}', 'user', 'Generation', 'Runs once per format, 13× per story. Per-format HARD RULES are injected from formats.js.'],
  ['repair', 'Contract repair (one retry)', 'prompts.js', 'Your previous ${f.label} output broke', 'user', 'Generation', 'Fires only when a validator or the grounding check rejects an output.'],
  ['diff-system', 'Ledger diff — system', 'prompts.js', 'You are comparing two versions of a fact ledger', 'system', 'Edit propagation', ''],
  ['diff-user', 'Ledger diff — user', 'prompts.js', 'The source story was edited.', 'user', 'Edit propagation', 'Decides what is a real correction vs harmless wording drift. False alarms waste an editor; misses ship wrong copy.'],
  ['patch-system', 'Targeted patch — system', 'prompts.js', 'You are issuing a surgical correction', 'system', 'Edit propagation', ''],
  ['patch-user', 'Targeted patch — user', 'prompts.js', 'FACTS THAT CHANGED IN THE SOURCE:', 'user', 'Edit propagation', 'Sees ONLY the stale lines, never the whole output. This is what makes regeneration surgical.'],
  ['patch-visual', 'Visual patch (infographic)', 'pipeline.js', 'you are correcting ONLY the image.', 'user', 'Edit propagation', 'Corrects the image spec only — same shape, same stat count, only outdated values move.'],
  ['locate-stale', 'Stale line locator (fallback)', 'pipeline.js', 'These facts changed in the source story:', 'user', 'Edit propagation', 'Used when a fact is carried but cannot be matched by string — translated or transliterated copy.'],
  ['cluster-system', 'Wire clustering — system', 'discover.js', 'You are the intake editor on a national news desk.', 'system', 'Discovery', ''],
  ['cluster-user', 'Wire clustering — user', 'discover.js', 'Here are items from competitor wires.', 'user', 'Discovery', 'Groups competitor RSS into distinct stories. Headlines are rewritten, never copied.'],
  ['trend-search', 'Trending search agent (web_search)', 'discover.js', 'Find the India news stories breaking', 'user', 'Discovery', 'Tool-using call. Asks for prose notes, not JSON — structuring is a separate pass.'],
  ['trend-structure', 'Trending structuring', 'discover.js', 'Turn these research notes into structured entries.', 'user', 'Discovery', 'Must not discard good leads because the notes also record a dead end.'],
  ['filed-system', 'Already-filed check — system', 'discover.js', 'You are the desk editor deciding whether', 'system', 'Discovery', ''],
  ['filed-user', 'Already-filed check — user', 'discover.js', 'For each candidate story, decide whether', 'user', 'Discovery', 'Same event vs merely same topic. A false "already filed" means the desk misses a story.'],
  ['brief-system', 'Starter brief — system', 'discover.js', 'You are a rewrite-desk journalist', 'system', 'Discovery', 'Attribution rules live here. This is the anti-plagiarism boundary.'],
  ['brief-user', 'Starter brief — user', 'discover.js', 'Write a starter brief for this story.', 'user', 'Discovery', ''],
  ['art-system', 'Art director — system', 'artdirector.js', 'You are a creative director specializing', 'system', 'Imagery', ''],
  ['art-user', 'Art director — user', 'artdirector.js', 'Given an article summary and', 'user', 'Imagery', 'Writes the image-generation prompts for Instagram slides. Carries the casualty and likeness limits.'],
];

const prompts = SPEC.map(([id, name, file, anchor, role, stage, note]) => ({
  id, name, file: `server/${file}`, role, stage, note, text: grab(file, anchor),
}));

// GUARDRAIL is string concatenation, not a template literal.
const a = FILES['artdirector.js'];
const gStart = a.indexOf('const GUARDRAIL =');
const guard = a
  .slice(gStart, a.indexOf(';', gStart))
  .split('=')[1]
  .split('+')
  .map((p) => p.trim().replace(/^'|'$/g, ''))
  .join('');
prompts.push({
  id: 'art-guardrail', name: 'Image guardrail (appended verbatim)', file: 'server/artdirector.js',
  role: 'shared', stage: 'Imagery',
  note: 'Appended to whatever the art director writes — belt and braces.', text: guard,
});

const short = prompts.filter((p) => p.text.length < 60);
if (short.length) console.warn('WARNING — suspiciously short:', short.map((p) => p.id).join(', '));

fs.writeFileSync(path.join(root, 'prompts.json'), JSON.stringify(prompts, null, 2));

const md = [
  '# Prompts — Living Story Sync',
  '',
  `Generated from source by \`npm run prompts:dump\` on ${new Date().toISOString().slice(0, 10)}.`,
  'Edit the prompt in the file named under each heading, then re-run this to refresh.',
  '',
  ...prompts.map((p) =>
    [`## ${p.name}`, '', `\`${p.file}\` · ${p.role}${p.note ? `\n\n${p.note}` : ''}`, '', '```text', p.text, '```', ''].join('\n')
  ),
].join('\n');
fs.writeFileSync(path.join(root, 'PROMPTS.md'), md);

console.log(`${prompts.length} prompts -> prompts.json, PROMPTS.md`);
for (const p of prompts) console.log(`  ${p.id.padEnd(16)} ${String(p.text.length).padStart(5)}  ${p.stage}`);
