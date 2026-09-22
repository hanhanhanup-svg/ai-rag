import { usePageBreadcrumbs } from './Breadcrumbs';
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, FileText, FileUp, Plus, RefreshCw, Search, Trash2, Undo2, X } from 'lucide-react';
import { api, ApiError, errorMessage, formatBytes, formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader, StatusBadge } from './components';
import { SelectControl } from './SelectControl';
import { UploadDialog } from './UploadDialog';
import { sourceKindNames } from './KnowledgeGovernance';
import type { KnowledgeBase, KnowledgeDocument, User } from './types';
import './document-directory.css';
import './knowledge-issues.css';

type DirectoryDocument = KnowledgeDocument & {deletedAt?:string;deletedByName?:string};
type DirectoryData = { documents: DirectoryDocument[]; pagination?: { offset:number; limit:number; total:number; hasMore:boolean } };
const PAGE_SIZE = 50;
const statusOptions = [
  {value:'',label:'全部文件'}, {value:'published',label:'已发布'}, {value:'review',label:'待审核'},
  {value:'processing',label:'处理中'}, {value:'failed',label:'处理失败'}, {value:'archived',label:'已下架'},
];

export function DocumentDirectory({user,base,onChanged}:{user:User;base?:KnowledgeBase;onChanged?:()=>void}) {
  const location = useLocation();
  const [params,setParams] = useSearchParams();
  const rawPage = Number(params.get('page'));
  const page = Number.isSafeInteger(rawPage)&&rawPage>0&&Number.isSafeInteger((rawPage-1)*PAGE_SIZE) ? rawPage : 1;
  const baseId = base?.id || params.get('baseId') || '';
  const trash = user.role!=='viewer'&&params.get('trash')==='1';
  const availableStatuses = statusOptions.filter(item=>user.role!=='viewer'||['','published'].includes(item.value));
  const status = !trash&&availableStatuses.some(item=>item.value===params.get('status')) ? params.get('status')! : '';
  const appliedQuery = params.get('q') || '';
  const [query,setQuery] = useState(appliedQuery);
  const [upload,setUpload] = useState(false);
  const [action,setAction] = useState<{kind:'delete'|'restore';document:DirectoryDocument}|null>(null);
  const [actionBusy,setActionBusy] = useState(false);
  const [actionError,setActionError] = useState('');
  const [actionOutdated,setActionOutdated] = useState(false);
  const [notice,setNotice] = useState('');
  const bases = useResource<{bases:KnowledgeBase[]}>(base?null:'/bases');
  const knownBases = base ? [base] : bases.data?.bases || [];
  const resource = useResource<DirectoryData>((trash?'/documents/trash?':'/documents?')+new URLSearchParams({baseId,status,q:appliedQuery,limit:String(PAGE_SIZE),offset:String((page-1)*PAGE_SIZE)}));
  const documents = resource.data?.documents || [];
  const total = resource.data?.pagination?.total ?? documents.length;
  const processing = !trash&&documents.some(doc=>['queued','processing'].includes(doc.status)||['queued','processing'].includes(doc.embeddingStatus||''));
  const filtered = Boolean(appliedQuery||status||(!base&&baseId));
  const assetDirectory = location.pathname.startsWith('/assets/');
  useEffect(()=>setQuery(appliedQuery),[appliedQuery]);
  useEffect(()=>{if(!processing)return;const timer=window.setInterval(resource.reload,4000);return()=>clearInterval(timer);},[processing,resource.reload]);
  useEffect(()=>{
    if(!resource.data?.pagination||resource.loading||page<=Math.max(1,Math.ceil(total/PAGE_SIZE)))return;
    const next=new URLSearchParams(params);next.set('page',String(Math.max(1,Math.ceil(total/PAGE_SIZE))));setParams(next,{replace:true});
  },[resource.data,resource.loading,page,total,params,setParams]);
  function filter(key:string,value:string) {
    const next=new URLSearchParams(params);
    if(key!=='page')next.delete('page');
    value?next.set(key,value):next.delete(key);
    if(base)next.delete('baseId');
    setParams(next);
  }
  function resetFilters() {
    const next=new URLSearchParams(params);
    for(const key of ['q','status','page'])next.delete(key);
    if(!base)next.delete('baseId');
    setQuery('');setParams(next);
  }
  function changeView(deleted:boolean) {
    const next=new URLSearchParams(params);
    for(const key of ['q','status','page'])next.delete(key);
    deleted?next.set('trash','1'):next.delete('trash');
    setNotice('');setParams(next);
  }
  function refresh(){resource.reload();onChanged?.();}
  function selectAction(kind:'delete'|'restore',document:DirectoryDocument){setAction({kind,document});setActionError('');setActionOutdated(false);}
  async function submitAction() {
    if(!action||actionBusy||actionOutdated)return;
    setActionBusy(true);setActionError('');
    try {
      await api('/documents/'+encodeURIComponent(action.document.id)+(action.kind==='restore'?'/restore-from-trash':''),{method:action.kind==='restore'?'POST':'DELETE',body:JSON.stringify({revision:action.document.revision})});
      setNotice(action.kind==='restore'?'文档已恢复，完成处理与审核后可用于搜索问答。':'文档已移入回收站，可在回收站恢复。');
      setAction(null);refresh();
    } catch(error) {
      setActionError(errorMessage(error));
      if(error instanceof ApiError&&['REVISION_CONFLICT','DOCUMENT_CHANGED'].includes(error.code))setActionOutdated(true);
    } finally {setActionBusy(false);}
  }
  const viewButton=user.role!=='viewer'&&<button type="button" className="e-btn" onClick={()=>changeView(!trash)}>{trash?<ArrowLeft size={15}/>:<Trash2 size={15}/>}<span>{trash?'返回文档':'回收站'}</span></button>;
  const uploadButton=!trash&&user.role!=='viewer'&&(base?.systemKind==='feedback_learning'?<Link className="e-btn primary" to="/governance/feedback">从反馈加入</Link>:<button className={base||!assetDirectory?'e-btn primary':'e-btn'} onClick={()=>setUpload(true)}><Plus size={17}/>{base?'接入资料':'上传资料'}</button>);
  const heading=trash?(base?'本库回收站':'文档回收站'):(base?'本库知识文档':assetDirectory||user.role==='viewer'?'知识文档':'资料接入');

  return <div className={base?'e-document-directory is-scoped':'e-page e-document-directory'}>
    {!base&&<DirectoryBreadcrumbs trash={trash} assetDirectory={assetDirectory} baseId={baseId}/>} 
    {!base&&<PageHeader title={heading} description={trash?'恢复误删的文档，原件和版本记录继续保留。':'查看资料、处理进度与版本，让每一份企业知识都有清晰的状态。'} actions={<>{viewButton}{uploadButton}</>}/>}
    {notice&&<Notice kind="success">{notice}</Notice>}
    <section className="e-card e-document-workbench" aria-label={heading}>
      {base&&<div className="e-directory-heading"><div><h2>{heading}</h2><p>{trash?'已删除文档可恢复，原件与版本记录保留。':'查找资料、筛选状态，查看原件与历史版本。'}</p></div><div className="e-actions">{viewButton}{uploadButton}</div></div>}
      {!trash&&<div className="e-filter-tabs" aria-label="按处理状态筛选">
        {availableStatuses.map(item=><button type="button" aria-pressed={status===item.value} className={status===item.value?'active':''} key={item.value} onClick={()=>filter('status',item.value)}>{item.label}</button>)}
      </div>}
      <div className="e-toolbar">
        <form className="e-inline-search" onSubmit={event=>{event.preventDefault();filter('q',query.trim());}}>
          <Search size={17} aria-hidden="true"/>
          <input value={query} onChange={event=>setQuery(event.target.value)} placeholder={trash?'搜索已删除文档…':base?'搜索本库文件名称、标签…':'搜索文件名称、标签…'} aria-label={trash?'搜索已删除文档':base?'搜索本库文档':'搜索文件'}/>
          <button className="e-btn small" type="submit">搜索</button>
        </form>
        {!base&&<SelectControl className="e-input" aria-label="筛选知识库" value={baseId} onChange={event=>filter('baseId',event.target.value)}><option value="">全部知识库</option>{knownBases.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</SelectControl>}
        {filtered&&<button className="e-text-link e-directory-reset" type="button" onClick={resetFilters}><X size={13}/>清除筛选</button>}
        <button type="button" className="e-icon-btn" aria-label="刷新文件列表" title="刷新文件列表" disabled={resource.loading} onClick={refresh}><RefreshCw size={17}/></button>
      </div>
      {(resource.error||bases.error)&&<Notice kind="error">{resource.error||bases.error}<button className="e-text-link" onClick={()=>{refresh();bases.reload();}}>重新加载</button></Notice>}
      {resource.loading&&!resource.data?<Loading/>:resource.error?null:documents.length?<>
        <div className="e-table-wrap" tabIndex={0} aria-label={base?'本库文档列表，可横向滚动':'文档列表，可横向滚动'}>
          <table className="e-table e-doc-table"><thead><tr><th>文件名称</th>{!base&&<th>所属知识库</th>}<th>{trash?'删除时间':'处理状态'}</th><th>版本</th><th>负责人 / 更新时间</th><th>操作</th></tr></thead><tbody>
            {documents.map(doc=><tr key={doc.id}>
              <td>{trash?<div className="e-file-cell"><span className="e-file-icon"><FileText size={20}/></span><div><strong>{doc.title}</strong><p>{doc.fileName}</p></div></div>:<Link className="e-file-cell" to={'/documents/'+encodeURIComponent(doc.id)+'?tab=content'}><span className="e-file-icon"><FileText size={20}/></span><div><strong>{doc.title}</strong><p>{formatBytes(doc.size)} · {doc.fileName.split('.').pop()?.toUpperCase()} · {doc.sourceCategoryName||sourceKindNames[doc.sourceKind||'unspecified']}{doc.sensitivity==='confidential'?' · 受限资料':''}</p>{doc.applications&&<span className="ki-row-apps">多处应用 · {doc.applications.count} 处</span>}</div></Link>}</td>
              {!base&&<td>{knownBases.find(row=>row.id===doc.baseId)?.name||'—'}</td>}
              <td>{trash?<span>{formatDate(doc.deletedAt)}</span>:<><StatusBadge status={doc.status}/>{['queued','processing'].includes(doc.status)&&<div className="e-progress-caption"><progress max={100} value={doc.progress||0}/><span>{doc.stage||'等待解析'}</span></div>}{doc.error&&<p className="e-table-error" title={doc.error}>{doc.error}</p>}</>}</td>
              <td><span className="e-version">V{doc.version}</span></td>
              <td><span>{doc.ownerName||'—'}</span><p className="e-muted">{formatDate(doc.updatedAt)}</p></td>
              <td><div className="e-directory-row-actions">{trash?<button type="button" className="e-text-link" onClick={()=>selectAction('restore',doc)}><Undo2 size={14}/>恢复</button>:<><Link className="e-text-link" to={'/documents/'+encodeURIComponent(doc.id)+'?tab=content'}>{doc.status==='review'&&doc.canManage?'校对审核':'查看详情'}<ChevronRight size={14}/></Link>{doc.canManage&&user.role!=='viewer'&&<button type="button" className="e-text-link e-directory-delete" disabled={doc.status==='processing'||doc.embeddingStatus==='processing'} title={doc.status==='processing'||doc.embeddingStatus==='processing'?'处理完成后可删除':'删除此文档版本'} onClick={()=>selectAction('delete',doc)}><Trash2 size={13}/>删除</button>}</>}</div></td>
            </tr>)}
          </tbody></table>
        </div>
        <div className="e-table-footer"><span>共 {total} 份文档版本 · 第 {page} / {Math.max(1,Math.ceil(total/PAGE_SIZE))} 页</span><div className="e-actions"><button className="e-btn small" disabled={page<=1||resource.loading} onClick={()=>filter('page',String(page-1))}>上一页</button><button className="e-btn small" disabled={!resource.data?.pagination?.hasMore||resource.loading} onClick={()=>filter('page',String(page+1))}>下一页</button></div></div>
      </>:<EmptyState title={filtered?'没有符合条件的文件':trash?'回收站为空':base?'本库暂无文档':'还没有企业资料'} description={filtered?'调整关键词或筛选条件后再试。':trash?'删除的文档会出现在这里，需要时可恢复。':user.role==='viewer'?'管理员发布资料后，你可以在这里查阅。':'接入原件后，解析内容、版本和处理状态会显示在这里。'} action={filtered?<button className="e-btn" onClick={resetFilters}>清除筛选</button>:!trash&&user.role!=='viewer'&&(base?.systemKind==='feedback_learning'?<Link className="e-btn primary" to="/governance/feedback">从反馈加入</Link>:<button className="e-btn primary" onClick={()=>setUpload(true)}><FileUp size={17}/>上传资料</button>)}/>}
    </section>
    {!base&&!trash&&user.role!=='viewer'&&<div className="e-process-strip">{['上传原件','自动解析','校对审核','发布生效','检索问答'].map((text,index)=><div key={text}><span>{index+1}</span>{text}{index<4&&<ChevronRight size={15}/>}</div>)}</div>}
    {upload&&<UploadDialog user={user} bases={knownBases} defaultBase={baseId} onClose={()=>setUpload(false)} onUploaded={refresh}/>}
    {action&&<Modal title={action.kind==='delete'?'删除知识文档':'恢复知识文档'} onClose={()=>setAction(null)} busy={actionBusy}>
      <form className="e-stack" onSubmit={event=>{event.preventDefault();void submitAction();}}>
        <div className="e-directory-action-file"><FileText size={22}/><div><strong>{action.document.title}</strong><p>V{action.document.version} · {action.document.fileName}</p></div></div>
        <p className="e-directory-action-copy">{action.kind==='delete'?'将这一版本移入回收站，其他版本保留。删除后将退出文档列表和搜索问答，原件与记录保留，可随时恢复。':'恢复后回到文档列表。完成解析与审核后，可再次用于搜索问答。'}</p>
        {actionError&&<Notice kind="error">{actionError}{actionOutdated&&<p>请关闭弹窗并刷新列表，核对最新版本后重试。</p>}</Notice>}
        <div className="e-modal-actions"><button type="button" className="e-btn" disabled={actionBusy} onClick={()=>{setAction(null);if(actionOutdated)refresh();}}>{actionOutdated?'关闭并刷新':'取消'}</button><button className={action.kind==='delete'?'e-btn danger':'e-btn primary'} disabled={actionBusy||actionOutdated}>{actionBusy?'正在处理…':action.kind==='delete'?'移入回收站':'恢复文档'}</button></div>
      </form>
    </Modal>}
  </div>;
}


function DirectoryBreadcrumbs({trash,assetDirectory,baseId}:{trash:boolean;assetDirectory:boolean;baseId:string}) {
  const scope=baseId?'?baseId='+encodeURIComponent(baseId):'';
  usePageBreadcrumbs(trash?[
    {label:assetDirectory?'知识资产':'接入加工',to:assetDirectory?'/assets/knowledge-bases':'/production/overview'},
    {label:assetDirectory?'知识文档':'文件接入',to:(assetDirectory?'/assets/documents':'/production/upload')+scope},
    {label:'回收站'},
  ]:null);
  return null;
}

