import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chunkPages, parseDocument } from './parser.mjs';
import { localEmbeddingAvailable, localEmbeddings } from './local-embeddings.mjs';
import { search, answerQuestion, modelConfig, embeddingSignature, validateAnswerCitations, usedCitations } from './retrieval.mjs';
import { evaluateKnowledgeResult } from './extensions.mjs';

const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw new Error('Reliability regressions must never call external services.');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const user={id:'reader',role:'viewer',active:true};
function memoryStore(documents,chunks,vectors=new Map()){
  const map=new Map(documents.map(d=>[d.id,d])),bases=new Map(documents.map(d=>[d.baseId,{id:d.baseId,visibility:'company'}]));
  const store={documents:map,chunkMap:chunks,user,bases,
    get(kind,id){return kind==='document'?map.get(id):kind==='base'?bases.get(id):kind==='user'&&id===user.id?store.user:kind==='setting'?{id:'model',provider:'disabled'}:null;},
    list:kind=>kind==='document'?[...map.values()]:[],
    chunks:id=>chunks.get(id)||[],
    vectors(ids,signature){return signature===embeddingSignature(modelConfig(store))?ids.flatMap(id=>(chunks.get(id)||[]).filter(c=>vectors.has(c.id)).map(c=>({id:c.id,vector:vectors.get(c.id)}))):[];}
  };return store;
}
let fixturePromise;
async function fixture(){
  if(!fixturePromise)fixturePromise=(async()=>{
    const specs=['public-documents.json','service-documents.json','asset-documents.json'].flatMap(name=>{const value=JSON.parse(fs.readFileSync(new URL('../scripts/metro-data/'+name,import.meta.url),'utf8'));return Array.isArray(value)?value:value.documents;});
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xrag-reliability-')),documents=[],chunks=new Map();
    try{
      for(const spec of specs){
        let pages;
        if(spec.format==='csv'){const file=path.join(directory,spec.key+'.csv');fs.writeFileSync(file,spec.content);pages=(await parseDocument({filePath:file,fileName:spec.fileName})).pages;}
        else pages=[{page:1,text:spec.content}];
        const doc={id:spec.key,baseId:spec.baseKey,title:spec.title,fileName:spec.fileName,status:spec.targetStatus||'published',version:1};
        documents.push(doc);chunks.set(doc.id,chunkPages(pages).map((c,i)=>({...c,id:doc.id+':'+i,documentId:doc.id})));
      }
    }finally{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});}
    const all=[...chunks.values()].flat(),vectors=new Map();
    if(localEmbeddingAvailable()){const values=await localEmbeddings(all.map(c=>c.text));all.forEach((c,i)=>vectors.set(c.id,values[i]));}
    return {specs,store:memoryStore(documents,chunks,vectors),documents,chunks,vectors};
  })();return fixturePromise;
}
test('the original eight questions and asset paraphrase retain their required source rule', {skip:!localEmbeddingAvailable()}, async()=>{
  const {store,specs}=await fixture(),eligible=specs.filter(d=>(d.targetStatus||'published')==='published'&&d.evaluation);
  const selected=[...eligible.filter(d=>d.kind==='public').slice(0,3),...['metro-passenger','metro-assets','metro-safety','metro-operations','metro-training'].map(base=>eligible.find(d=>d.baseKey===base&&d.kind==='example'))];
  assert.equal(selected.length,8);
  for(const spec of selected){const result=await search(store,user,spec.evaluation.question,{baseId:spec.baseKey,limit:8});assert.ok(result.results.some(r=>r.documentId===spec.key&&r.text.includes(spec.evaluation.expectedText)),spec.evaluation.question);}
  const question='根据行业示例资料，在行业示例中，设备资产台账的唯一标识应怎样管理？';
  const result=await search(store,user,question,{baseId:'metro-assets',limit:8});
  assert.ok(result.results.slice(0,4).some(r=>r.text.includes('设备编码一经分配不得重复使用')));
  const extract=await answerQuestion(store,user,question,{baseId:'metro-assets'});
  assert.equal(extract.mode,'extractive');assert.match(extract.answer,/设备编码一经分配不得重复使用/);
});
test('unrelated questions, unknown people and nonexistent full identifiers refuse even without a generation model', async()=>{
  const {store}=await fixture();
  for(const question of ['木星的卫星公转周期是多少？','示例城轨的总经理是谁？','SYN-EQ-00','SYN-EQ-999的设备名称是什么？']){
    const result=await search(store,user,question,{limit:8});assert.equal(result.results.length,0,question);
    const answer=await answerQuestion(store,user,question);assert.equal(answer.mode,'insufficient',question);assert.deepEqual(answer.citations,[]);
  }
  const exact=await search(store,user,'SYN-EQ-006',{limit:8});
  assert.ok(exact.results.length>0);assert.ok(exact.results.every(r=>r.text.includes('SYN-EQ-006')));
  assert.ok(exact.results.some(r=>r.text.includes('站台门系统')));
});
test('whole-table and filtered-count questions include all legal rows with their column headers', async()=>{
  const {store}=await fixture();
  for(const question of ['请列出设备台账全部15项的设备编码与所属站名。','合成设备台账中，示例A线有几台设备？分别列出设备编码。']){
    const result=await search(store,user,question,{baseId:'metro-assets',limit:8});
    assert.equal(result.coverage?.complete,true,question);assert.equal(result.coverage.totalRows,15);assert.equal(result.coverage.returnedRows,15);
    assert.equal(result.results.length,1);const table=result.results[0].table;
    assert.equal(table.rows.length,15);assert.equal(new Set(table.rows.map(r=>r[2])).size,15);
    assert.equal(table.rows.filter(r=>r[4]==='示例A线').length,5);assert.ok(table.headers.includes('设备编码'));
  }
});
test('missing, manually corrected, conflicting and over-budget table data cannot claim complete coverage', async()=>{
  const {documents,chunks,vectors}=await fixture(),target='metro-synthetic-asset-ledger-sep2026';
  const copy=()=>memoryStore(structuredClone(documents),new Map([...chunks].map(([id,rows])=>[id,structuredClone(rows)])),vectors);
  for(const variant of ['missing','manual','conflict']){
    const store=copy(),rows=store.chunkMap.get(target);assert.ok(rows.length>1);
    if(variant==='missing')rows.splice(1,1);
    if(variant==='manual'){store.documents.get(target).structuredDataIncomplete=true;delete rows[1].table;}
    if(variant==='conflict')rows[1].table.headers=['另一个含义',...rows[1].table.headers.slice(1)];
    const found=await search(store,user,'请列出设备台账全部15项的设备编码。',{baseId:'metro-assets'});
    assert.equal(found.coverage?.complete,false,variant);const answer=await answerQuestion(store,user,'请列出设备台账全部15项的设备编码。',{baseId:'metro-assets'});assert.equal(answer.mode,'insufficient',variant);
  }
  const doc={id:'large',baseId:'base',title:'物料清单',fileName:'materials.csv',status:'published',version:1};
  const rows=Array.from({length:201},(_,i)=>['ITEM-'+String(i+1).padStart(3,'0'),'合成物料']);
  const table={schemaVersion:1,tableId:'table:1',format:'csv',name:'物料清单',headers:['物料编号','名称'],rows,rowNumbers:rows.map((_,i)=>i+2),rowStart:1,rowEnd:201,totalRows:201,headerRowNumber:1,headerSource:'first-row'};
  const store=memoryStore([doc],new Map([[doc.id,[{id:'large:1',documentId:doc.id,page:1,text:'物料编号 名称 '+rows.map(r=>r.join(' ')).join('\n'),table}]]]));
  const found=await search(store,user,'请列出物料清单全部记录',{semantic:false});
  assert.equal(found.coverage?.complete,false);assert.equal(found.coverage.returnedRows,200);assert.equal(found.coverage.totalRows,201);
});
test('table aggregation cannot read another department or an unpublished version', async()=>{
  const {documents,chunks,vectors}=await fixture();const store=memoryStore(structuredClone(documents),chunks,vectors);
  store.bases.set('metro-assets',{id:'metro-assets',visibility:'private',ownerId:'someone-else'});
  assert.equal((await search(store,user,'SYN-EQ-006')).results.length,0);
  const found=await search(store,user,'列出乘客服务诉求台账全部记录');
  assert.ok(found.results.every(r=>r.documentId!=='metro-synthetic-passenger-requests-sep2026'));
});
test('citation declarations match actual references in both directions and substantive claims carry sources', ()=>{
  const refs=[{documentId:'source-a'},{documentId:'source-b'}];
  assert.deepEqual(validateAnswerCitations({answer:'设备编码不得重复使用。[1]',citations:[1]},refs),[1]);
  assert.deepEqual(validateAnswerCitations({answer:'处理依据如下：\n1. 保留原记录。[1]\n2. 提交复核说明。[2]',citations:[1,2]},refs),[1,2]);
  assert.deepEqual(validateAnswerCitations({answer:'原表清单如下。[1]\n| 编码 | 数量 |\n| --- | --- |\n| A-1 | 15 |',citations:[1]},refs),[1]);
  for(const payload of [
    {answer:'仅使用第一项。[1]',citations:[1,2]},
    {answer:'使用第二项。[2]',citations:[1]},
    {answer:'设备编码不得重复使用。[1]\n另外必须支付1000元补偿。',citations:[1]},
    {answer:'设备编码不得重复使用。[1]另外必须支付1000元补偿。',citations:[1]},
  ])assert.throws(()=>validateAnswerCitations(payload,refs),error=>['MODEL_INVALID_CITATIONS','MODEL_UNCITED_CLAIM'].includes(error.code));
});
test('evaluation uses only actual citations and snapshots completeness and refusal rules', ()=>{
  const result={mode:'model',answer:'编码不得重复使用。[1]',citations:[{documentId:'used',citation:1,used:true,text:'编码不得重复使用'},{documentId:'unused',citation:2,used:false,text:'编码不得重复使用'}]};
  assert.equal(usedCitations(result).length,1);
  assert.equal(evaluateKnowledgeResult({expectedDocumentId:'unused',expectedText:'编码不得重复使用'},result,'answer').passed,false);
  const rule={expectedDocumentId:'used',expectedText:'编码不得重复使用',expectedTerms:['不得重复使用','保留原记录'],requireCompleteEvidence:true};
  const checked=evaluateKnowledgeResult(rule,result,'answer');
  assert.equal(checked.passed,false);assert.deepEqual(checked.missingTerms,['保留原记录']);assert.equal(checked.coverageHit,false);assert.deepEqual(checked.ruleSnapshot.expectedTerms,rule.expectedTerms);
  rule.expectedTerms.push('后续编辑');assert.equal(checked.ruleSnapshot.expectedTerms.length,2);
  assert.equal(evaluateKnowledgeResult({mustRefuse:true},{mode:'insufficient',answer:'没有依据',citations:[]},'answer').passed,true);
  assert.equal(evaluateKnowledgeResult({mustRefuse:true},{mode:'extractive',answer:'无关摘录',citations:[]},'answer').passed,false);
  assert.equal(evaluateKnowledgeResult({expectedDocumentId:'a',expectedText:'标准规则'},{results:[{documentId:'a',text:'别的内容'},{documentId:'b',text:'标准规则'}]},'retrieval').passed,false);
});
