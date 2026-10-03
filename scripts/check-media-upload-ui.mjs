// Offline Chromium UI regression check: all page requests are intercepted; never uses production.
import {spawn} from 'node:child_process';import {readFileSync,existsSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
const project=process.cwd(),root=project+'/app/public';
const browser=spawn('/usr/bin/chromium',['--headless','--user-data-dir=/tmp/yubi-ui-chromium','--disable-dev-shm-usage','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND','--remote-debugging-pipe'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
browser.stderr.on('data',()=>{});browser.stdio[4].on('error',()=>{});
let seq=0,buffer='',session,authenticated=false,jobs=[],posts=0;const pending=new Map(),errors=[];
function send(method,params={},sid=session){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});browser.stdio[3].write(JSON.stringify({id,method,params,...(sid?{sessionId:sid}:{})})+'\0');});}
browser.stdio[4].on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\0'))>=0){const raw=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!raw)continue;const msg=JSON.parse(raw);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p?.reject(Error(JSON.stringify(msg.error))):p?.resolve(msg.result);}else if(msg.method==='Fetch.requestPaused')route(msg.params).catch(e=>errors.push(e.message));else if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);}});
const json=obj=>({body:Buffer.from(JSON.stringify(obj)).toString('base64'),contentType:'application/json'});
async function route({requestId,request}){
 const path=new URL(request.url).pathname;let body,contentType='text/plain',status=200;
 if(path==='/api/status')({body,contentType}=json({authenticated}));
 else if(path==='/api/social/status')({body,contentType}=json({mode:'active',jobs,events:[],latestAnalysis:null}));
 else if(path==='/api/social/upload-media'){
  posts++;const p=JSON.parse(request.postData),id=p.id||'mock'+posts,old=jobs.find(j=>j.id===id);assert.equal(request.method,'POST');
  const job={...p,id,slot:old?.slot||new Date(p.due+9*3600000).toISOString().slice(0,10)+':'+p.kind,status:p.hold?'draft':'scheduled',media_type:p.mp4?'video':'image',asset_id:'a'.repeat(48),updated:Date.now()};jobs=jobs.filter(j=>j.id!==id).concat(job);({body,contentType}=json({ok:true,id}));
 }else if(path.startsWith('/api/')){errors.push('Unexpected API '+path);status=500;({body,contentType}=json({error:'Forbidden test route'}));}
 else if(path.startsWith('/social-media/')){body=readFileSync(project+'/app/cloudflare/fixtures/animation-test.mp4').toString('base64');contentType='video/mp4';}
 else {const file=root+(path==='/'?'/social.html':path);if(existsSync(file)){body=readFileSync(file).toString('base64');contentType=/\.m?js$/.test(path)?'text/javascript':/\.css$/.test(path)?'text/css':/\.html$/.test(path)||path==='/'?'text/html':'image/png';}else{status=404;body='';}}
 await send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:contentType},{name:'Content-Security-Policy',value:"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"}],body});
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,40));}throw Error('Timeout: '+expression);}
async function file(path){const doc=await send('DOM.getDocument');const n=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#video-file'});await send('DOM.setFileInputFiles',{nodeId:n.nodeId,files:[path]});}
try{
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 await send('Runtime.enable');await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:'http://example.test/social.html'});await wait("document.getElementById('social-login')&&!document.getElementById('social-login').hidden");assert.equal(await evaluate("document.getElementById('social-owner').hidden"),true);
 authenticated=true;await send('Page.reload');await wait("document.getElementById('social-owner')&&!document.getElementById('social-owner').hidden");
 await evaluate("document.querySelector('.video-upload').open=true");await file(project+'/app/cloudflare/fixtures/animation-test.mp4');
 await evaluate("document.getElementById('video-caption').value='プロフィールのメッセージからお問い合わせください。';document.getElementById('video-checked').checked=true;document.getElementById('video-upload-form').requestSubmit()");
 await wait("document.getElementById('video-result').textContent.includes('下書きとして保存しました')");assert.equal(posts,1);assert.equal(jobs[0].status,'draft');assert.equal(await evaluate("document.getElementById('video-submit').disabled"),true);
 await wait("[...document.querySelectorAll('button')].some(n=>n.textContent==='素材・本文を編集') && !document.getElementById('video-file').disabled");
 await evaluate("[...document.querySelectorAll('button')].find(n=>n.textContent==='素材・本文を編集').click()");assert.equal(await evaluate("document.getElementById('video-date').disabled"),true);await file(project+'/app/cloudflare/fixtures/image-test.jpg');
 await evaluate("document.getElementById('video-save-mode').value='scheduled';document.getElementById('video-save-mode').dispatchEvent(new Event('change'));document.getElementById('video-checked').checked=true;document.getElementById('video-upload-form').requestSubmit()");
 await wait("document.getElementById('video-result').textContent.includes('公開予約を保存しました')");assert.equal(posts,2);assert.equal(jobs.length,1);assert.equal(jobs[0].status,'scheduled');assert.equal(jobs[0].media_type,'image');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);const png=await send('Page.captureScreenshot',{format:'png'});writeFileSync('/tmp/yubi-video-ui-mobile.png',Buffer.from(png.data,'base64'));
 assert.deepEqual(errors,[]);console.log('PASS: logged-out hidden; owner MP4 draft; read-back success; duplicate button disabled; same-ID JPEG replacement and scheduling; locked date; mobile no overflow. All browser requests fulfilled offline.');
}finally{browser.kill();}
