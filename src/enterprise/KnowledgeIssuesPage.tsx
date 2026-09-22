import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, RefreshCw, ScanSearch } from 'lucide-react';
import { BusinessContext } from './BusinessContext';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import { locatorText, type EvidenceLocator } from './EvidenceReview';
import { sourceKindNames } from './KnowledgeGovernance';
import type { KnowledgeBase, SourceKind, User } from './types';
import { SelectControl } from './SelectControl';
import './knowledge-issues.css';

type Similarity = { lexical?: number; semantic?: number | null; scoreMeaning?: string };
interface EvidenceRef {
  documentId: string;
  title: string;
  documentVersion: number;
  blockId: string;
  text: string;
  locator: EvidenceLocator;
  sourceKind?: SourceKind;
  applicability?: string;
  effectiveAt?: string;
  expiresAt?: string;
}
interface KnowledgeIssue {
  id: string;
  type: string;
  status: string;
  decisionRevision: number;
  candidateReason: string;
  evidenceRefs: EvidenceRef[];
  resolution?: string;
  decision?: string;
  similarity?: Similarity | number;
  criticalDifferences?: { numbers?: boolean; negation?: boolean; sourceKind?: boolean };
  stale?: boolean;
  canManage: boolean;
  actions: string[];
  updatedAt?: string;
}

const types: Record<string, string> = { near_duplicate: '近似内容', conflict: '疑似条款冲突', conditions_missing: '适用条件待核' };
const states: Record<string, string> = {
  open: '待处理', in_review: '核验中', resolved: '已处理', dismissed: '已排除', stale: '待重新检查',
  queued: '等待检查', running: '正在检查', completed: '检查完成', succeeded: '检查完成', interrupted: '检查中断', failed: '检查失败',
};
const decisions: Record<string, string> = {
  equivalent: '内容等价', different_scope: '适用范围不同', related: '有关联但不等价',
  confirmed_conflict: '确认存在冲突', extraction_error: '抽取结果有误', false_positive: '检测误报',
};

function similarityView(value?: Similarity | number) {
  if (value == null) return null;
  if (typeof value === 'number') return { lexical: value, semantic: null as number | null };
  return value;
}

function percent(score?: number | null) {
  if (score == null || Number.isNaN(score)) return null;
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}

function hasCritical(issue: KnowledgeIssue) {
  return Boolean(issue.criticalDifferences && Object.values(issue.criticalDifferences).some(Boolean));
}

export function KnowledgeIssuesPage({ user }: { user: User }) {
  const bases = useResource<{ bases: KnowledgeBase[] }>('/bases');
  const [params, setParams] = useSearchParams();
  const baseId = params.get('baseId') || '';
  const status = params.get('status') || '';
  const requestedIssue = params.get('issueId') || '';
  const r = useResource<{ issues: KnowledgeIssue[]; stats: Record<string, number> }>(`/knowledge-issues?${new URLSearchParams({ baseId, status })}`);
  const [runId, setRunId] = useState('');
  const run = useResource<{ run: { id: string; status: string; error?: string | { message?: string; code?: string }; progress?: number; summary?: unknown; result?: unknown } }>(runId ? `/knowledge-checks/runs/${runId}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<{ issue: KnowledgeIssue; action: string } | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState<KnowledgeIssue | null>(null);

  useEffect(() => {
    if (!runId || !['queued', 'running', 'processing'].includes(run.data?.run.status || 'queued')) return;
    const timer = setInterval(run.reload, 1800);
    return () => clearInterval(timer);
  }, [runId, run.data?.run.status, run.reload]);
  useEffect(() => {
    if (run.data && !['queued', 'running', 'processing'].includes(run.data.run.status)) r.reload();
  }, [run.data?.run.status]);
  useEffect(() => {
    if (!requestedIssue || !r.data?.issues.some(issue => issue.id === requestedIssue)) return;
    const frame = requestAnimationFrame(() => document.getElementById('knowledge-issue-' + requestedIssue)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return () => cancelAnimationFrame(frame);
  }, [requestedIssue, r.data]);
  useEffect(() => setSelected(null), [baseId, status]);

  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete('issueId');
    setSelected(null);
    setParams(next);
  }

  async function check() {
    setBusy(true); setError('');
    try {
      const result = await api<{ run: { id: string } }>('/knowledge-checks/runs', { method: 'POST', body: JSON.stringify({ baseId: baseId || undefined, clientRequestId: crypto.randomUUID() }) });
      setRunId(result.run.id);
      setNotice('已创建内容检查任务，候选结果需对照原文核验。');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="e-page">
      <PageHeader
        title="内容去重与冲突核验"
        description="对照原文处理近似内容与条件差异，算法候选不等同于正式业务结论。"
        actions={<>
          <button className="e-btn" onClick={r.reload}><RefreshCw size={15}/>刷新</button>
          {user.role !== 'viewer' && <button className="e-btn primary" disabled={busy || ['queued', 'running', 'processing'].includes(run.data?.run.status || '')} onClick={check}><ScanSearch size={16}/>检查当前知识</button>}
        </>}
      />
      <BusinessContext scope={{ baseId }} baseName={bases.data?.bases.find(base => base.id === baseId)?.name} onClear={() => filter('baseId', '')} />
      <Notice>不会自动合并、下架或裁决制度效力。确认重复后，知识文档中会显示「多处应用」；任一侧原件更新后需重新核验。</Notice>
      <div className="e-card e-grid two">
        <label className="e-field">知识范围
          <SelectControl value={baseId} onChange={e => filter('baseId', e.target.value)}>
            <option value="">全部可访问知识库</option>
            {bases.data?.bases.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </SelectControl>
        </label>
        <label className="e-field">办理状态
          <SelectControl value={status} onChange={e => filter('status', e.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(states).slice(0, 5).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </SelectControl>
        </label>
      </div>
      {!r.loading && requestedIssue && !r.data?.issues.some(issue => issue.id === requestedIssue) && (
        <Notice kind="warning">指定候选事项未在当前知识范围和状态中找到，可能已处理、来源变化或当前用户无权查看。请调整筛选或返回治理工作台核对。</Notice>
      )}
      {(error || r.error || run.error || bases.error) && <Notice kind="error">{error || r.error || run.error || bases.error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      {run.data && (
        <Notice kind={run.data.run.status === 'failed' ? 'error' : 'info'}>
          本次检查：{states[run.data.run.status] || run.data.run.status}
          {run.data.run.error ? ' · ' + (typeof run.data.run.error === 'string' ? run.data.run.error : run.data.run.error.message || run.data.run.error.code) : ''}
          {(run.data.run.summary != null || run.data.run.result != null) && (
            <details><summary>检查范围与结果</summary><pre className="e-code-output">{JSON.stringify(run.data.run.summary || run.data.run.result, null, 2)}</pre></details>
          )}
        </Notice>
      )}
      {r.loading && !r.data ? <Loading /> : r.data?.issues.length ? r.data.issues.map(issue => {
        const sim = similarityView(issue.similarity);
        const lexicalPct = percent(sim?.lexical);
        const semanticPct = percent(sim?.semantic);
        const canConfirm = issue.type === 'near_duplicate' && issue.canManage && issue.actions.includes('resolve') && !issue.stale && !hasCritical(issue);
        const confirmed = issue.type === 'near_duplicate' && issue.status === 'resolved' && issue.decision === 'equivalent';
        return (
          <section
            className="e-card e-stack ki-issue"
            key={issue.id}
            id={'knowledge-issue-' + issue.id}
            style={{ scrollMarginTop: 90, ...(requestedIssue === issue.id ? { borderColor: '#25a3bc', boxShadow: '0 0 0 2px #25a3bc20' } : {}) }}
          >
            {requestedIssue === issue.id && <Notice>已定位从治理待办进入的候选事项，请核对下方两侧原文与处理记录。</Notice>}
            <div className="e-section-heading">
              <h2>{types[issue.type] || issue.type}</h2>
              <span className={`e-badge ${issue.stale ? 'review' : issue.status === 'resolved' ? 'published' : 'review'}`}>{states[issue.status] || issue.status}</span>
              {confirmed && <span className="ki-app-badge">已确认多处应用</span>}
            </div>
            <p>{issue.candidateReason}</p>
            {issue.type === 'near_duplicate' && (lexicalPct || semanticPct) && (
              <div className="ki-similarity" aria-label="重复比例">
                <div className="ki-similarity-head">
                  <strong>重复比例</strong>
                  <span>仅作候选排序，不代表正式业务判定</span>
                </div>
                <div className="ki-similarity-meters">
                  {lexicalPct && (
                    <div>
                      <div className="ki-meter-label"><span>文本相近</span><em>{lexicalPct}</em></div>
                      <div className="ki-meter"><i style={{ width: lexicalPct }}/></div>
                    </div>
                  )}
                  <div>
                    <div className="ki-meter-label"><span>向量相近</span><em>{semanticPct || '未计算'}</em></div>
                    <div className="ki-meter">{semanticPct ? <i style={{ width: semanticPct }}/> : null}</div>
                  </div>
                </div>
              </div>
            )}
            {hasCritical(issue) && (
              <Notice kind="warning">
                需重点核对：{[issue.criticalDifferences?.numbers && '数字或编号差异', issue.criticalDifferences?.negation && '否定条件差异', issue.criticalDifferences?.sourceKind && '资料来源类别差异'].filter(Boolean).join('、')}。
                未完成原文核验不能认定内容等价。
              </Notice>
            )}
            {issue.stale && <Notice kind="warning">依据已发生变化，原处理结论暂不可沿用，请重新检查。</Notice>}
            <div className="e-evidence-comparison">
              {issue.evidenceRefs.map((ref, i) => (
                <article key={`${ref.blockId}-${i}`}>
                  <div className="e-section-heading">
                    <Link to={`/documents/${ref.documentId}?chunk=${encodeURIComponent(ref.blockId)}${ref.locator?.page ? `&page=${ref.locator.page}` : ''}`}>{ref.title}</Link>
                    <span className="e-version">V{ref.documentVersion}</span>
                  </div>
                  <small className="e-muted">{locatorText(ref.locator)}</small>
                  {ref.sourceKind && <p><span className="e-badge">{sourceKindNames[ref.sourceKind]}</span></p>}
                  {ref.applicability && <p className="e-muted">适用范围：{ref.applicability}</p>}
                  {(ref.effectiveAt || ref.expiresAt) && <p className="e-muted">生效 {ref.effectiveAt?.slice(0, 10) || '发布后'} · 失效 {ref.expiresAt?.slice(0, 10) || '未设置'}</p>}
                  <p className="e-evidence-text">{ref.text}</p>
                  <Link className="e-text-link ki-doc-link" to={`/assets/documents?q=${encodeURIComponent(ref.title)}`}>在知识文档中定位<ArrowRight size={13}/></Link>
                </article>
              ))}
            </div>
            {issue.resolution && (
              <Notice>
                <strong>{decisions[issue.decision || ''] || '办理记录'}</strong>
                <p>{issue.resolution}</p>
                {confirmed && (
                  <div className="ki-confirmed-links">
                    {issue.evidenceRefs.map(ref => (
                      <Link key={ref.documentId} className="e-btn" to={`/documents/${ref.documentId}?tab=metadata`}>查看《{ref.title}》多处应用<ArrowRight size={14}/></Link>
                    ))}
                  </div>
                )}
              </Notice>
            )}
            <div className="e-actions e-wrap">
              {canConfirm && <button className="e-btn primary" onClick={() => setConfirmDuplicate(issue)}>确认重复</button>}
              {issue.canManage && issue.actions.map(action => (
                <button className="e-btn" key={action} onClick={() => setSelected({ issue, action })}>
                  {({ start: '开始核验', resolve: '记录处理决定', dismiss: '排除候选', reopen: '重新检查' } as Record<string, string>)[action] || action}
                </button>
              ))}
              <span className="e-muted">{formatDate(issue.updatedAt)}</span>
            </div>
          </section>
        );
      }) : (
        <section className="e-card"><EmptyState title="当前没有需要展示的候选问题" description="可运行内容检查发现待核验线索；没有候选不代表所有资料已完成业务审定。"/></section>
      )}
      {selected && (
        <IssueAction
          item={selected}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); r.reload(); setNotice('处理决定已保存，可在文档操作记录与审计中追溯。'); }}
        />
      )}
      {confirmDuplicate && (
        <ConfirmDuplicateModal
          issue={confirmDuplicate}
          onClose={() => setConfirmDuplicate(null)}
          onSaved={(issue) => {
            setConfirmDuplicate(null);
            r.reload();
            const titles = issue.evidenceRefs.map(ref => ref.title).join('、');
            setNotice(`已确认内容等价：${titles}。知识文档中将显示「多处应用」。`);
          }}
        />
      )}
    </div>
  );
}

function IssueAction({ item, onClose, onSaved }: { item: { issue: KnowledgeIssue; action: string }; onClose: () => void; onSaved: () => void }) {
  const [resolution, setResolution] = useState('');
  const [decision, setDecision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await api(`/knowledge-issues/${item.issue.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          decisionRevision: item.issue.decisionRevision,
          action: decision === 'confirmed_conflict' ? 'start' : item.action,
          resolution,
          decision: decision || undefined,
        }),
      });
      onSaved();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="记录核验与处理依据" onClose={onClose} busy={busy}>
      <form className="e-stack" onSubmit={submit}>
        {error && <Notice kind="error">{error}</Notice>}
        <Notice>本操作记录核验结论；资料修订和审核发布仍通过原有文档流程完成。不能仅因相似度高就合并知识。</Notice>
        {['resolve', 'dismiss'].includes(item.action) && (
          <label className="e-field">处理分类
            <SelectControl value={decision} required onChange={e => setDecision(e.target.value)}>
              <option value="">请选择对照后的结论</option>
              {Object.entries(decisions)
                .filter(([value]) => item.action !== 'dismiss' || ['false_positive', 'extraction_error', 'different_scope', 'related'].includes(value))
                .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </SelectControl>
          </label>
        )}
        {decision === 'equivalent' && item.issue.type === 'near_duplicate' && <EquivalentImpactNotice issue={item.issue} />}
        {decision === 'confirmed_conflict' && <Notice kind="warning">确认存在冲突后保持核验中，需完成资料修订与后续复核，不会自动关闭问题。</Notice>}
        <label className="e-field">处理依据
          <textarea rows={5} required minLength={3} maxLength={2000} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="说明适用条件、两侧来源与版本，以及需要修订或排除的具体原因。"/>
        </label>
        <div className="e-modal-actions">
          <button className="e-btn" type="button" disabled={busy} onClick={onClose}>取消</button>
          <button className="e-btn primary" disabled={busy}>{busy ? '正在保存…' : '保存处理记录'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDuplicateModal({ issue, onClose, onSaved }: { issue: KnowledgeIssue; onClose: () => void; onSaved: (issue: KnowledgeIssue) => void }) {
  const [resolution, setResolution] = useState('对照原文后确认内容等价，作为同一知识的多处应用。');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sim = similarityView(issue.similarity);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/knowledge-issues/${issue.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({
          decisionRevision: issue.decisionRevision,
          action: 'resolve',
          decision: 'equivalent',
          resolution: resolution.trim(),
        }),
      });
      onSaved(issue);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="确认重复并登记多处应用" onClose={onClose} busy={busy} wide>
      <form className="e-stack" onSubmit={submit}>
        {error && <Notice kind="error">{error}</Notice>}
        <EquivalentImpactNotice issue={issue} />
        <div className="ki-confirm-score">
          <span>文本相近 {percent(sim?.lexical) || '—'}</span>
          <span>向量相近 {percent(sim?.semantic) || '未计算'}</span>
        </div>
        <div className="ki-confirm-docs">
          {issue.evidenceRefs.map(ref => (
            <Link key={ref.documentId} className="ki-confirm-doc" to={`/documents/${ref.documentId}?tab=metadata`}>
              <strong>{ref.title}</strong>
              <span>V{ref.documentVersion} · 打开知识文档</span>
              <ArrowRight size={14}/>
            </Link>
          ))}
        </div>
        <label className="e-field">确认依据
          <textarea rows={4} required minLength={3} maxLength={2000} value={resolution} onChange={e => setResolution(e.target.value)} />
        </label>
        <div className="e-modal-actions">
          <button type="button" className="e-btn" disabled={busy} onClick={onClose}>取消</button>
          <button className="e-btn primary" disabled={busy}>{busy ? '正在确认…' : '确认重复'}</button>
        </div>
      </form>
    </Modal>
  );
}

function EquivalentImpactNotice({ issue }: { issue: KnowledgeIssue }) {
  return (
    <Notice kind="warning">
      <strong>确认重复后的影响</strong>
      <ul className="ki-impact-list">
        <li>两侧资料仍各自保留原件与版本，不会自动合并为一个文件。</li>
        <li>在「知识文档」中会显示<strong>多处应用</strong>，标明同一知识在多处登记使用。</li>
        <li>检索与推荐按内容等价组折叠展示，减少重复条目；问答仍可回查各处原文。</li>
        <li>任一侧资料更新后，等价关系会失效并提示重新核验，避免沿用过期对应关系。</li>
      </ul>
      <div className="ki-impact-links">
        {issue.evidenceRefs.map(ref => (
          <Link key={ref.documentId} className="e-text-link" to={`/documents/${ref.documentId}`}>前往《{ref.title}》<ArrowRight size={12}/></Link>
        ))}
        <Link className="e-text-link" to="/assets/documents">打开知识文档模块<ArrowRight size={12}/></Link>
      </div>
    </Notice>
  );
}
