import crypto from 'node:crypto';
import { canDocument, canEdit, requireValue } from './security.mjs';

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const revisionNumber = chunk => chunk.blockRevision || 1;
export const historyAvailable = (store, user, document) => canEdit(user) && canDocument(user, document, store, { write: true });

function snapshot(chunk) {
  return { text: chunk.text, table: clone(chunk.table), structuredData: clone(chunk.table || chunk.structuredData), locator: clone(chunk.locator), quality: clone(chunk.quality), evidenceType: chunk.evidenceType || (chunk.table ? 'table' : 'paragraph'), reviewState: chunk.reviewState || 'unreviewed', blockRevision: revisionNumber(chunk), heading: chunk.heading || '' };
}

// Called inside the same synchronous transaction as the document/chunk mutation.
// INSERT (never UPSERT) and a deterministic source revision key reject duplicate snapshots.
export function preserveEvidenceRevisions(store, { document, next, oldChunks, chunks, actor, reason, blockId, blockIds, sourceFingerprint }) {
  const insert = store.db.prepare('INSERT INTO entities(kind,id,data) VALUES(?,?,?)');
  const records = [];
  const reviewed = new Set(blockIds?.length ? blockIds : blockId ? [blockId] : []);
  for (let index = 0; index < oldChunks.length; index++) {
    const before = oldChunks[index], after = chunks[index];
    if (revisionNumber(before) === revisionNumber(after)) continue;
    const id = 'evidence_revision_' + hash([document.id, document.revision, before.id, revisionNumber(before)]);
    requireValue(!store.get('evidenceRevision', id), 409, 'EVIDENCE_HISTORY_CONFLICT', '该来源修订已保存校对历史，请刷新后重试。');
    const record = {
      id, documentId: next.id, documentVersion: next.version, documentRevision: next.revision,
      chunkId: after.id, blockRevision: revisionNumber(after),
      sourceDocumentId: document.id, sourceDocumentVersion: document.version, sourceDocumentRevision: document.revision,
      sourceChunkId: before.id, sourceBlockRevision: revisionNumber(before),
      createdAt: next.updatedAt, actorId: actor.id, actorName: actor.name || actor.username || '维护人员', reason,
      cause: reviewed.has(before.id) ? 'manual_review' : 'header_propagation',
      sourceFingerprint, sourceOriginalSha256: document.sha256 || null,
      before: snapshot(before), after: snapshot(after),
    };
    insert.run('evidenceRevision', id, JSON.stringify(record));
    records.push(record);
  }
  return records;
}

export function evidenceHistory(store, user, document) {
  requireValue(historyAvailable(store, user, document), 404, 'EVIDENCE_HISTORY_NOT_FOUND', '校对历史不存在或无权查看。');
  const allRecords = store.list('evidenceRevision');
  const lineage = new Map();
  let current = document, ancestryUnavailable = false;
  while (current && !lineage.has(current.id) && lineage.size < 64) {
    if (!historyAvailable(store, user, current)) { ancestryUnavailable = true; break; }
    lineage.set(current.id, current);
    if (!current.previousVersionId) break;
    current = store.get('document', current.previousVersionId);
    if (!current) ancestryUnavailable = true;
  }
  const allowed = record => {
    const target = store.get('document', record.documentId), source = store.get('document', record.sourceDocumentId);
    return lineage.has(record.documentId) && historyAvailable(store, user, target) && historyAvailable(store, user, source);
  };
  const records = allRecords.filter(allowed);
  const indexed = new Map(records.map(record => [[record.documentId, record.chunkId, record.blockRevision].join(':'), record]));
  let incomplete = ancestryUnavailable;
  // Follow source revision edges rather than assuming every old blockRevision has a saved body.
  for (const chunk of store.chunks(document.id)) {
    let docId = document.id, chunkId = chunk.id, revision = revisionNumber(chunk), origin = chunk.evidenceOrigin;
    const seen = new Set();
    while (revision > 1) {
      const key = [docId, chunkId, revision].join(':');
      if (seen.has(key)) { incomplete = true; break; }
      seen.add(key);
      const record = indexed.get(key);
      if (record) { docId = record.sourceDocumentId; chunkId = record.sourceChunkId; revision = record.sourceBlockRevision; origin = null; continue; }
      if (!origin) origin = store.chunks(docId).find(item => item.id === chunkId)?.evidenceOrigin;
      if (origin && origin.blockRevision === revision && lineage.has(origin.documentId)) {
        docId = origin.documentId; chunkId = origin.chunkId;
        const sourceChunk = store.chunks(docId).find(item => item.id === chunkId);
        origin = sourceChunk?.evidenceOrigin;
        continue;
      }
      incomplete = true; break;
    }
  }
  const limit = 500, truncated = records.length > limit;
  const notice = [
    ...(incomplete ? ['先前校对仅保留审计、来源版本不可访问或部分修改前正文快照缺失；未补造历史。'] : []),
    ...(truncated ? ['当前仅显示最近500条修订记录。'] : []),
  ].join(' ') || null;
  return {
    document: { id: document.id, title: document.title, version: document.version },
    history: { incomplete, truncated, notice, records: records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.blockRevision - a.blockRevision || b.id.localeCompare(a.id)).slice(0, limit) },
  };
}
