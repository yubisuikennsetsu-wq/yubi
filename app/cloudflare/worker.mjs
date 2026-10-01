import {randomBytes,createHash,createHmac,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {classify,inWindow,hourKey,validPushEndpoint} from '../logic.mjs';
import {socialAsset,socialAction,socialTick} from './social.mjs';
import {studioAction} from './studio.mjs';
import {autopilotAction,autopilotTick} from './autopilot.mjs';
import {eyeIngest,eyeTick,eyeAlerts,eyeAction} from './eye.mjs';
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const equal=(a,b)=>timingSafeEqual(Buffer.from(hash(a),'hex'),Buffer.from(hash(b),'hex'));
const retention=30*86400000;
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(body,status=200,more={})=>new Response(JSON.stringify(body),{status,headers:{...headers,...more}});
const get=(e,sql,...args)=>e.DB.prepare(sql).bind(...args).first();
const run=(e,sql,...args)=>e.DB.prepare(sql).bind(...args).run();
const all=async(e,sql,...args)=>(await e.DB.prepare(sql).bind(...args).all()).results;
const meta=async(e,k)=>(await get(e,'SELECT v FROM meta WHERE k=?',k))?.v||null;
const setMeta=(e,k,v)=>run(e,'INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)',k,String(v));
function key(e){if(!/^[a-f0-9]{64}$/i.test(e.DATA_ENCRYPTION_KEY||''))throw Error('encryption key missing');return Buffer.from(e.DATA_ENCRYPTION_KEY,'hex');}
export function seal(e,value){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(e),iv);const ciphertext=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url');}
export function unseal(e,value){const b=Buffer.from(value,'base64url');const cipher=createDecipheriv('aes-256-gcm',key(e),b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');}
async function payload(req,max=262144){if(Number(req.headers.get('Content-Length'))>max)throw Error('body too large');const reader=req.body?.getReader();if(!reader)return Buffer.alloc(0);let size=0,chunks=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('body too large');}chunks.push(Buffer.from(value));}return Buffer.concat(chunks);}
function sessionToken(req){return(req.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8);}
async function logged(e,req){const token=sessionToken(req);return !!token&&!!await get(e,'SELECT id FROM sessions WHERE id=? AND expires>?',hash(token),Date.now());}
function configured(e){return !!(e.META_APP_SECRET&&e.META_VERIFY_TOKEN&&e.IG_ACCOUNT_ID&&e.DATA_ENCRYPTION_KEY);}
function vapid(e){if(!e.VAPID_JWK)return null;const jwk=JSON.parse(e.VAPID_JWK);const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');return {publicKey,jwk};}
async function purge(e){await e.DB.batch([e.DB.prepare('DELETE FROM messages WHERE received<?').bind(Date.now()-retention),e.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()),e.DB.prepare('DELETE FROM login_attempts WHERE expires<?').bind(Date.now()),e.DB.prepare('DELETE FROM notification_claims WHERE created<?').bind(Date.now()-2*86400000)]);}
async function notify(e,endpoint){
 if(!validPushEndpoint(endpoint))throw Error('invalid destination');
 const v=vapid(e);if(!v)throw Error('vapid missing');
 const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const token=enc({typ:'JWT',alg:'ES256'})+'.'+enc({aud:new URL(endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:e.VAPID_SUBJECT||e.APP_ORIGIN});
 let jwt;
 try{const signingKey=await crypto.subtle.importKey('jwk',v.jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signingKey,new TextEncoder().encode(token));jwt=token+'.'+Buffer.from(signature).toString('base64url');}catch{await setMeta(e,'pushError','signature_generation');throw Error('push signing failed');}
 let response;
 try{response=await fetch(endpoint,{method:'POST',headers:{Authorization:`vapid t=${jwt}, k=${v.publicKey}`,TTL:'3600',Urgency:'normal'},redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{await setMeta(e,'pushError','transport');throw Error('push transport failed');}
 if(!response.ok){let reason='';try{const body=await response.json();if(/^[A-Za-z0-9_]{1,80}$/.test(body.reason||''))reason=body.reason;}catch{}await setMeta(e,'pushError',`provider_${response.status}_${reason}`);}
 if([404,410].includes(response.status)){await run(e,'DELETE FROM subscriptions WHERE id=?',hash(endpoint));return false;}
 if(!response.ok)throw Error('push failed');
 await setMeta(e,'pushError','');await setMeta(e,'lastPushAccepted',Date.now());return true;
}
export function notificationWindow(e,date=new Date()){
 const from=Date.parse(e.TEST_NOTIFY_FROM||''),until=Date.parse(e.TEST_NOTIFY_UNTIL||'');
 return inWindow(date)||(Number.isFinite(from)&&Number.isFinite(until)&&until>=from&&until-from<=2*3600000&&date.getTime()>=from&&date.getTime()<=until);
}
export async function scheduled(e,date=new Date()){
 await purge(e);if(!notificationWindow(e,date))return;
 const latest=(await get(e,'SELECT max(received) latest FROM messages WHERE done=0'))?.latest||0;
 const subs=await all(e,'SELECT * FROM subscriptions WHERE notified<? LIMIT 5',latest);
 for(const sub of subs){const claim=hash(sub.id+Math.floor(date.getTime()/1800000));const result=await run(e,'INSERT OR IGNORE INTO notification_claims(id,created) VALUES (?,?)',claim,Date.now());if(!result.meta?.changes)continue;try{if(await notify(e,unseal(e,sub.endpoint))){await run(e,'UPDATE subscriptions SET notified=? WHERE id=?',latest,sub.id);await setMeta(e,'lastPush',Date.now());}}catch{await setMeta(e,'pushError','端末への通知送信に失敗しました');}}
 await setMeta(e,'lastCheck',Date.now());
}
async function webhook(e,req,url,ctx){
 if(req.method==='GET'){if(e.META_VERIFY_TOKEN&&url.searchParams.get('hub.mode')==='subscribe'&&equal(url.searchParams.get('hub.verify_token'),e.META_VERIFY_TOKEN))return new Response(url.searchParams.get('hub.challenge')||'',{headers:{'Content-Type':'text/plain'}});return json({error:'verification failed'},403);}
 if(req.method!=='POST')return json({error:'method'},405);
 const raw=await payload(req);const signature=req.headers.get('X-Hub-Signature-256');if(!configured(e)||!signature||!equal(signature,'sha256='+createHmac('sha256',e.META_APP_SECRET).update(raw).digest('hex')))return json({error:'signature'},403);
 const event=JSON.parse(raw);if(event.object!=='instagram')return json({error:'object'},400);let matching=false;
 const starters={YUBISUI_JOB:['求人について聞きたい','求人'],YUBISUI_PARTNER:['協力業者として相談したい','協力業者'],YUBISUI_BEGINNER:['未経験でも働けますか？','求人']};
 for(const entry of event.entry||[]){if(String(entry.id)!==e.IG_ACCOUNT_ID)continue;matching=true;for(const item of entry.messaging||[]){
 const m=item.message,starter=starters[item.postback?.payload],sender=String(item.sender?.id||'');
 if(m?.is_echo||sender===e.IG_ACCOUNT_ID){await eyeIngest(e,item,null,typeof m?.text==='string'?m.text:'',{seal,unseal});continue;}
 if(!sender||m?.is_echo||sender===e.IG_ACCOUNT_ID||(!m?.mid&&!starter))continue;
 const text=starter?'【用件ボタン】'+starter[0]:typeof m.text==='string'?m.text.slice(0,8000):'';
 let category=starter?.[1]||classify(text);
 if(!category&&text){const recent=await all(e,'SELECT sender,body,category FROM messages WHERE received>? ORDER BY received DESC LIMIT 200',Date.now()-86400000);for(const row of recent){let id=unseal(e,row.sender);try{id=JSON.parse(id).id||id;}catch{}if(id===sender&&unseal(e,row.body).startsWith('【用件ボタン】')){category=row.category;break;}}}
 await eyeIngest(e,item,category,text,{seal,unseal});
 if(!category)continue;const received=Math.min(Number(item.timestamp)||Date.now(),Date.now());if(received<Date.now()-retention)continue;
 const mid=m?.mid||'postback:'+sender+':'+item.timestamp+':'+item.postback.payload;
 await run(e,'INSERT OR IGNORE INTO messages(id,sender,body,category,received) VALUES(?,?,?,?,?)',hash(mid),seal(e,sender),seal(e,text),category,received);
 }}
 if(matching){await setMeta(e,'lastReceipt',Date.now());if(ctx?.waitUntil)ctx.waitUntil((async()=>{try{await eyeTick(e,{seal,unseal});await eyeAlerts(e,{seal,unseal},notify);}catch{await setMeta(e,'eyeSystemError',Date.now());}})());}return json({ok:true});
}
async function handle(req,e,ctx){
 const url=new URL(req.url);if(!e.DB)return json({error:'公開先のデータベースを設定してください'},503);
 if(url.pathname.startsWith('/social-media/')&&req.method==='GET')return await socialAsset(e,url.pathname)||new Response('Not found',{status:404});
 if(url.pathname==='/webhooks/instagram')return webhook(e,req,url,ctx);
 const origin=e.APP_ORIGIN||url.origin;
 if(url.pathname.startsWith('/api/')){
 if(!['GET','HEAD'].includes(req.method)&&req.headers.get('Origin')!==origin)return json({error:'origin'},403);
 if(url.pathname==='/api/status'){const auth=await logged(e,req);return json({authenticated:auth,instagramConfigured:configured(e),lastReceipt:auth?await meta(e,'lastReceipt'):null,publicKey:vapid(e)?.publicKey||null,secure:origin.startsWith('https://'),hasOwnerPassword:!!e.OWNER_PASSWORD,lastCheck:auth?await meta(e,'lastCheck'):null});}
 if(url.pathname==='/api/login'&&req.method==='POST'){
 const ip=hash(req.headers.get('CF-Connecting-IP')||'unknown');const slot=Math.floor(Date.now()/900000);const rateId=ip+slot;
 await run(e,'INSERT INTO login_attempts(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1',rateId,Date.now()+900000);if((await get(e,'SELECT count FROM login_attempts WHERE id=?',rateId)).count>10)return json({error:'時間をおいてお試しください'},429);
 const p=JSON.parse(await payload(req));if(!e.OWNER_PASSWORD||!equal(p.password,e.OWNER_PASSWORD))return json({error:'ログインできません'},401);
 const token=randomBytes(32).toString('base64url');await run(e,'INSERT INTO sessions(id,expires) VALUES (?,?)',hash(token),Date.now()+7*86400000);return json({ok:true},200,{'Set-Cookie':`session=${token}; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=604800`});
 }
 if(!await logged(e,req))return json({error:'所有者ログインが必要です'},401);
 if(url.pathname.startsWith('/api/eye/')){const action=url.pathname.slice('/api/eye/'.length);if(req.method!==(['status','notice'].includes(action)?'GET':'POST'))return json({error:'method'},405);try{return json(await eyeAction(e,action,req.method==='POST'?JSON.parse(await payload(req)): {},{seal,unseal}));}catch(err){return json({error:String(err.message).slice(0,180)},400);}}
 if(url.pathname.startsWith('/api/autopilot/')){
  const action=url.pathname.slice('/api/autopilot/'.length);if(req.method!==(action==='status'?'GET':'POST'))return json({error:'method'},405);
  try{return json(await autopilotAction(e,action,req.method==='POST'?JSON.parse(await payload(req)):{}));}catch(err){return json({error:String(err.message).slice(0,180)},400);}
 }
 if(url.pathname.startsWith('/api/studio/')){
  const action=url.pathname.slice('/api/studio/'.length);if(req.method!==(action==='drafts'?'GET':'POST'))return json({error:'method'},405);
  try{return json(await studioAction(e,action,req.method==='POST'?JSON.parse(await payload(req)):{}));}catch(err){return json({error:err.message},400);}
 }
 if(url.pathname==='/api/social/notice'&&req.method==='GET')return json({attention:!!await get(e,"SELECT id FROM social_events WHERE kind='error' AND created>? LIMIT 1",Date.now()-3600000)});
 if(url.pathname.startsWith('/api/social/')){
  const read=['/api/social/status','/api/social/preflight'].includes(url.pathname);
  if(req.method!==(read?'GET':'POST'))return json({error:'method'},405);
  try{return json(await socialAction(e,url.pathname,read?{}:JSON.parse(await payload(req,2200000))));}catch(err){return json({error:err.message},400);}
 }
 if(url.pathname==='/api/logout'&&req.method==='POST'){await run(e,'DELETE FROM sessions WHERE id=?',hash(sessionToken(req)));return json({ok:true},200,{'Set-Cookie':'session=; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=0'});}
 if(url.pathname==='/api/messages'&&req.method==='GET'){
 await purge(e);const list=await all(e,'SELECT * FROM messages ORDER BY received DESC LIMIT 200');const profiles=new Map();let lookups=0;const result=[];
 for(const m of list){const raw=unseal(e,m.sender);let profile;try{profile=JSON.parse(raw);if(!profile?.id)profile={id:raw};}catch{profile={id:raw};}
 if(profiles.has(profile.id))profile=profiles.get(profile.id);
 else if(e.IG_ACCESS_TOKEN&&/^\d+$/.test(profile.id)&&(!profile.checked||Date.now()-profile.checked>86400000)&&lookups++<5){
 try{const r=await fetch(`https://graph.instagram.com/v25.0/${profile.id}?fields=username,name`,{headers:{Authorization:`Bearer ${e.IG_ACCESS_TOKEN}`},redirect:'manual',signal:AbortSignal.timeout(5000)});const p=await r.json();if(r.ok&&typeof p.username==='string'){profile={id:profile.id,username:p.username.slice(0,100),name:typeof p.name==='string'?p.name.slice(0,200):'',checked:Date.now()};}else{profile.checked=Date.now();}}catch{profile.checked=Date.now();}
 profiles.set(profile.id,profile);
 }
 if(profile.checked)await run(e,'UPDATE messages SET sender=? WHERE id=?',seal(e,JSON.stringify(profile)),m.id);
 result.push({...m,peer:hash(profile.id),sender:profile.username?'@'+profile.username:profile.id,username:profile.username||null,displayName:profile.name||null,body:unseal(e,m.body)});
 }return json(result);}
 if(url.pathname==='/api/messages/delete'&&req.method==='POST'){const p=JSON.parse(await payload(req));const result=await run(e,'DELETE FROM messages WHERE id=? AND done=1',String(p.id));return result.meta?.changes?json({ok:true}):json({error:'対応済みのDMだけ削除できます'},409);}
 if(url.pathname==='/api/messages/done'&&req.method==='POST'){const p=JSON.parse(await payload(req));await run(e,'UPDATE messages SET done=? WHERE id=?',p.done?1:0,String(p.id));return json({ok:true});}
 if(url.pathname==='/api/subscribe'&&req.method==='POST'){const p=JSON.parse(await payload(req));if(!validPushEndpoint(p.endpoint))return json({error:'通知先を確認できません'},400);const count=(await get(e,'SELECT count(*) count FROM subscriptions')).count;if(count>=5&&!await get(e,'SELECT id FROM subscriptions WHERE id=?',hash(p.endpoint)))return json({error:'登録できる端末は5台までです'},400);await run(e,'INSERT OR IGNORE INTO subscriptions(id,endpoint) VALUES (?,?)',hash(p.endpoint),seal(e,p.endpoint));return json({ok:true});}
 if(url.pathname==='/api/push-test'&&req.method==='POST'){const p=JSON.parse(await payload(req));const sub=await get(e,'SELECT endpoint FROM subscriptions WHERE id=?',hash(p.endpoint||''));if(!sub)return json({error:'先に通知を設定してください'},400);const delivered=await notify(e,unseal(e,sub.endpoint));return delivered?json({ok:true}):json({error:'通知先の有効期限が切れています。再登録してください'},410);}
 return json({error:'not found'},404);
 }
 if(!e.ASSETS)return json({error:'画面の公開準備が必要です'},503);
 const staticResponse=await e.ASSETS.fetch(req);const response=new Response(staticResponse.body,staticResponse);response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");return response;
}
async function background(e,date){
 try{await eyeTick(e,{seal,unseal},date.getTime());await eyeAlerts(e,{seal,unseal},notify,date.getTime());}catch{await setMeta(e,'eyeSystemError',date.getTime());}
 try{await socialTick(e,date);}catch{await setMeta(e,'socialSystemError',Date.now());}
 try{await autopilotTick(e,date.getTime());}catch{await setMeta(e,'socialSystemError',Date.now());}
 if(date.getUTCMinutes()%30===0)await scheduled(e,date);
 if(inWindow(date)){
  const last=Number(await meta(e,'socialAlertSent')||0),error=await get(e,"SELECT max(created) latest FROM social_events WHERE kind='error'");
  const latest=Math.max(Number(error?.latest||0),Number(await meta(e,'socialSystemError')||0));
  if(latest>last){let ok=true;const subs=await all(e,'SELECT * FROM subscriptions LIMIT 5');for(const sub of subs){try{await notify(e,unseal(e,sub.endpoint));}catch{ok=false;}}if(ok&&subs.length)await setMeta(e,'socialAlertSent',latest);}
 }
}
export default {async fetch(req,e,ctx){try{return await handle(req,e,ctx);}catch{return json({error:'処理できませんでした。接続設定をご確認ください。'},500);}},async scheduled(event,e,ctx){ctx.waitUntil(background(e,new Date(event.scheduledTime)));}};
