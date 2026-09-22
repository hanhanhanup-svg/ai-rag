import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createApp } from './api.mjs';
import { sessionHash, canDocument, isRetrievable } from './security.mjs';
import { indexSnapshot, indexSnapshotCurrent, indexRetryAllowed } from './index-scheduling.mjs';

async function fixture(t) {
  const saved={...process.env},dir=mkdtempSync(path.join(os.tmpdir(),'xrag-document-trash-')),incoming=path.join(dir,'incoming');
  mkdirSync(incoming);
  for(const key of ['ADMIN_USERNAME','ADMIN_PASSWORD','DEEPSEEK_API_KEY','OPENAI_API_KEY','AI_API_KEY','EMBEDDING_API_KEY','KNOWLEDGE_API_ALLOWED_ENDPOINTS','KNOWLEDGE_WEB_ALLOWED_HOSTS'])delete process.env[key];
  Object.assign(process.env,{AUTH_MODE:'password',API_HOST:'127.0.0.1',LOCAL_EMBEDDINGS_ENABLED:'false',ALLOWED_ORIGINS:'http://localhost:5173',CONNECTOR_ROOTS:incoming});
  let app,server,serial=0;
  const actors={admin:{id:'admin',username:'admin',name:'隔离管理员',role:'admin',department:'测试部门',active:true},owner:{id:'owner',username:'owner',name:'隔离维护人',role:'editor',department:'测试部门',active:true},peer:{id:'peer',username:'peer',name:'隔离其他编辑',role:'editor',department:'测试部门',active:true},viewer:{id:'viewer',username:'viewer',name:'隔离读者',role:'viewer',department:'测试部门',active:true}};
  const base={id:'trash-test-base',name:'回收站隔离测试库',visibility:'company',ownerId:'admin',department:'测试部门',members:[],createdAt:new Date().toISOString()};
  const cookies={};
  const open=async()=>{app=await createApp({dataDir:path.join(dir,'state'),startWorker:false});app.store.put('setting',{id:'model',provider:'disabled',embeddingBaseUrl:'',embeddingModel:''});server=http.createServer(app.handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));};
  const close=async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;}if(app){await app.close();app=null;}};
  await open();
  for(const actor of Object.values(actors)){app.store.put('user',actor);const token=crypto.randomBytes(20).toString('hex');cookies[actor.id]='xrag_session='+token;app.store.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sessionHash(token),actor.id,Date.now()+600000);}
  app.store.put('base',base);
  const request=async(method,route,body,actor=actors.admin)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}`+route,{method,headers:{cookie:cookies[actor.id],origin:'http://localhost:5173',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text();return {status:response.status,data:response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):null,text};};
  function document(text,patch={},withChunks=true){const id='trash-document-'+ ++serial,bytes=Buffer.from(text),timestamp=new Date().toISOString();const doc={id,familyId:id,baseId:base.id,ownerId:actors.owner.id,title:'隔离回收资料'+serial,fileName:id+'.txt',storageName:id+'.txt',mimeType:'text/plain',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),status:'published',stage:'已发布',version:1,revision:1,contentRevision:1,pageCount:1,chunkCount:withChunks?1:0,sourceKind:'synthetic',applicability:'仅用于隔离自动测试',sensitivity:'internal',warnings:[],notes:[],tags:[],summary:'隔离验证摘要',createdAt:timestamp,updatedAt:timestamp,...patch};writeFileSync(path.join(app.store.dataDir,'uploads',doc.storageName),bytes);app.store.put('document',doc);if(withChunks)app.store.replaceChunks(id,[{id:id+'-chunk',documentId:id,page:1,ordinal:0,text}]);return doc;}
  const upload=async(text,extra={},actor=actors.owner)=>{const response=await request('POST','/api/documents',{baseId:base.id,fileName:'回收站上传隔离.txt',contentBase64:Buffer.from(text).toString('base64'),sourceKind:'synthetic',...extra},actor);return response;};
  t.after(async()=>{await close();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dir,{recursive:true,force:true});});
  return {get app(){return app;},dir,incoming,actors,base,request,document,upload,restart:async()=>{await close();await open();}};
}

const code=response=>response.data?.error?.code;

test('trash lifecycle requires ownership and revision, removes ordinary access, and preserves recoverable originals',async t=>{
  const f=await fixture(t),{owner,peer,viewer,admin}=f.actors;
  const text='回收验证巡检：检修前应核对设备编码和隔离状态，并记录复核人。';
  const doc=f.document(text,{title:'回收验证巡检规程'}),file=path.join(f.app.store.dataDir,'uploads',doc.storageName);
  const chunkIds=f.app.store.chunks(doc.id).map(chunk=>chunk.id),original=readFileSync(file);
  f.document('正常下架资料仍在普通文档列表',{status:'archived',title:'普通下架资料'});
  assert.equal((await f.request('GET','/api/search?q=回收验证巡检',undefined,viewer)).data.results.some(row=>row.documentId===doc.id),true);
  assert.equal((await f.request('POST','/api/favorites',{documentId:doc.id},viewer)).status,201);
  const chat=await f.request('POST','/api/chat',{question:'回收验证巡检需要核对什么？',baseId:f.base.id},viewer);
  assert.equal(chat.status,200,JSON.stringify(chat.data));assert.ok(chat.data.citations.some(ref=>ref.documentId===doc.id));
  f.app.store.put('evalRun',{id:'old-evaluation',createdAt:new Date().toISOString(),status:'completed',results:[{caseId:'case',passed:true,documentIds:[doc.id],excerpt:text,ruleSnapshot:{expectedText:'用户自填标准保留'}}]});
  assert.equal(code(await f.request('DELETE','/api/documents/'+doc.id,{},owner)),'REVISION_REQUIRED');
  assert.equal(code(await f.request('DELETE','/api/documents/'+doc.id,{revision:99},owner)),'REVISION_CONFLICT');
  for(const actor of [peer,viewer])assert.equal((await f.request('DELETE','/api/documents/'+doc.id,{revision:doc.revision},actor)).status,404);
  const removed=await f.request('DELETE','/api/documents/'+doc.id,{revision:doc.revision},owner);
  assert.equal(removed.status,200,JSON.stringify(removed.data));const deleted=removed.data.document;
  assert.ok(deleted.deletedAt);assert.equal(deleted.deletedBy,owner.id);assert.equal(deleted.deletedFromStatus,'published');assert.equal(deleted.status,'archived');assert.equal(deleted.revision,2);
  assert.equal(canDocument(admin,{...deleted,status:'published'},f.app.store),false);assert.equal(isRetrievable({...deleted,status:'published'}),false);
  for(const route of ['/api/documents/'+doc.id,'/api/documents/'+doc.id+'/file','/api/documents/'+doc.id+'/preview'])for(const actor of [admin,owner,viewer])assert.equal((await f.request('GET',route,undefined,actor)).status,404,route);
  assert.equal((await f.request('POST','/api/documents/'+doc.id+'/actions',{action:'restore',revision:deleted.revision},owner)).status,404);
  const ordinary=(await f.request('GET','/api/documents?status=archived')).data.documents;assert.ok(ordinary.some(row=>row.title==='普通下架资料'));assert.ok(!ordinary.some(row=>row.id===doc.id));
  assert.equal((await f.request('GET','/api/favorites',undefined,viewer)).data.favorites.length,0);
  assert.equal((await f.request('GET','/api/search?q=回收验证巡检',undefined,viewer)).data.results.length,0);
  assert.ok(!JSON.stringify((await f.request('GET','/api/graph?baseId='+f.base.id)).data).includes(doc.id));
  const history=await f.request('GET','/api/conversations/'+chat.data.conversationId,undefined,viewer);assert.equal(history.data.messages.find(message=>message.role==='assistant').citations.length,0);
  const evaluation=(await f.request('GET','/api/evaluations')).data.runs[0].results[0];assert.equal(evaluation.excerpt,'');assert.equal(evaluation.evidenceWithdrawn,true);assert.equal(evaluation.passed,true);assert.equal(evaluation.ruleSnapshot.expectedText,'用户自填标准保留');
  assert.equal((await f.request('GET','/api/documents/trash',undefined,viewer)).status,403);
  assert.equal((await f.request('GET','/api/documents/trash',undefined,peer)).data.documents.length,0);
  const trash=await f.request('GET','/api/documents/trash?baseId='+f.base.id+'&q=回收验证&limit=1&offset=0',undefined,owner);assert.equal(trash.status,200);assert.equal(trash.data.pagination.total,1);assert.equal(trash.data.documents[0].id,doc.id);assert.equal(trash.data.documents[0].canManage,true);
  assert.equal((await f.request('GET','/api/documents/trash?limit=0')).status,400);
  assert.equal((await f.request('POST','/api/documents/'+doc.id+'/restore-from-trash',{revision:deleted.revision},peer)).status,404);
  assert.equal(code(await f.request('POST','/api/documents/'+doc.id+'/restore-from-trash',{},owner)),'REVISION_REQUIRED');
  assert.equal(code(await f.request('POST','/api/documents/'+doc.id+'/restore-from-trash',{revision:1},owner)),'REVISION_CONFLICT');
  const restored=await f.request('POST','/api/documents/'+doc.id+'/restore-from-trash',{revision:deleted.revision},owner);assert.equal(restored.status,200);assert.equal(restored.data.document.status,'review');assert.equal(restored.data.document.deletedAt,null);
  assert.deepEqual(readFileSync(file),original);assert.deepEqual(f.app.store.chunks(doc.id).map(chunk=>chunk.id),chunkIds);
  assert.equal((await f.request('GET','/api/search?q=回收验证巡检',undefined,viewer)).data.results.length,0);
  assert.deepEqual(f.app.store.events(100,doc.id).filter(event=>['document.deleted','document.restored_from_trash'].includes(event.action)).map(event=>event.action).sort(),['document.deleted','document.restored_from_trash']);
});

test('trash permissions follow current private-base access and confidential-document ownership',async t=>{
  const f=await fixture(t),privateBase={...f.base,id:'private-base',visibility:'private',members:[f.actors.owner.id,f.actors.peer.id]};f.app.store.put('base',privateBase);
  const doc=f.document('私有库受限资料',{baseId:privateBase.id,sensitivity:'confidential'});
  const removed=await f.request('DELETE','/api/documents/'+doc.id,{revision:doc.revision},f.actors.owner);assert.equal(removed.status,200);
  assert.equal((await f.request('GET','/api/documents/trash?baseId='+privateBase.id,undefined,f.actors.peer)).data.documents.length,0);
  f.app.store.put('base',{...privateBase,members:[f.actors.peer.id]});
  assert.equal((await f.request('POST','/api/documents/'+doc.id+'/restore-from-trash',{revision:removed.data.document.revision},f.actors.owner)).status,404);
  assert.equal((await f.request('POST','/api/documents/'+doc.id+'/restore-from-trash',{revision:removed.data.document.revision},f.actors.admin)).status,200);
});

test('deleted highest versions reserve their version numbers and never republish an older version',async t=>{
  const f=await fixture(t),first=f.document('版本一原始内容',{status:'superseded',fileName:'版本链验收.txt'}),second=f.document('版本二回收原始内容',{familyId:first.familyId,version:2,previousVersionId:first.id,fileName:first.fileName});
  const removed=await f.request('DELETE','/api/documents/'+second.id,{revision:second.revision},f.actors.owner);assert.equal(removed.status,200);
  assert.equal(f.app.store.get('document',first.id).status,'superseded');
  const duplicate=await f.upload('版本二回收原始内容',{fileName:first.fileName});assert.equal(code(duplicate),'DOCUMENT_IN_TRASH');assert.equal(f.app.store.list('document').length,2);
  const third=await f.upload('版本三全新修订内容',{fileName:first.fileName,previousVersionId:first.id,duplicateAction:'version'});assert.equal(third.status,201,JSON.stringify(third.data));assert.equal(third.data.document.version,3);
  await f.app.runQueue();let current=f.app.store.get('document',third.data.document.id);assert.equal((await f.request('POST','/api/documents/'+current.id+'/actions',{action:'publish',revision:current.revision},f.actors.owner)).status,200);
  const restored=await f.request('POST','/api/documents/'+second.id+'/restore-from-trash',{revision:removed.data.document.revision},f.actors.owner);assert.equal(restored.data.document.status,'review');
  const invalidPublish=await f.request('POST','/api/documents/'+second.id+'/actions',{action:'publish',revision:restored.data.document.revision},f.actors.owner);assert.equal(code(invalidPublish),'NEWER_VERSION_PUBLISHED');
  assert.equal(f.app.store.get('document',current.id).status,'published');assert.equal(f.app.store.get('document',first.id).status,'superseded');
});

test('queued removal cancels work, empty restoration queues parsing, and active processing is rejected',async t=>{
  const f=await fixture(t),uploaded=await f.upload('待解析恢复内容');assert.equal(uploaded.status,201);const doc=uploaded.data.document;
  const removed=await f.request('DELETE','/api/documents/'+doc.id,{revision:doc.revision},f.actors.owner);assert.equal(removed.status,200);
  assert.ok(f.app.store.list('task').filter(task=>task.documentId===doc.id).every(task=>task.status==='cancelled'));
  await f.app.runQueue();assert.equal(f.app.store.get('document',doc.id).status,'archived');
  const restored=await f.request('POST','/api/documents/'+doc.id+'/restore-from-trash',{revision:removed.data.document.revision},f.actors.owner);assert.equal(restored.data.document.status,'queued');
  await f.app.runQueue();assert.equal(f.app.store.get('document',doc.id).status,'review');assert.ok(f.app.store.chunks(doc.id).length);
  for(const patch of [{status:'processing'},{embeddingStatus:'processing'}]){const busy=f.document('正在处理不得删除',patch);assert.equal(code(await f.request('DELETE','/api/documents/'+busy.id,{revision:busy.revision},f.actors.owner)),'DOCUMENT_BUSY');f.app.store.put('document',{...busy,status:'review',embeddingStatus:'pending'});}
  const busy=f.document('后台任务处理中');f.app.store.put('task',{id:'busy-index-task',documentId:busy.id,type:'index',status:'processing'});assert.equal(code(await f.request('DELETE','/api/documents/'+busy.id,{revision:busy.revision},f.actors.owner)),'DOCUMENT_BUSY');f.app.store.put('task',{id:'busy-index-task',documentId:busy.id,type:'index',status:'cancelled'});
});

test('stale parse jobs and restart recovery cannot write a tombstoned document back to processing or review',async t=>{
  const f=await fixture(t),uploaded=await f.upload('模拟异步队列删除边界'),doc=uploaded.data.document;
  const running=f.app.runQueue();const inFlight=f.app.store.get('document',doc.id);assert.equal(inFlight.status,'processing');
  const tombstone={...inFlight,status:'archived',deletedAt:new Date().toISOString(),deletedBy:f.actors.owner.id,deletedFromStatus:'queued',revision:inFlight.revision+1};f.app.store.put('document',tombstone);
  await running;assert.equal(f.app.store.get('document',doc.id).status,'archived');assert.equal(f.app.store.chunks(doc.id).length,0);assert.ok(f.app.store.list('task').filter(task=>task.documentId===doc.id).every(task=>task.status==='cancelled'));
  f.app.store.put('task',{id:'restart-stale',documentId:doc.id,status:'processing',createdAt:new Date().toISOString()});
  await f.restart();assert.equal(f.app.store.get('document',doc.id).status,'archived');assert.equal(f.app.store.get('task','restart-stale').status,'cancelled');await f.app.runQueue();assert.equal(f.app.store.get('document',doc.id).status,'archived');
  const inconsistent={...f.app.store.get('document',doc.id),status:'published'};const snapshot=indexSnapshot(inconsistent,'test-model');assert.equal(indexSnapshotCurrent(snapshot,inconsistent,'test-model'),false);assert.equal(indexRetryAllowed(inconsistent,'test-model',{force:true}),false);
});

test('directory and API source sync retain deleted latest versions as tombstones',async t=>{
  const f=await fixture(t),sourceFile=path.join(f.incoming,'同步回收验收.txt');writeFileSync(sourceFile,'第一版目录来源正文');
  const local=await f.request('POST','/api/connectors',{name:'目录回收测试',path:f.incoming,baseId:f.base.id,archiveDeleted:true});assert.equal(local.status,201,JSON.stringify(local.data));const localId=local.data.connector.id;
  assert.equal((await f.request('POST','/api/connectors/'+localId+'/sync',{})).status,200);await f.app.runQueue();const localDoc=f.app.store.list('document').find(doc=>doc.source?.connectorId===localId);
  const localDelete=await f.request('DELETE','/api/documents/'+localDoc.id,{revision:localDoc.revision});assert.equal(localDelete.status,200);writeFileSync(sourceFile,'来源更新后仍不得复活已删除资料');
  const repeat=await f.request('POST','/api/connectors/'+localId+'/sync',{});assert.equal(repeat.data.connector.stats.skipped,1);assert.equal(f.app.store.list('document').filter(doc=>doc.source?.connectorId===localId).length,1);assert.equal(f.app.store.get('document',localDoc.id).revision,localDelete.data.document.revision);
  let remoteText='第一版远程来源正文';const remote=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({records:[{id:'remote-1',title:'远程回收验证',text:remoteText,revision:remoteText.length}],complete:true}));});await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{remote.closeAllConnections();await new Promise(resolve=>remote.close(resolve));});
  const remoteUrl='http://127.0.0.1:'+remote.address().port+'/records';process.env.KNOWLEDGE_API_ALLOWED_ENDPOINTS=remoteUrl;process.env.KNOWLEDGE_CONNECTOR_ALLOW_HTTP_LOOPBACK='true';
  const created=await f.request('POST','/api/connectors',{type:'api',name:'远程回收测试',baseId:f.base.id,url:remoteUrl,permissionMapping:{mode:'target_base',approved:true}});assert.equal(created.status,201,JSON.stringify(created.data));const remoteId=created.data.connector.id;
  assert.equal((await f.request('POST','/api/connectors/'+remoteId+'/sync',{})).data.imported,1);await f.app.runQueue();const remoteDoc=f.app.store.list('document').find(doc=>doc.source?.connectorId===remoteId),receipt=f.app.store.list('sourceRecord').find(row=>row.connectorId===remoteId);
  const removed=await f.request('DELETE','/api/documents/'+remoteDoc.id,{revision:remoteDoc.revision});assert.equal(removed.status,200);remoteText='远程新增内容不得生成新版本';
  const sync=await f.request('POST','/api/connectors/'+remoteId+'/sync',{});assert.equal(sync.data.skipped,1);assert.equal(f.app.store.list('document').filter(doc=>doc.source?.connectorId===remoteId).length,1);assert.equal(f.app.store.get('document',remoteDoc.id).revision,removed.data.document.revision);assert.deepEqual(f.app.store.get('sourceRecord',receipt.id),receipt);assert.ok(existsSync(path.join(f.app.store.dataDir,'uploads',remoteDoc.storageName)));
});

for(const lateFailure of [false,true])test(`late ${lateFailure?'failed':'successful'} parse-time embedding result cannot revive a tombstoned document`,async t=>{
  const f=await fixture(t);let arrive,release;const arrived=new Promise(resolve=>arrive=resolve),released=new Promise(resolve=>release=resolve);
  const model=http.createServer(async(req,res)=>{const parts=[];for await(const part of req)parts.push(part);const input=JSON.parse(Buffer.concat(parts).toString());arrive();await released;res.writeHead(lateFailure?503:200,{'content-type':'application/json'});res.end(JSON.stringify(lateFailure?{}:{data:input.input.map((_,index)=>({index,embedding:[1,0]}))}));});await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{release();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));});
  const endpoint='http://127.0.0.1:'+model.address().port+'/v1';f.app.store.put('setting',{id:'model',provider:'ollama',baseUrl:endpoint,model:'isolated-test',embeddingBaseUrl:endpoint,embeddingModel:'isolated-embedding',timeoutMs:5000});
  const uploaded=await f.upload('隔离索引响应不得恢复删除状态'),doc=uploaded.data.document,pending=f.app.runQueue();await arrived;
  const current=f.app.store.get('document',doc.id);f.app.store.put('document',{...current,status:'archived',deletedAt:new Date().toISOString(),deletedBy:f.actors.owner.id,deletedFromStatus:'processing',revision:current.revision+1,contentRevision:(current.contentRevision||1)+1,embeddingRunId:null,embeddingStatus:'pending'});
  release();await pending;const after=f.app.store.get('document',doc.id);assert.equal(after.status,'archived');assert.ok(after.deletedAt);assert.equal(after.embeddingStatus,'pending');assert.equal(f.app.store.vectorCount(doc.id,after.embeddingSignature),0);assert.ok(f.app.store.list('task').filter(task=>task.documentId===doc.id).every(task=>task.status==='cancelled'));
});