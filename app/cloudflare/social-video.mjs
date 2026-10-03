// Deliberately narrow local animation profile. No transcoding or remote URL ingestion.
// Full decoding / pixel-format checks are performed by scripts/check-social-video.mjs.
export const MAX_ASSET_BYTES=1500000;
export function isMp4(bytes){return bytes.length>=12&&bytes.toString('ascii',4,8)==='ftyp';}
const invalid=()=>{throw Error('動画はfaststart形式のH.264 MP4、1080×1920、24〜30fps、3〜60秒、音声はなしまたはAAC-LC 48kHz stereoで設定してください');};
function boxes(bytes,start=0,end=bytes.length){
 const result=[];
 while(start<end){
  if(start+8>end)invalid();
  const size=bytes.readUInt32BE(start),type=bytes.toString('ascii',start+4,start+8);
  // Our small, non-fragmented uploads never need extended or unbounded box sizes.
  if(size<8||start+size>end)invalid();
  result.push({type,start,data:start+8,end:start+size});start+=size;
 }
 return result;
}
function child(bytes,parent,type){const found=boxes(bytes,parent.data,parent.end).filter(b=>b.type===type);if(found.length!==1)invalid();return found[0];}
function descriptor(bytes,start,end,tag){
 if(start>=end||bytes[start++]!==tag)invalid();let length=0,done=false;
 for(let i=0;i<4;i++){if(start>=end)invalid();const b=bytes[start++];length=length*128+(b&127);if(!(b&128)){done=true;break;}}
 if(!done||start+length>end)invalid();return {data:start,end:start+length};
}
function inspectAudio(bytes,mdia){
 const stbl=child(bytes,child(bytes,mdia,'minf'),'stbl'),stsd=child(bytes,stbl,'stsd');
 if(stsd.data+8>stsd.end||bytes.readUInt32BE(stsd.data+4)!==1)invalid();
 const entries=boxes(bytes,stsd.data+8,stsd.end),entry=entries[0];
 if(entries.length!==1||entry.type!=='mp4a'||entry.data+28>entry.end)invalid();
 if(bytes.readUInt16BE(entry.data+8)!==0||bytes.readUInt16BE(entry.data+16)!==2||bytes.readUInt32BE(entry.data+24)!==48000*65536)invalid();
 const esds=boxes(bytes,entry.data+28,entry.end).find(b=>b.type==='esds');if(!esds||esds.data+4>=esds.end)invalid();
 const es=descriptor(bytes,esds.data+4,esds.end,3);if(es.data+3>=es.end||bytes[es.data+2]!==0)invalid();
 const config=descriptor(bytes,es.data+3,es.end,4);
 if(config.data+13>=config.end||bytes[config.data]!==0x40||bytes[config.data+1]>>2!==5||bytes.readUInt32BE(config.data+9)>128000)invalid();
 const specific=descriptor(bytes,config.data+13,config.end,5);if(specific.data+2>specific.end)invalid();
 const a=bytes[specific.data],b=bytes[specific.data+1];
 if(a>>3!==2||((a&7)<<1|b>>7)!==3||((b>>3)&15)!==2)invalid();
}
export function inspectMp4(bytes){
 if(bytes.length<1000||bytes.length>MAX_ASSET_BYTES||!isMp4(bytes))invalid();
 const top=boxes(bytes),moov=top.find(b=>b.type==='moov'),mdat=top.find(b=>b.type==='mdat');
 if(!moov||!mdat||moov.start>mdat.start||top.filter(b=>b.type==='moov').length!==1||top.some(b=>b.type==='moof'))invalid();
 const tracks=boxes(bytes,moov.data,moov.end).filter(b=>b.type==='trak');if(tracks.length<1||tracks.length>2)invalid();
 const media=tracks.map(t=>{const mdia=child(bytes,t,'mdia'),hdlr=child(bytes,mdia,'hdlr');if(hdlr.data+12>hdlr.end)invalid();return {mdia,type:bytes.toString('ascii',hdlr.data+8,hdlr.data+12)};});
 const videos=media.filter(t=>t.type==='vide'),audios=media.filter(t=>t.type==='soun');
 if(videos.length!==1||audios.length>1||videos.length+audios.length!==tracks.length)invalid();
 if(audios.length)inspectAudio(bytes,audios[0].mdia);
 const mdia=videos[0].mdia;
 const mdhd=child(bytes,mdia,'mdhd');if(bytes[mdhd.data]!==0||mdhd.data+20>mdhd.end)invalid();
 const timescale=bytes.readUInt32BE(mdhd.data+12),ticks=bytes.readUInt32BE(mdhd.data+16),duration=ticks/timescale;
 if(!Number.isFinite(duration)||duration<3||duration>60)invalid();
 const stbl=child(bytes,child(bytes,mdia,'minf'),'stbl'),stsd=child(bytes,stbl,'stsd');
 if(stsd.data+8>stsd.end||bytes.readUInt32BE(stsd.data+4)!==1)invalid();
 const entries=boxes(bytes,stsd.data+8,stsd.end),entry=entries[0];
 if(entries.length!==1||entry.type!=='avc1'||entry.data+78>entry.end)invalid();
 const width=bytes.readUInt16BE(entry.data+24),height=bytes.readUInt16BE(entry.data+26);
 if(width!==1080||height!==1920)invalid();
 const avcc=boxes(bytes,entry.data+78,entry.end).find(b=>b.type==='avcC');
 if(!avcc||avcc.data+7>avcc.end||bytes[avcc.data]!==1||![66,77,100].includes(bytes[avcc.data+1]))invalid();
 const stts=child(bytes,stbl,'stts');if(stts.data+8>stts.end)invalid();
 const count=bytes.readUInt32BE(stts.data+4);if(!count||stts.data+8+count*8!==stts.end)invalid();
 let frames=0,totalTicks=0;
 for(let i=0;i<count;i++){
  const at=stts.data+8+i*8,n=bytes.readUInt32BE(at),delta=bytes.readUInt32BE(at+4),fps=timescale/delta;
  if(!n||fps<24||fps>30)invalid();frames+=n;totalTicks+=n*delta;
 }
 if(totalTicks!==ticks)invalid();
 return {duration,width,height,fps:frames/duration,audio:audios.length?'aac-lc-48000-stereo':'none'};
}
