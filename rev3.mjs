import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const out = [];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 300000 });
try {
  const p = await b.newPage();
  p.on('pageerror', e => out.push('PAGEERROR: ' + String(e).slice(0,200)));
  await p.setViewport({ width: 1440, height: 1100 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('lss.theme','dark'); } catch(e){} });
  await p.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2200));
  await p.evaluate(() => [...document.querySelectorAll('button,a')].find(x => /New story/i.test(x.textContent))?.click());
  await new Promise(r => setTimeout(r, 1200));
  await p.evaluate(() => [...document.querySelectorAll('.intake-mode')].find(m => /Write it myself/.test(m.textContent))?.click());
  await new Promise(r => setTimeout(r, 800));
  await p.click('.sample');
  await p.evaluate(() => {
    for (const btn of document.querySelectorAll('.chip-toggle')) {
      const l = btn.textContent.replace(/^\s*\d+\s*/, '').trim();
      if (btn.classList.contains('on') && !/TV script|Twitter/.test(l)) btn.click();
    }
  });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => /Generate rundown/.test(x.textContent)).click());
  let ok = false;
  for (let i = 0; i < 120 && !ok; i++) { await new Promise(r => setTimeout(r, 2000)); ok = await p.$('.script-table, .block') !== null; }
  if (!ok) throw new Error('no output produced');
  await new Promise(r => setTimeout(r, 2500));
  out.push('review dark: ' + JSON.stringify(await p.evaluate(() => {
    const de = document.documentElement;
    return { theme: de.getAttribute('data-theme'),
             steps: [...document.querySelectorAll('.step')].map(s => s.textContent.trim() + (s.classList.contains('on') ? '*' : '')),
             railItems: document.querySelectorAll('.rail-item').length,
             approveBtn: !!([...document.querySelectorAll('button')].find(x => /Approve/.test(x.textContent))),
             voiceRow: !!document.querySelector('.anchor-row'),
             gridRadius: getComputedStyle(document.querySelector('.output-grid')).borderRadius,
             font: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/["']/g,''),
             sideways: de.scrollWidth > de.clientWidth };
  })));
  await p.screenshot({ path: process.argv[2] });
  await p.evaluate(() => document.querySelectorAll('.theme-toggle button')[0].click());
  await new Promise(r => setTimeout(r, 900));
  out.push('review light bg: ' + await p.evaluate(() => getComputedStyle(document.body).backgroundColor));
  await p.screenshot({ path: process.argv[3] });
} catch (e) { out.push('ERROR ' + String(e.message||e).slice(0,200)); }
await b.close().catch(()=>{});
writeFileSync(process.argv[4], out.join('\n') + '\n');
