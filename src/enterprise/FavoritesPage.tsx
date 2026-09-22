import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, FileText, Trash2 } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Notice, PageHeader, StatusBadge } from './components';
import type { KnowledgeDocument } from './types';

type Favorite = {id:string;documentId:string;title:string;fileName:string;version:number;createdAt:string;status:string;document:KnowledgeDocument};
export function FavoriteButton({documentId}:{documentId:string}){
  const r=useResource<{favorites:Favorite[]}>('/favorites');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const favorite=r.data?.favorites.some(row=>row.documentId===documentId);
  async function toggle(){setBusy(true);setError('');try{await api(favorite?`/favorites/${documentId}`:'/favorites',{method:favorite?'DELETE':'POST',...(favorite?{}:{body:JSON.stringify({documentId})})});r.reload();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  return <div><button className="e-btn" onClick={toggle} disabled={busy||r.loading||Boolean(r.error)} title={r.error||undefined}><Bookmark size={16} fill={favorite?'currentColor':'none'}/>{favorite?'已收藏':'收藏文档'}</button>{error&&<p role="alert" className="e-danger-text" style={{fontSize:11,maxWidth:220,marginTop:5}}>{error}</p>}</div>;
}
export function FavoritesPage(){const r=useResource<{favorites:Favorite[]}>('/favorites');const [busy,setBusy]=useState('');const [error,setError]=useState('');async function remove(documentId:string){setBusy(documentId);setError('');try{await api(`/favorites/${documentId}`,{method:'DELETE'});r.reload();}catch(e){setError(errorMessage(e));}finally{setBusy('');}}
  return <div className="e-page"><PageHeader title="我的收藏" description="集中查阅常用资料。收藏保留所选版本，文档状态与访问权限实时校验。" actions={<button className="e-btn" onClick={r.reload}>刷新</button>}/>{(error||r.error)&&<Notice kind="error">{error||r.error}</Notice>}{r.loading?<Loading/>:r.data?.favorites.length?<div className="e-card"><div className="e-document-list">{r.data.favorites.map(row=><div className="e-document-line" key={row.id}><span className="e-file-icon"><FileText size={20}/></span><div><Link className="e-text-link" to={`/documents/${row.documentId}`}><strong>{row.title}</strong></Link><p>V{row.version} · 收藏于 {formatDate(row.createdAt)}</p></div><StatusBadge status={row.status}/><button className="e-icon-btn" title="取消收藏" aria-label={`取消收藏${row.title}`} disabled={busy===row.documentId} onClick={()=>remove(row.documentId)}><Trash2 size={16}/></button></div>)}</div></div>:<div className="e-card"><EmptyState title="还没有收藏的知识" description="在文档详情中点击“收藏文档”，下次可从这里快速查阅。" action={<Link className="e-btn primary" to="/application/search">搜索企业知识</Link>}/></div>}</div>;
}
