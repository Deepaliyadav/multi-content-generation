/**
 * Build the shareable per-format prompt reference.
 *
 * Reads the live format contracts so the page can never drift from what the
 * model is actually sent. Re-run after editing server/formats.js.
 *
 *   npm run prompts:formats
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, GROUPS, TWEET_TEXT_MAX } from '../server/formats.js';
import { GROUNDING, generateSystem } from '../server/prompts.js';
import { grabTemplate } from './lib/grab-template.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(root, 'FORMAT-PROMPTS.html');

// The art-direction prompts are module-private, so they are read from source.
const ART = fs.readFileSync(path.join(root, 'server', 'artdirector.js'), 'utf8');
const artSystem = grabTemplate(ART, 'You are a creative director specializing');
const artUser = grabTemplate(ART, 'Given an article summary and');
const guardrail = ART.slice(ART.indexOf('const GUARDRAIL ='), ART.indexOf(';', ART.indexOf('const GUARDRAIL =')))
  .split('=')[1].split('+').map((x) => x.trim().replace(/^'|'$/g, '')).join('');

/** Which formats get generated imagery, and at what frame. */
const IMAGERY = [
  ['Reel script + cover', '9:16', 'One cover image, directed from the kicker, headline and standfirst.'],
  ['Insta carousel', '1:1', 'One image per slide, directed from that slide\'s own copy.'],
  ['Insta post', '1:1', 'One image, directed from the hook and caption.'],
  ['Insta story', '9:16', 'One image per card.'],
  ['Photostory', '4:3', 'One landscape plate per frame — the reportage ratio, not a social square.'],
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const groupLabel = Object.fromEntries(GROUPS.map((g) => [g.id, g.label]));
const byGroup = GROUPS.map((g) => ({ ...g, formats: FORMATS.filter((f) => f.group === g.id) }));

let n = 0;
const card = (f) => {
  n += 1;
  const rules = f.rules({ language: '<selected language>' });
  return `
<article class="fmt" id="${f.id}">
  <header class="fmt-head">
    <span class="fmt-n">${String(n).padStart(2, '0')}</span>
    <div class="fmt-id">
      <h3>${esc(f.label)}</h3>
      <p class="fmt-blurb">${esc(f.blurb)}</p>
    </div>
    <div class="fmt-tags">
      <span class="tag">${esc(f.id)}</span>
      <span class="tag quiet">${rules.length} rules</span>
      <span class="tag quiet">${f.maxTokens} max tokens</span>
    </div>
  </header>

  <h4 class="lbl lbl-red">Hard rules <span class="lbl-note">sent verbatim, numbered</span></h4>
  <ol class="rules">${rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>

  <h4 class="lbl">Required structure</h4>
  <pre class="code">${esc(f.blockContract)}</pre>
  ${f.visualContract ? `<h4 class="lbl lbl-gold">Visual spec <span class="lbl-note">returned alongside the text</span></h4>
  <pre class="code">${esc(`"${f.visualContract.replace(/^"/, '')}`)}</pre>` : ''}
</article>`;
};

const html = `<title>Rundown Format Prompts</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  /* Dark-first: this documents a dark newsroom tool, so :root is the dark set
     and the light theme is the override, applied consistently in both
     directions so an explicit choice always beats the OS preference. */
  :root {
    --bg:#14171B; --panel:#1B1F24; --sunken:#0F1215; --raised:#232830;
    --line:#333A40; --line-soft:#272D33;
    --text:#ECEAE3; --dim:#9AA1A8; --faint:#5C646C;
    --red:#E14B36; --teal:#4FA8A0; --gold:#D9A441;
    --serif:'Newsreader',Georgia,'Times New Roman',serif;
    --sans:'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    --mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --bg:#F5F4F1; --panel:#FFFFFF; --sunken:#EFEEEA; --raised:#FFFFFF;
      --line:#D8D5CE; --line-soft:#E6E3DC;
      --text:#1A1D21; --dim:#5A6169; --faint:#8A9098;
      --red:#C43B27; --teal:#2F7C75; --gold:#9A6F16;
    }
  }
  :root[data-theme="light"] {
    --bg:#F5F4F1; --panel:#FFFFFF; --sunken:#EFEEEA; --raised:#FFFFFF;
    --line:#D8D5CE; --line-soft:#E6E3DC;
    --text:#1A1D21; --dim:#5A6169; --faint:#8A9098;
    --red:#C43B27; --teal:#2F7C75; --gold:#9A6F16;
  }

  body { background:var(--bg); color:var(--text); font-family:var(--sans); line-height:1.55; }
  .wrap { max-width:960px; margin:0 auto; padding:40px 24px 80px; }

  .masthead { border-bottom:2px solid var(--text); padding-bottom:18px; margin-bottom:8px; }
  .eyebrow { font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--red); margin:0 0 10px; }
  h1 { font-family:var(--serif); font-size:clamp(30px,5vw,46px); font-weight:600; line-height:1.08; margin:0 0 10px; text-wrap:balance; }
  .lede { font-family:var(--serif); font-size:18px; color:var(--dim); max-width:62ch; margin:0; }

  .facts { display:flex; flex-wrap:wrap; gap:0; border-bottom:1px solid var(--line); margin-bottom:34px; }
  .fact { padding:12px 22px 12px 0; margin-right:22px; border-right:1px solid var(--line-soft); }
  .fact:last-child { border-right:0; }
  .fact b { display:block; font-family:var(--mono); font-size:20px; color:var(--gold); font-variant-numeric:tabular-nums; }
  .fact span { font-family:var(--mono); font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--faint); }

  section { margin-bottom:38px; }
  h2 { font-family:var(--serif); font-size:26px; font-weight:600; margin:0 0 4px; }
  .sec-note { color:var(--dim); font-size:14px; margin:0 0 18px; max-width:64ch; }

  .note { border-left:3px solid var(--red); background:var(--panel); padding:14px 18px; margin:0 0 26px; }
  .note h3 { font-family:var(--sans); font-size:14px; font-weight:600; margin:0 0 6px; }
  .note p { margin:0; font-size:14px; color:var(--dim); max-width:66ch; }
  .note code, .inline { font-family:var(--mono); font-size:12.5px; background:var(--sunken); padding:1px 5px; border-radius:2px; color:var(--text); }

  .shared { background:var(--panel); border:1px solid var(--line-soft); padding:20px 22px; }
  .shared h3 { font-family:var(--sans); font-size:13px; font-weight:600; letter-spacing:.02em; margin:0 0 4px; }
  .shared p.k { color:var(--faint); font-size:13px; margin:0 0 14px; max-width:66ch; }

  .grp { font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--teal);
         border-top:1px solid var(--line); padding-top:10px; margin:34px 0 16px; }

  .fmt { background:var(--panel); border:1px solid var(--line-soft); padding:20px 22px 22px; margin-bottom:14px; }
  .fmt-head { display:grid; grid-template-columns:auto 1fr auto; gap:14px; align-items:start; margin-bottom:16px; }
  .fmt-n { font-family:var(--mono); font-size:13px; color:var(--gold); padding-top:5px; font-variant-numeric:tabular-nums; }
  .fmt-id h3 { font-family:var(--serif); font-size:22px; font-weight:600; margin:0; line-height:1.2; }
  .fmt-blurb { color:var(--dim); font-size:13.5px; margin:2px 0 0; }
  .fmt-tags { display:flex; flex-wrap:wrap; gap:5px; justify-content:flex-end; }
  .tag { font-family:var(--mono); font-size:10.5px; color:var(--teal); border:1px solid var(--line); border-radius:2px; padding:2px 7px; white-space:nowrap; }
  .tag.quiet { color:var(--faint); }

  .lbl { font-family:var(--mono); font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--faint);
         margin:18px 0 8px; font-weight:500; }
  .lbl-red { color:var(--red); }
  .lbl-gold { color:var(--gold); }
  .lbl-note { color:var(--faint); letter-spacing:.04em; text-transform:none; font-size:10.5px; }

  ol.rules { margin:0; padding-left:0; list-style:none; counter-reset:r; }
  ol.rules li { counter-increment:r; position:relative; padding:6px 0 6px 30px; font-size:14.5px;
                border-bottom:1px solid var(--line-soft); }
  ol.rules li:last-child { border-bottom:0; }
  ol.rules li::before { content:counter(r); position:absolute; left:0; top:6px;
                        font-family:var(--mono); font-size:11.5px; color:var(--faint); font-variant-numeric:tabular-nums; }

  pre.code { font-family:var(--mono); font-size:12.5px; line-height:1.6; background:var(--sunken);
             border:1px solid var(--line-soft); padding:12px 14px; margin:0; overflow-x:auto;
             white-space:pre-wrap; word-break:break-word; color:var(--text); }

  footer { border-top:1px solid var(--line); margin-top:40px; padding-top:18px; color:var(--faint); font-size:13px; }
  footer code { font-family:var(--mono); font-size:12.5px; color:var(--dim); }
  a { color:var(--teal); }
  .tbl { width:100%; border-collapse:collapse; font-size:13.5px; margin-bottom:4px; }
  .tbl th { text-align:left; font-family:var(--mono); font-size:10.5px; letter-spacing:.1em;
            text-transform:uppercase; color:var(--faint); font-weight:500;
            border-bottom:1px solid var(--line); padding:6px 12px 6px 0; }
  .tbl td { padding:8px 12px 8px 0; border-bottom:1px solid var(--line-soft); vertical-align:top; color:var(--dim); }
  .tbl td:first-child { color:var(--text); font-weight:500; white-space:nowrap; }

  /* Print / Save as PDF: force the light set, drop the panel fills, and never
     split a format across two pages. */
  @media print {
    :root {
      --bg:#FFFFFF; --panel:#FFFFFF; --sunken:#F5F4F1; --raised:#FFFFFF;
      --line:#BBB6AC; --line-soft:#DDD9D1;
      --text:#000000; --dim:#333333; --faint:#666666;
      --red:#A8321F; --teal:#20635C; --gold:#7A5610;
    }
    .wrap { max-width:none; padding:0; }
    .fmt, .shared, .note { break-inside:avoid; page-break-inside:avoid; border:1px solid var(--line-soft); }
    .fmt { margin-bottom:10px; }
    .grp { break-after:avoid; page-break-after:avoid; }
    h2, h3, h4 { break-after:avoid; page-break-after:avoid; }
    pre.code { white-space:pre-wrap; word-break:break-word; background:#F5F4F1; }
    a { color:#000; text-decoration:none; }
    @page { margin:14mm; }
  }

  @media (max-width:640px) {
    .fmt-head { grid-template-columns:auto 1fr; }
    .fmt-tags { grid-column:1/-1; justify-content:flex-start; }
  }
</style>

<div class="wrap">
  <div class="masthead">
    <p class="eyebrow">Rundown · content generation</p>
    <h1>The thirteen format prompts</h1>
    <p class="lede">Every format is generated by its own prompt. This is what each one is actually sent — the shared grounding contract, then that format's hard rules and required output shape.</p>
  </div>

  <div class="facts">
    <div class="fact"><b>13</b><span>formats</span></div>
    <div class="fact"><b>${FORMATS.reduce((a, f) => a + f.rules({ language: 'x' }).length, 0)}</b><span>hard rules</span></div>
    <div class="fact"><b>${FORMATS.filter((f) => f.visualContract).length}</b><span>with a visual spec</span></div>
    <div class="fact"><b>1</b><span>shared grounding contract</span></div>
  </div>

  <div class="note">
    <h3>Editing a rule? Change its validator too.</h3>
    <p>Every format is checked in code after generation, and the validators repeat the same numbers the rules state — <span class="inline">5–7 slides</span>, <span class="inline">40 characters</span>, <span class="inline">3–5 stats</span>. Change a rule in <span class="inline">server/formats.js</span> without changing the <span class="inline">validate</span> function beside it and the output will be rejected and sent back for an unnecessary repair round. Both live in the same object, a few lines apart.</p>
  </div>

  <section>
    <h2>What every format prompt carries</h2>
    <p class="sec-note">This preamble is prepended to all thirteen. The per-format rules below are appended to it, along with the fact ledger and the source story.</p>
    <div class="shared">
      <h3>Grounding contract</h3>
      <p class="k">The rule that makes the ledger enforceable. Shared with the diff and patch prompts too.</p>
      <pre class="code">${esc(GROUNDING)}</pre>
      <h3 style="margin-top:18px">Generation system prompt</h3>
      <p class="k">Appended to the grounding contract for generation calls only.</p>
      <pre class="code">${esc(generateSystem().replace(GROUNDING, '').trim())}</pre>
    </div>
  </section>

  ${byGroup
    .map(
      (g) => `<p class="grp">${esc(g.label)} — ${g.formats.length} format${g.formats.length > 1 ? 's' : ''}</p>
  ${g.formats.map(card).join('\n')}`
    )
    .join('\n')}

  <section>
    <p class="grp">Imagery — how the pictures get their prompts</p>
    <p class="sec-note">Five of the thirteen formats carry generated images. The image model is never handed the story directly: a creative-director call turns each slide's own copy into a photographic brief, then that brief is rendered. Headlines and figures are drawn over the picture in code afterwards, so the words stay exact even though the picture is generated.</p>

    <div class="fmt">
      <h4 class="lbl">Which formats get images</h4>
      <table class="tbl">
        <thead><tr><th>Format</th><th>Frame</th><th>How many</th></tr></thead>
        <tbody>${IMAGERY.map(([f, a, n]) => `<tr><td>${esc(f)}</td><td><span class="tag">${esc(a)}</span></td><td>${esc(n)}</td></tr>`).join('')}</tbody>
      </table>

      <h4 class="lbl">Art director — system prompt</h4>
      <pre class="code">${esc(artSystem)}</pre>

      <h4 class="lbl lbl-red">Art director — the brief <span class="lbl-note">one call per format, writes one prompt per slide</span></h4>
      <pre class="code">${esc(artUser)}</pre>

      <h4 class="lbl lbl-gold">Guardrail <span class="lbl-note">appended verbatim to whatever the director writes</span></h4>
      <pre class="code">${esc(guardrail)}</pre>
    </div>
  </section>

  <footer>
    <p>All rules read verbatim from <code>server/formats.js</code>. Regenerate this page with <code>npm run prompts:formats</code> after any edit. The Twitter ceiling is derived, not typed: <code>280 − 23 for the link = ${TWEET_TEXT_MAX}</code>.</p>
    <p>Prompts outside generation — fact extraction, ledger diffing, targeted patching, story discovery, image art direction — are in <code>PROMPTS.md</code> via <code>npm run prompts:dump</code>.</p>
  </footer>
</div>`;

fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)}KB) — ${FORMATS.length} formats`);
