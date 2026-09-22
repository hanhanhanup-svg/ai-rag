import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { handleKnowledgeUpgrade } from '../server/knowledge-upgrade.mjs';
import { createStore } from '../server/database.mjs';
import { createTable, chunkTable } from '../server/table-parser.mjs';
import { PARSER_LIMITS } from '../server/parser.mjs';
import { extractRelations, extractGraph, graphSnapshot, retrieveGraph, reviewGraphRelations, validateGraphPaths, GRAPH_LIMITS } from '../server/knowledge-graph.mjs';

async function fixture(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xrag-graph-')), store = createStore(dir);
  try {
    const admin = { id: 'admin', role: 'admin', name: '隔离测试管理员', active: true }, viewer = { id: 'viewer', role: 'viewer', active: true };
    for (const user of [admin, viewer]) store.put('user', user);
    store.put('base', { id: 'base', name: '测试库', visibility: 'company', ownerId: admin.id, members: [] });
    let serial = 0;
    function document(rows, patch = {}) {
      const id = 'doc_' + ++serial, doc = { id, familyId: id, baseId: 'base', ownerId: admin.id, title: '合成来源' + serial, fileName: id + '.csv', status: 'published', sourceKind: 'synthetic', sensitivity: 'internal', version: 1, revision: 1, contentRevision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch };
      const table = createTable(rows, { tableId: id + '_table', name: doc.title, format: 'csv' }, PARSER_LIMITS);
      store.put('document', doc); store.replaceChunks(id, chunkTable(table, 1, PARSER_LIMITS).map((chunk, index) => ({ ...chunk, id: id + '_chunk_' + index, documentId: id })));
      return doc;
    }
    function confirm(relations) { for (let index = 0; index < relations.length; index += 50) reviewGraphRelations(store, admin, { ids: relations.slice(index, index + 50).map(({ id, revision }) => ({ id, revision })), action: 'confirm', reason: '隔离测试逐行核对明确字段' }); }
    function extract(document) { return extractRelations(store, admin, document.id, { revision: document.revision }); }
    return await run({ store, admin, viewer, document, confirm, extract });
  } finally { store.close(); assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(dir, { recursive: true, force: true }); }
}
function metroChain(c) {
  const asset = c.document([['设备编码', '设备名称', '所属单位', '示例线路', '示例车站', '工单编号'], ['DEV-01', '一号扶梯', '合成城轨', '一号线', '中心站', 'WO-01']]);
  const issue = c.document([['工单编号', '问题编号', '问题摘要'], ['WO-01', 'ISS-01', '资料目录待统一']]);
  const procedure = c.document([['问题编号', '规程编号', '规程名称', '规程要求'], ['ISS-01', 'PROC-01', '资料核对流程', '核对原文编号，禁止自动修改设备参数。']]);
  const relations = [asset, issue, procedure].flatMap(document => c.extract(document).relations); c.confirm(relations);
  return { asset, issue, procedure, relations };
}

test('graph connects explicit identifiers across documents and returns a sourced three-hop metro path', () => fixture(c => {
  const chain = metroChain(c), found = retrieveGraph(c.store, c.viewer, 'DEV-01 的问题按照什么规程核对？', { maxHops: 3 });
  assert.ok(found.paths.some(path => path.edges.length === 3 && path.nodes.at(-1).type === 'procedure'));
  assert.ok(found.results.some(ref => ref.documentId === chain.procedure.id && ref.text.includes('禁止自动修改设备参数')));
  assert.ok(found.results.every(ref => c.store.chunks(ref.documentId).some(chunk => chunk.id === ref.id && chunk.text === ref.text)));
  assert.ok(found.paths.every(path => path.edges.every(edge => edge.rowNumber === 2 && edge.documentVersion === 1 && edge.revision === 2)));
  assert.equal(validateGraphPaths(c.store, c.viewer, found.paths).valid, true);
  const workOrders = c.store.list('knowledgeEntity').filter(entity => entity.type === 'work_order'); assert.equal(workOrders.length, 1);
  const issues = c.store.list('knowledgeEntity').filter(entity => entity.type === 'issue'); assert.equal(issues.length, 1);
}));
test('candidate, rejected, expired, and withdrawn relationships never enter graph retrieval', () => fixture(c => {
  const doc = c.document([['设备编号', '车站'], ['DEV-1', '甲站']]), result = c.extract(doc);
  assert.equal(graphSnapshot(c.store, c.viewer, { status: 'all' }).edges.length, 0);
  assert.equal(retrieveGraph(c.store, c.viewer, 'DEV-1').results.length, 0);
  c.confirm(result.relations); assert.equal(retrieveGraph(c.store, c.viewer, 'DEV-1').results.length, 1);
  c.store.put('document', { ...doc, expiresAt: '2000-01-01T00:00:00Z' }); assert.equal(retrieveGraph(c.store, c.admin, 'DEV-1').results.length, 0);
  c.store.put('document', { ...doc, source: { accessState: 'withdrawn' } }); assert.equal(retrieveGraph(c.store, c.admin, 'DEV-1').results.length, 0);
  c.store.put('document', doc); const relation = c.store.get('knowledgeRelation', result.relations[0].id);
  reviewGraphRelations(c.store, c.admin, { ids: [{ id: relation.id, revision: relation.revision }], action: 'reject', reason: '隔离核验撤回此关系' });
  assert.equal(retrieveGraph(c.store, c.viewer, 'DEV-1').results.length, 0);
}));
test('same-named stations on different lines and without a line remain separate, while explicit asset IDs align', () => fixture(c => {
  const docs = [c.document([['设备编号', '线路', '车站'], ['DEV-1', '一号线', '中心站']]), c.document([['设备编号', '线路', '车站'], ['DEV-1', '二号线', '中心站']]), c.document([['设备编号', '车站'], ['DEV-1', '中心站']]), c.document([['设备编号', '车站'], ['DEV-1', '中心站']])];
  docs.forEach(document => c.confirm(c.extract(document).relations));
  assert.equal(c.store.list('knowledgeEntity').filter(entity => entity.type === 'asset').length, 1);
  assert.equal(c.store.list('knowledgeEntity').filter(entity => entity.type === 'station').length, 4);
  const snapshot = graphSnapshot(c.store, c.viewer, { query: '中心站' }); assert.equal(snapshot.stats.matchedNodes, 4);
  assert.ok(snapshot.nodes.filter(node => node.type === 'station').every(node => node.scopeLabel));
}));
test('ACL filtering does not leak hidden metadata through a shared cross-document entity', () => fixture(c => {
  const visible = c.document([['设备编号', '设备名称', '车站'], ['DEV-1', '公开设备', '公开站']]); c.confirm(c.extract(visible).relations);
  const hidden = c.document([['设备编号', '设备名称', '工单编号'], ['DEV-1', '机密设备别名', 'SECRET-WO-1']], { sensitivity: 'confidential', title: '机密工单标题' }); c.confirm(c.extract(hidden).relations);
  const found = retrieveGraph(c.store, c.viewer, 'DEV-1'), json = JSON.stringify(found);
  for (const forbidden of ['机密设备别名', '机密工单标题', 'SECRET-WO-1', hidden.id]) assert.ok(!json.includes(forbidden));
  assert.equal(found.results.length, 1); assert.equal(graphSnapshot(c.store, c.viewer, { status: 'all' }).stats.totalEdges, 1);
  assert.throws(() => reviewGraphRelations(c.store, c.viewer, { ids: [{ id: c.store.list('knowledgeRelation')[0].id, revision: 2 }], action: 'confirm', reason: '读者不可操作' }));
}));
test('path validation retracts stale source edits, ACL changes, and relationship revisions', () => fixture(c => {
  const chain = metroChain(c), found = retrieveGraph(c.store, c.viewer, 'DEV-01');
  const path = found.paths.find(path => path.edges.length === 3 && path.nodes.at(-1).type === 'procedure'); assert.ok(path);
  c.store.put('document', { ...chain.issue, contentRevision: 2 }); assert.equal(validateGraphPaths(c.store, c.viewer, [path]).valid, false);
  c.store.put('document', { ...chain.issue, sensitivity: 'confidential' }); assert.equal(validateGraphPaths(c.store, c.viewer, [path]).valid, false);
  c.store.put('document', chain.issue);
  const edge = path.edges[0]; reviewGraphRelations(c.store, c.admin, { ids: [{ id: edge.id, revision: edge.revision }], action: 'reject', reason: '撤回历史路径关系' });
  assert.equal(validateGraphPaths(c.store, c.viewer, [path]).valid, false);
  assert.equal(validateGraphPaths(c.store, c.viewer, [path]).paths.length, 0);
}));
test('batch review is atomic and retries cannot overwrite intervening review revisions', () => fixture(c => {
  const doc = c.document([['设备编号', '车站', '工单编号'], ['DEV-1', '甲站', 'WO-1']]), result = c.extract(doc);
  assert.throws(() => reviewGraphRelations(c.store, c.admin, { ids: result.relations.map((r, i) => ({ id: r.id, revision: i ? 99 : 1 })), action: 'confirm', reason: '模拟并发旧版本' }), { code: 'REVISION_CONFLICT' });
  assert.ok(result.relations.every(r => c.store.get('knowledgeRelation', r.id).status === 'candidate'));
  c.confirm(result.relations); assert.throws(() => c.confirm(result.relations), { code: 'REVISION_CONFLICT' });
  assert.throws(() => reviewGraphRelations(c.store, c.admin, { ids: Array.from({ length: 51 }, (_, i) => ({ id: String(i), revision: 1 })), action: 'confirm', reason: '超过批次上限' }), { code: 'GRAPH_BATCH_LIMIT' });
}));
test('graph traversal obeys hop budgets, identifier boundaries, and no-match behavior', () => fixture(c => {
  metroChain(c);
  assert.ok(retrieveGraph(c.store, c.viewer, 'DEV-01', { maxHops: 1 }).paths.every(path => path.edges.length === 1));
  assert.ok(retrieveGraph(c.store, c.viewer, 'DEV-01', { maxHops: 99 }).paths.every(path => path.edges.length <= 3));
  assert.equal(retrieveGraph(c.store, c.viewer, 'DEV-010').paths.length, 0);
  assert.equal(graphSnapshot(c.store, c.viewer, { query: '完全不存在的实体' }).nodes.length, 0);
  assert.equal(validateGraphPaths(c.store, c.viewer, [{ id: 'forged', nodeIds: ['a', 'a'], edges: [{}] }]).valid, false);
  assert.equal(GRAPH_LIMITS.maxBatchReview, 50);
}));
test('table extraction is idempotent, skips unreviewed OCR structures and never invents missing links', () => fixture(c => {
  const doc = c.document([['问题编号', '问题摘要'], ['ISS-1', '资料核对问题']]);
  const first = c.extract(doc); assert.equal(first.entities.length, 1); assert.equal(first.relations.length, 0);
  const another = c.document([['设备编码', '关联资料编号'], ['DEV-1', 'DOC-1']]), result = c.extract(another); assert.equal(result.relations[0].predicate, 'references_document');
  c.confirm(result.relations); assert.equal(c.extract(another).relations[0].status, 'confirmed');
  const chunks = c.store.chunks(another.id); chunks[0].table.reviewRequired = true; chunks[0].reviewState = 'unreviewed'; c.store.replaceChunks(another.id, chunks);
  assert.equal(c.extract(another).relations.length, 0); assert.equal(retrieveGraph(c.store, c.viewer, 'DEV-1').paths.length, 0);
}));
test('scoped extraction refuses unauthorized or mismatched documents without partial mutation', () => fixture(c => {
  const doc = c.document([['设备编号', '车站'], ['DEV-1', '甲站']]);
  assert.throws(() => extractGraph(c.store, c.viewer, { baseId: 'base' }), { code: 'EDITOR_REQUIRED' });
  assert.throws(() => extractGraph(c.store, c.admin, { baseId: 'base', documentIds: [doc.id, 'missing'] }), { code: 'DOCUMENT_NOT_FOUND' });
  assert.equal(c.store.list('knowledgeRelation').length, 0);
  const result = extractGraph(c.store, c.admin, { baseId: 'base', documentIds: [doc.id] }); assert.equal(result.documentCount, 1); assert.equal(result.relationCount, 1);
}));

test('graph API exposes authorized extraction, review, overview, and focused sourced paths', () => fixture(async c => {
  const doc = c.document([['设备编号', '工单编号'], ['DEV-1', 'WO-1']]);
  async function call(method, route, input, user = c.admin) {
    let response;
    const handled = await handleKnowledgeUpgrade({ store: c.store, user, req: { method, url: route }, res: {}, bodyOf: async () => input, send: (_res, status, value) => { response = { status, value }; } });
    assert.equal(handled, true); return response;
  }
  const extracted = await call('POST', '/api/graph/extract', { documentIds: [doc.id] }); assert.equal(extracted.status, 200); assert.equal(extracted.value.relationCount, 1);
  const candidates = await call('GET', '/api/graph?status=candidate&baseId=base'); assert.equal(candidates.value.canManage, true); assert.equal(candidates.value.edges[0].evidenceRefs[0].title, doc.title);
  const reader = await call('GET', '/api/graph?status=all', undefined, c.viewer); assert.equal(reader.value.canManage, false); assert.equal(reader.value.edges.length, 0);
  const relation = candidates.value.edges[0];
  const reviewed = await call('POST', '/api/graph/relations/review', { ids: [{ id: relation.id, revision: relation.revision }], action: 'confirm', reason: '隔离 API 来源核对' }); assert.equal(reviewed.value.reviewedCount, 1);
  const focused = await call('GET', '/api/graph?query=DEV-1&hops=3', undefined, c.viewer); assert.equal(focused.value.paths.length, 1); assert.equal(focused.value.nodes.length, 2);
}));
test('targeted three-hop procedures retain all source chunks even among many shorter branches', () => fixture(c => {
  const chain = metroChain(c);
  for (let index = 0; index < 12; index++) {
    const doc = c.document([['设备编号', '工单编号'], ['DEV-01', 'WO-BRANCH-' + index]]); c.confirm(c.extract(doc).relations);
  }
  const found = retrieveGraph(c.store, c.viewer, 'DEV-01 关联工单问题依据什么规程？', { maxHops: 3, limit: 3 });
  assert.equal(found.results.length, 3); assert.ok(found.results.some(result => result.documentId === chain.procedure.id));
  assert.equal(found.paths[0].nodes.at(-1).type, 'procedure'); assert.equal(found.paths[0].nodes.at(-1).externalId, 'PROC-01');
  assert.ok(found.paths.every(path => path.evidenceRefs.every(ref => found.results.some(result => result.id === ref.blockId))));
}));

test('station names from a shared connector still require the same registered organization', () => fixture(c => {
  const docs = ['甲运营单位', '乙运营单位'].map((unit, index) => c.document([['设备编号', '所属单位', '车站'], ['DEV-' + index, unit, '中心站']], { source: { connectorId: 'shared-connector' } }));
  for (const doc of docs) c.confirm(c.extract(doc).relations);
  assert.equal(c.store.list('knowledgeEntity').filter(entity => entity.type === 'station').length, 2);
  const ambiguous = c.document([['设备名称', '车站'], ['同名扶梯', '中心站']]);
  assert.equal(c.extract(ambiguous).relations.length, 0);
}));

test('graph workbench prioritizes requested procedures and never stores out-of-budget node evidence', () => fixture(c => {
  metroChain(c);
  for (let index = 0; index < 12; index++) { const doc = c.document([['设备编号', '工单编号'], ['DEV-01', 'WO-BRANCH-' + index]]); c.confirm(c.extract(doc).relations); }
  const graph = graphSnapshot(c.store, c.viewer, { query: 'DEV-01 关联规程', hops: 3 });
  assert.equal(graph.paths[0].nodes.at(-1).type, 'procedure'); assert.equal(graph.paths[0].edges.length, 3);
  const found = retrieveGraph(c.store, c.viewer, 'DEV-01 关联规程', { limit: 3, maxHops: 3 });
  assert.ok(found.entities.every(entity => entity.evidenceRefs.every(ref => found.results.some(result => result.id === ref.blockId))));
  assert.ok(graph.paths.every(path => path.edges.every(edge => graph.edges.some(value => value.id === edge.id))));
}));


test('explicit relation tables keep document-defined categories and relation labels without a metro template', () => fixture(c => {
  const doc=c.document([['主体类型','主体编号','主体名称','关系','客体类型','客体编号','客体名称'],['合同','CON-1','软件服务合同','约定交付','交付物','DEL-1','验收说明']]);
  const extracted=c.extract(doc);
  assert.deepEqual(extracted.entities.map(entity=>entity.type).sort(),['交付物','合同']);
  assert.equal(extracted.relations.length,1);assert.equal(extracted.relations[0].predicate,'explicit:约定交付');
  const candidates=graphSnapshot(c.store,c.admin,{status:'candidate'});
  assert.equal(candidates.edges[0].label,'约定交付');
  assert.deepEqual(new Set(candidates.construction.types.map(type=>type.type)),new Set(['合同','交付物']));
  assert.equal(candidates.construction.documents[0].phase,'awaiting_review');
  assert.ok(candidates.construction.types.every(type=>type.documentCount===1&&type.candidate===1));
  c.confirm(extracted.relations);
  const reader=graphSnapshot(c.store,c.viewer);
  assert.equal(reader.construction.documents[0].phase,'connected');
  assert.equal(reader.construction.sourceDocumentCount,1);
  assert.equal(retrieveGraph(c.store,c.viewer,'CON-1').paths[0].edges[0].label,'约定交付');
  assert.equal(c.extract(doc).relations[0].status,'confirmed');
}));

test('ordinary documents have truthful construction progress and empty libraries have no preset categories', () => fixture(c => {
  const empty=graphSnapshot(c.store,c.admin);
  assert.equal(empty.construction.documentCount,0);assert.deepEqual(empty.construction.types,[]);
  const prose=c.document([['正文'],['企业合同归档工作说明']]);
  const processing=c.document([['正文'],['尚未处理']],{status:'processing'});c.store.replaceChunks(processing.id,[]);
  const failed=c.document([['正文'],['解析失败']],{status:'failed'});c.store.replaceChunks(failed.id,[]);
  const extracted=c.extract(prose);assert.equal(extracted.relations.length,0);
  const graph=graphSnapshot(c.store,c.admin),documents=new Map(graph.construction.documents.map(doc=>[doc.id,doc]));
  assert.equal(documents.get(prose.id).phase,'awaiting_extraction');
  assert.equal(documents.get(processing.id).phase,'parsing');assert.equal(documents.get(failed.id).phase,'parse_failed');
  assert.equal(graph.construction.documentCount,3);assert.equal(graph.construction.parsedDocumentCount,1);
  assert.equal(graph.construction.sourceDocumentCount,0);assert.deepEqual(graph.construction.types,[]);
}));

test('sourced standalone objects are visible as candidates to maintainers, without inventing relationships', () => fixture(c => {
  const doc=c.document([['问题编号','问题摘要'],['ISS-SOLO','需核对的资料问题']]);c.extract(doc);
  const graph=graphSnapshot(c.store,c.admin,{status:'candidate'});
  assert.equal(graph.nodes.length,1);assert.equal(graph.edges.length,0);assert.equal(graph.nodes[0].status,'candidate');
  assert.equal(graph.nodes[0].evidenceRefs[0].documentId,doc.id);
  assert.equal(graph.construction.documents[0].phase,'objects_found');
  assert.equal(graph.construction.types[0].type,'issue');
  assert.equal(graphSnapshot(c.store,c.viewer,{status:'all'}).nodes.length,0);
  assert.deepEqual(graphSnapshot(c.store,c.viewer,{status:'all'}).construction.types,[]);
}));

test('construction categories and source metadata obey ACL, removal and current evidence', () => fixture(c => {
  const visible=c.document([['主体类型','主体编号','关系','客体类型','客体编号'],['合同','CON-1','引用','附件','ATT-1']]);c.confirm(c.extract(visible).relations);
  const hidden=c.document([['主体类型','主体编号','关系','客体类型','客体编号'],['机密类别','SECRET-1','关联','秘密项目','SECRET-2']],{title:'机密原文名称',sensitivity:'confidential'});c.confirm(c.extract(hidden).relations);
  const removed=c.document([['正文'],['删除文档正文']],{title:'已经删除的资料',deletedAt:new Date().toISOString()});
  const reader=JSON.stringify(graphSnapshot(c.store,c.viewer,{status:'all'}));
  for(const value of ['机密类别','秘密项目','机密原文名称',hidden.id,removed.title,removed.id])assert.ok(!reader.includes(value),value+' leaked');
  c.store.put('document',{...visible,contentRevision:2});
  const stale=graphSnapshot(c.store,c.admin);
  assert.equal(stale.construction.documents.find(doc=>doc.id===visible.id).phase,'source_changed');
  assert.ok(!stale.construction.types.some(type=>type.type==='合同'||type.type==='附件'));
}));

test('unmapped business columns do not invent a relation from co-occurrence', () => fixture(c => {
  const doc=c.document([['合同编号','供应商编号','正文'],['CON-1','SUP-1','两个编号共同出现不等于确认合同主体关系']]);
  const extracted=c.extract(doc);assert.equal(extracted.relations.length,0);
  assert.deepEqual(graphSnapshot(c.store,c.admin).construction.types,[]);
}));
