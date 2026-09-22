import { now, uid } from './database.mjs';
import { canBase, canDocument, canEdit, isAdmin, isRetrievable, cleanString, requireValue } from './security.mjs';
import { documentIssues, SOURCE_KINDS } from './governance.mjs';
import { listKnowledgeIssues } from './knowledge-checks.mjs';
import { listRelations } from './knowledge-graph.mjs';
import { documentFingerprint, digest } from './knowledge-evidence.mjs';
import { evidenceCurrent, evidenceBundleCurrent } from './intelligence.mjs';

const recent=(a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt));
const statuses=['open','in_progress','verified','dismissed'];
const safeDate=value=>{if(!value)return null;requireValue(typeof value==='string'&&Number.isFinite(Date.parse(value)),400,'CASE_DATE_INVALID','办理期限格式不正确。');return new Date(value).toISOString();};
const docRef=(store,user,id,version,{write=false,published=false}={})=>{
  const doc=store.get('document',id);requireValue(canDocument(user,doc,store,{write}),404,'DOCUMENT_NOT_FOUND','关联资料不存在或无权访问。');
  requireValue(Number.isSafeInteger(version)&&version===doc.version,409,'DOCUMENT_VERSION_CHANGED','关联资料版本不匹配，请刷新。');
  if(published)requireValue(isRetrievable(doc),409,'CASE_PUBLISHED_EVIDENCE_REQUIRED','验证必须关联当前有效且已发布的资料。');
  return doc;
};
function canCase(store,user,item,write=false){
  if(!item||!canBase(user,store.get('base',item.baseId)))return false;
  if(write&&!canEdit(user))return false;
  if(!isAdmin(user)&&item.createdBy!==user.id&&!canEdit(user))return false;
  if(item.documentId&&!canDocument(user,store.get('document',item.documentId),store,{write}))return false;
  if(item.verification?.documentId&&!canDocument(user,store.get('document',item.verification.documentId),store,{write}))return false;
  if((item.history||[]).some(h=>h.verification?.documentId&&!canDocument(user,store.get('document',h.verification.documentId),store)))return false;
  if(item.feedbackId){const feedback=store.get('feedback',item.feedbackId);if(!feedback||!canFeedback(store,user,feedback))return false;}
  if(item.runId){const run=store.get('intelligenceRun',item.runId);if(!run||run.userId!==user.id&&!isAdmin(user)||!runVisible(store,user,run))return false;}
  return true;
}
function canFeedback(store,user,feedback){
  if(feedback.documentId&&!canDocument(user,store.get('document',feedback.documentId),store))return false;
  if(feedback.messageId){const message=store.get('message',feedback.messageId),conversation=message&&store.get('conversation',message.conversationId);if(!conversation||!isAdmin(user)&&conversation.userId!==user.id||!evidenceBundleCurrent(store,user,message))return false;}
  return isAdmin(user)||feedback.userId===user.id||canEdit(user)&&feedback.documentId&&canDocument(user,store.get('document',feedback.documentId),store,{write:true});
}
function verificationCurrent(store,user,item){
  if(!item.verification)return false;
  const v=item.verification,doc=store.get('document',v.documentId);
  return !!doc&&canDocument(user,doc,store)&&isRetrievable(doc)&&doc.version===v.documentVersion&&documentFingerprint(doc,store.chunks(doc.id))===v.fingerprint&&(!v.evaluationId||validEvaluation(store,user,item,v,doc,false));
}
function workspaceRunRoute(store,user,run){
  if(!run||!runVisible(store,user,run))return undefined;
  if(run.userId===user.id&&run.conversationId&&store.get('conversation',run.conversationId)?.userId===user.id)return '/application/chat?conversationId='+encodeURIComponent(run.conversationId);
  if(isAdmin(user)&&run.traceId&&store.get('trace',run.traceId))return '/settings/traces?trace='+encodeURIComponent(run.traceId);
  return undefined;
}
function publicCase(store,user,item){const {creationFingerprint,...safe}=item;const runRoute=item.runId?workspaceRunRoute(store,user,store.get('intelligenceRun',item.runId)):undefined;return {...safe,...(runRoute?{runRoute}:{}),canManage:canCase(store,user,item,true),verificationCurrent:verificationCurrent(store,user,item)};}
const caseStats=items=>({total:items.length,...Object.fromEntries(statuses.map(status=>[status,items.filter(c=>c.status===status).length])),staleVerification:items.filter(c=>c.status==='verified'&&!c.verificationCurrent).length});
export function listWorkspaceCases(store,user,{baseId=''}={}){
  if(baseId)requireValue(canBase(user,store.get('base',baseId)),404,'BASE_NOT_FOUND','知识库不存在或无权访问。');
  const cases=store.list('workspaceCase').filter(c=>(!baseId||c.baseId===baseId)&&canCase(store,user,c)).map(c=>publicCase(store,user,c)).sort(recent);
  return {cases,stats:caseStats(cases)};
}
function validEvaluation(store,user,item,verification,doc,throwOnFailure=true){
  const evaluation=store.get('promptEvaluation',verification.evaluationId),version=evaluation&&store.get('promptVersion',evaluation.versionId),run=item.runId&&store.get('intelligenceRun',item.runId);
  const valid=!!evaluation&&!!run&&evaluation.status==='completed'&&evaluation.total>=2&&evaluation.completed===evaluation.total&&evaluation.passed===evaluation.total&&Date.parse(evaluation.createdAt)>=Date.parse(item.createdAt)&&version?.status==='published'&&version.publishedEvaluationRef===evaluation.id&&version.templateId===run.templateSnapshot?.templateId&&evaluation.results?.some(row=>row.passed&&row.citations?.some(ref=>ref.documentId===doc.id&&ref.version===doc.version))&&evaluation.results.every(row=>evidenceCurrent(store,user,row.citations||[]));
  if(throwOnFailure)requireValue(valid,409,'CASE_EVALUATION_REQUIRED','评测必须来自原问答场景，办理后完成并全部通过，发布生效且引用当前资料版本。');
  return valid;
}
export function createWorkspaceCase(store,user,input){
  requireValue(canEdit(user),403,'EDITOR_REQUIRED','办理事项需要知识维护权限。');
  const baseId=cleanString(input.baseId,200),base=store.get('base',baseId);requireValue(canBase(user,base),404,'BASE_NOT_FOUND','知识库不存在或无权访问。');
  const title=cleanString(input.title,240),description=cleanString(input.description,4000),kind=input.kind||'clarification';
  requireValue(title&&description,400,'CASE_CONTENT_REQUIRED','请填写事项名称和问题说明。');requireValue(['revision','clarification'].includes(kind),400,'CASE_KIND_INVALID','事项类型无效。');
  let document=null;
  if(input.documentId){document=docRef(store,user,cleanString(input.documentId,200),input.documentVersion,{write:true});requireValue(document.baseId===baseId,400,'CASE_SCOPE_MISMATCH','关联文档须属于事项知识库。');}
  requireValue(kind!=='revision'||document,400,'CASE_ORIGINAL_REQUIRED','更正事项需要关联原文档及版本。');
  const feedbackId=cleanString(input.feedbackId,200)||null,runId=cleanString(input.runId,200)||null;
  if(feedbackId){const feedback=store.get('feedback',feedbackId);requireValue(feedback&&canFeedback(store,user,feedback),404,'FEEDBACK_NOT_FOUND','反馈不存在或无权访问。');if(feedback.documentId)requireValue(document?.id===feedback.documentId,400,'CASE_FEEDBACK_MISMATCH','事项原文档须与反馈文档一致。');}
  if(runId){const run=store.get('intelligenceRun',runId);requireValue(run&&(isAdmin(user)||run.userId===user.id)&&runVisible(store,user,run),404,'RUN_NOT_FOUND','问答运行不存在或无权访问。');requireValue(!run.baseId||run.baseId===baseId,400,'CASE_SCOPE_MISMATCH','问答运行不在事项范围内。');if(document)requireValue(run.documentId===document.id||(run.result?.citations||[]).some(c=>c.documentId===document.id&&c.version===document.version),400,'CASE_RUN_DOCUMENT_MISMATCH','关联原文档必须是该问答实际选择或引用的资料。');}
  const sourceKind=document?.sourceKind==='synthetic'?'synthetic':input.sourceKind||document?.sourceKind||'unspecified';requireValue(SOURCE_KINDS.includes(sourceKind),400,'INVALID_SOURCE_KIND','来源性质无效。');
  const seedKey=cleanString(input.seedKey,120);requireValue(!seedKey||sourceKind==='synthetic',400,'CASE_SEED_SYNTHETIC_ONLY','演示数据标识只能用于合成示例事项。');
  const creationFingerprint=digest({title,description,baseId,kind,documentId:document?.id||null,documentVersion:document?.version||null,feedbackId,runId,sourceKind});
  if(seedKey){const prior=store.list('workspaceCase').find(c=>c.createdBy===user.id&&c.seedKey===seedKey);if(prior){requireValue(canCase(store,user,prior)&&prior.creationFingerprint===creationFingerprint,409,'CASE_SEED_CONFLICT','相同演示标识已用于不同事项。');return publicCase(store,user,prior);}}
  const timestamp=now(),assigneeLabel=cleanString(input.assigneeLabel,120),item={id:uid('case_'),title,description,baseId,kind,sourceKind,status:'open',revision:1,documentId:document?.id||null,documentVersion:document?.version||null,feedbackId,runId,assigneeLabel,dueAt:safeDate(input.dueAt),createdBy:user.id,createdAt:timestamp,updatedAt:timestamp,reason:'登记问题',verification:null,history:[{id:uid('case_event_'),at:timestamp,actorId:user.id,actorName:user.name||'知识维护人员',from:null,to:'open',reason:'登记问题',assigneeLabel}],...(seedKey?{seedKey,creationFingerprint}:{})};
  store.transaction(()=>{store.put('workspaceCase',item);store.audit(user,'workspace.case.created',{target:item.id,documentId:item.documentId,sourceKind});});return publicCase(store,user,item);
}
export function updateWorkspaceCase(store,user,id,input){
  const item=store.get('workspaceCase',id);requireValue(canCase(store,user,item,true),404,'CASE_NOT_FOUND','办理事项不存在或无权处理。');
  requireValue(Number.isSafeInteger(input.revision)&&input.revision===item.revision,409,'CASE_REVISION_CONFLICT','办理事项已更新，请刷新后重试。');
  const reason=cleanString(input.reason,4000),status=input.status||item.status;requireValue(reason.length>=2,400,'CASE_REASON_REQUIRED','请填写本次办理说明。');requireValue(statuses.includes(status),400,'CASE_STATUS_INVALID','事项状态无效。');
  requireValue(!['verified','dismissed'].includes(item.status)||status==='open',409,'CASE_REOPEN_REQUIRED','已完成事项需要先重新打开，保留原办理记录。');
  let verification=item.verification;
  if(status==='verified'){
    requireValue(item.status==='in_progress',409,'CASE_IN_PROGRESS_REQUIRED','请先开始办理，再登记验证结果。');
    const v=input.verification||{},note=cleanString(v.note,4000);requireValue(note.length>=8,400,'CASE_VERIFICATION_NOTE_REQUIRED','请填写明确的人工核验过程与结论，至少8个字符。');
    const doc=docRef(store,user,cleanString(v.documentId,200),v.documentVersion,{write:true,published:true});requireValue(doc.baseId===item.baseId,400,'CASE_SCOPE_MISMATCH','验证资料须属于事项知识库。');
    if(item.kind==='revision'){
      const original=store.get('document',item.documentId),revised=doc.version>item.documentVersion&&(doc.familyId||doc.id)===(original.familyId||original.id);
      if(!revised){requireValue(v.evaluationId,409,'CASE_NEW_VERSION_REQUIRED','更正事项需关联同一文档的新发布版本，或关联本事项原问答场景的有效评测。');validEvaluation(store,user,item,v,doc);}
    }else if(v.evaluationId)validEvaluation(store,user,item,v,doc);
    verification={documentId:doc.id,documentVersion:doc.version,note,...(v.evaluationId?{evaluationId:cleanString(v.evaluationId,200)}:{}),fingerprint:documentFingerprint(doc,store.chunks(doc.id)),verifiedAt:now(),verifiedBy:user.id};
  }
  if(status==='open')verification=null;
  const timestamp=now(),assigneeLabel=input.assigneeLabel===undefined?item.assigneeLabel:cleanString(input.assigneeLabel,120);
  const next={...item,status,reason,assigneeLabel,dueAt:input.dueAt===undefined?item.dueAt:safeDate(input.dueAt),verification,revision:item.revision+1,updatedAt:timestamp,history:[...item.history,{id:uid('case_event_'),at:timestamp,actorId:user.id,actorName:user.name||'知识维护人员',from:item.status,to:status,reason,assigneeLabel,verification}]};
  store.transaction(()=>{store.put('workspaceCase',next);store.audit(user,'workspace.case.updated',{target:id,documentId:item.documentId,status,revision:next.revision});});return publicCase(store,user,next);
}
function runVisible(store,user,run){
  if(run.baseId&&!canBase(user,store.get('base',run.baseId)))return false;
  if(run.documentId&&!canDocument(user,store.get('document',run.documentId),store))return false;
  const refs=[...(run.result?.citations||[]),...(run.context?.turns||[]).flatMap(t=>t.citations||[])];
  return refs.every(ref=>canDocument(user,store.get('document',ref.documentId),store));
}
export function workspaceSummary(store,user,{baseId='',exportDocument=d=>d}={}){
  if(baseId)requireValue(canBase(user,store.get('base',baseId)),404,'BASE_NOT_FOUND','知识库不存在或无权访问。');
  const documents=store.list('document').filter(d=>(!baseId||d.baseId===baseId)&&canDocument(user,d,store)),docIds=new Set(documents.map(d=>d.id));
  const bases=store.list('base').filter(b=>(!baseId||b.id===baseId)&&canBase(user,b)).map(b=>({...b,documentCount:documents.filter(d=>d.baseId===b.id).length}));
  const todos=[];const add=(kind,id,title,description,route,doc,extra={})=>todos.push({id,kind,title,description,route,...(doc?{documentId:doc.id,baseId:doc.baseId,sourceKind:doc.sourceKind||'unspecified'}:{}),status:'open',severity:'medium',canManage:!!doc&&canDocument(user,doc,store,{write:true}),...extra});
  if(canEdit(user)){
    for(const doc of documents.filter(d=>canDocument(user,d,store,{write:true})))for(const issue of documentIssues(store,user,doc).filter(i=>i.issueStatus==='open')){
      const kind=issue.type==='pending_review'?'review':issue.type==='parse_failed'?'processing':issue.type==='parse_warning'?'evidence':'review_due';
      add(kind,issue.id,issue.title,issue.message,'/documents/'+encodeURIComponent(doc.id)+(kind==='evidence'?'?tab=evidence':''),doc,{severity:issue.severity,status:issue.status,dueAt:issue.reviewDueAt||issue.expiresAt});
    }
    const issues=listKnowledgeIssues(store,user,{baseId}).issues.filter(i=>['open','in_review','stale'].includes(i.status)&&i.canManage);
    for(const issue of issues){const doc=store.get('document',issue.documentStates[0].id);add('conflict',issue.id,issue.type==='near_duplicate'?'重复候选核验':'来源差异核验',issue.candidateReason,'/governance/knowledge-issues?'+new URLSearchParams({...(baseId?{baseId}:{}),issueId:issue.id}),doc,{status:issue.status});}
    const relations=listRelations(store,user).relations.filter(r=>docIds.has(r.documentId)&&r.canManage&&(r.status==='candidate'||r.stale));
    for(const [documentId,items] of Map.groupBy(relations,r=>r.documentId)){const doc=store.get('document',documentId);add('evidence','relations:'+documentId,doc.title+' · 关系复核',items.length+' 条候选或失效关系待核对','/assets/graph?'+new URLSearchParams({baseId:doc.baseId,status:'candidate'}),doc);}
    for(const doc of documents.filter(d=>canDocument(user,d,store,{write:true})&&['published','review'].includes(d.status))){const pending=store.chunks(doc.id).filter(c=>c.reviewState!=='confirmed'&&(c.table?.reviewRequired||c.quality?.reviewRequired));if(pending.length)add('evidence','blocks:'+doc.id,doc.title+' · 证据校对',pending.length+' 个复杂结构片段需人工核验','/documents/'+encodeURIComponent(doc.id)+'?tab=evidence',doc);}
    for(const task of store.list('task').filter(t=>docIds.has(t.documentId)&&['queued','processing'].includes(t.status))){const doc=store.get('document',task.documentId);if(canDocument(user,doc,store,{write:true}))add('processing',task.id,doc.title+' · '+(task.type==='index'?'语义索引':'资料加工'),task.stage||'等待加工完成','/production/tasks?baseId='+encodeURIComponent(doc.baseId),doc,{status:task.status,severity:'low'});}
    for(const task of store.list('task').filter(t=>docIds.has(t.documentId)&&t.status==='failed'&&t.type==='index')){const doc=store.get('document',task.documentId);if(canDocument(user,doc,store,{write:true})&&doc.embeddingStatus==='failed')add('processing',task.id,doc.title+' · 索引异常',task.error||'语义索引失败，请检查模型服务后重试','/production/tasks?baseId='+encodeURIComponent(doc.baseId),doc,{severity:'high',status:'failed'});}
  }
  for(const feedback of store.list('feedback').filter(f=>f.status!=='resolved'&&canFeedback(store,user,f)&&(!baseId||docIds.has(f.documentId)))){const doc=feedback.documentId?store.get('document',feedback.documentId):null;add('feedback',feedback.id,feedback.question||doc?.title||'知识使用反馈',feedback.comment||'请核对反馈内容','/application/feedback?feedbackId='+encodeURIComponent(feedback.id),doc,{status:feedback.status,canManage:canEdit(user)&&(isAdmin(user)||!!doc&&canDocument(user,doc,store,{write:true}))});}
  const cases=listWorkspaceCases(store,user,{baseId});
  const runs=store.list('intelligenceRun').filter(r=>(isAdmin(user)||r.userId===user.id)&&runVisible(store,user,r)&&(!baseId||r.baseId===baseId||!r.baseId&&r.documentId&&docIds.has(r.documentId))).sort(recent),runIds=new Set(runs.map(r=>r.id));
  const calls=store.list('modelCall').filter(c=>runIds.has(c.runId));
  const by=(items,key)=>items.reduce((map,item)=>{const value=item[key]||'unspecified';map[value]=(map[value]||0)+1;return map;},{});
  const known=calls.filter(c=>c.usageStatus==='known');
  return {scope:{baseId,label:baseId?store.get('base',baseId).name:'全部可访问知识',generatedAt:now(),usageScope:isAdmin(user)?'accessible_runs':'own_runs',canManage:canEdit(user)},bases,documents:{total:documents.length,published:documents.filter(isRetrievable).length,review:documents.filter(d=>d.status==='review').length,failed:documents.filter(d=>d.status==='failed').length,byStatus:by(documents,'status'),bySourceKind:by(documents,'sourceKind')},todos:todos.sort((a,b)=>['high','medium','low'].indexOf(a.severity)-['high','medium','low'].indexOf(b.severity)),todoStats:Object.fromEntries(['review','processing','conflict','review_due','feedback','evidence'].map(kind=>[kind,todos.filter(t=>t.kind===kind).length])),cases:cases.stats,
    usage:{runs:runs.length,completed:runs.filter(r=>r.status==='succeeded').length,failed:runs.filter(r=>['failed','interrupted','partial'].includes(r.status)).length,cancelled:runs.filter(r=>r.status==='cancelled').length,waitingInput:runs.filter(r=>r.status==='waiting_input').length,...Object.fromEntries(['model','extractive','insufficient','tool'].map(mode=>[mode,runs.filter(r=>r.status==='succeeded'&&r.result?.mode===mode).length])),calls:calls.length,knownCalls:known.length,unknownCalls:calls.length-known.length,inputTokens:known.reduce((n,c)=>n+c.inputTokens,0),outputTokens:known.reduce((n,c)=>n+c.outputTokens,0),accountingNote:'运行计数来自持久记录；用量仅汇总保留期内可访问问答运行的模型账本。未返回用量的调用独立计数，不按零用量估算。'},
    recentDocuments:documents.sort(recent).slice(0,8).map(exportDocument),recentRuns:runs.map(r=>({run:r,route:workspaceRunRoute(store,user,r)})).filter(item=>item.route).slice(0,8).map(({run:r,route})=>({id:r.id,conversationId:r.conversationId,question:cleanString(r.question,160),status:r.status,mode:r.result?.mode,createdAt:r.createdAt,durationMs:r.durationMs,route,sourceKind:(r.result?.citations||[]).some(ref=>store.get('document',ref.documentId)?.sourceKind==='synthetic')?'synthetic':'unspecified'}))};
}
export async function handleWorkspace(ctx,{exportDocument}={}){
  const {pathname,method,store,url,res}=ctx;if(!pathname.startsWith('/api/workspace/'))return false;
  const send=(status,data)=>{ctx.send(res,status,data);return true;};let user=ctx.currentActor?ctx.currentActor():ctx.user;
  if(method==='GET'&&pathname==='/api/workspace/summary')return send(200,workspaceSummary(store,user,{baseId:url.searchParams.get('baseId')||'',exportDocument}));
  if(method==='GET'&&pathname==='/api/workspace/cases')return send(200,listWorkspaceCases(store,user,{baseId:url.searchParams.get('baseId')||''}));
  const match=pathname.match(/^\/api\/workspace\/cases\/([^/]+)$/);
  if(method==='GET'&&match){const item=store.get('workspaceCase',match[1]);requireValue(canCase(store,user,item),404,'CASE_NOT_FOUND','办理事项不存在或无权访问。');return send(200,{case:publicCase(store,user,item)});}
  if(method==='POST'&&pathname==='/api/workspace/cases'||method==='PATCH'&&match){const input=await ctx.bodyOf(ctx.req);user=ctx.currentActor?ctx.currentActor():ctx.user;requireValue(user?.active,401,'AUTH_REQUIRED','身份已失效。');requireValue(input&&typeof input==='object'&&!Array.isArray(input),400,'INVALID_JSON','请求必须为对象。');return send(method==='POST'?201:200,{case:method==='POST'?createWorkspaceCase(store,user,input):updateWorkspaceCase(store,user,match[1],input)});}
  return false;
}
