import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { createRequire } from 'node:module';

// Chinese bge-small has 512 dimensions. The English small model has 384.
export const LOCAL_MODEL_REPOSITORY = 'Xenova/bge-small-zh-v1.5';
export const LOCAL_MODEL_REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781';
export const LOCAL_MODEL_DIMENSIONS = 512;
export const LOCAL_MODEL_ID = `local:${LOCAL_MODEL_REPOSITORY}@${LOCAL_MODEL_REVISION}:q8:cls:l2:v1`;
export const LOCAL_QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';
export const LOCAL_MODEL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');
export const LOCAL_MODEL_DIRECTORY = path.join(LOCAL_MODEL_ROOT, ...LOCAL_MODEL_REPOSITORY.split('/'));
const REQUIRED_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
const MANIFEST_PATH = path.join(LOCAL_MODEL_DIRECTORY, 'manifest.json');
const require = createRequire(import.meta.url);
let verifiedFingerprint = '', verifiedAvailable = false, runtimeError = '', extractorPromise = null;
let inferenceQueue = Promise.resolve();

function modelFailure(message, code = 'LOCAL_EMBEDDING_UNAVAILABLE') { return Object.assign(new Error(message), { code }); }

/** Availability requires installed runtime, a pinned manifest, and verified local file hashes. No network calls. */
export function localEmbeddingAvailable() {
  try {
    require.resolve('@huggingface/transformers');
    if (!existsSync(MANIFEST_PATH)) return false;
    const manifestStat = statSync(MANIFEST_PATH);
    const fingerprints = REQUIRED_FILES.map(name => { const stat = statSync(path.join(LOCAL_MODEL_DIRECTORY, name)); return `${name}:${stat.size}:${stat.mtimeMs}`; });
    const fingerprint = `${manifestStat.size}:${manifestStat.mtimeMs}:${fingerprints.join('|')}`;
    if (fingerprint === verifiedFingerprint) return verifiedAvailable;
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (manifest.repository !== LOCAL_MODEL_REPOSITORY || manifest.revision !== LOCAL_MODEL_REVISION || manifest.dimensions !== LOCAL_MODEL_DIMENSIONS) return false;
    for (const name of REQUIRED_FILES) {
      const entry = manifest.files?.find(file => file.path === name);
      if (!entry?.sha256 || !/^[a-f0-9]{64}$/.test(entry.sha256)) return false;
      const contents = readFileSync(path.join(LOCAL_MODEL_DIRECTORY, name));
      if (contents.length !== entry.size || createHash('sha256').update(contents).digest('hex') !== entry.sha256) return false;
    }
    verifiedFingerprint = fingerprint; verifiedAvailable = true;
    return true;
  } catch { return false; }
}

export function localEmbeddingInfo() {
  return { available: localEmbeddingAvailable(), model: LOCAL_MODEL_ID, modelId: LOCAL_MODEL_ID, repository: LOCAL_MODEL_REPOSITORY, revision: LOCAL_MODEL_REVISION, dimensions: LOCAL_MODEL_DIMENSIONS, pooling: 'cls', normalized: true, dtype: 'q8', device: 'cpu', offline: true, modelPath: LOCAL_MODEL_DIRECTORY, loaded: Boolean(extractorPromise), runtimeError: runtimeError || null, queryInstruction: LOCAL_QUERY_PREFIX, maxTokens: 512 };
}

async function extractor() {
  if (!localEmbeddingAvailable()) throw modelFailure('本地中文语义模型尚未准备完整或校验失败，请先运行 npm run model:prepare。');
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers');
      // These settings apply before model loading and remain strict during every inference.
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = LOCAL_MODEL_ROOT + path.sep;
      env.useBrowserCache = false;
      env.useFSCache = false;
      const model = await pipeline('feature-extraction', LOCAL_MODEL_REPOSITORY, {
        local_files_only: true, dtype: 'q8', device: 'cpu',
        session_options: { intraOpNumThreads: Math.max(1, Math.min(4, availableParallelism())), interOpNumThreads: 1, executionMode: 'sequential' },
      });
      runtimeError = '';
      return model;
    })().catch(error => { extractorPromise = null; runtimeError = error.message || '本地模型加载失败'; throw modelFailure(`本地中文语义模型加载失败：${runtimeError}`, 'LOCAL_EMBEDDING_LOAD_FAILED'); });
  }
  return extractorPromise;
}

/** Documents use plain text; short retrieval questions use the official BGE Chinese query instruction. */
export function localEmbeddings(texts, { query = false } = {}) {
  if (!Array.isArray(texts) || texts.length > 2048 || texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 200000)) return Promise.reject(modelFailure('语义向量输入必须为 1–2048 条有效文本，每条最多 200000 字符。', 'INVALID_EMBEDDING_INPUT'));
  if (!texts.length) return Promise.resolve([]);
  const copied = texts.map(text => (query ? LOCAL_QUERY_PREFIX : '') + text);
  // Serialize CPU work across callers; bounded batches avoid multiplying ONNX memory usage.
  const task = inferenceQueue.then(async () => {
    const extract = await extractor(), vectors = [];
    for (let index = 0; index < copied.length; index += 8) {
      const batch = copied.slice(index, index + 8);
      const output = await extract(batch, { pooling: 'cls', normalize: true });
      try {
        const rows = output.tolist();
        if (!Array.isArray(rows) || rows.length !== batch.length) throw modelFailure('本地语义模型返回了无效的向量数量。', 'INVALID_EMBEDDING_OUTPUT');
        for (const row of rows) {
          if (!Array.isArray(row) || row.length !== LOCAL_MODEL_DIMENSIONS || row.some(value => !Number.isFinite(value))) throw modelFailure('本地语义模型返回的向量维度或数值无效。', 'INVALID_EMBEDDING_OUTPUT');
          const norm = Math.hypot(...row);
          if (!(norm > 0)) throw modelFailure('本地语义向量为空。', 'INVALID_EMBEDDING_OUTPUT');
          vectors.push(row.map(value => value / norm));
        }
      } finally { await output.dispose?.(); }
    }
    return vectors;
  });
  inferenceQueue = task.then(() => undefined, () => undefined);
  return task;
}
