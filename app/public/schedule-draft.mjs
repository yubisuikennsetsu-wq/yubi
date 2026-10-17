const time=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
export function draftPlan(j,due,confirmed,now=Date.now()){
 if(!confirmed||j?.kind!=='feed'||j.status!=='draft'||j.media_id||j.published||j.container_id||j.weather_preview)throw Error('未処理の下書きの素材・本文・日時を確認してください。');
 const day=t=>new Date(t+9*3600000).toISOString().slice(0,10);
 if(!Number.isSafeInteger(due)||due<now+60000||due>now+28*86400000||day(due)!==day(j.due))throw Error('元の枠と同じ日本時間の日付で、1分後以降を指定してください。');
 return {id:j.id,expectedUpdated:j.updated,expectedAsset:j.asset_id,due,confirmed:true};
}
export async function scheduleDraft(api,j,p){
 let failure;try{await api('schedule-draft',p);}catch(e){failure=e;}
 const after=await api('status'),saved=after.jobs.find(x=>x.id===j.id);
 if(!saved||saved.status!=='scheduled'||saved.due!==p.due||saved.asset_id!==j.asset_id||saved.caption!==j.caption||saved.kind!==j.kind||saved.slot!==j.slot||saved.weather_preview)throw failure||Error('予約結果を確認できません。再送せず予定を更新してください。');
 return saved;
}
export function scheduleDraftButton(job,{api,refresh,message}){
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const button=make('button','内容を確認して公開予約');button.type='button';button.dataset.scheduleDraft=job.id;
 button.onclick=async()=>{
  if(button.disabled)return;button.disabled=true;
  const dialog=make('dialog');dialog.className='social-reschedule';
  let busy=false,done=false;
  dialog.addEventListener('close',()=>{dialog.remove();button.disabled=false;},{once:true});
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  try{
   const snapshot=await api('status'),j=snapshot.jobs.find(x=>x.id===job.id);
   if(!j||j.status!=='draft')throw Error('最新の下書きを確認してください。');
   const media=make(j.media_type==='video'?'video':'img');media.src='/social-media/'+j.asset_id+(j.media_type==='video'?'.mp4':'.jpg');media.className='social-thumb';media.controls=true;media.playsInline=true;media.preload='metadata';media.alt='公開予約する保存済み素材';
   const dateLabel=make('label','公開日時（日本時間・同じ日付のみ）'),date=make('input');date.type='datetime-local';date.value=new Date(Math.max(j.due,Math.ceil((Date.now()+5*60000)/60000)*60000)+9*3600000).toISOString().slice(0,16);dateLabel.append(date);
   const label=make('label'),check=make('input');check.type='checkbox';label.append(check,document.createTextNode('素材を再生・確認し、本文と公開日時を確認しました'));
   const save=make('button','この内容で公開予約する'),cancel=make('button','中止'),result=make('p');save.type=cancel.type='button';save.disabled=true;result.setAttribute('role','status');
   check.onchange=()=>{save.disabled=!check.checked||done;};date.oninput=()=>{check.checked=false;save.disabled=true;};cancel.onclick=()=>dialog.close();
   save.onclick=async()=>{
    if(busy||done||!check.checked)return;
    let p;try{p=draftPlan(j,Date.parse(date.value+':00+09:00'),check.checked);}catch(e){result.textContent=e.message;return;}
    busy=true;save.disabled=cancel.disabled=date.disabled=check.disabled=true;
    try{await scheduleDraft(api,j,p);done=true;await refresh();result.textContent='公開予約を確認しました：'+time(p.due)+'（日本時間）';message(result.textContent);}
    catch(e){done=true;result.textContent=e.message+' この画面を閉じて予定を更新してください。自動再送はしません。';}
    finally{busy=false;cancel.disabled=false;}
   };
   dialog.append(make('h2','保存済みの内容を確認'),media,make('p',j.caption),dateLabel,label,save,cancel,result);document.body.append(dialog);dialog.showModal();
  }catch(e){message(e.message);dialog.remove();button.disabled=false;}
 };
 return button;
}
