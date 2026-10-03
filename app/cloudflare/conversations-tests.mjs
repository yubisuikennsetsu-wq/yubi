import test from 'node:test';import assert from 'node:assert/strict';import {replyState,groupedMessages} from '../public/conversations.mjs';
test('返信の後の新着だけを未返信とする',()=>{assert.equal(replyState([{role:'相手',at:1},{role:'会社',at:2}]).unanswered,false);assert.equal(replyState([{role:'相手',at:3},{role:'会社',at:2}]).unanswered,true)});
test('送信失敗・結果不明を返信済みにしない',()=>{assert.equal(replyState([{role:'相手',at:1}],[{created:2,status:'failed'}]).unanswered,true);assert.equal(replyState([{role:'相手',at:1}],[{created:2,status:'uncertain'}]).unanswered,true)});
test('同じ送信者IDをまとめ未返信を先頭にする',()=>{const g=groupedMessages([{peer:'a',sender:'old',received:1,body:'a'},{peer:'a',sender:'new',received:3,body:'b'},{peer:'b',sender:'b',received:2,body:'c'}],[{peer:'a',history:[{role:'会社',at:4}],outbox:[]}]);assert.equal(g.length,2);assert.equal(g[0].key,'b');assert.equal(g[1].messages.length,2);assert.equal(g[1].reply.unanswered,false)});


import {suggestReply} from '../public/reply-text.mjs';
test('要確認の手動返信案にも定型の質問を出さない',()=>{
 for(const followup of [false,true])assert.equal(suggestReply('要確認','強い表現の架空相談',followup).text,'');
});
