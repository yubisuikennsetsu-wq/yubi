const MAX_BYTES=1500000;
const templateName=/template|テンプレート|投稿不可|do[\W_]*not[\W_]*post/i;
export function validateUploadFile(file){
 if(!file||! /\.(mp4|jpe?g)$/i.test(file.name)||templateName.test(file.name))throw Error('完成したMP4・JPEGを選んでください。天気テンプレートは登録できません。');
 if(file.size<1000||file.size>MAX_BYTES)throw Error('素材は1.5MB以下のMP4・JPEGを選んでください。');
 return /\.mp4$/i.test(file.name)?'video':'image';
}
export function buildMediaPayload(fields,file,content,now=Date.now()){
 validateUploadFile(file);
 if(!['feed','story'].includes(fields.kind)||!['求人','協力業者','面白'].includes(fields.category))throw Error('投稿種類と内容を確認してください。');
 const expected=fields.kind==='story'?'11:00':'16:00';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)||fields.time!==expected)throw Error('公開日と日本時間の公開時刻を確認してください。');
 const due=Date.parse(fields.date+'T'+fields.time+':00+09:00');
 if(!Number.isFinite(due)||new Date(due+9*3600000).toISOString().slice(0,10)!==fields.date||due<now+60000||due>now+28*86400000)throw Error('公開日時は1分後から28日後までで設定してください。');
 const caption=String(fields.caption||'').trim();
 if(caption.length<10||caption.length>2100||/https?:\/\/|ig\.me\/|www\.instagram\.com\/m\//i.test(caption))throw Error('本文は10〜2100文字、未検証のリンクなしで設定してください。');
 if(!['draft','scheduled'].includes(fields.mode)||fields.checked!==true)throw Error('保存方法と検品のチェックを確認してください。');
 return {kind:fields.kind,category:fields.category,caption,due,hold:fields.mode==='draft',checked:true,frame:1,fileName:file.name,...(/\.mp4$/i.test(file.name)?{mp4:content}:{jpeg:content})};
}
export function verifySavedMedia(result,snapshot,payload){
 const job=snapshot.jobs?.find(j=>j.id===result.id);
 if(!job||job.kind!==payload.kind||job.category!==payload.category||job.caption!==payload.caption||job.due!==payload.due||job.media_type!==(payload.mp4?'video':'image')||job.status!==(payload.hold?'draft':'scheduled'))throw Error('保存結果の一致を確認できません。再送せず、投稿予定を確認してください。');
 return job;
}
export function initVideoUpload({api,refresh}){
 const $=id=>document.getElementById(id),form=$('video-upload-form');if(!form)return;
 let previewURL,readPending=false,saved=false,uncertain=false,editJob=null;
 const say=text=>{$('video-result').textContent=text;};
 function button(){$('media-new').disabled=readPending;for(const n of form.querySelectorAll('input,select,textarea'))n.disabled=readPending||!!editJob&&['video-kind','video-date','video-time'].includes(n.id);const hold=$('video-save-mode').value==='draft';$('video-submit').textContent=saved?'保存済み':uncertain?'投稿予定で結果を確認してください':hold?'下書きを保存':'公開予約を保存';$('video-submit').disabled=readPending||saved||uncertain;}
 function time(){const value=$('video-kind').value==='story'?'11:00':'16:00';$('video-time').replaceChildren(new Option(value,value));}
 $('video-kind').addEventListener('change',time);
 $('video-save-mode').addEventListener('change',button);
 $('media-new').onclick=()=>{editJob=null;form.reset();$('video-date').value=tomorrow;$('media-editing').hidden=true;$('media-new').hidden=true;saved=false;uncertain=false;time();clearPreview();button();say('新しい投稿を登録します。');};
 const tomorrow=new Date(Date.now()+9*3600000+86400000).toISOString().slice(0,10);$('video-date').value=tomorrow;
 form.addEventListener('input',()=>{if(!readPending&&!uncertain){saved=false;button();}});
 function clearPreview(){if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;for(const id of ['video-preview','image-preview']){const n=$(id);n.removeAttribute('src');n.hidden=true;} $('video-file').value='';$('video-checked').checked=false;}
 $('video-file').addEventListener('change',()=>{
  if(previewURL)URL.revokeObjectURL(previewURL);previewURL=null;for(const id of ['video-preview','image-preview']){$(id).removeAttribute('src');$(id).hidden=true;} $('video-checked').checked=false;
  try{const type=validateUploadFile($('video-file').files[0]);previewURL=URL.createObjectURL($('video-file').files[0]);const view=$(type==='video'?'video-preview':'image-preview');view.src=previewURL;view.hidden=false;say(type==='video'?'動画全体を再生して確認してください。':'画像の内容・数値・文字を確認してください。');}catch(e){say(e.message);}
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(readPending||saved||uncertain)return;
  let submitted=false;
  try{
   const file=$('video-file').files[0];
   const fields={kind:$('video-kind').value,category:$('video-category').value,date:$('video-date').value,time:$('video-time').value,caption:$('video-caption').value,mode:$('video-save-mode').value,checked:$('video-checked').checked};
   const payload=buildMediaPayload(fields,file,'');
   if(editJob)Object.assign(payload,{id:editJob.id,expectedUpdated:editJob.updated,frame:Number(editJob.slot.split(':')[2]||1)});
   readPending=true;button();say('素材を確認しています…');
   const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('素材を読み込めませんでした。'));reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);});
   payload[/\.mp4$/i.test(file.name)?'mp4':'jpeg']=String(data).split(',')[1];
   const current=await api('status');const slot=fields.date+':'+fields.kind;
   if(!editJob&&[...current.jobs,...(current.hiddenJobs||[])].some(j=>j.slot===slot))throw Error('この日・種類は登録済みです。取消済みの場合も含め、投稿予定を確認してください。');
   say('保存しています…');submitted=true;
   const result=await api('upload-media',payload),snapshot=await api('status'),job=verifySavedMedia(result,snapshot,payload);
   saved=true;say((job.status==='draft'?'下書きとして保存しました。自動公開されません。':'公開予約を保存しました。')+'\n'+new Date(job.due).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+'（日本時間）\n'+(job.kind==='story'?'ストーリー':job.media_type==='video'?'通常投稿（リール）':'通常投稿')+'・'+job.category+'\n登録ID：'+job.id+(snapshot.mode!=='active'?'\n予約投稿は現在一時停止中です。':''));
   await refresh();
  }catch(e){const busy=/^投稿を確認中です/.test(e.message),invalid=e.code==='MEDIA_VALIDATION';uncertain=submitted&&!busy&&!invalid;say(e.message+(invalid?'\n形式検査で停止したため、今回は保存していません。素材を修正して選び直してください。':busy?'\n今回は保存していません。少し待ってから再試行してください。':submitted?'\n保存済みの可能性があります。再送せず、ページを更新して投稿予定を確認してください。':''));}
  finally{readPending=false;button();}
 });
 button();
 return {edit(job){
  if(readPending)return;
  editJob=job;saved=false;uncertain=false;clearPreview();
  $('video-kind').value=job.kind;time();$('video-category').value=job.category;$('video-date').value=new Date(job.due+9*3600000).toISOString().slice(0,10);$('video-caption').value=job.caption;$('video-save-mode').value=job.status==='draft'?'draft':'scheduled';
  $('media-editing').textContent='既存予約の編集：'+$('video-date').value+' '+$('video-time').value+'（日本時間）。日時・種類・掲載順は変更しません。';$('media-editing').hidden=false;$('media-new').hidden=false;form.closest('details').open=true;button();say('差し替える素材を選び、内容を確認してください。');form.scrollIntoView({behavior:'smooth',block:'start'});
 }};
}
