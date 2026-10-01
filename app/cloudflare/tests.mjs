import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {randomBytes,createHmac,generateKeyPairSync} from 'node:crypto';import worker,{seal,unseal,scheduled} from './worker.mjs';
function env(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));const adapter={prepare(sql){const args=[];return{bind(...a){args.push(...a);return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};return {db,DB:adapter,APP_ORIGIN:'https://example.test',OWNER_PASSWORD:'test-only-owner',META_APP_SECRET:'test-only-secret',META_VERIFY_TOKEN:'verify-test',IG_ACCOUNT_ID:'test-account',DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),VAPID_JWK:JSON.stringify(generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'}))};}
import {notificationWindow} from './worker.mjs';
test('臨時通知は指定日の1時まで、翌日以降は通常時間だけ',()=>{
 const e={TEST_NOTIFY_FROM:'2026-09-30T00:12:00+09:00',TEST_NOTIFY_UNTIL:'2026-09-30T01:00:00+09:00'};
 for(const time of ['2026-09-30T00:12:00+09:00','2026-09-30T01:00:00+09:00','2026-09-30T09:00:00+09:00'])assert.equal(notificationWindow(e,new Date(time)),true);
 for(const time of ['2026-09-30T00:11:59+09:00','2026-09-30T01:00:01+09:00','2026-10-01T01:00:00+09:00'])assert.equal(notificationWindow(e,new Date(time)),false);
 assert.equal(notificationWindow({},new Date('2026-09-30T01:00:00+09:00')),false);
});
const request=(path,{method='GET',body,headers={}}={})=>new Request('https://example.test'+path,{method,headers:{Origin:'https://example.test',...headers},body});
test('削除は本人の対応済みDMのみ、未対応と他サイトからの操作は拒否',async()=>{
 const e=env();await ingest(e,event('求人について'));
 const login=await worker.fetch(request('/api/login',{method:'POST',body:JSON.stringify({password:e.OWNER_PASSWORD})}),e);const cookie=login.headers.get('set-cookie').split(';')[0];
 const id=e.db.prepare('SELECT id FROM messages').get().id;
 const del=headers=>worker.fetch(request('/api/messages/delete',{method:'POST',body:JSON.stringify({id}),headers}),e);
 assert.equal((await del({})).status,401);assert.equal((await del({Cookie:cookie})).status,409);
 e.db.prepare('UPDATE messages SET done=1').run();
 assert.equal((await del({Cookie:cookie,Origin:'https://evil.test'})).status,403);
 assert.equal((await del({Cookie:cookie})).status,200);assert.equal(e.db.prepare('SELECT count(*) n FROM messages').get().n,0);
});
test('30分後の新着DMを通知でき、同じ時間枠では重複しない',async()=>{
 const e=env();await ingest(e,event('求人について','first',Date.now()-1000));e.db.prepare('INSERT INTO subscriptions VALUES(?,?,0)').run('sub',seal(e,'https://web.push.apple.com/test-only'));
 let sent=0;const realFetch=globalThis.fetch;globalThis.fetch=async()=>{sent++;return new Response('',{status:201});};
 try{await scheduled(e,new Date('2026-09-30T00:00:00Z'));await ingest(e,event('求人について','second'));await scheduled(e,new Date('2026-09-30T00:30:00Z'));await scheduled(e,new Date('2026-09-30T00:30:00Z'));assert.equal(sent,2);}finally{globalThis.fetch=realFetch;}
});
const event=(text,id='m1',timestamp=Date.now())=>JSON.stringify({object:'instagram',entry:[{id:'test-account',messaging:[{sender:{id:'test-sender'},timestamp,message:{mid:id,text}}]}]});
async function ingest(e,raw){return worker.fetch(request('/webhooks/instagram',{method:'POST',body:raw,headers:{'X-Hub-Signature-256':'sha256='+createHmac('sha256',e.META_APP_SECRET).update(raw).digest('hex')}}),e);}
test('用件ボタンと任意追記を受信し、再送は重複せず別人の雑談は保存しない',async()=>{
 const e=env();const obj=JSON.parse(event(''));const item=obj.entry[0].messaging[0];delete item.message;item.postback={title:'未経験でも働けますか？',payload:'YUBISUI_BEGINNER'};const raw=JSON.stringify(obj);
 await ingest(e,raw);await ingest(e,raw);await ingest(e,event('大阪で3年経験があります','followup'));await ingest(e,event('こんにちは','other').replace('test-sender','other-sender'));
 const rows=e.db.prepare('SELECT * FROM messages').all();assert.equal(rows.length,2);assert.equal(rows[0].category,'求人');assert.equal(rows[1].category,'求人');assert.equal(unseal(e,rows[1].body),'大阪で3年経験があります');
});
test('暗号化した本文を復元でき、改ざんを拒否する',()=>{const e=env();const sealed=seal(e,'個人情報を含む文章');assert.equal(unseal(e,sealed),'個人情報を含む文章');const b=Buffer.from(sealed,'base64url');b[b.length-1]^=1;assert.throws(()=>unseal(e,b.toString('base64url')));assert.ok(!sealed.includes('個人情報'));});
test('仕事DMだけを暗号化保存し、同じ受信を二重保存しない',async()=>{const e=env();const raw=event('求人について相談です');assert.equal((await ingest(e,raw)).status,200);await ingest(e,raw);await ingest(e,event('昨日はありがとう','m2'));const rows=e.db.prepare('SELECT * FROM messages').all();assert.equal(rows.length,1);assert.equal(unseal(e,rows[0].body),'求人について相談です');assert.notEqual(rows[0].sender,'test-sender');assert.equal((await worker.fetch(request('/api/messages'),e)).status,401);});
test('本人ログイン後だけ復号し、30日より古い内容は保存しない',async()=>{const e=env();await ingest(e,event('協力希望です'));await ingest(e,event('求人について','old',Date.now()-31*86400000));const login=await worker.fetch(request('/api/login',{method:'POST',body:JSON.stringify({password:e.OWNER_PASSWORD})}),e);assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];const response=await worker.fetch(request('/api/messages',{headers:{Cookie:cookie}}),e);const rows=await response.json();assert.equal(rows.length,1);assert.equal(rows[0].body,'協力希望です');const publicStatus=await(await worker.fetch(request('/api/status'),e)).json();assert.equal(publicStatus.lastReceipt,null);});
test('署名・対象アカウント・同一サイトからの操作を検証',async()=>{const e=env();assert.equal((await worker.fetch(request('/webhooks/instagram',{method:'POST',body:event('求人です')}),e)).status,403);const raw=event('求人です').replace('test-account','wrong-account');await ingest(e,raw);assert.equal(e.db.prepare('SELECT count(*) n FROM messages').get().n,0);assert.equal((await worker.fetch(request('/api/login',{method:'POST',body:'{}',headers:{Origin:'https://evil.test'}}),e)).status,403);});
test('夜間は通知せず、同じ時刻の並行処理でも重複通知しない',async()=>{const e=env();await ingest(e,event('求人について'));const endpoint='https://web.push.apple.com/test-only';e.db.prepare('INSERT INTO subscriptions VALUES(?,?,0)').run('sub-test',seal(e,endpoint));let sent=0;const realFetch=globalThis.fetch;globalThis.fetch=async()=>{sent++;return new Response('',{status:201});};try{await scheduled(e,new Date('2026-09-29T12:00:00Z'));assert.equal(sent,0);await Promise.all([scheduled(e,new Date('2026-09-30T00:00:00Z')),scheduled(e,new Date('2026-09-30T00:00:00Z'))]);assert.equal(sent,1);}finally{globalThis.fetch=realFetch;}});
