import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createStore } from './database.mjs';
import { createKnowledgeCard, knowledgeCardAction } from './knowledge-cards.mjs';
import { analyzeAnswerCompleteness, completeAnswerAnalysis } from './answer-completeness.mjs';
import { createKnowledgeDemand, knowledgeDemandAction } from './knowledge-demands.mjs';

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'xrag-knowledge-ext-'));
  const store = createStore(directory);
  const users = {
    admin: { id: 'admin', name: '管理员', role: 'admin', active: true, department: '调度' },
    editor: { id: 'editor', name: '编辑', role: 'editor', active: true, department: '制度' },
  };
  Object.values(users).forEach(user => store.put('user', user));
  const base = store.put('base', { id: 'base', name: '制度库', visibility: 'company', ownerId: users.editor.id, department: '制度', members: [] });
  const text = '出差须提前三个工作日申请，由部门负责人审批。';
  const doc = store.put('document', {
    id: 'doc-policy', familyId: 'doc-policy', baseId: base.id, ownerId: users.editor.id,
    title: '出差审批制度', fileName: 'policy.txt', storageName: 'policy.txt', version: 1, revision: 1,
    contentRevision: 1, status: 'published', sensitivity: 'internal', chunkCount: 1,
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
  });
  writeFileSync(path.join(directory, 'uploads', doc.storageName), text);
  store.replaceChunks(doc.id, [{ id: 'doc-policy-chunk', documentId: doc.id, ordinal: 0, page: 1, text }]);
  t.after(() => {
    store.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, users, base, doc };
}

const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);

test('knowledge card rejects illegal status transitions and requires evidence to publish', t => {
  const f = fixture(t);
  const created = createKnowledgeCard(f.store, f.users.editor, {
    title: '出差审批说明',
    template: 'card_rule',
    sourceDocumentIds: [f.doc.id],
    fields: { conclusion: '须提前申请并由部门负责人审批' },
  });
  const card = created.card;
  throwsCode(() => knowledgeCardAction(f.store, f.users.editor, card.id, { action: 'publish', revision: card.revision }), 'INVALID_STATUS');
  const submitted = knowledgeCardAction(f.store, f.users.editor, card.id, { action: 'submit', revision: card.revision }).card;
  throwsCode(() => knowledgeCardAction(f.store, f.users.editor, submitted.id, { action: 'publish', revision: submitted.revision }), 'EVIDENCE_REQUIRED');
  const withEvidence = f.store.put('knowledgeCard', {
    ...f.store.get('knowledgeCard', submitted.id),
    evidenceRefs: [{ documentId: f.doc.id, blockId: 'doc-policy-chunk', title: f.doc.title, text: '提前三个工作日' }],
    revision: submitted.revision,
  });
  const published = knowledgeCardAction(f.store, f.users.editor, withEvidence.id, { action: 'publish', revision: withEvidence.revision }).card;
  assert.equal(published.status, 'published');
  throwsCode(() => knowledgeCardAction(f.store, f.users.editor, published.id, { action: 'submit', revision: published.revision }), 'INVALID_STATUS');
});

test('smart completeness never invents factual enterprise slots without evidence', async t => {
  const f = fixture(t);
  const analyzed = analyzeAnswerCompleteness(f.store, f.users.editor, {
    question: '出差审批需要谁审批，办理时限多久？',
    answer: '请按制度办理。',
    citations: [],
  });
  const completed = await completeAnswerAnalysis(f.store, f.users.editor, {
    id: analyzed.analysis.id,
    mode: 'smart',
    createDemand: false,
  });
  assert.ok(completed.analysis.suggestions.length > 0);
  assert.ok(completed.analysis.suggestions.every(s => s.mode === 'smart' && s.factual === false && !(s.evidenceRefs || []).length));
  assert.ok(completed.analysis.suggestions.every(s => !/\d+\s*个工作日|部门负责人/.test(s.content) || /不得填写|澄清|结构/.test(s.content)));
});

test('completeness gaps can create pending_confirm knowledge demands', async t => {
  const f = fixture(t);
  const analyzed = analyzeAnswerCompleteness(f.store, f.users.editor, {
    question: '出差需要提交什么材料？办理时限多久？',
    answer: '',
    citations: [],
    runId: 'run-demo',
  });
  const completed = await completeAnswerAnalysis(f.store, f.users.editor, {
    id: analyzed.analysis.id,
    mode: 'hybrid',
    createDemand: true,
  });
  assert.ok(completed.analysis.demandIds.length >= 1);
  const demand = f.store.get('knowledgeDemand', completed.analysis.demandIds[0]);
  assert.equal(demand.status, 'pending_confirm');
  assert.equal(demand.source, 'completeness');
  assert.ok(demand.missingPoints.length > 0);
  throwsCode(() => knowledgeDemandAction(f.store, f.users.editor, demand.id, { action: 'close', revision: demand.revision }), 'INVALID_STATUS');
  const confirmed = knowledgeDemandAction(f.store, f.users.editor, demand.id, { action: 'confirm', revision: demand.revision }).demand;
  assert.equal(confirmed.status, 'confirmed');
});

test('manual demand creation and illegal transitions', t => {
  const f = fixture(t);
  const { demand } = createKnowledgeDemand(f.store, f.users.editor, {
    question: '某设备检修周期是多少？',
    category: 'knowledge_gap',
    missingPoints: ['检修周期'],
  });
  assert.equal(demand.status, 'confirmed');
  throwsCode(() => knowledgeDemandAction(f.store, f.users.editor, demand.id, { action: 'confirm', revision: demand.revision }), 'INVALID_STATUS');
  const assigned = knowledgeDemandAction(f.store, f.users.editor, demand.id, {
    action: 'assign',
    revision: demand.revision,
    assigneeId: f.users.editor.id,
  }).demand;
  assert.equal(assigned.status, 'assigned');
});
