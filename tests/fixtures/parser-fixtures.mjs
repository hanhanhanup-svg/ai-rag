import { deflateRawSync, deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipFixture(entries, { method = 8 } = {}) {
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const filename = Buffer.from(name);
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const relationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeRelationshipNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const spreadsheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const presentationNs = 'http://schemas.openxmlformats.org/presentationml/2006/main';
function contentTypes(entries) {
  return `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${entries.map(([part, type]) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`).join('')}</Types>`;
}
function relationships(entries) {
  return `${XML}<Relationships xmlns="${relationshipNs}">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${officeRelationshipNs}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
}

export function docxEntries(body) {
  return {
    '[Content_Types].xml': contentTypes([['word/document.xml', 'wordprocessingml.document.main+xml'], ['word/styles.xml', 'wordprocessingml.styles+xml']]),
    '_rels/.rels': relationships([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/_rels/document.xml.rels': relationships([['rId1', 'styles', 'styles.xml']]),
    'word/styles.xml': `${XML}<w:styles xmlns:w="${wordNs}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`,
    'word/document.xml': `${XML}<w:document xmlns:w="${wordNs}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
  };
}
export function docxFixture() {
  return zipFixture(docxEntries('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>采购制度</w:t></w:r></w:p><w:p><w:r><w:t>采购金额超过十万元应履行审批程序。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>软件</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>100000</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:br w:type="page"/><w:t>第二逻辑页：归档保存五年。</w:t></w:r></w:p>'));
}

export function xlsxFixture() {
  return zipFixture({
    '[Content_Types].xml': contentTypes([['xl/workbook.xml', 'spreadsheetml.sheet.main+xml'], ['xl/worksheets/sheet1.xml', 'spreadsheetml.worksheet+xml'], ['xl/worksheets/sheet2.xml', 'spreadsheetml.worksheet+xml'], ['xl/sharedStrings.xml', 'spreadsheetml.sharedStrings+xml'], ['xl/styles.xml', 'spreadsheetml.styles+xml']]),
    '_rels/.rels': relationships([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `${XML}<workbook xmlns="${spreadsheetNs}" xmlns:r="${officeRelationshipNs}"><sheets><sheet name="采购台账" sheetId="1" r:id="rId1"/><sheet name="项目计划" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': relationships([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', 'worksheets/sheet2.xml'], ['rId3', 'sharedStrings', 'sharedStrings.xml'], ['rId4', 'styles', 'styles.xml']]),
    'xl/sharedStrings.xml': `${XML}<sst xmlns="${spreadsheetNs}" count="3" uniqueCount="3"><si><t>供应商</t></si><si><t>金额</t></si><si><t>测试公司</t></si></sst>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="${spreadsheetNs}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `${XML}<worksheet xmlns="${spreadsheetNs}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>12800.5</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>日期</t></is></c><c r="B3" s="1"><v>45292</v></c></row><row r="4"><c r="A4"><f>SUM(C2:C2)</f><v>12800.5</v></c><c r="B4"><f>1+1</f></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `${XML}<worksheet xmlns="${spreadsheetNs}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>项目完成日期</t></is></c><c r="B1" t="inlineStr"><is><t>2026-12-31</t></is></c></row></sheetData></worksheet>`
  });
}

export function pptxFixture() {
  const slide = (title, text) => `${XML}<p:sld xmlns:a="${drawingNs}" xmlns:p="${presentationNs}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  return zipFixture({
    '[Content_Types].xml': contentTypes([['ppt/presentation.xml', 'presentationml.presentation.main+xml'], ['ppt/slides/slide1.xml', 'presentationml.slide+xml'], ['ppt/slides/slide2.xml', 'presentationml.slide+xml']]),
    '_rels/.rels': relationships([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `${XML}<p:presentation xmlns:p="${presentationNs}" xmlns:r="${officeRelationshipNs}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': relationships([['rId1', 'slide', 'slides/slide1.xml'], ['rId2', 'slide', 'slides/slide2.xml']]),
    'ppt/slides/slide1.xml': slide('第二张实际幻灯片', '年度计划需要业务负责人审核。'),
    'ppt/slides/slide2.xml': slide('第一张实际幻灯片', '知识生产包括上传、审核和发布。')
  });
}

export function pdfFixture(texts = ['Page one: procurement approval required.', 'Page two: records retained for five years.']) {
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Count ${texts.length} /Kids [${texts.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < texts.length; i++) {
    const content = `BT /F1 12 Tf 72 720 Td (${texts[i].replace(/[\\()]/g, '\\$&')}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

export async function writeParserFixtures(directory) {
  await mkdir(directory, { recursive: true });
  const fixtures = {
    '采购制度.docx': docxFixture(),
    '采购台账.xlsx': xlsxFixture(),
    '知识管理.pptx': pptxFixture(),
    'two-pages.pdf': pdfFixture(),
    '制度说明.md': '# 采购制度\n供应商必须经过审查。\n\n## 归档\n合同保存五年。',
    '供应商.csv': '供应商,金额,说明\r\n"测试,公司",12800,"第一行\n第二行"\r\n',
    '数据.json': '{"部门":"采购部","期限":5}',
    '正文.html': '<!doctype html><html><body><h1>企业制度</h1><p>审查 &amp; 审批</p><script>dangerous()</script><table><tr><td>部门</td><td>采购部</td></tr></table></body></html>'
  };
  await Promise.all(Object.entries(fixtures).map(([name, value]) => writeFile(path.join(directory, name), value)));
  return fixtures;
}


export async function scannedImageFixture(text = 'PROCUREMENT APPROVAL REQUIRED') {
  const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
  const chinese = /[\u3400-\u9fff]/.test(text);
  if (chinese && process.platform === 'win32') GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'ParserFixtureChinese');
  const width = 1800, height = 360;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#000000'; context.font = chinese ? '64px ParserFixtureChinese' : 'bold 64px sans-serif';
  context.fillText(text, 80, 140);
  context.font = '48px sans-serif'; context.fillText('Document evidence - 2026', 80, 240);
  const rgba = context.getImageData(0, 0, width, height).data;
  const rgb = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++) { rgb[pixel * 3] = rgba[pixel * 4]; rgb[pixel * 3 + 1] = rgba[pixel * 4 + 1]; rgb[pixel * 3 + 2] = rgba[pixel * 4 + 2]; }
  const header = Buffer.alloc(140);
  header.write('II', 0); header.writeUInt16LE(42, 2); header.writeUInt32LE(8, 4); header.writeUInt16LE(10, 8);
  const tags = [[256, 4, 1, width], [257, 4, 1, height], [258, 3, 3, 134], [259, 3, 1, 1], [262, 3, 1, 2], [273, 4, 1, 140], [277, 3, 1, 3], [278, 4, 1, height], [279, 4, 1, rgb.length], [284, 3, 1, 1]];
  tags.forEach(([tag, type, count, value], index) => { const at = 10 + index * 12; header.writeUInt16LE(tag, at); header.writeUInt16LE(type, at + 2); header.writeUInt32LE(count, at + 4); header.writeUInt32LE(value, at + 8); });
  header.writeUInt16LE(8, 134); header.writeUInt16LE(8, 136); header.writeUInt16LE(8, 138);
  return { width, height, rgb, png: await canvas.encode('png'), jpg: await canvas.encode('jpeg'), tiff: Buffer.concat([header, rgb]) };
}

export function scannedPdfFixture(images) {
  const objects = [];
  objects.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.push(Buffer.from('<< /Type /Pages /Count ' + images.length + ' /Kids [' + images.map((_, index) => (3 + index * 3) + ' 0 R').join(' ') + '] >>'));
  for (let index = 0; index < images.length; index++) {
    const item = images[index];
    const imageNumber = 4 + index * 3, streamNumber = imageNumber + 1;
    objects.push(Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Img ' + imageNumber + ' 0 R >> >> /Contents ' + streamNumber + ' 0 R >>'));
    const compressed = deflateSync(item.rgb);
    objects.push(Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width ' + item.width + ' /Height ' + item.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + compressed.length + ' >>\nstream\n'), compressed, Buffer.from('\nendstream')]));
    const drawing = 'q 600 0 0 120 6 550 cm /Img Do Q';
    objects.push(Buffer.from('<< /Length ' + Buffer.byteLength(drawing) + ' >>\nstream\n' + drawing + '\nendstream'));
  }
  const parts = [Buffer.from('%PDF-1.4\n')], offsets = [0];
  let length = parts[0].length;
  objects.forEach((item, index) => { offsets.push(length); const object = Buffer.concat([Buffer.from((index + 1) + ' 0 obj\n'), item, Buffer.from('\nendobj\n')]); parts.push(object); length += object.length; });
  parts.push(Buffer.from('xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + length + '\n%%EOF\n'));
  return Buffer.concat(parts);
}
