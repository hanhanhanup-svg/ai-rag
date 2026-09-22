import { Link } from 'react-router-dom';
import { FileText, Layers3, X } from 'lucide-react';
import { useResource } from './api';
import type { KnowledgeDocument } from './types';
import './knowledge-workspace.css';

export interface BusinessScope { object?:string; baseId?:string; documentId?:string; documentVersion?:number; entityId?:string; scenario?:string; scenarioVersionId?:string; task?:string }
export function scopeFromParams(params:URLSearchParams):BusinessScope { const version=Number(params.get('documentVersion'));return {object:params.get('object')||undefined,baseId:params.get('baseId')||undefined,documentId:params.get('documentId')||undefined,documentVersion:Number.isInteger(version)&&version>0?version:undefined,entityId:params.get('entityId')||undefined,scenario:params.get('scenario')||undefined,scenarioVersionId:params.get('scenarioVersionId')||undefined,task:params.get('task')||undefined}; }
export function businessHref(path:string,values:Record<string,string|number|undefined|null>):string {const params=new URLSearchParams();for(const [key,value] of Object.entries(values)){if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));}return path+(params.size?'?'+params.toString():'');}
export function BusinessContext({scope,baseName,onClear,disabled=false}:{scope:BusinessScope;baseName?:string;onClear?:()=>void;disabled?:boolean}) {
 const document=useResource<{document:KnowledgeDocument}>(scope.documentId?'/documents/'+encodeURIComponent(scope.documentId):null);
 if(!scope.object&&!scope.baseId&&!scope.documentId&&!scope.entityId&&!scope.task&&!scope.scenario&&!scope.scenarioVersionId)return null;
 return <div className="kw-context" aria-label="当前业务范围"><Layers3 size={17}/><div><strong>当前业务范围</strong><div className="kw-context-values">{scope.baseId&&<Link to={'/assets/knowledge-bases/'+encodeURIComponent(scope.baseId)}>{baseName||'限定知识库'}</Link>}{scope.documentId&&<Link to={'/documents/'+encodeURIComponent(scope.documentId)}><FileText size={13}/>{document.data?.document.title||'指定资料'}{scope.documentVersion?' · V'+scope.documentVersion:''}</Link>}{scope.entityId&&<Link to={businessHref('/assets/objects/'+encodeURIComponent(scope.entityId),{baseId:scope.baseId})}>指定业务对象</Link>}{scope.object&&<span>对象/关键词：{scope.object}</span>}{scope.task&&<span>任务：{scope.task}</span>}{scope.scenario&&<span>推荐场景：{({passenger:'客运服务',operations:'运营记录',maintenance:'设备维修',training:'岗位学习'} as Record<string,string>)[scope.scenario]||scope.scenario}</span>}</div>{scope.documentId&&<small>{document.error?'指定资料不可读取，请核对范围或清除后重新选择。':'仅依据此资料的指定版本检索；范围不可用时会明确返回原因。'}</small>}</div>{onClear&&<button type="button" className="e-text-link" onClick={onClear} disabled={disabled}><X size={14}/>清除范围</button>}</div>;
}
