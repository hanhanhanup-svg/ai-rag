import crypto from 'node:crypto';
import {retrieveLearningGuidance,isLearningDocument,learningDocumentCurrent,learningBundleCurrent,collectLearningEvidenceRefs,LEARNING_GUIDANCE_RULE} from './learning-guidance.mjs';
import { now,uid } from './database.mjs';
import { failure,requireValue,canBase,canDocument,isRetrievable,isAdmin,cleanString } from './security.mjs';
import { search,answerQuestion,invokeModel,modelConfig,documentFingerprint,usedCitations,graphPathsForEvidence,chatModelCatalog,resolveChatModel } from './retrieval.mjs';
import { retrieveGraph,validateGraphPaths } from './knowledge-graph.mjs';
import {resolveDocumentScope,documentWithinScope,graphWithinScope,evidenceWithinScope} from './document-scope.mjs';
import { knowledgePresentationPolicy } from './knowledge-checks.mjs';
import { withTrace,traceStep,traceContext,observationSummary,recoverObservability,pruneObservability,traceDetail } from './model-observability.mjs';

const states=new WeakMap(),TERMINAL=new Set(['succeeded','partial','failed','cancelled','interrupted']);
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
function state(store){if(!states.has(store))states.set(store,{tasks:new Map(),controllers:new Map(),checks:new Map(),evaluations:new Set(),evaluationControllers:new Set(),stopping:false,started:false,timer:null});return states.get(store);}
function actor(store,user){const current=store.get('user',user?.id);requireValue(current?.active,401,'AUTH_REQUIRED','身份已失效，请重新进入系统。');return current;}
function baseFor(store,user,id){if(!id)return null;const base=store.get('base',id);requireValue(canBase(user,base),404,'BASE_NOT_FOUND','知识库不存在或无权访问。');return base;}
function documentFor(store,user,id){const doc=store.get('document',id);requireValue(doc&&canDocument(user,doc,store)&&isRetrievable(doc),404,'DOCUMENT_NOT_FOUND','资料不存在、未生效或无权访问。');return doc;}
export function evidenceCurrent(store,user,refs=[]){const current=store.get('user',user?.id);if(!current?.active)return false;return refs.every(ref=>{const doc=store.get('document',ref.documentId);return doc&&canDocument(current,doc,store)&&isRetrievable(doc)&&learningDocumentCurrent(store,current,doc)&&(!ref.version||ref.version===doc.version)&&(!ref.sourceFingerprint||ref.sourceFingerprint===documentFingerprint(doc));});}
function allRefs(value){const refs=[];function walk(v,depth=0){if(!v||typeof v!=='object'||depth>12)return;if(Array.isArray(v)){for(const item of v)walk(item,depth+1);return;}for(const [key,item]of Object.entries(v)){if(['citations','evidenceRefs','contextEvidenceRefs'].includes(key)&&Array.isArray(item))refs.push(...item);else if(!['rows','headers','sourceRows'].includes(key))walk(item,depth+1);}}walk(value);return refs;}
function allGraphPaths(value){const paths=new Map();function walk(v,depth=0){if(!v||typeof v!=='object'||depth>14)return;if(Array.isArray(v)){for(const item of v)walk(item,depth+1);return;}if(v.id&&Array.isArray(v.nodes)&&Array.isArray(v.edges)&&v.edges.length){paths.set(v.id,v);return;}for(const [key,item]of Object.entries(v))if(!['rows','headers','sourceRows','text','content','answer'].includes(key))walk(item,depth+1);}walk(value);return [...paths.values()];}
export function evidenceBundleCurrent(store,user,value){return evidenceCurrent(store,user,allRefs(value))&&learningBundleCurrent(store,user,value)&&validateGraphPaths(store,user,allGraphPaths(value)).valid;}
function safeResult(store,user,result){if(!result)return result;return evidenceBundleCurrent(store,user,result)?result:{answer:'资料版本或访问权限已变化，请重新查询。',content:'资料版本或访问权限已变化，请重新查询。',mode:'insufficient',citations:[],warning:'已撤回过时证据。'};}
function patchRun(store,run,patch){const current=store.get('intelligenceRun',run.id)||run;return store.put('intelligenceRun',{...current,...patch,updatedAt:now(),revision:(current.revision||0)+1});}
function emit(store,runId,type,payload={}){
  return store.transaction(()=>{const run=store.get('intelligenceRun',runId),sequence=(run.eventSequence||0)+1,event={id:runId+':'+sequence,eventId:runId+':'+sequence,runId,sequence,type,timestamp:now(),payload};
    store.put('runEvent',event);store.put('intelligenceRun',{...run,eventSequence:sequence});return event;});
}
function runActor(store,run){const check=state(store).checks.get(run.id);const current=check?check():store.get('user',run.userId);requireValue(current?.active&&current.id===run.userId,401,'AUTH_REQUIRED','运行身份已失效。');baseFor(store,current,run.baseId);resolveDocumentScope(store,current,run);return current;}
function checkRun(store,runId){const run=store.get('intelligenceRun',runId);requireValue(run,404,'RUN_NOT_FOUND','运行不存在。');if(run.status==='cancel_requested'||state(store).controllers.get(run.id)?.signal.aborted)throw failure(499,'RUN_CANCELLED','运行已取消。');return {run,user:runActor(store,run)};}
function releaseConversation(store,run){const conversation=store.get('conversation',run.conversationId);if(conversation?.activeRunId===run.id){const revision=(conversation.revision||0)+1;store.put('conversation',{...conversation,activeRunId:null,revision,updatedAt:now()});const latest=store.get('intelligenceRun',run.id);if(latest)store.put('intelligenceRun',{...latest,conversationRevision:revision});}}
function endRun(store,runId,status,patch={}){
  const run=store.get('intelligenceRun',runId);if(!run)return;
  store.transaction(()=>{patchRun(store,run,{status,...patch,finishedAt:now(),durationMs:(run.activeDurationMs||0)+(run.startedAt?Math.max(0,Date.now()-Date.parse(run.startedAt)):0)});releaseConversation(store,run);});
  emit(store,runId,'run.'+status,{status,...(patch.errorCode?{errorCode:patch.errorCode,message:patch.errorMessage}:{} )});
}
function runView(store,user,run){const valid=evidenceBundleCurrent(store,user,run),{templateSnapshot,...view}=run;return {...view,result:run.result?safeResult(store,user,run.result):undefined,context:valid&&run.context?{objectIds:run.context.objectIds,sourceTurns:run.context.turns?.map(t=>t.turnId),followUp:run.context.followUp}:null,toolResults:valid?run.toolResults:[],...(!valid?{warning:'结果依据已变化，已隐藏旧内容。'}:{})};}
function ownRun(store,user,id){const run=store.get('intelligenceRun',id);requireValue(run?.userId===user.id,404,'RUN_NOT_FOUND','运行不存在。');return run;}
const objectIds=text=>[...new Set((String(text).match(/\b[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)+\b/gi)||[]).filter(x=>/\d/.test(x)))];
const followUp=text=>/^(?:那|那么|再|还|只|仅|其中|上述|这个|这些|它|其|同类|近|最近)|前面|刚才|接着|继续/.test(text);
export function buildConversationContext(store,user,conversationId,{baseId='',documentId='',documentVersion,question='',inputs={}}={}){
  const conversation=conversationId?store.get('conversation',conversationId):null;if(!conversation)return {turns:[],summary:null,objectIds:[],followUp:false,query:question};
  requireValue(conversation.userId===user.id,404,'CONVERSATION_NOT_FOUND','会话不存在。');
  if(baseId&&conversation.baseId&&baseId!==conversation.baseId)return {turns:[],summary:null,objectIds:[],followUp:false,query:question,resetReason:'知识库范围已切换'};
  const messages=store.list('message').filter(m=>m.conversationId===conversationId).sort((a,b)=>(a.sequence||0)-(b.sequence||0)||String(a.createdAt).localeCompare(String(b.createdAt)));
  const completed=messages.filter(m=>m.role==='assistant'&&!['partial','interrupted','cancelled'].includes(m.runStatus)&&evidenceBundleCurrent(store,user,m)&&evidenceWithinScope(m,{documentId,documentVersion})).map(m=>({turnId:m.turnId||m.id,question:cleanString(m.question,1500),answer:cleanString(m.content||m.answer,1500),citations:m.citations||[],graphPaths:m.graphPaths||[],learningEvidenceRefs:collectLearningEvidenceRefs(m)})).filter(t=>t.question);
  const recent=completed.slice(-6),older=completed.slice(-30,-6);while(recent.length>1&&JSON.stringify(recent.map(t=>({question:t.question,answer:t.answer}))).length>6000)older.push(recent.shift());const ids=objectIds(recent.map(t=>t.question).join(' ')),explicit=objectIds(question),follow=followUp(question)&&!explicit.length;
  if(follow&&!recent.length&&messages.some(m=>m.role==='assistant')&&!inputs.clarification)return {turns:[],summary:null,objectIds:[],followUp:true,waitingFor:{message:'前文依据已变化或不可访问，请重新明确本次主题与对象。',fields:[{name:'clarification',label:'本次主题和对象',type:'string',required:true}]}};
  const selected=cleanString(inputs.objectId,200)||null;
  if(selected)requireValue(ids.includes(selected)||question.includes(selected),400,'CONTEXT_OBJECT_UNKNOWN','补充对象必须来自当前问题或可访问的对话。');
  const summary=older.length?{id:conversationId,sourceTurns:older.map(t=>t.turnId),conditions:older.map(t=>t.question.slice(0,200)).join('\n').slice(-2000),evidenceRefs:older.flatMap(t=>t.citations),learningEvidenceRefs:collectLearningEvidenceRefs(older),method:'bounded_user_conditions',updatedAt:now()}:null;
  if(summary)store.put('conversationSummary',summary);
  if(follow&&ids.length>1&&!selected)return {turns:recent,summary,objectIds:ids,followUp:true,waitingFor:{message:'前文包含多个对象，请明确本次查询对象。',fields:[{name:'objectId',label:'本次对象',type:'string',required:true,options:ids}]}};
  const reference=selected||ids[0]||'';
  const query=follow&&recent.length?(reference?reference+'，':recent.at(-1).question+'；追问：')+question:question;
  return {turns:recent,summary,objectIds:explicit.length?explicit:reference?[reference]:[],followUp:follow,query,originalQuestion:question};
}

const property=(type,description)=>({type,description});
const schema=properties=>({type:'object',properties,additionalProperties:false});
export const TOOL_DEFINITIONS=[
  {name:'search_knowledge',label:'检索有效知识',available:true,inputSchema:schema({query:property('string','检索问题'),baseId:property('string','知识库编号')})},
  {name:'search_graph',label:'检索已核验知识图谱',available:true,inputSchema:schema({query:property('string','设备、车站或关联主题'),baseId:property('string','知识库编号'),maxHops:property('integer','最多三跳'),limit:property('integer','返回路径预算，最多12')})},
  {name:'query_table',label:'筛选与计算表格',available:true,inputSchema:schema({documentId:property('string','资料编号'),tableId:property('string','表格编号'),page:property('integer','工作表/页序号'),filters:{type:'array',maxItems:12,items:{...schema({column:property('string','原表列名'),op:{type:'string',enum:['eq','neq','contains','in','gt','gte','lt','lte','between']},value:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'},{type:'array',items:{anyOf:[{type:'string'},{type:'number'}]}}]}}),required:['column','op','value']}},select:{type:'array',maxItems:50,items:{type:'string'}},groupBy:{type:'array',maxItems:3,items:{type:'string'}},aggregations:{type:'array',maxItems:10,items:{...schema({op:{type:'string',enum:['count','sum','avg','min','max']},column:property('string','count之外必填的原表列名'),as:property('string','结果列名')}),required:['op']}},sort:{type:'array',maxItems:3,items:{...schema({column:property('string','结果列名'),direction:{type:'string',enum:['asc','desc']}}),required:['column','direction']}},limit:property('integer','返回行数，上限200')})},
  {name:'compare_clauses',label:'对照条款原文',available:true,inputSchema:schema({leftDocumentId:property('string','左侧资料'),rightDocumentId:property('string','右侧资料'),query:property('string','条款主题')})},
  {name:'lookup_asset',label:'查询业务设备记录',available:false,reason:'尚未配置并验收真实业务设备接口',inputSchema:schema({assetId:property('string','设备编号')})},
  {name:'lookup_work_orders',label:'查询业务维修记录',available:false,reason:'尚未配置并验收真实工单接口；可对已发布工单快照使用表格工具',inputSchema:schema({assetId:property('string','设备编号'),from:property('string','开始日期'),to:property('string','结束日期')})},
  {name:'create_report_draft',label:'整理本地报告草稿',available:true,inputSchema:schema({title:property('string','草稿标题')})},
];
function validateArgs(tool,args){requireValue(args&&typeof args==='object'&&!Array.isArray(args),400,'TOOL_ARGUMENTS_INVALID','工具参数必须为对象。');for(const [key,value]of Object.entries(args)){const prop=tool.inputSchema.properties[key];requireValue(prop,400,'TOOL_ARGUMENTS_INVALID','工具参数不在允许字段中。');requireValue(prop.type==='array'?Array.isArray(value):prop.type==='integer'?Number.isInteger(value):typeof value===prop.type,400,'TOOL_ARGUMENTS_INVALID','工具参数类型不正确。');}requireValue(JSON.stringify(args).length<=12000,413,'TOOL_ARGUMENTS_LIMIT','工具参数过大。');}
function tableSnapshot(store,user,args){
  const doc=documentFor(store,user,args.documentId);requireValue(!isLearningDocument(store,doc),409,'LEARNING_NOT_TABLE_SOURCE','纠错经验不是原始表格，请选择本次需要计算的原始资料。');requireValue(!knowledgePresentationPolicy(store,user).blockedDocumentIds.includes(doc.id),409,'TOOL_SOURCE_CONFLICT','该表格存在尚未复核的冲突，仅可先对照来源，不能直接给出确定统计。');requireValue(!doc.structuredDataIncomplete,409,'TABLE_INCOMPLETE','表格经校对或存在缺行，不能进行完整统计。');
  let chunks=store.chunks(doc.id).filter(c=>c.table?.schemaVersion===1);
  if(args.page)chunks=chunks.filter(c=>c.page===args.page);if(args.tableId)chunks=chunks.filter(c=>c.table.tableId===args.tableId);
  const groups=new Set(chunks.map(c=>c.page+'|'+c.table.tableId));requireValue(groups.size===1,400,groups.size?'TABLE_REQUIRED':'TABLE_UNAVAILABLE',groups.size?'请指定需要计算的工作表和表格。':'未找到可用的结构化表格。');
  const first=chunks[0],table=first.table;requireValue(table.totalRows<=5000,413,'TABLE_BUDGET','单次计算最多5000条来源记录，请缩小来源快照。');
  const native=/\.(csv|tsv|xlsx)$/i.test(doc.fileName);
  requireValue(chunks.every(c=>!c.table.reviewRequired||['confirmed','verified','accepted'].includes(c.reviewState)),409,'TABLE_REVIEW_REQUIRED','复杂表格结构尚未经过人工确认。');
  requireValue(native||chunks.every(c=>['confirmed','verified','accepted'].includes(c.reviewState||c.table.reviewState)),409,'TABLE_REVIEW_REQUIRED','识别产生的表格字段尚未复核，不能用于正式计算。');
  const rows=new Map();for(const chunk of chunks){const t=chunk.table;requireValue(t.totalRows===table.totalRows&&JSON.stringify(t.headers)===JSON.stringify(table.headers)&&t.rowEnd===t.rowStart+t.rows.length-1,409,'TABLE_INCOMPLETE','表头或记录范围不一致。');for(let i=0;i<t.rows.length;i++){const n=t.rowStart+i,value=t.rows[i];requireValue(Array.isArray(value)&&value.length===table.headers.length&&n>=1&&n<=table.totalRows&&!rows.has(n),409,'TABLE_INCOMPLETE','存在缺列或重复来源记录。');rows.set(n,{values:value,rowNumber:t.rowNumbers?.[i]||n,ordinal:n});}}
  requireValue(rows.size===table.totalRows,409,'TABLE_INCOMPLETE','表格证据不完整，不能声称全量统计。');
  return {doc,table,rows:[...rows].sort((a,b)=>a[0]-b[0]).map(([,row])=>row),chunks};
}

const normalized=value=>String(value??'').normalize('NFKC').toLowerCase().trim();
function includesLiteral(text,value){
  const needle=normalized(value),haystack=normalized(text);if(!needle)return false;
  if(/^[a-z0-9]$/.test(needle))return new RegExp('(^|[^a-z0-9])'+needle+'($|[^a-z0-9])','i').test(haystack);
  return haystack.includes(needle);
}
function rowConditionText(question,tables,inputs={}){
  let text=String(question).replace(/(?:已发布|已生效|现行|有效|已审核)(?:的)?\s*(?=《|文档|文件|资料|知识库|表格|数据表|台账)/gu,' ');
  text=text.replace(/《[^》]*》/g,' ');
  for(const table of tables)if(table.document.title)text=text.split(table.document.title).join(' ');
  return text+'\n'+Object.values(inputs).filter(v=>['string','number','boolean'].includes(typeof v)).join('\n');
}
export function tablePlanningContext(store,user,results){
  const descriptors=[],keys=new Set();let size=0;
  for(const result of results.filter(r=>r.table)){
    const args={documentId:result.documentId,page:result.page,tableId:result.table.tableId},key=JSON.stringify(args);if(keys.has(key))continue;keys.add(key);
    const snapshot=tableSnapshot(store,user,args),{doc,table,rows}=snapshot;
    requireValue(table.headers.length<=80,413,'TABLE_SCHEMA_BUDGET','表格列数过多，请指定较小的数据表。');
    const columns=table.headers.map((name,index)=>{
      const values=[...new Set(rows.map(r=>String(r.values[index]??'')).filter(v=>v.trim()))],preview=values.slice(0,8).map(v=>v.slice(0,100));
      return {name,type:table.fieldTypes?.[index]||'unknown',values:preview,valuesComplete:values.length<=8&&values.every(v=>v.length<=100),distinctValues:values.length,missingValues:rows.filter(r=>!String(r.values[index]??'').trim()).length};
    });
    const descriptor={...args,document:{id:doc.id,title:doc.title,status:doc.status,version:doc.version,sourceKind:doc.sourceKind||'unspecified',applicability:doc.applicability||''},table:{name:table.name,totalRows:table.totalRows,sourceComplete:true},columns};
    size+=JSON.stringify(descriptor).length;requireValue(size<=24000,413,'TABLE_SCHEMA_BUDGET','候选表结构超过规划预算，请指定一个较小的来源。');descriptors.push(descriptor);
  }
  return descriptors;
}
function simpleCountPlan(question,tables,inputs){
  if(tables.length!==1||Object.keys(inputs||{}).length)return null;
  const text=rowConditionText(question,tables,inputs);
  if(!/(?:多少|几)(?:条|行|项|台|个|笔)|(?:记录|条目|数据)(?:总)?数|行数|条数|计数/u.test(text))return null;
  if(/平均|均值|求和|总额|总金额|最大|最小|分组|分别|排序|筛选|仅|只看|只统计|其中|满足|排除|大于|小于|等于|为|属于|日期|期间|\d{4}年/u.test(text))return null;
  const table=tables[0];if(table.columns.some(c=>c.values.some(v=>includesLiteral(text,v))))return null;
  let residual=text;const generic='请 帮我 麻烦 调用 使用 表格 计算 工具 统计 计数 共 有 多少 几 条 行 项 台 个 笔 完整 全部 所有 记录 数据 条目 总数 数量 数 来源 说明 并 以及 与 和 覆盖 范围 情况 的 一共 总共 共有'.split(' ').sort((a,b)=>b.length-a.length);
  for(const item of new Intl.Segmenter('zh',{granularity:'word'}).segment(text))if(item.isWordLike&&table.document.title.includes(item.segment))residual=residual.split(item.segment).join(' ');
  for(const word of generic)residual=residual.split(word).join(' ');if(residual.replace(/[\s\p{P}\p{S}]/gu,''))return null;
  return [{id:'count_rows',tool:'query_table',args:{documentId:table.documentId,page:table.page,tableId:table.tableId,filters:[],aggregations:[{op:'count',as:'记录总数'}]}}];
}
export function validatePlannedTableArguments(store,user,args,{question,inputs={},tables=[]}){
  requireValue(tables.some(t=>t.documentId===args.documentId&&(!args.page||t.page===args.page)&&(!args.tableId||t.tableId===args.tableId)),400,'PLAN_SOURCE_NOT_SELECTED','模型规划的表格不在本次已选择来源中。');
  const snapshot=tableSnapshot(store,user,args),text=rowConditionText(question,tables,inputs),headers=snapshot.table.headers;
  for(const filter of args.filters||[]){
    const column=headers.indexOf(filter.column);requireValue(column>=0,400,'TABLE_COLUMN_UNKNOWN','模型规划使用了不存在的列。');
    const values=Array.isArray(filter.value)?filter.value:[filter.value];
    const explicitColumn=includesLiteral(text,filter.column);
    requireValue(values.length&&values.every(value=>includesLiteral(text,value)),400,'PLAN_UNREQUESTED_FILTER','模型增加了用户没有指定的记录筛选条件，尚未执行计算。');
    if(!explicitColumn)for(const value of values){const matching=headers.filter((_,index)=>snapshot.rows.some(row=>includesLiteral(row.values[index],value)));requireValue(matching.length===1&&matching[0]===filter.column,400,'PLAN_AMBIGUOUS_FILTER','记录筛选字段无法从用户条件唯一确定，请明确列名。');}
    if(['neq','gt','gte','lt','lte','between'].includes(filter.op)){
      const indicators={neq:/不等于|不是|排除|除外|不含|不属于|!=|<>/,gt:/大于|超过|高于|之后|晚于|>/,gte:/不少于|至少|大于等于|不低于|>=|≥/,lt:/小于|低于|之前|早于|</,lte:/不超过|至多|小于等于|不高于|<=|≤/,between:/之间|范围|从|至|到|between/i};
      requireValue(indicators[filter.op].test(text),400,'PLAN_UNREQUESTED_FILTER','模型增加了用户未明确的比较条件，尚未执行计算。');
    }
  }
  const countAsked=/(?:多少|几)(?:条|行|项|台|个|笔)|(?:记录|条目|数据)(?:总)?数|行数|条数|计数/u.test(text);
  if(countAsked){requireValue((args.aggregations||[]).some(a=>a.op==='count'),400,'PLAN_COUNT_REQUIRED','用户要求记录计数，但模型未提出计数操作，尚未执行计算。');for(const aggregation of args.aggregations||[])if(aggregation.op==='count'&&aggregation.column)requireValue(includesLiteral(text,aggregation.column)&&/非空|不为空|有值|已填/u.test(text),400,'PLAN_UNREQUESTED_FILTER','用户要求记录数，模型不能改成未经指定的某列非空数量。');}
  return args;
}

function decimal(value){const s=String(value).trim();if(!s)return null;requireValue(/^[+-]?\d+(?:\.\d{1,12})?$/.test(s),400,'TABLE_NON_NUMERIC','计算列含非数值或超过12位小数，须先核对字段。');const negative=s.startsWith('-'),[whole,fraction='']=s.replace(/^[+-]/,'').split('.');return (negative?-1n:1n)*(BigInt(whole)*1000000000000n+BigInt(fraction.padEnd(12,'0')));}
function numeric(value){const negative=value<0n,n=negative?-value:value,s=(negative?'-':'')+(n/1000000000000n)+'.'+String(n%1000000000000n).padStart(12,'0');const clean=s.replace(/\.?0+$/,'');const number=Number(clean);return Number.isFinite(number)&&Math.abs(number)<=Number.MAX_SAFE_INTEGER&&!/[eE]/.test(String(number))&&decimal(String(number))===value?number:clean;}
function compareValue(a,b){if(/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(a))&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(String(b))){const x=Date.parse(a),y=Date.parse(b);requireValue(Number.isFinite(x)&&Number.isFinite(y),400,'TABLE_INVALID_DATE','日期条件无效。');return x<y?-1:x>y?1:0;}const x=decimal(a),y=decimal(b);requireValue(x!==null&&y!==null,400,'TABLE_MISSING_VALUE','比较值缺失，不能当作0。');return x<y?-1:x>y?1:0;}
export function queryTable(store,user,args){
  const snapshot=tableSnapshot(store,actor(store,user),args),{doc,table}=snapshot,headers=table.headers;
  const column=name=>{const i=headers.indexOf(name);requireValue(i>=0,400,'TABLE_COLUMN_UNKNOWN','表格字段不存在，请使用原表列名。');return i;};
  const filters=args.filters||[];requireValue(filters.length<=12,400,'TABLE_FILTER_LIMIT','筛选条件过多。');
  const accepted=filters.map(f=>{requireValue(f&&Object.hasOwn(f,'value')&&['eq','neq','contains','in','gt','gte','lt','lte','between'].includes(f.op),400,'TABLE_FILTER_INVALID','筛选操作无效。');return {...f,index:column(f.column)};});
  let rows=snapshot.rows.filter(row=>accepted.every(f=>{const value=String(row.values[f.index]??'');if(f.op==='eq')return value===String(f.value);if(f.op==='neq')return value!==String(f.value);if(f.op==='contains')return value.includes(String(f.value));if(f.op==='in'){requireValue(Array.isArray(f.value)&&f.value.length<=100,400,'TABLE_FILTER_INVALID','集合筛选需要不超过100项的列表。');return f.value.map(String).includes(value);}if(!value.trim())return false;if(f.op==='between'){requireValue(Array.isArray(f.value)&&f.value.length===2,400,'TABLE_FILTER_INVALID','范围筛选需要两个边界。');return compareValue(value,f.value[0])>=0&&compareValue(value,f.value[1])<=0;}const compared=compareValue(value,f.value);return f.op==='gt'?compared>0:f.op==='gte'?compared>=0:f.op==='lt'?compared<0:compared<=0;}));
  const groupBy=args.groupBy||[],aggregations=args.aggregations||[];requireValue(groupBy.length<=3&&aggregations.length<=10,400,'TABLE_AGGREGATION_LIMIT','分组或计算字段超过限制。');const groupIndexes=groupBy.map(column),missing={};let result;
  if(aggregations.length){
    const specs=aggregations.map((a,i)=>{requireValue(a&&['count','sum','avg','min','max'].includes(a.op),400,'TABLE_AGGREGATION_INVALID','仅允许计数、求和、均值、最小值和最大值。');return {...a,index:a.column?column(a.column):null,as:cleanString(a.as,100)||a.op+'_'+(a.column||'rows')};});
    requireValue(new Set(specs.map(s=>s.as)).size===specs.length,400,'TABLE_AGGREGATION_INVALID','结果字段名称不能重复。');
    const groups=new Map();for(const row of rows){const key=JSON.stringify(groupIndexes.map(i=>row.values[i]));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}if(!groups.size&&!groupBy.length)groups.set('[]',[]);
    result=[...groups].map(([key,members])=>{const output=Object.fromEntries(groupBy.map((name,i)=>[name,JSON.parse(key)[i]]));for(const spec of specs){const values=spec.index===null?members.map(()=>1n):members.map(r=>String(r.values[spec.index]??'').trim()).filter(v=>v!=='');missing[spec.as]=(missing[spec.as]||0)+(members.length-values.length);if(spec.op==='count'){output[spec.as]=values.length;continue;}requireValue(spec.index!==null,400,'TABLE_COLUMN_REQUIRED','数值计算必须指定列。');const nums=values.map(decimal);if(!nums.length){output[spec.as]=null;continue;}let total=nums.reduce((a,b)=>a+b,0n);if(spec.op==='avg'){const length=BigInt(nums.length),sign=total<0n?-1n:1n;total=(total+sign*(length/2n))/length;}else if(spec.op==='min')total=nums.reduce((a,b)=>a<b?a:b);else if(spec.op==='max')total=nums.reduce((a,b)=>a>b?a:b);output[spec.as]=numeric(total);}return output;});
  }else{const selected=args.select?.length?args.select:headers;requireValue(selected.length<=50,400,'TABLE_SELECT_LIMIT','最多返回50列。');const indexes=selected.map(column);result=rows.map(row=>({...Object.fromEntries(selected.map((name,i)=>[name,row.values[indexes[i]]])),sourceRowNumber:row.rowNumber}));}
  const sort=args.sort||[];requireValue(sort.length<=3,400,'TABLE_SORT_LIMIT','最多三个排序字段。');for(const item of sort)requireValue(item&&['asc','desc'].includes(item.direction)&&result.every(row=>Object.hasOwn(row,item.column)),400,'TABLE_SORT_INVALID','排序字段或方向无效。');
  result.sort((a,b)=>{for(const s of sort){const x=a[s.column],y=b[s.column];const compared=typeof x==='number'&&typeof y==='number'?x-y:String(x??'').localeCompare(String(y??''),'zh-CN',{numeric:true});if(compared)return s.direction==='desc'?-compared:compared;}return 0;});
  const limit=Math.min(200,Math.max(1,args.limit||100)),output=result.slice(0,limit),complete=output.length===result.length,sourceRef={id:snapshot.chunks[0].id,documentId:doc.id,title:doc.title,fileName:doc.fileName,baseId:doc.baseId,version:doc.version,page:snapshot.chunks[0].page,sourceFingerprint:documentFingerprint(doc),sourceChunkIds:snapshot.chunks.map(c=>c.id),locator:snapshot.chunks[0].locator||{page:snapshot.chunks[0].page,tableId:table.tableId,rowNumbers:snapshot.rows.map(r=>r.rowNumber)},kind:'tool_result_source',text:'计算来源（点击查看原表，计算值见工具结果）：'+table.name+'；来源记录 '+table.totalRows+' 行',citation:1,used:true};
  const missingByColumn=Object.fromEntries(headers.map((name,index)=>[name,rows.filter(row=>!String(row.values[index]??'').trim()).length]));const rowsWithAllCellsPresent=rows.filter(row=>row.values.every(value=>String(value??'').trim())).length;
  return {tool:'query_table',version:1,status:'succeeded',recordQuality:{checkedRows:rows.length,rowsWithAllCellsPresent,rowsWithMissingCells:rows.length-rowsWithAllCellsPresent,missingByColumn,criterion:'仅按各列是否非空检查数据完整性，不等同于业务真实、有效或已审批'},result:output,matchedRows:rows.length,sourceRows:rows.map(r=>r.rowNumber),missing,calculation:{filters,groupBy,aggregations,sort,numericMethod:'fixed-point decimal, 12 places; mean rounded half away from zero; blanks excluded'},coverage:{complete,totalRows:table.totalRows,matchedRows:rows.length,returnedRows:output.length,sourceComplete:true,reason:complete?'已在完整来源快照上计算；缺失值另列':'已在完整来源快照上计算，但结果展示超过上限，请增加筛选'},citations:[sourceRef],snapshotHash:digest(snapshot.rows)};
}

function resolveReferences(value,completed){if(Array.isArray(value))return value.map(v=>resolveReferences(v,completed));if(value&&typeof value==='object'){if(Object.keys(value).length===1&&typeof value.$ref==='string'){const parts=value.$ref.split('.');requireValue(parts.length>=2&&parts.length<=8&&parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)&&!['__proto__','prototype','constructor'].includes(p)),400,'PLAN_REFERENCE_INVALID','步骤引用无效。');let found=completed.get(parts.shift());for(const part of parts)found=found?.[part];requireValue(found!==undefined,400,'PLAN_DEPENDENCY_MISSING','前置步骤结果不存在。');return found;}return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveReferences(v,completed)]));}return value;}
function toolContent(tool){
  if(tool.tool==='search_knowledge')return {matches:(tool.citations||[]).map(ref=>({id:ref.id,documentId:ref.documentId,title:ref.title,matchReason:ref.matchReason,graphPathIds:(ref.graphPaths||[]).map(path=>path.id)})),coverage:tool.coverage,conflicts:tool.conflicts,learningGuidance:tool.learningGuidance||[],learningEvidenceRefs:tool.learningEvidenceRefs||[]};
  if(tool.tool==='search_graph')return {paths:(tool.graphPaths||[]).map(p=>({id:p.id,nodes:p.nodes,relations:p.edges.map(e=>({subjectId:e.subjectId,objectId:e.objectId,predicate:e.predicate,label:e.label,documentId:e.documentId,blockId:e.blockId,rowNumber:e.rowNumber}))})),stats:tool.result.stats,interpretation:tool.result.interpretation};
  if(tool.tool==='create_report_draft')return {id:tool.result.id,title:tool.result.title,content:tool.result.content,status:tool.result.status,formal:tool.result.formal};
  return tool.result;
}
function readableToolResult(tool){
  if(tool.tool==='search_knowledge'){const {learningGuidance,learningEvidenceRefs,...original}=toolContent(tool);return JSON.stringify(original,null,2);}
  if(tool.tool==='search_graph')return (tool.graphPaths||[]).map(path=>path.nodes.map((node,i)=>node.name+(node.externalId&&node.externalId!==node.name?'（'+node.externalId+'）':'')+(i<path.edges.length?(path.edges[i].subjectId===node.id?' —'+path.edges[i].label+'→ ':' ←'+path.edges[i].label+'— '):'')).join('')).join('\n')||'未找到符合本次范围的已确认关系路径。';
  if(tool.tool==='create_report_draft')return tool.result.content;
  return JSON.stringify(toolContent(tool),null,2);
}
export async function executeReadOnlyTool(store,user,name,args,{runId,stepId,baseId='',documentId='',documentVersion,previousResults=[]}={}){
  user=actor(store,user);const scope=resolveDocumentScope(store,user,{baseId,documentId,documentVersion});const tool=TOOL_DEFINITIONS.find(t=>t.name===name);requireValue(tool,400,'TOOL_NOT_ALLOWED','该工具不在受控工具清单中。');requireValue(tool.available,409,'TOOL_NOT_CONFIGURED',tool.reason||'工具尚未配置。');validateArgs(tool,args);
  for(const field of ['documentId','leftDocumentId','rightDocumentId'])if(args[field]){const doc=documentFor(store,user,args[field]);requireValue(documentWithinScope(doc,scope),403,'TOOL_SCOPE_DENIED','工具资料不在本次指定资料范围中。');}
  if(name==='query_table')return queryTable(store,user,args);
  if(name==='search_knowledge'){requireValue(!args.baseId||!baseId||args.baseId===baseId,403,'TOOL_SCOPE_DENIED','检索范围超出本次知识库。');const found=await search(store,user,args.query,{...scope,baseId:scope.baseId||args.baseId||'',limit:8});return {tool:name,version:1,status:'succeeded',result:found.results,coverage:found.coverage,conflicts:found.conflicts,citations:found.results,graphPaths:found.graph?.paths||[],graph:found.graph,learningGuidance:found.learningGuidance,learningEvidenceRefs:found.learningEvidenceRefs};}
  if(name==='search_graph'){
    requireValue(!args.baseId||!baseId||args.baseId===baseId,403,'TOOL_SCOPE_DENIED','图谱检索范围超出本次知识库。');
    const query=cleanString(args.query,1000);requireValue(query,400,'GRAPH_QUERY_REQUIRED','请提供图谱检索对象或主题。');
    requireValue(args.maxHops===undefined||args.maxHops>=1&&args.maxHops<=3,400,'GRAPH_HOPS_LIMIT','图谱查询限制为一至三跳。');
    requireValue(args.limit===undefined||args.limit>=1&&args.limit<=12,400,'GRAPH_RESULT_LIMIT','图谱查询最多返回12条路径。');
    const graph=await traceStep(store,'retrieval.graph',()=>graphWithinScope(retrieveGraph(store,user,query,{baseId:scope.baseId||args.baseId||'',maxHops:args.maxHops||3,limit:args.limit||8}),scope));
    requireValue(graph.stats?.status!=='unavailable',503,'GRAPH_UNAVAILABLE','图谱检索暂不可用。');
    const citations=graph.results.map(ref=>({...ref,sourceFingerprint:documentFingerprint(documentFor(store,user,ref.documentId))}));
    const graphPaths=graphPathsForEvidence(graph.paths,citations);requireValue(validateGraphPaths(store,user,graphPaths).valid,409,'GRAPH_CHANGED','图谱关系已变化，请重新查询。');
    return {tool:name,version:1,status:'succeeded',result:{paths:graphPaths,entities:graph.entities,stats:graph.stats,interpretation:'关系表示对象关联，不能由连通路径推断因果或制度适用。'},citations,graphPaths};
  }
  if(name==='compare_clauses'){
    const left=documentFor(store,user,args.leftDocumentId),right=documentFor(store,user,args.rightDocumentId);
    const snippets=doc=>{let chunks=store.chunks(doc.id);if(args.query){const terms=cleanString(args.query,300).split(/\s+/);chunks=chunks.filter(c=>terms.some(t=>c.text.includes(t)));}return chunks.slice(0,4).map(c=>({id:c.id,documentId:doc.id,baseId:doc.baseId,title:doc.title,fileName:doc.fileName,version:doc.version,page:c.page,text:c.text,sourceFingerprint:documentFingerprint(doc)}));};
    const l=snippets(left),r=snippets(right);requireValue(l.length&&r.length,404,'CLAUSE_NOT_FOUND','至少一侧没有匹配条款，请明确条款位置。');
    const leftText=l.map(c=>c.text).join('\n'),rightText=r.map(c=>c.text).join('\n');
    return {tool:name,version:1,status:'succeeded',result:{left:{documentId:left.id,sourceKind:left.sourceKind,applicability:left.applicability,effectiveAt:left.effectiveAt,expiresAt:left.expiresAt,text:leftText},right:{documentId:right.id,sourceKind:right.sourceKind,applicability:right.applicability,effectiveAt:right.effectiveAt,expiresAt:right.expiresAt,text:rightText},identical:leftText===rightText,assessment:'原文对照，未自动判定冲突或制度效力'},citations:l.concat(r)};
  }
  const sources=previousResults.flatMap(r=>r.citations||[]);requireValue(sources.length&&evidenceBundleCurrent(store,user,previousResults)&&evidenceWithinScope(previousResults,scope),409,'REPORT_EVIDENCE_REQUIRED','草稿需要已完成步骤的有效依据。');
  const draftId='draft_'+digest([runId,stepId,previousResults]).slice(0,32),existing=store.get('reportDraft',draftId);
  const draft=existing||{id:draftId,userId:user.id,runId,title:cleanString(args.title,150)||'资料核对草稿',status:'draft',formal:false,content:'资料核对草稿（未经审批，不作为正式业务单据）\n\n'+previousResults.map((r,i)=>'步骤 '+(i+1)+'：'+r.tool+'\n'+readableToolResult(r)).join('\n\n').slice(0,20000),citations:sources,graphPaths:graphPathsForEvidence(allGraphPaths(previousResults),sources),learningEvidenceRefs:collectLearningEvidenceRefs(previousResults),createdAt:now()};
  if(!existing)store.put('reportDraft',draft);return {tool:name,version:1,status:'succeeded',result:draft,citations:sources};
}
function templateFor(store,id){if(!id)return null;const version=store.get('promptVersion',id);requireValue(version?.status==='published',409,'SCENARIO_NOT_PUBLISHED','业务模板尚未发布或已停用。');return version;}
function validateSchema(schemaValue){if(schemaValue===undefined)return {type:'object',properties:{},required:[]};requireValue(schemaValue&&schemaValue.type==='object'&&typeof schemaValue.properties==='object'&&!Array.isArray(schemaValue.properties),400,'SCHEMA_INVALID','业务字段须使用对象类型的 JSON Schema。');requireValue(Object.keys(schemaValue.properties).length<=20,400,'SCHEMA_LIMIT','最多20个业务字段。');for(const [name,p]of Object.entries(schemaValue.properties)){requireValue(/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(name)&&!['__proto__','constructor','prototype'].includes(name)&&p&&['string','number','integer','boolean'].includes(p.type),400,'SCHEMA_INVALID','字段名称或类型无效。');if(p.enum)requireValue(Array.isArray(p.enum)&&p.enum.length<=50&&p.enum.every(v=>String(v).length<=200&&(p.type==='integer'?Number.isSafeInteger(v):p.type==='number'?Number.isFinite(v):typeof v===p.type)),400,'SCHEMA_INVALID','字段选项类型不正确或过多。');}const required=schemaValue.required||[];requireValue(Array.isArray(required)&&required.every(n=>Object.hasOwn(schemaValue.properties,n)),400,'SCHEMA_INVALID','必填字段必须已经声明。');return {type:'object',additionalProperties:false,required,properties:Object.fromEntries(Object.entries(schemaValue.properties).map(([name,p])=>[name,{type:p.type,title:cleanString(p.title,100)||name,description:cleanString(p.description,400),...(p.enum?{enum:p.enum}:{})}]))};}
function validateInputs(input,definition){requireValue(input&&typeof input==='object'&&!Array.isArray(input),400,'INPUTS_INVALID','补充条件须为对象。');for(const [key,value]of Object.entries(input)){requireValue(!['__proto__','constructor','prototype'].includes(key)&&['string','number','boolean'].includes(typeof value)&&String(value).length<=2000,400,'INPUTS_INVALID','补充条件仅支持有限文本、数值和布尔字段。');if(!definition)continue;const p=definition.properties[key];requireValue(p,400,'INPUTS_INVALID','包含未声明的业务字段。');requireValue(p.type==='integer'?Number.isInteger(value):typeof value===p.type,400,'INPUTS_INVALID','业务字段类型不正确。');if(p.enum)requireValue(p.enum.includes(value),400,'INPUTS_INVALID','业务字段不在允许选项中。');}}
function requiredInputs(template,inputs){const fields=(template?.inputSchema.required||[]).filter(name=>inputs[name]===undefined||inputs[name]==='').map(name=>({name,label:template.inputSchema.properties[name].title||name,type:template.inputSchema.properties[name].type,required:true,...(template.inputSchema.properties[name].enum?{options:template.inputSchema.properties[name].enum}:{})}));return fields.length?{message:'请补充本业务场景的必要条件。',fields}:null;}
function waiting(store,run,waitingFor){const elapsed=run.startedAt?Date.now()-Date.parse(run.startedAt):0;patchRun(store,run,{status:'waiting_input',waitingFor,waitingUntil:new Date(Date.now()+30*60000).toISOString(),activeDurationMs:(run.activeDurationMs||0)+elapsed,startedAt:null});emit(store,run.id,'run.waiting_input',waitingFor);}
async function executeStep(store,runId,name,execute,{stepId,dependsOn=[],inputHash}={}){
  const {run}=checkRun(store,runId),id=stepId||uid('step_'),key=runId+':'+run.attempt+':'+id;
  const ordinal=1+store.list('runStep').filter(s=>s.runId===runId&&s.attempt===run.attempt).reduce((n,s)=>Math.max(n,s.ordinal||0),0);
  const step={id:key,stepId:id,runId,attempt:run.attempt,ordinal,name,dependsOn,inputHash,status:'running',startedAt:now()};store.put('runStep',step);emit(store,runId,'step.started',{stepId:id,name,attempt:run.attempt});
  try{const checkpoint=inputHash&&store.list('runStep').filter(s=>s.runId===runId&&s.stepId===id&&s.attempt<run.attempt&&s.name===name&&s.inputHash===inputHash&&s.status==='succeeded'&&s.result&&evidenceBundleCurrent(store,runActor(store,run),s.result)).sort((a,b)=>b.attempt-a.attempt)[0];
    if(checkpoint){checkRun(store,runId);store.put('runStep',{...step,status:'succeeded',finishedAt:now(),durationMs:0,result:checkpoint.result,reusedFrom:checkpoint.id});emit(store,runId,'step.completed',{stepId:id,name,status:'succeeded',reused:true,sourceAttempt:checkpoint.attempt});return checkpoint.result;}
    const result=await traceStep(store,name,execute,{attempt:run.attempt});checkRun(store,runId);store.put('runStep',{...step,status:'succeeded',finishedAt:now(),durationMs:Date.now()-Date.parse(step.startedAt),result});emit(store,runId,'step.completed',{stepId:id,name,status:'succeeded'});return result;}catch(error){store.put('runStep',{...step,status:['RUN_CANCELLED','MODEL_CANCELLED'].includes(error.code)?'cancelled':'failed',finishedAt:now(),errorCode:error.code||'STEP_FAILED'});throw error;}
}
function commitAnswer(store,run,result,usage){
  return store.transaction(()=>{
    const current=store.get('intelligenceRun',run.id),user=runActor(store,current);requireValue(current.status==='running',409,'RUN_STATE_CHANGED','运行状态已经变化。');
    requireValue(evidenceBundleCurrent(store,user,result)&&evidenceWithinScope(result,run),409,'EVIDENCE_CHANGED','最终提交前证据已变化，请重新查询。');
    const existing=store.get('message','answer_'+run.id);if(existing)return existing;
    const conversation=store.get('conversation',run.conversationId);requireValue(conversation?.activeRunId===run.id,409,'CONVERSATION_CHANGED','会话已被其他运行修改。');
    const existingRows=store.list('message').filter(m=>m.conversationId===conversation.id),max=existingRows.reduce((n,m)=>Math.max(n,m.sequence||0),conversation.messageSequence||existingRows.length);
    const reply={id:'answer_'+run.id,runId:run.id,traceId:run.traceId,conversationId:conversation.id,turnId:run.turnId,role:'assistant',question:run.question,content:result.answer,...result,context:run.context?{objectIds:run.context.objectIds,sourceTurns:run.context.turns.map(t=>t.turnId),strategy:run.context.followUp?'contextual_followup':'standalone'}:null,scenarioVersionId:run.scenarioVersionId,sequence:max+2,latencyMs:Date.now()-Date.parse(run.createdAt),createdAt:now(),runStatus:'succeeded'};
    store.put('message',{id:'question_'+run.id,runId:run.id,conversationId:conversation.id,turnId:run.turnId,role:'user',content:run.question,answer:run.question,sequence:max+1,createdAt:now()});store.put('message',reply);
    store.put('conversation',{...conversation,baseId:run.baseId||conversation.baseId,messageSequence:max+2,updatedAt:now()});
    const metrics=usage||store.get('setting','metrics')||{id:'metrics'};
    metrics.chatRequests=(metrics.chatRequests||0)+1;metrics.chatLatencySamples=(metrics.chatLatencySamples||0)+1;metrics.totalChatLatencyMs=(metrics.totalChatLatencyMs||0)+reply.latencyMs;metrics.lastChatLatencyMs=reply.latencyMs;metrics.averageChatLatencyMs=Math.round(metrics.totalChatLatencyMs/metrics.chatLatencySamples*10)/10;
    if(result.mode==='model')metrics.modelAnswers=(metrics.modelAnswers||0)+1;if(result.mode==='extractive')metrics.extractiveAnswers=(metrics.extractiveAnswers||0)+1;metrics.inputTokens=(metrics.inputTokens||0)+(result.usage?.prompt_tokens||0);metrics.outputTokens=(metrics.outputTokens||0)+(result.usage?.completion_tokens||0);store.put('setting',{...metrics,id:'metrics'});
    store.audit(user,'chat.answered',{target:run.id,mode:result.mode,citationCount:result.citations.length});return reply;
  });
}
async function executeRun(store,runId,usage){
  let run=store.get('intelligenceRun',runId);if(!run||run.status!=='queued'||state(store).stopping)return;
  const controller=new AbortController();state(store).controllers.set(runId,controller);
  const remaining=Math.max(1,run.budget.maxActiveMs-(run.activeDurationMs||0)),timeout=setTimeout(()=>controller.abort('budget'),remaining);
  run=patchRun(store,run,{status:'running',startedAt:now(),traceId:crypto.randomBytes(16).toString('hex'),waitingFor:null});
  try{await withTrace(store,{traceId:run.traceId,linkedTraceId:run.previousTraceId,runId,operation:'knowledge.run',actorId:run.userId,actorKind:store.get('user',run.userId)?.localOnly?'local_workspace':'account'},async()=>{
    emit(store,runId,'run.started',{status:'running',attempt:run.attempt});
    const user=runActor(store,run),template=run.templateSnapshot||null;
    const missing=requiredInputs(template,run.inputs||{});if(missing){waiting(store,run,missing);return;}
    let context=await executeStep(store,runId,'context.prepare',()=>buildConversationContext(store,user,run.conversationId,{baseId:run.baseId,documentId:run.documentId,documentVersion:run.documentVersion,question:run.question,inputs:run.inputs}));
    if(context.waitingFor){waiting(store,run,context.waitingFor);return;}
    if(context.followUp&&context.turns.length&&modelConfig(store).provider!=='disabled'){
      const rewriting=await executeStep(store,runId,'context.rewrite',()=>invokeModel(store,{temperature:0,max_tokens:500,response_format:{type:'json_object'},messages:[{role:'system',content:'将追问改写成可独立检索的问题，只保留用户明确表达的对象和条件，不回答问题、不增加事实。历史模型答复不能作为依据。返回JSON {"question":"完整问题","needsClarification":false}，对象歧义时needsClarification=true。'},{role:'user',content:JSON.stringify({question:run.question,conditions:run.inputs,history:context.turns.map(t=>({question:t.question})),summary:context.summary?.conditions,knownObjects:context.objectIds})}]},{feature:'query_rewrite',signal:controller.signal}));
      let rewritten;try{rewritten=JSON.parse(rewriting.choices?.[0]?.message?.content||'');}catch{throw failure(502,'QUERY_REWRITE_INVALID','追问改写返回格式无效。');}
      if(rewritten.needsClarification===true){waiting(store,run,{message:'请明确本次查询对象或范围。',fields:[{name:'clarification',label:'补充条件',type:'string',required:true}]});return;}
      const query=cleanString(rewritten.question,1000);requireValue(query&&objectIds(query).every(id=>context.objectIds.includes(id)||run.question.includes(id)),502,'QUERY_REWRITE_UNGROUNDED','问题改写引入了未经提供的对象，未继续查询。');context={...context,query,rewriteMethod:'model'};
    }
    run=patchRun(store,run,{context});
    let found=await executeStep(store,runId,'knowledge.search',async()=>{const user=runActor(store,run);let found=await search(store,user,context.query,{baseId:run.baseId,documentId:run.documentId,documentVersion:run.documentVersion,limit:8});
      if(!found.results.some(r=>r.table)&&/统计|计数|多少|总数|求和|平均|筛选|分组/u.test(context.query)){const titles=[...context.query.matchAll(/《([^》]+)》/g)].map(m=>normalized(m[1])),selected=store.list('document').filter(d=>titles.includes(normalized(d.title))&&!isLearningDocument(store,d)&&documentWithinScope(d,run)&&canDocument(user,d,store)&&isRetrievable(d)&&store.chunks(d.id).some(c=>c.table));if(selected.length===1){const scoped=await search(store,user,selected[0].title,{baseId:run.baseId,documentId:run.documentId||selected[0].id,documentVersion:run.documentVersion||selected[0].version,limit:8});found={...scoped,...retrieveLearningGuidance(store,user,context.query),query:context.query,results:scoped.results.filter(r=>r.documentId===selected[0].id),strategy:'用户明确标题的表格来源定位；统计仍由受控工具执行'};}}
      return found;});
    requireValue(evidenceBundleCurrent(store,runActor(store,run),{...found,citations:found.results}),409,'EVIDENCE_CHANGED','检索期间来源已变化。');emit(store,runId,'evidence.ready',{citations:found.results,coverage:found.coverage,graphPaths:found.graph?.paths||[],graph:found.graph});
    const allowed=template?.allowedTools||['search_knowledge','search_graph','query_table','compare_clauses','create_report_draft'];
    let plan=run.plan||[],planMethod=run.plan?.length?'explicit':'none',planningTables=[];
    if(!plan.length&&!found.conflicts?.length&&found.results.some(c=>c.table)&&(/统计|总计|求和|均值|平均|筛选|排序|分组|有几|多少/.test(context.query)||!found.graph?.paths?.length&&/全部|列出/.test(context.query))&&allowed.includes('query_table')){
      planningTables=tablePlanningContext(store,runActor(store,run),found.results);
      const direct=simpleCountPlan(context.query,planningTables,run.inputs);
      if(direct){plan=(await executeStep(store,runId,'tools.plan',async()=>({method:'deterministic_count',reason:'用户明确要求总记录数；文档发布状态属于来源范围，不是表内筛选条件。',plan:direct}))).plan;planMethod='deterministic_count';}
      else if(modelConfig(store).provider!=='disabled'){
        const proposed=await executeStep(store,runId,'tools.plan',()=>invokeModel(store,{temperature:0,max_tokens:1600,messages:[{role:'system',content:LEARNING_GUIDANCE_RULE+'按用户问题选择必要的只读工具。document是文档元数据，columns是表内字段，二者不可混用：已发布、有效版本、标题内日期等只限定资料来源，不能自动变成记录filters。filters只允许用户明确提供的记录条件；不要为了完整、有效、已发布等修饰词自行添加字段限制。使用真实原表列名及已展示的可选值，值列表不完整时不假设不存在其他值。统计记录总数必须使用aggregations:[{"op":"count","as":"记录总数"}]；没有记录条件时filters:[]；不要用返回行数或空结果代替计数。count不指定column表示记录数；指定column表示非空单元格数，只有用户明确要非空值数量才指定column。仅提供完整工具调用，不生成SQL或代码，不假装已执行。'},{role:'user',content:JSON.stringify({question:context.query,documentScope:'下列资料已通过权限、发布与版本检查；document.status不得直接用作表内记录条件',tables:planningTables,learningGuidance:found.learningGuidance||[],inputs:run.inputs,examples:[{task:'统计指定资料的全部记录数',arguments:{documentId:'使用tables中的真实documentId',filters:[],aggregations:[{op:'count',as:'记录总数'}]}},{task:'用户明确给出某一原表列的值后计数',arguments:{documentId:'使用tables中的真实documentId',filters:[{column:'用户明确对应的原列名',op:'eq',value:'用户明确指定且未经臆造的值'}],aggregations:[{op:'count',as:'记录总数'}]}}]})}],tools:TOOL_DEFINITIONS.filter(t=>allowed.includes(t.name)&&t.available).map(t=>({type:'function',function:{name:t.name,description:t.label,parameters:t.inputSchema}})),tool_choice:{type:'function',function:{name:'query_table'}}},{feature:'tool_planning',signal:controller.signal}).then(result=>({...result,learningEvidenceRefs:found.learningEvidenceRefs||[]})));
        plan=(proposed.choices?.[0]?.message?.tool_calls||[]).map((call,i)=>{let args;try{args=JSON.parse(call.function.arguments);}catch{throw failure(502,'TOOL_ARGUMENTS_INVALID','模型建议的工具参数无法解析。');}return {id:'tool_'+(i+1),tool:call.function.name,args};});planMethod='model';
        try{requireValue(plan.some(step=>step.tool==='query_table'),400,'PLAN_TOOL_REQUIRED','未取得有效的表格计算计划，尚未执行计算。');for(const step of plan)if(step.tool==='query_table')validatePlannedTableArguments(store,runActor(store,run),step.args,{question:context.query,inputs:run.inputs,tables:planningTables});}
        catch(error){if(!String(error.code).startsWith('PLAN_'))throw error;waiting(store,store.get('intelligenceRun',runId),{message:error.message+' 请明确本次要筛选的原表字段和取值，或说明统计全部来源记录。',fields:[{name:'clarification',label:'记录筛选条件',type:'string',required:true}]});return;}
      }
    }
    requireValue(evidenceBundleCurrent(store,runActor(store,run),found),409,'LEARNING_CHANGED','检索或纠错经验已变化，请重新查询。');
    run=patchRun(store,run,{planMethod});
    requireValue(plan.length<=run.budget.maxSteps,400,'PLAN_LIMIT','工具步骤超过运行预算。');
    const completed=new Map(),toolResults=[];for(let i=0;i<plan.length;i++){
      const step=plan[i];requireValue(step&&allowed.includes(step.tool),403,'TOOL_NOT_ALLOWED','业务场景未授权该工具。');requireValue(!completed.has(step.id||'tool_'+(i+1)),400,'PLAN_STEP_DUPLICATE','步骤编号不能重复。');
      for(const dependency of step.dependsOn||[])requireValue(completed.has(dependency),400,'PLAN_DEPENDENCY_MISSING','前置步骤尚未完成。');
      const args=resolveReferences(step.args||{},completed),stepId=step.id||'tool_'+(i+1);
      const output=await executeStep(store,runId,'tool.'+step.tool,()=>executeReadOnlyTool(store,runActor(store,run),step.tool,args,{runId,stepId,baseId:run.baseId,documentId:run.documentId,documentVersion:run.documentVersion,previousResults:toolResults}),{stepId,dependsOn:step.dependsOn,inputHash:['query_table','compare_clauses'].includes(step.tool)?digest(canonical({args,baseId:run.baseId,documentId:run.documentId,documentVersion:run.documentVersion,dependencyResults:toolResults})):undefined});
      requireValue(evidenceBundleCurrent(store,runActor(store,run),output),409,'EVIDENCE_CHANGED','工具结果来源已变化。');completed.set(stepId,output);toolResults.push(output);patchRun(store,run,{toolResults});
    }
    if(toolResults.length){
      let remaining=18000,complete=true;const derived=[],retrieved=[];
      for(const [i,tool]of toolResults.entries()){
        if(['search_graph','search_knowledge'].includes(tool.tool)){
          for(const ref of tool.citations||[]){if(retrieved.some(v=>v.id===ref.id))continue;if(ref.text.length>remaining){complete=false;continue;}retrieved.push(ref);remaining-=ref.text.length;}continue;
        }
        const text='受控程序执行结果（不是原文逐字摘录）：'+JSON.stringify({tool:tool.tool,result:toolContent(tool),calculation:tool.calculation,coverage:tool.coverage,missing:tool.missing,recordQuality:tool.recordQuality});
        if(text.length>remaining){complete=false;tool.coverage={...(tool.coverage||{}),complete:false,reason:'工具完整输出超过单次上下文预算，请增加筛选或查看工具结果卡。'};continue;}
        for(const ref of tool.citations||[]){if(text.length>remaining){complete=false;break;}derived.push({...ref,id:ref.sourceChunkIds?.[0]||ref.id,derivedEvidenceId:'tool-evidence-'+i+'-'+ref.documentId,kind:'tool_result',tool:tool.tool,text});remaining-=text.length;}
      }
      const ordinary=[];for(const ref of found.results)if(!retrieved.some(v=>v.id===ref.id)&&ref.text.length<=remaining){ordinary.push(ref);remaining-=ref.text.length;}
      const results=derived.concat(retrieved,ordinary),paths=graphPathsForEvidence(allGraphPaths({graph:found.graph,toolResults}),results);
      found={...found,results,graph:{...(found.graph||{}),paths},evidence:{sufficient:complete&&results.length>0},coverage:toolResults.find(t=>t.coverage)?.coverage};
    }
    const learningEvidenceRefs=collectLearningEvidenceRefs({found,context,toolResults});
    const currentContextRefs=context.turns.flatMap(t=>t.citations).concat(context.summary?.evidenceRefs||[]);requireValue(evidenceBundleCurrent(store,runActor(store,run),context),409,'CONTEXT_CHANGED','历史依据已变化，请重新提问。');
    let result;
    if(toolResults.length&&modelConfig(store).provider==='disabled'){
      const citations=[...new Map(toolResults.flatMap(t=>t.citations||[]).map(ref=>[ref.documentId+':'+ref.id,ref])).values()].map((c,i)=>({...c,citation:i+1,used:true}));
      result={answer:'以下为受控工具实际执行结果：\n\n'+toolResults.map(t=>t.tool+'\n'+readableToolResult(t)+'\n'+citations.filter(c=>(t.citations||[]).some(r=>r.id===c.id&&r.documentId===c.documentId)).map(c=>'['+c.citation+']').join('')).join('\n\n'),mode:'tool',citations,coverage:toolResults.find(t=>t.coverage)?.coverage};
    }else result=await executeStep(store,runId,'answer.generate',()=>answerQuestion(store,runActor(store,run),context.query,{baseId:run.baseId,documentId:run.documentId,documentVersion:run.documentVersion,found,model:run.chatModel||undefined,context:{turns:context.turns.map(t=>({question:t.question,topicOnlyAnswer:t.answer})),summary:context.summary?.conditions,learningEvidenceRefs:collectLearningEvidenceRefs(context),inputs:run.inputs,businessContext:{task:run.task,entityId:run.entityId}},template,toolResults:toolResults.map(t=>({tool:t.tool,result:toolContent(t),coverage:t.coverage,calculation:t.calculation})),stream:true,signal:controller.signal,feature:'chat_run'}));
    result={...result,graphPaths:result.mode==='model'?(result.graphPaths||[]):graphPathsForEvidence(allGraphPaths({graph:found.graph,toolResults}),result.citations||[]),toolResults,contextEvidenceRefs:currentContextRefs,learningEvidenceRefs:collectLearningEvidenceRefs({result,learningEvidenceRefs})};
    requireValue(evidenceBundleCurrent(store,runActor(store,run),result)&&evidenceWithinScope(result,run),409,'EVIDENCE_CHANGED','生成期间证据、资料范围或权限发生变化，未提交结果。');
    run=store.get('intelligenceRun',runId);
    const partial=toolResults.some(r=>r.coverage?.complete===false);
    if(partial){patchRun(store,run,{result:{...result,warning:'工具结果展示不完整，请增加筛选后继续。'}});emit(store,runId,'answer.final',{...result,partial:true});endRun(store,runId,'partial');return;}
    const reply=commitAnswer(store,run,result,usage);patchRun(store,run,{result:reply});emit(store,runId,'answer.segment',{text:reply.answer,citations:reply.citations,graphPaths:reply.graphPaths,learningEvidenceRefs:reply.learningEvidenceRefs,validated:true,wholeAnswer:true});emit(store,runId,'answer.final',reply);endRun(store,runId,'succeeded');
  });}catch(error){
    run=store.get('intelligenceRun',runId);if(!TERMINAL.has(run.status)){const cancelled=run.status==='cancel_requested',interrupted=state(store).stopping;
      const status=interrupted?'interrupted':cancelled?'cancelled':controller.signal.aborted||run.toolResults?.length?'partial':'failed';
      endRun(store,runId,status,{errorCode:interrupted?'PROCESS_INTERRUPTED':cancelled?'RUN_CANCELLED':controller.signal.aborted?'RUN_BUDGET_EXCEEDED':error.code||'RUN_FAILED',errorMessage:interrupted?'服务已停止，可重试此运行。':cancelled?'运行已取消。':controller.signal.aborted?'执行超过活动时间预算，结果未全部完成。':error.status&&error.status<500?error.message:'处理未完成，请凭运行编号查看错误类别。'});
    }
  }finally{clearTimeout(timeout);state(store).controllers.delete(runId);state(store).checks.delete(runId);}
}
function scheduleRun(store,runId,usage){const s=state(store);if(s.stopping||s.tasks.has(runId))return;const promise=new Promise(resolve=>setImmediate(resolve)).then(()=>executeRun(store,runId,usage));s.tasks.set(runId,promise);promise.finally(()=>s.tasks.delete(runId));}
export function createIntelligenceRun(store,user,input,{currentActor,usage,legacy=false}={}){
  user=actor(store,user);baseFor(store,user,input.baseId);const question=cleanString(input.question,4000);requireValue(question,400,'QUESTION_REQUIRED','请输入问题。');
  const requestId=cleanString(input.clientRequestId,150)||uid('request_'),fingerprint=digest(canonical({...input,clientRequestId:undefined})),key='run_'+digest([user.id,'create',requestId]);
  const existing=store.get('runIdempotency',key);if(existing){requireValue(existing.fingerprint===fingerprint,409,'IDEMPOTENCY_CONFLICT','同一请求编号不能用于不同参数。');return ownRun(store,user,existing.runId);}
  let conversation=input.conversationId?store.get('conversation',input.conversationId):null;if(input.conversationId)requireValue(conversation?.userId===user.id,404,'CONVERSATION_NOT_FOUND','会话不存在。');
  if(conversation&&!legacy)requireValue(Number.isSafeInteger(input.conversationRevision)&&input.conversationRevision===(conversation.revision||0),409,'CONVERSATION_REVISION','会话版本已变化，请刷新后重试。');
  if(conversation?.activeRunId){const active=store.get('intelligenceRun',conversation.activeRunId);requireValue(!active||TERMINAL.has(active.status),409,'CONVERSATION_BUSY','此会话已有未结束的任务。');}
  const requestedDocumentId=input.documentId===undefined?conversation?.documentId||'':input.documentId;
  const requestedVersion=input.documentVersion===undefined?conversation?.documentVersion:input.documentVersion;
  const scope=resolveDocumentScope(store,user,{baseId:input.baseId||conversation?.baseId||'',documentId:requestedDocumentId,documentVersion:requestedVersion});
  if(conversation)requireValue((conversation.documentId||'')===scope.documentId&&(conversation.documentVersion||null)===(scope.documentVersion||null),409,'CONVERSATION_SCOPE_CHANGED','精确资料范围已切换，请新建会话。');
  const task=cleanString(input.task===undefined?conversation?.task:input.task,1000),entityId=cleanString(input.entityId===undefined?conversation?.entityId:input.entityId,200);
  const template=templateFor(store,input.scenarioVersionId===undefined?conversation?.scenarioVersionId:input.scenarioVersionId);const inputs=input.inputs||{};validateInputs(inputs,template?.inputSchema);requireValue(!input.plan||Array.isArray(input.plan)&&input.plan.length<=6,400,'PLAN_INVALID','计划最多允许6个工具步骤。');
  if(!conversation)conversation={id:uid('conversation_'),userId:user.id,title:question.slice(0,80),...scope,task,entityId,scenarioVersionId:template?.id||null,createdAt:now(),updatedAt:now(),revision:0,messageSequence:0};
  const chatModel=resolveChatModel(store,input.chatModel||input.model);
  const run={id:uid('run_'),userId:user.id,conversationId:conversation.id,conversationRevision:(conversation.revision||0)+1,turnId:uid('turn_'),question,...scope,task,entityId,scenarioVersionId:template?.id||null,templateSnapshot:template,inputs,plan:input.plan||null,chatModel,status:'queued',revision:1,attempt:1,eventSequence:0,budget:{maxSteps:6,maxActiveMs:90000},createdAt:now(),updatedAt:now(),clientRequestId:requestId};
  store.transaction(()=>{store.put('intelligenceRun',run);store.put('runIdempotency',{id:key,userId:user.id,runId:run.id,fingerprint,createdAt:now()});store.put('conversation',{...conversation,...scope,task,entityId,scenarioVersionId:template?.id||null,activeRunId:run.id,revision:run.conversationRevision});store.audit(user,'run.created',{target:run.id,scenarioVersionId:template?.id||null});});
  if(currentActor)state(store).checks.set(run.id,currentActor);scheduleRun(store,run.id,usage);return run;
}
export function startIntelligence(store,{startWorker=true}={}){
  const s=state(store);if(s.started)return;s.started=true;s.stopping=false;recoverObservability(store);
  for(const run of store.list('intelligenceRun')){
    const committed=store.get('message','answer_'+run.id);
    if(['running','cancel_requested','queued'].includes(run.status)&&committed){patchRun(store,run,{result:committed});emit(store,run.id,'answer.final',committed);endRun(store,run.id,'succeeded',{recoveredCommit:true});}
    else if(['running','cancel_requested'].includes(run.status))endRun(store,run.id,run.status==='cancel_requested'?'cancelled':'interrupted',{errorCode:'PROCESS_INTERRUPTED',errorMessage:'上次执行因服务重启中断，请明确重试。'});
    else if(run.status==='queued'&&startWorker)scheduleRun(store,run.id);
    else if(run.status==='waiting_input'&&Date.parse(run.waitingUntil)<Date.now())endRun(store,run.id,'cancelled',{errorCode:'INPUT_WAIT_EXPIRED',errorMessage:'等待补充条件已到期。'});
  }
  for(const evaluation of store.list('promptEvaluation').filter(e=>e.status==='running')){store.put('promptEvaluation',{...evaluation,status:'interrupted',finishedAt:now()});const version=store.get('promptVersion',evaluation.versionId);if(version?.status==='evaluating')store.put('promptVersion',{...version,status:'draft'});}
  if(startWorker){s.timer=setInterval(()=>{for(const run of store.list('intelligenceRun'))if(run.status==='waiting_input'&&Date.parse(run.waitingUntil)<Date.now())endRun(store,run.id,'cancelled',{errorCode:'INPUT_WAIT_EXPIRED'});pruneObservability(store);},30000);s.timer.unref();}
}
export async function stopIntelligence(store){const s=state(store);s.stopping=true;if(s.timer)clearInterval(s.timer);for(const controller of [...s.controllers.values(),...s.evaluationControllers])controller.abort('shutdown');await Promise.allSettled([...s.tasks.values(),...s.evaluations]);}

function scenarioExampleQuestions(version){
  return [...new Set((version.evaluationCases||[]).filter(c=>!c.mustRefuse&&typeof c.question==='string'&&c.question.trim()).map(c=>cleanString(c.question,200)).filter(Boolean))].slice(0,3);
}
function scenarioView(store,row,user){
  const versions=store.list('promptVersion').filter(v=>v.templateId===row.id&&(isAdmin(user)||v.status==='published')).sort((a,b)=>b.version-a.version);
  return {...row,currentVersionId:row.activeVersionId||null,versions:versions.map(version=>{
    const exampleQuestions=scenarioExampleQuestions(version);
    if(isAdmin(user))return {...version,exampleQuestions};
    const {evaluationCases,evaluationRef,publishedEvaluationRef,...safe}=version;
    return {...safe,exampleQuestions};
  })};
}
function versionInput(store,input,templateId,version){
  const name=cleanString(input.name,120)||'业务问答场景',scenario=cleanString(input.scenario,80)||'general',goal=cleanString(input.goal,4000);requireValue(goal,400,'SCENARIO_GOAL_REQUIRED','请填写业务目标。');
  const allowedTools=input.allowedTools||['search_knowledge'];requireValue(Array.isArray(allowedTools)&&allowedTools.length<=6&&allowedTools.every(n=>TOOL_DEFINITIONS.some(t=>t.name===n)),400,'SCENARIO_TOOLS_INVALID','包含未登记工具。');
  const cases=input.evaluationCases||[];requireValue(Array.isArray(cases)&&cases.length<=30,400,'SCENARIO_CASES_LIMIT','模板最多关联30道评测题。');for(const c of cases)requireValue(c&&typeof c.question==='string'&&c.question.trim()&&c.question.length<=2000&&(!c.expectedTerms||Array.isArray(c.expectedTerms)&&c.expectedTerms.length<=20&&c.expectedTerms.every(t=>typeof t==='string'&&t.length<=200)),400,'SCENARIO_CASE_INVALID','评测题格式不正确。');
  const profile=input.modelProfile||{profile:'default'};requireValue(profile&&typeof profile==='object'&&Object.keys(profile).every(k=>k==='profile')&&(!profile.profile||profile.profile==='default'),400,'MODEL_PROFILE_UNAVAILABLE','当前仅登记了默认模型配置，不能使用未配置的模型档案。');
  return {id:uid('prompt_'),templateId,version,name,scenario,goal,inputSchema:validateSchema(input.inputSchema),outputSchema:validateSchema(input.outputSchema),allowedTools:[...new Set(allowedTools)],modelProfile:{profile:'default'},evaluationCases:structuredClone(cases),status:'draft',revision:1,createdAt:now(),updatedAt:now(),evaluationRef:null};
}
function evaluateVersion(store,user,version,{currentActor}={}){
  const evaluationActor=()=>{const fresh=currentActor?currentActor():actor(store,user);requireValue(fresh?.active&&fresh.id===user.id&&isAdmin(fresh),401,'AUTH_REQUIRED','评测身份或权限已失效。');return fresh;};
  const cases=version.evaluationCases;requireValue(cases.length>=2&&cases.some(c=>c.mustRefuse)&&cases.some(c=>!c.mustRefuse),400,'EVALUATION_COVERAGE_REQUIRED','发布评测至少包含一条正常回答和一条无依据拒答。');
  for(const c of cases){baseFor(store,user,c.baseId);if(c.expectedDocumentId)documentFor(store,user,c.expectedDocumentId);}
  requireValue(!store.list('promptEvaluation').some(e=>e.versionId===version.id&&e.status==='running'),409,'EVALUATION_RUNNING','该版本已有评测正在执行。');
  const evaluation={id:uid('prompt_eval_'),versionId:version.id,templateId:version.templateId,versionRevision:version.revision,versionHash:digest({...version,status:undefined,updatedAt:undefined,evaluationRef:undefined}),status:'running',createdAt:now(),userId:user.id,total:cases.length,completed:0,passed:0,results:[]};
  store.transaction(()=>{store.put('promptEvaluation',evaluation);store.put('promptVersion',{...version,status:'evaluating',evaluationRef:evaluation.id});store.audit(user,'scenario.evaluation_started',{target:version.id,evaluationId:evaluation.id});});
  const evaluationController=new AbortController();state(store).evaluationControllers.add(evaluationController);
  const task=new Promise(resolve=>setImmediate(resolve)).then(()=>withTrace(store,{feature:'prompt_evaluation',operation:'scenario.evaluation',actorId:user.id,actorKind:user.localOnly?'local_workspace':'account'},async()=>{
    try{for(let i=0;i<cases.length;i++){if(state(store).stopping){evaluation.status='interrupted';break;}const current=evaluationActor(),c=cases[i];requireValue(isAdmin(current),403,'ADMIN_REQUIRED','评测维护权限已失效。');baseFor(store,current,c.baseId);const started=Date.now();let row;
      try{const answer=await answerQuestion(store,current,c.question,{baseId:c.baseId||'',template:version,feature:'prompt_evaluation',signal:evaluationController.signal}),actual=usedCitations(answer),refusal=answer.mode==='insufficient'&&actual.length===0,sourceHit=!c.expectedDocumentId||actual.some(r=>r.documentId===c.expectedDocumentId),missing=(c.expectedTerms||[]).filter(t=>!answer.answer.includes(t)),permissionPass=evidenceCurrent(store,evaluationActor(),actual);
        row={index:i,question:c.question,passed:c.mustRefuse?refusal:answer.mode==='model'&&sourceHit&&!missing.length&&permissionPass,mode:answer.mode,sourceHit,missingTerms:missing,refusal,permissionPass,citations:actual.map(({documentId,version,sourceFingerprint})=>({documentId,version,sourceFingerprint})),latencyMs:Date.now()-started};}
      catch(error){row={index:i,question:c.question,passed:false,errorCode:error.code||'EVALUATION_FAILED',latencyMs:Date.now()-started};}
      evaluation.results.push(row);evaluation.completed++;if(row.passed)evaluation.passed++;store.put('promptEvaluation',{...evaluation});
    }
    evaluation.status=evaluation.status==='interrupted'||state(store).stopping?'interrupted':'completed';evaluation.finishedAt=now();evaluation.passRate=evaluation.completed?evaluation.passed/evaluation.total:0;store.put('promptEvaluation',{...evaluation});
    const latest=store.get('promptVersion',version.id);if(latest?.status==='evaluating')store.put('promptVersion',{...latest,status:evaluation.status==='completed'?'review':'draft',updatedAt:now()});store.audit(actor(store,user),'scenario.evaluated',{target:version.id,evaluationId:evaluation.id,passed:evaluation.passed,total:evaluation.total});
    }catch(error){store.put('promptEvaluation',{...evaluation,status:'interrupted',errorCode:error.code||'EVALUATION_INTERRUPTED',finishedAt:now()});const latest=store.get('promptVersion',version.id);if(latest?.status==='evaluating')store.put('promptVersion',{...latest,status:'draft'});}
  }));
  state(store).evaluations.add(task);task.finally(()=>{state(store).evaluations.delete(task);state(store).evaluationControllers.delete(evaluationController);});return evaluation;
}
function publishVersion(store,user,version,{rollback=false}={}){
  const evaluation=store.get('promptEvaluation',version.evaluationRef);requireValue(evaluation?.status==='completed'&&evaluation.versionId===version.id&&evaluation.completed===evaluation.total&&evaluation.passed===evaluation.total&&evaluation.total>=2,409,'SCENARIO_EVALUATION_REQUIRED','此版本尚未通过完整的正常回答和拒答评测。');
  requireValue(evaluation.results.every(r=>!r.citations?.length||evidenceCurrent(store,user,r.citations)),409,'SCENARIO_EVALUATION_STALE','评测所依据的资料已变化，请重新评测。');
  const scenario=store.get('promptScenario',version.templateId);store.transaction(()=>{if(scenario.activeVersionId&&scenario.activeVersionId!==version.id){const previous=store.get('promptVersion',scenario.activeVersionId);if(previous)store.put('promptVersion',{...previous,status:'disabled',disabledAt:now()});}store.put('promptVersion',{...version,status:'published',publishedAt:now(),publishedBy:user.id,publishedEvaluationRef:evaluation.id});store.put('promptScenario',{...scenario,activeVersionId:version.id,updatedAt:now()});store.audit(user,rollback?'scenario.rollback':'scenario.published',{target:version.id,evaluationId:evaluation.id});});return store.get('promptVersion',version.id);
}
async function readBody(ctx){
  let input;if(ctx.bodyOf)input=await ctx.bodyOf(ctx.req);else {const chunks=[];let size=0;for await(const chunk of ctx.req){size+=chunk.length;requireValue(size<=512*1024,413,'REQUEST_TOO_LARGE','请求内容过大。');chunks.push(chunk);}try{input=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw failure(400,'INVALID_JSON','请求必须为JSON对象。');}}
  requireValue(input&&typeof input==='object'&&!Array.isArray(input),400,'INVALID_JSON','请求必须为JSON对象。');
  const current=ctx.currentActor?await ctx.currentActor():actor(ctx.store,ctx.user);requireValue(current?.active&&current.id===ctx.user.id,401,'AUTH_REQUIRED','身份在读取请求期间已失效。');return {input,user:current};
}
async function streamEvents(ctx,user,run){
  const {store,res,req,url}=ctx;let last=Number(url.searchParams.get('after')||String(req.headers['last-event-id']||'').split(':').at(-1)||0);requireValue(Number.isSafeInteger(last)&&last>=0,400,'EVENT_SEQUENCE_INVALID','事件序号无效。');
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders?.();
  await new Promise(resolve=>{let closed=false,timer;const finish=()=>{if(closed)return;closed=true;if(timer)clearInterval(timer);if(!res.writableEnded)res.end();resolve();};res.once('close',finish);let heartbeat=Date.now();
    const tick=()=>{if(closed)return;try{const current=ctx.currentActor?ctx.currentActor():actor(store,user);if(!current?.active||current.id!==user.id){finish();return;}const latest=ownRun(store,current,run.id),events=store.list('runEvent').filter(e=>e.runId===run.id&&e.sequence>last).sort((a,b)=>a.sequence-b.sequence);
      for(const event of events){let outgoing=event;if(!evidenceBundleCurrent(store,current,event.payload))outgoing={...event,type:'evidence.withdrawn',payload:{message:'资料版本或访问权限已变化，原事件内容已撤回。'}};res.write('id: '+event.sequence+'\nevent: '+outgoing.type+'\ndata: '+JSON.stringify(outgoing)+'\n\n');last=event.sequence;if(res.writableLength>1024*1024){finish();return;}}
      if(TERMINAL.has(latest.status)&&last>=latest.eventSequence){finish();return;}if(Date.now()-heartbeat>15000){res.write(': heartbeat\n\n');heartbeat=Date.now();}
    }catch{finish();}};timer=setInterval(tick,200);timer.unref();tick();
  });
}
export async function handleIntelligence(ctx){
  const {pathname,method,store,res,url}=ctx;if(!pathname.startsWith('/api/'))return false;
  const supported=pathname==='/api/chat'||pathname.startsWith('/api/chat/runs')||pathname.startsWith('/api/scenarios')||pathname.startsWith('/api/scenario-versions')||pathname.startsWith('/api/scenario-evaluations')||pathname.startsWith('/api/observability')||pathname==='/api/intelligence/capabilities'||pathname.startsWith('/api/report-drafts/');
  if(!supported)return false;
  const user=actor(store,ctx.user),send=(status,data)=>{ctx.send(res,status,data);return true;};
  if(pathname==='/api/intelligence/capabilities'&&method==='GET'){const catalog=chatModelCatalog(store);return send(200,{tools:TOOL_DEFINITIONS,conversation:{historyTurns:6,summary:'bounded_user_conditions',streaming:'provider_sse_with_validated_final',persistentReplay:true,cancellation:true},model:{configured:modelConfig(store).provider!=='disabled',defaultModel:catalog.defaultModel,profiles:catalog.models.map(row=>({id:row.id,label:row.label})),style:'human_natural'},limits:{maxSteps:6,maxActiveMs:90000,maxTableRows:5000,maxOutputRows:200}});}
  if(pathname==='/api/observability'&&method==='GET'){requireValue(isAdmin(user),403,'ADMIN_REQUIRED','仅管理员可查看运行保障。');return send(200,observationSummary(store));}
  const traceMatch=pathname.match(/^\/api\/observability\/traces\/([^/]+)$/);if(traceMatch&&method==='GET'){requireValue(isAdmin(user),403,'ADMIN_REQUIRED','仅管理员可查看调用链。');const detail=traceDetail(store,traceMatch[1]);requireValue(detail,404,'TRACE_NOT_FOUND','调用链不存在。');return send(200,detail);}
  if(pathname==='/api/chat/runs'&&method==='GET'){const conversationId=url.searchParams.get('conversationId');return send(200,{runs:store.list('intelligenceRun').filter(r=>r.userId===user.id&&(!conversationId||r.conversationId===conversationId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(r=>runView(store,user,r))});}
  if((pathname==='/api/chat/runs'||pathname==='/api/chat')&&method==='POST'){
    const {input,user:current}=await readBody(ctx);ctx.rate?.('chat:'+current.id,12,60000);requireValue(!state(store).stopping,503,'SERVICE_STOPPING','服务正在停止。');
    if(pathname==='/api/chat'&&input.conversationId){
      // Legacy JSON callers wait their turn; the new run API keeps explicit 409 concurrency.
      for(;;){const conversation=store.get('conversation',input.conversationId);requireValue(conversation?.userId===current.id,404,'CONVERSATION_NOT_FOUND','会话不存在。');const active=conversation.activeRunId&&store.get('intelligenceRun',conversation.activeRunId);if(!active||TERMINAL.has(active.status))break;const pending=state(store).tasks.get(active.id);requireValue(pending&&active.status!=='waiting_input',409,'CONVERSATION_BUSY','会话正在等待补充条件。');await pending;const fresh=ctx.currentActor?await ctx.currentActor():actor(store,current);requireValue(fresh?.active&&fresh.id===current.id,401,'AUTH_REQUIRED','等待期间身份已失效。');}
    }
    const run=createIntelligenceRun(store,current,input,{currentActor:ctx.currentActor,usage:ctx.usage,legacy:pathname==='/api/chat'});
    if(pathname==='/api/chat/runs')return send(202,{run:runView(store,current,run)});
    const task=state(store).tasks.get(run.id);if(task)await task;const latest=ownRun(store,actor(store,current),run.id);if(latest.result&&latest.status==='succeeded')return send(200,safeResult(store,current,latest.result));
    if(latest.status==='waiting_input')return send(200,{runId:run.id,conversationId:run.conversationId,answer:latest.waitingFor.message,content:latest.waitingFor.message,mode:'waiting_input',citations:[],run:runView(store,current,latest)});
    if(latest.result)return send(200,{...safeResult(store,current,latest.result),run:runView(store,current,latest)});
    throw failure(latest.errorCode==='AUTH_REQUIRED'?401:502,latest.errorCode||'RUN_INCOMPLETE',latest.errorMessage||'本次运行未完成，可凭运行编号重试。');
  }
  const runMatch=pathname.match(/^\/api\/chat\/runs\/([^/]+)(?:\/(events|cancel|inputs|retry))?$/);
  if(runMatch){const run=ownRun(store,user,runMatch[1]),action=runMatch[2];
    if(method==='GET'&&action==='events'){await streamEvents(ctx,user,run);return true;}
    if(method==='GET'&&!action)return send(200,{run:runView(store,user,run),steps:store.list('runStep').filter(s=>s.runId===run.id).sort((a,b)=>(a.attempt||1)-(b.attempt||1)||(a.ordinal&&b.ordinal?a.ordinal-b.ordinal:String(a.startedAt||'').localeCompare(String(b.startedAt||'')))||String(a.id).localeCompare(String(b.id))).map(s=>({...s,result:s.result?safeToolResult(store,user,s.result):undefined})),result:run.result?safeResult(store,user,run.result):undefined});
    if(method==='POST'&&['cancel','inputs','retry'].includes(action)){
      const {input,user:current}=await readBody(ctx),latest=ownRun(store,current,run.id);
      if(action==='cancel'){if(TERMINAL.has(latest.status))return send(200,{run:runView(store,current,latest)});if(input.revision!==undefined)requireValue(input.revision===latest.revision,409,'RUN_REVISION','运行版本已变化。');patchRun(store,latest,{status:'cancel_requested'});emit(store,run.id,'run.cancel_requested',{status:'cancel_requested'});store.audit(current,'run.cancel_requested',{target:run.id});const controller=state(store).controllers.get(run.id);if(controller)controller.abort('cancel');else endRun(store,run.id,'cancelled');return send(200,{run:runView(store,current,store.get('intelligenceRun',run.id))});}
      const requestId=cleanString(action==='inputs'?input.inputRequestId:input.clientRequestId,150);requireValue(requestId,400,'REQUEST_ID_REQUIRED','恢复请求需要请求编号。');const key='resume_'+digest([current.id,run.id,action,requestId]),fingerprint=digest(canonical(input)),prior=store.get('runIdempotency',key);if(prior){requireValue(prior.fingerprint===fingerprint,409,'IDEMPOTENCY_CONFLICT','相同恢复编号不能用于不同参数。');return send(200,{run:runView(store,current,latest)});}
      requireValue(input.revision===latest.revision,409,'RUN_REVISION','运行版本已变化，请刷新。');
      resolveDocumentScope(store,current,latest);for(const field of ['baseId','documentId','documentVersion'])if(input[field]!==undefined)requireValue(String(input[field]??'')===String(latest[field]??''),409,'RUN_SCOPE_CHANGED','恢复任务不能更换资料范围，请新建会话。');
      requireValue(action==='inputs'?latest.status==='waiting_input':['interrupted','failed','partial','cancelled'].includes(latest.status),409,'RUN_NOT_RESUMABLE','该状态不允许恢复。');
      const inputs={...latest.inputs,...(input.inputs||{})};if(action==='inputs'){validateInputs(input.inputs||{});for(const field of latest.waitingFor.fields)requireValue(inputs[field.name]!==undefined&&inputs[field.name]!=='',400,'INPUT_REQUIRED','仍缺少必要条件。');}
      const question=inputs.clarification?latest.question+'；补充条件：'+cleanString(inputs.clarification,1000):latest.question;
      store.transaction(()=>{patchRun(store,latest,{status:'queued',attempt:latest.attempt+1,inputs,question,previousTraceId:latest.traceId,traceId:null,activeDurationMs:action==='retry'?0:latest.activeDurationMs||0,startedAt:null,finishedAt:null,errorCode:null,errorMessage:null,result:null,toolResults:[],waitingFor:null});store.put('runIdempotency',{id:key,runId:run.id,userId:current.id,fingerprint,createdAt:now()});const conversation=store.get('conversation',latest.conversationId);requireValue(!conversation.activeRunId||conversation.activeRunId===run.id,409,'CONVERSATION_BUSY','会话正在处理其他任务。');store.put('conversation',{...conversation,activeRunId:run.id,revision:(conversation.revision||0)+1});store.audit(current,'run.resumed',{target:run.id,attempt:latest.attempt+1});});
      if(ctx.currentActor)state(store).checks.set(run.id,ctx.currentActor);scheduleRun(store,run.id,ctx.usage);return send(202,{run:runView(store,current,store.get('intelligenceRun',run.id))});
    }
  }
  const draftMatch=pathname.match(/^\/api\/report-drafts\/([^/]+)$/);if(draftMatch&&method==='GET'){const draft=store.get('reportDraft',draftMatch[1]);requireValue(draft?.userId===user.id&&evidenceBundleCurrent(store,user,draft),404,'DRAFT_NOT_FOUND','草稿不存在或依据已失效。');return send(200,{draft});}
  if(pathname==='/api/scenarios'&&method==='GET')return send(200,{scenarios:store.list('promptScenario').map(s=>scenarioView(store,s,user)).filter(s=>isAdmin(user)||s.versions.length)});
  if(pathname==='/api/scenarios'&&method==='POST'){const {input,user:current}=await readBody(ctx);requireValue(isAdmin(current),403,'ADMIN_REQUIRED','仅管理员可维护业务模板。');const scenario={id:uid('scenario_'),name:cleanString(input.name,120)||'业务问答场景',scenario:cleanString(input.scenario,80)||'general',activeVersionId:null,createdAt:now(),updatedAt:now()},version=versionInput(store,input,scenario.id,1);store.transaction(()=>{store.put('promptScenario',scenario);store.put('promptVersion',version);store.audit(current,'scenario.created',{target:scenario.id,versionId:version.id});});return send(201,{scenario:scenarioView(store,scenario,current),version});}
  const scenarioMatch=pathname.match(/^\/api\/scenarios\/([^/]+)(?:\/(versions|rollback))?$/);
  if(scenarioMatch){const scenario=store.get('promptScenario',scenarioMatch[1]);requireValue(scenario,404,'SCENARIO_NOT_FOUND','业务模板不存在。');
    if(method==='GET'&&!scenarioMatch[2]){const view=scenarioView(store,scenario,user);return send(200,{scenario:view,versions:view.versions,evaluation:isAdmin(user)?store.get('promptEvaluation',view.versions[0]?.evaluationRef):undefined});}
    if(method==='POST'){const {input,user:current}=await readBody(ctx);requireValue(isAdmin(current),403,'ADMIN_REQUIRED','仅管理员可维护业务模板。');if(scenarioMatch[2]==='versions'){const number=Math.max(0,...store.list('promptVersion').filter(v=>v.templateId===scenario.id).map(v=>v.version))+1,version=versionInput(store,input,scenario.id,number);store.put('promptVersion',version);store.audit(current,'scenario.version_created',{target:scenario.id,versionId:version.id});return send(201,{version});}if(scenarioMatch[2]==='rollback'){const version=store.get('promptVersion',input.versionId);requireValue(version?.templateId===scenario.id,404,'SCENARIO_VERSION_NOT_FOUND','模板版本不存在。');return send(200,{version:publishVersion(store,current,version,{rollback:true})});}}
  }
  const versionMatch=pathname.match(/^\/api\/scenario-versions\/([^/]+)\/(evaluate|evaluations|publish|disable)$/);
  if(versionMatch){requireValue(isAdmin(user),403,'ADMIN_REQUIRED','仅管理员可维护业务模板。');const version=store.get('promptVersion',versionMatch[1]);requireValue(version,404,'SCENARIO_VERSION_NOT_FOUND','模板版本不存在。');if(method==='GET'&&versionMatch[2]==='evaluations')return send(200,{evaluations:store.list('promptEvaluation').filter(e=>e.versionId===version.id)});
    if(method==='POST'){const {input,user:current}=await readBody(ctx);requireValue(isAdmin(current),403,'ADMIN_REQUIRED','权限已变化。');if(input.revision!==undefined)requireValue(input.revision===version.revision,409,'SCENARIO_REVISION','模板版本已变化。');if(versionMatch[2]==='evaluate'){requireValue(version.status!=='published',409,'SCENARIO_IMMUTABLE','已发布模板不可原地评测变更，请创建新版本。');return send(202,{evaluation:evaluateVersion(store,current,version,{currentActor:ctx.currentActor})});}if(versionMatch[2]==='publish')return send(200,{version:publishVersion(store,current,version)});if(versionMatch[2]==='disable'){store.transaction(()=>{store.put('promptVersion',{...version,status:'disabled',disabledAt:now()});const scenario=store.get('promptScenario',version.templateId);if(scenario.activeVersionId===version.id)store.put('promptScenario',{...scenario,activeVersionId:null});store.audit(current,'scenario.disabled',{target:version.id});});return send(200,{version:store.get('promptVersion',version.id)});}}
  }
  const evaluationMatch=pathname.match(/^\/api\/scenario-evaluations\/([^/]+)$/);if(evaluationMatch&&method==='GET'){requireValue(isAdmin(user),403,'ADMIN_REQUIRED','仅管理员可查看模板评测。');const evaluation=store.get('promptEvaluation',evaluationMatch[1]);requireValue(evaluation,404,'EVALUATION_NOT_FOUND','评测记录不存在。');return send(200,{evaluation});}
  return false;
}
function safeToolResult(store,user,result){return evidenceBundleCurrent(store,user,result)?result:{tool:result.tool,status:'withdrawn',result:null,citations:[],warning:'来源已变化，旧工具结果已隐藏。'};}
