// Offline, read-only media check. Requires ffprobe and ffmpeg, never publishes.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectMp4} from '../app/cloudflare/social-video.mjs';
const path=process.argv[2];if(!path)throw Error('Usage: node scripts/check-social-video.mjs /path/to/animation.mp4');
const file=resolve(path),bytes=readFileSync(file),metadata=inspectMp4(bytes);
const data=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8',timeout:30000}));
const streams=data.streams||[],videos=streams.filter(x=>x.codec_type==='video'),audios=streams.filter(x=>x.codec_type==='audio'),video=videos[0];
if(videos.length!==1||audios.length>1||videos.length+audios.length!==streams.length||video.codec_name!=='h264'||video.pix_fmt!=='yuv420p'||video.width!==1080||video.height!==1920)throw Error('Only 1080×1920 H.264/yuv420p animation is supported');
if(audios.some(a=>a.codec_name!=='aac'||a.profile!=='LC'||Number(a.sample_rate)!==48000||a.channels!==2||!Number.isFinite(Number(a.bit_rate))||Number(a.bit_rate)>128000))throw Error('Audio must be AAC-LC stereo, 48kHz, at most 128kbps');
if(Number(data.format.duration)<3||Number(data.format.duration)>60)throw Error('Duration must be 3–60 seconds');
if(video.side_data_list?.some(x=>x.rotation))throw Error('Rotation metadata is not supported');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-xerror','-i',file,'-f','null','-'],{timeout:60000,stdio:['ignore','ignore','pipe']});
console.log(JSON.stringify({ok:true,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...metadata}));
