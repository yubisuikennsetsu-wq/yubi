export function classify(text='') {
  if (/求人|応募|採用|就職|転職|働きたい|働けます|未経験|募集条件|給与|給料|面接|履歴書/.test(text)) return '求人';
  if (/協力希望|協力業者|一人親方|応援行け|応援に|空き状況|稼働可能|職人.*紹介|鉄筋屋/.test(text)) return '協力業者';
  if (/見積|工事.*依頼|外構.*相談|造成.*相談|現場|納期|工程|施工|搬入|請求書/.test(text)) return '工事・取引';
  return null;
}
export function japanHour(date=new Date()) { return Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',hourCycle:'h23'}).format(date)); }
export function inWindow(date=new Date()) { const h=japanHour(date); return h>=9 && h<=19; }
export function hourKey(date=new Date()) {return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).format(date);}
export function validPushEndpoint(endpoint) {try {const u=new URL(endpoint); return u.protocol==='https:' && !u.username && !u.password && !u.port && (u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com')||u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com');} catch{return false;}}

