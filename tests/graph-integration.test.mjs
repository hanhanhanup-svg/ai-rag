import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createApp} from '../server/api.mjs';
import {sessionHash} from '../server/security.mjs';
import {createTable,chunkTable} from '../server/table-parser.mjs';
import {PARSER_LIMITS} from '../server/parser.mjs';
import {extractRelations,reviewRelation,retrieveGraph} from '../server/knowledge-graph.mjs';
import {search,answerQuestion,graphPathsForEvidence,validateAnswerGraphReferences} from '../server/retrieval.mjs';
import {buildConversationContext,evidenceBundleCurrent,executeReadOnlyTool} from '../server/intelligence.mjs';

const question='DEV-101关联的工单、问题和规程是什么？';
async function fixture(t,{confirm=true}={}){
  const saved={...process.env},dir=mkdtempSync(path.join(os.tmpdir(),'xrag-graph-integration-'));
  for(const key of ['ADMIN_USERNAME','ADMIN_PASSWORD','DEEPSEEK_API_KEY','OPENAI_API_KEY','AI_API_KEY','EMBEDDING_API_KEY'])delete process.env[key];
  process.env.AUTH_MODE='password';process.env.API_HOST='127.0.0.1';process.env.LOCAL_EMBEDDINGS_ENABLED='false';process.env.ALLOWED_ORIGINS='http://localhost:5173';
  const app=await createApp({dataDir:dir,startWorker:false}),store=app.store;
  store.put('setting',{id:'model',provider:'disabled',embeddingBaseUrl:'',embeddingModel:''});
  const admin={id:'admin',name:'图检索隔离管理员',role:'admin',active:true},viewer={id:'viewer',name:'图检索隔离读者',role:'viewer',active:true},base={id:'base',name:'图检索试验库',visibility:'company',ownerId:admin.id};
  const cookies={};for(const user of [admin,viewer]){store.put('user',user);const token=crypto.randomBytes(20).toString('hex');cookies[user.id]='xrag_session='+token;store.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sessionHash(token),user.id,Date.now()+600000);}
  store.put('base',base);
  const rows=[
    [['设备编号','工单编号','摘要'],['DEV-101','WO-201','隔离设备工单']],
    [['工单编号','问题编号','问题摘要'],['WO-201','ISSUE-301','核验资料尚需补齐']],
    [['问题编号','规程编号','规程要求'],['ISSUE-301','PROC-401','先核对原始记录再完成资料复核，不推定实际设备故障']]
  ],docs=[];
  for(const [i,data]of rows.entries()){
    const id='source'+i,bytes=Buffer.from(data.map(row=>row.join(',')).join('\n')),doc={id,familyId:id,baseId:base.id,ownerId:admin.id,title:['设备工单记录','问题关联登记','核验规程资料'][i],fileName:id+'.csv',storageName:id+'.csv',mimeType:'text/csv',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),status:'published',version:1,revision:1,contentRevision:1,pageCount:1,chunkCount:1,sourceKind:'synthetic',applicability:'仅隔离试验，不代表真实业务记录',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const table=createTable(data,{tableId:'table'+i,name:doc.title,format:'csv'},PARSER_LIMITS);
    writeFileSync(path.join(dir,'uploads',doc.storageName),bytes);store.put('document',doc);store.replaceChunks(id,chunkTable(table,1,PARSER_LIMITS).map((chunk,n)=>({...chunk,id:id+'_chunk'+n,documentId:id})));docs.push(doc);
    const extracted=extractRelations(store,admin,id,{revision:1});
    if(confirm)for(const relation of extracted.relations)reviewRelation(store,admin,relation.id,{revision:relation.revision,action:'confirm',reason:'对照隔离表格编号、关系及来源行'});
  }
  const server=http.createServer(app.handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const request=async(method,route,body,user=admin)=>{const response=await fetch(origin+route,{method,headers:{cookie:cookies[user.id],origin:'http://localhost:5173','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();return {status:response.status,data:response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):null,text};};
  const wait=async id=>{for(let i=0;i<300;i++){const run=store.get('intelligenceRun',id);if(!['queued','running','cancel_requested'].includes(run.status))return run;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('Isolated graph run did not finish');};
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dir,{recursive:true,force:true});});
  return {app,store,admin,viewer,base,docs,request,wait};
}
async function mockModel(t,f,respond){
  const requests=[],server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);await respond(body,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));f.store.put('setting',{id:'model',provider:'ollama',baseUrl:'http://127.0.0.1:'+server.address().port,model:'isolated-graph-fixture',embeddingBaseUrl:'',embeddingModel:''});
  t.after(()=>new Promise(resolve=>server.close(resolve)));return requests;
}
function answerFrom(body,res){
  const context=JSON.parse(body.messages.find(m=>m.role==='user').content),numbers=context.evidence.map(e=>e.citation);
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'DEV-101关联WO-201，WO-201关联ISSUE-301，ISSUE-301关联PROC-401；规程要求先核对原始记录再完成资料复核。'+numbers.map(n=>'['+n+']').join(''),citations:numbers,insufficient:false,graphPathIds:context.graphPaths.map(p=>p.id)})}}],usage:{prompt_tokens:30,completion_tokens:20,total_tokens:50}}));
}

test('hybrid retrieval preserves three-hop source closure, including relational list questions',async t=>{
  const f=await fixture(t);
  for(const query of [question,'分别列出 DEV-101关联的工单、问题和规程']){
    const found=await search(f.store,f.viewer,query,{semantic:false,limit:8});
    assert.ok(found.graph.paths.some(p=>p.edges.length===3),'a question about one asset must retrieve the remote procedure through three reviewed edges');
    assert.ok(found.results.some(r=>r.documentId===f.docs[2].id&&r.text.includes('先核对原始记录')));
    assert.match(found.strategy,/图谱/);assert.equal(found.coverage,undefined,'relational list is not a full single-table statistic');
    assert.equal(graphPathsForEvidence(found.graph.paths,found.results).length,found.graph.paths.length);
    assert.ok(found.results.every(ref=>(ref.graphPaths||[]).every(p=>found.graph.paths.some(other=>other.id===p.id))));
  }
  const lexical=await search(f.store,f.viewer,question,{semantic:false,graph:false});
  assert.ok(!lexical.results.some(r=>r.documentId===f.docs[2].id),'the third-hop source has no asset term and must not be passed off as ordinary keyword recall');
  const limited=await search(f.store,f.viewer,question,{semantic:false,limit:2});
  assert.ok(limited.graph.paths.every(p=>p.edges.length<=2),'an omitted third-hop source cannot leave a displayed complete path');
  assert.ok(f.store.list('traceSpan').some(span=>span.operation==='retrieval.graph'&&span.status==='succeeded'));
});

test('candidate, inaccessible, and stale intermediate relationships cannot reach a remote source',async t=>{
  const f=await fixture(t,{confirm:false});
  assert.equal((await search(f.store,f.viewer,question,{semantic:false})).graph.paths.length,0);
  for(const relation of f.store.list('knowledgeRelation'))reviewRelation(f.store,f.admin,relation.id,{revision:relation.revision,action:'confirm',reason:'核对测试字段'});
  const middle=f.docs[1];f.store.put('document',{...middle,sensitivity:'confidential'});
  const privateFound=await search(f.store,f.viewer,question,{semantic:false});
  assert.equal(privateFound.graph.paths.some(p=>p.edges.length===3),false);
  assert.equal(JSON.stringify(privateFound).includes('PROC-401'),false);
  f.store.put('document',{...middle,contentRevision:2});
  const stale=await search(f.store,f.viewer,question,{semantic:false});
  assert.equal(stale.graph.paths.some(p=>p.edges.length===3),false);
  assert.equal(stale.results.some(r=>r.documentId===f.docs[2].id),false);
});

test('real run injects reviewed paths and source citations, then withdraws history and SSE after rejection',async t=>{
  const f=await fixture(t),requests=await mockModel(t,f,answerFrom);
  const created=await f.request('POST','/api/chat/runs',{question,baseId:f.base.id,clientRequestId:'graph-run'});
  assert.equal(created.status,202,JSON.stringify(created.data));const run=await f.wait(created.data.run.id);
  assert.equal(run.status,'succeeded',JSON.stringify({status:run.status,errorCode:run.errorCode,errorMessage:run.errorMessage,coverage:run.result?.coverage}));assert.equal(run.result.mode,'model');
  assert.ok(run.result.graphPaths.some(p=>p.edges.length===3));
  const prompt=JSON.parse(requests[0].messages.find(m=>m.role==='user').content);
  assert.ok(prompt.graphPaths.some(p=>p.edges.length===3&&p.edges.every(e=>e.citations.length>0)));
  assert.ok(prompt.evidence.some(e=>e.text.includes('先核对原始记录')));
  assert.match(requests[0].messages[0].content,/路径连通不能证明因果/);
  const replay=await f.request('GET','/api/chat/runs/'+run.id+'/events');
  assert.match(replay.text,/event: evidence.ready/);assert.match(replay.text,/"graphPaths":/);assert.match(replay.text,/event: answer.final/);
  const last=f.store.list('knowledgeRelation').find(r=>r.documentId===f.docs[2].id);
  reviewRelation(f.store,f.admin,last.id,{revision:last.revision,action:'reject',reason:'复核测试：此关系不再有效'});
  assert.equal(evidenceBundleCurrent(f.store,f.admin,run.result),false);
  const history=await f.request('GET','/api/conversations/'+run.conversationId);
  const assistant=history.data.messages.find(m=>m.role==='assistant');
  assert.equal(assistant.mode,'insufficient');assert.deepEqual(assistant.graphPaths,[]);assert.deepEqual(assistant.citations,[]);
  assert.equal(JSON.stringify(assistant).includes('PROC-401'),false,'withdrawn graph source must not survive in nested metadata');
  const context=buildConversationContext(f.store,f.admin,run.conversationId,{question:'那它还关联什么？'});
  assert.equal(context.turns.length,0);assert.ok(context.waitingFor);
  const withdrawn=await f.request('GET','/api/chat/runs/'+run.id+'/events');
  assert.match(withdrawn.text,/event: evidence.withdrawn/);assert.doesNotMatch(withdrawn.text,/PROC-401/);
  const view=await f.request('GET','/api/chat/runs/'+run.id);
  assert.equal(view.data.run.result.mode,'insufficient');
});

test('relation changes while a provider responds prevent final graph answer submission',async t=>{
  const f=await fixture(t);
  await mockModel(t,f,(body,res)=>{const relation=f.store.list('knowledgeRelation').find(r=>r.documentId===f.docs[1].id);reviewRelation(f.store,f.admin,relation.id,{revision:relation.revision,action:'reject',reason:'生成期间复核撤回关系'});answerFrom(body,res);});
  const result=await answerQuestion(f.store,f.admin,question,{baseId:f.base.id});
  assert.equal(result.mode,'insufficient');assert.deepEqual(result.citations,[]);assert.ok(!result.graphPaths?.length);
});

test('search_graph executes as a bounded read-only step and a following draft retains revocation lineage',async t=>{
  const f=await fixture(t);
  await assert.rejects(executeReadOnlyTool(f.store,f.admin,'search_graph',{query:question,maxHops:4}),{code:'GRAPH_HOPS_LIMIT'});
  await assert.rejects(executeReadOnlyTool(f.store,f.admin,'search_graph',{query:question,baseId:'outside'},{baseId:f.base.id}),{code:'TOOL_SCOPE_DENIED'});
  const create=await f.request('POST','/api/chat/runs',{question,baseId:f.base.id,clientRequestId:'graph-steps',plan:[{id:'graph',tool:'search_graph',args:{query:question,maxHops:3}},{id:'draft',tool:'create_report_draft',args:{title:'图谱核对草稿'},dependsOn:['graph']}]});
  assert.equal(create.status,202,JSON.stringify(create.data));const run=await f.wait(create.data.run.id);
  assert.equal(run.status,'succeeded',JSON.stringify({status:run.status,errorCode:run.errorCode,errorMessage:run.errorMessage,coverage:run.result?.coverage}));assert.equal(run.toolResults[0].tool,'search_graph');
  assert.ok(run.toolResults[0].graphPaths.some(p=>p.edges.length===3));
  const draft=f.store.list('reportDraft')[0];assert.ok(draft.graphPaths.some(p=>p.edges.length===3));
  assert.equal(f.store.list('modelCall').length,0,'explicit read-only graph plan never needs an external model');
  const relation=f.store.list('knowledgeRelation')[0];reviewRelation(f.store,f.admin,relation.id,{revision:relation.revision,action:'reject',reason:'草稿来源复核撤回'});
  const hidden=await f.request('GET','/api/report-drafts/'+draft.id);assert.equal(hidden.status,404);
});

test('graph subsystem failure is explicit while text search remains usable',async t=>{
  const f=await fixture(t),list=f.store.list.bind(f.store);
  f.store.list=kind=>{if(kind==='knowledgeRelation')throw Object.assign(Error('isolated graph failure'),{code:'GRAPH_TEST_FAILURE'});return list(kind);};
  try{
    const found=await search(f.store,f.viewer,'DEV-101',{semantic:false});
    assert.ok(found.results.length);assert.equal(found.graph.stats.status,'unavailable');assert.match(found.warning,/图谱检索暂不可用/);assert.doesNotMatch(found.strategy,/已核验知识图谱/);
    await assert.rejects(executeReadOnlyTool(f.store,f.viewer,'search_graph',{query:'DEV-101'}),{code:'GRAPH_TEST_FAILURE'});
  }finally{f.store.list=list;}
});


test('graph claims citing only an endpoint or skipping the middle hop never become model answers',async t=>{
  const f=await fixture(t);let variant='endpoint',calls=0;
  await mockModel(t,f,(body,res)=>{
    calls++;const context=JSON.parse(body.messages.find(m=>m.role==='user').content),full=context.graphPaths.find(p=>p.edges.length===3),short=context.graphPaths.find(p=>p.edges.length===1),all=full.edges.map(e=>e.citations[0]);
    const used=variant==='endpoint'?[all[2]]:variant==='middle'?[all[0],all[2]]:[all[0],all[2]];
    const payload={answer:(variant==='implicit-subject'?'其关联规程为PROC-401。':'DEV-101通过关联资料对应PROC-401。')+used.map(n=>'['+n+']').join(''),citations:used,insufficient:false,graphPathIds:[['hidden-long-path','implicit-subject'].includes(variant)?short.id:full.id]};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(payload)}}]}));
  });
  for(const selected of ['endpoint','middle','hidden-long-path','implicit-subject']){
    variant=selected;const before=calls,result=await answerQuestion(f.store,f.admin,question,{baseId:f.base.id});
    assert.equal(result.mode,'extractive',selected+' must fall back to original evidence after its one repair fails');
    assert.equal(result.validationAttempts,2);assert.equal(calls-before,2);
    assert.doesNotMatch(result.answer,/DEV-101通过关联资料对应PROC-401|其关联规程为PROC-401/);
    assert.match(result.warning,/图谱|路径|关联/);
  }
});

test('one graph citation repair may add missing intermediate references from the same evidence',async t=>{
  const f=await fixture(t);let calls=0;
  const requests=await mockModel(t,f,(body,res)=>{
    calls++;if(calls>1){answerFrom(body,res);return;}
    const context=JSON.parse(body.messages.find(m=>m.role==='user').content),full=context.graphPaths.find(p=>p.edges.length===3),last=full.edges.at(-1).citations[0];
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'DEV-101关联PROC-401。['+last+']',citations:[last],insufficient:false,graphPathIds:[full.id]})}}]}));
  });
  const result=await answerQuestion(f.store,f.admin,question,{baseId:f.base.id});
  assert.equal(result.mode,'model');assert.equal(result.validationAttempts,2);assert.equal(calls,2);
  assert.ok(result.graphPaths.some(p=>p.edges.length===3));assert.equal(new Set(result.citations.map(c=>c.documentId)).size,3);
  assert.match(requests[1].messages.at(-1).content,/中间关联|每一跳/);
});

test('a fully cited path does not force citations to an unused neighbouring branch',async t=>{
  const f=await fixture(t),found=await search(f.store,f.viewer,question,{semantic:false}),full=found.graph.paths.find(p=>p.edges.length===3),one=found.graph.paths.find(p=>p.edges.length===1);
  const neighbour={...one,id:'unused-neighbour',nodeIds:[one.nodes[0].id,'other-node'],nodes:[one.nodes[0],{id:'other-node',type:'work_order',name:'WO-999',externalId:'WO-999'}],edges:[{...one.edges[0],id:'other-edge',objectId:'other-node',documentId:'other-source',blockId:'other-chunk'}]};
  const paths=found.graph.paths.concat(neighbour),citations=found.results.concat({id:'other-chunk',documentId:'other-source',text:'unused neighbour'}),used=found.results.map((_,i)=>i+1);
  const selected=validateAnswerGraphReferences({answer:'DEV-101关联PROC-401。'+used.map(n=>'['+n+']').join(''),graphPathIds:[full.id]},paths,citations,used,{required:true});
  assert.ok(selected.some(p=>p.id===full.id));assert.ok(!selected.some(p=>p.id===neighbour.id));
});

test('a search_knowledge tool does not duplicate graph source text into model tool metadata',async t=>{
  const f=await fixture(t),requests=await mockModel(t,f,answerFrom);
  const create=await f.request('POST','/api/chat/runs',{question,baseId:f.base.id,clientRequestId:'graph-search-budget',plan:[{id:'search',tool:'search_knowledge',args:{query:question}}]});
  assert.equal(create.status,202);const run=await f.wait(create.data.run.id);assert.equal(run.status,'succeeded');
  const context=JSON.parse(requests[0].messages.find(m=>m.role==='user').content);
  assert.ok(context.evidence.some(ref=>ref.text.includes('先核对原始记录')));
  assert.ok(!JSON.stringify(context.toolResults).includes('先核对原始记录'));
  assert.ok(!JSON.stringify(context.toolResults).includes('evidenceRefs'));
});


test('a source edited during retrieval cannot give old text a new fingerprint, with or without graph recall',async t=>{
  const f=await fixture(t),vectors=f.store.vectors.bind(f.store);
  for(const graph of [false,true]){
    const originalDoc=f.store.get('document',f.docs[0].id),originalChunks=f.store.chunks(originalDoc.id);let changed=false;
    f.store.vectors=()=>{
      if(!changed){changed=true;f.store.put('document',{...originalDoc,revision:originalDoc.revision+1,contentRevision:originalDoc.contentRevision+1});f.store.replaceChunks(originalDoc.id,originalChunks.map(c=>({...c,text:c.text.replace('隔离设备工单','来源已改为重新审批'),table:{...c.table,rows:c.table.rows.map(row=>row.map(value=>value==='隔离设备工单'?'来源已改为重新审批':value))}})));}
      return [];
    };
    const found=await search(f.store,f.viewer,question,{graph,semantic:true});
    assert.equal(changed,true);assert.equal(found.evidence.sufficient,false);assert.deepEqual(found.results,[]);
    assert.match(found.evidence.reason,/检索期间来源/);assert.ok(!JSON.stringify(found).includes('隔离设备工单'));
    f.store.put('document',originalDoc);f.store.replaceChunks(originalDoc.id,originalChunks);
  }
  f.store.vectors=vectors;
});

test('aggregated table evidence checks every source chunk even when document revision did not change',async t=>{
  const f=await fixture(t),doc=f.store.get('document',f.docs[0].id),first=f.store.chunks(doc.id)[0],vectors=f.store.vectors.bind(f.store);
  const chunks=[{...first,table:{...first.table,totalRows:2,complete:false}},{...first,id:doc.id+'_chunk1',ordinal:2,text:'设备工单记录第二行：DEV-102 WO-202 旧记录',table:{...first.table,rows:[['DEV-102','WO-202','旧记录']],rowNumbers:[3],rowStart:2,rowEnd:2,totalRows:2,complete:false}}];
  f.store.replaceChunks(doc.id,chunks);let changed=false;
  f.store.vectors=()=>{changed=true;f.store.replaceChunks(doc.id,[chunks[0],{...chunks[1],text:'设备工单记录第二行：DEV-102 WO-202 当前记录',table:{...chunks[1].table,rows:[['DEV-102','WO-202','当前记录']]}}]);return [];};
  try{
    const found=await search(f.store,f.viewer,'完整列出设备工单记录',{semantic:true,graph:false});
    assert.equal(changed,true);assert.equal(found.evidence.sufficient,false);assert.deepEqual(found.results,[]);
    assert.match(found.evidence.reason,/检索期间来源/);assert.ok(!JSON.stringify(found).includes('旧记录'));
  }finally{f.store.vectors=vectors;}
});


test('reverse graph traversal keeps predicate direction in model tool context and report drafts',async t=>{
  const f=await fixture(t),requests=await mockModel(t,f,answerFrom),query='PROC-401关联的设备和问题是什么？';
  const create=await f.request('POST','/api/chat/runs',{question:query,baseId:f.base.id,clientRequestId:'reverse-direction',plan:[{id:'graph',tool:'search_graph',args:{query,maxHops:3}},{id:'draft',tool:'create_report_draft',args:{title:'反向关联核对草稿'},dependsOn:['graph']}]});
  assert.equal(create.status,202);const run=await f.wait(create.data.run.id);assert.equal(run.status,'succeeded',run.errorCode);
  const draft=f.store.list('reportDraft')[0];assert.match(draft.content,/PROC-401 ←依据规程— /);assert.doesNotMatch(draft.content,/PROC-401 —依据规程→ /);
  const context=JSON.parse(requests[0].messages.find(m=>m.role==='user').content),toolPath=context.toolResults[0].result.paths.find(p=>p.relations.length===3);
  assert.ok(toolPath);assert.notEqual(toolPath.relations[0].subjectId,toolPath.nodes[0].id);
  assert.equal(toolPath.relations[0].objectId,toolPath.nodes[0].id);
  assert.equal(toolPath.relations[0].predicate,'follows_procedure');
  const promptPath=context.graphPaths.find(p=>p.edges.length===3);assert.equal(promptPath.edges[0].objectId,promptPath.nodes[0].id);
});

