import { existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const execute=promisify(execFile);
const error=(code,message)=>Object.assign(new Error(message),{code,status:422,statusCode:422});
export const MEDIA_EXTENSIONS=['.wav','.mp3','.m4a','.mp4','.mov','.webm','.ogg','.flac'];
export function adapterConfiguration(kind='ASR'){
  const command=process.env[`KNOWLEDGE_${kind}_COMMAND`]||'';
  let args=[];let argsValid=true;try{args=JSON.parse(process.env[`KNOWLEDGE_${kind}_ARGS`]||'[]');}catch{argsValid=false;}
  let available=false;try{available=argsValid&&!!command&&path.isAbsolute(command)&&existsSync(command)&&statSync(command).isFile()&&Array.isArray(args)&&args.every(a=>typeof a==='string');}catch{}
  return {available,command,args,timeoutMs:Math.max(1000,Math.min(1200000,Number(process.env[`KNOWLEDGE_${kind}_TIMEOUT_MS`])||600000))};
}
function mediaSignature(bytes,ext){
  if(ext==='.wav')return bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE';
  if(ext==='.mp3')return bytes.subarray(0,3).toString()==='ID3'||(bytes[0]===255&&(bytes[1]&224)===224);
  if(['.m4a','.mp4','.mov'].includes(ext))return bytes.subarray(4,8).toString()==='ftyp';
  if(ext==='.webm')return bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  if(ext==='.ogg')return bytes.subarray(0,4).toString()==='OggS';
  if(ext==='.flac')return bytes.subarray(0,4).toString()==='fLaC';
  return false;
}
async function videoEvidence(filePath,durationMs,ocrFactory){
  const temp=await mkdtemp(path.join(tmpdir(),'xrag-video-frames-')),blocks=[],warnings=[],maxFrames=12;
  const intervalMs=Math.max(10000,Math.ceil(durationMs/(maxFrames-1))),times=[];
  for(let time=0;time<durationMs&&times.length<maxFrames;time+=intervalMs)times.push(time);
  if(times.length<maxFrames&&durationMs>1000&&times.at(-1)<durationMs-1000)times.push(durationMs-1000);
  let engine,failed=0;
  try{
    if(!ocrFactory)throw error('FRAME_OCR_UNAVAILABLE','视频画面OCR未连接。');
    engine=await ocrFactory();
    for(const [index,time] of times.entries()){
      const image=path.join(temp,'frame-'+index+'.png');
      try{
        await execute(process.env.KNOWLEDGE_FFMPEG_COMMAND||'ffmpeg',['-hide_banner','-loglevel','error','-ss',(time/1000).toFixed(3),'-protocol_whitelist','file,pipe','-i',filePath,'-frames:v','1','-vf','scale=1280:-2:force_original_aspect_ratio=decrease','-threads','1','-y',image],{timeout:45000,maxBuffer:1024*1024,windowsHide:true,shell:false});
        const text=(await engine.recognize(image)).trim();
        if(text)blocks.push({type:'frame_text',text:'[视频画面文字；抽样时间 '+(time/1000).toFixed(1)+' 秒]\n'+text,locator:{startMs:time,endMs:Math.min(durationMs,time+1000),sampleMs:time,precision:'approximate',frame:index+1},quality:{text:'unreviewed',timing:'approximate',method:'ffmpeg+qwen-vl-or-ocr-sampling'}});
      }catch{failed++;warnings.push('约第'+(time/1000).toFixed(1)+'秒画面提取或OCR失败，该时间点不作为已识别画面。');}
    }
  }catch{failed=times.length;warnings.push('视频音轨已转写，但画面OCR不可用；请配置FFmpeg与本地Tesseract，或上传关键画面截图。');}
  finally{try{await engine?.close();}finally{await rm(temp,{recursive:true,force:true});}}
  return {blocks,warnings,visualCoverage:failed===times.length?'unavailable':failed?'partial':'sampled',frameSampling:{strategy:'uniform-time-sampling',intervalMs,maxFrames,requestedFrames:times.length,failedFrames:failed,textFrames:blocks.length,completeFrameCoverage:false}};
}
export async function parseMedia(filePath,fileName,bytes,{ocrFactory}={}){
  if(!mediaSignature(bytes,path.extname(fileName).toLowerCase()))throw error('CORRUPT_MEDIA','音视频文件头与格式不一致，请重新导出。');
  const config=adapterConfiguration('ASR');
  if(!config.available)throw error('ASR_CONFIGURATION_REQUIRED','尚未配置本地转写服务。请安装本地 Whisper 适配器并设置 KNOWLEDGE_ASR_COMMAND 与 KNOWLEDGE_ASR_ARGS，或先上传人工转写稿。单文件上限100MB。');
  let value;try{const {stdout}=await execute(config.command,[...config.args,'--input',filePath],{timeout:config.timeoutMs,maxBuffer:16*1024*1024,windowsHide:true,shell:false,encoding:'utf8'});value=JSON.parse(stdout.trim());}
  catch(e){throw error(e.killed?'ASR_TIMEOUT':'ASR_FAILED',e.killed?'本地音视频转写超时，请拆分文件。':'本地转写适配器执行失败或未返回约定JSON，请检查适配器及模型文件。');}
  if(!value||!Number.isFinite(value.durationMs)||value.durationMs<=0||value.durationMs>3600000||!Array.isArray(value.segments)||!value.segments.length||value.segments.length>20000||!['complete','partial'].includes(value.coverage))throw error('ASR_INVALID_RESULT','转写结果缺少有效总时长、完整性或时间片段；最长60分钟。');
  let previousStart=-1,total=0;
  const blocks=value.segments.map((segment,index)=>{
    if(!Number.isFinite(segment.startMs)||!Number.isFinite(segment.endMs)||segment.startMs<0||segment.endMs<=segment.startMs||segment.endMs>value.durationMs+1000||segment.startMs<previousStart||typeof segment.text!=='string'||!segment.text.trim())throw error('ASR_INVALID_RESULT','转写时间轴顺序、范围或文本无效，已拒绝作为证据。');
    previousStart=segment.startMs;total+=segment.text.length;if(total>2000000)throw error('DOCUMENT_LIMIT','转写文本超过200万字符，请拆分音视频。');
    return {type:'transcript',text:segment.text.trim(),locator:{startMs:Math.round(segment.startMs),endMs:Math.round(segment.endMs),segment:index+1},quality:{text:'unreviewed',timing:'unreviewed',method:'asr'},...(typeof segment.speaker==='string'?{speaker:segment.speaker.slice(0,80)}:{})};
  });
  const warnings=['音视频转写中的站名、设备编号、数字和时间位置需人工复核。'];
  if(value.coverage!=='complete')warnings.push('仅完成部分转写，不能作为整段音视频的完整内容使用；请补充转写或拆分后重试。');
  const isVideo=['.mp4','.mov','.webm'].includes(path.extname(fileName).toLowerCase());
  const frames=isVideo?await videoEvidence(filePath,value.durationMs,ocrFactory):null;
  if(frames){blocks.push(...frames.blocks);blocks.sort((a,b)=>a.locator.startMs-b.locator.startMs);warnings.push(...frames.warnings,'视频画面按时间等间隔抽样'+frames.frameSampling.requestedFrames+'帧，未分析每一帧；画面文字与音轨转写分别标记，不能推断未抽样画面的内容。');}
  return {pages:[{page:1,text:blocks.map(b=>b.text).join('\n'),blocks}],parser:String(value.parser||'local-asr').slice(0,120),warnings,notes:[`音视频总时长${Math.round(value.durationMs/1000)}秒；引用使用时间区间，不代表物理页码。`],coverage:value.coverage,durationMs:value.durationMs,...(frames?{visualCoverage:frames.visualCoverage,frameSampling:frames.frameSampling}:{})};
}
