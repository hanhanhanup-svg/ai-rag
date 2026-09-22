import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDocument } from '../server/parser.mjs';
import { scannedImageFixture, scannedPdfFixture } from './fixtures/parser-fixtures.mjs';

test('offline OCR reads PNG, JPEG, TIFF and scanned PDF with real page citations', { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'x-rag-ocr-test-'));
  const previousEngine = process.env.OCR_ENGINE;
  process.env.OCR_ENGINE = 'javascript';
  try {
    const first = await scannedImageFixture();
    const second = await scannedImageFixture('RECORDS RETAIN FIVE YEARS');
    const fixtures = [['scan.png', first.png], ['scan.jpg', first.jpg], ['scan.tiff', first.tiff], ['scan.pdf', scannedPdfFixture([first, second])]];
    for (const [fileName, bytes] of fixtures) {
      const filePath = path.join(directory, fileName);
      await writeFile(filePath, bytes);
      const result = await parseDocument({ filePath, fileName });
      assert.match(result.pages[0].text, /PROCUREMENT\s+APPROVAL\s+REQUIRED/i, fileName);
      assert.equal(result.pages[0].page, 1);
      assert.match(result.warnings.join(' '), /OCR/);
      if (fileName === 'scan.pdf') {
        assert.equal(result.pages.length, 2);
        assert.match(result.pages[1].text, /RECORDS\s+RETAIN\s+FIVE\s+YEARS/i);
        assert.equal(result.pages[1].page, 2);
      }
    }
  } finally {
    if (previousEngine === undefined) delete process.env.OCR_ENGINE; else process.env.OCR_ENGINE = previousEngine;
    await rm(directory, { recursive: true, force: true });
  }
});

test('image pixel limit and multi-page TIFF are rejected before OCR decoding', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'x-rag-image-limit-'));
  try {
    const fixture = await scannedImageFixture();
    const large = Buffer.from(fixture.png);
    large.writeUInt32BE(100_000, 16);
    const filePath = path.join(directory, 'large.png');
    await writeFile(filePath, large);
    await assert.rejects(parseDocument({ filePath, fileName: 'large.png' }), { code: 'DOCUMENT_LIMIT' });
    const multiple = Buffer.from(fixture.tiff);
    multiple.writeUInt32LE(8, 130);
    const tiffPath = path.join(directory, 'multiple.tif');
    await writeFile(tiffPath, multiple);
    await assert.rejects(parseDocument({ filePath: tiffPath, fileName: 'multiple.tif' }), { code: 'UNSUPPORTED_FORMAT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('Chinese OCR preserves words and PDF rendering also works without external Poppler', { timeout: 90_000 }, async () => {
  const previousEngine = process.env.OCR_ENGINE, previousRenderer = process.env.PDF_RENDERER;
  process.env.OCR_ENGINE = 'javascript'; process.env.PDF_RENDERER = 'canvas';
  try {
    for (const fileName of ['中文扫描.png', '中文扫描.pdf']) {
      const filePath = new URL('./fixtures/parser-samples/' + fileName, import.meta.url);
      const result = await parseDocument({ filePath: (await import('node:url')).fileURLToPath(filePath), fileName });
      assert.match(result.pages[0].text, /采购合同应当先审批后签订/);
      assert.equal(result.pages[0].page, 1);
    }
  } finally {
    if (previousEngine === undefined) delete process.env.OCR_ENGINE; else process.env.OCR_ENGINE = previousEngine;
    if (previousRenderer === undefined) delete process.env.PDF_RENDERER; else process.env.PDF_RENDERER = previousRenderer;
  }
});