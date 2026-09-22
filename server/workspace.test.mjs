import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from './api.mjs';
import {sessionHash} from './security.mjs';
import {extractRelations,reviewRelation} from './knowledge-graph.mjs';
import {executeReadOnlyTool} from './intelligence.mjs';
import {documentFingerprint} from './knowledge-evidence.mjs';
process.env.AUTH_MODE='password';process.env.LOCAL_EMBEDDINGS_ENABLED='false';
for(const name of ['ADMIN_USERNAME','ADMIN_PASSWORD','DEEPSEEK_API_KEY','AI_API_KEY','OPENAI_API_KEY','EMBEDDING_API_KEY'])delete process.env[name];
async function fixture(t){
 const dir=mkdtempSync(path.join(os.tmpdir(),'xrag-workspace-'));const app=await createApp({dataDir:dir,startWorker:false}),store=app.store;
 const admin={id:'admin',name:'测试维护员',role:'admin',active:true},viewer={id:'viewer',name:'测试使用者',role:'viewer',active:true,department:'public'},editor={id:'editor',name:'测试编辑',role:'editor',active:true,department:'public'};
 for(const user of [admin,viewer,editor]){store.put('user',user);store.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sessionHash(user.id),user.id,Date.now()+1000000);}
 const base={id:'base',name:'可见知识',visibility:'company',ownerId:admin.id},secret={id:'secret',name:'隐藏知识',visibility:'private',ownerId:admin.id};store.put('base',base);store.put('base',secret);
 store.put('setting',{id:'model',provider:'disabled',embeddingBaseUrl:'disabled://tests',embeddingModel:'none'});
 const addDoc=(id,extra={})=>{const doc={id,baseId:'base',familyId:id,title:'培训证据 '+id,fileName:id+'.md',version:1,revision:1,contentRevision:1,status:'published',ownerId:admin.id,sourceKind:'synthetic',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),size:1,chunkCount:1,pageCount:1,tags:[],reviewDueAt:'2030-01-01T00:00:00.000Z',...extra};store.put('document',doc);store.replaceChunks(id,[{id:id+'-chunk',documentId:id,page:1,ordinal:0,text:'完成培训任务需要学习活动、任务表现和复核证据。签到不能代替实际任务表现。'}]);return doc;};
 const doc=addDoc('doc'),other=addDoc('other'),hidden=addDoc('hidden',{baseId:'secret'});
 const server=http.createServer(app.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const request=async(method,route,body,user='admin')=>{const response=await fetch(origin+route,{method,headers:{cookie:'xrag_session='+user,origin:'http://localhost:5173',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};};
 const wait=async id=>{for(let i=0;i<200;i++){const run=store.get('intelligenceRun',id);if(!['queued','running'].includes(run.status))return run;await new Promise(r=>setTimeout(r,5));}throw Error('Run did not settle');};
 t.after(async()=>{await new Promise(r=>server.close(r));await app.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dir,{recursive:true,force:true});});
 return {app,store,admin,viewer,editor,base,doc,other,hidden,addDoc,request,wait};
}
test('workspace summary scopes documents, maintenance todos, private feedback and actual usage by current permissions',async t=>{
 const f=await fixture(t),draft=f.addDoc('draft',{status:'review'});f.addDoc('expired',{expiresAt:'2020-01-01'});
 f.store.put('feedback',{id:'private-feedback',userId:'admin',question:'private detail',comment:'secret',status:'open'});f.store.put('feedback',{id:'own-feedback',userId:'viewer',question:'own question',comment:'my feedback',status:'open'});
 f.store.put('intelligenceRun',{id:'admin-run',userId:'admin',baseId:'secret',status:'succeeded',result:{mode:'model'},createdAt:new Date().toISOString()});
 f.store.put('intelligenceRun',{id:'viewer-run',userId:'viewer',baseId:'base',status:'succeeded',result:{mode:'extractive'},createdAt:new Date().toISOString()});
 f.store.put('modelCall',{id:'private-call',runId:'admin-run',usageStatus:'known',inputTokens:999,outputTokens:999});f.store.put('modelCall',{id:'own-call',runId:'viewer-run',usageStatus:'unknown',inputTokens:null,outputTokens:null});
 const v=await f.request('GET','/api/workspace/summary',undefined,'viewer');assert.equal(v.status,200);assert.equal(v.data.documents.total,3);assert.equal(v.data.documents.published,2);assert.equal(v.data.documents.review,0);assert.equal(v.data.usage.runs,1);assert.equal(v.data.usage.unknownCalls,1);assert.equal(v.data.usage.inputTokens,0);assert.deepEqual(v.data.todos.map(x=>x.id),['own-feedback']);assert.ok(!JSON.stringify(v.data).includes('private detail'));assert.ok(!JSON.stringify(v.data).includes('hidden'));
 const a=await f.request('GET','/api/workspace/summary?baseId=base');assert.equal(a.status,200);assert.ok(a.data.todos.some(x=>x.documentId===draft.id&&x.kind==='review'&&x.route.startsWith('/documents/')));assert.equal(a.data.usage.runs,1);
 assert.equal((await f.request('GET','/api/workspace/summary?baseId=secret',undefined,'viewer')).status,404);assert.equal((await f.request('GET','/api/workspace/cases?baseId=secret',undefined,'viewer')).status,404);
});
test('persistent cases require revisions, real publication and verification; original feedback and audit remain independent',async t=>{
 const f=await fixture(t);f.store.put('feedback',{id:'fb',userId:'admin',documentId:'doc',question:'引用原版本',comment:'需要更正',status:'open'});
 const input={title:'版本更正',description:'核对并修订示例版本的培训依据',baseId:'base',kind:'revision',sourceKind:'synthetic',documentId:'doc',documentVersion:1,feedbackId:'fb',seedKey:'seed-case'};
 assert.equal((await f.request('POST','/api/workspace/cases',input,'viewer')).status,403);
 let r=await f.request('POST','/api/workspace/cases',input);assert.equal(r.status,201,JSON.stringify(r.data));let item=r.data.case;assert.equal((await f.request('POST','/api/workspace/cases',input)).data.case.id,item.id);assert.equal((await f.request('POST','/api/workspace/cases',{...input,title:'different'})).status,409);
 const patch=body=>f.request('PATCH','/api/workspace/cases/'+item.id,body);
 assert.equal((await patch({status:'in_progress',reason:'开始核对'})).status,409);assert.equal((await patch({revision:1,status:'verified',reason:'核验完成'})).status,409);
 r=await patch({revision:1,status:'in_progress',reason:'业务资料维护组已开始核对',assigneeLabel:'演示资料维护组'});item=r.data.case;assert.equal(item.revision,2);
 assert.equal((await patch({revision:1,status:'dismissed',reason:'过期请求'})).status,409);
 const verification={documentId:'doc',documentVersion:1,note:'已经逐段比对培训证据要求，原版本没有变化'};
 assert.equal((await patch({revision:2,status:'verified',reason:'尝试复核',verification})).status,409);
 assert.equal((await patch({revision:2,status:'verified',reason:'伪造评测',verification:{...verification,evaluationId:'does-not-exist'}})).status,409);
 const v2=f.addDoc('doc-v2',{familyId:'doc',version:2,status:'review'});
 assert.equal((await patch({revision:2,status:'verified',reason:'尚未发布',verification:{...verification,documentId:v2.id,documentVersion:2}})).status,409);
 f.store.put('document',{...v2,status:'published'});f.store.put('document',{...f.doc,status:'superseded'});
 r=await patch({revision:2,status:'verified',reason:'已完成版本对照和人工核验',verification:{...verification,documentId:v2.id,documentVersion:2}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.case.verificationCurrent,true);assert.equal(r.data.case.history.length,3);assert.equal(f.store.get('feedback','fb').status,'open');
 assert.equal((await patch({revision:3,status:'dismissed',reason:'跳过重新打开'})).status,409);
 f.store.put('document',{...v2,status:'archived'});assert.equal((await f.request('GET','/api/workspace/cases/'+item.id)).data.case.verificationCurrent,false);
 assert.ok(f.store.events(100).some(e=>e.action==='workspace.case.updated'));
});
test('document-scoped search excludes other versions, conflict pairs and graph edges outside its document',async t=>{
 const f=await fixture(t);const structure=(doc,headers,rows)=>{f.store.replaceChunks(doc.id,[{id:doc.id+'-chunk',documentId:doc.id,ordinal:0,page:1,text:headers.join(' ')+'\n'+rows.map(r=>r.join(' ')).join('\n'),table:{schemaVersion:1,tableId:'t',format:'csv',name:doc.title,headers,rows,rowNumbers:[2],totalRows:1,rowStart:1,rowEnd:1,complete:true}}]);const result=extractRelations(f.store,f.admin,doc.id,{revision:1});for(const relation of result.relations)reviewRelation(f.store,f.admin,relation.id,{revision:relation.revision,action:'confirm',reason:'测试真实来源行核验'});};
 structure(f.doc,['设备编号','工单编号'],[['SCOPE-EQ-001','SCOPE-WO-001']]);structure(f.other,['工单编号','问题编号'],[['SCOPE-WO-001','SCOPE-ISSUE-001']]);
 const query='/api/search?'+new URLSearchParams({q:'SCOPE-EQ-001关联问题',documentId:'doc',documentVersion:'1'});
 const r=await f.request('GET',query);assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.results.length);assert.ok(r.data.results.every(c=>c.documentId==='doc'));assert.ok((r.data.graph.paths||[]).every(p=>p.edges.every(e=>e.documentId==='doc')));assert.ok(!JSON.stringify(r.data).includes('SCOPE-ISSUE-001'));
 const states=[f.doc,f.other].map(d=>({id:d.id,fingerprint:documentFingerprint(d,f.store.chunks(d.id))}));f.store.put('knowledgeIssue',{id:'pair',type:'conflict',status:'open',createdAt:new Date().toISOString(),baseIds:['base'],documentStates:states,evidenceRefs:[{documentId:'doc',blockId:'doc-chunk'},{documentId:'other',blockId:'other-chunk'}]});
 const conflicted=await f.request('GET',query);assert.equal(conflicted.status,200);assert.ok(conflicted.data.results.every(c=>c.documentId==='doc'));assert.equal(conflicted.data.evidence.sufficient,false);
 assert.equal((await f.request('GET',query.replace('documentVersion=1','documentVersion=2'))).status,409);assert.equal((await f.request('GET','/api/search?q=培训&documentId=hidden&documentVersion=1',undefined,'viewer')).status,404);
 const draft=f.addDoc('draft',{status:'review'});assert.equal((await f.request('GET','/api/search?q=培训&documentId='+draft.id)).status,409);
});
test('document scope persists in conversations and retries and constrains every allowed read-only tool',async t=>{
 const f=await fixture(t);const created=await f.request('POST','/api/chat/runs',{question:'完成培训任务需要哪些证据？',baseId:'base',documentId:'doc',documentVersion:1,task:'原文核验',entityId:'explicit-context',clientRequestId:'scope-one'});assert.equal(created.status,202,JSON.stringify(created.data));const run=await f.wait(created.data.run.id);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.ok(run.result.citations.every(c=>c.documentId==='doc'));
 const conversation=(await f.request('GET','/api/conversations/'+run.conversationId)).data.conversation;assert.equal(conversation.documentId,'doc');assert.equal(conversation.documentVersion,1);assert.equal(conversation.task,'原文核验');assert.equal(conversation.entityId,'explicit-context');
 assert.equal((await f.request('POST','/api/chat/runs',{question:'继续核验',conversationId:conversation.id,conversationRevision:conversation.revision,documentId:'other',documentVersion:1,clientRequestId:'switch'})).status,409);
 const inherited=await f.request('POST','/api/chat/runs',{question:'培训证据有哪些？',conversationId:conversation.id,conversationRevision:conversation.revision,clientRequestId:'follow'});assert.equal(inherited.status,202);assert.equal((await f.wait(inherited.data.run.id)).documentId,'doc');
 const scope={documentId:'doc',documentVersion:1,baseId:'base'};
 for(const [name,args] of [['query_table',{documentId:'other'}],['compare_clauses',{leftDocumentId:'doc',rightDocumentId:'other'}]])await assert.rejects(executeReadOnlyTool(f.store,f.admin,name,args,scope),{code:'TOOL_SCOPE_DENIED'});
 const found=await executeReadOnlyTool(f.store,f.admin,'search_knowledge',{query:'培训证据'},scope);assert.ok(found.citations.length&&found.citations.every(c=>c.documentId==='doc'));
 await assert.rejects(executeReadOnlyTool(f.store,f.admin,'create_report_draft',{title:'不允许越界草稿'},{...scope,previousResults:[{citations:[{documentId:'other',id:'other-chunk',version:1}]}]}),{code:'REPORT_EVIDENCE_REQUIRED'});
 const failed=await f.request('POST','/api/chat/runs',{question:'培训证据核验',...scope,clientRequestId:'scope-fail',plan:[{id:'outside',tool:'query_table',args:{documentId:'other'}}]});const bad=await f.wait(failed.data.run.id);assert.equal(bad.status,'failed');assert.equal(bad.errorCode,'TOOL_SCOPE_DENIED');
 f.store.put('document',{...f.doc,status:'archived'});assert.equal((await f.request('POST','/api/chat/runs/'+bad.id+'/retry',{revision:bad.revision,clientRequestId:'retry-archived'})).status,409);assert.equal((await f.request('GET','/api/chat/runs/'+run.id)).data.result.mode,'insufficient');
});

test('workspace run navigation respects conversation ownership and exposes only existing administrator traces',async t=>{
 const f=await fixture(t),createdAt=new Date().toISOString();
 f.store.put('conversation',{id:'viewer-conversation',userId:'viewer',baseId:'base',title:'个人会话',createdAt,updatedAt:createdAt,revision:1});
 f.store.put('trace',{id:'actual-trace',traceId:'actual-trace',runId:'viewer-navigation-run',status:'succeeded'});
 const foreign={id:'viewer-navigation-run',userId:'viewer',conversationId:'viewer-conversation',baseId:'base',documentId:'doc',documentVersion:1,status:'succeeded',traceId:'actual-trace',question:'我的知识问题',result:{mode:'extractive',citations:[{documentId:'doc',version:1,id:'doc-chunk'}]},createdAt};f.store.put('intelligenceRun',foreign);
 const owner=await f.request('GET','/api/workspace/summary',undefined,'viewer');assert.equal(owner.data.recentRuns.find(r=>r.id===foreign.id).route,'/application/chat?conversationId=viewer-conversation');
 const admin=await f.request('GET','/api/workspace/summary');assert.equal(admin.data.recentRuns.find(r=>r.id===foreign.id).route,'/settings/traces?trace=actual-trace');assert.equal((await f.request('GET','/api/conversations/viewer-conversation')).status,404);assert.equal((await f.request('GET','/api/chat/runs/'+foreign.id)).status,404);assert.equal((await f.request('GET','/api/observability/traces/actual-trace')).status,200);
 const created=await f.request('POST','/api/workspace/cases',{title:'管理人员核对运行',description:'核对已授权资料的运行追踪，保留个人会话权限',baseId:'base',kind:'clarification',documentId:'doc',documentVersion:1,runId:foreign.id});assert.equal(created.status,201);assert.equal(created.data.case.runRoute,'/settings/traces?trace=actual-trace');
 assert.equal((await f.request('GET','/api/workspace/cases/'+created.data.case.id,undefined,'editor')).status,404);
 f.store.del('trace','actual-trace');const unavailable=await f.request('GET','/api/workspace/summary');assert.equal(unavailable.data.usage.runs,1);assert.ok(!unavailable.data.recentRuns.some(r=>r.id===foreign.id));assert.equal((await f.request('GET','/api/workspace/cases/'+created.data.case.id)).data.case.runRoute,undefined);
});

test('tasks and original governance preserve selected base before pagination and align all counts',async t=>{
 const f=await fixture(t);const review=f.addDoc('review-local',{status:'review',notes:['本库格式说明']}),other=f.addDoc('review-secret',{status:'review',baseId:'secret',notes:['外库格式说明']});
 for(let i=0;i<310;i++)f.store.put('task',{id:'foreign-task-'+i,documentId:other.id,status:'queued',createdAt:'2026-09-08T01:00:00Z'});
 f.store.put('task',{id:'target-task',documentId:review.id,status:'queued',createdAt:'2020-01-01T00:00:00Z'});
 const tasks=await f.request('GET','/api/tasks?baseId=base');assert.equal(tasks.status,200);assert.deepEqual(tasks.data.tasks.map(t=>t.id),['target-task']);assert.equal(tasks.data.scope.baseId,'base');
 assert.equal((await f.request('GET','/api/tasks?baseId=secret',undefined,'viewer')).status,404);assert.ok((await f.request('GET','/api/tasks',undefined,'viewer')).data.tasks.every(t=>t.documentId!==other.id));
 f.store.put('feedback',{id:'local-fb',userId:'admin',documentId:review.id,status:'open'});f.store.put('feedback',{id:'foreign-fb',userId:'admin',documentId:other.id,status:'open'});
 const governance=await f.request('GET','/api/governance?baseId=base');assert.equal(governance.status,200);assert.equal(governance.data.scope.baseId,'base');assert.equal(governance.data.stats.pendingReview,1);assert.equal(governance.data.stats.unresolvedFeedback,1);assert.ok(governance.data.issues.every(i=>i.baseId==='base'));assert.deepEqual(governance.data.notes.map(n=>n.documentId),[review.id]);
 assert.equal((await f.request('GET','/api/governance?baseId=secret',undefined,'editor')).status,404);
});
