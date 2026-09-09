import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const out = [];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 120000 });
try {
  const p = await b.newPage();
  p.on('pageerror', e => out.push('PAGEERROR: ' + String(e).slice(0,160)));
  await p.setViewport({ width: 1500, height: 1000 });
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('lss.theme','dark'); } catch(e){} });
  await p.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2500));
  // Pick a rundown that actually finished 13/13.
  const picked = await p.evaluate(() => {
    const card = [...document.querySelectorAll('.rd')].find(c => /13\/13 formats/.test(c.textContent));
    if (!card) return null;
    const h = card.querySelector('h3')?.textContent.slice(0, 40);
    card.click();
    return h;
  });
  out.push('opened: ' + (picked || 'NONE with 13/13'));
  await new Promise(r => setTimeout(r, 4000));
  out.push('pane state: ' + JSON.stringify(await p.evaluate(() => ({
    contentPane: !!document.querySelector('.content-pane'),
    rail: document.querySelectorAll('.rail-item').length,
    paneLabel: document.querySelector('.pane-label')?.textContent.trim(),
    allButtons: [...document.querySelectorAll('.content-pane button')].map(x => x.textContent.trim()).filter(Boolean).slice(0, 10),
  }))));
  const check = async (name) => {
    await p.evaluate((n) => [...document.querySelectorAll('.rail-item')].find(x => x.textContent.includes(n))?.click(), name);
    await new Promise(r => setTimeout(r, 1400));
    return p.evaluate(() => ({
      pane: document.querySelector('.pane-label')?.textContent.trim(),
      approveForInsta: [...document.querySelectorAll('button')].some(x => /Approve for Instagram/.test(x.textContent)),
      postToInstagram: [...document.querySelectorAll('button')].some(x => /Post to Instagram/.test(x.textContent)),
      dispatchBtn: [...document.querySelectorAll('.content-pane button')].map(x => x.textContent.trim()).find(t => /Draft to CMS|Draft a mail|Mark ready|Send /.test(t)) || null,
    }));
  };
  for (const n of ['Insta story', 'Insta post', 'Insta carousel', 'Translation', 'TV script']) {
    out.push(n.padEnd(15) + ': ' + JSON.stringify(await check(n)));
  }
} catch (e) { out.push('ERROR ' + String(e.message||e).slice(0,200)); }
await b.close().catch(()=>{});
writeFileSync(process.argv[2], out.join('\n') + '\n');
