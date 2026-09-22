import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Plus, RefreshCw, Sparkles, Trash2, Zap } from 'lucide-react';
import { api, useResource, errorMessage } from './api';
import { PageHeader, Notice, EmptyState, Loading } from './components';
import { SelectControl } from './SelectControl';
import { usePageBreadcrumbs } from './Breadcrumbs';
import { ServiceCatalog } from './ServiceCatalog';
import './model-settings.css';

type Row = Record<string, any>;

function Field({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return <label className="e-field"><span>{title}</span>{children}{hint && <small className="e-muted">{hint}</small>}</label>;
}

function useAction(reload?: () => unknown) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); setMessage(success); reload?.(); return true; }
    catch (e) { setError(errorMessage(e)); return false; }
    finally { setBusy(false); }
  }
  return { busy, run, notices: <>{error && <Notice kind="error">{error}</Notice>}{message && <Notice kind="success">{message}</Notice>}</> };
}

function statusMeta(row: Row) {
  if (!row.enabled) return { label: '已停用', tone: 'muted' as const };
  if (row.status === 'ok') return { label: row.lastLatencyMs != null ? `可用 · ${row.lastLatencyMs} ms` : '可用', tone: 'ok' as const };
  if (row.status === 'error') return { label: '连接失败', tone: 'bad' as const };
  if (row.status === 'needs_key' || !row.hasApiKey) return { label: '需配置密钥', tone: 'warn' as const };
  return { label: '已保存，待测试', tone: 'warn' as const };
}

const emptyForm = {
  kind: 'deepseek',
  name: '',
  provider: 'compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-v4-flash',
  modelsText: 'deepseek-v4-flash\ndeepseek-chat',
  timeoutMs: 60000,
  setDefault: true,
  hasEnvKey: false,
};

function formFromPreset(preset: Row) {
  const models = (preset.models || []) as Array<{ id: string; label?: string }>;
  return {
    kind: preset.kind || 'custom',
    name: preset.name || '',
    provider: preset.provider || 'compatible',
    baseUrl: preset.baseUrl || '',
    apiKey: '',
    model: models[0]?.id || '',
    modelsText: models.map(m => m.id).join('\n'),
    timeoutMs: 60000,
    setDefault: true,
    hasEnvKey: Boolean(preset.hasEnvKey),
  };
}

function parseModels(text: string, primary: string) {
  const ids = [...new Set(`${primary}\n${text}`.split(/[\n,]/).map(s => s.trim()).filter(Boolean))];
  return ids.map(id => ({ id, label: id, enabled: true }));
}

export function ModelSettingsPage() {
  usePageBreadcrumbs([{ label: '系统管理', to: '/settings/overview' }, { label: '模型配置' }]);
  const r = useResource<{ settings: Row; capabilities: Row; providers?: Row[]; presets?: Row[] }>('/settings');
  const action = useAction(r.reload);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [testResult, setTestResult] = useState<Row | null>(null);
  const [defaultModelPick, setDefaultModelPick] = useState('');

  const providers = r.data?.providers || [];
  const presets = r.data?.presets || [];
  const model = r.data?.settings?.model;
  const defaultProvider = providers.find(p => p.isDefault) || providers.find(p => p.enabled && p.hasApiKey) || null;

  useEffect(() => {
    if (model?.model) setDefaultModelPick(model.model);
  }, [model?.model]);

  const enabledModels = useMemo(() => {
    const rows: Array<{ providerId: string; providerName: string; id: string; label: string }> = [];
    for (const provider of providers.filter(p => p.enabled)) {
      for (const item of provider.models || []) {
        if (item.enabled === false) continue;
        rows.push({ providerId: provider.id, providerName: provider.name, id: item.id, label: item.label || item.id });
      }
    }
    return rows;
  }, [providers]);

  function openCreate() {
    const first = presets[0] || { kind: 'deepseek', name: 'DeepSeek', provider: 'compatible', baseUrl: 'https://api.deepseek.com', models: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-chat' }] };
    setEditingId(null);
    setForm(formFromPreset(first));
    setStep(1);
    setTestResult(null);
    setWizardOpen(true);
  }

  function openEdit(row: Row) {
    setEditingId(row.id);
    setForm({
      kind: row.kind || 'custom',
      name: row.name || '',
      provider: row.provider || 'compatible',
      baseUrl: row.baseUrl || '',
      apiKey: '',
      model: row.models?.[0]?.id || '',
      modelsText: (row.models || []).map((m: Row) => m.id).join('\n'),
      timeoutMs: row.timeoutMs || 60000,
      setDefault: Boolean(row.isDefault),
      hasEnvKey: false,
    });
    setStep(2);
    setTestResult(null);
    setWizardOpen(true);
  }

  function pickPreset(preset: Row) {
    setForm(formFromPreset(preset));
    setStep(2);
  }

  async function saveProvider(e: FormEvent) {
    e.preventDefault();
    const models = parseModels(form.modelsText, form.model);
    const body: Row = {
      kind: form.kind,
      name: form.name || undefined,
      provider: form.provider,
      baseUrl: form.baseUrl,
      model: form.model,
      models,
      timeoutMs: form.timeoutMs,
      setDefault: form.setDefault,
    };
    if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
    const ok = await action.run(async () => {
      if (editingId) await api(`/settings/model-providers/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/settings/model-providers', { method: 'POST', body: JSON.stringify(body) });
    }, editingId ? '模型服务已更新' : '模型服务已接入');
    if (ok) {
      setWizardOpen(false);
      setForm(x => ({ ...x, apiKey: '' }));
    }
  }

  async function testProvider(id: string, modelId?: string) {
    setTestResult(null);
    await action.run(async () => {
      const result = await api<Row>(`/settings/model-providers/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        body: JSON.stringify(modelId ? { model: modelId } : {}),
      });
      setTestResult(result);
    }, '连接测试通过');
  }

  return (
    <div className="e-page ms-page">
      <PageHeader
        title="模型配置"
        description="在线接入多家大模型服务，设置问答默认型号。聊天页可选用已启用服务中的型号；上传辅助草稿与默认模型共用。"
        actions={<><button className="e-btn" onClick={r.reload} disabled={action.busy || r.loading}><RefreshCw size={16} />刷新</button><button className="e-btn primary" onClick={openCreate} disabled={action.busy}><Plus size={16} />接入新模型</button></>}
      />
      {action.notices}
      {r.error && <Notice kind="error">{r.error}</Notice>}
      {r.loading && !r.data ? <Loading /> : <>
        <section className="ms-default-card">
          <div className="ms-default-main">
            <Sparkles size={26} />
            <div>
              <p className="ms-eyebrow">当前问答默认</p>
              <strong>{model?.model || '尚未设置默认模型'}</strong>
              <p className="e-muted">
                {defaultProvider ? `${defaultProvider.name} · ${String(defaultProvider.baseUrl || '').replace(/^https?:\/\//, '')}` : '请接入至少一家模型服务并设为默认'}
                {model?.hasApiKey || model?.provider === 'ollama' ? ' · 凭据已就绪' : ' · 尚缺可用凭据'}
              </p>
            </div>
          </div>
          <div className="ms-default-actions">
            <label className="e-field ms-inline-field">
              <span>更换默认型号</span>
              <SelectControl
                className="e-input"
                value={defaultModelPick}
                onChange={e => setDefaultModelPick(e.target.value)}
                disabled={!enabledModels.length || action.busy}
              >
                {!enabledModels.length && <option value="">暂无可用型号</option>}
                {enabledModels.map(item => (
                  <option key={`${item.providerId}:${item.id}`} value={item.id}>{item.label}（{item.providerName}）</option>
                ))}
              </SelectControl>
            </label>
            <button
              className="e-btn primary"
              disabled={action.busy || !defaultModelPick || !enabledModels.length}
              onClick={() => {
                const hit = enabledModels.find(item => item.id === defaultModelPick);
                if (!hit) return;
                void action.run(
                  () => api('/settings/model-default', { method: 'PUT', body: JSON.stringify({ providerId: hit.providerId, model: hit.id }) }),
                  '默认模型已更新',
                );
              }}
            >设为默认</button>
            {defaultProvider && (
              <button className="e-btn" disabled={action.busy} onClick={() => void testProvider(defaultProvider.id, model?.model)}>
                <Zap size={15} />测试默认连接
              </button>
            )}
          </div>
          {testResult?.ok && <Notice kind="success">测试通过：{String(testResult.model)}{testResult.latencyMs != null ? `，耗时 ${testResult.latencyMs} ms` : ''}</Notice>}
        </section>

        <section className="ms-section">
          <div className="ms-section-head">
            <h2>已接入的模型服务</h2>
            <p className="e-muted">一张卡片对应一家服务。可分别保存密钥、测试连通，并随时切换默认。</p>
          </div>
          {providers.length ? (
            <div className="ms-provider-grid">
              {providers.map(row => {
                const meta = statusMeta(row);
                return (
                  <article className={`ms-provider-card tone-${meta.tone}${row.isDefault ? ' is-default' : ''}`} key={row.id}>
                    <header>
                      <div>
                        <h3>{row.name}</h3>
                        <p className="e-muted">{String(row.baseUrl || '').replace(/^https?:\/\//, '') || '未填写地址'}</p>
                      </div>
                      <span className={`ms-status tone-${meta.tone}`}>{meta.label}</span>
                    </header>
                    <ul className="ms-model-chips">
                      {(row.models || []).filter((m: Row) => m.enabled !== false).slice(0, 6).map((m: Row) => (
                        <li key={m.id}>{m.label || m.id}{model?.model === m.id && row.isDefault ? ' · 默认' : ''}</li>
                      ))}
                      {(row.models || []).filter((m: Row) => m.enabled !== false).length > 6 && <li>+{(row.models || []).length - 6}</li>}
                    </ul>
                    {row.lastError && <p className="ms-error-line"><CircleAlert size={14} />{row.lastError}</p>}
                    <footer className="ms-card-actions">
                      {!row.isDefault && row.enabled && (
                        <button className="e-btn" disabled={action.busy} onClick={() => void action.run(
                          () => api('/settings/model-default', { method: 'PUT', body: JSON.stringify({ providerId: row.id, model: row.models?.[0]?.id }) }),
                          '已设为默认服务',
                        )}>设为默认</button>
                      )}
                      {row.isDefault && <span className="ms-default-tag"><CheckCircle2 size={14} />默认</span>}
                      <button className="e-btn" disabled={action.busy || !row.enabled} onClick={() => void testProvider(row.id)}>测试</button>
                      <button className="e-btn" disabled={action.busy} onClick={() => openEdit(row)}>编辑</button>
                      <button className="e-btn" disabled={action.busy} onClick={() => void action.run(
                        () => api(`/settings/model-providers/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !row.enabled }) }),
                        row.enabled ? '已停用该服务' : '已重新启用',
                      )}>{row.enabled ? '停用' : '启用'}</button>
                      {!row.isDefault && (
                        <button className="e-btn danger" disabled={action.busy} onClick={() => {
                          if (!window.confirm(`确定删除「${row.name}」？删除后聊天页将不再提供其型号。`)) return;
                          void action.run(
                            () => api(`/settings/model-providers/${encodeURIComponent(row.id)}`, { method: 'DELETE' }),
                            '模型服务已删除',
                          );
                        }}><Trash2 size={14} />删除</button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="还没有接入模型服务"
              description="点击「接入新模型」，选择 DeepSeek、通义千问或其他兼容接口，填入密钥后即可使用。"
              action={<button className="e-btn primary" onClick={openCreate}><Plus size={16} />接入新模型</button>}
            />
          )}
        </section>

        {wizardOpen && (
          <section className="ms-wizard e-card">
            <div className="ms-wizard-head">
              <h2>{editingId ? '编辑模型服务' : '接入新模型'}</h2>
              <button type="button" className="e-btn" onClick={() => setWizardOpen(false)}>关闭</button>
            </div>
            {!editingId && (
              <div className="ms-steps" aria-label="接入步骤">
                <button type="button" className={step === 1 ? 'active' : ''} onClick={() => setStep(1)}>1. 选择服务</button>
                <button type="button" className={step === 2 ? 'active' : ''} onClick={() => setStep(2)}>2. 填写配置</button>
                <span className={step === 3 ? 'active' : ''}>3. 保存启用</span>
              </div>
            )}
            {!editingId && step === 1 && (
              <div className="ms-preset-grid">
                {(presets.length ? presets : [
                  { kind: 'deepseek', name: 'DeepSeek', hint: '适合日常问答', baseUrl: 'https://api.deepseek.com', models: [{ id: 'deepseek-v4-flash' }], provider: 'compatible' },
                  { kind: 'qwen', name: '通义千问', hint: '阿里云百炼兼容接口', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [{ id: 'qwen3.8-max' }], provider: 'compatible' },
                  { kind: 'custom', name: '自定义兼容接口', hint: '任意 OpenAI 兼容地址', baseUrl: '', models: [], provider: 'compatible' },
                ]).map((preset: Row) => (
                  <button type="button" className={`ms-preset-card${form.kind === preset.kind ? ' is-selected' : ''}`} key={preset.kind} onClick={() => pickPreset(preset)}>
                    <strong>{preset.name}</strong>
                    <p>{preset.hint || preset.baseUrl || '按提示填写地址与型号'}</p>
                    {preset.hasEnvKey && <span className="ms-env-tag">服务器已有环境变量密钥</span>}
                  </button>
                ))}
              </div>
            )}
            {(editingId || step >= 2) && (
              <form className="e-stack" onSubmit={saveProvider}>
                <div className="e-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
                  <Field title="显示名称"><input className="e-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例如：生产-通义" /></Field>
                  <Field title="服务类型">
                    <SelectControl className="e-input" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}>
                      <option value="compatible">OpenAI 兼容接口</option>
                      <option value="ollama">Ollama 本机/内网</option>
                    </SelectControl>
                  </Field>
                  <Field title="服务地址" hint="须为 HTTPS；Ollama 可用本机 HTTP">
                    <input className="e-input" type="url" required value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.deepseek.com" />
                  </Field>
                  <Field title={editingId ? '更新 API 密钥' : 'API 密钥'} hint={editingId ? '留空则保留已保存密钥' : (form.provider === 'ollama' ? 'Ollama 通常可不填' : form.hasEnvKey ? '服务器已配置对应环境变量，可留空沿用' : '密钥仅保存在服务端，页面不会回显')}>
                    <input className="e-input" type="password" autoComplete="new-password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder={editingId ? '不会回显已保存密钥' : 'sk-…'} required={!editingId && form.provider !== 'ollama' && !form.hasEnvKey} />
                  </Field>
                  <Field title="默认选用型号">
                    <input className="e-input" required value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="例如 qwen3.8-max" />
                  </Field>
                  <Field title="请求超时（秒）">
                    <input className="e-input" type="number" min={5} max={120} value={Math.round(form.timeoutMs / 1000)} onChange={e => setForm({ ...form, timeoutMs: Number(e.target.value) * 1000 })} />
                  </Field>
                </div>
                <Field title="可选型号列表" hint="每行一个型号 ID；聊天页将展示已启用的型号">
                  <textarea className="e-input ms-models-area" rows={5} value={form.modelsText} onChange={e => setForm({ ...form, modelsText: e.target.value })} placeholder={'deepseek-v4-flash\ndeepseek-chat'} />
                </Field>
                <label className="ms-check">
                  <input type="checkbox" checked={form.setDefault} onChange={e => setForm({ ...form, setDefault: e.target.checked })} />
                  保存后设为问答默认服务
                </label>
                <div className="e-toolbar">
                  {!editingId && <button type="button" className="e-btn" onClick={() => setStep(1)}>返回上一步</button>}
                  <button className="e-btn primary" disabled={action.busy}>{editingId ? '保存修改' : '保存并接入'}</button>
                  <button type="button" className="e-btn" onClick={() => setWizardOpen(false)}>取消</button>
                </div>
              </form>
            )}
          </section>
        )}

        <section className="e-card">
          <h2>使用说明</h2>
          <ul>
            <li>智能问答页可在「回答模型」中选择所有已启用服务里的型号。</li>
            <li>文件上传时的适用范围草稿，使用本页设置的默认模型。</li>
            <li>扫描件视觉识别仍由服务端环境变量 AI_VISION_MODEL / DASHSCOPE_API_KEY 负责。</li>
            <li>企业内网 HTTPS 模型主机需由运维配置 MODEL_ALLOWED_HOSTS。</li>
          </ul>
        </section>
        <ServiceCatalog model={model} settingsCapabilities={r.data?.capabilities} />
      </>}
    </div>
  );
}

export default ModelSettingsPage;
