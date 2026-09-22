import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createApp } from './api.mjs';
import { sessionHash } from './security.mjs';
import { learnFeedback } from './feedback-learning.mjs';
import { knowledgeInterfaceEvidenceWithinBase } from './knowledge-interfaces.mjs';

async function fixture(t, { local = false } = {}) {
  const saved = { ...process.env }, directory = mkdtempSync(path.join(os.tmpdir(), 'xrag-knowledge-interface-'));
  for (const key of ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'AI_API_KEY', 'EMBEDDING_API_KEY', 'MODEL_ALLOWED_HOSTS']) delete process.env[key];
  Object.assign(process.env, { AUTH_MODE: local ? 'local' : 'password', API_HOST: '127.0.0.1', LOCAL_EMBEDDINGS_ENABLED: 'false', ALLOWED_ORIGINS: 'http://localhost:5173' });
  const app = await createApp({ dataDir: directory, startWorker: false });
  app.store.put('setting', { id: 'model', provider: 'disabled', embeddingBaseUrl: '', embeddingModel: '' });
  const users = { admin: { id: 'admin', name: '接口管理员', username: 'interface-admin', role: 'admin', active: true, department: '运维' }, editor: { id: 'editor', name: '维护人', username: 'interface-editor', role: 'editor', active: true, department: '运维' }, viewer: { id: 'viewer', name: '查看人', username: 'interface-viewer', role: 'viewer', active: true, department: '运维' } };
  const cookies = {};
  for (const user of Object.values(users)) { app.store.put('user', user); const token = crypto.randomBytes(24).toString('hex'); cookies[user.id] = 'xrag_session=' + token; app.store.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sessionHash(token), user.id, Date.now() + 600000); }
  const base = app.store.put('base', { id: 'interface-base', name: '设备维修知识库', visibility: 'company', ownerId: users.admin.id, members: [], createdAt: new Date().toISOString() });
  const other = app.store.put('base', { ...base, id: 'other-base', name: '其他授权范围' });
  let serial = 0;
  function document(text = '设备台账核对要求：核对设备编号、车站和核对人员，并保留核对日期。', patch = {}) {
    const id = 'interface-doc-' + ++serial, bytes = Buffer.from(text), timestamp = new Date().toISOString();
    const doc = app.store.put('document', { id, familyId: id, baseId: base.id, ownerId: users.admin.id, title: '设备台账核对要求', fileName: id + '.txt', storageName: id + '.txt', mimeType: 'text/plain', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), version: 1, revision: 1, contentRevision: 1, status: 'published', stage: '已发布', sensitivity: 'internal', chunkCount: 1, pageCount: 1, sourceKind: 'synthetic', applicability: '隔离测试资料', tags: [], summary: '设备台账核对要求', notes: [], warnings: [], createdAt: timestamp, updatedAt: timestamp, ...patch });
    writeFileSync(path.join(directory, 'uploads', doc.storageName), bytes);
    app.store.replaceChunks(id, [{ id: id + '-chunk', documentId: id, ordinal: 0, page: 1, text }]); return doc;
  }
  const server = http.createServer(app.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const nativeFetch = globalThis.fetch, origin = 'http://127.0.0.1:' + server.address().port;
  async function request(method, route, body, { user = users.admin, secret, headers = {} } = {}) {
    const response = await nativeFetch(origin + route, { method, headers: { ...(user ? { cookie: cookies[user.id] } : {}), origin: 'http://localhost:5173', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(secret ? { authorization: 'Bearer ' + secret } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null, text };
  }
  function rawRequest(method, route, body, headers = {}) {
    const text = JSON.stringify(body), request = http.request(origin + route, { method, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), origin: 'http://localhost:5173', ...headers } });
    const result = new Promise((resolve, reject) => { request.on('response', response => { const parts = []; response.on('data', part => parts.push(part)); response.on('end', () => { const raw = Buffer.concat(parts).toString(); resolve({ status: response.statusCode, data: JSON.parse(raw), text: raw }); }); }); request.on('error', reject); });
    return { request, result, text };
  }
  const publish = (patch = {}, user = users.admin) => request('POST', '/api/knowledge-interfaces', { name: '设备台账问答接口', baseId: base.id, scenario: 'maintenance', task: '设备台账核对', object: '设备台账', days: 90, ...patch }, { user });
  const call = (published, question = '设备台账核对要求是什么？', patch = {}) => request('POST', published.interface.endpoint, { question, ...patch }, { user: null, secret: published.secret });
  t.after(async () => { globalThis.fetch = nativeFetch; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.close(); for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(directory, { recursive: true, force: true }); });
  return { app, store: app.store, directory, users, base, other, document, request, rawRequest, cookies, publish, call, nativeFetch, origin };
}
const code = result => result.data?.error?.code;

function delayedModel(f, t) {
  let started, release;
  const entered = new Promise(resolve => { started = resolve; }), released = new Promise(resolve => { release = resolve; });
  let body;
  f.store.put('setting', { id: 'model', provider: 'ollama', baseUrl: 'http://127.0.0.1:19999/v1', model: 'isolated-test', embeddingBaseUrl: '', embeddingModel: '' });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('127.0.0.1:19999/v1/chat/completions')) {
      body = JSON.parse(options.body); started(); await released;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: '设备台账核对需要登记设备编号、车站和核对人员。[1]', citations: [1], graphPathIds: [] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return f.nativeFetch(url, options);
  };
  t.after(() => { release(); globalThis.fetch = oldFetch; });
  return { entered, release, get body() { return body; } };
}

test('admin publishes a fixed-base standard API with one-time independent secret and valid OpenAPI', async t => {
  const f = await fixture(t), source = f.document();
  f.document('外部机密标记不得进入绑定知识库回答。', { baseId: f.other.id, title: '其他范围机密' });
  for (const user of [f.users.editor, f.users.viewer]) {
    assert.equal((await f.publish({}, user)).status, 403);
    assert.equal((await f.request('GET', '/api/knowledge-interfaces', undefined, { user })).status, 403);
  }
  const created = await f.publish(); assert.equal(created.status, 201, created.text);
  const published = created.data, row = published.interface;
  assert.match(published.secret, /^ki_[A-Za-z0-9_-]+$/); assert.equal(row.method, 'POST'); assert.equal(row.scenarioLabel, '设备维修'); assert.equal(row.revision, 1);
  const persisted = f.store.get('knowledgeInterface', row.id); assert.equal(persisted.secretHash, crypto.createHash('sha256').update(published.secret).digest('hex')); assert.ok(!JSON.stringify(persisted).includes(published.secret));
  const list = await f.request('GET', '/api/knowledge-interfaces'); assert.equal(list.data.interfaces.length, 1); assert.ok(!list.text.includes('secretHash')); assert.ok(!list.text.includes(published.secret));
  const schema = await f.request('GET', '/api/knowledge-interfaces/' + row.id + '/openapi', undefined, { headers: { host: 'untrusted.example' } });
  assert.equal(schema.data.openapi, '3.0.3'); assert.equal(schema.data.servers[0].url, '/'); assert.equal(schema.data.paths[row.endpoint].post.requestBody.content['application/json'].schema.additionalProperties, false); assert.ok(!schema.text.includes(published.secret)); assert.ok(!schema.text.includes('untrusted.example'));
  const answer = await f.call(published); assert.equal(answer.status, 200, answer.text); assert.equal(answer.data.mode, 'extractive'); assert.ok(answer.data.citations.some(ref => ref.documentId === source.id)); assert.ok(answer.data.citations.every(ref => ref.baseId === f.base.id)); assert.ok(!answer.text.includes('外部机密标记')); assert.ok(!answer.text.includes('learningEvidenceRefs')); assert.ok(!answer.text.includes('traceId'));
  const after = (await f.request('GET', '/api/knowledge-interfaces')).data.interfaces[0]; assert.equal(after.calls, 1); assert.ok(after.lastUsedAt); assert.equal(after.revision, 1);
  assert.ok(!JSON.stringify(f.store.events(100)).includes(published.secret));
  assert.equal((await f.request('POST', '/api/service/answer', { baseId: f.base.id, question: '设备台账核对要求' }, { user: null, secret: published.secret })).status, 401);
});

test('configuration validates base, scenario-task catalog, expiry and prevents caller overrides', async t => {
  const f = await fixture(t); f.document(); f.store.put('base', { ...f.base, id: 'system-base', systemKind: 'feedback_learning' });
  for (const patch of [{ baseId: 'missing' }, { baseId: 'system-base' }]) assert.equal((await f.publish(patch)).status, 403);
  assert.equal(code(await f.publish({ scenario: 'invented' })), 'INVALID_SCENARIO');
  for (const patch of [{ scenario: 'training', task: '设备台账核对' }, { scenario: '', task: '设备台账核对' }, { task: '' }]) assert.equal(code(await f.publish(patch)), 'INVALID_TASK');
  for (const days of [0, -1, 366, 1.5, '90']) assert.equal(code(await f.publish({ days })), 'INVALID_DAYS');
  assert.equal(code(await f.publish({ object: 'x'.repeat(201) })), 'INVALID_OBJECT');
  const created = await f.publish({ scenario: '', task: '', object: '', days: 30 }); assert.equal(created.status, 201); assert.equal(created.data.interface.scenarioLabel, '通用问答');
  for (const patch of [{ baseId: f.other.id }, { scenario: 'training' }, { task: '其他任务' }, { object: '其他设备' }, { found: {} }, { template: {} }, { learningSourceBaseId: f.other.id }]) assert.equal(code(await f.call(created.data, undefined, patch)), 'INTERFACE_INPUT_INVALID');
  assert.equal((await f.call(created.data, '')).status, 400); assert.equal((await f.call(created.data, 'x'.repeat(4001))).status, 400);
  assert.equal((await f.request('GET', created.data.interface.endpoint, undefined, { user: null, secret: created.data.secret })).status, 405);
  const legacy = await f.request('POST', '/api/service-tokens', { name: '旧令牌', baseIds: [f.base.id], days: 90 });
  assert.equal((await f.request('POST', created.data.interface.endpoint, { question: '设备台账核对要求' }, { user: null, secret: legacy.data.secret })).status, 401);
});

test('optimistic revision protects enablement and key rotation, which immediately invalidates prior keys', async t => {
  const f = await fixture(t); f.document(); const created = (await f.publish()).data, route = '/api/knowledge-interfaces/' + created.interface.id;
  assert.equal(code(await f.request('PATCH', route, { active: false })), 'INTERFACE_REVISION_REQUIRED');
  assert.equal(code(await f.request('PATCH', route, { active: false, expectedRevision: 99 })), 'INTERFACE_REVISION_CONFLICT');
  assert.equal(code(await f.request('PATCH', route, { active: false, baseId: f.other.id, expectedRevision: 1 })), 'INVALID_INTERFACE_UPDATE');
  const paused = await f.request('PATCH', route, { active: false, expectedRevision: 1 }); assert.equal(paused.data.interface.revision, 2); assert.equal((await f.call(created)).status, 401);
  const resumed = await f.request('PATCH', route, { active: true, expectedRevision: 2 }); assert.equal(resumed.data.interface.revision, 3);
  const rotated = await f.request('POST', route + '/rotate-secret', { expectedRevision: 3, days: 180 }); assert.equal(rotated.status, 200); assert.equal(rotated.data.interface.revision, 4); assert.notEqual(rotated.data.secret, created.secret);
  assert.equal((await f.call(created)).status, 401); assert.equal((await f.call(rotated.data)).status, 200);
  assert.equal(code(await f.request('POST', route + '/rotate-secret', { expectedRevision: 3 })), 'INTERFACE_REVISION_CONFLICT');
  const latest = f.store.get('knowledgeInterface', created.interface.id); f.store.put('knowledgeInterface', { ...latest, expiresAt: '2020-01-01T00:00:00.000Z' }); assert.equal((await f.call(rotated.data)).status, 401);
});

test('calls are rate limited per interface and local mode keeps existing direct-loopback restrictions', async t => {
  const f = await fixture(t, { local: true }); f.document(); const created = (await f.publish()).data;
  assert.equal(code(await f.request('POST', created.interface.endpoint, { question: '设备台账核对要求' }, { secret: created.secret, headers: { 'x-forwarded-for': '127.0.0.1' } })), 'LOCAL_ACCESS_ONLY');
  const invalidHost = f.rawRequest('POST', created.interface.endpoint, { question: '设备台账核对要求' }, { host: 'outside.example', authorization: 'Bearer ' + created.secret }); invalidHost.request.end(invalidHost.text);
  assert.equal(code(await invalidHost.result), 'LOCAL_ACCESS_ONLY');
  for (let index = 0; index < 30; index++) assert.equal((await f.call(created, '')).status, 400);
  assert.equal(code(await f.call(created)), 'RATE_LIMIT');
});

test('fixed scenario context and only same-base learning reach the model; internal references stay private', async t => {
  const f = await fixture(t), source = f.document(), otherSource = f.document(undefined, { baseId: f.other.id });
  const feedback = (id, documentId, resolution) => f.store.put('feedback', { id, userId: f.users.admin.id, documentId, question: '设备台账核对要求是什么？', comment: '请纠正核对要求', resolution, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  for (const [id, documentId, resolution] of [['inside', source.id, '设备台账核对要求：逐条核验原文。'], ['outside', otherSource.id, '设备台账核对要求：外库秘密经验标记。'], ['private', null, '设备台账核对要求：私人经验标记。']]) { const row = feedback(id, documentId, resolution); learnFeedback(f.store, f.users.admin, row.id, { expectedUpdatedAt: row.updatedAt }); }
  const created = (await f.publish()).data, delayed = delayedModel(f, t), pending = f.call(created);
  await delayed.entered;
  const payload = JSON.parse(delayed.body.messages[1].content);
  assert.equal(payload.conversationContext.businessContext.baseId, f.base.id); assert.equal(payload.conversationContext.businessContext.scenario, 'maintenance'); assert.equal(payload.conversationContext.businessContext.task, '设备台账核对'); assert.equal(payload.conversationContext.businessContext.object, '设备台账');
  assert.ok(payload.learningGuidance.length > 0); assert.ok(!JSON.stringify(payload).includes('外库秘密经验标记')); assert.ok(!JSON.stringify(payload).includes('私人经验标记'));
  delayed.release(); const answer = await pending; assert.equal(answer.status, 200, answer.text); assert.equal(answer.data.mode, 'model'); assert.ok(!answer.text.includes('learningEvidenceRefs')); assert.ok(!answer.text.includes('learningGuidance'));
});

for (const mutation of ['disable', 'rotate', 'delete-base', 'disable-account', 'demote-account', 'move-document', 'expire', 'disable-resume']) {
  test('in-flight response is withdrawn after ' + mutation, async t => {
    const f = await fixture(t), source = f.document(), created = (await f.publish()).data, delayed = delayedModel(f, t), pending = f.call(created);
    await delayed.entered;
    const route = '/api/knowledge-interfaces/' + created.interface.id;
    if (mutation === 'disable' || mutation === 'disable-resume') { const result = await f.request('PATCH', route, { active: false, expectedRevision: 1 }); assert.equal(result.status, 200); if (mutation === 'disable-resume') assert.equal((await f.request('PATCH', route, { active: true, expectedRevision: 2 })).status, 200); }
    else if (mutation === 'rotate') assert.equal((await f.request('POST', route + '/rotate-secret', { expectedRevision: 1, days: 90 })).status, 200);
    else if (mutation === 'delete-base') f.store.del('base', f.base.id);
    else if (mutation === 'disable-account') f.store.put('user', { ...f.users.admin, active: false });
    else if (mutation === 'demote-account') f.store.put('user', { ...f.users.admin, role: 'viewer' });
    else if (mutation === 'move-document') f.store.put('document', { ...source, baseId: f.other.id });
    else if (mutation === 'expire') f.store.put('knowledgeInterface', { ...f.store.get('knowledgeInterface', created.interface.id), expiresAt: '2020-01-01T00:00:00.000Z' });
    delayed.release(); const answer = await pending;
    assert.ok([401, 403, 409].includes(answer.status), answer.text); assert.equal(answer.data.answer, undefined); assert.ok(!answer.text.includes(source.title));
    assert.equal(f.store.get('knowledgeInterface', created.interface.id).calls, 0);
  });
}

test('management rechecks the live administrator after awaiting the request body', async t => {
  const f = await fixture(t); let ready, reads = 0; const entered = new Promise(resolve => { ready = resolve; }), get = f.store.get;
  f.store.get = (kind, id) => { const value = get(kind, id); if (kind === 'user' && id === f.users.admin.id && ++reads >= 3) ready(); return value; };
  const pending = f.rawRequest('POST', '/api/knowledge-interfaces', { name: '在途权限校验', baseId: f.base.id, scenario: '', task: '' }, { cookie: f.cookies.admin });
  pending.request.write(pending.text.slice(0, 1)); await entered;
  f.store.put('user', { ...f.users.admin, role: 'viewer' }); pending.request.end(pending.text.slice(1));
  const response = await pending.result; assert.equal(response.status, 403); assert.equal(f.store.list('knowledgeInterface').length, 0);
});

test('service authorization is checked again after a slow body upload', async t => {
  const f = await fixture(t); f.document(); const published = (await f.publish()).data;
  let ready; const entered = new Promise(resolve => { ready = resolve; }), get = f.store.get;
  f.store.get = (kind, id) => { const value = get(kind, id); if (kind === 'knowledgeInterface' && id === published.interface.id) ready(); return value; };
  const pending = f.rawRequest('POST', published.interface.endpoint, { question: '设备台账核对要求' }, { authorization: 'Bearer ' + published.secret });
  pending.request.write(pending.text.slice(0, 1)); await entered;
  const row = get('knowledgeInterface', published.interface.id); f.store.put('knowledgeInterface', { ...row, active: false, revision: 2 });
  pending.request.end(pending.text.slice(1)); const response = await pending.result;
  assert.equal(response.status, 401); assert.equal(response.data.answer, undefined); assert.equal(get('knowledgeInterface', row.id).calls, 0);
});

test('nested graph or evidence references cannot bypass the bound original knowledge base', async t => {
  const f = await fixture(t), inside = f.document(), outside = f.document(undefined, { baseId: f.other.id });
  const bundle = { citations: [{ documentId: inside.id, baseId: f.base.id }], graphPaths: [{ edges: [{ documentId: inside.id, evidenceRefs: [{ documentId: outside.id }] }] }] };
  assert.equal(knowledgeInterfaceEvidenceWithinBase(f.store, bundle, f.base.id, f.users.admin), false);
  bundle.graphPaths[0].edges[0].evidenceRefs[0].documentId = inside.id;
  assert.equal(knowledgeInterfaceEvidenceWithinBase(f.store, bundle, f.base.id, f.users.admin), true);
});

test('legacy service answer retains its contract while restricting learning to the token-selected knowledge base', async t => {
  const f = await fixture(t), source = f.document(), outside = f.document(undefined, { baseId: f.other.id });
  for (const [id, documentId, resolution] of [['legacy-inside', source.id, '设备台账核对要求：同库核对方法。'], ['legacy-outside', outside.id, '设备台账核对要求：跨库经验不得泄露标记。']]) {
    const row = f.store.put('feedback', { id, userId: f.users.admin.id, documentId, question: '设备台账核对要求是什么？', comment: '核对经验', resolution, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    learnFeedback(f.store, f.users.admin, id, { expectedUpdatedAt: row.updatedAt });
  }
  const legacy = await f.request('POST', '/api/service-tokens', { name: '旧服务兼容', baseIds: [f.base.id], days: 90 }); assert.equal(legacy.status, 201);
  const delayed = delayedModel(f, t), pending = f.request('POST', '/api/service/answer', { question: '设备台账核对要求是什么？', baseId: f.base.id }, { user: null, secret: legacy.data.secret });
  await delayed.entered; const payload = JSON.parse(delayed.body.messages[1].content);
  assert.ok(payload.learningGuidance.length > 0); assert.ok(!JSON.stringify(payload).includes('跨库经验不得泄露标记'));
  delayed.release(); const result = await pending; assert.equal(result.status, 200, result.text); assert.equal(result.data.mode, 'model'); assert.ok(result.data.citations.every(ref => ref.baseId === f.base.id));
});
