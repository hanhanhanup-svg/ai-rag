import test from 'node:test';
process.env.LOCAL_EMBEDDINGS_ENABLED='false';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from './api.mjs';
import { tokenize } from './retrieval.mjs';

test('enterprise knowledge lifecycle, ACL, persistence, jobs and backups',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'xrag-backend-'));
  const originalEnv={...process.env};delete process.env.ADMIN_USERNAME;delete process.env.ADMIN_PASSWORD;delete process.env.AI_API_KEY;delete process.env.DEEPSEEK_API_KEY;delete process.env.OPENAI_API_KEY;
  let app,server,baseUrl,cookie='';
  const open=async()=>{app=await createApp({dataDir:dir,startWorker:false});server=http.createServer(app.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));baseUrl=`http://127.0.0.1:${server.address().port}`;};
  const close=async()=>{await new Promise(r=>server.close(r));await app.close();};
  const request=async(method,route,body,{as=cookie,origin='http://localhost:5173'}={})=>{const res=await fetch(baseUrl+route,{method,headers:{...(as?{cookie:as}:{}),...(origin?{origin}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const ct=res.headers.get('content-type');return {status:res.status,data:ct?.includes('json')?await res.json():await res.text(),cookie:res.headers.get('set-cookie')?.split(';')[0]};};
  try{
    await open();assert.equal((await request('GET','/ready.json')).data.writerLockHeld,true);
    assert.equal((await request('GET','/api/setup')).data.required,true);
    let r=await request('POST','/api/setup',{username:'admin',name:'管理员',password:'ExamplePassword123!'},{origin:'https://evil.example'});assert.equal(r.status,403);
    r=await request('POST','/api/setup',{username:'admin',name:'管理员',password:'ExamplePassword123!'});assert.equal(r.status,201);cookie=r.cookie;const adminCookie=cookie;assert.ok(!r.data.user.passwordHash);
    assert.equal((await request('POST','/api/setup',{})).status,409);
    const bases=(await request('GET','/api/bases')).data.bases;assert.equal(bases.length,1);const baseId=bases[0].id;
    r=await request('POST','/api/users',{username:'viewer',name:'其他部门用户',password:'ViewerPassword123!',role:'viewer',department:'研发'});assert.equal(r.status,201);const viewerId=r.data.user.id;
    r=await request('POST','/api/users',{username:'editor',name:'编辑',password:'EditorPassword123!',role:'editor',department:'制度管理'});assert.equal(r.status,201);
    const text='# 出差审批制度\n员工出差须提前三个工作日提交申请，部门负责人审批后方可预订交通和住宿。\n差旅报销应在返回后十个工作日内提交。';
    const upload=async(extra={})=>request('POST','/api/documents',{baseId,fileName:'出差审批制度.txt',contentBase64:Buffer.from(text).toString('base64'),duplicateAction:'skip',...extra});
    r=await upload();assert.equal(r.status,201);let doc=r.data.document;assert.equal(doc.status,'queued');assert.ok(existsSync(path.join(dir,'knowledge.sqlite')));
    await app.runQueue();doc=(await request('GET',`/api/documents/${doc.id}`)).data.document;assert.equal(doc.status,'review');assert.ok(doc.chunkCount>0);
    assert.equal((await request('GET','/api/search?q=出差')).data.results.length,0);
    assert.equal((await request('POST',`/api/documents/${doc.id}/actions`,{action:'publish',revision:0})).status,409);
    r=await request('POST',`/api/documents/${doc.id}/actions`,{action:'publish',revision:doc.revision});assert.equal(r.status,200);doc=r.data.document;
    r=await request('GET','/api/search?q=出差审批');assert.ok(r.data.results.length>0);assert.equal(r.data.results[0].documentId,doc.id);assert.match(r.data.strategy,/BM25/);
    const editorCookie=(await request('POST','/api/auth/login',{username:'editor',password:'EditorPassword123!'})).cookie;
    assert.equal((await request('PATCH',`/api/documents/${doc.id}`,{title:'无权修改'},{as:editorCookie})).status,404);
    assert.equal((await request('POST',`/api/documents/${doc.id}/actions`,{action:'archive',reason:'无权下架'},{as:editorCookie})).status,404);
    r=await upload();assert.equal(r.data.duplicate,true);assert.equal(r.data.document.id,doc.id);
    r=await request('POST','/api/auth/login',{username:'viewer',password:'ViewerPassword123!'});assert.equal(r.status,200);const viewerCookie=r.cookie;
    assert.equal((await request('GET','/api/users',undefined,{as:viewerCookie})).status,403);
    assert.equal((await request('POST','/api/documents',{},{as:viewerCookie})).status,403);
    r=await request('POST','/api/chat',{question:'出差如何审批？'},{as:viewerCookie});assert.equal(r.status,200);assert.equal(r.data.mode,'extractive');assert.ok(Number.isFinite(r.data.latencyMs)&&r.data.latencyMs>=0);assert.ok(r.data.citations.length);const conversationId=r.data.conversationId;
    assert.equal((await request('GET',`/api/conversations/${conversationId}`,undefined,{as:adminCookie})).status,404);
    const firstId=doc.id;
    r=await request('PATCH',`/api/documents/${firstId}`,{revision:doc.revision,title:'出差审批制度（修订）',chunks:[{id:(await request('GET',`/api/documents/${firstId}`)).data.chunks[0].id,text:'员工出差须提前五个工作日提交申请，部门负责人审批后方可预订交通和住宿。'}]});assert.equal(r.status,200);const v2=r.data.document;assert.equal(v2.version,2);assert.notEqual(v2.id,firstId);assert.equal(v2.status,'review');
    assert.equal((await request('GET',`/api/documents/${v2.id}`,undefined,{as:editorCookie})).status,404);
    assert.equal((await request('GET',`/api/documents/${v2.id}`,undefined,{as:viewerCookie})).status,404);
    r=await request('POST',`/api/documents/${v2.id}/actions`,{action:'publish',revision:v2.revision});assert.equal(r.status,200);doc=r.data.document;
    assert.equal((await request('GET',`/api/documents/${firstId}`)).data.document.status,'superseded');
    r=await request('GET',`/api/conversations/${conversationId}`,undefined,{as:viewerCookie});assert.equal(r.data.messages.find(m=>m.role==='assistant').citations.length,0);assert.match(r.data.messages.find(m=>m.role==='assistant').answer,/更新/);
    r=await upload({fileName:'保密战略.txt',title:'保密战略',sensitivity:'confidential',duplicateAction:'copy'});const privateDoc=r.data.document;await app.runQueue();const pd=(await request('GET',`/api/documents/${privateDoc.id}`)).data.document;await request('POST',`/api/documents/${pd.id}/actions`,{action:'publish',revision:pd.revision});
    assert.equal((await request('GET',`/api/documents/${pd.id}`,undefined,{as:viewerCookie})).status,404);
    assert.equal((await request('GET',`/api/documents/${pd.id}/file`,undefined,{as:viewerCookie})).status,404);
    assert.ok((await request('GET','/api/search?q=出差',undefined,{as:viewerCookie})).data.results.every(c=>c.documentId!==pd.id));
    r=await request('POST','/api/feedback',{question:'出差政策适用范围？',comment:'需要补充子公司范围',documentId:doc.id},{as:viewerCookie});assert.equal(r.status,201);const feedback=r.data.feedback;
    assert.equal((await request('PATCH',`/api/feedback/${feedback.id}`,{status:'resolved',resolution:''})).status,400);
    assert.equal((await request('PATCH',`/api/feedback/${feedback.id}`,{status:'resolved',resolution:'已补充并核对发布依据'})).status,200);
    const measured=(await request('GET','/api/operations')).data.metrics;assert.ok(Number.isFinite(measured.averageLatencyMs)&&measured.averageLatencyMs>=0);assert.ok(measured.completedRequests>0);assert.equal(measured.chatLatencySamples,1);assert.ok(Number.isFinite(measured.averageChatLatencyMs));
    r=await request('POST','/api/operations/backup',{});assert.equal(r.status,201);assert.equal(r.data.backup.verified,true);assert.ok(existsSync(path.join(dir,'backups',r.data.backup.id,'manifest.json')));
    const {cpSync}=await import('node:fs');const restoredDir=path.join(dir,'restore-verification');cpSync(path.join(dir,'backups',r.data.backup.id),restoredDir,{recursive:true});
    const restored=await createApp({dataDir:restoredDir,startWorker:false});assert.equal(restored.readiness().status,'ready');assert.equal(restored.store.get('document',doc.id).version,doc.version);assert.ok(restored.store.chunks(doc.id).length>0);await restored.close();
    assert.equal((await request('POST','/api/connectors',{name:'拒绝越界',path:os.tmpdir(),baseId})).status,403);
    assert.equal((await request('GET','/api/settings')).data.settings.model.hasApiKey,false);
    assert.equal((await request('POST','/api/settings/model/test',{})).status,400);
    assert.equal((await request('POST',`/api/documents/${doc.id}/actions`,{action:'archive',reason:'制度已废止',revision:doc.revision})).status,200);
    assert.equal((await request('GET','/api/search?q=出差',undefined,{as:viewerCookie})).data.results.length,0);
    const queued=await upload({fileName:'重启任务.txt',duplicateAction:'copy'});const task=app.store.list('task').find(t=>t.documentId===queued.data.document.id);app.store.put('task',{...task,status:'processing'});
    await close();await open();assert.equal((await request('GET','/api/setup')).data.required,false);assert.ok(app.store.get('document',doc.id));assert.equal(app.store.get('task',task.id).status,'queued');await app.runQueue();assert.equal(app.store.get('document',queued.data.document.id).status,'review');
    r=await request('POST','/api/auth/login',{username:'admin',password:'ExamplePassword123!'});cookie=r.cookie;
    assert.ok((await request('GET','/api/audit')).data.events.length>10);
    assert.equal((await request('PATCH',`/api/users/${(await request('GET','/api/auth/me')).data.user.id}`,{active:false})).status,409);
    assert.equal((await request('PATCH',`/api/users/${viewerId}`,{active:false})).status,200);
    assert.equal((await request('GET','/api/auth/me',undefined,{as:viewerCookie})).status,401);
    assert.ok(tokenize('测试ABC-123').includes('abc-123'));
    await close();server=null;
  }finally{if(server)await close();for(const k of Object.keys(process.env))if(!(k in originalEnv))delete process.env[k];Object.assign(process.env,originalEnv);assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dir,{recursive:true,force:true});}
});

test('department membership, encrypted settings, scheduled versions and source synchronization',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'xrag-controls-'));const folder=path.join(dir,'incoming');const {mkdirSync,unlinkSync}=await import('node:fs');mkdirSync(folder);
  const oldRoots=process.env.CONNECTOR_ROOTS;process.env.CONNECTOR_ROOTS=folder;
  const originalBootstrap=[process.env.ADMIN_USERNAME,process.env.ADMIN_PASSWORD];delete process.env.ADMIN_USERNAME;delete process.env.ADMIN_PASSWORD;
  const app=await createApp({dataDir:path.join(dir,'state'),startWorker:false});app.store.put('setting',{id:'model',provider:'disabled'});const server=http.createServer(app.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;let cookie;
  const call=async(method,route,data,as=cookie)=>{const r=await fetch(url+route,{method,headers:{origin:'http://localhost:5173',...(as?{cookie:as}:{}),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  try{
    const setup=await call('POST','/api/setup',{username:'admin2',password:'AdminPassword123!'});cookie=setup.cookie;
    const baseId=(await call('GET','/api/bases')).data.bases[0].id;
    const viewer=(await call('POST','/api/users',{username:'member',password:'MemberPassword123!',role:'viewer',department:'审计'})).data.user;
    const vc=(await call('POST','/api/auth/login',{username:'member',password:'MemberPassword123!'})).cookie;
    const base=(await call('POST','/api/bases',{name:'受限审计资料',department:'审计',visibility:'private'})).data.base;
    const contentBase64=Buffer.from('审计整改台账应每月汇总，审计主管负责复核。').toString('base64');
    let document=(await call('POST','/api/documents',{baseId:base.id,fileName:'审计.txt',contentBase64,sensitivity:'confidential'})).data.document;await app.runQueue();
    document=(await call('GET','/api/documents/'+document.id)).data.document;await call('POST','/api/documents/'+document.id+'/actions',{action:'publish',revision:document.revision});
    assert.equal((await call('GET','/api/search?q=审计',undefined,vc)).data.results.length,0);
    await call('PATCH','/api/bases/'+base.id,{members:[viewer.id]});
    assert.ok((await call('GET','/api/search?q=审计',undefined,vc)).data.results.length>0);
    assert.equal((await call('POST','/api/favorites',{documentId:document.id},vc)).status,201);
    assert.equal((await call('GET','/api/favorites',undefined,vc)).data.favorites.length,1);
    const answer=await call('POST','/api/chat',{question:'审计台账如何汇总？',baseId:base.id},vc);assert.ok(answer.data.citations.length);
    await call('PATCH','/api/bases/'+base.id,{members:[]});
    assert.equal((await call('GET','/api/favorites',undefined,vc)).data.favorites.length,0);
    assert.equal((await call('GET','/api/conversations/'+answer.data.conversationId,undefined,vc)).data.messages.find(m=>m.role==='assistant').citations.length,0);
    const key='local-test-key-never-real';await call('PUT','/api/settings',{model:{provider:'disabled',apiKey:key}});
    const settings=await call('GET','/api/settings');assert.equal(settings.data.settings.model.hasApiKey,true);assert.ok(!JSON.stringify(settings).includes(key));assert.notEqual(app.store.get('setting','model').sealedApiKey,key);
    const v1=(await call('POST','/api/documents',{baseId,fileName:'未来生效.txt',contentBase64,duplicateAction:'copy'})).data.document;await app.runQueue();await call('POST','/api/documents/'+v1.id+'/actions',{action:'publish'});
    const v2=(await call('POST','/api/documents',{baseId,fileName:'未来生效.txt',contentBase64:Buffer.from('审计整改台账应每季度汇总，审计主管负责复核。').toString('base64'),duplicateAction:'version',previousVersionId:v1.id,effectiveAt:new Date(Date.now()+86400000).toISOString()})).data.document;await app.runQueue();await call('POST','/api/documents/'+v2.id+'/actions',{action:'publish'});
    assert.equal(app.store.get('document',v1.id).status,'published');let found=(await call('GET','/api/search?q=台账',undefined,vc)).data.results;assert.ok(found.some(r=>r.documentId===v1.id));assert.ok(found.every(r=>r.documentId!==v2.id));
    app.store.put('document',{...app.store.get('document',v2.id),effectiveAt:new Date(Date.now()-1000).toISOString()});
    found=(await call('GET','/api/search?q=台账',undefined,vc)).data.results;assert.ok(found.some(r=>r.documentId===v2.id));assert.equal(app.store.get('document',v1.id).status,'superseded');
    const sourcePath=path.join(folder,'导入制度.txt');writeFileSync(sourcePath,'访客入厂应在门卫处登记，接待人员全程陪同。');
    const connector=(await call('POST','/api/connectors',{baseId,path:folder,name:'受控目录',archiveDeleted:true,intervalMinutes:15})).data.connector;assert.equal(connector.intervalMinutes,15);
    const imported=await call('POST','/api/connectors/'+connector.id+'/sync',{});assert.equal(imported.status,200);assert.equal(imported.data.connector.stats.created,1);await app.runQueue();
    assert.equal((await call('POST','/api/connectors/'+connector.id+'/sync',{})).data.connector.stats.unchanged,1);
    writeFileSync(sourcePath,'访客入厂应提前一天预约，在门卫处登记，接待人员全程陪同。');
    assert.equal((await call('POST','/api/connectors/'+connector.id+'/sync',{})).data.connector.stats.updated,1);await app.runQueue();unlinkSync(sourcePath);
    assert.equal((await call('POST','/api/connectors/'+connector.id+'/sync',{})).data.connector.stats.archived,2);
    assert.equal((await call('PATCH','/api/connectors/'+connector.id,{intervalMinutes:3})).status,400);
    assert.equal((await call('DELETE','/api/connectors/'+connector.id)).status,200);
    assert.equal((await call('GET','/api/connectors')).data.connectors.length,0);
  }finally{await new Promise(r=>server.close(r));await app.close();if(oldRoots===undefined)delete process.env.CONNECTOR_ROOTS;else process.env.CONNECTOR_ROOTS=oldRoots;for(let i=0;i<2;i++){const k=i?'ADMIN_PASSWORD':'ADMIN_USERNAME';if(originalBootstrap[i]===undefined)delete process.env[k];else process.env[k]=originalBootstrap[i];}assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dir,{recursive:true,force:true});}
});

test('automatic version selection never escalates read access into document ownership',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'xrag-version-acl-'));
  const saved={ADMIN_USERNAME:process.env.ADMIN_USERNAME,ADMIN_PASSWORD:process.env.ADMIN_PASSWORD};delete process.env.ADMIN_USERNAME;delete process.env.ADMIN_PASSWORD;
  const app=await createApp({dataDir:dir,startWorker:false}),server=http.createServer(app.handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const root='http://127.0.0.1:'+server.address().port;let adminCookie;
  const api=async(method,route,data,cookie=adminCookie)=>{const response=await fetch(root+route,{method,headers:{origin:'http://localhost:5173',...(cookie?{cookie}:{}),...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  try{
    const initial=await api('POST','/api/setup',{username:'version-admin',password:'VersionAdmin123!'});adminCookie=initial.cookie;
    const baseId=(await api('GET','/api/bases')).data.bases[0].id;
    for(const username of ['version-owner','version-reader'])assert.equal((await api('POST','/api/users',{username,name:username,password:'EditorPassword123!',role:'editor',department:'企业管理'})).status,201);
    const ownerCookie=(await api('POST','/api/auth/login',{username:'version-owner',password:'EditorPassword123!'})).cookie;
    const readerCookie=(await api('POST','/api/auth/login',{username:'version-reader',password:'EditorPassword123!'})).cookie;
    const text='采购合同应先完成业务审核，再由授权人员签署。',changed='采购合同应先完成业务与法务审核，再由授权人员签署。';
    const upload=(overrides,cookie)=>api('POST','/api/documents',{baseId,fileName:'采购制度.txt',contentBase64:Buffer.from(text).toString('base64'),duplicateAction:'version',...overrides},cookie);
    let response=await upload({duplicateAction:'copy'},ownerCookie);assert.equal(response.status,201);const originalId=response.data.document.id;await app.runQueue();
    response=await api('POST','/api/documents/'+originalId+'/actions',{action:'publish'},ownerCookie);assert.equal(response.status,200);
    assert.equal((await api('GET','/api/documents/'+originalId,undefined,readerCookie)).status,200,'The attacker must have real read access before the version attempt');
    const count=app.store.list('document').length;const {readdirSync}=await import('node:fs');const files=readdirSync(path.join(dir,'uploads')).length;
    const attempts=[
      {contentBase64:Buffer.from(changed).toString('base64')},
      {fileName:'同哈希不同名.txt'},
      {fileName:'显式指定版本.txt',previousVersionId:originalId,contentBase64:Buffer.from(changed).toString('base64')}
    ];
    for(const input of attempts){const rejected=await upload(input,readerCookie);assert.equal(rejected.status,404);assert.equal(rejected.data.error.code,'DOCUMENT_NOT_FOUND');assert.equal(app.store.list('document').length,count);assert.equal(readdirSync(path.join(dir,'uploads')).length,files,'Unauthorized version attempts must not save originals');assert.equal(app.store.get('document',originalId).status,'published');}
    response=await upload({contentBase64:Buffer.from(changed).toString('base64')},ownerCookie);assert.equal(response.status,201);const v2=response.data.document;assert.equal(v2.version,2);assert.equal(v2.previousVersionId,originalId);assert.equal(v2.familyId,app.store.get('document',originalId).familyId);await app.runQueue();
    assert.equal((await api('POST','/api/documents/'+v2.id+'/actions',{action:'publish'},ownerCookie)).status,200);assert.equal(app.store.get('document',originalId).status,'superseded');
    response=await upload({fileName:'合法同哈希.txt',contentBase64:Buffer.from(changed).toString('base64')},ownerCookie);assert.equal(response.status,201);assert.equal(response.data.document.version,3);assert.equal(response.data.document.previousVersionId,v2.id);
    response=await upload({fileName:'合法显式版本.txt',previousVersionId:v2.id,contentBase64:Buffer.from('采购合同最新修订要求。').toString('base64')},ownerCookie);assert.equal(response.status,201);assert.equal(response.data.document.version,4);assert.equal(response.data.document.previousVersionId,v2.id);
  }finally{await new Promise(resolve=>server.close(resolve));await app.close();for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dir,{recursive:true,force:true});}
});
