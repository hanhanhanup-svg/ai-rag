import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
const timestamp=()=>new Date().toISOString();
const id=bytes=>crypto.randomBytes(bytes).toString('hex');
const safe=value=>typeof value==='string'&&/^[\w./:-]{1,120}$/.test(value)?value:null;
const code=error=>safe(error?.code)||'INTERNAL_ERROR';
function persist(store,kind,value){if(typeof store?.put!=='function')return;try{store.put(kind,value);}catch{store.telemetryDropped=(store.telemetryDropped||0)+1;if(kind==='modelCall')store.meteringFinalizeFailures=(store.meteringFinalizeFailures||0)+1;}}
export function traceContext(){return context.getStore()||{};}
export async function withTrace(store,metadata,execute){
  const previous=traceContext(),traceId=metadata.traceId||id(16),started=Date.now();
  const trace={id:traceId,traceId,operation:safe(metadata.operation)||'operation',feature:safe(metadata.feature),runId:safe(metadata.runId),jobId:safe(metadata.jobId),requestId:safe(metadata.requestId),actorId:safe(metadata.actorId),actorKind:metadata.actorKind==='local_workspace'?'local_workspace':'account',linkedTraceId:safe(metadata.linkedTraceId||previous.traceId),startedAt:timestamp(),status:'running'};
  persist(store,'trace',trace);
  return context.run({...previous,...trace,spanId:null},async()=>{try{const result=await execute();persist(store,'trace',{...trace,status:'succeeded',finishedAt:timestamp(),durationMs:Date.now()-started});return result;}catch(error){persist(store,'trace',{...trace,status:error?.code==='RUN_CANCELLED'?'cancelled':'failed',errorCode:code(error),finishedAt:timestamp(),durationMs:Date.now()-started});throw error;}});
}
export async function traceStep(store,operation,execute,metadata={}){
  if(!traceContext().traceId)return withTrace(store,{operation},()=>traceStep(store,operation,execute,metadata));
  const parent=traceContext(),spanId=id(8),started=Date.now(),span={id:spanId,spanId,traceId:parent.traceId,parentSpanId:parent.spanId||null,runId:parent.runId||null,operation:safe(operation)||'step',attempt:Number.isSafeInteger(metadata.attempt)?metadata.attempt:1,startedAt:timestamp(),status:'running'};
  persist(store,'traceSpan',span);
  return context.run({...parent,spanId},async()=>{try{const result=await execute();persist(store,'traceSpan',{...span,status:'succeeded',finishedAt:timestamp(),durationMs:Date.now()-started});return result;}catch(error){persist(store,'traceSpan',{...span,status:['RUN_CANCELLED','MODEL_CANCELLED'].includes(error?.code)?'cancelled':'failed',errorCode:code(error),finishedAt:timestamp(),durationMs:Date.now()-started});throw error;}});
}
export async function observeModelCall(store,metadata,execute){
  return traceStep(store,'model.'+(safe(metadata.feature)||'other'),async()=>{
    const current=traceContext(),callId='call_'+crypto.randomUUID(),started=Date.now(),row={id:callId,callId,traceId:current.traceId,spanId:current.spanId,runId:current.runId||null,feature:safe(metadata.feature==='chat'?(current.feature||metadata.feature):metadata.feature)||'other',model:safe(metadata.model)||'configured-model',provider:safe(metadata.provider)||'compatible',billingApplicable:metadata.provider!=='local',attempt:Number.isSafeInteger(metadata.attempt)?metadata.attempt:1,startedAt:timestamp(),status:'running',usageStatus:'unknown',inputTokens:null,outputTokens:null,totalTokens:null};
    if(typeof store?.put==='function'){try{store.put('modelCall',row);}catch{throw Object.assign(new Error('模型用量账本不可写，本次尚未发起模型请求。'),{status:503,code:'METERING_UNAVAILABLE'});}}
    try{
      const result=await execute(callId),usage=result?.usage;
      const known=Number.isFinite(usage?.prompt_tokens)&&Number.isFinite(usage?.completion_tokens)&&usage.prompt_tokens>=0&&usage.completion_tokens>=0;
      persist(store,'modelCall',{...row,status:'succeeded',finishedAt:timestamp(),durationMs:Date.now()-started,usageStatus:known?'known':'unknown',inputTokens:known?usage.prompt_tokens:null,outputTokens:known?usage.completion_tokens:null,totalTokens:known?(Number.isFinite(usage.total_tokens)?usage.total_tokens:usage.prompt_tokens+usage.completion_tokens):null,streamed:result?.streamed===true});
      return result;
    }catch(error){persist(store,'modelCall',{...row,status:['MODEL_CANCELLED','RUN_CANCELLED'].includes(error?.code)?'cancelled':'failed',errorCode:code(error),finishedAt:timestamp(),durationMs:Date.now()-started});throw error;}
  },{attempt:metadata.attempt});
}
export async function instrumentRequest(store,req,res,next){
  const requestId='request_'+crypto.randomUUID(),traceId=id(16),path=String(req.url||'').split('?')[0];
  const feature=path.startsWith('/api/service/')?'service':path.includes('evaluation')?'evaluation':path.includes('/search')?'search':path.includes('/chat')?'chat':'http';
  if(!res.headersSent)res.setHeader('X-Request-Id',requestId);
  try{return await withTrace(store,{traceId,operation:'http.request',requestId,feature},async()=>{
    const result=await traceStep(store,'http.handler',next);
    if(!res.writableFinished&&!res.destroyed)await new Promise(resolve=>{res.once('finish',resolve);res.once('close',resolve);});
    return result;
  });}finally{const trace=store.get?.('trace',traceId);if(trace){const failed=res.statusCode>=400||res.destroyed&&!res.writableFinished;persist(store,'trace',{...trace,status:failed?'failed':'succeeded',httpStatus:res.statusCode,errorCode:failed?(safe(res.xragErrorCode)||(res.statusCode>=400?'HTTP_'+res.statusCode:'HTTP_DISCONNECTED')):undefined});}}
}

export function recoverObservability(store){
  if(typeof store?.list!=='function')return;
  for(const kind of ['modelCall','traceSpan','trace'])for(const row of store.list(kind).filter(r=>r.status==='running'))persist(store,kind,{...row,status:'interrupted',errorCode:'PROCESS_INTERRUPTED',finishedAt:timestamp(),...(kind==='modelCall'?{usageStatus:'unknown',inputTokens:null,outputTokens:null,totalTokens:null}:{})});
  pruneObservability(store);
}
export function pruneObservability(store){
  if(typeof store?.del!=='function')return;
  const now=Date.now();
  for(const [kind,days,max]of [['traceSpan',7,20000],['trace',30,10000],['modelCall',30,20000]]){
    const rows=store.list(kind).sort((a,b)=>String(b.startedAt).localeCompare(String(a.startedAt)));
    for(let n=0;n<rows.length;n++)if(rows[n].status!=='running'&&(n>=max||now-Date.parse(rows[n].startedAt)>days*86400000))store.del(kind,rows[n].id);
  }
}
export function observationSummary(store){
  const calls=store.list('modelCall'),runs=store.list('intelligenceRun'),traces=store.list('trace'),byFeature=new Map();
  const total={calls:0,knownCalls:0,unknownCalls:0,inputTokens:0,outputTokens:0};
  for(const call of calls){if(!byFeature.has(call.feature))byFeature.set(call.feature,{feature:call.feature,calls:0,knownCalls:0,unknownCalls:0,inputTokens:0,outputTokens:0});for(const target of [total,byFeature.get(call.feature)]){target.calls++;if(call.usageStatus==='known'){target.knownCalls++;target.inputTokens+=call.inputTokens;target.outputTokens+=call.outputTokens;}else target.unknownCalls++;}}
  const durations=runs.filter(r=>Number.isFinite(r.durationMs)).map(r=>r.durationMs).sort((a,b)=>a-b),percentile=p=>durations.length?durations[Math.min(durations.length-1,Math.ceil(durations.length*p)-1)]:null;
  const metrics={runsTotal:runs.length,p50LatencyMs:percentile(.5),p95LatencyMs:percentile(.95),droppedTelemetry:store.telemetryDropped||0,meteringFinalizeFailures:store.meteringFinalizeFailures||0};
  for(const status of ['succeeded','failed','cancelled','interrupted','partial'])metrics[status]=runs.filter(r=>r.status===status).length;
  metrics.waitingInput=runs.filter(r=>r.status==='waiting_input').length;
  const errors=new Map();for(const trace of traces.filter(r=>r.errorCode))errors.set(trace.errorCode,(errors.get(trace.errorCode)||0)+1);
  return {metrics,modelUsage:{...total,byFeature:[...byFeature.values()]},recentRuns:runs.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,50).map(run=>({
    id:run.id,
    status:run.status,
    traceId:run.traceId,
    createdAt:run.createdAt,
    durationMs:run.durationMs,
    attempt:run.attempt,
    question:run.question||'',
    answer:run.result?.answer||'',
    citations:Array.isArray(run.result?.citations)?run.result.citations:[],
  })),errors:[...errors].map(([code,count])=>({code,count})),telemetry:{implementation:'W3C identifiers and local AsyncLocalStorage spans',otlpConfigured:false,traceRetentionDays:7,runRetentionDays:null,runRetentionPolicy:'kept with conversation history; explicit workspace backup and lifecycle apply'}};
}

const FLOW_STEP_LABELS={
  'http.request':'接收请求','http.handler':'路由处理',
  'context.prepare':'整理对话上下文','context.rewrite':'理解追问并改写问题',
  'knowledge.search':'检索知识库原文','answer.generate':'生成并核对答复',
  'tools.plan':'选择查询工具','tool.search_knowledge':'执行知识检索工具',
  'tool.query_table':'筛选并计算表格','tool.compare_clauses':'对照条款',
  'tool.lookup_asset':'查询设备台账','tool.lookup_work_orders':'查询维修记录',
  'tool.create_report_draft':'整理报告草稿',
  'model.chat':'调用问答模型','model.chat_run':'调用问答模型','model.query_rewrite':'调用改写模型',
  'model.tool_planning':'调用工具规划模型','model.query_embedding':'生成查询向量',
  'model.evaluation':'调用评测模型','model.other':'调用模型',
};
const FLOW_STATUS={succeeded:'已完成',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',running:'进行中',partial:'部分完成',waiting_input:'待补充'};

function clipText(value,limit=320){
  const text=String(value||'').replace(/\s+/g,' ').trim();
  if(!text)return '';
  return text.length>limit?text.slice(0,limit)+'…':text;
}
function stepLabel(name=''){
  if(FLOW_STEP_LABELS[name])return FLOW_STEP_LABELS[name];
  if(name.startsWith('model.'))return '调用模型（'+(name.slice(6)||'其他')+'）';
  if(name.startsWith('tool.'))return '执行工具（'+(name.slice(5)||'其他')+'）';
  return /[\u3400-\u9fff]/.test(name)?name:(name||'处理步骤');
}
function stageStatus(status=''){
  if(['succeeded','completed'].includes(status))return 'done';
  if(['failed','cancelled','interrupted'].includes(status))return 'error';
  if(['running','queued','started','cancel_requested'].includes(status))return 'active';
  if(['partial','waiting_input'].includes(status))return 'warn';
  return 'done';
}

function fieldLabel(template,name){
  return template?.inputSchema?.properties?.[name]?.title||name;
}
function buildPlatformEnrichments(store,run,trace){
  if(!run){
    return [{
      id:'received',
      title:'接收并登记请求',
      before:'外部调用进入平台',
      after:'已建立可追踪处理链',
      summary:'先落盘请求标识与操作者，再进入后续处理，便于审计回放。',
      value:'请求受理',
    }];
  }
  const enrichments=[];
  const ctx=run.context&&typeof run.context==='object'?run.context:{};
  const template=run.templateSnapshot||null;
  const user=run.userId?store.get('user',run.userId):null;
  const base=run.baseId?store.get('base',run.baseId):null;
  const document=run.documentId?store.get('document',run.documentId):null;
  const actorName=user?.displayName||user?.name||user?.email||user?.id||'当前账号';
  enrichments.push({
    id:'identity',
    title:'按提问人身份校验权限',
    before:'用户原话直接检索',
    after:`${actorName} · 仅使用其权限内可见资料`,
    summary:'先确认运行身份，后续检索、引用与工具调用都不会越权。',
    value:'权限隔离',
  });
  if(base||document){
    enrichments.push({
      id:'scope',
      title:'补全并锁定业务范围',
      before:'问题里未必写清要查哪里',
      after:[base?.name?`知识库「${clipText(base.name,48)}」`:null,document?.title?`资料「${clipText(document.title,48)}」`:null].filter(Boolean).join(' · '),
      summary:'沿用会话/工作台当前范围，避免答案漂到无关知识库或过期版本。',
      value:'范围锁定',
    });
  }else{
    enrichments.push({
      id:'scope',
      title:'确认可检索边界',
      before:'未指定单一知识库',
      after:'按账号可见范围检索已发布、可访问资料',
      summary:'即便未点选知识库，也会先过滤权限与发布状态，再进入检索。',
      value:'范围治理',
    });
  }
  if(template){
    enrichments.push({
      id:'scenario',
      title:'套用业务场景约束',
      before:'通用自然语言问答',
      after:`场景「${clipText(template.name||'未命名场景',48)}」${template.goal?` · ${clipText(template.goal,100)}`:''}`,
      summary:'按场景目标与允许工具约束后续步骤，而不是裸调用大模型。',
      value:'场景约束',
    });
  }
  const inputEntries=Object.entries(run.inputs&&typeof run.inputs==='object'?run.inputs:{}).filter(([,value])=>value!==undefined&&value!==null&&String(value).trim()!=='');
  if(inputEntries.length){
    enrichments.push({
      id:'inputs',
      title:'补齐业务条件字段',
      before:'仅有问题文本',
      after:inputEntries.map(([name,value])=>`${fieldLabel(template,name)}=${clipText(String(value),72)}`).join('；'),
      summary:'把用户在场景表单或澄清环节补充的条件并入本次上下文。',
      value:'条件补全',
    });
  }else if(template?.inputSchema?.required?.length){
    enrichments.push({
      id:'inputs',
      title:'核验场景必填条件',
      before:`场景要求 ${template.inputSchema.required.length} 个必要条件`,
      after:'本次已满足或尚未进入补录等待',
      summary:'缺条件时会暂停并向用户索取，而不是用猜测继续回答。',
      value:'条件核验',
    });
  }
  if(run.task||run.entityId){
    enrichments.push({
      id:'business',
      title:'挂接当前业务上下文',
      before:'脱离工作台的纯问答',
      after:[run.task?`任务 ${clipText(String(run.task),48)}`:null,run.entityId?`实体 ${clipText(String(run.entityId),48)}`:null].filter(Boolean).join(' · '),
      summary:'把工作台任务/实体带入答复，让回答贴合正在办理的业务。',
      value:'业务挂接',
    });
  }
  const originalQuestion=clipText(ctx.originalQuestion||run.question,120);
  const effectiveQuery=clipText(ctx.query||run.question,160);
  if(ctx.followUp){
    enrichments.push({
      id:'followup',
      title:'识别追问并补全完整问题',
      before:originalQuestion||'简短追问',
      after:effectiveQuery||originalQuestion,
      summary:ctx.rewriteMethod==='model'
        ?`结合前文 ${Array.isArray(ctx.turns)?ctx.turns.length:0} 轮可验证历史，改写成可独立检索的问题。`
        :`接上前文对象 ${(Array.isArray(ctx.objectIds)?ctx.objectIds:[]).join('、')||'相关主题'}，避免“那个/刚才”无法检索。`,
      value:'追问理解',
    });
  }else if(effectiveQuery&&originalQuestion&&effectiveQuery!==originalQuestion){
    enrichments.push({
      id:'query',
      title:'规范化检索问题',
      before:originalQuestion,
      after:effectiveQuery,
      summary:'将用户原话整理为实际用于检索的问题表述。',
      value:'问题整理',
    });
  }else if(Array.isArray(ctx.objectIds)&&ctx.objectIds.length){
    enrichments.push({
      id:'objects',
      title:'锚定业务对象',
      before:'问题中的指代与编号',
      after:ctx.objectIds.map(id=>clipText(String(id),40)).join('、'),
      summary:'从对话中提取设备/编号等对象，后续检索围绕它们展开。',
      value:'对象锚定',
    });
  }else{
    enrichments.push({
      id:'context',
      title:'整理对话上下文',
      before:'单条用户原话',
      after:Array.isArray(ctx.turns)&&ctx.turns.length?`携带最近 ${ctx.turns.length} 轮仍可验证的历史`:'按独立问题处理，不混入失效历史',
      summary:'只保留仍可访问的历史依据，避免用过期证据回答。',
      value:'上下文治理',
    });
  }
  if(run.chatModel){
    enrichments.push({
      id:'model',
      title:'选定回答模型路由',
      before:'平台默认路由',
      after:String(run.chatModel),
      summary:'按用户选择的模型画像发起后续生成，用量可审计。',
      value:'模型路由',
    });
  }
  if(run.status==='waiting_input'&&run.waitingFor?.message){
    enrichments.push({
      id:'waiting',
      title:'发现信息不足并请求补全',
      before:'强行继续生成',
      after:clipText(run.waitingFor.message,160),
      summary:'缺对象或必要条件时暂停等待用户补充，体现可控补全而不是臆造。',
      value:'主动澄清',
    });
  }
  return enrichments;
}

/** Build a human-readable process story for admins reviewing a trace. */
export function buildTraceFlow(store,trace,{spans=[],calls=[]}={}){
  const run=trace.runId?store.get('intelligenceRun',trace.runId):store.list('intelligenceRun').find(row=>row.traceId===trace.id)||null;
  const runSteps=run?store.list('runStep').filter(step=>step.runId===run.id).sort((a,b)=>(a.attempt||1)-(b.attempt||1)||(a.ordinal||0)-(b.ordinal||0)||String(a.startedAt||'').localeCompare(String(b.startedAt||''))):[];
  const latestAttempt=runSteps.reduce((n,step)=>Math.max(n,step.attempt||1),run?.attempt||1);
  const activeSteps=runSteps.filter(step=>(step.attempt||1)===latestAttempt);
  const stages=[];
  const question=clipText(run?.question,800);
  stages.push({
    id:'input',
    kind:'input',
    title:'用户输入了什么',
    summary:question||(trace.feature==='http'?'一次平台接口请求':'未记录到用户问题文本'),
    detail:question?undefined:'该追踪未关联到可读取的问答运行，或运行记录已清理。',
    status:question?'done':stageStatus(trace.status),
    meta:[run?.scenarioVersionId?'已绑定业务场景':'通用问答',run?.baseId?'已限定知识库':null,run?.documentId?'已限定单份资料':null].filter(Boolean),
  });
  const enrichments=buildPlatformEnrichments(store,run,trace);
  stages.push({
    id:'accept',
    kind:'platform',
    title:'平台如何补全与受理',
    summary:run
      ?`平台在进入正式检索前，默默完成了 ${enrichments.length} 项信息补全与约束（权限、范围、场景条件、上下文等）。`
      :'请求已被平台接收，并开始记录处理链。',
    detail:run?'这些补全决定了后续“查哪里、按什么条件查、能不能答”，是平台相对裸模型调用的核心价值。':undefined,
    status:stageStatus(run?.status||trace.status),
    meta:[
      run?`运行状态：${FLOW_STATUS[run.status]||run.status}`:null,
      Number.isFinite(run?.attempt)?`第 ${run.attempt} 次尝试`:null,
      Number.isFinite(trace.durationMs)?`总耗时 ${trace.durationMs} ms`:null,
    ].filter(Boolean),
    enrichments,
  });
  const processItems=(activeSteps.length?activeSteps:spans.filter(span=>!String(span.operation||'').startsWith('http.')).sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||'')))).map((item,index)=>{
    const name=item.name||item.operation||'';
    const reused=Boolean(item.reusedFrom);
    return {
      id:item.id||item.stepId||item.spanId||`step_${index}`,
      title:stepLabel(name),
      summary:reused?'沿用上次已通过校验的结果，未重复计算。':(item.errorCode?`处理异常：${item.errorCode}`:(Number.isFinite(item.durationMs)?`耗时 ${item.durationMs} ms`:'已执行')),
      status:stageStatus(item.status),
      durationMs:item.durationMs,
      name,
    };
  });
  const modelItems=calls.slice().sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||''))).map((call,index)=>({
    id:call.id||call.callId||`call_${index}`,
    title:stepLabel('model.'+(call.feature||'other')),
    summary:[
      call.model?`模型 ${call.model}`:null,
      call.usageStatus==='known'?`输入 ${call.inputTokens} / 输出 ${call.outputTokens} Token`:(call.usageStatus==='unknown'?'用量未知':null),
      Number.isFinite(call.durationMs)?`${call.durationMs} ms`:null,
    ].filter(Boolean).join(' · ')||(FLOW_STATUS[call.status]||call.status||'已调用'),
    status:stageStatus(call.status),
    durationMs:call.durationMs,
  }));
  stages.push({
    id:'process',
    kind:'process',
    title:'进入了哪些处理流程',
    summary:processItems.length?`共 ${processItems.length} 个业务步骤${modelItems.length?`，期间模型调用 ${modelItems.length} 次`:''}。`:'暂无更细的业务步骤记录，仅保留请求级追踪。',
    status:processItems.some(item=>item.status==='error')?'error':processItems.some(item=>item.status==='active')?'active':'done',
    items:processItems,
    modelCalls:modelItems,
  });
  const answer=clipText(run?.result?.answer||run?.result?.content,900);
  const citationCount=Array.isArray(run?.result?.citations)?run.result.citations.length:0;
  const mode=run?.result?.mode;
  stages.push({
    id:'output',
    kind:'output',
    title:'最后输出了什么',
    summary:answer||(run?.errorMessage?`未形成正式答复：${run.errorMessage}`:(trace.errorCode?`处理未完成（${trace.errorCode}）`:'尚未形成可展示的输出')),
    detail:mode==='insufficient'?'模型判断当前依据不足，因此未给出确定结论。':mode==='extractive'?'输出为可追溯的原文摘录，而非模型归纳。':mode==='model'?'输出为基于原文核对后的模型答复。':undefined,
    status:answer?'done':stageStatus(run?.status||trace.status),
    meta:[
      mode?`输出方式：${({model:'基于原文生成',extractive:'原文摘录',insufficient:'依据不足',tool:'工具结果'})[mode]||mode}`:null,
      citationCount?`引用 ${citationCount} 条原文`:null,
      run?.result?.warning?clipText(run.result.warning,160):null,
    ].filter(Boolean),
  });
  return {
    title:question?`「${clipText(question,48)}」的处理过程`:'一次平台处理过程',
    status:run?.status||trace.status,
    statusLabel:FLOW_STATUS[run?.status||trace.status]||(run?.status||trace.status||'未知'),
    durationMs:Number.isFinite(run?.durationMs)?run.durationMs:trace.durationMs,
    startedAt:run?.createdAt||trace.startedAt,
    finishedAt:run?.finishedAt||trace.finishedAt,
    runId:run?.id||null,
    traceId:trace.id,
    stages,
  };
}

export function traceDetail(store,traceId){
  const trace=store.get('trace',traceId);
  if(!trace)return null;
  const spans=store.list('traceSpan').filter(span=>span.traceId===trace.id);
  const calls=store.list('modelCall').filter(call=>call.traceId===trace.id);
  return {trace,spans,calls,flow:buildTraceFlow(store,trace,{spans,calls})};
}
