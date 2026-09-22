import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { now, uid } from './database.mjs';
import { canEdit, isAdmin, canDocument, isRetrievable, requireValue, feedbackLearningFingerprint, learningSourceFingerprint, feedbackLearningAccess, feedbackLearningContentCurrent } from './security.mjs';

export const FEEDBACK_LEARNING_KIND = 'feedback_learning';
const canonicalSetting = 'feedback-learning-base';

/** Read-only: a normal knowledge base with the same name is never adopted. */
export function getLearningBase(store) {
  const configured = store.get('setting', canonicalSetting)?.baseId;
  const base = configured && store.get('base', configured);
  if (base?.systemKind === FEEDBACK_LEARNING_KIND) return base;
  return store.list('base').filter(item => item.systemKind === FEEDBACK_LEARNING_KIND)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id))[0] || null;
}

function ensureLearningBase(store, timestamp) {
  let base = getLearningBase(store);
  if (!base) base = store.put('base', {
    id: uid('base_'), name: '机器学习', description: '系统后台自用的自学习知识库，积累反馈中已确认的纠错经验，在相关问答中辅助系统持续改进回答。',
    systemKind: FEEDBACK_LEARNING_KIND, visibility: 'company', ownerId: 'system_feedback_learning',
    department: '', members: [], createdAt: timestamp, updatedAt: timestamp,
  });
  store.put('setting', { id: canonicalSetting, baseId: base.id });
  return base;
}

function actor(store, user) {
  const current = user?.id && store.get('user', user.id);
  return current?.active ? current : null;
}

function learningSource(store, user, feedback) {
  if (!feedback.documentId) return { allowed: isAdmin(user) || feedback.userId === user?.id, snapshots: [] };
  const source = store.get('document', feedback.documentId);
  if (!source || !canDocument(user, source, store)) return { allowed: false, reason: '原文档不存在或已无权访问。', snapshots: [] };
  if (source.learning || store.get('base', source.baseId)?.systemKind === FEEDBACK_LEARNING_KIND)
    return { allowed: false, reason: '学习资料不能再次作为学习来源。', snapshots: [] };
  if (source.source?.accessState === 'withdrawn' || source.source?.freshUntil && Date.parse(source.source.freshUntil) <= Date.now())
    return { allowed: false, reason: '原文档来源已失效，请先核对来源。', snapshots: [] };
  if (!isRetrievable(source)) {
    const reason = source.status === 'superseded' ? '原文档已有新版本，请基于当前已发布版本重新反馈。'
      : source.status === 'archived' ? '原文档已下架，暂不能加入机器学习。'
      : source.status !== 'published' ? '原文档尚未发布，发布后才能加入机器学习。'
      : '原文档尚未生效或已过有效期，暂不能加入机器学习。';
    return { allowed: false, reason, snapshots: [] };
  }
  return { allowed: true, snapshots: [{ documentId: source.id, version: source.version, contentFingerprint: learningSourceFingerprint(source, store.chunks(source.id)) }] };
}

function permission(store, user, feedback) {
  if (!user || !feedback) return { allowed: false, reason: '反馈不存在或无权访问。', snapshots: [] };
  const visible = isAdmin(user) || feedback.userId === user.id || canEdit(user) && feedback.documentId && canDocument(user, store.get('document', feedback.documentId), store);
  if (!visible) return { allowed: false, reason: '反馈不存在或无权访问。', snapshots: [] };
  const source = learningSource(store, user, feedback);
  if (!source.allowed) return source;
  if (!canEdit(user)) return { ...source, allowed: false, reason: '需要知识维护权限才能加入机器学习。' };
  return source;
}

/** Ordinary ACLs are necessary but insufficient: learned guidance must still match its confirmed input. */
export function isFeedbackLearningUsable(store, user, document) {
  const current = actor(store, user);
  document = document?.id ? store.get('document', document.id) : null;
  if (!current || !document?.learning || getLearningBase(store)?.id !== document.baseId || !isRetrievable(document)) return false;
  if (!canDocument(current, document, store) || !feedbackLearningContentCurrent(store, document)) return false;
  return document.learning.sourceSnapshots.every(ref => {
    const source = store.get('document', ref.documentId);
    return source && isRetrievable(source) && canDocument(current, source, store)
      && source.version === ref.version && learningSourceFingerprint(source, store.chunks(source.id)) === ref.contentFingerprint;
  });
}

export function feedbackLearningStatus(store, user, feedback) {
  const current = actor(store, user), access = permission(store, current, feedback);
  if (!feedback) return { canLearn: false, reason: access.reason };
  const record = store.get('feedbackLearning', feedback.id);
  const document = record && store.get('document', record.documentId);
  const view = { canLearn: access.allowed, ...(access.reason ? { reason: access.reason } : {}) };
  if (!document) return view;
  // Never leak a learned document id after source access is revoked.
  if (!current || !feedbackLearningAccess(store, current, document)) return { canLearn: false, reason: access.reason || '学习记录的来源已失效或访问权限已变化。' };
  Object.assign(view, { baseId: document.baseId, learnedAt: document.learning.learnedAt });
  if (document.deletedAt) return { ...view, canLearn: false, status: 'trashed', reason: '学习记录已移入回收站，请先恢复后再使用。' };
  view.documentId = document.id;
  const currentInput = feedbackLearningContentCurrent(store, document);
  const sourcesCurrent = document.learning.sourceSnapshots.every(ref => {
    const source = store.get('document', ref.documentId);
    return source && source.version === ref.version && learningSourceFingerprint(source, store.chunks(source.id)) === ref.contentFingerprint;
  });
  view.status = currentInput && sourcesCurrent && ['published', 'review'].includes(document.status) ? document.status : 'stale';
  if (view.status === 'review') view.reason = document.learning.hasResolution ? '学习记录待审核，发布后可纳入问答参考。' : '已保存，补充结论后可纳入问答参考。';
  else if (view.status === 'stale') view.reason = '反馈或原文档已更新，请核对后重新学习。';
  else if (view.status === 'published' && !isFeedbackLearningUsable(store, current, document)) {
    view.status = 'stale'; view.reason = '原文档尚未发布或已失效，学习结论暂不参与问答。';
  }
  return view;
}

/** Synchronous and transactional. No model calls, networking or indexing happen on click. */
export function learnFeedback(store, user, feedbackId, { expectedUpdatedAt, conclusion } = {}) {
  let createdFile;
  try {
    return store.transaction(() => {
      const current = actor(store, user), feedback = store.get('feedback', feedbackId);
      const access = permission(store, current, feedback);
      requireValue(access.allowed, 403, 'FEEDBACK_LEARNING_FORBIDDEN', access.reason || '无权加入机器学习。');
      requireValue(typeof expectedUpdatedAt === 'string' && expectedUpdatedAt.length > 0, 400, 'FEEDBACK_REVISION_REQUIRED', '请刷新反馈后再加入机器学习。');
      requireValue(expectedUpdatedAt === (feedback.updatedAt || feedback.createdAt), 409, 'FEEDBACK_REVISION_CONFLICT', '反馈已更新，请刷新后重新核对。');
      const previousRecord = store.get('feedbackLearning', feedback.id);
      const previous = previousRecord && store.get('document', previousRecord.documentId);
      requireValue(!previous?.deletedAt, 409, 'LEARNING_DOCUMENT_IN_TRASH', '学习记录已移入回收站，请先恢复。');
      requireValue(conclusion === undefined || typeof conclusion === 'string' && conclusion.length <= 4000, 400, 'INVALID_LEARNING_CONCLUSION', '确认结论最多 4000 字。');
      const feedbackFingerprint = feedbackLearningFingerprint(feedback);
      const feedbackResolution = String(feedback.resolution || '').trim();
      const confirmedConclusion = feedbackResolution || (conclusion === undefined && previous?.learning?.feedbackFingerprint === feedbackFingerprint ? previous.learning.confirmedConclusion || '' : String(conclusion || '').trim());
      const signature = crypto.createHash('sha256').update(JSON.stringify([feedbackFingerprint, access.snapshots, confirmedConclusion])).digest('hex');
      if (previous && previousRecord.inputSignature === signature && feedbackLearningContentCurrent(store, previous)) {
        return { documentId: previous.id, baseId: previous.baseId, status: previous.status, alreadyLearned: true, updatedAt: feedback.updatedAt || feedback.createdAt };
      }
      const timestamp = now(), base = ensureLearningBase(store, timestamp), id = uid('doc_');
      const resolution = confirmedConclusion, question = String(feedback.question || '').trim(), comment = String(feedback.comment || '').trim();
      const familyId = previous?.familyId || id;
      const family = store.list('document').filter(document => document.baseId === base.id && (document.familyId || document.id) === familyId);
      const version = family.length ? Math.max(...family.map(document => Number(document.version) || 1)) + 1 : 1;
      const title = ('反馈学习 · ' + (question || comment || '知识使用反馈').replace(/\s+/g, ' ')).slice(0, 180);
      const original = ['# ' + title, '', '## 问题', question || '未填写问题', '', '## 原反馈（待核实背景）', comment || '未填写反馈说明', '', '## 已确认结论', resolution || '待补充结论，暂不用于问答参考。', '', '## 来源记录', '反馈编号：' + feedback.id, '原文档编号：' + (feedback.documentId || '无；仅反馈作者和管理员可访问'), '纳入人：' + current.name, '纳入时间：' + timestamp, ''].join('\n');
      const bytes = Buffer.from(original, 'utf8'), storageName = id + '.md';
      const rawPath = path.join(store.dataDir, 'uploads', storageName);
      writeFileSync(rawPath, bytes, { flag: 'wx', mode: 0o600 });
      createdFile = rawPath;
      const chunk = { id: uid('chunk_'), documentId: id, ordinal: 0, page: 1, heading: resolution ? '已确认结论' : '待补充结论', text: resolution ? ['问题：' + (question || '知识使用反馈'), '已确认结论：' + resolution].join('\n') : ['问题：' + (question || '知识使用反馈'), '原反馈（待核实）：' + comment, '待补充结论，暂不用于问答参考。'].join('\n'), evidenceType: 'paragraph', reviewState: resolution ? 'confirmed' : 'unreviewed', locator: { type: 'text', paragraph: 1 } };
      const learning = { schemaVersion: 1, feedbackId: feedback.id, feedbackFingerprint, sourceDocumentId: feedback.documentId || null, sourceUserId: feedback.userId, sourceSnapshots: access.snapshots, learnedBy: current.id, learnedAt: timestamp, hasResolution: !!resolution, confirmedConclusion: resolution, conclusionSource: resolution ? (feedbackResolution ? 'feedback_resolution' : 'learning_confirmation') : null, chunksFingerprint: crypto.createHash('sha256').update(JSON.stringify([chunk])).digest('hex') };
      const document = { id, familyId, baseId: base.id, ownerId: feedback.documentId ? current.id : feedback.userId, department: '', title, fileName: title.replace(/[\\/:*?"<>|]/g, '_') + '.md', storageName, mimeType: 'text/markdown', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), status: resolution ? 'published' : 'review', stage: resolution ? '已发布' : '待补充结论', progress: 100, error: null, version, previousVersionId: previous?.id || null, revision: 1, contentRevision: 1, chunkCount: 1, pageCount: 1, sourceKind: 'unspecified', applicability: '经确认的反馈结论，仅作为相关业务问题的补充参考。', businessOwner: current.name, sensitivity: 'internal', warnings: [], notes: [], tags: ['反馈学习'], summary: resolution ? resolution.slice(0, 240) : '待补充结论，暂不参与问答。', createdAt: timestamp, updatedAt: timestamp, publishedAt: resolution ? timestamp : null, reviewerId: resolution ? current.id : null, reviewReason: resolution ? '经反馈学习操作确认纳入使用。' : null, parseCoverage: 'complete', visualCoverage: 'not_applicable', learning };
      for (const older of family.filter(item => !item.deletedAt && item.status === 'published')) store.put('document', { ...older, status: 'superseded', stage: '已有新学习版本', revision: (older.revision || 1) + 1, updatedAt: timestamp });
      store.put('document', document); store.replaceChunks(id, [chunk]);
      store.put('feedbackLearning', { id: feedback.id, documentId: id, baseId: base.id, inputSignature: signature, learnedAt: timestamp, learnedBy: current.id });
      store.audit(current, 'feedback.learned', { documentId: id, documentTitle: title, target: feedback.id, baseId: base.id, version, status: document.status, previousVersionId: previous?.id || null });
      return { documentId: id, baseId: base.id, status: document.status, alreadyLearned: false, updatedAt: feedback.updatedAt || feedback.createdAt };
    });
  } catch (error) {
    if (createdFile) try { unlinkSync(createdFile); } catch {}
    throw error;
  }
}
