import { useState } from 'react';
import { Plus, Settings2, X } from 'lucide-react';
import { api, errorMessage } from './api';
import { Notice } from './components';
import { SelectControl } from './SelectControl';
import { sourceKindNames } from './KnowledgeGovernance';
import type { SourceKind } from './types';

export interface SourceCategory { id: string; name: string; sourceKind: SourceKind; enabled: boolean; builtin: boolean }
export interface SourceCategoriesData { categories: SourceCategory[]; revision: number; canManage: boolean; updatedAt?: string }
type EditableCategory = Omit<SourceCategory, 'id'> & { id?: string; localId: string };
export function SourceCategorySettings({data,onSaved,onClose,onBusyChange}:{data:SourceCategoriesData;onSaved:(data:SourceCategoriesData)=>void;onClose:()=>void;onBusyChange:(busy:boolean)=>void}) {
  const [rows,setRows]=useState<EditableCategory[]>(()=>data.categories.map(row=>({...row,localId:row.id})));
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const edit=(localId:string,patch:Partial<EditableCategory>)=>setRows(old=>old.map(row=>row.localId===localId?{...row,...patch}:row));
  async function save(){
    setError('');setBusy(true);onBusyChange(true);
    try{const result=await api<SourceCategoriesData>('/source-categories',{method:'PUT',body:JSON.stringify({revision:data.revision,categories:rows.map(({localId,...row})=>row)})});onSaved(result);}
    catch(error){setError(errorMessage(error));}finally{setBusy(false);onBusyChange(false);}
  }
  return <section className="up-category-settings" aria-labelledby="up-category-settings-title">
    <div className="up-section-heading"><h3 id="up-category-settings-title"><Settings2 size={16}/>资料来源类别设置</h3><button className="e-icon-btn" type="button" aria-label="关闭来源类别设置" onClick={onClose} disabled={busy}><X size={16}/></button></div>
    <p className="e-muted">按业务需要调整名称、增加或停用类别。来源性质用于保留公开、受控和示例资料的区别；已保存资料保留原有类别记录。</p>
    {!data.canManage&&<Notice>当前账号可查看类别；修改需要管理员权限。</Notice>}
    {error&&<Notice kind="error">{error}</Notice>}
    <div className="up-category-rows">{rows.map((row,index)=><div className="up-category-row" key={row.localId}>
      <label className="e-field">类别名称<input aria-label={`类别名称 ${index+1}`} maxLength={60} disabled={busy||!data.canManage} value={row.name} onChange={e=>edit(row.localId,{name:e.target.value})}/></label>
      <label className="e-field">来源性质<SelectControl aria-label={`来源性质 ${index+1}`} value={row.sourceKind} disabled={busy||!data.canManage||Boolean(row.id)} onChange={e=>edit(row.localId,{sourceKind:e.target.value as SourceKind})}>{Object.entries(sourceKindNames).map(([value,label])=><option value={value} key={value}>{label}</option>)}</SelectControl></label>
      <label className="up-category-toggle"><input type="checkbox" checked={row.enabled} disabled={busy||!data.canManage} onChange={e=>edit(row.localId,{enabled:e.target.checked})}/>{row.enabled?'启用':'已停用'}</label>
      {!row.id&&<button className="e-icon-btn" type="button" aria-label={`移除新增类别 ${index+1}`} disabled={busy} onClick={()=>setRows(old=>old.filter(item=>item.localId!==row.localId))}><X size={15}/></button>}
    </div>)}</div>
    <div className="up-category-actions">{data.canManage&&<button className="e-btn small" type="button" disabled={busy||rows.length>=100} onClick={()=>setRows(old=>[...old,{localId:crypto.randomUUID(),name:'',sourceKind:'reference',enabled:true,builtin:false}])}><Plus size={15}/>新增类别</button>}<div className="e-actions"><button type="button" className="e-btn small" disabled={busy} onClick={onClose}>取消</button>{data.canManage&&<button type="button" className="e-btn primary small" disabled={busy||rows.some(row=>!row.name.trim())} onClick={()=>void save()}>{busy?'正在保存…':'保存类别'}</button>}</div></div>
  </section>;
}
