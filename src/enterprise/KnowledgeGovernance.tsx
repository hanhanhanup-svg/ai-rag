import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layers3, RefreshCw } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import type { GovernanceData, GovernanceIssue, KnowledgeBase, KnowledgeDocument, SourceKind } from './types';
import { SelectControl } from './SelectControl';

export const sourceKindNames: Record<SourceKind, string> = {
  unspecified: '尚未分类', official_public: '官方公开资料', internal_controlled: '内部受控文件',
  synthetic: '行业示例 / 合成资料', reference: '参考资料',
};
export function dateAfterDays(days = 0) {
  const date = new Date(); date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
export type GovernanceAction = 'acknowledge' | 'reopen' | 'review';
const issueNames: Record<string, string> = {
  parse_failed: '解析失败', pending_review: '待审核发布', expired: '已失效', expiring: '即将失效',
  review_due: '到期复审', no_review_date: '未安排复审', parse_warning: '解析质量待核验',
};
const actionNames: Record<GovernanceAction, string> = { acknowledge: '确认已核验', reopen: '重新打开', review: '记录复审' };
type ActionTarget = Pick<GovernanceIssue, 'documentId' | 'title' | 'type' | 'revision' | 'reviewDueAt'>;
export function GovernanceActionDialog({ target, action, onClose, onSaved }: {
  target: ActionTarget; action: GovernanceAction; onClose: () => void; onSaved: (document: KnowledgeDocument) => void;
}) {
  const [reason, setReason] = useState('');
  const [nextReviewAt, setNextReviewAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3) { setError('请填写具体核验依据或办理原因，至少3个字。'); return; }
    if (action === 'review' && (!nextReviewAt || nextReviewAt <= dateAfterDays())) {
      setError('请选择今天之后的下次复审日期。'); return;
    }
    setBusy(true); setError('');
    try {
      const result = await api<{ document: KnowledgeDocument; issues: GovernanceIssue[] }>('/governance/actions', {
        method: 'POST', body: JSON.stringify({
          documentId: target.documentId, type: target.type, action, reason: reason.trim(), revision: target.revision,
          ...(action === 'review' ? { nextReviewAt } : {}),
        }),
      });
      onSaved(result.document);
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <Modal title={actionNames[action]} onClose={onClose} busy={busy}>
    <form className="e-stack" onSubmit={submit}>
      <strong>{target.title}</strong>
      <Notice>{action === 'review' ? '记录本次适用性复核和下次复审日期。此操作不会修改失效日期，也不会将待审核或失效资料自动发布。'
        : action === 'acknowledge' ? '确认仅针对当前版本的解析质量问题，请先对照原件核验。内容变化后需要重新核验。'
        : '保留已有核验记录，将此问题重新列为待处理。'}</Notice>
      {error && <Notice kind="error">{error}</Notice>}
      <label className="e-field">{action === 'review' ? '复审结论与依据' : '核验依据或办理原因'}
        <textarea required minLength={3} maxLength={2000} rows={4} value={reason} onChange={event => setReason(event.target.value)}
          placeholder={action === 'review' ? '说明已核对的来源版本、适用范围及本次结论' : '说明核对了哪些内容、依据是什么，以及确认或重新打开的原因'}/>
      </label>
      {action === 'review' && <label className="e-field">下次复审日期
        <input type="date" required min={dateAfterDays(1)} value={nextReviewAt} onChange={event => setNextReviewAt(event.target.value)}/>
        <small className="e-muted">复审是定期核验安排；文档停止适用仍以失效日期为准。</small>
      </label>}
      <div className="e-modal-actions"><button className="e-btn" type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="e-btn primary" disabled={busy}>{busy ? '正在保存…' : actionNames[action]}</button></div>
    </form>
  </Modal>;
}

export function GovernancePage() {
  const [params, setParams] = useSearchParams();
  const baseId = params.get('baseId') || '';
  const bases = useResource<{ bases: KnowledgeBase[] }>('/bases');
  const resource = useResource<GovernanceData & { scope?: { baseId: string; label: string } }>(`/governance${baseId ? `?baseId=${encodeURIComponent(baseId)}` : ''}`);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState<{ issue: GovernanceIssue; action: GovernanceAction } | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => { setType(''); setSelected(null); setNotice(''); }, [baseId]);
  const scopeMismatch = Boolean(baseId && resource.data && resource.data.scope?.baseId !== baseId);
  const data = scopeMismatch ? null : resource.data;
  const scopeName = data?.scope?.label || bases.data?.bases.find(base => base.id === baseId)?.name || (baseId ? '所选知识库' : '全部可访问知识库');
  const issues = data?.issues || [];
  const outstanding = issues.filter(issue => issue.issueStatus !== 'acknowledged');
  const acknowledged = issues.filter(issue => issue.issueStatus === 'acknowledged');
  const rows = issues.filter(issue => (!type || issue.type === type) && (!status || (issue.issueStatus || 'open') === status));
  const notes = data?.notes || [];
  function changeBase(value: string) { const next = new URLSearchParams(params); value ? next.set('baseId', value) : next.delete('baseId'); setParams(next); }
  return <div className="e-page">
    <PageHeader title="知识治理" description="把需要办理的问题与资料格式说明分开，按实际原因完成核验、复审或业务修订。"
      actions={<button className="e-btn" onClick={resource.reload}><RefreshCw size={16}/>刷新</button>}/>
    <section className="e-card e-toolbar" aria-label="治理知识范围">
      <label className="e-field" style={{minWidth:220,flex:'1 1 280px'}}>知识范围<SelectControl aria-label="治理知识范围" value={baseId} onChange={event => changeBase(event.target.value)}>
        <option value="">全部可访问知识库</option>
        {baseId && !bases.loading && !bases.data?.bases.some(base => base.id === baseId) && <option value={baseId} disabled>所选知识库不可用</option>}
        {bases.data?.bases.map(base => <option value={base.id} key={base.id}>{base.name}</option>)}
      </SelectControl></label>
      <span className="e-muted" style={{display:'flex',alignItems:'center',gap:7,flex:'1 1 260px',fontSize:12}}><Layers3 size={16}/>统计、待办和阅读说明均属于：{scopeName}</span>
      <Link className="e-text-link" to={`/production/overview${baseId ? `?baseId=${encodeURIComponent(baseId)}` : ''}`}>返回接入加工</Link>
    </section>
    {(resource.error || bases.error) && <Notice kind="error">{resource.error || bases.error}</Notice>}
    {scopeMismatch && <Notice kind="warning">治理范围尚未正确加载，请刷新后继续。当前不展示其他知识库的数据。</Notice>}
    {notice && <Notice kind="success">{notice}</Notice>}
    <div className="e-governance-stats">
      {[['待处理问题', outstanding.length], ['涉及文档', new Set(outstanding.map(issue => issue.documentId)).size],
        ['高优先级', outstanding.filter(issue => issue.severity === 'high').length], ['已确认核验', acknowledged.length]].map(([name, value]) =>
        <section className="e-card" key={name}><p className="e-muted">{name}</p><strong>{data ? value : '—'}</strong></section>)}
    </div>
    <div className="e-toolbar">
      <SelectControl className="e-input" aria-label="治理办理状态" value={status} onChange={event => setStatus(event.target.value)}>
        <option value="open">待处理</option><option value="acknowledged">已确认</option><option value="">全部办理状态</option>
      </SelectControl>
      <SelectControl className="e-input" aria-label="问题类型" value={type} onChange={event => setType(event.target.value)}>
        <option value="">全部问题类型</option>{[...new Set(issues.map(issue => issue.type))].map(value =>
          <option key={value} value={value}>{issueNames[value] || value}</option>)}
      </SelectControl>
    </div>
    {resource.loading && !data ? <Loading text="正在读取所选知识库的治理事项…"/> : resource.error || scopeMismatch ? null : rows.length ? <div className="e-table-wrap"><table className="e-table">
      <thead><tr><th>文档与问题</th><th>说明</th><th>优先级 / 状态</th><th>维护责任人</th><th>办理</th></tr></thead>
      <tbody>{rows.map(issue => <tr key={issue.id}>
        <td><Link className="e-text-link" to={`/documents/${issue.documentId}`}>{issue.title}</Link><p className="e-muted">{issueNames[issue.type] || issue.type}</p></td>
        <td>{issue.message}{issue.reviewDueAt && <p className="e-muted">复审日期：{formatDate(issue.reviewDueAt).split(' ')[0]}</p>}
          {issue.acknowledgement ? <p className="e-muted">核验说明：{issue.acknowledgement.reason}<br/>{issue.acknowledgement.actorName} · {formatDate(issue.acknowledgement.at)}</p> : (issue.acknowledgedReason || issue.reason) && <p className="e-muted">办理说明：{issue.acknowledgedReason || issue.reason}</p>}</td>
        <td><span className={`e-badge ${issue.severity === 'high' ? 'failed' : issue.severity === 'medium' ? 'review' : ''}`}>
          {({ high: '高', medium: '中', low: '低' } as Record<string,string>)[issue.severity] || issue.severity}</span>
          <p className="e-muted">{issue.issueStatus === 'acknowledged' ? '已确认' : '待处理'}</p></td>
        <td>{issue.ownerName || '尚未指定'}</td>
        <td><div className="e-governance-actions">
          {issue.canManage && (['review', 'acknowledge', 'reopen'] as GovernanceAction[]).filter(action => issue.actions?.includes(action)).map(action =>
            <button className="e-btn small" key={action} onClick={() => { setSelected({ issue, action }); setNotice(''); }}>{actionNames[action]}</button>)}
          <Link className="e-text-link" to={`/documents/${issue.documentId}`}>{issue.type === 'pending_review' ? '校对审核'
            : ['expired', 'expiring'].includes(issue.type) ? '核实有效期' : issue.type === 'parse_failed' ? '处理原件' : '查看文档'}</Link>
        </div></td>
      </tr>)}</tbody>
    </table></div> : <EmptyState title={status === 'acknowledged' ? '暂无已确认的问题' : '当前筛选下没有待办问题'}
      description="待审核、失效和解析失败需通过文档业务流程处理；有依据的核验与复审会保留办理记录。"/>}
    <section className="e-card e-format-notes">
      <details><summary>资料格式与阅读说明 · {data ? notes.length : '—'} 份文档</summary>
        <p className="e-muted">{scopeName}内的页码含义、格式限制等说明帮助核验原件，不计入待处理问题，也无需逐条关闭。</p>
        {notes.length ? notes.map(note => <div className="e-governance-note" key={note.documentId}>
          <Link className="e-text-link" to={`/documents/${note.documentId}`}>{note.title}</Link>
          <ul>{note.notes.map((text, index) => <li key={index}>{text}</li>)}</ul>
        </div>) : <p className="e-muted">暂无格式说明。</p>}
      </details>
    </section>
    {selected && <GovernanceActionDialog target={selected.issue} action={selected.action} onClose={() => setSelected(null)}
      onSaved={() => { setNotice(`${actionNames[selected.action]}已保存，页面将显示最新办理结果。`); setSelected(null); resource.reload(); }}/>}
  </div>;
}
