import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const log = [];
const say = (...a) => log.push(a.join(' '));
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 300000 });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1000 });
  await p.goto('http://localhost:8787', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.sample', { timeout: 30000 });
  await p.click('.sample');
  await p.select('.select', process.argv[4]);
  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('.chip-toggle')) {
      const l = btn.textContent.replace(/^\s*\d+\s*/, '').trim();
      if (btn.classList.contains('on') && !l.includes('Translation')) btn.click();
    }
  });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.includes('Generate rundown')).click());
  let found = false;
  for (let i = 0; i < 150 && !found; i++) { await new Promise(r => setTimeout(r, 2000)); found = await p.$('.article') !== null; }
  if (!found) throw new Error('article never appeared');
  await new Promise(r => setTimeout(r, 3000));
  say(process.argv[4].toUpperCase(), JSON.stringify(await p.evaluate(() => {
    const a = document.querySelector('.article'), h = a.querySelector('h2'), body = a.querySelector('.body p');
    const f = el => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g,'');
    return { dir: getComputedStyle(a).direction, align: getComputedStyle(a).textAlign,
             headFont: f(h), bodyFont: body ? f(body) : null,
             bodyLeading: body ? getComputedStyle(body).lineHeight : null,
             sample: h.textContent.slice(0, 34) };
  })));
  await p.screenshot({ path: process.argv[2] });
} catch (e) { say('ERROR', String(e.message || e).slice(0,200)); }
await b.close().catch(()=>{});
writeFileSync(process.argv[3], log.join('\n') + '\n');
