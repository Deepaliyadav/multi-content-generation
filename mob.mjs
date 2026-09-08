import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', protocolTimeout: 300000,
});
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await p.goto('http://localhost:8787', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.sample', { timeout: 30000 });

const overflow = () => p.evaluate(() => {
  const de = document.documentElement;
  const wide = [...document.querySelectorAll('body *')]
    .filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
    .map(el => (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName))
    .slice(0, 6);
  return { pageScrollsSideways: de.scrollWidth > de.clientWidth, docW: de.scrollWidth, viewport: window.innerWidth, offenders: [...new Set(wide)] };
});

console.log('COMPOSE  ', JSON.stringify(await overflow()));
await p.screenshot({ path: process.argv[2] });

await p.click('.sample');
await p.evaluate(() => {
  for (const btn of document.querySelectorAll('.chip-toggle')) {
    const l = btn.textContent.replace(/^\s*\d+\s*/, '').trim();
    // Push + TV script: no image calls, so this is a fast review screen.
    if (btn.classList.contains('on') && !l.includes('Push notification') && !l.includes('TV script')) btn.click();
  }
});
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Generate rundown')).click());
await p.waitForFunction(() => !!document.querySelector('.content-pane .phone, .script-table, .block'), { timeout: 300000, polling: 1000 });
await new Promise(r => setTimeout(r, 2500));

console.log('REVIEW   ', JSON.stringify(await overflow()));
console.log('rail     ', JSON.stringify(await p.evaluate(() => {
  const r = document.querySelector('.format-rail');
  const cs = getComputedStyle(r);
  return { horizontal: cs.display === 'flex', scrollsX: r.scrollWidth > r.clientWidth, height: Math.round(r.getBoundingClientRect().height) };
})));
await p.screenshot({ path: process.argv[3] });

await p.evaluate(() => [...document.querySelectorAll('.rail-item')].find(b => b.textContent.includes('TV script'))?.click());
await new Promise(r => setTimeout(r, 1500));
console.log('TV pane  ', JSON.stringify(await overflow()));
console.log('script   ', JSON.stringify(await p.evaluate(() => {
  const td = document.querySelector('.script-table td');
  return { stacked: getComputedStyle(td).display === 'block', rows: document.querySelectorAll('.script-table tr').length };
})));
await p.screenshot({ path: process.argv[4] });
await b.close();
console.log('DONE');
