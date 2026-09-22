import crypto from 'node:crypto';
import { now } from './database.mjs';
import { canBase, canDocument, canEdit, isRetrievable, requireValue, cleanString } from './security.mjs';
import { digest, currentActor, checkedDocument, revision, documentFingerprint, evidenceBlocks } from './knowledge-evidence.mjs';

export const GRAPH_LIMITS = Object.freeze({ maxNodes: 200, maxEdges: 400, maxHops: 3, maxPaths: 100, maxDocuments: 100, maxRows: 10000, maxBatchReview: 50 });
export const GRAPH_ALGORITHM = 'registered-evidence-graph:v2';
const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const labels = { located_at: '位于车站', belongs_to_line: '属于线路', has_work_order: '关联工单', has_fault: '关联故障', has_issue: '关联问题', follows_procedure: '依据规程', references_document: '关联资料' };
const headers = {
  subjectType: /^(?:主体类型|主语类型|来源对象类型|subject_type)$/i,
  subjectId: /^(?:主体编号|主语编号|来源对象编号|subject_id)$/i,
  subjectName: /^(?:主体名称|主语名称|来源对象名称|subject_name)$/i,
  explicitRelation: /^(?:关系|关系名称|关系类型|谓词|relation|predicate)$/i,
  objectType: /^(?:客体类型|宾语类型|目标对象类型|object_type)$/i,
  objectId: /^(?:客体编号|宾语编号|目标对象编号|object_id)$/i,
  objectName: /^(?:客体名称|宾语名称|目标对象名称|object_name)$/i,
  asset: /^(?:(?:关联|相关)?(?:设备|资产)(?:编号|编码|ID|标识)|asset_id|device_id)$/i,
  assetName: /^(?:设备名称|资产名称|asset_name|device_name)$/i,
  station: /^(?:(?:示例|所属)?(?:车站|站点|站名)|station_name)$/i,
  stationId: /^(?:车站编号|车站编码|station_id)$/i,
  line: /^(?:(?:示例|所属)?线路(?:名称)?|line_name)$/i,
  lineId: /^(?:线路编号|线路编码|line_id)$/i,
  organization: /^(?:所属单位|运营单位|运营公司|organization)$/i,
  work_order: /^(?:工单(?:编号|编码|ID|号)|work_order_id)$/i,
  fault: /^(?:故障(?:编号|编码|ID)|fault_id)$/i,
  faultName: /^(?:故障现象|故障描述|故障名称|fault_name)$/i,
  issue: /^(?:问题(?:编号|编码|ID)|issue_id)$/i,
  issueName: /^(?:问题摘要|问题描述|问题名称|issue_name)$/i,
  procedure: /^(?:规程编号|规程编码|制度编号|标准编号|procedure_id)$/i,
  procedureName: /^(?:规程名称|制度名称|标准名称|procedure_name)$/i,
  document: /^(?:(?:关联)?资料编号|文档编号|document_id)$/i,
  documentName: /^(?:(?:关联)?资料名称|文档名称|document_name)$/i,
};
function columns(table) { return Object.fromEntries(Object.entries(headers).map(([key, pattern]) => [key, table.headers.findIndex(h => pattern.test(String(h).trim()))])); }
function publicRef(store, ref) {
  const doc = store.get('document', ref.documentId), chunk = store.chunks(ref.documentId).find(c => c.id === ref.blockId);
  return { ...ref, title: doc?.title || '', sourceKind: doc?.sourceKind || 'unspecified', text: chunk?.text || '', locator: ref.locator || chunk?.locator || null };
}
function sourceCurrent(store, relation) {
  const document = store.get('document', relation.documentId);
  if (!document || documentFingerprint(document, store.chunks(document.id)) !== relation.sourceFingerprint) return false;
  return relation.evidenceRefs?.length > 0 && relation.evidenceRefs.every(ref => {
    const chunk = store.chunks(document.id).find(c => c.id === ref.blockId);
    return ref.documentId === document.id && ref.documentVersion === document.version && chunk && (!chunk.table?.reviewRequired || ['confirmed', 'verified', 'accepted'].includes(chunk.reviewState)) && (!ref.contentHash || digest({ text: chunk.text, table: chunk.table || null }) === ref.contentHash);
  });
}
function publicRelation(store, user, relation, { retrieval = false } = {}) {
  const document = store.get('document', relation.documentId);
  if (!canDocument(user, document, store)) return null;
  const stale = !sourceCurrent(store, relation), canManage = canEdit(user) && canDocument(user, document, store, { write: true });
  if ((retrieval || !canManage) && (stale || relation.status !== 'confirmed' || !isRetrievable(document))) return null;
  const ref = relation.evidenceRefs?.[0] || {};
  return { ...relation, label: relation.predicate.startsWith('explicit:') ? relation.predicate.slice(9) : labels[relation.predicate] || relation.predicate, sourceTitle: document.title, baseId: document.baseId, documentVersion: document.version, blockId: ref.blockId, rowNumber: ref.rowNumber ?? null, stale, canManage, actions: canManage && !stale ? ['confirm', 'reject'] : [], evidenceRefs: relation.evidenceRefs.map(value => publicRef(store, value)) };
}
function scopedNodes(store, edges) {
  const ids = new Set(edges.flatMap(edge => [edge.subjectId, edge.objectId]));
  return [...ids].flatMap(id => {
    const stored = store.get('knowledgeEntity', id); if (!stored) return [];
    // Use only visible edge evidence; a shared entity must never expose another document's metadata.
    const related = edges.filter(edge => edge.subjectId === id || edge.objectId === id);
    const evidenceRefs = [...new Map(related.flatMap(edge => edge.evidenceRefs).map(ref => [ref.documentId + ':' + ref.blockId + ':' + ref.rowNumber, ref])).values()];
    const edge = related[0], name = edge.subjectId === id ? edge.subjectName : edge.objectName;
    return [{ id, type: stored.type, name, externalId: stored.externalId, baseId: edge.baseId, scopeLabel: stored.scopeLabel || '', identityMethod: stored.identityMethod || 'legacy-source-scoped', aliases: [], evidenceRefs, degree: related.length }];
  });
}

export function extractRelations(store, user, documentId, input = {}) {
  return store.transaction(() => {
    const actor = currentActor(store, user), document = checkedDocument(store, actor, documentId, true);
    requireValue(canEdit(actor), 403, 'EDITOR_REQUIRED', '关系抽取需要编辑权限。');
    revision(input.revision, document.revision);
    requireValue(['review', 'published'].includes(document.status), 409, 'DOCUMENT_NOT_READY', '请先完成文档解析。');
    const fingerprint = documentFingerprint(document, store.chunks(documentId));
    const entities = new Map(), relations = new Map(); let rowCount = 0, skippedBlocks = 0;
    for (const block of evidenceBlocks(store, document, actor)) {
      const table = block.structuredData;
      if (block.type !== 'table' || !Array.isArray(table?.headers) || !Array.isArray(table.rows)) continue;
      if (table.reviewRequired && !['confirmed', 'verified', 'accepted'].includes(block.reviewState)) { skippedBlocks++; continue; }
      const cols = columns(table);
      for (const [rowIndex, row] of table.rows.entries()) {
        requireValue(++rowCount <= GRAPH_LIMITS.maxRows, 422, 'GRAPH_SCOPE_TOO_LARGE', '单份资料最多处理 10000 行，请拆分资料。');
        const value = field => cols[field] < 0 ? '' : cleanString(String(row[cols[field]] ?? ''), 500);
        const rowNumber = table.rowNumbers?.[rowIndex];
        if (!Number.isInteger(rowNumber)) { skippedBlocks++; continue; }
        const ref = { documentId, documentVersion: document.version, blockId: block.id, rowNumber, locator: { ...block.locator, rowNumbers: [rowNumber] }, contentHash: block.contentHash };
        const organization = value('organization'), lineName = value('line'), lineCode = value('lineId');
        const sourceScope = document.source?.connectorId || document.familyId || document.id;
        const make = (type, code, name = code, extraScope = '') => {
          if (!code && !name) return null;
          const explicit = !!code;
          const scope = extraScope || (explicit ? 'base-identifier' : 'source:' + sourceScope);
          const id = 'entity_' + digest({ baseId: document.baseId, type, scope, key: normalize(code || name) }).slice(0, 24);
          const old = store.get('knowledgeEntity', id);
          const entity = { id, type, name: name || code, externalId: code || '', baseId: document.baseId, sourceId: sourceScope, scopeLabel: extraScope ? [organization, lineName || lineCode, !lineName && !lineCode ? '来源限定' : ''].filter(Boolean).join(' / ') : explicit ? '知识库内明确编号' : '来源限定', identityMethod: explicit && !extraScope ? 'base-explicit-identifier' : 'scoped-exact-value', evidenceRefs: [...new Map([...(old?.evidenceRefs || []), ref].map(r => [r.documentId + ':' + r.blockId + ':' + r.rowNumber, r])).values()].slice(-1000), documentId, sourceFingerprint: fingerprint };
          store.put('knowledgeEntity', entity); entities.set(id, entity); return entity;
        };
        const asset = value('asset') ? make('asset', value('asset'), value('assetName') || value('asset')) : null;
        const order = make('work_order', value('work_order'));
        const lineScope = organization ? 'organization:' + normalize(organization) : 'base-line';
        const line = make('line', lineCode, lineName || lineCode, lineScope);
        const stationScope = line ? 'line:' + line.id : 'source:' + sourceScope + ':organization:' + normalize(organization);
        const station = make('station', value('stationId'), value('station') || value('stationId'), stationScope);
        const eventScope = order ? 'order:' + order.id : 'row:' + documentId + ':' + block.id + ':' + rowNumber;
        const fault = make('fault', value('fault'), value('faultName') || value('fault'), value('fault') ? '' : eventScope);
        const issue = make('issue', value('issue'), value('issueName') || value('issue'), value('issue') ? '' : eventScope);
        const procedure = make('procedure', value('procedure'), value('procedureName') || value('procedure'));
        const linkedDoc = make('document', value('document'), value('documentName') || value('document'));
        const connect = (subject, object, predicate) => {
          if (!subject || !object || subject.id === object.id) return;
          const id = 'relation_' + digest({ documentId, blockId: block.id, rowNumber, subjectId: subject.id, objectId: object.id, predicate, fingerprint, algorithm: GRAPH_ALGORITHM }).slice(0, 24);
          const old = store.get('knowledgeRelation', id);
          const relation = old || { id, subjectId: subject.id, subjectName: subject.name, predicate, objectId: object.id, objectName: object.name, evidenceRefs: [ref], documentId, sourceFingerprint: fingerprint, status: 'candidate', revision: 1, method: GRAPH_ALGORITHM, createdAt: now() };
          if (!old) store.put('knowledgeRelation', relation); relations.set(id, relation);
        };
        const subjectType = cleanString(value('subjectType'), 80), objectType = cleanString(value('objectType'), 80), relationName = cleanString(value('explicitRelation'), 120);
        // Only an explicitly supplied subject-predicate-object record creates a custom relation.
        if (subjectType && objectType && relationName) {
          const subject = make(subjectType, value('subjectId'), value('subjectName') || value('subjectId'));
          const object = make(objectType, value('objectId'), value('objectName') || value('objectId'));
          connect(subject, object, 'explicit:' + relationName);
        }
        connect(asset, station, 'located_at'); connect(station, line, 'belongs_to_line');
        connect(asset, order, 'has_work_order');
        // A row explicitly attributes the event to its work order, or to the asset if no order is supplied.
        connect(order || asset, fault, 'has_fault'); connect(order || asset, issue, 'has_issue');
        connect(fault || issue || order || asset, procedure, 'follows_procedure');
        connect(procedure || order || asset, linkedDoc, 'references_document');
      }
    }
    store.audit(actor, 'knowledge.relations.extracted', { documentId, entityCount: entities.size, relationCount: relations.size, rowCount, algorithm: GRAPH_ALGORITHM });
    return { entities: [...entities.values()], relations: [...relations.values()], rowCount, skippedBlocks };
  });
}

export function listRelations(store, user, documentId, { entityId } = {}) {
  const actor = currentActor(store, user), document = documentId ? checkedDocument(store, actor, documentId) : null;
  const relations = store.list('knowledgeRelation').filter(r => (!document || r.documentId === document.id) && (!entityId || r.subjectId === entityId || r.objectId === entityId)).map(r => publicRelation(store, actor, r)).filter(Boolean);
  return { entities: scopedNodes(store, relations), relations };
}
function reviewOne(store, actor, id, input) {
  const relation = store.get('knowledgeRelation', id); requireValue(relation, 404, 'RELATION_NOT_FOUND', '关系不存在。');
  const document = checkedDocument(store, actor, relation.documentId, true);
  requireValue(canEdit(actor), 403, 'EDITOR_REQUIRED', '复核需要编辑权限。'); revision(input.revision, relation.revision);
  requireValue(sourceCurrent(store, relation), 409, 'RELATION_STALE', '关系依据已变更，请重新抽取。');
  requireValue(['confirm', 'reject'].includes(input.action), 400, 'INVALID_ACTION', '关系动作无效。');
  const reason = cleanString(input.reason, 2000); requireValue(reason.length >= 2, 400, 'REASON_REQUIRED', '请填写复核依据。');
  const next = { ...relation, status: input.action === 'confirm' ? 'confirmed' : 'rejected', revision: relation.revision + 1, reviewedBy: actor.id, reviewedAt: now(), reason };
  store.put('knowledgeRelation', next); store.audit(actor, 'knowledge.relation.' + input.action, { documentId: document.id, target: id, reason });
  return publicRelation(store, actor, next);
}
export function reviewRelation(store, user, id, input) { return store.transaction(() => reviewOne(store, currentActor(store, user), id, input)); }
export function reviewGraphRelations(store, user, input = {}) {
  requireValue(Array.isArray(input.ids) && input.ids.length > 0 && input.ids.length <= GRAPH_LIMITS.maxBatchReview, 400, 'GRAPH_BATCH_LIMIT', '每次复核 1–50 条关系。');
  requireValue(input.ids.every(item => typeof item?.id === 'string') && new Set(input.ids.map(item => item.id)).size === input.ids.length, 400, 'INVALID_RELATION_IDS', '关系编号不可重复或为空。');
  return store.transaction(() => { const actor = currentActor(store, user), relations = input.ids.map(item => reviewOne(store, actor, item.id, { revision: item.revision, action: input.action, reason: input.reason })); return { reviewedCount: relations.length, relations }; });
}
export function extractGraph(store, user, input = {}) {
  return store.transaction(() => {
    const actor = currentActor(store, user); requireValue(canEdit(actor), 403, 'EDITOR_REQUIRED', '关系抽取需要编辑权限。');
    const baseId = cleanString(input.baseId, 100);
    if (baseId) requireValue(canBase(actor, store.get('base', baseId)), 404, 'BASE_NOT_FOUND', '知识库不存在或无权访问。');
    if (input.documentIds !== undefined) requireValue(Array.isArray(input.documentIds) && input.documentIds.length > 0 && input.documentIds.length <= GRAPH_LIMITS.maxDocuments && input.documentIds.every(id => typeof id === 'string') && new Set(input.documentIds).size === input.documentIds.length, 400, 'GRAPH_SCOPE_INVALID', '请指定 1–100 份不同资料。');
    let documents = store.list('document').filter(d => (!baseId || d.baseId === baseId) && ['review', 'published'].includes(d.status) && canDocument(actor, d, store, { write: true }));
    if (input.documentIds) { documents = documents.filter(d => input.documentIds.includes(d.id)); requireValue(documents.length === input.documentIds.length, 404, 'DOCUMENT_NOT_FOUND', '部分资料不存在、不在指定范围或不可编辑。'); }
    requireValue(documents.length <= GRAPH_LIMITS.maxDocuments, 422, 'GRAPH_SCOPE_TOO_LARGE', '单次最多处理 100 份资料，请选择知识库或缩小范围。');
    const sourceRows = documents.reduce((total, document) => total + store.chunks(document.id).reduce((count, chunk) => count + (chunk.table?.rows?.length || 0), 0), 0);
    requireValue(sourceRows <= GRAPH_LIMITS.maxRows, 422, 'GRAPH_SCOPE_TOO_LARGE', '单次最多处理 10000 行，请缩小知识库范围或分批选择资料。');
    const outcomes = documents.map(document => extractRelations(store, actor, document.id, { revision: document.revision }));
    const relations = outcomes.flatMap(value => value.relations), entityIds = new Set(outcomes.flatMap(value => value.entities.map(e => e.id)));
    return { documentCount: documents.length, entityCount: entityIds.size, relationCount: relations.length, relations, skippedBlocks: outcomes.reduce((n, v) => n + v.skippedBlocks, 0), message: '已按原始表格明确字段生成关系候选，请逐项核对来源后确认。', limitations: ['支持表格中明确的主体类型、主体编号或名称、关系、客体类型及客体编号或名称；类别保留资料中的原始名称。', '兼容既有设备、工单、问题等明确业务字段；同库编号可对齐，无编号名称按来源限定。', '不从共现、相似名称或自由文本推测关系；候选需要核验。'] };
  });
}

function matchNodes(nodes, query) {
  const text = normalize(query); if (!text) return [];
  const matches = value => {
    const term = normalize(value); if (term.length < 2) return false;
    if (/^[a-z0-9_.-]+$/.test(term)) return new RegExp('(^|[^a-z0-9_.-])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9_.-])', 'i').test(text);
    return text.includes(term) || (text.length >= 2 && term.includes(text));
  };
  const explicit = nodes.filter(node => node.externalId && matches(node.externalId));
  return explicit.length ? explicit : nodes.filter(node => matches(node.name));
}
function pathNode(node) { return { id: node.id, type: node.type, name: node.name, externalId: node.externalId || '', scopeLabel: node.scopeLabel || '' }; }
function queryTargetTypes(query) { return [...new Set([/规程|制度|标准|流程|依据/.test(query) ? 'procedure' : '', /问题/.test(query) ? 'issue' : '', /故障/.test(query) ? 'fault' : '', /工单|维修记录|维修历史/.test(query) ? 'work_order' : '', /车站|站点|哪个站/.test(query) ? 'station' : '', /线路|哪条线/.test(query) ? 'line' : '', /资料|文档/.test(query) ? 'document' : ''].filter(Boolean))]; }
function rankPaths(paths, targetTypes) {
  return [...paths].sort((a, b) => {
    const aTarget = targetTypes.includes(a.nodes.at(-1).type), bTarget = targetTypes.includes(b.nodes.at(-1).type);
    if (aTarget !== bTarget) return bTarget - aTarget;
    if (aTarget && bTarget) { const priority = targetTypes.indexOf(a.nodes.at(-1).type) - targetTypes.indexOf(b.nodes.at(-1).type); if (priority) return priority; }
    return a.edges.length - b.edges.length || a.id.localeCompare(b.id);
  });
}
function buildPaths(nodes, edges, seeds, hops, maxPaths = GRAPH_LIMITS.maxPaths) {
  const byId = new Map(nodes.map(node => [node.id, node])), adjacency = new Map();
  for (const edge of edges) for (const id of [edge.subjectId, edge.objectId]) { if (!adjacency.has(id)) adjacency.set(id, []); adjacency.get(id).push(edge); }
  const paths = [], seen = new Set(), queue = seeds.map(node => ({ nodeIds: [node.id], edges: [] })); let processed = 0;
  while (queue.length && paths.length < maxPaths && processed++ < 10000) {
    const path = queue.shift(), last = path.nodeIds.at(-1); if (path.edges.length >= hops) continue;
    for (const edge of adjacency.get(last) || []) {
      const next = edge.subjectId === last ? edge.objectId : edge.subjectId; if (path.nodeIds.includes(next) || !byId.has(next)) continue;
      const nextEdges = [...path.edges, edge], nodeIds = [...path.nodeIds, next], key = nextEdges.map(e => e.id).join('|');
      if (seen.has(key)) continue; seen.add(key);
      const value = { id: 'path_' + digest({ nodeIds, edges: nextEdges.map(e => [e.id, e.revision]) }).slice(0, 24), nodeIds, nodes: nodeIds.map(id => pathNode(byId.get(id))), edges: nextEdges, evidenceRefs: [...new Map(nextEdges.flatMap(e => e.evidenceRefs).map(ref => [ref.documentId + ':' + ref.blockId + ':' + ref.rowNumber, ref])).values()] };
      paths.push(value); queue.push({ nodeIds, edges: nextEdges }); if (paths.length >= maxPaths) break;
    }
  }
  return { paths, truncated: queue.length > 0 || processed >= 10000 };
}

function standaloneCandidates(store, actor, baseId, edgeNodes) {
  const linked = new Set(edgeNodes.map(node => node.id));
  if (!canEdit(actor)) return [];
  return store.list('knowledgeEntity').flatMap(entity => {
    if (linked.has(entity.id) || (baseId && entity.baseId !== baseId)) return [];
    const document = store.get('document', entity.documentId);
    if (!document || !['review', 'published'].includes(document.status) || !canDocument(actor, document, store, {write:true})) return [];
    const refs = (entity.evidenceRefs || []).filter(ref => ref.documentId === document.id);
    if (!sourceCurrent(store, {documentId:document.id, sourceFingerprint:entity.sourceFingerprint, evidenceRefs:refs})) return [];
    return [{id:entity.id,type:entity.type,name:entity.name,externalId:entity.externalId||'',baseId:document.baseId,scopeLabel:entity.scopeLabel||'',evidenceRefs:refs.map(ref=>publicRef(store,ref)),degree:0,status:'candidate'}];
  });
}
function constructionProgress(store, actor, baseId, graph) {
  const sources = store.list('document').filter(document => (!baseId || document.baseId === baseId) && !['archived','superseded'].includes(document.status) && canDocument(actor,document,store) && (canEdit(actor) || isRetrievable(document)));
  const currentEdges = graph.edges.filter(edge => !edge.stale && edge.status !== 'rejected');
  const currentNodes = [...scopedNodes(store,currentEdges),...graph.nodes.filter(node=>node.status==='candidate')];
  const documents = sources.map(document => {
    const chunks=store.chunks(document.id), refs=currentEdges.filter(edge=>edge.documentId===document.id);
    const objects=currentNodes.filter(node=>node.evidenceRefs?.some(ref=>ref.documentId===document.id));
    const stale=graph.edges.filter(edge=>edge.documentId===document.id&&edge.stale).length;
    const candidate=refs.filter(edge=>edge.status==='candidate').length;
    const phase=['queued','processing'].includes(document.status)?'parsing':document.status==='failed'?'parse_failed':!chunks.length?'awaiting_parse':stale?'source_changed':candidate?'awaiting_review':refs.length?'connected':objects.length?'objects_found':'awaiting_extraction';
    return {id:document.id,title:document.title,version:document.version,sourceKind:document.sourceKind||'unspecified',status:document.status,phase,parsed:chunks.length>0,entityCount:objects.length,relationCount:refs.length,candidate,stale};
  });
  const types=[...new Set(currentNodes.map(node=>node.type))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(type=>{
    const nodes=currentNodes.filter(node=>node.type===type),ids=new Set(nodes.map(node=>node.id)),edges=currentEdges.filter(edge=>ids.has(edge.subjectId)||ids.has(edge.objectId));
    return {type,nodeCount:nodes.length,documentCount:new Set(nodes.flatMap(node=>node.evidenceRefs?.map(ref=>ref.documentId)||[])).size,confirmed:edges.filter(edge=>edge.status==='confirmed'&&isRetrievable(store.get('document',edge.documentId))).length,candidate:edges.filter(edge=>edge.status==='candidate').length,relationCount:edges.length};
  });
  const predicates=[...new Set(currentEdges.map(edge=>edge.predicate))].map(predicate=>{const edges=currentEdges.filter(edge=>edge.predicate===predicate);return {predicate,label:edges[0].label,count:edges.length,documentCount:new Set(edges.map(edge=>edge.documentId)).size};});
  return {documentCount:documents.length,parsedDocumentCount:documents.filter(document=>document.parsed).length,sourceDocumentCount:documents.filter(document=>document.entityCount||document.relationCount).length,pendingDocumentCount:documents.filter(document=>!['connected'].includes(document.phase)).length,types,predicates,documents:documents.sort((a,b)=>a.title.localeCompare(b.title,'zh-CN')).slice(0,100),documentsTruncated:documents.length>100};
}

function graphData(store, actor, baseId, retrieval) {
  if (baseId) requireValue(canBase(actor, store.get('base', baseId)), 404, 'BASE_NOT_FOUND', '知识库不存在或无权访问。');
  const edges = store.list('knowledgeRelation').filter(r => !baseId || store.get('document', r.documentId)?.baseId === baseId).map(r => publicRelation(store, actor, r, { retrieval })).filter(Boolean);
  const nodes=scopedNodes(store,edges);
  return { edges, nodes: retrieval?nodes:[...nodes,...standaloneCandidates(store,actor,baseId,nodes)] };
}
export function graphSnapshot(store, user, options = {}) {
  const actor = currentActor(store, user), baseId = cleanString(options.baseId, 100), query = cleanString(options.query, 1000), entityId = cleanString(options.entityId, 100);
  const status = options.status || 'confirmed'; requireValue(['confirmed', 'candidate', 'rejected', 'stale', 'all'].includes(status), 400, 'INVALID_GRAPH_STATUS', '图谱状态无效。');
  const hops = Math.max(1, Math.min(GRAPH_LIMITS.maxHops, Number(options.hops) || 2));
  const all = graphData(store, actor, baseId, false);
  const canManage = canEdit(actor) && store.list('document').some(d => (!baseId || d.baseId === baseId) && canDocument(actor, d, store, { write: true }));
  let edges = all.edges.filter(edge => status === 'all' || (status === 'stale' ? edge.stale : edge.status === status && !edge.stale));
  // A confirmed view is suitable for readers and retrieval, including maintainers.
  if (status === 'confirmed') edges = edges.filter(edge => isRetrievable(store.get('document', edge.documentId)));
  const standalone = ['all','candidate'].includes(status) ? all.nodes.filter(node=>node.status==='candidate') : [];
  let nodes = [...scopedNodes(store, edges),...standalone], seeds = entityId ? nodes.filter(node => node.id === entityId) : matchNodes(nodes, query);
  if (options.type) { seeds = (query || entityId ? seeds : nodes).filter(node => node.type === options.type); }
  const focused = !!(query || entityId || options.type), traversed = focused ? buildPaths(nodes, edges, seeds, hops, GRAPH_LIMITS.maxPaths * 10) : { paths: [], truncated: false };
  let paths = [], truncated = traversed.truncated;
  if (focused) {
    const nodeIds = new Set(seeds.slice(0, GRAPH_LIMITS.maxNodes).map(node => node.id)), edgeIds = new Set();
    for (const path of rankPaths(traversed.paths, queryTargetTypes(query))) {
      if (paths.length >= GRAPH_LIMITS.maxPaths) break;
      const addedNodes = path.nodeIds.filter(id => !nodeIds.has(id)), addedEdges = path.edges.filter(edge => !edgeIds.has(edge.id));
      if (nodeIds.size + addedNodes.length > GRAPH_LIMITS.maxNodes || edgeIds.size + addedEdges.length > GRAPH_LIMITS.maxEdges) continue;
      path.nodeIds.forEach(id => nodeIds.add(id)); path.edges.forEach(edge => edgeIds.add(edge.id)); paths.push(path);
    }
    truncated ||= paths.length < traversed.paths.length || seeds.length > GRAPH_LIMITS.maxNodes;
    edges = edges.filter(edge => edgeIds.has(edge.id));
    const displayedNodes = new Map(scopedNodes(store, edges).map(node => [node.id, node]));
    nodes = [...nodeIds].map(id => displayedNodes.get(id) || nodes.find(node => node.id === id)).filter(Boolean);
  } else {
    truncated ||= nodes.length > GRAPH_LIMITS.maxNodes || edges.length > GRAPH_LIMITS.maxEdges;
    nodes = nodes.slice(0, GRAPH_LIMITS.maxNodes); const visible = new Set(nodes.map(node => node.id));
    edges = edges.filter(edge => visible.has(edge.subjectId) && visible.has(edge.objectId)).slice(0, GRAPH_LIMITS.maxEdges);
    nodes = [...scopedNodes(store, edges),...standalone.filter(node=>visible.has(node.id))];
  }
  return { nodes, edges, paths, canManage, construction:constructionProgress(store,actor,baseId,all), stats: { nodeCount: nodes.length, edgeCount: edges.length, totalNodes: all.nodes.length, totalEdges: all.edges.length, confirmed: all.edges.filter(e => e.status === 'confirmed' && !e.stale && isRetrievable(store.get('document', e.documentId))).length, candidate: all.edges.filter(e => e.status === 'candidate' && !e.stale).length, rejected: all.edges.filter(e => e.status === 'rejected' && !e.stale).length, stale: all.edges.filter(e => e.stale).length, matchedNodes: seeds.length, documentCount: new Set(all.edges.map(e => e.documentId)).size }, limits: { ...GRAPH_LIMITS, truncated, hops }, algorithm: GRAPH_ALGORITHM };
}

// Keep the same source fingerprint contract as retrieval.mjs without introducing a module cycle.
function retrievalFingerprint(doc) { return crypto.createHash('sha256').update(JSON.stringify([doc.id, doc.version, doc.contentRevision, doc.revision, doc.status, doc.effectiveAt, doc.expiresAt, doc.sourceKind, doc.applicability, doc.parseCoverage, doc.visualCoverage, doc.source?.sourceRevision, doc.source?.permissionMappingVersion, doc.source?.accessState])).digest('hex'); }
export function retrieveGraph(store, user, query, { baseId = '', limit = 12, maxHops = 3 } = {}) {
  const actor = currentActor(store, user), { nodes, edges } = graphData(store, actor, baseId, true), matched = matchNodes(nodes, query);
  const seeds = matched.slice(0, 12), hops = Math.max(1, Math.min(GRAPH_LIMITS.maxHops, Number(maxHops) || 3)), budget = Math.max(1, Math.min(30, Number(limit) || 12));
  const targetTypes = queryTargetTypes(query);
  const traversed = buildPaths(nodes, edges, seeds, hops, GRAPH_LIMITS.maxPaths * 10), results = [];
  const rankedPaths = rankPaths(traversed.paths, targetTypes);
  const selected = [];
  for (const path of rankedPaths) {
    if (selected.length >= GRAPH_LIMITS.maxPaths) break;
    const missingRefs = [...new Map(path.evidenceRefs.filter(ref => !results.some(r => r.id === ref.blockId)).map(ref => [ref.blockId, ref])).values()];
    // Every selected path gets all of its source chunks, or none of its new evidence.
    if (results.length + missingRefs.length > budget) continue;
    selected.push(path);
    for (const ref of missingRefs) {
    const doc = store.get('document', ref.documentId), chunk = store.chunks(ref.documentId).find(c => c.id === ref.blockId);
    if (!chunk || !doc) continue;
    results.push({ id: chunk.id, documentId: doc.id, title: doc.title, fileName: doc.fileName, baseId: doc.baseId, version: doc.version, sourceFingerprint: retrievalFingerprint(doc), text: chunk.text, page: chunk.page, heading: chunk.heading || '', score: Math.round(10000 / (1 + path.edges.length)) / 10000, matchReason: '已确认关系路径（' + path.edges.map(e => e.label).join(' → ') + '）', updatedAt: doc.updatedAt, corrected: !!chunk.corrected, sourceKind: doc.sourceKind || 'unspecified', applicability: doc.applicability || '', effectiveAt: doc.effectiveAt || null, expiresAt: doc.expiresAt || null, locator: chunk.locator || ref.locator || null, reviewState: chunk.reviewState || 'unreviewed', sourceCoverage: { parseCoverage: doc.parseCoverage || 'unknown', visualCoverage: doc.visualCoverage || 'not_applicable', frameSampling: doc.frameSampling || null }, ...(chunk.table ? { table: chunk.table } : {}), graphPathIds: [] });
    }
  }
  const resultIds = new Set(results.map(r => r.id)), paths = selected.filter(path => path.evidenceRefs.every(ref => resultIds.has(ref.blockId)));
  for (const result of results) result.graphPathIds = paths.filter(path => path.evidenceRefs.some(ref => ref.blockId === result.id)).map(path => path.id);
  const returnedEdges = [...new Map(paths.flatMap(path => path.edges).map(edge => [edge.id, edge])).values()], seedIds = new Set(seeds.map(seed => seed.id));
  const entities = scopedNodes(store, returnedEdges).filter(node => seedIds.has(node.id));
  return { results, paths, entities, stats: { matchedNodes: seeds.length, pathCount: paths.length, evidenceCount: results.length, edgeCount: edges.length, hops, targetTypes, truncated: traversed.truncated || matched.length > seeds.length || paths.length < traversed.paths.length } };
}
export function validateGraphPaths(store, user, paths = []) {
  const actor = currentActor(store, user), validPaths = [], invalidPathIds = [];
  for (const path of Array.isArray(paths) ? paths.slice(0, GRAPH_LIMITS.maxPaths) : []) {
    let valid = Array.isArray(path?.edges) && path.edges.length > 0 && path.edges.length <= GRAPH_LIMITS.maxHops && Array.isArray(path.nodeIds) && path.nodeIds.length === path.edges.length + 1 && new Set(path.nodeIds).size === path.nodeIds.length;
    const freshEdges = [];
    if (valid) for (const [index, edge] of path.edges.entries()) {
      const relation = store.get('knowledgeRelation', edge.id), fresh = relation ? publicRelation(store, actor, relation, { retrieval: true }) : null;
      if (!fresh || fresh.revision !== edge.revision || fresh.documentVersion !== edge.documentVersion || fresh.documentId !== edge.documentId || fresh.blockId !== edge.blockId || fresh.subjectId !== edge.subjectId || fresh.objectId !== edge.objectId || ![fresh.subjectId, fresh.objectId].includes(path.nodeIds[index]) || ![fresh.subjectId, fresh.objectId].includes(path.nodeIds[index + 1])) { valid = false; break; }
      freshEdges.push(fresh);
    }
    if (valid) { const nodes = scopedNodes(store, freshEdges), byId = new Map(nodes.map(node => [node.id, node])); validPaths.push({ ...path, nodes: path.nodeIds.map(id => pathNode(byId.get(id))), edges: freshEdges, evidenceRefs: [...new Map(freshEdges.flatMap(edge => edge.evidenceRefs).map(ref => [ref.documentId + ':' + ref.blockId + ':' + ref.rowNumber, ref])).values()] }); }
    else invalidPathIds.push(path?.id || 'unknown');
  }
  return { valid: Array.isArray(paths) && paths.length <= GRAPH_LIMITS.maxPaths && invalidPathIds.length === 0, invalidPathIds, paths: validPaths };
}
