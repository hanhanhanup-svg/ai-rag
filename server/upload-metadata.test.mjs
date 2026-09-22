import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './api.mjs';
import { sessionHash } from './security.mjs';

process.env.AUTH_MODE = 'password';
process.env.LOCAL_EMBEDDINGS_ENABLED = 'false';
for (const key of ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'DEEPSEEK_API_KEY', 'AI_API_KEY', 'OPENAI_API_KEY', 'EMBEDDING_API_KEY']) delete process.env[key];

const nativeFetch = globalThis.fetch;
const blockedExternalRequests = [];
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    blockedExternalRequests.push(url.origin);
    throw new Error('External network requests are forbidden in upload metadata tests.');
  }
  return nativeFetch(input, options);
};

async function fixture(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const dir = mkdtempSync(path.join(temporaryRoot, 'xrag-upload-metadata-'));
  const app = await createApp({ dataDir: dir, startWorker: false });
  const store = app.store;
  const admin = { id: 'upload-admin', name: '测试系统管理员', username: 'upload-admin', role: 'admin', active: true, department: '测试资料管理' };
  const editor = { id: 'upload-editor', name: '测试资料维护人', username: 'upload-editor', role: 'editor', active: true, department: '测试资料管理' };
  const viewer = { id: 'upload-viewer', name: '测试资料使用人', username: 'upload-viewer', role: 'viewer', active: true, department: '测试资料管理' };
  for (const user of [admin, editor, viewer]) {
    store.put('user', user);
    store.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sessionHash(user.id), user.id, Date.now() + 600000);
  }
  const base = { id: 'metadata-base', name: '隔离测试知识库', ownerId: admin.id, visibility: 'company', department: admin.department };
  store.put('base', base);
  store.put('setting', { id: 'model', provider: 'disabled', embeddingBaseUrl: 'disabled://tests', embeddingModel: 'none' });
  const server = http.createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const request = async (method, route, body, user = admin) => {
    const response = await fetch(origin + route, {
      method,
      headers: { origin: 'http://localhost:5173', ...(user ? { cookie: 'xrag_session=' + user.id } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  let uploadNumber = 0;
  const upload = (extra = {}, user = editor) => request('POST', '/api/documents', {
    baseId: base.id,
    fileName: '隔离资料_' + (++uploadNumber) + '.txt',
    contentBase64: Buffer.from('【合成测试】资料维护岗位应核对来源与适用范围，本文件用于隔离测试 ' + uploadNumber + '。').toString('base64'),
    duplicateAction: 'copy',
    ...extra,
  }, user);
  const categories = async () => {
    const response = await request('GET', '/api/source-categories');
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  };
  const addCategory = async () => {
    const current = await categories();
    const response = await request('PUT', '/api/source-categories', { revision: current.revision, categories: [...current.categories, { name: '合成培训材料', sourceKind: 'synthetic', enabled: true }] });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return { config: response.data, category: response.data.categories.at(-1) };
  };
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await app.close();
    assert.ok(path.resolve(dir).startsWith(temporaryRoot + path.sep));
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(blockedExternalRequests, [], 'the metadata workflow must not attempt external model or network calls');
  });
  return { app, store, dir, admin, editor, viewer, base, request, upload, categories, addCategory };
}

test('upload metadata stores custom category snapshots, defaults business owner and preserves history through rename and disable', async t => {
  const f = await fixture(t);
  const { config, category } = await f.addCategory();
  assert.match(category.id, /^source_category_/);
  assert.equal(category.builtin, false);
  const uploaded = await f.upload({ sourceCategoryId: category.id });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  let document = uploaded.data.document;
  assert.equal(document.ownerId, f.editor.id);
  assert.equal(document.businessOwner, f.editor.name);
  assert.equal(document.sourceCategoryId, category.id);
  assert.equal(document.sourceCategoryName, '合成培训材料');
  assert.equal(document.sourceKind, 'synthetic');
  await f.app.runQueue();
  document = (await f.request('GET', '/api/documents/' + document.id, undefined, f.editor)).data.document;
  assert.equal(document.status, 'review');
  const renamed = await f.request('PUT', '/api/source-categories', { revision: config.revision, categories: config.categories.map(item => item.id === category.id ? { ...item, name: '模拟岗位练习资料' } : item) });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal((await f.request('GET', '/api/documents/' + document.id, undefined, f.editor)).data.document.sourceCategoryName, '合成培训材料');
  const edited = await f.request('PATCH', '/api/documents/' + document.id, { revision: document.revision, applicability: '仅用于测试岗位的资料核验演练，不构成真实业务依据。' }, f.editor);
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  document = edited.data.document;
  assert.equal(document.sourceCategoryId, category.id);
  assert.equal(document.sourceCategoryName, '合成培训材料');
  assert.equal(document.sourceKind, 'synthetic');
  const newUpload = await f.upload({ sourceCategoryId: category.id, sourceKind: category.sourceKind, businessOwner: '指定测试复核岗位' });
  assert.equal(newUpload.status, 201, JSON.stringify(newUpload.data));
  assert.equal(newUpload.data.document.sourceCategoryName, '模拟岗位练习资料');
  assert.equal(newUpload.data.document.businessOwner, '指定测试复核岗位');
  const disabled = await f.request('PUT', '/api/source-categories', { revision: renamed.data.revision, categories: renamed.data.categories.map(item => item.id === category.id ? { ...item, enabled: false } : item) });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.data));
  const beforeDocumentCount = f.store.list('document').length, beforeFiles = readdirSync(path.join(f.dir, 'uploads')).sort();
  const blocked = await f.upload({ sourceCategoryId: category.id });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error.code, 'SOURCE_CATEGORY_DISABLED');
  assert.equal(f.store.list('document').length, beforeDocumentCount);
  assert.deepEqual(readdirSync(path.join(f.dir, 'uploads')).sort(), beforeFiles);
  const retained = await f.request('PATCH', '/api/documents/' + document.id, { revision: document.revision, sourceCategoryId: category.id, applicability: '停用类别下的旧资料仍可复核其适用范围。' }, f.editor);
  assert.equal(retained.status, 200, JSON.stringify(retained.data));
  assert.equal(retained.data.document.sourceCategoryName, '合成培训材料');
  assert.equal(retained.data.document.sourceKind, 'synthetic');
  assert.equal(f.store.list('modelCall').length, 0);
});

test('source-category HTTP configuration enforces administrator role, optimistic concurrency and semantic matching', async t => {
  const f = await fixture(t), initial = await f.categories();
  for (const user of [f.editor, f.viewer]) {
    const visible = await f.request('GET', '/api/source-categories', undefined, user);
    assert.equal(visible.status, 200);
    assert.equal(visible.data.canManage, false);
    assert.equal((await f.request('PUT', '/api/source-categories', initial, user)).status, 403);
  }
  assert.equal((await f.request('GET', '/api/source-categories', undefined, null)).status, 401);
  const { category } = await f.addCategory();
  assert.equal((await f.request('PUT', '/api/source-categories', initial)).status, 409);
  const rejected = await f.upload({ sourceCategoryId: category.id, sourceKind: 'official_public' });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.error.code, 'SOURCE_CATEGORY_KIND_MISMATCH');
  assert.equal(f.store.list('document').length, 0);
  const defaultUpload = await f.upload({});
  assert.equal(defaultUpload.status, 201, JSON.stringify(defaultUpload.data));
  assert.equal(defaultUpload.data.document.businessOwner, f.editor.name);
  assert.equal(defaultUpload.data.document.sourceCategoryId, 'unspecified');
  assert.equal(defaultUpload.data.document.sourceKind, 'unspecified');
  const blankOwner = await f.upload({ businessOwner: '  ' });
  assert.equal(blankOwner.status, 201);
  assert.equal(blankOwner.data.document.businessOwner, f.editor.name);
  assert.equal((await f.upload({}, f.viewer)).status, 403);
});

test('metadata and governance source-kind edits replace old category mapping while unrelated edits retain it', async t => {
  const f = await fixture(t), { category } = await f.addCategory();
  const uploaded = await f.upload({ sourceCategoryId: category.id });
  assert.equal(uploaded.status, 201);
  await f.app.runQueue();
  let document = (await f.request('GET', '/api/documents/' + uploaded.data.document.id, undefined, f.editor)).data.document;
  let response = await f.request('PATCH', '/api/documents/' + document.id, { revision: document.revision, sourceKind: 'reference', applicability: '仅作为资料核验参考。' }, f.editor);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  document = response.data.document;
  assert.equal(document.sourceKind, 'reference');
  assert.equal(document.sourceCategoryId, 'reference');
  assert.equal(document.sourceCategoryName, '参考资料');
  response = await f.request('POST', '/api/documents/' + document.id + '/actions', { action: 'publish', revision: document.revision }, f.editor);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  document = response.data.document;
  const nextReviewAt = new Date(Date.now() + 365 * 86400000).toISOString();
  response = await f.request('POST', '/api/governance/actions', { documentId: document.id, revision: document.revision, action: 'review', type: 'no_review_date', reason: '复核资料确认为合成培训资料，并保留使用限制。', nextReviewAt, sourceCategoryId: category.id }, f.editor);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  document = response.data.document;
  assert.equal(document.sourceKind, 'synthetic');
  assert.equal(document.sourceCategoryId, category.id);
  assert.equal(document.sourceCategoryName, category.name);
  response = await f.request('POST', '/api/governance/actions', { documentId: document.id, revision: document.revision, action: 'review', type: 'review_due', reason: '更新复核结论，来源类别保持原记录。', nextReviewAt, applicability: '仅供隔离测试演练。' }, f.editor);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.document.sourceCategoryId, category.id);
  assert.equal(response.data.document.sourceCategoryName, category.name);
  assert.equal(response.data.document.sourceKind, 'synthetic');
});
