import { now, uid } from './database.mjs';
import { canDocument, canBase, canEdit, isRetrievable, requireValue, cleanString } from './security.mjs';
import { digest, currentActor, checkedDocument, revision, documentFingerprint, evidenceBlocks } from './knowledge-evidence.mjs';

export const CHECK_ALGORITHM='knowledge-checks:lexical-vector-facts:v1';
const activeJobs=new WeakMap();
const normalize=text=>String(text).normalize('NFKC').toLowerCase().replace(/[\s，。；、：!?！？"'“”‘’（）()\[\]【】]/g,'');
function terms(text){const values=new Set(),s=normalize(text);for(const token of s.match(/[a-z0-9_-]+/g)||[])values.add(token);for(const text of s.match(/[\p{Script=Han}]+/gu)||[])for(let n=0;n<text.length-1;n++)values.add(text.slice(n,n+2));return values;}
function similarity(left,right){const a=terms(left),b=terms(right);if(!a.size||!b.size)return 0;let intersection=0;for(const token of a)if(b.has(token))intersection++;return 2*intersection/(a.size+b.size);}
function cosine(a,b){if(!a||!b||a.length!==b.length)return 0;let dot=0,na=0,nb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return na&&nb?dot/Math.sqrt(na*nb):0;}
function facts(text){return [...text.matchAll(/(?:每|不少于|不超过|至少|最多|超过|低于|大于|小于|≤|≥|<|>)?\s*\d+(?:\.\d+)?\s*(?:小时|分钟|天|日|周|月|年|次|万元|元|毫米|厘米|米|%)/g)].map(m=>normalize(m[0]));}
function comparable(left,right){const a=left.text.replace(/\d+(?:\.\d+)?/g,'#').replace(/不得|禁止|严禁|必须|应当|应/g,'要求'),b=right.text.replace(/\d+(?:\.\d+)?/g,'#').replace(/不得|禁止|严禁|必须|应当|应/g,'要求');return similarity(a,b);}
function overlapping(a,b){const start=Math.max(Date.parse(a.effectiveAt)||0,Date.parse(b.effectiveAt)||0),end=Math.min(Date.parse(a.expiresAt)||Infinity,Date.parse(b.expiresAt)||Infinity);return start<end;}
function issueCurrent(store,issue){return issue.documentStates.every(state=>{const document=store.get('document',state.id);return document&&documentFingerprint(document,store.chunks(state.id))===state.fingerprint;});}
function issueAccess(store,user,issue,write=false){return issue.documentStates.every(state=>canDocument(user,store.get('document',state.id),store,{write}));}
export function publicIssue(store,user,issue){
  if(!issueAccess(store,user,issue))return null;
  const stale=!issueCurrent(store,issue),canManage=canEdit(user)&&issueAccess(store,user,issue,true);
  const status=stale?'stale':issue.status;
  return {...issue,stale,status,canManage,actions:canManage?(stale?['reopen']:['resolved','dismissed'].includes(status)?['reopen']:['start','resolve','dismiss']):[],evidenceRefs:issue.evidenceRefs.map(ref=>({...ref,title:store.get('document',ref.documentId)?.title||ref.title,sourceKind:store.get('document',ref.documentId)?.sourceKind||'unspecified',applicability:store.get('document',ref.documentId)?.applicability||'',effectiveAt:store.get('document',ref.documentId)?.effectiveAt||null,expiresAt:store.get('document',ref.documentId)?.expiresAt||null}))};
}
export function listKnowledgeIssues(store,user,{baseId='',status=''}={}){
  const issues=store.list('knowledgeIssue').filter(i=>!baseId||i.baseIds.includes(baseId)).map(i=>publicIssue(store,user,i)).filter(Boolean).filter(i=>!status||i.status===status).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const stats={total:issues.length,open:issues.filter(i=>['open','in_review'].includes(i.status)).length,stale:issues.filter(i=>i.stale).length,resolved:issues.filter(i=>i.status==='resolved').length};
  return {issues,stats};
}
export function knowledgePresentationPolicy(store,user){
  const issues=listKnowledgeIssues(store,user).issues.filter(i=>!i.stale),blocked=new Set(),equivalentGroups=[];
  for(const issue of issues){const documents=issue.documentStates.map(s=>store.get('document',s.id));if(!documents.every(isRetrievable))continue;
    if(issue.type==='conflict'&&['open','in_review'].includes(issue.status))for(const d of documents)blocked.add(d.id);
    if(issue.type==='near_duplicate'&&issue.status==='resolved'&&issue.decision==='equivalent')equivalentGroups.push({id:issue.id,documentIds:documents.map(d=>d.id)});
  }
  return {blockedDocumentIds:[...blocked],equivalentGroups,issues:issues.filter(i=>i.type==='conflict'&&['open','in_review'].includes(i.status)).map(i=>({id:i.id,documentIds:i.documentStates.map(d=>d.id),type:i.type}))};
}

/** Documents confirmed as content-equivalent appear as multi-place applications of the same knowledge. */
export function documentApplications(store,user,documentId){
  if(!documentId)return null;
  const group=knowledgePresentationPolicy(store,user).equivalentGroups.find(row=>row.documentIds.includes(documentId));
  if(!group)return null;
  const peers=group.documentIds.filter(id=>id!==documentId).map(id=>store.get('document',id)).filter(doc=>doc&&canDocument(user,doc,store)).map(doc=>({id:doc.id,title:doc.title,version:doc.version,status:doc.status,baseId:doc.baseId,fileName:doc.fileName}));
  if(!peers.length)return null;
  return {groupId:group.id,issueId:group.id,count:peers.length+1,peers,label:'多处应用',summary:`本资料已与 ${peers.length} 份资料确认为内容等价，检索与推荐中按同一知识多处应用处理；任一侧原件更新后需重新核验等价关系。`};
}

export function checkKnowledge(store,user,{baseId='',maxDocuments=100,maxBlocks=800}={}){
  user=currentActor(store,user);requireValue(canEdit(user),403,'EDITOR_REQUIRED','检查需要编辑权限。');
  if(baseId)requireValue(canBase(user,store.get('base',baseId)),404,'BASE_NOT_FOUND','知识库不存在或无权访问。');
  const documents=store.list('document').filter(d=>(!baseId||d.baseId===baseId)&&['review','published'].includes(d.status)&&canDocument(user,d,store,{write:true}));
  requireValue(documents.length<=maxDocuments,422,'CHECK_SCOPE_TOO_LARGE','本次检查最多100份资料，请指定较小知识库。');
  const items=[],states=new Map();
  for(const document of documents){const chunks=store.chunks(document.id);states.set(document.id,{id:document.id,fingerprint:documentFingerprint(document,chunks)});const blocks=evidenceBlocks(store,document,user);for(const block of blocks.filter(b=>b.text.trim().length>=12)){items.push({document,block,text:block.text});}}
  requireValue(items.length<=maxBlocks,422,'CHECK_SCOPE_TOO_LARGE','本次检查最多800个证据片段，请按知识库拆分。');
  const vectors=new Map();for(const row of store.db.prepare('SELECT id,document_id,embedding,embedding_model FROM chunks WHERE embedding IS NOT NULL').all()){const doc=documents.find(d=>d.id===row.document_id);if(doc&&row.embedding_model===doc.embeddingSignature){try{vectors.set(row.id,{value:JSON.parse(row.embedding),model:row.embedding_model});}catch{}}}
  const candidates=new Map();
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const a=items[i],b=items[j];if(a.document.id===b.document.id||!overlapping(a.document,b.document))continue;
    const identities=text=>[...new Set((text.match(/(?:设备|资产)\s*[A-Za-z][A-Za-z0-9_-]*|\b[A-Za-z]+[-_]?\d+[A-Za-z0-9_-]*\b/g)||[]).map(normalize))].sort();const identityA=identities(a.text),identityB=identities(b.text);if(identityA.length&&identityB.length&&JSON.stringify(identityA)!==JSON.stringify(identityB))continue;
    const lexical=similarity(a.text,b.text),va=vectors.get(a.block.id),vb=vectors.get(b.block.id),semantic=va?.model===vb?.model?cosine(va?.value,vb?.value):0;
    const factA=facts(a.text),factB=facts(b.text),numberDifference=factA.length&&factB.length&&JSON.stringify(factA)!==JSON.stringify(factB);
    const negationDifference=/(不得|禁止|严禁)/.test(a.text)!==/(不得|禁止|严禁)/.test(b.text);
    const shape=comparable(a,b),scopeA=normalize(a.document.applicability||''),scopeB=normalize(b.document.applicability||'');
    let type,reason;
    if((numberDifference||negationDifference)&&shape>=0.72){type=!scopeA||!scopeB||scopeA!==scopeB?'conditions_missing':'conflict';reason=type==='conditions_missing'?'存在数值或要求差异，但适用条件未完整登记或不一致，需先核对可比范围。':numberDifference?'同一登记范围内发现数值、周期或频次差异，需对照条件与原文确认。':'同一登记范围内发现禁止与要求表达差异，需对照条件与原文确认。';}
    else if(lexical>=0.86||semantic>=0.93){type='near_duplicate';reason=normalize(a.text)===normalize(b.text)?'规范化文本相同；来源性质与适用范围仍需独立复核。':'文本或本地向量相近，仅作为等价候选，不自动合并资料。';}
    if(!type)continue;
    const documentStates=[states.get(a.document.id),states.get(b.document.id)].sort((a,b)=>a.id.localeCompare(b.id));
    const key=digest({type,blocks:[a.block.id,b.block.id].sort(),states:documentStates,algorithm:CHECK_ALGORITHM});
    if(candidates.size>=300)break;
    const id='issue_'+key.slice(0,32),old=store.get('knowledgeIssue',id);
    if(old){candidates.set(id,old);continue;}
    const criticalDifferences={numbers:JSON.stringify(a.text.match(/\d+(?:\.\d+)?/g)||[])!==JSON.stringify(b.text.match(/\d+(?:\.\d+)?/g)||[]),negation:negationDifference,sourceKind:a.document.sourceKind!==b.document.sourceKind};
    const evidenceRefs=[a,b].map(v=>({documentId:v.document.id,title:v.document.title,documentVersion:v.document.version,blockId:v.block.id,blockRevision:v.block.blockRevision,text:v.text.slice(0,16000),contentHash:v.block.contentHash,locator:v.block.locator}));
    candidates.set(id,{id,type,status:'open',decisionRevision:1,candidateReason:reason,criticalDifferences,similarity:{lexical:Math.round(lexical*10000)/10000,semantic:semantic?Math.round(semantic*10000)/10000:null,scoreMeaning:'candidate-ranking-only'},evidenceRefs,documentStates,baseIds:[...new Set([a.document.baseId,b.document.baseId])],algorithmVersion:CHECK_ALGORITHM,createdAt:now(),updatedAt:now(),resolution:'',decision:null});
  }
  store.transaction(()=>{const actor=currentActor(store,user);for(const issue of candidates.values()){requireValue(issueAccess(store,actor,issue,true)&&issueCurrent(store,issue),409,'CHECK_SOURCE_CHANGED','检查期间资料或权限已变更，请重新执行。');store.put('knowledgeIssue',issue);}store.audit(actor,'knowledge.checked',{documentCount:documents.length,blockCount:items.length,candidateCount:candidates.size,algorithm:CHECK_ALGORITHM});});
  return {documentCount:documents.length,blockCount:items.length,candidateCount:candidates.size,issueIds:[...candidates.keys()],vectorBlocks:vectors.size,algorithmVersion:CHECK_ALGORITHM,limitations:['机器结果仅为候选；未执行人工效力判断。',...(candidates.size>=300?['候选达到300条上限，请缩小范围继续检查。']:[])]};
}

export function startKnowledgeCheck(store,user,input={}){
  const key=cleanString(input.clientRequestId,100),fingerprint=digest({baseId:input.baseId||''});
  let run=store.transaction(()=>{const actor=currentActor(store,user);requireValue(canEdit(actor),403,'EDITOR_REQUIRED','检查需要编辑权限。');if(key){const prior=store.list('knowledgeCheckRun').find(r=>r.actorId===actor.id&&r.clientRequestId===key);if(prior){requireValue(prior.inputFingerprint===fingerprint,409,'IDEMPOTENCY_CONFLICT','同一请求编号不能用于不同检查范围。');return prior;}}
    const active=store.list('knowledgeCheckRun').find(r=>r.actorId===actor.id&&['queued','running'].includes(r.status));requireValue(!active,409,'CHECK_BUSY','已有检查正在进行，请等待完成。');
    const value={id:uid('check_'),actorId:actor.id,baseId:input.baseId||'',clientRequestId:key,inputFingerprint:fingerprint,status:'queued',createdAt:now(),updatedAt:now(),attempt:1};store.put('knowledgeCheckRun',value);return value;});
  if(run.status!=='queued')return run;
  let jobs=activeJobs.get(store);if(!jobs){jobs=new Set();activeJobs.set(store,jobs);}if(jobs.has(run.id))return run;jobs.add(run.id);
  setImmediate(()=>{try{run={...store.get('knowledgeCheckRun',run.id),status:'running',updatedAt:now()};store.put('knowledgeCheckRun',run);const result=checkKnowledge(store,user,{baseId:run.baseId});store.put('knowledgeCheckRun',{...run,result,status:'succeeded',completedAt:now()});}catch(error){try{store.put('knowledgeCheckRun',{...run,status:'failed',error:{code:error.code||'CHECK_FAILED',message:error.status?error.message:'检查失败，请重新执行。'},completedAt:now()});}catch{}}finally{jobs.delete(run.id);}});
  return run;
}
export function reviewKnowledgeIssue(store,user,id,input){
  return store.transaction(()=>{const actor=currentActor(store,user),issue=store.get('knowledgeIssue',id);requireValue(issue&&issueAccess(store,actor,issue,true)&&canEdit(actor),404,'ISSUE_NOT_FOUND','候选不存在或无权办理。');revision(input.decisionRevision,issue.decisionRevision);const reason=cleanString(input.resolution,2000);requireValue(reason.length>=2,400,'REASON_REQUIRED','请填写办理依据。');
    requireValue(['start','resolve','dismiss','reopen'].includes(input.action),400,'INVALID_ACTION','办理动作无效。');
    const isCurrent=issueCurrent(store,issue);requireValue(isCurrent||input.action==='reopen',409,'ISSUE_STALE','依据已变更，请重新检查，不可沿用旧结论。');
    const decisions=['equivalent','different_scope','related','confirmed_conflict','extraction_error','false_positive'];if(input.decision)requireValue(decisions.includes(input.decision),400,'INVALID_DECISION','复核结论无效。');
    if(input.decision==='equivalent'){requireValue(issue.type==='near_duplicate',400,'INVALID_DECISION','只有近似候选可以确认等价。');requireValue(!Object.values(issue.criticalDifferences||{}).some(Boolean),409,'CRITICAL_DIFFERENCE','数值、否定词或来源性质存在关键差异，不能确认等价；请校正提取结果后重新检查，或保留适用范围差异。');}
    if(input.decision==='confirmed_conflict')requireValue(input.action==='start',409,'CONFLICT_UNRESOLVED','已确认但尚未修订的冲突必须保持处理中，不能关闭或忽略。');
    if(input.action==='dismiss')requireValue(['false_positive','extraction_error','different_scope','related'].includes(input.decision),400,'DECISION_REQUIRED','忽略候选须明确误报、提取错误、范围不同或仅相关的依据。');
    requireValue(!['resolved','dismissed'].includes(issue.status)||input.action==='reopen',409,'ISSUE_CLOSED','已办理问题须先重新打开。');
    if(input.action==='resolve'&&issue.type==='conflict'){requireValue(input.decision!=='confirmed_conflict',409,'CONFLICT_UNRESOLVED','确认存在冲突不能关闭问题，请保持处理中并关联修订。');if(!['different_scope','false_positive','extraction_error'].includes(input.decision)){const replacement=store.get('document',input.relatedDocumentId);requireValue(replacement&&isRetrievable(replacement)&&canDocument(actor,replacement,store)&&issue.documentStates.some(s=>replacement.previousVersionId===s.id),409,'PUBLISHED_RESOLUTION_REQUIRED','消除冲突须关联已发布的来源修订或明确范围/误报依据。');}}
    let next={...issue,status:input.action==='start'?'in_review':input.action==='resolve'?'resolved':input.action==='dismiss'?'dismissed':'open',decisionRevision:issue.decisionRevision+1,resolution:reason,decision:input.decision||null,relatedDocumentId:input.relatedDocumentId||null,reviewedBy:actor.id,reviewedAt:now(),updatedAt:now()};
    if(!isCurrent){next={...next,status:'stale',resolution:reason+'（旧依据已过时，须运行新的知识检查。）'};}
    store.put('knowledgeIssue',next);store.audit(actor,'knowledge.issue.'+input.action,{target:id,decision:next.decision,reason,documentIds:issue.documentStates.map(s=>s.id)});return publicIssue(store,actor,next);
  });
}
export { extractRelations, listRelations, reviewRelation } from './knowledge-graph.mjs';
