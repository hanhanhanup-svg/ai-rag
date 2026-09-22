import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from './api.mjs';
import { embeddingSignature, modelConfig } from './retrieval.mjs';

const vectorFor = text => [text.length, [...text].reduce((sum, character) => sum + character.codePointAt(0), 0)];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function waitFor(predicate, message) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) { const result = predicate(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 15)); }
  assert.fail(message);
}

async function fixture(t, { startWorker = false } = {}) {
  const keys = ['AUTH_MODE', 'API_HOST', 'LOCAL_EMBEDDINGS_ENABLED', 'AI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'EMBEDDING_API_KEY', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];
  const oldEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.AUTH_MODE = 'local'; process.env.API_HOST = '127.0.0.1'; process.env.LOCAL_EMBEDDINGS_ENABLED = 'false';
  for (const key of keys.slice(3)) delete process.env[key];
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'x-rag-index-automation-'));
  const requests = [], service = { behavior: null };
  const model = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    assert.equal(req.url, '/v1/embeddings');
    const reply = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: body.input.map((text, index) => ({ index, embedding: vectorFor(text) })), usage: { prompt_tokens: 10, completion_tokens: 0 } })); };
    const reject = (status = 503) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end('{}'); };
    if (service.behavior) await service.behavior({ body, reply, reject }); else reply();
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const originalFetch = globalThis.fetch;
  let deniedNetworkRequests = 0;
  globalThis.fetch = (url, options) => {
    const target = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
    if (target.hostname !== '127.0.0.1') { deniedNetworkRequests++; throw Error('External network is forbidden in index automation tests.'); }
    return originalFetch(url, options);
  };
  const app = await createApp({ dataDir: tempRoot, startWorker });
  app.store.put('setting', { id: 'model', provider: 'ollama', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'unused-test-chat', embeddingBaseUrl: `http://127.0.0.1:${model.address().port}/v1`, embeddingModel: 'test-embedding', timeoutMs: 5000 });
  const server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, route, input) => {
    const res = await fetch(baseUrl + route, { method, headers: { origin: 'http://localhost:5173', ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: res.status, data: await res.json() };
  };
  const base = app.store.list('base')[0], user = app.store.list('user')[0];
  const upload = async text => {
    const result = await request('POST', '/api/documents', { baseId: base.id, fileName: '自动索引合成测试.txt', contentBase64: Buffer.from(text).toString('base64'), sourceKind: 'synthetic', duplicateAction: 'copy' });
    assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data.document;
  };
  const patch = async (id, text) => {
    const current = app.store.get('document', id), chunk = app.store.chunks(id)[0];
    const result = await request('PATCH', '/api/documents/' + id, { revision: current.revision, chunks: [{ id: chunk.id, text }] });
    assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data.document;
  };
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await app.close(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    assert.ok(path.resolve(tempRoot).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(tempRoot, { recursive: true, force: true });
    assert.equal(deniedNetworkRequests, 0, 'The test must never attempt an external network request.');
  });
  return { app, service, requests, request, upload, patch, base, user };
}

test('HTTP upload and corrected text automatically reach ready without a rebuild request', async t => {
  const f = await fixture(t, { startWorker: true });
  const uploaded = await f.upload('合成测试：设备日常巡检应记录时间、设备编码和检查结果。');
  await waitFor(() => { const document = f.app.store.get('document', uploaded.id); return document.status === 'review' && document.embeddingStatus === 'ready'; }, 'Upload did not automatically produce a semantic index.');
  const corrected = '合成测试校对：设备巡检记录应补充核对人员和异常处置记录。';
  const edited = await f.patch(uploaded.id, corrected);
  await waitFor(() => { const document = f.app.store.get('document', edited.id); return document.embeddingStatus === 'ready' && f.requests.some(body => body.input.includes(corrected)); }, 'Corrected text was not automatically indexed.');
  assert.deepEqual(f.app.store.vectors([edited.id], embeddingSignature(modelConfig(f.app.store)))[0].vector, vectorFor(corrected));
  assert.equal(f.app.store.events(100).filter(event => event.action === 'document.reindex_requested').length, 0);
});

test('temporary parse-time indexing failure is retried by the background policy, then clears stale warnings', async t => {
  const f = await fixture(t);
  f.service.behavior = ({ reject }) => reject();
  const uploaded = await f.upload('合成测试：培训资料应登记学习主题和核对依据。');
  await f.app.runQueue();
  let document = f.app.store.get('document', uploaded.id);
  assert.equal(document.status, 'review'); assert.equal(document.embeddingStatus, 'failed'); assert.equal(document.embeddingRetry.failures, 1);
  assert.ok(document.warnings.some(warning => warning.startsWith('语义索引未完成')));
  f.app.backfillIndexes();
  assert.equal(f.app.store.list('task').filter(task => task.type === 'index').length, 0, 'Backoff must prevent immediate repeat calls.');
  f.app.store.put('document', { ...document, embeddingRetry: { ...document.embeddingRetry, nextAttemptAt: new Date(Date.now() - 1).toISOString() } });
  f.service.behavior = null;
  f.app.backfillIndexes(); await f.app.runQueue();
  document = f.app.store.get('document', uploaded.id);
  assert.equal(document.embeddingStatus, 'ready'); assert.equal(document.embeddingRetry, null);
  assert.equal(document.warnings.some(warning => warning.startsWith('语义索引未完成')), false);
  assert.equal(f.requests.length, 2);
  assert.equal(f.app.store.list('task').find(task => task.type === 'index').status, 'succeeded');
});

test('three failed attempts exhaust the budget; corrected model settings automatically reset it', async t => {
  const f = await fixture(t);
  f.service.behavior = ({ reject }) => reject();
  const uploaded = await f.upload('合成测试：交接资料按事项登记处理状态。'); await f.app.runQueue();
  for (const attempt of [2, 3]) {
    const document = f.app.store.get('document', uploaded.id);
    f.app.store.put('document', { ...document, embeddingRetry: { ...document.embeddingRetry, nextAttemptAt: new Date(Date.now() - 1).toISOString() } });
    f.app.backfillIndexes(); await f.app.runQueue();
    assert.equal(f.app.store.get('document', uploaded.id).embeddingRetry.failures, attempt);
  }
  const failed = f.app.store.get('document', uploaded.id); assert.equal(failed.embeddingRetry.exhausted, true);
  for (let check = 0; check < 4; check++) { f.app.backfillIndexes(); await f.app.runQueue(); }
  assert.equal(f.requests.length, 3);
  assert.ok(f.app.store.list('task').filter(task => task.type === 'index').every(task => task.status === 'failed'));
  const settings = await f.request('PUT', '/api/settings', { model: { embeddingApiKey: 'test-only-updated-credential' } });
  assert.equal(settings.status, 200); assert.equal(f.app.store.get('document', uploaded.id).embeddingRetry, null);
  f.service.behavior = null; f.app.backfillIndexes(); await f.app.runQueue();
  assert.equal(f.app.store.get('document', uploaded.id).embeddingStatus, 'ready'); assert.equal(f.requests.length, 4);
});

for (const obsoleteFailure of [false, true]) test(`late ${obsoleteFailure ? 'failed' : 'successful'} model response cannot overwrite corrected content or its status`, async t => {
  const f = await fixture(t);
  const uploaded = await f.upload('合成原始内容：维修记录包含设备编码。'); await f.app.runQueue();
  const firstText = '合成第一轮校对内容：增加故障类型。', latestText = '合成最新校对内容：增加复核时间与处理结果。';
  await f.patch(uploaded.id, firstText);
  const arrived = deferred(), release = deferred();
  f.service.behavior = async ({ body, reply, reject }) => {
    if (body.input.includes(firstText)) { arrived.resolve(); await release.promise; if (obsoleteFailure) reject(); else reply(); }
    else reply();
  };
  const writes = [], originalEmbedding = f.app.store.embedding;
  f.app.store.embedding = (id, vector, signature) => { writes.push(vector); originalEmbedding(id, vector, signature); };
  const work = f.app.runQueue(); await arrived.promise;
  await f.patch(uploaded.id, latestText);
  assert.equal(f.app.store.vectorCount(uploaded.id, embeddingSignature(modelConfig(f.app.store))), 0);
  release.resolve(); await work;
  const document = f.app.store.get('document', uploaded.id);
  assert.equal(document.embeddingStatus, 'ready'); assert.equal(document.embeddingError, null);
  assert.deepEqual(writes, [vectorFor(latestText)], 'No vector for the outdated text may be committed, even temporarily.');
  assert.equal(f.app.store.chunks(uploaded.id)[0].text, latestText);
  assert.ok(f.app.store.list('task').some(task => task.type === 'index' && task.errorCode === 'INDEX_INPUT_CHANGED'));
});

test('an in-flight model response cannot commit after credentials change even with the same vector signature', async t => {
  const f = await fixture(t);
  const uploaded = await f.upload('合成原文：知识核对需保留依据。'); await f.app.runQueue();
  await f.patch(uploaded.id, '合成校对内容：知识核对应补充来源和日期。');
  const arrived = deferred(), release = deferred(); let first = true;
  f.service.behavior = async ({ reply }) => { if (first) { first = false; arrived.resolve(); await release.promise; } reply(); };
  const work = f.app.runQueue(); await arrived.promise;
  const beforeSignature = embeddingSignature(modelConfig(f.app.store));
  const changed = await f.request('PUT', '/api/settings', { model: { embeddingApiKey: 'test-only-rotated-credential' } }); assert.equal(changed.status, 200);
  assert.equal(embeddingSignature(modelConfig(f.app.store)), beforeSignature);
  release.resolve(); await work;
  assert.equal(f.app.store.get('document', uploaded.id).embeddingStatus, 'ready');
  assert.ok(f.app.store.list('task').some(task => task.errorCode === 'INDEX_INPUT_CHANGED'));
  assert.equal(f.requests.length, 3, 'Initial parse plus old and current indexing attempts should be visible.');
});
