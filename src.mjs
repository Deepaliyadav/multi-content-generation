import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const out = [];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 300000 });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 1050 });
  await p.goto('http://localhost:8787', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.sample', { timeout: 30000 });
  await p.click('.sample');
  const srcHead = await p.evaluate(() => document.querySelector('.input').value.slice(0, 40));
  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('.chip-toggle')) {
      const l = btn.textContent.replace(/^\s*\d+\s*/, '').trim();
      if (btn.classList.contains('on') && !l.includes('Translation')) btn.click();
    }
  });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.includes('Generate rundown')).click());
  let ok = false;
  for (let i = 0; i < 150 && !ok; i++) { await new Promise(r => setTimeout(r, 2000)); ok = await p.$('.article') !== null; }
  if (!ok) throw new Error('no article');
  await new Promise(r => setTimeout(r, 2500));

  const tabs = () => p.evaluate(() => [...document.querySelectorAll('.ver-tab')].map(t => t.textContent.trim() + (t.classList.contains('on') ? '*' : '')));
  const view = () => p.evaluate(() => {
    const a = document.querySelector('.article'), h = a.querySelector('h2');
    return { kicker: a.querySelector('.kicker')?.textContent, head: h.textContent.slice(0, 40),
             editable: h.isContentEditable, cls: a.className.trim(),
             lang: document.querySelector('.lang-select')?.value };
  });
  out.push('source headline in composer: ' + srcHead);
  out.push('tabs after run: ' + JSON.stringify(await tabs()));
  out.push('showing:        ' + JSON.stringify(await view()));

  await p.evaluate(() => document.querySelectorAll('.ver-tab')[0].click());
  await new Promise(r => setTimeout(r, 900));
  out.push('after Source:   ' + JSON.stringify(await tabs()));
  out.push('showing:        ' + JSON.stringify(await view()));
  await p.screenshot({ path: process.argv[2] });
} catch (e) { out.push('ERROR ' + String(e.message||e).slice(0,180)); }
await b.close().catch(()=>{});
writeFileSync(process.argv[3], out.join('\n') + '\n');
