import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Database, FolderSync, Globe2, KeyRound, Link2, Plus, RefreshCw, Search, Settings2 } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import { SelectControl } from './SelectControl';
import type { KnowledgeBase } from './types';
import './sources-page.css';

type SourceType = 'folder' | 'web' | 'api';
type SourceError = string | { file?: string; message?: string; error?: string; code?: string };
interface SourceStats {
  scanned?: number; created?: number; imported?: number; updated?: number; unchanged?: number; skipped?: number;
  archived?: number; withdrawn?: number; failed?: number; partial?: boolean; pages?: number; errors?: SourceError[];
}
interface Source {
  id: string; type?: SourceType; name: string; baseId: string; path?: string; url?: string; revision?: number;
  status: string; active?: boolean; intervalMinutes?: number; lastSyncAt?: string | null; nextSyncAt?: string | null;
  lastError?: string | null; archiveDeleted?: boolean; stats?: SourceStats | null; errors?: SourceError[];
  fieldMapping?: Record<string, string>; permissionMapping?: { mode: string; approved?: boolean }; maxPages?: number;
  hasToken?: boolean; hasSecret?: boolean;
}
interface SyncResponse extends SourceStats { connector?: Source }
interface Outcome { message: string; kind: 'success' | 'warning' | 'error'; stats?: SourceStats; errors?: SourceError[] }
const types = [
  { id: 'folder' as const, label: '服务器目录', hint: '同步目录中的文件', icon: FolderSync },
  { id: 'web' as const, label: '公开网页', hint: '保存单个网页快照', icon: Globe2 },
  { id: 'api' as const, label: '业务接口', hint: '按记录增量接入', icon: Link2 },
];
const intervals: Record<number, string> = { 0: '手动同步', 15: '每 15 分钟', 60: '每小时', 1440: '每天' };
const fields: Record<string, string> = { id: '记录编号', text: '正文内容', title: '资料标题', revision: '来源版本', updatedAt: '更新时间', deleted: '删除标记', allowed: '允许访问标记' };
const defaultMapping = { id: 'id', text: 'text', title: 'title', revision: 'revision', updatedAt: 'updatedAt', deleted: 'deleted', allowed: 'allowed' };
const sourceType = (row: Source) => row.type === 'web' || row.type === 'api' ? row.type : 'folder';
const sourceAddress = (row: Source) => sourceType(row) === 'folder' ? row.path : row.url;
const errorText = (error: SourceError) => typeof error === 'string' ? error : [error.file, error.message || error.error || error.code].filter(Boolean).join('：');
function sourceState(row: Source, syncing: boolean, outcome?: Outcome) {
  if (syncing || row.status === 'syncing') return { label: '同步中', kind: 'busy' };
  if (row.active === false) return { label: '已停用', kind: 'idle' };
  if (outcome?.kind === 'error') return { label: '同步失败', kind: 'error' };
  if (outcome?.kind === 'warning') return { label: '部分完成', kind: 'warning' };
  if (['failed', 'error'].includes(row.status)) return { label: '同步失败', kind: 'error' };
  if (['warning', 'partial'].includes(row.status) || row.stats?.partial || (row.stats?.failed || 0) > 0) return { label: '部分完成', kind: 'warning' };
  if (!row.lastSyncAt) return { label: '待首次同步', kind: 'idle' };
  return { label: '已同步', kind: 'success' };
}
function ResultCounts({ stats }: { stats: SourceStats }) {
  return <div className="e-source-counts">{[
    ['新增', stats.created ?? stats.imported ?? 0], ['更新', stats.updated ?? 0],
    ['未变化', stats.unchanged ?? stats.skipped ?? 0], ['撤回 / 下架', stats.archived ?? stats.withdrawn ?? 0],
    ['失败', stats.failed ?? 0],
  ].map(([label, value]) => <span key={label}><strong>{value}</strong>{label}</span>)}</div>;
}
export function SourcesPage() {
  const resource = useResource<{ connectors: Source[] }>('/connectors');
  const bases = useResource<{ bases: KnowledgeBase[] }>('/bases');
  const [editing, setEditing] = useState<Source | 'new' | null>(null);
  const [removing, setRemoving] = useState<Source | null>(null);
  const [busyId, setBusyId] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const rows = (resource.data?.connectors || []).filter(row => (typeFilter === 'all' || sourceType(row) === typeFilter) && [row.name, sourceAddress(row), bases.data?.bases.find(base => base.id === row.baseId)?.name].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  async function sync(row: Source) {
    setBusyId(row.id); setMessage('');
    setOutcomes(old => { const next = { ...old }; delete next[row.id]; return next; });
    try {
      const result = await api<SyncResponse>('/connectors/' + encodeURIComponent(row.id) + '/sync', { method: 'POST', body: '{}' });
      const current = result.connector, stats = current?.stats || result;
      const errors = result.errors || stats.errors || current?.errors || [];
      const failed = ['failed', 'error'].includes(current?.status || '');
      const partial = !failed && (result.partial || stats.partial || (stats.failed || 0) > 0 || ['partial', 'warning'].includes(current?.status || ''));
      setOutcomes(old => ({ ...old, [row.id]: {
        kind: failed ? 'error' : partial ? 'warning' : 'success', stats, errors,
        message: failed ? current?.lastError || '本次同步失败，资料源已保留，可检查配置后重试。' : partial ? '本次同步部分完成，请查看失败原因。' : '本次同步完成，新资料和新版本仍需审核发布。',
      } }));
      resource.reload();
    } catch (error) {
      setOutcomes(old => ({ ...old, [row.id]: { kind: 'error', message: errorMessage(error) + ' 资料源已保留，可重试同步。' } }));
      resource.reload();
    } finally { setBusyId(''); }
  }
  async function remove(event: FormEvent) {
    event.preventDefault(); if (!removing) return;
    setBusyId(removing.id); setRemoveError('');
    try {
      await api('/connectors/' + encodeURIComponent(removing.id), { method: 'DELETE', body: '{}' });
      setMessage('已移除“' + removing.name + '”，已接入文档和历史版本保留。');
      closeRemove();
      resource.reload();
    } catch (error) { setRemoveError(errorMessage(error)); }
    finally { setBusyId(''); }
  }
  function closeRemove() { setRemoving(null); setRemoveError(''); }
  return <div className="e-page e-sources-page">
    <PageHeader title="资料源同步" description="连接目录、网页或业务接口，将资料持续更新到知识库。" actions={<><button className="e-btn" disabled={Boolean(busyId)} onClick={resource.reload}><RefreshCw size={16}/>刷新</button><button className="e-btn primary" onClick={() => { setMessage(''); setEditing('new'); }}><Plus size={16}/>新增资料源</button></>}/>
    {resource.error && <Notice kind="error">{resource.error}<button className="e-text-link" onClick={resource.reload}>重新加载</button></Notice>}
    {bases.error && <Notice kind="error">目标知识库暂时无法加载。<button className="e-text-link" onClick={bases.reload}>重新加载知识库</button></Notice>}
    {message && <Notice kind="success">{message}</Notice>}
    <div className="e-sources-toolbar">
      <div className="e-sources-search"><Search size={17}/><input aria-label="搜索资料源" placeholder="搜索名称、地址或知识库" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <SelectControl aria-label="资料源类型" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="all">全部类型</option>{types.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</SelectControl>
      <span>{rows.length} 个资料源</span>
    </div>
    {resource.loading && !resource.data ? <Loading/> : rows.length ? <div className="e-sources-list">{rows.map(row => {
      const type = types.find(item => item.id === sourceType(row))!;
      const outcome = outcomes[row.id];
      const state = sourceState(row, busyId === row.id, outcome);
      const stats = outcome?.stats || row.stats;
      const details = outcome?.errors?.length ? outcome.errors : row.errors?.length ? row.errors : row.stats?.errors || [];
      return <article className="e-card e-source-item" key={row.id}>
        <div className="e-source-item-heading"><span className={'e-source-type-icon ' + type.id}><type.icon size={22}/></span><div><h2>{row.name}</h2><span className="e-source-type-name">{type.label}</span></div><span className={'e-source-state ' + state.kind}>{state.label}</span></div>
        <p className="e-source-address">{sourceAddress(row) || '来源地址未登记'}</p>
        <div className="e-source-meta"><span><Database size={14}/>{bases.data?.bases.find(base => base.id === row.baseId)?.name || (bases.loading ? '目标知识库信息待加载' : '目标知识库暂不可用')}</span><span>{intervals[row.intervalMinutes || 0] || '已配置周期'}</span></div>
        <div className="e-source-sync-detail">
          <span className="e-source-last-sync">{row.lastSyncAt ? '最近同步 ' + formatDate(row.lastSyncAt) : '配置已保存，尚未执行首次同步'}</span>
          {stats && <ResultCounts stats={stats}/>}
          {outcome ? <p className={'e-source-outcome ' + outcome.kind} role="status">{outcome.message}</p> : row.lastError ? <p className="e-source-outcome error">{row.lastError}</p> : null}
          {details.length > 0 && <details className="e-source-errors"><summary>查看 {details.length} 项同步说明</summary><ul>{details.map((error, index) => <li key={index}>{errorText(error)}</li>)}</ul></details>}
        </div>
        <div className="e-source-item-actions"><button className="e-btn primary" disabled={Boolean(busyId) || row.status === 'syncing' || row.active === false} onClick={() => void sync(row)}><RefreshCw size={14} className={busyId === row.id ? 'e-spin' : ''}/>{busyId === row.id ? '正在同步…' : '立即同步'}</button><button className="e-btn" disabled={Boolean(busyId) || row.status === 'syncing'} onClick={() => setEditing(row)}><Settings2 size={14}/>编辑</button><button className="e-text-link" disabled={Boolean(busyId) || row.status === 'syncing'} onClick={() => { setRemoveError(''); setRemoving(row); }}>移除</button><Link className="e-text-link e-source-documents" to={'/assets/documents?baseId=' + encodeURIComponent(row.baseId)}>查看资料<ArrowRight size={13}/></Link></div>
      </article>;
    })}</div> : !resource.error && <div className="e-card"><EmptyState title={search || typeFilter !== 'all' ? '没有匹配的资料源' : '添加第一个资料源'} description={search || typeFilter !== 'all' ? '调整名称或类型继续查找。' : '选择目录、公开网页或业务接口，保存后即可发起同步。'} action={!search && typeFilter === 'all' && <button className="e-btn primary" onClick={() => setEditing('new')}><Plus size={16}/>新增资料源</button>}/></div>}
    {editing && <SourceEditor row={editing === 'new' ? undefined : editing} bases={(bases.data?.bases || []).filter(base=>base.systemKind!=='feedback_learning')} basesLoading={bases.loading} basesError={bases.error} onReloadBases={bases.reload} onClose={() => setEditing(null)} onSaved={row => { setEditing(null); setMessage('“' + row.name + '”配置已保存。' + (row.lastSyncAt ? '后续同步按新配置执行。' : '尚未执行首次同步，请点击“立即同步”查看实际接入结果。')); setOutcomes(old => { const next = { ...old }; delete next[row.id]; return next; }); resource.reload(); }}/>}
    {removing && <Modal title="移除资料源" onClose={closeRemove} busy={Boolean(busyId)}><form className="e-stack" onSubmit={remove}><p>移除“{removing.name}”后停止后续同步，已接入文档和历史版本继续保留。</p>{removeError && <Notice kind="error">{removeError}</Notice>}<div className="e-modal-actions"><button type="button" className="e-btn" disabled={Boolean(busyId)} onClick={closeRemove}>取消</button><button className="e-btn danger" disabled={Boolean(busyId)}>{busyId ? '正在移除…' : '确认移除'}</button></div></form></Modal>}
  </div>;
}

function SourceEditor({ row, bases, basesLoading, basesError, onReloadBases, onClose, onSaved }: { row?: Source; bases: KnowledgeBase[]; basesLoading: boolean; basesError: string; onReloadBases: () => void; onClose: () => void; onSaved: (row: Source) => void }) {
  const [type, setType] = useState<SourceType>(row ? sourceType(row) : 'folder');
  const [name, setName] = useState(row?.name || '');
  const [baseId, setBaseId] = useState(row?.baseId || '');
  const [folder, setFolder] = useState(row?.path || '');
  const [url, setUrl] = useState(row?.url || '');
  const [intervalMinutes, setIntervalMinutes] = useState(row?.intervalMinutes || 0);
  const [archiveDeleted, setArchiveDeleted] = useState(row?.archiveDeleted || false);
  const [token, setToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [approved, setApproved] = useState(row?.permissionMapping?.approved || false);
  const [mapping, setMapping] = useState<Record<string, string>>({ ...defaultMapping, ...row?.fieldMapping });
  const [maxPages, setMaxPages] = useState(row?.maxPages || 5);
  const [advanced, setAdvanced] = useState(false);
  const [credentials, setCredentials] = useState(false);
  const [active, setActive] = useState(row?.active !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!baseId) { setError('请选择目标知识库。'); return; }
    if (type === 'api' && !row && (!approved || Object.values(mapping).some(value => !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(value)) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20)) {
      if (!approved) setError('请先确认业务接口的目标知识库权限。');
      else { setAdvanced(true); setError('请填写有效的单层字段名，单次读取页数为 1 至 20 的整数。'); }
      return;
    }
    setBusy(true);
    try {
      const shared = { name: name.trim(), intervalMinutes };
      const body = row
        ? { ...shared, ...(type === 'folder' ? { archiveDeleted } : { revision: row.revision, active, ...(type === 'api' && clearToken ? { token: '' } : type === 'api' && token.trim() ? { token: token.trim() } : {}) }) }
        : { ...shared, type, baseId, ...(type === 'folder' ? { path: folder.trim(), archiveDeleted } : { url: url.trim(), ...(type === 'api' ? { maxPages, fieldMapping: mapping, permissionMapping: { mode: 'target_base', approved }, ...(token.trim() ? { token: token.trim() } : {}) } : {}) }) };
      const result = await api<{ connector: Source }>(row ? '/connectors/' + encodeURIComponent(row.id) : '/connectors', { method: row ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      setToken('');
      onSaved({ ...result.connector, type });
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title={row ? '编辑资料源' : '新增资料源'} onClose={onClose} busy={busy} wide>
    <form className="e-stack e-source-editor" onSubmit={submit}>
      {!row ? <fieldset className="e-source-type-picker"><legend>选择接入方式</legend><div>{types.map(item => <label className={type === item.id ? 'selected' : ''} key={item.id}><input type="radio" name="source-type" value={item.id} checked={type === item.id} disabled={busy} onChange={() => { setType(item.id); setError(''); }}/><item.icon size={21}/><strong>{item.label}</strong><small>{item.hint}</small></label>)}</div></fieldset> : <p className="e-source-edit-type">{types.find(item => item.id === type)?.label}<span>地址与目标库创建后固定</span></p>}
      {error && <Notice kind="error">{error}</Notice>}
      <label className="e-field">资料源名称<input required maxLength={120} disabled={busy} value={name} onChange={e => setName(e.target.value)} placeholder={type === 'folder' ? '例如：设备维护资料' : type === 'web' ? '例如：行业政策发布页' : '例如：设备工单接口'}/></label>
      {type === 'folder' ? <label className="e-field">服务器目录<input required disabled={Boolean(row) || busy} value={folder} onChange={e => setFolder(e.target.value)} placeholder="填写服务器上的完整目录路径"/><small>选择已获准接入的文件目录。</small></label> : <label className="e-field">{type === 'web' ? '网页地址' : '接口地址'}<input required type="url" maxLength={2000} disabled={Boolean(row) || busy} value={url} onChange={e => setUrl(e.target.value)} placeholder={type === 'web' ? 'https://example.com/article' : 'https://example.com/api/records'}/><small>{type === 'web' ? '读取该地址的单页内容，保留来源快照。' : '读取返回 JSON 记录的接口，按来源版本更新资料。'}</small></label>}
      <div className="e-source-form-grid"><label className="e-field">目标知识库<SelectControl required disabled={Boolean(row) || busy || basesLoading} value={baseId} onChange={e => setBaseId(e.target.value)}><option value="">{basesLoading ? '正在加载知识库…' : '请选择知识库'}</option>{bases.map(base => <option value={base.id} key={base.id}>{base.name}</option>)}</SelectControl></label><label className="e-field">同步周期<SelectControl value={intervalMinutes} disabled={busy} onChange={e => setIntervalMinutes(Number(e.target.value))}>{Object.entries(intervals).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectControl></label></div>
      {basesError && <Notice kind="error">{basesError}<button type="button" className="e-text-link" onClick={onReloadBases}>重新加载知识库</button></Notice>}
      {!basesLoading && !basesError && !bases.length && <p className="e-source-empty-bases">请先创建目标知识库。<Link to="/assets/knowledge-bases" target="_blank" rel="noreferrer">打开知识库</Link><button type="button" className="e-text-link" onClick={onReloadBases}>刷新列表</button></p>}
      {type === 'folder' && <label className="e-source-check"><input type="checkbox" disabled={busy} checked={archiveDeleted} onChange={e => setArchiveDeleted(e.target.checked)}/><span>来源文件删除时，同步下架对应知识<small>已接入的原件与历史版本继续保留。</small></span></label>}
      {type === 'api' && <>
        <div className="e-source-disclosure"><button type="button" aria-expanded={credentials} className="e-source-disclosure-button" onClick={() => setCredentials(value => !value)}><KeyRound size={16}/><span>访问凭据<small>{row?.hasToken || row?.hasSecret ? '已配置，留空保留' : '可选，接口需要认证时填写'}</small></span><span>{credentials ? '收起' : '展开'}</span></button>{credentials && <div className="e-source-disclosure-content"><label className="e-field">Bearer Token<input type="password" autoComplete="new-password" maxLength={2000} disabled={busy || clearToken} value={token} onChange={e => setToken(e.target.value)} placeholder={row ? '填写新凭据以替换，留空保持不变' : '填写接口访问令牌'}/></label>{(row?.hasToken || row?.hasSecret) && <label className="e-source-check"><input type="checkbox" disabled={busy} checked={clearToken} onChange={e => { setClearToken(e.target.checked); if (e.target.checked) setToken(''); }}/><span>清除已保存的凭据</span></label>}</div>}</div>
        <div className="e-source-disclosure"><button type="button" aria-expanded={advanced} className="e-source-disclosure-button" onClick={() => setAdvanced(value => !value)}><Settings2 size={16}/><span>字段与分页<small>{row ? '查看已保存映射' : '已填常用字段，按接口格式调整'}</small></span><span>{advanced ? '收起' : '展开'}</span></button>{advanced && <div className="e-source-disclosure-content"><div className="e-source-form-grid">{Object.entries(fields).map(([key, label]) => <label className="e-field" key={key}>{label}<input disabled={Boolean(row) || busy} value={mapping[key]} onChange={e => setMapping(old => ({ ...old, [key]: e.target.value }))}/></label>)}<label className="e-field">单次最多读取页数<input type="number" min={1} max={20} disabled={Boolean(row) || busy} value={maxPages} onChange={e => setMaxPages(Number(e.target.value))}/></label></div><p className="e-source-format-note">接口返回 records 数组，通过 nextCursor 分页；complete 标记是否完整。字段映射支持单层字段名。{row && '字段与分页配置创建后固定。'}</p><pre className="e-source-schema">{'{ "records": [{ "id": "001", "title": "资料标题", "text": "正文" }], "nextCursor": null, "complete": true }'}</pre></div>}</div>
        <label className="e-source-check e-source-permission"><input type="checkbox" required disabled={Boolean(row) || busy} checked={approved} onChange={e => setApproved(e.target.checked)}/><span>已确认源记录可按目标知识库的权限开放<small>来源撤回或明确拒绝访问时，对应资料停止参与知识服务。</small></span></label>
      </>}
      {row && type !== 'folder' && <label className="e-source-check"><input type="checkbox" checked={active} disabled={busy} onChange={e => setActive(e.target.checked)}/><span>启用此资料源</span></label>}
      <p className="e-source-save-note">保存后可在列表点击“立即同步”，查看实际接入结果。</p>
      <div className="e-modal-actions"><button type="button" className="e-btn" disabled={busy} onClick={onClose}>取消</button><button className="e-btn primary" disabled={busy || basesLoading || Boolean(basesError) || !bases.length}>{busy ? '正在保存…' : '保存资料源'}</button></div>
    </form>
  </Modal>;
}
