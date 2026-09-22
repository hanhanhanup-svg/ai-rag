import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { sendStoredFile, validMediaHeader } from './media-preview.mjs';
import { canDocument, isRetrievable } from './security.mjs';

test('media preview supports bounded, suffix and HEAD byte ranges without accepting malformed ranges', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'xrag-media-range-')), file = path.join(dir, 'sample.wav');
  const data = Buffer.alloc(256); data.write('RIFF', 0); data.write('WAVE', 8); writeFileSync(file, data);
  const server = http.createServer((req, res) => { try { sendStoredFile(req, res, file, { mimeType: 'audio/wav', fileName: '测试.wav', preview: true }); } catch (e) { res.writeHead(e.status || 500); res.end(e.code); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const url = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal(validMediaHeader('audio/wav', data.subarray(0, 16)), true); assert.equal(validMediaHeader('audio/wav', Buffer.from('<script>alert(1)</script>')), false);
    let response = await fetch(url, { headers: { range: 'bytes=0-15' } }); assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 0-15/256'); assert.equal((await response.arrayBuffer()).byteLength, 16);
    response = await fetch(url, { headers: { range: 'bytes=-10' } }); assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 10);
    response = await fetch(url, { method: 'HEAD', headers: { range: 'bytes=32-' } }); assert.equal(response.status, 206); assert.equal(response.headers.get('content-length'), '224'); assert.equal((await response.arrayBuffer()).byteLength, 0);
    for (const range of ['bytes=300-', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=8-4', 'bytes=999999999999999999999999999999999-']) { response = await fetch(url, { headers: { range } }); assert.equal(response.status, 416); await response.text(); }
  } finally { await new Promise(resolve => server.close(resolve)); assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); rmSync(dir, { recursive: true, force: true }); }
});

test('withdrawn or stale remote source blocks reader originals as well as retrieval while retaining maintenance access', () => {
  const base = { id: 'b', ownerId: 'editor', visibility: 'company' }, store = { get: () => base }, reader = { id: 'reader', role: 'viewer' }, editor = { id: 'editor', role: 'editor' };
  const doc = { id: 'd', baseId: 'b', ownerId: 'editor', status: 'published' };
  assert.equal(canDocument(reader, doc, store), true); assert.equal(isRetrievable(doc), true);
  for (const source of [{ accessState: 'withdrawn' }, { freshUntil: '2020-01-01T00:00:00Z' }]) {
    const unavailable = { ...doc, source }; assert.equal(canDocument(reader, unavailable, store), false); assert.equal(isRetrievable(unavailable), false); assert.equal(canDocument(editor, unavailable, store, { write: true }), true);
  }
});
