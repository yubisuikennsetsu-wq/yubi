// Preserve the live dependency bundle and every unchanged application module.
import {readFileSync,writeFileSync} from 'node:fs';
const [livePath,builtPath,outPath]=process.argv.slice(2);
if(!livePath||!builtPath||!outPath)throw Error('Provide live, build, and output paths');
const live=readFileSync(livePath,'utf8'),built=readFileSync(builtPath,'utf8');
function sections(source){const ms=[...source.matchAll(/^\/\/ ([^\n]+)\n/gm)],map=new Map();for(let i=0;i<ms.length;i++){const m=ms[i],name=m[1].replace(/^app\//,''),end=ms[i+1]?.index??source.length;const list=map.get(name)||[];list.push({start:m.index,end,body:source.slice(m.index+m[0].length,end)});map.set(name,list);}return map;}
const old=sections(live),fresh=sections(built);
for(const name of ['logic.mjs','dm-safety.mjs','cloudflare/eye.mjs','cloudflare/studio.mjs','cloudflare/autopilot.mjs','cloudflare/composer.mjs']){
 if(!old.has(name)||!fresh.has(name)||JSON.stringify(old.get(name).map(x=>x.body))!==JSON.stringify(fresh.get(name).map(x=>x.body)))throw Error('Unrelated module changed: '+name);
}
if(old.get('cloudflare/social.mjs')?.length!==1||fresh.get('cloudflare/social.mjs')?.length!==2||old.get('cloudflare/worker.mjs')?.length!==2||fresh.get('cloudflare/worker.mjs')?.length!==2)throw Error('Unexpected module layout');
if(old.get('cloudflare/worker.mjs')[0].body!==fresh.get('cloudflare/worker.mjs')[0].body)throw Error('Worker imports changed');
if(old.has('cloudflare/social-video.mjs')||fresh.get('cloudflare/social-video.mjs')?.length!==1)throw Error('Unexpected video module');
const edits=[{...old.get('cloudflare/social.mjs')[0],replacement:'// cloudflare/social.mjs\n'+fresh.get('cloudflare/social.mjs')[0].body+'// cloudflare/social-video.mjs\n'+fresh.get('cloudflare/social-video.mjs')[0].body+'// cloudflare/social.mjs\n'+fresh.get('cloudflare/social.mjs')[1].body},{...old.get('cloudflare/worker.mjs')[1],replacement:'// cloudflare/worker.mjs\n'+fresh.get('cloudflare/worker.mjs')[1].body}];
let result=live;for(const {start,end,replacement} of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,start)+replacement+result.slice(end);
writeFileSync(outPath,result.replace(/^\/\/# sourceMappingURL=.*\n?/gm,''));console.log('Media bundle assembled; DM, generation, composer and dependencies preserved.');
