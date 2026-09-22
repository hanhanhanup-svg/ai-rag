import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, CircleAlert, CircleDashed, RefreshCw, Square } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { Loading, Notice } from './components';
import { AnswerCitations, AnswerText, CoverageNotice } from './KnowledgeContent';
import { DataValue } from './IntelligencePages';
import { isActiveRun, runLabels, type BusinessScenario, type ChatRun, type JsonSchema, type RunDetail, type RunEvent, type ToolResult } from './UpgradeTypes';
import type { User } from './types';
import { SelectControl } from './SelectControl';
import './chat-run-progress.css';

const stepNames: Record<string,string> = {
  'context.prepare':'准备上下文', 'context.rewrite':'理解追问', 'knowledge.search':'查找资料', 'answer.generate':'生成并核对回答', 'tools.plan':'选择查询工具',
  'tool.search_knowledge':'查找知识依据', 'tool.query_table':'筛选并计算表格', 'tool.compare_clauses':'对照条款',
  'tool.lookup_asset':'查询设备台账', 'tool.lookup_work_orders':'查询维修记录', 'tool.create_report_draft':'整理报告草稿',
};
function stepTitle(step:{name?:string;label?:string;type?:string},index:number){const known=stepNames[step.name||'']||stepNames[step.type||'']||stepNames[step.label||''];if(known)return known;const label=step.label||step.name||'';return /[\u3400-\u9fff]/.test(label)?label:'处理步骤 '+(index+1);}
const eventTypes=['run.started','step.started','step.completed','evidence.ready','answer.segment','answer.final','run.waiting_input','run.partial','run.cancelled','run.interrupted','run.failed','run.completed','run.succeeded','run.cancel_requested','evidence.withdrawn'];
export function useChatRuns(id:string,onSettled:(detail:RunDetail)=>void){const [detail,setDetail]=useState<RunDetail|null>(null);const [error,setError]=useState('');const [channel,setChannel]=useState('');const [segment,setSegment]=useState('');const [revision,reload]=useState(0);const callback=useRef(onSettled);callback.current=onSettled;const finished=useRef(new Set<string>());
  useEffect(()=>{if(!id){setDetail(null);setError('');setSegment('');return;}let alive=true;let source:EventSource|null=null;let polling:ReturnType<typeof setInterval>|null=null;let refreshing=false;let lastSequence=0;setDetail(null);setError('');setSegment('');setChannel('');
    const refresh=async()=>{if(!alive||refreshing)return;refreshing=true;try{const next=await api<RunDetail>(`/chat/runs/${id}`);if(!alive)return;setDetail(next);setError('');if(!isActiveRun(next.run.status)){source?.close();if(polling)clearInterval(polling);if(!finished.current.has(`${id}:${next.run.attempt}`)){finished.current.add(`${id}:${next.run.attempt}`);callback.current(next);}}}catch(e){if(alive)setError(errorMessage(e));}finally{refreshing=false;}};
    const receive=(event:Event)=>{try{const row=JSON.parse((event as MessageEvent).data) as RunEvent;if(row.runId!==id)return;if(row.type==='evidence.withdrawn'){setSegment('');setChannel('资料版本或权限已变化，原进度内容已撤回。');void refresh();return;}if(row.sequence<=lastSequence)return;lastSequence=row.sequence;if(row.type==='answer.segment'&&typeof row.payload.text==='string')setSegment(old=>old+row.payload.text);if(row.type==='answer.final')setSegment('');void refresh();}catch{setChannel('收到无法识别的进度事件，正在核对运行状态。');}};
    source=new EventSource(`/api/chat/runs/${id}/events?after=0`,{withCredentials:true});source.onopen=()=>alive&&setChannel('');source.onerror=()=>alive&&setChannel('进度通道暂时断开，正在核对运行状态；不会重新提交问题。');source.onmessage=receive;for(const type of eventTypes)source.addEventListener(type,receive);void refresh();polling=setInterval(()=>void refresh(),2500);
    return()=>{alive=false;source?.close();if(polling)clearInterval(polling);};
  },[id,revision]);return {detail,error,channel,segment,reload:()=>reload(value=>value+1)};
}
export function SchemaInputs({schema,values,onChange,disabled=false}:{schema?:JsonSchema;values:Record<string,string|number|boolean>;onChange:(values:Record<string,string|number|boolean>)=>void;disabled?:boolean}){return <div className="e-grid two">{Object.entries(schema?.properties||{}).map(([key,field])=><label className="e-field" key={key}>{field.title||key}{schema?.required?.includes(key)?'（必填）':''}{field.enum?.length?<SelectControl value={String(values[key]??'')} required={schema?.required?.includes(key)} disabled={disabled} onChange={e=>onChange({...values,[key]:e.target.value})}><option value="">请选择对象</option>{field.enum.map(value=><option key={String(value)} value={String(value)}>{String(value)}</option>)}</SelectControl>:field.type==='boolean'?<SelectControl value={values[key]===undefined?'':String(values[key])} disabled={disabled} onChange={e=>{if(e.target.value===''){const next={...values};delete next[key];onChange(next);}else onChange({...values,[key]:e.target.value==='true'});}}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></SelectControl>:<input disabled={disabled} type={['number','integer'].includes(field.type)?'number':'text'} step={field.type==='integer'?1:'any'} value={String(values[key]??'')} onChange={e=>onChange({...values,[key]:['number','integer'].includes(field.type)&&e.target.value!==''?Number(e.target.value):e.target.value})}/>}</label>)}</div>;}
export function ScenarioPicker({value,onChange,inputs,onInputs,disabled}:{value:string;onChange:(id:string)=>void;inputs:Record<string,string|number|boolean>;onInputs:(values:Record<string,string|number|boolean>)=>void;disabled:boolean}){const r=useResource<{scenarios:BusinessScenario[]}>('/scenarios');const version=r.data?.scenarios.flatMap(row=>row.versions).find(row=>row.id===value);return <div className="e-chat-scenario"><label className="e-field">业务场景<SelectControl value={value} onChange={e=>{onChange(e.target.value);onInputs({});}} disabled={disabled}><option value="">通用知识问答</option>{r.data?.scenarios.flatMap(row=>row.versions.filter(v=>v.status==='published').map(v=><option key={v.id} value={v.id}>{row.name} · V{v.version}</option>))}</SelectControl></label>{r.error&&<Notice kind="error">场景列表：{r.error}</Notice>}{version&&<><p className="e-muted">{version.goal}</p><SchemaInputs schema={version.inputSchema} values={inputs} onChange={onInputs} disabled={disabled}/></>}</div>;}
export function RunProgress({observer,user,onRun,layout='standalone',children}:{observer:ReturnType<typeof useChatRuns>;user:User;onRun:(id:string)=>void;layout?:'standalone'|'inline';children?:ReactNode}) {
  const run=observer.detail?.run;
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [inputs,setInputs]=useState<Record<string,string|number|boolean>>({});
  const [detailsOpen,setDetailsOpen]=useState(false);
  const detailsId=useId();
  const active=isActiveRun(run?.status);
  const completed=run?.status==='completed'||run?.status==='succeeded';
  const needsAttention=Boolean(run&&['failed','interrupted','partial','waiting_input'].includes(run.status));
  const steps=observer.detail?.steps||[];
  const runError=run?.errorMessage||(typeof run?.error==='string'?run.error:run?.error?.message)||run?.errorCode;
  const stepErrors=[...new Set(steps.map(step=>step.error||step.errorCode).filter((message):message is string=>Boolean(message)&&message!==runError))];
  useEffect(()=>{setDetailsOpen(false);},[run?.id,run?.attempt]);

  async function action(type:string,e?:FormEvent) {
    e?.preventDefault();if(!run)return;setBusy(true);setError('');
    try {
      const data=await api<{run?:ChatRun}>(`/chat/runs/${run.id}/${type}`,{method:'POST',body:JSON.stringify({revision:run.revision,clientRequestId:crypto.randomUUID(),inputRequestId:run.waitingFor?.inputRequestId||crypto.randomUUID(),inputs})});
      if(data.run?.id)onRun(data.run.id);observer.reload();
    } catch(e) {setError(errorMessage(e));} finally {setBusy(false);}
  }

  const summary=run?<div className="e-run-summary">
    <span className={`e-run-status${completed?' is-completed':needsAttention?' needs-attention':''}`} role="status" aria-live="polite" aria-atomic="true">
      {completed?<CheckCircle2 size={14} aria-hidden="true"/>:needsAttention?<CircleAlert size={14} aria-hidden="true"/>:<CircleDashed size={14} aria-hidden="true"/>}
      {runLabels[run.status]||run.status}
    </span>
    <button type="button" className="e-run-details-toggle" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={()=>setDetailsOpen(value=>!value)}>
      {steps.length?<>处理步骤 <span>· {steps.length}</span></>:'处理详情'}<ChevronDown size={13} aria-hidden="true"/>
    </button>
    {user.role==='admin'&&run.traceId&&<Link className="e-run-trace-link" to={`/settings/traces?trace=${encodeURIComponent(run.traceId)}`}>查看处理链</Link>}
    {(active||['failed','interrupted','partial','cancelled'].includes(run.status))&&<div className="e-run-summary-actions">
      {active&&<button className="e-text-link" disabled={busy} onClick={()=>void action('cancel')}><Square size={12} aria-hidden="true"/>取消本次运行</button>}
      {['failed','interrupted','partial','cancelled'].includes(run.status)&&<button className="e-run-retry" disabled={busy} onClick={()=>void action('retry')}><RefreshCw size={13} aria-hidden="true"/>重新尝试</button>}
    </div>}
  </div>:null;

  const body=<>
    {(observer.error||error)&&<Notice kind="error">{error||observer.error}<button className="e-text-link" onClick={observer.reload}>重新读取运行</button></Notice>}
    {observer.channel&&active&&<p className="e-muted">{observer.channel}</p>}
    {run?<>
      {layout==='inline'?<div className="e-answer-actions">{children}{summary}</div>:summary}
      <div className="e-run-detail-panel" id={detailsId} hidden={!detailsOpen}>
        <p className="e-run-metadata">第 {run.attempt} 次尝试 <span>·</span> {formatDate(run.createdAt)}</p>
        {steps.length?<ol className="e-run-steps">{steps.map((step,i)=><li key={step.id||step.stepId||i}>
          <span className={`e-badge ${['completed','succeeded'].includes(step.status)?'published':''}`}>{runLabels[step.status]||step.status}</span>
          <span>{stepTitle(step,i)}</span>
          {step.durationMs!==undefined&&<small>{step.durationMs} ms</small>}
        </li>)}</ol>:<p className="e-muted">{active?'正在读取实际处理进度…':'暂无处理步骤记录'}</p>}
        {completed&&<ToolResults results={observer.detail?.result?.toolResults}/>}
      </div>
      {active&&!steps.length&&<Loading text="正在读取实际处理进度…"/>}
      {observer.segment&&active&&<div><span className="e-badge review">生成中，尚未形成完整答复</span><p className="e-evidence-text">{observer.segment}</p></div>}
      {runError&&<Notice kind="error">{runError}</Notice>}
      {stepErrors.length>0&&<Notice kind="error">{stepErrors.map(message=><p key={message}>{message}</p>)}</Notice>}
      {run.status==='waiting_input'&&run.waitingFor&&<form className="e-stack" onSubmit={e=>void action('inputs',e)}>
        <Notice>{run.waitingFor.message||run.waitingFor.question||'请补充以下条件后继续。'}</Notice>
        <SchemaInputs schema={{type:'object',properties:Object.fromEntries((run.waitingFor.fields||[]).map(field=>typeof field==='string'?[field,{type:'string',title:field}]:[field.name,{type:field.type||'string',title:field.label||field.name,enum:field.options}])),required:(run.waitingFor.fields||[]).map(field=>typeof field==='string'?field:field.name)}} values={inputs} onChange={setInputs} disabled={busy}/>
        <button className="e-btn primary" disabled={busy}>补充并继续</button>
      </form>}
      {run.status==='partial'&&observer.detail?.result?.answer&&<div><Notice kind="warning">本次结果仅部分完成，请核对未完成项后继续。</Notice><AnswerText content={observer.detail.result.answer} citations={observer.detail.result.citations}/><AnswerCitations message={observer.detail.result}/></div>}
      {!completed&&!active&&<ToolResults results={observer.detail?.result?.toolResults}/>}
    </>:!observer.error&&(layout==='inline'?null:<Loading text="运行已提交，正在获取进度…"/>)}
  </>;

  if(layout==='inline')return <div className="e-run-progress e-run-progress-compact e-run-progress-inline" aria-label="问答处理状态">{body}</div>;
  return <section className="e-run-progress e-run-progress-compact" aria-label="问答处理状态">{body}</section>;
}
export function ToolResults({results}:{results?:ToolResult[]}){if(!results?.length)return null;return <div className="e-tool-results">{results.map((row,i)=><details key={i} open={results.length===1}><summary>{({search_knowledge:'知识检索',query_table:'表格筛选与计算',compare_clauses:'条款对照',lookup_asset:'设备台账查询',lookup_work_orders:'维修记录查询',create_report_draft:'本地报告草稿'} as Record<string,string>)[row.tool]||row.tool} · {runLabels[row.status]||row.status}</summary><CoverageNotice coverage={row.coverage}/><ToolData value={row.result}/>{row.calculation!=null&&<details className="e-detail-json"><summary>计算条件与过程</summary><DataValue value={row.calculation}/></details>}{row.missing!=null&&<><h4>缺少的数据</h4><DataValue value={row.missing}/></>}</details>)}</div>;}

function ToolData({value}:{value:unknown}) { if(Array.isArray(value)&&value.length&&value.every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&Object.values(row).every(cell=>cell==null||typeof cell!=='object'))){const rows=value as Record<string,unknown>[];const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];return <div className="e-table-scroll" tabIndex={0} aria-label="实际工具结果，可横向滚动"><table><thead><tr>{headers.map(header=><th key={header}>{header==='sourceRowNumber'?'来源记录号':header}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{headers.map(header=><td key={header}>{row[header]==null?'—':String(row[header])}</td>)}</tr>)}</tbody></table></div>;}return <DataValue value={value}/>;}
