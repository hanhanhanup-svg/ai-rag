import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { requireValue } from './security.mjs';

export const MEDIA_MIME_TYPES = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/flac', 'video/mp4', 'video/webm', 'video/quicktime'];
export function validMediaHeader(mime, header) {
  if (mime === 'audio/wav') return header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WAVE';
  if (mime === 'audio/mpeg') return header.subarray(0, 3).toString() === 'ID3' || (header[0] === 255 && (header[1] & 224) === 224);
  if (mime === 'audio/mp4' || mime === 'video/mp4' || mime === 'video/quicktime') return header.subarray(4, 8).toString() === 'ftyp';
  if (mime === 'video/webm') return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (mime === 'audio/ogg') return header.subarray(0, 4).toString() === 'OggS';
  if (mime === 'audio/flac') return header.subarray(0, 4).toString() === 'fLaC';
  return false;
}
export function sendStoredFile(req, res, filePath, { mimeType, fileName, preview }) {
  const size = statSync(filePath).size; let start = 0, end = size - 1, status = 200;
  const headers = { 'Content-Type': mimeType, 'Accept-Ranges': 'bytes', 'Content-Disposition': (preview ? 'inline' : 'attachment') + '; filename="download' + path.extname(fileName) + '"; filename*=UTF-8\'\'' + encodeURIComponent(fileName), 'Cache-Control': 'private, no-store', 'Content-Security-Policy': preview ? "default-src 'none'; media-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'" : "sandbox; default-src 'none'; frame-ancestors 'none'" };
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    res.setHeader('Content-Range', 'bytes */' + size);
    requireValue(match && (match[1] || match[2]), 416, 'INVALID_RANGE', '仅支持一个有效的文件字节区间。');
    if (!match[1]) { const suffix = Number(match[2]); requireValue(Number.isSafeInteger(suffix) && suffix > 0, 416, 'INVALID_RANGE', '文件区间无效。'); start = Math.max(0, size - suffix); }
    else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
    requireValue(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start, 416, 'INVALID_RANGE', '文件区间超出原件范围。');
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end();
  else { const stream = createReadStream(filePath, { start, end }); stream.on('error', () => res.destroy()); res.once('close', () => stream.destroy()); stream.pipe(res); }
}
