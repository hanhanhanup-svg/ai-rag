import { readFile, stat, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SaxesParser } from 'saxes';
import { createTable, chunkTable, tableNotes } from './table-parser.mjs';
import { createRequire } from 'node:module';
import { MEDIA_EXTENSIONS, parseMedia } from './media-parser.mjs';
import { layoutEnabled, parseLayout } from './layout-parser.mjs';
import { parseOcrTsv,ocrEvidence } from './ocr-layout.mjs';
import { tryQwenVisionOcr } from './qwen-vision.mjs';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
export const PARSER_LIMITS = Object.freeze({
  fileBytes: 100 * 1024 * 1024,
  expandedBytes: 400 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  zipEntries: 10_000,
  pages: 1000,
  textChars: 2_000_000,
  xmlNodes: 250_000,
  rows: 50_000,
  columns: 1000,
  ocrPages: 20,
  imagePixels: 20_000_000,
  tableRowChars: 12000,
  chunkChars: 1200,
  chunkOverlap: 120
});

export class DocumentParseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentParseError';
    this.code = code;
    this.status = 422;
    this.statusCode = 422;
  }
}

function fail(code, message) { throw new DocumentParseError(code, message); }
function limit(condition, message) { if (condition) fail('DOCUMENT_LIMIT', message); }
function clean(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000e-\u001f]/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function decode(buffer, warnings = [], xml = false) {
  let encoding = 'utf-8';
  let data = buffer;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) { encoding = 'utf-16le'; data = buffer.subarray(2); }
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) { encoding = 'utf-16be'; data = buffer.subarray(2); }
  else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) data = buffer.subarray(3);
  else if (xml && buffer[0] === 0x3c && buffer[1] === 0) encoding = 'utf-16le';
  else if (xml && buffer[0] === 0 && buffer[1] === 0x3c) encoding = 'utf-16be';
  try { return new TextDecoder(encoding, { fatal: true }).decode(data); }
  catch {
    if (xml || encoding !== 'utf-8') fail('CORRUPT_DOCUMENT', '文件文本编码损坏，请重新导出为 UTF-8 或标准 Office 文件。');
    try {
      const text = new TextDecoder('gb18030', { fatal: true }).decode(data);
      warnings.push('原文件不是 UTF-8，已按 GB18030 解码；请核对中文和特殊符号。');
      return text;
    } catch { fail('CORRUPT_DOCUMENT', '无法识别文本编码，请另存为 UTF-8 后重新上传。'); }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Read only selected package members in memory. Never extract archive paths to disk.
function readOfficeZip(buffer) {
  let end = -1;
  for (let p = buffer.length - 22; p >= Math.max(0, buffer.length - 65_557); p--) {
    if (buffer.readUInt32LE(p) === 0x06054b50 && p + 22 + buffer.readUInt16LE(p + 20) === buffer.length) { end = p; break; }
  }
  if (end < 0) fail('CORRUPT_DOCUMENT', 'Office 文件不是完整的 ZIP 容器，请重新保存后上传。');
  const count = buffer.readUInt16LE(end + 10);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count !== buffer.readUInt16LE(end + 8)) {
    fail('UNSUPPORTED_FORMAT', '不支持分卷压缩的 Office 文件。');
  }
  if (count === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) fail('DOCUMENT_LIMIT', '不支持 ZIP64 Office 文件，请拆分文档。');
  limit(count > PARSER_LIMITS.zipEntries, `Office 内部文件数超过 ${PARSER_LIMITS.zipEntries}，请拆分文件。`);
  if (directoryOffset + directorySize > end) fail('CORRUPT_DOCUMENT', 'Office 压缩目录损坏。');
  const entries = new Map();
  let offset = directoryOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) fail('CORRUPT_DOCUMENT', 'Office 内部目录不完整。');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressed = buffer.readUInt32LE(offset + 20);
    const expanded = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > directoryOffset + directorySize) fail('CORRUPT_DOCUMENT', 'Office 内部目录长度异常。');
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes);
    const mode = buffer.readUInt32LE(offset + 38) >>> 16;
    if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(p => p === '..' || p === '.') || (mode & 0xf000) === 0xa000) {
      fail('UNSAFE_ARCHIVE', 'Office 包含不安全路径或符号链接，已拒绝解析。请用办公软件重新保存。');
    }
    if (entries.has(name)) fail('CORRUPT_DOCUMENT', 'Office 内部存在重复文件名，无法安全确定内容。');
    if (flags & 1) fail('ENCRYPTED_DOCUMENT', '文件已加密，请先解除密码保护再上传。');
    if (![0, 8].includes(method)) fail('UNSUPPORTED_FORMAT', 'Office 使用了不支持的压缩方式，请重新保存为标准格式。');
    total += expanded;
    limit(expanded > PARSER_LIMITS.entryBytes || total > PARSER_LIMITS.expandedBytes, 'Office 解压大小超过限制（单项 32MB、总计 100MB），请拆分文档。');
    limit(expanded > 1024 * 1024 && expanded / Math.max(1, compressed) > 200, 'Office 压缩比例异常，可能包含压缩炸弹；请重新保存或拆分文档。');
    if (localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) fail('CORRUPT_DOCUMENT', 'Office 内部文件头损坏。');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressed > directoryOffset || !buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes) || buffer.readUInt16LE(localOffset + 8) !== method || (buffer.readUInt16LE(localOffset + 6) & 1)) {
      fail('CORRUPT_DOCUMENT', 'Office 内部文件与目录不一致。');
    }
    entries.set(name, { method, crc, expanded, compressed, dataOffset });
    offset = next;
  }
  if (offset !== directoryOffset + directorySize) fail('CORRUPT_DOCUMENT', 'Office 压缩目录校验失败。');
  let actualExpanded = 0;
  const cache = new Map();
  return {
    has: name => entries.has(name),
    names: () => [...entries.keys()],
    read(name, optional = false) {
      if (cache.has(name)) return cache.get(name);
      const entry = entries.get(name);
      if (!entry) {
        if (optional) return null;
        fail('CORRUPT_DOCUMENT', `Office 缺少必要部件：${name}。`);
      }
      const compressed = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressed);
      let data;
      try { data = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, Math.min(entry.expanded + 1, PARSER_LIMITS.entryBytes)) }); }
      catch { fail('CORRUPT_DOCUMENT', `Office 部件解压失败或超过声明大小：${name}。`); }
      if (data.length !== entry.expanded || crc32(data) !== entry.crc) fail('CORRUPT_DOCUMENT', `Office 部件大小或校验码错误：${name}。`);
      actualExpanded += data.length;
      limit(actualExpanded > PARSER_LIMITS.expandedBytes, 'Office 实际解压内容超过 100MB。');
      cache.set(name, data);
      return data;
    }
  };
}

function xmlTree(buffer) {
  const source = decode(buffer, [], true);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail('UNSAFE_DOCUMENT', 'Office XML 含有 DTD 或自定义实体，已拒绝解析。');
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let nodes = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('opentag', tag => {
    limit(++nodes > PARSER_LIMITS.xmlNodes || stack.length > 100, 'Office XML 结构过大或嵌套过深，请拆分文档。');
    const attrs = {};
    for (const attr of Object.values(tag.attributes)) { attrs[attr.name] = attr.value; attrs[attr.local] = attr.value; }
    const node = { name: tag.local, uri: tag.uri, attrs, children: [], text: '' };
    stack.at(-1).children.push(node);
    stack.push(node);
  });
  parser.on('text', text => { stack.at(-1).text += text; });
  parser.on('cdata', text => { stack.at(-1).text += text; });
  parser.on('closetag', () => { stack.pop(); });
  parser.on('error', () => { fail('CORRUPT_DOCUMENT', 'Office XML 格式损坏，请在办公软件中修复后重新保存。'); });
  try { parser.write(source).close(); }
  catch (error) { if (error instanceof DocumentParseError) throw error; fail('CORRUPT_DOCUMENT', 'Office XML 解析失败。'); }
  return root;
}
function descendants(node, name, out = []) {
  for (const child of node.children) { if (child.name === name) out.push(child); descendants(child, name, out); }
  return out;
}
function first(node, name) { return descendants(node, name)[0]; }
function allText(node) { return node.text + node.children.map(allText).join(''); }
function rels(zip, name) {
  const data = zip.read(name, true);
  const result = new Map();
  if (data) for (const item of descendants(xmlTree(data), 'Relationship')) result.set(item.attrs.Id, item.attrs);
  return result;
}
function packageTarget(base, relationship) {
  if (!relationship || relationship.TargetMode === 'External') fail('UNSUPPORTED_FORMAT', '文档主体引用了外部内容，无法安全读取；请先嵌入内容。');
  const target = relationship.Target;
  if (!target || target.includes('\\') || /^[a-z]+:/i.test(target)) fail('UNSAFE_DOCUMENT', 'Office 内部引用路径不安全。');
  const resolved = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(base, target));
  if (resolved.startsWith('../') || resolved === '..') fail('UNSAFE_DOCUMENT', 'Office 内部引用超出文档范围。');
  return resolved;
}

function wordParagraph(node) {
  const visit = item => {
    if (item.name === 'del' || item.name === 'instrText') return '';
    if (item.name === 't') return item.text;
    if (item.name === 'tab') return '\t';
    if (item.name === 'br') return item.attrs.type === 'page' ? '\f' : '\n';
    if (item.name === 'cr') return '\n';
    return item.children.map(visit).join('');
  };
  let text = visit(node);
  const style = first(node, 'pStyle')?.attrs.val ?? '';
  const heading = /^(?:heading|标题)\s*([1-6])/i.exec(style);
  if (heading) text = `${'#'.repeat(Number(heading[1]))} ${text}`;
  else if (first(node, 'numPr')) text = `• ${text}`;
  if (first(node, 'pageBreakBefore')) text = `\f${text}`;
  return text;
}

function officeTable(node, format, tableId, name) {
  const records=[],merges=[];
  for(const [rowIndex,row] of node.children.filter(n=>n.name==='tr').entries()){
    const cells=[];let column=0;
    for(const cell of row.children.filter(n=>n.name==='tc')){
      const span=Math.max(1,Number(first(cell,'gridSpan')?.attrs.val||cell.attrs.gridSpan||1));
      limit(span>PARSER_LIMITS.columns,'表格合并列数超过限制。');
      const vertical=first(cell,'vMerge');
      cells.push(descendants(cell,'p').map(format==='docx'?wordParagraph:drawingParagraph).join(' / ').replace(/[\t\f\n]+/g,' '));
      for(let n=1;n<span;n++)cells.push('');
      if(span>1||vertical||cell.attrs.rowSpan)merges.push({row:rowIndex+1,column:column+1,columnSpan:span,rowSpan:Number(cell.attrs.rowSpan)||1,vertical:vertical?vertical.attrs.val||'continue':undefined});
      column+=span;
    }
    records.push(cells);
  }
  const table=createTable(records,{tableId,name,format},PARSER_LIMITS);
  return {...table,merges,reviewRequired:merges.length>0};
}
function officeChartBlocks(zip,part,tree,warnings){
  const relationshipPath=path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels');
  const relationships=rels(zip,relationshipPath),blocks=[];
  for(const [index,chart] of descendants(tree,'chart').filter(c=>c.attrs['r:id']||c.attrs.id).entries()){
    const relation=relationships.get(chart.attrs['r:id']||chart.attrs.id);
    if(!relation||relation.TargetMode==='External'){warnings.push('图表依赖外部内容，未连接或计算外部数据；请嵌入数据后重试。');continue;}
    const chartPath=packageTarget(path.posix.dirname(part),relation),chartTree=xmlTree(zip.read(chartPath));
    const title=descendants(first(chartTree,'title')||{children:[]},'t').map(t=>t.text).join('')||'图表'+(index+1);
    const series=descendants(chartTree,'ser').map((ser,n)=>{
      const category=first(ser,'cat')||first(ser,'xVal'),values=first(ser,'val')||first(ser,'yVal');
      const points=node=>node?descendants(node,'pt').map(p=>({index:Number(p.attrs.idx),value:first(p,'v')?.text??''})).filter(p=>Number.isInteger(p.index)&&p.index>=0).sort((a,b)=>a.index-b.index):[];
      return {name:first(first(ser,'tx')||{children:[]},'v')?.text||'序列'+(n+1),categories:points(category),values:points(values),valueSource:'embedded-cache'};
    });
    if(!series.some(s=>s.values.length)){warnings.push('图表“'+title+'”没有内嵌数值缓存，不能读取精确数值；请保存数据后重试。');continue;}
    const text=title+'\n'+series.map(s=>s.name+'\n'+s.values.map(p=>(s.categories.find(c=>c.index===p.index)?.value||'位置'+(p.index+1))+'\t'+p.value).join('\n')).join('\n');
    blocks.push({type:'chart',text,structuredData:{schemaVersion:1,title,series,valueSource:'embedded-cache'},locator:{packagePart:chartPath},quality:{text:'native',numeric:'unreviewed',method:'ooxml-chart-cache'}});
    warnings.push('图表“'+title+'”读取文件内缓存数值，未重算公式；单位、轴尺度和数据时效需人工核对。');
  }
  return blocks;
}
function parseDocx(zip) {
  const root=xmlTree(zip.read('word/document.xml')),body=first(root,'body');
  if(!body)fail('CORRUPT_DOCUMENT','DOCX 缺少正文。');
  const warnings=[],pages=[{page:1,text:'',blocks:[]}];let tableNumber=0;
  function addText(text){
    const parts=text.split('\f');for(let i=0;i<parts.length;i++){if(i)pages.push({page:pages.length+1,text:'',blocks:[]});if(parts[i].trim())pages.at(-1).blocks.push({type:'paragraph',text:parts[i],locator:{page:pages.length,pageKind:'logical'},quality:{text:'native',method:'docx-ooxml'}});}
  }
  function walk(node){for(const child of node.children){if(child.name==='p')addText(wordParagraph(child));else if(child.name==='tbl'){const table=officeTable(child,'docx','docx:table:'+ ++tableNumber,'表格'+tableNumber);pages.at(-1).blocks.push({type:'table',text:table.headers.join('\t')+'\n'+table.rows.map(r=>r.join('\t')).join('\n'),table,locator:{page:pages.length,pageKind:'logical'}});if(table.merges.length)warnings.push('表格'+tableNumber+'含合并单元格，已保留合并位置，覆盖区域不填充推测值；请核对。');}else if(!['sectPr','del'].includes(child.name))walk(child);}}
  walk(body);
  // The package gives a reliable part, but a floating chart has no stable print page.
  const charts=officeChartBlocks(zip,'word/document.xml',root,warnings);
  for(const chart of charts)pages[0].blocks.push({...chart,locator:{...chart.locator,page:1,pageKind:'logical',placement:'package-part-only'}});
  for(const page of pages)page.text=clean(page.blocks.map(b=>b.text).join('\n'));
  return {pages,parser:'docx-ooxml-v2',warnings,notes:['DOCX 页码为显式分页形成的逻辑页，不等同于 Word 排版页码；浮动对象以包内位置定位。']};
}

function columnIndex(ref) {
  const letters = /^([A-Z]+)/i.exec(ref)?.[1];
  if (!letters) return -1;
  let index = 0;
  for (const c of letters.toUpperCase()) index = index * 26 + c.charCodeAt(0) - 64;
  return index - 1;
}
function excelDate(value, date1904, timeOnly = false) {
  const days = Number(value);
  if (!Number.isFinite(days)) return value;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 60 ? 31 : 30);
  const date = new Date(epoch + Math.round(days * 86400000));
  if (!Number.isFinite(date.getTime())) return value;
  const iso = date.toISOString();
  if (timeOnly) return iso.slice(11, 19);
  return Number.isInteger(days) ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}
function spreadsheetStyles(zip) {
  const data = zip.read('xl/styles.xml', true);
  if (!data) return [];
  const root = xmlTree(data);
  const formats = new Map(descendants(root, 'numFmt').map(item => [Number(item.attrs.numFmtId), item.attrs.formatCode]));
  const xfs = first(root, 'cellXfs');
  return (xfs?.children ?? []).filter(item => item.name === 'xf').map(item => {
    const id = Number(item.attrs.numFmtId);
    const format = (formats.get(id) ?? '').replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
    return { date: (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || /[ydhs]|m{2,}/i.test(format), timeOnly: [18, 19, 20, 21, 45, 46, 47].includes(id) || (!!format && /[hs]/i.test(format) && !/[yd]/i.test(format)) };
  });
}

function parseXlsx(zip) {
  const workbook = xmlTree(zip.read('xl/workbook.xml'));
  const relationships = rels(zip, 'xl/_rels/workbook.xml.rels');
  const sharedData = zip.read('xl/sharedStrings.xml', true);
  const shared = sharedData ? descendants(xmlTree(sharedData), 'si').map(item => descendants(item, 't').map(t => t.text).join('')) : [];
  const styles = spreadsheetStyles(zip);
  const date1904 = ['1', 'true'].includes(first(workbook, 'workbookPr')?.attrs.date1904);
  const warnings = ['XLSX 页码表示工作表序号；保留单元格顺序和空列，不代表打印页码。公式只读取文件内已保存的计算结果，不执行公式或外部链接。'];
  const pages = [];
  let formulaWithoutValue = 0;
  let hiddenSheets = 0;
  for (const sheet of descendants(workbook, 'sheet')) {
    limit(pages.length >= PARSER_LIMITS.pages, 'Excel 工作表超过 1000 个，请拆分文件。');
    if (sheet.attrs.state && sheet.attrs.state !== 'visible') hiddenSheets++;
    const name = packageTarget('xl', relationships.get(sheet.attrs['r:id'] ?? sheet.attrs.id));
    const root = xmlTree(zip.read(name));
    const lines = [`# 工作表：${sheet.attrs.name}`];
    const records = [], sourceRows = [], formulaCells = [];
    const rows = descendants(root, 'row');
    limit(rows.length > PARSER_LIMITS.rows, '单个工作表超过 50000 行，请按业务范围拆分。');
    for (const row of rows) {
      const values = [];
      let lastColumn = -1;
      for (const cell of row.children.filter(item => item.name === 'c')) {
        const index = cell.attrs.r ? columnIndex(cell.attrs.r) : lastColumn + 1;
        if (index < 0) fail('CORRUPT_DOCUMENT', 'Excel 单元格位置无效。');
        limit(index >= PARSER_LIMITS.columns, 'Excel 内容超过 1000 列，请拆分工作表。');
        let value = first(cell, 'v')?.text ?? '';
        if (cell.attrs.t === 's') {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 0 || n >= shared.length) fail('CORRUPT_DOCUMENT', 'Excel 共享字符串索引无效。');
          value = shared[n];
        } else if (cell.attrs.t === 'inlineStr') value = descendants(cell, 't').map(t => t.text).join('');
        else if (cell.attrs.t === 'b') value = value === '1' ? 'TRUE' : 'FALSE';
        else if (!cell.attrs.t || cell.attrs.t === 'n') {
          const style = styles[Number(cell.attrs.s ?? 0)];
          if (value && style?.date) value = excelDate(value, date1904, style.timeOnly);
        }
        if(first(cell,'f'))formulaCells.push({cell:cell.attrs.r||null,formula:allText(first(cell,'f')).slice(0,2000),cachedValue:first(cell,'v')?.text??null});
        if (first(cell, 'f') && !first(cell, 'v')) { value = '[公式结果未缓存]'; formulaWithoutValue++; }
        values[index] = value.replace(/[\t\r\n]+/g, ' ');
        lastColumn = index;
      }
      if (values.some(Boolean)) { lines.push(values.join('\t')); records.push(values); sourceRows.push(Number(row.attrs.r)||rows.indexOf(row)+1); }
    }
    const merges = descendants(root, 'mergeCell').map(item => item.attrs.ref);
    if (merges.length) { lines.push(`[合并单元格：${merges.join('、')}]`); warnings.push(`工作表“${sheet.attrs.name}”存在合并单元格，未推断覆盖区域的值；请核对表头和字段归属。`); }
    const table=createTable(records,{tableId:`sheet:${pages.length+1}`,name:sheet.attrs.name,format:'xlsx',rowNumbers:sourceRows},PARSER_LIMITS);
    table.merges=merges;table.formulaCells=formulaCells;table.reviewRequired=merges.length>0||formulaCells.some(c=>c.cachedValue===null);
    const chartBlocks=[];const sheetRelationships=rels(zip,path.posix.join(path.posix.dirname(name),'_rels',path.posix.basename(name)+'.rels'));for(const drawing of descendants(root,'drawing')){const drawingPart=packageTarget(path.posix.dirname(name),sheetRelationships.get(drawing.attrs['r:id']||drawing.attrs.id));chartBlocks.push(...officeChartBlocks(zip,drawingPart,xmlTree(zip.read(drawingPart)),warnings).map(b=>({...b,locator:{...b.locator,page:pages.length+1,pageKind:'worksheet',sheet:sheet.attrs.name}})));}
    pages.push({ page: pages.length + 1, heading: sheet.attrs.name, text: clean(lines.join('\n')+'\n'+chartBlocks.map(b=>b.text).join('\n')), table, ...(chartBlocks.length?{blocks:chartBlocks}:{}), hasContent: lines.length > 1||chartBlocks.length>0 });
  }
  if (!pages.some(page => page.hasContent)) fail('EMPTY_DOCUMENT', 'Excel 中没有可提取的单元格内容。');
  if (formulaWithoutValue) warnings.push(`${formulaWithoutValue} 个公式没有缓存结果，已标记；请用 Excel 重新计算并保存后上传。`);
  if (hiddenSheets) warnings.push(`已读取 ${hiddenSheets} 个隐藏工作表，请审核其内容是否允许发布。`);
  return { pages: pages.map(({ hasContent, ...page }) => page), parser: 'xlsx-ooxml', warnings };
}

function drawingParagraph(node) {
  return node.children.map(child => child.name === 'br' ? '\n' : child.name === 'tab' ? '\t' : descendants(child, 't').map(t => t.text).join('')).join('');
}
function parsePptx(zip) {
  const presentation=xmlTree(zip.read('ppt/presentation.xml')),relationships=rels(zip,'ppt/_rels/presentation.xml.rels');
  const pages=[],warnings=[];
  for(const slide of descendants(presentation,'sldId')){
    limit(pages.length>=PARSER_LIMITS.pages,'PPTX 超过1000页，请拆分文件。');
    const part=packageTarget('ppt',relationships.get(slide.attrs['r:id']??slide.attrs.id)),tree=xmlTree(zip.read(part)),blocks=[];let heading,tableNumber=0;
    function walk(node){for(const child of node.children){
      if(child.name==='sp'){const paragraphs=descendants(child,'p').map(drawingParagraph).filter(t=>t.trim()),kind=first(child,'ph')?.attrs.type;if(['title','ctrTitle'].includes(kind)&&paragraphs.length)heading=paragraphs[0];if(paragraphs.length)blocks.push({type:'paragraph',text:paragraphs.join('\n'),locator:{page:pages.length+1,pageKind:'slide'},quality:{text:'native',method:'pptx-ooxml'}});}
      else if(child.name==='tbl'){const table=officeTable(child,'pptx','slide:'+(pages.length+1)+':table:'+ ++tableNumber,'幻灯片'+(pages.length+1)+'表格'+tableNumber);blocks.push({type:'table',table,text:table.headers.join('\t')+'\n'+table.rows.map(r=>r.join('\t')).join('\n')});if(table.merges.length)warnings.push('幻灯片'+(pages.length+1)+'表格包含合并单元格，需核对字段归属。');}
      else walk(child);
    }}
    walk(tree);blocks.push(...officeChartBlocks(zip,part,tree,warnings).map(b=>({...b,locator:{...b.locator,page:pages.length+1,pageKind:'slide'}})));
    const text=clean(blocks.map(b=>b.text).join('\n'));if(!text)warnings.push('第'+(pages.length+1)+'张幻灯片无可提取文本；图片内容需另行OCR。');
    pages.push({page:pages.length+1,text,blocks,...(heading?{heading}:{})});
  }
  return {pages,parser:'pptx-ooxml-v2',warnings,notes:['PPTX页码为幻灯片序号；图片内文字需另行OCR。']};
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®' };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
  });
}
function htmlText(source) {
  return clean(decodeEntities(source.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<h([1-6])\b[^>]*>/gi, (_, n) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<\/(?:h[1-6]|p|div|section|article|header|footer|tr|li|ul|ol|table)>/gi, '\n')
    .replace(/<br\b[^>]*>/gi, '\n').replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:td|th)>/gi, '\t').replace(/<[^>]*>/g, '')));
}
function csvText(source, ext) {
  const delimiters = ext === '.tsv' ? ['\t'] : [',', ';', '\t'];
  const counts=new Map(delimiters.map(value=>[value,0]));let inQuotes=false;
  for(let i=0;i<source.length;i++){const c=source[i];if(c==='\"'){if(inQuotes&&source[i+1]==='\"'){i++;continue;}inQuotes=!inQuotes;}else if(!inQuotes){if(c==='\n'||c==='\r')break;if(counts.has(c))counts.set(c,counts.get(c)+1);}}
  const delimiter = [...delimiters].sort((a,b)=>counts.get(b)-counts.get(a))[0];
  const rows = [], rowNumbers=[];let recordNumber=0;
  let row = [], cell = '', quoted = false, afterQuote = false;
  function pushCell() { row.push(cell); cell = ''; afterQuote = false; limit(row.length > PARSER_LIMITS.columns, '表格文本超过 1000 列。'); }
  function pushRow() { pushCell(); recordNumber++; if(row.some(value=>value.trim())){rows.push(row);rowNumbers.push(recordNumber);} row = []; limit(rows.length > PARSER_LIMITS.rows, '表格文本超过 50000 行。'); }
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else cell += c === '\n' || c === '\r' || c === '\t' ? ' ' : c;
    } else if (c === delimiter) pushCell();
    else if (c === '\r' || c === '\n') { if (c === '\r' && source[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"' && cell === '' && !afterQuote) quoted = true;
    else if (afterQuote && !/\s/.test(c)) fail('CORRUPT_DOCUMENT', 'CSV 引号后存在无效内容，请重新导出。');
    else if (!afterQuote) cell += c;
  }
  if (quoted) fail('CORRUPT_DOCUMENT', 'CSV 包含未闭合的引号，请重新导出。');
  if (cell || row.length || afterQuote) pushRow();
  return {text:clean(rows.map(row=>row.join('\t')).join('\n')),rows,rowNumbers};
}

async function findExecutable(candidates, args = ['--version']) {
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try { await execFileAsync(candidate, args, { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }); return candidate; }
    catch { /* Try the next explicitly configured or standard installation. */ }
  }
  return null;
}
async function withTimeout(promise, milliseconds, timeoutMessage, onTimeout = () => {}) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { onTimeout(); reject(new DocumentParseError('DOCUMENT_LIMIT', timeoutMessage)); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function closeOcr(tools) {
  if (!tools) return;
  if (tools.worker) await tools.worker.terminate().catch(() => {});
  if (tools.languageDirectory) await rm(tools.languageDirectory, { recursive: true, force: true }).catch(() => {});
}
async function javascriptOcr(pdftoppm) {
  let languageDirectory = null, worker = null;
  try {
    const { createWorker } = await import('tesseract.js');
    languageDirectory = await mkdtemp(path.join(tmpdir(), 'x-rag-ocr-langs-'));
    let gzip = true;
    for (const language of ['chi_sim', 'eng']) {
      const info = require('@tesseract.js-data/' + language);
      const zipped = path.join(info.langPath, language + '.traineddata.gz');
      const plain = path.join(info.langPath, language + '.traineddata');
      if (await stat(zipped).then(() => true).catch(() => false)) await copyFile(zipped, path.join(languageDirectory, language + '.traineddata.gz'));
      else { gzip = false; await copyFile(plain, path.join(languageDirectory, language + '.traineddata')); }
    }
    let expired = false;
    const creating = createWorker(['chi_sim', 'eng'], 1, { langPath: languageDirectory, gzip, cacheMethod: 'none', logger: () => {}, errorHandler: () => {} });
    creating.then(lateWorker => { if (expired) lateWorker.terminate().catch(() => {}); }).catch(() => {});
    worker = await withTimeout(creating, 90_000, 'OCR 初始化超过 90 秒，请检查服务器资源后重试。', () => { expired = true; });
    return { kind: 'javascript', worker, pdftoppm, languageDirectory, language: 'chi_sim+eng', warnings: [] };
  } catch (error) {
    await closeOcr({ worker, languageDirectory });
    if (error instanceof DocumentParseError) throw error;
    fail('OCR_UNAVAILABLE', '离线 OCR 组件或中英文语言包不可用。请安装 tesseract.js、@tesseract.js-data/chi_sim、@tesseract.js-data/eng，或配置 TESSERACT_PATH 指向原生 Tesseract。');
  }
}
async function ocrTools(needsPdf = false) {
  const pdftoppm = needsPdf && process.env.PDF_RENDERER !== 'canvas' ? await findExecutable([process.env.PDFTOPPM_PATH, 'pdftoppm'], ['-v']) : null;
  const tesseract = process.env.OCR_ENGINE === 'javascript' ? null : await findExecutable([
    process.env.TESSERACT_PATH, process.env.OCR_TESSERACT_PATH, 'tesseract',
    process.platform === 'win32' ? 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe' : null
  ]);
  if (tesseract) {
    try {
      const result = await execFileAsync(tesseract, ['--list-langs'], { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 });
      const languages = result.stdout + '\n' + result.stderr;
      if (/^chi_sim\s*$/m.test(languages) && /^eng\s*$/m.test(languages)) return { kind: 'native', tesseract, pdftoppm, language: 'chi_sim+eng', warnings: [] };
    } catch { /* Fall back to the shipped offline OCR engine and language data. */ }
  }
  return javascriptOcr(pdftoppm);
}
function cleanOcr(text) { return clean(text).replace(/(?<=[\u3400-\u9fff]) (?=[\u3400-\u9fff])/g, ''); }
async function recognizeImageData(filePath, tools, store) {
  const qwen = await tryQwenVisionOcr(filePath, store, { feature: 'parse_vision' });
  if (qwen && typeof qwen.text === 'string' && qwen.text.trim()) {
    return { text: cleanOcr(qwen.text), words: [], lines: [], method: 'qwen-vl', model: qwen.model };
  }
  try {
    if(tools.kind==='javascript'){
      const result=await withTimeout(tools.worker.recognize(filePath,{}, {text:true,tsv:true}),90000,'OCR识别超过90秒，请缩小图片或拆分文件。',()=>{tools.worker.terminate().catch(()=>{});});
      limit((result.data.text?.length??0)>PARSER_LIMITS.textChars,'OCR输出超过200万字符，请拆分文件。');
      return {text:cleanOcr(result.data.text??''),...parseOcrTsv(result.data.tsv),method:'tesseract-js'};
    }
    const result=await execFileAsync(tools.tesseract,[filePath,'stdout','-l',tools.language,'--dpi','150','tsv'],{timeout:90000,windowsHide:true,maxBuffer:16*1024*1024});
    const data=parseOcrTsv(result.stdout),lines=[];let previous;
    for(const word of data.words){if(previous!==word.lineKey){lines.push([]);previous=word.lineKey;}lines.at(-1).push(word.text);}
    return {...data,text:cleanOcr(lines.map(line=>line.join(' ')).join('\n')),method:'tesseract'};
  }catch(error){if(error instanceof DocumentParseError)throw error;if(error.killed||error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')fail('DOCUMENT_LIMIT','OCR超时或输出超限，请拆分文件。');fail('OCR_FAILED','OCR无法读取图片，请检查文件和本地语言包。');}
}
async function recognizeImage(filePath,tools,store){return (await recognizeImageData(filePath,tools,store)).text;}
async function renderPdfOcrPage(page, filePath, pageNumber, prefix, tools) {
  if (tools.pdftoppm) {
    try {
      await execFileAsync(tools.pdftoppm, ['-f', String(pageNumber), '-l', String(pageNumber), '-singlefile', '-scale-to', '2400', '-png', filePath, prefix], { timeout: 90_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      return prefix + '.png';
    } catch { fail('OCR_FAILED', '扫描 PDF 转图片失败或超时，请检查文件或拆分。'); }
  }
  try {
    const { createCanvas } = await import('@napi-rs/canvas');
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, 2400 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    limit(!Number.isFinite(viewport.width * viewport.height) || viewport.width * viewport.height > PARSER_LIMITS.imagePixels, 'PDF 页面尺寸超过 OCR 限制，请重新导出。');
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const rendering = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    await withTimeout(rendering.promise, 90_000, 'PDF 页面渲染超时，请拆分文件。', () => rendering.cancel());
    const { writeFile } = await import('node:fs/promises');
    await writeFile(prefix + '.png', await canvas.encode('png'));
    return prefix + '.png';
  } catch (error) {
    if (error instanceof DocumentParseError) throw error;
    fail('OCR_UNAVAILABLE', '扫描 PDF 页面渲染不可用，请安装 Poppler 并配置 PDFTOPPM_PATH，或安装 @napi-rs/canvas。');
  }
}

function pdfPageText(items) {
  const lines = [];
  let line = '', previous = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5] ?? 0;
    const x = item.transform?.[4] ?? 0;
    const font = Math.max(1, Math.abs(item.transform?.[3] ?? item.height ?? 10));
    if (previous && Math.abs(y - previous.y) > Math.max(2, font * 0.4)) { if (line.trim()) lines.push(line.trim()); line = ''; previous = null; }
    if (previous && line && item.str) {
      const gap = x - previous.end;
      if (gap > font * 1.8) line += '\t';
      else if (gap > font * 0.15 && /[\p{L}\p{N}]$/u.test(line) && /^[\p{L}\p{N}]/u.test(item.str) && !/[\u3400-\u9fff]$/.test(line) && !/^[\u3400-\u9fff]/.test(item.str)) line += ' ';
    }
    line += item.str;
    previous = { y, end: x + (item.width ?? 0) };
    if (item.hasEOL) { if (line.trim()) lines.push(line.trim()); line = ''; previous = null; }
  }
  if (line.trim()) lines.push(line.trim());
  return clean(lines.join('\n'));
}

function nativePdfEvidence(items,pageNumber,text){
  const visible=items.filter(item=>typeof item.str==='string'&&item.str.trim()&&Array.isArray(item.transform));
  if(!visible.length)return {};
  const bounds=visible.map(item=>[item.transform[4],item.transform[5]-Math.abs(item.height||item.transform[3]||10),item.transform[4]+(item.width||0),item.transform[5]]);
  const bbox=[Math.min(...bounds.map(b=>b[0])),Math.min(...bounds.map(b=>b[1])),Math.max(...bounds.map(b=>b[2])),Math.max(...bounds.map(b=>b[3]))];
  const locator={page:pageNumber,pageKind:'physical',bbox,coordinateSystem:'pdf-bottom-left',unit:'pt',granularity:'page-text-bounds'};
  const lines=[];for(const item of [...visible].sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])){let line=lines.find(row=>Math.abs(row.y-item.transform[5])<2);if(!line){line={y:item.transform[5],items:[]};lines.push(line);}line.items.push(item);}
  const rows=lines.map(line=>{const cells=[],starts=[];let end=-Infinity;for(const item of line.items.sort((a,b)=>a.transform[4]-b.transform[4])){const font=Math.abs(item.transform[3]||item.height||10);if(!cells.length||item.transform[4]-end>font*1.8){cells.push(item.str);starts.push(item.transform[4]);}else cells[cells.length-1]+=item.str;end=item.transform[4]+(item.width||0);}return {cells,starts};});
  const width=rows[0]?.cells.length||0;
  if(rows.length>=3&&width>=2&&width<=20&&rows.every(row=>row.cells.length===width&&row.starts.every((x,i)=>Math.abs(x-rows[0].starts[i])<=12))){
    const table=createTable(rows.map(row=>row.cells),{tableId:'pdf:page:'+pageNumber,name:'第'+pageNumber+'页候选表格',format:'pdf'},PARSER_LIMITS);
    if(table.headerSource==='first-row'){table.reviewRequired=true;table.locator={...locator,granularity:'candidate-table-bounds'};return {locator,blocks:[{type:'table',table,text,locator:table.locator,quality:{text:'native',structure:'candidate',method:'pdf-coordinate-alignment'}}],tableCandidate:true};}
  }
  return {locator};
}

async function parsePdf(buffer, filePath, store) {
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) fail('CORRUPT_DOCUMENT', 'PDF 文件头无效，请重新导出。');
  let task, document;
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const warnings = [];
  const pages = [];
  let ocr = null, temp = null, ocrCount = 0, total = 0;
  try {
    task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true, useWorkerFetch: false, stopAtErrors: true, maxImageSize: 16_000_000, isOffscreenCanvasSupported: false, isImageDecoderSupported: false });
    document = await task.promise;
    limit(document.numPages > PARSER_LIMITS.pages, 'PDF 超过 1000 页，请拆分后上传。');
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      let text = pdfPageText(content.items),usedOcr=false,scannedEvidence=null;
      if (text.trim().length < 200) {
        const operators = await page.getOperatorList();
        const imageOps = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat];
        if (operators.fnArray.some(op => imageOps.includes(op))) {
          limit(++ocrCount > PARSER_LIMITS.ocrPages, '单个 PDF 需要 OCR 的页面超过 20 页，请拆分文件。');
          ocr ??= await ocrTools(true);
          temp ??= await mkdtemp(path.join(tmpdir(), 'x-rag-ocr-'));
          const prefix = path.join(temp, `page-${n}`);
          const imagePath = await renderPdfOcrPage(page, filePath, n, prefix, ocr);
          const recognized=await recognizeImageData(imagePath,ocr,store);text=recognized.text||text;usedOcr=true;scannedEvidence=ocrEvidence(recognized,n,PARSER_LIMITS);
          if(recognized.method==='qwen-vl')warnings.push('第'+n+'页扫描内容由通义千问视觉识别，数字与专有名词仍建议人工核对。');
          if(scannedEvidence?.tableCount)warnings.push('第'+n+'页发现OCR词框对齐的表格候选，记录和单元格位置须逐项确认后才能全表统计。');
          if (!text) warnings.push(`第 ${n} 页经 OCR 仍无可识别文字，请对照原件检查。`);
        } else if (!text.trim()) warnings.push(`第 ${n} 页没有可提取的文本（可能为空白页或轮廓文字）。`);
      }
      total += text.length;
      limit(total > PARSER_LIMITS.textChars, 'PDF 提取文本超过 200 万字符，请拆分文件。');
      const evidence=usedOcr&&scannedEvidence?{blocks:scannedEvidence.blocks}:usedOcr?{locator:{page:n,pageKind:'physical'},blocks:[{type:'paragraph',text,locator:{page:n,pageKind:'physical'},quality:{text:'unreviewed',numeric:'unreviewed',method:'ocr'}}]}:nativePdfEvidence(content.items,n,text);
      if(evidence.tableCandidate)warnings.push('第'+n+'页按文本坐标识别为候选表格，字段及行列归属须人工确认后才能全表统计。');
      const {tableCandidate,...pageEvidence}=evidence;pages.push({ page:n,text,...pageEvidence });
      page.cleanup();
    }
    if (ocrCount) warnings.push(`其中 ${ocrCount} 页经过 OCR；识别内容需审核，尤其是数字、表格及专有名词。`, ...ocr.warnings);
    return { pages, warnings, parser: ocrCount ? 'pdfjs+tesseract' : 'pdfjs' };
  } catch (error) {
    if (error instanceof DocumentParseError) throw error;
    if (error.name === 'PasswordException') fail('ENCRYPTED_DOCUMENT', 'PDF 已加密，请解除密码保护后上传。');
    fail('CORRUPT_DOCUMENT', 'PDF 解析失败，文件可能损坏；请重新导出为标准 PDF 后上传。');
  } finally {
    if (task) await task.destroy().catch(() => {});
    await closeOcr(ocr);
    if (temp) await rm(temp, { recursive: true, force: true });
  }
}

function validateImage(buffer, ext) {
  let width = 0, height = 0;
  const invalid = () => fail('CORRUPT_DOCUMENT', '图片文件头、尺寸或格式不正确，请重新保存图片。');
  if (ext === '.png') {
    if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.subarray(12, 16).toString() !== 'IHDR') invalid();
    width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20);
  } else if (['.jpg', '.jpeg'].includes(ext)) {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) invalid();
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) invalid();
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) invalid();
      const size = buffer.readUInt16BE(offset);
      if (size < 2 || offset + size > buffer.length) invalid();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (size < 8) invalid();
        height = buffer.readUInt16BE(offset + 3); width = buffer.readUInt16BE(offset + 5); break;
      }
      offset += size;
    }
  } else if (['.tif', '.tiff'].includes(ext)) {
    if (buffer.length < 8 || !['II*\0', 'MM\0*'].includes(buffer.subarray(0, 4).toString('latin1'))) invalid();
    const le = buffer.subarray(0, 2).toString() === 'II';
    const u16 = offset => le ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    const u32 = offset => le ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    const directory = u32(4);
    if (directory + 2 > buffer.length) invalid();
    const count = u16(directory);
    if (directory + 2 + count * 12 + 4 > buffer.length) invalid();
    for (let i = 0; i < count; i++) {
      const offset = directory + 2 + i * 12;
      const tag = u16(offset), type = u16(offset + 2), values = u32(offset + 4);
      if ([256, 257].includes(tag)) {
        if (values !== 1 || ![3, 4].includes(type)) invalid();
        const value = type === 3 ? u16(offset + 8) : u32(offset + 8);
        if (tag === 256) width = value; else height = value;
      }
    }
    if (u32(directory + 2 + count * 12)) fail('UNSUPPORTED_FORMAT', '多页 TIFF 请先转为多页 PDF 或拆分为单页图片后上传，以保证每页引用准确。');
  } else if (ext === '.bmp') {
    if (buffer.length < 26 || buffer.subarray(0, 2).toString() !== 'BM') invalid();
    const headerSize = buffer.readUInt32LE(14);
    if (headerSize === 12) { width = buffer.readUInt16LE(18); height = buffer.readUInt16LE(20); }
    else { width = buffer.readInt32LE(18); height = Math.abs(buffer.readInt32LE(22)); }
  } else if (ext === '.webp') {
    if (buffer.length < 30 || buffer.subarray(0, 4).toString() !== 'RIFF' || buffer.subarray(8, 12).toString() !== 'WEBP') invalid();
    const format = buffer.subarray(12, 16).toString();
    if (format === 'VP8X') { width = buffer.readUIntLE(24, 3) + 1; height = buffer.readUIntLE(27, 3) + 1; }
    else if (format === 'VP8L' && buffer[20] === 0x2f) { const packed = buffer.readUInt32LE(21); width = (packed & 0x3fff) + 1; height = ((packed >>> 14) & 0x3fff) + 1; }
    else if (format === 'VP8 ' && buffer[23] === 0x9d && buffer[24] === 1 && buffer[25] === 0x2a) { width = buffer.readUInt16LE(26) & 0x3fff; height = buffer.readUInt16LE(28) & 0x3fff; }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) invalid();
  limit(width * height > PARSER_LIMITS.imagePixels || width > 20_000 || height > 20_000, '图片超过 2000 万像素或单边超过 20000 像素，请缩小后上传。');
  return { width, height };
}

export async function parseDocument({ filePath, fileName, mimeType, store } = {}) {
  if (!filePath || typeof filePath !== 'string' || !fileName || typeof fileName !== 'string') fail('INVALID_DOCUMENT', '缺少文件路径或文件名。');
  const resolved = path.resolve(filePath);
  let info;
  try { info = await stat(resolved); } catch { fail('FILE_NOT_FOUND', '原始文件不存在，请重新上传。'); }
  if (!info.isFile()) fail('INVALID_DOCUMENT', '上传内容不是普通文件。');
  if (!info.size) fail('EMPTY_DOCUMENT', '文件为空，请选择有内容的文件。');
  limit(info.size > PARSER_LIMITS.fileBytes, '文件超过 100MB，请拆分后上传。');
  const buffer = await readFile(resolved);
  limit(buffer.length > PARSER_LIMITS.fileBytes, '文件超过 100MB，请拆分后上传。');
  const ext = path.extname(fileName).toLowerCase();
  const warnings = [];
  let result;
  if (MEDIA_EXTENSIONS.includes(ext)) result = await parseMedia(resolved, fileName, buffer,{ocrFactory:async()=>{const engine=await ocrTools();return {recognize:image=>recognizeImage(image,engine,store),close:()=>closeOcr(engine)};}});
  else if (ext === '.pdf') {if(!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))fail('CORRUPT_DOCUMENT','PDF文件头无效。');result = layoutEnabled()?await parseLayout(resolved,fileName,PARSER_LIMITS):await parsePdf(buffer, resolved, store);}
  else if (['.docx', '.xlsx', '.pptx'].includes(ext)) {
    const zip = readOfficeZip(buffer);
    if (!zip.has('[Content_Types].xml')) fail('CORRUPT_DOCUMENT', '文件不是标准 Office Open XML 格式。');
    xmlTree(zip.read('[Content_Types].xml'));
    result = ext === '.docx' ? parseDocx(zip) : ext === '.xlsx' ? parseXlsx(zip) : parsePptx(zip);
  } else if (['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp'].includes(ext)) {
    validateImage(buffer, ext);
    if(layoutEnabled())result=await parseLayout(resolved,fileName,PARSER_LIMITS);
    else {
    const ocr = await ocrTools();
    try {
      const recognized=await recognizeImageData(resolved,ocr,store),text=recognized.text,layout=ocrEvidence(recognized,1,PARSER_LIMITS);
      const parserLabel = recognized.method === 'qwen-vl' ? 'qwen-vl' : (ocr.kind === 'javascript' ? 'tesseract-js' : 'tesseract');
      result = { pages: [{ page: 1, text,...(layout?{blocks:layout.blocks}:{}) }], parser: parserLabel, warnings: [recognized.method==='qwen-vl'?'图片由通义千问视觉识别提取文字，数字、表格和专有名词需人工审核。':'图片经 OCR 提取，数字、表格和专有名词需人工审核。',...(layout?.tableCount?['已按OCR词框识别表格候选；单元格、缺漏行和数字须人工确认后才能全表统计。']:[]), ...ocr.warnings] };
    } finally { await closeOcr(ocr); }
    }
  } else if (['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.html', '.htm'].includes(ext)) {
    let text = decode(buffer, warnings), table;
    if (text.includes('\0')) fail('CORRUPT_DOCUMENT', '文件包含二进制内容，请确认扩展名或另存为 UTF-8 文本。');
    limit(text.length > PARSER_LIMITS.textChars, '文本超过 200 万字符，请拆分文件。');
    if (['.html', '.htm'].includes(ext)) text = htmlText(text);
    else if (['.csv', '.tsv'].includes(ext)) { const csv=csvText(text,ext);text=csv.text;table=createTable(csv.rows,{tableId:'table:1',name:fileName,format:ext.slice(1),rowNumbers:csv.rowNumbers},PARSER_LIMITS); }
    else if (ext === '.json') {
      try { text = JSON.stringify(JSON.parse(text), null, 2); }
      catch { fail('CORRUPT_DOCUMENT', 'JSON 语法不正确，请修复后重新上传。'); }
    }
    result = { pages: table?[{page:1,text:clean(text),table}]:text.split('\f').map((part, index) => ({ page: index + 1, text: clean(part) })), warnings: [...warnings], notes: ['文本页码为换页符划分的逻辑页；没有换页符时为第 1 页。'], parser: `text-${ext.slice(1)}` };
  } else {
    void mimeType; // Do not trust an upload's declared MIME type instead of checking its format.
    fail('UNSUPPORTED_FORMAT', '暂不支持此格式。请上传 PDF、DOCX、XLSX、PPTX、TXT、Markdown、CSV、JSON、HTML 或常见图片；旧版 DOC/XLS/PPT 请另存为新版格式，ZIP 和音视频请先解包或转写。');
  }
  limit(result.pages.length > PARSER_LIMITS.pages, '文档超过 1000 个页/工作表，请拆分文件。');
  let length = 0;
  result.pages = result.pages.map(page => {
    const text = clean(page.text);
    length += text.length;
    limit(length > PARSER_LIMITS.textChars, '提取文本超过 200 万字符，请拆分文件。');
    return { page: page.page, text, ...(page.heading ? { heading: clean(page.heading) } : {}), ...(page.table?{table:page.table}:{}), ...(page.blocks?{blocks:page.blocks}:{}), ...(page.locator?{locator:page.locator}:{}) };
  });
  if (!result.pages.some(page => page.text.trim())) fail('EMPTY_DOCUMENT', '文件中没有可提取的文字。图片或扫描件请配置 OCR；空白文件请补充内容后上传。');
  const notes=[...(result.notes||[]),...result.pages.flatMap(p=>[...(p.table?[p.table]:[]),...(p.blocks||[]).filter(b=>b.table).map(b=>b.table)]).flatMap(tableNotes)];
  const actualWarnings=[];
  for(const warning of result.warnings||[]){if(/^XLSX 页码表示工作表序号/.test(warning))notes.push(warning);else actualWarnings.push(warning);}
  return { ...result, warnings: [...new Set(actualWarnings)], notes:[...new Set(notes)] };
}

/** Keep document page attribution intact; overlap only within the same page and section. */
export function chunkPages(pages) {
  if (!Array.isArray(pages)) fail('INVALID_DOCUMENT', '解析页数据无效。');
  limit(pages.length > PARSER_LIMITS.pages, '待切分文档页数超过限制。');
  const chunks = [];
  let total = 0;
  for (const page of pages) {
    if (!Number.isInteger(page.page) || page.page < 1 || typeof page.text !== 'string') fail('INVALID_DOCUMENT', '解析页缺少有效页码或文本。');
    total += page.text.length;
    limit(total > PARSER_LIMITS.textChars, '待切分文本超过 200 万字符。');
    if(page.table){chunks.push(...chunkTable(page.table,page.page,PARSER_LIMITS,chunks.length+1));if(!page.blocks?.length)continue;}
    if(page.blocks?.length){for(const block of page.blocks){if(block.table){chunks.push(...chunkTable(block.table,page.page,PARSER_LIMITS,chunks.length+1));continue;}const parts=chunkPages([{page:page.page,text:block.text,heading:page.heading||''}]);for(const part of parts)chunks.push({...part,ordinal:chunks.length+1,evidenceType:block.type||'paragraph',locator:block.locator||page.locator||{page:page.page},quality:block.quality||{text:'unknown'},...(block.structuredData?{structuredData:block.structuredData}:{}),...(block.speaker?{speaker:block.speaker}:{})});}continue;}
    const sections = [];
    let section = { heading: page.heading ?? '', lines: [] };
    for (const line of clean(page.text).split('\n')) {
      const title = /^#{1,6}\s+(.+)$/.exec(line);
      if (title && section.lines.some(text => text.trim())) { sections.push(section); section = { heading: title[1], lines: [] }; }
      else if (title) section.heading = title[1];
      section.lines.push(line);
    }
    sections.push(section);
    for (const item of sections) {
      const text = item.lines.join('\n').trim();
      let start = 0;
      while (start < text.length) {
        let end = Math.min(text.length, start + PARSER_LIMITS.chunkChars);
        if (end < text.length) {
          const sample = text.slice(start, end);
          const breakAt = Math.max(sample.lastIndexOf('\n'), sample.lastIndexOf('。') + 1, sample.lastIndexOf('！') + 1, sample.lastIndexOf('？') + 1, sample.lastIndexOf('. ') + 1);
          if (breakAt > PARSER_LIMITS.chunkChars / 2) end = start + breakAt;
          if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--;
        }
        const value = text.slice(start, end).trim();
        if (value) chunks.push({ text: value, page: page.page, heading: item.heading, ordinal: chunks.length + 1,...(page.locator?{locator:page.locator}:{}) });
        if (end >= text.length) break;
        let next = Math.max(start + 1, end - PARSER_LIMITS.chunkOverlap);
        if (/^[\uDC00-\uDFFF]$/.test(text[next])) next++;
        start = next;
      }
    }
  }
  return chunks;
}
