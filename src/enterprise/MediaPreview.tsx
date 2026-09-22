import { useEffect, useRef, useState } from 'react';
import { Notice } from './components';
import type { KnowledgeDocument } from './types';

export function MediaPreview({document,timeMs=0}:{document:KnowledgeDocument;timeMs?:number}){
  const ref=useRef<HTMLMediaElement|null>(null);const [failed,setFailed]=useState(false);
  useEffect(()=>{setFailed(false);},[document.id]);
  useEffect(()=>{const node=ref.current;if(node&&node.readyState>=1)node.currentTime=Math.max(0,timeMs/1000);},[timeMs,document.id]);
  const seek=()=>{if(ref.current)ref.current.currentTime=Math.max(0,timeMs/1000);};const url=`/api/documents/${document.id}/preview`;
  return <div className="e-media-preview">{failed?<Notice kind="warning">浏览器或当前服务无法播放此原件，请下载后在本地核验对应时间段。</Notice>:document.mimeType?.startsWith('video/')?<video ref={node=>{ref.current=node;}} controls preload="metadata" src={url} onLoadedMetadata={seek} onError={()=>setFailed(true)}/>:<audio ref={node=>{ref.current=node;}} controls preload="metadata" src={url} onLoadedMetadata={seek} onError={()=>setFailed(true)}/>}<p className="e-muted">{timeMs>0?`定位至 ${(timeMs/1000).toFixed(1)} 秒，请播放并核验对应原声。`:'使用原件核验转写，时间位置以实际解析结果为准。'}</p><a className="e-text-link" href={`/api/documents/${document.id}/file`} target="_blank" rel="noreferrer">下载媒体原件</a></div>;
}
