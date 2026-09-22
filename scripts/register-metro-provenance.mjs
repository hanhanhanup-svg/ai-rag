import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {writeJsonAtomic} from './atomic-json.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),origin='http://localhost:8787';
const receipt=JSON.parse(fs.readFileSync(path.join(root,'.runtime','metro-seed-receipt.json'),'utf8'));
const specs=['public-documents.json','service-documents.json','asset-documents.json'].flatMap(name=>JSON.parse(fs.readFileSync(path.join(root,'scripts','metro-data',name),'utf8')));
async function api(route,body,method=body?'POST':'GET'){
  const response=await fetch(origin+'/api'+route,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();assert.ok(response.ok,`${route}: ${response.status} ${result.error?.message||''}`);return result;
}
const results=[];
for(const spec of specs){
  const id=receipt.documents[spec.key].id;let doc=(await api('/documents/'+id)).document;
  if(doc.status==='archived'){results.push({id,title:doc.title,status:doc.status,updated:false,reason:'保留已归档历史资料'});continue;}
  const bytes=fs.readFileSync(path.join(root,'knowledge-sources','metro-demo',spec.baseKey,spec.fileName));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),doc.sha256);
  assert.ok(doc.tags.includes(spec.kind==='public'?'官方公开资料':'行业示例'));
  const metadata={sourceKind:spec.kind==='public'?'official_public':'synthetic',businessOwner:'本地资料维护（待业务认领）',applicability:spec.kind==='public'?'官方公开规范摘编，用于来源检索与学习；具体适用性须结合正式原文和本单位受控文件核验。':'虚构“示例城轨”的合成资料，仅用于平台演示与流程讨论；不代表真实运营记录、内部正式规章或现场作业指令。'};
  const version=doc.version,expiresAt=doc.expiresAt||null,status=doc.status;
  if(Object.entries(metadata).some(([key,value])=>doc[key]!==value)){
    if(status==='published'){
      assert.ok(doc.reviewDueAt&&Date.parse(doc.reviewDueAt)>Date.now());
      doc=(await api('/governance/actions',{documentId:id,type:'no_review_date',action:'review',reason:'工程复核补全来源登记：已核对受控原件哈希及来源标签；责任登记为本地资料维护、待业务认领，不代表真实运营单位业务审批。',revision:doc.revision,nextReviewAt:doc.reviewDueAt,...metadata})).document;
    }else{
      assert.equal(status,'review');doc=(await api('/documents/'+id,{revision:doc.revision,...metadata},'PATCH')).document;
    }
  }
  for(const [key,value] of Object.entries(metadata))assert.equal(doc[key],value);
  assert.equal(doc.version,version);assert.equal(doc.status,status);assert.equal(doc.expiresAt||null,expiresAt);
  results.push({id,title:doc.title,status:doc.status,version:doc.version,...metadata,originalHashVerified:true});
}
writeJsonAtomic(path.join(root,'output','optimization','source-registration.json'),{verifiedAt:new Date().toISOString(),results});
console.log(JSON.stringify({registered:results.filter(r=>r.sourceKind).length,officialPublic:results.filter(r=>r.sourceKind==='official_public').length,synthetic:results.filter(r=>r.sourceKind==='synthetic').length,historicalArchived:results.filter(r=>r.status==='archived').length,newBodyVersions:0}));
