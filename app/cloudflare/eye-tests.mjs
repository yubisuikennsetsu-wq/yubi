import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {randomBytes} from 'node:crypto';
import {classify} from '../logic.mjs';
import {eyeIngest,eyeTick,eyeAction,eyeAlerts,dueAt,office,humanRequest,validatePlan} from './eye.mjs';import {seal,unseal} from './worker.mjs';
const c={seal,unseal},now=Date.parse('2026-09-30T12:00:00+09:00');
function env(){const db=new DatabaseSync(':memory:');for(const f of ['schema.sql','eye.sql'])db.exec(readFileSync(new URL(f,import.meta.url),'utf8'));db.exec("INSERT INTO meta VALUES('eyeInstalled','1'),('eyeMode','active'),('eyeVerified','1')");const DB={prepare(sql){let a=[];return {bind(...v){a=v;return this},async first(){return db.prepare(sql).get(...a)||null},async all(){return {results:db.prepare(sql).all(...a)}},async run(){return {meta:{changes:Number(db.prepare(sql).run(...a).changes)}}}}}};return {db,DB,IG_ACCOUNT_ID:'123',IG_ACCESS_TOKEN:'test',DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),AI:{async run(model,p){return {response:JSON.stringify(p.max_tokens===250?{safe:true}:{action:'reply',text:'どちらの地域でのお仕事をお考えですか？',facts:[],unknown:['地域'],reason:'対応地域を確認'})}}}};}
const item=(text='求人について聞きたい',mid='m1',at=now)=>({sender:{id:'456'},recipient:{id:'123'},timestamp:at,message:{mid,text}});
async function receive(e,text='求人について聞きたい',mid='m1',at=now){await eyeIngest(e,item(text,mid,at),'求人',text,c,at);}
function fake(latest='m1',send=()=>new Response(JSON.stringify({message_id:'sent1'}))){let sends=0;const old=globalThis.fetch;globalThis.fetch=async(u,p={})=>{if(p.method==='POST'){sends++;return send();}return new Response(JSON.stringify({data:[{messages:{data:[{id:latest,from:{id:'456'}}]}}]}));};return {restore(){globalThis.fetch=old},get sends(){return sends}};}
test('営業時間内は即時、夜間は翌朝9時',()=>{assert.equal(office(Date.parse('2026-09-30T19:00:00+09:00')),false);assert.equal(dueAt(now),now);assert.equal(new Date(dueAt(Date.parse('2026-09-30T19:00:00+09:00'))).toISOString(),'2026-10-01T00:00:00.000Z');});
test('受信の重複を排除し、新着で送信候補を更新',async()=>{const e=env();await receive(e);await receive(e);assert.equal(e.db.prepare('SELECT count(*) n FROM eye_events').get().n,1);await receive(e,'神戸です','m2',now+1000);assert.equal(e.db.prepare('SELECT last_in FROM eye_threads').get().last_in,now+1000);});
test('初回にAI開示して即時に一度だけ送信',async()=>{const e=env();await receive(e);const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,1);await eyeTick(e,c,now+30*60000);await eyeTick(e,c,now+35*60000);assert.equal(f.sends,1);const o=e.db.prepare('SELECT * FROM eye_outbox').get();assert.equal(o.status,'sent');assert.match(unseal(e,o.body),/DM受付のeye/);assert.match(unseal(e,o.body),/AIです/);}finally{f.restore()}});
test('人との会話希望には謝罪して停止し、引き継ぎを残す',async()=>{const e=env();await receive(e,'担当者に代わってください');assert.equal(humanRequest('担当者に代わってください'),true);const f=fake();try{await eyeTick(e,c,now+30*60000);assert.equal(f.sends,1);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'human');assert.match(unseal(e,e.db.prepare('SELECT body FROM eye_outbox').get().body),/失礼しました/);await receive(e,'早くして','m2',now+40*60000);await eyeTick(e,c,now+70*60000);assert.equal(f.sends,1);}finally{f.restore()}});
test('手動返信のechoが届いたら自動返信を止める',async()=>{const e=env();await receive(e);await eyeIngest(e,{sender:{id:'123'},recipient:{id:'456'},timestamp:now+1000,message:{mid:'manual',text:'担当です',is_echo:true}},null,'担当です',c,now+1000);const f=fake();try{await eyeTick(e,c,now+30*60000);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'manual');}finally{f.restore()}});
test('Instagramに未同期の新着がある場合は送らない',async()=>{const e=env();await receive(e);const f=fake('m2');try{await eyeTick(e,c,now+30*60000);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'human');}finally{f.restore()}});
test('送信結果不明は再送もスマホ再開も拒否',async()=>{const e=env();await receive(e);const f=fake('m1',()=>{throw Error('network')});try{await eyeTick(e,c,now+30*60000);await eyeTick(e,c,now+35*60000);assert.equal(f.sends,1);assert.equal(e.db.prepare('SELECT status FROM eye_outbox').get().status,'uncertain');await assert.rejects(()=>eyeAction(e,'state',{peer:e.db.prepare('SELECT peer FROM eye_threads').get().peer,state:'active'},c,now),/送信結果/);}finally{f.restore()}});
test('金額はモデルで勝手に作らず担当に回す',async()=>{const e=env();e.AI.run=()=>{throw Error('AI should not run')};await receive(e,'日給いくらですか');const f=fake();try{await eyeTick(e,c,now+30*60000);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'human');assert.equal(f.sends,1);}finally{f.restore()}});
test('全体停止は送信しない、結果照合なしではLINE完了不可',async()=>{const e=env();await receive(e);await eyeAction(e,'mode',{mode:'paused'},c,now);const f=fake();try{await eyeTick(e,c,now+30*60000);assert.equal(f.sends,0);await assert.rejects(()=>eyeAction(e,'state',{peer:e.db.prepare('SELECT peer FROM eye_threads').get().peer,state:'handed_off'},c,now),/LINE/);}finally{f.restore()}});
test('通知に失敗すると案件を残し、成功時だけ通知済み',async()=>{const e=env();await receive(e,'人と話したい');e.db.prepare('INSERT INTO subscriptions VALUES(?,?,0)').run('s',seal(e,'https://web.push.apple.com/test'));await eyeAlerts(e,c,async()=>{throw Error('fail')},now);assert.equal(e.db.prepare('SELECT notified FROM eye_threads').get().notified,0);await eyeAlerts(e,c,async()=>true,now+6*60000);assert.equal(e.db.prepare('SELECT notified FROM eye_threads').get().notified,now);});
test('出典のない事実と未確認金額を拒否',()=>{assert.throws(()=>validatePlan({action:'reply',text:'日給15000円です',facts:[],unknown:[],reason:'x'},[]));assert.throws(()=>validatePlan({action:'reply',text:'こんにちは',facts:[{text:'経験10年',source:'madeup'}],unknown:[],reason:'x'},[]));});
test('生成中の新着があれば古い返信を送らない',async()=>{const e=env();await receive(e);let once=true;const original=e.AI.run;e.AI.run=async(...a)=>{if(once){once=false;await receive(e,'訂正します','m2',now+1000);}return original(...a)};const f=fake('m2');try{await eyeTick(e,c,now+30*60000);assert.equal(f.sends,0);}finally{f.restore()}});
test('LINE案内と照合完了は別状態、メモは暗号化',async()=>{const e=env();await receive(e);e.AI.run=async(_,p)=>({response:JSON.stringify(p.max_tokens===250?{safe:true}:{action:'line',text:'詳しいお話はLINEで進めましょう。',facts:[],unknown:[],reason:'聞き取り済み'})});const f=fake();try{await eyeTick(e,c,now+30*60000);let t=e.db.prepare('SELECT * FROM eye_threads').get();assert.equal(t.state,'line');await eyeAction(e,'state',{peer:t.peer,state:'handed_off',note:'照合テスト'},c,now+31*60000);t=e.db.prepare('SELECT * FROM eye_threads').get();assert.equal(t.state,'handed_off');assert.ok(!t.summary.includes('照合テスト'));assert.match(unseal(e,t.summary),/照合テスト/);}finally{f.restore()}});
test('BOT疑いは返信せず停止する',async()=>{const e=env();await receive(e);e.AI.run=async(_,p)=>({response:JSON.stringify(p.max_tokens===250?{safe:true}:{action:'bot',text:'',facts:[],unknown:[],reason:'無関係な同文とリンクを反復'})});const f=fake();try{await eyeTick(e,c,now+30*60000);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'bot');}finally{f.restore()}});
test('7往復後も必要な聞き取りを続けられる',async()=>{const e=env();await receive(e);e.db.prepare('UPDATE eye_threads SET turns=7').run();const f=fake();try{await eyeTick(e,c,now+30*60000);assert.equal(f.sends,1);assert.equal(e.db.prepare('SELECT turns FROM eye_threads').get().turns,8);assert.doesNotMatch(unseal(e,e.db.prepare('SELECT body FROM eye_outbox').get().body),/笑|AIです/);}finally{f.restore()}});
test('24時間を過ぎた会話には送信しない',async()=>{const e=env();await receive(e,'求人です','m1',now-86400000);const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'human');}finally{f.restore()}});


test('用件ボタンは同一送信者・本文・時刻で照合し、新しい別DMは除外',async()=>{for(const mismatch of [false,true]){const e=env();const text='【用件ボタン】協力業者として相談したい';await receive(e,text,'synthetic-postback');const original=globalThis.fetch;let sends=0;globalThis.fetch=async(u,p={})=>{if(p.method==='POST'){sends++;return Response.json({message_id:'sent-button'})}return Response.json({data:[{messages:{data:[{id:'api-button-id',from:{id:'456'},created_time:new Date(now+(mismatch?5000:0)).toISOString(),message:'協力業者として相談したい'}]}}]})};try{await eyeTick(e,c,now+1000);assert.equal(sends,mismatch?0:1)}finally{globalThis.fetch=original}}});
test('一覧削除で返信を止め、取り消しは停止状態、新着だけ再表示',async()=>{const e=env();await receive(e);const peer=e.db.prepare('SELECT peer FROM eye_threads').get().peer;await eyeAction(e,'delete',{peer},c,now+1);assert.equal((await eyeAction(e,'status',{},c,now+2)).threads.length,0);const f=fake();try{await eyeTick(e,c,now+3);assert.equal(f.sends,0)}finally{f.restore()}await receive(e);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'deleted');await eyeAction(e,'restore',{peer},c,now+4);assert.equal(e.db.prepare('SELECT state,due FROM eye_threads').get().state,'paused');await eyeAction(e,'delete',{peer},c,now+5);await receive(e,'追加です','m2',now+1000);assert.equal((await eyeAction(e,'status',{},c,now+1001)).threads.length,1);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'active');});
test('送信結果が不明の会話は削除で隠さない',async()=>{const e=env();await receive(e);const f=fake('m1',()=>{throw Error('network')});try{await eyeTick(e,c,now);const peer=e.db.prepare('SELECT peer FROM eye_threads').get().peer;await assert.rejects(()=>eyeAction(e,'delete',{peer},c,now+1),/送信中または送信結果/);assert.equal((await eyeAction(e,'status',{},c,now+2)).threads.length,1)}finally{f.restore()}});
test('生成中の削除は返信せずエラー時も再表示しない',async()=>{const e=env();await receive(e);const peer=e.db.prepare('SELECT peer FROM eye_threads').get().peer;e.AI.run=async()=>{await eyeAction(e,'delete',{peer},c,now+1);throw Error('generation failed')};const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'deleted')}finally{f.restore()}});
test('30回を超えてもAI作成と検品を維持して返信できる',async()=>{const e=env();e.db.prepare("INSERT INTO meta VALUES('eyeAI:2026-09-30','30')").run();await receive(e);const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,1);assert.equal(e.db.prepare("SELECT v FROM meta WHERE k='eyeAI:2026-09-30'").get().v,'32')}finally{f.restore()}});
test('プロバイダーの無料枠上限で未検品の返信は送らない',async()=>{const e=env();await receive(e);e.AI.run=async()=>{throw Error('daily free allocation exceeded')};const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'human')}finally{f.restore()}});
test('LINE案内後のお礼にも返信し、追加の質問を再受付する',async()=>{const e=env();await receive(e);e.AI.run=async(_,p)=>({response:JSON.stringify(p.max_tokens===250?{safe:true}:{action:'line',text:'続きはLINEでご相談いただけますか？',facts:[],unknown:[],reason:'引き継ぎ'})});let f=fake();try{await eyeTick(e,c,now)}finally{f.restore()}await receive(e,'ありがとうございます','m2',now+1000);let sawContext=false;e.AI.run=async(_,p)=>{if(p.max_tokens===250)return {response:'{"safe":true}'};sawContext=JSON.parse(p.messages[1].content).lineGuided;assert.match(p.messages[0].content,/催促・誘導文/);return {response:JSON.stringify({action:'close',text:'こちらこそ、ありがとうございます！',facts:[],unknown:[],reason:'お礼への返信'})}};f=fake('m2',()=>Response.json({message_id:'sent2'}));try{await eyeTick(e,c,now+1000);assert.equal(f.sends,1);assert.equal(sawContext,true);const o=e.db.prepare("SELECT body FROM eye_outbox WHERE sent_id='sent2'").get();assert.doesNotMatch(unseal(e,o.body),/lin\.ee|追加後|DM受付/);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'line')}finally{f.restore()}await receive(e,'大阪も対応されていますか','m3',now+2000);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'active');});
test('LINE案内済みでも所有者の停止や引き継ぎ完了を勝手に解除しない',async()=>{for(const state of ['paused','manual','human','handed_off','closed']){const e=env();await receive(e);e.db.prepare('UPDATE eye_threads SET state=?').run(state);await receive(e,'ありがとうございます','m2',now+1000);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,state)}});

// All scenarios below use invented messages, in-memory DBs, and mocked services.
test('初回の苦情・威圧は仕事キーワードがなくても人へ回し返信しない',async()=>{
 for(const text of ['騒音で困っています','お前ふざけるな','支払いが未払いです','苦情です。担当者に代わって','早くしろ','工事で壁が壊された']){
  const e=env();const category=classify(text);assert.equal(category,'要確認');
  e.AI.run=()=>{throw Error('AI must not run')};
  await eyeIngest(e,item(text),category,text,c,now);
  const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state,due FROM eye_threads').get().state,'human');assert.equal(e.db.prepare('SELECT due FROM eye_threads').get().due,null);assert.equal((await eyeAction(e,'notice',{},c,now)).attention,true);}finally{f.restore()}
 }
});
test('保留中の続投や人の対応希望で手動停止・引継ぎ完了を解除しない',async()=>{
 for(const state of ['paused','manual','human','handed_off','closed','bot']){
  const e=env();await receive(e);e.db.prepare('UPDATE eye_threads SET state=?').run(state);
  await receive(e,'担当者と話したい。ふざけるな','m2',now+1000);
  assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,state);
 }
});
test('判断困難ないたずらの疑いは無返信の人確認とし、既存メモを保つ',async()=>{
 const e=env();await receive(e,'宇宙で働きたいかも');
 e.db.prepare('UPDATE eye_threads SET summary=?').run(seal(e,JSON.stringify({facts:[{text:'架空の既知情報',source:'old'}],unknown:['地域'],ownerNote:'確認用メモ'})));
 e.AI.run=async()=>({response:JSON.stringify({action:'review',text:'',facts:[],unknown:['相談意図'],reason:'相談か冗談か判断困難'})});
 const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,0);const t=e.db.prepare('SELECT * FROM eye_threads').get();assert.equal(t.state,'human');const s=JSON.parse(unseal(e,t.summary));assert.equal(s.ownerNote,'確認用メモ');assert.equal(s.facts.length,1);assert.deepEqual(s.unknown,['地域','相談意図']);assert.equal((await eyeAction(e,'notice',{},c,now)).attention,true);}finally{f.restore()}
});
test('明白に無関係ないたずらは検品後に無返信で停止し、続投にも反応しない',async()=>{
 const e=env();await receive(e,'求人とは関係なくからかいに来ただけ');let reviews=0;
 e.AI.run=async(_,p)=>{if(p.max_tokens===250){reviews++;assert.equal(JSON.parse(p.messages[1].content).action,'none');return {response:'{"safe":true}'}}return {response:JSON.stringify({action:'none',text:'',facts:[],unknown:[],reason:'相談なし、からかいのみ'})}};
 const f=fake();try{await eyeTick(e,c,now);await receive(e,'また来た','m2',now+1000);await eyeTick(e,c,now+1000);assert.equal(f.sends,0);assert.equal(reviews,1);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'paused')}finally{f.restore()}
});
test('相談の誤除外はnone・bot・closeの検品でも人へ回す',async()=>{
 for(const action of ['none','bot','close']){
  const e=env();await receive(e,'対応について相談があります');
  e.AI.run=async(_,p)=>({response:JSON.stringify(p.max_tokens===250?{safe:false}:{action,text:'',facts:[],unknown:[],reason:'誤分類のテスト'})});
  const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'human')}finally{f.restore()}
 }
});
test('挑発や警告を含む返信候補は検品前でも止める',()=>{
 for(const text of ['落ち着いてください','通報します','ブロックします','いたずらはお断りです','バカにしないで'])assert.throws(()=>validatePlan({action:'reply',text,facts:[],unknown:[],reason:'候補'},[]),/検品/);
});
test('短文・外国語・絵文字・冗談まじりの相談を自動的に排除しない',async()=>{
 for(const text of ['求人','Hello, jobs?','👷','求人あります？笑']){
  const e=env();await receive(e,text);let calls=0;const original=e.AI.run;
  e.AI.run=async(...args)=>{calls++;assert.match(args[1].messages[0].content,/正当な苦情/);assert.match(args[1].messages[0].content,/反論・皮肉・挑発/);return original(...args)};
  const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,1);assert.equal(calls,2)}finally{f.restore()}
 }
});
test('既存LINE会話の威圧も無返信の確認待ちにする',async()=>{
 const e=env();await receive(e);e.db.prepare("UPDATE eye_threads SET state='line'").run();await receive(e,'いい加減にしろ','m2',now+1000);
 const f=fake('m2');try{await eyeTick(e,c,now+1000);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'human')}finally{f.restore()}
});
test('旧版で受信済みの強い表現も送信前に確認待ちへ回す',async()=>{
 const e=env();await receive(e,'お前ふざけるな');e.db.prepare("UPDATE eye_threads SET state='active',due=?").run(now);
 const f=fake();try{await eyeTick(e,c,now);assert.equal(f.sends,0);assert.equal(e.db.prepare('SELECT state FROM eye_threads').get().state,'human')}finally{f.restore()}
});
test('無返信の引継ぎも既存の要対応通知へ載る',async()=>{
 const e=env();await receive(e,'騒音に困っています');e.db.prepare('INSERT INTO subscriptions VALUES(?,?,0)').run('s',seal(e,'https://web.push.apple.com/test'));let notices=0;
 await eyeAlerts(e,c,async()=>{notices++;return true},now);assert.equal(notices,1);assert.equal(e.db.prepare('SELECT notified FROM eye_threads').get().notified,now);
});
