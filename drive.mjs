import puppeteer from 'puppeteer-core';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',protocolTimeout:900000,args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1500,height:1000});
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
await p.goto('http://localhost:8787/',{waitUntil:'networkidle0'});

await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>/Noida/.test(x.textContent))?.click());
await wait(800);
// narrow the run to the three Instagram formats
await p.evaluate(()=>{
  [...document.querySelectorAll('button')].find(x=>/^Clear$/.test(x.textContent.trim()))?.click();
});
await wait(400);
const picked = await p.evaluate(()=>{
  const want=['Insta story','Insta post','Insta carousel'];
  const got=[];
  for(const w of want){
    const el=[...document.querySelectorAll('.chip-toggle, button')].find(x=>x.textContent.trim().endsWith(w));
    if(el){el.click();got.push(w);}
  }
  return got;
});
console.log('selected:', picked.join(', '));
await wait(400);
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>/Generate rundown/.test(x.textContent))?.click());
const t=Date.now();
await p.waitForFunction(()=>document.querySelectorAll('.rail-item').length>=3,{timeout:400000}).catch(()=>console.log('gen wait timed out'));
await wait(2500);
console.log('generated in', ((Date.now()-t)/1000).toFixed(1)+'s');

async function inspect(name){
  await p.evaluate((n)=>{
    const it=[...document.querySelectorAll('.rail-item')].find(x=>x.textContent.includes(n));
    it?.click();
  }, name);
  await wait(1200);
  return p.evaluate(()=>{
    const box=document.querySelector('.publish-box');
    const btn=box?[...box.querySelectorAll('button')][0]:null;
    return {
      hasPublishBox: !!box,
      buttonText: btn?btn.textContent.trim().replace(/\s+/g,' '):null,
      boxText: box?box.innerText.replace(/\n/g,' | ').slice(0,150):null,
    };
  });
}
for (const f of ['Insta carousel','Insta story','Insta post']) {
  console.log(`\n${f}:`, JSON.stringify(await inspect(f)));
}
console.log('\njs errors:', errs.length?errs.slice(0,3).join(' | '):'none');
await b.close();
