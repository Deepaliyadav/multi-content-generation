/**
 * End-to-end acceptance run. Drives the real app in a real browser against the
 * real model — generation, format fidelity, inline editing, approval, the
 * stale-detection loop, targeted patching, and responsive layout.
 *
 *   node server/index.js &        # or: npm start
 *   npm run verify
 *
 * Set CHROME_PATH if Chrome is somewhere unusual. BASE_URL defaults to :8787.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
  process.exit(2);
}
const BASE_URL = process.env.BASE_URL || 'http://localhost:8787/';
const shot = (p, n) => p.screenshot({ path: `/tmp/acc-${n}.png`, fullPage: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = [];
const check = (ok, label, extra = '') => { pass.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 900000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', (e) => console.log('  PAGEERROR', String(e).slice(0, 160)));

await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
await page.evaluate(() => [...document.querySelectorAll('.sample')].find((b) => b.textContent.includes('Noida')).click());
await wait(300);
await page.select('.select', 'Hindi').catch(() => {});
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Generate formats').click());

// Ledger must be visible before any output card exists.
await page.waitForSelector('.fact', { timeout: 300000 });
const preState = await page.evaluate(() => ({ facts: document.querySelectorAll('.fact').length, cards: document.querySelectorAll('.card').length }));
check(preState.facts >= 5 && preState.cards === 0, 'Fact ledger is shown BEFORE any output is generated', `${preState.facts} facts, ${preState.cards} cards`);
await shot(page, '1-ledger-first');

await page.waitForSelector('.tabs', { timeout: 480000 });
await wait(1500);

const gen = await page.evaluate(() => {
  const all = [];
  const tabs = [...document.querySelectorAll('.tab')];
  return { timer: document.querySelector('.metric')?.textContent, tabs: tabs.length };
});
check(/\d+\.\ds/.test(gen.timer || ''), 'Visible generation timer', gen.timer);
check(gen.tabs === 5, 'Five logical groups', `${gen.tabs} tabs`);

// Collect every card across every tab.
const cards = [];
for (let i = 0; i < gen.tabs; i++) {
  await page.evaluate((idx) => document.querySelectorAll('.tab')[idx].click(), i);
  await wait(400);
  cards.push(...await page.evaluate(() => [...document.querySelectorAll('.card')].map((c) => ({
    title: c.querySelector('.card-title')?.textContent,
    blocks: [...c.querySelectorAll('.block-label')].map((b) => b.textContent),
    text: [...c.querySelectorAll('.line')].map((l) => l.textContent).join(' '),
    svg: !!c.querySelector('.visual-wrap svg'),
    warn: !!c.querySelector('.warn'),
    facts: c.querySelectorAll('.fact-chip').length,
  }))));
}
check(cards.length === 13, 'All 13 formats present', `${cards.length}`);
check(cards.every((c) => c.facts > 0), 'Every card shows which facts it used');
check(!cards.some((c) => c.warn), 'No format contract violations', cards.filter((c) => c.warn).map((c) => c.title).join(',') || 'none');

const tv = cards.find((c) => c.title === 'TV script');
check(['Breaking strap', 'Ticker', 'On-screen highlights', 'Anchor script'].every((p) => tv.blocks.includes(p)), 'TV script has 4 distinct labelled parts', tv.blocks.join(' / '));
const photo = cards.find((c) => c.title === 'Photostory');
check(photo.blocks.every((b) => /^Frame \d/.test(b)) && photo.blocks.length >= 5, 'Photostory is sequential frames', `${photo.blocks.length} frames`);
const carousel = cards.find((c) => c.title === 'Insta carousel');
check(carousel.blocks.every((b) => /^Slide \d/.test(b)), 'Carousel is slide-structured, distinct from photostory');
const igCard = cards.find((c) => c.title === 'Infographic');
const reel = cards.find((c) => c.title.includes('Reel'));
check(igCard.svg && reel.svg, 'Infographic and Reel cover are rendered images');
const story = cards.find((c) => c.title === 'Insta story');
const post = cards.find((c) => c.title === 'Insta post');
check(story.text.length < post.text.length, 'Insta story is materially shorter than Insta post', `${story.text.length} vs ${post.text.length} chars`);
// Distinctness: no two text outputs share the same body.
const bodies = cards.filter((c) => !c.svg).map((c) => c.text.replace(/\s+/g, ' ').trim());
check(new Set(bodies).size === bodies.length, 'No two outputs are the same text');

// Inline edit round-trip.
await page.evaluate((idx) => document.querySelectorAll('.tab')[idx].click(), 3);
await wait(400);
const edited = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.querySelector('.card-title').textContent === 'Photostory');
  [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
  return true;
});
await wait(300);
await page.evaluate(() => {
  const ta = document.querySelector('.card-edit');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ta.value.replace(/\n/, '\nEDIT-MARKER-OK\n'));
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await wait(200);
await page.evaluate(() => [...document.querySelectorAll('.card-foot button')].find((b) => b.textContent.trim() === 'Save edit').click());
await wait(500);
const editOk = await page.evaluate(() => document.body.innerText.includes('EDIT-MARKER-OK'));
check(editOk, 'Inline editing saves back into the output');

// Approve everything.
let approved = 0;
for (let i = 0; i < gen.tabs; i++) {
  await page.evaluate((idx) => document.querySelectorAll('.tab')[idx].click(), i);
  await wait(300);
  approved += await page.evaluate(() => {
    const b = [...document.querySelectorAll('.card-foot button')].filter((x) => x.textContent.trim() === 'Approve');
    b.forEach((x) => x.click());
    return b.length;
  });
}
check(approved === 13, 'All 13 can be approved into Published', `${approved}`);

// Narrow correction.
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Edit source story')).click());
await wait(400);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Small correction')).click());
await wait(300);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Update source & re-check')).click());
await page.waitForFunction(() => document.querySelectorAll('.metric').length >= 2, { timeout: 480000 });
await wait(1200);
await shot(page, '2-stale');

const scan = await page.evaluate(() => ({
  banner: document.querySelector('.banner h3')?.textContent,
  detail: document.querySelector('.banner p')?.textContent,
  metric: document.querySelectorAll('.metric')[1]?.textContent,
  // Count only rows carrying an old → new arrow. A dropped fact also gets the
  // .changed class, and an earlier version of this check passed on one of those
  // while the scan had in fact found nothing.
  corrected: document.querySelectorAll('.fact.changed .fact-arrow').length,
}));
check(/\d+ of \d+ formats are now stale/.test(scan.banner || ''), 'Stale verdict banner', scan.banner);
check(/\d+\.\ds/.test(scan.metric || ''), 'Stale-scan timer', scan.metric);
check(scan.corrected >= 1, 'Ledger shows a corrected fact as old → new', `${scan.corrected} corrections`);

const verdicts = [];
for (let i = 0; i < gen.tabs; i++) {
  await page.evaluate((idx) => document.querySelectorAll('.tab')[idx].click(), i);
  await wait(350);
  verdicts.push(...await page.evaluate(() => [...document.querySelectorAll('.card')].map((c) => ({
    title: c.querySelector('.card-title')?.textContent,
    stale: c.classList.contains('stale'),
    lines: c.querySelectorAll('.line.stale-line').length,
    total: c.querySelectorAll('.line').length,
  }))));
}
const staleN = verdicts.filter((v) => v.stale).length;
check(staleN > 0 && staleN < 13, 'Some formats flag stale and some do NOT', `${staleN} stale, clean: ${verdicts.filter((v) => !v.stale).map((v) => v.title).join(', ')}`);
const flaggedLines = verdicts.reduce((n, v) => n + v.lines, 0);
const totalLines = verdicts.reduce((n, v) => n + v.total, 0);
check(flaggedLines < totalLines * 0.35, 'Flagging is line-precise, not blanket', `${flaggedLines} of ${totalLines} lines`);

// Patch one and confirm the diff.
for (let i = 0; i < gen.tabs; i++) {
  await page.evaluate((idx) => document.querySelectorAll('.tab')[idx].click(), i);
  await wait(300);
  const did = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.card.stale')].find((x) => x.querySelector('.line.stale-line'));
    if (!c) return null;
    [...c.querySelectorAll('button')].find((b) => b.textContent.includes('Regenerate this one'))?.click();
    return c.querySelector('.card-title').textContent;
  });
  if (did) {
    await page.waitForFunction(() => !!document.querySelector('.diff'), { timeout: 300000 });
    await wait(1000);
    await shot(page, '3-diff');
    const d = await page.evaluate(() => {
      const el = document.querySelector('.diff');
      const card = el.closest('.card');
      return { fmt: card.querySelector('.card-title').textContent, stale: card.classList.contains('stale'), ins: el.querySelectorAll('ins.d').length, del: el.querySelectorAll('del.d').length };
    });
    check(d.ins > 0 && d.del > 0, 'Before/after diff shows struck-out old and highlighted new', `${d.fmt}: -${d.del} +${d.ins}`);
    check(!d.stale, 'Patched card is no longer flagged stale');
    break;
  }
}

// Responsive.
for (const [w, h, name] of [[1024, 900, 'tablet'], [768, 1000, 'narrow'], [420, 900, 'phone']]) {
  await page.setViewport({ width: w, height: h });
  await wait(700);
  await shot(page, `4-${name}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  check(!overflow, `No horizontal overflow at ${w}px`);
}

await browser.close();
console.log(`\n${pass.filter(Boolean).length}/${pass.length} checks passed`);
process.exit(pass.every(Boolean) ? 0 : 1);
