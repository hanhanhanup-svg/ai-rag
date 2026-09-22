import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import { parseDocument,chunkPages } from '../server/parser.mjs';
import { zipFixture,docxEntries,docxFixture,xlsxFixture,pdfFixture } from './fixtures/parser-fixtures.mjs';
async function work(run){const directory=await mkdtemp(path.join(os.tmpdir(),'xrag-parser-upgrade-'));try{await run(directory);}finally{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(directory,{recursive:true,force:true});}}
async function parse(directory,name,bytes){const filePath=path.join(directory,name);await writeFile(filePath,bytes);return parseDocument({filePath,fileName:name});}
test('native Office tables become whole-row evidence with source coordinates and preserve merged cells without invented values',async()=>work(async directory=>{
  const result=await parse(directory,'real.docx',docxFixture()),chunks=chunkPages(result.pages),table=chunks.find(c=>c.table);
  assert.ok(table);assert.deepEqual(table.table.headers,['项目','金额']);assert.deepEqual(table.table.rows,[['软件','100000']]);assert.equal(table.locator.pageKind,'logical');assert.deepEqual(table.locator.rowNumbers,[2]);assert.equal(table.evidenceType,'table');
  const entries=docxEntries('<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并标题</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>DEV-1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc></w:tr></w:tbl>');
  const merged=chunkPages((await parse(directory,'merged.docx',zipFixture(entries))).pages)[0];assert.equal(merged.table.merges[0].columnSpan,2);assert.equal(merged.table.rows[0][1],'');assert.equal(merged.table.reviewRequired,true);assert.equal(merged.quality.structure,'candidate');
}));
test('native chart evidence reads actual embedded category and value caches and retains package provenance',async()=>work(async directory=>{
  const entries=docxEntries('<w:p><w:r><w:drawing><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="chart1"/></w:drawing></w:r></w:p>');
  entries['word/_rels/document.xml.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="chart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/></Relationships>';
  entries['word/charts/chart1.xml']='<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:tx><c:v>维修次数</c:v></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>第一季度</c:v></c:pt><c:pt idx="1"><c:v>第二季度</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!B2:B3</c:f><c:numCache><c:pt idx="0"><c:v>7</c:v></c:pt><c:pt idx="1"><c:v>11</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>';
  const result=await parse(directory,'chart.docx',zipFixture(entries)),chart=chunkPages(result.pages).find(c=>c.evidenceType==='chart');assert.ok(chart);assert.match(chart.text,/第一季度\t7/);assert.match(chart.text,/第二季度\t11/);assert.equal(chart.structuredData.series[0].valueSource,'embedded-cache');assert.equal(chart.locator.packagePart,'word/charts/chart1.xml');assert.equal(chart.locator.placement,'package-part-only');assert.match(result.warnings.join(' '),/未重算公式/);
}));
test('XLSX exposes actual row/cell ranges and cached formula metadata without executing formulas',async()=>work(async directory=>{
  const result=await parse(directory,'sheet.xlsx',xlsxFixture()),chunks=chunkPages(result.pages);assert.ok(chunks[0].locator.sheet);assert.match(chunks[0].locator.cellRange,/^A\d+:[A-Z]+\d+$/);assert.ok(chunks[0].table.formulaCells.length);assert.ok(chunks[0].table.formulaCells.some(c=>c.cachedValue===null));assert.equal(chunks[0].table.reviewRequired,true);
}));
test('PDF paragraph evidence carries real numeric page coordinates with explicit coordinate system',async()=>work(async directory=>{
  const result=await parse(directory,'source.pdf',pdfFixture()),chunks=chunkPages(result.pages);
  assert.equal(result.pages.length,2);for(const chunk of chunks){assert.equal(chunk.locator.page,chunk.page);assert.equal(chunk.locator.coordinateSystem,'pdf-bottom-left');assert.equal(chunk.locator.bbox.length,4);assert.ok(chunk.locator.bbox.every(Number.isFinite));assert.equal(chunk.locator.granularity,'page-text-bounds');}
}));
test('ASR adapter contract preserves segment time ranges, rejects invalid times, and reports missing configuration truthfully',async()=>work(async directory=>{
  const saved={command:process.env.KNOWLEDGE_ASR_COMMAND,args:process.env.KNOWLEDGE_ASR_ARGS};try{
    delete process.env.KNOWLEDGE_ASR_COMMAND;delete process.env.KNOWLEDGE_ASR_ARGS;const bytes=Buffer.alloc(44);bytes.write('RIFF');bytes.write('WAVE',8);
    await assert.rejects(parse(directory,'protocol-only.wav',bytes),{code:'ASR_CONFIGURATION_REQUIRED'});
    const adapter=path.join(directory,'protocol-adapter.mjs');await writeFile(adapter,"process.stdout.write(JSON.stringify({parser:'test-protocol-only',durationMs:10000,coverage:'complete',segments:[{startMs:0,endMs:4000,text:'第一段测试文字'},{startMs:5000,endMs:9000,text:'设备编号 DEV-1，第二段文字'}]}));");
    process.env.KNOWLEDGE_ASR_COMMAND=process.execPath;process.env.KNOWLEDGE_ASR_ARGS=JSON.stringify([adapter]);
    const result=await parse(directory,'protocol-only.wav',bytes),chunks=chunkPages(result.pages);assert.equal(result.parser,'test-protocol-only');assert.equal(result.coverage,'complete');assert.equal(chunks.length,2);assert.equal(chunks[0].evidenceType,'transcript');assert.deepEqual(chunks.map(c=>[c.locator.startMs,c.locator.endMs]),[[0,4000],[5000,9000]]);
    await writeFile(adapter,"process.stdout.write(JSON.stringify({durationMs:1000,coverage:'complete',segments:[{startMs:500,endMs:200,text:'invalid'}]}));");await assert.rejects(parse(directory,'protocol-only.wav',bytes),{code:'ASR_INVALID_RESULT'});
  }finally{for(const [field,key] of [['command','KNOWLEDGE_ASR_COMMAND'],['args','KNOWLEDGE_ASR_ARGS']])if(saved[field]===undefined)delete process.env[key];else process.env[key]=saved[field];}
}));

test('real offline OCR reconstructs a clean scanned table with cell boxes and requires manual confirmation',async()=>{
  const saved=process.env.OCR_ENGINE;process.env.OCR_ENGINE='javascript';
  try{const result=await parseDocument({filePath:fileURLToPath(new URL('./fixtures/parser-samples/scanned-asset-table.png',import.meta.url)),fileName:'scanned-asset-table.png'}),chunks=chunkPages(result.pages),table=chunks.find(c=>c.table);assert.ok(table,'actual OCR must yield a candidate table');assert.deepEqual(table.table.headers,['ASSET','COUNT','STATUS']);assert.deepEqual(table.table.rows.map(r=>r[1]),['7','11','25']);assert.equal(table.table.totalRows,3);assert.equal(table.table.reviewRequired,true);assert.equal(table.reviewState,'unreviewed');assert.equal(table.locator.coordinateSystem,'image-top-left');assert.ok(table.table.cellBounds.length>=9);assert.ok(table.table.cellBounds.every(c=>c.bbox.length===4&&c.bbox.every(Number.isFinite)));assert.match(result.warnings.join(' '),/人工确认/);}finally{if(saved===undefined)delete process.env.OCR_ENGINE;else process.env.OCR_ENGINE=saved;}
});

test('layout adapter rejects false completeness and out-of-page coordinates and marks valid structure for review',async()=>work(async directory=>{
  const saved={enabled:process.env.KNOWLEDGE_LAYOUT_ENABLED,command:process.env.KNOWLEDGE_LAYOUT_COMMAND,args:process.env.KNOWLEDGE_LAYOUT_ARGS};
  const adapter=path.join(directory,'layout-protocol.mjs');
  try{
    process.env.KNOWLEDGE_LAYOUT_ENABLED='true';process.env.KNOWLEDGE_LAYOUT_COMMAND=process.execPath;process.env.KNOWLEDGE_LAYOUT_ARGS=JSON.stringify([adapter]);
    const block={type:'table',text:'ASSET COUNT\\nDEV-1 7',bbox:[10,10,200,150],table:{headers:['ASSET','COUNT'],rows:[['DEV-1','7']]}};
    const output={parser:'test-layout-protocol-only',totalPages:2,coverage:'complete',pages:[{page:1,width:500,height:500,blocks:[block]}]};
    const send=async()=>writeFile(adapter,'process.stdout.write('+JSON.stringify(JSON.stringify(output))+');');
    await send();await assert.rejects(parse(directory,'layout.pdf',pdfFixture()),{code:'LAYOUT_INVALID_RESULT'});
    output.coverage='partial';block.bbox=[10,10,800,150];await send();await assert.rejects(parse(directory,'layout.pdf',pdfFixture()),{code:'LAYOUT_INVALID_RESULT'});
    block.bbox=[10,10,200,150];await send();const result=await parse(directory,'layout.pdf',pdfFixture());assert.equal(result.coverage,'partial');const table=chunkPages(result.pages)[0];assert.equal(table.table.reviewRequired,true);assert.equal(table.table.totalRows,1);assert.equal(table.locator.pageWidth,500);assert.match(result.warnings.join(' '),/部分页面/);
  }finally{for(const [field,key]of[['enabled','KNOWLEDGE_LAYOUT_ENABLED'],['command','KNOWLEDGE_LAYOUT_COMMAND'],['args','KNOWLEDGE_LAYOUT_ARGS']])if(saved[field]===undefined)delete process.env[key];else process.env[key]=saved[field];}
}));

test('real local video frame extraction OCR labels sampled visual text separately from ASR protocol output',async()=>work(async directory=>{
  const keys=['KNOWLEDGE_ASR_COMMAND','KNOWLEDGE_ASR_ARGS','OCR_ENGINE'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    const adapter=path.join(directory,'video-asr-protocol.mjs');await writeFile(adapter,"process.stdout.write(JSON.stringify({parser:'test-asr-protocol-only',durationMs:2000,coverage:'complete',segments:[{startMs:0,endMs:1900,text:'协议夹具文字，不作为真实语音识别结果。'}]}));");process.env.KNOWLEDGE_ASR_COMMAND=process.execPath;process.env.KNOWLEDGE_ASR_ARGS=JSON.stringify([adapter]);process.env.OCR_ENGINE='javascript';
    const result=await parseDocument({filePath:fileURLToPath(new URL('./fixtures/parser-samples/scanned-table-video.mp4',import.meta.url)),fileName:'scanned-table-video.mp4'}),chunks=chunkPages(result.pages),frames=chunks.filter(c=>c.evidenceType==='frame_text');
    assert.equal(result.visualCoverage,'sampled');assert.equal(result.frameSampling.completeFrameCoverage,false);assert.equal(result.frameSampling.failedFrames,0);assert.ok(frames.length>=1);assert.ok(frames.every(c=>c.text.includes(']\n')&&!c.text.includes(']\\n')));assert.ok(frames.every(c=>c.locator.startMs>=0&&c.locator.endMs<=2000&&c.locator.precision==='approximate'));assert.match(frames.map(c=>c.text).join(' '),/ASSET/);assert.match(result.warnings.join(' '),/未分析每一帧/);assert.ok(chunks.some(c=>c.evidenceType==='transcript'));
  }finally{for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
}));
