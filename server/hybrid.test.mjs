import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { createApp } from './api.mjs';
import { localEmbeddingAvailable } from './local-embeddings.mjs';
import { modelConfig, embeddingSignature, publicModel, search } from './retrieval.mjs';

test('offline Chinese hybrid retrieval indexes real uploads and isolates model versions', {skip:!localEmbeddingAvailable()}, async()=>{
  const dataDir=mkdtempSync(path.join(os.tmpdir(),'xrag-hybrid-'));
  const saved={LOCAL_EMBEDDINGS_ENABLED:process.env.LOCAL_EMBEDDINGS_ENABLED,EMBEDDING_BASE_URL:process.env.EMBEDDING_BASE_URL,EMBEDDING_MODEL:process.env.EMBEDDING_MODEL,ADMIN_USERNAME:process.env.ADMIN_USERNAME,ADMIN_PASSWORD:process.env.ADMIN_PASSWORD};
  process.env.LOCAL_EMBEDDINGS_ENABLED='true';delete process.env.EMBEDDING_BASE_URL;delete process.env.EMBEDDING_MODEL;delete process.env.ADMIN_USERNAME;delete process.env.ADMIN_PASSWORD;
  const originalFetch=globalThis.fetch;let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw new Error('This offline integration test blocks model network requests.');};
  let app;
  try{
    app=await createApp({dataDir,startWorker:false});app.store.put('setting',{id:'model',provider:'disabled'});
    const user={id:'tester',name:'测试管理员',username:'tester',role:'admin',department:'企业',active:true};app.store.put('user',user);app.store.put('base',{id:'base',name:'语义检索测试',visibility:'company',ownerId:user.id});
    const sources=[
      '员工因公出差发生的交通费和住宿费，应当取得合法发票。出差结束后五个工作日内提交费用报销申请，由部门负责人审核。',
      '生产设备发生故障时，值班人员应先停止设备运行并断开电源，设置安全警示，再通知维修人员排查故障。',
      '员工申请年休假应提前向直属主管提出，部门结合工作安排审批。休假期间应做好岗位工作交接。',
      '企业重要业务数据每天进行备份，每季度开展恢复演练。备份副本应与生产环境隔离保存。',
    ];
    const questions=['去外地办事垫付的钱怎样申请返还？','机器突然坏了，现场应该先做什么？','想请几天假，需要向谁申请？','怎样防止系统数据丢失？'];
    const documents=[];
    for(let i=0;i<sources.length;i++){const result=await app.ingest(user,{baseId:'base',fileName:'样例'+(i+1)+'.txt',contentBase64:Buffer.from(sources[i]).toString('base64'),duplicateAction:'copy'});await app.runQueue();const d=app.store.get('document',result.document.id);assert.equal(d.status,'review');assert.equal(d.embeddingStatus,'ready');app.store.put('document',{...d,status:'published'});documents.push(d);}
    const model=modelConfig(app.store),signature=embeddingSignature(model);assert.equal(model.embeddingBaseUrl,'local://bge');assert.equal(publicModel(app.store).embeddingSource,'local');assert.equal(publicModel(app.store).localEmbedding.dimensions,512);
    const vectors=app.store.vectors(documents.map(d=>d.id),signature);assert.equal(vectors.length,4);for(const row of vectors){assert.equal(row.vector.length,512);assert.ok(Math.abs(Math.hypot(...row.vector)-1)<1e-6);}
    for(let i=0;i<questions.length;i++){const result=await search(app.store,user,questions[i],{baseId:'base'});assert.equal(result.results[0]?.documentId,documents[i].id,'Different wording must recall the expected source');assert.match(result.strategy,/本地 BGE/);}
    app.store.db.prepare('UPDATE chunks SET embedding_model=? WHERE document_id=?').run('local:older-model-revision',documents[1].id);
    assert.equal((await search(app.store,user,questions[1],{baseId:'base'})).results.length,0,'An incompatible stored model vector must not enter semantic ranking');
    const task={id:'recover-index',type:'index',documentId:documents[1].id,title:'语义重建',status:'processing',createdAt:new Date().toISOString()};app.store.put('task',task);
    await app.close();app=null;app=await createApp({dataDir,startWorker:false});assert.equal(app.store.get('task',task.id).status,'queued');assert.equal(app.store.get('document',documents[1].id).status,'published','Recovering an index job must not unpublish knowledge');await app.runQueue();
    assert.equal((await search(app.store,user,questions[1],{baseId:'base'})).results[0].documentId,documents[1].id);
    const corrected='生产设备出现异常必须立即停机并切断电源，先确保现场安全，再联系专业维修人员。';
    app.store.replaceChunks(documents[1].id,[{id:'corrected-chunk',documentId:documents[1].id,page:1,ordinal:0,text:corrected,corrected:true}]);app.store.put('task',{...task,id:'edit-index',status:'queued'});await app.runQueue();
    assert.equal(app.store.chunks(documents[1].id)[0].text,corrected,'Index updates must preserve manual corrections instead of parsing the old original again');assert.equal(app.store.vectors([documents[1].id],signature)[0].id,'corrected-chunk');
    process.env.LOCAL_EMBEDDINGS_ENABLED='false';assert.equal(modelConfig(app.store).embeddingSource,'disabled');assert.match((await search(app.store,user,'设备',{})).strategy,/BM25/);
    assert.equal(networkAttempts,0);
  }finally{if(app)await app.close();globalThis.fetch=originalFetch;for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;assert.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dataDir,{recursive:true,force:true});}
});
