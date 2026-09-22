/**
 * Apply DeepSeek as the active chat / upload-guidance model.
 * Usage: node --env-file-if-exists=.env.local scripts/configure-deepseek-model.mjs
 * Stop the API writer first if the data directory is locked.
 * Vision OCR still uses DashScope (DASHSCOPE_API_KEY / AI_VISION_MODEL) when available.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../server/database.mjs';
import { modelConfig, testModel } from '../server/retrieval.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
const apiKey = (process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || '').trim();
const baseUrl = (process.env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const model = process.env.AI_MODEL || 'deepseek-v4-flash';

if (!apiKey) {
  console.error('Missing DEEPSEEK_API_KEY / AI_API_KEY');
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
