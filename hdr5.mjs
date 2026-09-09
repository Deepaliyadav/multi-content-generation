import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const out = [];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 300000 });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1728, height: 1000 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('lss.theme','dark'); } catch(e){} });
  await p.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2200));
  const h0 = await p.evaluate(() => Math.round(document.querySelector('.masthead').getBoundingClientRect().height));
  out.push('header before any run: ' + h0 + 'px');
  await p.evaluate(() => [...document.querySelectorAll('button,a')].find(x => /New story/i.test(x.textContent))?.click());
  await new Promise(r => setTimeout(r, 1000));
  await p.evaluate(() => [...document.querySelectorAll('.intake-mode')].find(m => /Write it myself/.test(m.textContent)).click());
  await new Promise(r => setTimeout(r, 800));
  await p.click('.sample');
  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('.chip-toggle')) {
      const l = btn.textContent.replace(/^\s*\d+\s*/, '').trim();
      if (btn.classList.contains('on') && !/Push notification/.test(l)) btn.click();
    }
  });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => /Generate rundown/.test(x.textContent)).click());
  let ok = false;
  for (let i = 0; i < 90 && !ok; i++) { await new Promise(r => setTimeout(r, 2000)); ok = await p.evaluate(() => !!document.querySelector('.metric')); }
  out.push('metrics appeared: ' + ok);
  for (const w of [1728, 1440, 1200, 1024, 900]) {
    await p.setViewport({ width: w, height: 1000 });
    await new Promise(r => setTimeout(r, 450));
    out.push(String(w).padStart(4) + ': ' + JSON.stringify(await p.evaluate(() => {
      const met = document.querySelector('.metric');
      const mr = met ? met.getBoundingClientRect() : null;
      const steps = document.querySelector('.steps')?.getBoundingClientRect();
      const inner = document.querySelector('.masthead-inner');
      return {
        headerH: Math.round(document.querySelector('.masthead').getBoundingClientRect().height),
        metricVisible: !!(mr && mr.width),
        metricH: mr ? Math.round(mr.height) : null,
        metricText: met ? met.textContent.replace(/\s+/g,' ').trim() : null,
        gapToSteps: mr && steps ? Math.round(steps.left - mr.right) : null,
        overflow: inner.scrollWidth > inner.clientWidth + 1,
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    })));
  }
  await p.setViewport({ width: 1728, height: 1000 });
  await new Promise(r => setTimeout(r, 400));
  await p.screenshot({ path: process.argv[2], clip: { x: 0, y: 0, width: 1728, height: 110 } });
} catch (e) { out.push('ERROR ' + String(e.message||e).slice(0,200)); }
await b.close().catch(()=>{});
writeFileSync(process.argv[3], out.join('\n') + '\n');
