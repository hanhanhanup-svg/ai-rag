import {writeJsonAtomic} from './atomic-json.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseDocument} from '../server/parser.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin='http://localhost:8787';
const receipt=JSON.parse(fs.readFileSync(path.join(root,'.runtime','metro-seed-receipt.json'),'utf8'));
const progressPath=path.join(root,'.runtime','knowledge-quality-check.json');
const progress=fs.existsSync(progressPath)?JSON.parse(fs.readFileSync(progressPath,'utf8')):{cases:{},runs:{}};
const save=()=>writeJsonAtomic(progressPath,progress);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,body,attempt=0){
  const response=await fetch(origin+'/api'+route,{method:body?'POST':'GET',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(response.status===429&&attempt<4){console.log('等待平台请求配额恢复…');await sleep(16000);return api(route,body,attempt+1);}
  const result=await response.json();assert.equal(response.ok,true,`${route}: ${response.status} ${result.error?.message||''}`);return result;
}
const assetSpecs=JSON.parse(fs.readFileSync(path.join(root,'scripts','metro-data','asset-documents.json'),'utf8'));
const ledger=assetSpecs.find(s=>s.key==='metro-synthetic-asset-ledger-sep2026');
const parsed=await parseDocument({filePath:path.join(root,'knowledge-sources','metro-demo',ledger.baseKey,ledger.fileName),fileName:ledger.fileName});
const table=parsed.pages[0].table,assetBase=receipt.bases['metro-assets'];
const ledgerId=receipt.documents[ledger.key].id;
const row=table.rows.find(r=>r[2]==='SYN-EQ-006');assert.ok(row);
const additional=[
  {key:'asset-paraphrase',question:'根据行业示例资料，在行业示例中，设备资产台账的唯一标识应怎样管理？',baseId:assetBase,expectedDocumentId:receipt.documents['metro-asset-field-standard-example'].id,expectedTerms:['不得重复使用']},
  {key:'table-row',question:'合成设备台账中，SYN-EQ-006的系统分类、车站和责任角色分别是什么？',baseId:assetBase,expectedDocumentId:ledgerId,expectedTerms:[row[6],row[5],row[10]]},
  {key:'table-all',question:'请列出合成设备资产台账的全部设备编码，并给出总数量，不要遗漏任何记录。',baseId:assetBase,expectedDocumentId:ledgerId,expectedTerms:table.rows.map(r=>r[2]),requireCompleteEvidence:true},
  {key:'table-filter',question:'合成设备台账中，示例A线有几台设备？分别列出设备编码。',baseId:assetBase,expectedDocumentId:ledgerId,expectedTerms:table.rows.filter(r=>r[4]==='示例A线').map(r=>r[2]),requireCompleteEvidence:true},
  {key:'missing-id',question:'合成设备台账中，SYN-EQ-999的责任岗位是什么？',baseId:assetBase,mustRefuse:true},
  {key:'partial-id',question:'合成设备台账中，SYN-EQ-00的责任岗位是什么？',baseId:assetBase,mustRefuse:true},
  {key:'unrelated',question:'木星的卫星有多少颗？请根据知识库给出准确数量。',mustRefuse:true},
];
let state=await api('/evaluations');
assert.ok(state.cases.length>=8,'保留已有的八条正向检索用例');
for(const {key,...testCase} of additional){
  let existing=state.cases.find(c=>c.question===testCase.question&&c.baseId===(testCase.baseId||null)&&c.expectedDocumentId===(testCase.expectedDocumentId||null)&&JSON.stringify(c.expectedTerms||[])===JSON.stringify(testCase.expectedTerms||[])&&!!c.requireCompleteEvidence===!!testCase.requireCompleteEvidence&&!!c.mustRefuse===!!testCase.mustRefuse);
  if(!existing){existing=(await api('/evaluations/cases',testCase)).case;state.cases.push(existing);}
  progress.cases[key]=existing.id;save();
}
const mode=process.argv.includes('--answer')?'answer':'retrieval';
state=await api('/evaluations');
let run=progress.runs[mode]&&!process.argv.includes('--rerun')?state.runs.find(r=>r.id===progress.runs[mode]):null;
if(!run){
  assert.ok(!state.runs.some(r=>r.status==='running'),'已有评测正在运行，稍后重跑');
  run=(await api('/evaluations/run',{mode})).run;progress.runs[mode]=run.id;save();
}
let previous=-1;
const deadline=Date.now()+(mode==='answer'?1500000:240000);
while(run.status==='running'&&Date.now()<deadline){
  if(previous!==run.completed){console.log(JSON.stringify({mode,run:run.id,completed:run.completed,total:run.total,passed:run.passed}));previous=run.completed;}
  await sleep(mode==='answer'?3000:1500);
  run=(await api('/evaluations')).runs.find(r=>r.id===run.id);assert.ok(run);
}
const output=path.join(root,'output','optimization',`evaluation-${mode}.json`);fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify({verifiedAt:new Date().toISOString(),mode,caseRules:state.cases,run},null,2));
console.log(JSON.stringify({mode,status:run.status,passed:run.passed,total:run.total,failed:run.results.filter(r=>!r.passed).map(r=>({question:r.question,error:r.error,answerMode:r.answerMode,sourceHit:r.sourceHit,textHit:r.textHit,completenessHit:r.completenessHit,missingTerms:r.missingTerms,warning:r.warning})),output},null,2));
assert.equal(run.status,'completed','评测尚未完成，保留进度');
// A failed quality result is evidence to investigate, never silently discarded.
if(run.passed!==run.total)process.exitCode=2;
