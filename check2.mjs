import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', protocolTimeout: 300000,
});
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 1000 });
await p.goto('http://localhost:8787', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.sample', { timeout: 30000 });
await p.click('.sample');
await p.evaluate(() => {
  for (const btn of document.querySelectorAll('.chip-toggle')) {
    const l = btn.textContent.replace(/^\s*\d+\s*/, '').trim();
    if (btn.classList.contains('on') && !l.includes('Insta story') && !l.includes('Translation')) btn.click();
  }
});
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Generate rundown')).click());
// Wait for the story pane to actually have a card, not just the rail.
await p.waitForFunction(() => !!document.querySelector('.ig-slide'), { timeout: 300000, polling: 1000 });
await new Promise(r => setTimeout(r, 3000));

console.log('story card + button:', JSON.stringify(await p.evaluate(() => {
  const c = document.querySelector('.ig-slide').getBoundingClientRect();
  const t = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Post to Instagram'))?.getBoundingClientRect();
  return { card: Math.round(c.width)+'x'+Math.round(c.height),
           buttonBottom: t ? Math.round(t.bottom) : null, viewport: window.innerHeight,
           buttonFullyVisible: t ? t.bottom <= window.innerHeight : null,
           compareHere: !!([...document.querySelectorAll('button')].find(b => /Compare with source/.test(b.textContent))) };
})));

await p.click('.ig-slide .preview-btn');
await p.waitForFunction(() => !!document.querySelector('.preview-backdrop img'), { timeout: 60000, polling: 500 });
await new Promise(r => setTimeout(r, 1000));
const before = await p.evaluate(() => ({ h: document.querySelector('.preview-head .pane-label')?.textContent.replace(/\s+/g,' ').trim(), s: (document.querySelector('.preview-backdrop img').src||'').slice(-26) }));
const nav = await p.evaluate(() => ({ arrows: !!document.querySelector('.preview-nav.next'), dots: document.querySelectorAll('.preview-foot .ig-dot').length }));
await p.click('.preview-nav.next');
await new Promise(r => setTimeout(r, 2500));
const after = await p.evaluate(() => ({ h: document.querySelector('.preview-head .pane-label')?.textContent.replace(/\s+/g,' ').trim(), s: (document.querySelector('.preview-backdrop img').src||'').slice(-26) }));
console.log('preview nav:', JSON.stringify({ ...nav, from: before.h, to: after.h, imageChanged: before.s !== after.s }));
await p.screenshot({ path: process.argv[2] });
await b.close();
console.log('DONE');
