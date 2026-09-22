import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import { createApp } from '../server/api.mjs';
import { sessionHash } from '../server/security.mjs';
import { connectorTarget } from '../server/source-connectors.mjs';
import { checkKnowledge,knowledgePresentationPolicy } from '../server/knowledge-checks.mjs';
import { createTable,chunkTable } from '../server/table-parser.mjs';
import { PARSER_LIMITS } from '../server/parser.mjs';

async function fixture(run){
  const saved={...process.env},dir=mkdtempSync(path.join(os.tmpdir(),'xrag-upgrade-'));let app,server;
  for(const key of ['ADMIN_USERNAME','ADMIN_PASSWORD','DEEPSEEK_API_KEY','OPENAI_API_KEY','AI_API_KEY','EMBEDDING_API_KEY','KNOWLEDGE_API_ALLOWED_ENDPOINTS','KNOWLEDGE_WEB_ALLOWED_HOSTS'])delete process.env[key];
  process.env.AUTH_MODE='password';process.env.API_HOST='127.0.0.1';process.env.LOCAL_EMBEDDINGS_ENABLED='false';process.env.ALLOWED_ORIGINS='http://localhost:5173';
  try{
    app=await createApp({dataDir:dir,startWorker:false});app.store.put('setting',{id:'model',provider:'disabled',embeddingBaseUrl:'',embeddingModel:''});
    const admin={id:'admin',username:'admin',name:'隔离管理员',role:'admin',active:true},viewer={id:'viewer',username:'viewer',name:'隔离读者',role:'viewer',active:true};
    const cookies={};for(const actor of [admin,viewer]){app.store.put('user',actor);const token=crypto.randomBytes(20).toString('hex');cookies[actor.id]='xrag_session='+token;app.store.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sessionHash(token),actor.id,Date.now()+600000);}
    const base={id:'base',name:'隔离库',visibility:'company',ownerId:admin.id,members:[]};app.store.put('base',base);
    let serial=0;
    function document(text,patch={},chunks){
      const id='document_'+ ++serial,bytes=Buffer.from(text);const doc={id,familyId:id,baseId:base.id,ownerId:admin.id,title:'测试资料'+serial,fileName:id+'.txt',storageName:id+'.txt',mimeType:'text/plain',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),status:'published',stage:'已发布',version:1,revision:1,contentRevision:1,pageCount:1,chunkCount:chunks?.length||1,sourceKind:'reference',applicability:'设备维护试验范围',sensitivity:'internal',warnings:[],notes:[],summary:'保留摘要',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),...patch};
      writeFileSync(path.join(dir,'uploads',doc.storageName),bytes);app.store.put('document',doc);app.store.replaceChunks(id,(chunks||[{text,page:1,ordinal:0}]).map((c,index)=>({...c,id:id+'_chunk_'+index,documentId:id})));return doc;
    }
    server=http.createServer(app.handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const request=(method,route,body,actor=admin)=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method,headers:{cookie:cookies[actor.id],origin:'http://localhost:5173','content-type':'application/json'}},res=>{let value='';res.setEncoding('utf8');res.on('data',part=>value+=part);res.on('end',()=>resolve({status:res.statusCode,data:res.headers['content-type']?.includes('application/json')?JSON.parse(value):null,text:value}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
    await run({app,dir,admin,viewer,base,document,request});
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}if(app)await app.close();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dir,{recursive:true,force:true});}
}
test('evidence API preserves original and published version, requires revision, and removes conflicting table values on text correction',async()=>fixture(async c=>{
  const table=createTable([['设备编号','次数'],['DEV-1','7'],['DEV-2','9']],{tableId:'test-table',name:'设备表',format:'csv'},PARSER_LIMITS);
  const doc=c.document('original bytes',{expiresAt:'2099-01-01T00:00:00Z'},chunkTable(table,1,PARSER_LIMITS));
  const evidence=await c.request('GET','/api/documents/'+doc.id+'/evidence');assert.equal(evidence.status,200);const block=evidence.data.blocks[0];assert.deepEqual(block.structuredData.rowNumbers,[2,3]);assert.equal(evidence.data.document.canManage,true);
  const denied=await c.request('PATCH','/api/documents/'+doc.id+'/evidence/'+block.id,{revision:1,blockRevision:1,reason:'不可越权',text:'changed'},c.viewer);assert.equal(denied.status,404);
  const response=await c.request('PATCH','/api/documents/'+doc.id+'/evidence/'+block.id,{revision:1,blockRevision:1,reason:'对照原件校对数值',text:'设备DEV-1检修8次，已核对。'});assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.createdVersion,true);
  const next=c.app.store.get('document',response.data.document.id);assert.equal(next.status,'review');assert.equal(next.expiresAt,doc.expiresAt);assert.equal(next.structuredDataIncomplete,true);assert.equal(c.app.store.get('document',doc.id).status,'published');assert.equal(c.app.store.chunks(doc.id)[0].table.rows[0][1],'7');assert.equal(c.app.store.chunks(next.id)[0].table,undefined);assert.equal(readFileSync(path.join(c.dir,'uploads',next.storageName)).toString(),'original bytes');
  const again=await c.request('PATCH','/api/documents/'+next.id+'/evidence/'+response.data.blocks[0].id,{revision:0,blockRevision:1,reason:'旧版本校对'});assert.equal(again.status,409);
}));
test('structured correction retains source row identity and confirmation is a real audited action',async()=>fixture(async c=>{
  const table=createTable([['设备编号','次数'],['DEV-1','7']],{tableId:'test-table',name:'设备表',format:'csv'},PARSER_LIMITS);table.reviewRequired=true;
  const doc=c.document('original',{status:'review'},chunkTable(table,1,PARSER_LIMITS)),route='/api/documents/'+doc.id+'/evidence/'+doc.id+'_chunk_0';
  let response=await c.request('PATCH',route,{revision:1,blockRevision:1,reason:'不能伪造源记录号',structuredData:{...c.app.store.chunks(doc.id)[0].table,rowNumbers:[99]}});assert.equal(response.status,400);assert.equal(c.app.store.get('document',doc.id).revision,1);
  response=await c.request('PATCH',route,{revision:1,blockRevision:1,reason:'逐项核对原件数值与来源行'});assert.equal(response.status,200);assert.equal(response.data.blocks[0].reviewState,'confirmed');assert.equal(response.data.createdVersion,false);assert.ok(c.app.store.events().some(e=>e.action==='evidence.reviewed'));
}));
test('knowledge checks retain true differences, prevent unsafe equivalence, and make old decisions stale after source changes',async()=>fixture(async c=>{
  const left=c.document('设备A每7天检查一次，并填写完整维护记录。'),right=c.document('设备A每30天检查一次，并填写完整维护记录。');
  checkKnowledge(c.app.store,c.admin,{baseId:c.base.id});let listed=await c.request('GET','/api/knowledge-issues');const conflict=listed.data.issues.find(i=>i.type==='conflict');assert.ok(conflict);assert.ok(conflict.criticalDifferences.numbers);assert.deepEqual(new Set(knowledgePresentationPolicy(c.app.store,c.admin).blockedDocumentIds),new Set([left.id,right.id]));
  let response=await c.request('POST','/api/knowledge-issues/'+conflict.id+'/actions',{decisionRevision:1,action:'resolve',decision:'confirmed_conflict',resolution:'确认差异但还没修订'});assert.equal(response.status,409);
  response=await c.request('POST','/api/knowledge-issues/'+conflict.id+'/actions',{decisionRevision:1,action:'start',decision:'confirmed_conflict',resolution:'已确认范围重叠，等待业务修订'});assert.equal(response.status,200);assert.equal(response.data.issue.status,'in_review');
  c.app.store.put('document',{...c.app.store.get('document',left.id),applicability:'另一范围'});listed=await c.request('GET','/api/knowledge-issues');assert.equal(listed.data.issues.find(i=>i.id===conflict.id).status,'stale');assert.equal(knowledgePresentationPolicy(c.app.store,c.admin).blockedDocumentIds.length,0);
  response=await c.request('POST','/api/knowledge-issues/'+conflict.id+'/actions',{decisionRevision:2,action:'resolve',decision:'different_scope',resolution:'旧依据不能直接关闭'});assert.equal(response.status,409);
}));
test('different equipment identities do not become equivalent or conflicts and hidden evidence stays hidden',async()=>fixture(async c=>{
  c.document('设备DEV-101每7天检查一次，并填写完整维护记录。');c.document('设备DEV-202每30天检查一次，并填写完整维护记录。');
  checkKnowledge(c.app.store,c.admin,{baseId:c.base.id});assert.equal(c.app.store.list('knowledgeIssue').length,0);
  const a=c.document('相同条款要求每日检查设备外观并填写维护记录。'),b=c.document('相同条款要求每日检查设备外观并填写维护记录。',{sensitivity:'confidential'});
  checkKnowledge(c.app.store,c.admin,{baseId:c.base.id});let response=await c.request('GET','/api/knowledge-issues',undefined,c.viewer);assert.ok(response.data.issues.every(i=>i.evidenceRefs.every(r=>r.documentId!==b.id)));
  const issue=c.app.store.list('knowledgeIssue').find(i=>i.documentStates.some(d=>d.id===a.id)&&i.documentStates.some(d=>d.id===b.id));assert.ok(issue);
  response=await c.request('POST','/api/knowledge-issues/'+issue.id+'/actions',{decisionRevision:1,action:'resolve',decision:'equivalent',resolution:'对照原件，关键条款及适用范围一致'});assert.equal(response.status,200);assert.equal(knowledgePresentationPolicy(c.app.store,c.viewer).equivalentGroups.length,0);
}));
test('table-derived entity relations require review and become unavailable after source revision',async()=>fixture(async c=>{
  const table=createTable([['设备编号','车站','工单编号'],['DEV-1','甲站','WO-1']],{tableId:'asset-table',name:'设备关系',format:'csv'},PARSER_LIMITS),doc=c.document('device relationship',{},chunkTable(table,1,PARSER_LIMITS));
  let response=await c.request('POST','/api/documents/'+doc.id+'/relations/extract',{revision:1});assert.equal(response.status,200);assert.equal(response.data.relations.length,2);const relation=response.data.relations[0];assert.equal(relation.evidenceRefs[0].rowNumber,2);
  response=await c.request('GET','/api/documents/'+doc.id+'/relations',undefined,c.viewer);assert.equal(response.data.relations.length,0);
  response=await c.request('POST','/api/relations/'+relation.id+'/actions',{revision:1,action:'confirm',reason:'对照原表设备编号和车站确认'});assert.equal(response.status,200);
  response=await c.request('GET','/api/documents/'+doc.id+'/relations',undefined,c.viewer);assert.equal(response.data.relations.length,1);
  c.app.store.put('document',{...doc,contentRevision:2});response=await c.request('GET','/api/documents/'+doc.id+'/relations',undefined,c.viewer);assert.equal(response.data.relations.length,0);
}));
test('connector URL policy rejects SSRF, misleading credentials and encoded traversal before a connection',async()=>fixture(async()=>{
  process.env.KNOWLEDGE_WEB_ALLOWED_HOSTS='example.test';
  await assert.rejects(connectorTarget('https://example.test/path','web',{resolve:async()=>[{address:'127.0.0.1',family:4}]}),{code:'SOURCE_ADDRESS_DENIED'});
  await assert.rejects(connectorTarget('https://example.test/path','web',{resolve:async()=>[{address:'::ffff:127.0.0.1',family:6}]}),{code:'SOURCE_ADDRESS_DENIED'});
  await assert.rejects(connectorTarget('https://example.test/%252e%252e/secret','web'),{code:'SOURCE_PATH_DENIED'});
  await assert.rejects(connectorTarget('https://example.test/path?token=secret','web'),{code:'INVALID_SOURCE_URL'});
  await assert.rejects(connectorTarget('http://127.0.0.1/private','api'),{code:'API_ENDPOINT_NOT_ALLOWED'});
}));
test('real local API connector imports without model calls, redacts token, deduplicates repeat sync and withdraws revoked source',async()=>fixture(async c=>{
  let allowed=true,text='测试设备台账：设备DEV-1位于甲站，来源仅用于隔离测试。';let calls=0;
  const source=http.createServer((req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer connector-test-secret');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({records:[{id:'asset-1',title:'隔离台账',text,allowed,revision:allowed?text.length:'revoked',updatedAt:'2026-09-08T00:00:00Z'}],complete:true}));});
  await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+source.address().port+'/records';process.env.KNOWLEDGE_API_ALLOWED_ENDPOINTS=url;process.env.KNOWLEDGE_CONNECTOR_ALLOW_HTTP_LOOPBACK='true';
  try{
    let response=await c.request('POST','/api/connectors',{type:'api',name:'隔离来源',baseId:c.base.id,url,token:'connector-test-secret'});assert.equal(response.status,400);assert.equal(response.data.error.code,'PERMISSION_MAPPING_REQUIRED');
    response=await c.request('POST','/api/connectors',{type:'api',name:'隔离来源',baseId:c.base.id,url,token:'connector-test-secret',permissionMapping:{mode:'target_base',approved:true}});assert.equal(response.status,201,JSON.stringify(response.data));const id=response.data.connector.id;assert.ok(!JSON.stringify(response.data).includes('connector-test-secret'));
    response=await c.request('POST','/api/connectors/'+id+'/sync',{});assert.equal(response.status,200);assert.equal(response.data.imported,1,JSON.stringify(response.data));assert.equal(c.app.store.list('document').length,1);
    response=await c.request('POST','/api/connectors/'+id+'/sync',{});assert.equal(response.data.skipped,1);assert.equal(c.app.store.list('document').length,1);assert.equal(c.app.store.get('remoteConnector',id).cursor,null);
    const document=c.app.store.list('document')[0];c.app.store.put('document',{...document,status:'published'});
    allowed=false;response=await c.request('POST','/api/connectors/'+id+'/sync',{});assert.equal(response.data.withdrawn,1);assert.equal(c.app.store.get('document',document.id).source.accessState,'withdrawn');assert.equal((await c.request('GET','/api/documents/'+document.id+'/file',undefined,c.viewer)).status,404);
    allowed=true;response=await c.request('POST','/api/connectors/'+id+'/sync',{});assert.equal(response.data.updated,1);assert.equal(c.app.store.list('document').length,2);assert.equal(c.app.store.get('document',document.id).source.accessState,'withdrawn');
    assert.ok(calls>=4);response=await c.request('GET','/api/connectors');assert.ok(!JSON.stringify(response.data).includes('sealedSecret'));assert.ok(!JSON.stringify(response.data).includes('connector-test-secret'));
  }finally{source.closeAllConnections();await new Promise(resolve=>source.close(resolve));}
}));
test('failed pagination never advances the cursor or duplicates an already ingested first page',async()=>fixture(async c=>{
  const source=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url.includes('cursor=')){res.statusCode=503;res.end('{}');}else res.end(JSON.stringify({records:[{id:'one',text:'隔离分页来源记录，失败批次不得丢失游标。'}],nextCursor:'page-two'}));});
  await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+source.address().port+'/records';process.env.KNOWLEDGE_API_ALLOWED_ENDPOINTS=url;process.env.KNOWLEDGE_CONNECTOR_ALLOW_HTTP_LOOPBACK='true';
  try{const created=await c.request('POST','/api/connectors',{type:'api',baseId:c.base.id,url,permissionMapping:{mode:'target_base',approved:true}});const id=created.data.connector.id;for(let n=0;n<2;n++){const response=await c.request('POST','/api/connectors/'+id+'/sync',{});assert.equal(response.data.partial,true);assert.equal(response.data.failed,1);assert.equal(c.app.store.get('remoteConnector',id).cursor,null);}assert.equal(c.app.store.list('document').length,1);assert.equal(c.app.store.list('sourceRecord').length,1);}finally{source.closeAllConnections();await new Promise(resolve=>source.close(resolve));}
}));


test('evidence history retains each real transcript correction and rejects concurrent or stale revisions without losing bodies',async()=>fixture(async c=>{
  const original='请核对设备台障,保留原始资料。',doc=c.document(original,{status:'review',durationMs:2000},[{text:original,page:1,ordinal:1,evidenceType:'transcript',locator:{startMs:0,endMs:1900,segment:1},quality:{text:'unreviewed',timing:'unreviewed',method:'asr'}}]),chunkId=doc.id+'_chunk_0',route='/api/documents/'+doc.id+'/evidence/'+chunkId;
  const competing=await Promise.all([
    c.request('PATCH',route,{revision:1,blockRevision:1,text:'请核对设备台账,保留原始资料。',reason:'对照原音校对设备台账'}),
    c.request('PATCH',route,{revision:1,blockRevision:1,text:'并发请求不得覆盖已接受校对。',reason:'并发旧修订请求'}),
  ]);
  assert.deepEqual(competing.map(x=>x.status).sort(),[200,409]);
  const accepted=competing.find(x=>x.status===200).data.blocks[0].text;
  let records=c.app.store.list('evidenceRevision');assert.equal(records.length,1);const first=JSON.stringify(records[0]);
  assert.equal(records[0].before.text,original);assert.equal(records[0].after.text,accepted);assert.equal(records[0].sourceBlockRevision,1);assert.equal(records[0].blockRevision,2);assert.match(records[0].sourceFingerprint,/^[a-f0-9]{64}$/);assert.equal(records[0].actorId,c.admin.id);assert.equal(records[0].before.quality.method,'asr');assert.equal(records[0].after.quality.method,'manual');assert.deepEqual(records[0].before.locator,{startMs:0,endMs:1900,segment:1});
  const secondText=accepted.replaceAll(',','，')+'已复核。';
  let response=await c.request('PATCH',route,{revision:2,blockRevision:2,text:secondText,reason:'核对标点及时间区间',locator:{startMs:100,endMs:1800}});assert.equal(response.status,200);
  records=c.app.store.list('evidenceRevision');assert.equal(records.length,2);assert.equal(JSON.stringify(records.find(r=>r.blockRevision===2)),first);
  const latest=records.find(r=>r.blockRevision===3);assert.equal(latest.before.text,accepted);assert.equal(latest.after.text,secondText);assert.equal(latest.before.locator.startMs,0);assert.equal(latest.after.locator.startMs,100);
  response=await c.request('PATCH',route,{revision:3,blockRevision:2,text:'不得更新',reason:'旧片段修订冲突'});assert.equal(response.status,409);assert.equal(c.app.store.list('evidenceRevision').length,2);assert.equal(c.app.store.chunks(doc.id)[0].text,secondText);
  response=await c.request('GET','/api/documents/'+doc.id+'/evidence/history');assert.equal(response.status,200);assert.equal(response.data.history.incomplete,false);assert.equal(response.data.history.records.length,2);assert.equal(response.data.history.records[0].after.text,secondText);
  assert.equal(readFileSync(path.join(c.dir,'uploads',doc.storageName),'utf8'),original);
}));

test('evidence history is atomic with chunk storage and duplicate source revision cannot overwrite a snapshot',async()=>fixture(async c=>{
  const doc=c.document('修改前正文',{status:'review'}),chunkId=doc.id+'_chunk_0',route='/api/documents/'+doc.id+'/evidence/'+chunkId;
  const originalReplace=c.app.store.replaceChunks;c.app.store.replaceChunks=()=>{throw new Error('isolated-storage-failure');};
  try{const failed=await c.request('PATCH',route,{revision:1,blockRevision:1,text:'未提交正文',reason:'模拟存储失败回滚'});assert.equal(failed.status,500);}finally{c.app.store.replaceChunks=originalReplace;}
  assert.equal(c.app.store.list('evidenceRevision').length,0);assert.equal(c.app.store.get('document',doc.id).revision,1);assert.equal(c.app.store.chunks(doc.id)[0].text,'修改前正文');
  const response=await c.request('PATCH',route,{revision:1,blockRevision:1,text:'实际提交正文',reason:'恢复后执行真实校对'});assert.equal(response.status,200);const saved=c.app.store.list('evidenceRevision')[0];
  // A corrupted/replayed source revision must also fail the INSERT-only history guard.
  c.app.store.put('document',{...c.app.store.get('document',doc.id),revision:1});c.app.store.replaceChunks(doc.id,[{...c.app.store.chunks(doc.id)[0],blockRevision:1}]);
  const duplicate=await c.request('PATCH',route,{revision:1,blockRevision:1,text:'不得覆盖快照',reason:'相同来源修订重放'});assert.equal(duplicate.status,409);assert.equal(duplicate.data.error.code,'EVIDENCE_HISTORY_CONFLICT');assert.deepEqual(c.app.store.list('evidenceRevision'),[saved]);
}));

test('legacy corrected evidence is marked incomplete without inventing its missing old body',async()=>fixture(async c=>{
  const doc=c.document('真实原件不变',{status:'review'},[{text:'请核对设备台账,保留资料。',page:1,ordinal:1,evidenceType:'transcript',blockRevision:2,corrected:true,reviewState:'confirmed'}]),chunkId=doc.id+'_chunk_0';
  let response=await c.request('GET','/api/documents/'+doc.id+'/evidence/history');assert.equal(response.data.history.incomplete,true);assert.equal(response.data.history.records.length,0);
  response=await c.request('PATCH','/api/documents/'+doc.id+'/evidence/'+chunkId,{revision:1,blockRevision:2,text:'请核对设备台账，保留资料。',reason:'本轮只核对中文标点'});assert.equal(response.status,200);
  response=await c.request('GET','/api/documents/'+doc.id+'/evidence/history');assert.equal(response.data.history.incomplete,true);assert.match(response.data.history.notice,/未补造历史/);assert.equal(response.data.history.records.length,1);assert.equal(response.data.history.records[0].before.text,'请核对设备台账,保留资料。');assert.equal(JSON.stringify(response.data).includes('台障'),false);
}));

test('history follows corrected versions but never discloses draft or withdrawn-source bodies to unauthorized readers',async()=>fixture(async c=>{
  const doc=c.document('原始正文',{status:'review'}),route='/api/documents/'+doc.id+'/evidence/'+doc.id+'_chunk_0';
  let response=await c.request('PATCH',route,{revision:1,blockRevision:1,text:'首次校对后的正文',reason:'首次真实校对'});assert.equal(response.status,200);
  c.app.store.put('document',{...c.app.store.get('document',doc.id),status:'published'});
  response=await c.request('GET','/api/documents/'+doc.id+'/evidence',undefined,c.viewer);assert.equal(response.status,200);assert.equal(response.data.historyAvailable,false);assert.equal('history' in response.data,false);assert.equal('records' in response.data,false);
  response=await c.request('GET','/api/documents/'+doc.id+'/evidence/history',undefined,c.viewer);assert.equal(response.status,404);assert.equal(response.text.includes('原始正文'),false);
  response=await c.request('PATCH',route,{revision:2,blockRevision:2,text:'新版本待审核正文',reason:'发布后发现需进一步校对'});assert.equal(response.status,200);const next=response.data.document;
  response=await c.request('GET','/api/documents/'+next.id+'/evidence/history');assert.equal(response.data.history.incomplete,false);assert.equal(response.data.history.records.length,2);assert.equal(response.data.history.records[0].sourceDocumentId,doc.id);assert.equal(response.data.history.records[0].documentId,next.id);assert.equal(response.data.history.records[0].before.text,'首次校对后的正文');
  response=await c.request('GET','/api/documents/'+doc.id+'/evidence/history');assert.equal(response.data.history.records.length,1);assert.equal(response.text.includes('新版本待审核正文'),false);
  c.app.store.put('user',{...c.viewer,role:'editor'});c.app.store.put('document',{...c.app.store.get('document',next.id),ownerId:c.viewer.id});c.app.store.put('document',{...c.app.store.get('document',doc.id),source:{accessState:'withdrawn'}});
  response=await c.request('GET','/api/documents/'+next.id+'/evidence',undefined,c.viewer);assert.equal(response.status,200);assert.equal(response.data.historyAvailable,true);
  response=await c.request('GET','/api/documents/'+next.id+'/evidence/history',undefined,c.viewer);assert.equal(response.status,200);assert.equal(response.data.history.records.length,0);assert.equal(response.data.history.incomplete,true);assert.equal(response.text.includes('首次校对后的正文'),false);assert.equal(response.text.includes('原始正文'),false);
}));

test('header propagation preserves before and after tables for every affected evidence block',async()=>fixture(async c=>{
  const table=createTable([['设备编号','次数'],['DEV-1','7'],['DEV-2','9']],{tableId:'table-history',name:'设备表',format:'csv'},PARSER_LIMITS);
  const fragments=table.rows.map((row,index)=>({text:'旧表头记录'+index,page:1,ordinal:index,table:{...table,rows:[row],rowNumbers:[table.rowNumbers[index]],rowStart:index+1,rowEnd:index+1}}));
  const doc=c.document('original table bytes',{status:'review'},fragments),chunks=c.app.store.chunks(doc.id);
  const response=await c.request('PATCH','/api/documents/'+doc.id+'/evidence/'+chunks[0].id,{revision:1,blockRevision:1,reason:'原件明确列名为检修次数',structuredData:{...chunks[0].table,headers:['设备编号','检修次数']}});
  assert.equal(response.status,200);const records=c.app.store.list('evidenceRevision');assert.equal(records.length,2);assert.deepEqual(new Set(records.map(r=>r.cause)),new Set(['manual_review','header_propagation']));
  for(const record of records){assert.deepEqual(record.before.table.headers,['设备编号','次数']);assert.deepEqual(record.after.table.headers,['设备编号','检修次数']);assert.deepEqual(record.before.table.rows,record.after.table.rows);assert.deepEqual(record.after.structuredData,record.after.table);}
  const history=await c.request('GET','/api/documents/'+doc.id+'/evidence/history');assert.equal(history.data.history.incomplete,false);assert.equal(history.data.history.records.length,2);
}));
