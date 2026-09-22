import { graphRelationLabels } from './GraphTypes';
import { EvidenceSourcePreview } from './EvidenceSourcePreview';
import { MediaPreview } from './MediaPreview';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ExternalLink, Network, RefreshCw } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { DataValue } from './IntelligencePages';
import { EmptyState, Loading, Modal, Notice } from './components';
import type { ChunkTable, KnowledgeDocument } from './types';

export interface EvidenceLocator { page?:number; bbox?:number[]; sheet?:string; cellRange?:string; rowNumbers?:number[]; startMs?:number; endMs?:number; webSnapshotId?:string; externalRecordId?:string; kind?:string; pageKind?:string; coordinateSystem?:string;pageWidth?:number;pageHeight?:number;unit?:string;precision?:string;sampleMs?:number }
interface EvidenceBlock { id:string; documentId:string; documentVersion:number; blockRevision:number; type:string; text:string; structuredData?:ChunkTable; locator:EvidenceLocator; quality?:unknown; reviewState:string; contentHash:string; canManage?:boolean }
interface EvidenceData {document:KnowledgeDocument;blocks:EvidenceBlock[];capabilities?:unknown;historyAvailable?:boolean}
const reviewLabels:Record<string,string>={unreviewed:'待核验',pending:'待核验',candidate:'候选',confirmed:'已核验',rejected:'已驳回',reviewed:'已核验'};
export function locatorText(locator:EvidenceLocator={}) { const rows=[];if(locator.page)rows.push(`第 ${locator.page} 页 / 节`);if(locator.sheet)rows.push(`工作表 ${locator.sheet}`);if(locator.cellRange)rows.push(`单元格 ${locator.cellRange}`);if(locator.rowNumbers?.length)rows.push(`来源记录 ${locator.rowNumbers[0]}–${locator.rowNumbers[locator.rowNumbers.length-1]}`);if(locator.startMs!==undefined)rows.push(`${(locator.startMs/1000).toFixed(1)}–${((locator.endMs??locator.startMs)/1000).toFixed(1)} 秒`);if(locator.precision==='approximate')rows.push('抽样时间附近，不代表连续视觉覆盖');if(locator.externalRecordId)rows.push(`源记录 ${locator.externalRecordId}`);if(locator.bbox?.length)rows.push(`原页区域 ${locator.bbox.join(', ')}`);return rows.join(' · ')||'原文段落'; }
export function EvidenceReview({document,onChanged}:{document:KnowledgeDocument;onChanged:()=>void}) {
  const [graphParams] = useSearchParams();
  const targetBlock = graphParams.get('block');
  const targetRow = Number(graphParams.get('row'));
  const maxBatch = 50;

  const r=useResource<EvidenceData>(`/documents/${document.id}/evidence`);
  const [selected,setSelected]=useState<{block:EvidenceBlock;mode:'confirm'|'edit'}|null>(null);
  const [tab,setTab]=useState('all');
  const [notice,setNotice]=useState('');
  const [mediaTime,setMediaTime]=useState(0);
  const [selectedCell,setSelectedCell]=useState<{block:EvidenceBlock;bbox:number[];row:number;column:number}|null>(null);
  const [checked,setChecked]=useState<string[]>([]);
  const [batchOpen,setBatchOpen]=useState(false);
  const navigate=useNavigate();
  useEffect(()=>{if(!r.data||!targetBlock)return;const frame=requestAnimationFrame(()=>{window.document.getElementById('evidence-'+targetBlock)?.scrollIntoView({block:'start'});});return()=>cancelAnimationFrame(frame);},[r.data,targetBlock]);
  useEffect(()=>setChecked([]),[tab,document.id,r.data?.document.revision]);
  const canManage=Boolean(r.data?.document.canManage??document.canManage);
  const blocks=(r.data?.blocks||[]).filter(row=>tab==='all'||tab==='pending'?tab==='all'||row.reviewState!=='confirmed':row.type===tab);
  const pending=blocks.filter(block=>block.reviewState!=='confirmed'&&block.canManage!==false);
  const selectedBlocks=pending.filter(block=>checked.includes(block.id));
  function toggle(block:EvidenceBlock){setChecked(current=>current.includes(block.id)?current.filter(id=>id!==block.id):current.length<maxBatch?[...current,block.id]:current);}
  function handleSaved(result:EvidenceData&{createdVersion:boolean;reviewedCount?:number}){
    setSelected(null);setBatchOpen(false);setChecked([]);
    if(result.createdVersion&&result.document.id!==document.id)navigate(`/documents/${result.document.id}`,{state:{notice:`已批量核验 ${result.reviewedCount||1} 条证据并生成待审核新版本，原件与此前发布版本保留。`}});
    else{r.reload();onChanged();setNotice(`已记录 ${result.reviewedCount||1} 条证据核验，相关索引与派生结果将按当前修订更新。`);}
  }

  return <div className="e-stack">
    <section className="e-card">
      <div className="e-section-heading">
        <div><h2>证据对照与抽取复核</h2><p className="e-muted">每个结果保留来源位置和修订记录。已发布资料的核验与校对生成待审核新版本。</p></div>
        <div className="e-actions e-wrap">
          {canManage&&pending.length>0&&<>
            <button type="button" className="e-btn" onClick={()=>setChecked(pending.slice(0,maxBatch).map(block=>block.id))}>全选待核验{pending.length>maxBatch?`前 ${maxBatch}`:''}</button>
            {checked.length>0&&<button type="button" className="e-btn" onClick={()=>setChecked([])}>清空选择</button>}
            <button type="button" className="e-btn primary" disabled={!selectedBlocks.length} onClick={()=>setBatchOpen(true)}><CheckCircle2 size={15}/>批量记录已核验{selectedBlocks.length?` · ${selectedBlocks.length}`:''}</button>
          </>}
          <button className="e-btn" onClick={r.reload}><RefreshCw size={15}/>刷新</button>
        </div>
      </div>
      <div className="e-filter-tabs">{[['all','全部证据'],['pending','待核验'],['table','表格'],['chart','图表'],['transcript','音视频转写'],['frame_text','抽样画面文字']].map(([value,label])=><button key={value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{label}</button>)}</div>
      {canManage&&pending.length>0&&<p className="e-muted e-evidence-batch-hint">勾选待核验证据后，一次填写办理依据即可批量确认；正文校对仍请逐条处理。每批最多 {maxBatch} 条。</p>}
    </section>
    {r.data?.historyAvailable&&<EvidenceRevisionHistory key={document.id+":"+r.data.document.revision} documentId={document.id}/>}
    {(document.mimeType?.startsWith("audio/")||document.mimeType?.startsWith("video/"))&&<section className="e-card"><MediaPreview document={document} timeMs={mediaTime}/></section>}
    {r.error&&<Notice kind="error">{r.error}</Notice>}
    {notice&&<Notice kind="success">{notice}</Notice>}
    {r.loading&&!r.data?<Loading/>:blocks.length?blocks.map(block=><article id={`evidence-${block.id}`} className={`e-card e-evidence-card ${targetBlock===block.id?'e-graph-evidence-target':''} ${checked.includes(block.id)?'is-selected':''}`} key={block.id}>
      {targetBlock===block.id&&<div className="e-graph-evidence-location">已定位图谱关系的来源证据{targetRow?` · 来源行 ${targetRow}`:''}，请结合下方完整记录核验。{block.structuredData&&targetRow>0&&<GraphSourceRecord table={block.structuredData} rowNumber={targetRow}/>}</div>}
      <div className="e-section-heading">
        <div className="e-evidence-card-title">
          {canManage&&block.canManage!==false&&block.reviewState!=='confirmed'&&<label className="e-evidence-check"><input type="checkbox" aria-label={`选择${({paragraph:'文字段落',table:'结构化表格',chart:'图表说明',transcript:'转写片段',frame_text:'抽样画面文字'} as Record<string,string>)[block.type]||'证据片段'}`} checked={checked.includes(block.id)} disabled={!checked.includes(block.id)&&checked.length>=maxBatch} onChange={()=>toggle(block)}/></label>}
          <h3>{({paragraph:'文字段落',table:'结构化表格',chart:'图表说明',transcript:'转写片段',frame_text:'抽样画面文字'} as Record<string,string>)[block.type]||'证据片段'}</h3>
        </div>
        <div className="e-actions"><span className={`e-badge ${block.reviewState==='confirmed'?'published':'review'}`}>{reviewLabels[block.reviewState]||block.reviewState||'待核验'}</span><span className="e-version">V{block.documentVersion} · 证据修订 {block.blockRevision}</span></div>
      </div>
      <p className="e-muted">{locatorText(block.locator)}</p>
      {block.locator.startMs!==undefined&&<button className="e-text-link" onClick={()=>setMediaTime(block.locator.startMs!)}>定位到对应时间片段</button>}
      <Link className="e-text-link" to={`/documents/${document.id}?chunk=${encodeURIComponent(block.id)}${block.locator.page?`&page=${block.locator.page}`:''}`}>回到原文核验<ExternalLink size={14}/></Link>
      {block.structuredData?.headers&&block.structuredData?.rows?<div className="e-table-scroll" tabIndex={0} aria-label="结构化证据表格，可横向滚动"><table><thead><tr><th>来源记录</th>{block.structuredData.headers.map((header,index)=><th key={index}>{header}</th>)}</tr></thead><tbody>{block.structuredData.rows.map((row,index)=><tr key={index} className={targetBlock===block.id&&targetRow===(block.structuredData?.rowNumbers?.[index])?'e-graph-row-target':''}><th>{block.structuredData?.rowNumbers?.[index]??'未提供'}</th>{row.map((value,column)=><td key={column}>{block.structuredData?.cellBounds?.find(cell=>cell.row===block.structuredData?.rowNumbers[index]&&cell.column===column+1)?<button className="e-evidence-cell" onClick={()=>{const cell=block.structuredData!.cellBounds!.find(cell=>cell.row===block.structuredData!.rowNumbers[index]&&cell.column===column+1)!;setSelectedCell({block,bbox:cell.bbox,row:cell.row,column:cell.column});}} aria-label={'核验来源记录 '+block.structuredData.rowNumbers[index]+' 第 '+(column+1)+' 列'}>{value||'空值'}<ExternalLink size={12}/></button>:value}</td>)}</tr>)}</tbody></table><p className="e-table-footnote">本片段 {block.structuredData.rows.length} 条 / 全表 {block.structuredData.totalRows} 条；完整覆盖请以文档表格视图汇总核验。</p></div>:<><p className="e-evidence-text">{block.text}</p>{block.structuredData&&<details className="e-detail-json"><summary>结构化提取结果</summary><DataValue value={block.structuredData}/></details>}</>}
      {block.quality!=null&&<details className="e-detail-json"><summary>抽取质量与检查方法</summary><pre>{JSON.stringify(block.quality,null,2)}</pre></details>}
      {canManage&&block.canManage!==false&&<div className="e-actions e-wrap"><button className="e-btn" onClick={()=>setSelected({block,mode:'edit'})}>校对证据</button><button className="e-btn" disabled={block.reviewState==='confirmed'} onClick={()=>setSelected({block,mode:'confirm'})}><CheckCircle2 size={15}/>记录已核验</button></div>}
    </article>):<section className="e-card"><EmptyState title="当前分类暂无可复核证据" description="解析能力、格式和服务配置会影响可提取结果；没有结构化结果时不会模拟识别成功。"/></section>}
    {selected&&<EvidenceEditor document={{...document,...r.data?.document}} block={selected.block} mode={selected.mode} onClose={()=>setSelected(null)} onSaved={result=>{setSelected(null);if(result.createdVersion&&result.document.id!==document.id)navigate(`/documents/${result.document.id}`,{state:{notice:'已保存为待审核新版本，原件与此前发布版本保留。'}});else{r.reload();onChanged();setNotice('证据复核已保存，相关索引与派生结果将按当前修订更新。');}}}/>}
    {batchOpen&&<BatchEvidenceConfirm document={{...document,...r.data?.document}} blocks={selectedBlocks} onClose={()=>setBatchOpen(false)} onSaved={handleSaved}/>}
    {selectedCell&&<Modal title={'单元格原件对照 · 来源记录 '+selectedCell.row+' / 第 '+selectedCell.column+' 列'} wide onClose={()=>setSelectedCell(null)}><EvidenceSourcePreview document={document} locator={{...selectedCell.block.locator,bbox:selectedCell.bbox}}/></Modal>}
    <RelationsPanel document={document}/>
  </div>;
}

function BatchEvidenceConfirm({document,blocks,onClose,onSaved}:{document:KnowledgeDocument;blocks:EvidenceBlock[];onClose:()=>void;onSaved:(data:EvidenceData&{createdVersion:boolean;reviewedCount?:number})=>void}){
  const [reason,setReason]=useState('');const [checked,setChecked]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function submit(event:FormEvent){
    event.preventDefault();if(reason.trim().length<3||!checked||!blocks.length)return;
    setBusy(true);setError('');
    try{
      const result=await api<EvidenceData&{createdVersion:boolean;reviewedCount:number}>(`/documents/${document.id}/evidence/batch-review`,{method:'POST',body:JSON.stringify({revision:document.revision,reason:reason.trim(),items:blocks.map(block=>({id:block.id,blockRevision:block.blockRevision}))})});
      onSaved(result);
    }catch(e){setError(errorMessage(e));}finally{setBusy(false);}
  }
  return <Modal title={`批量记录已核验 · ${blocks.length} 条`} wide onClose={onClose} busy={busy}>
    <form className="e-stack" onSubmit={submit}>
      <Notice>{document.status==='published'?'当前为已发布资料，批量核验将创建一份待审核新版本，不覆盖当前正式知识。':'批量核验会更新当前待审核稿的证据修订。'}请确认已对照来源位置核实所选片段。</Notice>
      <div className="e-evidence-batch-list">{blocks.map(block=><article key={block.id}><strong>{({paragraph:'文字段落',table:'结构化表格',chart:'图表说明',transcript:'转写片段',frame_text:'抽样画面文字'} as Record<string,string>)[block.type]||'证据片段'}</strong><span>{locatorText(block.locator)}</span><p>{block.text.slice(0,120)}{block.text.length>120?'…':''}</p></article>)}</div>
      {error&&<Notice kind="error">{error}</Notice>}
      <label className="e-field">统一办理依据<textarea required minLength={3} maxLength={2000} rows={4} value={reason} onChange={e=>setReason(e.target.value)} placeholder="说明已对照的原文位置、核实结果，以及对本批证据一并确认的原因。"/></label>
      <label className="e-graph-attestation"><input type="checkbox" required checked={checked} onChange={e=>setChecked(e.target.checked)}/>我已对照原文核验所选证据，且上述办理依据适用于本批次。</label>
      <div className="e-modal-actions"><button type="button" className="e-btn" disabled={busy} onClick={onClose}>取消</button><button className="e-btn primary" disabled={busy||!checked||reason.trim().length<3}>{busy?'正在保存…':document.status==='published'?'保存为待审核新版本':'保存批量核验'}</button></div>
    </form>
  </Modal>;
}

interface EvidenceSnapshot {
  text?: string; structuredData?: unknown; table?: unknown; locator?: EvidenceLocator;
  quality?: unknown; evidenceType?: string; reviewState?: string; blockRevision?: number; heading?: string;
}
interface EvidenceRevision {
  id: string; documentId: string; documentVersion: number; chunkId: string; blockRevision: number;
  sourceDocumentId: string; sourceDocumentVersion: number; sourceChunkId: string; sourceBlockRevision: number;
  createdAt: string; actorId?: string; actorName?: string; reason: string; cause: string;
  before: EvidenceSnapshot; after: EvidenceSnapshot;
}
interface EvidenceHistoryData {
  document: {id: string; title: string; version: number};
  history: {incomplete: boolean; truncated?: boolean; notice: string|null; records: EvidenceRevision[]};
}
const evidenceTypeLabels: Record<string,string> = {paragraph:'文字段落',table:'结构化表格',chart:'图表说明',transcript:'转写片段',frame_text:'抽样画面文字'};
const snapshotFieldLabels: Record<string,string> = {text:'正文',structuredData:'结构化字段',table:'表格字段',locator:'来源位置',quality:'抽取质量',evidenceType:'证据类型',reviewState:'核验状态',heading:'段落标题'};
function sameSnapshotValue(a: unknown, b: unknown) { return JSON.stringify(a ?? null)===JSON.stringify(b ?? null); }
function EvidenceRevisionHistory({documentId}:{documentId:string}) {
  const [open,setOpen]=useState(false);
  const r=useResource<EvidenceHistoryData>(open ? '/documents/'+documentId+'/evidence/history' : null);
  return <details className="e-card e-detail-json" onToggle={e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}}>
    <summary>修订记录</summary>
    {open&&<div className="e-stack" style={{marginTop:16}}>
      <div className="e-section-heading"><p className="e-muted">仅展示有权查看的真实快照；核验确认与正文修改均保留办理依据。</p><button className="e-btn small" type="button" disabled={r.loading} onClick={r.reload}><RefreshCw size={14}/>刷新记录</button></div>
      {r.error&&<Notice kind="error">{r.error}</Notice>}
      {r.loading&&!r.data?<Loading/>:r.data&&<>
        {(r.data.history.incomplete||r.data.history.notice)&&<Notice kind="warning">{r.data.history.notice||'先前校对仅保留审计，部分修改前正文快照缺失；未补造历史。'}</Notice>}
        {r.data.history.records.length?r.data.history.records.map(record=>{
          const keys=(Object.keys(snapshotFieldLabels) as Array<keyof EvidenceSnapshot>).filter(key=>{
            if(key==='table'&&sameSnapshotValue(record.before.table,record.before.structuredData)&&sameSnapshotValue(record.after.table,record.after.structuredData))return false;
            return !sameSnapshotValue(record.before[key],record.after[key]);
          });
          return <details className="e-detail-json" key={record.id}>
            <summary>V{record.sourceDocumentVersion} · 修订 {record.sourceBlockRevision} → V{record.documentVersion} · 修订 {record.blockRevision} · {formatDate(record.createdAt)}</summary>
            <div className="e-stack" style={{marginTop:14}}>
              <p className="e-muted">{record.cause==='header_propagation'?'同表表头同步':record.cause==='manual_review'?'人工核验 / 校对':'修订记录'} · 办理人：{record.actorName||'未记录姓名'}</p>
              <p className="e-muted">对应片段：{record.after.heading||record.before.heading||(record.after.text||record.before.text||'').slice(0,60)||'未记录片段标题'}</p><p className="e-evidence-text">办理原因：{record.reason||'未记录原因'}</p>
              {keys.length?keys.map(key=><section key={key} className="e-stack">
                <h3>{snapshotFieldLabels[key]}变更</h3>
                <div className="e-evidence-comparison">
                  <article><h3>修改前</h3><EvidenceHistoryValue field={key} value={record.before[key]}/></article>
                  <article><h3>修改后</h3><EvidenceHistoryValue field={key} value={record.after[key]}/></article>
                </div>
              </section>):<p className="e-muted">本次保存前后，正文、结构化字段、来源位置与核验状态未发生变化。</p>}
            </div>
          </details>;
        }):<p className="e-muted">{r.data.history.incomplete?'当前暂无可对照的修订正文；历史缺口见上方说明。':'暂无已保存的修订快照。'}</p>}
      </>}
    </div>}
  </details>;
}
function EvidenceHistoryValue({field,value}:{field:keyof EvidenceSnapshot;value:unknown}) {
  if(value===undefined||value===null)return <p className="e-muted">未保存该字段</p>;
  if(field==='reviewState')return <p className="e-evidence-text">{reviewLabels[String(value)]||String(value)}</p>;
  if(field==='evidenceType')return <p className="e-evidence-text">{evidenceTypeLabels[String(value)]||String(value)}</p>;
  if(typeof value==='string')return <p className="e-evidence-text">{value||'（空文本）'}</p>;
  if((field==='structuredData'||field==='table')&&typeof value==='object') {
    const table=value as Partial<ChunkTable>;
    if(Array.isArray(table.headers)&&Array.isArray(table.rows)) {
      const {headers,rows,rowNumbers,...metadata}=table;
      return <div className="e-stack" style={{marginTop:12}}>
        <div className="e-table-scroll" tabIndex={0} aria-label="修订表格，可横向滚动"><table><thead><tr><th>来源记录</th>{headers.map((header,index)=><th key={index}>{header}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}><th>{rowNumbers?.[index]??'未记录'}</th>{row.map((cell,column)=><td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>
        {Object.keys(metadata).length>0&&<details className="e-detail-json"><summary>表格附加字段</summary><DataValue value={metadata}/></details>}
      </div>;
    }
  }
  if(field==='locator')return <div className="e-stack" style={{marginTop:12}}><p className="e-muted">{locatorText(value as EvidenceLocator)}</p><DataValue value={value}/></div>;
  return <DataValue value={value}/>;
}

function EvidenceEditor({document,block,mode,onClose,onSaved}:{document:KnowledgeDocument;block:EvidenceBlock;mode:'confirm'|'edit';onClose:()=>void;onSaved:(data:EvidenceData&{createdVersion:boolean})=>void}){const [reason,setReason]=useState('');const [text,setText]=useState(block.text);const [startMs,setStartMs]=useState(block.locator.startMs||0);const [endMs,setEndMs]=useState(block.locator.endMs||0);const [table,setTable]=useState(block.structuredData?.headers?structuredClone(block.structuredData):null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const result=await api<EvidenceData&{createdVersion:boolean}>(`/documents/${document.id}/evidence/${block.id}`,{method:'PATCH',body:JSON.stringify({revision:document.revision,blockRevision:block.blockRevision,reason,...(mode==='edit'?(table?{structuredData:table}:{text,...(['transcript','frame_text'].includes(block.type)?{locator:{startMs,endMs}}:{})}):{})})});onSaved(result);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}return <Modal title={mode==='confirm'?'记录证据核验':'校对抽取证据'} wide onClose={onClose} busy={busy}><form className="e-stack" onSubmit={submit}>{error&&<Notice kind="error">{error}</Notice>}<Notice>{document.status==='published'?'当前为已发布资料，保存将创建待审核版本，不覆盖当前正式知识。':'保存保留原件，并更新当前待审核稿的证据修订。'}请对照来源位置核实数字、单位、编号及适用条件。</Notice><p className="e-muted">{locatorText(block.locator)}</p><OriginalEvidence document={document} locator={block.locator}/>{mode==='edit'&&['transcript','frame_text'].includes(block.type)&&<div className="e-grid two"><label className="e-field">起始时间（秒）<input type="number" required min={0} step={0.001} max={document.durationMs?document.durationMs/1000:undefined} value={startMs/1000} onChange={e=>setStartMs(Math.round(Number(e.target.value)*1000))}/></label><label className="e-field">结束时间（秒）<input type="number" required min={(startMs+1)/1000} step={0.001} max={document.durationMs?document.durationMs/1000:undefined} value={endMs/1000} onChange={e=>setEndMs(Math.round(Number(e.target.value)*1000))}/></label></div>}{mode==='edit'&&(table?<div className="e-table-scroll"><table><thead><tr><th>来源记录</th>{table.headers.map((header,column)=><th key={column}><input aria-label={`第${column+1}列表头`} required value={header} onChange={e=>setTable(old=>old?{...old,headers:old.headers.map((value,i)=>i===column?e.target.value:value)}:old)}/></th>)}</tr></thead><tbody>{table.rows.map((row,index)=><tr key={index}><th>{table.rowNumbers[index]??'未提供'}</th>{row.map((value,column)=><td key={column}><input aria-label={`记录${table.rowNumbers[index]??index+1} ${table.headers[column]}`} value={value} onChange={e=>setTable(old=>old?{...old,rows:old.rows.map((values,i)=>i===index?values.map((cell,j)=>j===column?e.target.value:cell):values)}:old)}/></td>)}</tr>)}</tbody></table></div>:<label className="e-field">校对文本<textarea rows={12} required value={text} onChange={e=>setText(e.target.value)}/></label>)}<label className="e-field">核验依据与修改原因<textarea required minLength={3} maxLength={2000} rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="说明对照的原文位置、核实结果及修订原因。"/></label><div className="e-modal-actions"><button type="button" className="e-btn" disabled={busy} onClick={onClose}>取消</button><button className="e-btn primary" disabled={busy}>{busy?'正在保存…':document.status==='published'?'保存为待审核新版本':'保存复核记录'}</button></div></form></Modal>;}
interface Relation {id:string;revision:number;subjectId?:string;subject?:string;predicate:string;objectId?:string;object?:string;value?:string;reviewState?:string;status?:string;canManage?:boolean;actions?:string[];stale?:boolean;subjectName?:string;objectName?:string;evidenceRefs?:Array<{blockId?:string;documentId?:string;text?:string}>}
function RelationsPanel({document}:{document:KnowledgeDocument}){const r=useResource<{entities:Array<{id:string;name:string;type:string}>;relations:Relation[]}>(`/documents/${document.id}/relations`);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [selected,setSelected]=useState<{relation:Relation;action:string}|null>(null);const [reason,setReason]=useState('');async function extract(){setBusy(true);setError('');try{await api(`/documents/${document.id}/relations/extract`,{method:'POST',body:JSON.stringify({revision:document.revision})});r.reload();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}async function act(e:FormEvent){e.preventDefault();if(!selected)return;setBusy(true);try{await api(`/relations/${selected.relation.id}/actions`,{method:'POST',body:JSON.stringify({revision:selected.relation.revision,action:selected.action,reason})});setSelected(null);r.reload();}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}return <section className="e-card e-stack"><div className="e-section-heading"><h2>实体与关系</h2><Link className="e-text-link" to={`/assets/graph?baseId=${encodeURIComponent(document.baseId)}`}><Network size={15}/>进入知识图谱</Link>{document.canManage&&<button className="e-btn" disabled={busy} onClick={extract}>{busy?'正在处理…':'提取关系候选'}</button>}</div><p className="e-muted">关系须有文档证据并经过复核；同名对象不自动认定为同一设备或车站。</p>{(error||r.error)&&<Notice kind="error">{error||r.error}</Notice>}{r.loading?<Loading/>:r.data?.relations.length?<div className="e-table-scroll"><table><thead><tr><th>对象</th><th>关系</th><th>关联对象 / 值</th><th>状态与依据</th><th>办理</th></tr></thead><tbody>{r.data.relations.map(row=><tr key={row.id}><td>{r.data?.entities.find(e=>e.id===row.subjectId)?.name||row.subjectName||row.subject||row.subjectId}</td><td>{graphRelationLabels[row.predicate]||row.predicate}</td><td>{r.data?.entities.find(e=>e.id===row.objectId)?.name||row.objectName||row.object||row.value||row.objectId}</td><td>{reviewLabels[row.reviewState||row.status||'']||row.reviewState||row.status}{row.evidenceRefs?.map((ref,i)=><p key={i}><Link to={`/documents/${ref.documentId||document.id}${ref.blockId?`?chunk=${ref.blockId}`:''}`}>{ref.text||'查看原文证据'}</Link></p>)}</td><td>{document.canManage&&row.canManage!==false&&!row.stale&&Boolean(row.actions?.length)&&<div className="e-actions"><button className="e-text-link" onClick={()=>{setSelected({relation:row,action:'confirm'});setReason('');}}>确认</button><button className="e-text-link" onClick={()=>{setSelected({relation:row,action:'reject'});setReason('');}}>驳回</button></div>}</td></tr>)}</tbody></table></div>:<EmptyState title="尚无可见的实体关系" description="维护人员提取并核验候选后，可从这里回查关系的原文依据。"/>}{selected&&<Modal title={selected.action==='confirm'?'确认关系依据':'驳回关系候选'} onClose={()=>setSelected(null)} busy={busy}><form onSubmit={act} className="e-stack"><label className="e-field">办理依据<textarea required minLength={3} rows={3} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="e-btn primary" disabled={busy}>保存办理记录</button></form></Modal>}</section>;}

function OriginalEvidence({document,locator}:{document:KnowledgeDocument;locator:EvidenceLocator}) {return <details className="e-evidence-original" open><summary>原件对照</summary>{document.mimeType==='application/pdf'?<iframe title="证据对应的 PDF 原件" src={'/api/documents/'+document.id+'/preview#page='+(locator.page||1)}/>:document.mimeType?.startsWith('image/')?<img alt={document.fileName} src={'/api/documents/'+document.id+'/preview'}/>:document.mimeType?.startsWith('audio/')||document.mimeType?.startsWith('video/')?<MediaPreview document={document} timeMs={locator.startMs||0}/>:<p className="e-muted">此格式请在本地办公软件中核验原件，来源记录号和单元格位置保持不变。</p>}<a className="e-text-link" href={'/api/documents/'+document.id+'/file'} target="_blank" rel="noreferrer">下载原件对照</a></details>;}

function GraphSourceRecord({table,rowNumber}:{table:ChunkTable;rowNumber:number}) {
  const index=table.rowNumbers?.indexOf(rowNumber)??-1;
  if(index<0||!table.rows[index])return null;
  const fields=table.headers.map((label,column)=>({label,value:table.rows[index][column]||'空值'})).filter(field=>/(编号|编码|名称|车站|站名|问题摘要|问题描述|所属单位|线路)$/.test(field.label)).slice(0,8);
  return fields.length?<dl className="e-graph-record-summary">{fields.map((field,index)=><div key={index}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>:null;
}
