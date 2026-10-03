import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {socialAction,socialTick,validateJob,slotFor,socialAsset} from './social.mjs';import worker from './worker.mjs';
import {studioAction} from './studio.mjs';
function env(){const db=new DatabaseSync(':memory:');for(const name of ['schema.sql','social.sql'])db.exec(readFileSync(new URL(name,import.meta.url),'utf8'));const DB={prepare(sql){let args=[];return{bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}};}};},async batch(s){db.exec('BEGIN');try{const results=[];for(const x of s)results.push(await x.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};return {db,DB,APP_ORIGIN:'https://example.test',IG_ACCESS_TOKEN:'test-token',IG_ACCOUNT_ID:'test-id',OWNER_PASSWORD:'owner',DATA_ENCRYPTION_KEY:'ab'.repeat(32)};}
const due=Date.parse('2026-10-01T16:00:00+09:00'),now=due-3600000;
const jpeg=Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(1200)]).toString('base64');
const payload=()=>({kind:'feed',category:'求人',caption:'仕事内容はプロフィールのメッセージから聞いてください。',due,jpeg,checked:true});
test('複数ストーリーは順番を守り、結果不明の後続を公開しない',async()=>{const e=env();active(e);const d=due-5*3600000,n=d-2*3600000,p={...payload(),kind:'story',due:d};await assert.rejects(()=>socialAction(e,'/api/social/queue',{...p,frame:2},n));for(const frame of [1,2,3])await socialAction(e,'/api/social/queue',{...p,frame},n);await assert.rejects(()=>socialAction(e,'/api/social/queue',{...p,frame:2},n));e.db.prepare("UPDATE social_jobs SET status='ready',container_id=slot").run();let order=[];const f=globalThis.fetch;globalThis.fetch=async(url,o)=>{order.push(new URLSearchParams(o.body).get('creation_id'));if(order.length===2)throw Error('connection lost');return Response.json({id:'m1'});};try{await socialTick(e,new Date(d));assert.deepEqual(order,['2026-10-01:story','2026-10-01:story:02']);assert.deepEqual(e.db.prepare('SELECT status FROM social_jobs ORDER BY slot').all().map(x=>x.status),['published','uncertain','ready']);}finally{globalThis.fetch=f;}});
test('予報待ち下書きは公開せず、検品済み編集で予約へ切り替える',async()=>{const e=env();active(e);const j=await socialAction(e,'/api/social/queue',{...payload(),hold:true},now-3600000);let calls=0;const f=globalThis.fetch;globalThis.fetch=async()=>{calls++;return Response.json({id:'c'});};try{await socialTick(e,new Date(due-5400000));assert.equal(calls,0);await socialAction(e,'/api/social/edit',{...payload(),id:j.id},now);assert.equal(e.db.prepare('SELECT status FROM social_jobs').get().status,'scheduled');await assert.rejects(()=>socialAction(e,'/api/social/edit',{...payload(),id:j.id,kind:'story',due:due-5*3600000},now-6*3600000));}finally{globalThis.fetch=f;}});
test('スマホ制作は一日6回まで、下書き保存で公開予約は作られない',async()=>{const e=env();let calls=0;e.AI={async run(model,p){assert.equal(model,'@cf/black-forest-labs/flux-1-schnell');assert.equal(p.steps,4);calls++;return {image:jpeg};}};const results=await Promise.all(Array.from({length:6},()=>studioAction(e,'generate',{brief:'a yellow tape measure'},now)));await assert.rejects(()=>studioAction(e,'generate',{brief:'another image'},now));assert.equal(calls,6);const d=await studioAction(e,'save',{kind:'story',category:'求人',headline:'まずは話から',caption:'質問だけでもお気軽に',asset:results[0].asset},now);assert.equal((await studioAction(e,'drafts',{},now)).drafts[0].id,d.draft.id);assert.equal(e.db.prepare('SELECT COUNT(*) n FROM social_jobs').get().n,0);assert.equal((await worker.fetch(new Request(e.APP_ORIGIN+'/api/studio/drafts'),e)).status,401);await assert.rejects(()=>studioAction(e,'save',{kind:'story',category:'求人',asset:'a'.repeat(48)},now));});
test('画像確認中の取消競合を防ぎ、確認後の取消を保持する',async()=>{const e=env();const j=await socialAction(e,'/api/social/queue',payload(),now);const f=globalThis.fetch;globalThis.fetch=async()=>{await assert.rejects(()=>socialAction(e,'/api/social/cancel',{id:j.id},now));return Response.json({id:'c'});};try{assert.equal((await socialAction(e,'/api/social/prepare',{id:j.id},now)).status,'processing');await socialAction(e,'/api/social/cancel',{id:j.id},now);assert.equal(e.db.prepare('SELECT status FROM social_jobs').get().status,'cancelled');}finally{globalThis.fetch=f;}});
function active(e){e.db.prepare('INSERT INTO meta VALUES(?,?)').run('socialMode','active');e.db.prepare('INSERT INTO meta VALUES(?,?)').run('socialLastInsights',String(now));}
test('日本時間の予約枠、画像・文言・検品を検証する',()=>{assert.equal(slotFor('feed',due),'2026-10-01:feed');assert.equal(validateJob(payload(),now).kind,'feed');for(const change of [{due:now},{due:due+3600000},{kind:'story'},{checked:false},{jpeg:'abc'},{caption:'https://ig.me/m/test'}])assert.throws(()=>validateJob({...payload(),...change},now));});
test('同日の同種別を二重登録せず、画像URLは推測困難な識別子のみ',async()=>{const e=env();await socialAction(e,'/api/social/queue',payload(),now);await assert.rejects(()=>socialAction(e,'/api/social/queue',payload(),now));const job=e.db.prepare('SELECT * FROM social_jobs').get();assert.equal(job.asset_id.length,48);assert.equal((await socialAsset(e,'/social-media/'+job.asset_id+'.jpg')).status,200);assert.equal(await socialAsset(e,'/social-media/1.jpg'),null);});
test('停止中は投稿せず、再開後も予定時刻前に公開しない',async()=>{const e=env();await socialAction(e,'/api/social/queue',payload(),now);e.db.prepare('INSERT INTO meta VALUES(?,?)').run('socialLastInsights',String(now));let calls=0;const f=globalThis.fetch;globalThis.fetch=async()=>{calls++;return Response.json({id:'container'});};try{await socialTick(e,new Date(due-1800000));assert.equal(calls,0);await socialAction(e,'/api/social/mode',{mode:'active'});await socialTick(e,new Date(due-1200000));assert.equal(calls,1);assert.equal(e.db.prepare('SELECT status FROM social_jobs').get().status,'processing');}finally{globalThis.fetch=f;}});
test('同時実行でも公開は一回のみ、公開結果とリンクを保存',async()=>{const e=env();active(e);await socialAction(e,'/api/social/queue',payload(),now);e.db.prepare("UPDATE social_jobs SET status='ready',container_id='c'").run();let published=0;const f=globalThis.fetch;globalThis.fetch=async(url,options)=>{if(options.method==='POST'){published++;return Response.json({id:'media'});}return Response.json({permalink:'https://www.instagram.com/p/test/'});};try{await Promise.all([socialTick(e,new Date(due)),socialTick(e,new Date(due))]);await socialTick(e,new Date(due+300000));assert.equal(published,1);const j=e.db.prepare('SELECT * FROM social_jobs').get();assert.equal(j.status,'published');assert.equal(j.media_id,'media');assert.equal(j.permalink,'https://www.instagram.com/p/test/');}finally{globalThis.fetch=f;}});
test('公開通信が途切れたとき再送せず、遅延超過も停止する',async()=>{const e=env();active(e);await socialAction(e,'/api/social/queue',payload(),now);e.db.prepare("UPDATE social_jobs SET status='ready',container_id='c'").run();let attempts=0;const f=globalThis.fetch;globalThis.fetch=async()=>{attempts++;throw Error('timeout');};try{await socialTick(e,new Date(due));await socialTick(e,new Date(due+300000));assert.equal(attempts,1);assert.equal(e.db.prepare('SELECT status FROM social_jobs').get().status,'uncertain');await assert.rejects(()=>socialAction(e,'/api/social/cancel',{id:e.db.prepare('SELECT id FROM social_jobs').get().id}));}finally{globalThis.fetch=f;}const e2=env();active(e2);await socialAction(e2,'/api/social/queue',payload(),now);await socialTick(e2,new Date(due+91*60000));assert.equal(e2.db.prepare('SELECT status FROM social_jobs').get().status,'failed');});
test('途中終了の公開処理は確認待ちにして再公開しない',async()=>{const e=env();active(e);await socialAction(e,'/api/social/queue',payload(),now);e.db.prepare("UPDATE social_jobs SET status='publishing',updated=?").run(now);await socialTick(e,new Date(due));assert.equal(e.db.prepare('SELECT status FROM social_jobs').get().status,'uncertain');});
test('管理APIは所有者認証・同一サイト・HTTP操作種別を検証',async()=>{const e=env();const req=(path,method='GET',body,headers={})=>new Request(e.APP_ORIGIN+path,{method,headers:{Origin:e.APP_ORIGIN,...headers},body:body?JSON.stringify(body):undefined});assert.equal((await worker.fetch(req('/api/social/status'),e)).status,401);const login=await worker.fetch(req('/api/login','POST',{password:'owner'}),e);const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await worker.fetch(req('/api/social/status','GET',undefined,{Cookie:cookie}),e)).status,200);assert.equal((await worker.fetch(req('/api/social/mode','POST',{mode:'active'},{Cookie:cookie,Origin:'https://evil.test'}),e)).status,403);assert.equal((await worker.fetch(req('/api/social/mode','GET',undefined,{Cookie:cookie}),e)).status,405);});

const mp4=()=>readFileSync(new URL('./fixtures/animation-test.mp4',import.meta.url));
const videoPayload=()=>{const p=payload();delete p.jpeg;return {...p,mp4:mp4().toString('base64')}};
test('無音MP4を保存し動画として返し、JPEGとの混在や不正動画を拒否する',async()=>{
 const e=env();const j=await socialAction(e,'/api/social/queue',videoPayload(),now);
 const s=await socialAction(e,'/api/social/status',{},now);assert.equal(s.jobs[0].media_type,'video');
 const a=e.db.prepare('SELECT asset_id FROM social_jobs WHERE id=?').get(j.id).asset_id;
 const r=await socialAsset(e,'/social-media/'+a+'.mp4');assert.equal(r.headers.get('Content-Type'),'video/mp4');assert.deepEqual(Buffer.from(await r.arrayBuffer()),mp4());
 assert.equal((await socialAsset(e,'/social-media/'+a+'.jpg')).status,404);
 for(const change of [{jpeg},{mp4:jpeg},{mp4:Buffer.alloc(1500001).toString('base64')},{checked:false}])assert.throws(()=>validateJob({...videoPayload(),...change},now));
 const broken=mp4();broken.writeUInt32BE(7,0);assert.throws(()=>validateJob({...videoPayload(),mp4:broken.toString('base64')},now));
});
test('動画の先頭・末尾RangeとHEADを正しい長さで返す',async()=>{
 const e=env();await socialAction(e,'/api/social/queue',videoPayload(),now);const a=e.db.prepare('SELECT asset_id FROM social_jobs').get().asset_id,path='/social-media/'+a+'.mp4';
 const get=range=>socialAsset(e,path,new Request('https://example.test'+path,{headers:{Range:range}}));
 let r=await get('bytes=0-15');assert.equal(r.status,206);assert.deepEqual(Buffer.from(await r.arrayBuffer()),mp4().subarray(0,16));
 r=await get('bytes=-10');assert.equal(r.status,206);assert.deepEqual(Buffer.from(await r.arrayBuffer()),mp4().subarray(-10));
 for(const range of ['bytes=999999999-','bytes=5-2','bytes=0-1,3-4','bytes=-0'])assert.equal((await get(range)).status,416);
 r=await worker.fetch(new Request('https://example.test'+path,{method:'HEAD'}),e);assert.equal(r.status,200);assert.equal(r.headers.get('Content-Length'),String(mp4().length));assert.equal(await r.text(),'');
});
test('動画はfeedをREELS共有、storyをSTORIESで模擬登録する',async()=>{
 for(const kind of ['feed','story']){
  const e=env(),p={...videoPayload(),kind,due:kind==='story'?due-5*3600000:due},n=p.due-2*3600000;
  const j=await socialAction(e,'/api/social/queue',p,n);const old=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,o)=>{calls++;assert.ok(url.endsWith('/media'));const b=new URLSearchParams(o.body);assert.equal(b.get('media_type'),kind==='feed'?'REELS':'STORIES');assert.match(b.get('video_url'),/\.mp4$/);assert.equal(b.has('image_url'),false);assert.equal(b.get('share_to_feed'),kind==='feed'?'true':null);return Response.json({id:'test-container'})};
  try{await socialAction(e,'/api/social/prepare',{id:j.id},n);assert.equal(calls,1);assert.equal(e.db.prepare('SELECT status FROM social_jobs').get().status,'processing')}finally{globalThis.fetch=old}
 }
});
test('AAC-LC無音トラック付き動画を受け付け、48kHz以外は拒否する',async()=>{
 const bytes=readFileSync(new URL('./fixtures/animation-aac-test.mp4',import.meta.url));
 const e=env(),p={...videoPayload(),mp4:bytes.toString('base64')};
 await socialAction(e,'/api/social/queue',p,now);assert.equal((await socialAction(e,'/api/social/status',{},now)).jobs[0].media_type,'video');
 const audio=bytes.indexOf('mp4a');assert.ok(audio>0);const wrongRate=Buffer.from(bytes);wrongRate.writeUInt32BE(44100*65536,audio+28);
 assert.throws(()=>validateJob({...p,mp4:wrongRate.toString('base64')},now));
 const wrongCodec=Buffer.from(bytes);wrongCodec.write('ac-3',audio,'ascii');assert.throws(()=>validateJob({...p,mp4:wrongCodec.toString('base64')},now));
});

test('所有者の動画登録はOrigin・認証・操作種別を守り、保存結果を読み戻せる',async()=>{
 const e=env(),origin=e.APP_ORIGIN;
 const req=(path,method,body,cookie,site=origin)=>new Request(origin+path,{method,headers:{Origin:site,...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 const data={...videoPayload(),due:Date.parse(slotFor('feed',Date.now()+2*86400000).slice(0,10)+'T16:00:00+09:00'),fileName:'20261005_feed.mp4',hold:true};
 const path='/api/social/upload-video';
 assert.equal((await worker.fetch(req(path,'POST',data),e)).status,401);
 const login=await worker.fetch(req('/api/login','POST',{password:'owner'}),e),cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await worker.fetch(req(path,'POST',data,cookie,'https://evil.test'),e)).status,403);
 assert.equal((await worker.fetch(req(path,'GET',null,cookie),e)).status,405);
 assert.equal((await worker.fetch(req(path,'POST',{...data,fileName:'20261011_weather_DO_NOT_POST_template.mp4'},cookie),e)).status,400);
 const r=await worker.fetch(req(path,'POST',data,cookie),e);assert.equal(r.status,200);const result=await r.json();
 const snapshot=await(await worker.fetch(req('/api/social/status','GET',null,cookie),e)).json();
 assert.equal(snapshot.jobs[0].id,result.id);assert.equal(snapshot.jobs[0].status,'draft');assert.equal(snapshot.jobs[0].media_type,'video');
 assert.equal((await worker.fetch(req(path,'POST',data,cookie),e)).status,400);
 assert.equal(e.db.prepare('SELECT count(*) n FROM social_jobs').get().n,1);
});
test('動画アップロードは明示した予約だけ保存し、未完成テンプレートを拒否する',async()=>{
 for(const hold of [true,false]){
  const e=env(),p={...videoPayload(),fileName:'finished.mp4',hold};
  await socialAction(e,'/api/social/upload-video',p,now);
  assert.equal(e.db.prepare('SELECT status FROM social_jobs').get().status,hold?'draft':'scheduled');
 }
 for(const change of [{fileName:'weather_template.mp4'},{fileName:'天気_投稿不可.mp4'},{fileName:'x.jpg'},{fileName:''},{hold:undefined},{mp4:undefined}]){
  const e=env();await assert.rejects(()=>socialAction(e,'/api/social/upload-video',{...videoPayload(),fileName:'finished.mp4',hold:false,...change},now));assert.equal(e.db.prepare('SELECT count(*) n FROM social_jobs').get().n,0);
 }
});

test('所有者のJPEG差替えは同じ予約ID・日時を維持し、競合・取消・実行中を拒否する',async()=>{
 const e=env(),n=due-4*3600000;
 const first=await socialAction(e,'/api/social/queue',payload(),n);
 const p={...payload(),id:first.id,fileName:'weather_construction_20261004.jpg',hold:false,expectedUpdated:n};
 const oldAsset=e.db.prepare('SELECT asset_id FROM social_jobs').get().asset_id;
 await socialAction(e,'/api/social/upload-media',p,n+1);
 let j=e.db.prepare('SELECT * FROM social_jobs').get();assert.equal(j.id,first.id);assert.equal(j.due,due);assert.equal(j.status,'scheduled');assert.notEqual(j.asset_id,oldAsset);
 await assert.rejects(()=>socialAction(e,'/api/social/upload-media',p,n+2),/更新/);
 for(const status of ['cancelled','processing','ready','preparing','publishing','published','uncertain','failed']){
  e.db.prepare('UPDATE social_jobs SET status=?').run(status);
  await assert.rejects(()=>socialAction(e,'/api/social/upload-media',{...p,expectedUpdated:n+1},n+3));
 }
 e.db.prepare("UPDATE social_jobs SET status='scheduled'").run();
 await assert.rejects(()=>socialAction(e,'/api/social/upload-media',{...p,expectedUpdated:n+1,due:due+86400000},n+4),/日時/);
 await assert.rejects(()=>socialAction(e,'/api/social/upload-media',{...p,expectedUpdated:n+1},due-30000));
 assert.equal(e.db.prepare('SELECT count(*) n FROM social_jobs').get().n,1);
});
