import path from 'node:path';
import { existsSync } from 'node:fs';
import { canDocument, canEdit, requireValue } from './security.mjs';
import { now } from './database.mjs';

export function canManageTrashedDocument(user, document, store) {
  return Boolean(document?.deletedAt) && canEdit(user) && canDocument(user, {...document, deletedAt:null}, store, {write:true});
}

function requireRevision(document, revision) {
  requireValue(Number.isSafeInteger(revision) && revision > 0, 400, 'REVISION_REQUIRED', '请刷新文档后再操作，必须提供当前版本标识。');
  requireValue(revision === document.revision, 409, 'REVISION_CONFLICT', '内容已被其他人更新，请刷新后重试。');
}

export function cancelDeletedDocumentTasks(store, documentId) {
  for (const task of store.list('task').filter(row => row.documentId === documentId && ['queued','processing'].includes(row.status))) {
    store.put('task', {...task, status:'cancelled', stage:'文档已移入回收站', error:'文档已移入回收站，本次任务已停止。', errorCode:'DOCUMENT_IN_TRASH', nextAttemptAt:null, completedAt:now(), updatedAt:now()});
  }
}

export function moveDocumentToTrash(store, user, documentId, revision) {
  return store.transaction(() => {
    const document = store.get('document', documentId);
    requireValue(canEdit(user) && canDocument(user, document, store, {write:true}), 404, 'DOCUMENT_NOT_FOUND', '文档不存在或无权管理。');
    requireRevision(document, revision);
    const running = store.list('task').some(task => task.documentId === documentId && task.status === 'processing');
    requireValue(document.status !== 'processing' && document.embeddingStatus !== 'processing' && !running, 409, 'DOCUMENT_BUSY', '文档正在处理，请完成后再移入回收站。');
    const timestamp = now();
    const deleted = store.put('document', {...document, deletedAt:timestamp, deletedBy:user.id, deletedByName:user.name || user.username, deletedFromStatus:document.status, status:'archived', stage:'已移入回收站', updatedAt:timestamp, revision:document.revision+1, contentRevision:(document.contentRevision||1)+1, embeddingStatus:'pending', embeddingRunId:null, embeddingRetry:null});
    cancelDeletedDocumentTasks(store, documentId);
    store.audit(user, 'document.deleted', {documentId, documentTitle:document.title, baseId:document.baseId, version:document.version, fromStatus:document.status, message:'文档已移入回收站，原件与历史版本保留。'});
    return deleted;
  });
}

export function restoreDocumentFromTrash(store, user, documentId, revision) {
  return store.transaction(() => {
    const document = store.get('document', documentId);
    requireValue(canManageTrashedDocument(user, document, store), 404, 'DOCUMENT_NOT_FOUND', '回收站文档不存在或无权管理。');
    requireRevision(document, revision);
    requireValue(existsSync(path.join(store.dataDir, 'uploads', document.storageName)), 409, 'ORIGINAL_MISSING', '原件未找到，请先恢复原件备份。');
    cancelDeletedDocumentTasks(store, documentId);
    const chunks = store.chunks(documentId), hasContent = chunks.length > 0, timestamp = now();
    const restored = store.put('document', {...document, deletedAt:null, deletedBy:null, deletedByName:null, deletedFromStatus:null, restoredAt:timestamp, restoredBy:user.id, status:hasContent?'review':'queued', stage:hasContent?'待审核':'等待解析', progress:hasContent?100:0, chunkCount:chunks.length, error:null, errorCode:null, publishedAt:null, reviewerId:null, reviewReason:null, updatedAt:timestamp, revision:document.revision+1, contentRevision:(document.contentRevision||1)+1, embeddingStatus:'pending', embeddingRunId:null, embeddingRetry:null, embeddingError:null});
    store.audit(user, 'document.restored_from_trash', {documentId, documentTitle:document.title, baseId:document.baseId, version:document.version, deletedAt:document.deletedAt, restoredStatus:restored.status, message:hasContent?'文档已恢复为待审核，重新审核后才能使用。':'文档已恢复，等待重新解析与审核。'});
    return restored;
  });
}