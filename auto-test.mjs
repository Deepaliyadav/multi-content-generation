import puppeteer from 'puppeteer-core';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',protocolTimeout:1800000,args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1440,height:900});
const calls=[];
p.on('request',r=>{const u=r.url(); if(u.includes('/api/wire')) calls.push(`${new Date().toISOString().slice(11,19)} wire`);
  if(u.includes('/api/discover')&&!u.includes('brief')) calls.push(`${new Date().toISOString().slice(11,19)} DISCOVER`);});
await p.goto('http://localhost:8787/',{waitUntil:'networkidle0'});
await p.evaluate(()=>[...document.querySelectorAll('.intake-mode')].find(x=>/Find me a story/.test(x.textContent))?.click());
console.log('panel opened, auto armed. waiting 6 minutes for the timer...');
const t0=Date.now();
// poll every 30s and report state
for (let i=0;i<13;i++){
  await wait(30000);
  const st = await p.evaluate(()=>({
    rows: document.querySelectorAll('.sweep-row').length,
    note: [...document.querySelectorAll('.meter')].map(m=>m.textContent).find(t=>/next check|unchanged|Auto-refresh|Clustering|Reading|Searching|Checking/.test(t)) || '',
    running: !!document.querySelector('.btn-primary')?.textContent.includes('Sweeping'),
  }));
  console.log(`${((Date.now()-t0)/1000).toFixed(0).padStart(4)}s rows=${st.rows} running=${st.running} | ${st.note.slice(0,64)}`);
  if (st.rows>0) { console.log('\nAUTO-SWEEP PRODUCED RESULTS'); break; }
}
console.log('\napi calls:\n  ' + (calls.join('\n  ')||'(none)'));
await b.close();
