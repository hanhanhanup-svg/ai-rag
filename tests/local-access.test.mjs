import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createApp } from '../server/api.mjs';
import { createLocalAccess } from '../server/local-access.mjs';

const ENV_KEYS=['AUTH_MODE','API_HOST','ADMIN_USERNAME','ADMIN_PASSWORD','ADMIN_NAME','LOCAL_EMBEDDINGS_ENABLED','EMBEDDING_BASE_URL','EMBEDDING_MODEL','EMBEDDING_API_KEY','ALLOWED_ORIGINS'];
async function fixture(run){
  const saved=Object.fromEntries(ENV_KEYS.map(key=>[key,process.env[key]])),dir=mkdtempSync(path.join(os.tmpdir(),'xrag-local-access-'));
  let app=null,server=null,port=0;
  process.env.API_HOST='127.0.0.1';process.env.LOCAL_EMBEDDINGS_ENABLED='false';process.env.ALLOWED_ORIGINS='http://localhost:5173';
  for(const key of ['ADMIN_USERNAME','ADMIN_PASSWORD','ADMIN_NAME','EMBEDDING_BASE_URL','EMBEDDING_MODEL','EMBEDDING_API_KEY'])delete process.env[key];
  const close=async()=>{if(server){const current=server;server=null;await new Promise(resolve=>current.close(resolve));}if(app){const current=app;app=null;await current.close();}};
  const open=async mode=>{process.env.AUTH_MODE=mode;app=await createApp({dataDir:dir,startWorker:false});app.store.put('setting',{id:'model',provider:'disabled'});server=http.createServer(app.handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;return app;};
  const request=(method,route,{body,cookie,headers={}}={})=>new Promise((resolve,reject)=>{
    const requestHeaders={...(body===undefined?{}:{'content-type':'application/json',origin:'http://localhost:5173'}),...(cookie?{cookie}:{}),...headers};
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:requestHeaders},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const bytes=Buffer.concat(chunks);let data=null;try{if(res.headers['content-type']?.includes('application/json'))data=JSON.parse(bytes.toString());}catch(error){reject(error);return;}resolve({status:res.statusCode,headers:res.headers,bytes,data,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});});res.on('error',reject);});
    req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();
  });
  try{await run({open,close,request,dir,get app(){return app;}});}
  finally{await close();for(const[key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));rmSync(dir,{recursive:true,force:true});}
}

test('local access needs no cookie, persists its actor and knowledge, and safely returns to password setup',async()=>fixture(async ctx=>{
  let app=await ctx.open('local');
  let response=await ctx.request('GET','/api/setup');assert.equal(response.status,200);assert.deepEqual(response.data,{required:false,authMode:'local'});assert.equal(response.headers['set-cookie'],undefined);
  response=await ctx.request('GET','/api/auth/me');assert.equal(response.status,200);const actor=response.data.user;assert.equal(actor.authMode,'local');assert.equal(actor.localOnly,true);assert.equal(actor.role,'admin');assert.equal(response.headers['set-cookie'],undefined);assert.equal(app.store.get('user',actor.id).passwordHash,null);
  response=await ctx.request('GET','/api/bases');assert.equal(response.status,200);assert.equal(response.headers['set-cookie'],undefined);const baseId=response.data.bases[0].id;
  const text='本机免登录模式上传的业务知识必须完整保留，恢复账号登录后继续可用。';
  response=await ctx.request('POST','/api/documents',{body:{baseId,fileName:'免登录资料.txt',contentBase64:Buffer.from(text).toString('base64'),duplicateAction:'copy'}});assert.equal(response.status,201);assert.equal(response.headers['set-cookie'],undefined);const documentId=response.data.document.id;assert.equal(response.data.document.ownerId,actor.id);
  await app.runQueue();response=await ctx.request('POST','/api/documents/'+documentId+'/actions',{body:{action:'publish'}});assert.equal(response.status,200);assert.equal(response.headers['set-cookie'],undefined);
  assert.equal(Number(app.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n),0);assert.equal(app.store.events().find(e=>e.action==='document.upload').actorId,actor.id);
  assert.equal((await ctx.request('POST','/api/auth/login',{body:{username:'unused',password:'UnusedPassword123!'}})).status,409);
  await ctx.close();app=await ctx.open('local');
  response=await ctx.request('GET','/api/auth/me',{cookie:'xrag_session=not-a-session'});assert.equal(response.status,200);assert.equal(response.data.user.id,actor.id);assert.equal(response.headers['set-cookie'],undefined);
  response=await ctx.request('GET','/api/documents/'+documentId);assert.equal(response.status,200);assert.equal(response.data.document.status,'published');assert.ok(response.data.chunks.some(c=>c.text.includes(text)));assert.equal(app.store.list('user').filter(u=>u.localOnly).length,1);assert.equal(Number(app.store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n),0);
  const baseCount=app.store.list('base').length;
  await ctx.close();app=await ctx.open('password');
  assert.equal(app.store.get('user',actor.id).active,false);assert.equal((await ctx.request('GET','/api/auth/me')).status,401);assert.equal((await ctx.request('GET','/api/bases')).status,401);assert.equal((await ctx.request('GET','/api/setup')).data.required,true);
  response=await ctx.request('POST','/api/setup',{body:{username:'real-admin',name:'正式管理员',password:'RealAdminPassword123!'}});assert.equal(response.status,201);assert.ok(response.cookie);assert.equal(response.data.user.localOnly,undefined);const passwordCookie=response.cookie;
  assert.equal(app.store.list('base').length,baseCount);assert.ok(app.store.get('base',baseId));assert.ok(app.store.get('document',documentId));assert.equal(app.store.get('user',actor.id).passwordHash,null);
  response=await ctx.request('GET','/api/documents/'+documentId,{cookie:passwordCookie});assert.equal(response.status,200);assert.equal(response.data.document.ownerId,actor.id);
  response=await ctx.request('GET','/api/documents/'+documentId+'/file',{cookie:passwordCookie});assert.equal(response.status,200);assert.equal(response.bytes.toString(),text);assert.equal((await ctx.request('GET','/api/setup')).data.required,false);
}));

test('switching local access on and off preserves existing password identities',async()=>fixture(async ctx=>{
  let app=await ctx.open('password');
  let response=await ctx.request('POST','/api/setup',{body:{username:'existing-admin',password:'ExistingAdmin123!'}});assert.equal(response.status,201);const realId=response.data.user.id,adminCookie=response.cookie;
  response=await ctx.request('POST','/api/users',{cookie:adminCookie,body:{username:'existing-editor',name:'原有知识管理员',password:'ExistingEditor123!',role:'editor',department:'研发'}});assert.equal(response.status,201);const editorId=response.data.user.id;
  const adminHash=app.store.get('user',realId).passwordHash,editorHash=app.store.get('user',editorId).passwordHash,baseIds=app.store.list('base').map(b=>b.id);
  await ctx.close();app=await ctx.open('local');
  response=await ctx.request('GET','/api/auth/me',{cookie:adminCookie});assert.equal(response.status,200);const localId=response.data.user.id;assert.notEqual(localId,realId);assert.equal(response.data.user.localOnly,true);assert.equal(response.headers['set-cookie'],undefined);
  assert.equal(app.store.get('user',realId).passwordHash,adminHash);assert.equal(app.store.get('user',editorId).passwordHash,editorHash);assert.equal(app.store.get('user',editorId).role,'editor');assert.deepEqual(app.store.list('base').map(b=>b.id),baseIds);assert.equal((await ctx.request('GET','/api/setup')).data.required,false);
  await ctx.close();app=await ctx.open('password');
  assert.equal((await ctx.request('GET','/api/auth/me')).status,401);assert.equal((await ctx.request('GET','/api/setup')).data.required,false);assert.equal(app.store.get('user',localId).active,false);
  response=await ctx.request('POST','/api/auth/login',{body:{username:'existing-admin',password:'ExistingAdmin123!'}});assert.equal(response.status,200);assert.equal(response.data.user.id,realId);assert.equal(response.data.user.role,'admin');
  response=await ctx.request('POST','/api/auth/login',{body:{username:'existing-editor',password:'ExistingEditor123!'}});assert.equal(response.status,200);assert.equal(response.data.user.id,editorId);assert.equal(response.data.user.role,'editor');assert.equal(response.data.user.department,'研发');
  assert.equal(app.store.get('user',realId).passwordHash,adminHash);assert.equal(app.store.get('user',editorId).passwordHash,editorHash);
  assert.equal((await ctx.request('POST','/api/auth/login',{body:{username:'__local_workspace__',password:'AnyPassword123!'}})).status,401);
}));

test('local access rejects unsafe binding, host, forwarding headers, origins and non-loopback peers',async()=>fixture(async ctx=>{
  process.env.AUTH_MODE='local';
  for(const host of ['0.0.0.0','::','192.0.2.10','example.com']){process.env.API_HOST=host;await assert.rejects(createApp({dataDir:ctx.dir,startWorker:false}),error=>error.code==='LOCAL_ACCESS_BIND_REQUIRED');assert.equal(existsSync(path.join(ctx.dir,'.writer.lock')),false);}
  process.env.API_HOST='127.0.0.1';const app=await ctx.open('local');
  for(const headers of [
    {host:'outside.example'},
    {host:'192.0.2.10'},
    {forwarded:'for=192.0.2.10;host=localhost'},
    {'x-forwarded-for':'192.0.2.10'},
    {'x-forwarded-host':'localhost'},
    {'x-real-ip':'192.0.2.10'},
    {origin:'https://outside.example'},
    {origin:'null'}
  ]){const response=await ctx.request('GET','/api/auth/me',{headers});assert.equal(response.status,403);assert.equal(response.data.error.code,'LOCAL_ACCESS_ONLY');assert.equal(response.headers['set-cookie'],undefined);}
  let response=await ctx.request('POST','/api/bases',{body:{name:'禁止外部页面写入'},headers:{origin:'https://outside.example'}});assert.equal(response.status,403);assert.equal(response.data.error.code,'LOCAL_ACCESS_ONLY');assert.equal(app.store.list('base').length,1);
  response=await ctx.request('GET','/api/auth/me',{headers:{host:'localhost',origin:'http://localhost:5173'}});assert.equal(response.status,200);assert.equal(response.headers['set-cookie'],undefined);
  // A direct guard assertion covers an actual non-loopback peer without exposing a listening service to the LAN.
  const guard=createLocalAccess(app.store,()=>{throw new Error('The existing default base must be reused.');});
  assert.throws(()=>guard.assertRequest({headers:{host:'localhost'},socket:{remoteAddress:'192.0.2.10'}}),error=>error.code==='LOCAL_ACCESS_ONLY');
}));
