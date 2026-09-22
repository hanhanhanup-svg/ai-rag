import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, CircleAlert, Expand, ExternalLink, FileText, GitBranch, Layers3, List, Maximize2, Minimize2, Network, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { api, errorMessage, useResource } from './api';
import { EmptyState, Loading, Modal, Notice } from './components';
import type { KnowledgeBase, User } from './types';
import { edgeEvidence, graphEvidenceUrl, graphRelationLabels, graphTypeLabels, type GraphData, type GraphEdge, type GraphEvidence, type GraphNode } from './GraphTypes';
import { GraphPaths } from './GraphPaths';
import { GraphScene } from './GraphScene';
import { aggregateGraph, graphTypeColor } from './graph-visual-model';
import './graph.css';
import { SelectControl } from './SelectControl';

const statusLabels: Record<string,string> = {confirmed:'已确认',candidate:'待复核',rejected:'已驳回'};
const phaseLabels:Record<string,string>={parsing:'解析中',parse_failed:'解析待处理',awaiting_parse:'已接入，等待解析',source_changed:'来源变化，待复核',awaiting_review:'关系待核验',connected:'已有可追溯关系',objects_found:'已识别对象，待关联',awaiting_extraction:'已解析，待提取或核验'};
const maxBatch = 50;

export function GraphPage({user}:{user:User}) {
  const [params,setParams] = useSearchParams();
  const baseId=params.get('baseId')||'', query=params.get('query')||'', entityId=params.get('entityId')||'', type=params.get('type')||'';
  const hops=Math.min(3,Math.max(1,Number(params.get('hops'))||2));
  const status=user.role==='viewer'?'confirmed':params.get('status')||'confirmed';
  const [queryInput,setQueryInput]=useState(query);
  const [view,setView]=useState<'graph'|'list'>('graph');
  const [presentation,setPresentation]=useState<'structure'|'relations'>(query||entityId||type?'relations':'structure');
  const [graphScope,setGraphScope]=useState<'path'|'all'>('path');
  const [immersive,setImmersive]=useState(false);
  const bases=useResource<{bases:KnowledgeBase[]}>('/bases');
  const r=useResource<GraphData>(`/graph?${new URLSearchParams({baseId,query,entityId,type,hops:String(hops),status})}`);
  const [selection,setSelection]=useState<{kind:'node'|'edge';id:string}|null>(entityId?{kind:'node',id:entityId}:null);
  const [checked,setChecked]=useState<string[]>([]);
  const [review,setReview]=useState<{edges:GraphEdge[];action:'confirm'|'reject'}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[extractOpen,setExtractOpen]=useState(false);
  const manageable=user.role!=='viewer'&&r.data?.canManage!==false;
  const nodes=r.data?.nodes||[], edges=r.data?.edges||[];
  const construction=r.data?.construction;
  const types=construction?.types||aggregateGraph(nodes,edges).nodes.map(item=>({type:item.type,nodeCount:item.count,documentCount:item.evidenceCount,relationCount:item.relationCount,confirmed:0,candidate:0}));
  const leadingPath=query?r.data?.paths?.[0]||null:null;
  const currentPath=presentation==='relations'&&leadingPath&&graphScope==='path'?leadingPath:null;
  const plottedNodes=currentPath?currentPath.nodeIds.flatMap(id=>{const node=nodes.find(n=>n.id===id);return node?[node]:[];}):nodes;
  const plottedEdges=currentPath?currentPath.edges:edges;
  const selectedNode=selection?.kind==='node'?nodes.find(n=>n.id===selection.id):undefined;
  const selectedEdge=selection?.kind==='edge'?edges.find(e=>e.id===selection.id):undefined;
  const hasSelection=!!(selectedNode||selectedEdge);
  const eligible=edges.filter(edge=>edge.canManage&&!edge.stale&&edge.status==='candidate');
  const selectedEdges=eligible.filter(edge=>checked.includes(edge.id));
  const hasSynthetic=edges.some(edge=>edge.evidenceRefs?.some(ref=>ref.sourceKind==='synthetic'));
  const documentCount=useMemo(()=>new Set(edges.map(e=>e.documentId)).size,[r.data]);
  const baseName=bases.data?.bases.find(base=>base.id===baseId)?.name||'全部可访问知识库';

  useEffect(()=>setQueryInput(query),[query]);
  useEffect(()=>{setGraphScope('path');setPresentation(query||entityId||type?'relations':'structure');},[query,entityId,baseId,type,hops]);
  useEffect(()=>{setChecked([]);setError('');setSelection(entityId?{kind:'node',id:entityId}:null);},[baseId,query,entityId,type,hops,status]);
  useEffect(()=>{if(!hasSelection||!window.matchMedia('(max-width: 700px)').matches)return;const frame=requestAnimationFrame(()=>window.document.querySelector('.e-graph-inspector')?.scrollIntoView({block:'start',behavior:'smooth'}));return()=>cancelAnimationFrame(frame);},[selection?.id,hasSelection]);
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!review&&!extractOpen){setImmersive(false);setSelection(null);}};window.addEventListener('keydown',escape,true);return()=>window.removeEventListener('keydown',escape,true);},[review,extractOpen]);
  useEffect(()=>{if(!immersive)return;const before=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=before;};},[immersive]);
  function update(values:Record<string,string>){const next=new URLSearchParams(params);for(const [key,value] of Object.entries(values)){if(value)next.set(key,value);else next.delete(key);}setParams(next);}
  function submit(event:FormEvent){event.preventDefault();setSelection(null);setView('graph');setPresentation('relations');update({query:queryInput.trim(),entityId:'',type:''});}
  function focus(node:GraphNode){setView('graph');setPresentation('relations');setSelection({kind:'node',id:node.id});update({entityId:node.id,query:'',type:''});}
  function focusType(value:string){setSelection(null);setView('graph');setPresentation('relations');setGraphScope('all');const category=types.find(item=>item.type===value);update({type:value,query:'',entityId:'',...(manageable&&category&&!category.confirmed?{status:'candidate'}:{})});}
  function overview(){setView('graph');setPresentation('structure');setSelection(null);update({entityId:'',query:'',type:''});}
  function selectSystem(value:string){if(!value){overview();return;}focusType(value);}
  function toggle(edge:GraphEdge){setChecked(current=>current.includes(edge.id)?current.filter(id=>id!==edge.id):current.length<maxBatch?[...current,edge.id]:current);}
  async function extract(){setBusy(true);setError('');try{const result=await api<{documentCount:number;entityCount:number;relationCount:number;message?:string}>('/graph/extract',{method:'POST',body:JSON.stringify({baseId:baseId||undefined})});setExtractOpen(false);setNotice(`${result.message||'关系候选提取完成。'} 处理 ${result.documentCount} 份文档，识别 ${result.entityCount} 个实体、${result.relationCount} 条关系。候选须核验后才参与检索。`);update({status:'candidate',query:'',entityId:'',type:type||''});r.reload();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  const activeSystem=type?types.find(item=>item.type===type):null;
  const pendingCount=activeSystem?activeSystem.candidate:(r.data?.stats.candidate||0);
  const systemTabs=[{id:'',label:'全部',nodeCount:types.reduce((sum,item)=>sum+item.nodeCount,0),candidate:r.data?.stats.candidate||0},...types.map(item=>({id:item.type,label:graphTypeLabels[item.type]||item.type,nodeCount:item.nodeCount,candidate:item.candidate}))];

  return <div className={`e-page e-graph-page xg-page ${immersive?'xg-immersive':''}`}>
    <header className="xg-heading">
      <div className="xg-title"><div className="xg-title-icon"><Network size={25}/></div><div><span className="xg-eyebrow">DOCUMENT KNOWLEDGE</span><h1>知识图谱<span>随文档积累，形成可追溯的知识体系</span></h1></div></div>
      <div className="xg-heading-actions"><button className="e-btn" onClick={()=>setImmersive(v=>!v)} aria-pressed={immersive}>{immersive?<Minimize2 size={15}/>:<Maximize2 size={15}/>}<span>{immersive?'退出专注':'专注图谱'}</span></button><button className="e-btn" disabled={r.loading||busy} onClick={r.reload} aria-label="刷新图谱"><RefreshCw size={15} className={r.loading?'e-spin':''}/></button></div>
    </header>

    <form className="xg-query-panel" onSubmit={submit}>
      <div className="xg-query-line"><Search size={19}/><input aria-label="搜索图谱对象或业务问题" value={queryInput} onChange={e=>setQueryInput(e.target.value)} maxLength={500} placeholder="搜索文档中已识别的对象或业务问题…"/><button className="e-btn primary" disabled={r.loading}>检索关系<ArrowRight size={15}/></button></div>
      <div className="xg-query-options"><label><span>知识范围</span><SelectControl aria-label="图谱知识范围" value={baseId} onChange={e=>update({baseId:e.target.value,entityId:''})}><option value="">全部可访问知识库</option>{bases.data?.bases.map(base=><option key={base.id} value={base.id}>{base.name}</option>)}</SelectControl></label><label><span>探索深度</span><SelectControl aria-label="关联范围" value={hops} onChange={e=>update({hops:e.target.value})}><option value="1">1 跳 · 直接关联</option><option value="2">2 跳 · 关联延伸</option><option value="3">3 跳 · 深度追溯</option></SelectControl></label>{manageable&&<label><span>关系状态</span><SelectControl aria-label="关系状态" value={status} onChange={e=>update({status:e.target.value})}><option value="confirmed">已确认有效</option><option value="candidate">候选待复核</option><option value="all">全部可维护关系</option></SelectControl></label>}</div>
    </form>
    {(error||r.error||bases.error)&&<Notice kind="error">{error||r.error||bases.error}<button className="e-text-link" onClick={r.reload}>重新读取</button></Notice>}
    {notice&&<Notice kind="success">{notice}</Notice>}
    {status!=='confirmed'&&<Notice kind="warning">关系治理视图：候选、过时和已驳回关系不会进入普通读者的检索与回答。</Notice>}

    <section className="xg-system-map" aria-label="随资料构建的知识体系">
      <div className="xg-system-caption"><span><Layers3 size={14}/>知识体系</span><small>按对象分类浏览；提取后请对照原文确认或驳回</small></div>
      <nav className="xg-system-tabs" aria-label="知识体系分类">
        {systemTabs.map(tab=><button key={tab.id||'all'} type="button" className={(!type&&!tab.id)||type===tab.id?'active':''} aria-pressed={(!type&&!tab.id)||type===tab.id} disabled={r.loading} onClick={()=>selectSystem(tab.id)}>
          <strong>{tab.label}</strong>
          <em>{tab.nodeCount}</em>
          {tab.candidate>0&&<span className="xg-system-pending">{tab.candidate}</span>}
        </button>)}
      </nav>
      {!types.length&&!r.loading&&<p className="xg-system-empty">{construction?.documentCount?'资料已接入，提取出有来源的对象后会在这里形成分类。':'从接入第一份文档开始，逐步形成对象分类与知识关联。'}</p>}
      {r.data&&<div className="xg-system-panel">
        <div className="xg-system-summary">
          <div><span>当前</span><strong>{activeSystem?graphTypeLabels[activeSystem.type]||activeSystem.type:'全部体系'}</strong></div>
          <div><span>对象</span><strong>{activeSystem?activeSystem.nodeCount:types.reduce((sum,item)=>sum+item.nodeCount,0)}</strong></div>
          <div><span>关系</span><strong>{activeSystem?activeSystem.relationCount:edges.length||r.data.stats.edgeCount}</strong></div>
          <div><span>来源</span><strong>{activeSystem?activeSystem.documentCount:construction?.sourceDocumentCount||0}</strong></div>
          <div><span>待核验</span><strong className={pendingCount?'is-pending':''}>{pendingCount}</strong></div>
        </div>
        <div className="xg-system-actions">
          {manageable&&<button type="button" className="e-btn primary" disabled={busy||r.loading} onClick={()=>{setError('');setExtractOpen(true);}}><GitBranch size={15}/>提取关系</button>}
          {manageable&&pendingCount>0&&<button type="button" className="e-btn" disabled={r.loading} onClick={()=>{setView('list');update({status:'candidate',...(type?{type}:{})});}}><Check size={15}/>核验待确认 · {pendingCount}</button>}
          {type&&<button type="button" className="e-btn" disabled={r.loading} onClick={()=>{setView('graph');setPresentation('relations');setGraphScope('all');}}>查看本类关系</button>}
          {!type&&types.length>0&&<button type="button" className="e-btn" disabled={r.loading} onClick={overview}>分类全景</button>}
        </div>
        <p className="xg-system-hint">提取只产生候选；确认后才进入检索与问答。手工调整：在关系列表勾选后批量确认或驳回，也可点开单条对照原文办理。</p>
      </div>}
      {Boolean(construction?.documents.length)&&<details className="xg-construction-sources" open={!types.length}><summary>来源文档与构建进度 <span>{construction?.documentCount} 份</span></summary><div className="xg-source-documents">{construction?.documents.map(doc=><Link key={doc.id} to={'/documents/'+encodeURIComponent(doc.id)+'?tab=evidence'}><FileText size={16}/><div><strong>{doc.title}</strong><small>V{doc.version}{doc.sourceKind==='synthetic'?' · 模拟资料':''} · {doc.entityCount} 个对象 · {doc.relationCount} 条关系</small></div><span className={['e-badge',doc.phase==='connected'?'published':''].join(' ')}>{phaseLabels[doc.phase]||doc.phase}</span><ChevronRight size={13}/></Link>)}</div>{construction?.documentsTruncated&&<p className="xg-system-empty">展示前 100 份来源文档，可选择知识库缩小范围。</p>}</details>}
    </section>

    <section className="e-graph-workbench xg-stage" aria-label="知识图谱工作台">
      <div className="xg-stage-header"><div className="xg-stage-heading"><span className="xg-stage-indicator"/><div><span className="xg-eyebrow">KNOWLEDGE RELATIONS</span><h2>{view==='list'?'关系与来源清单':presentation==='structure'?'当前知识体系':entityId?'对象关联网络':'业务关系探索'}</h2></div></div><div className="xg-mode-switch" role="group" aria-label="图谱视图切换"><button className={view==='graph'&&presentation==='structure'?'active':''} aria-pressed={view==='graph'&&presentation==='structure'} onClick={overview}><Layers3 size={15}/>分类全景</button><button className={view==='graph'&&presentation==='relations'?'active':''} aria-pressed={view==='graph'&&presentation==='relations'} onClick={()=>{setView('graph');setPresentation('relations');}}><Network size={15}/>关系探索</button><button className={view==='list'?'active':''} aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={15}/>关系列表</button></div></div>
      <div className="xg-stage-context"><div className="xg-scope-trail"><span>{baseName}</span><ChevronRight size={12}/><strong title={query||selectedNode?.name||graphTypeLabels[type]||type||'全部业务对象'}>{query||selectedNode?.name||graphTypeLabels[type]||type||'全部业务对象'}</strong></div><div className="xg-network-metrics"><span><b>{nodes.length}</b>对象</span><span><b>{edges.length}</b>关系</span><span><b>{documentCount}</b>来源</span>{r.data&&<span className="xg-verified-count"><ShieldCheck size={12}/>{edges.filter(edge=>edge.status==='confirmed'&&!edge.stale).length} 条已确认</span>}</div></div>
      {r.data?.limits.truncated&&<Notice kind="warning">结果受到对象、关系或路径展示上限限制。请缩小知识范围；当前画面不是完整图谱。</Notice>}
      {view==='graph'&&presentation==='relations'&&leadingPath&&<div className="xg-path-lens"><span><GitBranch size={15}/><strong>{currentPath?'聚焦完整证据链':'全部匹配关系'}</strong><small>{currentPath?`${plottedNodes.length} 个对象 · ${plottedEdges.length} 段关系`:`${nodes.length} 个对象 · ${edges.length} 条关系`}</small></span><button onClick={()=>{setGraphScope(v=>v==='path'?'all':'path');setSelection(null);}}>{currentPath?'展开全部关联':'聚焦最相关路径'}<ArrowRight size={13}/></button></div>}
      {r.loading?<div className="xg-stage-loading"><Loading text="正在读取当前知识网络…"/></div>:!nodes.length?<EmptyState title={query||entityId||type?'当前范围未找到可用关系':construction?.documentCount?'知识体系正在积累':'从第一份文档开始'} description={construction?.documentCount?'上方可查看每份资料的解析与提取进度。只有核验通过、来源有效的关系用于检索与回答。':'接入文档后，先解析内容，再提取对象与明确关系；这里会随资料逐步形成分类。'} action={construction?.documentCount?(manageable&&(r.data?.stats.candidate?<button className="e-btn" onClick={()=>update({status:'candidate'})}>查看待核验关系</button>:<button className="e-btn" onClick={()=>setExtractOpen(true)}>从已有资料提取</button>)):(user.role!=='viewer'&&<Link className="e-btn primary" to="/production/upload">接入文档</Link>)}/>:
        <div className={`e-graph-workspace xg-network-area ${hasSelection?'has-selection':''}`}>
          <div className="e-graph-main-view">
            {view==='graph'?<GraphScene nodes={plottedNodes} edges={plottedEdges} pathNodeIds={currentPath?.nodeIds} focusId={entityId||leadingPath?.nodeIds[0]||(type?nodes.find(node=>node.type===type)?.id:'')||''} selection={selection} onNode={node=>setSelection({kind:'node',id:node.id})} onEdge={edge=>setSelection({kind:'edge',id:edge.id})} onExpand={focus} presentation={presentation} onType={focusType}/>:
              <div className="e-graph-relations-list" aria-label="知识关系列表">{edges.map(edge=><article key={edge.id} className={selection?.id===edge.id?'selected':''}><div className="e-graph-list-heading">{manageable&&edge.canManage&&!edge.stale&&edge.status==='candidate'&&<input type="checkbox" aria-label={`选择关系 ${edge.subjectName} ${edge.label||edge.predicate} ${edge.objectName}`} checked={checked.includes(edge.id)} disabled={!checked.includes(edge.id)&&checked.length>=maxBatch} onChange={()=>toggle(edge)}/>}<button className="e-graph-relation-button" onClick={()=>setSelection({kind:'edge',id:edge.id})}><strong>{edge.subjectName||nodes.find(n=>n.id===edge.subjectId)?.name}</strong><span>{edge.label||graphRelationLabels[edge.predicate]||edge.predicate}<ArrowRight size={13}/></span><strong>{edge.objectName||nodes.find(n=>n.id===edge.objectId)?.name}</strong></button><span className={`e-badge ${edge.status==='confirmed'&&!edge.stale?'published':'review'}`}>{edge.stale?'来源已变化':statusLabels[edge.status]||edge.status}</span></div><div className="e-graph-list-foot"><span>{edge.sourceTitle||'资料关系'}{edge.documentVersion?` · V${edge.documentVersion}`:''}{edge.rowNumber!=null?` · 来源行 ${edge.rowNumber}`:''}</span><button className="e-text-link" onClick={()=>setSelection({kind:'edge',id:edge.id})}>查看依据<ExternalLink size={12}/></button></div></article>)}</div>}
          </div>
          {hasSelection&&<aside className="e-graph-inspector" aria-label="对象与关系详情"><div className="xg-inspector-cap"><span><ShieldCheck size={14}/>对象与证据</span><button className="e-icon-btn" aria-label="关闭对象详情" onClick={()=>setSelection(null)}><X size={16}/></button></div>
            {selectedNode?<><div className="e-graph-inspector-heading"><span className="e-badge" style={{color:graphTypeColor(selectedNode.type)}}>{graphTypeLabels[selectedNode.type]||selectedNode.type}</span><h3>{selectedNode.name}</h3>{selectedNode.externalId&&<p className="e-muted">编号：{selectedNode.externalId}</p>}{selectedNode.scopeLabel&&<p className="e-muted">识别范围：{selectedNode.scopeLabel}</p>}</div><button className="e-btn primary" onClick={()=>focus(selectedNode)}><Expand size={15}/>以此对象展开 {hops} 跳</button><Link className="e-text-link" to={`/application/chat?${new URLSearchParams({q:`请查找 ${selectedNode.externalId||selectedNode.name} 的关联资料并说明依据。`,...(baseId?{baseId}:{})})}`}><Search size={14}/>就此对象提问</Link><h4>当前网络中的关联</h4><div className="e-graph-neighbors">{edges.filter(edge=>edge.subjectId===selectedNode.id||edge.objectId===selectedNode.id).slice(0,30).map(edge=>{const otherId=edge.subjectId===selectedNode.id?edge.objectId:edge.subjectId;return <button key={edge.id} onClick={()=>setSelection({kind:'edge',id:edge.id})}><span>{edge.label||graphRelationLabels[edge.predicate]||edge.predicate}</span><strong>{nodes.find(n=>n.id===otherId)?.name||'关联对象'}</strong><ChevronRight size={13}/></button>;})}</div>{selectedNode.evidenceRefs?.length?<><h4>对象来源</h4><EvidenceLinks refs={selectedNode.evidenceRefs}/></>:null}</>:
            selectedEdge?<><div className="e-graph-inspector-heading"><span className={`e-badge ${selectedEdge.status==='confirmed'&&!selectedEdge.stale?'published':'review'}`}>{selectedEdge.stale?'来源已变化':statusLabels[selectedEdge.status]||selectedEdge.status}</span><h3>{selectedEdge.label||graphRelationLabels[selectedEdge.predicate]||selectedEdge.predicate}</h3><p>{selectedEdge.subjectName||nodes.find(n=>n.id===selectedEdge.subjectId)?.name}<ArrowRight size={14}/>{selectedEdge.objectName||nodes.find(n=>n.id===selectedEdge.objectId)?.name}</p></div><h4>关系依据</h4><EvidenceLinks refs={edgeEvidence(selectedEdge)}/><div className="e-actions e-wrap">{[selectedEdge.subjectId,selectedEdge.objectId].map(id=>{const node=nodes.find(n=>n.id===id);return node?<button key={id} className="e-btn" onClick={()=>focus(node)}>展开{graphTypeLabels[node.type]||'对象'}</button>:null;})}</div>{manageable&&selectedEdge.canManage&&!selectedEdge.stale&&selectedEdge.status==='candidate'&&<div className="e-graph-review-actions"><button className="e-btn primary" onClick={()=>setReview({edges:[selectedEdge],action:'confirm'})}><Check size={14}/>确认关系</button><button className="e-btn" onClick={()=>setReview({edges:[selectedEdge],action:'reject'})}>驳回候选</button></div>}</>:null}
          </aside>}
        </div>}
      <div className="xg-stage-footer"><span><ShieldCheck size={13}/>{status==='confirmed'?'已核验关系 · 原文可追溯':'关系治理 · 候选不进入回答'}</span><span>单击查看依据 · 双击展开 · Ctrl + 滚轮缩放</span>{hasSynthetic&&<span className="xg-synthetic-label">含合成示例</span>}</div>
      {manageable&&eligible.length>0&&<div className="e-graph-batch"><div><strong>候选关系复核</strong><p>对照原文后办理；每批最多 {maxBatch} 条。</p></div><div className="e-actions e-wrap"><button className="e-btn" onClick={()=>{setView('list');setChecked(eligible.slice(0,maxBatch).map(e=>e.id));}}>选择当前前 {Math.min(maxBatch,eligible.length)} 条</button><span>已选 {selectedEdges.length} 条</span><button className="e-btn" disabled={!selectedEdges.length} onClick={()=>setChecked([])}>清空</button><button className="e-btn primary" disabled={!selectedEdges.length} onClick={()=>setReview({edges:selectedEdges,action:'confirm'})}>确认所选</button><button className="e-btn" disabled={!selectedEdges.length} onClick={()=>setReview({edges:selectedEdges,action:'reject'})}>驳回所选</button></div></div>}
    </section>
    {hasSynthetic&&<p className="xg-data-note"><CircleAlert size={13}/>当前范围包含合成示例。关系用于展示知识关联，不代表真实运营记录；分类展示不改变原文关系方向或制度适用范围。</p>}
    {status==='confirmed'&&r.data&&<GraphPaths paths={r.data.paths}/>}
    {extractOpen&&<Modal title="提取有出处的关系候选" onClose={()=>setExtractOpen(false)} busy={busy}><div className="e-stack"><p>处理范围：<strong>{baseName}</strong>{type?<> · 当前分类 <strong>{graphTypeLabels[type]||type}</strong></>:null}。</p><p className="e-muted">依据表格中的明确对象字段提取候选，保留来源行。提取后请在「知识体系」中切换分类，对照原文确认或驳回；未确认关系不进入检索与问答。</p>{error&&<Notice kind="error">{error}</Notice>}<div className="e-modal-actions"><button className="e-btn" disabled={busy} onClick={()=>setExtractOpen(false)}>取消</button><button className="e-btn primary" disabled={busy} onClick={()=>void extract()}>{busy?'正在提取…':'开始提取'}</button></div></div></Modal>}
    {review&&<GraphReview item={review} onClose={()=>setReview(null)} onSaved={count=>{setReview(null);setChecked([]);setNotice(`已保存 ${count} 条关系复核记录。`);r.reload();}}/>}
  </div>;
}

function EvidenceLinks({refs}:{refs:GraphEvidence[]}) {
  return <div className="e-graph-evidence-links">{refs.slice(0,20).map((ref,index)=><article key={`${ref.documentId}-${ref.blockId}-${index}`}>
    <Link to={graphEvidenceUrl(ref)}><FileText size={15}/><strong>{ref.title||'原文资料'}</strong><ExternalLink size={13}/></Link>
    <p className="e-muted">{[ref.documentVersion&&`V${ref.documentVersion}`,ref.rowNumber!=null&&`来源行 ${ref.rowNumber}`,ref.locator?.page&&`第 ${ref.locator.page} 页 / 节`,ref.locator?.sheet,ref.locator?.cellRange].filter(Boolean).join(' · ')||'原文证据片段'}</p>
    {ref.sourceKind==='synthetic'&&<span className="e-badge">合成示例资料</span>}
    {ref.text&&<p className="e-graph-evidence-text">{ref.text}</p>}
  </article>)}</div>;
}


function GraphReview({item,onClose,onSaved}:{item:{edges:GraphEdge[];action:'confirm'|'reject'};onClose:()=>void;onSaved:(count:number)=>void}) {
  const [reason,setReason]=useState('');const [checked,setChecked]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent) {event.preventDefault();if(reason.trim().length<3||!checked)return;setBusy(true);setError('');try {
    const result=await api<{reviewedCount:number}>('/graph/relations/review',{method:'POST',body:JSON.stringify({ids:item.edges.map(edge=>({id:edge.id,revision:edge.revision})),action:item.action,reason:reason.trim()})});onSaved(result.reviewedCount);
  }catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <Modal title={`${item.action==='confirm'?'确认':'驳回'} ${item.edges.length} 条关系`} wide onClose={onClose} busy={busy}><form className="e-stack" onSubmit={submit}>
    <p className="e-muted">本次办理仅作用于下列关系。来源变化或修订号不一致时，整批停止保存，请刷新后重新核验。</p>
    <div className="e-graph-review-list">{item.edges.map(edge=><details key={edge.id}><summary>{edge.subjectName} · {edge.label||graphRelationLabels[edge.predicate]||edge.predicate} · {edge.objectName}</summary><EvidenceLinks refs={edgeEvidence(edge)}/></details>)}</div>
    {error&&<Notice kind="error">{error}</Notice>}
    <label className="e-field">办理依据<textarea rows={4} required minLength={3} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="说明已核对的来源、适用范围、编号与关系含义，以及确认或驳回的具体原因。"/></label>
    <label className="e-graph-attestation"><input type="checkbox" required checked={checked} onChange={e=>setChecked(e.target.checked)}/>我已对照原文核验所选关系，且上述办理依据适用于本批次。</label>
    <div className="e-modal-actions"><button className="e-btn" type="button" disabled={busy} onClick={onClose}>取消</button><button className="e-btn primary" disabled={busy||!checked||reason.trim().length<3}>{busy?'正在保存…':'保存复核记录'}</button></div>
  </form></Modal>;
}

