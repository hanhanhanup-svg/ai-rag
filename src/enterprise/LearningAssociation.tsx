import { BrainCircuit } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useResource } from './api';

export function LearningAssociation() {
  const resource=useResource<{enabled:boolean;base:{id:string;name:string}|null}>('/learning/default');
  if(!resource.data?.enabled)return null;
  const content=<><BrainCircuit size={14}/><span>机器学习</span><small>默认关联</small></>;
  const title='文档问答会按相关性参考已纳入的反馈结论，事实依据仍来自当前原文。';
  return resource.data.base?<Link className="e-document-learning-link" title={title} to={'/assets/knowledge-bases/'+encodeURIComponent(resource.data.base.id)+'?tab=documents'}>{content}</Link>:<span className="e-document-learning-link" title={title}>{content}</span>;
}
