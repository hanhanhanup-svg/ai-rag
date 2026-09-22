import test from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendations, handleRecommendations, recommendationEvent, recommendationSignature } from './recommendations.mjs';

function fixture() {
  const records = new Map(), chunks = new Map();
  const store = { get: (kind, id) => structuredClone(records.get(kind + ':' + id) || null), put: (kind, value) => { records.set(kind + ':' + value.id, structuredClone(value)); return value; }, list: kind => [...records.entries()].filter(([key]) => key.startsWith(kind + ':')).map(([, value]) => structuredClone(value)), del: (kind, id) => records.delete(kind + ':' + id), transaction: fn => fn(), chunks: id => chunks.get(id) || [], audit() {} };
  const user = { id: 'reader', role: 'viewer', active: true, department: '客运' };
  store.put('user', user); store.put('base', { id: 'public', visibility: 'company', ownerId: 'owner' }); store.put('base', { id: 'private', visibility: 'private', ownerId: 'owner', members: [] });
  const doc = (id, extra = {}) => { const d = { id, familyId: id, title: '设备维修工单资料 ' + id, baseId: 'public', ownerId: 'owner', sensitivity: 'internal', status: 'published', version: 1, revision: 1, sourceKind: 'synthetic', applicability: '行业示例', createdAt: '2026-01-01T00:00:00Z', ...extra }; store.put('document', d); chunks.set(id, [{ id: id + '-c', text: '设备维修工单记录，仅用于测试。', page: 1 }]); return d; };
  return { store, user, doc, chunks };
}
test('scene recommendations filter ACL, lifecycle, conflicts and only fold reviewed visible equivalents', () => {
  const { store, user, doc } = fixture(); doc('valid'); doc('equivalent'); doc('hidden', { baseId: 'private', title: '秘密设备维修' }); doc('review', { status: 'review' }); doc('expired', { expiresAt: '2020-01-01' }); doc('conflict'); doc('unrelated', { title: '培训课程' });
  const r = getRecommendations(store, user, { scenario: 'maintenance', contextId: 'session1' }, { policy: { blockedDocumentIds: ['conflict'], equivalentGroups: [{ id: 'group', documentIds: ['valid', 'equivalent', 'hidden'] }] } });
  assert.equal(r.items.length, 1); assert.ok(['valid', 'equivalent'].includes(r.items[0].documentId)); assert.equal(r.items[0].sourceKind, 'synthetic'); assert.match(r.items[0].reasons.join(''), /标题或标签/); assert.ok(!JSON.stringify(r).includes('秘密'));
});
test('explicit scene feedback is version scoped, idempotent, rechecks permissions and does not mistake an open for reading', () => {
  const { store, user, doc } = fixture(); const d = doc('valid');
  const r = getRecommendations(store, user, { scenario: 'maintenance', contextId: 'session1' });
  const event = { requestId: r.requestId, documentId: d.id, version: 1, contextId: 'session1', type: 'open', clientRequestId: 'open1' };
  recommendationEvent(store, user, event); assert.equal(recommendationEvent(store, user, event).duplicate, true);
  assert.throws(() => recommendationEvent(store, user, { ...event, type: 'dismiss' }), e => e.code === 'IDEMPOTENCY_CONFLICT');
  assert.equal(getRecommendations(store, user, { scenario: 'maintenance', contextId: 'session1' }).items[0].read, false);
  recommendationEvent(store, user, { ...event, clientRequestId: 'read1', type: 'mark_read' });
  assert.equal(getRecommendations(store, user, { scenario: 'maintenance', contextId: 'session1' }).items[0].read, true);
  recommendationEvent(store, user, { ...event, clientRequestId: 'dismiss1', type: 'dismiss' });
  assert.equal(getRecommendations(store, user, { scenario: 'maintenance', contextId: 'session1' }).items.length, 0);
  assert.equal(getRecommendations(store, user, { scenario: 'maintenance', contextId: 'session2' }).items.length, 1);
  store.put('document', { ...d, version: 2, revision: 2 });
  assert.equal(getRecommendations(store, user, { scenario: 'maintenance', contextId: 'session1' }).items[0].read, false);
  assert.throws(() => recommendationEvent(store, user, { ...event, clientRequestId: 'stale' }), e => e.code === 'RECOMMENDATION_CHANGED');
  store.put('document', { ...d, baseId: 'private' });
  assert.throws(() => recommendationEvent(store, user, { ...event, clientRequestId: 'revoked' }), e => e.code === 'RECOMMENDATION_CHANGED');
});
test('no matching scene returns an honest empty state and no hidden source counts', () => {
  const { store, user, doc } = fixture(); doc('hidden', { baseId: 'private' });
  const r = getRecommendations(store, user, { scenario: 'maintenance' }); assert.equal(r.items.length, 0); assert.match(r.emptyReason, /暂无/);
  store.put('user', { ...user, active: false }); assert.throws(() => getRecommendations(store, user), e => e.code === 'AUTH_REQUIRED');
});

test('business query intersects scenario and search evidence without bypassing visibility or versions', () => {
  const { store, user, doc } = fixture(); doc('valid'); doc('hidden', {baseId:'private'}); doc('other', {title:'培训课程'});
  const searchResult = { results: ['valid','hidden','other'].map(id=>({documentId:id,id:id+'-evidence',text:'查询定位的原文证据',page:3})), coverage:{marker:'preserved'} };
  const result = getRecommendations(store,user,{scenario:'maintenance',q:'设备核验'},{searchResult});
  assert.deepEqual(result.items.map(row=>row.documentId),['valid']);
  assert.equal(result.items[0].chunkId,'valid-evidence'); assert.equal(result.items[0].page,3);
  assert.equal(result.items[0].excerpt,'查询定位的原文证据'); assert.ok(result.items[0].reasonCodes.includes('business_query'));
  assert.deepEqual(result.coverage,searchResult.coverage);
  assert.equal(getRecommendations(store,user,{q:'无结果'},{searchResult:{results:[]}}).items.length,0);
  assert.equal(getRecommendations(store,user,{documentId:'valid',documentVersion:'2'}).items.length,0);
  assert.deepEqual(getRecommendations(store,user,{documentId:'valid',documentVersion:'1'}).items.map(row=>row.documentId),['valid']);
});

function managedFixture() {
  const f = fixture(), manager = { id: 'owner', role: 'editor', active: true, department: '客运' };
  f.store.put('user', manager);
  async function links(method = 'GET', input, actor = manager) {
    let output;
    const handled = await handleRecommendations({ pathname: '/api/recommendation-links', method, store: f.store, user: actor, req: {}, res: {}, bodyOf: async () => input, send: (_res, status, value) => { assert.equal(status, 200); output = value; } });
    assert.equal(handled, true);
    return output;
  }
  return { ...f, manager, links };
}
const taskLink = (documentId, extra = {}) => ({ documentId, scenario: 'maintenance', task: '设备台账核对', reason: '用于核对设备台账字段与适用范围。', status: 'approved', ...extra });

test('task links list live document status, availability and source versions within the readable scope', async () => {
  const f = managedFixture();
  f.doc('valid'); f.doc('expired', { expiresAt: '2020-01-01' }); f.doc('future', { effectiveAt: '2999-01-01' }); f.doc('review', { status: 'review' }); f.doc('withdrawn', { source: { accessState: 'withdrawn' } }); f.doc('hidden', { baseId: 'private' });
  for (const id of ['valid', 'expired', 'future', 'review', 'withdrawn', 'hidden']) await f.links('POST', taskLink(id, {status:'draft'}));
  const changed = { ...f.store.get('document', 'valid'), version: 2, revision: 2 }; f.store.put('document', changed);
  const managed = (await f.links()).links;
  assert.equal(managed.length, 6);
  assert.deepEqual(Object.fromEntries(managed.map(link => [link.documentId, link.documentRetrievable])), { valid: true, expired: false, future: false, review: false, withdrawn: false, hidden: true });
  const current = managed.find(link => link.documentId === 'valid');
  assert.equal(current.documentVersion, 2); assert.equal(current.documentStatus, 'published'); assert.equal(current.stale, true); assert.equal(current.canManage, true);
  const readable = (await f.links('GET', undefined, f.user)).links;
  assert.deepEqual(readable.map(link => link.documentId).sort(), ['expired', 'future', 'valid']);
  assert.ok(readable.every(link => link.canManage === false));
});

test('task links reject duplicate creation including disabled links and keep revision conflicts from overwriting edits', async () => {
  const f = managedFixture(); f.doc('valid'); f.doc('other');
  const first = (await f.links('POST', taskLink('valid'))).link;
  await assert.rejects(f.links('POST', taskLink('valid', { task: ' 设备台账核对 ' })), { code: 'LINK_ALREADY_EXISTS', status: 409 });
  const disabled = (await f.links('POST', { ...first, status: 'disabled' })).link;
  await assert.rejects(f.links('POST', taskLink('valid')), { code: 'LINK_ALREADY_EXISTS' });
  const enabled = (await f.links('POST', { ...disabled, status: 'approved', reason: '更新后的用途说明' })).link;
  assert.equal(enabled.id, first.id); assert.equal(enabled.revision, 3);
  await assert.rejects(f.links('POST', { ...disabled, reason: '过期的编辑请求' }), { code: 'REVISION_CONFLICT' });
  assert.equal(f.store.get('recommendation_link', first.id).reason, '更新后的用途说明');
  await f.links('POST', taskLink('valid', { task: '维修工单资料核对' }));
  await f.links('POST', taskLink('other'));
  assert.equal(f.store.list('recommendation_link').length, 3);
});

test('disabling a stale task link preserves its old evidence and requires explicit evidence changes before reapproval', async () => {
  const f = managedFixture(); f.doc('valid'); f.doc('other');
  const first = (await f.links('POST', taskLink('valid', { chunkIds: ['valid-c', 'valid-c'] }))).link;
  assert.deepEqual(first.chunkIds, ['valid-c']);
  await assert.rejects(f.links('POST', { ...first, chunkIds: ['other-c'] }), { code: 'INVALID_LINK_EVIDENCE' });
  const changed = { ...f.store.get('document', 'valid'), revision: 2 }; f.store.put('document', changed);
  f.chunks.set('valid', [{ id: 'valid-new', text: '修订后的设备资料。', page: 1 }]);
  await assert.rejects(f.links('POST', { ...first, reason: '仍保留旧定位' }), { code: 'INVALID_LINK_EVIDENCE' });
  const disabled = (await f.links('POST', { ...first, chunkIds: undefined, status: 'disabled' })).link;
  assert.equal(disabled.documentSignature, first.documentSignature); assert.deepEqual(disabled.chunkIds, ['valid-c']);
  assert.equal((await f.links()).links[0].stale, true);
  assert.equal(getRecommendations(f.store, f.user, { scenario: 'maintenance' }).items.find(item=>item.documentId==='valid').reasonCodes.includes('reviewed_task_link'), false);
  await assert.rejects(f.links('POST', { ...disabled, status: 'approved' }), { code: 'INVALID_LINK_EVIDENCE' });
  const approved = (await f.links('POST', { ...disabled, chunkIds: [], status: 'approved', reason: '已核对当前版本，取消旧片段定位。' })).link;
  assert.equal(approved.documentSignature, recommendationSignature(changed)); assert.deepEqual(approved.chunkIds, []);
  assert.equal((await f.links()).links[0].stale, false);
  assert.ok(getRecommendations(f.store, f.user, { scenario: 'maintenance' }).items.find(item=>item.documentId==='valid').reasonCodes.includes('reviewed_task_link'));
});

test('task link writes recheck active editor ownership and reject unavailable sources when enabling', async () => {
  const f = managedFixture(); f.doc('valid');
  await assert.rejects(f.links('POST', taskLink('valid'), f.user), { code: 'LINK_PERMISSION_REQUIRED' });
  const colleague = { id: 'colleague', role: 'editor', active: true }; f.store.put('user', colleague);
  await assert.rejects(f.links('POST', taskLink('valid'), colleague), { code: 'LINK_PERMISSION_REQUIRED' });
  await assert.rejects(f.links('POST', taskLink('valid', { reason: '   ' })), { code: 'LINK_REASON_REQUIRED' });
  const cases = [['expired', { expiresAt: '2020-01-01' }], ['future', {effectiveAt:'2999-01-01'}], ['review', {status:'review'}], ['withdrawn', {source:{accessState:'withdrawn'}}], ['source-expired', {source:{freshUntil:'2020-01-01'}}]];
  for(const [id,extra] of cases){
    f.doc(id,extra);
    await assert.rejects(f.links('POST',taskLink(id)),{code:'LINK_DOCUMENT_UNAVAILABLE',status:409});
    const draft=(await f.links('POST',taskLink(id,{status:'draft'}))).link;
    const disabled=(await f.links('POST',{...draft,status:'disabled'})).link;
    assert.equal(disabled.status,'disabled');
    await assert.rejects(f.links('POST',{...disabled,status:'approved'}),{code:'LINK_DOCUMENT_UNAVAILABLE'});
  }
  assert.ok((await f.links()).links.every(link=>link.documentRetrievable===false));
  assert.deepEqual(getRecommendations(f.store,f.user,{scenario:'maintenance'}).items.map(item=>item.documentId),['valid']);
  f.store.put('user', { ...f.manager, active: false });
  await assert.rejects(f.links('POST', taskLink('valid')), { code: 'AUTH_REQUIRED' });
});

test('separate task link saves preserve partial success and a retry cannot duplicate already saved items', async () => {
  const f = managedFixture(); f.doc('first'); f.doc('second');
  const results = [];
  for (const input of [taskLink('first'), taskLink('second', { chunkIds: ['foreign'] })]) {
    try { const { link } = await f.links('POST', input); results.push({ id: link.documentId, saved: true }); }
    catch (error) { results.push({ id: input.documentId, error: error.code }); }
  }
  assert.deepEqual(results, [{ id: 'first', saved: true }, { id: 'second', error: 'INVALID_LINK_EVIDENCE' }]);
  assert.equal(f.store.list('recommendation_link').length, 1);
  await assert.rejects(f.links('POST', taskLink('first')), { code: 'LINK_ALREADY_EXISTS' });
  await f.links('POST', taskLink('second', { chunkIds: ['second-c'] }));
  assert.equal(f.store.list('recommendation_link').length, 2);
});


test('task link creation rejects a changed source snapshot and accepts the refreshed snapshot', async () => {
  const f = managedFixture(); const source = f.doc('valid');
  const expectedDocumentSignature = recommendationSignature(source);
  const changed = { ...source, revision: source.revision + 1, applicability: '更新后的适用范围' }; f.store.put('document', changed);
  await assert.rejects(f.links('POST', taskLink('valid', { expectedDocumentSignature })), { code: 'LINK_DOCUMENT_CHANGED', status: 409 });
  assert.equal(f.store.list('recommendation_link').length, 0);
  const approved = (await f.links('POST', taskLink('valid', { expectedDocumentSignature: recommendationSignature(changed) }))).link;
  assert.equal(approved.documentSignature, recommendationSignature(changed));
  const listed = (await f.links()).links[0];
  assert.equal(listed.currentDocumentSignature, recommendationSignature(changed));
  assert.equal(listed.stale, false);
});

test('task link purpose edits reject changed source snapshots while disabling preserves the earlier confirmation', async () => {
  const f = managedFixture(); const source = f.doc('valid');
  const approved = (await f.links('POST', taskLink('valid', { expectedDocumentSignature: recommendationSignature(source) }))).link;
  const listed = (await f.links()).links[0];
  const changed = { ...source, revision: source.revision + 1, applicability: '已变化的适用范围' }; f.store.put('document', changed);
  await assert.rejects(f.links('POST', { ...listed, reason: '只修改用途说明', expectedDocumentSignature: listed.currentDocumentSignature }), { code: 'LINK_DOCUMENT_CHANGED' });
  const unchanged = f.store.get('recommendation_link', approved.id);
  assert.equal(unchanged.reason, approved.reason); assert.equal(unchanged.revision, approved.revision); assert.equal(unchanged.documentSignature, approved.documentSignature);
  const current = (await f.links()).links[0];
  assert.equal(current.stale, true); assert.equal(current.currentDocumentSignature, recommendationSignature(changed));
  const disabled = (await f.links('POST', { ...listed, status: 'disabled', expectedDocumentSignature: listed.currentDocumentSignature })).link;
  assert.equal(disabled.status, 'disabled'); assert.equal(disabled.documentSignature, approved.documentSignature);
  await assert.rejects(f.links('POST', { ...disabled, status: 'approved', expectedDocumentSignature: listed.currentDocumentSignature }), { code: 'LINK_DOCUMENT_CHANGED' });
  const reconfirmed = (await f.links('POST', { ...disabled, status: 'approved', expectedDocumentSignature: current.currentDocumentSignature })).link;
  assert.equal(reconfirmed.documentSignature, recommendationSignature(changed));
});

test('task link snapshot checks apply to drafts, reject empty supplied snapshots and preserve callers without the field', async () => {
  const f = managedFixture(); const source = f.doc('draft', {status:'review'});
  const signature = recommendationSignature(source); f.store.put('document', {...source,revision:2});
  await assert.rejects(f.links('POST', taskLink('draft', {status:'draft',expectedDocumentSignature:signature})), {code:'LINK_DOCUMENT_CHANGED'});
  await assert.rejects(f.links('POST', taskLink('draft', {status:'draft',expectedDocumentSignature:''})), {code:'LINK_DOCUMENT_CHANGED'});
  const legacy = (await f.links('POST', taskLink('draft', {status:'draft'}))).link;
  assert.equal(legacy.status,'draft');
});
