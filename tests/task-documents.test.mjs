import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createApp } from '../server/api.mjs';

const ORIGIN = 'http://localhost:5173';
const ENV_KEYS = ['AUTH_MODE', 'API_HOST', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_NAME', 'LOCAL_EMBEDDINGS_ENABLED', 'EMBEDDING_BASE_URL', 'EMBEDDING_MODEL', 'EMBEDDING_API_KEY', 'ALLOWED_ORIGINS'];

async function fixture(run) {
  const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xrag-task-documents-'));
  let app, server;
  process.env.AUTH_MODE = 'local';
  process.env.API_HOST = '127.0.0.1';
  process.env.LOCAL_EMBEDDINGS_ENABLED = 'false';
  process.env.ALLOWED_ORIGINS = ORIGIN;
  for (const key of ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_NAME', 'EMBEDDING_BASE_URL', 'EMBEDDING_MODEL', 'EMBEDDING_API_KEY']) delete process.env[key];
  try {
    app = await createApp({ dataDir: dir, startWorker: false });
    app.store.put('setting', { id: 'model', provider: 'disabled' });
    assert.equal(path.resolve(app.store.dataDir), path.resolve(dir));
    server = http.createServer(app.handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const request = (method, route, { body, origin = ORIGIN } = {}) => new Promise((resolve, reject) => {
      const headers = body === undefined ? {} : { 'content-type': 'application/json', ...(origin === null ? {} : { origin }) };
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()), headers: res.headers }); }
          catch (error) { reject(error); }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
    const bases = await request('GET', '/api/bases');
    assert.equal(bases.status, 200);
    const baseId = bases.data.bases[0].id;
    const upload = async (title, { publish = true } = {}) => {
      let response = await request('POST', '/api/documents', { body: {
        baseId, title, fileName: title + '.txt', duplicateAction: 'copy',
        contentBase64: Buffer.from(title + '。本文记录设备编号、维修日期和核对依据，仅用于接口测试。').toString('base64'),
      } });
      assert.equal(response.status, 201);
      const id = response.data.document.id;
      await app.runQueue();
      if (publish) {
        response = await request('POST', '/api/documents/' + id + '/actions', { body: { action: 'publish' } });
        assert.equal(response.status, 200);
      }
      response = await request('GET', '/api/documents/' + id);
      assert.equal(response.status, 200);
      assert.ok(response.data.chunks.length > 0);
      return response.data;
    };
    await run({ app, request, upload });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (app) await app.close();
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(dir, { recursive: true, force: true });
  }
}

const taskLink = (documentId, extra = {}) => ({
  documentId, scenario: 'maintenance', task: '设备台账核对',
  reason: '用于核对设备台账中的编号与维修记录。', status: 'approved', ...extra,
});

test('task document picker exposes local admin maintenance permissions and current publication availability', async () => fixture(async ({ app, request, upload }) => {
  const actor = await request('GET', '/api/auth/me');
  assert.equal(actor.status, 200);
  assert.equal(actor.data.user.role, 'admin');
  assert.equal(actor.data.user.authMode, 'local');
  assert.equal(actor.headers['set-cookie'], undefined);
  const valid = await upload('设备台账有效资料');
  const review = await upload('设备台账待审核资料', { publish: false });
  const expired = await upload('设备台账失效资料');
  // Simulate expiry after publication in this isolated fixture, without waiting for a wall clock boundary.
  const expiredDoc = app.store.get('document', expired.document.id);
  app.store.put('document', { ...expiredDoc, expiresAt: '2000-01-01T00:00:00.000Z' });
  const response = await request('GET', '/api/documents?limit=100');
  assert.equal(response.status, 200);
  const documents = new Map(response.data.documents.map(document => [document.id, document]));
  for (const item of [valid, review, expired]) assert.equal(documents.get(item.document.id).canManage, true);
  assert.equal(documents.get(valid.document.id).status, 'published');
  assert.equal(documents.get(valid.document.id).retrievable, true);
  assert.equal(documents.get(review.document.id).retrievable, false);
  assert.equal(documents.get(expired.document.id).retrievable, false);
  for (const item of [review, expired]) {
    const rejected = await request('POST', '/api/recommendation-links', { body: taskLink(item.document.id) });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.data.error.code, 'LINK_DOCUMENT_UNAVAILABLE');
  }
  assert.deepEqual((await request('GET', '/api/recommendation-links')).data.links, []);
}));

test('task documents can be configured together, listed, edited and disabled through the real API without duplicates or stale overwrites', async () => fixture(async ({ request, upload }) => {
  const documents = [await upload('设备台账字段说明'), await upload('设备维修记录说明')];
  const saved = [];
  for (const { document, chunks } of documents) {
    const response = await request('POST', '/api/recommendation-links', { body: taskLink(document.id, { chunkIds: [chunks[0].id] }) });
    assert.equal(response.status, 200);
    assert.equal(response.data.link.revision, 1);
    saved.push(response.data.link);
  }
  let response = await request('GET', '/api/recommendation-links');
  assert.equal(response.status, 200);
  assert.equal(response.data.links.length, 2);
  for (const link of response.data.links) {
    const source = documents.find(item => item.document.id === link.documentId).document;
    assert.equal(link.title, source.title);
    assert.equal(link.documentVersion, source.version);
    assert.equal(link.documentStatus, 'published');
    assert.equal(link.documentRetrievable, true);
    assert.equal(link.canManage, true);
    assert.equal(link.stale, false);
  }
  response = await request('POST', '/api/recommendation-links', { body: taskLink(saved[0].documentId) });
  assert.equal(response.status, 409);
  assert.equal(response.data.error.code, 'LINK_ALREADY_EXISTS');
  response = await request('POST', '/api/recommendation-links', { body: { ...saved[0], reason: '核对设备编号、规格和当前检修状态。' } });
  assert.equal(response.status, 200);
  const edited = response.data.link;
  assert.equal(edited.id, saved[0].id);
  assert.equal(edited.revision, 2);
  assert.deepEqual(edited.chunkIds, saved[0].chunkIds);
  response = await request('POST', '/api/recommendation-links', { body: { ...saved[0], reason: '旧页面提交的用途不得覆盖新内容。' } });
  assert.equal(response.status, 409);
  assert.equal(response.data.error.code, 'REVISION_CONFLICT');
  assert.equal((await request('GET', '/api/recommendation-links')).data.links.find(link => link.id === edited.id).reason, edited.reason);
  const recommendationsRoute = '/api/recommendations?' + new URLSearchParams({ scenario: 'maintenance', task: '设备台账核对' });
  response = await request('GET', recommendationsRoute);
  assert.equal(response.status, 200);
  for (const link of saved) assert.ok(response.data.items.find(item => item.documentId === link.documentId).reasonCodes.includes('reviewed_task_link'));
  const archived = await request('POST', '/api/documents/' + edited.documentId + '/actions', { body: { action: 'archive', reason: '接口测试：资料下架后停止任务关联。' } });
  assert.equal(archived.status, 200);
  response = await request('GET', '/api/recommendation-links');
  const unavailable = response.data.links.find(link => link.id === edited.id);
  assert.equal(unavailable.documentStatus, 'archived');
  assert.equal(unavailable.documentRetrievable, false);
  assert.equal(unavailable.stale, true);
  response = await request('POST', '/api/recommendation-links', { body: { ...edited, chunkIds: [], status: 'disabled' } });
  assert.equal(response.status, 200);
  const disabled = response.data.link;
  assert.equal(disabled.revision, 3);
  assert.equal(disabled.documentSignature, edited.documentSignature);
  assert.deepEqual(disabled.chunkIds, edited.chunkIds);
  response = await request('POST', '/api/recommendation-links', { body: taskLink(edited.documentId, { status: 'disabled' }) });
  assert.equal(response.status, 409);
  assert.equal(response.data.error.code, 'LINK_ALREADY_EXISTS');
  response = await request('GET', '/api/recommendation-links');
  assert.equal(response.data.links.length, 2);
  assert.equal(response.data.links.find(link => link.id === disabled.id).status, 'disabled');
  assert.equal(response.data.links.find(link => link.id === saved[1].id).status, 'approved');
  response = await request('GET', recommendationsRoute);
  assert.deepEqual(response.data.items.map(item => item.documentId), [saved[1].documentId]);
  assert.ok(response.data.items[0].reasonCodes.includes('reviewed_task_link'));
}));

test('task document configuration requires an allowed browser Origin even in local access mode', async () => fixture(async ({ request, upload }) => {
  const { document } = await upload('设备资料来源校验');
  const body = taskLink(document.id);
  let response = await request('POST', '/api/recommendation-links', { body, origin: null });
  assert.equal(response.status, 403);
  assert.equal(response.data.error.code, 'ORIGIN_REQUIRED');
  response = await request('POST', '/api/recommendation-links', { body, origin: 'http://localhost:5999' });
  assert.equal(response.status, 403);
  assert.equal(response.data.error.code, 'ORIGIN_DENIED');
  assert.deepEqual((await request('GET', '/api/recommendation-links')).data.links, []);
  response = await request('POST', '/api/recommendation-links', { body });
  assert.equal(response.status, 200);
  assert.equal((await request('GET', '/api/recommendation-links')).data.links.length, 1);
}));
