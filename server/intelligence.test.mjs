import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStore } from './database.mjs';
import { handleIntelligence,startIntelligence,stopIntelligence,queryTable,buildConversationContext,evidenceCurrent,tablePlanningContext,validatePlannedTableArguments } from './intelligence.mjs';
import { documentFingerprint as knowledgeFingerprint } from './knowledge-evidence.mjs';
import { invokeModel,documentFingerprint,search,answerQuestion } from './retrieval.mjs';
import { instrumentRequest,observationSummary,observeModelCall,recoverObservability } from './model-observability.mjs';

async function fixture(t){
  const dir=mkdtempSync(path.join(tmpdir(),'xrag-intelligence-')),store=createStore(dir);
  const user={id:'admin',name:'测试工作空间',role:'admin',active:true,localOnly:true},viewer={id:'viewer',role:'viewer',active:true,department:'other'};
  const base={id:'base',name:'测试知识库',visibility:'company',ownerId:user.id},doc={id:'doc',baseId:base.id,title:'培训证据要求',fileName:'training.md',version:1,revision:1,contentRevision:1,status:'published',ownerId:user.id};
  store.put('user',user);store.put('user',viewer);store.put('base',base);store.put('document',doc);store.put('setting',{id:'model',provider:'disabled',baseUrl:'https://api.example.invalid',model:'not-configured',embeddingBaseUrl:'disabled://tests',embeddingModel:'none'});
  store.replaceChunks(doc.id,[{id:'chunk1',documentId:doc.id,page:1,ordinal:1,text:'完成培训任务需要学习活动、任务表现和复核证据。签到不能代替实际任务表现。'}]);
  let currentId=user.id,beforeBody;
  const server=http.createServer((req,res)=>instrumentRequest(store,req,res,async()=>{try{const url=new URL(req.url,'http://localhost');const currentActor=()=>store.get('user',currentId);const send=(response,status,data)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(data));};
    const handled=await handleIntelligence({req,res,url,pathname:url.pathname,method:req.method,user:currentActor(),currentActor,store,send,bodyOf:async()=>{let text='';for await(const chunk of req)text+=chunk;await beforeBody?.();return JSON.parse(text||'{}');}});
    if(!handled)send(res,404,{error:{code:'NOT_FOUND'}});
  }catch(error){res.xragErrorCode=error.code;res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:error.code||'INTERNAL_ERROR',message:error.message}}));}}).catch(()=>res.destroy()));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));startIntelligence(store,{startWorker:false});const origin='http://127.0.0.1:'+server.address().port;
  const request=async(method,p,input)=>{const response=await fetch(origin+p,{method,headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined});return {status:response.status,data:await response.json()};};
  const wait=async runId=>{for(let i=0;i<200;i++){const run=store.get('intelligenceRun',runId);if(!['queued','running','cancel_requested'].includes(run.status))return run;await new Promise(r=>setTimeout(r,5));}throw Error('Run did not settle');};
  t.after(async()=>{await stopIntelligence(store);await new Promise(resolve=>server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});});
  return {store,user,viewer,base,doc,request,wait,origin,acting:id=>currentId=id,beforeRead:fn=>beforeBody=fn};
}
function addTable(f){
  const doc={...f.doc,id:'tableDoc',title:'设备费用台账',fileName:'设备.csv'};f.store.put('document',doc);
  const headers=['设备编号','线路','金额','日期'],rows=[['EQ-001','A','0.10','2026-09-01'],['EQ-002','A','0.20','2026-09-02'],['EQ-003','B','','2026-09-03']];
  for(let i=0;i<2;i++){}
  f.store.replaceChunks(doc.id,[{id:'table1',documentId:doc.id,page:1,ordinal:1,text:'设备费用台账',table:{schemaVersion:1,tableId:'table:1',name:'设备费用台账',headers,rows:rows.slice(0,2),rowNumbers:[2,3],rowStart:1,rowEnd:2,totalRows:3}},{id:'table2',documentId:doc.id,page:1,ordinal:2,text:'设备费用台账',table:{schemaVersion:1,tableId:'table:1',name:'设备费用台账',headers,rows:rows.slice(2),rowNumbers:[4],rowStart:3,rowEnd:3,totalRows:3}}]);return doc;
}
async function modelServer(t,f,respond){
  const requests=[];const server=http.createServer(async(req,res)=>{let data='';for await(const c of req)data+=c;const body=JSON.parse(data);requests.push(body);await respond(body,res,requests.length);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));f.store.put('setting',{id:'model',provider:'ollama',baseUrl:'http://127.0.0.1:'+server.address().port,model:'mock-local',embeddingBaseUrl:'disabled://tests',embeddingModel:'none'});
  t.after(()=>new Promise(resolve=>server.close(resolve)));return requests;
}
function stream(res,payload,{usage=true,complete=true}={}){
  res.writeHead(200,{'Content-Type':'text/event-stream'});const text=JSON.stringify(payload);
  for(let i=0;i<text.length;i+=17)res.write('data: '+JSON.stringify({choices:[{delta:{content:text.slice(i,i+17)}}]})+'\n\n');
  if(usage)res.write('data: '+JSON.stringify({choices:[],usage:{prompt_tokens:70,completion_tokens:30,total_tokens:100}})+'\n\n');
  if(complete)res.write('data: [DONE]\n\n');res.end();
}
const question='完成培训任务需要哪些证据？',valid={answer:'完成培训任务需要学习活动、任务表现和复核证据。[1]',citations:[1],insufficient:false};

test('deterministic table tools use all source rows, exact decimals, missing values and typed filters',async t=>{
  const f=await fixture(t),doc=addTable(f);
  const sum=queryTable(f.store,f.user,{documentId:doc.id,filters:[{column:'线路',op:'eq',value:'A'}],aggregations:[{op:'sum',column:'金额',as:'sum'},{op:'avg',column:'金额',as:'average'},{op:'count',as:'count'}]});
  assert.deepEqual(sum.result,[{sum:0.3,average:0.15,count:2}]);assert.deepEqual(sum.sourceRows,[2,3]);assert.equal(sum.coverage.sourceComplete,true);
  const missing=queryTable(f.store,f.user,{documentId:doc.id,aggregations:[{op:'avg',column:'金额'}]});assert.equal(missing.missing.avg_金额,1);assert.equal(missing.result[0].avg_金额,0.15);
  const filtered=queryTable(f.store,f.user,{documentId:doc.id,filters:[{column:'日期',op:'between',value:['2026-09-02','2026-09-03']}],select:['设备编号'],sort:[{column:'设备编号',direction:'desc'}]});assert.deepEqual(filtered.result.map(r=>r.设备编号),['EQ-003','EQ-002']);
  assert.throws(()=>queryTable(f.store,f.user,{documentId:doc.id,filters:[{column:'missing',op:'eq',value:1}]}),{code:'TABLE_COLUMN_UNKNOWN'});
  const chunks=f.store.chunks(doc.id);chunks[0].table.reviewRequired=true;f.store.replaceChunks(doc.id,chunks);assert.throws(()=>queryTable(f.store,f.user,{documentId:doc.id}),{code:'TABLE_REVIEW_REQUIRED'});
  chunks[0].reviewState='confirmed';f.store.replaceChunks(doc.id,chunks);assert.equal(queryTable(f.store,f.user,{documentId:doc.id}).result.length,3);
  f.store.replaceChunks(doc.id,[chunks[0]]);assert.throws(()=>queryTable(f.store,f.user,{documentId:doc.id}),{code:'TABLE_INCOMPLETE'});
});

test('runs persist idempotency, exactly one answer pair and real sequential tool results',async t=>{
  const f=await fixture(t),doc=addTable(f),input={question:'统计设备费用并整理草稿',baseId:f.base.id,clientRequestId:'same-request',plan:[{id:'sum',tool:'query_table',args:{documentId:doc.id,filters:[{column:'线路',op:'eq',value:'A'}],aggregations:[{op:'sum',column:'金额',as:'总额'}]}},{id:'draft',tool:'create_report_draft',dependsOn:['sum'],args:{title:'费用核对草稿'}}]};
  const created=await f.request('POST','/api/chat/runs',input);assert.equal(created.status,202);const run=await f.wait(created.data.run.id);assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.result.mode,'tool');assert.equal(run.toolResults[0].result[0].总额,0.3);assert.equal(f.store.list('reportDraft').length,1);
  const repeated=await f.request('POST','/api/chat/runs',input);assert.equal(repeated.data.run.id,run.id);assert.equal(f.store.list('message').length,2);
  assert.equal((await f.request('POST','/api/chat/runs',{...input,question:'changed'})).status,409);
  const events=await fetch(f.origin+'/api/chat/runs/'+run.id+'/events?after=0');const body=await events.text();assert.match(body,/answer.final/);assert.match(body,/step.completed/);
  f.store.put('document',{...doc,status:'archived',revision:2});
  const replay=await(await fetch(f.origin+'/api/chat/runs/'+run.id+'/events?after=0')).text();assert.match(replay,/evidence.withdrawn/);assert.doesNotMatch(replay,/"总额":0.3/);
  const view=await f.request('GET','/api/chat/runs/'+run.id);assert.equal(view.data.result.mode,'insufficient');assert.equal(view.data.steps.find(s=>s.name==='tool.query_table').result.status,'withdrawn');
});

test('new runs reject concurrent conversation submissions while legacy JSON remains sequential',async t=>{
  const f=await fixture(t);await modelServer(t,f,async(body,res)=>{await new Promise(r=>setTimeout(r,70));stream(res,valid);});
  f.store.put('conversation',{id:'conv',userId:f.user.id,baseId:f.base.id,title:'history',revision:0,messageSequence:0});
  const first=await f.request('POST','/api/chat/runs',{question,baseId:f.base.id,conversationId:'conv',conversationRevision:0,clientRequestId:'one'});
  const revision=f.store.get('conversation','conv').revision;
  const second=await f.request('POST','/api/chat/runs',{question,baseId:f.base.id,conversationId:'conv',conversationRevision:revision,clientRequestId:'two'});assert.equal(second.status,409);assert.equal(second.data.error.code,'CONVERSATION_BUSY');
  assert.equal((await f.wait(first.data.run.id)).status,'succeeded');
  const responses=await Promise.all([f.request('POST','/api/chat',{question,conversationId:'conv'}),f.request('POST','/api/chat',{question,conversationId:'conv'})]);assert.ok(responses.every(r=>r.status===200),JSON.stringify(responses));
  const messages=f.store.list('message').sort((a,b)=>a.sequence-b.sequence);assert.deepEqual(messages.map(m=>m.sequence),[1,2,3,4,5,6]);for(let i=0;i<6;i+=2)assert.equal(messages[i].turnId,messages[i+1].turnId);
});

test('real provider SSE is consumed, validated once, metered without raw content and safely replayed',async t=>{
  const f=await fixture(t),requests=await modelServer(t,f,(body,res)=>stream(res,valid));
  const response=await f.request('POST','/api/chat',{question,baseId:f.base.id,clientRequestId:'stream-request'});assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.data.mode,'model');assert.equal(requests[0].stream,true);assert.equal(requests.length,1);
  const calls=f.store.list('modelCall');assert.equal(calls.length,1);assert.equal(calls[0].streamed,true);assert.equal(calls[0].usageStatus,'known');assert.equal(calls[0].inputTokens,70);assert.equal(calls[0].outputTokens,30);
  const serialized=JSON.stringify([...calls,...f.store.list('trace'),...f.store.list('traceSpan')]);assert.ok(!serialized.includes(question));assert.ok(!serialized.includes('学习活动、任务表现'));assert.ok(!serialized.includes('Authorization'));
  const summary=observationSummary(f.store);assert.equal(summary.modelUsage.knownCalls,1);assert.equal(summary.modelUsage.inputTokens,70);
  const invalid=await f.request('POST','/api/chat/runs',{question:''});assert.equal(invalid.status,400);assert.ok(f.store.list('trace').some(r=>r.httpStatus===400&&r.status==='failed'));
});

test('multi-turn follow-ups use completed current context and omit withdrawn source history',async t=>{
  const f=await fixture(t),requests=await modelServer(t,f,(body,res)=>{if(body.messages[0].content.includes('将追问')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({question:'EQ-001 完成培训需要哪些证据？',needsClarification:false})}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));}else stream(res,valid);});
  f.store.put('conversation',{id:'conv',userId:f.user.id,baseId:f.base.id,revision:0,messageSequence:2});
  const source={documentId:f.doc.id,version:1,sourceFingerprint:documentFingerprint(f.doc)};
  f.store.put('message',{id:'old-user',conversationId:'conv',role:'user',sequence:1,content:'设备 EQ-001 的培训任务'});
  f.store.put('message',{id:'old-answer',conversationId:'conv',role:'assistant',sequence:2,turnId:'old-turn',question:'设备 EQ-001 的培训任务',content:'历史主题，不能作为新事实',citations:[source]});
  const context=buildConversationContext(f.store,f.user,'conv',{baseId:f.base.id,question:'只看本月需要哪些证据？'});assert.equal(context.objectIds[0],'EQ-001');assert.equal(context.turns.length,1);
  f.store.put('document',{...f.doc,revision:2});assert.equal(buildConversationContext(f.store,f.user,'conv',{baseId:f.base.id,question:'只看本月需要哪些证据？'}).turns.length,0);assert.equal(evidenceCurrent(f.store,f.user,[source]),false);
  f.store.put('document',f.doc);f.store.replaceChunks(f.doc.id,[{id:'chunk1',documentId:f.doc.id,page:1,ordinal:1,text:'EQ-001 完成培训任务需要学习活动、任务表现和复核证据。'}]);
  const answer=await f.request('POST','/api/chat',{question:'只看本月需要哪些证据？',conversationId:'conv'});assert.equal(answer.status,200,JSON.stringify(answer));assert.equal(requests.length,2);assert.ok(requests[0].messages[1].content.includes('EQ-001'));assert.ok(JSON.parse(requests[1].messages[1].content).conversationContext.turns.length===1);
});

test('ambiguous objects wait for inputs and input retries are persistent and idempotent',async t=>{
  const f=await fixture(t);f.store.put('conversation',{id:'conv',userId:f.user.id,baseId:f.base.id,revision:0,messageSequence:2});
  f.store.put('message',{id:'old',conversationId:'conv',role:'assistant',sequence:2,turnId:'old',question:'EQ-001 与 EQ-002 的资料',content:'两个对象',citations:[]});
  const created=await f.request('POST','/api/chat/runs',{question:'只看培训需要哪些证据？',conversationId:'conv',conversationRevision:0,clientRequestId:'wait'});
  const waiting=await f.wait(created.data.run.id);assert.equal(waiting.status,'waiting_input');assert.deepEqual(waiting.waitingFor.fields[0].options,['EQ-001','EQ-002']);assert.equal(f.store.list('message').length,1);
  const input={revision:waiting.revision,inputRequestId:'selection',inputs:{objectId:'EQ-001'}};
  const resumed=await f.request('POST','/api/chat/runs/'+waiting.id+'/inputs',input);assert.equal(resumed.status,202);const finished=await f.wait(waiting.id);assert.equal(finished.status,'succeeded');assert.equal(finished.attempt,2);
  const repeat=await f.request('POST','/api/chat/runs/'+waiting.id+'/inputs',input);assert.equal(repeat.status,200);assert.equal(f.store.list('message').length,3);
});

test('cancellation prevents final message commits and permission is checked after body parsing',async t=>{
  const f=await fixture(t);await modelServer(t,f,async(body,res)=>{await new Promise(r=>setTimeout(r,200));if(!res.destroyed)stream(res,valid);});
  const started=await f.request('POST','/api/chat/runs',{question,clientRequestId:'cancel'});
  await new Promise(r=>setTimeout(r,30));const cancelled=await f.request('POST','/api/chat/runs/'+started.data.run.id+'/cancel',{});assert.equal(cancelled.status,200);const run=await f.wait(started.data.run.id);assert.equal(run.status,'cancelled');assert.equal(f.store.list('message').length,0);
  f.beforeRead(()=>f.store.put('user',{...f.user,active:false}));const rejected=await f.request('POST','/api/chat/runs',{question,clientRequestId:'revoked'});assert.equal(rejected.status,401);assert.equal(f.store.list('intelligenceRun').length,1);
});

test('model ledger failures prevent sending and interrupted usage remains explicitly unknown',async t=>{
  const f=await fixture(t);let sent=0;const refusing={...f.store,put(kind,row){if(kind==='modelCall')throw Error('disk unavailable');return f.store.put(kind,row);}};
  await assert.rejects(()=>observeModelCall(refusing,{feature:'test',provider:'local',model:'mock'},async()=>{sent++;return {usage:{prompt_tokens:1,completion_tokens:1}};}),{code:'METERING_UNAVAILABLE'});assert.equal(sent,0);
  await observeModelCall(f.store,{feature:'test',provider:'local',model:'mock'},async()=>({choices:[]}));let row=f.store.list('modelCall')[0];assert.equal(row.usageStatus,'unknown');assert.equal(row.inputTokens,null);
  f.store.put('modelCall',{id:'interrupted-call',status:'running',startedAt:new Date().toISOString(),usageStatus:'unknown',inputTokens:null,outputTokens:null,feature:'test'});recoverObservability(f.store);assert.equal(f.store.get('modelCall','interrupted-call').status,'interrupted');assert.equal(observationSummary(f.store).modelUsage.unknownCalls,2);
});

test('business template versions cannot publish before real positive and refusal evaluation',async t=>{
  const f=await fixture(t);await modelServer(t,f,(body,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));});
  const definition={name:'培训整理',scenario:'training',goal:'整理培训依据',inputSchema:{type:'object',properties:{},required:[]},outputSchema:{type:'object',properties:{}},allowedTools:['search_knowledge'],evaluationCases:[{question,baseId:f.base.id,expectedTerms:['学习活动','任务表现','复核证据'],expectedDocumentId:f.doc.id},{question:'木星大气风暴温度是多少？',baseId:f.base.id,mustRefuse:true}]};
  const created=await f.request('POST','/api/scenarios',definition);assert.equal(created.status,201);const version=created.data.version;
  assert.equal((await f.request('POST','/api/scenario-versions/'+version.id+'/publish',{})).status,409);
  const evaluation=await f.request('POST','/api/scenario-versions/'+version.id+'/evaluate',{});assert.equal(evaluation.status,202);
  for(let i=0;i<100&&f.store.get('promptEvaluation',evaluation.data.evaluation.id).status==='running';i++)await new Promise(r=>setTimeout(r,5));
  const result=f.store.get('promptEvaluation',evaluation.data.evaluation.id);assert.equal(result.passed,2,JSON.stringify(result));assert.equal((await f.request('POST','/api/scenario-versions/'+version.id+'/publish',{})).status,200);
  const next=await f.request('POST','/api/scenarios/'+created.data.scenario.id+'/versions',{...definition,goal:'新目标'});assert.equal(next.data.version.version,2);assert.equal(f.store.get('promptVersion',version.id).goal,'整理培训依据');assert.equal((await f.request('POST','/api/scenario-versions/'+next.data.version.id+'/publish',{})).status,409);
  f.acting(f.viewer.id);assert.equal((await f.request('GET','/api/observability')).status,403);assert.equal((await f.request('POST','/api/scenarios',definition)).status,403);
});

test('feature ledgers stay disjoint and unavailable stream usage never becomes a zero estimate',async t=>{
  const f=await fixture(t);
  await observeModelCall(f.store,{feature:'chat',provider:'ollama',model:'mock'},async()=>({usage:{prompt_tokens:7,completion_tokens:3}}));
  await observeModelCall(f.store,{feature:'prompt_evaluation',provider:'ollama',model:'mock'},async()=>({usage:{prompt_tokens:11,completion_tokens:5}}));
  await observeModelCall(f.store,{feature:'document_embedding',provider:'local',model:'mock'},async()=>[]);
  const summary=observationSummary(f.store);assert.equal(summary.modelUsage.calls,3);
  assert.deepEqual(summary.modelUsage.byFeature.map(f=>[f.feature,f.calls,f.inputTokens,f.outputTokens]).sort(),[['chat',1,7,3],['document_embedding',1,0,0],['prompt_evaluation',1,11,5]]);
  assert.equal(f.store.list('modelCall').find(c=>c.feature==='document_embedding').billingApplicable,false);
  await modelServer(t,f,(body,res)=>stream(res,valid,{complete:false,usage:false}));
  await assert.rejects(()=>invokeModel(f.store,{stream:true,messages:[{role:'user',content:'local test'}]},{feature:'stream_test'}),{code:'MODEL_STREAM_INTERRUPTED'});
  const interrupted=f.store.list('modelCall').find(c=>c.feature==='stream_test');assert.equal(interrupted.status,'failed');assert.equal(interrupted.usageStatus,'unknown');assert.equal(interrupted.inputTokens,null);
});

test('process restart recovers committed answers without model replay and leaves unfinished runs explicit',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'xrag-recovery-'));let store=createStore(directory);
  t.after(async()=>{await stopIntelligence(store);store.close();assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));rmSync(directory,{recursive:true,force:true});});
  const user={id:'admin',active:true,role:'admin'};store.put('user',user);
  for(const id of ['done','unfinished','cancel']){store.put('conversation',{id:'conv-'+id,userId:user.id,activeRunId:id,revision:1});store.put('intelligenceRun',{id,conversationId:'conv-'+id,userId:user.id,status:id==='cancel'?'cancel_requested':'running',attempt:1,revision:1,eventSequence:0,createdAt:new Date().toISOString()});}
  store.put('message',{id:'answer_done',runId:'done',conversationId:'conv-done',role:'assistant',answer:'已提交的本地结果',citations:[]});
  store.put('promptEvaluation',{id:'eval',versionId:'version',status:'running'});store.put('promptVersion',{id:'version',status:'evaluating'});
  store.close();store=createStore(directory);startIntelligence(store,{startWorker:false});
  assert.equal(store.get('intelligenceRun','done').status,'succeeded');assert.equal(store.get('intelligenceRun','done').recoveredCommit,true);assert.equal(store.get('intelligenceRun','unfinished').status,'interrupted');assert.equal(store.get('intelligenceRun','cancel').status,'cancelled');assert.equal(store.list('message').length,1);
  assert.equal(store.list('modelCall').length,0);assert.equal(store.get('conversation','conv-done').activeRunId,null);assert.equal(store.get('promptVersion','version').status,'draft');assert.equal(store.get('promptEvaluation','eval').status,'interrupted');
});

test('retry reuses a completed immutable table checkpoint but recalculates after a source revision',async t=>{
  const f=await fixture(t),doc=addTable(f),created=await f.request('POST','/api/chat/runs',{question:'统计设备费用',clientRequestId:'checkpoint',plan:[{id:'sum',tool:'query_table',args:{documentId:doc.id,aggregations:[{op:'sum',column:'金额',as:'total'}]}},{id:'invalid',tool:'query_table',args:{documentId:doc.id,select:['不存在的列']}}]});
  let run=await f.wait(created.data.run.id);assert.equal(run.status,'partial');assert.equal(f.store.list('message').length,0);
  let retry=await f.request('POST','/api/chat/runs/'+run.id+'/retry',{revision:run.revision,clientRequestId:'retry1'});assert.equal(retry.status,202);run=await f.wait(run.id);
  assert.ok(f.store.list('runStep').find(s=>s.runId===run.id&&s.stepId==='sum'&&s.attempt===2).reusedFrom);
  f.store.put('document',{...doc,revision:doc.revision+1});retry=await f.request('POST','/api/chat/runs/'+run.id+'/retry',{revision:run.revision,clientRequestId:'retry2'});assert.equal(retry.status,202);run=await f.wait(run.id);
  assert.equal(f.store.list('runStep').find(s=>s.runId===run.id&&s.stepId==='sum'&&s.attempt===3).reusedFrom,undefined);
});

test('sampled media and unresolved conflicts cannot turn into complete or authoritative answers',async t=>{
  const f=await fixture(t);f.store.put('document',{...f.doc,fileName:'培训视频.mp4',title:'培训视频证据要求',parseCoverage:'partial',visualCoverage:'sampled'});
  let result=await search(f.store,f.user,'完整培训视频需要哪些证据？',{semantic:false});assert.equal(result.evidence.sufficient,false);assert.equal(result.coverage.kind,'media');
  let answer=await answerQuestion(f.store,f.user,'完整培训视频需要哪些证据？',{semantic:false});assert.equal(answer.mode,'insufficient');assert.match(answer.answer,/媒体证据不完整/);
  f.store.put('document',{...f.doc,fileName:'培训视频.mp4',title:'培训视频证据要求',parseCoverage:'complete',visualCoverage:'sampled'});
  result=await search(f.store,f.user,'培训需要哪些证据？',{semantic:false});assert.ok(result.results.length);assert.match(result.warning,/抽样/);
  f.store.put('document',f.doc);const second={...f.doc,id:'second',title:'培训证据其他要求'};f.store.put('document',second);f.store.replaceChunks(second.id,[{id:'second1',documentId:second.id,page:1,ordinal:1,text:'完成培训任务仅记录学习活动。'}]);
  const docs=[f.doc,second],issue={id:'conflict',type:'conflict',status:'open',documentStates:docs.map(d=>({id:d.id,fingerprint:knowledgeFingerprint(d,f.store.chunks(d.id))})),evidenceRefs:docs.map(d=>({documentId:d.id,blockId:f.store.chunks(d.id)[0].id,text:f.store.chunks(d.id)[0].text})),baseIds:[f.base.id],createdAt:new Date().toISOString()};f.store.put('knowledgeIssue',issue);
  result=await search(f.store,f.user,question,{semantic:false});assert.equal(result.evidence.sufficient,false);assert.equal(new Set(result.results.map(r=>r.documentId)).size,2);
  answer=await answerQuestion(f.store,f.user,question,{semantic:false});assert.equal(answer.mode,'extractive');assert.match(answer.warning,/不能合并/);assert.ok(answer.conflicts.length);
  f.store.put('document',{...second,revision:2,contentRevision:2});result=await search(f.store,f.user,question,{semantic:false});assert.equal(result.conflicts,undefined);
});

test('confirmed equivalent sources share candidate quota and review-required tables fail complete evidence checks',async t=>{
  const f=await fixture(t),other={...f.doc,id:'equivalent'};f.store.put('document',other);f.store.replaceChunks(other.id,[{id:'eqchunk',documentId:other.id,page:1,ordinal:1,text:f.store.chunks(f.doc.id)[0].text}]);
  f.store.put('knowledgeIssue',{id:'equivalent-group',type:'near_duplicate',status:'resolved',decision:'equivalent',documentStates:[f.doc,other].map(d=>({id:d.id,fingerprint:knowledgeFingerprint(d,f.store.chunks(d.id))})),evidenceRefs:[],baseIds:[f.base.id],createdAt:new Date().toISOString()});
  const result=await search(f.store,f.user,question,{semantic:false});assert.equal(new Set(result.results.map(r=>r.documentId)).size,1);
  const doc=addTable(f),chunks=f.store.chunks(doc.id);chunks[0].table.reviewRequired=true;f.store.replaceChunks(doc.id,chunks);
  const table=await search(f.store,f.user,'统计设备费用台账全部记录',{semantic:false});assert.equal(table.coverage.complete,false);assert.equal(table.evidence.sufficient,false);
});

test('business output schema is checked and provider reasoning is excluded from persisted planning results',async t=>{
  const f=await fixture(t),requests=await modelServer(t,f,(body,res,n)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({...valid,structuredOutput:{count:n===1?'3':3}}),reasoning_content:'PRIVATE_REASONING_SHOULD_NOT_PERSIST',provider_internal:{secret:'INTERNAL_METADATA'}}}],usage:{prompt_tokens:8,completion_tokens:6,total_tokens:14}}));});
  const result=await answerQuestion(f.store,f.user,question,{template:{goal:'按要求整理',outputSchema:{type:'object',properties:{count:{type:'integer'}},required:['count']}}});
  assert.equal(result.mode,'model');assert.equal(result.validationAttempts,2);assert.deepEqual(result.structuredOutput,{count:3});assert.equal(requests.length,2);
  const projected=await invokeModel(f.store,{messages:[{role:'user',content:'local projection test'}]},{feature:'tool_planning'});assert.equal(projected.choices[0].message.reasoning_content,undefined);assert.ok(!JSON.stringify(projected).includes('PRIVATE_REASONING'));assert.ok(!JSON.stringify(f.store.list('modelCall')).includes('INTERNAL_METADATA'));
});

test('shutdown cancels active template evaluation without post-close writes or successful status',async t=>{
  const f=await fixture(t);let started=false;await modelServer(t,f,async(body,res)=>{started=true;await new Promise(r=>setTimeout(r,160));if(!res.destroyed)stream(res,valid);});
  const created=await f.request('POST','/api/scenarios',{name:'停止测试',goal:'检查引用',evaluationCases:[{question,expectedTerms:['任务表现']},{question:'不存在的木星轨道指标',mustRefuse:true}]});
  const evaluation=await f.request('POST','/api/scenario-versions/'+created.data.version.id+'/evaluate',{});
  for(let i=0;i<50&&!started;i++)await new Promise(r=>setTimeout(r,5));assert.ok(started);await stopIntelligence(f.store);
  assert.equal(f.store.get('promptEvaluation',evaluation.data.evaluation.id).status,'interrupted');assert.equal(f.store.get('promptVersion',created.data.version.id).status,'draft');assert.equal(f.store.list('modelCall')[0].status,'cancelled');
});

function planningFixture(f){
  const doc={...f.doc,id:'planning-table',title:'示例城轨设备台账（2026年9月合成示例）',fileName:'设备台账.csv'};
  const headers=['设备编码','线路','台账状态','数据性质'],rows=Array.from({length:15},(_,i)=>['EQ-'+String(i+1).padStart(3,'0'),i<5?'A线':'B线','在用','合成示例']);
  f.store.put('document',doc);const chunks=[0,1,2].map(n=>({id:'planning-'+n,documentId:doc.id,page:1,ordinal:n,text:headers.join('\t')+'\n'+rows.slice(n*5,n*5+5).map(r=>r.join('\t')).join('\n'),table:{schemaVersion:1,tableId:'table:1',name:doc.title,headers,rows:rows.slice(n*5,n*5+5),rowNumbers:Array.from({length:5},(_,i)=>n*5+i+2),rowStart:n*5+1,rowEnd:n*5+5,totalRows:15,format:'csv',complete:false}}));
  f.store.replaceChunks(doc.id,chunks);return {doc,chunks};
}
test('published document metadata never becomes a row filter and record counts run on all fifteen rows',async t=>{
  const f=await fixture(t),{doc,chunks}=planningFixture(f),q='请调用表格计算工具，统计已发布的《'+doc.title+'》共有多少条完整设备记录，说明数据来源与覆盖范围。';
  const requests=await modelServer(t,f,(body,res)=>{if(body.tools){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'bad-plan',type:'function',function:{name:'query_table',arguments:JSON.stringify({documentId:doc.id,filters:[{column:'台账状态',op:'eq',value:'已发布'}],aggregations:[]})}}]}}]}));}else stream(res,{answer:'该设备台账共有15条来源记录，计算覆盖完整表格快照。[1]',citations:[1],insufficient:false});});
  const response=await f.request('POST','/api/chat',{question:q,baseId:f.base.id});
  assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.data.mode,'model',JSON.stringify({response:response.data,requests:requests.map(r=>({tools:!!r.tools,user:r.messages?.[1]?.content}))}));assert.equal(response.data.toolResults[0].result[0].记录总数,15);assert.equal(response.data.toolResults[0].matchedRows,15);assert.deepEqual(response.data.toolResults[0].calculation.filters,[]);
  assert.equal(requests.some(r=>r.tools),false,'simple total count does not delegate source/row intent separation to the model');
  assert.equal(response.data.citations[0].id,chunks[0].id);assert.equal(response.data.citations[0].kind,'tool_result');assert.match(response.data.citations[0].text,/受控程序执行结果/);assert.ok(response.data.citations[0].sourceChunkIds.every(id=>chunks.some(c=>c.id===id)));
  const detail=await f.request('GET','/api/chat/runs/'+response.data.runId);
  assert.deepEqual(detail.data.steps.map(s=>s.name),['context.prepare','knowledge.search','tools.plan','tool.query_table','answer.generate']);
  assert.deepEqual(detail.data.steps.map(s=>s.ordinal),[1,2,3,4,5]);
  for(const step of f.store.list('runStep'))f.store.put('runStep',{...step,startedAt:'2026-09-08T00:00:00.000Z'});
  const sameTime=await f.request('GET','/api/chat/runs/'+response.data.runId);assert.deepEqual(sameTime.data.steps.map(s=>s.ordinal),[1,2,3,4,5]);
});
test('model filters must come from actual user row conditions and count must be an actual aggregation',async t=>{
  const f=await fixture(t),{doc,chunks}=planningFixture(f),tables=tablePlanningContext(f.store,f.user,chunks.map(c=>({...c,documentId:doc.id}))),q='统计已发布的《'+doc.title+'》共有多少条记录？';
  assert.equal(tables[0].document.status,'published');assert.deepEqual(tables[0].columns.find(c=>c.name==='台账状态').values,['在用']);assert.equal(tables[0].table.totalRows,15);
  assert.throws(()=>validatePlannedTableArguments(f.store,f.user,{documentId:doc.id,filters:[{column:'台账状态',op:'eq',value:'已发布'}],aggregations:[]},{question:q,tables}),{code:'PLAN_UNREQUESTED_FILTER'});
  assert.throws(()=>validatePlannedTableArguments(f.store,f.user,{documentId:doc.id,filters:[],aggregations:[]},{question:q,tables}),{code:'PLAN_COUNT_REQUIRED'});
  assert.throws(()=>validatePlannedTableArguments(f.store,f.user,{documentId:doc.id,filters:[],aggregations:[{op:'count',column:'台账状态'}]},{question:q,tables}),{code:'PLAN_UNREQUESTED_FILTER'});
  const args={documentId:doc.id,filters:[{column:'线路',op:'eq',value:'A线'}],aggregations:[{op:'count',as:'记录数'}]};
  validatePlannedTableArguments(f.store,f.user,args,{question:'只统计线路为A线的记录共有多少条？',tables});assert.equal(queryTable(f.store,f.user,args).result[0].记录数,5);
  const zero={documentId:doc.id,filters:[{column:'台账状态',op:'eq',value:'已发布'}],aggregations:[{op:'count',as:'记录数'}]};
  validatePlannedTableArguments(f.store,f.user,zero,{question:'只统计台账状态为已发布的记录，共有多少条？',tables});assert.equal(queryTable(f.store,f.user,zero).result[0].记录数,0,'an explicitly requested empty row condition remains an honest zero');
});
test('unrequested model conditions wait for clarification before any misleading empty result is executed',async t=>{
  const f=await fixture(t),{doc}=planningFixture(f),requests=await modelServer(t,f,(body,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{tool_calls:[{id:'bad-plan',type:'function',function:{name:'query_table',arguments:JSON.stringify({documentId:doc.id,filters:[{column:'台账状态',op:'eq',value:'已发布'}],aggregations:[{op:'count',as:'记录数'}]})}}]}}],usage:{prompt_tokens:30,completion_tokens:20,total_tokens:50}}));});
  const created=await f.request('POST','/api/chat/runs',{question:'请统计已发布的《'+doc.title+'》中，仅线路为A线的记录共有多少条？',baseId:f.base.id,clientRequestId:'invalid-plan'});
  const run=await f.wait(created.data.run.id);assert.equal(run.status,'waiting_input',JSON.stringify(run));assert.match(run.waitingFor.message,/未.*指定|没有指定/);
  assert.equal(f.store.list('message').length,0);assert.equal(f.store.list('runStep').filter(s=>s.name==='tool.query_table').length,0);assert.equal(requests.length,1);
  const descriptor=JSON.parse(requests[0].messages[1].content).tables[0];assert.equal(descriptor.document.status,'published');assert.ok(descriptor.columns.find(c=>c.name==='线路').values.includes('A线'));
});
