import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, FileText, Plus, RefreshCw, Settings2, Sparkles, UploadCloud, X } from 'lucide-react';
import { api, ApiError, errorMessage, fileBase64, formatBytes, useResource } from './api';
import { Modal, Notice } from './components';
import { SelectControl } from './SelectControl';
import { sourceKindNames } from './KnowledgeGovernance';
import { SourceCategorySettings, type SourceCategoriesData } from './SourceCategorySettings';
import type { KnowledgeBase, KnowledgeDocument, SourceKind, User } from './types';
import './upload-dialog.css';

type DraftStatus = 'idle'|'queued'|'generating'|'ready'|'failed'|'skipped';
type UploadItem = {id:string;file:File;status:'pending'|'uploading'|'done'|'failed';message?:string;documentId?:string;draft:string;draftOrigin:'empty'|'model'|'manual';draftStatus:DraftStatus;draftContext?:string;draftError?:string;draftWarnings?:string[]};
interface GuidanceTarget {configured:boolean;provider:string;baseUrl:string;model:string;destinationSignature:string;requiresConsent:true}
interface GuidanceConsent {confirmed:true;fileSha256:string;destinationSignature:string}
function nextYearDate(){const date=new Date();const month=date.getMonth();date.setFullYear(date.getFullYear()+1);if(date.getMonth()!==month)date.setDate(0);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
interface GuidanceResponse {draft:{applicability:string;model?:string;warnings?:string[]};coverage?:{partial:boolean};requiresReview:boolean}
const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.txt,.md,.markdown,.csv,.html,.htm,.json,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp,.tsv,.wav,.mp3,.m4a,.mp4,.mov,.webm,.ogg,.flac';
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const draftLabels:Record<DraftStatus,string>={idle:'等待生成说明',queued:'等待生成说明',generating:'正在生成辅助说明…',ready:'辅助说明已生成，待核对',failed:'辅助说明未生成',skipped:'已跳过自动生成'};
const uploadLabels={pending:'待上传',uploading:'上传中',done:'已保存',failed:'上传失败'};
export function UploadDialog({user,bases:allBases,defaultBase,previous,onClose,onUploaded}:{user:User;bases:KnowledgeBase[];defaultBase?:string;previous?:KnowledgeDocument;onClose:()=>void;onUploaded:()=>void}){
  const capabilities=useResource<{capabilities:Array<{id:string;status:string;detail:string}>}>('/knowledge/capabilities');
  const targetResource=useResource<{target:GuidanceTarget}>('/documents/applicability-target');
  const target=targetResource.data?.target;
  const categoriesResource=useResource<SourceCategoriesData>('/source-categories');
  const [savedCategories,setSavedCategories]=useState<SourceCategoriesData|null>(null);
  const categories=savedCategories||categoriesResource.data;
  const categoryOptions=categories?.categories||Object.entries(sourceKindNames).map(([id,name])=>({id,name,sourceKind:id as SourceKind,enabled:true,builtin:true}));
  const [categoryId,setCategoryId]=useState(previous?.sourceCategoryId||previous?.sourceKind||'unspecified');
  const selectedCategory=categoryOptions.find(row=>row.id===categoryId);
  const sourceKind=selectedCategory?.sourceKind||previous?.sourceKind||'unspecified';
  const [categorySettings,setCategorySettings]=useState(false);const [settingsBusy,setSettingsBusy]=useState(false);
  const [items,setItems]=useState<UploadItem[]>([]);const [activeId,setActiveId]=useState('');
  const bases=allBases.filter(base=>base.systemKind!=='feedback_learning');
  const [baseId,setBaseId]=useState(bases.some(base=>base.id===defaultBase)?defaultBase!:bases[0]?.id||'');
  const [sensitivity,setSensitivity]=useState(previous?.sensitivity||'internal');
  const [duplicateAction,setDuplicateAction]=useState(previous?'version':'skip');
  const [reviewDueAt,setReviewDueAt]=useState(nextYearDate);
  const [businessOwner,setBusinessOwner]=useState(previous?.businessOwner||user.name||user.username);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [dragging,setDragging]=useState(false);const [metadataOpen,setMetadataOpen]=useState(Boolean(previous));
  const [retry,setRetry]=useState(0);const input=useRef<HTMLInputElement>(null);const itemsRef=useRef(items);itemsRef.current=items;
  const generation=useRef<{id:string;context:string;controller:AbortController}|null>(null);const mounted=useRef(true);
  const context=JSON.stringify([baseId,sensitivity,categoryId,sourceKind,target?.destinationSignature,user.id,user.role,user.department]);const contextRef=useRef(context);contextRef.current=context;
  const activeItem=items.find(item=>item.id===activeId)||items[0];
  const needsDraft=(item:UploadItem)=>item.status!=='done'&&item.draftOrigin!=='manual'&&item.draftStatus!=='skipped'&&(item.draftContext!==context||['idle','queued','generating'].includes(item.draftStatus));
  const drafting=Boolean(baseId&&categories&&selectedCategory?.enabled&&(targetResource.loading||target?.configured))&&items.some(needsDraft);
  const patchItem=(id:string,patch:Partial<UploadItem>)=>setItems(old=>old.map(item=>item.id===id?{...item,...patch}:item));
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;generation.current?.controller.abort();};},[]);
  useEffect(()=>{
    const running=generation.current;
    const runningItem=items.find(item=>item.id===running?.id);
    if(running&&(running.controller.signal.aborted||running.context!==context||!runningItem||runningItem.draftOrigin==='manual'||runningItem.draftStatus==='skipped'||runningItem.status==='done'||!target?.configured)){
      running.controller.abort();generation.current=null;
    }
    if(generation.current||busy||!baseId||!categories||!selectedCategory?.enabled||!target?.configured)return;
    const original=items.find(needsDraft);if(!original)return;
    const controller=new AbortController();const request={id:original.id,context,controller};generation.current=request;
    patchItem(original.id,{draft:'',draftStatus:'generating',draftContext:context,draftError:undefined,draftWarnings:undefined});
    void (async()=>{
      try{
        if(!original.file.size||original.file.size>MAX_UPLOAD_BYTES)throw new Error('请选择非空且不超过 100 MB 的文件。');
        const [contentBase64,hash]=await Promise.all([fileBase64(original.file),original.file.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes))]);
        if(controller.signal.aborted||contextRef.current!==context||itemsRef.current.find(item=>item.id===original.id)?.draftOrigin==='manual')return;
        // Keep exact-file and destination binding for the user-authorized automatic request.
        const consent:GuidanceConsent={confirmed:true,fileSha256:Array.from(new Uint8Array(hash)).map(value=>value.toString(16).padStart(2,'0')).join(''),destinationSignature:target.destinationSignature};
        const result=await api<GuidanceResponse>('/documents/applicability-draft',{method:'POST',signal:controller.signal,body:JSON.stringify({baseId,fileName:original.file.name,contentBase64,sensitivity,sourceKind,sourceCategoryId:categoryId,consent})});
        if(controller.signal.aborted||contextRef.current!==context||!mounted.current)return;
        setItems(old=>old.map(item=>item.id!==original.id||item.draftOrigin==='manual'||item.status==='done'?item:{...item,draft:result.draft.applicability,draftOrigin:'model',draftStatus:'ready',draftContext:context,draftWarnings:result.draft.warnings||[],draftError:undefined}));
      }catch(error){
        if(controller.signal.aborted||contextRef.current!==context||!mounted.current)return;
        setItems(old=>old.map(item=>item.id!==original.id||item.draftOrigin==='manual'?item:{...item,draftStatus:'failed',draftContext:context,draftError:errorMessage(error)}));
        if(error instanceof ApiError&&error.code==='GUIDANCE_CONSENT_REQUIRED')targetResource.reload();
      }finally{
        if(generation.current===request){generation.current=null;if(mounted.current)setRetry(value=>value+1);}
      }
    })();
  },[context,items,retry,busy,Boolean(categories),selectedCategory?.enabled,target?.configured]);
  function add(files:File[]){
    if(busy||settingsBusy)return;setError('');const limited=previous?files.slice(0,1):files;
    const next=limited.map(file=>({id:crypto.randomUUID(),file,status:'pending' as const,draft:'',draftOrigin:'empty' as const,draftStatus:'idle' as const}));
    if(!next.length)return;
    setItems(old=>previous?next:[...old,...next]);setActiveId(next[0].id);setMetadataOpen(true);
  }
  function stopGeneration(){generation.current?.controller.abort();setItems(old=>old.map(item=>needsDraft(item)?{...item,draftStatus:'skipped',draftContext:context}:item));}
  function regenerate(){if(!activeItem||busy)return;patchItem(activeItem.id,{draftStatus:'idle',draftOrigin:'empty',draft:'',draftError:undefined,draftContext:undefined});if(!target?.configured)targetResource.reload();}
  function close(){generation.current?.controller.abort();onClose();}
  async function submit(event:FormEvent){
    event.preventDefault();if(categorySettings){setError('请先保存或关闭来源类别设置。');return;}if(!baseId||!items.length){setError('请选择知识库和需要上传的文件。');return;}
    if(drafting){setError('辅助说明正在生成，可等待完成或跳过生成后上传。');return;}
    if(!selectedCategory?.enabled){setError('所选来源类别已停用，请选择其他类别。');return;}
    if(settingsBusy){setError('请先完成来源类别设置。');return;}generation.current?.controller.abort();
    setBusy(true);setError('');
    let allSucceeded=true;
    for(const item of items){
      if(item.status==='done')continue;
      if(!item.file.size||item.file.size>MAX_UPLOAD_BYTES){allSucceeded=false;patchItem(item.id,{status:'failed',message:'文件不能为空且不得超过 100 MB。'});continue;}
      patchItem(item.id,{status:'uploading',message:'正在保存原件…'});
      try{const result=await api<{document:KnowledgeDocument;duplicate?:boolean}>('/documents',{method:'POST',body:JSON.stringify({fileName:item.file.name,contentBase64:await fileBase64(item.file),baseId,title:previous?.title,sensitivity,reviewDueAt:reviewDueAt||undefined,sourceKind,sourceCategoryId:categoryId,applicability:item.draft,businessOwner,duplicateAction,previousVersionId:previous?.id})});patchItem(item.id,{status:'done',documentId:result.document.id,message:result.duplicate?'已识别重复文件，保留已有资料':'原件已保存，后台正在处理'});onUploaded();}
      catch(error){allSucceeded=false;patchItem(item.id,{status:'failed',message:errorMessage(error)});}
    }
    setBusy(false);
    if(allSucceeded)close();
  }
  return <Modal title={previous?`上传新版本 · ${previous.title}`:'接入企业资料'} onClose={close} wide busy={busy||settingsBusy}><form className="e-stack up-form" onSubmit={submit}>
    {error&&<Notice kind="error">{error}</Notice>}
    {!bases.length&&!previous&&<Notice kind="warning">请先<Link className="e-text-link" to="/assets/knowledge-bases" onClick={close}>创建知识库</Link>，再接入资料。</Notice>}
    <div className="e-grid two"><label className="e-field">存入知识库<SelectControl value={baseId} onChange={e=>setBaseId(e.target.value)} required disabled={busy||Boolean(previous)}><option value="">请选择知识库</option>{bases.map(base=><option key={base.id} value={base.id}>{base.name}</option>)}</SelectControl></label><label className="e-field">资料访问级别<SelectControl value={sensitivity} onChange={e=>setSensitivity(e.target.value as 'internal'|'confidential')} disabled={busy}><option value="internal">内部资料：遵循知识库权限</option><option value="confidential">受限资料：管理员、上传人、库负责人及指定成员</option></SelectControl></label></div>
    <div
      className={`e-upload-drop up-drop ${items.length?'has-files':''} ${dragging?'dragging':''}`}
      onClick={()=>{if(!busy)input.current?.click();}}
      onDragOver={e=>{e.preventDefault();setDragging(true);}}
      onDragLeave={()=>setDragging(false)}
      onDrop={e=>{e.preventDefault();setDragging(false);add(Array.from(e.dataTransfer.files));}}
    >
      <span className="up-drop-icon" aria-hidden="true"><UploadCloud size={items.length?22:32}/></span>
      <div className="up-drop-copy">
        <strong>{items.length?'继续添加资料':previous?'选择一份新的原件':'拖入文件到此处'}</strong>
        <p className="up-drop-formats">PDF · Word · Excel · PPTX · 文本 · 图片 · 音视频</p>
        <p className="up-drop-limit">单份不超过 <em>100 MB</em></p>
      </div>
      <button type="button" className={`e-btn ${items.length?'':'primary'} up-drop-action`} onClick={e=>{e.stopPropagation();input.current?.click();}} disabled={busy}>
        {items.length?<><Plus size={15}/>{previous?'更换文件':'添加文件'}</>:'选择文件'}
      </button>
      <input ref={input} className="e-visually-hidden" type="file" multiple={!previous} accept={ACCEPT} onChange={e=>{add(Array.from(e.target.files||[]));e.target.value='';}}/>
    </div>
    {items.length>0&&<section className="up-files" aria-labelledby="up-files-title"><div className="up-section-heading"><h3 id="up-files-title">本次资料 <span>{items.length} 份</span></h3><small>{formatBytes(items.reduce((sum,item)=>sum+item.file.size,0))} · 已保存 {items.filter(item=>item.status==='done').length} 份</small></div><div className="up-file-list">{items.map(item=><div key={item.id} className={`up-file-row is-${item.status} ${activeItem?.id===item.id?'is-active':''}`}>
      <button type="button" className="up-file-select" aria-pressed={activeItem?.id===item.id} onClick={()=>{setActiveId(item.id);setMetadataOpen(true);}}><span className="up-file-icon"><FileText size={23}/></span><span className="up-file-body"><strong>{item.file.name}</strong><span>{formatBytes(item.file.size)}{item.message?' · '+item.message:''}</span><small>{item.draftOrigin==='manual'?'使用已编辑说明':!target?.configured&&!targetResource.loading&&item.draftStatus==='idle'?'可直接填写辅助说明':draftLabels[item.draftStatus]}</small></span></button>
      <span className={`up-file-status ${item.status}`}>{item.status==='done'?<Check size={13}/>:item.status==='uploading'?<RefreshCw size={13} className="e-spin"/>:null}{uploadLabels[item.status]}</span>
      {item.status==='done'&&item.documentId&&<Link className="e-text-link up-file-detail" to={`/documents/${item.documentId}`} onClick={close}>查看处理详情</Link>}
      {item.status!=='done'&&<button type="button" className="e-icon-btn" aria-label={`移除${item.file.name}`} disabled={busy} onClick={()=>setItems(old=>old.filter(row=>row.id!==item.id))}><X size={16}/></button>}
    </div>)}</div><p className="up-file-help">点击文件查看或编辑各自的辅助说明。</p></section>}
    {items.some(item=>/\.(wav|mp3|m4a|mp4|mov|webm|ogg|flac)$/i.test(item.file.name))&&<Notice kind={capabilities.data?.capabilities.find(row=>row.id==='asr')?.status==='available'?'info':'warning'}>{capabilities.loading?'正在核对本地转写能力…':capabilities.error||capabilities.data?.capabilities.find(row=>row.id==='asr')?.detail||'当前未取得转写能力状态，接入后请核验实际任务结果。'}</Notice>}
    <details className="e-advanced up-metadata" open={metadataOpen} onToggle={e=>setMetadataOpen(e.currentTarget.open)}><summary>来源、责任人与辅助说明</summary><div className="e-stack">
      <div className="e-grid two"><div className="e-field"><div className="up-field-heading"><label htmlFor="up-source-category">资料来源类别</label><button type="button" className="e-icon-btn up-settings-button" aria-label="设置资料来源类别" title="设置资料来源类别" disabled={busy||!categories} aria-expanded={categorySettings} onClick={()=>setCategorySettings(value=>!value)}><Settings2 size={15}/></button></div><SelectControl id="up-source-category" disabled={busy||categoriesResource.loading} value={categoryId} onChange={e=>setCategoryId(e.target.value)}>{categoryOptions.filter(row=>row.enabled||row.id===categoryId).map(row=><option key={row.id} value={row.id} disabled={!row.enabled}>{row.name}{!row.enabled?'（已停用）':''}</option>)}</SelectControl></div><label className="e-field">业务维护责任人<input disabled={busy} maxLength={120} value={businessOwner} onChange={e=>setBusinessOwner(e.target.value)} placeholder={user.name||user.username}/><small className="e-muted">默认当前用户，可按实际维护责任调整。</small></label></div>
      {categoriesResource.error&&<Notice kind="error">{categoriesResource.error}<button type="button" className="e-text-link" onClick={categoriesResource.reload}>重新读取来源类别</button></Notice>}
      {categorySettings&&categories&&<SourceCategorySettings onBusyChange={setSettingsBusy} data={categories} onClose={()=>setCategorySettings(false)} onSaved={result=>{setSavedCategories(result);setCategorySettings(false);}}/>}
      <div className="up-guidance"><div className="up-field-heading"><label htmlFor="up-applicability">适用范围与使用限制</label><span><Sparkles size={14}/>AI 辅助草稿</span></div>
        {activeItem&&<p className="up-guidance-file">当前文件：{activeItem.file.name}</p>}
        <textarea id="up-applicability" disabled={busy||!activeItem||activeItem.status==='done'} rows={4} maxLength={1000} value={activeItem?.draft||''} onChange={e=>activeItem&&patchItem(activeItem.id,{draft:e.target.value,draftOrigin:'manual',draftStatus:'ready',draftError:undefined})} placeholder={activeItem?'根据文档内容和当前角色权限生成，可直接修改。':'选择资料后，将自动生成辅助描述。'}/>
        <div className="up-guidance-footer"><small>根据文档内容、当前角色与知识库权限生成；请核对后使用。</small><div className="e-actions">{drafting&&<button className="e-text-link" type="button" disabled={busy} onClick={stopGeneration}>跳过生成</button>}{activeItem&&activeItem.status!=='done'&&<button className="e-text-link" type="button" disabled={busy||drafting||!baseId} onClick={regenerate}><Sparkles size={14}/>{activeItem.draftOrigin==='manual'?'重新生成并替换':activeItem.draftStatus==='failed'?'重试生成':'重新生成'}</button>}</div></div>
        {activeItem&&drafting&&needsDraft(activeItem)&&<div className="up-draft-progress" role="status"><RefreshCw className="e-spin" size={15}/>{targetResource.loading?'正在准备自动生成…':draftLabels[activeItem.draftStatus]}</div>}
        {activeItem&&!target?.configured&&!targetResource.loading&&<p className="up-draft-unavailable" role="status">自动生成暂不可用，可直接填写说明后上传。<button type="button" className="e-text-link" disabled={busy} onClick={targetResource.reload}>重试连接</button></p>}
        {activeItem?.draftError&&<Notice kind="warning">{activeItem.draftError} 可直接填写说明，或重试生成。</Notice>}
        {Boolean(activeItem?.draftWarnings?.length)&&<p className="up-draft-warning">{activeItem?.draftWarnings?.join('；')}</p>}
      </div>
      <details className="up-date-settings"><summary>复审与重复文件设置</summary><div className="e-stack"><label className="e-field">下次复审日期（可选）<input disabled={busy} type="date" value={reviewDueAt} onChange={e=>setReviewDueAt(e.target.value)}/><small className="e-muted">默认一年后复审，可调整。审核发布后生效，复审时再决定是否继续使用。</small></label><label className="e-field">遇到重复文件<SelectControl value={duplicateAction} disabled={busy||Boolean(previous)} onChange={e=>setDuplicateAction(e.target.value)}><option value="skip">跳过重复文件（推荐）</option><option value="version">作为新版本，审核发布后替换旧版</option><option value="copy">另存一份独立资料</option></SelectControl></label></div></details>
    </div></details>
    <p className="e-muted">原件和校验记录会保留；资料经过解析、校对和发布后，才可用于搜索与问答。</p>
    <div className="e-modal-actions"><button type="button" className="e-btn" disabled={busy||settingsBusy} onClick={close}>关闭</button><button className="e-btn primary" disabled={busy||categorySettings||settingsBusy||drafting||!baseId||!categories||!items.some(item=>item.status!=='done')}>{busy?'正在逐份上传…':drafting?'正在生成辅助说明…':items.some(item=>item.status==='failed')?'重试未完成文件':'开始上传'}</button></div>
  </form></Modal>;
}
