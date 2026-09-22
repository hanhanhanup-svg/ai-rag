/**
 * Apply Tongyi Qwen (DashScope) as the active chat / upload-guidance model.
 * Usage: node --env-file-if-exists=.env.local scripts/configure-qwen-model.mjs
 * Stop the API writer first if the data directory is locked.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../server/database.mjs';
import { modelConfig, testModel } from '../server/retrieval.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
const apiKey = (process.env.AI_API_KEY || process.env.DASHSCOPE_API_KEY || '').trim();
const baseUrl = (process.env.AI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
const model = process.env.AI_MODEL || 'qwen3.8-max';

if (!apiKey) {
  console.error('Missing AI_API_KEY / DASHSCOPE_API_KEY');
  process.exit(1);
}

const store = createStore(dataDir);
try {
  const old = store.get('setting', 'model') || { id: 'model' };
  const next = {
    ...old,
    id: 'model',
    provider: 'compatible',
    baseUrl,
    model,
    timeoutMs: Math.max(Number(old.timeoutMs) || 0, 90000),
    // Prefer sealed key so UI shows hasApiKey; env remains backup after restart.
    sealedApiKey: store.seal(apiKey),
  };
  store.put('setting', next);
  const cfg = modelConfig(store);
  console.log(JSON.stringify({
    saved: true,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasApiKey: !!cfg.apiKey,
    timeoutMs: cfg.timeoutMs,
  }, null, 2));
  try {
    const result = await testModel(store);
    console.log('connection_test', result);
  } catch (error) {
    console.error('connection_test_failed', error.code || error.name, error.message);
    process.exitCode = 2;
  }
} finally {
  store.close();
}
