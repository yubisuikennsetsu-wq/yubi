// Replace only social.mjs in a verified live bundle; preserve dependencies and DM code.
import {readFileSync,writeFileSync} from 'node:fs';
const [basePath,builtPath,outPath]=process.argv.slice(2);
if(!basePath||!builtPath||!outPath)throw Error('Provide live bundle, dry-run build and output paths');
const base=readFileSync(basePath,'utf8'),built=readFileSync(builtPath,'utf8');
function sections(source){const ms=[...source.matchAll(/^\/\/ ([^\n]+)\n/gm)],map=new Map();for(let i=0;i<ms.length;i++){const m=ms[i],name=m[1].replace(/^app\//,''),end=ms[i+1]?.index??source.length;const list=map.get(name)||[];list.push({start:m.index,end,body:source.slice(m.index+m[0].length,end)});map.set(name,list);}return map;}
const old=sections(base),fresh=sections(built);
for(const name of ['logic.mjs','dm-safety.mjs','cloudflare/eye.mjs','cloudflare/studio.mjs','cloudflare/autopilot.mjs','cloudflare/composer.mjs','cloudflare/social-video.mjs','cloudflare/worker.mjs']){
 const clean=items=>items?.map(x=>x.body.replace(/^\/\/# sourceMappingURL=.*\n?/gm,''));
 if(!old.has(name)||!fresh.has(name)||JSON.stringify(clean(old.get(name)))!==JSON.stringify(clean(fresh.get(name))))throw Error('Unrelated module changed: '+name);
}
const a=old.get('cloudflare/social.mjs'),b=fresh.get('cloudflare/social.mjs');
if(a?.length!==2||b?.length!==2)throw Error('Unexpected social module layout');
let result=base;for(let i=1;i>=0;i--)result=result.slice(0,a[i].start)+'// cloudflare/social.mjs\n'+b[i].body+result.slice(a[i].end);
writeFileSync(outPath,result.replace(/^\/\/# sourceMappingURL=.*\n?/gm,''));
console.log('Only social.mjs replaced; all other live code preserved.');
