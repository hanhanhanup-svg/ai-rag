import crypto from 'node:crypto';
import { copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { uid, now } from './database.mjs';
import { canDocument, canEdit, requireValue, cleanString } from './security.mjs';
import { historyAvailable, preserveEvidenceRevisions } from './evidence-history.mjs';

export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function currentActor(store, user) { const actor = store.get('user', user?.id); requireValue(actor?.active, 401, 'AUTH_REQUIRED', '账号已停用，请重新登录。'); return actor; }
export function checkedDocument(store, user, id, write = false) { const document = store.get('document', id); requireValue(canDocument(user, document, store, { write }), 404, 'DOCUMENT_NOT_FOUND', '文档不存在或无权访问。'); return document; }
export function revision(value, expected) { requireValue(Number.isInteger(value) && value === (expected || 0), 409, 'REVISION_CONFLICT', '资料已更新，请刷新后重试。'); }
export function documentFingerprint(document, chunks) { return digest({ version: document.version, contentRevision: document.contentRevision || 1, status: document.status, sensitivity: document.sensitivity, baseId: document.baseId, applicability: document.applicability || '', effectiveAt: document.effectiveAt, expiresAt: document.expiresAt, source: document.source ? {connectorId:document.source.connectorId,externalId:document.source.externalId,sourceRevision:document.source.sourceRevision,contentHash:document.source.contentHash,permissionMappingVersion:document.source.permissionMappingVersion,accessState:document.source.accessState} : null, chunks: chunks.map(c => [c.id, digest(c.text), c.table ? digest(c.table) : null]) }); }
export function evidenceBlocks(store, document, user) {
  const writable = canDocument(user, document, store, { write: true }) && ['review', 'published'].includes(document.status);
  return store.chunks(document.id).map(chunk => {
    const type = chunk.evidenceType || (chunk.table ? 'table' : 'paragraph');
    const ext = path.extname(document.fileName || '').toLowerCase();
    const locator = chunk.locator || { page: chunk.page, pageKind: ext === '.docx' ? 'logical' : ext === '.xlsx' ? 'worksheet' : ['.csv','.tsv','.txt','.md','.html','.json'].includes(ext) ? 'logical' : 'physical', ...(chunk.table ? { sheet: chunk.table.format === 'xlsx' ? chunk.table.name : undefined, rowNumbers: chunk.table.rowNumbers, rowNumberKind: chunk.table.rowNumberKind, tableId: chunk.table.tableId, cellRange: chunk.table.cellRange } : {}) };
    return { id: chunk.id, documentId: document.id, documentVersion: document.version, blockRevision: chunk.blockRevision || 1, type, text: chunk.text, structuredData: chunk.table || chunk.structuredData || null, locator, contentHash: digest({ text: chunk.text, table: chunk.table || null }), parserVersion: document.parser || 'legacy', quality: chunk.quality || { text: 'unknown', structure: 'unknown', method: 'legacy' }, reviewState: chunk.reviewState || 'unreviewed', canManage: writable, heading: chunk.heading || '', ...(chunk.reviewedAt ? { reviewedAt: chunk.reviewedAt, reviewedBy: chunk.reviewedBy } : {}) };
  });
}
export function publicEvidence(store, document, user) { return { document: { id: document.id, title: document.title, version: document.version, revision: document.revision, status: document.status, canManage: canDocument(user, document, store, { write: true }) && ['review','published'].includes(document.status) }, blocks: evidenceBlocks(store, document, user), historyAvailable: historyAvailable(store, user, document) }; }

function validateTablePatch(previous, input) {
  requireValue(previous && input && input.schemaVersion === 1 && Array.isArray(input.headers) && input.headers.length > 0 && input.headers.length <= 1000 && Array.isArray(input.rows), 400, 'INVALID_TABLE', '只能校对已有结构化表格，须提供完整表头和当前片段全部数据行。');
  requireValue(input.headers.every(x => typeof x === 'string' && x.length <= 1000) && input.rows.length === previous.rows.length && input.rows.every(r => Array.isArray(r) && r.length === input.headers.length && r.every(c => typeof c === 'string' && c.length <= 12000)), 400, 'INVALID_TABLE', '表格字段或行数无效；不能在片段校对中新增、删除或遗漏来源记录。');
  requireValue(JSON.stringify(input.rowNumbers) === JSON.stringify(previous.rowNumbers) && input.totalRows === previous.totalRows && input.tableId === previous.tableId, 400, 'TABLE_SOURCE_CHANGED', '来源记录号、表格标识和总记录数不可改写。');
  requireValue(input.headers.every(h=>h.trim())&&new Set(input.headers.map(h=>h.trim())).size===input.headers.length,400,'INVALID_TABLE_HEADERS','列名必须非空且互不重复。');
  requireValue(input.headers.length === previous.headers.length, 400, 'TABLE_COLUMNS_CHANGED', '列数调整需要重新解析完整表格，不能仅修改一个片段。');
  requireValue(JSON.stringify(input).length <= 100000, 413, 'TABLE_TOO_LARGE', '校对片段过大，请按片段处理。');
  return { ...previous, headers: input.headers.map(x => x.trim()), rows: input.rows.map(r => [...r]), ...(Array.isArray(input.fieldTypes) && input.fieldTypes.length === input.headers.length ? { fieldTypes: input.fieldTypes.map(x => ['text','number','date','unknown'].includes(x) ? x : 'unknown') } : {}) };
}
function tableText(table) { return `表格：${table.name || '数据表'}；数据行 ${table.rowStart || 1}–${table.rowEnd ?? table.totalRows} / ${table.totalRows}\n${table.headers.join('\t')}\n${table.rows.map((r,i) => `[源${table.rowNumberKind === 'worksheet-row' ? '行' : '记录'}${table.rowNumbers[i]}] ${r.map(c=>c.replace(/[\t\r\n]+/g,' ')).join('\t')}`).join('\n')}`; }

export function reviewEvidence(store, user, documentId, blockId, input) {
  return reviewEvidenceBatch(store, user, documentId, { ...input, items: [{ id: blockId, blockRevision: input.blockRevision }] });
}

export function reviewEvidenceBatch(store, user, documentId, input) {
  const reason = cleanString(input.reason, 2000); requireValue(reason.length >= 2, 400, 'REASON_REQUIRED', '请填写校对依据或确认原因。');
  const items = Array.isArray(input.items) ? input.items : [];
  requireValue(items.length >= 1 && items.length <= 50, 400, 'BATCH_SIZE', '请选择 1–50 条待核验证据。');
  const hasEdit = input.text !== undefined || input.structuredData !== undefined || input.locator !== undefined;
  requireValue(!(hasEdit && items.length > 1), 400, 'BATCH_EDIT_UNSUPPORTED', '批量办理仅支持记录已核验；正文或时间校对请逐条处理。');
  requireValue(!(input.text !== undefined && input.structuredData !== undefined), 400, 'AMBIGUOUS_CORRECTION', '文本校对和结构化校对请分别提交。');
  let copiedPath;
  try {
    return store.transaction(() => {
      const actor = currentActor(store, user), document = checkedDocument(store, actor, documentId, true);
      requireValue(canEdit(actor) && ['published', 'review'].includes(document.status), 409, 'DOCUMENT_NOT_REVIEWABLE', '仅待审核或已发布资料可以校对。');
      revision(input.revision, document.revision);
      const oldChunks = store.chunks(documentId);
      const seen = new Set();
      const targets = items.map(item => {
        const id = cleanString(item?.id, 120);
        requireValue(id && !seen.has(id), 400, 'INVALID_BATCH_ITEM', '批量核验条目无效或重复。');
        seen.add(id);
        const original = oldChunks.find(chunk => chunk.id === id);
        requireValue(original, 404, 'EVIDENCE_NOT_FOUND', '证据片段不存在。');
        revision(item.blockRevision, original.blockRevision || 1);
        requireValue((original.reviewState || 'unreviewed') !== 'confirmed' || hasEdit, 409, 'ALREADY_CONFIRMED', '所选片段中包含已核验证据，请刷新后重试。');
        return original;
      });

      const changes = new Map();
      let tableRemoved = false;
      for (const original of targets) {
        const changed = { ...original, blockRevision: (original.blockRevision || 1) + 1, reviewState: 'confirmed', reviewedAt: now(), reviewedBy: actor.id, corrected: true };
        if (input.locator !== undefined) {
          requireValue(['transcript', 'frame_text'].includes(original.evidenceType), 400, 'LOCATOR_NOT_EDITABLE', '此接口仅支持校对音视频时间位置。');
          const { startMs, endMs } = input.locator;
          requireValue(Number.isFinite(document.durationMs) && Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= 0 && endMs > startMs && endMs <= document.durationMs, 400, 'INVALID_TIME_RANGE', '时间位置须在原音视频时长内且结束晚于开始。');
          changed.locator = { ...original.locator, startMs: Math.round(startMs), endMs: Math.round(endMs), precision: 'reviewed', ...(original.evidenceType === 'frame_text' ? { sampleMs: Math.round(startMs) } : {}) };
        }
        if (input.structuredData !== undefined) { changed.table = validateTablePatch(original.table, input.structuredData); changed.text = tableText(changed.table); }
        if (input.text !== undefined) {
          requireValue(typeof input.text === 'string' && input.text.trim().length > 0 && input.text.length <= 16000, 400, 'INVALID_TEXT', '校对文本不能为空且不得超过16000字符。');
          changed.text = input.text.trim();
          if (changed.text !== original.text && original.table) { delete changed.table; delete changed.structuredData; changed.evidenceType = 'paragraph'; tableRemoved = true; }
        }
        changed.quality = { ...(original.quality || {}), text: 'reviewed', structure: tableRemoved ? 'unavailable' : changed.table ? 'reviewed' : 'unknown', method: 'manual' };
        changes.set(original.id, changed);
      }

      let next = { ...document, revision: (document.revision || 0) + 1, contentRevision: (document.contentRevision || 1) + 1, updatedAt: now(), embeddingStatus: 'pending' };
      const createdVersion = document.status === 'published';
      if (createdVersion) {
        const id = uid('doc_'), familyId = document.familyId || document.id, version = 1 + Math.max(...store.list('document').filter(d => (d.familyId || d.id) === familyId).map(d => d.version || 1));
        const storageName = id + path.extname(document.storageName);
        copiedPath = path.join(store.dataDir, 'uploads', storageName);
        copyFileSync(path.join(store.dataDir, 'uploads', document.storageName), copiedPath, 1);
        next = { ...next, id, familyId, version, storageName, previousVersionId: document.id, status: 'review', stage: '证据已校对，待审核', revision: 1, createdAt: now(), ownerId: actor.id, progress: 100 };
        delete next.publishedAt; delete next.publishedBy;
        next.evidenceSourceId = document.id; next.evidenceSourceRevision = document.revision;
        store.put('document', { ...document, revision: document.revision + 1, updatedAt: now() });
      }
      if (tableRemoved) { next.structuredDataIncomplete = true; next.warnings = [...new Set([...(next.warnings || []), '表格片段经文本校对，结构化字段需重新核对；全表统计暂不可用。'])]; }

      const primaryId = targets[0].id;
      const primaryChanged = changes.get(primaryId);
      const chunks = oldChunks.map(chunk => {
        let value = changes.has(chunk.id) ? changes.get(chunk.id) : { ...chunk };
        if (input.structuredData && primaryChanged?.table && JSON.stringify(primaryChanged.table.headers) !== JSON.stringify(targets[0].table.headers) && value.table?.tableId === targets[0].table.tableId && !changes.has(chunk.id)) {
          value = { ...value, table: { ...value.table, headers: [...primaryChanged.table.headers], reviewRequired: true }, blockRevision: (value.blockRevision || 1) + 1, reviewState: 'unreviewed' };
          value.text = tableText(value.table);
        }
        return { ...value, id: createdVersion ? uid('chunk_') : value.id, documentId: next.id, ...(createdVersion ? { evidenceOrigin: { documentId: document.id, chunkId: chunk.id, blockRevision: chunk.blockRevision || 1 } } : {}) };
      });
      preserveEvidenceRevisions(store, { document, next, oldChunks, chunks, actor, reason, blockId: primaryId, blockIds: targets.map(item => item.id), sourceFingerprint: documentFingerprint(document, oldChunks) });
      store.put('document', next); store.replaceChunks(next.id, chunks);
      store.audit(actor, 'evidence.reviewed', { documentId: next.id, sourceDocumentId: document.id, blockId: primaryId, blockIds: targets.map(item => item.id), reviewedCount: targets.length, createdVersion, reason, tableRemoved });
      return { ...publicEvidence(store, next, actor), createdVersion, reviewedCount: targets.length };
    });
  } catch (error) { if (copiedPath) try { unlinkSync(copiedPath); } catch {} throw error; }
}
