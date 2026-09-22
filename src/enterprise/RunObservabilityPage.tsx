import { useSearchParams } from 'react-router-dom';
import { Activity, ArrowDown, CheckCircle2, CircleAlert, CircleDashed, MessageSquareText, RefreshCw, Sparkles, Workflow } from 'lucide-react';
import { formatDate, useResource } from './api';
import { EmptyState, Loading, Modal, Notice, PageHeader } from './components';
import { runLabels } from './UpgradeTypes';
import type { User } from './types';
import { AnswerCompletenessPanel } from './AnswerCompletenessPanel';
import './run-trace-flow.css';

interface Observability {
  metrics: Record<string, number>;
  modelUsage: {
    calls: number; knownCalls: number; unknownCalls: number; inputTokens: number; outputTokens: number;
    byFeature: Array<{ feature: string; calls: number; knownCalls: number; unknownCalls: number; inputTokens: number; outputTokens: number }>;
  };
  recentRuns: Array<{ id: string; traceId: string; question?: string; answer?: string; citations?: unknown[]; status: string; createdAt: string; updatedAt?: string; durationMs?: number }>;
  errors: Array<{ id?: string; message?: string; error?: string; traceId?: string; createdAt?: string; code?: string; count?: number }>;
}

interface FlowItem {
  id: string;
  title: string;
  summary?: string;
  status?: string;
  durationMs?: number;
  name?: string;
}

interface FlowEnrichment {
  id: string;
  title: string;
  before?: string;
  after?: string;
  summary?: string;
  value?: string;
}

interface FlowStage {
  id: string;
  kind: string;
  title: string;
  summary: string;
  detail?: string;
  status: string;
  meta?: string[];
  enrichments?: FlowEnrichment[];
  items?: FlowItem[];
  modelCalls?: FlowItem[];
}

interface TraceFlow {
  title: string;
  status: string;
  statusLabel: string;
  durationMs?: number;
  startedAt?: string;
  finishedAt?: string;
  runId?: string | null;
  traceId: string;
  stages: FlowStage[];
}

interface TraceDetail {
  trace: Record<string, unknown>;
  spans: unknown[];
  calls: unknown[];
  flow?: TraceFlow;
}

function stageIcon(kind: string, status: string) {
  if (status === 'error') return <CircleAlert size={18} aria-hidden="true" />;
  if (status === 'active') return <CircleDashed size={18} aria-hidden="true" />;
  if (kind === 'input') return <MessageSquareText size={18} aria-hidden="true" />;
  if (kind === 'output') return <Sparkles size={18} aria-hidden="true" />;
  if (kind === 'process') return <Workflow size={18} aria-hidden="true" />;
  return <CheckCircle2 size={18} aria-hidden="true" />;
}

function TraceFlowView({ flow }: { flow: TraceFlow }) {
  return (
    <div className="rt-flow" aria-label="处理流程记录">
      <header className="rt-flow-head">
        <div>
          <p className="rt-flow-kicker">可读处理过程</p>
          <h3>{flow.title}</h3>
        </div>
        <div className="rt-flow-badges">
          <span className={`rt-pill is-${flow.status === 'succeeded' || flow.status === 'completed' ? 'done' : ['failed', 'cancelled', 'interrupted'].includes(flow.status) ? 'error' : 'active'}`}>{flow.statusLabel}</span>
          {Number.isFinite(flow.durationMs) && <span className="rt-pill">总耗时 {flow.durationMs} ms</span>}
          {flow.startedAt && <span className="rt-pill">{formatDate(flow.startedAt)}</span>}
        </div>
      </header>
      <ol className="rt-stages">
        {flow.stages.map((stage, index) => (
          <li key={stage.id} className={`rt-stage is-${stage.status}`}>
            <div className="rt-stage-rail" aria-hidden="true">
              <span className="rt-stage-dot">{stageIcon(stage.kind, stage.status)}</span>
              {index < flow.stages.length - 1 && <span className="rt-stage-line"><ArrowDown size={14} /></span>}
            </div>
            <article className="rt-stage-card">
              <div className="rt-stage-title">
                <strong>{stage.title}</strong>
                <span className="rt-stage-kind">{({ input: '输入', platform: '补全', process: '流程', output: '输出' } as Record<string, string>)[stage.kind] || stage.kind}</span>
              </div>
              <p className="rt-stage-summary">{stage.summary}</p>
              {stage.detail && <p className="rt-stage-detail">{stage.detail}</p>}
              {!!stage.meta?.length && <ul className="rt-stage-meta">{stage.meta.map(item => <li key={item}>{item}</li>)}</ul>}
              {!!stage.enrichments?.length && (
                <div className="rt-enrich">
                  <h4>用户信息补全（平台价值）</h4>
                  <ol>
                    {stage.enrichments.map(item => (
                      <li key={item.id}>
                        <div className="rt-enrich-head">
                          <strong>{item.title}</strong>
                          {item.value && <span className="rt-enrich-value">{item.value}</span>}
                        </div>
                        {(item.before || item.after) && (
                          <div className="rt-enrich-diff" aria-label="补全前后对比">
                            {item.before && <p><span>原始侧</span>{item.before}</p>}
                            {item.after && <p><span>平台补全后</span>{item.after}</p>}
                          </div>
                        )}
                        {item.summary && <p className="rt-enrich-summary">{item.summary}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {!!stage.items?.length && (
                <div className="rt-substeps">
                  <h4>业务处理步骤</h4>
                  <ol>
                    {stage.items.map(item => (
                      <li key={item.id} className={`is-${item.status || 'done'}`}>
                        <strong>{item.title}</strong>
                        <span>{item.summary}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {!!stage.modelCalls?.length && (
                <div className="rt-substeps rt-model-calls">
                  <h4>模型调用（平台默默完成）</h4>
                  <ol>
                    {stage.modelCalls.map(item => (
                      <li key={item.id} className={`is-${item.status || 'done'}`}>
                        <strong>{item.title}</strong>
                        <span>{item.summary}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </article>
          </li>
        ))}
      </ol>
      <p className="rt-flow-note">以上按“用户输入 → 平台受理 → 处理流程 → 最终输出”整理；技术编号仅供排障时对照。</p>
      <details className="rt-tech">
        <summary>技术对照（追踪编号）</summary>
        <p>追踪编号：{flow.traceId}{flow.runId ? ` · 运行编号：${flow.runId}` : ''}</p>
      </details>
    </div>
  );
}

export function RunObservabilityPage({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'completeness' ? 'completeness' : 'traces';
  const r = useResource<Observability>(user.role === 'admin' ? '/observability' : null);
  const traceId = params.get('trace') || '';
  const trace = useResource<TraceDetail>(traceId ? `/observability/traces/${encodeURIComponent(traceId)}` : null);
  if (user.role !== 'admin') return <Notice>运行追踪与模型用量由管理员查看。</Notice>;
  const metrics = r.data?.metrics;

  function choose(next: string) {
    const values = new URLSearchParams(params);
    if (next === 'traces') values.delete('tab');
    else values.set('tab', next);
    if (next !== 'traces') values.delete('trace');
    setParams(values);
  }

  function openTrace(id: string) {
    const values = new URLSearchParams(params);
    values.delete('tab');
    values.set('trace', id);
    setParams(values);
  }

  return (
    <div className="e-page">
      <PageHeader
        title="运行追踪与完整性补全"
        description="定位问答运行步骤与用量，并对答复做应答要点完整性检查与补全。"
        actions={<button className="e-btn" onClick={() => { r.reload(); trace.reload(); }}><RefreshCw size={16}/>刷新</button>}
      />
      <div className="e-filter-tabs" aria-label="追踪与补全">
        <button type="button" className={tab === 'traces' ? 'active' : ''} onClick={() => choose('traces')}>运行追踪与用量</button>
        <button type="button" className={tab === 'completeness' ? 'active' : ''} onClick={() => choose('completeness')}>问题解析与答复完整性</button>
      </div>
      {tab === 'completeness' ? <AnswerCompletenessPanel user={user} embedded /> : (
        <>
          {r.error && <Notice kind="error">{r.error}</Notice>}
          {r.loading && !r.data ? <Loading /> : r.data && (
            <>
              <div className="e-stats-grid">
                {[{ label: '运行记录', value: metrics?.runsTotal }, { label: '已完成', value: metrics?.succeeded }, { label: '失败 / 中断', value: (metrics?.failed || 0) + (metrics?.interrupted || 0) }, { label: '响应时长 P95', value: metrics?.p95LatencyMs, unit: 'ms' }].map(row => (
                  <div className="e-stat-card" key={row.label}><div><span>{row.label}</span><strong>{row.value ?? '—'}{row.unit && <small> {row.unit}</small>}</strong></div><Activity size={19}/></div>
                ))}
              </div>
              <section className="e-card e-stack">
                <div className="e-section-heading"><h2>模型实际用量</h2><span className="e-muted">Token 为服务返回的实际记录，不等于结算账单</span></div>
                <div className="e-grid three">
                  <div>模型调用 <strong>{r.data.modelUsage.calls}</strong> 次</div>
                  <div>已知用量 <strong>{r.data.modelUsage.knownCalls}</strong> 次</div>
                  <div>用量未知 <strong>{r.data.modelUsage.unknownCalls}</strong> 次</div>
                </div>
                {r.data.modelUsage.unknownCalls > 0 && <Notice kind="warning">部分调用未返回完整用量。下方 Token 合计仅覆盖已知用量，不能推断未知调用免费。</Notice>}
                <div className="e-table-scroll">
                  <table>
                    <thead><tr><th>用途</th><th>调用次数</th><th>输入 Token</th><th>输出 Token</th><th>未知用量次数</th></tr></thead>
                    <tbody>
                      {r.data.modelUsage.byFeature.map(row => (
                        <tr key={row.feature}>
                          <td>{({ chat: '知识问答', evaluation: '质量评测', scenario_evaluation: '场景评测', rewrite: '上下文整理', query_embedding: '查询向量生成', chat_run: '知识问答', query_rewrite: '理解追问', prompt_evaluation: '业务场景评测', tool_planning: '选择查询工具' } as Record<string, string>)[row.feature] || row.feature}</td>
                          <td>{row.calls}</td><td>{row.inputTokens}</td><td>{row.outputTokens}</td><td>{row.unknownCalls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {metrics?.droppedTelemetry ? <Notice kind="warning">有 {metrics.droppedTelemetry} 条观测事件未成功记录，请检查存储和运行日志。</Notice> : null}
              </section>
              <section className="e-card">
                <h2>最近运行</h2>
                {r.data.recentRuns.length ? (
                  <div className="e-table-scroll">
                    <table>
                      <thead><tr><th>运行记录</th><th>状态</th><th>开始时间</th><th>追踪</th><th>完整性</th></tr></thead>
                      <tbody>
                        {r.data.recentRuns.map(row => (
                          <tr key={row.id}>
                            <td><span title={row.id}>{row.question || (row.id.length > 16 ? row.id.slice(0, 16) + '…' : row.id)}</span></td>
                            <td>{runLabels[row.status] || row.status}</td>
                            <td>{formatDate(row.createdAt)}</td>
                            <td>{row.traceId ? <button type="button" className="e-text-link" onClick={() => openTrace(row.traceId)}>查看处理步骤</button> : <span className="e-muted">尚未开始执行</span>}</td>
                            <td><button type="button" className="e-text-link" onClick={() => setParams({ tab: 'completeness' })}>完整性补全</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState title="尚无新的运行追踪记录" description="执行新的问答或工具任务后，真实运行会出现在这里。" />}
              </section>
              <section className="e-card">
                <h2>异常记录</h2>
                {r.data.errors.length ? r.data.errors.map((row, i) => (
                  <div className="e-scenario-case" key={row.id || i}>
                    <p>{row.message || row.error || row.code || '处理异常'}{row.count !== undefined ? ' · ' + row.count + ' 次' : ''}</p>
                    <span className="e-muted">{formatDate(row.createdAt)}</span>
                    {row.traceId && <button type="button" className="e-text-link" onClick={() => openTrace(row.traceId!)}>查看处理过程</button>}
                  </div>
                )) : <p className="e-muted">当前记录中没有异常。</p>}
              </section>
            </>
          )}
          {traceId && (
            <Modal title="处理过程记录" wide onClose={() => { const values = new URLSearchParams(params); values.delete('trace'); setParams(values); }}>
              {trace.error && <Notice kind="error">{trace.error}</Notice>}
              {trace.loading ? <Loading text="正在整理处理过程…" /> : trace.data?.flow ? (
                <TraceFlowView flow={trace.data.flow} />
              ) : trace.data ? (
                <div className="e-stack">
                  <Notice kind="warning">未能生成可读流程，以下为原始追踪数据。</Notice>
                  <DataValue value={trace.data.trace} />
                  <h3>处理步骤</h3>
                  {trace.data.spans.map((span, i) => <DataValue key={i} value={span} />)}
                  <h3>模型调用与用量</h3>
                  {trace.data.calls.map((call, i) => <DataValue key={i} value={call} />)}
                </div>
              ) : null}
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

export function DataValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="e-muted">未提供</span>;
  if (typeof value !== 'object') return <span className="e-data-value">{String(value)}</span>;
  if (Array.isArray(value)) return <div className="e-data-array">{value.map((item, i) => <div key={i}><DataValue value={item} /></div>)}</div>;
  return (
    <dl className="e-data-object">
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt>{({ operation: '操作类型', runId: '运行编号', actorKind: '执行主体类型', actorId: '执行主体编号', finishedAt: '结束时间', spanId: '步骤编号', parentSpanId: '上级步骤编号', stepId: '步骤编号', conversationId: '会话编号', versionId: '版本编号', errorCode: '异常代码', usageStatus: '用量状态', provider: '服务提供方', requestId: '请求编号', status: '状态', message: '说明', error: '失败原因', name: '名称', label: '步骤', question: '问题', answer: '答复', total: '总数', passed: '通过', durationMs: '耗时（ms）', inputTokens: '输入 Token', outputTokens: '输出 Token', usageKnown: '用量是否已知', createdAt: '创建时间', startedAt: '开始时间', completedAt: '结束时间', attempt: '尝试次数', reason: '依据', coverage: '数据覆盖', traceId: '追踪编号', id: '记录编号', model: '模型', feature: '用途', result: '结果', results: '逐项结果', expectedTerms: '必要要点', missingTerms: '未覆盖要点' } as Record<string, string>)[key] || key}</dt>
          <dd><DataValue value={item} /></dd>
        </div>
      ))}
    </dl>
  );
}
