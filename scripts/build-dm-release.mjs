// Offline assembly of a DM-only bundle while preserving the deployed dependency bundle.
// Usage: node scripts/build-dm-release.mjs live-worker.js new-build.js output.mjs
import {readFileSync,writeFileSync} from 'node:fs';
const [livePath,builtPath,outPath]=process.argv.slice(2);
if(!livePath||!builtPath||!outPath)throw Error('Provide deployed bundle, freshly compiled bundle, and output path');
const live=readFileSync(livePath,'utf8'),built=readFileSync(builtPath,'utf8');
function sections(source){
 const markers=[...source.matchAll(/^\/\/ ([^\n]+)\n/gm)],map=new Map();
 for(let i=0;i<markers.length;i++){
  const m=markers[i],name=m[1].replace(/^app\//,''),end=markers[i+1]?.index??source.length;
  const list=map.get(name)||[];list.push({start:m.index,end,body:source.slice(m.index+m[0].length,end)});map.set(name,list);
 }
 return map;
}
const old=sections(live),fresh=sections(built);
for(const name of ['cloudflare/social.mjs','cloudflare/studio.mjs','cloudflare/autopilot.mjs','cloudflare/composer.mjs','cloudflare/worker.mjs']){
 const before=old.get(name),after=fresh.get(name);
 if(!before||!after||JSON.stringify(before.map(x=>x.body))!==JSON.stringify(after.map(x=>x.body)))throw Error('Non-DM code differs: '+name);
}
for(const name of ['logic.mjs','cloudflare/eye.mjs'])if(old.get(name)?.length!==1||fresh.get(name)?.length!==1)throw Error('Unexpected DM module layout');
if(fresh.get('dm-safety.mjs')?.length!==1||old.has('dm-safety.mjs'))throw Error('Unexpected safety module layout');
let result=live;
for(const name of ['logic.mjs','cloudflare/eye.mjs'].sort((a,b)=>old.get(b)[0].start-old.get(a)[0].start)){
 const {start,end}=old.get(name)[0];
 const safety=name==='logic.mjs'?'// dm-safety.mjs\n'+fresh.get('dm-safety.mjs')[0].body:'';
 result=result.slice(0,start)+safety+'// '+name+'\n'+fresh.get(name)[0].body+result.slice(end);
}
result=result.replace(/^\/\/# sourceMappingURL=.*\n?/gm,'');
writeFileSync(outPath,result);
console.log('DM-only bundle assembled; all non-DM deployed code preserved.');
