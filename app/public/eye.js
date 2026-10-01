import {replyState} from './conversations.mjs';
const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
let data={threads:[]},filter='all';
const labels={awaiting_new:'次のDMを受付待ち',active:'eye対応中',human_pending:'人への切り替え待ち',human:'人の対応待ち',manual:'手動対応中',bot:'BOT疑い・停止',line:'LINE引き継ぎ待ち',handed_off:'LINE引き継ぎ済み',paused:'停止中',closed:'終了'};
async function api(action,p){const r=await fetch('/api/eye/'+action,{method:p?'POST':'GET',headers:p?{'Content-Type':'application/json'}:{},body:p?JSON.stringify(p):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'接続を確認してください');return d;}
function note(t){$('#notice').textContent=t;}
async function act(action,p){try{await api(action,p);await refresh();note('保存しました');}catch(e){note(e.message);}}
function button(text,fn){const b=el('button',text);b.onclick=fn;return b;}
async function removeConversation(t){
 if(!confirm('この会話をアプリの一覧から削除しますか？\nInstagramのDMは残ります。予約中の返信は停止し、新しいDMが届くと再表示します。'))return;
 try{await api('delete',{peer:t.peer});await refresh();note('一覧から削除しました。');$('#notice').append(button('取り消す',async()=>{try{await api('restore',{peer:t.peer});await refresh();note('元に戻しました。自動返信は停止中です。');}catch(e){note(e.message);}}));}catch(e){note(e.message);}
}
function render(){
 $('#mode').textContent=data.mode==='active'?'自動受付：稼働中':data.mode==='unavailable'?'導入準備中':'自動受付：停止中';
 $('#pause').hidden=data.mode!=='active';$('#start').hidden=data.mode==='active'||!data.verified;$('#start').disabled=!data.verified;$('#start').textContent='自動受付を開始';
 $('#delivery').textContent=data.deliveryVerified?'Instagramへの送信成功実績あり':'実際のDMへの送信成功は、次の対象DMで確認します。';
 $('#threads').replaceChildren();let rows=data.threads.filter(t=>filter==='all'||filter==='line'&&t.state==='line'||filter==='attention'&&['human','human_pending','bot','manual'].includes(t.state)).sort((a,b)=>Number(replyState(b.history,b.outbox).unanswered)-Number(replyState(a.history,a.outbox).unanswered)||b.updated-a.updated);
 if(!rows.length)$('#threads').append(el('p','この条件の会話はありません。開始後に届く仕事DMから表示します。'));
 for(const t of rows){const reply=replyState(t.history,t.outbox),card=el('details');card.className='eye-panel conversation';card.open=reply.unanswered;if(['human','human_pending','bot'].includes(t.state))card.classList.add('eye-alert');const heading=el('summary');heading.className='conversation-heading';heading.append(el('b',t.displayName||'Instagramの相談 '+t.peer.slice(0,6)),el('span',reply.label),el('small',labels[t.state]||t.state));card.append(heading);const state=el('p',labels[t.state]||t.state);state.className='eye-state';card.append(state,el('p',t.reason||''));
 const remove=button('削除',event=>{event.preventDefault();event.stopPropagation();removeConversation(t);});remove.className='conversation-delete';remove.setAttribute('aria-label',(t.displayName||'この会話')+'を一覧から削除');heading.insertBefore(remove,heading.querySelector('small'));
 if(t.due)card.append(el('p','返信予定：'+new Date(t.due).toLocaleString('ja-JP')));
 card.append(el('small',`返信 ${t.turns} 通 · 通知${t.notified>=t.updated?'サービス受付済み':'未送信／対象外'} · ${t.acknowledged>=t.updated?'確認済み':'未確認'}`));
 const summary=el('details');summary.open=true;summary.append(el('summary','聞き取り・引き継ぎメモ'));if(t.summary){if(t.summary.reason)summary.append(el('p','判断理由：'+t.summary.reason));if(t.summary.latestRequest)summary.append(el('p','直近の相談：'+t.summary.latestRequest));for(const f of t.summary.facts||[])summary.append(el('p','• '+f.text));for(const u of t.summary.unknown||[])summary.append(el('p','未確認：'+u));if(t.summary.lineMatch)summary.append(el('p','LINE照合：'+t.summary.lineMatch));}else summary.append(el('p','まだ要約はありません。下の会話原文を確認してください。'));card.append(summary);
 if(reply.unanswered){const latest=t.history.filter(x=>x.role==='相手').at(-1);if(latest){const latestBox=el('p',latest.text);latestBox.className='eye-bubble';card.append(latestBox);}}
 const history=el('details');history.append(el('summary','会話と送信結果'));for(const m of t.history){const b=el('div',m.role+' · '+new Date(m.at).toLocaleString('ja-JP')+'\n'+m.text);b.className='eye-bubble'+(m.role==='会社'?' out':'');history.append(b);}for(const o of t.outbox.filter(x=>x.status!=='sent'))history.append(el('p','送信状態：'+o.status+'\n'+o.body));card.append(history);
 const actions=el('div');actions.className='eye-actions';if(t.acknowledged<t.updated&&['human','human_pending','bot','manual','line'].includes(t.state))actions.append(button('確認済みにする',()=>act('ack',{peer:t.peer})));
 const controls=el('details');controls.append(el('summary','対応メモ・受付の操作'));const ops=el('div');ops.className='eye-actions';
 if(['active','human_pending'].includes(t.state))ops.append(button('この会話を停止',()=>act('state',{peer:t.peer,state:'paused'})));
 else if(!['closed','handed_off'].includes(t.state)&&data.verified)ops.append(button('eyeを再開',()=>{if(confirm('最新の会話を確認しましたか？ eyeが自動で返信を再開します。'))act('state',{peer:t.peer,state:'active'});}));
 if(!['closed','handed_off'].includes(t.state))ops.append(button('対応を終了',()=>act('state',{peer:t.peer,state:'closed'})));
 const link=el('a','Instagramで返信 ↗');link.href='https://www.instagram.com/direct/inbox/';link.target='_blank';link.rel='noopener';actions.append(link);card.append(actions);
 if(t.outbox.some(x=>x.status==='uncertain'))for(const [result,label] of [['delivered','Instagramで到着を確認'],['not_delivered','Instagramで未送信を確認']])actions.append(button(label,()=>{if(confirm('Instagramの会話を実際に確認しましたか？ この操作で自動再送はしません。'))act('resolve',{peer:t.peer,result,confirmed:true});}));
 const memoLabel=el('label','担当者の対応メモ'),memo=el('textarea');memo.rows=3;memo.value=t.summary?.ownerNote||'';memo.placeholder='対応内容・確認した条件など（相手には送信しません）';memoLabel.append(memo);controls.append(memoLabel,button('メモを保存',()=>act('note',{peer:t.peer,note:memo.value})),ops);card.append(controls);
 if(t.state==='line'){const l=el('label','照合したLINEの表示名・メモ'),input=el('input');input.placeholder='Instagram名と照合して入力';l.append(input);card.append(l,button('LINE引き継ぎ完了',()=>act('state',{peer:t.peer,state:'handed_off',note:input.value})));}$('#threads').append(card);
 }
}
async function refresh(){try{await fetch('/api/messages');data=await api('status');render();}catch(e){note(e.message+'。必要な場合は仕事DM画面からログインしてください。');}}
$('#pause').onclick=()=>act('mode',{mode:'paused'});$('#start').onclick=()=>{if(confirm('通常の仕事DMへ、eyeが承認なしで返信します。開始しますか？'))act('mode',{mode:'active'});};
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));render();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});refresh();





