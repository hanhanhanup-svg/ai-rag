import { type ReactNode } from 'react';
import { Database, FileSearch, Sparkles, Wrench } from 'lucide-react';
import { formatBytes, useResource } from './api';
import { Loading, Notice } from './components';
import './service-catalog.css';

type CapRow = { id: string; name: string; status: string; detail: string; formats?: string[] };
type ToolRow = { name: string; label: string; available: boolean; reason?: string };
type ModelInfo = {
  provider?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  hasApiKey?: boolean;
  embeddingEnabled?: boolean;
  embeddingSource?: string;
  embeddingModel?: string;
  localEmbedding?: { available?: boolean; model?: string; dimensions?: number; loaded?: boolean };
};
type SettingsCaps = Record<string, unknown>;

type CatalogItem = {
  id: string;
  name: string;
  summary: string;
  status: 'available' | 'configured' | 'required' | 'unavailable';
  statusLabel: string;
  configurable: boolean;
  formats?: string[];
  params?: { label: string; value: string }[];
};

function statusOf(cap: CapRow): CatalogItem['status'] {
  if (cap.status === 'available') return 'available';
  if (cap.status === 'configuration_required') return 'required';
  return 'unavailable';
}

function statusLabel(status: CatalogItem['status']) {
  return ({ available: '可用', configured: '已配置', required: '需配置', unavailable: '未接入' } as const)[status];
}

function providerLabel(provider?: string) {
  return ({ compatible: '通义千问 / DeepSeek / 兼容接口', ollama: 'Ollama 内网', disabled: '仅原文检索' } as Record<string, string>)[provider || ''] || provider || '—';
}

function boolText(value: unknown) {
  return value ? '已启用' : '未启用';
}

function buildModelItems(model?: ModelInfo): CatalogItem[] {
  const local = model?.localEmbedding;
  const embeddingReady = Boolean(model?.embeddingEnabled);
  return [
    {
      id: 'llm',
      name: '问答大模型',
      summary: '知识问答、辅助说明草稿与业务场景推理所使用的对话模型。',
      status: model?.provider === 'disabled' ? 'unavailable' : model?.hasApiKey || model?.provider === 'ollama' ? 'configured' : 'required',
      statusLabel: model?.provider === 'disabled' ? '仅原文检索' : model?.hasApiKey || model?.provider === 'ollama' ? '已配置' : '需配置',
      configurable: true,
      params: [
        { label: '服务类型', value: providerLabel(model?.provider) },
        { label: '服务地址', value: model?.baseUrl || '—' },
        { label: '模型名称', value: model?.model || '—' },
        { label: '超时', value: model?.timeoutMs ? `${Math.round(model.timeoutMs / 1000)} 秒` : '—' },
        { label: 'API 密钥', value: model?.hasApiKey ? '已配置（不回显）' : '未配置 / 环境变量' },
      ],
    },
    {
      id: 'embedding',
      name: '向量嵌入模型',
      summary: '用于语义检索与近似内容召回；优先本地离线 BGE，缺失时降级为中文 BM25。',
      status: embeddingReady ? 'available' : 'required',
      statusLabel: embeddingReady ? '可用' : '需配置',
      configurable: true,
      params: [
        { label: '嵌入来源', value: model?.embeddingSource === 'local' ? '本地 BGE' : model?.embeddingSource === 'external' ? '外部接口' : '未启用' },
        { label: '模型', value: model?.embeddingModel || local?.model || '—' },
        { label: '维度', value: local?.dimensions != null ? String(local.dimensions) : '—' },
        { label: '本地状态', value: local?.available ? (local.loaded ? '已加载' : '可用') : '不可用' },
      ],
    },
  ];
}

function buildKnowledgeItems(caps: CapRow[]): CatalogItem[] {
  const configHints: Record<string, { configurable: boolean; params?: (cap: CapRow) => { label: string; value: string }[] }> = {
    asr: {
      configurable: true,
      params: (cap) => [
        { label: '适配器', value: 'KNOWLEDGE_ASR_COMMAND / ARGS' },
        { label: '超时', value: 'KNOWLEDGE_ASR_TIMEOUT_MS' },
        { label: '视频抽帧', value: 'FFmpeg + 画面 OCR（最多 12 帧）' },
        { label: '当前状态', value: cap.status === 'available' ? '适配器已登记' : '待登记本地 Whisper' },
      ],
    },
    layout: {
      configurable: true,
      params: () => [
        { label: '开关', value: 'KNOWLEDGE_LAYOUT_ENABLED=true' },
        { label: '适配器', value: 'KNOWLEDGE_LAYOUT_COMMAND / ARGS' },
        { label: '说明', value: '复杂版式需本地适配器并核验真实结果' },
      ],
    },
    web_api: {
      configurable: true,
      params: () => [
        { label: '网页白名单', value: 'KNOWLEDGE_WEB_ALLOWED_HOSTS' },
        { label: 'API 白名单', value: 'KNOWLEDGE_API_ALLOWED_ENDPOINTS' },
        { label: '接入方式', value: '仅白名单内只读采集' },
      ],
    },
  };
  return caps.map((cap) => {
    const hint = configHints[cap.id];
    const status = statusOf(cap);
    return {
      id: cap.id,
      name: cap.name,
      summary: cap.detail,
      status,
      statusLabel: statusLabel(status),
      configurable: Boolean(hint?.configurable),
      formats: cap.formats,
      params: hint?.params?.(cap),
    };
  });
}

function buildToolItems(tools: ToolRow[]): CatalogItem[] {
  return tools.map((tool) => ({
    id: `tool-${tool.name}`,
    name: tool.label,
    summary: tool.available ? `受控问答工具 · ${tool.name}` : tool.reason || '尚未接入真实业务接口。',
    status: tool.available ? 'available' : 'unavailable',
    statusLabel: tool.available ? '可用' : '未接入',
    configurable: false,
    params: tool.available ? [{ label: '工具标识', value: tool.name }] : [{ label: '原因', value: tool.reason || '待配置' }],
  }));
}

function buildPlatformItems(caps?: SettingsCaps, limits?: { fileBytes?: number; mediaDurationMs?: number }): CatalogItem[] {
  const maxMb = caps?.maxFileSizeMB ?? (limits?.fileBytes ? Math.round(Number(limits.fileBytes) / (1024 * 1024)) : undefined);
  const formats = Array.isArray(caps?.formats) ? (caps!.formats as string[]) : undefined;
  return [
    {
      id: 'ocr',
      name: '扫描件 OCR',
      summary: '本地中英文 OCR，用于扫描 PDF 与图片文字识别。',
      status: caps?.ocr ? 'available' : 'unavailable',
      statusLabel: caps?.ocr ? '可用' : '未启用',
      configurable: false,
      formats: ['pdf', 'png', 'jpg'],
    },
    {
      id: 'hybrid-search',
      name: '混合检索',
      summary: '语义向量与全文检索组合；无向量时自动降级 BM25。',
      status: caps?.hybridSearch ? 'available' : 'configured',
      statusLabel: caps?.hybridSearch ? '语义+全文' : '全文检索',
      configurable: false,
      params: [
        { label: '向量检索', value: boolText(caps?.hybridSearch) },
        { label: '全文检索', value: boolText(caps?.lexicalSearch ?? true) },
      ],
    },
    {
      id: 'ingest-limits',
      name: '资料接入边界',
      summary: '单文件大小、音视频时长与解析边界，超限会明确提示。',
      status: 'available',
      statusLabel: '可用',
      configurable: false,
      formats,
      params: [
        { label: '单文件上限', value: maxMb != null ? `${maxMb} MB` : limits?.fileBytes != null ? formatBytes(Number(limits.fileBytes)) : '—' },
        { label: '音视频时长', value: limits?.mediaDurationMs != null ? `${Math.round(Number(limits.mediaDurationMs) / 60000)} 分钟` : '—' },
        { label: '版本管理', value: boolText(caps?.versioning ?? true) },
      ],
    },
    {
      id: 'connectors',
      name: '目录与远端同步',
      summary: '受控目录同步、网页快照与业务 API 只读接入。',
      status: caps?.connectors ? 'available' : 'unavailable',
      statusLabel: caps?.connectors ? '可用' : '未启用',
      configurable: true,
      params: [
        { label: '目录根', value: 'CONNECTOR_ROOTS（服务端）' },
        { label: '网页/API', value: '白名单环境变量' },
      ],
    },
    {
      id: 'sso',
      name: '统一登录（SSO）',
      summary: '企业 OIDC 登录；本地模式可免登录使用。',
      status: caps?.sso ? 'configured' : 'unavailable',
      statusLabel: caps?.sso ? '已配置' : '未启用',
      configurable: true,
      params: [
        { label: '颁发方', value: 'OIDC_ISSUER' },
        { label: '客户端', value: 'OIDC_CLIENT_ID' },
        { label: '站点源', value: 'PUBLIC_ORIGIN' },
      ],
    },
    {
      id: 'acl-backup',
      name: '权限校验与备份',
      summary: '服务端 ACL、操作审计与含原件的备份能力。',
      status: 'available',
      statusLabel: '可用',
      configurable: false,
      params: [
        { label: '服务端权限', value: boolText(caps?.serverAcl ?? true) },
        { label: '备份', value: boolText(caps?.backups ?? true) },
        { label: '部署', value: caps?.architecture === 'single-node-sqlite' ? '单节点持久化' : String(caps?.architecture || '—') },
      ],
    },
  ];
}

function CatalogGroup({ icon, title, description, items }: { icon: ReactNode; title: string; description: string; items: CatalogItem[] }) {
  if (!items.length) return null;
  return (
    <section className="svc-group">
      <header className="svc-group-head">
        <span className="svc-group-icon" aria-hidden="true">{icon}</span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="svc-group-count">{items.length}</span>
      </header>
      <div className="svc-grid">
        {items.map((item) => (
          <article key={item.id} className={`svc-card ${item.configurable ? 'is-configurable' : ''}`}>
            <div className="svc-card-top">
              <strong>{item.name}</strong>
              <span className={`svc-status is-${item.status}`}>{item.statusLabel}</span>
            </div>
            <p className="svc-summary">{item.summary}</p>
            {item.formats?.length ? <p className="svc-formats">格式：{item.formats.join(' · ')}</p> : null}
            {item.params?.length ? (
              <dl className="svc-params">
                {item.params.map((param) => (
                  <div key={param.label}>
                    <dt>{param.label}</dt>
                    <dd>{param.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <footer className="svc-card-foot">{item.configurable ? '可配置' : '内置能力'}</footer>
          </article>
        ))}
      </div>
    </section>
  );
}

export function ServiceCatalog({ model, settingsCapabilities }: { model?: ModelInfo; settingsCapabilities?: SettingsCaps }) {
  const knowledge = useResource<{ capabilities: CapRow[]; limits?: { fileBytes?: number; mediaDurationMs?: number } }>('/knowledge/capabilities');
  const intelligence = useResource<{ tools: ToolRow[] }>('/intelligence/capabilities');
  const loading = knowledge.loading || intelligence.loading;
  const error = knowledge.error || intelligence.error;

  const modelItems = buildModelItems(model);
  const knowledgeItems = buildKnowledgeItems(knowledge.data?.capabilities || []);
  const toolItems = buildToolItems(intelligence.data?.tools || []);
  const platformItems = buildPlatformItems(settingsCapabilities, knowledge.data?.limits);

  const all = [...modelItems, ...knowledgeItems, ...toolItems, ...platformItems];
  const total = all.length;
  const configurable = all.filter((item) => item.configurable).length;
  const toolsReady = toolItems.filter((item) => item.status === 'available').length;

  return (
    <section className="e-card svc-catalog">
      <div className="svc-intro">
        <div>
          <h2>服务配置清单</h2>
          <p className="e-muted">汇总平台已接入的模型、解析算法、检索能力与问答工具。可配置项展示关键参数；其余为内置能力，便于了解平台完整能力面。</p>
        </div>
        <div className="svc-stats" aria-label="能力统计">
          <div><strong>{loading && !total ? '—' : total}</strong><span>项能力</span></div>
          <div><strong>{loading && !total ? '—' : configurable}</strong><span>可配置</span></div>
          <div><strong>{loading && !toolsReady ? '—' : toolsReady}</strong><span>问答工具</span></div>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {loading && !knowledge.data && !intelligence.data ? (
        <Loading />
      ) : (
        <div className="svc-groups">
          <CatalogGroup icon={<Sparkles size={18} />} title="模型与向量" description="问答推理与语义检索所依赖的模型服务。" items={modelItems} />
          <CatalogGroup icon={<FileSearch size={18} />} title="解析、识别与知识治理" description="原件解析、OCR/ASR、图谱与近似内容核对。" items={knowledgeItems} />
          <CatalogGroup icon={<Wrench size={18} />} title="问答工具" description="业务场景可选用的受控只读工具。" items={toolItems} />
          <CatalogGroup icon={<Database size={18} />} title="平台基础服务" description="检索、接入边界、登录与备份等平台能力。" items={platformItems} />
        </div>
      )}
      <p className="svc-footnote">上方「问答模型」可直接调整对话模型；ASR、版式、网页/API 白名单与 SSO 由服务器环境变量配置，状态在此同步展示。</p>
    </section>
  );
}
