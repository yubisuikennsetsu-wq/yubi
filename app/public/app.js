import {groupedMessages} from './conversations.mjs';
const $=s=>document.querySelector(s);
let status={},filter="未対応";
let live=[],threads=[];
function toast(s){$('#toast').textContent=s;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,4500);}
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function show(view){$('#inbox-view').hidden=view!=='inbox';$('#settings-view').hidden=view!=='settings';document.querySelectorAll('[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===view));}
function render(){
 const source=groupedMessages(live,threads);$('#pending-count').textContent=source.filter(g=>!g.done).length;
 const rows=source.filter(g=>filter==='すべて'||(filter==='未対応'?!g.done:filter==='対応済み'?g.done:g.messages.some(m=>m.category===filter)));$('#messages').replaceChildren();
 if(!rows.length){const empty=el('div',undefined,'empty');empty.append(el('b',status.authenticated?'表示できる仕事DMはありません':'Instagramの接続を待っています'),el('span','通知・接続設定から準備状況をご確認ください。'));$('#messages').append(empty);return;}
 for(const g of rows){const m=g.latest,card=el('details',undefined,'message conversation');card.open=g.reply.unanswered;const top=el('summary',undefined,'conversation-heading');top.append(el('b',m.sender),el('span',g.reply.label,'category'),el('small',g.messages.length+'件 · '+new Date(m.received).toLocaleString('ja-JP')));card.append(top);
 const t=g.thread;if(t?.summary){const box=el('div',undefined,'conversation-summary');box.append(el('b','会話のまとめ'));for(const f of t.summary.facts||[])box.append(el('p','• '+f.text));for(const u of t.summary.unknown||[])box.append(el('p','未確認：'+u));if(t.summary.latestRequest)box.append(el('p','直近の相談：'+t.summary.latestRequest));if(t.summary.ownerNote)box.append(el('p','対応メモ：'+t.summary.ownerNote));card.append(box);}
 const h=t?.history?.length?t.history:g.messages.slice().reverse().map(x=>({role:'相手',text:x.body,at:x.received}));const latest=h.at(-1);if(latest)card.append(el('p',(latest.role==='会社'?'返信：':'相手：')+latest.text,'message-body'));
 const past=el('details');past.append(el('summary','これまでのやり取り'));for(const x of h)past.append(el('p',x.role+' · '+new Date(x.at).toLocaleString('ja-JP')+'\n'+x.text,'message-body'));card.append(past);
 const actions=el('div',undefined,'action-row');const done=el('button',g.done?'未対応に戻す':'対応済みにする');done.onclick=async()=>{try{for(const x of g.messages){await api('/api/messages/done',{id:x.id,done:!g.done});x.done=!g.done;}render();toast('会話の状態を保存しました');}catch(e){await refresh();toast(e.message);}};const link=el('a',t?'eyeで対応・確認 →':'Instagramで確認 ↗');link.href=t?'/eye.html':'https://www.instagram.com/direct/inbox/';actions.append(done,link);
 if(g.done){const remove=el('button','削除','delete-button');remove.onclick=async()=>{if(!confirm('この会話の対応済み受信DMをアプリから削除しますか？ InstagramのDMは残ります。'))return;try{for(const x of g.messages)await api('/api/messages/delete',{id:x.id});await refresh();}catch(e){toast(e.message);}};actions.append(remove);}card.append(actions);$('#messages').append(card);}
}
async function api(url,payload){const r=await fetch(url,{method:payload?'POST':'GET',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'接続を確認してください');return d;}
async function refresh(){try{status=await api('/api/status');$('#ig-status').textContent=status.lastReceipt?'受信実績あり':status.instagramConfigured?'連携設定済み・受信テスト待ち':'まだ接続されていません';$('#login-status').textContent=status.authenticated?'ログイン済み':status.hasOwnerPassword?'所有者ログインが必要です':'公開時にアプリ専用パスワードを設定します。';if(status.authenticated){live=await api('/api/messages');threads=(await api('/api/eye/status')).threads||[];const eye=await api('/api/eye/notice');const badge=document.getElementById("eye-count"),alert=document.getElementById("eye-attention");if(badge){badge.hidden=!eye.count;badge.textContent=eye.count||'';}if(alert){alert.hidden=!eye.attention;alert.textContent='eyeから確認のお願い '+eye.count+'件 →';}}if(status.lastReceipt){$('#connection-title').textContent='Instagramの受信を確認';$('#connection-copy').textContent='iPhoneへの通知は、この端末での通知設定が必要です。';$('.label').textContent='受信確認';}render();}catch{toast('サーバーへの接続を確認してください');}}
document.querySelectorAll('[data-view]').forEach(n=>n.onclick=()=>show(n.dataset.view));$('#settings-shortcut').onclick=()=>show('settings');$('#back').onclick=()=>show('inbox');document.querySelectorAll('[data-filter]').forEach(n=>n.onclick=()=>{filter=n.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b===n));render();});
$('#login-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/login',{password:$('#password').value});$('#password').value='';await refresh();toast('ログインしました');}catch(e){$('#login-status').textContent=e.message;}};
let sw;
if('serviceWorker'in navigator)sw=navigator.serviceWorker.register('/sw.js');
const ios=/iPhone|iPad|iPod/.test(navigator.userAgent);
$('#enable-push').onclick=async()=>{try{if(!status.secure)throw Error('公開先の準備が必要です。プレビューからはiPhone通知を開始できません。');if(!status.authenticated)throw Error('先に所有者ログインをしてください。');if(ios&&!matchMedia('(display-mode: standalone)').matches&&!navigator.standalone)throw Error('ホーム画面に追加して、そのアイコンから開いてください。');if(!('PushManager'in window)||!('Notification'in window))throw Error('この環境は通知に対応していません。');const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('通知が許可されていません。端末の設定をご確認ください。');await sw;const reg=await navigator.serviceWorker.ready;const raw=atob(status.publicKey.replace(/-/g,'+').replace(/_/g,'/'));const key=Uint8Array.from(raw,c=>c.charCodeAt(0));const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});await api('/api/subscribe',sub.toJSON());$('#push-status').textContent='この端末の通知先を登録しました。テスト通知で確認してください。';toast('通知先を登録しました');}catch(e){$('#push-status').textContent=e.message;}};
$('#test-push').onclick=async()=>{try{if(!status.secure||!status.authenticated)throw Error('公開と所有者ログインが必要です。');const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(!sub)throw Error('先に「この端末で通知を設定」を押してください。');await api('/api/push-test',{endpoint:sub.endpoint});toast('通知サービスへ送信しました。端末の到着をご確認ください。');}catch(e){$('#push-status').textContent=e.message;}};
render();refresh();


document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});



