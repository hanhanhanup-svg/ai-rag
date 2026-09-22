import { Link } from 'react-router-dom';
import { BookOpen, ChevronDown, ExternalLink } from 'lucide-react';
import { sourceKindNames } from './KnowledgeGovernance';
import { Notice } from './components';
import type { ChatMessage, Chunk, ChunkTable, Coverage, SearchResult } from './types';

export function CoverageNotice({ coverage }: { coverage?: Coverage }) {
  if (!coverage) return null;const computed=coverage.sourceComplete===true;
  return <Notice kind={coverage.complete?'info':'warning'}><strong>{computed?(coverage.complete?'来源快照完整，结果已全部返回':'来源快照完整，结果仅部分返回'):(coverage.complete?'资料覆盖完整':'当前依据未覆盖全部数据')}</strong>
    {computed?<span> · 已核对来源 {coverage.totalRows} 行{Number.isFinite(coverage.matchedRows)?'，条件匹配 '+coverage.matchedRows+' 行':''}，返回 {coverage.returnedRows} 项结果</span>:Number.isFinite(coverage.returnedRows)&&Number.isFinite(coverage.totalRows)&&<span> · 已返回 {coverage.returnedRows} / {coverage.totalRows} 行</span>}
    {coverage.reason&&<span>。{coverage.reason}</span>}{!coverage.complete&&<span>{computed?' 请增加筛选后查阅剩余结果。':' 请勿据此认定全量清单或完整统计。'}</span>}
  </Notice>;
}
export function citationNumber(citation: SearchResult, index: number) {
  return Number.isInteger(citation.citation) && Number(citation.citation) > 0 ? Number(citation.citation) : index + 1;
}
export function citationLink(citation: SearchResult) {
  return `/documents/${encodeURIComponent(citation.documentId)}?chunk=${encodeURIComponent(citation.id)}&page=${citation.page}${citation.locator?.startMs!==undefined?'&timeMs='+citation.locator.startMs:''}`;
}
export function AnswerText({ content, citations = [] }: { content: string; citations?: SearchResult[] }) {
  const byNumber = new Map(citations.map((citation, index) => [citationNumber(citation, index), citation]));
  return <p className="e-answer-text">{content.split(/(\[\d+(?:\s*[,，]\s*\d+)*\])/g).map((part, index) => {
    if (!/^\[\d+(?:\s*[,，]\s*\d+)*\]$/.test(part)) return <span key={index}>{part}</span>;
    const numbers = part.slice(1, -1).split(/[,，]/).map(value => Number(value.trim()));
    return <span className="e-inline-citation-group" key={index}>{numbers.map((number, childIndex) => {
      const citation = byNumber.get(number);
      return citation ? <Link className="e-inline-citation" key={childIndex} to={citationLink(citation)}
        title={`依据 ${number}：${citation.title} · V${citation.version}`}
        aria-label={`查看依据${number}：${citation.title}`}>[{number}]</Link> : <span key={childIndex}>[{number}]</span>;
    })}</span>;
  })}</p>;
}
function Citation({ citation, number }: { citation: SearchResult; number: number }) {
  const excerpt = citation.text.replace(/\s+/g, ' ').trim();
  return <Link className="e-citation" to={citationLink(citation)}><span>{number}</span><div>
    <strong>{citation.title}</strong><small>V{citation.version} · 第 {citation.page} 页 / 节{citation.heading ? ` · ${citation.heading}` : ''}</small>
    {citation.locator?.startMs!==undefined&&<small>来源时间 {(citation.locator.startMs/1000).toFixed(1)} 秒{citation.locator.precision==='approximate'?'附近 · 抽样画面，不代表连续覆盖':''}</small>}{citation.sourceKind&&<small>{sourceKindNames[citation.sourceKind]}{citation.applicability?' · '+citation.applicability:''}</small>}<p className="e-citation-excerpt">{excerpt.length>180?excerpt.slice(0,180)+'…':excerpt}</p><small>查看原文依据 ↗</small></div><ExternalLink size={14}/></Link>;
}
export function AnswerCitations({ message }: { message: ChatMessage }) {
  const citations = message.citations || [];
  if (!citations.length) return null;
  const references = new Set<number>();
  for (const match of (message.content || message.answer || '').matchAll(/\[(\d+(?:\s*[,，]\s*\d+)*)\]/g)) {
    match[1].split(/[,，]/).forEach(value => references.add(Number(value.trim())));
  }
  const entries = citations.map((citation, index) => ({ citation, number: citationNumber(citation, index) }));
  const explicit = entries.filter(entry => entry.citation.used === true ||
    (entry.citation.used === undefined && references.has(entry.number)));
  const extractiveFallback = message.mode === 'extractive' && !references.size && !entries.some(entry => typeof entry.citation.used === 'boolean');
  const primary = extractiveFallback ? entries : explicit;
  const secondary = entries.filter(entry => !primary.includes(entry));
  const primaryLabel = extractiveFallback ? '摘录依据' : '答案实际引用';
  return <div className="e-answer-sources">
    {primary.length > 0 && <details className="e-citations e-citations-used">
      <summary aria-label={`${primaryLabel}，共 ${primary.length} 条，点击展开或收起`}>
        <span className="e-citations-summary-main"><BookOpen size={15} aria-hidden="true"/>{primaryLabel} · {primary.length} 条</span>
        <span className="e-citations-summary-hint">点击展开依据</span>
        <ChevronDown size={14} aria-hidden="true"/>
      </summary>
      <div className="e-citations-body">{primary.map(entry => <Citation key={`${entry.citation.id}-${entry.number}`} {...entry}/>)}</div>
    </details>}
    {secondary.length > 0 && <details className="e-citations e-citations-other">
      <summary aria-label={`其他检索依据，共 ${secondary.length} 条，点击展开或收起`}>
        <span className="e-citations-summary-main"><BookOpen size={15} aria-hidden="true"/>其他检索依据 · {secondary.length} 条</span>
        <ChevronDown size={14} aria-hidden="true"/>
      </summary>
      <p className="e-source-explanation">这些资料参与检索，尚未标记为当前答案实际采用的依据。</p>
      <div className="e-citations-body">{secondary.map(entry => <Citation key={`${entry.citation.id}-${entry.number}`} {...entry}/>)}</div>
    </details>}
  </div>;
}

type TableRow = { sequence: number; sourceRow: number; values: string[] };
type TableGroup = { key: string; table: ChunkTable; page: number; rows: Map<number, TableRow>; chunks: Chunk[]; consistent: boolean };
export function StructuredTables({ chunks, focusedChunk, editing = false }: { chunks: Chunk[]; focusedChunk?: string | null; editing?: boolean }) {
  const groups = new Map<string, TableGroup>();
  for (const chunk of chunks) {
    const table = chunk.table;
    if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) continue;
    const key = `${chunk.documentId}:${chunk.page}:${table.tableId}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, table, page: chunk.page, rows: new Map(), chunks: [], consistent: true };
      groups.set(key, group);
    }
    if (!group.chunks.some(existing => existing.id === chunk.id)) group.chunks.push(chunk);
    if (table.totalRows !== group.table.totalRows || JSON.stringify(table.headers) !== JSON.stringify(group.table.headers)) group.consistent = false;
    if (table.rowEnd !== table.rowStart + table.rows.length - 1) group.consistent = false;
    table.rows.forEach((values, index) => {
      if (values.length !== table.headers.length) group!.consistent = false;
      const sequence = table.rowStart + index;
      const previous = group!.rows.get(sequence);
      if (previous && JSON.stringify(previous.values) !== JSON.stringify(values)) group!.consistent = false;
      group!.rows.set(sequence, { sequence, sourceRow: table.rowNumbers?.[index] ?? sequence, values });
    });
  }
  return <>{[...groups.values()].map(group => {
    const rows = [...group.rows.values()].sort((left, right) => left.sequence - right.sequence);
    const total = group.table.totalRows;
    const complete = group.consistent && rows.length === total && rows.every((row, index) => row.sequence === index + 1);
    const focus = group.chunks.find(chunk => chunk.id === focusedChunk)?.table;
    const rowLabel = group.table.format === 'xlsx' ? '原表行号' : '原文件记录号';
    return <section className="e-structured-table" key={group.key}>
      <div className="e-structured-table-heading"><h3>{group.table.name || '结构化表格'}</h3>
        <span className={`e-badge ${complete ? 'published' : 'review'}`}>{complete ? '完整表格' : '部分数据'}</span></div>
      <p className="e-muted">第 {group.page} 页 / 工作表 · 已显示 {rows.length} / {total} 条数据
        {group.table.headerSource === 'generated' && ' · 列名由系统生成，请对照原件核验'}</p>
      {!complete && <Notice kind="warning">当前内容未构成完整表格，请结合原件核验。不能将已显示的行作为全量数据。</Notice>}
      {editing && <p className="e-muted">表格按原件的行列关系展示。修改表格内容请上传新版本；下方普通文本仍可校对。</p>}
      <div className="e-table-scroll" role="region" tabIndex={0} aria-label={`${group.table.name || '表格'}，可横向滚动`}>
        <table><thead><tr><th scope="col">{rowLabel}</th>{group.table.headers.map((header, index) =>
          <th scope="col" key={index}>{header || `第${index + 1}列`}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.sequence} className={focus && row.sequence >= focus.rowStart && row.sequence <= focus.rowEnd ? 'highlighted' : ''}>
            <th scope="row">{group.chunks.filter(chunk => chunk.table?.rowStart === row.sequence).map(chunk =>
              <span key={chunk.id} id={`chunk-${chunk.id}`} className="e-table-anchor"/>)}{row.sourceRow}</th>
            {group.table.headers.map((_, index) => <td key={index}>{row.values[index] ?? ''}</td>)}
          </tr>)}</tbody></table>
      </div>
    </section>;
  })}</>;
}
