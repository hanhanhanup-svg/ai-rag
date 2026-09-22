import { evidenceBundleCurrent } from './intelligence.mjs';
import { knowledgeInterfaceEvidenceWithinBase } from './knowledge-interfaces.mjs';
import crypto from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { now, uid } from './database.mjs';
import { failure, requireValue, isAdmin, canBase, canDocument, isRetrievable, safeUser, issueSession, cleanString, sessionHash } from './security.mjs';
import { search, answerQuestion, validateEndpoint, usedCitations } from './retrieval.mjs';

const sendJson = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function readJson(req) { const parts=[]; let size=0; for await (const c of req) { size+=c.length; requireValue(size <= 512*1024,413,'REQUEST_TOO_LARGE','请求内容过大。'); parts.push(c); } try { const result=JSON.parse(Buffer.concat(parts).toString()||'{}'); requireValue(result && typeof result==='object' && !Array.isArray(result),400,'INVALID_JSON','请求内容须为对象。'); return result; } catch(e) { throw e.status?e:failure(400,'INVALID_JSON','请求内容不是有效 JSON。'); } }
function admin(user) { requireValue(isAdmin(user),403,'ADMIN_REQUIRED','此操作需要管理员权限。'); }
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const enabledSso = () => !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.PUBLIC_ORIGIN);
function cookie(req,name) { return req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||''; }
function oidcAddress(value) { const u=new URL(value); const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname); requireValue(u.protocol==='https:'||(process.env.OIDC_ALLOW_HTTP_LOOPBACK==='true'&&local&&u.protocol==='http:'),400,'OIDC_HTTPS_REQUIRED','统一登录地址必须使用 HTTPS。'); requireValue(!u.username&&!u.password&&!u.hash,400,'OIDC_INVALID_URL','统一登录地址无效。'); return u; }
async function fetchOidc(url, options={}) { oidcAddress(url); let r; try { r=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)}); } catch { throw failure(502,'SSO_UNAVAILABLE','统一登录服务暂不可用。'); } requireValue(r.ok,502,'SSO_UNAVAILABLE','统一登录服务返回异常，请联系管理员。'); const text=await r.text(); requireValue(text.length<512*1024,502,'SSO_RESPONSE_TOO_LARGE','统一登录响应过大。'); try{return JSON.parse(text);}catch{throw failure(502,'SSO_INVALID_RESPONSE','统一登录响应格式无效。');} }
async function oidcConfig() { const issuer=process.env.OIDC_ISSUER.replace(/\/$/,''); const config=await fetchOidc(issuer+'/.well-known/openid-configuration'); requireValue(config.issuer===issuer,502,'SSO_ISSUER_MISMATCH','统一登录颁发者不匹配。'); for(const name of ['authorization_endpoint','token_endpoint','jwks_uri'])oidcAddress(config[name]); return config; }
function redactToken(row) { const { tokenHash, ...safe }=row; return safe; }
function redactWebhook(row) { const { sealedSecret, ...safe }=row; return {...safe,hasSecret:!!sealedSecret}; }


const extensionStates = new WeakMap();
function extensionState(store) {
  let state = extensionStates.get(store);
  if (!state) { state = { stopping: false, evaluations: new Set() }; extensionStates.set(store, state); }
  return state;
}
function scheduleEvaluation(store, execute) {
  const state = extensionState(store);
  const task = new Promise(resolve => setImmediate(resolve)).then(() => execute(state));
  state.evaluations.add(task);
  task.then(() => state.evaluations.delete(task), () => state.evaluations.delete(task));
}
export async function stopExtensionTasks(store) {
  const state = extensionState(store); state.stopping = true;
  while (state.evaluations.size) await Promise.allSettled([...state.evaluations]);
}

export function evaluateKnowledgeResult(testCase,found,mode='retrieval'){
  const refs=mode==='answer'?usedCitations(found):(found.results||[]);
  const applicable=testCase.expectedDocumentId?refs.filter(r=>r.documentId===testCase.expectedDocumentId):refs;
  const text=mode==='answer'?(found.answer||''):applicable.map(r=>r.text).join('\n');
  const sourceHit=!testCase.expectedDocumentId||applicable.length>0;
  const textHit=!testCase.expectedText||text.includes(testCase.expectedText);
  const missingTerms=(testCase.expectedTerms||[]).filter(term=>!text.includes(term));
  const coverageHit=!testCase.requireCompleteEvidence||found.coverage?.complete===true;
  const completenessHit=!missingTerms.length&&coverageHit;
  const refusal=mode==='answer'?found.mode==='insufficient'&&refs.length===0:refs.length===0||found.evidence?.sufficient===false;
  const passed=testCase.mustRefuse?refusal:sourceHit&&textHit&&completenessHit&&(mode!=='answer'||found.mode==='model');
  return {ruleSnapshot:{expectedDocumentId:testCase.expectedDocumentId||null,expectedText:testCase.expectedText||'',expectedTerms:[...(testCase.expectedTerms||[])],requireCompleteEvidence:testCase.requireCompleteEvidence===true,mustRefuse:testCase.mustRefuse===true},passed,sourceHit,textHit,completenessHit,missingTerms,coverageHit,refusal,answerMode:found.mode||'retrieval',documentIds:[...new Set(refs.map(r=>r.documentId))],excerpt:text.slice(0,1000),warning:found.warning||null,...(found.coverage?{coverage:found.coverage}:{})};
}

export async function handleExtension(ctx) {
  const {req,res,url,pathname,method,user,store}=ctx;
  const respond=(status,data)=>{sendJson(res,status,data);return true;};
  if(pathname==='/api/auth/sso/status'&&method==='GET') return respond(200,{enabled:enabledSso(),name:process.env.OIDC_LABEL||'企业统一登录'});
  if(pathname==='/api/auth/sso/start'&&method==='GET') {
    requireValue(enabledSso(),503,'SSO_NOT_CONFIGURED','企业统一登录尚未配置。'); const config=await oidcConfig();
    const state=crypto.randomBytes(32).toString('base64url'),nonce=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
    for(const old of store.list('oidcState')) if(old.expiresAt<Date.now())store.del('oidcState',old.id);
    const browser=crypto.randomBytes(32).toString('base64url'); store.put('oidcState',{id:hash(state),nonce,verifier,browserHash:hash(browser),expiresAt:Date.now()+5*60000});
    const callback=process.env.PUBLIC_ORIGIN.replace(/\/$/,'')+'/api/auth/sso/callback'; const redirect=new URL(config.authorization_endpoint);
    const params={client_id:process.env.OIDC_CLIENT_ID,redirect_uri:callback,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'};
    for(const [key,value]of Object.entries(params))redirect.searchParams.set(key,value);
    res.setHeader('Set-Cookie','xrag_oidc='+browser+'; Path=/api/auth/sso; HttpOnly; SameSite=Lax; Max-Age=300'+(process.env.PUBLIC_ORIGIN.startsWith('https:')?'; Secure':''));res.writeHead(302,{Location:redirect.toString(),'Cache-Control':'no-store'});res.end();return true;
  }
  if(pathname==='/api/auth/sso/callback'&&method==='GET') {
    requireValue(enabledSso(),503,'SSO_NOT_CONFIGURED','企业统一登录尚未配置。'); const state=url.searchParams.get('state')||'',saved=store.get('oidcState',hash(state));
    requireValue(saved&&saved.expiresAt>Date.now()&&saved.browserHash===hash(cookie(req,'xrag_oidc')),400,'SSO_STATE_INVALID','统一登录状态已失效，请重新登录。'); store.del('oidcState',saved.id);
    requireValue(!url.searchParams.get('error')&&url.searchParams.get('code'),400,'SSO_CANCELLED','统一登录未完成，请重试。');const config=await oidcConfig();
    const form=new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:process.env.PUBLIC_ORIGIN.replace(/\/$/,'')+'/api/auth/sso/callback',client_id:process.env.OIDC_CLIENT_ID,code_verifier:saved.verifier}); if(process.env.OIDC_CLIENT_SECRET)form.set('client_secret',process.env.OIDC_CLIENT_SECRET);
    const result=await fetchOidc(config.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form.toString()}); requireValue(typeof result.id_token==='string',502,'SSO_ID_TOKEN_MISSING','统一登录未返回身份凭据。');
    const jwks=await fetchOidc(config.jwks_uri); let payload;
    try { ({payload}=await jwtVerify(result.id_token,createLocalJWKSet(jwks),{issuer:config.issuer,audience:process.env.OIDC_CLIENT_ID,algorithms:['RS256','PS256','ES256'],requiredClaims:['sub','iat','exp'],maxTokenAge:'10m',clockTolerance:30})); } catch { throw failure(401,'SSO_TOKEN_INVALID','统一登录身份校验失败。'); }
    requireValue(payload.nonce===saved.nonce&&payload.email_verified===true&&typeof payload.email==='string'&&(typeof payload.aud!=='object'||payload.aud.length<2||payload.azp===process.env.OIDC_CLIENT_ID),401,'SSO_IDENTITY_INVALID','统一登录的邮箱或登录校验未通过。');
    const account=store.list('user').find(u=>u.username.toLowerCase()===payload.email.toLowerCase()&&u.active);requireValue(account,403,'SSO_ACCOUNT_NOT_PROVISIONED','请先由管理员为该企业邮箱创建并授权账号。');
    const binding=store.get('oidcBinding',account.id);requireValue(!binding||(binding.issuer===config.issuer&&binding.subject===payload.sub),403,'SSO_BINDING_MISMATCH','该账号的统一登录身份不匹配。'); if(!binding)store.put('oidcBinding',{id:account.id,issuer:config.issuer,subject:payload.sub,createdAt:now()});
    issueSession(res,account,store);store.audit(account,'auth.sso_login',{message:'统一登录校验成功'});res.writeHead(302,{Location:process.env.PUBLIC_ORIGIN.replace(/\/$/,'')+'/workspace/overview','Cache-Control':'no-store'});res.end();return true;
  }
  if(pathname.startsWith('/api/service/')) {
    const raw=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];requireValue(raw&&raw.length<300,401,'SERVICE_TOKEN_REQUIRED','需要有效的应用访问令牌。');
    const token=store.list('serviceToken').find(t=>t.tokenHash===hash(raw));requireValue(token?.active&&Date.parse(token.expiresAt)>Date.now(),401,'SERVICE_TOKEN_INVALID','应用访问令牌已过期或停用。');
    const account=store.get('user',token.userId);requireValue(account?.active,401,'SERVICE_ACCOUNT_DISABLED','应用所属账号已停用。');ctx.rate?.('service:'+token.id,30,60000);
    const input=method==='POST'?await readJson(req):{};const baseId=input.baseId||url.searchParams.get('baseId'); const allowed=token.baseIds.filter(id=>canBase(account,store.get('base',id)));requireValue(!baseId||allowed.includes(baseId),403,'SERVICE_SCOPE_DENIED','该应用无权使用此知识库。');
    store.put('serviceToken',{...token,lastUsedAt:now(),calls:(token.calls||0)+1});
    if(pathname==='/api/service/search'&&method==='GET') { const q=cleanString(url.searchParams.get('q'),1000);requireValue(q,400,'QUERY_REQUIRED','请提供搜索问题。'); const batches=await Promise.all((baseId?[baseId]:allowed).map(id=>search(store,account,q,{baseId:id,learningSourceBaseId:id,limit:10})));const fresh=store.get('serviceToken',token.id);const current=store.get('user',account.id);requireValue(fresh?.active&&current?.active&&Date.parse(fresh.expiresAt)>Date.now(),401,'SERVICE_TOKEN_INVALID','应用授权已失效。');const results=batches.flatMap(b=>b.results).filter(r=>fresh.baseIds.includes(r.baseId)&&canDocument(current,store.get('document',r.documentId),store)&&isRetrievable(store.get('document',r.documentId))).sort((a,b)=>b.score-a.score).slice(0,20);store.audit(account,'service.search',{target:token.id,message:'应用检索',resultCount:results.length});return respond(200,{query:q,results}); }
    if(pathname==='/api/service/answer'&&method==='POST') { requireValue(baseId,400,'BASE_REQUIRED','应用问答必须指定已授权的知识库。');const question=cleanString(input.question,4000);requireValue(question,400,'QUESTION_REQUIRED','请提供问题。');const answer=await answerQuestion(store,account,question,{baseId,learningSourceBaseId:baseId});const freshToken=store.get('serviceToken',token.id);requireValue(freshToken?.active&&Date.parse(freshToken.expiresAt)>Date.now()&&freshToken.baseIds.includes(baseId),403,'SERVICE_SCOPE_CHANGED','应用授权已变更，请重新请求。');const currentAccount=store.get('user',account.id);requireValue(currentAccount?.active&&canBase(currentAccount,store.get('base',baseId))&&evidenceBundleCurrent(store,currentAccount,answer)&&knowledgeInterfaceEvidenceWithinBase(store,answer,baseId,currentAccount),403,'SERVICE_SCOPE_CHANGED','应用账号或回答依据范围已变更，请重新请求。');store.audit(currentAccount,'service.answer',{target:token.id,message:'应用问答',mode:answer.mode});return respond(200,answer); }
    throw failure(404,'SERVICE_ROUTE_NOT_FOUND','应用服务接口不存在。');
  }
  if(pathname==='/api/service-tokens'&&method==='GET') {admin(user);return respond(200,{tokens:store.list('serviceToken').map(redactToken)});}
  if(pathname==='/api/service-tokens'&&method==='POST') {admin(user);const input=await readJson(req),name=cleanString(input.name,120),baseIds=[...new Set(input.baseIds||[])];requireValue(name&&baseIds.length>0,400,'TOKEN_SCOPE_REQUIRED','请填写应用名称并选择授权知识库。');for(const id of baseIds)requireValue(canBase(user,store.get('base',id)),403,'BASE_DENIED','知识库无权访问。');const raw='xrag_'+crypto.randomBytes(36).toString('base64url'),expiresAt=new Date(Date.now()+Math.max(1,Math.min(365,Number(input.days)||90))*86400000).toISOString();const row={id:uid('token_'),name,userId:user.id,baseIds,tokenHash:hash(raw),active:true,createdAt:now(),expiresAt,lastUsedAt:null,calls:0};store.put('serviceToken',row);store.audit(user,'service_token.created',{target:row.id,message:name});return respond(201,{token:redactToken(row),secret:raw});}
  const tokenMatch=pathname.match(/^\/api\/service-tokens\/([^/]+)$/);if(tokenMatch&&method==='DELETE'){admin(user);const row=store.get('serviceToken',tokenMatch[1]);requireValue(row,404,'TOKEN_NOT_FOUND','令牌不存在。');store.put('serviceToken',{...row,active:false,revokedAt:now()});store.audit(user,'service_token.revoked',{target:row.id});return respond(200,{revoked:true});}
  if(pathname==='/api/evaluations'&&method==='GET'){admin(user);return respond(200,{cases:store.list('evalCase'),runs:store.list('evalRun').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30).map(run=>({...run,results:(run.results||[]).map(result=>(result.documentIds||[]).some(id=>{const doc=store.get('document',id);return !canDocument(user,doc,store)||!isRetrievable(doc);})?{...result,excerpt:'',documentIds:[],evidenceWithdrawn:true,warning:'关联资料已删除、下架或权限变化，历史正文摘录已隐藏。'}:result)}))});}
  if(pathname==='/api/evaluations/cases'&&method==='POST'){admin(user);const input=await readJson(req);requireValue(cleanString(input.question,2000),400,'QUESTION_REQUIRED','请填写测试问题。');requireValue(input.expectedTerms===undefined||(Array.isArray(input.expectedTerms)&&input.expectedTerms.length<=20&&input.expectedTerms.every(t=>typeof t==='string'&&t.trim().length>0&&t.length<=200)),400,'EXPECTED_TERMS_INVALID','必要关键词最多20条，每条1至200字。');if(input.baseId)requireValue(canBase(user,store.get('base',input.baseId)),404,'BASE_NOT_FOUND','知识库不存在。');if(input.expectedDocumentId){const doc=store.get('document',input.expectedDocumentId);requireValue(canDocument(user,doc,store)&&isRetrievable(doc),400,'EXPECTED_DOCUMENT_INVALID','标准依据须是可访问的已发布文档。');}requireValue(input.mustRefuse===true||input.expectedDocumentId||cleanString(input.expectedText,1000)||input.expectedTerms?.length,400,'EXPECTED_EVIDENCE_REQUIRED','请指定预期文档、关键词，或勾选无依据问题。');const row={id:uid('case_'),question:cleanString(input.question,2000),baseId:input.baseId||null,expectedDocumentId:input.expectedDocumentId||null,expectedText:cleanString(input.expectedText,1000),expectedTerms:(input.expectedTerms||[]).map(t=>cleanString(t,200)),requireCompleteEvidence:input.requireCompleteEvidence===true,mustRefuse:input.mustRefuse===true,createdAt:now(),ownerId:user.id};store.put('evalCase',row);return respond(201,{case:row});}
  const caseMatch=pathname.match(/^\/api\/evaluations\/cases\/([^/]+)$/);if(caseMatch&&method==='DELETE'){admin(user);store.del('evalCase',caseMatch[1]);return respond(200,{deleted:true});}
  if(pathname==='/api/evaluations/run'&&method==='POST'){
    admin(user);requireValue(!extensionState(store).stopping,503,'SERVICE_STOPPING','服务正在停止，暂不接受新评测。');ctx.rate?.('eval:'+user.id,2,60000);const input=await readJson(req),mode=input.mode==='answer'?'answer':'retrieval';const cases=store.list('evalCase');requireValue(cases.length>0&&cases.length<=100,400,'EVAL_CASES_REQUIRED','请先准备 1–100 条评测问题。');requireValue(!store.list('evalRun').some(r=>r.status==='running'),409,'EVAL_RUNNING','已有评测正在进行。');
    const run={id:uid('eval_'),status:'running',mode,total:cases.length,completed:0,passed:0,createdAt:now(),userId:user.id,results:[]};store.put('evalRun',run);
    scheduleEvaluation(store,async lifecycle=>{try{for(const c of cases){if(lifecycle.stopping){run.status='interrupted';run.error='服务停止，剩余问题未执行，请重新运行。';run.completedAt=now();store.put('evalRun',{...run});return;}const started=Date.now();let result;try{const found=mode==='answer'?await answerQuestion(store,user,c.question,{baseId:c.baseId||''}):await search(store,user,c.question,{baseId:c.baseId||'',limit:8});result={caseId:c.id,question:c.question,...evaluateKnowledgeResult(c,found,mode),latencyMs:Date.now()-started};}catch(e){result={caseId:c.id,question:c.question,passed:false,error:e.message,latencyMs:Date.now()-started};}run.results.push(result);run.completed++;if(result.passed)run.passed++;store.put('evalRun',{...run});}run.status='completed';run.completedAt=now();run.passRate=run.passed/run.total;store.put('evalRun',run);store.audit(user,'evaluation.completed',{target:run.id,message:'评测完成：'+run.passed+'/'+run.total});}catch(e){store.put('evalRun',{...run,status:'failed',error:e.message,completedAt:now()});}});
    return respond(202,{run});
  }
  if(pathname==='/api/webhooks'&&method==='GET'){admin(user);return respond(200,{webhooks:store.list('webhook').map(redactWebhook),deliveries:store.list('webhookDelivery').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)});}
  if(pathname==='/api/webhooks'&&method==='POST'){admin(user);const input=await readJson(req),name=cleanString(input.name,120);requireValue(name,400,'NAME_REQUIRED','请填写名称。');const target=await validateEndpoint(input.url,'compatible');const events=Array.isArray(input.events)?input.events.filter(x=>['document.published','document.archived','document.upload','document.parse_failed'].includes(x)):['document.published','document.archived'];requireValue(events.length,400,'EVENTS_REQUIRED','请选择通知事件。');const row={id:uid('hook_'),name,url:target,events,active:true,lastAuditRow:Number(store.db.prepare('SELECT COALESCE(MAX(rowid),0) AS n FROM audit').get().n),sealedSecret:store.seal(crypto.randomBytes(32).toString('base64url')),createdAt:now()};store.put('webhook',row);store.audit(user,'webhook.created',{target:row.id,message:name});return respond(201,{webhook:redactWebhook(row),secret:store.unseal(row.sealedSecret)});}
  const hookMatch=pathname.match(/^\/api\/webhooks\/([^/]+)(?:\/(test))?$/);if(hookMatch){admin(user);const hook=store.get('webhook',hookMatch[1]);requireValue(hook,404,'WEBHOOK_NOT_FOUND','通知配置不存在。');if(method==='DELETE'&&!hookMatch[2]){store.put('webhook',{...hook,active:false});return respond(200,{disabled:true});}if(method==='POST'&&hookMatch[2]==='test'){requireValue(hook.active,409,'WEBHOOK_DISABLED','通知已停用，请创建新的通知配置。');ctx.rate?.('hooktest:'+user.id,5,60000);const result=await deliverWebhook(store,hook,{id:uid('event_'),action:'test',createdAt:now(),documentId:null});requireValue(result.success,502,'WEBHOOK_DELIVERY_FAILED','通知请求失败，请查看投递记录。');return respond(200,{delivery:result});}}
  if(pathname==='/api/integration/status'&&method==='GET'){admin(user);return respond(200,{sso:{enabled:enabledSso(),issuer:process.env.OIDC_ISSUER||'',name:process.env.OIDC_LABEL||'企业统一登录',accountMapping:'以已验证邮箱匹配现有账号，不自动授予权限'},serviceApi:{search:'/api/service/search',answer:'/api/service/answer',authentication:'Bearer',readOnly:true}});}
  return false;
}

export async function deliverWebhook(store, hook, event, deliveryId) {
  const previous = deliveryId && store.get('webhookDelivery', deliveryId);
  const envelope = { id: event.id, action: event.action, createdAt: event.createdAt, documentId: event.documentId || null };
  const row = { id: deliveryId || uid('delivery_'), hookId: hook.id, eventId: event.id, action: event.action, createdAt: previous?.createdAt || now(), event: envelope, attempts: previous?.attempts || 0, status: 'pending', success: false, nextAttemptAt: null };
  const current = store.get('webhook', hook.id);
  if (!current?.active) { Object.assign(row, { status: 'cancelled', error: '通知已停用，未发起新的投递', updatedAt: now() }); store.put('webhookDelivery', row); return row; }
  row.attempts++;
  // Persist the immutable event envelope before I/O. An interrupted send remains recoverable.
  store.put('webhookDelivery', row);
  const payload = { id: envelope.id, event: envelope.action, occurredAt: envelope.createdAt, documentId: envelope.documentId };
  const text = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const endpoint = await validateEndpoint(current.url, 'compatible');
    const authorized = store.get('webhook', hook.id);
    if (!authorized?.active) { Object.assign(row, { status: 'cancelled', error: '通知已停用，未发起新的投递', updatedAt: now() }); store.put('webhookDelivery', row); return row; }
    const signature = crypto.createHmac('sha256', store.unseal(authorized.sealedSecret)).update(timestamp + '.' + text).digest('hex');
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-XRAG-Timestamp': timestamp, 'X-XRAG-Signature': 'sha256=' + signature, 'X-XRAG-Event-ID': envelope.id }, body: text, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.body) await response.body.cancel();
    row.httpStatus = response.status; row.success = response.ok; row.status = response.ok ? 'delivered' : 'failed'; row.error = response.ok ? null : '接收服务返回 HTTP ' + response.status;
  } catch { row.success = false; row.status = 'failed'; row.error = '通知地址连接失败或不在允许范围'; }
  row.updatedAt = now(); row.nextAttemptAt = !row.success && row.attempts < 3 ? Date.now() + row.attempts * 60000 : null;
  if (!store.get('webhook', hook.id)?.active) row.nextAttemptAt = null;
  store.put('webhookDelivery', row); return row;
}

export function startExtensions(store) {
  let stopped = false, busy = false, currentTick = Promise.resolve();
  const lifecycle = extensionState(store); lifecycle.stopping = false;
  for (const run of store.list('evalRun').filter(run => run.status === 'running')) store.put('evalRun', { ...run, status: 'interrupted', error: '服务重启中断了该评测，请重新运行。', completedAt: now() });
  for (const row of store.list('webhookDelivery').filter(row => row.status === 'pending')) {
    const active = store.get('webhook', row.hookId)?.active;
    store.put('webhookDelivery', { ...row, status: active ? 'failed' : 'cancelled', error: active ? '上次发送被中断，待重新投递' : '通知已停用', nextAttemptAt: active && row.attempts < 3 ? Date.now() : null, updatedAt: now() });
  }
  async function tick() {
    if (stopped || busy) return; busy = true;
    try {
      for (const hook of store.list('webhook').filter(hook => hook.active)) {
        if (stopped) break;
        const batch = store.db.prepare('SELECT rowid AS sequence,data FROM audit WHERE rowid>? ORDER BY rowid LIMIT 200').all(hook.lastAuditRow || 0);
        let cursor = hook.lastAuditRow || 0;
        for (const row of batch) {
          if (stopped || !store.get('webhook', hook.id)?.active) break;
          const event = JSON.parse(row.data), id = hash(hook.id + ':' + event.id);
          if (hook.events.includes(event.action) && !store.get('webhookDelivery', id)) await deliverWebhook(store, hook, event, id);
          cursor = Number(row.sequence);
        }
        const current = store.get('webhook', hook.id);
        if (current) store.put('webhook', { ...current, lastAuditRow: cursor, lastEventAt: now() });
      }
      for (const row of store.list('webhookDelivery').filter(row => row.nextAttemptAt && row.nextAttemptAt <= Date.now())) {
        if (stopped) break;
        const hook = store.get('webhook', row.hookId), record = row.event ? null : store.db.prepare('SELECT data FROM audit WHERE id=?').get(row.eventId), event = row.event || (record ? JSON.parse(record.data) : null);
        if (hook?.active && event) await deliverWebhook(store, hook, event, row.id);
        else store.put('webhookDelivery', { ...row, status: hook?.active ? 'failed' : 'cancelled', nextAttemptAt: null, error: '通知已停用或原事件不可用' });
      }
    } catch {} finally { busy = false; }
  }
  const timer = setInterval(() => { if (stopped || busy) return currentTick; currentTick = tick(); return currentTick; }, 5000); timer.unref();
  return async () => { stopped = true; clearInterval(timer); const evaluations = stopExtensionTasks(store); await Promise.allSettled([currentTick, evaluations]); };
}