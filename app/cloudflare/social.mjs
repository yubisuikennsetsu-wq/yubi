import {randomBytes} from 'node:crypto';
const one=(e,s,...a)=>e.DB.prepare(s).bind(...a).first();
const run=(e,s,...a)=>e.DB.prepare(s).bind(...a).run();
const list=async(e,s,...a)=>(await e.DB.prepare(s).bind(...a).all()).results;
const meta=async(e,k)=>(await one(e,'SELECT v FROM meta WHERE k=?',k))?.v;
const set=(e,k,v)=>run(e,'INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)',k,String(v));
const event=(e,id,kind,note)=>run(e,'INSERT INTO social_events(job_id,kind,note,created) VALUES(?,?,?,?)',id,kind,note,Date.now());
export const jstDay=t=>new Date(t+9*3600000).toISOString().slice(0,10);
export function slotFor(kind,due,frame=1){return jstDay(due)+':'+kind+(frame>1?':'+String(frame).padStart(2,'0'):'');}
export function validateJob(p,now=Date.now()){
 if(!['feed','story'].includes(p.kind)||!['求人','協力業者','面白'].includes(p.category))throw Error('投稿種別を確認してください');
 const due=Number(p.due),caption=String(p.caption||'').trim();
 if(!Number.isFinite(due)||due<now+60000||due>now+28*86400000)throw Error('予約は1分後から28日後までです');
 const local=new Date(due+9*3600000);
 if(local.getUTCHours()!==(p.kind==='story'?11:16)||local.getUTCMinutes()!==0)throw Error('ストーリーは11時、投稿は16時に設定してください');
 if(caption.length>2100||caption.length<10)throw Error('投稿文は10〜2100文字で設定してください');
 if(/https?:\/\/|ig\.me\/|www\.instagram\.com\/m\//i.test(caption))throw Error('本文には未検証のリンクを使用できません');
 const bytes=Buffer.from(String(p.jpeg||''),'base64');
 if(bytes.length<1000||bytes.length>1500000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error('画像は1.5MB以下のJPEGで設定してください');
 if(p.checked!==true)throw Error('画像と文章の検品が必要です');
 const frame=p.frame===undefined?1:Number(p.frame);
 if(!Number.isInteger(frame)||frame<1||frame>3||(p.kind==='feed'&&frame!==1))throw Error('ストーリーの掲載順は1〜3枚です');
 return {kind:p.kind,category:p.category,due,caption,bytes,frame,hold:p.hold===true,slot:slotFor(p.kind,due,frame)};
}
async function graph(e,path,body){
 let response;
 try{response=await fetch('https://graph.instagram.com/v25.0/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+e.IG_ACCESS_TOKEN,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:body?new URLSearchParams(body):undefined,redirect:'manual',signal:AbortSignal.timeout(20000)});}catch(err){throw Error('Instagramとの通信結果を確認できません: '+String(err.message).replaceAll(e.IG_ACCESS_TOKEN||'__none__','[redacted]').slice(0,180));}
 let d;try{d=await response.json();}catch{throw Error('Instagramから応答を確認できません');}
 if(!response.ok)throw Error(`Instagram接続エラー ${response.status}/${d.error?.code||'unknown'}`);
 return d;
}
async function lease(e,id,now){const r=await run(e,'INSERT INTO social_leases(id,until_at) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET until_at=excluded.until_at WHERE social_leases.until_at<?',id,now+240000,now);return !!r.meta?.changes;}
export async function socialAsset(e,path){
 const m=/^\/social-media\/([a-f0-9]{48})\.jpg$/.exec(path);if(!m)return null;
 const a=await one(e,'SELECT bytes FROM social_assets WHERE id=?',m[1]);
 return a?new Response(Buffer.from(a.bytes),{headers:{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'}}):new Response('Not found',{status:404});
}
export async function socialAction(e,pathname,p={},now=Date.now()){
 if(pathname==='/api/social/status')return {
  mode:await meta(e,'socialMode')||'paused',generation:'prepared-assets-only',
  jobs:await list(e,'SELECT id,slot,kind,category,caption,due,status,asset_id,media_id,permalink,error,created,published FROM social_jobs ORDER BY due,slot LIMIT 150'),
  events:await list(e,'SELECT job_id,kind,note,created FROM social_events ORDER BY created DESC LIMIT 20'),
  lastCheck:await meta(e,'socialLastCheck'),lastInsights:await meta(e,'socialLastInsights'),
  latestAnalysis:await one(e,'SELECT body,created FROM social_snapshots ORDER BY created DESC LIMIT 1')
 };
 if(pathname==='/api/social/mode'){
  if(!['paused','active'].includes(p.mode))throw Error('動作設定を確認してください');
  await set(e,'socialMode',p.mode);await event(e,null,'mode',p.mode==='active'?'予約投稿を再開しました':'予約投稿を一時停止しました');return {ok:true};
 }
 if(pathname==='/api/social/queue'){
  const j=validateJob(p,now);const id=randomBytes(16).toString('hex'),asset=randomBytes(24).toString('hex');
  if(await one(e,'SELECT id FROM social_jobs WHERE slot=?',j.slot))throw Error('この日・種別の投稿はすでに登録済みです');
  if(j.frame>1&&!await one(e,'SELECT id FROM social_jobs WHERE slot=?',slotFor(j.kind,j.due,j.frame-1)))throw Error('先に前の画像を登録してください');
  await e.DB.batch([e.DB.prepare('INSERT INTO social_assets(id,bytes,created) VALUES(?,?,?)').bind(asset,j.bytes,now),e.DB.prepare('INSERT INTO social_jobs(id,slot,kind,category,caption,due,asset_id,created,updated,status) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,j.slot,j.kind,j.category,j.caption,j.due,asset,now,now,j.hold?'draft':'scheduled')]);
  await event(e,id,j.hold?'draft':'queued',j.hold?'確認用の下書きを保存しました（公開保留）':'投稿を予約しました');return {ok:true,id,slot:j.slot};
 }
 if(pathname==='/api/social/edit'){
  const j=validateJob(p,now);if(!await lease(e,'tick',now))throw Error('投稿を確認中です。数分後に操作してください');
  try{const old=await one(e,'SELECT * FROM social_jobs WHERE id=?',String(p.id));if(!old||!['draft','scheduled','ready','processing'].includes(old.status)||old.due-now<3600000)throw Error('公開1時間前までの予約だけ編集できます');
  if(old.slot!==j.slot||old.due!==j.due)throw Error('予約の種類・掲載順・日時は変更できません');const asset=randomBytes(24).toString('hex');
  await e.DB.batch([e.DB.prepare('INSERT INTO social_assets(id,bytes,created) VALUES(?,?,?)').bind(asset,j.bytes,now),e.DB.prepare("UPDATE social_jobs SET caption=?,category=?,asset_id=?,container_id=NULL,status=?,updated=? WHERE id=?").bind(j.caption,j.category,asset,j.hold?'draft':'scheduled',now,old.id)]);
  await event(e,old.id,'edited','スマホから予約内容を更新しました');return {ok:true,id:old.id};
  }finally{await run(e,"DELETE FROM social_leases WHERE id='tick'");}
 }
 if(pathname==='/api/social/cancel'){
  if(!await lease(e,'tick',now))throw Error('投稿を確認中です。数分後にもう一度操作してください');
  try{
  const r=await run(e,"UPDATE social_jobs SET status='cancelled',updated=? WHERE id=? AND status IN ('draft','scheduled','processing','ready','failed')",now,String(p.id));
  if(!r.meta?.changes)throw Error('公開中・公開済みの投稿は取り消せません');
  await event(e,String(p.id),'cancelled','予約を取り消しました');return {ok:true};
  }finally{await run(e,'DELETE FROM social_leases WHERE id=?','tick');}
 }
 if(pathname==='/api/social/preflight'){
  const q=await graph(e,e.IG_ACCOUNT_ID+'/content_publishing_limit?fields=config,quota_usage');return {ok:true,limits:q.data};
 }
 if(pathname==='/api/social/prepare'){
  const j=await one(e,'SELECT * FROM social_jobs WHERE id=?',String(p.id));
  if(!j||j.due<now||j.due>now+23*3600000)throw Error('23時間以内の予約だけ画像登録を確認できます');
  if(!['scheduled','processing'].includes(j.status))return {ok:true,status:j.status};
  if(!await lease(e,'tick',now))throw Error('確認処理中です。数分後に更新してください');
  try{await advance(e,j,now);}finally{await run(e,'DELETE FROM social_leases WHERE id=?','tick');}
  return {ok:true,status:(await one(e,'SELECT status FROM social_jobs WHERE id=?',j.id)).status};
 }
 if(pathname==='/api/social/analyze'){await collectInsights(e,now);return {ok:true};}
 throw Error('操作を確認してください');
}
export async function collectInsights(e,now=Date.now()){
 const id='insights:'+jstDay(now);if(!await lease(e,id,now))return;
 const media=await graph(e,e.IG_ACCOUNT_ID+'/media?fields=id,caption,media_type,timestamp,permalink,like_count,comments_count&limit=12');
 const posts=[];
 for(const m of (media.data||[]).slice(0,12)){
  let reach=null;
  try{const d=await graph(e,m.id+'/insights?metric=reach');reach=d.data?.find(x=>x.name==='reach')?.values?.[0]?.value??null;}catch{}
  posts.push({...m,reach});
 }
 const body=JSON.stringify({checkedAt:now,posts,note:'累計値です。公開条件が異なるため単純比較や応募成果の断定はできません。未取得はゼロではありません。'});
 await run(e,'INSERT OR REPLACE INTO social_snapshots(id,body,created) VALUES(?,?,?)',jstDay(now),body,now);
 await run(e,'DELETE FROM social_snapshots WHERE created<?',now-90*86400000);
 await set(e,'socialLastInsights',now);
}
async function advance(e,j,now){
 const update=async(status,extra={})=>{await run(e,'UPDATE social_jobs SET status=?,container_id=?,media_id=?,permalink=?,error=?,updated=?,published=? WHERE id=?',status,extra.container_id??j.container_id,extra.media_id??j.media_id,extra.permalink??j.permalink,extra.error??null,now,extra.published??j.published,j.id);};
 if(j.status==='scheduled'){
  const r=await run(e,"UPDATE social_jobs SET status='preparing',updated=? WHERE id=? AND status='scheduled'",now,j.id);if(!r.meta?.changes)return;
  try{
   const b={image_url:e.APP_ORIGIN+'/social-media/'+j.asset_id+'.jpg'};
   if(j.kind==='story')b.media_type='STORIES';else b.caption=j.caption;
   const c=await graph(e,e.IG_ACCOUNT_ID+'/media',b);if(!c.id)throw Error('画像の登録結果が不明です');
   await update('processing',{container_id:c.id});
  }catch(err){await update('failed',{error:err.message});await event(e,j.id,'error',err.message);}
  return;
 }
 if(j.status==='processing'){
  const c=await graph(e,j.container_id+'?fields=status_code');
  if(c.status_code==='FINISHED')await update('ready');
  else if(['ERROR','EXPIRED'].includes(c.status_code)){await update('failed',{error:'Instagramで画像を準備できませんでした'});await event(e,j.id,'error','画像の準備に失敗しました');}
  return;
 }
 if(j.status==='ready'&&now>=j.due){
  if(await meta(e,'socialMode')!=='active')return;
  const frame=Number(j.slot.split(':')[2]||1);
  if(j.kind==='story'&&frame>1){const previous=await one(e,'SELECT status FROM social_jobs WHERE slot=?',slotFor('story',j.due,frame-1));if(previous?.status!=='published')return;}
  const claim=await run(e,"UPDATE social_jobs SET status='publishing',updated=? WHERE id=? AND status='ready'",now,j.id);if(!claim.meta?.changes)return;
  try{
   const d=await graph(e,e.IG_ACCOUNT_ID+'/media_publish',{creation_id:j.container_id});if(!d.id)throw Error('公開結果が不明です');
   await update('published',{media_id:d.id,published:now});await event(e,j.id,'published',j.kind==='story'?'ストーリーを公開しました':'投稿を公開しました');
   if(j.kind==='feed'){try{const x=await graph(e,d.id+'?fields=permalink');await run(e,'UPDATE social_jobs SET permalink=? WHERE id=?',x.permalink||null,j.id);}catch{}}
  }catch(err){await update('uncertain',{error:'公開結果を確認できません。重複を避けるため自動再送していません。'});await event(e,j.id,'error','公開結果不明。Instagramでの確認が必要です。');}
 }
}
export async function socialTick(e,date=new Date()){
 const now=date.getTime();if(!await lease(e,'tick',now))return;
 await set(e,'socialLastCheck',now);
 await run(e,"DELETE FROM social_assets WHERE id IN (SELECT asset_id FROM social_jobs WHERE status IN ('published','cancelled','failed') AND updated<?)",now-7*86400000);
 // A crashed POST may have succeeded at Meta. Never retry publication automatically.
 const stale=await list(e,"SELECT id FROM social_jobs WHERE status IN ('preparing','publishing') AND updated<?",now-10*60000);
 for(const j of stale){await run(e,"UPDATE social_jobs SET status='uncertain',error=?,updated=? WHERE id=?",'処理結果を確認できません。自動再送は停止しています。',now,j.id);await event(e,j.id,'error','処理結果の確認が必要です');}
 const expired=await list(e,"SELECT id FROM social_jobs WHERE status IN ('scheduled','processing','ready') AND due<?",now-90*60000);
 for(const j of expired){await run(e,"UPDATE social_jobs SET status='failed',error=?,updated=? WHERE id=?",'予定時刻を90分過ぎたため公開を停止しました',now,j.id);await event(e,j.id,'error','予定時刻内に公開できませんでした');}
 const h=new Date(now+9*3600000).getUTCHours();
 if(h>=9&&h<=19&&jstDay(Number(await meta(e,'socialLastInsights')||0))!==jstDay(now)&&now-Number(await meta(e,'socialInsightsAttempt')||0)>=1800000){
  await set(e,'socialInsightsAttempt',now);
  try{await collectInsights(e,now);}catch{await event(e,null,'error','反応データを取得できませんでした');}
 }
 if(await meta(e,'socialMode')!=='active')return;
 for(const kind of ['story','feed']){
  const deadline=Date.parse(jstDay(now)+'T'+(kind==='story'?'11':'16')+':15:00+09:00');
  if(now>=deadline&&now<deadline+300000&&!await one(e,'SELECT id FROM social_jobs WHERE slot=?',slotFor(kind,now)))await event(e,null,'error',(kind==='story'?'ストーリー':'通常投稿')+'の準備済み素材がありません');
 }
 const jobs=await list(e,"SELECT * FROM social_jobs WHERE status IN ('scheduled','processing','ready') AND due<=? AND due>=? ORDER BY due,slot LIMIT 6",now+30*60000,now-90*60000);
 for(const j of jobs){try{await advance(e,j,now);}catch{await event(e,j.id,'error','Instagramとの接続を確認してください');}}
 await run(e,'DELETE FROM social_events WHERE created<?',now-90*86400000);
}


