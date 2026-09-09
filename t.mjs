import puppeteer from 'puppeteer-core';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',protocolTimeout:300000,args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:950});
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
await p.goto('http://localhost:8787/',{waitUntil:'networkidle0'});
await p.evaluate(()=>[...document.querySelectorAll('.intake-mode')].find(x=>/Find me a story/.test(x.textContent))?.click());
await wait(1500);
const t = await p.evaluate(()=>({
  hasHint: document.body.innerText.includes('CMS_SEARCH_URL'),
  rows: document.querySelectorAll('.sweep-row').length,
  updated: document.querySelector('.meter.updated')?.textContent,
  markFiled: [...document.querySelectorAll('.sweep-row button')].some(x=>/Mark as filed/.test(x.textContent)),
  panelText: [...document.querySelectorAll('.intake-body .meter')].map(x=>x.textContent.trim()).join(' :: ').slice(0,150),
}));
console.log('hint gone:', !t.hasHint);
console.log('rows still restored:', t.rows);
console.log('updated label:', JSON.stringify(t.updated));
console.log('"Mark as filed" still available:', t.markFiled);
console.log('remaining meters:', t.panelText);
console.log('js errors:', errs.length?errs.slice(0,3).join(' | '):'none');
await b.close();
