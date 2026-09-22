import { ArrowRight, BookOpen, CircleAlert, Clock3, FileText, Gauge, Layers3, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate, useResource } from './api';
import { EmptyState, Loading, Notice, StatusBadge } from './components';
import type { User } from './types';
import type { WorkspaceSummary } from './WorkspaceTypes';
export const todoKindNames:Record<string,string>={review:'发布审核',processing:'加工事项',conflict:'内容核验',review_due:'时效复审',feedback:'用户反馈',evidence:'证据复核',case:'改进事项',pending_review:'发布审核',failed:'加工异常',knowledge_issue:'内容核验',governance:'知识治理'};
export function WorkspaceHome({user}:{user:User}){
  const r=useResource<WorkspaceSummary>('/workspace/summary');const [query,setQuery]=useState('');const navigate=useNavigate();
  const data=r.data;const editor=user.role!=='viewer';
  function search(e:FormEvent){e.preventDefault();if(query.trim())navigate(`/application/find?q=${encodeURIComponent(query.trim())}`);}
  return <div className="e-page ws-page ws-home"><div className="ws-page-heading"><div><h1>工作概览</h1></div><button className="e-btn" aria-label="刷新工作台" onClick={r.reload}><RefreshCw size={15}/>刷新</button></div>
    <section className="ws-command"><div className="ws-command-main"><h2>查找知识依据</h2><p className="ws-search-description">综合业务场景、文档搜索与知识图谱</p><form onSubmit={search}><Search size={20}/><input aria-label="工作台搜索知识" value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入设备、规程名称或具体业务问题…"/><button type="submit">综合查找<ArrowRight size={15}/></button></form><div className="ws-command-links"><Link to="/application/find">综合查找<ArrowRight size={13}/></Link><Link to="/application/hub">按业务场景开始<ArrowRight size={13}/></Link><Link to="/application/chat">进入智能问答<ArrowRight size={13}/></Link><Link to="/assets/graph">探索知识图谱<ArrowRight size={13}/></Link></div></div></section>
    {editor&&<Link to="/operations/overview" className="ws-ops-entry" aria-label="进入运营总览">
      <span className="ws-ops-entry-icon" aria-hidden="true"><Gauge size={20}/></span>
      <div><strong>运营总览</strong><p>查看知识覆盖、问答结果与待处理问题，判断下一步需要完善什么。</p></div>
      <span className="ws-ops-entry-action">进入分析<ArrowRight size={14}/></span>
    </Link>}
    {r.error&&<Notice kind="error">{r.error}<button className="e-text-link" onClick={r.reload}>重新读取</button></Notice>}{r.loading&&!data?<Loading text="正在汇集工作范围内的知识与待办…"/>:data&&<>
    <div className="ws-metrics ws-home-metrics"><KnowledgeSummary total={data.documents.total} available={data.documents.published}/><Metric label={editor?'治理待办':'业务知识库'} value={editor?data.todos.length:data.bases.length} note={editor?'点击下方待办进入具体办理':'按专业和业务范围组织'} icon={editor?CircleAlert:Layers3}/><Metric label="示例资料" value={data.documents.bySourceKind?.synthetic||0} note="已标记来源，不代表真实运营记录" icon={ShieldCheck}/></div>
    <div className="ws-home-grid"><section className="ws-surface"><div className="ws-section-head"><div><span className="ws-overline">NEXT ACTION</span><h2>{editor?'需要处理的事项':'继续使用知识'}</h2></div><Link to={editor?'/governance/overview':'/application/favorites'}>{editor?'查看全部':'我的收藏'}<ArrowRight size={14}/></Link></div>{editor?data.todos.length?<div className="ws-todo-list">{data.todos.slice(0,6).map(todo=><Link key={todo.id} to={todo.route} className="ws-todo-row"><span className={`ws-priority ${todo.severity==='high'?'high':''}`}><CircleAlert size={16}/></span><div><strong>{todo.title}</strong><p>{todoKindNames[todo.kind]||'知识待办'} · {todo.description}</p></div><span className="ws-small-tag">{todoKindNames[todo.kind]||'待处理'}</span><ArrowRight size={14}/></Link>)}</div>:<EmptyState title="当前没有待处理事项" description="新增资料、质量问题和反馈会汇集到这里。"/>:<div className="ws-reader-actions"><Link to="/application/find"><Search/><strong>综合查找</strong><span>智能组合场景、文档与图谱</span><ArrowRight/></Link><Link to="/application/hub"><Sparkles/><strong>选择业务场景</strong><span>按当前任务找到知识与助手</span><ArrowRight/></Link><Link to="/application/search"><BookOpen/><strong>查找任务依据</strong><span>按适用范围核对推荐资料</span><ArrowRight/></Link></div>}</section>
    <section className="ws-surface"><div className="ws-section-head"><div><span className="ws-overline">RECENT KNOWLEDGE</span><h2>最近更新</h2></div><Link to="/assets/documents">知识文档<ArrowRight size={14}/></Link></div>{data.recentDocuments.length?<div className="ws-document-list">{data.recentDocuments.slice(0,5).map(doc=><Link key={doc.id} to={`/documents/${doc.id}`}><span className="e-file-icon"><FileText size={19}/></span><div><strong>{doc.title}</strong><p>V{doc.version} · {formatDate(doc.updatedAt)}{doc.sourceKind==='synthetic'?' · 合成示例':''}</p></div><StatusBadge status={doc.status}/></Link>)}</div>:<EmptyState title="还没有资料" description="接入并审核资料后，即可用于搜索和问答。"/>}</section></div>
    <p className="ws-footnote"><Clock3 size={12}/>统计来自当前可访问记录；示例资料、实际操作记录与模型运行结果分别保留来源。</p></>}
  </div>;
}
function KnowledgeSummary({total,available}:{total:number;available:number}){
  return <section className="ws-metric ws-knowledge-summary" aria-labelledby="ws-knowledge-title">
    <span id="ws-knowledge-title">资料总数<FileText size={17} aria-hidden="true"/></span>
    <strong>{total.toLocaleString()}</strong>
    <div className="ws-knowledge-availability">其中 <b>{available.toLocaleString()}</b> 份可用于搜索和问答</div>
    <small>按当前权限和知识库范围统计，不同版本分别计数。</small>
    <details className="ws-knowledge-conditions">
      <summary>可用条件</summary>
      <p>已发布、已生效、未过期，且来源未撤回、来源有效性未过期。</p>
    </details>
  </section>;
}
function Metric({label,value,note,icon:Icon}:{label:string;value:number;note:string;icon:typeof FileText}){return <div className="ws-metric"><span>{label}<Icon size={17}/></span><strong>{value.toLocaleString()}</strong><small>{note}</small></div>;}

