import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Code2, Copy, Database, Download, KeyRound, Link2, Loader2, Plus, Power, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api, ApiError, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import { SelectControl } from './SelectControl';
import type { KnowledgeBase, User } from './types';
import './knowledge-interfaces.css';

export interface KnowledgeInterfaceContext { baseId?: string; scenario?: string; task?: string; object?: string }
export interface KnowledgeInterface {
  id: string; name: string; baseId: string; baseName: string; scenario: string; scenarioLabel: string; task: string; object?: string;
  active: boolean; revision: number; createdAt: string; updatedAt: string; expiresAt: string; lastUsedAt?: string | null;
  calls: number; endpoint: string; method: 'POST';
}
interface CatalogScene { id: string; label: string; tasks: string[] }
interface InterfaceResult { interface: KnowledgeInterface; secret: string }
const managePath = '/settings/knowledge-interfaces';
const lifetimes = [30, 90, 180, 365];
const expired = (row: KnowledgeInterface) => Boolean(row.expiresAt && new Date(row.expiresAt).valueOf() <= Date.now());
const endpointUrl = (row: KnowledgeInterface) => new URL(row.endpoint, window.location.origin).href;
const questionFor = (row: KnowledgeInterface) => row.task ? '请说明' + row.task + '的处理依据。' : '请说明相关要求与依据。';
const shellQuote = (text: string) => "'" + text.replace(/'/g, "'\"'\"'") + "'";

function CopyButton({ value, label = '复制', className = 'e-btn small' }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  useEffect(() => { setCopied(false); setError(''); }, [value]);
  async function copy() { try { await navigator.clipboard.writeText(value); setCopied(true); setError(''); } catch { setError('无法自动复制，请手动选择并复制。'); } }
  return <span className="ki-copy"><button type="button" className={className} onClick={() => void copy()}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? '已复制' : label}</button>{error && <small role="alert">{error}</small>}</span>;
}

function SecretCard({ secret, expiresAt, reset = false }: { secret: string; expiresAt: string; reset?: boolean }) {
  return <section className="ki-secret-card">
    <div className="ki-secret-heading"><KeyRound size={18}/><strong>{reset ? '新密钥已生成' : '接口密钥'}</strong><CopyButton value={secret} label="复制密钥"/></div>
    <p>{reset ? '旧密钥已立即失效。' : ''}密钥仅在此处显示一次，请复制保存。关闭后需重置才能获取新密钥。</p>
    <textarea aria-label="一次性接口密钥" readOnly value={secret} rows={2} onFocus={event => event.currentTarget.select()} spellCheck={false}/>
    <small>有效期至 {formatDate(expiresAt)}</small>
  </section>;
}

function InterfaceInstructions({ row }: { row: KnowledgeInterface }) {
  const [downloading, setDownloading] = useState(false), [error, setError] = useState('');
  const endpoint = endpointUrl(row), body = JSON.stringify({ question: questionFor(row) }, null, 2);
  const curl = 'curl --request POST ' + shellQuote(endpoint) + ' \\\n  --header ' + shellQuote('Authorization: Bearer YOUR_INTERFACE_KEY') + ' \\\n  --header ' + shellQuote('Content-Type: application/json') + ' \\\n  --data-raw ' + shellQuote(JSON.stringify({ question: questionFor(row) }));
  async function download() {
    setDownloading(true); setError('');
    try {
      const document = await api<Record<string, unknown>>('/knowledge-interfaces/' + encodeURIComponent(row.id) + '/openapi');
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob), anchor = window.document.createElement('a');
      anchor.href = url; anchor.download = 'knowledge-interface-' + row.id.replace(/[^a-zA-Z0-9_-]/g, '') + '.openapi.json';
      window.document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(errorMessage(failure)); } finally { setDownloading(false); }
  }
  return <section className="ki-instructions">
    <div className="ki-section-heading"><h3>调用说明</h3><button type="button" className="e-btn small" disabled={downloading} onClick={() => void download()}>{downloading ? <Loader2 className="e-spin" size={14}/> : <Download size={14}/>}下载 OpenAPI</button></div>
    <div className="ki-endpoint"><span>POST</span><code>{endpoint}</code><CopyButton value={endpoint} label="复制地址"/></div>
    <p className="ki-help">使用 Bearer 密钥认证，提交问题后返回绑定知识库的问答与引用。场景、任务和业务对象作为问答背景。</p>
    <div className="ki-code-card"><div><strong>请求 JSON</strong><CopyButton value={body} label="复制 JSON"/></div><pre><code>{body}</code></pre></div>
    <details className="ki-curl"><summary>查看 curl 示例</summary><div className="ki-code-card"><div><span>将 YOUR_INTERFACE_KEY 替换为接口密钥</span><CopyButton value={curl} label="复制 curl"/></div><pre><code>{curl}</code></pre></div></details>
    {error && <Notice kind="error">{error}<button type="button" className="e-text-link" onClick={() => void download()}>重试下载</button></Notice>}
  </section>;
}

/** onPublished runs when the user finishes the success view, preserving the once-only secret until then. */
export function PublishKnowledgeInterfaceDialog({ context = {}, onClose, onPublished }: { context?: KnowledgeInterfaceContext; onClose: () => void; onPublished?: (row: KnowledgeInterface) => void }) {
  const auth = useResource<{ user: User | null }>('/auth/me'), admin = auth.data?.user?.role === 'admin';
  const bases = useResource<{ bases: KnowledgeBase[] }>(admin ? '/bases' : null);
  const catalog = useResource<{ scenarios: CatalogScene[] }>(admin ? '/recommendation-links' : null);
  const ordinaryBases = (bases.data?.bases || []).filter(base => !base.systemKind), scenes = catalog.data?.scenarios || [];
  const [baseId, setBaseId] = useState(context.baseId || ''), [scenario, setScenario] = useState(context.scenario || ''), [task, setTask] = useState(context.task || '');
  const [object, setObject] = useState(context.object || ''), [customName, setCustomName] = useState<string | null>(null), [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<InterfaceResult | null>(null);
  const submitting = useRef(false);
  const base = ordinaryBases.find(item => item.id === baseId), scene = scenes.find(item => item.id === scenario);
  const suggestedName = [base?.name, task || scene?.label || '知识问答'].filter(Boolean).join(' · ').slice(0, 120);
  const name = customName ?? suggestedName;
  useEffect(() => { if (!context.baseId && !baseId && ordinaryBases.length === 1) setBaseId(ordinaryBases[0].id); }, [bases.data, context.baseId, baseId]);
  useEffect(() => { if (scene && !task && scene.tasks.length) setTask(scene.tasks[0]); }, [scene, task]);
  function close() { if (busy) return; if (result) onPublished?.(result.interface); onClose(); }
  async function publish(event: FormEvent) {
    event.preventDefault(); if (submitting.current || !admin) return; setError('');
    if (!base) { setError('请选择可发布的普通知识库。'); return; }
    if (!name.trim()) { setError('请填写接口名称。'); return; }
    if (scenario && (!scene || !scene.tasks.includes(task))) { setError('请选择当前场景中的任务。'); return; }
    if (!Number.isInteger(days) || days < 1 || days > 365) { setError('密钥有效期应为 1 至 365 天。'); return; }
    submitting.current = true; setBusy(true);
    try {
      const created = await api<InterfaceResult>('/knowledge-interfaces', { method: 'POST', body: JSON.stringify({ name: name.trim(), baseId, scenario, task: scenario ? task : '', ...(object.trim() ? { object: object.trim() } : {}), days }) });
      setResult(created);
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 0 ? '未收到发布结果，请先在管理页确认是否已创建，避免重复发布。' : errorMessage(failure));
    } finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title={result ? '标准接口已发布' : '发布为标准接口'} onClose={close} busy={busy} wide>
    {result ? <div className="ki-publish-result">
      <div className="ki-published-heading"><span><Check size={22}/></span><div><strong>{result.interface.name}</strong><p>{result.interface.baseName} · {result.interface.scenarioLabel || '通用知识问答'}{result.interface.task ? ' / ' + result.interface.task : ''}</p></div></div>
      <SecretCard secret={result.secret} expiresAt={result.interface.expiresAt}/>
      <InterfaceInstructions row={result.interface}/>
      <div className="e-modal-actions"><button type="button" className="e-btn" onClick={close}>完成</button><Link className="e-btn primary" to={managePath + '?interfaceId=' + encodeURIComponent(result.interface.id)} onClick={close}>进入接口管理<ArrowRight size={15}/></Link></div>
    </div> : auth.loading ? <Loading text="正在确认发布权限…"/> : auth.error ? <Notice kind="error">{auth.error}<button className="e-text-link" onClick={auth.reload}>重试</button></Notice> : !admin ? <div className="ki-permission"><ShieldCheck size={28}/><h3>仅管理员可发布标准接口</h3><p>请联系管理员发布所需的知识问答接口。</p><button className="e-btn" onClick={close}>关闭</button></div> : <form className="ki-publish-form" onSubmit={publish}>
      <p className="ki-intro">将知识库问答提供给业务系统使用，调用时沿用这里的场景和任务背景。</p>
      {bases.error && <Notice kind="error">{bases.error}<button type="button" className="e-text-link" onClick={bases.reload}>重新加载知识库</button></Notice>}
      {scenario && !scene && !catalog.loading && !catalog.error && <Notice kind="warning">该业务场景已不可用，请重新选择场景或通用知识问答。</Notice>}
      {catalog.error && <Notice kind="warning">场景目录暂未加载，可重试或选择通用知识问答。<button type="button" className="e-text-link" onClick={catalog.reload}>重试</button></Notice>}
      {bases.loading && !bases.data ? <Loading text="正在加载知识库…"/> : !bases.error && !ordinaryBases.length ? <div className="ki-empty-bases"><EmptyState title="暂无可发布的知识库" description="请先建立普通知识库并准备可用于问答的资料。" action={<Link className="e-btn" to="/assets/knowledge-bases" onClick={close}>管理知识库<ArrowRight size={14}/></Link>}/></div> : <>
        <label className="e-field">绑定知识库<SelectControl aria-label="绑定知识库" required value={baseId} disabled={busy || bases.loading} onChange={event => setBaseId(event.target.value)}><option value="">请选择知识库</option>{ordinaryBases.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectControl><small>仅使用所选知识库中可用于问答的资料。</small></label>
        {baseId && !base && !bases.loading && !bases.error && <Notice kind="warning">当前知识库无法发布，请重新选择普通知识库。</Notice>}
        <div className="ki-form-grid"><label className="e-field">业务场景<SelectControl aria-label="业务场景" value={scenario} disabled={busy || catalog.loading} onChange={event => { const next = scenes.find(item => item.id === event.target.value); setScenario(event.target.value); setTask(next?.tasks[0] || ''); }}><option value="">通用知识问答</option>{scenes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</SelectControl></label><label className="e-field">当前任务<SelectControl aria-label="当前任务" value={task} required={Boolean(scenario)} disabled={busy || !scenario || catalog.loading} onChange={event => setTask(event.target.value)}>{!scene && <option value="">{scenario ? '请选择有效场景' : '无需指定任务'}</option>}{scene?.tasks.map(item => <option key={item} value={item}>{item}</option>)}</SelectControl></label></div>
        <div className="ki-form-grid ki-name-grid"><label className="e-field">接口名称<input aria-label="接口名称" value={name} required maxLength={120} disabled={busy} onChange={event => setCustomName(event.target.value)}/></label><label className="e-field">密钥有效期<SelectControl aria-label="密钥有效期" value={days} disabled={busy} onChange={event => setDays(Number(event.target.value))}>{lifetimes.map(value => <option key={value} value={value}>{value} 天{value === 90 ? '（默认）' : ''}</option>)}</SelectControl></label></div>
        <details className="ki-context-options"><summary>{object ? '业务对象：' + object : '业务对象或编号（选填）'}</summary><label className="e-field">业务对象或编号<input aria-label="业务对象或编号" value={object} maxLength={200} disabled={busy} placeholder="例如：设备编号、岗位或业务关键词" onChange={event => setObject(event.target.value)}/></label></details>
      </>}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="e-modal-actions"><button type="button" className="e-btn" disabled={busy} onClick={close}>取消</button><button className="e-btn primary" disabled={busy || !base || Boolean(bases.error) || bases.loading || Boolean(scenario && (!scene || catalog.loading))}>{busy ? <Loader2 size={16} className="e-spin"/> : <Link2 size={16}/>} {busy ? '正在发布…' : '发布接口'}</button></div>
    </form>}
  </Modal>;
}

export function KnowledgeInterfacesPage({ user }: { user: User }) {
  const [params, setParams] = useSearchParams(), requestedId = params.get('interfaceId') || '';
  const resource = useResource<{ interfaces: KnowledgeInterface[] }>(user.role === 'admin' ? '/knowledge-interfaces' : null);
  const [search, setSearch] = useState(''), [stateFilter, setStateFilter] = useState('all'), [publishing, setPublishing] = useState(false);
  const [selected, setSelected] = useState<KnowledgeInterface | null>(null), [busyId, setBusyId] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const changing = useRef(false), all = resource.data?.interfaces || [], query = search.trim().toLocaleLowerCase();
  const rows = all.filter(row => (stateFilter === 'all' || row.active === (stateFilter === 'active')) && [row.name, row.baseName, row.scenarioLabel, row.task, row.object].filter(Boolean).join(' ').toLocaleLowerCase().includes(query));
  useEffect(() => {
    if (!requestedId) { setSelected(null); return; }
    const row = resource.data?.interfaces.find(item => item.id === requestedId);
    if (row) setSelected(row); else setSelected(previous => previous?.id === requestedId ? previous : null);
  }, [requestedId, resource.data]);
  function choose(row: KnowledgeInterface | null) { setSelected(row); const next = new URLSearchParams(params); row ? next.set('interfaceId', row.id) : next.delete('interfaceId'); setParams(next); }
  async function toggle(row: KnowledgeInterface) {
    if (changing.current) return; changing.current = true; setBusyId(row.id); setError(''); setMessage('');
    try {
      const result = await api<{ interface: KnowledgeInterface }>('/knowledge-interfaces/' + encodeURIComponent(row.id), { method: 'PATCH', body: JSON.stringify({ expectedRevision: row.revision, active: !row.active }) });
      setMessage('“' + result.interface.name + '”已' + (result.interface.active ? '启用。' : '停用，外部调用将停止。'));
      if (selected?.id === row.id) setSelected(result.interface); resource.reload();
    } catch (failure) { setError(failure instanceof ApiError && failure.status === 409 ? '接口配置已有更新，已刷新列表，请按最新状态重试。' : errorMessage(failure)); if (failure instanceof ApiError && failure.status === 409) resource.reload(); }
    finally { changing.current = false; setBusyId(''); }
  }
  return <div className="e-page ki-page">
    <PageHeader title="知识库标准接口管理" description="管理业务系统可调用的知识问答接口。" actions={user.role === 'admin' && <><button className="e-btn" onClick={resource.reload}><RefreshCw size={16}/>刷新</button><button className="e-btn primary" onClick={() => setPublishing(true)}><Plus size={16}/>发布标准接口</button></>}/>
    {user.role !== 'admin' ? <section className="e-card ki-permission"><ShieldCheck size={30}/><h3>仅管理员可管理标准接口</h3><p>接口发布、启停和密钥管理由管理员负责。</p></section> : <>
      {(resource.error || error) && <Notice kind="error">{error || resource.error}<button className="e-text-link" onClick={() => { setError(''); resource.reload(); }}>刷新列表</button></Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <div className="ki-toolbar"><label className="ki-search"><Search size={17}/><input aria-label="搜索标准接口" placeholder="搜索名称、知识库、场景或任务" value={search} onChange={event => setSearch(event.target.value)}/></label><SelectControl aria-label="接口状态" value={stateFilter} onChange={event => setStateFilter(event.target.value)}><option value="all">全部状态</option><option value="active">已启用</option><option value="inactive">已停用</option></SelectControl><span>{rows.length} 个接口</span></div>
      {!resource.loading && !resource.error && requestedId && !selected && <Notice kind="warning">未找到指定接口，请从列表中重新选择。</Notice>}
      {resource.loading && !resource.data ? <Loading text="正在加载标准接口…"/> : rows.length ? <div className="ki-list">{rows.map(row => <article className="e-card ki-interface-card" key={row.id}>
        <div className="ki-card-main"><span className="ki-card-icon"><Link2 size={21}/></span><div><div className="ki-card-title"><h2>{row.name}</h2><span className={'ki-status ' + (row.active ? 'active' : 'inactive')}>{row.active ? '已启用' : '已停用'}</span>{expired(row) && <span className="ki-expired">密钥已到期</span>}</div><p><Database size={13}/>{row.baseName}</p><div className="ki-card-context"><span>{row.scenarioLabel || '通用知识问答'}</span>{row.task && <span>{row.task}</span>}{row.object && <span>{row.object}</span>}</div></div></div>
        <div className="ki-card-usage"><div><strong>{row.calls || 0}</strong><span>累计调用</span></div><div><strong>{row.lastUsedAt ? formatDate(row.lastUsedAt) : '尚无调用'}</strong><span>最近调用</span></div></div>
        <div className="ki-card-actions"><button className="e-btn" disabled={Boolean(busyId)} onClick={() => choose(row)}><Code2 size={14}/>调用说明</button><button className="e-text-link" disabled={Boolean(busyId)} onClick={() => void toggle(row)}>{busyId === row.id ? '正在更新…' : row.active ? '停用' : '启用'}</button></div>
      </article>)}</div> : !resource.error && <section className="e-card"><EmptyState title={query || stateFilter !== 'all' ? '没有匹配的接口' : '发布第一个标准接口'} description={query || stateFilter !== 'all' ? '调整关键词或状态继续查找。' : '选择知识库与业务场景，生成稳定的问答地址和专用密钥。'} action={!query && stateFilter === 'all' && <button className="e-btn primary" onClick={() => setPublishing(true)}><Plus size={16}/>发布标准接口</button>}/></section>}
      {selected && !publishing && <KnowledgeInterfaceDetails key={selected.id} row={selected} onClose={() => choose(null)} onUpdated={row => { setSelected(row); resource.reload(); }}/>}
      {publishing && <PublishKnowledgeInterfaceDialog onClose={() => setPublishing(false)} onPublished={row => { choose(row); resource.reload(); }}/>}
    </>}
  </div>;
}

function KnowledgeInterfaceDetails({ row, onClose, onUpdated }: { row: KnowledgeInterface; onClose: () => void; onUpdated: (row: KnowledgeInterface) => void }) {
  const [current, setCurrent] = useState(row), [days, setDays] = useState(90), [secret, setSecret] = useState('');
  const [busy, setBusy] = useState<'toggle' | 'rotate' | ''>(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const changing = useRef(false);
  useEffect(() => { setCurrent(row); }, [row]);
  async function change(kind: 'toggle' | 'rotate') {
    if (changing.current) return; changing.current = true; setBusy(kind); setError(''); setMessage('');
    try {
      if (kind === 'toggle') {
        const result = await api<{ interface: KnowledgeInterface }>('/knowledge-interfaces/' + encodeURIComponent(current.id), { method: 'PATCH', body: JSON.stringify({ expectedRevision: current.revision, active: !current.active }) });
        setCurrent(result.interface); onUpdated(result.interface); setMessage(result.interface.active ? '接口已启用。' : '接口已停用，外部调用将停止。');
      } else {
        const result = await api<InterfaceResult>('/knowledge-interfaces/' + encodeURIComponent(current.id) + '/rotate-secret', { method: 'POST', body: JSON.stringify({ expectedRevision: current.revision, days }) });
        setCurrent(result.interface); setSecret(result.secret); onUpdated(result.interface);
      }
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 409 ? '接口配置已有更新，请刷新接口状态后重试。' : errorMessage(failure));
    } finally { changing.current = false; setBusy(''); }
  }
  async function refresh() {
    if (changing.current) return; setError('');
    try { const response = await api<{ interfaces: KnowledgeInterface[] }>('/knowledge-interfaces'); const latest = response.interfaces.find(item => item.id === current.id); if (!latest) { setError('接口不存在或当前无权查看。'); return; } setCurrent(latest); onUpdated(latest); }
    catch (failure) { setError(errorMessage(failure)); }
  }
  return <Modal title="标准接口详情" onClose={onClose} busy={Boolean(busy)} wide><div className="ki-details">
    <div className="ki-detail-heading"><span className="ki-card-icon"><Link2 size={21}/></span><div><h2>{current.name}</h2><p>{current.baseName} · {current.scenarioLabel || '通用知识问答'}{current.task ? ' / ' + current.task : ''}</p>{current.object && <small>业务对象：{current.object}</small>}</div><span className={'ki-status ' + (current.active ? 'active' : 'inactive')}>{current.active ? '已启用' : '已停用'}</span></div>
    <div className="ki-detail-meta"><span>累计调用 <strong>{current.calls || 0}</strong></span><span>最近调用 {current.lastUsedAt ? formatDate(current.lastUsedAt) : '尚无调用'}</span><span>密钥到期 {formatDate(current.expiresAt)}</span></div>
    {expired(current) && <Notice kind="warning">密钥已到期，请重置后更新调用方配置。</Notice>}
    {!current.active && <p className="ki-paused-note">接口已停用，启用后才可继续调用。</p>}
    {error && <Notice kind="error">{error}<button type="button" className="e-text-link" disabled={Boolean(busy)} onClick={() => void refresh()}>刷新接口状态</button></Notice>}
    {message && <Notice kind="success">{message}</Notice>}
    {secret && <SecretCard secret={secret} expiresAt={current.expiresAt} reset/>}
    <InterfaceInstructions row={current}/>
    <section className="ki-key-management"><div><h3>密钥管理</h3><p>重置后旧密钥立即失效，请同步更新调用方配置。</p></div><div className="ki-key-controls"><SelectControl aria-label="重置后密钥有效期" value={days} disabled={Boolean(busy)} onChange={event => setDays(Number(event.target.value))}>{lifetimes.map(value => <option key={value} value={value}>有效期 {value} 天</option>)}</SelectControl><button type="button" className="e-btn" disabled={Boolean(busy)} onClick={() => void change('rotate')}>{busy === 'rotate' ? <Loader2 size={15} className="e-spin"/> : <KeyRound size={15}/>}重置密钥</button></div></section>
    <div className="e-modal-actions"><button type="button" className="e-btn" disabled={Boolean(busy)} onClick={() => void change('toggle')}>{busy === 'toggle' ? <Loader2 size={15} className="e-spin"/> : <Power size={15}/>} {current.active ? '停用接口' : '启用接口'}</button><button type="button" className="e-btn primary" disabled={Boolean(busy)} onClick={onClose}>关闭</button></div>
  </div></Modal>;
}
