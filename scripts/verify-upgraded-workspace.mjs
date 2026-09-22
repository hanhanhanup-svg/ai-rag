import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {writeJsonAtomic} from './atomic-json.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),origin='http://localhost:8787';
async function get(route){const response=await fetch(origin+route);assert.equal(response.status,200,route);return response.json();}
const receipt=JSON.parse(fs.readFileSync(path.join(root,'.runtime','metro-seed-receipt.json'),'utf8'));
const migration=JSON.parse(fs.readFileSync(path.join(root,'.runtime','structured-table-upgrade.json'),'utf8'));
const listed=(await get('/api/documents?limit=500')).documents;
const current=[],statuses={};
for(const [key,record]of Object.entries(receipt.documents)){
  const doc=listed.find(d=>d.id===record.id);assert.ok(doc,key);assert.equal(doc.sha256,record.sha256);assert.equal(doc.status,record.status);assert.equal(doc.embeddingStatus,'ready');
  if(doc.status!=='archived'){assert.equal(doc.sourceKind,record.kind==='public'?'official_public':'synthetic');assert.ok(doc.applicability);assert.equal(doc.businessOwner,'本地资料维护（待业务认领）');}
  if(doc.status==='published'){assert.ok(doc.reviewDueAt);assert.ok(doc.lastReviewedAt);assert.ok(Date.parse(doc.reviewDueAt)>Date.now());}
  current.push({key,id:doc.id,version:doc.version,status:doc.status,chunkCount:doc.chunkCount,sha256:doc.sha256,sourceKind:doc.sourceKind,reviewDueAt:doc.reviewDueAt,expiresAt:doc.expiresAt,embeddingStatus:doc.embeddingStatus});statuses[doc.status]=(statuses[doc.status]||0)+1;
}
assert.equal(current.length,28);assert.deepEqual(statuses,{published:23,review:4,archived:1});
const tables=[];
for(const [key,record]of Object.entries(migration.documents)){
  const detail=await get('/api/documents/'+record.newId),old=listed.find(d=>d.id===record.oldId);
  assert.equal(old?.status,'superseded');assert.equal(old.sha256,record.sha256);
  assert.equal(detail.chunks.flatMap(c=>c.table.rows).length,record.rows);assert.ok(detail.chunks.every(c=>c.table.headers.length>0));
  tables.push({key,rows:record.rows,chunks:detail.chunks.length,version:detail.document.version,previousVersionRetained:true});
}
const governance=await get('/api/governance');assert.equal(governance.stats.total,5);assert.equal(governance.stats.pendingReview,4);assert.equal(governance.stats.expiring,1);assert.equal(governance.notes.length,27);
assert.ok(!governance.issues.some(i=>i.type==='parse_warning'||i.type==='no_review_date'));
const cases=await get('/api/evaluations');assert.equal(cases.cases.length,15);
const runs=cases.runs.filter(r=>r.status==='completed').sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
const latestRetrieval=runs.find(r=>r.mode==='retrieval'),latestAnswer=runs.find(r=>r.mode==='answer');
assert.equal(latestRetrieval.total,15);assert.equal(latestRetrieval.passed,15);assert.equal(latestAnswer.total,15);
const feedback=(await get('/api/feedback')).feedback;
assert.ok(feedback.some(f=>f.type==='evaluation'&&f.status==='in_progress'));
const ready=await get('/ready.json');assert.equal(ready.status,'ready');assert.equal(ready.queue.pending,0);
const user=(await get('/api/auth/me')).user;assert.equal(user.authMode,'local');
const report={verifiedAt:new Date().toISOString(),authMode:user.authMode,uniqueSourceDocuments:28,allVersionRecords:listed.length,currentStatuses:statuses,currentChunks:current.reduce((n,d)=>n+d.chunkCount,0),allVersionChunks:listed.reduce((n,d)=>n+d.chunkCount,0),documents:current,tables,totalTableRows:tables.reduce((n,d)=>n+d.rows,0),governance:{...governance.stats,informationalNoteDocuments:governance.notes.length},evaluation:{retrieval:{id:latestRetrieval.id,passed:latestRetrieval.passed,total:latestRetrieval.total},answer:{id:latestAnswer.id,passed:latestAnswer.passed,total:latestAnswer.total,failed:latestAnswer.results.filter(r=>!r.passed).map(r=>({question:r.question,mode:r.answerMode,warning:r.warning||null}))}},feedback:{total:feedback.length,unresolved:feedback.filter(f=>f.status!=='resolved').length},readiness:ready};
writeJsonAtomic(path.join(root,'output','optimization','workspace-verification.json'),report);
console.log(JSON.stringify({...report,documents:undefined,readiness:undefined},null,2));
