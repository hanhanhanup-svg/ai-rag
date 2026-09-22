import { now, uid } from './database.mjs';
import { failure, requireValue, cleanString } from './security.mjs';
import { modelConfig, validateEndpoint, publicModel } from './retrieval.mjs';

const DEEPSEEK_MODELS = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek Flash' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat' },
];
const QWEN_MODELS = [
  { id: 'qwen3.8-max', label: '通义千问 3.8 Max（最强）' },
  { id: 'qwen3.7-plus', label: '通义千问 3.7 Plus' },
  { id: 'qwen3-max', label: '通义千问 3 Max' },
  { id: 'qwen-max', label: '通义千问 Max' },
  { id: 'qwen-plus', label: '通义千问 Plus' },
  { id: 'qwen-turbo', label: '通义千问 Turbo（更快）' },
  { id: 'qwen-long', label: '通义千问 Long（长文）' },
];
const OPENAI_MODELS = [
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4o', label: 'GPT-4o' },
];
const MOONSHOT_MODELS = [
  { id: 'moonshot-v1-auto', label: 'Kimi Auto' },
  { id: 'moonshot-v1-8k', label: 'Kimi 8K' },
  { id: 'moonshot-v1-32k', label: 'Kimi 32K' },
  { id: 'moonshot-v1-128k', label: 'Kimi 128K' },
];
const ZHIPU_MODELS = [
  { id: 'glm-4-flash', label: 'GLM-4 Flash' },
  { id: 'glm-4-plus', label: 'GLM-4 Plus' },
  { id: 'glm-4-air', label: 'GLM-4 Air' },
];

/** Built-in vendor templates for the onboarding wizard. */
export const MODEL_PROVIDER_PRESETS = [
  {
    kind: 'deepseek',
    name: 'DeepSeek',
    family: 'deepseek',
    provider: 'compatible',
    baseUrl: 'https://api.deepseek.com',
    models: DEEPSEEK_MODELS,
    hint: '适合日常问答与快速回复。在 DeepSeek 开放平台创建 API Key。',
    envKey: 'DEEPSEEK_API_KEY',
  },
  {
    kind: 'qwen',
    name: '通义千问',
    family: 'qwen',
    provider: 'compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: QWEN_MODELS,
    hint: '阿里云百炼 OpenAI 兼容接口。使用 DASHSCOPE_API_KEY。',
    envKey: 'DASHSCOPE_API_KEY',
  },
  {
    kind: 'openai',
    name: 'OpenAI',
    family: 'openai',
    provider: 'compatible',
    baseUrl: 'https://api.openai.com/v1',
    models: OPENAI_MODELS,
    hint: '官方 OpenAI Chat Completions 兼容接口。',
    envKey: 'OPENAI_API_KEY',
  },
  {
    kind: 'moonshot',
    name: '月之暗面 Kimi',
    family: 'moonshot',
    provider: 'compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: MOONSHOT_MODELS,
    hint: 'Kimi OpenAI 兼容接口。',
    envKey: 'MOONSHOT_API_KEY',
  },
  {
    kind: 'zhipu',
    name: '智谱 GLM',
    family: 'zhipu',
    provider: 'compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ZHIPU_MODELS,
    hint: '智谱开放平台 OpenAI 兼容接口。',
    envKey: 'ZHIPU_API_KEY',
  },
  {
    kind: 'ollama',
    name: 'Ollama 本机',
    family: 'ollama',
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: [{ id: 'qwen2.5:7b', label: 'Qwen2.5 7B' }, { id: 'llama3.2', label: 'Llama 3.2' }],
    hint: '本机或内网 Ollama，可使用 HTTP。通常无需 API 密钥。',
    envKey: '',
  },
  {
    kind: 'custom',
    name: '自定义兼容接口',
    family: 'other',
    provider: 'compatible',
    baseUrl: '',
    models: [],
    hint: '任意 OpenAI Chat Completions 兼容服务。填写完整 Base URL 与型号。',
    envKey: 'AI_API_KEY',
  },
];

function presetOf(kind) {
  return MODEL_PROVIDER_PRESETS.find(row => row.kind === kind) || MODEL_PROVIDER_PRESETS.find(row => row.kind === 'custom');
}

function normalizeModels(input, fallback = []) {
  const rows = Array.isArray(input) ? input : fallback;
  const seen = new Set();
  const models = [];
  for (const row of rows) {
    const id = cleanString(typeof row === 'string' ? row : row?.id, 120);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = cleanString(typeof row === 'string' ? row : (row?.label || row?.id), 120) || id;
    models.push({ id, label, enabled: row?.enabled === false ? false : true });
  }
  return models;
}

function familyFromHints(baseUrl = '', model = '', kind = '') {
  const preset = presetOf(kind);
  if (preset?.family && kind && kind !== 'custom') return preset.family;
  const host = String(baseUrl || '').toLowerCase();
  const id = String(model || '').toLowerCase();
  if (host.includes('deepseek') || id.includes('deepseek')) return 'deepseek';
  if (host.includes('dashscope') || host.includes('aliyuncs') || /\bqwen\b/.test(id) || id.startsWith('qwen')) return 'qwen';
  if (host.includes('openai.com') || id.startsWith('gpt-') || id.startsWith('o1')) return 'openai';
  if (host.includes('moonshot') || id.includes('moonshot') || id.includes('kimi')) return 'moonshot';
  if (host.includes('bigmodel') || id.startsWith('glm-')) return 'zhipu';
  if (host.includes('11434') || kind === 'ollama') return 'ollama';
  return preset?.family || 'other';
}

function readApiKey(store, row) {
  if (row?.sealedApiKey) {
    try { return store.unseal(row.sealedApiKey); } catch { /* fall through */ }
  }
  const preset = presetOf(row?.kind);
  if (preset?.envKey && process.env[preset.envKey]) return process.env[preset.envKey];
  if (row?.family === 'deepseek' || row?.kind === 'deepseek') return process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || '';
  if (row?.family === 'qwen' || row?.kind === 'qwen') return process.env.DASHSCOPE_API_KEY || process.env.AI_API_KEY || '';
  if (row?.family === 'openai' || row?.kind === 'openai') return process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '';
  return process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.DEEPSEEK_API_KEY || '';
}

export function publicProvider(store, row, defaults = {}) {
  if (!row) return null;
  const apiKey = readApiKey(store, row);
  const models = normalizeModels(row.models).map(model => ({ ...model, enabled: model.enabled !== false }));
  const defaultProviderId = defaults.defaultProviderId || store.get('setting', 'model')?.defaultProviderId || '';
  const defaultModel = defaults.defaultModel || store.get('setting', 'model')?.model || '';
  const isDefault = row.id === defaultProviderId || (!defaultProviderId && row.enabled !== false && row.baseUrl && (models.some(m => m.id === defaultModel) || row.baseUrl === modelConfig(store).baseUrl));
  return {
    id: row.id,
    name: row.name,
    kind: row.kind || 'custom',
    family: row.family || familyFromHints(row.baseUrl, models[0]?.id, row.kind),
    provider: row.provider || 'compatible',
    baseUrl: row.baseUrl || '',
    models,
    enabled: row.enabled !== false,
    status: row.enabled === false ? 'disabled' : (row.status || (apiKey || row.provider === 'ollama' ? 'untested' : 'needs_key')),
    hasApiKey: Boolean(apiKey) || row.provider === 'ollama',
    timeoutMs: Math.min(120000, Math.max(5000, Number(row.timeoutMs) || 60000)),
    lastTestAt: row.lastTestAt || null,
    lastLatencyMs: row.lastLatencyMs ?? null,
    lastError: row.lastError || null,
    lastTestModel: row.lastTestModel || null,
    isDefault: Boolean(isDefault),
    sortOrder: Number(row.sortOrder) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function writeDefaultSetting(store, provider, modelId) {
  const old = store.get('setting', 'model') || { id: 'model' };
  const apiKey = readApiKey(store, provider);
  const models = normalizeModels(provider.models);
  const model = modelId || models.find(m => m.enabled !== false)?.id || models[0]?.id || old.model || '';
  const patch = {
    id: 'model',
    provider: provider.provider || 'compatible',
    baseUrl: provider.baseUrl || '',
    model,
    timeoutMs: Math.min(120000, Math.max(5000, Number(provider.timeoutMs) || old.timeoutMs || 60000)),
    defaultProviderId: provider.id,
    embeddingModel: old.embeddingModel,
    embeddingBaseUrl: old.embeddingBaseUrl,
    sealedEmbeddingApiKey: old.sealedEmbeddingApiKey,
  };
  if (provider.sealedApiKey) patch.sealedApiKey = provider.sealedApiKey;
  else if (apiKey) patch.sealedApiKey = store.seal(apiKey);
  else if (Object.hasOwn(old, 'sealedApiKey')) patch.sealedApiKey = old.sealedApiKey;
  store.put('setting', { ...old, ...patch });
}

function seedProvider(store, { kind, name, provider, baseUrl, models, apiKey, family, enabled = true, status = 'untested', sortOrder = 0, makeDefault = false }) {
  const preset = presetOf(kind);
  const row = {
    id: uid('mprov_'),
    name: name || preset.name,
    kind: kind || 'custom',
    family: family || familyFromHints(baseUrl, models?.[0]?.id || models?.[0], kind),
    provider: provider || preset.provider || 'compatible',
    baseUrl: baseUrl || preset.baseUrl || '',
    models: normalizeModels(models, preset.models),
    enabled,
    status: enabled ? status : 'disabled',
    timeoutMs: 60000,
    sortOrder,
    lastTestAt: null,
    lastLatencyMs: null,
    lastError: null,
    lastTestModel: null,
    createdAt: now(),
    updatedAt: now(),
  };
  if (apiKey) row.sealedApiKey = store.seal(apiKey);
  store.put('modelProvider', row);
  if (makeDefault) writeDefaultSetting(store, row, row.models[0]?.id);
  return row;
}

/** Create initial provider cards from current setting + env when none exist. */
export function ensureModelProviders(store) {
  const existing = store.list('modelProvider');
  if (existing.length) return existing.sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.createdAt).localeCompare(String(b.createdAt)));

  const config = modelConfig(store);
  const seeded = [];
  const envDeepseek = process.env.DEEPSEEK_API_KEY || '';
  const envQwen = process.env.DASHSCOPE_API_KEY || '';
  const envOpenAI = process.env.OPENAI_API_KEY || '';
  const envAi = process.env.AI_API_KEY || '';
  let host = '';
  try { host = new URL(config.baseUrl || '').hostname.toLowerCase(); } catch { host = ''; }
  const primaryFamily = familyFromHints(config.baseUrl, config.model);

  if (envDeepseek || primaryFamily === 'deepseek' || host.includes('deepseek')) {
    const isPrimary = primaryFamily === 'deepseek' || host.includes('deepseek');
    seeded.push(seedProvider(store, {
      kind: 'deepseek',
      baseUrl: isPrimary ? config.baseUrl : 'https://api.deepseek.com',
      models: isPrimary && config.model ? [{ id: config.model, label: config.model }, ...DEEPSEEK_MODELS] : DEEPSEEK_MODELS,
      apiKey: envDeepseek || (isPrimary ? config.apiKey : '') || '',
      makeDefault: isPrimary && config.provider !== 'disabled',
      status: (envDeepseek || (isPrimary && config.apiKey)) ? 'untested' : 'needs_key',
      sortOrder: 10,
    }));
  }
  if (envQwen || primaryFamily === 'qwen' || host.includes('dashscope') || host.includes('aliyuncs')) {
    const isPrimary = primaryFamily === 'qwen' || host.includes('dashscope') || host.includes('aliyuncs');
    seeded.push(seedProvider(store, {
      kind: 'qwen',
      baseUrl: isPrimary ? config.baseUrl : 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: isPrimary && config.model ? [{ id: config.model, label: config.model }, ...QWEN_MODELS] : QWEN_MODELS,
      apiKey: envQwen || (isPrimary ? config.apiKey : '') || (primaryFamily === 'deepseek' ? envAi : '') || '',
      makeDefault: isPrimary && config.provider !== 'disabled',
      status: (envQwen || (isPrimary && config.apiKey)) ? 'untested' : 'needs_key',
      sortOrder: 20,
    }));
  }
  if (!seeded.length && config.provider !== 'disabled' && (config.baseUrl || config.model)) {
    seeded.push(seedProvider(store, {
      kind: primaryFamily === 'ollama' || config.provider === 'ollama' ? 'ollama' : (primaryFamily === 'openai' ? 'openai' : 'custom'),
      name: primaryFamily === 'ollama' ? 'Ollama 本机' : (config.model ? `当前配置 · ${config.model}` : '当前模型服务'),
      provider: config.provider || 'compatible',
      baseUrl: config.baseUrl,
      models: config.model ? [{ id: config.model, label: config.model }] : [],
      apiKey: config.apiKey || envOpenAI || envAi || '',
      family: primaryFamily || 'other',
      makeDefault: true,
      status: config.apiKey || config.provider === 'ollama' ? 'untested' : 'needs_key',
      sortOrder: 0,
    }));
  }

  if (seeded.length && !(store.get('setting', 'model')?.defaultProviderId)) {
    const preferred = seeded.find(row => row.id === store.get('setting', 'model')?.defaultProviderId)
      || seeded.find(row => normalizeModels(row.models).some(m => m.id === config.model))
      || seeded[0];
    if (preferred) writeDefaultSetting(store, preferred, config.model || preferred.models[0]?.id);
  }
  return store.list('modelProvider').sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function listPublicProviders(store) {
  const rows = ensureModelProviders(store);
  const setting = store.get('setting', 'model') || {};
  return rows.map(row => publicProvider(store, row, { defaultProviderId: setting.defaultProviderId, defaultModel: setting.model }));
}

export function getProvider(store, id) {
  ensureModelProviders(store);
  const row = store.get('modelProvider', id);
  requireValue(row, 404, 'PROVIDER_NOT_FOUND', '模型服务不存在。');
  return row;
}

export async function createModelProvider(store, input = {}) {
  const kind = cleanString(input.kind, 40) || 'custom';
  const preset = presetOf(kind);
  requireValue(preset, 400, 'INVALID_KIND', '不支持的服务类型。');
  const providerType = cleanString(input.provider, 40) || preset.provider || 'compatible';
  requireValue(['compatible', 'ollama'].includes(providerType), 400, 'INVALID_PROVIDER', '模型类型无效。');
  const baseUrl = cleanString(input.baseUrl, 500) || preset.baseUrl || '';
  requireValue(baseUrl || providerType === 'ollama', 400, 'BASE_URL_REQUIRED', '请填写服务地址。');
  if (baseUrl) await validateEndpoint(baseUrl, providerType, { allowInternalModelHosts: true });
  let models = normalizeModels(input.models, preset.models);
  const customModel = cleanString(input.model, 120);
  if (customModel && !models.some(m => m.id === customModel)) models = [{ id: customModel, label: customModel, enabled: true }, ...models];
  requireValue(models.length > 0, 400, 'MODEL_REQUIRED', '请至少填写一个模型名称。');
  const name = cleanString(input.name, 80) || preset.name;
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (providerType !== 'ollama') requireValue(apiKey || process.env[preset.envKey] || process.env.AI_API_KEY, 400, 'API_KEY_REQUIRED', '请填写 API 密钥。');
  const timeoutMs = Math.min(120000, Math.max(5000, Number(input.timeoutMs) || 60000));
  const row = {
    id: uid('mprov_'),
    name,
    kind,
    family: familyFromHints(baseUrl, models[0]?.id, kind),
    provider: providerType,
    baseUrl,
    models,
    enabled: input.enabled === false ? false : true,
    status: 'untested',
    timeoutMs,
    sortOrder: (store.list('modelProvider').reduce((n, p) => Math.max(n, Number(p.sortOrder) || 0), 0) || 0) + 10,
    lastTestAt: null,
    lastLatencyMs: null,
    lastError: null,
    lastTestModel: null,
    createdAt: now(),
    updatedAt: now(),
  };
  if (apiKey) row.sealedApiKey = store.seal(apiKey);
  store.put('modelProvider', row);
  const makeDefault = input.setDefault === true || !store.get('setting', 'model')?.defaultProviderId || modelConfig(store).provider === 'disabled';
  if (makeDefault && row.enabled) writeDefaultSetting(store, row, models.find(m => m.enabled)?.id || models[0].id);
  return publicProvider(store, row);
}

export async function updateModelProvider(store, id, input = {}) {
  const old = getProvider(store, id);
  const patch = { ...old, updatedAt: now() };
  if (input.name !== undefined) patch.name = cleanString(input.name, 80) || old.name;
  if (input.kind !== undefined) {
    patch.kind = cleanString(input.kind, 40) || old.kind;
    patch.family = familyFromHints(patch.baseUrl, patch.models?.[0]?.id, patch.kind);
  }
  if (input.provider !== undefined) {
    requireValue(['compatible', 'ollama'].includes(input.provider), 400, 'INVALID_PROVIDER', '模型类型无效。');
    patch.provider = input.provider;
  }
  if (input.baseUrl !== undefined) {
    const baseUrl = cleanString(input.baseUrl, 500);
    requireValue(baseUrl, 400, 'BASE_URL_REQUIRED', '请填写服务地址。');
    await validateEndpoint(baseUrl, patch.provider || old.provider || 'compatible', { allowInternalModelHosts: true });
    patch.baseUrl = baseUrl;
    patch.family = familyFromHints(baseUrl, patch.models?.[0]?.id, patch.kind);
  }
  if (input.models !== undefined || input.model !== undefined) {
    let models = normalizeModels(input.models, old.models);
    const customModel = cleanString(input.model, 120);
    if (customModel && !models.some(m => m.id === customModel)) models = [{ id: customModel, label: customModel, enabled: true }, ...models];
    requireValue(models.length > 0, 400, 'MODEL_REQUIRED', '请至少填写一个模型名称。');
    patch.models = models;
  }
  if (input.timeoutMs !== undefined) {
    requireValue(Number.isFinite(Number(input.timeoutMs)), 400, 'INVALID_TIMEOUT', '超时时间无效。');
    patch.timeoutMs = Math.min(120000, Math.max(5000, Number(input.timeoutMs)));
  }
  if (input.enabled !== undefined) {
    patch.enabled = input.enabled === true;
    patch.status = patch.enabled ? (old.status === 'disabled' ? 'untested' : old.status) : 'disabled';
  }
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    requireValue(input.apiKey.trim().length < 1000, 400, 'INVALID_KEY', '密钥长度无效。');
    patch.sealedApiKey = store.seal(input.apiKey.trim());
    if (patch.status === 'needs_key') patch.status = 'untested';
  }
  if (input.clearApiKey === true) {
    patch.sealedApiKey = null;
    if (patch.provider !== 'ollama') patch.status = 'needs_key';
  }
  store.put('modelProvider', patch);
  const setting = store.get('setting', 'model') || {};
  if (setting.defaultProviderId === patch.id) {
    if (patch.enabled === false) {
      const fallback = store.list('modelProvider').find(row => row.id !== patch.id && row.enabled !== false);
      if (fallback) writeDefaultSetting(store, fallback, normalizeModels(fallback.models).find(m => m.enabled)?.id);
      else store.put('setting', { ...setting, id: 'model', provider: 'disabled', defaultProviderId: null });
    } else {
      writeDefaultSetting(store, patch, setting.model);
    }
  } else if (input.setDefault === true && patch.enabled !== false) {
    writeDefaultSetting(store, patch, normalizeModels(patch.models).find(m => m.enabled)?.id);
  }
  return publicProvider(store, patch);
}

export function deleteModelProvider(store, id) {
  const row = getProvider(store, id);
  const setting = store.get('setting', 'model') || {};
  requireValue(setting.defaultProviderId !== row.id, 409, 'DEFAULT_PROVIDER', '请先将默认模型切换到其他服务，再删除当前服务。');
  store.del('modelProvider', row.id);
  return { ok: true };
}

export function setDefaultModelProvider(store, { providerId, model } = {}) {
  const row = getProvider(store, providerId);
  requireValue(row.enabled !== false, 400, 'PROVIDER_DISABLED', '已停用的服务不能设为默认。');
  const models = normalizeModels(row.models);
  const modelId = cleanString(model, 120) || models.find(m => m.enabled)?.id || models[0]?.id;
  requireValue(modelId, 400, 'MODEL_REQUIRED', '请选择默认模型。');
  requireValue(models.some(m => m.id === modelId), 400, 'MODEL_NOT_ALLOWED', '所选型号不在该服务的型号列表中。');
  const apiKey = readApiKey(store, row);
  requireValue(row.provider === 'ollama' || apiKey, 400, 'API_KEY_REQUIRED', '请先为该服务配置 API 密钥。');
  writeDefaultSetting(store, { ...row, sealedApiKey: row.sealedApiKey || (apiKey ? store.seal(apiKey) : null) }, modelId);
  return { model: publicModel(store), provider: publicProvider(store, row) };
}

async function requestChatCompletion(baseUrl, provider, apiKey, body, timeoutMs) {
  const base = await validateEndpoint(baseUrl, provider, { allowInternalModelHosts: true });
  let response;
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch (error) {
    throw failure(502, 'MODEL_UNAVAILABLE', error.name === 'TimeoutError' ? '模型响应超时，请稍后重试。' : '无法连接模型服务，请检查网络及服务地址。');
  }
  if (!response.ok) {
    throw failure(502, response.status === 401 ? 'MODEL_AUTH_FAILED' : response.status === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_SERVICE_ERROR', `模型服务请求失败（HTTP ${response.status}），请检查账户、额度和模型配置。`);
  }
  try { return await response.json(); } catch { throw failure(502, 'MODEL_INVALID_RESPONSE', '模型服务返回格式不正确。'); }
}

export async function testModelProvider(store, id, { model } = {}) {
  const row = getProvider(store, id);
  requireValue(row.enabled !== false, 400, 'PROVIDER_DISABLED', '已停用的服务无法测试。');
  const models = normalizeModels(row.models);
  const modelId = cleanString(model, 120) || models.find(m => m.enabled)?.id || models[0]?.id;
  requireValue(modelId, 400, 'MODEL_REQUIRED', '请先配置至少一个型号。');
  const apiKey = readApiKey(store, row);
  requireValue(row.provider === 'ollama' || apiKey, 400, 'MODEL_NOT_CONFIGURED', '请先配置 API 密钥。');
  const timeoutMs = Math.min(120000, Math.max(5000, Number(row.timeoutMs) || 60000));
  const start = Date.now();
  try {
    const payload = {
      model: modelId,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_tokens: 128,
      temperature: 0,
    };
    try {
      if (new URL(row.baseUrl).hostname === 'api.deepseek.com') payload.thinking = { type: 'disabled' };
    } catch { /* ignore */ }
    const result = await requestChatCompletion(row.baseUrl, row.provider || 'compatible', apiKey, payload, timeoutMs);
    requireValue(!!result.choices?.[0]?.message?.content, 502, 'MODEL_INVALID_RESPONSE', '模型未返回有效内容。');
    const tested = {
      ok: true,
      provider: row.provider,
      model: result.model || modelId,
      latencyMs: Date.now() - start,
      usage: result.usage || null,
      testedAt: now(),
    };
    store.put('modelProvider', {
      ...row,
      status: 'ok',
      lastTestAt: tested.testedAt,
      lastLatencyMs: tested.latencyMs,
      lastError: null,
      lastTestModel: tested.model,
      updatedAt: now(),
    });
    return tested;
  } catch (error) {
    store.put('modelProvider', {
      ...row,
      status: 'error',
      lastTestAt: now(),
      lastLatencyMs: Date.now() - start,
      lastError: error.message || '连接失败',
      lastTestModel: modelId,
      updatedAt: now(),
    });
    throw error;
  }
}

/** Internal credentials used by chat routing. */
export function providerCredentials(store) {
  const rows = ensureModelProviders(store).filter(row => row.enabled !== false);
  return rows.map(row => {
    const models = normalizeModels(row.models).filter(m => m.enabled !== false);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      family: row.family || familyFromHints(row.baseUrl, models[0]?.id, row.kind),
      provider: row.provider || 'compatible',
      baseUrl: row.baseUrl,
      apiKey: readApiKey(store, row),
      models,
      timeoutMs: Math.min(120000, Math.max(5000, Number(row.timeoutMs) || 60000)),
      available: row.provider === 'ollama' || Boolean(readApiKey(store, row)),
    };
  }).filter(row => row.available && row.models.length);
}

export function catalogFromProviders(store) {
  const setting = store.get('setting', 'model') || {};
  const credentials = providerCredentials(store);
  const models = [];
  const seen = new Set();
  for (const provider of credentials) {
    for (const model of provider.models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      models.push({
        id: model.id,
        label: provider.name && provider.name !== model.label ? `${model.label} · ${provider.name}` : model.label,
        family: provider.family,
        providerId: provider.id,
      });
    }
  }
  const current = setting.model || models[0]?.id || '';
  if (current && !models.some(row => row.id === current)) {
    models.unshift({ id: current, label: `当前配置 · ${current}`, family: familyFromHints(setting.baseUrl, current), providerId: setting.defaultProviderId || null });
  }
  const defaultModel = models.some(row => row.id === current) ? current : models[0]?.id || current;
  return { defaultModel, models };
}

export function resolveProviderRoute(store, requestedModel) {
  const credentials = providerCredentials(store);
  const setting = store.get('setting', 'model') || {};
  const wanted = cleanString(requestedModel, 120) || setting.model || '';
  let match = wanted ? credentials.find(row => row.models.some(m => m.id === wanted)) : null;
  if (!match && setting.defaultProviderId) match = credentials.find(row => row.id === setting.defaultProviderId) || null;
  if (!match) match = credentials[0] || null;
  requireValue(match, 400, 'MODEL_NOT_CONFIGURED', '尚未配置可用的模型服务，请到系统管理 → 模型配置中接入。');
  const model = wanted && match.models.some(m => m.id === wanted)
    ? wanted
    : (match.models.find(m => m.id === setting.model)?.id || match.models[0]?.id);
  requireValue(model, 400, 'MODEL_NOT_CONFIGURED', '所选服务尚未配置型号。');
  return {
    model,
    baseUrl: match.baseUrl,
    apiKey: match.apiKey,
    provider: match.provider || 'compatible',
    timeoutMs: match.timeoutMs,
    family: match.family,
    providerId: match.id,
  };
}

/** Keep legacy single-form saves mirrored into the provider registry. */
export function syncProviderFromLegacyModel(store, savedModel) {
  if (!savedModel) return;
  ensureModelProviders(store);
  const setting = store.get('setting', 'model') || {};
  let row = setting.defaultProviderId ? store.get('modelProvider', setting.defaultProviderId) : null;
  if (!row) {
    row = store.list('modelProvider').find(item => item.baseUrl === savedModel.baseUrl)
      || store.list('modelProvider')[0]
      || null;
  }
  if (!row) {
    if (savedModel.provider === 'disabled') return;
    seedProvider(store, {
      kind: familyFromHints(savedModel.baseUrl, savedModel.model) === 'deepseek' ? 'deepseek'
        : familyFromHints(savedModel.baseUrl, savedModel.model) === 'qwen' ? 'qwen'
          : savedModel.provider === 'ollama' ? 'ollama' : 'custom',
      name: savedModel.model ? `当前配置 · ${savedModel.model}` : '默认模型服务',
      provider: savedModel.provider || 'compatible',
      baseUrl: savedModel.baseUrl,
      models: savedModel.model ? [{ id: savedModel.model, label: savedModel.model }] : [],
      apiKey: savedModel.sealedApiKey ? (() => { try { return store.unseal(savedModel.sealedApiKey); } catch { return ''; } })() : '',
      makeDefault: true,
      status: 'untested',
    });
    return;
  }
  const models = normalizeModels(row.models);
  if (savedModel.model && !models.some(m => m.id === savedModel.model)) {
    models.unshift({ id: savedModel.model, label: savedModel.model, enabled: true });
  }
  const next = {
    ...row,
    provider: savedModel.provider || row.provider,
    baseUrl: savedModel.baseUrl || row.baseUrl,
    models,
    timeoutMs: savedModel.timeoutMs || row.timeoutMs,
    updatedAt: now(),
  };
  if (savedModel.sealedApiKey) next.sealedApiKey = savedModel.sealedApiKey;
  if (savedModel.provider === 'disabled') next.enabled = false;
  else next.enabled = true;
  store.put('modelProvider', next);
  if (savedModel.provider !== 'disabled') {
    store.put('setting', { ...setting, id: 'model', defaultProviderId: next.id, model: savedModel.model || setting.model });
  }
}
