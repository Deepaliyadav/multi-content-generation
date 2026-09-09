import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const out = [];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 120000 });
try {
  const p = await b.newPage();
  p.on('pageerror', e => out.push('PAGEERROR: ' + String(e).slice(0,160)));
  await p.setViewport({ width: 1600, height: 1000 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('lss.theme','dark'); } catch(e){} });
  await p.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2800));
  out.push('board filters: ' + JSON.stringify(await p.evaluate(() =>
    [...document.querySelectorAll('.filters button')].map(x => x.textContent.trim()))));
  out.push('draft chip on a card: ' + await p.evaluate(() =>
    [...document.querySelectorAll('.chip.st')].some(c => /Draft/.test(c.textContent))));
  // open a rundown and use the new button
  await p.evaluate(() => {
    const c = [...document.querySelectorAll('.rd')].find(x => !x.classList.contains('rd-generating')) || document.querySelector('.rd');
    c?.click();
  });
  await new Promise(r => setTimeout(r, 3500));
  const before = await p.evaluate(() => [...document.querySelectorAll('button')].find(x => /Move to Draft|In drafts/.test(x.textContent))?.textContent.trim());
  out.push('button before: ' + before);
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => /Move to Draft/.test(x.textContent))?.click());
  await new Promise(r => setTimeout(r, 1800));
  out.push('button after : ' + await p.evaluate(() => [...document.querySelectorAll('button')].find(x => /Move to Draft|In drafts/.test(x.textContent))?.textContent.trim()));
  await p.screenshot({ path: process.argv[2], clip: { x: 300, y: 150, width: 1250, height: 220 } });
  // back to the board, check the Draft filter shows it
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => /← Desk board/.test(x.textContent))?.click());
  await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(() => [...document.querySelectorAll('.filters button')].find(x => /Draft/.test(x.textContent))?.click());
  await new Promise(r => setTimeout(r, 1200));
  out.push('draft filter: ' + JSON.stringify(await p.evaluate(() => ({
    label: [...document.querySelectorAll('.filters button')].find(x => /Draft/.test(x.textContent))?.textContent.trim(),
    cards: document.querySelectorAll('.rd').length,
    allDraft: [...document.querySelectorAll('.rd')].every(c => c.classList.contains('rd-draft')),
  }))));
  await p.screenshot({ path: process.argv[3], clip: { x: 80, y: 100, width: 1450, height: 420 } });
} catch (e) { out.push('ERROR ' + String(e.message||e).slice(0,200)); }
await b.close().catch(()=>{});
writeFileSync(process.argv[4], out.join('\n') + '\n');
