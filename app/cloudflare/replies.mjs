import {createHash} from 'node:crypto';
import {suggestReply} from '../public/reply-text.mjs';
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const one=(e,s,...a)=>e.DB.prepare(s).bind(...a).first();
const run=(e,s,...a)=>e.DB.prepare(s).bind(...a).run();
export async function trackDmEvent(e,item){
 const mid=item.message?.mid||item.postback&&('postback:'+item.sender?.id+':'+item.timestamp+':'+item.postback.payload);
 if(!mid)return;
 const outgoing=item.message?.is_echo||String(item.sender?.id)===e.IG_ACCOUNT_ID;
 const id=String(outgoing?item.recipient?.id||'':item.sender?.id||'');if(!id)return;
 const revision=hash(mid),now=Date.now();
 const r=await run(e,'INSERT OR IGNORE INTO dm_seen_events(id,created) VALUES(?,?)',revision,now);
 if(r.meta?.changes)await run(e,'INSERT OR REPLACE INTO dm_peer_state(peer,revision,updated) VALUES(?,?,?)',hash(id),revision,now);
}
export async function replyAction(e,action,p,{seal,unseal},now=Date.now()){
 const m=await one(e,'SELECT * FROM messages WHERE id=?',String(p.id||''));if(!m)throw Error('対象のDMが見つかりません');
 let recipient=unseal(e,m.sender);try{recipient=JSON.parse(recipient).id||recipient;}catch{}
 if(!/^\d+$/.test(recipient))throw Error('送信先を確認できません。Instagramで返信してください');
 const peer=hash(recipient),state=await one(e,'SELECT * FROM dm_peer_state WHERE peer=?',peer);
 const revision=state?.revision||m.id;
 const old=await one(e,'SELECT * FROM dm_replies WHERE message_id=?',m.id);
 if(old&&['sending','sent','uncertain'].includes(old.status))return {status:old.status,text:unseal(e,old.body),blocked:true,note:old.status==='sent'?'このDMにはアプリから返信済みです。':'送信結果をInstagramで確認してください。二重送信を防ぐため再送は停止しています。'};
 if(action==='draft'){
  const history=await one(e,"SELECT message_id FROM dm_replies WHERE peer=? AND status='sent' LIMIT 1",peer);
  const suggestion=suggestReply(m.category,unseal(e,m.body),!!history);
  const text=old?.status==='draft'&&old.revision===revision?unseal(e,old.body):suggestion.text;
  await run(e,"INSERT INTO dm_replies(message_id,peer,revision,body,status,updated) VALUES(?,?,?,?,'draft',?) ON CONFLICT(message_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,status='draft',updated=excluded.updated WHERE dm_replies.status IN ('draft','failed')",m.id,peer,revision,seal(e,text),now);
  return {status:'draft',revision,text,note:suggestion.note,canSend:now-m.received<86400000&&!m.done,expiresAt:m.received+86400000};
 }
 if(action!=='send')throw Error('操作を確認してください');
 if(p.confirmed!==true)throw Error('宛先と返信文を確認してください');
 const text=String(p.text||'').trim();if(!text||[...text].length>1000)throw Error('返信文は1〜1000文字で入力してください');
 if(m.done)throw Error('対応済みのDMです。Instagramで会話を確認してください');
 if(now-m.received>=86400000||now<m.received)throw Error('アプリから返信できる時間を過ぎています。Instagramで返信してください');
 if(!old||p.revision!==revision||old.revision!==revision)throw Error('会話が更新されました。最新のDMを確認して返信案を開き直してください');
 if(!e.IG_ACCESS_TOKEN)throw Error('Instagramの送信接続を確認してください');
 const claimed=await run(e,"UPDATE dm_replies SET status='sending',body=?,updated=? WHERE message_id=? AND status='draft' AND revision=?",seal(e,text),now,m.id,revision);
 if(!claimed.meta?.changes)throw Error('送信済み、または送信処理中です');
 try{
  const r=await fetch('https://graph.instagram.com/v25.0/'+e.IG_ACCOUNT_ID+'/messages',{method:'POST',headers:{Authorization:'Bearer '+e.IG_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({recipient:{id:recipient},message:{text}}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  const d=await r.json();
  if(!r.ok){if(r.status>=400&&r.status<500){await run(e,"UPDATE dm_replies SET status='failed',updated=? WHERE message_id=?",now,m.id);return {status:'failed',note:'Instagramが送信を受け付けませんでした（'+r.status+'/'+(Number(d.error?.code)||0)+'）。接続・権限・返信可能時間を確認してください。'};}throw Error('unknown');}
  if(!d.message_id)throw Error('unknown');
  await run(e,"UPDATE dm_replies SET status='sent',sent_id=?,updated=? WHERE message_id=?",String(d.message_id),Date.now(),m.id);
  return {status:'sent',note:'Instagramへ送信しました。'};
 }catch{
  await run(e,"UPDATE dm_replies SET status='uncertain',updated=? WHERE message_id=? AND status='sending'",Date.now(),m.id);
  return {status:'uncertain',note:'送信結果を確認できません。Instagramで確認してください。自動再送はしません。'};
 }
}
