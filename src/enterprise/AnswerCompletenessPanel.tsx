import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api, errorMessage, formatDate, useResource } from './api';
import { EmptyState, Loading, Notice, PageHeader } from './components';
import { SelectControl } from './SelectControl';
import type { User } from './types';
import './knowledge-extensions.css';

type ChecklistItem = { id: string; label: string; status: string; note?: string };
type Suggestion = { pointId: string; mode: string; kind: string; title: string; content: string; evidenceRefs?: Array<{ title?: string; text?: string; documentId?: string }>; pendingConfirm?: boolean; factual?: boolean };
type Analysis = { id: string; question: string; answer?: string; checklist: ChecklistItem[]; suggestions?: Suggestion[]; demandIds?: string[]; completionMode?: string; updatedAt?: string; runId?: string };
type Observability = { recentRuns?: Array<{ id: string; question?: string; status?: string; answer?: string; citations?: unknown[]; traceId?: string; createdAt?: string }> };

const pointStatus: Record<string, string> = {
  answered: '已回答', partial: '部分回答', missing: '未回答', need_condition: '条件不足', insufficient: '依据不足或冲突',
};

export function AnswerCompletenessPanel({ user, embedded = false }: { user: User; embedded?: boolean }) {
  const runs = useResource<Observability>(user.role === 'admin' ? '/observability' : null);
  const list = useResource<{ items: Analysis[]; config: { defaultMode: string; createDemandOnGap: boolean } }>('/answer-completeness');
  const [runId, setRunId] = useState('');
  const [mode, setMode] = useState('hybrid');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedRun = (runs.data?.recentRuns || []).find(run => run.id === runId);

  async function analyze() {
    if (!selectedRun?.question) { setError('请选择一次问答运行。'); return; }
    setBusy(true); setError('');
    try {
      const result = await api<{ analysis: Analysis }>('/answer-completeness/analyze', {
        method: 'POST',
        body: JSON.stringify({
          question: selectedRun.question,
          answer: selectedRun.answer || '',
          citations: selectedRun.citations || [],
          runId: selectedRun.id,
          traceId: selectedRun.traceId,
        }),
      });
      setAnalysis(result.analysis);
      setMode(list.data?.config?.defaultMode || 'hybrid');
      setNotice('已解析应答内容清单。');
      list.reload();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function complete() {
    if (!analysis) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ analysis: Analysis }>('/answer-completeness/complete', {
        method: 'POST',
        body: JSON.stringify({ id: analysis.id, mode, createDemand: true }),
      });
      setAnalysis(result.analysis);
      setNotice(result.analysis.demandIds?.length ? '已补全并归集未解决缺口到需求池。' : '已生成补全建议。');
      list.reload();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  const body = (
    <>
      <Notice>智能解析可补结构与澄清建议，不能凭空生成企业规定。关联解析补入的事实必须带原文引用；仍缺依据时保留缺口。</Notice>
      {(error || runs.error || list.error) && <Notice kind="error">{error || runs.error || list.error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      <div className="e-toolbar kx-toolbar">
        <SelectControl className="e-input" aria-label="选择问答运行" value={runId} onChange={e => setRunId(e.target.value)}>
          <option value="">选择最近问答运行</option>
          {(runs.data?.recentRuns || []).map(run => <option key={run.id} value={run.id}>{(run.question || run.id).slice(0, 40)}</option>)}
        </SelectControl>
        <SelectControl className="e-input" aria-label="补全方式" value={mode} onChange={e => setMode(e.target.value)}>
          <option value="hybrid">组合：智能识别缺项 + 知识关联补事实</option>
          <option value="smart">智能解析补全（结构/澄清）</option>
          <option value="knowledge">现有知识关联补全</option>
        </SelectControl>
        <button className="e-btn primary" disabled={busy || !runId} onClick={analyze}>解析完整性</button>
        <button className="e-btn" disabled={busy || !analysis} onClick={complete}>执行补全</button>
        <button className="e-btn" onClick={() => { runs.reload(); list.reload(); }}><RefreshCw size={15}/>刷新</button>
      </div>
      {busy && !analysis ? <Loading text="正在解析应答要点…" /> : analysis ? (
        <div className="kx-split">
          <section className="e-card">
            <h3>应答内容清单</h3>
            <p className="e-muted">{analysis.question}</p>
            <div className="kx-checklist">
              {analysis.checklist.map(item => (
                <div key={item.id} className={`kx-check is-${item.status}`}>
                  <strong>{item.label}</strong>
                  <span>{pointStatus[item.status] || item.status}</span>
                  <p>{item.note}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="e-card">
            <h3>补全建议</h3>
            {analysis.suggestions?.length ? analysis.suggestions.map((item, index) => (
              <article key={index} className="kx-suggestion">
                <div className="e-section-heading">
                  <strong>{item.title}</strong>
                  <span className="e-badge">{item.mode === 'smart' ? '智能解析' : '知识关联'}{item.factual ? ' · 事实' : ' · 非事实'}</span>
                </div>
                <p>{item.content}</p>
                {!!item.evidenceRefs?.length && (
                  <div className="kx-evidence">
                    {item.evidenceRefs.map((ref, i) => (
                      <div key={i}>
                        {ref.documentId ? <Link to={`/documents/${ref.documentId}`}>{ref.title || '原文依据'}</Link> : <span>{ref.title}</span>}
                        <p className="e-muted">{ref.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            )) : <EmptyState title="尚未生成补全建议" description="先解析清单，再选择补全方式执行。" />}
            {!!analysis.demandIds?.length && (
              <Notice>
                已关联需求：{analysis.demandIds.map(id => (
                  <Link key={id} className="e-text-link" to={`/assets/demand-pool?q=${encodeURIComponent(analysis.question)}`}>{id}</Link>
                ))}
              </Notice>
            )}
          </section>
        </div>
      ) : (
        <EmptyState title="从运行记录开始完整性检查" description="选择一次问答，拆解审批主体、材料、时限等应答要点并补全缺口。" />
      )}
      {!!list.data?.items?.length && (
        <section className="e-card">
          <h3>最近分析</h3>
          <div className="kx-list">
            {list.data.items.slice(0, 8).map(item => (
              <button key={item.id} className={analysis?.id === item.id ? 'active' : ''} onClick={() => setAnalysis(item)}>
                <strong>{item.question}</strong>
                <span>{item.completionMode || '仅解析'} · {formatDate(item.updatedAt)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );

  if (embedded) return <div className="kx-panel">{body}</div>;
  return <div className="e-page"><PageHeader title="问题解析与答复完整性补全" description="拆解应答要点并按配置补全，无依据不填造企业事实。" />{body}</div>;
}
