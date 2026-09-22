import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createApp } from '../server/api.mjs';
import { sessionHash, isRetrievable, failure } from '../server/security.mjs';

async function fixture(run) {
  const saved = { ...process.env }, dir = mkdtempSync(path.join(os.tmpdir(), 'xrag-governance-'));
  for (const key of ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'DEEPSEEK_API_KEY', 'AI_API_KEY', 'OPENAI_API_KEY', 'EMBEDDING_API_KEY', 'EMBEDDING_BASE_URL', 'EMBEDDING_MODEL']) delete process.env[key];
  process.env.AUTH_MODE = 'password'; process.env.API_HOST = '127.0.0.1'; process.env.LOCAL_EMBEDDINGS_ENABLED = 'false';
  process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
  let app, server;
  try {
    app = await createApp({ dataDir: dir, startWorker: false });
    app.store.put('setting', { id: 'model', provider: 'disabled', embeddingBaseUrl: '', embeddingModel: '' });
    const admin = { id: 'test_admin', username: 'test_admin', name: '隔离测试管理员', role: 'admin', active: true, department: '测试' };
    const editor = { id: 'test_editor', username: 'test_editor', name: '隔离测试编辑', role: 'editor', active: true, department: '测试' };
    const viewer = { id: 'test_viewer', username: 'test_viewer', name: '隔离测试读者', role: 'viewer', active: true, department: '测试' };
    const cookies = {};
    for (const actor of [admin, editor, viewer]) {
      app.store.put('user', actor); const token = crypto.randomBytes(32).toString('hex'); cookies[actor.id] = 'xrag_session=' + token;
      app.store.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sessionHash(token), actor.id, Date.now() + 3600000);
    }
    const base = { id: 'test_base', name: '隔离测试库', visibility: 'company', ownerId: admin.id, members: [], department: '测试', createdAt: new Date().toISOString() };
    app.store.put('base', base);
    let nextId = 0;
    const document = (patch = {}) => {
      const id = 'test_document_' + (++nextId), bytes = Buffer.from('设备检查应逐项记录。原件条款保持不变。\n');
      const doc = { id, familyId: id, baseId: base.id, ownerId: admin.id, title: '原始标题', summary: '原始摘要', fileName: id + '.txt', storageName: id + '.txt', mimeType: 'text/plain', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), status: 'review', stage: '待审核', version: 1, revision: 1, contentRevision: 1, chunkCount: 1, pageCount: 1, sensitivity: 'internal', warnings: [], notes: [], createdAt: new Date().toISOString(), ...patch };
      writeFileSync(path.join(dir, 'uploads', doc.storageName), bytes);
      app.store.put('document', doc); app.store.replaceChunks(doc.id, [{ id: doc.id + '_chunk', documentId: doc.id, ordinal: 0, page: 1, text: '已经人工校对的内容必须保留。', corrected: true }]);
      return doc;
    };
    server = http.createServer(app.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const request = (method, route, body, actor = admin, extraHeaders = {}) => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: { cookie: cookies[actor.id], origin: 'http://localhost:5173', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders } }, res => {
        const chunks = []; res.on('data', part => chunks.push(part)); res.on('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode, data: res.headers['content-type']?.includes('application/json') ? JSON.parse(bytes.toString()) : null, bytes }); });
      }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const slowRequest = async (method, route, body, actor = admin) => {
      const encoded = JSON.stringify(body); let req;
      const result = new Promise((resolve, reject) => {
        req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: { cookie: cookies[actor.id], origin: 'http://localhost:5173', 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded) } }, res => { let text = ''; res.setEncoding('utf8'); res.on('data', part => text += part); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) })); }); req.on('error', reject); req.flushHeaders();
      });
      // Let the server accept headers before a second complete request arrives.
      await new Promise(resolve => setTimeout(resolve, 35));
      return { finish: () => { req.end(encoded); return result; } };
    };
    await run({ app, dir, admin, editor, viewer, base, document, request, slowRequest });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (app) await app.close();
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(dir, { recursive: true, force: true });
  }
}

test('slow document edits and actions reject stale revisions without losing the winning update', async () => fixture(async ctx => {
  const doc = ctx.document(), route = '/api/documents/' + doc.id;
  const slow = await ctx.slowRequest('PATCH', route, { revision: 1, summary: '迟到的摘要' });
  const fast = await ctx.request('PATCH', route, { revision: 1, title: '已保存的新标题' });
  assert.equal(fast.status, 200); assert.equal(fast.data.document.revision, 2);
  const late = await slow.finish(); assert.equal(late.status, 409); assert.equal(late.data.error.code, 'REVISION_CONFLICT');
  let current = ctx.app.store.get('document', doc.id); assert.equal(current.title, '已保存的新标题'); assert.equal(current.summary, '原始摘要');
  const delayedPublish = await ctx.slowRequest('POST', route + '/actions', { revision: 2, action: 'publish' });
  assert.equal((await ctx.request('POST', route + '/actions', { revision: 2, action: 'reject', reason: '先修订条款' })).status, 200);
  assert.equal((await delayedPublish.finish()).status, 409); current = ctx.app.store.get('document', doc.id); assert.equal(current.status, 'rejected');
}));

test('body upload cannot retain revoked privileges and unrelated base changes merge against current state', async () => fixture(async ctx => {
  const doc = ctx.document({ ownerId: ctx.editor.id });
  const slow = await ctx.slowRequest('PATCH', '/api/documents/' + doc.id, { revision: 1, title: '禁止写入' }, ctx.editor);
  assert.equal((await ctx.request('PATCH', '/api/users/' + ctx.editor.id, { role: 'viewer' })).status, 200);
  assert.equal((await slow.finish()).status, 401); assert.equal(ctx.app.store.get('document', doc.id).title, '原始标题');
  const slowBase = await ctx.slowRequest('PATCH', '/api/bases/' + ctx.base.id, { name: '新名称' });
  assert.equal((await ctx.request('PATCH', '/api/bases/' + ctx.base.id, { description: '另一请求的说明' })).status, 200);
  assert.equal((await slowBase.finish()).status, 200);
  const base = ctx.app.store.get('base', ctx.base.id); assert.equal(base.name, '新名称'); assert.equal(base.description, '另一请求的说明');
}));

test('review dates, informative notes and version-bound warning acknowledgements have separate lifecycles', async () => fixture(async ctx => {
  let doc = ctx.document({ status: 'published', reviewDueAt: '2020-01-01T00:00:00.000Z', warnings: ['文本页码为换页符划分的逻辑页；没有换页符时为第 1 页。', '图片经 OCR 提取，数字需人工核对。'] });
  let response = await ctx.request('GET', '/api/governance');
  assert.ok(response.data.notes.some(n => n.documentId === doc.id)); assert.equal(response.data.issues.find(i => i.type === 'parse_warning').message, '图片经 OCR 提取，数字需人工核对。');
  assert.ok(response.data.issues.some(i => i.type === 'review_due')); assert.ok(isRetrievable(doc));
  const future = new Date(Date.now() + 90 * 86400000).toISOString();
  response = await ctx.request('POST', '/api/governance/actions', { documentId: doc.id, type: 'review_due', action: 'review', reason: '逐条复核有效', revision: doc.revision, nextReviewAt: future });
  assert.equal(response.status, 200); doc = response.data.document;
  assert.equal(doc.status, 'published'); assert.equal(doc.expiresAt, undefined); assert.equal(doc.reviewDueAt, future); assert.equal(doc.lastReviewedBy, ctx.admin.id); assert.ok(doc.lastReviewedAt); assert.ok(isRetrievable(doc));
  assert.equal((await ctx.request('POST', '/api/governance/actions', { documentId: doc.id, type: 'review_due', action: 'review', reason: '日期无效', revision: doc.revision, nextReviewAt: '2020-01-01' })).status, 400);
  response = await ctx.request('POST', '/api/governance/actions', { documentId: doc.id, type: 'parse_warning', action: 'acknowledge', reason: '已对照扫描原件核对数字', revision: doc.revision });
  assert.equal(response.status, 200); doc = response.data.document; const acknowledged = response.data.issues.find(i => i.type === 'parse_warning');
  assert.equal(acknowledged.issueStatus, 'acknowledged'); assert.match(acknowledged.acknowledgement.reason, /扫描原件/); assert.ok(acknowledged.fingerprint);
  response = await ctx.request('POST', '/api/governance/actions', { documentId: doc.id, type: 'parse_warning', action: 'reopen', reason: '发现需要再确认的数字', revision: doc.revision });
  assert.equal(response.status, 200); doc = response.data.document; assert.equal(response.data.issues.find(i => i.type === 'parse_warning').issueStatus, 'open');
  response = await ctx.request('POST', '/api/governance/actions', { documentId: doc.id, type: 'parse_warning', action: 'acknowledge', reason: '复核完成', revision: doc.revision }); doc = response.data.document;
  response = await ctx.request('PATCH', '/api/documents/' + doc.id, { revision: doc.revision, title: '内容已修订', sourceKind: 'internal_controlled', applicability: '车辆检修岗位', businessOwner: '车辆专业负责人' });
  assert.equal(response.status, 200); const next = response.data.document; assert.notEqual(next.id, doc.id); assert.equal(next.businessOwner, '车辆专业负责人');
  const nextIssues = (await ctx.request('GET', '/api/governance')).data.issues.filter(i => i.documentId === next.id);
  assert.equal(nextIssues.find(i => i.type === 'parse_warning').issueStatus, 'open');
  assert.equal((await ctx.request('POST', '/api/governance/actions', { documentId: next.id, type: 'pending_review', action: 'acknowledge', reason: '不能跳过审核', revision: next.revision })).status, 400);
  const expired = ctx.document({ status: 'published', expiresAt: '2020-01-01', reviewDueAt: null });
  assert.equal((await ctx.request('POST', '/api/governance/actions', { documentId: expired.id, type: 'no_review_date', action: 'review', reason: '不能恢复失效资料', nextReviewAt: future })).status, 409);
  assert.equal(isRetrievable(ctx.app.store.get('document', expired.id)), false);
  assert.ok(ctx.app.store.events().some(e => e.action === 'governance.acknowledge' && e.fingerprint && e.reason));
}));

test('reparse preserves the published version, original hash and corrected chunks until the new version is approved', async () => fixture(async ctx => {
  const old = ctx.document({ status: 'published' }), oldChunks = ctx.app.store.chunks(old.id), original = readFileSync(path.join(ctx.dir, 'uploads', old.storageName));
  let response = await ctx.request('POST', '/api/documents/' + old.id + '/reparse', { revision: old.revision, reason: '采用新解析器保留完整记录' });
  assert.equal(response.status, 202); const nextId = response.data.document.id; assert.notEqual(nextId, old.id); assert.equal(response.data.document.status, 'queued'); assert.equal(response.data.document.version, 2);
  assert.equal((await ctx.request('POST', '/api/documents/' + old.id + '/reparse', { revision: old.revision, reason: '重复任务' })).status, 409);
  assert.deepEqual(ctx.app.store.chunks(old.id), oldChunks); assert.equal(ctx.app.store.get('document', old.id).status, 'published');
  assert.deepEqual(readFileSync(path.join(ctx.dir, 'uploads', ctx.app.store.get('document', nextId).storageName)), original);
  await ctx.app.runQueue(); const next = ctx.app.store.get('document', nextId); assert.equal(next.status, 'review'); assert.equal(next.summary, old.summary); assert.ok(ctx.app.store.chunks(nextId).some(c => c.text.includes('原件条款保持不变')));
  assert.deepEqual(ctx.app.store.chunks(old.id), oldChunks); assert.equal(ctx.app.store.get('document', old.id).status, 'published');
  response = await ctx.request('POST', '/api/documents/' + nextId + '/actions', { revision: next.revision, action: 'publish', reason: '对照原件复核完成' });
  assert.equal(response.status, 200); assert.equal(ctx.app.store.get('document', old.id).status, 'superseded'); assert.equal(ctx.app.store.get('document', nextId).status, 'published');
  assert.equal((await ctx.request('POST', '/api/documents/' + old.id + '/reparse', { reason: '不允许从旧版本继续', revision: ctx.app.store.get('document', old.id).revision })).status, 409);
}));

test('document and chunk transaction failure rolls back the version and removes its copied original', async () => fixture(async ctx => {
  const doc = ctx.document({ status: 'published' }), beforeFiles = readdirSync(path.join(ctx.dir, 'uploads')), beforeDocs = ctx.app.store.list('document');
  const replace = ctx.app.store.replaceChunks;
  ctx.app.store.replaceChunks = (...args) => { replace(...args); throw failure(422, 'TEST_STORAGE_FAILURE', 'isolated transaction rollback'); };
  const response = await ctx.request('PATCH', '/api/documents/' + doc.id, { revision: 1, chunks: [{ id: doc.id + '_chunk', text: '新版本修正内容' }] });
  assert.equal(response.status, 422); ctx.app.store.replaceChunks = replace;
  assert.deepEqual(ctx.app.store.list('document'), beforeDocs); assert.deepEqual(readdirSync(path.join(ctx.dir, 'uploads')), beforeFiles);
  assert.equal(ctx.app.store.chunks(doc.id)[0].text, '已经人工校对的内容必须保留。');
}));

test('authenticated users behind one socket address have independent business quotas', async () => fixture(async ctx => {
  for (let i = 0; i < 300; i++) assert.equal((await ctx.request('GET', '/api/auth/me', undefined, ctx.viewer)).status, 200);
  assert.equal((await ctx.request('GET', '/api/auth/me', undefined, ctx.viewer)).status, 429);
  assert.equal((await ctx.request('GET', '/api/auth/me', undefined, ctx.admin)).status, 200);
  assert.equal((await ctx.request('GET', '/api/auth/me', undefined, ctx.viewer, { 'x-forwarded-for': '192.0.2.44' })).status, 429);
}));


test('successful reparse replaces only the unchanged draft and preserves its governance metadata', async () => fixture(async ctx => {
  const old = ctx.document({ summary: '业务负责人自定义摘要', tags: ['设备台账'], reviewDueAt: '2030-01-01T00:00:00.000Z', businessOwner: '车辆专业' });
  const response = await ctx.request('POST', '/api/documents/' + old.id + '/reparse', { revision: old.revision, reason: '优化表格分段' });
  assert.equal(response.status, 202); assert.equal(ctx.app.store.get('document', old.id).status, 'review');
  await ctx.app.runQueue(); const next = ctx.app.store.get('document', response.data.document.id);
  assert.equal(next.status, 'review'); assert.equal(ctx.app.store.get('document', old.id).status, 'superseded');
  assert.equal(next.summary, old.summary); assert.deepEqual(next.tags, old.tags); assert.equal(next.reviewDueAt, old.reviewDueAt); assert.equal(next.businessOwner, old.businessOwner);
  assert.ok(ctx.app.store.events().some(e => e.action === 'document.draft_superseded' && e.documentId === old.id));
}));


test('manual table correction removes only conflicting structured rows and preserves the old version', async () => fixture(async ctx => {
  const doc = ctx.document({status:'published',chunkCount:2});
  const chunks=[
    {id:doc.id+'_chunk',documentId:doc.id,ordinal:0,page:1,text:'设备甲 数量 2',table:{columns:['设备','数量'],rows:[['设备甲','2']]}},
    {id:doc.id+'_second',documentId:doc.id,ordinal:1,page:1,text:'设备乙 数量 3',table:{columns:['设备','数量'],rows:[['设备乙','3']]}}
  ];ctx.app.store.replaceChunks(doc.id,chunks);
  const response=await ctx.request('PATCH','/api/documents/'+doc.id,{revision:doc.revision,chunks:[{id:chunks[0].id,text:'设备甲 数量 5'},{id:chunks[1].id,text:chunks[1].text}]});
  assert.equal(response.status,200);assert.equal(response.data.document.structuredDataIncomplete,true);
  const current=ctx.app.store.chunks(response.data.document.id);
  assert.equal(current[0].table,undefined);assert.equal(current[0].text,'设备甲 数量 5');assert.deepEqual(current[1].table,chunks[1].table);
  assert.deepEqual(ctx.app.store.chunks(doc.id),chunks);assert.equal(ctx.app.store.get('document',doc.id).status,'published');
  assert.ok(response.data.document.warnings.some(message=>message.includes('全表统计暂不可用')));
  const issue=(await ctx.request('GET','/api/governance')).data.issues.find(i=>i.documentId===response.data.document.id&&i.type==='parse_warning');
  assert.match(issue.message,/结构化字段需重新核对/);assert.equal(issue.issueStatus,'open');
}));

test('direct asynchronous ingestion refreshes account permissions and rejects stopped owners', async () => fixture(async ctx => {
  ctx.app.store.put('user',{...ctx.editor,active:false});
  await assert.rejects(ctx.app.ingest(ctx.editor,{baseId:ctx.base.id,fileName:'禁止新增.txt',contentBase64:Buffer.from('不能写入').toString('base64')}),error=>error.code==='AUTH_REQUIRED');
  assert.equal(ctx.app.store.list('document').length,0);assert.equal(readdirSync(path.join(ctx.dir,'uploads')).length,0);
}));


test('reparse restores structured CSV rows after manual text correction without changing the old evidence', async () => fixture(async ctx => {
  const original=Buffer.from('设备,数量\n设备甲,2\n设备乙,3\n');
  let old=ctx.document({status:'published',fileName:'设备统计.csv',storageName:'设备统计.csv',mimeType:'text/csv',structuredDataIncomplete:true,warnings:['表格片段经文本校对，结构化字段需重新核对；全表统计暂不可用']});
  writeFileSync(path.join(ctx.dir,'uploads',old.storageName),original);
  old={...old,size:original.length,sha256:crypto.createHash('sha256').update(original).digest('hex')};ctx.app.store.put('document',old);
  const oldChunks=ctx.app.store.chunks(old.id);
  const response=await ctx.request('POST','/api/documents/'+old.id+'/reparse',{revision:old.revision,reason:'重新对照原始CSV构建结构化字段'});
  assert.equal(response.status,202);assert.equal(response.data.document.structuredDataIncomplete,false);
  // Also cover an unfinished task restored from a version that retained the flag.
  const queued=ctx.app.store.get('document',response.data.document.id);ctx.app.store.put('document',{...queued,structuredDataIncomplete:true});
  await ctx.app.runQueue();const current=ctx.app.store.get('document',response.data.document.id),chunks=ctx.app.store.chunks(current.id);
  assert.equal(current.status,'review');assert.equal(current.structuredDataIncomplete,false);assert.ok(chunks.every(chunk=>chunk.table?.schemaVersion===1));
  assert.deepEqual(chunks.flatMap(chunk=>chunk.table.rows),[['设备甲','2'],['设备乙','3']]);
  assert.ok(current.warnings.every(message=>!message.includes('全表统计暂不可用')));
  assert.equal(ctx.app.store.get('document',old.id).structuredDataIncomplete,true);assert.equal(ctx.app.store.get('document',old.id).status,'published');
  assert.deepEqual(ctx.app.store.chunks(old.id),oldChunks);assert.deepEqual(readFileSync(path.join(ctx.dir,'uploads',old.storageName)),original);
}));


test('review may register verified source metadata without changing content, validity or publication', async () => fixture(async ctx => {
  const expiry=new Date(Date.now()+365*86400000).toISOString(),nextReviewAt=new Date(Date.now()+90*86400000).toISOString();
  const doc=ctx.document({status:'published',expiresAt:expiry,tags:['行业示例'],summary:'明确合成资料的摘要'}),beforeChunks=ctx.app.store.chunks(doc.id),beforeOriginal=readFileSync(path.join(ctx.dir,'uploads',doc.storageName));
  const body={documentId:doc.id,type:'no_review_date',action:'review',reason:'核对受控来源并登记待业务认领责任',revision:doc.revision,nextReviewAt,sourceKind:'synthetic',businessOwner:'本地资料维护（待业务认领）',applicability:'仅用于平台演示，不构成真实运营记录或业务审批。',reviewDueAt:'2000-01-01',expiresAt:'2000-01-01',title:'不得覆盖正文标题'};
  const response=await ctx.request('POST','/api/governance/actions',body);assert.equal(response.status,200);const next=response.data.document;
  assert.equal(next.id,doc.id);assert.equal(next.version,doc.version);assert.equal(next.contentRevision,doc.contentRevision);assert.equal(next.status,'published');assert.equal(next.expiresAt,expiry);assert.equal(next.reviewDueAt,nextReviewAt);
  assert.equal(next.title,doc.title);assert.equal(next.summary,doc.summary);assert.deepEqual(next.tags,doc.tags);assert.equal(next.sourceKind,'synthetic');assert.equal(next.businessOwner,body.businessOwner);assert.equal(next.applicability,body.applicability);
  assert.deepEqual(ctx.app.store.chunks(doc.id),beforeChunks);assert.deepEqual(readFileSync(path.join(ctx.dir,'uploads',doc.storageName)),beforeOriginal);assert.equal(ctx.app.store.list('document').length,1);
  const event=ctx.app.store.events().find(e=>e.action==='governance.review');assert.deepEqual(event.metadataFields,['sourceKind','applicability','businessOwner']);assert.ok(!JSON.stringify(event).includes(body.businessOwner));assert.ok(!JSON.stringify(event).includes(body.applicability));
  const beforeInvalid=ctx.app.store.get('document',doc.id);
  const rejected=await ctx.request('POST','/api/governance/actions',{...body,revision:next.revision,sourceKind:'pretend-approved'});assert.equal(rejected.status,400);assert.equal(rejected.data.error.code,'INVALID_SOURCE_KIND');assert.deepEqual(ctx.app.store.get('document',doc.id),beforeInvalid);
  assert.equal((await ctx.request('POST','/api/governance/actions',{...body,revision:next.revision},ctx.viewer)).status,403);
}));


test('legacy same-millisecond history shows the question first without modifying persisted evidence', async () => fixture(async ctx => {
  const timestamp='2026-01-01T12:00:00.000Z',id='legacy_conversation',doc=ctx.document({status:'published'});
  ctx.app.store.put('conversation',{id,userId:ctx.admin.id,title:'旧历史',createdAt:timestamp,updatedAt:timestamp});
  const question={id:'z_legacy_question',conversationId:id,role:'user',content:'先问',createdAt:timestamp};
  const answer={id:'a_legacy_answer',conversationId:id,role:'assistant',content:'后答',answer:'后答',mode:'extractive',citations:[{id:doc.id+'_chunk',documentId:doc.id,text:'保留内容',page:1}],createdAt:timestamp};
  ctx.app.store.put('message',answer);ctx.app.store.put('message',question);
  let response=await ctx.request('GET','/api/conversations/'+id);assert.equal(response.status,200);assert.deepEqual(response.data.messages.map(message=>message.id),[question.id,answer.id]);
  assert.deepEqual(ctx.app.store.get('message',answer.id),answer);assert.deepEqual(ctx.app.store.get('message',question.id),question);
  ctx.app.store.put('document',{...doc,status:'archived'});response=await ctx.request('GET','/api/conversations/'+id);
  assert.deepEqual(response.data.messages.map(message=>message.role),['user','assistant']);assert.equal(response.data.messages[1].mode,'insufficient');assert.deepEqual(response.data.messages[1].citations,[]);assert.notEqual(response.data.messages[1].content,answer.content);
  assert.deepEqual(ctx.app.store.get('message',answer.id),answer);assert.equal((await ctx.request('GET','/api/conversations/'+id,undefined,ctx.viewer)).status,404);
}));

test('concurrent pairs in one conversation receive persistent adjacent sequence numbers even in one millisecond', async () => fixture(async ctx => {
  const NativeDate=globalThis.Date,fixed=NativeDate.now();
  globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};
  try{
    const timestamp=new Date().toISOString(),id='concurrent_conversation';
    ctx.app.store.put('conversation',{id,userId:ctx.admin.id,title:'并发历史',createdAt:timestamp,updatedAt:timestamp});
    ctx.app.store.put('message',{id:'z_old_question',conversationId:id,role:'user',content:'旧问题',createdAt:timestamp});
    ctx.app.store.put('message',{id:'a_old_answer',conversationId:id,role:'assistant',content:'旧回答',createdAt:timestamp});
    const results=await Promise.all(['并发问题甲','并发问题乙'].map(question=>ctx.request('POST','/api/chat',{question,conversationId:id})));
    for(const result of results)assert.equal(result.status,200);
    let response=await ctx.request('GET','/api/conversations/'+id);assert.equal(response.status,200);const messages=response.data.messages;
    assert.deepEqual(messages.slice(0,2).map(message=>message.role),['user','assistant']);assert.deepEqual(messages.slice(2).map(message=>message.sequence),[3,4,5,6]);
    for(let i=2;i<messages.length;i+=2){assert.equal(messages[i].role,'user');assert.equal(messages[i+1].role,'assistant');assert.equal(messages[i].turnId,messages[i+1].turnId);assert.equal(messages[i].content,messages[i+1].question);assert.equal(messages[i].createdAt,timestamp);assert.equal(messages[i+1].createdAt,timestamp);}
    assert.notEqual(messages[2].turnId,messages[4].turnId);assert.equal(ctx.app.store.get('conversation',id).messageSequence,6);
    assert.equal(new Set(messages.slice(2).map(message=>message.sequence)).size,4);
    for(const message of messages.slice(2)){const persisted=ctx.app.store.get('message',message.id);assert.equal(persisted.sequence,message.sequence);assert.equal(persisted.turnId,message.turnId);}
    response=await ctx.request('GET','/api/conversations/'+id);assert.deepEqual(response.data.messages.map(message=>message.id),messages.map(message=>message.id));
  }finally{globalThis.Date=NativeDate;}
}));

test('feedback records remain scoped to an accessible knowledge base without expanding actor access', async () => fixture(async ctx => {
  const one=ctx.document({status:'published'});
  const otherBase={...ctx.base,id:'feedback_other_base',name:'其他知识库',visibility:'private',ownerId:ctx.admin.id};
  ctx.app.store.put('base',otherBase);
  const two=ctx.document({baseId:otherBase.id,status:'published'});
  const createdAt=new Date().toISOString();
  for(const row of [
    {id:'scope_own',documentId:one.id,userId:ctx.viewer.id},
    {id:'scope_peer',documentId:one.id,userId:ctx.admin.id},
    {id:'scope_other',documentId:two.id,userId:ctx.admin.id},
    {id:'scope_message',documentId:null,userId:ctx.viewer.id},
  ]) ctx.app.store.put('feedback',{...row,createdAt,updatedAt:createdAt,question:'隔离反馈记录',comment:'隔离检查'});
  const route='/api/feedback?baseId='+ctx.base.id;
  const scoped=await ctx.request('GET',route);
  assert.equal(scoped.status,200);
  assert.deepEqual(scoped.data.feedback.map(row=>row.id).sort(),['scope_own','scope_peer']);
  assert.equal(scoped.data.scope.label,ctx.base.name);
  const own=await ctx.request('GET',route,undefined,ctx.viewer);
  assert.deepEqual(own.data.feedback.map(row=>row.id),['scope_own']);
  const denied=await ctx.request('GET','/api/feedback?baseId='+otherBase.id,undefined,ctx.viewer);
  assert.equal(denied.status,404);
  const global=await ctx.request('GET','/api/feedback',undefined,ctx.viewer);
  assert.deepEqual(global.data.feedback.map(row=>row.id).sort(),['scope_message','scope_own']);
}));

test('feedback learning API creates one default knowledge base and preserves a repeatable one-click flow', async () => fixture(async ctx => {
  const before=await ctx.request('GET','/api/learning/default');
  assert.equal(before.status,200);assert.equal(before.data.enabled,true);assert.equal(before.data.base,null);
  const sameName={...ctx.base,id:'ordinary_machine_learning',name:'机器学习'};ctx.app.store.put('base',sameName);
  const source=ctx.document({status:'published',title:'设备记录核对'});
  const timestamp=new Date().toISOString();
  ctx.app.store.put('feedback',{id:'learn_api_feedback',userId:ctx.admin.id,documentId:source.id,type:'incorrect',question:'设备台账统计如何保证范围正确？',comment:'旧回答增加了未指定筛选，得到了错误的0条。',resolution:'文档发布状态不作为行筛选条件。应按问题明确条件核对完整记录后计数。',status:'resolved',createdAt:timestamp,updatedAt:timestamp});
  const route='/api/feedback/learn_api_feedback/learn';
  const result=await ctx.request('POST',route,{expectedUpdatedAt:timestamp});
  assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.status,'published');assert.equal(result.data.alreadyLearned,false);
  assert.notEqual(result.data.baseId,sameName.id);
  const learningBase=ctx.app.store.get('base',result.data.baseId);assert.equal(learningBase.name,'机器学习');assert.equal(learningBase.systemKind,'feedback_learning');
  const second=await ctx.request('POST',route,{expectedUpdatedAt:timestamp});
  assert.equal(second.status,200,JSON.stringify(second.data));assert.equal(second.data.alreadyLearned,true);assert.equal(second.data.documentId,result.data.documentId);
  assert.equal(ctx.app.store.list('base').filter(base=>base.systemKind==='feedback_learning').length,1);
  const association=await ctx.request('GET','/api/learning/default');assert.equal(association.data.base.id,result.data.baseId);
  const ordinaryUpload=await ctx.request('POST','/api/documents',{baseId:result.data.baseId,fileName:'ordinary.txt',contentBase64:Buffer.from('普通上传不可绕过学习来源').toString('base64')});
  assert.equal(ordinaryUpload.status,400);assert.equal(ordinaryUpload.data.error.code,'LEARNING_BASE_MANAGED');
  const detail=await ctx.request('GET','/api/documents/'+result.data.documentId);assert.equal(detail.status,200);assert.ok(detail.data.chunks.length>0);
  const original=await ctx.request('GET','/api/documents/'+result.data.documentId+'/file');assert.equal(original.status,200);assert.ok(original.bytes.toString('utf8').includes('旧回答增加了未指定筛选'));
  const records=await ctx.request('GET','/api/feedback');const record=records.data.feedback.find(row=>row.id==='learn_api_feedback');assert.equal(record.learning.documentId,result.data.documentId);
  assert.equal((await ctx.request('POST',route,{expectedUpdatedAt:timestamp},ctx.viewer)).status,403);
  const current=ctx.app.store.get('feedback','learn_api_feedback');ctx.app.store.put('feedback',{...current,updatedAt:'2099-01-01T00:00:00.000Z',resolution:'新的已确认结论'});
  assert.equal((await ctx.request('POST',route,{expectedUpdatedAt:timestamp})).status,409);
}));

test('feedback without a conclusion becomes a review draft and never an active correction', async () => fixture(async ctx => {
  const timestamp=new Date().toISOString();
  ctx.app.store.put('feedback',{id:'learn_api_unresolved',userId:ctx.admin.id,documentId:null,type:'missing',question:'设备数量为什么不一致？',comment:'尚未核对的用户问题',resolution:'',status:'open',createdAt:timestamp,updatedAt:timestamp});
  const result=await ctx.request('POST','/api/feedback/learn_api_unresolved/learn',{expectedUpdatedAt:timestamp});
  assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.status,'review');
  assert.equal(isRetrievable(ctx.app.store.get('document',result.data.documentId)),false);
  const record=(await ctx.request('GET','/api/feedback')).data.feedback.find(row=>row.id==='learn_api_unresolved');assert.equal(record.learning.status,'review');
  const completed=await ctx.request('POST','/api/feedback/learn_api_unresolved/learn',{expectedUpdatedAt:timestamp,conclusion:'应对齐资料版本与筛选范围，再依据完整台账核对数量。'});
  assert.equal(completed.status,201,JSON.stringify(completed.data));assert.equal(completed.data.status,'published');
  assert.equal(ctx.app.store.get('feedback','learn_api_unresolved').resolution,'');
  const completedDoc=ctx.app.store.get('document',completed.data.documentId);assert.equal(isRetrievable(completedDoc),true);
}));
