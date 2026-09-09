import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const out = [];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 120000 });
try {
  const p = await b.newPage();
  p.on('pageerror', e => out.push('PAGEERROR: ' + String(e).slice(0,160)));
  await p.setViewport({ width: 1600, height: 900 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('lss.theme','dark'); } catch(e){} });
  await p.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));
  out.push('before run: ' + JSON.stringify(await p.evaluate(() => ({
    sweep: document.querySelector('.sweep-line')?.textContent.replace(/\s+/g,' ').trim(),
    ceiling: document.querySelector('.warn-hint')?.textContent.replace(/\s+/g,' ').trim() || null,
  }))));
  // Run a cycle so lastRunAt gets set, then re-read.
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => /Run one now/.test(x.textContent))?.click());
  let got = null;
  for (let i = 0; i < 45 && !got; i++) {
    await new Promise(r => setTimeout(r, 2000));
    got = await p.evaluate(() => {
      const t = document.querySelector('.sweep-line')?.textContent.replace(/\s+/g,' ').trim();
      return t && !/Not swept yet/.test(t) ? t : null;
    });
  }
  out.push('after run : ' + (got || '(lastRunAt never set — cycle may have been skipped by the ceiling)'));
  await p.screenshot({ path: process.argv[2], clip: { x: 240, y: 80, width: 1200, height: 330 } });
} catch (e) { out.push('ERROR ' + String(e.message||e).slice(0,200)); }
await b.close().catch(()=>{});
writeFileSync(process.argv[3], out.join('\n') + '\n');
