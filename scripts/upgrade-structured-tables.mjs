import {writeJsonAtomic} from './atomic-json.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseDocument,chunkPages} from '../server/parser.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin='http://localhost:8787';
const receiptPath=path.join(root,'.runtime','metro-seed-receipt.json');
const progressPath=path.join(root,'.runtime','structured-table-upgrade.json');
const evidencePath=path.join(root,'output','optimization','table-migration.json');
const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
const progress=fs.existsSync(progressPath)?JSON.parse(fs.readFileSync(progressPath,'utf8')):{startedAt:new Date().toISOString(),documents:{}};
const specs=['public-documents.json','service-documents.json','asset-documents.json'].flatMap(name=>JSON.parse(fs.readFileSync(path.join(root,'scripts','metro-data',name),'utf8'))).filter(d=>d.format==='csv');
const save=()=>writeJsonAtomic(progressPath,progress);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,body){
  const response=await fetch(origin+'/api'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  const result=await response.json();
  if(!response.ok)throw new Error(`${route}: ${response.status} ${result.error?.message||result.message||'request failed'}`);
  return result;
}
async function ready(id){
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){
    const detail=await api('/documents/'+id),doc=detail.document;
    if(doc.status==='failed'||doc.embeddingStatus==='failed')throw new Error('解析或索引失败：'+doc.title);
    if(['review','published'].includes(doc.status)&&doc.embeddingStatus==='ready')return detail;
    await sleep(1500);
  }
  throw new Error('解析尚未完成，保留进度；可稍后重跑。');
}
assert.equal(specs.length,4,'只处理已确认的四份行业示例 CSV');
const sources=new Map();
for(const spec of specs){
  const record=receipt.documents[spec.key];assert.ok(record,spec.key);
  const filePath=path.join(root,'knowledge-sources','metro-demo',spec.baseKey,spec.fileName);
  const hash=crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  assert.equal(hash,record.sha256,'来源文件已变化，需先人工核对：'+spec.key);
  const parsed=await parseDocument({filePath,fileName:spec.fileName});
  sources.set(spec.key,{hash,table:parsed.pages[0].table,chunks:chunkPages(parsed.pages)});
}
for(const spec of specs){
  const source=sources.get(spec.key),record=receipt.documents[spec.key];
  let item=progress.documents[spec.key];
  if(!item){
    const old=(await api('/documents/'+record.id)).document;
    assert.equal(old.sha256,source.hash);assert.ok(['review','published'].includes(old.status));
    item=progress.documents[spec.key]={oldId:old.id,oldVersion:old.version,oldStatus:old.status,sha256:old.sha256,summary:old.summary,tags:old.tags,expiresAt:old.expiresAt||null};save();
  }
  if(!item.newId){
    const details=await api('/documents/'+item.oldId);
    const recovered=details.versions?.filter(d=>d.reparseSourceId===item.oldId&&d.sha256===item.sha256).sort((a,b)=>b.version-a.version)[0];
    if(recovered)item.newId=recovered.id;
    else{
      const response=await api('/documents/'+item.oldId+'/reparse',{revision:details.document.revision,reason:'结构化表格升级：保留完整记录、列名和来源记录号；原文件不变，生成新版本后复核。'});
      item.newId=response.document.id;
    }
    save();
  }
  let detail=await ready(item.newId),doc=detail.document;
  assert.equal(doc.sha256,item.sha256);assert.equal(doc.version,item.oldVersion+1);
  assert.equal(doc.summary,item.summary);assert.deepEqual(doc.tags,item.tags);assert.equal(doc.expiresAt||null,item.expiresAt);
  assert.ok(detail.chunks.every(c=>c.table?.schemaVersion===1));
  assert.deepEqual(detail.chunks.flatMap(c=>c.table.rows),source.table.rows,'全部单元格与原件一致');
  assert.deepEqual(detail.chunks.flatMap(c=>c.table.rowNumbers),source.table.rowNumbers);
  assert.ok(detail.chunks.every(c=>JSON.stringify(c.table.headers)===JSON.stringify(source.table.headers)));
  const original=await fetch(origin+'/api/documents/'+doc.id+'/file');assert.equal(original.status,200);
  assert.equal(crypto.createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex'),item.sha256);
  if(item.oldStatus==='published'&&doc.status==='review')doc=(await api('/documents/'+doc.id+'/actions',{action:'publish',revision:doc.revision,reason:`工程复核：新解析的 ${source.table.totalRows} 条记录及全部单元格与受控原件逐项一致，原件 SHA-256 不变；保留行业示例标记。`})).document;
  assert.equal(doc.status,item.oldStatus,'保持原有发布/待审边界');
  const previous=(await api('/documents/'+item.oldId)).document;assert.equal(previous.status,'superseded');
  item.newVersion=doc.version;item.status=doc.status;item.rows=source.table.totalRows;item.chunks=detail.chunks.length;item.originalVerified=true;item.summaryPreserved=true;item.completedAt??=new Date().toISOString();save();
  receipt.documents[spec.key]={...record,id:doc.id,status:doc.status};
  writeJsonAtomic(receiptPath,receipt);
  console.log(JSON.stringify({title:doc.title,version:doc.version,status:doc.status,rows:item.rows,chunks:item.chunks,originalVerified:true}));
}
progress.completedAt=new Date().toISOString();save();
fs.mkdirSync(path.dirname(evidencePath),{recursive:true});
fs.writeFileSync(evidencePath,JSON.stringify({startedAt:progress.startedAt,completedAt:progress.completedAt,documents:Object.entries(progress.documents).map(([key,d])=>({key,...d})),totalRows:Object.values(progress.documents).reduce((n,d)=>n+d.rows,0),totalChunks:Object.values(progress.documents).reduce((n,d)=>n+d.chunks,0),previousVersionsRetained:true},null,2));
console.log('结构化迁移完成，原版本、原件和审计保留。');
