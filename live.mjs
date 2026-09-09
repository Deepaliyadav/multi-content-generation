import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const out = [];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 120000 });
try {
  const p = await b.newPage();
  p.on('pageerror', e => out.push('PAGEERROR: ' + String(e).slice(0,160)));
  await p.setViewport({ width: 1500, height: 950 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('lss.theme','dark'); } catch(e){} });
  await p.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2200));
  await p.evaluate(() => [...document.querySelectorAll('button,a')].find(x => /New story/i.test(x.textContent))?.click());
  await new Promise(r => setTimeout(r, 1500));
  const read = () => p.evaluate(() => {
    const t = [...document.querySelectorAll('.meter')].map(m => m.textContent.replace(/\s+/g,' ').trim());
    return {
      next: t.find(x => /next check/.test(x)) || null,
      updated: t.find(x => /Updated|Checked/.test(x)) || null,
    };
  });
  const a = await read();
  out.push('t=0s  : ' + JSON.stringify(a));
  // No refresh, no interaction — does it move on its own?
  await new Promise(r => setTimeout(r, 12000));
  const c = await read();
  out.push('t=12s : ' + JSON.stringify(c));
  out.push('countdown ticked without refresh: ' + (a.next !== c.next || /s$/.test(String(c.next))));
  await new Promise(r => setTimeout(r, 12000));
  const d = await read();
  out.push('t=24s : ' + JSON.stringify(d));
  await p.screenshot({ path: process.argv[2], clip: { x: 240, y: 150, width: 1100, height: 260 } });
} catch (e) { out.push('ERROR ' + String(e.message||e).slice(0,200)); }
await b.close().catch(()=>{});
writeFileSync(process.argv[3], out.join('\n') + '\n');
