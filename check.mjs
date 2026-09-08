import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  protocolTimeout: 300000,   // generations are slow; the default 180s was the killer
});
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGE ERROR:', String(e).slice(0,180)));
await p.setViewport({ width: 1500, height: 1000 });
await p.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
await p.waitForSelector('.sample', { timeout: 30000 });
await p.click('.sample');
// Only Insta story + Translation: the smallest set that exercises all three changes.
await p.evaluate(() => {
  for (const btn of document.querySelectorAll('.chip-toggle')) {
    const l = btn.textContent.replace(/^\s*\d+\s*/, '').trim();
    if (btn.classList.contains('on') && !l.includes('Insta story') && !l.includes('Translation')) btn.click();
  }
});
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Generate rundown')).click());
await p.waitForSelector('.format-rail', { timeout: 300000 });
await new Promise(r => setTimeout(r, 5000));

const open = async (n) => { await p.evaluate((x) => [...document.querySelectorAll('.rail-item')].find(b => b.textContent.includes(x))?.click(), n); await new Promise(r => setTimeout(r, 1500)); };

await open('Insta story');
console.log('1) story card + publish button');
console.log('  ', JSON.stringify(await p.evaluate(() => {
  const c = document.querySelector('.ig-slide').getBoundingClientRect();
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Post to Instagram'));
  const t = btn.getBoundingClientRect();
  return { card: Math.round(c.width)+'x'+Math.round(c.height), ratio: (c.height/c.width).toFixed(2),
           buttonBottom: Math.round(t.bottom), viewport: window.innerHeight, buttonFullyVisible: t.bottom <= window.innerHeight };
})));

console.log('2) preview navigation');
await p.click('.ig-slide .preview-btn');
await p.waitForSelector('.preview-backdrop img', { timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));
const s1 = await p.evaluate(() => (document.querySelector('.preview-backdrop img')?.src||'').slice(-26));
const h1 = await p.evaluate(() => document.querySelector('.preview-head .pane-label')?.textContent.replace(/\s+/g,' ').trim());
const nav = await p.evaluate(() => ({ arrows: !!document.querySelector('.preview-nav.next'), dots: document.querySelectorAll('.preview-foot .ig-dot').length }));
await p.click('.preview-nav.next');
await new Promise(r => setTimeout(r, 2000));
const s2 = await p.evaluate(() => (document.querySelector('.preview-backdrop img')?.src||'').slice(-26));
const h2 = await p.evaluate(() => document.querySelector('.preview-head .pane-label')?.textContent.replace(/\s+/g,' ').trim());
console.log('  ', JSON.stringify({ ...nav, from: h1, to: h2, imageChanged: s1 !== s2 && !!s2 }));
await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
await new Promise(r => setTimeout(r, 400));

console.log('3) compare-with-source scoping');
for (const n of ['Insta story', 'Translation']) {
  await open(n);
  console.log(`   ${n.padEnd(12)}:`, await p.evaluate(() => !!([...document.querySelectorAll('button')].find(b => /Compare with source/.test(b.textContent)))));
}
await open('Insta story');
await p.screenshot({ path: process.argv[2] });
await b.close();
console.log('DONE');
