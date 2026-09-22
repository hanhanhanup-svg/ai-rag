import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { createStore } from '../server/database.mjs';
import { handleExtension, deliverWebhook, startExtensions, stopExtensionTasks } from '../server/extensions.mjs';

const HOOK_ORIGIN = 'https://203.0.113.10';
const MODEL_ORIGIN = 'https://203.0.113.11';
const ADMIN = { id: 'webhook-test-admin', role: 'admin', active: true, name: 'Local Test Admin', department: 'Test' };
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const immediate = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function extensionRequest(store, method, pathname, body, user = ADMIN) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]); req.headers = { 'content-type': 'application/json' };
  let status, responseBody;
  const res = { writeHead(code) { status = code; }, end(text) { responseBody = text ? JSON.parse(text) : null; } };
  const handled = await handleExtension({ req, res, store, method, pathname, url: new URL(pathname, 'http://127.0.0.1'), user, rate() {} });
  assert.equal(handled, true, 'The requested extension route should be handled');
  return { status, data: responseBody };
}

// Capture the real periodic callback, but never wait five seconds or advance wall-clock time.
function controlledWorker(store) {
  const originalInterval = globalThis.setInterval; let tick;
  globalThis.setInterval = (callback, milliseconds) => {
    assert.equal(milliseconds, 5000); tick = callback;
    const timer = originalInterval(() => {}, 2_000_000_000); clearInterval(timer); return timer;
  };
  let stop;
  try { stop = startExtensions(store); } finally { globalThis.setInterval = originalInterval; }
  assert.equal(typeof tick, 'function');
  return { tick: () => Promise.resolve(tick()), stop };
}

test('persistent webhooks and graceful extension shutdown use only local test transport', { timeout: 45_000 }, async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'xrag-webhooks-'));
  const originalFetch = globalThis.fetch, originalLocalModelFlag = process.env.LOCAL_EMBEDDINGS_ENABLED;
  const packets = [], transportErrors = [], stores = new Set(), workers = new Set();
  let receiver = async (_packet, res) => { res.writeHead(204); res.end(); };
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const packet = { method: req.method, path: req.url, headers: req.headers, rawBody: Buffer.concat(chunks).toString('utf8') };
      packets.push(packet); await receiver(packet, res);
    } catch (error) { transportErrors.push(error); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localOrigin = `http://127.0.0.1:${server.address().port}`;
  process.env.LOCAL_EMBEDDINGS_ENABLED = 'false';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.ok([HOOK_ORIGIN, MODEL_ORIGIN].includes(url.origin), `Unexpected outbound request blocked: ${url.origin}`);
    // Public documentation addresses pass URL validation but are never contacted.
    return originalFetch(localOrigin + url.pathname, init);
  };
  let count = 0;
  const newStore = () => { const store = createStore(path.join(directory, String(++count))); store.put('user', ADMIN); stores.add(store); return store; };
  const start = store => { const worker = controlledWorker(store); workers.add(worker); return worker; };
  async function closeWorker(worker) { await worker.stop(); workers.delete(worker); }
  function closeStore(store) { store.close(); stores.delete(store); }
  async function createHook(store, suffix = '') {
    const result = await extensionRequest(store, 'POST', '/api/webhooks', { name: 'Local Test Hook' + suffix, url: HOOK_ORIGIN + '/incoming' + suffix, events: ['document.published', 'document.archived'] });
    assert.equal(result.status, 201); assert.ok(result.data.secret); return result.data;
  }
  function overdue(store, id) { const row = store.get('webhookDelivery', id); store.put('webhookDelivery', { ...row, nextAttemptAt: Date.now() - 1 }); }
  try {
    await t.test('signature covers timestamp and raw payload, excludes document content, and secret is not re-exposed', async () => {
      packets.length = 0; const store = newStore(), created = await createHook(store), hook = store.get('webhook', created.webhook.id);
      const event = store.audit(ADMIN, 'document.published', { documentId: 'doc-signature', documentTitle: 'Private title must not be transmitted', text: 'Private document content must not be transmitted' });
      const result = await deliverWebhook(store, hook, event, digest(hook.id + ':' + event.id));
      assert.equal(result.status, 'delivered'); assert.equal(result.attempts, 1); assert.equal(result.nextAttemptAt, null); assert.equal(packets.length, 1);
      const packet = packets[0], timestamp = packet.headers['x-xrag-timestamp'];
      assert.equal(packet.method, 'POST'); assert.equal(packet.headers['x-xrag-event-id'], event.id);
      assert.match(timestamp, /^\d+$/); assert.ok(Math.abs(Number(timestamp) - Math.floor(Date.now() / 1000)) <= 2);
      const expected = 'sha256=' + crypto.createHmac('sha256', created.secret).update(timestamp + '.' + packet.rawBody).digest('hex');
      assert.equal(packet.headers['x-xrag-signature'], expected);
      assert.deepEqual(JSON.parse(packet.rawBody), { id: event.id, event: event.action, occurredAt: event.createdAt, documentId: event.documentId });
      assert.ok(!packet.rawBody.includes('Private')); assert.ok(!packet.rawBody.includes(created.secret));
      const tampered = crypto.createHmac('sha256', created.secret).update(timestamp + '.' + packet.rawBody + ' ').digest('hex'); assert.notEqual('sha256=' + tampered, expected);
      const listing = await extensionRequest(store, 'GET', '/api/webhooks');
      assert.equal('sealedSecret' in listing.data.webhooks[0], false); assert.equal('secret' in listing.data.webhooks[0], false);
      assert.ok(!JSON.stringify(listing.data).includes(created.secret)); assert.ok(!JSON.stringify(store.events()).includes(created.secret));
      assert.notEqual(store.get('webhook', hook.id).sealedSecret, created.secret);
      closeStore(store);
    });

    await t.test('rowid cursor skips pre-subscription events, survives reopen, and drains beyond one 200-row batch', async () => {
      packets.length = 0; let store = newStore();
      store.audit(ADMIN, 'document.published', { documentId: 'before-subscription' });
      const created = await createHook(store), hookId = created.webhook.id, sameTime = new Date().toISOString();
      const eventIds = [];
      for (let index = 0; index < 205; index++) eventIds.push(store.audit(ADMIN, 'document.published', { documentId: 'backlog-' + index, createdAt: sameTime }).id);
      const dataDir = store.dataDir; closeStore(store); // Simulate shutdown before the notification worker ran.
      store = createStore(dataDir); stores.add(store); const worker = start(store);
      await worker.tick(); assert.ok(packets.length > 0 && packets.length < eventIds.length);
      await worker.tick(); assert.equal(packets.length, eventIds.length);
      const delivered = packets.map(packet => JSON.parse(packet.rawBody));
      assert.ok(!delivered.some(event => event.documentId === 'before-subscription'));
      assert.deepEqual(new Set(delivered.map(event => event.id)), new Set(eventIds));
      assert.equal(store.list('webhookDelivery').length, 205);
      const cursor = store.get('webhook', hookId).lastAuditRow; assert.ok(cursor > 205);
      await closeWorker(worker); closeStore(store);
      store = createStore(dataDir); stores.add(store); const restarted = start(store);
      await restarted.tick(); assert.equal(packets.length, 205, 'Completed events must not be resent after restart');
      assert.equal(store.get('webhook', hookId).lastAuditRow, cursor);
      await closeWorker(restarted); closeStore(store);
    });

    await t.test('failed deliveries use bounded backoff, preserve event IDs, and stop after three attempts', async () => {
      packets.length = 0; receiver = async (_packet, res) => { res.writeHead(503); res.end('temporarily unavailable'); };
      const store = newStore(), created = await createHook(store), event = store.audit(ADMIN, 'document.archived', { documentId: 'retry-document' });
      const worker = start(store), id = digest(created.webhook.id + ':' + event.id);
      const before = Date.now(); await worker.tick();
      let row = store.get('webhookDelivery', id); assert.equal(row.status, 'failed'); assert.equal(row.attempts, 1); assert.ok(row.nextAttemptAt >= before + 60000 && row.nextAttemptAt < Date.now() + 61000);
      await worker.tick(); assert.equal(packets.length, 1, 'Not-yet-due retries should not run');
      overdue(store, id); await worker.tick(); row = store.get('webhookDelivery', id); assert.equal(row.attempts, 2); assert.ok(row.nextAttemptAt >= Date.now() + 119000);
      overdue(store, id); await worker.tick(); row = store.get('webhookDelivery', id); assert.equal(row.attempts, 3); assert.equal(row.nextAttemptAt, null);
      await worker.tick(); assert.equal(packets.length, 3); assert.equal(new Set(packets.map(packet => packet.headers['x-xrag-event-id'])).size, 1);
      assert.equal(store.list('webhookDelivery').length, 1); assert.equal(row.event.documentId, 'retry-document');
      await closeWorker(worker); closeStore(store); receiver = async (_packet, res) => { res.writeHead(204); res.end(); };
    });

    await t.test('persisted in-flight envelope recovers after restart even when the original audit row is no longer retained', async () => {
      packets.length = 0; let store = newStore(); const created = await createHook(store), hookId = created.webhook.id;
      const event = store.audit(ADMIN, 'document.published', { documentId: 'pending-document' }), id = digest(hookId + ':' + event.id);
      const sequence = Number(store.db.prepare('SELECT rowid AS n FROM audit WHERE id=?').get(event.id).n);
      store.put('webhookDelivery', { id, hookId, eventId: event.id, action: event.action, event: { id: event.id, action: event.action, createdAt: event.createdAt, documentId: event.documentId }, status: 'pending', attempts: 1, nextAttemptAt: null, createdAt: event.createdAt });
      store.put('webhook', { ...store.get('webhook', hookId), lastAuditRow: sequence });
      store.db.prepare('DELETE FROM audit WHERE id=?').run(event.id);
      const dataDir = store.dataDir; closeStore(store); store = createStore(dataDir); stores.add(store);
      const worker = start(store); await worker.tick();
      const recovered = store.get('webhookDelivery', id); assert.equal(recovered.status, 'delivered'); assert.equal(recovered.attempts, 2); assert.equal(recovered.nextAttemptAt, null);
      assert.equal(packets.length, 1); assert.equal(packets[0].headers['x-xrag-event-id'], event.id); assert.equal(JSON.parse(packets[0].rawBody).documentId, event.documentId);
      await closeWorker(worker); closeStore(store);
    });

    await t.test('disabling during an in-flight send prevents later queued events and disallows manual tests', async () => {
      packets.length = 0; const store = newStore(), created = await createHook(store), hookId = created.webhook.id;
      const first = store.audit(ADMIN, 'document.published', { documentId: 'first-event' }); store.audit(ADMIN, 'document.archived', { documentId: 'must-not-send' });
      const entered = deferred(), release = deferred(); receiver = async (_packet, res) => { entered.resolve(); await release.promise; res.writeHead(204); res.end(); };
      const worker = start(store), ticking = worker.tick(); await entered.promise;
      const pending = store.get('webhookDelivery', digest(hookId + ':' + first.id)); assert.equal(pending.status, 'pending', 'Outbox state must be committed before HTTP finishes');
      assert.equal((await extensionRequest(store, 'DELETE', '/api/webhooks/' + hookId)).status, 200);
      release.resolve(); await ticking; await worker.tick(); assert.equal(packets.length, 1); assert.equal(store.get('webhook', hookId).active, false);
      await assert.rejects(extensionRequest(store, 'POST', '/api/webhooks/' + hookId + '/test', {}), error => error.code === 'WEBHOOK_DISABLED');
      assert.equal(packets.length, 1); await closeWorker(worker); closeStore(store); receiver = async (_packet, res) => { res.writeHead(204); res.end(); };
    });

    await t.test('disabled hooks cancel persisted due retries and internal endpoints are rejected before fetch', async () => {
      packets.length = 0; receiver = async (_packet, res) => { res.writeHead(500); res.end(); };
      const store = newStore(), created = await createHook(store), event = store.audit(ADMIN, 'document.published', { documentId: 'cancel-retry' });
      const worker = start(store), id = digest(created.webhook.id + ':' + event.id); await worker.tick(); assert.equal(packets.length, 1);
      await extensionRequest(store, 'DELETE', '/api/webhooks/' + created.webhook.id); overdue(store, id); await worker.tick();
      assert.equal(packets.length, 1); assert.equal(store.get('webhookDelivery', id).nextAttemptAt, null); assert.equal(store.get('webhookDelivery', id).status, 'cancelled');
      for (const url of ['http://127.0.0.1/notify', 'https://127.0.0.1/notify', 'https://169.254.169.254/metadata']) await assert.rejects(extensionRequest(store, 'POST', '/api/webhooks', { name: 'blocked', url, events: ['document.published'] }));
      assert.equal(packets.length, 1); await closeWorker(worker); closeStore(store); receiver = async (_packet, res) => { res.writeHead(204); res.end(); };
    });

    await t.test('graceful worker stop waits for the current evaluation and interrupts remaining questions', async () => {
      packets.length = 0; const store = newStore();
      store.put('base', { id: 'eval-base', ownerId: ADMIN.id, visibility: 'private' });
      store.put('document', { id: 'eval-document', baseId: 'eval-base', status: 'published', ownerId: ADMIN.id, title: '采购审批', fileName: '采购审批.txt', version: 1, sensitivity: 'internal' });
      store.replaceChunks('eval-document', [{ id: 'eval-chunk', documentId: 'eval-document', ordinal: 0, page: 1, text: '采购审批需要部门负责人确认。' }]);
      store.put('setting', { id: 'model', provider: 'compatible', baseUrl: MODEL_ORIGIN + '/model', model: 'local-test-model', sealedApiKey: store.seal('nonproduction-local-test-key'), embeddingBaseUrl: '', embeddingModel: '' });
      for (const id of ['first-case', 'second-case']) store.put('evalCase', { id, question: '采购审批', baseId: 'eval-base', expectedDocumentId: 'eval-document', expectedText: '负责人', mustRefuse: false });
      const worker = start(store), entered = deferred(), release = deferred();
      receiver = async (packet, res) => {
        assert.equal(packet.path, '/model/chat/completions'); entered.resolve(); await release.promise;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: '采购审批需要部门负责人确认。[1]', citations: [1], insufficient: false }) } }] }));
      };
      const started = await extensionRequest(store, 'POST', '/api/evaluations/run', { mode: 'answer' }); assert.equal(started.status, 202); await entered.promise;
      let stopped = false; const stopping = worker.stop().then(() => { stopped = true; }); await immediate();
      assert.equal(stopped, false, 'Worker shutdown must wait for a real in-flight model response');
      await assert.rejects(extensionRequest(store, 'POST', '/api/evaluations/run', { mode: 'answer' }), error => error.code === 'SERVICE_STOPPING');
      release.resolve(); await stopping; workers.delete(worker);
      const run = store.get('evalRun', started.data.run.id); assert.equal(run.status, 'interrupted'); assert.equal(run.completed, 1); assert.equal(run.passed, 1); assert.equal(packets.length, 1);
      closeStore(store); await immediate(); receiver = async (_packet, res) => { res.writeHead(204); res.end(); };
    });

    await t.test('stopExtensionTasks also protects a queued evaluation when no periodic worker was started', async () => {
      const store = newStore(); store.put('evalCase', { id: 'queued-case', question: 'no evidence', mustRefuse: true });
      const started = await extensionRequest(store, 'POST', '/api/evaluations/run', { mode: 'retrieval' });
      await stopExtensionTasks(store); const run = store.get('evalRun', started.data.run.id);
      assert.equal(run.status, 'interrupted'); assert.equal(run.completed, 0); closeStore(store); await immediate();
    });
    assert.deepEqual(transportErrors, [], 'The loopback receiver should not have hidden assertion failures');
  } finally {
    for (const worker of workers) await worker.stop();
    for (const store of stores) { await stopExtensionTasks(store); store.close(); }
    globalThis.fetch = originalFetch;
    if (originalLocalModelFlag === undefined) delete process.env.LOCAL_EMBEDDINGS_ENABLED; else process.env.LOCAL_EMBEDDINGS_ENABLED = originalLocalModelFlag;
    await new Promise(resolve => server.close(resolve));
    const checked = path.resolve(directory); assert.ok(checked.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(checked).startsWith('xrag-webhooks-'));
    rmSync(checked, { recursive: true, force: true });
  }
});
