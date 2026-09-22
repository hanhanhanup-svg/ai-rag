import {writeJsonAtomic} from './atomic-json.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseDocument} from '../server/parser.mjs';

// This reviews only the controlled demonstration bundle, never arbitrary uploads.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const origin='http://localhost:8787';
const receipt=JSON.parse(fs.readFileSync(path.join(root,'.runtime','metro-seed-receipt.json'),'utf8'));
const progressPath=path.join(root,'.runtime','metro-engineering-review.json');
const progress=fs.existsSync(progressPath)?JSON.parse(fs.readFileSync(progressPath,'utf8')):{documents:{}};
const specs=['public-documents.json','service-documents.json','asset-documents.json'].flatMap(name=>JSON.parse(fs.readFileSync(path.join(root,'scripts','metro-data',name),'utf8')));
async function api(route,body){
  const r=await fetch(origin+'/api'+route,{method:body?'POST':'GET',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const result=await r.json();assert.equal(r.ok,true,`${route}: ${r.status} ${result.error?.message||''}`);return result;
}
const results=[];
for(const spec of specs){
  const record=receipt.documents[spec.key],detail=await api('/documents/'+record.id);
  let doc=detail.document;
  const source=path.join(root,'knowledge-sources','metro-demo',spec.baseKey,spec.fileName);
  const bytes=fs.readFileSync(source),sha=crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(doc.sha256,sha,'来源原件变化，须另行复核');assert.equal(sha,record.sha256);
  assert.ok(doc.tags.includes(spec.kind==='public'?'官方公开资料':'行业示例'));
  assert.ok(doc.summary.includes(spec.kind==='public'?'官方公开资料摘编':'行业示例'));
  assert.ok(detail.chunks.length>0);assert.equal(doc.embeddingStatus,'ready');
  if(spec.format==='csv'){
    const parsed=await parseDocument({filePath:source,fileName:spec.fileName});
    assert.ok(detail.chunks.every(c=>c.table?.schemaVersion===1));
    assert.deepEqual(detail.chunks.flatMap(c=>c.table.rows),parsed.pages[0].table.rows);
    assert.deepEqual(detail.chunks.flatMap(c=>c.table.rowNumbers),parsed.pages[0].table.rowNumbers);
    assert.ok(detail.chunks.every(c=>JSON.stringify(c.table.headers)===JSON.stringify(parsed.pages[0].table.headers)));
  }
  if(doc.status!=='published'){results.push({id:doc.id,title:doc.title,status:doc.status,reviewed:false,reason:'保持原审核或下架状态'});continue;}
  const saved=progress.documents[doc.id];
  if(saved&&doc.lastReviewReason===saved.reason&&doc.reviewDueAt===saved.reviewDueAt&&(!doc.expiresAt||Date.parse(doc.reviewDueAt)<Date.parse(doc.expiresAt))){results.push(saved);continue;}
  if(doc.reviewDueAt&&(!doc.expiresAt||Date.parse(doc.reviewDueAt)<Date.parse(doc.expiresAt))){results.push({id:doc.id,title:doc.title,status:doc.status,reviewed:false,reason:'已有复审计划，保持当前安排',reviewDueAt:doc.reviewDueAt});continue;}
  const expiresAt=doc.expiresAt||null;
  const planned=Date.now()+(spec.kind==='public'?30:90)*86400000;
  const nextReviewAt=new Date(expiresAt?Math.min(planned,Math.max(Date.now()+86400000,Date.parse(expiresAt)-7*86400000)):planned).toISOString();
  const reason=spec.kind==='public'?'工程复核：核对已导入官方摘编的受控来源文件、SHA-256、来源标记、原文链接及可检索状态；本次安排来源更新检查，不替代运营单位适用性审批。':'工程复核：核对受控合成示例原件、SHA-256、行业示例标记及可检索状态。仅用于平台演示，不构成真实运营记录或业务审批。';
  doc=(await api('/governance/actions',{documentId:doc.id,type:'no_review_date',action:'review',reason,revision:doc.revision,nextReviewAt})).document;
  assert.equal(doc.expiresAt||null,expiresAt,'复审不得修改有效期');assert.equal(doc.status,'published');assert.ok(doc.lastReviewedAt);
  const result={id:doc.id,title:doc.title,status:doc.status,reviewed:true,reason,reviewDueAt:doc.reviewDueAt,lastReviewedAt:doc.lastReviewedAt,expiresAt,validityUnchanged:true};
  progress.documents[doc.id]=result;writeJsonAtomic(progressPath,progress);results.push(result);
}
const governance=await api('/governance');
const output=path.join(root,'output','optimization','governance-review.json');fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify({verifiedAt:new Date().toISOString(),scope:'受控地铁示例语料工程复核；非业务审批',results,governance},null,2));
console.log(JSON.stringify({reviewed:results.filter(d=>d.reviewed).length,keptOriginalStatus:results.filter(d=>!d.reviewed).length,governance:governance.stats,noteDocuments:governance.notes.length}));
