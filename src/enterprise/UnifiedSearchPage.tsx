import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Boxes, FileText, MessageSquare, Network, RefreshCw, Search, Sparkles } from 'lucide-react';
import { api, errorMessage, useResource } from './api';
import { PageHeader, Notice, Loading, EmptyState } from './components';
import { SelectControl } from './SelectControl';
import type { KnowledgeBase, User } from './types';
import './unified-search.css';

type Channel = { id: string; label: string; score: number; selected: boolean; reasons: string[] };
type DocItem = { documentId: string; title: string; version: number; baseId: string; page?: number; excerpt: string; matchReason?: string; reasons?: string[]; route: string; sourceKind?: string };
type UnifiedResult = {
  query: string;
  strategy: { summary: string; primary: string; selectedChannels: string[] };
  intent: { channels: Channel[]; matchedScenarios: Array<{ id: string; label: string; tasks: string[]; hits: string[] }> };
  documents: { items: DocItem[]; strategy?: string; emptyReason?: string | null };
  scenarios: { matched: Array<{ id: string; label: string; tasks: string[]; hits: string[] }>; items: DocItem[]; emptyReason?: string | null };
  graph: { entities: Array<{ id: string; name: string; type: string; externalId?: string; route: string }>; paths: Array<{ id: string; label: string; hops: number; nodeNames: string[] }>; evidence: DocItem[]; emptyReason?: string | null } | null;
  routes: Record<string, string>;
  nextActions: Array<{ id: string; label: string; route: string }>;
};

const channelIcon: Record<string, typeof Search> = {
  documents: BookOpen,
  scenarios: Boxes,
  graph: Network,
  chat: MessageSquare,
};

export function UnifiedSearchPage({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const bases = useResource<{ bases: KnowledgeBase[] }>('/bases');
  const spec = useResource<Record<string, unknown>>('/unified-search/spec');
  const [query, setQuery] = useState(params.get('q') || '');
  const [baseId, setBaseId] = useState(params.get('baseId') || '');
  const [result, setResult] = useState<UnifiedResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [docsOpen, setDocsOpen] = useState(false);

  async function run(nextQuery = query, nextBase = baseId) {
    const q = nextQuery.trim();
    if (!q) { setError('请输入要查找的内容。'); return; }
    setBusy(true); setError('');
    const search = new URLSearchParams({ q });
    if (nextBase) search.set('baseId', nextBase);
    setParams(search, { replace: true });
    try {
      const data = await api<UnifiedResult>('/unified-search?' + search.toString());
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const q = params.get('q');
    if (q) void run(q, params.get('baseId') || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    void run();
  }

  return (
    <div className="e-page us-page">
      <PageHeader
        title="综合查找"
        description="输入业务问题后，系统会分析意图并组合业务场景、文档搜索与知识图谱结果。"
        actions={<button className="e-btn" onClick={() => setDocsOpen(value => !value)}><BookOpen size={15}/>{docsOpen ? '收起接口说明' : '接口说明'}</button>}
      />

      <section className="e-card us-query">
        <form onSubmit={submit} className="us-query-form">
          <label className="e-field us-query-field" htmlFor="unified-search-q">查找内容</label>
          <div className="us-query-row">
            <span className="us-query-icon" aria-hidden="true"><Search size={18}/></span>
            <input id="unified-search-q" value={query} onChange={e => setQuery(e.target.value)} placeholder="例如：设备台账与维修工单有什么关联？交接班需要哪些资料？" disabled={busy} />
            <SelectControl className="e-input us-base" aria-label="知识库范围" value={baseId} onChange={e => setBaseId(e.target.value)} disabled={busy}>
              <option value="">全部可访问知识库</option>
              {(bases.data?.bases || []).map(base => <option key={base.id} value={base.id}>{base.name}</option>)}
            </SelectControl>
            <button className="e-btn primary" disabled={busy || !query.trim()}>{busy ? '分析中…' : '综合查找'}</button>
          </div>
        </form>
        <p className="us-hint">将自动判断：业务场景推荐、文档原文检索、知识图谱关联，并给出进入智能问答的入口。</p>
      </section>

      {docsOpen && (
        <section className="e-card us-docs">
          <h2>接口说明</h2>
          <p className="e-muted">网页与集成方可通过下列接口获得与本页一致的综合查找结果。完整说明见仓库文档 <code>docs/综合查找接口说明.md</code>。</p>
          <dl className="us-docs-grid">
            <div><dt>接口</dt><dd><code>GET /api/unified-search</code></dd></div>
            <div><dt>鉴权</dt><dd>登录会话（与业务网页相同）</dd></div>
            <div><dt>参数</dt><dd><code>q</code>（必填）、<code>baseId</code>（可选）</dd></div>
            <div><dt>说明文档</dt><dd><code>GET /api/unified-search/spec</code></dd></div>
          </dl>
          <pre className="us-code">{`const result = await fetch('/api/unified-search?' + new URLSearchParams({
  q: '设备台账与工单有什么关联？',
  baseId: '可选知识库ID'
}), { credentials: 'include' }).then(r => r.json());`}</pre>
          {spec.data && <p className="us-spec-note">当前版本：{String((spec.data as { version?: string }).version || '1.0')} · {(spec.data as { description?: string }).description}</p>}
        </section>
      )}

      {(error || bases.error) && <Notice kind="error">{error || bases.error}</Notice>}

      {busy && !result && <Loading text="正在分析意图并检索各通道…"/>}

      {result && (
        <div className="us-result">
          <section className="e-card us-intent">
            <div className="us-intent-head">
              <div>
                <h2>意图分析</h2>
                <p>{result.strategy.summary}</p>
              </div>
              <button className="e-btn" disabled={busy} onClick={() => run()}><RefreshCw size={15}/>重新分析</button>
            </div>
            <div className="us-channels">
              {result.intent.channels.map(channel => {
                const Icon = channelIcon[channel.id] || Sparkles;
                return (
                  <article key={channel.id} className={`us-channel ${channel.selected ? 'is-selected' : ''} ${result.strategy.primary === channel.id ? 'is-primary' : ''}`}>
                    <div className="us-channel-top">
                      <Icon size={16}/>
                      <strong>{channel.label}</strong>
                      <span>{channel.selected ? (result.strategy.primary === channel.id ? '主通道' : '已选用') : '未选用'}</span>
                    </div>
                    <p>{channel.reasons[0] || '得分较低，本次未启用'}</p>
                  </article>
                );
              })}
            </div>
            {result.nextActions.length > 0 && (
              <div className="us-actions">
                {result.nextActions.map(action => (
                  <Link key={action.id} className="e-btn" to={action.route}>{action.label}<ArrowRight size={14}/></Link>
                ))}
              </div>
            )}
          </section>

          {result.scenarios.matched.length > 0 && (
            <section className="e-card us-block">
              <div className="us-block-head">
                <h2><Boxes size={18}/>业务场景</h2>
                <Link className="e-text-link" to={result.routes.scenarios}>打开场景工作台<ArrowRight size={13}/></Link>
              </div>
              <div className="us-scenario-tags">
                {result.scenarios.matched.map(row => (
                  <div key={row.id} className="us-scenario-tag">
                    <strong>{row.label}</strong>
                    <span>任务：{row.tasks[0]}</span>
                    <small>关键词：{row.hits.join('、')}</small>
                  </div>
                ))}
              </div>
              {result.scenarios.items.length ? (
                <div className="us-doc-list">
                  {result.scenarios.items.map(item => <DocCard key={`scenario-${item.documentId}`} item={item}/>)}
                </div>
              ) : <EmptyState title="场景资料暂无命中" description={result.scenarios.emptyReason || '可改用文档搜索或智能问答。'}/>}
            </section>
          )}

          <section className="e-card us-block">
            <div className="us-block-head">
              <h2><BookOpen size={18}/>文档搜索</h2>
              <Link className="e-text-link" to={result.routes.documents}>查看更多依据<ArrowRight size={13}/></Link>
            </div>
            {result.documents.strategy && <p className="e-muted us-strategy">检索策略：{result.documents.strategy}</p>}
            {result.documents.items.length ? (
              <div className="us-doc-list">
                {result.documents.items.map(item => <DocCard key={`doc-${item.documentId}-${item.page || 0}`} item={item}/>)}
              </div>
            ) : <EmptyState title="未命中文档依据" description={result.documents.emptyReason || '请调整问题或知识库范围。'}/>}
          </section>

          {result.graph && (
            <section className="e-card us-block">
              <div className="us-block-head">
                <h2><Network size={18}/>知识图谱</h2>
                <Link className="e-text-link" to={result.routes.graph}>在图谱中探索<ArrowRight size={13}/></Link>
              </div>
              {result.graph.entities.length > 0 && (
                <div className="us-entity-list">
                  {result.graph.entities.map(entity => (
                    <Link key={entity.id} className="us-entity" to={entity.route}>
                      <strong>{entity.name}</strong>
                      <span>{entity.type}{entity.externalId ? ` · ${entity.externalId}` : ''}</span>
                    </Link>
                  ))}
                </div>
              )}
              {result.graph.paths.length > 0 && (
                <div className="us-path-list">
                  {result.graph.paths.map(path => (
                    <div key={path.id} className="us-path">
                      <strong>{path.nodeNames.join(' → ') || path.label}</strong>
                      <span>{path.hops} 跳 · {path.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {!result.graph.entities.length && !result.graph.paths.length && (
                <EmptyState title="暂无图谱命中" description={result.graph.emptyReason || '可先核验关系后再查。'}/>
              )}
            </section>
          )}

          <section className="e-card us-chat-cta">
            <div>
              <h2><MessageSquare size={18}/>需要归纳成答案？</h2>
              <p className="e-muted">综合查找只返回依据与关系，不自动生成回答。可进入智能问答，在相同问题与范围内继续。</p>
            </div>
            <button className="e-btn primary" onClick={() => navigate(result.routes.chat)}>进入智能问答<ArrowRight size={15}/></button>
          </section>
        </div>
      )}

      {!busy && !result && !error && (
        <EmptyState title="输入问题开始综合查找" description={`当前账号：${user.name || user.username}。系统会按意图组合场景、文档与图谱通道。`}/>
      )}
    </div>
  );
}

function DocCard({ item }: { item: DocItem }) {
  return (
    <article className="us-doc">
      <span className="us-doc-icon"><FileText size={18}/></span>
      <div>
        <Link to={item.route}><strong>{item.title}</strong></Link>
        <p>V{item.version}{item.page ? ` · 第 ${item.page} 页` : ''}{item.sourceKind === 'synthetic' ? ' · 合成示例' : ''}</p>
        <p className="us-excerpt">{item.excerpt}</p>
        {(item.matchReason || item.reasons?.[0]) && <small>{item.matchReason || item.reasons?.[0]}</small>}
      </div>
    </article>
  );
}
