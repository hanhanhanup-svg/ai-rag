import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ExternalLink, Network } from 'lucide-react';
import { edgeEvidence, graphEvidenceUrl, graphRelationLabels, type GraphPath } from './GraphTypes';
import './graph.css';

export function GraphPaths({ paths, compact = false }: { paths?: GraphPath[]; compact?: boolean }) {
  const [visible,setVisible] = useState(5);
  if (!paths?.length) return null;
  return <section className={`e-graph-paths ${compact ? 'compact' : ''}`} aria-label="图谱关联路径">
    <div className="e-section-heading"><h3><Network size={16}/>图谱关联路径</h3><span className="e-muted">{paths.length} 条有出处的关联</span></div>
    <p className="e-muted">路径说明资料之间的关联，不能单独推断因果或处理结论。</p>
    {paths.slice(0, compact ? 2 : visible).map(path => <details key={path.id} className="e-graph-path">
      <summary><span className="e-graph-path-chain">{path.nodes.map((node,index) => <span key={`${node.id}-${index}`}>
        {index > 0 && (path.edges[index-1]?.subjectId===node.id ? <ArrowLeft size={13} aria-label="反向查找已有关系"/> : <ArrowRight size={13} aria-label="沿关系方向查找"/>)}<span title={node.scopeLabel}>{node.name}{node.externalId&&node.externalId!==node.name?` (${node.externalId})`:''}</span>
      </span>)}</span><span className="e-muted">{path.edges.length} 段关系 · 查看依据</span></summary>
      <div className="e-stack">{path.edges.map(edge => <div key={edge.id} className="e-graph-path-evidence">
        <strong>{edge.subjectName || path.nodes.find(n => n.id === edge.subjectId)?.name || '对象'} <span>{edge.label || graphRelationLabels[edge.predicate] || edge.predicate}</span> {edge.objectName || path.nodes.find(n => n.id === edge.objectId)?.name || '关联对象'}</strong>
        {edgeEvidence(edge).map((ref,index) => <Link className="e-text-link" key={`${ref.blockId}-${index}`} to={graphEvidenceUrl(ref)}>
          {ref.title || '查看原文依据'}{ref.documentVersion ? ` · V${ref.documentVersion}` : ''}{ref.rowNumber != null ? ` · 来源行 ${ref.rowNumber}` : ''}<ExternalLink size={12}/>
        </Link>)}
      </div>)}<Link className="e-text-link" to={`/assets/graph?${new URLSearchParams({entityId:path.nodeIds[0] || path.nodes[0]?.id || '',hops:String(Math.min(3,Math.max(1,path.edges.length)))})}`}><Network size={14}/>在知识图谱中展开</Link></div>
    </details>)}
    {paths.length > (compact ? 2 : visible) && (compact ? <p className="e-muted">此处展示前 2 条路径，可进入知识图谱继续探索。</p> : <button className="e-text-link" onClick={()=>setVisible(value=>value+5)}>查看更多关联路径（剩余 {paths.length-visible} 条）<ArrowRight size={13}/></button>)}
  </section>;
}
