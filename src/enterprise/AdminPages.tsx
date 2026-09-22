import { FeedbackRecords } from './FeedbackRecords';
import { SourcesPage } from './SourcesPage';
import { TasksWithAttributes } from './AttributeAnnotationPanel';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BusinessContext, businessHref } from './BusinessContext';
import { Download, Plus, RefreshCw } from 'lucide-react';
import { api, useResource, errorMessage, formatDate, formatBytes } from './api';
import type { User, KnowledgeBase } from './types';
import { PageHeader, Notice, EmptyState, Loading } from './components';
import { GovernancePage as Governance } from './KnowledgeGovernance';
import { SelectControl } from './SelectControl';
import { ModelSettingsPage } from './ModelSettingsPage';

type Row = Record<string, any>;
const roleNames: Record<string, string> = { admin: '系统管理员', editor: '知识管理员', viewer: '员工' };
const stateNames: Record<string, string> = { other: '其他问题', incorrect: '答案不准确', missing: '缺少知识', outdated: '资料过期', citation: '引用有误', open: '待处理', in_progress: '处理中', resolved: '已解决', queued: '排队中', processing: '处理中', review: '待审核', published: '已发布', failed: '失败', archived: '已下架', superseded: '历史版本', enabled: '启用', disabled: '停用', idle: '待同步', syncing: '同步中', success: '成功', error: '异常', pending: '待处理', completed: '已完成', succeeded: '解析完成', ready: '可用', warning: '部分失败', parse_failed: '解析失败', pending_review: '待审核', expired: '已过期', expiring: '即将到期', no_review_date: '缺少复审日期', parse_warning: '解析待核验', low: '低', medium: '中', high: '高' };
const label = (s: unknown) => stateNames[String(s)] || String(s ?? '—');
function Fields({ children }: { children: ReactNode }) { return <div className="e-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>{children}</div>; }
function Field({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) { return <label className="e-field"><span>{title}</span>{children}{hint && <small className="e-muted">{hint}</small>}</label>; }
function Summary({ values }: { values: { title: string; value: ReactNode; hint?: string }[] }) { return <div className="e-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>{values.map(v => <div className="e-card" key={v.title}><p className="e-muted">{v.title}</p><strong style={{ display: 'block', fontSize: 26, margin: '8px 0' }}>{v.value}</strong>{v.hint && <small className="e-muted">{v.hint}</small>}</div>)}</div>; }
function useAction(reload?: () => unknown) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function run(fn: () => Promise<unknown>, success: string) { setBusy(true); setError(''); setMessage(''); try { await fn(); setMessage(success); reload?.(); return true; } catch (e) { setError(errorMessage(e)); return false; } finally { setBusy(false); } }
  return { busy, run, notices: <>{error && <Notice kind="error">{error}</Notice>}{message && <Notice kind="success">{message}</Notice>}</> };
}
function Refresh({ onClick }: { onClick: () => unknown }) { return <button className="e-btn" onClick={onClick}><RefreshCw size={16} />刷新</button>; }

function Feedback({ user }: { user: User }) { return <FeedbackRecords user={user}/>; }

function UsersPage({ user }: { user: User }) {
  const r = useResource<{ users: Row[] }>('/users'), action = useAction(r.reload);
  const empty = { username: '', name: '', password: '', role: 'viewer', department: '', active: true };
  const [form, setForm] = useState(empty), [editing, setEditing] = useState<string | null>(null), [show, setShow] = useState(false);
  function edit(row: Row) { setEditing(row.id); setForm({ username: row.username, name: row.name, password: '', role: row.role, department: row.department || '', active: Boolean(row.active) }); setShow(true); }
  return <div className="e-page"><PageHeader title="用户与权限" description="管理员负责账号，知识管理员维护资料，员工仅使用已授权知识。权限调整由服务端即时执行。" actions={<button className="e-btn primary" onClick={() => { setForm(empty); setEditing(null); setShow(true); }}><Plus size={16} />新增用户</button>} />{action.notices}{r.error && <Notice kind="error">{r.error}</Notice>}
    {show && <section className="e-card"><h2>{editing ? '编辑用户' : '新增用户'}</h2><form className="e-stack" onSubmit={async e => { e.preventDefault(); const body: Row = { ...form }; if (!body.password) delete body.password; if (await action.run(() => api(editing ? `/users/${editing}` : '/users', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) }), '用户信息已保存')) setShow(false); }}><Fields>
      <Field title="登录账号"><input className="e-input" autoComplete="off" required disabled={!!editing} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></Field><Field title="姓名"><input className="e-input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
      <Field title={editing ? '重置密码（留空不修改）' : '初始密码'} hint="至少 12 位，包含字母和数字"><input className="e-input" type="password" autoComplete="new-password" minLength={12} required={!editing} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></Field>
      <Field title="所属部门"><input className="e-input" required value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="例如：综合管理部" /></Field><Field title="系统角色"><SelectControl className="e-input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{Object.entries(roleNames).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</SelectControl></Field>
      {editing && <Field title="账号状态"><SelectControl className="e-input" value={String(form.active)} onChange={e => setForm({ ...form, active: e.target.value === 'true' })}><option value="true">启用</option><option value="false">停用</option></SelectControl></Field>}
      </Fields><div className="e-toolbar"><button className="e-btn primary" disabled={action.busy}>保存用户</button><button type="button" className="e-btn" onClick={() => setShow(false)}>取消</button></div></form></section>}
    {r.loading ? <Loading /> : <div className="e-table-wrap"><table className="e-table"><thead><tr><th>姓名 / 账号</th><th>部门</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{(r.data?.users || []).map(x => <tr key={x.id}><td><strong>{x.name}</strong><p className="e-muted">{x.username}{x.id === user.id ? ' · 当前账号' : ''}</p></td><td>{x.department || '—'}</td><td>{roleNames[x.role] || x.role}</td><td>{x.active ? '启用' : '停用'}</td><td>{formatDate(x.createdAt)}</td><td><button className="e-btn" onClick={() => edit(x)}>编辑</button></td></tr>)}</tbody></table></div>}
    <Notice>知识范围在知识库中设置：企业共享、部门共享或指定成员。文档原件、检索结果及问答引用均遵循同一授权规则。</Notice>
  </div>;
}

function Settings() {
  return <ModelSettingsPage />;
}

function Operations() {
  const r = useResource<Row>('/operations'), action = useAction(r.reload);
  const d = r.data || {}, health = d.health || {}, storage = d.storage || {}, metrics = d.metrics || {};
  return <div className="e-page"><PageHeader title="运行与备份" description="查看服务与存储的实际状态，并创建包含数据库和原件的备份。" actions={<Refresh onClick={r.reload} />} />{action.notices}{r.error && <Notice kind="error">{r.error}</Notice>}
    {r.loading ? <Loading /> : <><Summary values={[{ title: '服务状态', value: health.ok === false || health.status === 'error' ? '需检查' : '运行中', hint: health.checkedAt ? formatDate(health.checkedAt) : '来自服务器实时检查' }, { title: '文档原件', value: storage.fileCount ?? storage.uploadCount ?? storage.documents ?? '—', hint: formatBytes(storage.totalBytes || storage.uploadBytes || 0) }, { title: '问答次数', value: metrics.chatCount ?? metrics.chatRequests ?? metrics.questions ?? '—' }, { title: '平均响应', value: metrics.averageLatencyMs != null ? `${Math.round(metrics.averageLatencyMs)} ms` : '—', hint: '本次运行已完成请求的平均处理耗时' }]} />
      <section className="e-card"><h2>数据备份</h2><p className="e-muted">备份保存在服务器受控目录中，包含数据库与原文文件。模型密钥不作为可下载附件提供。</p><button className="e-btn primary" disabled={action.busy} onClick={() => action.run(() => api('/operations/backup', { method: 'POST', body: '{}' }), '备份已生成，位置见备份记录')}><Download size={16} />{action.busy ? '正在备份…' : '创建备份'}</button>
      {(d.backups || []).length ? <div className="e-table-wrap"><table className="e-table"><thead><tr><th>备份</th><th>时间</th><th>原件数量</th></tr></thead><tbody>{d.backups.map((b: Row) => <tr key={b.id || b.name}><td>{b.name || b.id}</td><td>{formatDate(b.createdAt)}</td><td>{b.documentCount ?? 0}</td></tr>)}</tbody></table></div> : <p className="e-muted">尚未创建备份。</p>}</section>
      <section className="e-card"><h2>恢复与部署</h2><p>恢复操作在服务停止后由服务器管理员执行，避免覆盖运行中的数据。项目附带备份恢复工具和部署说明；上线前应在独立目录完成恢复演练。</p><p className="e-muted">就绪检查：/ready.json。解析失败、问答失败和权限变更可通过任务与审计记录定位。</p></section></>}
  </div>;
}

function Connectors() { return <SourcesPage/>; }
function Tasks({ user }: { user: User }) {
  const [params,setParams]=useSearchParams();const baseId=params.get('baseId')||'';const state=params.get('status')||'';
  const r=useResource<{tasks:Row[]}>('/tasks?'+new URLSearchParams({baseId}));const bases=useResource<{bases:KnowledgeBase[]}>('/bases');
  const rows=(r.data?.tasks||[]).filter(x=>!state||x.status===state);
  function filter(key:string,value:string){const next=new URLSearchParams(params);value?next.set(key,value):next.delete(key);if(key!=='tab'){/* keep tab */}setParams(next);}
  const queue=<>
    <BusinessContext scope={{baseId}} baseName={bases.data?.bases.find(base=>base.id===baseId)?.name} onClear={()=>filter('baseId','')}/>
    {(r.error||bases.error)&&<Notice kind="error">{r.error||bases.error}</Notice>}
    <div className="e-toolbar"><SelectControl className="e-input" aria-label="任务知识范围" value={baseId} onChange={e=>filter('baseId',e.target.value)}><option value="">全部可访问知识库</option>{bases.data?.bases.map(base=><option key={base.id} value={base.id}>{base.name}</option>)}</SelectControl><SelectControl className="e-input" aria-label="处理状态" value={state} onChange={e=>filter('status',e.target.value)}><option value="">全部状态</option>{['queued','processing','succeeded','failed'].map(value=><option key={value} value={value}>{label(value)}</option>)}</SelectControl><Refresh onClick={r.reload}/></div>
    <p className="e-muted">当前范围匹配 {rows.length} 个任务。服务端按知识库和文档权限筛选后，最多返回该范围最近 300 条。解析成功后可切换到「属性标注」。</p>
    {r.loading?<Loading/>:rows.length?<div className="e-table-wrap"><table className="e-table"><thead><tr><th>文件</th><th>任务类型</th><th>状态</th><th>阶段</th><th>进度</th><th>说明</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td>{x.fileName||x.title}</td><td>{x.type==='index'?'索引构建':'资料解析'}</td><td>{x.status==='succeeded'?'已完成':label(x.status)}</td><td>{x.stage||'—'}</td><td><progress value={x.progress||0} max={100} aria-label={(x.fileName||x.title||'文件')+'处理进度'}/>{x.progress||0}%</td><td>{x.error||x.message||'—'}</td><td>{formatDate(x.updatedAt||x.createdAt)}</td><td className="e-actions">{x.documentId&&<><Link className="e-btn" to={'/documents/'+encodeURIComponent(x.documentId)}>查看文件</Link>{x.status==='succeeded'&&<Link className="e-text-link" to={`/production/tasks?tab=attributes&documentId=${encodeURIComponent(x.documentId)}`}>属性标注</Link>}</>}</td></tr>)}</tbody></table></div>:<EmptyState title="当前范围暂无匹配任务" description="上传文件后自动创建任务，可调整知识范围或处理状态继续查看。" action={<Link className="e-btn primary" to={businessHref('/production/upload',{baseId})}>接入本库资料</Link>}/>}
  </>;
  return <TasksWithAttributes user={user} tasksView={queue}/>;
}

function Audit() {
  const names:Record<string,string>={
    'document.upload':'接入文档','document.parsed':'解析文档完成','document.parse_failed':'解析文档失败','document.parse_obsolete':'解析结果已过时','document.publish':'审核发布文档','document.reject':'退回文档修订','document.archive':'下架文档','document.restore':'恢复文档待审','document.edited':'保存文档校对','document.download':'下载原件','document.preview':'预览原件','document.indexed':'构建语义索引','document.index_failed':'索引构建失败','document.reparse_requested':'申请重新解析','document.draft_superseded':'替换待审草稿','document.scheduled_superseded':'有效版本切换',
    'knowledge.relations.extracted':'提取知识关系','knowledge.relation.confirm':'确认知识关系','knowledge.relation.reject':'排除候选关系','knowledge.checked':'检查知识质量','evidence.reviewed':'复核原文证据','governance.review':'完成资料复审','governance.acknowledge':'确认质量核验','governance.reopen':'重新打开质量问题',
    'feedback.learned':'加入机器学习','feedback.created':'提交知识反馈','feedback.updated':'办理知识反馈','workspace.case.created':'登记改进事项','workspace.case.updated':'更新改进事项','chat.answered':'完成知识问答','run.created':'创建问答运行','run.cancelled':'取消问答运行','run.retried':'重试问答运行',
    'scenario.created':'创建业务场景','scenario.updated':'更新业务场景','scenario.published':'发布业务场景','scenario.evaluated':'完成场景评测','scenario.evaluation_started':'开始场景评测','scenario.disabled':'停用业务场景','evaluation.completed':'完成检索评测',
    'connector.created':'创建资料源','connector.updated':'更新资料源','connector.deleted':'移除资料源','connector.sync':'同步资料源','connector.source_deleted':'来源删除并下架资料','connector.scheduled_failed':'定时同步失败','operations.backup':'创建数据备份','settings.updated':'更新平台设置','model.test':'测试模型连接','base.created':'创建知识库','base.updated':'更新知识库','user.created':'创建用户','user.updated':'更新用户与权限','auth.login':'用户登录','auth.logout':'用户退出','auth.password_changed':'修改登录密码','system.bootstrap':'初始化平台'
  };
  const [params,setParams]=useSearchParams();const query=params.get('q')||'';const actor=params.get('actor')||'';const object=params.get('object')||'';const from=params.get('from')||'';const to=params.get('to')||'';const event=params.get('action')||'';const r=useResource<{events:Row[]}>('/audit');const all=r.data?.events||[];
  function change(key:string,value:string){const next=new URLSearchParams(params);value?next.set(key,value):next.delete(key);setParams(next,{replace:true});}
  function docId(x:Row):string{return String(x.documentId||(typeof x.detail==='object'&&x.detail?.documentId)||(/^doc_/.test(x.target||x.targetId||'')?x.target||x.targetId:'')||'');}
  function actorName(x:Row):string{return String(x.actorName||x.actor||'系统');}
  function eventName(value:string){return names[value]||'其他系统事件';}
  function objectName(x:Row):string{return String(x.documentTitle||x.targetName||x.target||x.targetId||x.documentId||'—');}
  function objectType(x:Row){if(docId(x))return '文档';const id=String(x.target||x.targetId||'');return id.startsWith('run_')?'问答运行':id.startsWith('base_')?'知识库':id.startsWith('user_')?'用户':id.startsWith('feedback_')?'知识反馈':id.startsWith('connector_')?'资料源':id.startsWith('case_')||id.startsWith('workspace_case_')?'改进事项':id?'业务对象':'平台服务';}
  const invalidDates=Boolean(from&&to&&from>to);const events=all.filter(x=>{const text=[actorName(x),x.action,eventName(x.action),objectName(x),x.message,typeof x.detail==='string'?x.detail:JSON.stringify(x.detail||{})].join(' ').toLowerCase();const time=Date.parse(x.time||x.createdAt);return(!query||text.includes(query.toLowerCase()))&&(!actor||actorName(x)===actor)&&(!event||x.action===event)&&(!object||[objectName(x),docId(x)].join(' ').toLowerCase().includes(object.toLowerCase()))&&(!from||time>=new Date(from+'T00:00:00').valueOf())&&(!to||time<=new Date(to+'T23:59:59.999').valueOf())&&!invalidDates;});
  return <div className="e-page"><PageHeader title="操作审计" description="按人员、业务对象与时间核对实际操作，返回原文并追查记录细节。" actions={<Refresh onClick={r.reload}/>} />{r.error&&<Notice kind="error">{r.error}</Notice>}<section className="e-card e-stack"><Fields><Field title="事件关键词"><input className="e-input" aria-label="搜索审计记录" value={query} onChange={e=>change('q',e.target.value)} placeholder="例如：发布、复审、提取关系"/></Field><Field title="操作人"><SelectControl className="e-input" value={actor} onChange={e=>change('actor',e.target.value)}><option value="">全部操作人</option>{[...new Set(all.map(actorName))].map(name=><option key={name}>{name}</option>)}</SelectControl></Field><Field title="事件类型"><SelectControl className="e-input" value={event} onChange={e=>change('action',e.target.value)}><option value="">全部事件</option>{[...new Set(all.map(x=>String(x.action)))].map(value=><option value={value} key={value}>{eventName(value)}{names[value]?'':'（'+value+'）'}</option>)}</SelectControl></Field><Field title="业务对象"><input className="e-input" value={object} onChange={e=>change('object',e.target.value)} placeholder="文档名称或对象编号"/></Field><Field title="开始日期"><input className="e-input" type="date" value={from} max={to||undefined} onChange={e=>change('from',e.target.value)}/></Field><Field title="结束日期"><input className="e-input" type="date" value={to} min={from||undefined} onChange={e=>change('to',e.target.value)}/></Field></Fields><div className="e-toolbar"><span className="e-muted">最近 {all.length} 条实际记录中，匹配 {events.length} 条。接口最多返回最近 500 条；当前筛选不代表历史全量查询。</span><button className="e-btn" onClick={()=>setParams({},{replace:true})}>清除筛选</button></div>{invalidDates&&<Notice kind="warning">结束日期须不早于开始日期。</Notice>}</section>
    {r.loading?<Loading/>:events.length?<div className="e-table-wrap"><table className="e-table"><thead><tr><th>发生时间</th><th>操作人</th><th>业务事件</th><th>关联对象</th><th>处理说明与细节</th></tr></thead><tbody>{events.map(x=>{const documentId=docId(x);const summary=x.message||(typeof x.detail==='string'?x.detail:'');const detail=Object.fromEntries(Object.entries(x).filter(([key])=>!['time','actor','actorName','createdAt','documentTitle','message'].includes(key)));return <tr key={x.id}><td style={{whiteSpace:'nowrap'}}>{formatDate(x.time||x.createdAt)}</td><td>{actorName(x)}</td><td><strong>{eventName(x.action)}</strong></td><td style={{maxWidth:280,overflowWrap:'anywhere'}}><span className="e-badge">{objectType(x)}</span><p>{x.documentTitle||x.targetName||'对象编号见记录细节'}</p>{documentId&&<Link className="e-text-link" to={'/documents/'+encodeURIComponent(documentId)}>查看关联原文</Link>}</td><td style={{maxWidth:410,overflowWrap:'anywhere'}}>{summary&&<p>{summary}</p>}{typeof x.citationCount==='number'&&<p className="e-muted">附 {x.citationCount} 条知识引用</p>}<details><summary style={{cursor:'pointer',color:'#197b96'}}>展开记录细节</summary><pre style={{whiteSpace:'pre-wrap',fontSize:11,lineHeight:1.6,background:'#f5f8fb',padding:12,borderRadius:6,maxHeight:280,overflow:'auto'}}>{JSON.stringify(detail,null,2)}</pre></details></td></tr>;})}</tbody></table></div>:<EmptyState title="当前返回范围内没有符合条件的记录" description="可清除筛选后查看最近记录；更早事件不在此接口的单次返回范围中。"/>}
  </div>;
}

function Account({ user }: { user: User }) {
  const action = useAction(), [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' }), [mismatch, setMismatch] = useState('');
  return <div className="e-page"><PageHeader title="我的账号" description="管理个人登录密码，账号角色和部门由系统管理员维护。" />{action.notices}{mismatch && <Notice kind="error">{mismatch}</Notice>}<section className="e-card"><h2>{user.name}</h2><p className="e-muted">{user.username} · {user.department || '未设置部门'} · {roleNames[user.role]}</p><form className="e-stack" style={{ maxWidth: 480 }} onSubmit={async e => { e.preventDefault(); setMismatch(''); if (form.newPassword !== form.confirm) { setMismatch('两次输入的新密码不一致'); return; } if (await action.run(() => api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) }), '密码已更新')) setForm({ currentPassword: '', newPassword: '', confirm: '' }); }}><Field title="当前密码"><input className="e-input" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={e => setForm({ ...form, currentPassword: e.target.value })} /></Field><Field title="新密码" hint="至少 12 位，包含字母和数字"><input className="e-input" type="password" autoComplete="new-password" required minLength={12} value={form.newPassword} onChange={e => setForm({ ...form, newPassword: e.target.value })} /></Field><Field title="确认新密码"><input className="e-input" type="password" autoComplete="new-password" required minLength={12} value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} /></Field><button className="e-btn primary" disabled={action.busy}>更新密码</button></form></section></div>;
}

export default function AdminPages({ page, user }: { page: string; user: User }) {
  if (user.authMode === 'local' && ['users', 'account'].includes(page)) return <div className="e-page"><PageHeader title="本机免登录" description="当前使用本地工作空间。" /><Notice>可以直接使用知识库，暂时无需设置账号或密码。</Notice><div><Link className="e-btn primary" to="/workspace/overview">返回工作台</Link></div></div>;
  const adminOnly = ['users', 'settings', 'operations', 'connectors', 'audit'];
  if (adminOnly.includes(page) && user.role !== 'admin') return <div className="e-page"><PageHeader title="需要管理员权限" /><Notice kind="warning">当前账号没有该管理功能的权限。</Notice></div>;
  if (page === 'feedback') return <Feedback user={user} />;
  if (page === 'governance') return <Governance />;
  if (page === 'users') return <UsersPage user={user} />;
  if (page === 'settings') return <Settings />;
  if (page === 'operations') return <Operations />;
  if (page === 'connectors') return <Connectors />;
  if (page === 'tasks') return <Tasks user={user} />;
  if (page === 'audit') return <Audit />;
  return <Account user={user} />;
}

