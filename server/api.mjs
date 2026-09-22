import { handleKnowledgeInterfaces } from './knowledge-interfaces.mjs';
import { learnFeedback, feedbackLearningStatus, getLearningBase } from './feedback-learning.mjs';
import {handleWorkspace} from './workspace.mjs';
import { canManageTrashedDocument, moveDocumentToTrash, restoreDocumentFromTrash, cancelDeletedDocumentTasks } from './document-trash.mjs';
import http from 'node:http';
import {handleIntelligence,startIntelligence,stopIntelligence,evidenceBundleCurrent} from './intelligence.mjs';
import {instrumentRequest,traceStep,withTrace} from './model-observability.mjs';
import {handleKnowledgeUpgrade,knowledgePresentationPolicy,createKnowledgeUpgradeWorker} from './knowledge-upgrade.mjs';
import {documentApplications} from './knowledge-checks.mjs';
import {handleRecommendations,recommendationSignature} from './recommendations.mjs';
import {handleUnifiedSearch} from './unified-search.mjs';
import {handleKnowledgeAttributes} from './knowledge-attributes.mjs';
import {handleKnowledgeCards} from './knowledge-cards.mjs';
import {handleAnswerCompleteness} from './answer-completeness.mjs';
import {handleKnowledgeDemands} from './knowledge-demands.mjs';
import {MEDIA_MIME_TYPES,validMediaHeader,sendStoredFile} from './media-preview.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync, readdirSync, realpathSync, lstatSync, copyFileSync, unlinkSync, createReadStream, openSync, readSync, closeSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';
import { createStore, now, uid } from './database.mjs';
import { accountUsers, createLocalAccess } from './local-access.mjs';
import { parserMessages, governanceMetadata, documentIssues, applyGovernanceAction } from './governance.mjs';
import { listSourceCategories, updateSourceCategories, resolveSourceCategory } from './source-categories.mjs';
import { uploadGuidanceTarget, generateUploadApplicability } from './upload-guidance.mjs';
import { indexSnapshot, indexSnapshotCurrent, indexRetryAfterFailure, indexRetryAllowed, clearIndexRetry } from './index-scheduling.mjs';
import { failure, requireValue, passwordHash, verifyPassword, safeUser, isAdmin, canEdit, canBase, canDocument, isRetrievable, authenticate, issueSession, clearSession, validateOrigin, limiter, cleanString, validateDates } from './security.mjs';
import { modelConfig, publicModel, testModel, search, answerQuestion, embeddings, validateEndpoint, embeddingEnabled, embeddingSignature } from './retrieval.mjs';
import {
  MODEL_PROVIDER_PRESETS,
  listPublicProviders,
  createModelProvider,
  updateModelProvider,
  deleteModelProvider,
  setDefaultModelProvider,
  testModelProvider,
  syncProviderFromLegacyModel,
} from './model-providers.mjs';

const projectDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MAX_FILE=100*1024*1024,MAX_BODY=145*1024*1024;
const FILE_TYPES={'.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.html':'text/html','.htm':'text/html','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.tif':'image/tiff','.tiff':'image/tiff','.bmp':'image/bmp','.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg','.flac':'audio/flac','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.tsv':'text/tab-separated-values','.markdown':'text/markdown'};
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const sortRecent=(a,b)=>String(b.createdAt).localeCompare(String(a.createdAt));
const checkRevision=(doc,value)=>{if(value!==undefined)requireValue(Number(value)===doc.revision,409,'REVISION_CONFLICT','内容已被其他人更新，请刷新后重试。');};
const requestBodies = new WeakMap();
function bodyOf(req) {
  if (requestBodies.has(req)) return requestBodies.get(req);
  const result = new Promise((resolve, reject) => {
    requireValue(req.headers['content-type']?.startsWith('application/json'), 415, 'JSON_REQUIRED', '此接口只接受 JSON 数据。');
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(failure(413, 'UPLOAD_TOO_LARGE', '请求过大，单个文件不得超过 100MB。')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); requireValue(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_JSON', '请求内容必须是对象。'); resolve(body); } catch (error) { reject(error.status ? error : failure(400, 'INVALID_JSON', 'JSON 格式不正确。')); } });
    req.on('error', reject);
  });
  requestBodies.set(req, result); return result;
}
function fileNameOf(value){const name=cleanString(value,240);requireValue(name&&name===path.basename(name)&&!/[\x00-\x1f<>:"/\\|?*]/.test(name)&&!name.endsWith('.')&&!name.endsWith(' '),400,'INVALID_FILENAME','文件名不合法。');requireValue(FILE_TYPES[path.extname(name).toLowerCase()],400,'UNSUPPORTED_FORMAT','支持 PDF、Office、文本、表格、图片与常见音视频；单件最大100MB。');return name;}
function exportedDoc(store,doc){if(!doc)return null;const {storageName,...safe}=doc;return {...safe,...parserMessages(doc),ownerName:store.get('user',doc.ownerId)?.name||'已停用用户'};}
function safeAudit(event){return {...event,time:event.createdAt,actor:event.actorName,target:event.documentTitle||event.documentId||event.target||'',detail:event.reason||event.message||event.detail||''};}
function orderedConversationMessages(store,conversationId){
  const rows=store.list('message').filter(message=>message.conversationId===conversationId);
  const hasSequence=message=>Number.isSafeInteger(message.sequence)&&message.sequence>0;
  const legacyOrder=(a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||((a.role==='user'?0:1)-(b.role==='user'?0:1))||String(a.id).localeCompare(String(b.id));
  // Existing history is read in a stable order without rewriting timestamps or
  // inventing a relationship between legacy messages that lacks a stored turn ID.
  const legacy=rows.filter(message=>!hasSequence(message)).sort(legacyOrder);
  const sequenced=rows.filter(hasSequence).sort((a,b)=>a.sequence-b.sequence||legacyOrder(a,b));
  return [...legacy,...sequenced];
}
function defaultBase(store,user){const base={id:uid('base_'),name:'企业制度知识库',description:'发布有效制度、操作指引与企业通用知识。',department:user.department,visibility:'company',ownerId:user.id,members:[],createdAt:now(),updatedAt:now()};store.put('base',base);return base;}

export async function createApp({dataDir=process.env.DATA_DIR||path.join(projectDir,'data'),startWorker=true}={}){
  const store=createStore(path.resolve(dataDir));const rate=limiter();let processing=false,closed=false,backupRunning=false,stopExtensions=null,interval=null,scheduledPromise=null,knowledgeWorker=null;

  const finishBackground=async()=>{
    if(interval)clearInterval(interval);
    await stopIntelligence(store);
    if(knowledgeWorker)await knowledgeWorker.close();
    let stopTasks;try{if(existsSync(path.join(projectDir,'server','extensions.mjs')))stopTasks=(await import('./extensions.mjs')).stopExtensionTasks;}catch{}
    await Promise.allSettled([stopExtensions?stopExtensions():null,stopTasks?stopTasks(store):null,scheduledPromise]);
    while(processing)await new Promise(resolve=>setTimeout(resolve,100));
  };
  try{
  const usage={requests:0,errors:0,completedRequests:0,totalRequestLatencyMs:0,averageLatencyMs:null,chatRequests:0,chatLatencySamples:0,totalChatLatencyMs:0,averageChatLatencyMs:null,lastChatLatencyMs:null,modelAnswers:0,extractiveAnswers:0,inputTokens:0,outputTokens:0,startedAt:now()};
  const previousMetrics=store.get('setting','metrics');if(previousMetrics)for(const key of ['chatRequests','chatLatencySamples','totalChatLatencyMs','modelAnswers','extractiveAnswers','inputTokens','outputTokens'])usage[key]=previousMetrics[key]||0;
  if(usage.chatLatencySamples>0)usage.averageChatLatencyMs=Math.round(usage.totalChatLatencyMs/usage.chatLatencySamples*10)/10;
  const audit=(user,action,detail)=>store.audit(user,action,detail);
  const getDoc=(user,id,write=false)=>{const d=store.get('document',id);requireValue(canDocument(user,d,store,{write}),404,'DOCUMENT_NOT_FOUND','文档不存在或无权访问。');return d;};
  const getBase=(user,id)=>{const b=store.get('base',id);requireValue(canBase(user,b),404,'BASE_NOT_FOUND','知识库不存在或无权访问。');return b;};
  const requireAdmin=user=>requireValue(isAdmin(user),403,'ADMIN_REQUIRED','此操作需要管理员权限。');
  const requireEditor=user=>requireValue(canEdit(user),403,'EDITOR_REQUIRED','此操作需要编辑或管理员权限。');
  const activeUser=user=>{const current=store.get('user',user?.id);requireValue(current?.active,401,'AUTH_REQUIRED','账号已停用或不存在。');return current;};
  const patchDoc=(doc,patch)=>store.put('document',{...doc,...patch,updatedAt:now(),revision:(doc.revision||0)+1});
  function taskFor(doc){const task={id:uid('task_'),documentId:doc.id,title:doc.title,status:'queued',stage:'等待解析',progress:0,error:null,attempts:0,createdAt:now(),updatedAt:now()};store.put('task',task);return task;}

  // Compared only in memory; credentials are never stored in task metadata or logs.
  const embeddingConfigurationKey=config=>JSON.stringify([config.provider,config.embeddingBaseUrl,config.embeddingModel,config.embeddingApiKey,config.timeoutMs]);
  async function indexChunks(documentId,chunks,configuration=modelConfig(store)){
    requireValue(!store.get('document',documentId)?.deletedAt,409,'DOCUMENT_IN_TRASH','文档已移入回收站，不再建立检索索引。');
    if(!embeddingEnabled(configuration)){const current=store.get('document',documentId);if(current)store.put('document',{...current,embeddingStatus:'pending',embeddingRunId:null});return {skipped:true};}
    const signature=embeddingSignature(configuration);let document=store.get('document',documentId);
    requireValue(document,404,'DOCUMENT_NOT_FOUND','文档记录不存在。');
    const snapshot=indexSnapshot(document,signature),configurationKey=embeddingConfigurationKey(configuration),runId=uid('indexrun_');
    const currentInput=()=>{const currentConfig=modelConfig(store);return indexSnapshotCurrent(snapshot,store.get('document',documentId),embeddingSignature(currentConfig))&&embeddingEnabled(currentConfig)&&embeddingConfigurationKey(currentConfig)===configurationKey;};
    const assertCurrent=()=>requireValue(currentInput()&&store.get('document',documentId)?.embeddingRunId===runId,409,'INDEX_INPUT_CHANGED','资料或模型已更新，系统将按最新内容接续检索准备。');
    store.put('document',{...document,embeddingStatus:'processing',embeddingSignature:signature,embeddingRunId:runId,embeddingError:null});
    try{
      assertCurrent();
      for(let i=0;i<chunks.length;i+=32){
        const vectors=await embeddings(store,chunks.slice(i,i+32).map(c=>c.text),{configuration});
        assertCurrent();
        if(vectors)for(let j=0;j<vectors.length;j++)store.embedding(chunks[i+j].id,vectors[j],signature);
      }
      assertCurrent();document=store.get('document',documentId);const count=store.vectorCount(documentId,signature);
      requireValue(count===chunks.length,409,'INDEX_INCOMPLETE','语义索引尚未覆盖当前全部片段，将自动重试。');
      store.put('document',{...document,embeddingStatus:'ready',embeddingSignature:signature,embeddingRunId:null,embeddingUpdatedAt:now(),embeddingError:null,warnings:(document.warnings||[]).filter(warning=>!warning.startsWith('语义索引未完成，仍可使用全文检索：')),...clearIndexRetry()});
      return {count,signature};
    }catch(error){
      document=store.get('document',documentId);
      if(!currentInput()||document?.embeddingRunId!==runId){
        if(document?.embeddingRunId===runId)store.put('document',{...document,embeddingStatus:'pending',embeddingRunId:null,embeddingError:null,...clearIndexRetry()});
        throw failure(409,'INDEX_INPUT_CHANGED','资料或模型已更新，旧索引结果未写入，系统将自动接续。');
      }
      store.put('document',{...document,embeddingStatus:'failed',embeddingSignature:signature,embeddingRunId:null,embeddingError:error.message,embeddingUpdatedAt:now(),embeddingRetry:indexRetryAfterFailure(document,signature,error)});throw error;
    }
  }
  function queueIndex(document,{force=false}={}){
    document=document?.id?store.get('document',document.id):null;if(!document||document.deletedAt)return null;
    const configuration=modelConfig(store);if(!embeddingEnabled(configuration)||!document?.chunkCount||!['review','published'].includes(document.status))return null;
    const signature=embeddingSignature(configuration);
    const old=store.list('task').find(t=>t.documentId===document.id&&t.type==='index'&&['queued','processing'].includes(t.status));
    if(old){if(force)store.put('document',{...store.get('document',document.id),...clearIndexRetry()});return old;}
    if(!force&&store.vectorCount(document.id,signature)===document.chunkCount){
      if(document.embeddingStatus!=='ready'||document.embeddingSignature!==signature)store.put('document',{...store.get('document',document.id),embeddingStatus:'ready',embeddingSignature:signature,embeddingRunId:null,embeddingError:null,...clearIndexRetry()});
      return null;
    }
    if(!indexRetryAllowed(document,signature,{force}))return null;
    const task={id:uid('task_'),type:'index',documentId:document.id,title:document.title,status:'queued',stage:'等待检索准备',progress:0,error:null,attempts:0,createdAt:now(),updatedAt:now(),embeddingSignature:signature,contentRevision:document.contentRevision||1};
    store.put('task',task);store.put('document',{...store.get('document',document.id),embeddingStatus:'queued',...(force?clearIndexRetry():{})});
    if(startWorker)setImmediate(()=>runQueue());return task;
  }
  function backfillIndexes(){const config=modelConfig(store);if(!embeddingEnabled(config))return;for(const document of store.list('document').filter(d=>!d.deletedAt&&['published','review'].includes(d.status)))queueIndex(document);}

  async function ingest(user,input,{bytes,source}={}){
    user=activeUser(user);requireEditor(user);const metadata={...governanceMetadata(input),...resolveSourceCategory(store,input.sourceCategoryId===undefined&&input.sourceKind===undefined?{sourceKind:"unspecified"}:input)};if(!metadata.businessOwner)metadata.businessOwner=user.name||user.username;const base=getBase(user,input.baseId);requireValue(base.systemKind!=='feedback_learning',400,'LEARNING_BASE_MANAGED','机器学习知识库从反馈记录生成知识，请使用反馈详情中的机器学习按钮。');const fileName=fileNameOf(input.fileName);let sensitivity=input.sensitivity||'internal';requireValue(['internal','confidential'].includes(sensitivity),400,'INVALID_SENSITIVITY','保密级别无效。');
    requireValue(['skip','version','copy'].includes(input.duplicateAction||'skip'),400,'INVALID_DUPLICATE_ACTION','重复文件处理方式无效。');validateDates(input.effectiveAt,input.expiresAt);
    if(!bytes){requireValue(typeof input.contentBase64==='string'&&input.contentBase64.length>0&&input.contentBase64.length<=Math.ceil(MAX_FILE/3)*4+4&&/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64),400,'INVALID_FILE_DATA','文件数据无效或超过 100MB。');bytes=Buffer.from(input.contentBase64,'base64');}
    requireValue(bytes.length>0&&bytes.length<=MAX_FILE,413,'UPLOAD_TOO_LARGE','文件不能为空且不得超过 100MB。');
    const sha256=crypto.createHash('sha256').update(bytes).digest('hex');const docs=store.list('document').filter(d=>d.baseId===base.id&&canDocument(user,d,store));const same=docs.filter(d=>d.sha256===sha256&&d.status!=='archived').sort((a,b)=>b.version-a.version)[0];
    const deletedDuplicate=store.list('document').find(d=>d.baseId===base.id&&d.sha256===sha256&&canManageTrashedDocument(user,d,store));
    requireValue(!deletedDuplicate||same||input.duplicateAction==='copy',409,'DOCUMENT_IN_TRASH','同一文件已在回收站，请恢复原文档，或明确选择另存副本。');
    if(same&&(input.duplicateAction||'skip')==='skip')return {document:exportedDoc(store,same),duplicate:true};
    let previous=null;
    if(input.previousVersionId){previous=getDoc(user,input.previousVersionId,true);requireValue(previous.baseId===base.id,400,'VERSION_BASE_MISMATCH','新版本必须属于同一知识库。');}
    else if(input.duplicateAction==='version')previous=docs.filter(d=>d.fileName===fileName).sort((a,b)=>b.version-a.version)[0]||same||null;
    if(previous)previous=getDoc(user,previous.id,true);
    if(previous?.sensitivity==='confidential'){if(!input.sensitivity)sensitivity='confidential';requireValue(sensitivity==='confidential'||isAdmin(user),403,'DECLASSIFICATION_ADMIN_REQUIRED','降低原文档保密级别需要管理员权限。');}
    const familyId=previous?.familyId||previous?.id||uid('family_');const version=previous?Math.max(...store.list('document').filter(d=>(d.familyId||d.id)===familyId).map(d=>d.version))+1:1;
    const id=uid('doc_'),storageName=`${id}${path.extname(fileName).toLowerCase()}`;
    writeFileSync(path.join(store.dataDir,'uploads',storageName),bytes,{flag:'wx',mode:0o600});
    const timestamp=now();const doc={id,baseId:base.id,title:cleanString(input.title,240)||fileName.replace(/\.[^.]+$/,''),fileName,mimeType:FILE_TYPES[path.extname(fileName).toLowerCase()],storageName,size:bytes.length,sha256,version,familyId,status:'queued',stage:'等待解析',progress:0,error:null,ownerId:user.id,department:base.department||user.department,sensitivity,createdAt:timestamp,updatedAt:timestamp,effectiveAt:input.effectiveAt||null,expiresAt:input.expiresAt||null,chunkCount:0,pageCount:0,tags:[],summary:'',previousVersionId:previous?.id||null,revision:1,contentRevision:1,notes:[],sourceKind:'unspecified',reviewDueAt:null,...metadata,...(source?{source}:{})};
    store.transaction(()=>{store.put('document',doc);taskFor(doc);audit(user,'document.upload',{documentId:id,documentTitle:doc.title,baseId:base.id,sha256,version});});
    if(startWorker)setImmediate(()=>runQueue());return {document:exportedDoc(store,doc),duplicate:false};
  }
  async function runQueue(){
    if(processing||closed)return;
    processing=true;
    const stopDeleted=documentId=>{if(!store.get('document',documentId)?.deletedAt)return false;cancelDeletedDocumentTasks(store,documentId);return true;};
    try{while(!closed){
      const task=store.list('task').filter(t=>t.status==='queued').sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
      if(!task)break;
      let doc=store.get('document',task.documentId);
      if(!doc){store.put('task',{...task,status:'failed',error:'文档记录不存在'});continue;}
      if(stopDeleted(doc.id))continue;
      const update=patch=>store.put('task',{...store.get('task',task.id),...patch,updatedAt:now()});
      if(task.type==='index'){
        update({status:'processing',stage:'更新语义索引',progress:30,attempts:(task.attempts||0)+1});
        try{
          const result=await indexChunks(doc.id,store.chunks(doc.id));
          if(stopDeleted(doc.id))continue;
          update({status:'succeeded',stage:result.skipped?'仅全文索引':'语义索引已更新',progress:100,completedAt:now()});
          audit(null,'document.indexed',{documentId:doc.id,documentTitle:doc.title,count:result.count||0});
        }catch(error){
          if(stopDeleted(doc.id))continue;
          const latest=store.get('document',doc.id),obsolete=error.code==='INDEX_INPUT_CHANGED',retry=latest?.embeddingRetry;
          update({status:'failed',stage:obsolete?'旧任务已结束，等待最新内容':retry?.nextAttemptAt?'检索准备暂未完成，将自动重试':'检索准备未完成，全文检索可用',progress:100,error:error.message,errorCode:error.code||'INDEX_FAILED',nextAttemptAt:retry?.nextAttemptAt||null,completedAt:now()});
          audit(null,obsolete?'document.index_obsolete':'document.index_failed',{documentId:doc.id,documentTitle:doc.title,message:error.code||'INDEX_FAILED'});
          if(obsolete&&latest)queueIndex(latest);
        }
        continue;
      }
      try{
        update({status:'processing',stage:'解析原文',progress:15,attempts:(task.attempts||0)+1});
        doc=patchDoc(doc,{status:'processing',stage:'解析原文',progress:15,error:null});
        const assertParseCurrent=()=>requireValue(!store.get('document',doc.id)?.deletedAt&&store.get('document',doc.id)?.revision===doc.revision,409,'PARSE_REVISION_CONFLICT','资料已更新，旧解析结果未覆盖新内容。');
        const {parseDocument,chunkPages}=await import('./parser.mjs');
        assertParseCurrent();
        const result=await withTrace(store,{operation:'document.parse',jobId:task.id,actorId:doc.ownerId},()=>traceStep(store,'parse.document',()=>parseDocument({filePath:path.join(store.dataDir,'uploads',doc.storageName),fileName:doc.fileName,mimeType:doc.mimeType,store})));
        assertParseCurrent();
        update({stage:'生成知识片段',progress:60});
        const chunks=chunkPages(result.pages).map((c,index)=>({...c,id:uid('chunk_'),documentId:doc.id,ordinal:index}));
        requireValue(chunks.length>0,422,'EMPTY_DOCUMENT','文件中未找到可检索的文本。');
        store.replaceChunks(doc.id,chunks);
        const {warnings,notes}=parserMessages(result),config=modelConfig(store);
        if(embeddingEnabled(config)){
          update({stage:'生成语义索引',progress:80});
          try{await indexChunks(doc.id,chunks,config);}catch(e){warnings.push(`语义索引未完成，仍可使用全文检索：${e.message}`);}
          assertParseCurrent();
        }
        doc=patchDoc(store.get('document',doc.id),{status:'review',stage:'待审核',progress:100,pageCount:result.totalPages||result.pages.length,processedPageCount:result.pages.length,chunkCount:chunks.length,parser:result.parser,parseCoverage:result.coverage||null,durationMs:result.durationMs||null,visualCoverage:result.visualCoverage||null,frameSampling:result.frameSampling||null,warnings,notes,structuredDataIncomplete:result.coverage==='partial',summary:doc.preserveSummaryOnParse?doc.summary:chunks[0].text.slice(0,220)});
        update({status:'succeeded',stage:'待审核',progress:100,completedAt:now(),warnings});
        audit(null,'document.parsed',{documentId:doc.id,documentTitle:doc.title,chunkCount:chunks.length});
        if(doc.reparseSourceId){const previous=store.get('document',doc.reparseSourceId);if(previous&&!previous.deletedAt&&previous.status==='review'&&previous.revision===doc.reparseSourceRevision){patchDoc(previous,{status:'superseded',stage:'已由重新解析的待审版本替代'});audit(null,'document.draft_superseded',{documentId:previous.id,documentTitle:previous.title,replacementId:doc.id,reason:'原稿及校对内容已保留，新解析版本等待审核'});}}
      }catch(e){
        if(stopDeleted(doc.id))continue;
        if(e.code==='PARSE_REVISION_CONFLICT'){
          update({status:'failed',stage:'解析结果已过时',progress:100,error:e.message,errorCode:e.code,completedAt:now()});
          audit(null,'document.parse_obsolete',{documentId:doc.id,errorCode:e.code});continue;
        }
        doc=patchDoc(store.get('document',doc.id),{status:'failed',stage:'解析失败',progress:100,error:e.message||'文档解析失败',errorCode:e.code||'PARSE_FAILED'});
        update({status:'failed',stage:'解析失败',progress:100,error:doc.error,errorCode:doc.errorCode,completedAt:now()});
        audit(null,'document.parse_failed',{documentId:doc.id,documentTitle:doc.title,message:doc.errorCode});
      }
    }}finally{processing=false;}
  }
  // Persisted jobs interrupted by a restart return to the queue without losing originals.
  for(const task of store.list('task').filter(t=>t.status==='processing')){const d=store.get('document',task.documentId);if(d?.deletedAt){cancelDeletedDocumentTasks(store,d.id);continue;}store.put('task',{...task,status:'queued',stage:'重启后等待恢复',updatedAt:now()});if(d){if(task.type==='index')store.put('document',{...d,embeddingStatus:'queued'});else patchDoc(d,{status:'queued',stage:'重启后等待恢复',progress:0});}}
  const localAccess=createLocalAccess(store,user=>defaultBase(store,user));
  if(!localAccess.enabled&&!accountUsers(store).length&&process.env.ADMIN_USERNAME&&process.env.ADMIN_PASSWORD){const admin={id:uid('user_'),username:cleanString(process.env.ADMIN_USERNAME,80),name:cleanString(process.env.ADMIN_NAME,80)||'系统管理员',role:'admin',department:'企业管理',active:true,passwordHash:await passwordHash(process.env.ADMIN_PASSWORD),createdAt:now()};store.transaction(()=>{store.put('user',admin);if(!store.list('base').length)defaultBase(store,admin);audit(admin,'system.bootstrap',{});});}
  interval=startWorker?setInterval(()=>{runQueue().catch(()=>{});scheduledPromise ||= scheduledWork().catch(()=>{}).finally(()=>{scheduledPromise=null;});store.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());},3000):null;if(interval)interval.unref();if(startWorker)setImmediate(()=>{backfillIndexes();runQueue();});

  function readiness(){try{store.db.exec("INSERT INTO meta(key,value) VALUES('readiness','ok') ON CONFLICT(key) DO UPDATE SET value='ok'");const target=path.join(store.dataDir,'uploads',`.ready-${crypto.randomUUID()}`);writeFileSync(target,'ok',{flag:'wx',mode:0o600});const valid=readFileSync(target,'utf8')==='ok';unlinkSync(target);requireValue(valid,503,'STORAGE_UNAVAILABLE','文件存储不可读写。');return {status:'ready',database:{readable:true,writable:true,integrity:'SQLite WAL'},storage:{readable:true,writable:true},writerLockHeld:true,queue:{running:processing,pending:store.list('task').filter(t=>['queued','processing'].includes(t.status)).length},checkedAt:now()};}catch(e){throw failure(503,'NOT_READY',e.message||'服务尚未就绪。');}}
  async function createBackup(user){requireValue(!backupRunning,409,'BACKUP_BUSY','备份正在进行。');backupRunning=true;const id=`backup-${new Date().toISOString().replace(/[:.]/g,'-')}`,dir=path.join(store.dataDir,'backups',id);try{mkdirSync(dir,{recursive:true});await backup(store.db,path.join(dir,'knowledge.sqlite'));const snapshot=new DatabaseSync(path.join(dir,'knowledge.sqlite'),{readOnly:true});const docs=snapshot.prepare("SELECT data FROM entities WHERE kind='document'").all().map(r=>JSON.parse(r.data));snapshot.close();mkdirSync(path.join(dir,'uploads'));const files=[];for(const d of docs){const src=path.join(store.dataDir,'uploads',d.storageName),dst=path.join(dir,'uploads',d.storageName);requireValue(existsSync(src),500,'BACKUP_SOURCE_MISSING',`备份缺少原件：${d.fileName}`);copyFileSync(src,dst);const hash=crypto.createHash('sha256').update(readFileSync(dst)).digest('hex');requireValue(hash===d.sha256,500,'BACKUP_HASH_MISMATCH','备份文件校验失败。');files.push({storageName:d.storageName,sha256:hash,size:d.size});}if(existsSync(path.join(store.dataDir,'.encryption-key')))copyFileSync(path.join(store.dataDir,'.encryption-key'),path.join(dir,'.encryption-key'));const manifest={id,createdAt:now(),documentCount:docs.length,files,externalEncryptionKey:!!process.env.APP_ENCRYPTION_KEY};writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});audit(user,'operations.backup',{target:id,message:`备份 ${docs.length} 份原件并核对 SHA-256`});return {backup:{id,createdAt:manifest.createdAt,documentCount:docs.length,verified:true}};}catch(e){writeFileSync(path.join(dir,'FAILED.txt'),'Backup did not complete. Do not restore this directory.',{mode:0o600});throw e;}finally{backupRunning=false;}}
  function roots(){return (process.env.CONNECTOR_ROOTS||'').split(';').filter(Boolean).map(root=>{try{return realpathSync(root);}catch{return null;}}).filter(Boolean);}
  function checkedFolder(value){requireValue(typeof value==='string'&&path.isAbsolute(value),400,'CONNECTOR_PATH_INVALID','同步目录必须是绝对路径。');let actual;try{actual=realpathSync(value);}catch{throw failure(400,'CONNECTOR_PATH_INVALID','同步目录不存在。');}const comparable=value=>process.platform==='win32'?value.toLowerCase():value;requireValue(roots().some(root=>comparable(actual)===comparable(root)||comparable(actual).startsWith(comparable(root)+path.sep)),403,'CONNECTOR_PATH_DENIED','同步目录必须位于 CONNECTOR_ROOTS 配置的白名单根目录内。');requireValue(statSync(actual).isDirectory(),400,'CONNECTOR_PATH_INVALID','同步来源必须是目录。');return actual;}
  async function syncConnector(user,connector){requireValue(connector.status!=='syncing',409,'CONNECTOR_BUSY','该目录正在同步。');const root=checkedFolder(connector.path);connector={...connector,status:'syncing',lastError:null};store.put('connector',connector);const stats={scanned:0,created:0,updated:0,unchanged:0,archived:0,failed:0,skipped:0},errors=[];try{const files=[];function scan(folder,depth=0){requireValue(depth<20,400,'CONNECTOR_DEPTH_LIMIT','同步目录层级不得超过 20 层。');for(const entry of readdirSync(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink()||lstatSync(file).isSymbolicLink())continue;if(entry.isDirectory())scan(file,depth+1);else if(entry.isFile()&&FILE_TYPES[path.extname(file).toLowerCase()]){files.push(file);requireValue(files.length<=2000,400,'CONNECTOR_FILE_LIMIT','单个连接器最多同步 2000 个文件。');}}}scan(root);const seen=new Set();for(const file of files){user=activeUser(user);requireEditor(user);getBase(user,connector.baseId);const rel=path.relative(root,file);seen.add(rel);stats.scanned++;try{requireValue(statSync(file).size<=MAX_FILE,413,'UPLOAD_TOO_LARGE','文件超过 100MB');const canonical=realpathSync(file);requireValue(canonical.startsWith(root+path.sep),403,'CONNECTOR_PATH_DENIED','文件越出允许的同步目录。');const bytes=readFileSync(canonical);const hash=crypto.createHash('sha256').update(bytes).digest('hex');const old=store.list('document').filter(d=>d.source?.connectorId===connector.id&&d.source.path===rel).sort((a,b)=>b.version-a.version)[0];if(old?.deletedAt){stats.skipped++;continue;}if(old&&old.sha256===hash){stats.unchanged++;continue;}const result=await ingest(user,{baseId:connector.baseId,fileName:path.basename(file),duplicateAction:old?'version':'copy',previousVersionId:old?.id},{bytes,source:{connectorId:connector.id,path:rel}});if(result.document)old?stats.updated++:stats.created++;}catch(e){stats.failed++;errors.push({file:rel,message:e.message});}}
      if(connector.archiveDeleted)for(const doc of store.list('document').filter(d=>!d.deletedAt&&d.source?.connectorId===connector.id&&!seen.has(d.source.path)&&!['archived','superseded','processing','queued'].includes(d.status))){user=activeUser(user);requireEditor(user);getDoc(user,doc.id,true);patchDoc(doc,{status:'archived',stage:'来源文件已删除',archiveReason:'受控目录来源文件已删除'});stats.archived++;audit(user,'connector.source_deleted',{documentId:doc.id,documentTitle:doc.title});}
      connector={...connector,status:errors.length?'warning':'ready',lastSyncAt:now(),lastError:errors.length?`${errors.length} 个文件同步失败`:null,stats,errors:errors.slice(0,50)};store.put('connector',connector);audit(user,'connector.sync',{target:connector.id,message:`检查 ${stats.scanned}，新增 ${stats.created}，更新 ${stats.updated}，失败 ${stats.failed}`});return {connector};
    }catch(e){store.put('connector',{...connector,status:'failed',lastError:e.message,lastSyncAt:now(),stats});throw e;}}


  function synchronizeLifecycle(){const current=Date.now();const published=store.list('document').filter(d=>!d.deletedAt&&d.status==='published'&&(!d.effectiveAt||Date.parse(d.effectiveAt)<=current));const families=new Map();for(const d of published){const key=d.familyId||d.id;if(!families.has(key)||families.get(key).version<d.version)families.set(key,d);}for(const d of published){const newest=families.get(d.familyId||d.id);if(newest.id!==d.id){patchDoc(d,{status:'superseded',stage:'已被新版本替代'});audit(null,'document.scheduled_superseded',{documentId:d.id,documentTitle:d.title,newVersionId:newest.id});}}}
  for(const connector of store.list('connector').filter(c=>c.status==='syncing'))store.put('connector',{...connector,status:'ready',nextSyncAt:now(),lastError:'服务重启，未完成的同步将重新检查来源文件。'});
  let extensionHandler;async function extension(context){if(!existsSync(path.join(projectDir,'server','extensions.mjs')))return false;extensionHandler ||= (await import('./extensions.mjs')).handleExtension;return await extensionHandler(context);}
  let lastScheduledCheck=0;
  async function scheduledWork(){if(closed||Date.now()-lastScheduledCheck<30000)return;lastScheduledCheck=Date.now();synchronizeLifecycle();backfillIndexes();for(const connector of store.list('connector')){if(!connector.intervalMinutes||connector.status==='syncing'||(connector.nextSyncAt&&Date.parse(connector.nextSyncAt)>Date.now()))continue;const actor=store.get('user',connector.ownerId);if(!actor?.active||!canEdit(actor)||!canBase(actor,store.get('base',connector.baseId))){store.put('connector',{...connector,status:'failed',lastError:'连接器负责人的权限已失效，请管理员重新保存配置。',nextSyncAt:new Date(Date.now()+connector.intervalMinutes*60000).toISOString()});continue;}try{await syncConnector(actor,connector);}catch(e){audit(null,'connector.scheduled_failed',{target:connector.id,message:e.message});}const latest=store.get('connector',connector.id);store.put('connector',{...latest,nextSyncAt:new Date(Date.now()+connector.intervalMinutes*60000).toISOString()});}const hours=Number(process.env.BACKUP_INTERVAL_HOURS)||0;if(hours>0&&!backupRunning){const plan=store.get('setting','automaticBackup')||{};if(!plan.nextAt||Date.parse(plan.nextAt)<=Date.now()){store.put('setting',{id:'automaticBackup',nextAt:new Date(Date.now()+Math.max(1,hours)*3600000).toISOString(),attemptedAt:now()});try{const result=await createBackup(null);store.put('setting',{id:'automaticBackup',nextAt:new Date(Date.now()+Math.max(1,hours)*3600000).toISOString(),lastBackupId:result.backup.id,lastSucceededAt:now()});}catch(e){audit(null,'operations.automatic_backup_failed',{message:e.message});}}}}

  const handlerCore=async(req,res)=>{
    const requestStarted=performance.now();
    if(req.url?.startsWith('/api/'))res.once('finish',()=>{const elapsed=performance.now()-requestStarted;usage.completedRequests++;usage.totalRequestLatencyMs+=elapsed;usage.averageLatencyMs=Math.round(usage.totalRequestLatencyMs/usage.completedRequests*10)/10;});
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');usage.requests++;
    try{
      const url=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(url.pathname);const method=req.method;const ip=req.socket.remoteAddress||'unknown';
      if(pathname==='/ready.json'&&method==='GET')return send(res,200,readiness());
      if(!pathname.startsWith('/api/')){
        if(method!=='GET'&&method!=='HEAD')throw failure(404,'NOT_FOUND','接口不存在。');const dist=path.resolve(process.env.STATIC_DIR||path.join(projectDir,'dist'));const candidate=path.resolve(dist,`.${pathname}`);requireValue(candidate===dist||candidate.startsWith(dist+path.sep),403,'PATH_DENIED','路径不可访问。');const target=existsSync(candidate)&&statSync(candidate).isFile()?candidate:path.join(dist,'index.html');requireValue(existsSync(target),404,'NOT_FOUND','页面尚未构建，请先执行构建。');const ext=path.extname(target);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':ext==='.html'?'no-cache':'public, max-age=3600','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'"});if(method==='HEAD')res.end();else createReadStream(target).pipe(res);return;
      }
      localAccess.assertRequest(req);
      if(!pathname.startsWith('/api/service/'))validateOrigin(req);if(['/api/setup','/api/auth/login'].includes(pathname)||pathname.startsWith('/api/auth/sso'))rate(`auth-source:${ip}`,300,60000);synchronizeLifecycle();
      const extensionContext={req,res,url,pathname,method,user:null,store,send,rate,audit,createBackup,search,answerQuestion,publicModel,bodyOf};
      if(pathname.startsWith('/api/service/knowledge/')&&await handleKnowledgeInterfaces(extensionContext))return;
      if((pathname.startsWith('/api/auth/sso')||pathname.startsWith('/api/service/'))&&await extension(extensionContext))return;
      if(pathname==='/api/setup'&&method==='GET')return send(res,200,{required:!localAccess.enabled&&!accountUsers(store).length,authMode:localAccess.enabled?'local':'password'});
      if(localAccess.enabled&&['/api/setup','/api/auth/login','/api/auth/password'].includes(pathname)&&method==='POST')throw failure(409,'LOCAL_ACCESS_ENABLED','当前为本机免登录模式，无需设置账号密码。');
      if(pathname==='/api/setup'&&method==='POST'){
        rate(`setup:${ip}`,10,900000);requireValue(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)&&!req.headers['x-forwarded-for'],403,'SETUP_LOCAL_ONLY','首次初始化仅允许本机访问。');requireValue(accountUsers(store).length===0,409,'ALREADY_INITIALIZED','系统已初始化。');const input=await bodyOf(req);const username=cleanString(input.username,80);requireValue(/^[a-zA-Z0-9_.@-]{3,80}$/.test(username),400,'INVALID_USERNAME','账号须为 3–80 位字母、数字或 . _ @ -。');const hash=await passwordHash(input.password);const user={id:uid('user_'),username,name:cleanString(input.name,80)||username,role:'admin',department:'企业管理',active:true,passwordHash:hash,createdAt:now()};store.transaction(()=>{requireValue(!accountUsers(store).length,409,'ALREADY_INITIALIZED','系统已初始化。');store.put('user',user);if(!store.list('base').length)defaultBase(store,user);audit(user,'system.setup',{});});issueSession(res,user,store);return send(res,201,{user:safeUser(user)});
      }
      if(pathname==='/api/auth/login'&&method==='POST'){rate(`login:${ip}`,100,900000);const input=await bodyOf(req);const username=cleanString(input.username,80);rate(`login-account:${ip}:${username.toLowerCase()}`,15,900000);let user=accountUsers(store).find(u=>u.username.toLowerCase()===username.toLowerCase());const checkedHash=user?.passwordHash;const valid=user&&await verifyPassword(input.password,checkedHash);user=user&&store.get('user',user.id);requireValue(valid&&user?.active&&user.passwordHash===checkedHash,401,'INVALID_CREDENTIALS','账号或密码错误，或账号已停用。');issueSession(res,user,store);audit(user,'auth.login',{});return send(res,200,{user:safeUser(user)});}
      const currentActor=()=>{const value=localAccess.enabled?store.get('user',localAccess.user.id):authenticate(req,store);requireValue(value?.active,401,'AUTH_REQUIRED','请先登录，或账号权限已变更。');return localAccess.enabled?{...value,authMode:'local'}:value;};
      let user=currentActor();rate(`business:${user.id}`,300,60000);
      const upgradeContext={...extensionContext,user,usage,activeUser,currentActor,ingest,getDoc,getBase,patchDoc,taskFor,runQueue,startWorker,roots,queueIndex};
      if(pathname.startsWith('/api/knowledge-interfaces')&&await handleKnowledgeInterfaces(upgradeContext))return;
      if(await handleWorkspace(upgradeContext,{exportDocument:doc=>exportedDoc(store,doc)}))return;
      if(await handleIntelligence(upgradeContext))return;
      if(await handleKnowledgeUpgrade(upgradeContext))return;
      if(pathname.startsWith('/api/recommendation')&&await traceStep(store,'recommendations.request',()=>handleRecommendations(upgradeContext,{policy:knowledgePresentationPolicy(store,user)})))return;
      if(pathname.startsWith('/api/unified-search')&&await handleUnifiedSearch(upgradeContext))return;
      if(await handleKnowledgeAttributes(upgradeContext))return;
      if(await handleKnowledgeCards(upgradeContext))return;
      if(await handleAnswerCompleteness(upgradeContext))return;
      if(await handleKnowledgeDemands(upgradeContext))return;
      if(await extension({...extensionContext,user}))return;
      // Finish network reads before taking business snapshots; permissions may
      // have changed while the sender was still uploading its request body.
      let requestInput;
      if(['POST','PUT','PATCH','DELETE'].includes(method)){
        if(req.headers['content-type']||Number(req.headers['content-length'])>0||req.headers['transfer-encoding'])requestInput=await bodyOf(req);
        user=currentActor();
      }
      const inputBody=()=>{requireValue(requestInput!==undefined,415,'JSON_REQUIRED','此接口只接受 JSON 数据。');return requestInput;};
      if(pathname==='/api/documents/applicability-target'&&method==='GET'){requireEditor(user);return send(res,200,{target:uploadGuidanceTarget(store)});}
      if(pathname==='/api/documents/applicability-draft'&&method==='POST'){
        requireEditor(user);rate('upload-guidance:'+user.id,20,60000);const input=inputBody();
        getBase(user,input.baseId);const category=resolveSourceCategory(store,input);
        const controller=new AbortController();const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
        try{const result=await generateUploadApplicability(store,user,{...input,...category},{currentActor,signal:controller.signal});if(!controller.signal.aborted)return send(res,200,result);}
        finally{res.off('close',abort);}return;
      }
      if(pathname==='/api/source-categories'&&method==='GET')return send(res,200,listSourceCategories(store,user));
      if(pathname==='/api/source-categories'&&method==='PUT')return send(res,200,updateSourceCategories(store,user,inputBody()));
      if(pathname==='/api/auth/me'&&method==='GET')return send(res,200,{user:safeUser(user)});
      if(pathname==='/api/auth/logout'&&method==='POST'){clearSession(req,res,store);return send(res,200,{ok:true});}
      if(pathname==='/api/auth/password'&&method==='POST'){rate(`password:${user.id}`,10,900000);const input=inputBody(),checkedHash=user.passwordHash;requireValue(await verifyPassword(input.currentPassword,checkedHash),400,'PASSWORD_MISMATCH','当前密码不正确。');const hash=await passwordHash(input.newPassword);user=currentActor();requireValue(user.passwordHash===checkedHash,409,'CREDENTIALS_CHANGED','密码已被更新，请重新登录后操作。');store.put('user',{...user,passwordHash:hash});store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);issueSession(res,user,store);audit(user,'auth.password_changed',{});return send(res,200,{ok:true});}
      if(pathname==='/api/bases'&&method==='GET')return send(res,200,{bases:store.list('base').filter(b=>canBase(user,b)).map(b=>({...b,documentCount:store.list('document').filter(d=>d.baseId===b.id&&canDocument(user,d,store)).length}))});
      if(pathname==='/api/bases'&&method==='POST'){requireEditor(user);const input=inputBody();const name=cleanString(input.name,120);requireValue(name,400,'NAME_REQUIRED','请填写知识库名称。');const visibility=input.visibility||'department';requireValue(['company','department','private'].includes(visibility),400,'INVALID_VISIBILITY','知识库访问范围无效。');const members=input.members||[];requireValue(Array.isArray(members)&&members.every(id=>typeof id==='string'&&store.get('user',id)),400,'INVALID_MEMBERS','成员列表无效。');const base={id:uid('base_'),name,description:cleanString(input.description,1000),department:cleanString(input.department,100)||user.department,visibility,ownerId:user.id,members:[...new Set(members)],createdAt:now(),updatedAt:now()};store.put('base',base);audit(user,'base.created',{target:base.id,message:base.name});return send(res,201,{base:{...base,documentCount:0}});}
      const baseMatch=pathname.match(/^\/api\/bases\/([^/]+)$/);if(baseMatch&&method==='PATCH'){const base=getBase(user,baseMatch[1]);requireValue(isAdmin(user)||base.ownerId===user.id,403,'BASE_OWNER_REQUIRED','只有知识库负责人或管理员可修改访问范围。');const input=inputBody();const patch={};for(const key of ['name','description','department'])if(input[key]!==undefined)patch[key]=cleanString(input[key],key==='description'?1000:120);if(input.visibility!==undefined){requireValue(['company','department','private'].includes(input.visibility),400,'INVALID_VISIBILITY','访问范围无效。');patch.visibility=input.visibility;}if(input.members!==undefined){requireValue(Array.isArray(input.members)&&input.members.every(id=>typeof id==='string'&&store.get('user',id)),400,'INVALID_MEMBERS','成员列表无效。');patch.members=[...new Set(input.members)];}const next=store.put('base',{...base,...patch,updatedAt:now()});audit(user,'base.updated',{target:base.id,message:'知识库资料或权限已更新'});return send(res,200,{base:next});}

      if(pathname==='/api/documents'&&method==='GET'){
        const baseId=url.searchParams.get('baseId'),status=url.searchParams.get('status'),q=cleanString(url.searchParams.get('q'),1000).toLowerCase();
        const requestedLimit=Number(url.searchParams.get('limit')||200),offset=Number(url.searchParams.get('offset')||0);
        requireValue(Number.isInteger(requestedLimit)&&requestedLimit>0&&Number.isSafeInteger(offset)&&offset>=0,400,'INVALID_PAGINATION','分页参数必须是有效的非负整数。');
        const limit=Math.min(500,requestedLimit);
        const matching=store.list('document').filter(d=>canDocument(user,d,store)&&(!baseId||d.baseId===baseId)&&(!status||status==='all'||d.status===status)&&(!q||`${d.title} ${d.fileName} ${d.tags?.join(' ')}`.toLowerCase().includes(q))).sort(sortRecent);
        const documents=matching.slice(offset,offset+limit).map(d=>({...exportedDoc(store,d),canManage:canEdit(user)&&canDocument(user,d,store,{write:true}),retrievable:isRetrievable(d),currentDocumentSignature:recommendationSignature(d),applications:documentApplications(store,user,d.id)}));const hasMore=offset+documents.length<matching.length;
        return send(res,200,{documents,pagination:{offset,limit,total:matching.length,hasMore,nextOffset:hasMore?offset+documents.length:null}});
      }
      if(pathname==='/api/documents'&&method==='POST'){rate(`upload:${user.id}`,40,60000);const input=inputBody();return send(res,201,await ingest(user,input));}
      if(pathname==='/api/documents/trash'&&method==='GET'){
        requireEditor(user);
        const baseId=cleanString(url.searchParams.get('baseId'),200),q=cleanString(url.searchParams.get('q'),1000).toLowerCase();
        if(baseId)getBase(user,baseId);
        const requestedLimit=Number(url.searchParams.get('limit')||200),offset=Number(url.searchParams.get('offset')||0);
        requireValue(Number.isInteger(requestedLimit)&&requestedLimit>0&&Number.isSafeInteger(offset)&&offset>=0,400,'INVALID_PAGINATION','分页参数必须是有效的非负整数。');
        const limit=Math.min(500,requestedLimit);
        const matching=store.list('document').filter(document=>canManageTrashedDocument(user,document,store)&&(!baseId||document.baseId===baseId)&&(!q||`${document.title} ${document.fileName} ${(document.tags||[]).join(' ')}`.toLowerCase().includes(q))).sort((a,b)=>String(b.deletedAt).localeCompare(String(a.deletedAt))||b.id.localeCompare(a.id));
        const documents=matching.slice(offset,offset+limit).map(document=>({...exportedDoc(store,document),canManage:true,canRestore:true,retrievable:false}));
        const hasMore=offset+documents.length<matching.length;
        return send(res,200,{documents,pagination:{offset,limit,total:matching.length,hasMore,nextOffset:hasMore?offset+documents.length:null}});
      }
      const trashRestore=pathname.match(/^\/api\/documents\/([^/]+)\/restore-from-trash$/);
      if(trashRestore&&method==='POST'){
        const input=inputBody();let restored;
        store.transaction(()=>{user=currentActor();requireEditor(user);restored=restoreDocumentFromTrash(store,user,trashRestore[1],input.revision);if(restored.status==='queued')taskFor(restored);});
        if(restored.status==='review')queueIndex(restored);else if(startWorker)setImmediate(()=>runQueue());
        return send(res,200,{document:{...exportedDoc(store,store.get('document',restored.id)),canManage:true}});
      }
      const docMatch=pathname.match(/^\/api\/documents\/([^/]+)(?:\/(file|preview|actions|reindex|reparse))?$/);
      if(docMatch){let doc=getDoc(user,docMatch[1],!['GET','HEAD'].includes(method));const sub=docMatch[2];

        if((sub==='preview'||sub==='file')&&['GET','HEAD'].includes(method)){
          const filePath=path.join(store.dataDir,'uploads',doc.storageName);requireValue(existsSync(filePath),404,'ORIGINAL_MISSING','原件未找到，请联系管理员恢复备份。');
          const preview=sub==='preview';
          if(preview){
            requireValue(['application/pdf','image/png','image/jpeg','image/webp','image/bmp','image/tiff',...MEDIA_MIME_TYPES].includes(doc.mimeType),415,'PREVIEW_NOT_SUPPORTED','该格式请下载原件查看；支持PDF、位图及已验证的音视频预览。');
            const fd=openSync(filePath,'r'),header=Buffer.alloc(16);try{readSync(fd,header,0,16,0);}finally{closeSync(fd);}
            const valid=MEDIA_MIME_TYPES.includes(doc.mimeType)?validMediaHeader(doc.mimeType,header):doc.mimeType==='application/pdf'?header.subarray(0,5).toString()==='%PDF-':
              doc.mimeType==='image/png'?header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
              doc.mimeType==='image/jpeg'?header[0]===255&&header[1]===216&&header[2]===255:
              doc.mimeType==='image/webp'?header.subarray(0,4).toString()==='RIFF'&&header.subarray(8,12).toString()==='WEBP':
              doc.mimeType==='image/bmp'?header.subarray(0,2).toString()==='BM':
              header.subarray(0,4).equals(Buffer.from([73,73,42,0]))||header.subarray(0,4).equals(Buffer.from([77,77,0,42]));
            requireValue(valid,415,'PREVIEW_CONTENT_INVALID','原件格式与类型不匹配，不能在页面内预览。');
            res.setHeader('X-Frame-Options','SAMEORIGIN');
          }
          audit(user,preview?'document.preview':'document.download',{documentId:doc.id,documentTitle:doc.title});
          sendStoredFile(req,res,filePath,{mimeType:doc.mimeType,fileName:doc.fileName,preview});return;
        }
        if(sub==='reindex'&&method==='POST'){requireEditor(user);requireValue(doc.chunkCount>0,409,'NO_CHUNKS','请先完成文档解析。');const task=queueIndex(doc,{force:true});requireValue(task,409,'EMBEDDING_NOT_CONFIGURED','语义模型未配置或尚未准备完整。');audit(user,'document.reindex_requested',{documentId:doc.id,documentTitle:doc.title});return send(res,202,{task});}
        if(!sub&&method==='DELETE'){
          const input=inputBody();user=currentActor();requireEditor(user);
          doc=moveDocumentToTrash(store,user,doc.id,input.revision);
          return send(res,200,{document:{...exportedDoc(store,doc),canManage:true,canRestore:true,retrievable:false}});
        }
        if(!sub&&method==='GET'){const versions=store.list('document').filter(d=>(d.familyId||d.id)===(doc.familyId||doc.id)&&canDocument(user,d,store)).sort((a,b)=>b.version-a.version).map(d=>exportedDoc(store,d));return send(res,200,{document:{...exportedDoc(store,doc),canManage:canDocument(user,doc,store,{write:true}),applications:documentApplications(store,user,doc.id)},permissions:{canManage:canDocument(user,doc,store,{write:true})},chunks:store.chunks(doc.id),versions,events:store.events(100,doc.id).map(safeAudit)});}
        if(!sub&&method==='PATCH'){
          const input=inputBody();let createdFile;
          try{doc=store.transaction(()=>{
            user=currentActor();requireEditor(user);let current=getDoc(user,docMatch[1],true);checkRevision(current,input.revision);
            requireValue(!['queued','processing','failed','archived','superseded'].includes(current.status),409,'DOCUMENT_NOT_EDITABLE','当前状态不允许编辑；请先恢复或重试解析。');
            const patch={...governanceMetadata(input),...resolveSourceCategory(store,input,current)};
            for(const key of ['title','summary'])if(input[key]!==undefined)patch[key]=cleanString(input[key],key==='title'?240:4000);
            if(patch.title!==undefined)requireValue(patch.title,400,'TITLE_REQUIRED','标题不能为空。');
            if(input.tags!==undefined){requireValue(Array.isArray(input.tags)&&input.tags.length<=30,400,'INVALID_TAGS','标签最多 30 个。');patch.tags=input.tags.map(v=>cleanString(v,60)).filter(Boolean);}
            for(const key of ['effectiveAt','expiresAt'])if(input[key]!==undefined)patch[key]=input[key]||null;
            validateDates(Object.hasOwn(patch,'effectiveAt')?patch.effectiveAt:current.effectiveAt,Object.hasOwn(patch,'expiresAt')?patch.expiresAt:current.expiresAt);
            let chunks=store.chunks(current.id);
            if(input.chunks!==undefined){
              requireValue(Array.isArray(input.chunks)&&input.chunks.length<=chunks.length,400,'INVALID_CHUNKS','知识片段列表无效。');
              const original=new Map(chunks.map(c=>[c.id,c]));let tableEdited=false;
              for(const entry of input.chunks){requireValue(original.has(entry.id)&&typeof entry.text==='string'&&entry.text.trim().length>0&&entry.text.length<=12000,400,'INVALID_CHUNK','知识片段不存在、为空或超过长度限制。');const corrected={...original.get(entry.id),text:entry.text.trim(),corrected:true,correctedAt:now(),correctedBy:user.id};if(corrected.table&&entry.text.trim()!==original.get(entry.id).text.trim()){delete corrected.table;tableEdited=true;}original.set(entry.id,corrected);}
              chunks=chunks.map(c=>original.get(c.id));
              patch.notes=[...new Set([...parserMessages(current).notes,'解析内容经人工校对，原始文件已保留，请结合原件复核。'])];
              patch.warnings=parserMessages(current).warnings;if(tableEdited){patch.structuredDataIncomplete=true;patch.warnings=[...new Set([...patch.warnings,'表格片段经文本校对，结构化字段需重新核对；全表统计暂不可用'])];}
            }
            patch.contentRevision=(current.contentRevision||1)+1;
            if(current.status==='published'){
              const family=store.list('document').filter(d=>(d.familyId||d.id)===(current.familyId||current.id));
              const old=current,id=uid('doc_'),storageName=id+path.extname(old.fileName);createdFile=path.join(store.dataDir,'uploads',storageName);
              copyFileSync(path.join(store.dataDir,'uploads',old.storageName),createdFile);
              current={...old,...patch,id,familyId:old.familyId||old.id,storageName,version:Math.max(...family.map(d=>d.version))+1,previousVersionId:old.id,status:'review',stage:'待审核',ownerId:user.id,createdAt:now(),updatedAt:now(),revision:1,governanceAcknowledgements:{},lastReviewedAt:null,lastReviewedBy:null,lastReviewReason:null};
              store.put('document',current);store.replaceChunks(current.id,chunks.map(c=>({...c,id:uid('chunk_'),documentId:current.id})));
              audit(user,'document.version_created',{documentId:current.id,documentTitle:current.title,previousVersionId:old.id});
            }else{current=patchDoc(current,{...patch,status:'review',stage:'待审核'});if(input.chunks)store.replaceChunks(current.id,chunks);}
            audit(user,'document.edited',{documentId:current.id,documentTitle:current.title});return current;
          });}catch(error){if(createdFile&&existsSync(createdFile))unlinkSync(createdFile);throw error;}
          queueIndex(doc,{force:true});return send(res,200,{document:exportedDoc(store,store.get('document',doc.id))});
        }
        if(sub==='actions'&&method==='POST'){
          const input=inputBody();doc=store.transaction(()=>{
            user=currentActor();requireEditor(user);let current=getDoc(user,docMatch[1],true);checkRevision(current,input.revision);
            const action=input.action,reason=cleanString(input.reason,2000);requireValue(['publish','reject','archive','retry','restore'].includes(action),400,'INVALID_ACTION','文档操作无效。');
            if(action==='publish'){
              requireValue(current.status==='review'&&current.chunkCount>0,409,'REVIEW_REQUIRED','只有完成解析的待审核文档可以发布。');
              requireValue(!current.expiresAt||Date.parse(current.expiresAt)>Date.now(),409,'DOCUMENT_EXPIRED','文档已失效，请更新有效期后发布。');
              for(const sibling of store.list('document').filter(d=>!d.deletedAt&&d.id!==current.id&&(d.familyId||d.id)===(current.familyId||current.id)&&d.status==='published')){
                requireValue(sibling.version<current.version,409,'NEWER_VERSION_PUBLISHED','已有更新版本发布，请基于最新版本修改。');
                if(!current.effectiveAt||Date.parse(current.effectiveAt)<=Date.now())patchDoc(sibling,{status:'superseded',stage:'已被新版本替代'});
              }
              current=patchDoc(current,{status:'published',stage:'已发布',publishedAt:now(),reviewerId:user.id,reviewReason:reason});
            }
            if(action==='reject'){requireValue(current.status==='review',409,'REVIEW_REQUIRED','只有待审核文档可以驳回。');requireValue(reason,400,'REASON_REQUIRED','请填写驳回原因。');current=patchDoc(current,{status:'rejected',stage:'已驳回',reviewReason:reason,reviewerId:user.id});}
            if(action==='archive'){requireValue(!['queued','processing','archived','superseded'].includes(current.status),409,'ARCHIVE_NOT_ALLOWED','该文档当前无法下架。');requireValue(reason,400,'REASON_REQUIRED','请填写下架原因。');current=patchDoc(current,{status:'archived',stage:'已下架',archiveReason:reason,archivedAt:now()});}
            if(action==='retry'){requireValue(current.status==='failed',409,'RETRY_NOT_ALLOWED','只有解析失败文档可以重试。');current=patchDoc(current,{status:'queued',stage:'等待重试',progress:0,error:null,errorCode:null});taskFor(current);}
            if(action==='restore'){requireValue(['archived','rejected'].includes(current.status),409,'RESTORE_NOT_ALLOWED','只有已下架或驳回的文档可恢复。');current=patchDoc(current,{status:current.chunkCount?'review':'queued',stage:current.chunkCount?'待审核':'等待解析',archiveReason:null});if(!current.chunkCount)taskFor(current);}
            audit(user,'document.'+action,{documentId:current.id,documentTitle:current.title,reason,version:current.version});return current;
          });
          if(['publish','restore'].includes(input.action)&&['review','published'].includes(doc.status))queueIndex(doc);if(startWorker&&doc.status==='queued')setImmediate(()=>runQueue());return send(res,200,{document:exportedDoc(store,store.get('document',doc.id))});
        }
        if(sub==='reparse'&&method==='POST'){
          const input=inputBody();let createdFile,result;
          try{result=store.transaction(()=>{
            user=currentActor();requireEditor(user);const old=getDoc(user,docMatch[1],true);checkRevision(old,input.revision);
            requireValue(['review','published','rejected','failed'].includes(old.status),409,'REPARSE_NOT_ALLOWED','请在解析结束后重新解析；已下架或替代的版本须先按版本流程处理。');
            const reason=cleanString(input.reason,2000);requireValue(reason,400,'REASON_REQUIRED','请填写重新解析原因。');
            requireValue(!store.list('task').some(t=>t.reparseSourceId===old.id&&['queued','processing'].includes(t.status)),409,'REPARSE_BUSY','该原件已有重新解析任务，请等待完成。');
            const sourceFile=path.join(store.dataDir,'uploads',old.storageName);requireValue(existsSync(sourceFile),404,'ORIGINAL_MISSING','原件缺失，请先恢复备份。');
            requireValue(crypto.createHash('sha256').update(readFileSync(sourceFile)).digest('hex')===old.sha256,409,'ORIGINAL_HASH_MISMATCH','原件校验失败，请先恢复可信原件。');
            const familyId=old.familyId||old.id,family=store.list('document').filter(d=>(d.familyId||d.id)===familyId),id=uid('doc_'),storageName=id+path.extname(old.fileName);
            createdFile=path.join(store.dataDir,'uploads',storageName);copyFileSync(sourceFile,createdFile);
            const document={...old,id,familyId,storageName,version:Math.max(...family.map(d=>d.version))+1,previousVersionId:old.id,reparseSourceId:old.id,reparseSourceRevision:old.revision,reparseReason:reason,ownerId:user.id,status:'queued',stage:'等待重新解析',progress:0,error:null,errorCode:null,createdAt:now(),updatedAt:now(),revision:1,contentRevision:1,chunkCount:0,pageCount:0,parser:null,notes:[],warnings:[],structuredDataIncomplete:false,summary:old.summary||'',preserveSummaryOnParse:!!old.summary?.trim(),governanceAcknowledgements:{},lastReviewedAt:null,lastReviewedBy:null,lastReviewReason:null,publishedAt:null,reviewerId:null,reviewReason:null,embeddingStatus:null,embeddingSignature:null,embeddingError:null};
            store.put('document',document);const task=taskFor(document);task.reparseSourceId=old.id;store.put('task',task);
            audit(user,'document.reparse_requested',{documentId:document.id,documentTitle:document.title,previousVersionId:old.id,reason,version:document.version,sha256:old.sha256});return {document,task};
          });}catch(error){if(createdFile&&existsSync(createdFile))unlinkSync(createdFile);throw error;}
          if(startWorker)setImmediate(()=>runQueue());return send(res,202,{document:exportedDoc(store,result.document),task:result.task});
        }
      }

      if(pathname==='/api/search'&&method==='GET'){rate(`search:${user.id}`,60,60000);const q=cleanString(url.searchParams.get('q'),1000);return send(res,200,await search(store,user,q,{baseId:url.searchParams.get('baseId')||'',documentId:url.searchParams.get('documentId')||'',documentVersion:url.searchParams.get('documentVersion'),limit:Number(url.searchParams.get('limit'))||12}));}
      if(pathname==='/api/chat'&&method==='POST'){rate(`chat:${user.id}`,12,60000);const input=inputBody();const question=cleanString(input.question,4000);requireValue(question,400,'QUESTION_REQUIRED','请输入问题。');if(input.baseId)getBase(user,input.baseId);let conversation=input.conversationId?store.get('conversation',input.conversationId):null;if(input.conversationId)requireValue(conversation?.userId===user.id,404,'CONVERSATION_NOT_FOUND','会话不存在。');if(!conversation)conversation={id:uid('conversation_'),userId:user.id,title:question.slice(0,80),baseId:input.baseId||null,createdAt:now(),updatedAt:now()};const answerStarted=performance.now();let result=await answerQuestion(store,user,question,{baseId:input.baseId||conversation.baseId||''});const answerLatencyMs=Math.round((performance.now()-answerStarted)*10)/10;const latestUser=store.get('user',user.id);requireValue(latestUser?.active,401,'AUTH_REQUIRED','会话权限已更新，请重新登录。');if(!evidenceBundleCurrent(store,latestUser,result))result={answer:'生成过程中知识版本或访问权限发生变化，请重新提问获取当前有效依据。',mode:'insufficient',citations:[],warning:'已撤回不再有效的引用。'};const userMessage={id:uid('message_'),conversationId:conversation.id,role:'user',content:question,answer:question,createdAt:now()};const reply={id:uid('message_'),conversationId:conversation.id,role:'assistant',question,content:result.answer,...result,latencyMs:answerLatencyMs,createdAt:now()};store.transaction(()=>{
        const current=store.get('conversation',conversation.id)||conversation;requireValue(current.userId===user.id,404,'CONVERSATION_NOT_FOUND','会话不存在。');
        const existing=store.list('message').filter(message=>message.conversationId===current.id);
        const maximum=existing.reduce((max,message)=>Number.isSafeInteger(message.sequence)?Math.max(max,message.sequence):max,Math.max(Number(current.messageSequence)||0,existing.length));
        requireValue(Number.isSafeInteger(maximum)&&maximum<Number.MAX_SAFE_INTEGER-2,409,'CONVERSATION_LIMIT','会话记录过多，请新建会话。');
        const turnId=uid('turn_');Object.assign(userMessage,{turnId,sequence:maximum+1});Object.assign(reply,{turnId,sequence:maximum+2});
        store.put('conversation',{...current,updatedAt:now(),messageSequence:maximum+2});store.put('message',userMessage);store.put('message',reply);
      });usage.chatRequests++;usage.chatLatencySamples++;usage.totalChatLatencyMs+=answerLatencyMs;usage.lastChatLatencyMs=answerLatencyMs;usage.averageChatLatencyMs=Math.round(usage.totalChatLatencyMs/usage.chatLatencySamples*10)/10;if(result.mode==='model')usage.modelAnswers++;if(result.mode==='extractive')usage.extractiveAnswers++;usage.inputTokens+=result.usage?.prompt_tokens||0;usage.outputTokens+=result.usage?.completion_tokens||0;store.put('setting',{id:'metrics',...usage});audit(user,'chat.answered',{target:conversation.id,mode:result.mode,citationCount:result.citations.length});return send(res,200,reply);}
      if(pathname==='/api/conversations'&&method==='GET')return send(res,200,{conversations:store.list('conversation').filter(c=>c.userId===user.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
      const convMatch=pathname.match(/^\/api\/conversations\/([^/]+)$/);if(convMatch&&method==='GET'){const conversation=store.get('conversation',convMatch[1]);requireValue(conversation?.userId===user.id,404,'CONVERSATION_NOT_FOUND','会话不存在。');const messages=orderedConversationMessages(store,conversation.id).map(m=>{if(m.role!=='assistant')return m;const unavailable=!evidenceBundleCurrent(store,user,m);if(unavailable)return {...m,answer:'该历史回答引用的资料已更新、失效或访问权限已变更，请重新提问获取当前依据。',content:'该历史回答引用的资料已更新、失效或访问权限已变更，请重新提问获取当前依据。',citations:[],graphPaths:[],toolResults:[],contextEvidenceRefs:[],learningGuidance:[],learningEvidenceRefs:[],mode:'insufficient',warning:'历史引用或关系已撤回，原回答已隐藏。'};return m;});return send(res,200,{conversation,messages});}
      if(convMatch&&method==='DELETE'){
        rate(`conversation-delete:${user.id}`,30,60000);
        const conversation=store.get('conversation',convMatch[1]);
        requireValue(conversation?.userId===user.id,404,'CONVERSATION_NOT_FOUND','会话不存在。');
        const active=conversation.activeRunId?store.get('intelligenceRun',conversation.activeRunId):null;
        requireValue(!active||['succeeded','partial','failed','cancelled','interrupted'].includes(active.status),409,'CONVERSATION_BUSY','会话仍在回答中，请结束后再删除。');
        const runs=store.list('intelligenceRun').filter(run=>run.conversationId===conversation.id);
        const runIds=new Set(runs.map(run=>run.id));
        store.transaction(()=>{
          for(const message of store.list('message').filter(row=>row.conversationId===conversation.id))store.del('message',message.id);
          if(store.get('conversationSummary',conversation.id))store.del('conversationSummary',conversation.id);
          for(const step of store.list('runStep').filter(row=>runIds.has(row.runId)))store.del('runStep',step.id);
          for(const event of store.list('runEvent').filter(row=>runIds.has(row.runId)))store.del('runEvent',event.id);
          for(const row of store.list('runIdempotency').filter(row=>runIds.has(row.runId)))store.del('runIdempotency',row.id);
          for(const run of runs)store.del('intelligenceRun',run.id);
          store.del('conversation',conversation.id);
        });
        audit(user,'conversation.deleted',{target:conversation.id,message:conversation.title||'会话已删除'});
        return send(res,200,{ok:true});
      }
      if(pathname==='/api/learning/default'&&method==='GET'){
        const base=getLearningBase(store);
        return send(res,200,{enabled:true,base:base&&canBase(user,base)?{id:base.id,name:base.name}:null});
      }
      const feedbackLearnMatch=pathname.match(/^\/api\/feedback\/([^/]+)\/learn$/);
      if(feedbackLearnMatch&&method==='POST'){
        requireEditor(user);rate('feedback-learning:'+user.id,30,60000);
        const result=await learnFeedback(store,user,feedbackLearnMatch[1],inputBody());
        return send(res,result.alreadyLearned?200:201,result);
      }
      if(pathname==='/api/feedback'&&method==='GET'){
        const baseId=cleanString(url.searchParams.get('baseId'),200);if(baseId)getBase(user,baseId);
        const feedback=store.list('feedback').filter(f=>(!baseId||store.get('document',f.documentId)?.baseId===baseId)&&(isAdmin(user)||f.userId===user.id||(canEdit(user)&&f.documentId&&canDocument(user,store.get('document',f.documentId),store)))).sort(sortRecent);
        return send(res,200,{feedback:feedback.map(row=>({...row,learning:feedbackLearningStatus(store,user,row)})),scope:{baseId,label:baseId?store.get('base',baseId).name:'全部可访问知识库'}});
      }
      if(pathname==='/api/feedback'&&method==='POST'){const input=inputBody();if(input.documentId)getDoc(user,input.documentId);if(input.messageId){const m=store.get('message',input.messageId);requireValue(m&&store.get('conversation',m.conversationId)?.userId===user.id,404,'MESSAGE_NOT_FOUND','问答记录不存在。');}const item={id:uid('feedback_'),userId:user.id,userName:user.name,question:cleanString(input.question,4000),type:cleanString(input.type,60)||'other',comment:cleanString(input.comment,4000),documentId:input.documentId||null,messageId:input.messageId||null,status:'open',resolution:'',createdAt:now(),updatedAt:now()};requireValue(item.comment||item.question,400,'FEEDBACK_REQUIRED','请填写问题或反馈内容。');store.put('feedback',item);audit(user,'feedback.created',{target:item.id,documentId:item.documentId});return send(res,201,{feedback:item});}
      const feedbackMatch=pathname.match(/^\/api\/feedback\/([^/]+)$/);if(feedbackMatch&&method==='PATCH'){requireEditor(user);const item=store.get('feedback',feedbackMatch[1]);requireValue(item&&(isAdmin(user)||(item.documentId&&canDocument(user,store.get('document',item.documentId),store))),404,'FEEDBACK_NOT_FOUND','反馈不存在或无权处理。');const input=inputBody();requireValue(['open','in_progress','resolved'].includes(input.status),400,'INVALID_STATUS','反馈状态无效。');const resolution=cleanString(input.resolution,4000);requireValue(input.status!=='resolved'||resolution,400,'RESOLUTION_REQUIRED','关闭反馈前请填写处理说明及复核结果。');const next=store.put('feedback',{...item,status:input.status,resolution,assigneeId:user.id,assigneeName:user.name,updatedAt:now(),resolvedAt:input.status==='resolved'?now():null});audit(user,'feedback.updated',{target:item.id,documentId:item.documentId,message:input.status});return send(res,200,{feedback:next});}

      if(pathname==='/api/favorites'&&method==='GET')return send(res,200,{favorites:store.list('favorite').filter(f=>f.userId===user.id).map(f=>({...f,document:store.get('document',f.documentId)})).filter(f=>canDocument(user,f.document,store)).map(f=>({...f,title:f.document.title,fileName:f.document.fileName,version:f.document.version,status:f.document.status,document:exportedDoc(store,f.document)})).sort(sortRecent)});
      if(pathname==='/api/favorites'&&method==='POST'){const input=inputBody();const document=getDoc(user,input.documentId);const old=store.list('favorite').find(f=>f.userId===user.id&&f.documentId===document.id);const favorite=old||store.put('favorite',{id:uid('favorite_'),documentId:document.id,userId:user.id,createdAt:now()});return send(res,201,{favorite:{...favorite,title:document.title}});}
      const favoriteMatch=pathname.match(/^\/api\/favorites\/([^/]+)$/);if(favoriteMatch&&method==='DELETE'){for(const f of store.list('favorite').filter(f=>f.userId===user.id&&(f.documentId===favoriteMatch[1]||f.id===favoriteMatch[1])))store.del('favorite',f.id);return send(res,200,{ok:true});}

      if(pathname==='/api/tasks'&&method==='GET'){const baseId=cleanString(url.searchParams.get('baseId'),200);if(baseId)getBase(user,baseId);return send(res,200,{tasks:store.list('task').filter(t=>{const doc=store.get('document',t.documentId);return canDocument(user,doc,store)&&(!baseId||doc.baseId===baseId);}).sort(sortRecent).slice(0,300),scope:{baseId,label:baseId?store.get('base',baseId).name:'全部可访问知识库'}});}
      if(pathname==='/api/dashboard'&&method==='GET'){const docs=store.list('document').filter(d=>canDocument(user,d,store));const tasks=store.list('task').filter(t=>docs.some(d=>d.id===t.documentId)).sort(sortRecent).slice(0,8);return send(res,200,{stats:{totalDocuments:docs.length,publishedDocuments:docs.filter(isRetrievable).length,pendingReview:docs.filter(d=>d.status==='review').length,totalBases:store.list('base').filter(b=>canBase(user,b)).length,documents:docs.length,published:docs.filter(isRetrievable).length,review:docs.filter(d=>d.status==='review').length,failed:docs.filter(d=>d.status==='failed').length,bases:store.list('base').filter(b=>canBase(user,b)).length,chunks:docs.reduce((n,d)=>n+d.chunkCount,0),questions:store.list('conversation').filter(c=>c.userId===user.id).length,feedback:store.list('feedback').filter(f=>(isAdmin(user)||f.userId===user.id)&&f.status!=='resolved').length},recentDocuments:docs.sort(sortRecent).slice(0,8).map(d=>exportedDoc(store,d)),tasks,activity:store.events(100).filter(e=>isAdmin(user)||e.actorId===user.id||(e.documentId&&canDocument(user,store.get('document',e.documentId),store))).slice(0,12).map(safeAudit),model:publicModel(store)});}
      if(pathname==='/api/governance'&&method==='GET'){
        requireEditor(user);const baseId=cleanString(url.searchParams.get('baseId'),200);if(baseId)getBase(user,baseId);const docs=store.list('document').filter(d=>(!baseId||d.baseId===baseId)&&canDocument(user,d,store)),issues=docs.flatMap(d=>documentIssues(store,user,d).map(issue=>({...issue,baseId:d.baseId}))),open=issues.filter(i=>i.issueStatus==='open');
        const notes=docs.filter(d=>!['archived','superseded'].includes(d.status)).map(d=>({documentId:d.id,baseId:d.baseId,title:d.title,notes:parserMessages(d).notes})).filter(d=>d.notes.length);
        return send(res,200,{issues,notes,scope:{baseId,label:baseId?store.get('base',baseId).name:'全部可访问知识库'},stats:{total:open.length,acknowledged:issues.length-open.length,high:open.filter(i=>i.severity==='high').length,pendingReview:open.filter(i=>i.type==='pending_review').length,expired:open.filter(i=>i.type==='expired').length,expiring:open.filter(i=>i.type==='expiring').length,reviewDue:open.filter(i=>i.type==='review_due').length,unresolvedFeedback:store.list('feedback').filter(f=>f.status!=='resolved'&&(!baseId||docs.some(d=>d.id===f.documentId))&&(isAdmin(user)||(f.documentId&&canDocument(user,store.get('document',f.documentId),store)))).length}});
      }
      if(pathname==='/api/governance/actions'&&method==='POST'){
        const input=inputBody();const document=store.transaction(()=>{user=currentActor();requireEditor(user);const doc=getDoc(user,input.documentId,true);checkRevision(doc,input.revision);const patch={...applyGovernanceAction(doc,input,user,now()),...(input.action==='review'?resolveSourceCategory(store,input,doc):{})};const next=patchDoc(doc,patch);audit(user,'governance.'+input.action,{documentId:doc.id,documentTitle:doc.title,type:input.type,reason:cleanString(input.reason,2000),version:doc.version,fingerprint:patch.governanceAcknowledgements?.parse_warning?.fingerprint,nextReviewAt:patch.reviewDueAt,metadataFields:['sourceKind','applicability','businessOwner'].filter(key=>Object.hasOwn(patch,key)&&patch[key]!==doc[key])});return next;});
        return send(res,200,{document:exportedDoc(store,document),issues:documentIssues(store,user,document)});
      }
      if(pathname==='/api/audit'&&method==='GET'){requireAdmin(user);return send(res,200,{events:store.events(500).map(safeAudit)});}
      if(pathname==='/api/users'&&method==='GET'){requireAdmin(user);return send(res,200,{users:accountUsers(store).map(safeUser)});}
      if(pathname==='/api/users'&&method==='POST'){requireAdmin(user);const input=inputBody(),username=cleanString(input.username,80);requireValue(/^[a-zA-Z0-9_.@-]{3,80}$/.test(username),400,'INVALID_USERNAME','账号须为 3–80 位字母、数字或 . _ @ -。');requireValue(['admin','editor','viewer'].includes(input.role),400,'INVALID_ROLE','用户角色无效。');const hash=await passwordHash(input.password);user=currentActor();requireAdmin(user);requireValue(!store.list('user').some(u=>u.username.toLowerCase()===username.toLowerCase()),409,'USERNAME_EXISTS','账号已存在。');const next={id:uid('user_'),username,name:cleanString(input.name,80)||username,role:input.role,department:cleanString(input.department,100),active:true,passwordHash:hash,createdAt:now()};store.put('user',next);audit(user,'user.created',{target:next.id,message:next.username});return send(res,201,{user:safeUser(next)});}
      const userMatch=pathname.match(/^\/api\/users\/([^/]+)$/);if(userMatch&&method==='PATCH'){requireAdmin(user);let target=store.get('user',userMatch[1]);requireValue(target,404,'USER_NOT_FOUND','用户不存在。');const input=inputBody(),patch={};if(input.role!==undefined){requireValue(['admin','editor','viewer'].includes(input.role),400,'INVALID_ROLE','角色无效。');patch.role=input.role;}if(input.active!==undefined){requireValue(typeof input.active==='boolean',400,'INVALID_ACTIVE','启用状态无效。');patch.active=input.active;}for(const key of ['name','department'])if(input[key]!==undefined)patch[key]=cleanString(input[key],100);if(input.password)patch.passwordHash=await passwordHash(input.password);user=currentActor();requireAdmin(user);target=store.get('user',userMatch[1]);requireValue(target,404,'USER_NOT_FOUND','用户不存在。');if(target.role==='admin'&&target.active&&(patch.role&&patch.role!=='admin'||patch.active===false))requireValue(store.list('user').some(u=>u.id!==target.id&&u.role==='admin'&&u.active),409,'LAST_ADMIN','至少保留一位有效管理员。');const next=store.put('user',{...target,...patch,updatedAt:now()});if(patch.role||patch.department!==undefined||patch.active===false||patch.passwordHash)store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);audit(user,'user.updated',{target:next.id,message:'用户资料、权限或凭据已更新'});return send(res,200,{user:safeUser(next)});}
      if(pathname==='/api/settings'&&method==='GET'){requireAdmin(user);return send(res,200,{settings:{model:publicModel(store),organization:store.get('setting','organization')||{name:'企业知识库',reviewDays:365},connectorRoots:roots()},providers:listPublicProviders(store),presets:MODEL_PROVIDER_PRESETS.map(({envKey,...rest})=>({...rest,hasEnvKey:Boolean(envKey&&process.env[envKey])})),capabilities:{modelConfigured:publicModel(store).configured,formats:Object.keys(FILE_TYPES).map(s=>s.slice(1).toUpperCase()),maxFileSizeMB:100,ocr:true,hybridSearch:publicModel(store).embeddingEnabled,lexicalSearch:true,versioning:true,serverAcl:true,backups:true,connectors:true,sso:!!(process.env.OIDC_ISSUER&&process.env.OIDC_CLIENT_ID&&process.env.PUBLIC_ORIGIN),architecture:'single-node-sqlite',notes:['扫描件支持本地中英文 OCR；无法识别或超出限制时会明确报错','仅已审核发布且在有效期内的文档参与问答','优先使用已校验的离线 BGE 中文语义模型；模型缺失时明确降级为中文 BM25 全文检索']}});}
      if(pathname==='/api/settings'&&method==='PUT'){requireAdmin(user);const input=inputBody();if(input.model){const old=store.get('setting','model')||{id:'model'},value=input.model,patch={};if(value.provider!==undefined){requireValue(['disabled','compatible','ollama'].includes(value.provider),400,'INVALID_PROVIDER','模型类型无效。');patch.provider=value.provider;}for(const key of ['baseUrl','embeddingBaseUrl'])if(value[key]!==undefined){const v=cleanString(value[key],500);if(v&&!(key==='embeddingBaseUrl'&&v==='local://bge'))await validateEndpoint(v,patch.provider||old.provider||'compatible',{allowInternalModelHosts:true});patch[key]=v;}for(const key of ['model','embeddingModel'])if(value[key]!==undefined)patch[key]=cleanString(value[key],120);if(value.timeoutMs!==undefined){requireValue(Number.isFinite(Number(value.timeoutMs)),400,'INVALID_TIMEOUT','超时时间无效。');patch.timeoutMs=Math.max(5000,Math.min(120000,Number(value.timeoutMs)));}if(typeof value.apiKey==='string'&&value.apiKey.trim()){requireValue(value.apiKey.length<1000,400,'INVALID_KEY','密钥长度无效。');patch.sealedApiKey=store.seal(value.apiKey.trim());}if(typeof value.embeddingApiKey==='string'&&value.embeddingApiKey.trim())patch.sealedEmbeddingApiKey=store.seal(value.embeddingApiKey.trim());if(value.clearApiKey===true)patch.sealedApiKey=null;if(value.clearEmbeddingApiKey===true)patch.sealedEmbeddingApiKey=null;user=currentActor();requireAdmin(user);requireValue(JSON.stringify(store.get('setting','model')||{id:'model'})===JSON.stringify(old),409,'SETTINGS_CONFLICT','模型设置已被其他人更新，请刷新后重试。');const saved=store.put('setting',{...old,...patch,id:'model'});syncProviderFromLegacyModel(store,saved);if(['provider','embeddingModel','embeddingBaseUrl','sealedEmbeddingApiKey','timeoutMs'].some(key=>Object.hasOwn(patch,key)&&patch[key]!==old[key]))for(const document of store.list('document').filter(d=>d.embeddingStatus==='failed'))store.put('document',{...document,embeddingStatus:'pending',embeddingRunId:null,embeddingError:null,...clearIndexRetry()});}if(input.organization){store.put('setting',{id:'organization',name:cleanString(input.organization.name,120)||'企业知识库',reviewDays:Math.min(3650,Math.max(1,Number(input.organization.reviewDays)||365))});}if(startWorker)backfillIndexes();audit(user,'settings.updated',{message:'系统设置已更新，密钥已隐藏'});return send(res,200,{settings:{model:publicModel(store),organization:store.get('setting','organization')},providers:listPublicProviders(store)});}
      if(pathname==='/api/settings/model/test'&&method==='POST'){requireAdmin(user);rate(`modeltest:${user.id}`,6,60000);const result=await testModel(store);store.put('setting',{id:'modelTest',...result});audit(user,'model.test',{message:`${result.model} 连接成功`,latencyMs:result.latencyMs});return send(res,200,result);}
      if(pathname==='/api/settings/model-providers'&&method==='GET'){requireAdmin(user);return send(res,200,{providers:listPublicProviders(store),presets:MODEL_PROVIDER_PRESETS.map(({envKey,...rest})=>({...rest,hasEnvKey:Boolean(envKey&&process.env[envKey])})),model:publicModel(store)});}
      if(pathname==='/api/settings/model-providers'&&method==='POST'){requireAdmin(user);const input=inputBody();const provider=await createModelProvider(store,input);audit(user,'settings.updated',{message:`已接入模型服务 ${provider.name}`,target:provider.id});return send(res,201,{provider,providers:listPublicProviders(store),model:publicModel(store)});}
      if(pathname==='/api/settings/model-default'&&method==='PUT'){requireAdmin(user);const input=inputBody();const result=setDefaultModelProvider(store,input);audit(user,'settings.updated',{message:`已将默认模型切换为 ${result.provider.name} / ${result.model.model}`,target:result.provider.id});return send(res,200,{...result,providers:listPublicProviders(store)});}
      const providerMatch=pathname.match(/^\/api\/settings\/model-providers\/([^/]+)$/);
      if(providerMatch&&method==='PATCH'){requireAdmin(user);const provider=await updateModelProvider(store,providerMatch[1],inputBody());audit(user,'settings.updated',{message:`已更新模型服务 ${provider.name}`,target:provider.id});return send(res,200,{provider,providers:listPublicProviders(store),model:publicModel(store)});}
      if(providerMatch&&method==='DELETE'){requireAdmin(user);deleteModelProvider(store,providerMatch[1]);audit(user,'settings.updated',{message:'已删除模型服务',target:providerMatch[1]});return send(res,200,{ok:true,providers:listPublicProviders(store),model:publicModel(store)});}
      const providerTestMatch=pathname.match(/^\/api\/settings\/model-providers\/([^/]+)\/test$/);
      if(providerTestMatch&&method==='POST'){requireAdmin(user);rate(`modeltest:${user.id}`,6,60000);const input=inputBody();const result=await testModelProvider(store,providerTestMatch[1],input);store.put('setting',{id:'modelTest',...result});audit(user,'model.test',{message:`${result.model} 连接成功`,latencyMs:result.latencyMs,target:providerTestMatch[1]});return send(res,200,{...result,providers:listPublicProviders(store)});}
      if(pathname==='/api/operations'&&method==='GET'){requireAdmin(user);const docs=store.list('document'),uploadFiles=readdirSync(path.join(store.dataDir,'uploads')).filter(n=>!n.startsWith('.'));const backups=readdirSync(path.join(store.dataDir,'backups')).filter(n=>existsSync(path.join(store.dataDir,'backups',n,'manifest.json'))&&!existsSync(path.join(store.dataDir,'backups',n,'FAILED.txt'))).map(n=>{const m=JSON.parse(readFileSync(path.join(store.dataDir,'backups',n,'manifest.json'),'utf8'));return {id:m.id,createdAt:m.createdAt,documentCount:m.documentCount,verified:true};}).sort(sortRecent);const missing=docs.filter(d=>!existsSync(path.join(store.dataDir,'uploads',d.storageName))).map(d=>d.id);return send(res,200,{health:readiness(),storage:{documentCount:docs.length,fileCount:uploadFiles.length,totalBytes:docs.reduce((n,d)=>n+d.size,0),databaseBytes:statSync(path.join(store.dataDir,'knowledge.sqlite')).size,missingFiles:missing,orphanFiles:uploadFiles.filter(n=>!docs.some(d=>d.storageName===n)).length},model:{...publicModel(store),lastTest:store.get('setting','modelTest')},metrics:{...usage,latencyScope:'completed-api-requests-since-start',chatLatencyScope:'recorded-chat-retrieval-and-generation',uptimeSeconds:Math.floor((Date.now()-Date.parse(usage.startedAt))/1000),pendingTasks:store.list('task').filter(t=>t.status==='queued').length,failedTasks:store.list('task').filter(t=>t.status==='failed').length},backups});}
      if(pathname==='/api/operations/backup'&&method==='POST'){requireAdmin(user);return send(res,201,await createBackup(user));}
      if(pathname==='/api/connectors'&&method==='GET'){requireAdmin(user);return send(res,200,{connectors:store.list('connector'),allowedRoots:roots()});}
      if(pathname==='/api/connectors'&&method==='POST'){requireAdmin(user);const input=inputBody();getBase(user,input.baseId);const folder=checkedFolder(input.path),name=cleanString(input.name,120)||path.basename(folder);const intervalMinutes=Number(input.intervalMinutes)||0;requireValue([0,15,60,1440].includes(intervalMinutes),400,'INVALID_SYNC_INTERVAL','同步周期支持手动、15分钟、每小时或每天。');const connector={id:uid('connector_'),name,path:folder,baseId:input.baseId,status:'ready',archiveDeleted:input.archiveDeleted===true,intervalMinutes,nextSyncAt:intervalMinutes?new Date(Date.now()+intervalMinutes*60000).toISOString():null,lastSyncAt:null,lastError:null,stats:null,createdAt:now(),ownerId:user.id};store.put('connector',connector);audit(user,'connector.created',{target:connector.id,message:name});return send(res,201,{connector});}

      const connectorItemMatch=pathname.match(/^\/api\/connectors\/([^/]+)$/);if(connectorItemMatch&&method==='PATCH'){requireAdmin(user);const connector=store.get('connector',connectorItemMatch[1]);requireValue(connector,404,'CONNECTOR_NOT_FOUND','同步连接器不存在。');requireValue(connector.status!=='syncing',409,'CONNECTOR_BUSY','同步期间不能修改连接器。');const input=inputBody(),patch={};if(input.name!==undefined)patch.name=cleanString(input.name,120);if(input.archiveDeleted!==undefined)patch.archiveDeleted=input.archiveDeleted===true;if(input.intervalMinutes!==undefined){requireValue([0,15,60,1440].includes(Number(input.intervalMinutes)),400,'INVALID_SYNC_INTERVAL','同步周期支持手动、15分钟、每小时或每天。');patch.intervalMinutes=Number(input.intervalMinutes);}const next=store.put('connector',{...connector,...patch,ownerId:user.id,status:'ready',nextSyncAt:patch.intervalMinutes?new Date(Date.now()+patch.intervalMinutes*60000).toISOString():null});audit(user,'connector.updated',{target:next.id,message:next.name});return send(res,200,{connector:next});}
      if(connectorItemMatch&&method==='DELETE'){requireAdmin(user);const connector=store.get('connector',connectorItemMatch[1]);requireValue(connector,404,'CONNECTOR_NOT_FOUND','同步连接器不存在。');requireValue(connector.status!=='syncing',409,'CONNECTOR_BUSY','同步期间不能删除连接器。');store.del('connector',connector.id);audit(user,'connector.deleted',{target:connector.id,message:'连接器已移除，已导入原件与知识版本继续保留'});return send(res,200,{ok:true});}

      const connectorMatch=pathname.match(/^\/api\/connectors\/([^/]+)\/sync$/);if(connectorMatch&&method==='POST'){requireAdmin(user);const connector=store.get('connector',connectorMatch[1]);requireValue(connector,404,'CONNECTOR_NOT_FOUND','同步连接器不存在。');return send(res,200,await syncConnector(user,connector));}
      throw failure(404,'NOT_FOUND','接口不存在。');
    }catch(e){usage.errors++;res.xragErrorCode=e.code||'INTERNAL_ERROR';const status=e.status||500;if(!res.headersSent&&!res.destroyed)send(res,status,{error:{code:e.code||'INTERNAL_ERROR',message:status===500?'服务处理失败，请检查服务器日志或联系管理员。':e.message}});if(status===500)console.error(`[api] request failed (${e.code||e.name||'INTERNAL_ERROR'})`);}
  };
  const handler=(req,res)=>instrumentRequest(store,req,res,()=>handlerCore(req,res));
  startIntelligence(store,{startWorker});
  knowledgeWorker=createKnowledgeUpgradeWorker({store,ingest,startWorker});
  if(startWorker&&existsSync(path.join(projectDir,'server','extensions.mjs')))stopExtensions=(await import('./extensions.mjs')).startExtensions?.(store);
  return {handler,store,runQueue,backfillIndexes,ingest,readiness,async close(){closed=true;await finishBackground();store.close();}};
  }catch(error){closed=true;await finishBackground();store.close();throw error;}
}

export async function startServer(options={}){
  const app=await createApp(options),server=http.createServer(app.handler);
  server.requestTimeout=180000;server.headersTimeout=20000;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(process.env.API_PORT)||8787,process.env.API_HOST||'127.0.0.1',resolve);});
  }catch(error){server.close();await app.close();throw error;}
  console.log(`X-RAG API ready at http://${process.env.API_HOST||'127.0.0.1'}:${Number(process.env.API_PORT)||8787}`);
  let closing;
  const close=()=>closing ||= (async()=>{await new Promise(resolve=>server.close(resolve));await app.close();})();
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)));
  return {app,server,close};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer().catch(e=>{console.error(`X-RAG startup failed (${e.code||e.name||'STARTUP_ERROR'})`);process.exitCode=1;});

