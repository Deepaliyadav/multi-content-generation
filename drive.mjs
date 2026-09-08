import puppeteer from 'puppeteer-core';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',protocolTimeout:900000,args:['--no-sandbox']});
const p=await b.newPage(); await p.setViewport({width:1500,height:1000});
const bodies=[];
p.on('request',r=>{if(r.url().includes('/api/generate')) bodies.push(JSON.parse(r.postData()||'{}'));});
await p.goto('http://localhost:8787/',{waitUntil:'networkidle0'});
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>/Noida/.test(x.textContent))?.click());
await wait(800);
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>/^Clear$/.test(x.textContent.trim()))?.click());
await wait(300);
await p.evaluate(()=>{for(const w of ['Twitter / X post','Article highlights'])
  [...document.querySelectorAll('.chip-toggle, button')].find(x=>x.textContent.trim().endsWith(w))?.click();});
await wait(300);
await p.evaluate(()=>[...document.querySelectorAll('button')].find(x=>/Generate rundown/.test(x.textContent))?.click());
await p.waitForFunction(()=>document.querySelectorAll('.rail-item').length>=2,{timeout:300000});
await wait(2000);
console.log('initial generate only:', JSON.stringify(bodies[0]?.only));

// capture BOTH formats' body text
const read = async () => p.evaluate(()=>{
  const out={};
  for(const it of document.querySelectorAll('.rail-item')){
    const name=it.innerText.split('\n')[0].trim();
    it.click();
    out[name]=null;
  }
  return out;
});
const grab = async (name) => { await p.evaluate((n)=>{[...document.querySelectorAll('.rail-item')].find(x=>x.innerText.includes(n))?.click();},name); await wait(700);
  return p.evaluate(()=>document.querySelector('.content-pane')?.innerText||''); };

const hlBefore = await grab('Article highlights');
const twBefore = await grab('Twitter / X post');

// regenerate ONLY the highlights
await p.evaluate(()=>{[...document.querySelectorAll('.rail-item')].find(x=>x.innerText.includes('Article highlights'))?.click();});
await wait(700);
bodies.length=0;
await p.evaluate(()=>document.querySelector('.btn-regen')?.click());
await p.waitForFunction(()=>document.querySelector('.btn-regen')?.textContent.includes('Regenerate'),{timeout:200000}).catch(()=>{});
await wait(1500);

console.log('\nregenerate request only:', JSON.stringify(bodies[0]?.only), '| steer:', JSON.stringify(bodies[0]?.steer));
console.log('requests fired:', bodies.length);

const hlAfter = await grab('Article highlights');
const twAfter = await grab('Twitter / X post');
console.log('\nhighlights changed:', hlBefore!==hlAfter, '  <- should be true');
console.log('twitter    changed:', twBefore!==twAfter, '  <- should be FALSE');
const strip=t=>t.split('\n').filter(l=>!/^(Copy text|Punchier|Shorter|More formal|Regenerate|Click any|ARTICLE|TWITTER)/.test(l)).join(' ').slice(0,150);
console.log('\nhl before:', strip(hlBefore));
console.log('hl after :', strip(hlAfter));
await b.close();
