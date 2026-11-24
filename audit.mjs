import { chromium, devices } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext(devices['iPhone 13']);
const p = await ctx.newPage();
const clean = s => s.replace(/\n{2,}/g,'\n').replace(/[ \t]+/g,' ').trim();
for (const [label,url] of [['DETAIL','https://zenpass.hk/detail.html?id=demo-001'],['BOOKING','https://zenpass.hk/booking.html?id=demo-001']]){
  await p.goto(url,{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
  const t = await p.evaluate(()=>document.body.innerText);
  console.log('\n=== '+label+' ===\n'+clean(t).slice(0,3000));
}
await b.close();
