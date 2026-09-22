import crypto from 'node:crypto';
import { canDocument, cleanString, requireValue } from './security.mjs';

// Only known, purely informational legacy messages are moved out of warnings.
// OCR, encoding, missing text and complex-layout notices still require review.
export function parserMessages(value = {}) {
  const notes = [...(value.notes || [])], warnings = [];
  for (const message of value.warnings || []) {
    if (/^文本页码为换页符划分的逻辑页；没有换页符时为第 1 页。$/.test(message) || /^解析内容经人工校对，原始文件已保留，请结合原件复核。$/.test(message)) notes.push(message);
    else warnings.push(message);
  }
  return { notes: [...new Set(notes)], warnings: [...new Set(warnings)] };
}

export const SOURCE_KINDS = ['official_public', 'internal_controlled', 'synthetic', 'reference', 'unspecified'];
export function governanceMetadata(input) {
  const patch = {};
  if (input.sourceKind !== undefined) {
    requireValue(SOURCE_KINDS.includes(input.sourceKind), 400, 'INVALID_SOURCE_KIND', '资料来源性质无效。');
    patch.sourceKind = input.sourceKind;
  }
  for (const key of ['applicability', 'businessOwner']) if (input[key] !== undefined) patch[key] = cleanString(input[key], key === 'applicability' ? 1000 : 120);
  if (input.reviewDueAt !== undefined) {
    requireValue(input.reviewDueAt === null || input.reviewDueAt === '' || (typeof input.reviewDueAt === 'string' && Number.isFinite(Date.parse(input.reviewDueAt))), 400, 'INVALID_REVIEW_DATE', '复审日期格式不正确。');
    patch.reviewDueAt = input.reviewDueAt ? new Date(input.reviewDueAt).toISOString() : null;
  }
  return patch;
}

export function warningFingerprint(doc) {
  return crypto.createHash('sha256').update(JSON.stringify([doc.id, doc.version, doc.sha256, doc.contentRevision || 1, doc.parser, parserMessages(doc).warnings])).digest('hex');
}

export function documentIssues(store, user, doc, time = Date.now()) {
  const issues = [], canManage = canDocument(user, doc, store, { write: true });
  const add = (type, severity, message, actions = [], extra = {}) => issues.push({
    id: `${doc.id}:${type}`, documentId: doc.id, title: doc.title, type, severity, message,
    ownerName: doc.businessOwner || store.get('user', doc.ownerId)?.name || '',
    expiresAt: doc.expiresAt || null, reviewDueAt: doc.reviewDueAt || null, revision: doc.revision,
    status: doc.status, createdAt: doc.createdAt, issueStatus: 'open', canManage, actions: canManage ? actions : [], ...extra,
  });
  if (doc.status === 'failed') add('parse_failed', 'high', doc.error || '解析失败，需处理原件或重试');
  if (doc.status === 'review') add('pending_review', 'medium', '资料已完成解析，等待业务审核');
  if (doc.status === 'published') {
    const expired = !!doc.expiresAt && Date.parse(doc.expiresAt) <= time;
    if (expired) add('expired', 'high', '文档已失效，已停止参与检索问答；须修订有效期并重新审核');
    else {
      if (doc.expiresAt && Date.parse(doc.expiresAt) - time < 30 * 86400000) add('expiring', 'medium', '文档将在 30 天内失效，请核对是否需要修订');
      if (!doc.reviewDueAt) add('no_review_date', 'low', '尚未设置独立复审日期；复审日期不会改变文档有效期', ['review']);
      else if (Date.parse(doc.reviewDueAt) <= time) add('review_due', 'medium', '文档已到复审日期，请复核内容并安排下次复审', ['review']);
    }
  }
  const { warnings } = parserMessages(doc);
  if (warnings.length && !['archived', 'superseded'].includes(doc.status)) {
    const fingerprint = warningFingerprint(doc), acknowledgement = doc.governanceAcknowledgements?.parse_warning;
    const acknowledged = acknowledgement?.status === 'acknowledged' && acknowledgement.fingerprint === fingerprint;
    add('parse_warning', 'medium', warnings.join('；'), [acknowledged ? 'reopen' : 'acknowledge'], {
      fingerprint, issueStatus: acknowledged ? 'acknowledged' : 'open', acknowledgement: acknowledged ? acknowledgement : null,
    });
  }
  return issues;
}

export function applyGovernanceAction(doc, input, user, timestamp) {
  const reason = cleanString(input.reason, 2000);
  requireValue(reason, 400, 'REASON_REQUIRED', '请填写复核结论或处理原因。');
  if (input.action === 'review') {
    requireValue(['review_due', 'no_review_date'].includes(input.type), 400, 'INVALID_GOVERNANCE_ACTION', '此问题不能通过复审关闭。');
    requireValue(doc.status === 'published' && (!doc.expiresAt || Date.parse(doc.expiresAt) > Date.parse(timestamp)), 409, 'REVIEW_NOT_ALLOWED', '仅已发布且未失效的资料可完成复审；待审核或失效资料须按发布流程处理。');
    requireValue(typeof input.nextReviewAt === 'string' && Number.isFinite(Date.parse(input.nextReviewAt)) && Date.parse(input.nextReviewAt) > Date.parse(timestamp), 400, 'NEXT_REVIEW_REQUIRED', '请设置未来的下次复审日期。');
    const metadata = governanceMetadata({ sourceKind: input.sourceKind, applicability: input.applicability, businessOwner: input.businessOwner });
    return { ...metadata, reviewDueAt: new Date(input.nextReviewAt).toISOString(), lastReviewedAt: timestamp, lastReviewedBy: user.id, lastReviewReason: reason };
  }
  requireValue(input.type === 'parse_warning' && ['acknowledge', 'reopen'].includes(input.action), 400, 'INVALID_GOVERNANCE_ACTION', '只有解析告警可确认或重新打开；审核、失效问题不能直接关闭。');
  requireValue(parserMessages(doc).warnings.length && !['archived', 'superseded'].includes(doc.status), 409, 'ISSUE_NOT_ACTIVE', '当前版本没有可办理的解析告警。');
  const fingerprint = warningFingerprint(doc), previous = doc.governanceAcknowledgements?.parse_warning;
  if (input.action === 'reopen') requireValue(previous?.status === 'acknowledged' && previous.fingerprint === fingerprint, 409, 'ISSUE_NOT_ACKNOWLEDGED', '当前版本的告警尚未确认。');
  return { governanceAcknowledgements: { ...(doc.governanceAcknowledgements || {}), parse_warning: { status: input.action === 'acknowledge' ? 'acknowledged' : 'open', reason, actorId: user.id, actorName: user.name, at: timestamp, fingerprint, version: doc.version } } };
}
