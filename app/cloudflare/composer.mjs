import puppeteer from '@cloudflare/puppeteer';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function composition(p,kind,category,image){
 const story=kind==='story',h=story?1920:1350,top=story?200:70,foot=story?300:170;
 const layouts={editorial:`.visual{left:70px;right:70px;top:${top+390}px;bottom:${foot+80}px}h1{left:70px;right:70px;top:${top+80}px;font-size:78px}`,split:`.visual{left:430px;right:70px;top:${top+95}px;bottom:${foot+80}px}h1{left:70px;width:310px;top:${top+130}px;font-size:64px}`,photo:`.visual{inset:0}.headline{position:absolute;top:${top+50}px;left:50px;width:980px;height:350px;background:rgba(250,248,242,.96)}h1{left:80px;right:80px;top:${top+90}px;font-size:74px}.footer{background:rgba(250,248,242,.96);padding:28px;left:50px!important;right:50px;bottom:${foot-60}px!important}.kicker{background:#faf8f2;padding:10px}`};
 const cta=category==='面白'?'株式会社 指吸建設':'プロフィール → メッセージ';
 return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:1080px;height:${h}px;overflow:hidden;background:#faf8f2;color:#171717;font-family:'Noto Sans CJK JP','Noto Sans JP',sans-serif}.visual{position:absolute;object-fit:cover}h1{position:absolute;margin:0;line-height:1.3;font-weight:800;white-space:pre-line;overflow-wrap:anywhere}.kicker{position:absolute;left:70px;top:${top}px;font-size:28px;letter-spacing:3px}.footer{position:absolute;left:70px;bottom:${foot-90}px}.footer b{font-size:36px}.footer p{font-size:27px;margin:20px 0 0}.accent{position:absolute;left:70px;top:${top+55}px;background:${p.accent};width:85px;height:8px}${layouts[p.layout]||layouts.editorial}</style><img class="visual" src="data:image/jpeg;base64,${image}"><div class="headline"></div><div class="kicker">${category==='求人'?'土木・造成・外構｜仲間募集':category==='協力業者'?'協力業者・一人親方の皆さまへ':'YUBISUI / BREAK TIME'}</div><div class="accent"></div><h1>${escape(p.headline)}</h1><div class="footer"><b>${cta}</b><p>${category==='面白'?'@yubisui_kensetsu':`「${category}」と一言でOK`}</p>${category==='面白'?'':'<p>株式会社 指吸建設　@yubisui_kensetsu</p>'}</div></html>`;
}
export async function renderComposition(e,p,kind,category,bytes){
 const browser=await puppeteer.launch(e.BROWSER);const timer=setTimeout(()=>browser.close().catch(()=>{}),45000);
 try{const page=await browser.newPage();await page.setViewport({width:1080,height:kind==='story'?1920:1350,deviceScaleFactor:1});
 await page.setContent(composition(p,kind,category,Buffer.from(bytes).toString('base64')),{waitUntil:'load',timeout:20000});
 const geometry=await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(x=>x.decode()));const a=document.querySelector('h1').getBoundingClientRect(),b=document.querySelector('.visual').getBoundingClientRect(),f=document.querySelector('.footer').getBoundingClientRect();return {a:{x:a.x,right:a.right,bottom:a.bottom},b:{x:b.x,y:b.y},f:{y:f.y},text:document.querySelector('h1').textContent};});
 if(geometry.a.right>1020||geometry.a.bottom>geometry.f.y-25||(p.layout==='editorial'&&geometry.a.bottom>geometry.b.y-20))throw Error('文字が画像の安全範囲に収まりません');
 const jpeg=await page.screenshot({type:'jpeg',quality:88});if(jpeg.length>1500000)throw Error('画像容量が大きすぎます');return jpeg;
 }finally{clearTimeout(timer);await browser.close();}
}
