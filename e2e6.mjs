import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
const dl = process.argv[3];
await p._client().send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }).catch(()=>{});
const cdp = await p.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
p.on('pageerror', e => console.log('PAGE ERROR:', String(e).slice(0,180)));
await p.goto('http://localhost:8787', { waitUntil: 'networkidle2' });
await p.waitForSelector('.sample', { timeout: 20000 });
await p.click('.sample');
await p.evaluate(() => {
  for (const btn of document.querySelectorAll('.chip-toggle')) {
    const label = btn.textContent.replace(/^\s*\d+\s*/, '').trim();
    if (btn.classList.contains('on') && !label.includes('TV script')) btn.click();
  }
});
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Generate rundown')).click());
await p.waitForSelector('.format-rail', { timeout: 200000 });
await new Promise(r => setTimeout(r, 3000));
await p.evaluate(() => [...document.querySelectorAll('.rail-item')].find(b => b.textContent.includes('TV script'))?.click());
await new Promise(r => setTimeout(r, 1500));

// Is the read block above the script table?
const order = await p.evaluate(() => {
  const read = document.querySelector('.anchor-read');
  const table = document.querySelector('.script-table');
  const play = document.querySelector('.anchor-play');
  return {
    readAboveTable: !!(read && table) && (read.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) > 0,
    playClasses: play?.className,
    playText: play?.textContent.trim(),
    playBg: getComputedStyle(play).backgroundColor,
    buttons: [...document.querySelectorAll('.anchor-row button')].map(b => b.textContent.trim()),
  };
});
console.log(JSON.stringify(order, null, 1));

console.log('clicking download…');
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Download mp3')).click());
await new Promise(r => setTimeout(r, 12000));
await p.screenshot({ path: process.argv[2] });
await b.close();
