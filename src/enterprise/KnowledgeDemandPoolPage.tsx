import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import { SelectControl } from './SelectControl';
import type { User } from './types';
import './knowledge-extensions.css';

type Demand = {
  id: string; status: string; category: string; priority: string; question: string; conditions?: string;
  answer?: string; missingPoints?: string[]; relatedRunId?: string; relatedDocIds?: string[]; assigneeId?: string;
  assigneeName?: string; creatorName?: string; dueAt?: string; revision: number; updatedAt?: string;
  verification?: { passed?: boolean; note?: string }; history?: Array<{ at: string; action: string; note?: string }>;
};

const statusNames: Record<string, string> = {
  pending_confirm: '待确认', confirmed: '已确认', assigned: '已分派', in_progress: '处理中',
  review: '待审核', verifying: '复测中', closed: '已关闭', returned: '已退回',
};
const categoryNames: Record<string, string> = {
  knowledge_gap: '知识缺失', knowledge_outdated: '知识过期', conflict: '口径冲突',
  retrieval_miss: '检索未命中', parse_error: '解析错误', other: '其他',
};

export function KnowledgeDemandPoolPage({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const category = params.get('category') || '';
  const q = params.get('q') || '';
  const resource = useResource<{ demands: Demand[]; stats: Record<string, number>; categories: string[]; statuses: string[] }>(
    `/knowledge-demands?${new URLSearchParams({ status, category, q })}`,
  );
  const [selected, setSelected] = useState<Demand | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ question: '', category: 'knowledge_gap', missingPoints: '', priority: 'medium' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api<{ demand: Demand }>('/knowledge-demands', {
        method: 'POST',
        body: JSON.stringify({
          question: form.question,
          category: form.category,
          priority: form.priority,
          missingPoints: form.missingPoints.split(/[,，\n]/).map(v => v.trim()).filter(Boolean),
        }),
      });
      setCreating(false); setSelected(result.demand); setNotice('需求已创建。'); resource.reload();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ demand: Demand }>(`/knowledge-demands/${selected.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ revision: selected.revision, action, ...extra }),
      });
      setSelected(result.demand); setNotice(`已更新为：${statusNames[result.demand.status] || result.demand.status}`); resource.reload();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  async function verify() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ demand: Demand }>(`/knowledge-demands/${selected.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ answer: selected.answer || '' }),
      });
      setSelected(result.demand);
      setNotice(result.demand.verification?.passed ? '复测通过，需求已关闭。' : '复测未通过，已退回继续处理。');
      resource.reload();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  const stats = resource.data?.stats || {};

  return (
    <div className="e-page">
      <PageHeader
        title="知识需求池"
        description="归集问答缺口与口径冲突，分派处理并在发布后回归验证。不能靠重复新增知识或强行生成答案关闭需求。"
        actions={<>
          <button className="e-btn" onClick={resource.reload}><RefreshCw size={15}/>刷新</button>
          {user.role !== 'viewer' && <button className="e-btn primary" onClick={() => setCreating(true)}><Plus size={15}/>登记需求</button>}
        </>}
      />
      <div className="kx-stats">
        <div><strong>{stats.total ?? '—'}</strong><span>全部</span></div>
        <div><strong>{stats.pending_confirm ?? '—'}</strong><span>待确认</span></div>
        <div><strong>{stats.open ?? '—'}</strong><span>处理中</span></div>
        <div><strong>{stats.overdue ?? '—'}</strong><span>已逾期</span></div>
      </div>
      <Notice>流程：需求收集 → 分类确认 → 分派处理 → 内容审核 → 发布与复测 → 关闭或退回。「没有答出来」不等于「库中没有」，检索未命中应转检索优化。</Notice>
      {(error || resource.error) && <Notice kind="error">{error || resource.error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      <div className="e-toolbar">
        <SelectControl className="e-input" value={status} onChange={e => filter('status', e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectControl>
        <SelectControl className="e-input" value={category} onChange={e => filter('category', e.target.value)}>
          <option value="">全部分类</option>
          {Object.entries(categoryNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectControl>
        <input className="e-input" placeholder="搜索问题" value={q} onChange={e => filter('q', e.target.value)} />
      </div>
      {resource.loading && !resource.data ? <Loading /> : (
        <div className="kx-split">
          <div className="e-card kx-list">
            {(resource.data?.demands || []).length ? resource.data!.demands.map(row => (
              <button key={row.id} className={selected?.id === row.id ? 'active' : ''} onClick={() => setSelected(row)}>
                <strong>{row.question}</strong>
                <span>{statusNames[row.status]} · {categoryNames[row.category] || row.category} · {formatDate(row.updatedAt)}</span>
              </button>
            )) : <EmptyState title="需求池为空" description="可从完整性补全转入，或人工登记。" />}
          </div>
          <section className="e-card e-stack">
            {!selected ? <EmptyState title="选择需求查看详情" description="查看缺失点、分派与复测结果。" /> : (
              <>
                <div className="e-section-heading">
                  <h2>{selected.question}</h2>
                  <span className="e-badge">{statusNames[selected.status]}</span>
                </div>
                <p className="e-muted">分类：{categoryNames[selected.category]} · 优先级：{selected.priority} · 提出人：{selected.creatorName || '—'}</p>
                {!!selected.missingPoints?.length && <p>缺失事项：{selected.missingPoints.join('、')}</p>}
                {selected.conditions && <p>业务条件：{selected.conditions}</p>}
                {selected.answer && <p>已有答案摘要：{selected.answer}</p>}
                {selected.verification && <Notice kind={selected.verification.passed ? 'success' : 'warning'}>复测：{selected.verification.note}</Notice>}
                {user.role !== 'viewer' && (
                  <div className="e-actions e-wrap">
                    {selected.status === 'pending_confirm' && <button className="e-btn primary" disabled={busy} onClick={() => act('confirm')}>确认建单</button>}
                    {['confirmed', 'returned'].includes(selected.status) && <button className="e-btn" disabled={busy} onClick={() => act('assign', { assigneeId: user.id })}>分派给我</button>}
                    {['assigned', 'confirmed'].includes(selected.status) && <button className="e-btn" disabled={busy} onClick={() => act('start')}>开始处理</button>}
                    {selected.status === 'in_progress' && <button className="e-btn" disabled={busy} onClick={() => act('submit_review')}>提交审核</button>}
                    {['review', 'verifying'].includes(selected.status) && <button className="e-btn primary" disabled={busy} onClick={verify}>回归复测</button>}
                    {['review', 'verifying'].includes(selected.status) && <button className="e-btn" disabled={busy} onClick={() => act('close', { resolutionNote: '已完成知识补充并确认' })}>关闭</button>}
                    <button className="e-btn" disabled={busy} onClick={() => act('return', { note: '退回补充' })}>退回</button>
                    <Link className="e-text-link" to="/assets/knowledge-cards">去维护知识卡片</Link>
                    <Link className="e-text-link" to="/production/tasks?tab=attributes">去维护属性标注</Link>
                  </div>
                )}
                {!!selected.history?.length && (
                  <details>
                    <summary>处理记录</summary>
                    <ul className="kx-history">
                      {selected.history.slice().reverse().map((item, index) => (
                        <li key={index}>{formatDate(item.at)} · {item.action}{item.note ? ` · ${item.note}` : ''}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {creating && (
        <Modal title="登记知识需求" onClose={() => setCreating(false)} busy={busy}>
          <form className="e-stack" onSubmit={create}>
            {error && <Notice kind="error">{error}</Notice>}
            <label className="e-field">原始问题<textarea className="e-input" required rows={3} value={form.question} onChange={e => setForm({ ...form, question: e.target.value })} /></label>
            <label className="e-field">分类
              <SelectControl className="e-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {Object.entries(categoryNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </SelectControl>
            </label>
            <label className="e-field">缺失事项（逗号分隔）<input className="e-input" value={form.missingPoints} onChange={e => setForm({ ...form, missingPoints: e.target.value })} /></label>
            <div className="e-modal-actions">
              <button type="button" className="e-btn" onClick={() => setCreating(false)}>取消</button>
              <button className="e-btn primary" disabled={busy}>创建</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
