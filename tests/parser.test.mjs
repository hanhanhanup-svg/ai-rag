import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDocument, chunkPages, PARSER_LIMITS } from '../server/parser.mjs';
import { writeParserFixtures, zipFixture, docxEntries, pdfFixture } from './fixtures/parser-fixtures.mjs';

let directory;
before(async () => { directory = await mkdtemp(path.join(tmpdir(), 'x-rag-parser-test-')); await writeParserFixtures(directory); });
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
const parse = name => parseDocument({ filePath: path.join(directory, name), fileName: name });
async function parseContent(name, content) { await writeFile(path.join(directory, name), content); return parse(name); }

test('DOCX extracts actual Chinese body, headings, table columns and explicit page breaks', async () => {
  const result = await parse('采购制度.docx');
  assert.equal(result.parser, 'docx-ooxml-v2');
  assert.equal(result.pages.length, 2);
  assert.match(result.pages[0].text, /# 采购制度/);
  assert.match(result.pages[0].text, /软件\t100000/);
  assert.match(result.pages[1].text, /归档保存五年/);
  assert.equal(result.pages[1].page, 2);
  assert.match(result.notes.join(' '), /逻辑页/);
  const chunks = chunkPages(result.pages);
  assert.equal(chunks[0].heading, '采购制度');
  assert.ok(chunks.some(chunk => chunk.page === 2 && chunk.text.includes('归档保存五年')));
});

test('XLSX preserves worksheets, sparse columns, shared strings, dates and cached formulas', async () => {
  const result = await parse('采购台账.xlsx');
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].heading, '采购台账');
  assert.match(result.pages[0].text, /供应商\t\t金额/);
  assert.match(result.pages[0].text, /测试公司\t\t12800\.5/);
  assert.match(result.pages[0].text, /2024-01-01/);
  assert.match(result.pages[0].text, /公式结果未缓存/);
  assert.match(result.warnings.join(' '), /1 个公式没有缓存结果/);
  assert.match(result.pages[1].text, /项目完成日期\t2026-12-31/);
});

test('PPTX follows presentation relationship order rather than ZIP filenames', async () => {
  const result = await parse('知识管理.pptx');
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].heading, '第一张实际幻灯片');
  assert.match(result.pages[0].text, /上传、审核和发布/);
  assert.equal(result.pages[1].heading, '第二张实际幻灯片');
  assert.equal(result.pages[1].page, 2);
});

test('PDF text extraction keeps actual PDF page attribution', async () => {
  const result = await parse('two-pages.pdf');
  assert.equal(result.parser, 'pdfjs');
  assert.equal(result.pages.length, 2);
  assert.match(result.pages[0].text, /procurement approval/);
  assert.match(result.pages[1].text, /five years/);
  assert.ok(chunkPages(result.pages).every(chunk => chunk.page === (chunk.text.includes('one:') ? 1 : 2)));
});

test('text formats parse real content and remove inactive HTML script/style content', async () => {
  const markdown = await parse('制度说明.md');
  assert.deepEqual(chunkPages(markdown.pages).map(chunk => chunk.heading), ['采购制度', '归档']);
  const csv = await parse('供应商.csv');
  assert.match(csv.pages[0].text, /测试,公司\t12800\t第一行 第二行/);
  const json = await parse('数据.json');
  assert.match(json.pages[0].text, /"部门": "采购部"/);
  const html = await parse('正文.html');
  assert.match(html.pages[0].text, /# 企业制度/);
  assert.match(html.pages[0].text, /审查 & 审批/);
  assert.doesNotMatch(html.pages[0].text, /dangerous/);
  const utf16 = await parseContent('utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文制度\f第二页', 'utf16le')]));
  assert.equal(utf16.pages.length, 2);
  assert.equal(utf16.pages[1].text, '第二页');
});

test('chunking retains content coverage, heading context, overlap and page boundaries', () => {
  const text = `# 制度\n${'采购审批须由业务负责人确认，保存全部审批记录。'.repeat(160)}`;
  const pages = [{ page: 3, text }, { page: 7, text: '第二份证据只属于第七页。' }];
  const chunks = chunkPages(pages);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every(chunk => chunk.text.length <= PARSER_LIMITS.chunkChars));
  assert.deepEqual(chunks.map(chunk => chunk.ordinal), chunks.map((_, index) => index + 1));
  assert.ok(chunks.filter(chunk => chunk.page === 3).every(chunk => chunk.heading === '制度'));
  assert.equal(chunks.at(-1).page, 7);
  assert.ok(chunks.slice(0, -1).every(chunk => !chunk.text.includes('第七页')));
  const longSingle = Array.from({ length: 2800 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join('');
  const split = chunkPages([{ page: 1, text: longSingle }]);
  let cursor = 0;
  for (const chunk of split) {
    const at = longSingle.indexOf(chunk.text);
    assert.ok(at <= cursor, 'No original text may be skipped at a chunk boundary');
    cursor = at + chunk.text.length;
  }
  assert.equal(cursor, longSingle.length);
});

test('empty, corrupt, unsupported and malformed files fail with actionable codes', async () => {
  await assert.rejects(parseContent('empty.txt', ''), { code: 'EMPTY_DOCUMENT' });
  await assert.rejects(parseContent('whitespace.txt', ' \n\t'), { code: 'EMPTY_DOCUMENT' });
  await assert.rejects(parseContent('bad.pdf', 'not a PDF'), { code: 'CORRUPT_DOCUMENT' });
  await assert.rejects(parseContent('bad.docx', 'not a ZIP'), { code: 'CORRUPT_DOCUMENT' });
  await assert.rejects(parseContent('bad.json', '{"broken":'), { code: 'CORRUPT_DOCUMENT' });
  await assert.rejects(parseContent('bad.csv', 'name,value\n"unterminated'), { code: 'CORRUPT_DOCUMENT' });
  await assert.rejects(parseContent('old.doc', Buffer.from('legacy')), { code: 'UNSUPPORTED_FORMAT' });
  await assert.rejects(parseContent('binary.txt', Buffer.from([1, 0, 2])), { code: 'CORRUPT_DOCUMENT' });
  await assert.rejects(parseContent('fake.png', Buffer.from('not an image')), { code: 'CORRUPT_DOCUMENT' });
  await assert.rejects(parseContent('empty.pdf', pdfFixture([''])), { code: 'EMPTY_DOCUMENT' });
});

test('Office archive traversal, inflated size abuse, CRC damage and XML entities are rejected', async () => {
  await assert.rejects(parseContent('traversal.docx', zipFixture({ ...docxEntries('<w:p/>'), '../outside.txt': 'escape' })), { code: 'UNSAFE_ARCHIVE' });
  await assert.rejects(parseContent('absolute.docx', zipFixture({ ...docxEntries('<w:p/>'), 'C:/outside.txt': 'escape' })), { code: 'UNSAFE_ARCHIVE' });
  await assert.rejects(parseContent('bomb.docx', zipFixture({ ...docxEntries('<w:p/>'), 'word/bomb.xml': 'x'.repeat(2 * 1024 * 1024) })), { code: 'DOCUMENT_LIMIT' });
  const data = zipFixture(docxEntries('<w:p><w:r><w:t>good</w:t></w:r></w:p>'), { method: 0 });
  data[data.indexOf(Buffer.from('good'))] = 0x62;
  await assert.rejects(parseContent('crc.docx', data), { code: 'CORRUPT_DOCUMENT' });
  const entities = docxEntries('<w:p><w:r><w:t>&evil;</w:t></w:r></w:p>');
  entities['word/document.xml'] = entities['word/document.xml'].replace('<w:document', '<!DOCTYPE document [<!ENTITY evil SYSTEM "file:///etc/passwd">]><w:document');
  await assert.rejects(parseContent('entity.docx', zipFixture(entities)), { code: 'UNSAFE_DOCUMENT' });
  const invalid = docxEntries('<w:p><w:r><w:t>broken</w:t></w:p>');
  await assert.rejects(parseContent('xml.docx', zipFixture(invalid)), { code: 'CORRUPT_DOCUMENT' });
});

test('text and page count limits are enforced before chunking or document publication', async () => {
  await assert.rejects(parseContent('long.txt', 'A'.repeat(PARSER_LIMITS.textChars + 1)), { code: 'DOCUMENT_LIMIT' });
  await assert.rejects(parseContent('many-pages.txt', Array.from({ length: 1001 }, () => 'page').join('\f')), { code: 'DOCUMENT_LIMIT' });
  assert.throws(() => chunkPages([{ page: 0, text: 'invalid' }]), { code: 'INVALID_DOCUMENT' });
});
