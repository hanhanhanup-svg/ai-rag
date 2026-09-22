import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Database, FileText, Loader2, MessageSquare, RefreshCw, Search, Sparkles } from 'lucide-react';
import { api, ApiError, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import { SelectControl } from './SelectControl';
import type { User } from './types';
import './feedback-records.css';

interface FeedbackLearning { canLearn: boolean; documentId?: string; baseId?: string; status?: string; learnedAt?: string; reason?: string }
interface LearnResult { documentId: string; baseId: string; status: string; alreadyLearned: boolean; updatedAt: string }
interface LearnState { busy?: boolean; error?: string; conflict?: boolean; refreshing?: boolean; expectedUpdatedAt?: string; result?: LearnResult }
interface FeedbackRecord {
  id: string; type: string; question?: string; comment?: string; documentId?: string | null; messageId?: string | null;
  userName?: string; createdByName?: string; createdAt?: string; updatedAt?: string; resolution?: string; status?: string;
  assigneeName?: string; resolvedAt?: string; learning?: FeedbackLearning;
}
const typeNames: Record<string, string> = { incorrect: '答案不准确', missing: '缺少知识', outdated: '资料过期', citation: '引用有误', evaluation: '评测反馈', other: '其他反馈' };
const sourceName = (row: FeedbackRecord) => row.documentId ? '文档反馈' : row.messageId ? '问答反馈' : '知识使用反馈';
const historicalStates: Record<string, string> = { open: '待处理', in_progress: '处理中', resolved: '已解决' };
export function FeedbackRecords({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const baseId = params.get('baseId') || '';
  const resource = useResource<{ feedback: FeedbackRecord[]; scope?: { baseId: string | null; label: string } }>('/feedback' + (baseId ? '?baseId=' + encodeURIComponent(baseId) : ''));
  const scopeName = resource.data?.scope?.label;
  const [learningStates, setLearningStates] = useState<Record<string, LearnState>>({});
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    if (!resource.data) return;
    setLearningStates(previous => {
      const changed = Object.values(previous).some(state => state.refreshing || state.result);
      return changed ? Object.fromEntries(Object.entries(previous).map(([id, state]) => [id, state.refreshing ? {} : state.result ? { ...state, result: undefined } : state])) : previous;
    });
  }, [resource.data]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [conclusion, setConclusion] = useState('all');
  const requestedId = params.get('feedbackId') || '';
  const all = resource.data?.feedback || [];
  const selected = all.find(row => row.id === requestedId);
  const query = search.trim().toLocaleLowerCase();
  const rows = all.filter(row => (type === 'all' || row.type === type) && (conclusion === 'all' || (conclusion === 'yes' ? !!row.resolution?.trim() : !row.resolution?.trim())) && [row.question, row.comment, row.resolution, row.userName, row.createdByName].filter(Boolean).join(' ').toLocaleLowerCase().includes(query));
  async function learn(row: FeedbackRecord, conclusion?: string) {
    if (!row.learning?.canLearn || inFlight.current.has(row.id)) return;
    const expectedUpdatedAt = row.updatedAt || row.createdAt;
    inFlight.current.add(row.id);
    setLearningStates(previous => ({ ...previous, [row.id]: { busy: true, expectedUpdatedAt } }));
    try {
      const result = await api<LearnResult>('/feedback/' + encodeURIComponent(row.id) + '/learn', { method: 'POST', body: JSON.stringify({ expectedUpdatedAt, ...(conclusion?.trim() ? { conclusion: conclusion.trim() } : {}) }) });
      setLearningStates(previous => ({ ...previous, [row.id]: { result, expectedUpdatedAt } }));
      resource.reload();
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      setLearningStates(previous => ({ ...previous, [row.id]: { error: conflict ? '反馈记录已有更新，请刷新记录后重试。' : errorMessage(error), conflict, expectedUpdatedAt } }));
    } finally { inFlight.current.delete(row.id); }
  }
  function refreshLearning(id: string) {
    setLearningStates(previous => ({ ...previous, [id]: { ...previous[id], refreshing: true } }));
    resource.reload();
  }
  function choose(id?: string) { const next = new URLSearchParams(params); id ? next.set('feedbackId', id) : next.delete('feedbackId'); setParams(next); }
  return <div className="e-page e-feedback-records">
    <PageHeader title={user.role === 'viewer' ? '我的反馈' : '反馈记录'} description="查阅知识使用中的反馈内容、来源与已有结论。" actions={<button className="e-btn" onClick={resource.reload}><RefreshCw size={16}/>刷新</button>}/>
    {baseId && <div className="e-feedback-scope"><span><Database size={15}/>{scopeName || '指定知识库'}<small>仅显示关联此知识库文档的反馈</small></span><button className="e-text-link" onClick={() => { const next = new URLSearchParams(params); next.delete('baseId'); setParams(next); }}>查看全部记录</button></div>}
    {resource.error && <Notice kind="error">{resource.error}<button className="e-text-link" onClick={resource.reload}>重新加载</button></Notice>}
    <div className="e-feedback-record-filters"><div className="e-feedback-search"><Search size={17}/><input aria-label="搜索反馈记录" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索反馈内容、提交人或结论"/></div><SelectControl aria-label="反馈类型" value={type} onChange={event => setType(event.target.value)}><option value="all">全部类型</option>{Object.entries(typeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectControl><SelectControl aria-label="反馈结论" value={conclusion} onChange={event => setConclusion(event.target.value)}><option value="all">全部记录</option><option value="yes">已有结论</option><option value="no">暂无结论</option></SelectControl><span>{rows.length} 条记录</span></div>
    {!resource.loading && !resource.error && requestedId && !selected && <Notice kind="warning">未找到指定反馈记录，记录可能不存在或当前无权查看。</Notice>}
    {resource.loading && !resource.data ? <Loading/> : rows.length ? <div className="e-feedback-record-list">{rows.map(row => <article key={row.id} className="e-card e-feedback-record">
      <span className="e-feedback-record-icon"><MessageSquare size={20}/></span>
      <div className="e-feedback-record-main"><div className="e-feedback-record-top"><h2>{row.question || '知识使用反馈'}</h2><span>{typeNames[row.type] || row.type || '其他反馈'}</span></div>
        <p className="e-feedback-record-comment">{row.comment || '未填写补充说明'}</p>
        {row.resolution && <div className="e-feedback-record-resolution"><span>已有结论</span><p>{row.resolution}</p></div>}
        <div className="e-feedback-record-meta"><span>{row.userName || row.createdByName || '提交人未记录'}</span><span>{formatDate(row.createdAt)}</span><span>{sourceName(row)}</span>{row.documentId && <Link to={'/documents/' + encodeURIComponent(row.documentId)}><FileText size={13}/>查看资料</Link>}<button type="button" className="e-text-link" onClick={() => choose(row.id)}>查看记录<ArrowRight size={13}/></button></div>
      </div>
    </article>)}</div> : !resource.error && <div className="e-card"><EmptyState title={query || type !== 'all' || conclusion !== 'all' ? '没有匹配的反馈记录' : '暂无反馈记录'} description={query || type !== 'all' || conclusion !== 'all' ? '调整关键词或筛选条件继续查找。' : '在知识问答中提交的反馈会记录在这里。'}/></div>}
    {selected && <Modal title="反馈详情" onClose={() => choose()} busy={Boolean(learningStates[selected.id]?.busy)} wide>
      <div className="e-feedback-detail">
        <div className="e-feedback-detail-meta"><span>{typeNames[selected.type] || selected.type || '其他反馈'}</span><span>{sourceName(selected)}</span><span>{selected.userName || selected.createdByName || '提交人未记录'} · {formatDate(selected.createdAt)}</span></div>
        <section><h3>相关问题</h3><p>{selected.question || '未记录相关问题'}</p></section>
        <section><h3>反馈内容</h3><p>{selected.comment || '未填写补充说明'}</p></section>
        {selected.documentId && <Link className="e-feedback-source-link" to={'/documents/' + encodeURIComponent(selected.documentId)}><FileText size={16}/>查看关联资料<ArrowRight size={14}/></Link>}
        <section className="e-feedback-detail-conclusion"><h3>已有结论</h3><p>{selected.resolution || '暂未记录补充结论。'}</p>{selected.resolution && (selected.assigneeName || selected.resolvedAt) && <small>{[selected.assigneeName, selected.resolvedAt ? formatDate(selected.resolvedAt) : ''].filter(Boolean).join(' · ')}</small>}</section>
        {selected.status && <p className="e-feedback-history-state">历史记录状态：{historicalStates[selected.status] || selected.status}</p>}
        <FeedbackLearningActions key={selected.id} row={selected} state={learningStates[selected.id]} reloading={resource.loading} onLearn={conclusion => void learn(selected, conclusion)} onRefresh={() => refreshLearning(selected.id)} onClose={() => choose()}/>
      </div>
    </Modal>}
  </div>;
}


function FeedbackLearningActions({ row, state, reloading, onLearn, onRefresh, onClose }: { row: FeedbackRecord; state?: LearnState; reloading: boolean; onLearn: (conclusion?: string) => void; onRefresh: () => void; onClose: () => void }) {
  const [conclusion, setConclusion] = useState('');
  const currentVersion = row.updatedAt || row.createdAt;
  const result = state?.result && (currentVersion === state.expectedUpdatedAt || currentVersion === state.result.updatedAt) ? state.result : undefined;
  const learning = { ...row.learning, ...result };
  const saved = Boolean(learning.documentId);
  const active = saved && learning.status === 'published';
  const stale = saved && learning.status === 'stale';
  const trashed = learning.status === 'trashed';
  const canLearn = row.learning?.canLearn === true;
  const busy = Boolean(state?.busy);
  const canUpdateDraft = saved && !active && (stale || trashed || Boolean(row.resolution?.trim() || conclusion.trim()));
  const disabled = busy || reloading || Boolean(state?.conflict) || Boolean(state?.refreshing) || active || (saved && !canUpdateDraft);
  return <div className="e-feedback-learning">
    <div className={'e-feedback-learning-note' + (saved ? active ? ' learned' : ' draft' : '')} role="status">
      <Sparkles size={16}/>
      <div>
        {saved && <strong>{active ? '已加入机器学习' : trashed ? '学习记录已删除' : stale ? '学习记录待更新' : '已保存学习草稿 · 待补充结论'}</strong>}
        <p>{active ? '默认关联文档问答，按相关性参考已有结论。' : trashed ? learning.reason || '学习记录已移入回收站，当前不会作为问答依据。' : stale ? '反馈或来源已有更新，请重新学习以保持参考内容一致。' : saved ? '待补充并核对结论后再作为问答依据，当前草稿不作为正确知识引用。' : '默认关联文档问答，按相关性参考已有结论。'}</p>
        {!saved && canLearn && !row.resolution?.trim() && !conclusion.trim() && <small>当前没有结论，将保存为待补充的学习草稿。</small>}
        {!canLearn && saved && !trashed && learning.reason && <small>{learning.reason}</small>}
        {!canLearn && !saved && <small>{row.learning?.reason || '当前账号暂无加入机器学习的权限。'}</small>}
        {saved && <div className="e-feedback-learning-links">
          {learning.documentId && !trashed && !stale && <Link to={'/documents/' + encodeURIComponent(learning.documentId)}><FileText size={14}/>查看学习知识<ArrowRight size={12}/></Link>}
          {learning.baseId && <Link to={'/assets/knowledge-bases/' + encodeURIComponent(learning.baseId)}><Database size={14}/>打开学习知识库<ArrowRight size={12}/></Link>}
        </div>}
      </div>
    </div>
    {!row.resolution?.trim() && !active && canLearn && <label className="e-feedback-learning-conclusion"><span>可用于问答的结论 <small>选填</small></span><textarea aria-label="可用于问答的结论" value={conclusion} disabled={busy} onChange={event => setConclusion(event.target.value)} maxLength={4000} rows={3} placeholder="填写正确做法或核对后的结论；留空仅保存待补充记录"/><small>此处结论保存为学习知识，原反馈内容保留。</small></label>}
    {state?.error && <Notice kind="error">{state.error}{state.conflict && <button type="button" className="e-text-link" disabled={Boolean(state.refreshing)} onClick={onRefresh}>{state.refreshing ? '正在刷新…' : '刷新记录'}</button>}</Notice>}
    <div className="e-modal-actions">
      <button type="button" className="e-btn" disabled={busy} onClick={onClose}>关闭</button>
      {(canLearn || saved) && <button type="button" className={'e-btn ' + (active ? 'e-feedback-learning-done' : 'primary')} disabled={disabled || !canLearn} onClick={() => onLearn(conclusion)}>
        {busy ? <Loader2 size={16} className="e-spin"/> : saved && !canUpdateDraft ? <Check size={16}/> : <Sparkles size={16}/>}
        {busy ? '正在加入…' : active ? '已加入机器学习' : stale ? '重新学习' : trashed ? '重新加入机器学习' : saved && !canUpdateDraft ? '已保存学习草稿' : '机器学习'}
      </button>}
    </div>
  </div>;
}
