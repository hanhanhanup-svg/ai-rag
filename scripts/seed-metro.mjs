import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin='http://localhost:8787';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sourceRoot=path.join(root,'knowledge-sources','metro-demo');
const receiptPath=path.join(root,'.runtime','metro-seed-receipt.json');
const reportPath=path.join(root,'docs','地铁行业资料导入清单.md');
const receipt=fs.existsSync(receiptPath)?JSON.parse(fs.readFileSync(receiptPath,'utf8')):{startedAt:new Date().toISOString(),documents:{},bases:{},connectors:{},chats:[],feedback:[]};
const save=()=>{fs.mkdirSync(path.dirname(receiptPath),{recursive:true});fs.writeFileSync(receiptPath,JSON.stringify(receipt,null,2));};
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function readDocuments(){
  const documents=[];
  let offset=0;
  while(true){
    const page=await api('/documents?limit=500&offset='+offset);
    documents.push(...page.documents);
    if(!page.pagination?.hasMore)return documents;
    offset=page.pagination.nextOffset;
  }
}
async function waitForRun(id,timeoutMs=180000){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const run=(await api('/evaluations')).runs.find(row=>row.id===id);
    if(!run)throw new Error('评测记录不存在，请重新运行导入器：'+id);
    if(run.status!=='running')return run;
    await sleep(1500);
  }
  throw new Error('评测仍未完成，本次导入未通过验收；请稍后重跑检查实际结果。');
}

async function api(route,{method='GET',body}={}) {
  for(let attempt=0;attempt<5;attempt++){
    const response=await fetch(origin+'/api'+route,{method,headers:{Origin:origin,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(130000)});
    const data=await response.json();
    if(response.status===429){console.log('[等待] 请求限流，稍后继续');await sleep(16000);continue;}
    if(!response.ok)throw new Error(`${method} ${route}: ${response.status} ${data.error?.message||data.message||JSON.stringify(data)}`);
    return data;
  }
  throw new Error('请求频率仍受限，请稍后重新运行；已完成的导入会保留。');
}
const catalogs=[
  {key:'metro-standards',name:'地铁法规与标准',department:'合规管理',description:'交通运输部等官方公开规范的来源摘编，保留文号、发布日期与原文链接。适用性以正式原文和运营单位受控文件为准。'},
  {key:'metro-passenger',name:'客运组织与乘客服务',department:'客运管理',description:'失物招领、无障碍服务、投诉办理、客流记录与服务培训。含明确标注的行业示例，用于展示知识办理流程。'},
  {key:'metro-assets',name:'设施设备与维修保障',department:'设备管理',description:'设备台账、维修工单、巡检记录、备件领用与供应商资料。示例台账使用虚构资产和合成记录。'},
  {key:'metro-safety',name:'安全管理与应急体系',department:'安全管理',description:'官方风险隐患、应急演练与安全评估公开资料，以及行业示例整改台账；不替代实际现场预案和作业授权。'},
  {key:'metro-operations',name:'运营管理与知识治理',department:'运营管理',description:'交接班信息、运营日报口径、事件复盘和知识发布流程示例，覆盖文档版本与持续维护。'},
  {key:'metro-training',name:'岗位培训与经验案例',department:'教育培训',description:'岗位学习地图、师带徒清单、培训计划与案例编写规范。培训与考核数据均为合成示例。'},
];
const bundles=['public-documents.json','service-documents.json','asset-documents.json'];
const docs=bundles.flatMap(name=>{const data=JSON.parse(fs.readFileSync(path.join(root,'scripts','metro-data',name),'utf8'));return Array.isArray(data)?data:data.documents;});
if(docs.length!==28||new Set(docs.map(d=>d.key)).size!==docs.length)throw new Error('行业资料必须包含28个唯一条目。');
for(const doc of docs){
  if(!catalogs.some(c=>c.key===doc.baseKey)||!doc.content||!doc.fileName||path.basename(doc.fileName)!==doc.fileName)throw new Error('资料目录、正文或文件名无效：'+doc.key);
  if(doc.kind==='example'&&!/示例/.test(doc.content))throw new Error('行业示例缺少正文标记：'+doc.key);
  if(doc.kind==='public'&&(!doc.sourceUrl||!doc.content.includes(doc.sourceUrl)))throw new Error('公开资料缺少可核验来源：'+doc.key);
}
const user=(await api('/auth/me')).user;
if(user.authMode!=='local'||user.role!=='admin')throw new Error('此演示资料导入器仅允许当前本机免登录管理员工作空间使用。');
receipt.status='running';receipt.runStartedAt=new Date().toISOString();delete receipt.completedAt;delete receipt.lastError;save();
try {
if(!receipt.backup){receipt.backup=(await api('/operations/backup',{method:'POST',body:{}})).backup;save();console.log('[备份] 导入前快照已创建');}
const existingBases=(await api('/bases')).bases;
for(const catalog of catalogs){
  let base=existingBases.find(b=>b.id===receipt.bases[catalog.key]||b.name===catalog.name);
  if(!base&&catalog.key==='metro-standards')base=existingBases.find(b=>b.name==='企业制度知识库'&&b.documentCount===0);
  if(base){if(base.name!==catalog.name||base.description!==catalog.description)base=(await api('/bases/'+base.id,{method:'PATCH',body:catalog})).base;}
  else base=(await api('/bases',{method:'POST',body:{...catalog,visibility:'company',members:[]}})).base;
  receipt.bases[catalog.key]=base.id;save();
  const folder=path.join(sourceRoot,catalog.key);fs.mkdirSync(folder,{recursive:true});
  for(const doc of docs.filter(d=>d.baseKey===catalog.key))fs.writeFileSync(path.join(folder,doc.fileName),doc.content,'utf8');
}
const connectors=(await api('/connectors')).connectors;
for(const catalog of catalogs){
  const folder=path.join(sourceRoot,catalog.key),name='地铁资料包 · '+catalog.name;
  let connector=connectors.find(c=>c.id===receipt.connectors[catalog.key]||c.path===folder&&c.baseId===receipt.bases[catalog.key]);
  if(!connector)connector=(await api('/connectors',{method:'POST',body:{name,path:folder,baseId:receipt.bases[catalog.key],intervalMinutes:0,archiveDeleted:false}})).connector;
  receipt.connectors[catalog.key]=connector.id;save();
  const synced=(await api('/connectors/'+connector.id+'/sync',{method:'POST',body:{}})).connector;
  if(synced.stats.failed)throw new Error('资料源同步失败：'+catalog.name+' '+JSON.stringify(synced.errors));
  console.log('[同步] '+catalog.name+' '+JSON.stringify(synced.stats));
}
let allDocs=[];
let parsingComplete=false;
const latestFor=(spec,documents)=>documents.filter(d=>d.baseId===receipt.bases[spec.baseKey]&&d.source?.connectorId===receipt.connectors[spec.baseKey]&&d.source.path===spec.fileName).sort((a,b)=>b.version-a.version)[0];
const deadline=Date.now()+180000;
while(Date.now()<deadline){
  allDocs=await readDocuments();
  const imported=docs.map(spec=>latestFor(spec,allDocs)).filter(Boolean);
  const pending=imported.filter(d=>['queued','processing'].includes(d.status));
  const failed=imported.filter(d=>d.status==='failed');
  if(failed.length)throw new Error('解析失败：'+failed.map(d=>d.fileName+':'+d.error).join('；'));
  if(imported.length===docs.length&&!pending.length){parsingComplete=true;break;}
  console.log('[解析] 已完成 '+(imported.length-pending.length)+' / '+docs.length);await sleep(3000);
}
if(!parsingComplete)throw new Error('解析等待超时，本次导入未完成；后台任务会继续保留。');
receipt.expiries??={};
for(const [index,spec] of docs.entries()){
  let doc=latestFor(spec,allDocs);if(!doc||['queued','processing','failed'].includes(doc.status))throw new Error('资料尚未准备好：'+spec.fileName);
  const currentHash=crypto.createHash('sha256').update(spec.content).digest('hex');if(doc.sha256!==currentHash)throw new Error('原件哈希不一致：'+spec.fileName);
  const tags=[...new Set([spec.kind==='public'?'官方公开资料':'行业示例',...(spec.tags||[]),'地铁资料包'])];
  const target=spec.targetStatus||'published';
  const expiryKey=spec.key+':'+doc.sha256;
  const expiresAt=spec.kind==='example'?(receipt.expiries[expiryKey]??doc.expiresAt??new Date(Date.parse(doc.createdAt)+(index===7?14:180)*86400000).toISOString()):null;
  receipt.expiries[expiryKey]=expiresAt;save();
  const metadata={title:spec.title,summary:(spec.kind==='public'?'【官方公开资料摘编】':'【行业示例】')+spec.summary,tags,expiresAt};
  if(doc.status==='review'){
    const changed=doc.title!==metadata.title||doc.summary!==metadata.summary||JSON.stringify([...(doc.tags||[])].sort())!==JSON.stringify([...tags].sort())||(doc.expiresAt||null)!==expiresAt;
    if(changed)doc=(await api('/documents/'+doc.id,{method:'PATCH',body:{...metadata,revision:doc.revision}})).document;
    if(target==='published')doc=(await api('/documents/'+doc.id+'/actions',{method:'POST',body:{action:'publish',revision:doc.revision,reason:spec.kind==='public'?'已核验官方公开来源与文件版本，作为来源摘编入库。':'已核对行业示例标识、正文及字段，用于平台功能演示，不代表真实运营单位制度。'}})).document;
    if(target==='archived')doc=(await api('/documents/'+doc.id+'/actions',{method:'POST',body:{action:'archive',revision:doc.revision,reason:'旧版行业示例模板留存，用于展示文档下架与历史资料管理。'}})).document;
  }
  if(doc.status!==target)throw new Error('文档状态与清单不一致，请在页面核对后重跑：'+spec.title+'（实际 '+doc.status+'，预期 '+target+'）');
  receipt.documents[spec.key]={id:doc.id,title:spec.title,baseKey:spec.baseKey,kind:spec.kind,format:spec.format,status:doc.status,sha256:doc.sha256,expiresAt,sourceUrl:spec.sourceUrl||null};save();
  console.log('[入库] '+doc.status+' '+spec.title);
}
const eligible=docs.filter(d=>receipt.documents[d.key].status==='published'&&d.evaluation);
const selected=[...eligible.filter(d=>d.kind==='public').slice(0,3),...catalogs.filter(c=>c.key!=='metro-standards').map(c=>eligible.find(d=>d.baseKey===c.key&&d.kind==='example')).filter(Boolean)];
if(selected.length!==8||new Set(selected.map(d=>d.key)).size!==8)throw new Error('资料包评测必须选中 3 份公开资料和 5 个知识库的行业示例，共 8 项。');
console.log('[评测范围] '+selected.map(d=>d.key).join('、'));
const embeddingRequired=(await api('/operations')).model.embeddingEnabled===true;
const importedIds=new Set(docs.map(d=>receipt.documents[d.key].id));
const indexDeadline=Date.now()+180000;
let indexComplete=false;
while(Date.now()<indexDeadline){
  allDocs=await readDocuments();
  const current=allDocs.filter(d=>importedIds.has(d.id));
  if(current.length!==docs.length)throw new Error('资料在索引检查期间发生变化，请重新运行导入器。');
  const activeTasks=(await api('/tasks')).tasks.filter(t=>importedIds.has(t.documentId)&&['queued','processing'].includes(t.status));
  const searchable=current.filter(d=>['review','published'].includes(d.status));
  const failed=searchable.filter(d=>embeddingRequired&&d.embeddingStatus==='failed');
  if(failed.length)throw new Error('语义索引失败，请在处理任务中修复后重跑：'+failed.map(d=>d.title).join('；'));
  const pending=searchable.filter(d=>embeddingRequired&&d.embeddingStatus!=='ready');
  if(!activeTasks.length&&!pending.length){indexComplete=true;break;}
  console.log('[索引] 等待 '+Math.max(activeTasks.length,pending.length)+' 项后台任务稳定');await sleep(2000);
}
if(!indexComplete)throw new Error('索引等待超时，本次导入未通过验收。');
const corpusFingerprint=fingerprint(docs.map(spec=>{
  const doc=allDocs.find(d=>d.id===receipt.documents[spec.key].id);
  if(doc.sha256!==receipt.documents[spec.key].sha256||doc.status!==receipt.documents[spec.key].status)throw new Error('资料版本或状态已变化，请重新运行导入器：'+spec.title);
  return {key:spec.key,id:doc.id,sha256:doc.sha256,revision:doc.revision,status:doc.status,embeddingSignature:doc.embeddingSignature||null,embeddingStatus:doc.embeddingStatus||null};
}));
let evaluationState=await api('/evaluations');
const existingCases=evaluationState.cases;
const selectedCases=[];
for(const spec of selected){
  const desired={question:spec.evaluation.question,baseId:receipt.bases[spec.baseKey],expectedDocumentId:receipt.documents[spec.key].id,expectedText:spec.evaluation.expectedText,mustRefuse:false};
  let record=existingCases.find(c=>Object.entries(desired).every(([key,value])=>c[key]===value));
  if(!record){record=(await api('/evaluations/cases',{method:'POST',body:desired})).case;existingCases.push(record);}
  selectedCases.push({...record,specKey:spec.key});
}
if(new Set(selectedCases.map(c=>c.id)).size!==8)throw new Error('未取得 8 个独立的资料包评测用例。');
evaluationState=await api('/evaluations');
const evaluationFingerprint=fingerprint({version:1,mode:'retrieval',corpusFingerprint,selectedCaseIds:selectedCases.map(c=>c.id),cases:evaluationState.cases.map(c=>({id:c.id,question:c.question,baseId:c.baseId,expectedDocumentId:c.expectedDocumentId,expectedText:c.expectedText,mustRefuse:c.mustRefuse})).sort((a,b)=>a.id.localeCompare(b.id))});
const passedSelection=run=>run?.status==='completed'&&run.mode==='retrieval'&&run.completed===run.total&&selectedCases.every(c=>run.results?.some(result=>result.caseId===c.id&&result.passed===true&&result.documentIds?.includes(c.expectedDocumentId)));
let run=receipt.evaluation?.fingerprint===evaluationFingerprint?evaluationState.runs.find(r=>r.id===receipt.evaluation.id):null;
if(run?.status==='running')run=await waitForRun(run.id);
if(!passedSelection(run)){
  const active=(await api('/evaluations')).runs.find(r=>r.status==='running');
  if(active)await waitForRun(active.id);
  run=(await api('/evaluations/run',{method:'POST',body:{mode:'retrieval'}})).run;
  receipt.evaluation={...run,fingerprint:evaluationFingerprint,selectedCaseIds:selectedCases.map(c=>c.id)};save();
  run=await waitForRun(run.id);
}
const selectedResults=selectedCases.map(c=>run.results?.find(result=>result.caseId===c.id)).filter(Boolean);
receipt.evaluation={...run,fingerprint:evaluationFingerprint,selectedCaseIds:selectedCases.map(c=>c.id),selectedResults,selectedTotal:8,selectedPassed:selectedResults.filter(r=>r.passed).length};save();
if(!passedSelection(run))throw new Error('资料包评测未通过：'+receipt.evaluation.selectedPassed+'/8，运行状态 '+run.status+'；请检查实际结果后重跑。');
console.log('[评测] 资料包 8/8 通过；系统全量用例 '+run.passed+'/'+run.total+'（'+run.status+'）');
for(const spec of eligible.filter(d=>['metro-passenger','metro-assets','metro-safety','metro-standards','metro-training'].includes(d.baseKey)).filter((d,i,a)=>a.findIndex(x=>x.baseKey===d.baseKey)===i))await api('/favorites',{method:'POST',body:{documentId:receipt.documents[spec.key].id}});
const chatPlans=['metro-passenger','metro-assets','metro-training'].map(key=>{
  const spec=eligible.find(d=>d.baseKey===key&&d.kind==='example');
  if(!spec)throw new Error('缺少实际问答所需的已发布示例：'+key);
  const document=receipt.documents[spec.key],question='根据行业示例资料，'+spec.evaluation.question;
  return {spec,document,question,fingerprint:fingerprint({version:1,key:spec.key,documentId:document.id,sha256:document.sha256,question,corpusFingerprint})};
});
const liveConversations=new Set((await api('/conversations')).conversations.map(c=>c.id));
const verifiedChats=[];
for(const plan of chatPlans){
  const {spec,document,question}=plan;
  const cached=receipt.chats.find(c=>c.key===spec.key&&c.fingerprint===plan.fingerprint&&c.mode==='model'&&c.citationDocumentIds?.includes(document.id));
  let response=null;
  if(cached&&liveConversations.has(cached.conversationId)){
    const history=await api('/conversations/'+cached.conversationId);
    const message=history.messages.find(m=>m.id===cached.messageId&&m.role==='assistant');
    if(message?.mode==='model'&&message.citations?.some(c=>c.documentId===document.id&&c.used===true))response=message;
  }
  if(!response&&process.argv.includes('--with-chat'))response=await api('/chat',{method:'POST',body:{question,baseId:receipt.bases[spec.baseKey]}});
  if(!response)continue;
  if(response.mode!=='model'||!response.citations?.some(c=>c.documentId===document.id&&c.used===true)){
    receipt.chatAttempts=(receipt.chatAttempts||[]).concat({key:spec.key,fingerprint:plan.fingerprint,messageId:response.id,conversationId:response.conversationId,mode:response.mode,citationDocumentIds:(response.citations||[]).map(c=>c.documentId),createdAt:new Date().toISOString()}).slice(-20);save();
    throw new Error('实际问答未通过：'+spec.title+'，模式 '+response.mode+'，必须由模型回答并引用本次目标文档。');
  }
  const row={key:spec.key,fingerprint:plan.fingerprint,documentId:document.id,sha256:document.sha256,messageId:response.id,conversationId:response.conversationId,mode:response.mode,question,citations:response.citations.filter(c=>c.used===true).length,citationDocumentIds:[...new Set(response.citations.filter(c=>c.used===true).map(c=>c.documentId))],answer:response.answer||response.content};
  verifiedChats.push(row);receipt.chats=receipt.chats.filter(c=>c.key!==spec.key).concat(row);save();console.log('[问答] 已核验 model 与目标引用：'+spec.title);
}
receipt.chats=verifiedChats;save();
if(process.argv.includes('--with-chat')&&receipt.chats.length!==3)throw new Error('本次要求的 3 条模型问答尚未全部通过。');
const issues=[
  {key:'source-review',base:'metro-standards',type:'outdated',status:'open',question:'【示例反馈】法规资料下一次版本复核如何安排？',comment:'这是平台办理流程示例：请维护人员在后续更新前再次核对官方版本和适用范围，不表示当前文件已经过期。'},
  {key:'asset-fields',base:'metro-assets',type:'missing',status:'in_progress',question:'【示例反馈】设备台账还应补充哪些检修附件？',comment:'示例台账待补充附件目录与检查记录的关联说明，不涉及真实设备缺陷。',resolution:'已受理示例需求，待补充资料后校对发布；当前未标记为已完成。'},
  {key:'service-trace',base:'metro-passenger',type:'other',status:'resolved',question:'【示例反馈】失物登记流程是否能定位到原文？',comment:'演示一次可追溯性核验：检查文档详情中的原文与知识片段。',resolution:'本次导入已实际解析并发布示例服务文档，完成检索及引用核验；示例反馈办理完成。'},
];
const existingFeedback=(await api('/feedback')).feedback;
for(const issue of issues){let record=existingFeedback.find(f=>f.question===issue.question);const doc=selected.find(d=>d.baseKey===issue.base&&d.kind==='example')||eligible.find(d=>d.baseKey===issue.base);if(!doc)throw new Error('反馈缺少已发布依据：'+issue.key);if(issue.status==='resolved'){const expectedCase=selectedCases.find(c=>c.expectedDocumentId===receipt.documents[doc.key].id);if(!expectedCase||!selectedResults.some(r=>r.caseId===expectedCase.id&&r.passed))throw new Error('反馈关联文档尚未通过检索核验：'+issue.key);}if(!record)record=(await api('/feedback',{method:'POST',body:{...issue,documentId:receipt.documents[doc.key].id}})).feedback;if(record.status!==issue.status)record=(await api('/feedback/'+record.id,{method:'PATCH',body:{status:issue.status,resolution:issue.resolution}})).feedback;receipt.feedback=receipt.feedback.filter(r=>r.key!==issue.key).concat({key:issue.key,id:record.id,status:record.status});save();}
receipt.status='completed';receipt.completedAt=new Date().toISOString();receipt.stats=(await api('/dashboard')).stats;save();
const rows=docs.map(d=>{const v=receipt.documents[d.key];return `| ${catalogs.find(c=>c.key===d.baseKey).name} | ${d.title} | ${d.kind==='public'?'官方公开摘编':'行业示例'} | ${v.status} | ${d.format.toUpperCase()} | ${d.sourceUrl?`[原文](${d.sourceUrl})`:'合成示例，非真实运营记录'} |`;});
fs.writeFileSync(reportPath,`# 地铁行业资料导入清单\n\n导入时间：${receipt.completedAt}。通过资料同步、后台解析、校对与审核接口实际入库，保留原件及哈希。未伪造历史访问量、运营事件或统计数据。\n\n## 资料组成\n\n共 ${docs.length} 份资料、${catalogs.length} 个行业知识库。官方公开资料与行业示例在正文、摘要和标签中区分。示例适用于平台演示，不能作为运营单位正式规章或现场处置指令。\n\n| 知识库 | 文档 | 来源性质 | 当前状态 | 格式 | 来源 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n## 实际运行数据\n\n- 处理任务与审计来自本次真实导入、解析、发布和同步操作。\n- 目录资料源：${catalogs.length} 个，默认手动同步；再次运行导入脚本按源文件哈希复用资料。\n- 检索评测：${receipt.evaluation.selectedPassed??0}/${receipt.evaluation.selectedTotal??0}，状态 ${receipt.evaluation.status||'未知'}；结果是实际执行值，不等于业务通用准确率。\n- 已运行模型问答 ${receipt.chats.length} 条，模式：${receipt.chats.map(c=>c.mode).join('、')}。\n- 示例反馈：待处理、处理中、已解决各一条，正文注明示例性质。\n- 导入前已创建备份：${receipt.backup.id}。\n\n## 更新方式\n\n来源文件在 knowledge-sources/metro-demo 下按知识库分目录保存。源清单位于 scripts/metro-data，可在页面“资料同步”重新读取；变化文件进入新版本审核。不要把示例台账当作真实运行统计。\n\n重新执行：\n\n\x60\x60\x60text\nnode scripts/seed-metro.mjs\n# 需要同时创建实际模型问答记录时加 --with-chat\n\x60\x60\x60\n`);
console.log(JSON.stringify({documents:docs.length,bases:catalogs.length,stats:receipt.stats,evaluation:{passed:receipt.evaluation.selectedPassed,total:receipt.evaluation.selectedTotal,status:receipt.evaluation.status},chats:receipt.chats.map(c=>({mode:c.mode,citations:c.citations})),report:reportPath},null,2));

} catch(error) {
  receipt.status='failed';receipt.failedAt=new Date().toISOString();receipt.lastError=error.message;delete receipt.completedAt;save();
  throw error;
}
