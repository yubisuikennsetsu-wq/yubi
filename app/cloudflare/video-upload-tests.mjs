import test from 'node:test';import assert from 'node:assert/strict';
import {buildMediaPayload,verifySavedMedia,validateUploadFile} from '../public/video-upload.mjs';
const now=Date.parse('2026-10-04T04:00:00+09:00'),file={name:'20261005_feed.mp4',size:250000};
const fields={kind:'feed',category:'求人',date:'2026-10-05',time:'16:00',caption:'求人についてプロフィールのメッセージからご相談ください。',mode:'draft',checked:true};
test('ブラウザのタイムゾーンによらず日本時間を保存し、下書きと予約を区別する',()=>{
 const p=buildMediaPayload(fields,file,'bytes',now);assert.equal(p.due,Date.parse('2026-10-05T07:00:00Z'));assert.equal(p.hold,true);
 assert.equal(buildMediaPayload({...fields,kind:'story',time:'11:00',mode:'scheduled'},file,'bytes',now).due,Date.parse('2026-10-05T02:00:00Z'));
 assert.equal(buildMediaPayload({...fields,mode:'scheduled'},file,'bytes',now).hold,false);
 for(const change of [{time:'11:00'},{date:'2026-10-03'},{date:'2026-02-30'},{mode:'publish-now'},{checked:false},{caption:'https://example.test'}])assert.throws(()=>buildMediaPayload({...fields,...change},file,'bytes',now));
});
test('未完成テンプレート・非MP4・上限超過を送信前に拒否する',()=>{
 for(const f of [null,{...file,name:'20261011_DO_NOT_POST_template.mp4'},{...file,name:'天気テンプレート.mp4'},{...file,name:'a.png'},{...file,size:1500001}])assert.throws(()=>validateUploadFile(f));
});
test('成功表示にはIDと種類・本文・日時・動画・状態の読戻し一致が必要',()=>{
 const p=buildMediaPayload(fields,file,'bytes',now),j={id:'saved',...p,media_type:'video',status:'draft'};
 assert.equal(verifySavedMedia({id:'saved'},{jobs:[j]},p),j);
 for(const change of [{id:'other'},{kind:'story'},{caption:'other'},{due:p.due+1},{media_type:'image'},{status:'scheduled'}])assert.throws(()=>verifySavedMedia({id:'saved'},{jobs:[{...j,...change}]},p));
});

import {changeCancelledVisibility,verifyCancelledVisibility} from '../public/cancelled-visibility.mjs';
test('削除後の通信失敗は読戻しで判断し、書込みを自動再送しない',async()=>{
 const job={id:'cancelled',status:'cancelled',updated:123},calls=[];
 const api=async(path)=>{calls.push(path);if(path==='hide-cancelled')throw Error('lost response');return {jobs:[],hiddenJobs:[job]};};
 await changeCancelledVisibility(api,job,true);assert.deepEqual(calls,['hide-cancelled','status']);
 assert.throws(()=>verifyCancelledVisibility({jobs:[job],hiddenJobs:[]},job.id,true));
 assert.throws(()=>verifyCancelledVisibility({jobs:[],hiddenJobs:[job]},job.id,false));
 await assert.rejects(()=>changeCancelledVisibility(async()=>{throw Error('offline');},job,true),/offline/);
 await assert.rejects(()=>changeCancelledVisibility(api,{...job,status:'scheduled'},true));
});

test('天気プレビューの正直な下書き確認を受け付け、公開予約と読戻しフラグ不一致を拒否する',()=>{
 const template={...file,name:'20261011_weather_template.mp4'},preview={...fields,kind:'story',time:'11:00',weatherPreview:true};
 const p=buildMediaPayload(preview,template,'bytes',now);assert.equal(p.hold,true);assert.equal(p.weatherPreview,true);
 assert.throws(()=>buildMediaPayload({...preview,mode:'scheduled'},template,'bytes',now));assert.throws(()=>buildMediaPayload({...preview,weatherPreview:false},template,'bytes',now));
 const job={id:'p',...p,status:'draft',media_type:'video',weather_preview:1};assert.equal(verifySavedMedia({id:'p'},{jobs:[job]},p),job);assert.throws(()=>verifySavedMedia({id:'p'},{jobs:[{...job,weather_preview:0}]},p));
});

import {reschedulePlan,verifyReschedule} from '../public/reschedule.mjs';
test('日時変更UIは2件入替えを明示し、公開不可フラグ・素材・状態の読戻しまで確認する',()=>{
 const a={id:'a',kind:'story',slot:'2026-10-09:story',due:Date.parse('2026-10-09T11:00:00+09:00'),status:'draft',asset_id:'weather',weather_preview:1,caption:'確認用',updated:1};
 const b={...a,id:'b',slot:'2026-10-11:story',due:Date.parse('2026-10-11T11:00:00+09:00'),status:'scheduled',asset_id:'finished',weather_preview:0};
 const plan=reschedulePlan(a,b.due,{jobs:[a,b]},now);assert.equal(plan.payload.swapId,b.id);assert.equal(plan.expected[0].status,'draft');assert.equal(plan.expected[1].due,a.due);
 verifyReschedule({jobs:plan.expected},plan.expected);
 assert.throws(()=>verifyReschedule({jobs:[{...plan.expected[0],weather_preview:0},plan.expected[1]]},plan.expected));
 assert.throws(()=>reschedulePlan(a,b.due,{jobs:[a],hiddenJobs:[{...b,status:'cancelled'}]},now));
});

test('本日の遅延受付は明示確認し11時枠を保持、UTC15時で前日分を拒否する',()=>{
 const f={...fields,kind:'story',date:'2026-10-12',time:'11:00',mode:'scheduled'},n=Date.parse('2026-10-12T14:59:59Z');
 assert.throws(()=>buildMediaPayload(f,file,'bytes',n),/遅延投稿/);
 const p=buildMediaPayload({...f,lateToday:true},file,'bytes',n);assert.equal(p.lateToday,true);assert.equal(p.due,Date.parse('2026-10-12T02:00:00Z'));
 assert.throws(()=>buildMediaPayload({...f,lateToday:true},file,'bytes',n+1000));
 const next=buildMediaPayload({...f,date:'2026-10-13'},file,'bytes',n);assert.equal(next.lateToday,false);assert.equal(next.due,Date.parse('2026-10-13T02:00:00Z'));
});

test('ストーリー掲載順を明示し、feedの不正な2枚目を拒否し、天気下書きの2枚目を受け付ける',()=>{
 const story={...fields,kind:'story',time:'11:00',frame:2};assert.equal(buildMediaPayload(story,file,'bytes',now).frame,2);assert.equal(buildMediaPayload({...story,weatherPreview:true},file,'bytes',now).frame,2);assert.throws(()=>buildMediaPayload({...story,weatherPreview:true,mode:'scheduled'},file,'bytes',now));
 for(const change of [{frame:0},{frame:4},{frame:1.5},{kind:'feed',time:'16:00'}])assert.throws(()=>buildMediaPayload({...story,...change},file,'bytes',now));
 const p=buildMediaPayload(story,file,'bytes',now),j={id:'s',...p,slot:'2026-10-05:story:02',status:'draft',media_type:'video'};verifySavedMedia({id:'s'},{jobs:[j]},p);assert.throws(()=>verifySavedMedia({id:'s'},{jobs:[{...j,slot:'2026-10-05:story'}]},p));
});
