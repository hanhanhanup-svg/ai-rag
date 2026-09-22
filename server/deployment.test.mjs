import test from 'node:test';
process.env.LOCAL_EMBEDDINGS_ENABLED='false';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createStore } from './database.mjs';
import { createApp, startServer } from './api.mjs';
import { validateEndpoint } from './retrieval.mjs';
function removeTemp(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dir,{recursive:true,force:true});}

test('writer lock, incomplete restore and failed startup remain safe',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'xrag-deploy-'));
  const saved={ADMIN_USERNAME:process.env.ADMIN_USERNAME,ADMIN_PASSWORD:process.env.ADMIN_PASSWORD,API_PORT:process.env.API_PORT,APP_ENCRYPTION_KEY:process.env.APP_ENCRYPTION_KEY};
  let occupied;
  try{
    const restoring=path.join(dir,'restoring');mkdirSync(restoring);writeFileSync(path.join(restoring,'.restore-incomplete'),'in progress');
    assert.throws(()=>createStore(restoring),e=>e.code==='RESTORE_INCOMPLETE');assert.equal(existsSync(path.join(restoring,'knowledge.sqlite')),false);
    const bad=path.join(dir,'bad-pid');mkdirSync(bad);writeFileSync(path.join(bad,'.writer.lock'),'0');
    assert.throws(()=>createStore(bad),e=>e.code==='WRITER_LOCK_INVALID');assert.equal(readFileSync(path.join(bad,'.writer.lock'),'utf8'),'0');assert.equal(existsSync(path.join(bad,'.writer-recovery.lock')),false);
    const dbDir=path.join(dir,'active');const first=createStore(dbDir);assert.throws(()=>createStore(dbDir),e=>e.code==='WRITER_ALREADY_ACTIVE');first.put('test',{id:'still-open',ok:true});first.close();first.close();assert.equal(existsSync(path.join(dbDir,'.writer.lock')),false);
    const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});const deadPid=child.pid;await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});writeFileSync(path.join(dbDir,'.writer.lock'),String(deadPid));const recovered=createStore(dbDir);assert.equal(recovered.get('test','still-open').ok,true);recovered.close();
    const corrupt=path.join(dir,'corrupt');mkdirSync(corrupt);writeFileSync(path.join(corrupt,'knowledge.sqlite'),'This is not a SQLite database');assert.throws(()=>createStore(corrupt));assert.equal(existsSync(path.join(corrupt,'.writer.lock')),false);
    process.env.ADMIN_USERNAME='admin';process.env.ADMIN_PASSWORD='short';const weak=path.join(dir,'weak-bootstrap');await assert.rejects(createApp({dataDir:weak,startWorker:false}),e=>e.code==='WEAK_PASSWORD');assert.equal(existsSync(path.join(weak,'.writer.lock')),false);delete process.env.ADMIN_USERNAME;delete process.env.ADMIN_PASSWORD;
    occupied=http.createServer((q,s)=>s.end());await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));process.env.API_PORT=String(occupied.address().port);const busy=path.join(dir,'busy-port');await assert.rejects(startServer({dataDir:busy,startWorker:false}),e=>e.code==='EADDRINUSE');assert.equal(existsSync(path.join(busy,'.writer.lock')),false);
    const sealedDir=path.join(dir,'sealed');delete process.env.APP_ENCRYPTION_KEY;const sealed=createStore(sealedDir);sealed.put('setting',{id:'model',sealedApiKey:sealed.seal('test-placeholder-only')});sealed.close();unlinkSync(path.join(sealedDir,'.encryption-key'));assert.throws(()=>createStore(sealedDir),e=>e.code==='ENCRYPTION_KEY_MISSING');assert.equal(existsSync(path.join(sealedDir,'.writer.lock')),false);
  }finally{if(occupied)await new Promise(resolve=>occupied.close(resolve));for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;removeTemp(dir);}
});

test('internal HTTPS models require explicit operations allowlist',async()=>{
  const saved=process.env.MODEL_ALLOWED_HOSTS;try{
    delete process.env.MODEL_ALLOWED_HOSTS;await assert.rejects(validateEndpoint('https://127.0.0.1/v1','compatible',{allowInternalModelHosts:true}),e=>e.code==='MODEL_ADDRESS_DENIED');
    process.env.MODEL_ALLOWED_HOSTS='127.0.0.1';assert.equal(await validateEndpoint('https://127.0.0.1/v1','compatible',{allowInternalModelHosts:true}),'https://127.0.0.1/v1');
    await assert.rejects(validateEndpoint('https://127.0.0.1/v1','compatible'),e=>e.code==='MODEL_ADDRESS_DENIED');
    await assert.rejects(validateEndpoint('http://127.0.0.1/v1','compatible',{allowInternalModelHosts:true}),e=>e.code==='MODEL_HTTPS_REQUIRED');
    await assert.rejects(validateEndpoint('https://user:secret@127.0.0.1/v1','compatible',{allowInternalModelHosts:true}),e=>e.code==='INVALID_MODEL_URL');
  }finally{if(saved===undefined)delete process.env.MODEL_ALLOWED_HOSTS;else process.env.MODEL_ALLOWED_HOSTS=saved;}
});

test('safe inline preview, forced downloads and bounded document pages',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'xrag-preview-')),saved={ADMIN_USERNAME:process.env.ADMIN_USERNAME,ADMIN_PASSWORD:process.env.ADMIN_PASSWORD};delete process.env.ADMIN_USERNAME;delete process.env.ADMIN_PASSWORD;
  const app=await createApp({dataDir:dir,startWorker:false}),server=http.createServer(app.handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const baseUrl='http://127.0.0.1:'+server.address().port;let cookie;
  const request=async(method,route,body,as=cookie)=>{const r=await fetch(baseUrl+route,{method,headers:{origin:'http://localhost:5173',...(as?{cookie:as}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const bytes=Buffer.from(await r.arrayBuffer());return {status:r.status,headers:r.headers,body:bytes,data:r.headers.get('content-type')?.includes('application/json')?JSON.parse(bytes.toString()):null};};
  try{
    const initial=await request('POST','/api/setup',{username:'preview-admin',password:'PreviewPassword123!'});cookie=initial.headers.get('set-cookie').split(';')[0];const baseId=(await request('GET','/api/bases')).data.bases[0].id;
    const upload=async(fileName,content,sensitivity='internal')=>(await request('POST','/api/documents',{baseId,fileName,contentBase64:Buffer.from(content).toString('base64'),duplicateAction:'copy',sensitivity})).data.document;
    const pdf=await upload('preview.pdf','%PDF-1.4\n% test fixture\n%%EOF');
    const image=await upload('preview.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6U1IAAAAASUVORK5CYII=','base64'),'confidential');
    const html=await upload('untrusted.html','<script>alert(document.cookie)</script>');
    const spoof=await upload('spoof.png','<html>not an image</html>');
    let r=await request('GET','/api/documents/'+pdf.id+'/preview');assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/^inline/);assert.equal(r.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('cache-control'),/no-store/);
    r=await request('GET','/api/documents/'+image.id+'/preview');assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');
    assert.equal((await request('GET','/api/documents/'+html.id+'/preview')).status,415);
    assert.equal((await request('GET','/api/documents/'+spoof.id+'/preview')).status,415);
    r=await request('GET','/api/documents/'+html.id+'/file');assert.equal(r.status,200);assert.match(r.headers.get('content-disposition'),/^attachment/);assert.match(r.headers.get('content-security-policy'),/sandbox/);
    r=await request('GET','/api/documents?limit=2&offset=1');assert.equal(r.data.documents.length,2);assert.deepEqual(r.data.pagination,{offset:1,limit:2,total:4,hasMore:true,nextOffset:3});assert.equal((await request('GET','/api/documents?limit=10000')).data.pagination.limit,500);assert.equal((await request('GET','/api/documents?offset=-1')).status,400);
    const viewer=(await request('POST','/api/users',{username:'preview-viewer',password:'ViewerPassword123!',role:'viewer',department:'其他部门'})).data.user;
    const viewerCookie=(await request('POST','/api/auth/login',{username:'preview-viewer',password:'ViewerPassword123!'})).headers.get('set-cookie').split(';')[0];app.store.put('document',{...app.store.get('document',image.id),status:'published'});
    assert.equal((await request('GET','/api/documents/'+image.id+'/preview',undefined,viewerCookie)).status,404);
    await request('PATCH','/api/users/'+viewer.id,{active:false});assert.equal((await request('GET','/api/documents/'+pdf.id+'/file',undefined,viewerCookie)).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));await app.close();for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;removeTemp(dir);}
});

test('knowledge permission changes during model generation withdraw the answer',async()=>{
  const {answerQuestion}=await import('./retrieval.mjs');
  const dir=mkdtempSync(path.join(os.tmpdir(),'xrag-revocation-')),store=createStore(dir);
  let notifyStarted,releaseResponse;const started=new Promise(resolve=>notifyStarted=resolve);
  const model=http.createServer(async(req,res)=>{for await(const chunk of req)void chunk;notifyStarted();await new Promise(resolve=>releaseResponse=resolve);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'审计整改台账须每月汇总。[1]',citations:[1],insufficient:false})}}]}));});
  await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
  try{
    const admin={id:'admin',name:'Admin',role:'admin',active:true,department:'A'},viewer={id:'viewer',name:'Viewer',role:'viewer',active:true,department:'B'};
    store.put('user',admin);store.put('user',viewer);store.put('base',{id:'restricted',ownerId:admin.id,members:[viewer.id],visibility:'private'});
    store.put('document',{id:'secret',baseId:'restricted',ownerId:admin.id,status:'published',sensitivity:'confidential',title:'审计整改制度',fileName:'审计.txt',version:1,updatedAt:new Date().toISOString()});
    store.replaceChunks('secret',[{id:'source',documentId:'secret',ordinal:0,page:1,text:'审计整改台账须每月汇总。'}]);
    store.put('setting',{id:'model',provider:'ollama',baseUrl:'http://127.0.0.1:'+model.address().port,model:'deterministic-test-model',timeoutMs:10000});
    const pending=answerQuestion(store,viewer,'审计整改台账如何汇总？',{baseId:'restricted'});await started;
    store.put('base',{...store.get('base','restricted'),members:[]});releaseResponse();
    const answer=await pending;assert.equal(answer.mode,'insufficient');assert.equal(answer.citations.length,0);assert.ok(!answer.answer.includes('每月汇总'));assert.match(answer.answer,/权限/);
  }finally{releaseResponse?.();await new Promise(resolve=>model.close(resolve));store.close();removeTemp(dir);}
});
