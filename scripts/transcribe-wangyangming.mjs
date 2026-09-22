/**
 * Offline-transcribe Wang Yangming MP3s into markdown evidence files.
 * node scripts/transcribe-wangyangming.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'data', 'wangyangming-transcripts');
const py = 'D:/ai-project/ai-rag/.runtime/asr-env/Scripts/python.exe';
const script = path.join(root, 'scripts', 'asr-local.py');
const files = [
  { src: 'C:/Users/Administrator/Music/077.王阳明传奇：家世渊源.mp3', title: '王阳明传奇·家世渊源' },
  { src: 'C:/Users/Administrator/Music/078.王阳明传奇：不羁少年.mp3', title: '王阳明传奇·不羁少年' },
  { src: 'C:/Users/Administrator/Music/079.王阳明传奇：龙场悟道.mp3', title: '王阳明传奇·龙场悟道' },
  { src: 'C:/Users/Administrator/Music/080.王阳明传奇：平定叛乱.mp3', title: '王阳明传奇·平定叛乱' },
];

fs.mkdirSync(outDir, { recursive: true });

function runOne(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(py, [script, '--input', file.src], { windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`${file.title} ASR failed: ${err || out}`));
      try {
        const json = JSON.parse(out.trim());
        resolve(json);
      } catch (e) {
        reject(new Error(`${file.title} invalid JSON: ${e.message}`));
      }
    });
  });
}

for (const file of files) {
  const mdPath = path.join(outDir, `${file.title}.md`);
  if (fs.existsSync(mdPath) && fs.statSync(mdPath).size > 500) {
    console.log('skip existing', file.title);
    continue;
  }
  console.log('transcribing', file.title, '…');
  const result = await runOne(file);
  const body = [
    `# ${file.title}`,
    '',
    `> 来源音频：${path.basename(file.src)}`,
    `> 转写模型：${result.model || 'faster-whisper'}；时长约 ${Math.round((result.durationMs || 0) / 60000)} 分钟；覆盖：${result.coverage}`,
    `> 说明：本地语音识别草稿，专名、年代、引文需结合原音与《传习录》文本核对。`,
    '',
    ...(result.segments || []).map(seg => {
      const start = Math.floor(seg.startMs / 1000);
      const m = String(Math.floor(start / 60)).padStart(2, '0');
      const s = String(start % 60).padStart(2, '0');
      return `- [${m}:${s}] ${seg.text}`;
    }),
    '',
  ].join('\n');
  fs.writeFileSync(mdPath, body, 'utf8');
  console.log('wrote', mdPath, `(${result.segments?.length || 0} segments)`);
}

console.log('done', outDir);
