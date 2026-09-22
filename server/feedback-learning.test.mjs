import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createStore } from './database.mjs';
import { canDocument } from './security.mjs';
import { learnFeedback, feedbackLearningStatus, getLearningBase, isFeedbackLearningUsable } from './feedback-learning.mjs';

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'xrag-feedback-learning-'));
  const store = createStore(directory);
  const users = {
    admin: { id: 'admin', name: '管理员', role: 'admin', active: true, department: '调度' },
    editor: { id: 'editor', name: '维护人', role: 'editor', active: true, department: '调度' },
    peer: { id: 'peer', name: '其他维护人', role: 'editor', active: true, department: '设备' },
    viewer: { id: 'viewer', name: '读者', role: 'viewer', active: true, department: '调度' },
  };
  Object.values(users).forEach(user => store.put('user', user));
  const base = store.put('base', { id: 'source-base', name: '原文库', visibility: 'company', ownerId: users.editor.id, department: '调度', members: [] });
  let serial = 0;
  const document = (patch = {}) => {
    const id = 'source-' + ++serial, text = '核对台账时需比对设备编号和站点，并登记核对人员。';
    const doc = store.put('document', { id, familyId: id, baseId: base.id, ownerId: users.editor.id, title: '设备台账核对', fileName: id + '.txt', storageName: id + '.txt', version: 1, revision: 1, contentRevision: 1, status: 'published', sensitivity: 'internal', chunkCount: 1, sha256: crypto.createHash('sha256').update(text).digest('hex'), ...patch });
    writeFileSync(path.join(directory, 'uploads', doc.storageName), text);
    store.replaceChunks(id, [{ id: id + '-chunk', documentId: id, ordinal: 0, page: 1, text }]);
    return doc;
  };
  const feedback = (patch = {}) => store.put('feedback', { id: 'feedback-' + ++serial, userId: users.editor.id, userName: users.editor.name, question: '台账核对需要检查什么？', comment: '旧答案说无需登记核对人员，这是错误的。', resolution: '比对设备编号和站点，并登记核对人员。', status: 'open', createdAt: '2026-09-09T01:00:00.000Z', updatedAt: '2026-09-09T01:00:00.000Z', ...patch });
  const learn = (row, user = users.editor, extra = {}) => learnFeedback(store, user, row.id, { expectedUpdatedAt: row.updatedAt || row.createdAt, ...extra });
  t.after(() => { store.close(); assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(directory, { recursive: true, force: true }); });
  return { store, directory, users, base, document, feedback, learn };
}
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);

test('canonical learning base is lazy, never hijacks a same-name ordinary base, and repeated clicks persist once', t => {
  const f = fixture(t), source = f.document();
  f.store.put('base', { id: 'same-name', name: '机器学习', ownerId: f.users.peer.id, visibility: 'company' });
  assert.equal(getLearningBase(f.store), null);
  const row = f.feedback({ documentId: source.id }), before = f.store.list('base').length;
  const result = f.learn(row), doc = f.store.get('document', result.documentId);
  assert.equal(result.status, 'published'); assert.equal(result.alreadyLearned, false);
  assert.notEqual(result.baseId, 'same-name'); assert.equal(getLearningBase(f.store).systemKind, 'feedback_learning');
  assert.equal(f.store.list('base').length, before + 1);
  const again = f.learn(row); assert.equal(again.documentId, doc.id); assert.equal(again.alreadyLearned, true);
  assert.equal(f.store.list('document').length, 2); assert.equal(f.store.events().filter(event => event.action === 'feedback.learned').length, 1);
  const original = readFileSync(path.join(f.directory, 'uploads', doc.storageName), 'utf8');
  assert.ok(original.includes(row.question)); assert.ok(original.includes(row.comment)); assert.ok(original.includes(row.resolution));
  assert.ok(!f.store.chunks(doc.id)[0].text.includes('无需登记'));
  assert.equal(isFeedbackLearningUsable(f.store, f.users.viewer, doc), true);
});

test('draft feedback can gain an explicit learning conclusion without changing the original feedback', t => {
  const f = fixture(t), row = f.feedback({ resolution: '', documentId: f.document().id });
  const draft = f.learn(row), draftDoc = f.store.get('document', draft.documentId);
  assert.equal(draft.status, 'review'); assert.equal(isFeedbackLearningUsable(f.store, f.users.editor, draftDoc), false);
  assert.equal(feedbackLearningStatus(f.store, f.users.editor, row).status, 'review');
  assert.equal(f.learn(row).alreadyLearned, true);
  const confirmed = f.learn(row, f.users.editor, { conclusion: '应登记核对人、核对日期和差异处理结果。' });
  const doc = f.store.get('document', confirmed.documentId);
  assert.equal(confirmed.status, 'published'); assert.equal(doc.version, 2); assert.equal(doc.previousVersionId, draft.documentId);
  assert.equal(doc.learning.conclusionSource, 'learning_confirmation');
  assert.equal(f.store.get('feedback', row.id).resolution, '');
  assert.equal(isFeedbackLearningUsable(f.store, f.users.viewer, doc), true);
  assert.equal(f.learn(row).alreadyLearned, true);
  assert.equal(f.learn(row, f.users.editor, { conclusion: doc.learning.confirmedConclusion }).documentId, doc.id);
});

test('an existing feedback resolution wins over optional input and changed conclusions create one new version', t => {
  const f = fixture(t), row = f.feedback({ documentId: f.document().id });
  const first = f.learn(row, f.users.editor, { conclusion: '用户输入不得覆盖原有结论' });
  assert.equal(f.store.get('document', first.documentId).learning.confirmedConclusion, row.resolution);
  const changed = f.store.put('feedback', { ...row, resolution: '增加核对时间记录。', updatedAt: '2026-09-09T01:01:00.000Z' });
  throwsCode(() => f.learn(row), 'FEEDBACK_REVISION_CONFLICT');
  assert.equal(isFeedbackLearningUsable(f.store, f.users.viewer, f.store.get('document', first.documentId)), false);
  assert.equal(feedbackLearningStatus(f.store, f.users.editor, changed).status, 'stale');
  const second = f.learn(changed), next = f.store.get('document', second.documentId);
  assert.equal(next.version, 2); assert.equal(f.store.get('document', first.documentId).status, 'superseded');
  assert.equal(f.learn(changed).documentId, next.id);
});

test('source-less learning is accessible only to the feedback author or admin even in a company-wide base', t => {
  const f = fixture(t), row = f.feedback();
  const result = f.learn(row), doc = f.store.get('document', result.documentId);
  for (const user of [f.users.editor, f.users.admin]) {
    assert.equal(canDocument(user, doc, f.store), true); assert.equal(isFeedbackLearningUsable(f.store, user, doc), true);
  }
  for (const user of [f.users.peer, f.users.viewer]) {
    assert.equal(canDocument(user, doc, f.store), false); assert.equal(isFeedbackLearningUsable(f.store, user, doc), false);
    assert.equal(feedbackLearningStatus(f.store, user, row).canLearn, false);
    assert.equal(feedbackLearningStatus(f.store, user, row).documentId, undefined);
    throwsCode(() => f.learn(row, user), 'FEEDBACK_LEARNING_FORBIDDEN');
  }
});

test('viewer feedback can be learned by admin but viewers and inactive editors cannot learn', t => {
  const f = fixture(t), row = f.feedback({ userId: f.users.viewer.id });
  throwsCode(() => f.learn(row, f.users.viewer), 'FEEDBACK_LEARNING_FORBIDDEN');
  const learned = f.learn(row, f.users.admin), doc = f.store.get('document', learned.documentId);
  assert.equal(canDocument(f.users.viewer, doc, f.store), true); assert.equal(isFeedbackLearningUsable(f.store, f.users.viewer, doc), true);
  assert.equal(canDocument(f.users.editor, doc, f.store), false);
  const own = f.feedback(); f.store.put('user', { ...f.users.editor, active: false });
  throwsCode(() => f.learn(own), 'FEEDBACK_LEARNING_FORBIDDEN');
});

test('source ACL is an additional boundary and revocation removes learned access', t => {
  const f = fixture(t); f.store.put('base', { ...f.base, visibility: 'private', members: [f.users.viewer.id] });
  const row = f.feedback({ documentId: f.document().id }), learned = f.learn(row), doc = f.store.get('document', learned.documentId);
  assert.equal(isFeedbackLearningUsable(f.store, f.users.viewer, doc), true);
  assert.equal(canDocument(f.users.peer, doc, f.store), false);
  f.store.put('base', { ...f.base, visibility: 'private', members: [] });
  assert.equal(canDocument(f.users.viewer, doc, f.store), false); assert.equal(isFeedbackLearningUsable(f.store, f.users.viewer, doc), false);
});

test('deleted, superseded, expired or edited source documents invalidate learning guidance', t => {
  const f = fixture(t), source = f.document(), row = f.feedback({ documentId: source.id });
  const result = f.learn(row), doc = f.store.get('document', result.documentId);
  for (const patch of [{ deletedAt: new Date().toISOString() }, { status: 'superseded' }, { expiresAt: '2020-01-01T00:00:00.000Z' }, { version: 2 }, { source: { accessState: 'withdrawn' } }]) {
    f.store.put('document', { ...source, ...patch });
    assert.equal(isFeedbackLearningUsable(f.store, f.users.admin, doc), false, JSON.stringify(patch));
  }
  f.store.put('document', source);
  const chunks = f.store.chunks(source.id); f.store.replaceChunks(source.id, [{ ...chunks[0], text: '原文已改，未递增版本也必须撤回。' }]);
  assert.equal(isFeedbackLearningUsable(f.store, f.users.viewer, doc), false);
  assert.equal(feedbackLearningStatus(f.store, f.users.editor, row).status, 'stale');
  const next = f.learn(row); assert.equal(f.store.get('document', next.documentId).version, 2);
  assert.equal(isFeedbackLearningUsable(f.store, f.users.viewer, f.store.get('document', next.documentId)), true);
});

test('feedback mutations are detected even without a changed timestamp; unconfirmed manual publication stays unusable', t => {
  const f = fixture(t), row = f.feedback({ documentId: f.document().id });
  const result = f.learn(row), doc = f.store.get('document', result.documentId);
  f.store.put('feedback', { ...row, comment: '反馈内容已重新核对' });
  assert.equal(isFeedbackLearningUsable(f.store, f.users.editor, doc), false);
  const empty = f.feedback({ resolution: '' }), draft = f.learn(empty), draftDoc = f.store.get('document', draft.documentId);
  f.store.put('document', { ...draftDoc, status: 'published' });
  assert.equal(isFeedbackLearningUsable(f.store, f.users.admin, f.store.get('document', draftDoc.id)), false);
});

test('editing learned chunks requires a new learning confirmation; recursion and uploads into the system base cannot expand access', t => {
  const f = fixture(t), row = f.feedback({ documentId: f.document().id }), result = f.learn(row), doc = f.store.get('document', result.documentId);
  f.store.replaceChunks(doc.id, [{ ...f.store.chunks(doc.id)[0], text: '没有确认的新内容' }]);
  assert.equal(isFeedbackLearningUsable(f.store, f.users.viewer, doc), false);
  const recursive = f.feedback({ documentId: doc.id });
  throwsCode(() => f.learn(recursive), 'FEEDBACK_LEARNING_FORBIDDEN');
  const ordinary = f.document({ baseId: result.baseId });
  assert.equal(canDocument(f.users.admin, ordinary, f.store), false);
  assert.equal(isFeedbackLearningUsable(f.store, f.users.admin, ordinary), false);
});

test('learning never restores a trashed record or duplicates its reserved version', t => {
  const f = fixture(t), row = f.feedback({ documentId: f.document().id }), result = f.learn(row), doc = f.store.get('document', result.documentId);
  f.store.put('document', { ...doc, deletedAt: new Date().toISOString(), status: 'archived' });
  assert.equal(feedbackLearningStatus(f.store, f.users.editor, row).status, 'trashed');
  assert.equal(feedbackLearningStatus(f.store, f.users.editor, row).canLearn, false);
  throwsCode(() => f.learn(row), 'LEARNING_DOCUMENT_IN_TRASH');
  assert.equal(f.store.list('document').length, 2);
});

test('failed persistence rolls back the base, document, chunks and new raw file', t => {
  const f = fixture(t), row = f.feedback(), before = readdirSync(path.join(f.directory, 'uploads'));
  f.store.audit = () => { throw new Error('isolated audit failure'); };
  assert.throws(() => f.learn(row), /isolated audit failure/);
  assert.equal(getLearningBase(f.store), null); assert.equal(f.store.list('document').length, 0);
  assert.equal(f.store.get('feedbackLearning', row.id), null);
  assert.deepEqual(readdirSync(path.join(f.directory, 'uploads')), before);
});

test('required expected stamp protects writes and no model is invoked by the standalone service', t => {
  const f = fixture(t), row = f.feedback();
  throwsCode(() => learnFeedback(f.store, f.users.editor, row.id), 'FEEDBACK_REVISION_REQUIRED');
  throwsCode(() => f.learn(row, f.users.editor, { conclusion: 'x'.repeat(4001) }), 'INVALID_LEARNING_CONCLUSION');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('A learning click must not access the network'); };
  try { assert.equal(f.learn(row).status, 'published'); } finally { globalThis.fetch = originalFetch; }
});

test('usability re-reads the current learning document rather than trusting an older caller snapshot', t => {
  const f = fixture(t), row = f.feedback({ documentId: f.document().id }), result = f.learn(row), oldSnapshot = f.store.get('document', result.documentId);
  f.store.put('document', { ...oldSnapshot, deletedAt: new Date().toISOString(), status: 'archived' });
  assert.equal(isFeedbackLearningUsable(f.store, f.users.admin, oldSnapshot), false);
  f.store.put('document', { ...oldSnapshot, status: 'superseded' });
  assert.equal(isFeedbackLearningUsable(f.store, f.users.editor, oldSnapshot), false);
});

test('ordinary reads also withdraw stale published learning, while its source-authorized maintainer can still manage it', t => {
  const f = fixture(t), source = f.document(), row = f.feedback({ documentId: source.id }), result = f.learn(row), doc = f.store.get('document', result.documentId);
  f.store.put('feedback', { ...row, resolution: '更新后的结论。' });
  assert.equal(canDocument(f.users.viewer, doc, f.store), false);
  assert.equal(canDocument(f.users.admin, doc, f.store), false);
  assert.equal(canDocument(f.users.editor, doc, f.store, { write: true }), true);
  assert.equal(feedbackLearningStatus(f.store, f.users.editor, f.store.get('feedback', row.id)).canLearn, true);
});

test('non-current published sources cannot advertise or accept learning, while valid and source-less feedback still work', t => {
  const f = fixture(t), source = f.document(), row = f.feedback({ documentId: source.id });
  for (const patch of [
    { status: 'review' }, { status: 'queued' }, { status: 'superseded' }, { status: 'archived' },
    { expiresAt: '2020-01-01T00:00:00.000Z' }, { effectiveAt: '2999-01-01T00:00:00.000Z' },
  ]) {
    f.store.put('document', { ...source, ...patch });
    for (const user of [f.users.editor, f.users.admin]) {
      const status = feedbackLearningStatus(f.store, user, row);
      assert.equal(status.canLearn, false, JSON.stringify(patch)); assert.match(status.reason, /原文档/);
      throwsCode(() => f.learn(row, user), 'FEEDBACK_LEARNING_FORBIDDEN');
    }
  }
  assert.equal(getLearningBase(f.store), null); assert.equal(f.store.list('document').length, 1);
  f.store.put('document', source);
  assert.equal(feedbackLearningStatus(f.store, f.users.editor, row).canLearn, true);
  const learned = f.learn(row); assert.equal(learned.status, 'published');
  f.store.put('document', { ...source, status: 'archived' });
  const stale = feedbackLearningStatus(f.store, f.users.editor, row);
  assert.equal(stale.canLearn, false); assert.equal(stale.status, 'stale'); assert.match(stale.reason, /原文档/);
  throwsCode(() => f.learn(row), 'FEEDBACK_LEARNING_FORBIDDEN');
  assert.equal(f.store.list('document').length, 2);
  const privateFeedback = f.feedback();
  assert.equal(feedbackLearningStatus(f.store, f.users.editor, privateFeedback).canLearn, true);
  assert.equal(f.learn(privateFeedback).status, 'published');
});
