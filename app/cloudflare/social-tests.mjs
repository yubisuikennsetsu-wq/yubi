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

test('取消予約の論理削除と表示復元は予約行・枠・取消状態を保ち、再クリックは監査を重複しない',async()=>{
 const e=env(),j=await socialAction(e,'/api/social/queue',payload(),now);await socialAction(e,'/api/social/cancel',{id:j.id},now+1);
 const before={...e.db.prepare('SELECT * FROM social_jobs').get()},p={id:j.id,expectedUpdated:now+1};
 await socialAction(e,'/api/social/hide-cancelled',p,now+2);await socialAction(e,'/api/social/hide-cancelled',p,now+3);
 let s=await socialAction(e,'/api/social/status');assert.equal(s.jobs.length,0);assert.equal(s.hiddenJobs.length,1);assert.equal(s.hiddenJobs[0].id,j.id);assert.deepEqual({...e.db.prepare('SELECT * FROM social_jobs').get()},before);
 assert.equal(e.db.prepare("SELECT count(*) n FROM social_events WHERE kind='hidden'").get().n,1);
 await assert.rejects(()=>socialAction(e,'/api/social/queue',payload(),now+4),/登録済み/);
 await socialAction(e,'/api/social/show-cancelled',p,now+5);await socialAction(e,'/api/social/show-cancelled',p,now+6);
 s=await socialAction(e,'/api/social/status');assert.equal(s.hiddenJobs.length,0);assert.equal(s.jobs[0].status,'cancelled');assert.deepEqual({...e.db.prepare('SELECT * FROM social_jobs').get()},before);
 assert.equal(e.db.prepare("SELECT count(*) n FROM social_events WHERE kind='shown'").get().n,1);
});
test('論理削除は取消以外・古い状態・公開済み記録・lease競合を拒否する',async()=>{
 for(const status of ['draft','scheduled','preparing','processing','ready','publishing','published','uncertain','failed']){
  const e=env(),j=await socialAction(e,'/api/social/queue',payload(),now);e.db.prepare('UPDATE social_jobs SET status=?').run(status);
  for(const action of ['hide-cancelled','show-cancelled'])await assert.rejects(()=>socialAction(e,'/api/social/'+action,{id:j.id,expectedUpdated:now},now+1));
  assert.equal(e.db.prepare("SELECT count(*) n FROM meta WHERE k LIKE 'socialHidden:%'").get().n,0);
 }
 const e=env(),j=await socialAction(e,'/api/social/queue',payload(),now);await socialAction(e,'/api/social/cancel',{id:j.id},now+1);const p={id:j.id,expectedUpdated:now+1};
 await assert.rejects(()=>socialAction(e,'/api/social/hide-cancelled',{...p,expectedUpdated:now},now+2));
 e.db.prepare("INSERT INTO social_leases VALUES('tick',?)").run(now+10000);await assert.rejects(()=>socialAction(e,'/api/social/hide-cancelled',p,now+3),/確認中/);e.db.prepare('DELETE FROM social_leases').run();
 e.db.prepare("UPDATE social_jobs SET media_id='published-id'").run();await assert.rejects(()=>socialAction(e,'/api/social/hide-cancelled',p,now+4));
});
test('削除APIは所有者認証・Origin・POSTを要求し、状態が変わった行は隠さない',async()=>{
 const e=env(),url=e.APP_ORIGIN,path='/api/social/hide-cancelled',p={id:'missing',expectedUpdated:1};
 const request=(method,body,cookie,origin=url)=>new Request(url+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 assert.equal((await worker.fetch(request('POST',p),e)).status,401);
 const login=await worker.fetch(new Request(url+'/api/login',{method:'POST',headers:{Origin:url},body:JSON.stringify({password:'owner'})}),e),cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await worker.fetch(request('POST',p,cookie,'https://other.test'),e)).status,403);assert.equal((await worker.fetch(request('GET',null,cookie),e)).status,405);assert.equal((await worker.fetch(request('POST',p,cookie),e)).status,400);
 const j=await socialAction(e,'/api/social/queue',payload(),now);await socialAction(e,'/api/social/cancel',{id:j.id},now+1);await socialAction(e,path,{id:j.id,expectedUpdated:now+1},now+2);
 e.db.prepare("UPDATE social_jobs SET status='uncertain'").run();const snapshot=await socialAction(e,'/api/social/status');assert.equal(snapshot.jobs[0].status,'uncertain');assert.equal(snapshot.hiddenJobs.length,0);
});

test('Cron終了・早期return・例外で自分のleaseを解放し、稼働中と新しい所有者のleaseは守る',async()=>{
 for(const enabled of [true,false]){
  const e=env();if(enabled)active(e);await socialTick(e,new Date(due-6*3600000));assert.equal(e.db.prepare("SELECT * FROM social_leases WHERE id='tick'").get(),undefined);
 }
 const e=env();active(e);await socialAction(e,'/api/social/queue',payload(),now);const f=globalThis.fetch;
 globalThis.fetch=async()=>{await assert.rejects(()=>socialAction(e,'/api/social/edit',{...payload(),id:e.db.prepare('SELECT id FROM social_jobs').get().id},due-1800000),/確認中/);e.db.prepare("UPDATE social_leases SET until_at=? WHERE id='tick'").run(due+3600000);return Response.json({id:'mock'});};
 try{await socialTick(e,new Date(due-1800000));assert.equal(e.db.prepare("SELECT until_at FROM social_leases WHERE id='tick'").get().until_at,due+3600000);}finally{globalThis.fetch=f;}
 const broken=env(),prepare=broken.DB.prepare;broken.DB.prepare=function(sql){if(sql.startsWith('DELETE FROM social_assets'))throw Error('test DB failure');return prepare.call(this,sql);};
 await assert.rejects(()=>socialTick(broken,new Date(now)),/test DB failure/);assert.equal(broken.db.prepare("SELECT * FROM social_leases WHERE id='tick'").get(),undefined);
});

test('AACの実測平均ビットレート上限を維持し、超過の数値と保存前拒否コードを返す',async()=>{
 const bytes=readFileSync(new URL('./fixtures/animation-aac-test.mp4',import.meta.url));
 const decoder=bytes.indexOf(Buffer.from([4,0x80,0x80,0x80,0x17,0x40,0x15]));assert.ok(decoder>0);
 const p={...videoPayload(),fileName:'music.mp4',hold:false};
 for(const rate of [128000,128001,130295]){
  const b=Buffer.from(bytes);b.writeUInt32BE(rate,decoder+14);p.mp4=b.toString('base64');
  if(rate===128000)assert.equal(validateJob(p,now).kind,'feed');
  else assert.throws(()=>validateJob(p,now),error=>error.code==='MEDIA_VALIDATION'&&error.message.includes(rate.toLocaleString('en-US')));
 }
 const e=env(),url=e.APP_ORIGIN,j=await socialAction(e,'/api/social/queue',payload(),now),before={...e.db.prepare('SELECT * FROM social_jobs').get()};
 await assert.rejects(()=>socialAction(e,'/api/social/upload-media',{...p,id:j.id,expectedUpdated:now},now),error=>error.code==='MEDIA_VALIDATION');
 assert.deepEqual({...e.db.prepare('SELECT * FROM social_jobs').get()},before);
 const login=await worker.fetch(new Request(url+'/api/login',{method:'POST',headers:{Origin:url},body:JSON.stringify({password:'owner'})}),e),cookie=login.headers.get('set-cookie').split(';')[0];
 const day=new Date(Date.now()+9*3600000+86400000).toISOString().slice(0,10);
 const r=await worker.fetch(new Request(url+'/api/social/upload-media',{method:'POST',headers:{Origin:url,Cookie:cookie},body:JSON.stringify({...p,due:Date.parse(day+'T16:00:00+09:00')})}),e);
 assert.equal(r.status,400);assert.equal((await r.json()).code,'MEDIA_VALIDATION');assert.equal(e.db.prepare('SELECT count(*) n FROM social_jobs').get().n,1);
});

test('予報待ちテンプレートは明示した下書きのみ、同じ素材の改名・別枠・直接APIによる予約昇格を拒否する',async()=>{
 const e=env(),n=due-86400000,p={...payload(),kind:'story',due:due-5*3600000,fileName:'20261011_weather_template.jpg',hold:true,weatherPreview:true};
 for(const change of [{hold:false},{weatherPreview:false},{kind:'feed',due},{frame:2}])await assert.rejects(()=>socialAction(e,'/api/social/upload-media',{...p,...change},n));
 const j=await socialAction(e,'/api/social/upload-media',p,n);let s=await socialAction(e,'/api/social/status');assert.equal(s.jobs[0].status,'draft');assert.equal(s.jobs[0].weather_preview,1);
 const edit={...p,id:j.id,expectedUpdated:n,weatherPreview:false,completedWeatherConfirmed:true,fileName:'finished.jpg',hold:false};
 await assert.rejects(()=>socialAction(e,'/api/social/upload-media',edit,n+1),/確認用素材/);
 await assert.rejects(()=>socialAction(e,'/api/social/edit',{...edit,fileName:undefined},n+1),/確認用素材/);
 await assert.rejects(()=>socialAction(e,'/api/social/queue',{...edit,id:undefined,due:p.due+86400000},n+1),/確認用素材/);
 assert.equal(e.db.prepare('SELECT status FROM social_jobs').get().status,'draft');assert.equal((await socialAction(e,'/api/social/status')).jobs[0].weather_preview,1);
 const bytes=Buffer.from(p.jpeg,'base64');bytes[bytes.length-1]=1;const replacement={...edit,jpeg:bytes.toString('base64')};
 await assert.rejects(()=>socialAction(e,'/api/social/upload-media',{...replacement,completedWeatherConfirmed:false},n+2),/完成確認/);
 await socialAction(e,'/api/social/upload-media',replacement,n+3);s=await socialAction(e,'/api/social/status');assert.equal(s.jobs[0].status,'scheduled');assert.equal(s.jobs[0].weather_preview,0);assert.equal(s.jobs[0].id,j.id);
 // Earlier preview hashes remain blocked even after a completed replacement.
 await assert.rejects(()=>socialAction(e,'/api/social/queue',{...edit,id:undefined,due:p.due+86400000},n+4),/確認用素材/);
});
test('予報待ちは誤って公開状態になっても送信せず、完成済みの一部未発表表示は妨げない',async()=>{
 const e=env(),p={...payload(),kind:'story',due:due-5*3600000,hold:true,weatherPreview:true},n=p.due-86400000;active(e);
 const j=await socialAction(e,'/api/social/queue',p,n),f=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not publish preview');};
 try{
  for(const status of ['scheduled','processing','ready']){e.db.prepare('UPDATE social_jobs SET status=?').run(status);await socialTick(e,new Date(p.due));}
  assert.equal(calls,0);
  e.db.prepare("DELETE FROM meta WHERE k='weatherPreview:'||?").run(j.id);await socialTick(e,new Date(p.due));assert.equal(calls,0); // hash remains a second guard
 }finally{globalThis.fetch=f;}
 const clean=env();await socialAction(clean,'/api/social/upload-media',{...p,weatherPreview:false,hold:false,fileName:'weather_complete.jpg',caption:'公式予報に基づく週間天気。最終日のみ未発表です。'},n);
 assert.equal((await socialAction(clean,'/api/social/status')).jobs[0].status,'scheduled');
});

test('日時変更は素材なしでID・状態・予報待ちフラグを維持し、2件の枠を原子的に入れ替える',async()=>{
 const e=env(),n=due-2*86400000,aDue=due-5*3600000,bDue=aDue+2*86400000;
 const a=await socialAction(e,'/api/social/queue',{...payload(),kind:'story',due:aDue,hold:true,weatherPreview:true},n);
 const bBytes=Buffer.from(jpeg,'base64');bBytes[bBytes.length-1]=2;
 const b=await socialAction(e,'/api/social/queue',{...payload(),kind:'story',due:bDue,jpeg:bBytes.toString('base64')},n);
 const rows=e.db.prepare('SELECT * FROM social_jobs ORDER BY due').all().map(x=>({...x}));
 await assert.rejects(()=>socialAction(e,'/api/social/reschedule',{id:a.id,expectedUpdated:n,due:bDue},n+1),/入替え/);
 await assert.rejects(()=>socialAction(e,'/api/social/reschedule',{id:a.id,expectedUpdated:n,due:bDue,swapId:b.id,swapExpectedUpdated:n-1,swapConfirmed:true},n+1));
 const p={id:a.id,expectedUpdated:n,due:bDue,swapId:b.id,swapExpectedUpdated:n,swapConfirmed:true};
 await socialAction(e,'/api/social/reschedule',p,n+2);
 const after=(await socialAction(e,'/api/social/status')).jobs;
 for(const old of rows){const j=after.find(x=>x.id===old.id);assert.equal(j.asset_id,old.asset_id);assert.equal(j.status,old.status);assert.equal(j.caption,old.caption);assert.equal(j.due,old.id===a.id?bDue:aDue);}
 assert.equal(after.find(x=>x.id===a.id).weather_preview,1);assert.equal(after.find(x=>x.id===a.id).status,'draft');
 await assert.rejects(()=>socialAction(e,'/api/social/reschedule',p,n+3));
 await socialAction(e,'/api/social/reschedule',{id:a.id,expectedUpdated:n+2,due:bDue+86400000},n+4);
 assert.equal(e.db.prepare('SELECT due FROM social_jobs WHERE id=?').get(a.id).due,bDue+86400000);
 assert.equal(e.db.prepare("SELECT count(*) n FROM social_jobs WHERE slot LIKE 'rescheduling:%'").get().n,0);
});
test('日時入替えの途中失敗は全件rollbackし、過去・処理中・lease競合・非所有者を拒否する',async()=>{
 const e=env(),n=due-2*86400000;
 const a=await socialAction(e,'/api/social/queue',payload(),n),b=await socialAction(e,'/api/social/queue',{...payload(),due:due+86400000},n);
 const p={id:a.id,expectedUpdated:n,due:due+86400000,swapId:b.id,swapExpectedUpdated:n,swapConfirmed:true};
 const before=e.db.prepare('SELECT * FROM social_jobs ORDER BY id').all();
 const batch=e.DB.batch;e.DB.batch=async statements=>batch([...statements.slice(0,2),{async run(){throw Error('simulated transaction failure');}},...statements.slice(2)]);
 await assert.rejects(()=>socialAction(e,'/api/social/reschedule',p,n+1),/transaction failure/);assert.deepEqual(e.db.prepare('SELECT * FROM social_jobs ORDER BY id').all(),before);e.DB.batch=batch;
 for(const status of ['processing','ready','preparing','publishing','published','uncertain','cancelled','failed']){e.db.prepare('UPDATE social_jobs SET status=? WHERE id=?').run(status,b.id);await assert.rejects(()=>socialAction(e,'/api/social/reschedule',p,n+2));}
 e.db.prepare("UPDATE social_jobs SET status='scheduled'").run();
 for(const date of [n,n+30000,due+3600000,n+29*86400000])await assert.rejects(()=>socialAction(e,'/api/social/reschedule',{id:a.id,expectedUpdated:n,due:date},n+3));
 e.db.prepare("INSERT INTO social_leases VALUES('tick',?)").run(n+10000);await assert.rejects(()=>socialAction(e,'/api/social/reschedule',p,n+4),/確認中/);
 const req=new Request(e.APP_ORIGIN+'/api/social/reschedule',{method:'POST',headers:{Origin:e.APP_ORIGIN},body:JSON.stringify(p)});assert.equal((await worker.fetch(req,e)).status,401);
});
