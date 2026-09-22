import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseDocument,chunkPages,PARSER_LIMITS} from '../server/parser.mjs';
import {xlsxFixture} from './fixtures/parser-fixtures.mjs';

async function withSource(name,content,run){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xrag-table-'));
  try{const file=path.join(dir,name);await fs.writeFile(file,content);return await run(await parseDocument({filePath:file,fileName:name}));}
  finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(dir,{recursive:true,force:true});}
}

test('CSV chunks preserve every complete row, repeat headers and retain stable source record identity',async()=>{
  const rows=Array.from({length:24},(_,i)=>[`ITEM-${String(i+1).padStart(3,'0')}`,`站点${i%4+1}`,`完整记录${i+1}：${'资料核对'.repeat(26)}`]);
  const csv=['设备编号,所属站点,说明',...rows.map(row=>row.join(','))].join('\n');
  await withSource('台账.csv',csv,result=>{
    assert.equal(result.warnings.length,0);assert.ok(result.notes.length);
    const chunks=chunkPages(result.pages);assert.ok(chunks.length>2);
    assert.deepEqual(chunks.flatMap(c=>c.table.rows),rows);
    assert.deepEqual(chunks.flatMap(c=>c.table.rowNumbers),rows.map((_,i)=>i+2));
    let previous=0;
    for(const chunk of chunks){assert.deepEqual(chunk.table.headers,['设备编号','所属站点','说明']);assert.ok(chunk.text.includes('设备编号\t所属站点\t说明'));assert.equal(chunk.table.rowStart,previous+1);assert.equal(chunk.table.rowEnd,previous+chunk.table.rows.length);assert.equal(chunk.table.totalRows,24);assert.equal(chunk.table.complete,false);previous=chunk.table.rowEnd;}
    assert.equal(previous,24);
  });
});

test('quoted separators, multiline cells, blank records and duplicate headings retain their data',async()=>{
  const source='"项目,分类,补充,说明";名称;名称\r\n\r\n"甲;乙";"第一行\n第二行";"说""明"\r\n';
  await withSource('引用.csv',source,result=>{
    const table=chunkPages(result.pages)[0].table;
    assert.deepEqual(table.headers,['项目,分类,补充,说明','名称（列2）','名称（列3）']);
    assert.deepEqual(table.rows,[['甲;乙','第一行 第二行','说"明']]);
    assert.deepEqual(table.rowNumbers,[3]);assert.equal(table.rowNumberKind,'record-number');
  });
});

test('numeric first rows remain data and long records are kept whole or rejected explicitly',async()=>{
  await withSource('no-header.csv','001,12\n002,30',result=>{const table=result.pages[0].table;assert.equal(table.headerSource,'generated');assert.equal(table.totalRows,2);assert.deepEqual(table.rows[0],['001','12']);});
  await withSource('long.csv','编号,正文\nA1,'+'长'.repeat(1800),result=>{const chunks=chunkPages(result.pages);assert.equal(chunks.length,1);assert.equal(chunks[0].table.rows[0][1].length,1800);assert.ok(chunks[0].text.length>PARSER_LIMITS.chunkChars);});
  await assert.rejects(withSource('too-long.csv','编号,正文\nA1,'+'长'.repeat(PARSER_LIMITS.tableRowChars+1),result=>chunkPages(result.pages)),{code:'DOCUMENT_LIMIT'});
});

test('XLSX table evidence keeps sparse columns, distinct sheets and original worksheet row numbers',async()=>{
  await withSource('结构.xlsx',xlsxFixture(),result=>{
    const first=result.pages[0].table,second=result.pages[1].table;
    assert.deepEqual(first.headers,['供应商','列2','金额']);
    assert.deepEqual(first.rows[0],['测试公司','','12800.5']);
    assert.deepEqual(first.rowNumbers,[2,3,4]);assert.equal(first.tableId,'sheet:1');
    assert.equal(second.headerSource,'generated');assert.equal(second.tableId,'sheet:2');
    assert.deepEqual(second.rows,[['项目完成日期','2026-12-31']]);
    const chunks=chunkPages(result.pages);assert.ok(chunks.filter(c=>c.page===2).every(c=>c.table.tableId==='sheet:2'));
  });
});
