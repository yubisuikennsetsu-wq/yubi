export function verifyCancelledVisibility(snapshot,id,hidden){
 const visible=snapshot.jobs?.find(j=>j.id===id),removed=snapshot.hiddenJobs?.find(j=>j.id===id);
 if(hidden?(!removed||removed.status!=='cancelled'||!!visible):(!visible||visible.status!=='cancelled'||!!removed))throw Error('保存結果を確認できません。再操作する前に投稿予定を更新してください。');
}
export async function changeCancelledVisibility(api,job,hidden){
 if(job.status!=='cancelled'||!Number.isSafeInteger(job.updated))throw Error('最新の取消予約を確認してください。');
 let writeError;
 try{await api(hidden?'hide-cancelled':'show-cancelled',{id:job.id,expectedUpdated:job.updated});}catch(e){writeError=e;}
 // Never repeat a possibly successful write after a lost response.
 const snapshot=await api('status');
 try{verifyCancelledVisibility(snapshot,job.id,hidden);}catch(e){throw writeError||e;}
 return snapshot;
}
export function cancelledVisibilityButton(job,hidden,{api,refresh,message,confirmAction=globalThis.confirm}){
 const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=hidden?'削除':'一覧に戻す';button.dataset.cancelledVisibility=hidden?'hide':'show';
 button.disabled=busy.has(job.id);
 button.onclick=async()=>{
  if(busy.has(job.id))return;
  if(!confirmAction(hidden?'この取消予約を一覧から削除しますか？ 記録は残り、後で一覧に戻せます。':'取消予約を一覧に戻しますか？ 公開予約は再開しません。'))return;
  busy.add(job.id);button.disabled=true;message('保存結果を確認しています…');
  try{
   await changeCancelledVisibility(api,job,hidden);
   busy.delete(job.id);await refresh();message(hidden?'取消予約を一覧から削除しました。「削除した取消予約」から戻せます。':'取消予約を一覧に戻しました。公開予約は再開していません。');
  }catch(e){busy.delete(job.id);button.disabled=false;message(e.message+' 再操作する前に投稿予定を更新してください。');}
 };
 return button;
}
const busy=new Set();
