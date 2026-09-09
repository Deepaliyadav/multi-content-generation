import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const out = [];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 300000 });
try {
  const p = await b.newPage();
  p.on('pageerror', e => out.push('PAGEERROR: ' + String(e).slice(0,180)));
  await p.setViewport({ width: 1440, height: 1050 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('lss.theme','dark'); } catch(e){} });
  await p.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2200));
  await p.evaluate(() => [...document.querySelectorAll('button,a')].find(x => /New story/i.test(x.textContent))?.click());
  await new Promise(r => setTimeout(r, 1000));
  await p.evaluate(() => [...document.querySelectorAll('.intake-mode')].find(m => /Write it myself/.test(m.textContent)).click());
  await new Promise(r => setTimeout(r, 800));
  await p.click('.sample');
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => /Generate rundown/.test(x.textContent)).click());
  // Catch the progress list while rows are still running.
  let snap = null;
  for (let i = 0; i < 60 && !snap; i++) {
    await new Promise(r => setTimeout(r, 1500));
    snap = await p.evaluate(() => {
      const running = [...document.querySelectorAll('.prow.running')];
      if (!running.length) return null;
      return {
        runningRows: running.length,
        timeCells: running.slice(0, 3).map(r => r.querySelector('.prow-time')?.textContent.trim()),
        anyDots: [...document.querySelectorAll('.prow-time')].some(t => /·|\.\.\./.test(t.textContent)),
        doneSample: [...document.querySelectorAll('.prow.done .prow-time')].slice(0,2).map(t => t.textContent.trim()),
      };
    });
  }
  out.push(snap ? 'progress: ' + JSON.stringify(snap) : 'no running rows caught');
  if (snap) await p.screenshot({ path: process.argv[2] });
} catch (e) { out.push('ERROR ' + String(e.message||e).slice(0,200)); }
await b.close().catch(()=>{});
writeFileSync(process.argv[3], out.join('\n') + '\n');
