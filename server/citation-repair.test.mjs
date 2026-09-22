import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion, validateAnswerCitations } from './retrieval.mjs';

function fixture(){
  const user={id:'reader',role:'viewer',active:true},base={id:'base',visibility:'company'};
  const document={id:'source',baseId:base.id,title:'岗位培训要求',fileName:'training.md',status:'published',version:1};
  const chunks=[{id:'rule',documentId:document.id,page:1,text:'完成培训任务应记录学习活动、任务表现和复核证据。签到不能替代任务表现证据。'},{id:'review',documentId:document.id,page:1,text:'复核人员负责核验任务表现证据，员工应记录学习问题。'}];
  const store={get(kind,id){if(kind==='user')return user;if(kind==='base')return base;if(kind==='document')return document;if(kind==='setting')return {id:'model',provider:'ollama',baseUrl:'http://127.0.0.1:1',model:'local-mock'};return null;},list:kind=>kind==='document'?[document]:[],chunks:()=>chunks,vectors:()=>[]};
  return {store,user,document};
}
const question='完成培训任务需要记录哪些证据？';
const valid={answer:'完成培训任务应记录学习活动、任务表现和复核证据。[1]',citations:[1],insufficient:false};
async function run(responses,{revoke=false}={}){
  const {store,user,document}=fixture(),requests=[],originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'http://127.0.0.1:1/chat/completions','The test intercepts only a local mock endpoint.');
    requests.push(JSON.parse(options.body));const index=requests.length-1;
    if(revoke&&index===0)document.status='archived';
    const value=responses[Math.min(index,responses.length-1)];
    if(value?.httpStatus)return new Response('{}',{status:value.httpStatus});
    return new Response(JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{return {answer:await answerQuestion(store,user,question,{baseId:'base'}),requests};}finally{globalThis.fetch=originalFetch;}
}
test('one repair request uses identical evidence and returns only strictly validated actual citations', async()=>{
  const bad={answer:'完成培训任务应记录学习活动、任务表现和复核证据。[1]',citations:[1,2],insufficient:false};
  const {answer,requests}=await run([bad,valid]);
  assert.equal(requests.length,2);assert.equal(answer.mode,'model');assert.equal(answer.validationAttempts,2);
  assert.deepEqual(requests[1].messages.slice(0,2),requests[0].messages);
  assert.equal(requests[1].messages[2].content,JSON.stringify(bad),'The original invalid declaration is sent back to the model, not silently edited.');
  assert.match(requests[1].messages[3].content,/同一批证据|同一批/);
  assert.equal(requests[1].temperature,0);assert.equal(answer.citations.length,1);assert.equal(answer.citations[0].citation,1);assert.equal(answer.citations[0].used,true);
  assert.deepEqual(answer.usage,{prompt_tokens:200,completion_tokens:40,total_tokens:240},'Usage includes the rejected first output.');
});
test('a second invalid result falls back without a third request or fabricated citation repair', async()=>{
  const bad={answer:'培训记录需完整。[1]',citations:[1,2],insufficient:false};
  const {answer,requests}=await run([bad,bad]);
  assert.equal(requests.length,2);assert.equal(answer.mode,'extractive');assert.equal(answer.validationAttempts,2);assert.match(answer.warning,/正文引用与声明/);
  assert.equal(answer.citations.some(c=>c.used===true),false);
});
test('malformed JSON and uncited factual claims can be repaired once using the same sources', async()=>{
  for(const bad of ['{"answer":', {answer:'培训任务应记录证据。[1]负责人必须每年复核3次。',citations:[1],insufficient:false}]){
    const {answer,requests}=await run([bad,valid]);assert.equal(requests.length,2);assert.equal(answer.mode,'model');assert.equal(answer.answer,valid.answer);assert.deepEqual(requests[1].messages.slice(0,2),requests[0].messages);
  }
});
test('valid answers pass once; false refusals with retrieved evidence are repaired once', async()=>{
  const first=await run([valid]);assert.equal(first.requests.length,1);assert.equal(first.answer.mode,'model');
  const repaired=await run([{answer:'当前证据不足。',citations:[],insufficient:true},valid]);
  assert.equal(repaired.requests.length,2);assert.equal(repaired.answer.mode,'model');assert.equal(repaired.answer.validationAttempts,2);
  assert.match(repaired.requests[1].messages[3].content,/误判证据不足|不得以证据不足/);
});
test('persistent false refusals fall back to extractive evidence instead of empty insufficient', async()=>{
  const {answer,requests}=await run([
    {answer:'当前证据不足。',citations:[],insufficient:true},
    {answer:'仍然不足。',citations:[],insufficient:true},
  ]);
  assert.equal(requests.length,2);assert.equal(answer.mode,'extractive');assert.ok(answer.citations.length>0);assert.match(answer.warning,/检索已命中相关原文/);
});
test('genuine refusals with no retrieved evidence stay insufficient without forced rewrite', async()=>{
  const {store,user}=fixture(),originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'没有依据',citations:[],insufficient:true})}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const answer=await answerQuestion(store,user,'火星轨道票价是多少？',{baseId:'base',found:{results:[],query:'火星轨道票价是多少？',evidence:{sufficient:false,reason:'当前有效资料未提供足够相关依据，请补充主题或资料'}}});
    assert.equal(requests.length,0);assert.equal(answer.mode,'insufficient');assert.deepEqual(answer.citations,[]);
  }finally{globalThis.fetch=originalFetch;}
});
test('transport failures are not retried as citation repairs', async()=>{
  const {answer,requests}=await run([{httpStatus:503}]);assert.equal(requests.length,1);assert.equal(answer.mode,'extractive');assert.match(answer.warning,/HTTP 503/);
});
test('revoked evidence is not sent to the model again for format repair', async()=>{
  const bad={answer:'培训记录需完整。[1]',citations:[1,2],insufficient:false};
  const {answer,requests}=await run([bad,valid],{revoke:true});assert.equal(requests.length,1);assert.equal(answer.mode,'insufficient');assert.deepEqual(answer.citations,[]);
});


test('canonical citation strings preserve the same actual source set without an unnecessary model retry', async()=>{
  const captured={answer:'根据行业示例资料，判断员工完成一项学习任务需同时记录学习活动、任务表现和复核证据；仅有阅读时长或课程签到不足以说明已具备办理能力[2]。',citations:['2'],insufficient:false};
  assert.deepEqual(validateAnswerCitations(captured,[{},{}]),[2]);
  assert.deepEqual(captured.citations,['2'],'Normalization does not rewrite the model declaration.');
  const {answer,requests}=await run([{...valid,citations:['1']}]);
  assert.equal(requests.length,1);assert.equal(answer.mode,'model');assert.equal(answer.validationAttempts,1);
  assert.deepEqual(answer.citations.map(c=>c.citation),[1]);assert.equal(answer.citations[0].used,true);
});

test('citation type normalization cannot invent, truncate or substitute a declared source', ()=>{
  const refs=[{},{}];
  for(const value of ['', ' 1', '1 ', '01', '1.0', '1e0', '+1', '1x', '9007199254740993', true, false, null, {}, [], 0, -1, 1.5]){
    assert.throws(()=>validateAnswerCitations({...valid,citations:[value]},refs),{code:'MODEL_INVALID_CITATIONS'});
  }
  for(const ids of [['2'],['1','2'],['3']]){
    assert.throws(()=>validateAnswerCitations({...valid,citations:ids},refs),{code:'MODEL_INVALID_CITATIONS'},'Body and declared source sets must still match exactly.');
  }
});


test('explicit leading source attribution covers one factual sentence without requiring model repair', async()=>{
  const captured={answer:'根据[1]，班组负责人至少每周组织排查1次，专业部门负责人至少每月组织排查1次。',citations:[1],insufficient:false};
  assert.deepEqual(validateAnswerCitations(captured,[{}]),[1]);
  for(const prefix of ['根据','依据','按照','据']){
    assert.deepEqual(validateAnswerCitations({...captured,answer:prefix+'[1]，班组负责人至少每周组织排查1次。'},[{}]),[1]);
  }
  assert.deepEqual(validateAnswerCitations({answer:'根据[1][2]，两项记录应分别复核。',citations:[1,2]},[{},{}]),[1,2]);
  const {answer,requests}=await run([{...valid,answer:'根据[1]，完成培训任务应记录学习活动、任务表现和复核证据。'}]);
  assert.equal(requests.length,1);assert.equal(answer.mode,'model');assert.equal(answer.validationAttempts,1);
});

test('leading attribution cannot cover later uncited claims or substitute a different source', ()=>{
  for(const answer of [
    '根据[1]，班组负责人至少每周组织排查1次。负责人必须每年提交3次证明。',
    '根据[1]，班组负责人至少每周组织排查1次！负责人必须每年提交3次证明。',
    '根据[1]，班组负责人至少每周组织排查1次.负责人必须每年提交3次证明。',
    '根据[1]，班组负责人至少每周组织排查1次。\n负责人必须每年提交3次证明。',
    '班组负责人每周排查1次。[1]另外必须支付1000元补偿。',
  ])assert.throws(()=>validateAnswerCitations({answer,citations:[1]},[{}]),{code:'MODEL_UNCITED_CLAIM'});
  assert.throws(()=>validateAnswerCitations({answer:'根据[2]，班组负责人至少每周组织排查1次。',citations:[1]},[{},{}]),{code:'MODEL_INVALID_CITATIONS'});
});


test('source grammar supports named documents, mid-sentence attribution and independently cited sentences', ()=>{
  const positive=[
    ['根据资料[1]，负责人应每周复核1次。',[1]],
    ['根据官方公开文件[1]，负责人应每周复核1次。',[1]],
    ['根据所提供的材料 [1]，负责人应每周复核1次。',[1]],
    ['根据《培训要求》[1]，完成任务应保存三类记录。',[1]],
    ['依据《培训要求》（2024年版）[1]，完成任务应保存三类记录。',[1]],
    ['岗位负责人应按[1]规定，每周组织排查1次。',[1]],
    ['按[1]规定，负责人应每周复核1次。',[1]],
    ['[1]规定，负责人应每周复核1次。',[1]],
    ['资料[1]明确规定负责人应每周复核1次。',[1]],
    ['文件[1]中要求负责人应每周复核1次。',[1]],
    ['证据[1]显示，样本记录周期为1.5个月。',[1]],
    ['报告[1]记载，样本记录周期为1.5个月。',[1]],
    ['根据资料[1]及[2]，两类记录应分别复核。',[1,2]],
    ['根据资料[1]，班组负责人应每周复核1次。按[2]规定，专业负责人应每月复核1次。',[1,2]],
    ['1. 根据资料[1]，负责人应每周复核1次。',[1]],
    ['- 资料[1]规定，负责人应每周复核1次。',[1]],
  ];
  for(const [answer,ids]of positive)assert.deepEqual(validateAnswerCitations({answer,citations:ids},[{},{}]),ids,answer);
});

test('attribution scope cannot turn a bare marker or previous sentence into support for added facts', ()=>{
  const negative=[
    '[1]，负责人必须每年另交1000元。',
    '已查阅资料[1]，负责人必须每年另交1000元。',
    '参考[1]之后，负责人必须每年另交1000元。',
    '根据资料[1]，负责人每周复核1次。负责人还必须每年另交1000元。',
    '按[1]规定每周复核1次！负责人还必须每年另交1000元。',
    '[1]规定每周复核1次.负责人还必须每年另交1000元。',
    '资料[1]规定每周复核1次。\n负责人还必须每年另交1000元。',
    '根据资料[1]，负责人每周复核1次。[2]只是候选来源，负责人必须每年另交1000元。',
    '根据资料[1]，负责人每周复核1次。没有第二条依据，但负责人必须每年另交1000元。',
  ];
  for(const answer of negative){
    const ids=[...new Set([...answer.matchAll(/\[(\d+)\]/g)].map(m=>Number(m[1])))];
    assert.throws(()=>validateAnswerCitations({answer,citations:ids},[{},{}]),{code:'MODEL_UNCITED_CLAIM'},answer);
  }
});
