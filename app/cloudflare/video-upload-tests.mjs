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
