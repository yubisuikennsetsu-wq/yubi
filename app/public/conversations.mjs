export function replyState(history=[],outbox=[]){
 const incoming=Math.max(0,...history.filter(x=>x.role==='相手').map(x=>Number(x.at)||0));
 const outgoing=Math.max(0,...history.filter(x=>x.role==='会社').map(x=>Number(x.at)||0),...outbox.filter(x=>['sent','confirmed_sent'].includes(x.status)).map(x=>Number(x.created)||0));
 const uncertain=outbox.some(x=>x.status==='uncertain'&&Number(x.created)>=incoming);
 return {unanswered:incoming>0&&(outgoing<incoming||uncertain),incoming,outgoing,uncertain,label:uncertain?'送信結果の確認が必要':outgoing>=incoming&&outgoing>0?'返信済み':'未返信'};
}
export function groupedMessages(messages,threads=[]){
 const byPeer=new Map(threads.map(t=>[t.peer,t])),groups=new Map();
 for(const m of messages){const key=m.peer||m.username||m.sender;if(!groups.has(key))groups.set(key,{key,messages:[],thread:byPeer.get(key)});groups.get(key).messages.push(m);}
 for(const g of groups.values()){
 g.messages.sort((a,b)=>b.received-a.received);g.latest=g.messages[0];
 const h=[...g.messages.map(m=>({role:'相手',at:m.received})),...(g.thread?.history||[])];g.reply=replyState(h,g.thread?.outbox);g.done=g.messages.every(m=>m.done);
 }
 return [...groups.values()].sort((a,b)=>Number(b.reply.unanswered)-Number(a.reply.unanswered)||b.latest.received-a.latest.received);
}
