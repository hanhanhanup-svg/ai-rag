import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { adapterConfiguration } from './media-parser.mjs';
import { createTable } from './table-parser.mjs';
const execute=promisify(execFile);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code,status:422,statusCode:422});};
export function layoutEnabled(){return process.env.KNOWLEDGE_LAYOUT_ENABLED==='true';}
export async function parseLayout(filePath,fileName,limits){
  const configuration=adapterConfiguration('LAYOUT');if(!configuration.available)fail('LAYOUT_CONFIGURATION_REQUIRED','复杂版式已启用但适配器不可用；请设置 KNOWLEDGE_LAYOUT_COMMAND / KNOWLEDGE_LAYOUT_ARGS，或关闭 KNOWLEDGE_LAYOUT_ENABLED 使用原生解析。');
  let output;try{const result=await execute(configuration.command,[...configuration.args,'--input',filePath],{windowsHide:true,shell:false,timeout:configuration.timeoutMs,maxBuffer:32*1024*1024,encoding:'utf8'});output=JSON.parse(result.stdout.trim());}catch(error){fail(error.killed?'LAYOUT_TIMEOUT':'LAYOUT_FAILED',error.killed?'复杂版式解析超时，请拆分文件。':'本地复杂版式适配器失败或未返回约定JSON，请检查适配器和模型。');}
  if(!output||!Array.isArray(output.pages)||!output.pages.length||output.pages.length>limits.pages||!Number.isInteger(output.totalPages)||output.totalPages<output.pages.length||output.totalPages>limits.pages||!['complete','partial'].includes(output.coverage))fail('LAYOUT_INVALID_RESULT','版式输出缺少页数、覆盖状态或有效页面。');
  if(output.coverage==='complete'&&output.pages.length!==output.totalPages)fail('LAYOUT_INVALID_RESULT','实际页面未完整覆盖，不能标记完整解析。');
  let total=0,tableNumber=0;const seen=new Set(),warnings=['复杂版式结果由本地适配器提取；数字、单元格归属与图表单位需人工复核。'];
  if(output.coverage==='partial')warnings.push('仅完成部分页面的复杂版式解析，不可声称全文或全表完整覆盖。');
  const pages=output.pages.map(page=>{
    if(!Number.isInteger(page.page)||page.page<1||page.page>output.totalPages||seen.has(page.page)||!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<=0||page.height<=0||page.width*page.height>limits.imagePixels||!Array.isArray(page.blocks)||page.blocks.length>10000)fail('LAYOUT_INVALID_RESULT','版式页码、图像尺寸或证据块无效。');seen.add(page.page);
    const blocks=page.blocks.map((block,index)=>{
      if(!block||!['paragraph','table','chart'].includes(block.type)||typeof block.text!=='string'||!block.text.trim()||block.text.length>100000)fail('LAYOUT_INVALID_RESULT','版式证据类型或文本无效。');
      total+=block.text.length;if(total>limits.textChars)fail('DOCUMENT_LIMIT','复杂版式提取文本超过200万字符。');
      const bbox=block.bbox;if(!Array.isArray(bbox)||bbox.length!==4||!bbox.every(Number.isFinite)||bbox[0]<0||bbox[1]<0||bbox[2]<=bbox[0]||bbox[3]<=bbox[1]||bbox[2]>page.width||bbox[3]>page.height)fail('LAYOUT_INVALID_RESULT','版式定位框越界或无效。');
      const locator={page:page.page,pageKind:'physical',bbox,coordinateSystem:'image-top-left',unit:'px',pageWidth:page.width,pageHeight:page.height,block:index+1};
      const value={type:block.type,text:block.text.trim(),locator,quality:{text:'unreviewed',structure:block.type==='table'?'candidate':'unknown',numeric:'unreviewed',method:'layout-adapter'}};
      if(block.type==='table'){
        const data=block.table;if(!data||!Array.isArray(data.headers)||!data.headers.length||data.headers.length>limits.columns||!data.headers.every(c=>typeof c==='string'&&c.length<=1000)||!Array.isArray(data.rows)||data.rows.length>limits.rows||data.rows.some(row=>!Array.isArray(row)||row.length!==data.headers.length||row.some(c=>typeof c!=='string'||c.length>12000)))fail('LAYOUT_INVALID_RESULT','表格结构、字段或行记录无效。');
        if(JSON.stringify(data).length>limits.textChars)fail('DOCUMENT_LIMIT','单表结构超过文本限制。');
        const table=createTable([data.headers,...data.rows],{tableId:'layout:table:'+ ++tableNumber,name:'第'+page.page+'页表格'+tableNumber,format:'pdf'},limits);
        value.table={...table,headers:data.headers,rows:data.rows,rowNumbers:data.rows.map((_,i)=>i+2),totalRows:data.rows.length,headerRowNumber:1,headerSource:'adapter',reviewRequired:true,locator,extractionCoverage:output.coverage};
      }
      if(block.type==='chart'){value.structuredData={schemaVersion:1,valueSource:'unreviewed-visual',description:block.text.trim()};warnings.push('第'+page.page+'页图表仅保留识别说明；未经核实的视觉估值不进入精确统计。');}
      return value;
    });return {page:page.page,text:blocks.map(b=>b.text).join('\n'),blocks};
  }).sort((a,b)=>a.page-b.page);
  return {pages,parser:String(output.parser||'local-layout').slice(0,120),warnings:[...new Set(warnings)],notes:['定位框使用原始解析图像的像素坐标；需按页宽高缩放到预览。'],coverage:output.coverage,totalPages:output.totalPages};
}
