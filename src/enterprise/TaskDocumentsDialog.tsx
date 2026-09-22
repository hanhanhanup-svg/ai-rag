import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Check, Search, X } from 'lucide-react';
import { api, errorMessage, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, StatusBadge } from './components';
import { SelectControl } from './SelectControl';
import type { KnowledgeDocument } from './types';
import './task-documents.css';

type Scene = {id:string;label:string;tasks:string[]};
type TaskLink = {id:string;documentId:string;title?:string;scenario:string;task:string;reason:string;chunkIds?:string[];status:string;revision:number;stale:boolean;canManage:boolean;documentVersion?:number;documentStatus?:string;documentRetrievable?:boolean;currentDocumentSignature?:string};
type LinkData = {links:TaskLink[];scenarios:Scene[]};
type PickDocument = KnowledgeDocument & {retrievable?:boolean;currentDocumentSignature?:string};
type DocumentData = {documents:PickDocument[];pagination:{total:number;hasMore:boolean;nextOffset:number|null}};
const PAGE_SIZE=20;
const purposeOptions=['用于任务前的资料准备','用于执行过程中的依据核对','用于办理结果的复核'];

export function TaskDocumentsDialog({initialScenario='',initialTask='',baseId='',onClose,onSaved}:{initialScenario?:string;initialTask?:string;baseId?:string;onClose:()=>void;onSaved:()=>void}) {
  const links=useResource<LinkData>('/recommendation-links');
  const [scene,setScene]=useState(initialScenario);
  const [task,setTask]=useState(initialTask);
  const [tab,setTab]=useState<'add'|'configured'>('add');
  const [query,setQuery]=useState('');const [applied,setApplied]=useState('');const [offset,setOffset]=useState(0);
  const [selected,setSelected]=useState<PickDocument[]>([]);const [purpose,setPurpose]=useState('');
  const [editing,setEditing]=useState<TaskLink|null>(null);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [confirmClose,setConfirmClose]=useState(false);
  const scenes=links.data?.scenarios||[];
  const tasks=scenes.find(row=>row.id===scene)?.tasks||[];
  const contextReady=Boolean(scene&&task&&tasks.includes(task));
  const records=(links.data?.links||[]).filter(row=>row.scenario===scene&&row.task===task);
  const docs=useResource<DocumentData>(contextReady&&tab==='add'?'/documents?'+new URLSearchParams({baseId,q:applied,status:'published',limit:String(PAGE_SIZE),offset:String(offset)}):null);
  const dirty=selected.length>0||Boolean(editing);
  function close(){if(busy)return;if(dirty)setConfirmClose(true);else onClose();}
  function chooseScene(value:string){setScene(value);setTask('');setOffset(0);setError('');setNotice('');}
  function changeTab(value:'add'|'configured'){setTab(value);setError('');setNotice('');}
  useEffect(()=>{if(initialTask&&!tasks.includes(initialTask)&&links.data&&task===initialTask)setTask('');},[links.data,initialTask,task,tasks]);
  function toggle(doc:PickDocument){setSelected(old=>old.some(row=>row.id===doc.id)?old.filter(row=>row.id!==doc.id):[...old,doc]);setNotice('');}
  async function save(event:FormEvent){
    event.preventDefault();if(!contextReady||!selected.length||purpose.trim().length<3||busy)return;
    setBusy(true);setConfirmClose(false);setError('');setNotice('');let saved=0;const completed=new Set<string>();const failures:string[]=[];
    try {
      // Refresh before a batch so a retry does not recreate links already persisted.
      const latest=await api<LinkData>('/recommendation-links');
      for(const doc of selected){
        if(latest.links.some(row=>row.documentId===doc.id&&row.scenario===scene&&row.task===task)){completed.add(doc.id);failures.push(`《${doc.title}》已有配置，请到“已配置”查看。`);continue;}
        try{await api('/recommendation-links',{method:'POST',body:JSON.stringify({documentId:doc.id,expectedDocumentSignature:doc.currentDocumentSignature,scenario:scene,task,reason:purpose.trim(),status:'approved'})});saved++;completed.add(doc.id);}
        catch(e){if((e as {code?:string}).code==='LINK_DOCUMENT_CHANGED'){completed.add(doc.id);docs.reload();failures.push(`《${doc.title}》已发生变化，已从本次选择移除。请查看原文后重新勾选。`);}else failures.push(`《${doc.title}》：${errorMessage(e)}`);}
      }
      setSelected(old=>old.filter(doc=>!completed.has(doc.id)));links.reload();
      if(saved){onSaved();setNotice(`已为“${task}”配置 ${saved} 份资料。`);}
      if(failures.length)setError(failures.join('\n'));
      else {setPurpose('');setTab('configured');}
    } catch(e){setError(errorMessage(e));} finally{setBusy(false);}
  }
  async function update(row:TaskLink,status=row.status){
    if(busy||row.reason.trim().length<3)return;setBusy(true);setError('');setNotice('');
    try{await api('/recommendation-links',{method:'POST',body:JSON.stringify({...row,status,expectedDocumentSignature:row.currentDocumentSignature})});setEditing(null);links.reload();onSaved();setNotice(status==='disabled'?'已停用此任务配置，资料原件继续保留。':'任务资料配置已保存。');}
    catch(e){setError((e as {code?:string}).code==='LINK_DOCUMENT_CHANGED'?'资料已发生变化，请取消本次编辑、重新查看原文后再配置。':errorMessage(e));links.reload();}finally{setBusy(false);}
  }
  return <Modal title="配置任务资料" wide busy={busy} onClose={close}>
    <div className="td-dialog">
      <p className="td-intro">为一项任务选好资料，查找依据时就能优先找到。</p>
      {confirmClose&&<Notice kind="warning">当前选择还未保存。<div className="e-actions"><button className="e-btn" disabled={busy} onClick={()=>setConfirmClose(false)}>继续配置</button><button className="e-btn" disabled={busy} onClick={()=>{if(!busy)onClose();}}>放弃并关闭</button></div></Notice>}
      {(error||links.error||docs.error)&&<Notice kind="error"><span style={{whiteSpace:'pre-line'}}>{error||links.error||docs.error}</span><button className="e-text-link" disabled={busy} onClick={()=>{links.reload();docs.reload();setError('');}}>重新加载</button></Notice>}
      {notice&&<Notice kind="success">{notice}</Notice>}
      <section className="td-context" aria-label="选择任务">
        <div className="td-section-title"><span>1</span><strong>选择任务</strong><small>已带入页面选择，可在这里调整</small></div>
        <div className="e-grid two"><label className="e-field">业务场景<SelectControl aria-label="配置业务场景" value={scene} disabled={busy||dirty||links.loading} onChange={e=>chooseScene(e.target.value)}><option value="">请选择业务场景</option>{scenes.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</SelectControl></label><label className="e-field">业务任务<SelectControl aria-label="配置业务任务" value={task} disabled={busy||dirty||!scene} onChange={e=>{setTask(e.target.value);setOffset(0);setError('');setNotice('');}}><option value="">请选择一项任务</option>{tasks.map(row=><option key={row}>{row}</option>)}</SelectControl></label></div>
      </section>
      {links.loading&&!links.data?<Loading/>:!contextReady?<div className="td-start"><BookOpen size={30}/><strong>先选一项任务，再为它添加资料</strong><p>每项任务单独配置，已有资料不会被覆盖。</p></div>:<>
        <div className="td-tabs" role="group" aria-label="资料配置视图"><button className={tab==='add'?'active':''} aria-pressed={tab==='add'} disabled={busy||Boolean(editing)} onClick={()=>changeTab('add')}>添加资料</button><button className={tab==='configured'?'active':''} aria-pressed={tab==='configured'} disabled={busy||selected.length>0} onClick={()=>changeTab('configured')}>已配置 <span>{records.length}</span></button></div>
        {tab==='add'?<form onSubmit={save} className="td-add">
          <div className="td-section-title"><span>2</span><strong>勾选所需资料</strong><small>{baseId?'当前知识库范围':'全部可访问知识库'}</small></div>
          <div className="td-search"><Search size={17}/><input aria-label="搜索可配置资料" value={query} disabled={busy} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();setApplied(query.trim());setOffset(0);}}} placeholder="搜索资料名称或关键词"/><button className="e-btn" type="button" disabled={busy} onClick={()=>{setApplied(query.trim());setOffset(0);}}>查找</button></div>
          <div className="td-pick-list" aria-label="可配置资料">
            {docs.loading?<Loading/>:docs.data?.documents.length?docs.data.documents.map(doc=>{
              const configured=records.some(row=>row.documentId===doc.id);const checked=selected.some(row=>row.id===doc.id);
              return <div className={`td-document ${checked?'selected':''}`} key={doc.id}><label><input type="checkbox" checked={checked||configured} disabled={busy||configured||!doc.canManage||!doc.retrievable||links.loading||Boolean(links.error)} onChange={()=>toggle(doc)}/><div><strong>{doc.title}</strong><div className="td-document-meta"><span>V{doc.version}</span><StatusBadge status={doc.status}/>{configured?<span>已配置</span>:!doc.canManage?<span>仅可查看</span>:!doc.retrievable?<span>当前不可用于搜索</span>:null}</div></div></label><Link to={'/documents/'+doc.id} target="_blank" rel="noreferrer" className="e-text-link">查看原文</Link></div>;
            }):<EmptyState title="没有找到相关资料" description="试试其他关键词，或先将所需资料接入知识库。"/>}
          </div>
          {docs.data&&<div className="td-pagination"><span>第 {Math.floor(offset/PAGE_SIZE)+1} 页{selected.length>0?` · 已选 ${selected.length} 份`:''}</span><div><button type="button" className="e-text-link" disabled={busy||offset===0||docs.loading} onClick={()=>setOffset(old=>Math.max(0,old-PAGE_SIZE))}>上一页</button><button type="button" className="e-text-link" disabled={busy||!docs.data.pagination.hasMore||docs.loading} onClick={()=>setOffset(docs.data?.pagination.nextOffset||0)}>下一页</button></div></div>}
          {selected.length>0&&<section className="td-purpose"><div className="td-section-title"><span>3</span><strong>说明这些资料的用途</strong></div><div className="td-selection">{selected.map(doc=><span key={doc.id}>{doc.title}<button type="button" disabled={busy} aria-label={'取消选择'+doc.title} onClick={()=>toggle(doc)}><X size={12}/></button></span>)}</div><div className="td-purpose-options">{purposeOptions.map(value=><button type="button" disabled={busy} key={value} aria-pressed={purpose===value} onClick={()=>setPurpose(value)}>{value}</button>)}</div><input aria-label="资料用途说明" required minLength={3} maxLength={1000} disabled={busy} value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="选择上方用途，或补充一句具体说明"/><small>本次说明应用于已勾选资料，保存后仍按资料权限、发布状态和有效期参与搜索。</small></section>}
          <footer className="td-footer"><div><strong>{selected.length?`已选 ${selected.length} 份资料`:'勾选资料后即可保存'}</strong>{selected.length>0&&<button type="button" className="e-text-link" disabled={busy} onClick={()=>{setSelected([]);setPurpose('');}}>清空选择</button>}</div><button className="e-btn primary" disabled={busy||!selected.length||purpose.trim().length<3||links.loading||Boolean(links.error)} type="submit"><Check size={16}/>{busy?'正在保存…':'保存并启用'}</button></footer>
        </form>:<div className="td-configured">
          {records.length?records.map(row=><article className="td-configured-row" key={row.id}><div className="td-configured-heading"><Link target="_blank" rel="noreferrer" to={'/documents/'+row.documentId}>{row.title||'资料'}</Link><span className={`e-badge ${row.stale?'review':row.status==='approved'?'published':''}`}>{row.status==='disabled'?'已停用':row.documentRetrievable===false?'资料当前不可用':row.stale?'版本变化，需确认':row.status==='approved'?'已启用':'待启用'}</span></div>
            {editing?.id===row.id?<div className="td-edit"><label className="e-field">资料用途说明<textarea aria-label="编辑资料用途" rows={2} maxLength={1000} value={editing.reason} disabled={busy} onChange={e=>setEditing({...editing,reason:e.target.value})}/></label>{row.stale&&<div className="e-stack"><p className="e-muted">请先查看当前原文，再确认是否继续用于此任务。</p>{Boolean(row.chunkIds?.length)&&<label className="e-check"><input type="checkbox" disabled={busy} checked={!editing.chunkIds?.length} onChange={e=>setEditing({...editing,chunkIds:e.target.checked?[]:row.chunkIds})}/>已核对原文，改为关联整份资料并清除旧段落定位</label>}</div>}<div className="e-actions"><button className="e-btn primary" disabled={busy||editing.reason.trim().length<3||row.documentRetrievable===false||(row.stale&&Boolean(editing.chunkIds?.length))} onClick={()=>void update(editing,row.stale||row.status!=='approved'?'approved':row.status)}>{row.stale?'确认当前版本并启用':row.status!=='approved'?'保存并启用':'保存说明'}</button><button className="e-btn" disabled={busy} onClick={()=>setEditing(null)}>取消</button></div></div>:<><p>{row.reason}</p>{row.canManage&&<div className="e-actions"><button className="e-text-link" disabled={busy||Boolean(editing)} onClick={()=>{setEditing({...row});setError('');setNotice('');}}>{row.stale?'查看并确认':row.status!=='approved'?'查看并启用':'修改用途'}</button>{row.status!=='disabled'&&<button className="e-text-link" disabled={busy||Boolean(editing)} onClick={()=>void update(row,'disabled')}>停用</button>}</div>}</>}
          </article>):<EmptyState title="这项任务还没有配置资料" action={<button className="e-btn primary" onClick={()=>changeTab('add')}>添加资料</button>}/>}
        </div>}
      </>}
    </div>
  </Modal>;
}


