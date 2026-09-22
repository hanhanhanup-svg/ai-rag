import { isAdmin, canDocument, requireValue, failure } from './security.mjs';
import { currentActor, checkedDocument, publicEvidence, reviewEvidence, reviewEvidenceBatch } from './knowledge-evidence.mjs';
import { evidenceHistory } from './evidence-history.mjs';
import { listKnowledgeIssues, startKnowledgeCheck, reviewKnowledgeIssue, extractRelations, listRelations, reviewRelation } from './knowledge-checks.mjs';
import { safeConnector, createRemoteConnector, updateRemoteConnector, syncRemoteConnector, createRemoteConnectorWorker } from './source-connectors.mjs';
import { adapterConfiguration, MEDIA_EXTENSIONS } from './media-parser.mjs';
import { graphSnapshot, extractGraph, reviewGraphRelations } from './knowledge-graph.mjs';
export { knowledgePresentationPolicy } from './knowledge-checks.mjs';

export function knowledgeCapabilities(){
  const asr=adapterConfiguration('ASR'),layout=adapterConfiguration('LAYOUT');
  return {capabilities:[
    {id:'evidence',name:'统一证据与来源定位',status:'available',detail:'原件、版本、表格来源行和工作表单元格可回查；旧片段缺失位置标为unknown。',formats:['pdf','docx','xlsx','pptx','csv','txt','md']},
    {id:'scan_tables',name:'扫描表格候选与单元格定位',status:'available',detail:'内置离线Tesseract词框与行列对齐候选；仅支持可对齐表格，数字/缺漏/单元格需人工确认，不声称复杂合并表自动还原。',formats:['pdf','png','jpg']},
    {id:'office_tables',name:'Office原生表格',status:'available',detail:'保留完整记录、表头和合并位置；合并区域不填充推测值。',formats:['docx','xlsx','pptx']},
    {id:'office_charts',name:'Office原生图表',status:'available',detail:'读取内嵌缓存数据；未缓存、外部连接及单位不明需要人工核对，不执行公式。',formats:['docx','xlsx','pptx']},
    {id:'asr',name:'本地音视频转写',status:asr.available?'available':'configuration_required',detail:asr.available?'本地适配器已登记；每次转写仍校验时间轴与真实执行结果，视频附带最多12帧抽样OCR，未覆盖每帧。':'配置本地Whisper适配器 KNOWLEDGE_ASR_COMMAND / KNOWLEDGE_ASR_ARGS，或上传人工转写稿。',formats:MEDIA_EXTENSIONS.map(x=>x.slice(1))},
    {id:'layout',name:'复杂版式与图像图表',status:layout.available&&process.env.KNOWLEDGE_LAYOUT_ENABLED==='true'?'available':'configuration_required',detail:'原生PDF可提取文本位置；复杂版式通过KNOWLEDGE_LAYOUT_COMMAND本地适配器，需启用KNOWLEDGE_LAYOUT_ENABLED并验证真实结果。',formats:['pdf','png','jpg']},
    {id:'relations',name:'知识图谱与关系检索',status:'available',detail:'按明确表格字段建立线路、车站、设备、工单、故障/问题和规程关系；编号跨资料对齐，关系人工复核后进入1–3跳检索，每跳可回查来源。',formats:['table']},
    {id:'knowledge_checks',name:'近似内容与条款差异',status:'available',detail:'文本指纹与已有本地向量召回候选，逐项核对数值/否定词和登记范围；人工确认后才折叠。初始阈值尚未业务校准。',formats:['text']},
    {id:'web_api',name:'网页和业务来源',status:'available',detail:'只访问运维白名单；网页单URL快照，业务API分页只读，源撤权与明确删除先阻断访问。',formats:['html','json']}
  ],limits:{fileBytes:100*1024*1024,mediaDurationMs:3600000,checkDocuments:100,checkBlocks:800,checkCandidates:300,initialCandidateThresholds:{lexical:0.86,semantic:0.93,calibrated:false,meaning:'ranking-not-probability'},connectorMaxPages:20,connectorPageBytes:5*1024*1024}};
}
export async function handleKnowledgeUpgrade(context){
  const {store,req,res,send}=context,url=context.url||new URL(req.url,'http://localhost'),pathname=context.pathname||url.pathname,method=context.method||req.method;
  let user=context.user;const actor=()=>context.currentActor?context.currentActor():currentActor(store,user);
  const respond=(status,value)=>{send(res,status,value);return true;};
  const body=async()=>{const input=await context.bodyOf(req);user=actor();return input;};
  if(pathname==='/api/knowledge/capabilities'&&method==='GET')return respond(200,knowledgeCapabilities());
  if(pathname==='/api/graph'&&method==='GET')return respond(200,graphSnapshot(store,actor(),Object.fromEntries(url.searchParams)));
  if(pathname==='/api/graph/extract'&&method==='POST'){const input=await body();return respond(200,extractGraph(store,user,input));}
  if(pathname==='/api/graph/relations/review'&&method==='POST'){const input=await body();return respond(200,reviewGraphRelations(store,user,input));}
  const evidence=pathname.match(/^\/api\/documents\/([^/]+)\/evidence(?:\/([^/]+))?$/);
  if(evidence){if(method==='GET'&&evidence[2]==='history'){user=actor();const document=checkedDocument(store,user,evidence[1],true);return respond(200,evidenceHistory(store,user,document));}if(method==='GET'&&!evidence[2]){user=actor();const document=checkedDocument(store,user,evidence[1]);return respond(200,{...publicEvidence(store,document,user),capabilities:knowledgeCapabilities().capabilities});}if(method==='POST'&&evidence[2]==='batch-review'){const input=await body();return respond(200,reviewEvidenceBatch(store,user,evidence[1],input));}if(method==='PATCH'&&evidence[2]&&evidence[2]!=='batch-review'&&evidence[2]!=='history'){const input=await body();return respond(200,reviewEvidence(store,user,evidence[1],evidence[2],input));}}
  const relationDocument=pathname.match(/^\/api\/documents\/([^/]+)\/relations(?:\/(extract))?$/);
  if(relationDocument){if(method==='GET'&&!relationDocument[2])return respond(200,listRelations(store,actor(),relationDocument[1]));if(method==='POST'&&relationDocument[2]){const input=await body();return respond(200,extractRelations(store,user,relationDocument[1],input));}}
  const relation=pathname.match(/^\/api\/relations\/([^/]+)\/actions$/);
  if(relation&&method==='POST'){const input=await body();return respond(200,{relation:reviewRelation(store,user,relation[1],input)});}
  const entity=pathname.match(/^\/api\/entities\/([^/]+)\/relations$/);
  if(entity&&method==='GET')return respond(200,listRelations(store,actor(),null,{entityId:entity[1]}));
  if(pathname==='/api/knowledge-issues'&&method==='GET')return respond(200,listKnowledgeIssues(store,actor(),{baseId:url.searchParams.get('baseId')||'',status:url.searchParams.get('status')||''}));
  if(pathname==='/api/knowledge-checks/runs'&&method==='POST'){const input=await body();return respond(202,{run:startKnowledgeCheck(store,user,input)});}
  const run=pathname.match(/^\/api\/knowledge-checks\/runs\/([^/]+)$/);
  if(run&&method==='GET'){const record=store.get('knowledgeCheckRun',run[1]),current=actor();requireValue(record&&(record.actorId===current.id||isAdmin(current)),404,'RUN_NOT_FOUND','检查任务不存在。');return respond(200,{run:record});}
  const issue=pathname.match(/^\/api\/knowledge-issues\/([^/]+)\/actions$/);
  if(issue&&method==='POST'){const input=await body();return respond(200,{issue:reviewKnowledgeIssue(store,user,issue[1],input)});}
  if(pathname==='/api/intake/jobs'&&method==='POST'){const input=await body();requireValue(context.ingest,503,'INTAKE_UNAVAILABLE','当前实例未配置文件接入。');const result=await context.ingest(user,input);const task=store.list('task').filter(t=>t.documentId===result.document.id&&t.type!=='index').at(-1);return respond(202,{jobId:task?.id||null,documentId:result.document.id,...result});}
  const intake=pathname.match(/^\/api\/intake\/jobs\/([^/]+)$/);
  if(intake&&method==='GET'){const task=store.get('task',intake[1]),current=actor();requireValue(task&&canDocument(current,store.get('document',task.documentId),store),404,'JOB_NOT_FOUND','接入任务不存在。');return respond(200,{job:task,document:publicEvidence(store,store.get('document',task.documentId),current).document});}
  if(pathname==='/api/connectors'&&method==='GET'){requireValue(isAdmin(actor()),403,'ADMIN_REQUIRED','连接器需要管理员权限。');return respond(200,{connectors:[...store.list('connector'),...store.list('remoteConnector')].map(safeConnector),allowedRoots:context.roots?context.roots():[],remoteConfiguration:{webHostsConfigured:!!process.env.KNOWLEDGE_WEB_ALLOWED_HOSTS,apiEndpointsConfigured:!!process.env.KNOWLEDGE_API_ALLOWED_ENDPOINTS}});}
  if(pathname==='/api/connectors'&&method==='POST'){const input=await body();if(!['web','api'].includes(input.type))return false;const connector=await createRemoteConnector(store,user,input,actor);return respond(201,{connector});}
  const connector=pathname.match(/^\/api\/connectors\/([^/]+)(?:\/(sync))?$/);
  if(connector&&store.get('remoteConnector',connector[1])){
    if(connector[2]&&method==='POST'){await body();return respond(200,await syncRemoteConnector({...context,user,currentActor:actor},connector[1]));}
    if(!connector[2]&&method==='PATCH'){const input=await body();return respond(200,{connector:updateRemoteConnector(store,user,connector[1],input)});}
    if(!connector[2]&&method==='DELETE'){await body();requireValue(isAdmin(user),403,'ADMIN_REQUIRED','连接器需要管理员权限。');store.transaction(()=>{const value=store.get('remoteConnector',connector[1]);requireValue(value.status!=='syncing',409,'CONNECTOR_BUSY','同步过程中不能移除来源。');store.del('remoteConnector',value.id);store.audit(user,'connector.deleted',{target:value.id,message:'已移除远端接入，原件与历史版本继续保留'});});return respond(200,{ok:true});}
  }
  return false;
}
export function createKnowledgeUpgradeWorker(context){
  for(const run of context.store.list('knowledgeCheckRun').filter(r=>['queued','running'].includes(r.status)))context.store.put('knowledgeCheckRun',{...run,status:'interrupted',error:{code:'CHECK_INTERRUPTED',message:'服务重启中断检查，请用新的请求编号重新运行。'},completedAt:new Date().toISOString()});
  return createRemoteConnectorWorker(context);
}
