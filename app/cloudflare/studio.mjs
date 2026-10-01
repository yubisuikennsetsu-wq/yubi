import {randomBytes} from 'node:crypto';
const first=(e,sql,...p)=>e.DB.prepare(sql).bind(...p).first();
const run=(e,sql,...p)=>e.DB.prepare(sql).bind(...p).run();
const str=(v,n)=>String(v||'').trim().slice(0,n);
export async function studioAction(e,action,p,now=Date.now()){
 if(action==='drafts'){const r=await e.DB.prepare("SELECT v FROM meta WHERE k LIKE 'studio:draft:%' ORDER BY k DESC LIMIT 30").all();return {drafts:r.results.map(x=>JSON.parse(x.v))};}
 if(action==='save'){
  const id=p.id||randomBytes(16).toString('hex');if(!/^[a-f0-9]{32}$/.test(id))throw Error('下書きを確認してください');
  if(!['story','feed'].includes(p.kind)||!['求人','協力業者','面白'].includes(p.category))throw Error('種類を選んでください');
  const d={id,kind:p.kind,category:p.category,headline:str(p.headline,60),caption:str(p.caption,2100),brief:str(p.brief,700),layout:['editorial','photo','split'].includes(p.layout)?p.layout:'editorial',accent:/^#[a-f0-9]{6}$/i.test(p.accent)?p.accent:'#a84633',asset:/^[a-f0-9]{48}$/.test(p.asset)?p.asset:null,date:str(p.date,10),updated:now};
  if(d.asset&&!await first(e,'SELECT id FROM social_assets WHERE id=?',d.asset))throw Error('画像が見つかりません');
  await run(e,'INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)','studio:draft:'+id,JSON.stringify(d));return {draft:d};
 }
 if(action==='generate'){
  if(!e.AI)throw Error('画像制作の接続を準備中です');
  const brief=str(p.brief,700);if(brief.length<4)throw Error('作りたい画像を短く入力してください');
  const key='studio:count:'+new Date(now).toISOString().slice(0,10);
  const count=await first(e,"INSERT INTO meta(k,v) VALUES(?, '1') ON CONFLICT(k) DO UPDATE SET v=CAST(v AS INTEGER)+1 WHERE CAST(v AS INTEGER)<6 RETURNING v",key);
  if(!count)throw Error('今日の画像制作は6回までです。日本時間9時に回数が戻ります');
  let r;try{r=await e.AI.run('@cf/black-forest-labs/flux-1-schnell',{prompt:'Create an original editorial still-life photograph or sophisticated graphic for a Japanese social post. Natural materials, believable lighting, strong single focal point, restrained color, creative composition. No text, letters, logos, watermarks, people, faces or hands. Not a real company project or documented event. The user concept is: '+brief+'. Keep essential subject near center. Do not add any text.',steps:4});}catch{throw Error('画像を作れませんでした。無料枠または接続状況をご確認ください。有料へ自動切替はしません');}
  const bytes=Buffer.from(r.image||'','base64');if(bytes.length<1000||bytes.length>1500000||bytes[0]!==255||bytes[1]!==216)throw Error('画像の形式を確認できませんでした');
  const asset=randomBytes(24).toString('hex');await run(e,'INSERT INTO social_assets(id,bytes,created) VALUES(?,?,?)',asset,bytes,now);return {asset,remaining:6-Number(count.v)};
 }
 throw Error('制作操作を確認してください');
}
