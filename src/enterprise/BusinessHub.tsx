import { useMemo, useState } from 'react';
import { PublishKnowledgeInterfaceDialog, type KnowledgeInterfaceContext } from './KnowledgeInterfaces';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, FileText, GraduationCap, MessageSquare, Network, PlugZap, Search, Settings2, Sparkles, TrainFront, Users, Wrench } from 'lucide-react';
import { useResource } from './api';
import { EmptyState, Loading, Notice, PageHeader } from './components';
import { sourceKindNames } from './KnowledgeGovernance';
import type { BusinessScenario, ScenarioVersion } from './UpgradeTypes';
import type { KnowledgeBase, SourceKind, User } from './types';
import './business-hub.css';
import { SelectControl } from './SelectControl';

type CatalogScene = { id: string; label: string; tasks: string[] };
type RecommendedDocument = { documentId: string; title: string; version: number; baseId: string; sourceKind: SourceKind; chunkId?: string; excerpt: string; reasons: string[]; reviewOverdue?: boolean };
type PublishedAssistant = { scenarioId: string; name: string; scenarioKey: string; version: ScenarioVersion; goal: string };

const sceneStyle: Record<string, { icon: typeof Wrench; intro: string; words: string[]; baseWords: string[]; color: string }> = {
  maintenance: { icon: Wrench, intro: '沿设备、工单和资料依据，核对一项具体业务。', words: ['设备', '维修', '工单', '检修'], baseWords: ['设施设备'], color: 'blue' },
  operations: { icon: TrainFront, intro: '整理交接、运营与客流记录，保留材料口径。', words: ['运营', '客流', '交接', '规程'], baseWords: ['运营管理'], color: 'teal' },
  passenger: { icon: Users, intro: '查阅服务资料与案例，为材料办理找到依据。', words: ['客运', '乘客', '失物', '投诉'], baseWords: ['客运组织'], color: 'violet' },
  training: { icon: GraduationCap, intro: '围绕岗位学习与备课，组织有来源的知识。', words: ['培训', '岗位', '课程', '学习'], baseWords: ['岗位培训'], color: 'amber' },
};

const assistantColors = ['green', 'rose', 'blue', 'violet', 'teal', 'amber'] as const;

function matchingVersions(scenarios: BusinessScenario[], scene: CatalogScene | undefined): ScenarioVersion[] {
  if (!scene) return [];
  const words = sceneStyle[scene.id]?.words || [scene.label];
  return scenarios.flatMap(row => {
    const version = row.versions.find(v => v.id === (row.activeVersionId || row.currentVersionId) && v.status === 'published');
    if (!version) return [];
    return row.scenario === scene.id || words.some(word => `${row.name} ${row.scenario} ${version.goal}`.includes(word)) ? [version] : [];
  });
}

function publishedAssistants(scenarios: BusinessScenario[]): PublishedAssistant[] {
  return scenarios.flatMap(row => {
    const version = row.versions.find(v => v.id === (row.activeVersionId || row.currentVersionId) && v.status === 'published');
    if (!version) return [];
    return [{ scenarioId: row.id, name: version.name || row.name, scenarioKey: row.scenario || version.scenario || '', version, goal: version.goal || '' }];
  });
}

function preferredBase(bases: KnowledgeBase[] | undefined, text: string) {
  const hay = text.toLowerCase();
  return bases?.find(base => hay.includes(base.name) || base.name.split(/[·•、\s]/).some(part => part.length >= 2 && hay.includes(part)))?.id || '';
}

function route(path: string, values: Record<string, string | undefined>) {
  return path + '?' + new URLSearchParams(Object.entries(values).filter(([, value]) => Boolean(value)) as [string, string][]);
}

export function BusinessHub({ user }: { user: User }) {
  const [params, setParams] = useSearchParams();
  const [publishContext, setPublishContext] = useState<KnowledgeInterfaceContext | null>(null);
  const catalog = useResource<{ scenarios: CatalogScene[] }>('/recommendation-links');
  const assistants = useResource<{ scenarios: BusinessScenario[] }>('/scenarios');
  const bases = useResource<{ bases: KnowledgeBase[] }>('/bases');
  const scenes = catalog.data?.scenarios || [];
  const published = useMemo(() => publishedAssistants(assistants.data?.scenarios || []), [assistants.data]);
  const assistantId = params.get('assistantId') || '';
  const activeAssistant = published.find(row => row.scenarioId === assistantId);
  const activeCatalog = !activeAssistant
    ? (scenes.find(row => row.id === params.get('scenario')) || scenes.find(row => row.id === 'maintenance') || scenes[0])
    : undefined;
  const task = activeAssistant
    ? (params.get('task') || activeAssistant.name)
    : (activeCatalog?.tasks.includes(params.get('task') || '') ? params.get('task') || '' : activeCatalog?.tasks[0] || '');
  const baseId = params.get('baseId') || '';
  const object = params.get('object') || '';
  const matching = useMemo(() => matchingVersions(assistants.data?.scenarios || [], activeCatalog), [assistants.data, activeCatalog]);
  const assistant = activeAssistant?.version || matching.find(row => row.id === params.get('scenarioVersionId')) || matching[0];
  const recommendationsQuery = activeAssistant
    ? new URLSearchParams({ task, baseId, contextId: 'business-hub', q: object || activeAssistant.name })
    : activeCatalog
      ? new URLSearchParams({ scenario: activeCatalog.id, task, baseId, contextId: 'business-hub' })
      : null;
  const recommendations = useResource<{ items: RecommendedDocument[]; policyVersion: string }>(recommendationsQuery ? '/recommendations?' + recommendationsQuery : null);

  function change(values: Record<string, string>) {
    setParams(old => {
      const next = new URLSearchParams(old);
      for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
      return next;
    }, { replace: true });
  }
  function selectScene(scene: CatalogScene) {
    const preferred = bases.data?.bases.find(base => (sceneStyle[scene.id]?.baseWords || []).some(word => base.name.includes(word)));
    change({ scenario: scene.id, assistantId: '', task: scene.tasks[0] || '', scenarioVersionId: '', baseId: preferred?.id || '', object: '' });
  }
  function selectAssistant(row: PublishedAssistant) {
    change({
      assistantId: row.scenarioId,
      scenario: '',
      task: row.name,
      scenarioVersionId: row.version.id,
      baseId: preferredBase(bases.data?.bases, `${row.name} ${row.goal}`) || baseId,
      object: '',
    });
  }

  const activeLabel = activeAssistant?.name || activeCatalog?.label || '';
  const context = { scenario: activeCatalog?.id, task, baseId, object, from: 'hub', ...(assistant ? { scenarioVersionId: assistant.id } : {}), ...(activeAssistant ? { assistantId: activeAssistant.scenarioId } : {}) };
  const question = activeAssistant
    ? `请依据已发布资料${object ? '，围绕' + object : ''}，按「${activeAssistant.name}」场景要求作答，列明依据与待补充事项。`
    : `请依据当前已发布资料${object ? '，围绕' + object : ''}完成“${task || activeLabel || '资料核验'}”，列明依据、适用范围和待补充事项。`;
  const chat = route('/application/chat', { ...context, q: question });

  return <div className="e-page bh-page">
    <PageHeader
      title="业务场景"
      description="上方是固定行业任务入口；在「管理问答场景」中评测并发布的助手，会出现在下方「已发布问答助手」。"
      actions={user.role === 'admin' ? <Link className="e-btn" to="/application/scenarios"><Settings2 size={16}/>管理问答场景</Link> : undefined}
    />
    {(catalog.error || assistants.error || bases.error) && <Notice kind="error">{catalog.error || assistants.error || bases.error}</Notice>}

    <section className="bh-block" aria-labelledby="bh-catalog-title">
      <div className="bh-block-head">
        <div>
          <h2 id="bh-catalog-title">行业任务入口</h2>
          <p>固定目录，用于按客运、运营、维修、培训等任务组织资料。</p>
        </div>
      </div>
      {catalog.loading && !catalog.data ? <Loading text="正在加载可用业务场景…"/> : scenes.length ? (
        <div className="bh-scenes" role="group" aria-label="选择行业任务入口">
          {scenes.map(scene => {
            const style = sceneStyle[scene.id];
            const Icon = style?.icon || BookOpen;
            const count = matchingVersions(assistants.data?.scenarios || [], scene).length;
            const selected = !activeAssistant && activeCatalog?.id === scene.id;
            return <button key={scene.id} className={`bh-scene ${style?.color || 'blue'} ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => selectScene(scene)}>
              <span className="bh-scene-top"><span className="bh-scene-icon"><Icon size={22}/></span>{selected ? <CheckCircle2 size={18}/> : <ChevronRight size={18}/>}</span>
              <strong>{scene.label}</strong>
              <p>{style?.intro || '按任务查阅相关资料，并核验适用范围。'}</p>
              <span className="bh-scene-meta">{scene.tasks.length} 项任务 · {assistants.loading ? '核对助手中' : count ? `${count} 个已发布相关助手` : '通用知识问答'}</span>
            </button>;
          })}
        </div>
      ) : <section className="e-card"><EmptyState title="暂无可用业务场景" description="场景目录加载完成后，可从任务入口组织知识。"/></section>}
    </section>

    <section className="bh-block" aria-labelledby="bh-assistant-title">
      <div className="bh-block-head">
        <div>
          <h2 id="bh-assistant-title">已发布问答助手</h2>
          <p>来自「管理问答场景」且已发布的版本；草稿或仅评测通过前不会出现在这里。</p>
        </div>
        {user.role === 'admin' && <Link className="e-text-link" to="/application/scenarios">去发布或核对状态<ArrowRight size={14}/></Link>}
      </div>
      {assistants.loading && !assistants.data ? <Loading text="正在加载已发布助手…"/> : published.length ? (
        <div className="bh-scenes" role="group" aria-label="选择已发布问答助手">
          {published.map((row, index) => {
            const selected = activeAssistant?.scenarioId === row.scenarioId;
            const color = assistantColors[index % assistantColors.length];
            return <button key={row.scenarioId} className={`bh-scene ${color} ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => selectAssistant(row)}>
              <span className="bh-scene-top"><span className="bh-scene-icon"><Sparkles size={22}/></span>{selected ? <CheckCircle2 size={18}/> : <ChevronRight size={18}/>}</span>
              <strong>{row.name}</strong>
              <p>{row.goal.slice(0, 72) || '已发布的业务问答助手，可带入智能问答使用。'}{row.goal.length > 72 ? '…' : ''}</p>
              <span className="bh-scene-meta">已发布 · V{row.version.version} · {row.scenarioKey || '业务助手'}</span>
            </button>;
          })}
        </div>
      ) : (
        <section className="e-card">
          <EmptyState
            title="还没有已发布的问答助手"
            description={user.role === 'admin' ? '在「管理问答场景」创建后，需完成真实评测并发布，才会出现在此列表。' : '管理员发布业务问答场景后，可在此选用。'}
          />
        </section>
      )}
    </section>

    {(activeAssistant || activeCatalog) && <section className="e-card bh-task-panel" aria-label="本次任务">
      <div className="bh-section-title">
        <span className="bh-step">01</span>
        <div><h2>明确本次任务</h2><p>{activeAssistant ? '当前选用已发布问答助手，可调整知识范围后进入问答。' : '切换页面时保留所选场景和知识范围。'}</p></div>
        <span className="e-badge">{activeLabel}</span>
      </div>
      <div className="bh-task-fields">
        {activeAssistant ? (
          <label className="e-field">当前助手<input value={activeAssistant.name} readOnly/></label>
        ) : (
          <label className="e-field">当前任务<SelectControl value={task} onChange={e => change({ scenario: activeCatalog!.id, task: e.target.value })}>{activeCatalog!.tasks.map(value => <option key={value}>{value}</option>)}</SelectControl></label>
        )}
        <label className="e-field">知识范围<SelectControl value={baseId} onChange={e => change({ baseId: e.target.value })}><option value="">全部可访问知识库</option>{bases.data?.bases.map(base => <option key={base.id} value={base.id}>{base.name}</option>)}</SelectControl></label>
        <label className="e-field">业务对象或关键词（可选）<input value={object} maxLength={120} onChange={e => change({ object: e.target.value })} placeholder="例如：DEMO26-EQ-001 或设备编号"/></label>
      </div>
    </section>}

    {(activeAssistant || activeCatalog) && <div className="bh-work-area">
      <section className="e-card bh-documents">
        <div className="bh-section-title">
          <span className="bh-step">02</span>
          <div><h2>查阅任务资料</h2><p>{activeAssistant ? '按助手主题与关键词推荐可核验资料。' : '按当前场景和任务推荐，打开后可核对原文版本。'}</p></div>
          <Link className="e-text-link" to={route('/application/search', context)}>查看全部依据<ArrowRight size={14}/></Link>
        </div>
        {recommendations.error && <Notice kind="error">{recommendations.error}</Notice>}
        {recommendations.loading ? <Loading text="正在核对资料的状态与任务关联…"/> : recommendations.data?.items.length ? (
          <div className="bh-document-list">{recommendations.data.items.slice(0, 4).map(doc => (
            <article key={doc.documentId}>
              <span className="bh-document-icon"><FileText size={20}/></span>
              <div>
                <Link className="bh-document-title" to={route('/documents/' + doc.documentId, { chunk: doc.chunkId })}>{doc.title}</Link>
                <div className="bh-document-meta">
                  <span>V{doc.version}</span>
                  <span className={doc.sourceKind === 'synthetic' ? 'bh-demo' : ''}>{sourceKindNames[doc.sourceKind] || '来源待登记'}</span>
                  {doc.reviewOverdue && <span className="bh-overdue">已到复审日期</span>}
                </div>
                <p>{doc.reasons[0] || '当前范围内的可用资料'}</p>
                <Link className="e-text-link" to={route('/application/chat', { ...context, baseId: doc.baseId, documentId: doc.documentId, documentVersion: String(doc.version), q: `请依据《${doc.title}》V${doc.version}${object ? `，围绕${object}` : ''}，说明${task}所需的材料、适用范围及待核验事项。` })}>围绕此版本提问<ArrowRight size={13}/></Link>
              </div>
            </article>
          ))}</div>
        ) : <EmptyState title="当前任务暂无匹配资料" description="可调整知识范围，或在知识搜索中使用更明确的关键词。"/>}
        <div className="bh-document-footer">
          <Link className="e-btn" to={route('/application/search', { ...context, q: object || task })}><Search size={16}/>搜索更多依据</Link>
          <Link className="e-btn" to={route('/assets/graph', { baseId, query: object || undefined, hops: '3' })}><Network size={16}/>查看知识关系</Link>
        </div>
      </section>

      <section className="e-card bh-assistant" aria-label="使用与集成">
        <div className="bh-section-title"><span className="bh-step">03</span><div><h2>使用与集成</h2><p>从当前任务进入问答，或发布给其他系统调用。</p></div></div>
        {assistants.loading ? <Loading text="正在核对可用助手…"/> : activeAssistant ? (
          <p className="bh-assistant-match"><span className="e-badge published">已发布 · V{activeAssistant.version.version}</span><strong>{activeAssistant.name}</strong></p>
        ) : matching.length > 1 ? (
          <label className="e-field bh-assistant-pick">相关业务助手<SelectControl value={assistant?.id || ''} onChange={e => change({ scenarioVersionId: e.target.value })}>{matching.map(version => <option key={version.id} value={version.id}>{version.name} · V{version.version}</option>)}</SelectControl></label>
        ) : assistant ? (
          <p className="bh-assistant-match"><span className="e-badge published">已发布 · V{assistant.version}</span><strong>{assistant.name}</strong></p>
        ) : null}
        <div className="bh-use-actions">
          <Link className="bh-action bh-action-primary" to={chat}>
            <span className="bh-action-icon" aria-hidden="true"><MessageSquare size={22}/></span>
            <span className="bh-action-copy"><strong>进入知识问答</strong><small>带入当前任务，直接开始对话</small></span>
            <ArrowRight size={18} aria-hidden="true"/>
          </Link>
          {user.role === 'admin' && <button type="button" className="bh-action bh-action-secondary" onClick={() => setPublishContext({ baseId, scenario: activeCatalog?.id || 'operations', task, object })}>
            <span className="bh-action-icon" aria-hidden="true"><PlugZap size={22}/></span>
            <span className="bh-action-copy"><strong>发布为标准接口</strong><small>供其他业务系统调用本库问答</small></span>
            <ArrowRight size={18} aria-hidden="true"/>
          </button>}
        </div>
        <Link className="bh-feedback-link" to="/application/feedback">资料缺失或版本不符？提交反馈</Link>
      </section>
    </div>}
    {publishContext && <PublishKnowledgeInterfaceDialog context={publishContext} onClose={() => setPublishContext(null)}/>}
  </div>;
}
