/**
 * Unit checks for the parts that must be right by construction rather than by
 * luck: fact-reference matching, the extraction-drift guard, and the
 * deterministic staleness backstop.
 *
 *   npm run test:unit
 */
import { textCarriesValue, valueVariants } from '../server/facts.js';
import { isDrift, reconcileChanges } from '../server/pipeline.js';
import { FORMATS, FORMAT_IDS, TWEET_TEXT_MAX } from '../server/formats.js';
import { backend, backendReady, backendHint, cliPath } from '../server/llm.js';
import fs from 'node:fs';

let failed = 0;
const chk = (ok, label, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
};
const group = (n) => console.log(`\n── ${n} ──`);

group('fact-reference matching');
const m = (hay, val, want) =>
  chk(textCarriesValue(hay, val) === want, `${JSON.stringify(hay).slice(0, 42)} ~ ${JSON.stringify(val)}`);
// exact and spelled-out
m('Five people were killed', '5', true);
m('5 dead in collapse', 'Five', true);
m('Death toll rises to 8', '5', false);
// cross-script numerals: the Translation card must be checkable without an LLM
m('पांच लोगों की मौत', '5', true);
m('পাঁচ জন নিহত', 'Five', true);
m('मरने वालों की संख्या ५ हुई', '5', true);
m('आठ लोगों की मौत', '8', true);
m('আট জন নিহত', 'eight', true);
m('आठ लोगों की मौत', '5', false);
// never match inside a larger number
m('A total of 1,529 were screened', '5', false);
m('gave way at about 6.15 am', '15', false);
m('gave way at about 6.15 am', '6', false);
m('50 people gathered', '5', false);
// separators around a number are fine
m('a garment unit in Sector 62, Noida collapsed', '62', true);
m('Around 1,200 residents', '1200', true);
m('gave way at about 6.15 am', '6.15 am', true);
// word boundaries
m('There were fives everywhere', 'five', false);
// multi-token values need their distinguishing number
m('Sector 62, Noida sealed', 'Sector 62, Noida', true);
m('The Noida sector was sealed', 'Sector 62, Noida', false);
m('Fire in Sector 63, Noida', 'Sector 62, Noida', false);
m('A Delhi Police spokesperson said', 'Delhi Police spokesperson', true);
m('Police said little', 'Delhi Police spokesperson', false);
m('taken to Kailash Hospital, Noida', 'Fortis Hospital, Noida', false);
chk(valueVariants('Five').includes('पांच'), 'number words expand across scripts');

group('extraction-drift guard');
const d = (a, b, want) => chk(isDrift(a, b) === want, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
d('6.15 am', '6.15 am Tuesday', true);   // more specific, not a correction
d('around 1,200', '1,200', true);        // hedge moved
d('Noida', 'Sector 62, Noida', true);
d('March', 'March 2026', true);
d('5', '8', false);                      // real corrections survive
d('5', '50', false);
d('Sector 62, Noida', 'Sector 63, Noida', false);
d('Delhi Police spokesperson', 'Noida Police Commissioner', false);

group('deterministic staleness backstop');
const story = {
  headline: 'Five dead as stairwell collapses at Noida industrial unit',
  body: 'Twelve of those hurt were taken to Kailash Hospital, Noida, where four are critical. Police said no arrests have been made so far. Around 1,200 residents were moved.',
};
const oldFacts = [
  { id: 'f6', label: 'Hospital', value: 'Fortis Hospital, Noida', type: 'name' },
  { id: 'f9', label: 'Residents moved', value: '1,200', type: 'number' },
  { id: 'f12', label: 'Arrests', value: 'none', type: 'status' },
];
const newFacts = [
  { id: 'g6', label: 'Hospital', value: 'Kailash Hospital, Noida', type: 'name' },
  { id: 'g9', label: 'Residents moved', value: '1,200', type: 'number' },
  { id: 'g12', label: 'Arrests', value: 'none', type: 'status' },
];
// The failure mode: the aligner split the correction into remove + add, so it
// reported nothing as changed. Published copy would have been declared clean.
let changed = [];
reconcileChanges({ changed, oldFacts, newFacts, story });
chk(changed.length === 1, 'recovers a change the aligner missed entirely');
chk(
  changed[0]?.oldValue === 'Fortis Hospital, Noida' && changed[0]?.newValue === 'Kailash Hospital, Noida',
  'with the correct old → new pair'
);
chk(!changed.some((c) => c.label === 'Residents moved'), 'a still-supported fact is not invented as a change');
chk(!changed.some((c) => c.label === 'Arrests'), 'paraphrase-prone status facts are left to the aligner');
const already = [{ oldId: 'f6', newId: 'g6', label: 'Hospital', oldValue: 'Fortis Hospital, Noida', newValue: 'Kailash Hospital, Noida' }];
reconcileChanges({ changed: already, oldFacts, newFacts, story });
chk(already.length === 1, 'does not duplicate what the aligner already found');
let drifted = [];
reconcileChanges({
  changed: drifted,
  oldFacts: [{ id: 'a', label: 'Collapse time', value: '6.15 am', type: 'time' }],
  newFacts: [{ id: 'b', label: 'Collapse time', value: '6.15 am Tuesday', type: 'time' }],
  story: { headline: 'x', body: 'The stairwell gave way at 6.15 am Tuesday.' },
});
chk(drifted.length === 0, 'rewording is still suppressed by the backstop');

group('format contracts');
chk(FORMAT_IDS.length === 13, 'thirteen formats defined', String(FORMAT_IDS.length));
chk(FORMATS.every((f) => typeof f.validate === 'function'), 'every format has a validator');
chk(FORMATS.every((f) => f.rules({ language: 'Hindi' }).length >= 3), 'every format has hard rules');
const tw = FORMATS.find((f) => f.id === 'twitter');
chk(tw.validate({ blocks: [{ label: 'Post', lines: ['x'.repeat(TWEET_TEXT_MAX + 1)] }] }).length > 0, 'tweet over the ceiling is rejected');
chk(tw.validate({ blocks: [{ label: 'Post', lines: ['x'.repeat(TWEET_TEXT_MAX)] }] }).length === 0, 'tweet at the ceiling is accepted');
const push = FORMATS.find((f) => f.id === 'push');
chk(push.validate({ blocks: [{ label: 'Title', lines: ['x'.repeat(41)] }, { label: 'Body', lines: ['y'] }] }).length > 0, 'push title over 40 is rejected');
const tv = FORMATS.find((f) => f.id === 'tv_script');
chk(tv.validate({ blocks: [{ label: 'Ticker', lines: ['a'] }] }).length >= 3, 'TV script missing parts is rejected');

group('model backend resolution');
// Regression: the server used to trust CLAUDE_CODE_EXECPATH, which only exists
// inside a Claude Code session — so it worked in-session and died with
// "spawn claude ENOENT" for anyone starting it from a normal terminal.
chk(backendReady, 'a model backend is available', backend === 'claude-cli' ? String(cliPath) : backend);
if (backend === 'claude-cli') {
  chk(!!cliPath && fs.existsSync(cliPath), 'resolved claude binary exists on disk', String(cliPath));
  chk(
    cliPath !== 'claude',
    'resolves to an absolute path, never a bare command name that only works on PATH'
  );
}
chk(backendReady ? backendHint === null : typeof backendHint === 'string',
    'an unavailable backend carries an actionable hint');

console.log(`\n${failed ? `${failed} FAILURES` : 'all unit checks pass'}`);
process.exit(failed ? 1 : 0);
