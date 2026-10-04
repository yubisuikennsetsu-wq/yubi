const time=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
export function reschedulePlan(job,due,snapshot,now=Date.now()){
 const eligible=j=>j&&['draft','scheduled'].includes(j.status)&&j.due>now+3600000&&!j.media_id&&!j.published;
 if(!eligible(job))throw Error('公開1時間前までの未処理の下書き・予約済みが対象です。');
 const local=new Date(due+9*3600000),day=local.toISOString().slice(0,10);
 if(!Number.isSafeInteger(due)||due<=now+3600000||due>now+28*86400000||local.getUTCHours()!==(job.kind==='story'?11:16)||local.getUTCMinutes()!==0)throw Error('1時間後から28日後までの公開日を指定してください。');
 const slot=day+':'+job.kind,rows=[...snapshot.jobs,...(snapshot.hiddenJobs||[])];
 if(rows.some(j=>j.slot.startsWith(slot+':')||j.slot.startsWith(job.slot+':'))||job.slot.split(':').length!==2)throw Error('複数枚ストーリーがある枠は変更できません。');
 const other=rows.find(j=>j.slot===slot&&j.id!==job.id);
 if(other&&!eligible(other))throw Error('移動先には変更できない予約があります。別の日を選んでください。');
 return {other,payload:{id:job.id,expectedUpdated:job.updated,due,...(other?{swapId:other.id,swapExpectedUpdated:other.updated,swapConfirmed:true}:{})},expected:[{...job,due},...(other?[{...other,due:job.due}]:[])]};
}
export function verifyReschedule(snapshot,expected){
 for(const old of expected){const j=snapshot.jobs.find(x=>x.id===old.id);if(!j||j.due!==old.due||j.status!==old.status||j.asset_id!==old.asset_id||!!j.weather_preview!==!!old.weather_preview||j.caption!==old.caption||j.kind!==old.kind)throw Error('変更結果を確認できません。再操作せず、投稿予定を読み直してください。');}
}
export function rescheduleButton(job,{api,refresh,message}){
 const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='日時を変更';button.dataset.reschedule=job.id;
 button.onclick=async()=>{
  if(button.disabled)return;button.disabled=true;
  const dialog=document.createElement('dialog');dialog.className='social-reschedule';
  try{
   const snapshot=await api('status'),current=snapshot.jobs.find(j=>j.id===job.id);if(!current)throw Error('最新の予約を確認してください。');
   const title=document.createElement('h2');title.textContent='公開日時を変更';
   const info=document.createElement('p');info.textContent=time(current.due)+'（日本時間）\n'+current.caption+'\n'+(current.weather_preview?'予報更新待ち・公開不可のまま移動します。':'素材・本文・公開状態は変更しません。');
   const label=document.createElement('label');label.textContent='変更先の日付（日本時間）';
   const date=document.createElement('input');date.type='date';date.required=true;date.value=new Date(current.due+9*3600000).toISOString().slice(0,10);label.append(date);
   const target=document.createElement('p'),swapLabel=document.createElement('label'),swap=document.createElement('input');swap.type='checkbox';swapLabel.append(swap,document.createTextNode('表示された2件の日時を入れ替えることを確認しました。'));swapLabel.hidden=true;
   const save=document.createElement('button');save.type='button';save.className='primary';save.textContent='日時を変更する';
   const cancel=document.createElement('button');cancel.type='button';cancel.textContent='閉じる';cancel.className='secondary';cancel.onclick=()=>dialog.close();
   const result=document.createElement('p');result.setAttribute('role','status');
   let plan,busy=false,done=false;
   function update(){swap.checked=false;try{const due=Date.parse(date.value+'T'+(current.kind==='story'?'11':'16')+':00:00+09:00');plan=reschedulePlan(current,due,snapshot);target.textContent=plan.other?'入替え相手：'+time(plan.other.due)+'\n'+plan.other.caption+'\nこの予約を '+time(current.due)+' へ移します。':'移動先：'+time(due)+'（日本時間）';swapLabel.hidden=!plan.other;save.textContent=plan.other?'2件の日時を入れ替える':'日時を変更する';save.disabled=due===current.due||!!plan.other;result.textContent='';}catch(e){plan=null;save.disabled=true;target.textContent=e.message;swapLabel.hidden=true;}}
   date.onchange=update;swap.onchange=()=>{save.disabled=!plan||!!plan.other&&!swap.checked;};
   dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
   save.onclick=async()=>{
    if(busy||done||!plan||plan.other&&!swap.checked)return;busy=true;save.disabled=true;cancel.disabled=true;date.disabled=true;swap.disabled=true;result.textContent='変更結果を確認しています…';
    try{
     let writeError;try{await api('reschedule',plan.payload);}catch(e){writeError=e;}
     const after=await api('status');try{verifyReschedule(after,plan.expected);}catch(e){throw writeError||e;}
     done=true;await refresh();result.textContent='日時の変更を確認しました。素材と公開状態は維持されています。';message(result.textContent);
    }catch(e){done=true;result.textContent=e.message+' 再操作する前に、この画面を閉じて投稿予定を更新してください。';}
    finally{busy=false;cancel.disabled=false;}
   };
   dialog.append(title,info,label,target,swapLabel,save,cancel,result);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});update();dialog.showModal();
  }catch(e){message(e.message);dialog.remove();}finally{button.disabled=false;}
 };
 return button;
}
