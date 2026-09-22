import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { LOCAL_MODEL_REPOSITORY, LOCAL_MODEL_REVISION, LOCAL_MODEL_DIMENSIONS, LOCAL_MODEL_DIRECTORY, LOCAL_MODEL_ID, localEmbeddingAvailable, localEmbeddingInfo, localEmbeddings } from '../server/local-embeddings.mjs';

const REQUIRED = ['config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','vocab.txt','onnx/model_quantized.onnx','README.md'];
const VERIFY_ONLY = process.argv.includes('--verify-only') || process.argv.includes('--verify');
const metadataUrl = `https://huggingface.co/api/models/${LOCAL_MODEL_REPOSITORY}/revision/${LOCAL_MODEL_REVISION}?blobs=true`;
const sourceCard = 'https://huggingface.co/BAAI/bge-small-zh-v1.5/raw/main/README.md';
const scriptFile = fileURLToPath(import.meta.url);

// Node fetch needs this startup flag to honor an existing enterprise HTTP(S) proxy.
if (!VERIFY_ONLY && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) && process.env.NODE_USE_ENV_PROXY !== '1' && !process.execArgv.includes('--use-env-proxy')) {
  const child = spawn(process.execPath, ['--use-env-proxy', scriptFile, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true, env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  const code = await new Promise(resolve => child.once('close', code => resolve(code ?? 1)));
  process.exit(code);
}

function checksums(contents) { return { sha256: createHash('sha256').update(contents).digest('hex'), gitBlob: createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex') }; }
function checkedTarget(name) { const target = path.resolve(LOCAL_MODEL_DIRECTORY, name); assert.ok(target.startsWith(LOCAL_MODEL_DIRECTORY + path.sep), '模型文件路径必须在固定模型目录内'); return target; }
function verifyBytes(contents, meta) {
  const hashes = checksums(contents);
  assert.equal(contents.length, meta.size, `${meta.rfilename} 文件大小不匹配`);
  if (meta.lfs?.sha256) assert.equal(hashes.sha256, meta.lfs.sha256, `${meta.rfilename} 官方 SHA-256 不匹配`);
  else if (meta.blobId) assert.equal(hashes.gitBlob, meta.blobId, `${meta.rfilename} 官方 Git blob 校验不匹配`);
  return hashes;
}
async function fetchPublic(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000), redirect: 'follow', headers: { 'User-Agent': 'X-RAG-local-model-preparation/1.0' } });
  if (!response.ok) throw new Error(`官方下载失败：HTTP ${response.status}；${new URL(url).pathname}`);
  return response;
}
async function download(meta) {
  const name = meta.rfilename, target = checkedTarget(name), source = `https://huggingface.co/${LOCAL_MODEL_REPOSITORY}/resolve/${LOCAL_MODEL_REVISION}/${name}`;
  if (existsSync(target)) { try { const hashes = verifyBytes(readFileSync(target), meta); console.log(`[已校验] ${name}`); return { path: name, size: meta.size, sha256: hashes.sha256, source, officialSha256: meta.lfs?.sha256 || null, gitBlob: meta.blobId || null }; } catch { console.log(`[重新下载] ${name} 的本地校验未通过`); } }
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.download'; if (existsSync(temporary)) unlinkSync(temporary);
  console.log(`[下载] ${name} (${(meta.size / 1048576).toFixed(2)} MB)`);
  const response = await fetchPublic(source + `?download=true&prepare=${Date.now()}`);
  let received = 0, reported = 0;
  const progress = new Transform({ transform(chunk, encoding, callback) { received += chunk.length; if (received - reported >= 5 * 1048576) { reported = received; console.log(`[进度] ${name}: ${(received / 1048576).toFixed(1)} / ${(meta.size / 1048576).toFixed(1)} MB`); } if (received > meta.size) callback(new Error('下载数据超过官方文件大小')); else callback(null, chunk); } });
  try { await streamPipeline(Readable.fromWeb(response.body), progress, createWriteStream(temporary, { flags: 'wx' })); const contents = readFileSync(temporary), hashes = verifyBytes(contents, meta); if (existsSync(target)) unlinkSync(target); renameSync(temporary, target); return { path: name, size: meta.size, sha256: hashes.sha256, source, officialSha256: meta.lfs?.sha256 || null, gitBlob: meta.blobId || null }; }
  catch(error) { if (existsSync(temporary)) unlinkSync(temporary); throw error; }
}
async function semanticCheck() {
  assert.equal(localEmbeddingAvailable(), true, '本地模型校验失败');
  // A denied fetch proves this check performs inference without any network download or API call.
  const fetchBefore = globalThis.fetch; let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw new Error('离线语义验证禁止网络访问'); };
  const started = Date.now();
  try {
    const documents = [
      '员工因公出差发生的交通费和住宿费，应当取得合法发票。出差结束后五个工作日内提交费用报销申请，由部门负责人审核。',
      '生产设备发生故障时，值班人员应先停止设备运行并断开电源，设置安全警示，再通知维修人员排查故障。',
      '员工申请年休假应提前向直属主管提出，部门结合工作安排审批。休假期间应做好岗位工作交接。',
      '企业重要业务数据每天进行备份，每季度开展恢复演练。备份副本应与生产环境隔离保存。',
    ];
    const questions = ['去外地办事垫付的钱怎样申请返还？', '机器突然坏了，现场应该先做什么？', '想请几天假，需要向谁申请？', '怎样防止系统数据丢失？'];
    const documentVectors = await localEmbeddings(documents);
    const questionVectors = await localEmbeddings(questions, { query: true });
    const rows = questionVectors.map((vector, index) => { const scores = documentVectors.map(candidate => vector.reduce((total, value, dimension) => total + value * candidate[dimension], 0)); const best = scores.indexOf(Math.max(...scores)); return { question: questions[index], expectedDocumentIndex: index, actualDocumentIndex: best, passed: best === index, cosineScores: scores.map(score => Number(score.toFixed(6))) }; });
    for (const vector of [...documentVectors, ...questionVectors]) { assert.equal(vector.length, LOCAL_MODEL_DIMENSIONS); assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-6); assert.ok(vector.every(Number.isFinite)); }
    const repeated = await localEmbeddings(documents);
    assert.ok(repeated[0].reduce((sum,value,index)=>sum+value*documentVectors[0][index],0) > 0.999, '同文重复推理应保持一致');
    assert.equal(networkAttempts, 0, '离线推理不应产生网络请求');
    assert.equal(rows.filter(row => row.passed).length, rows.length, '中文语义检索未通过预设用例');
    const report = { modelId: LOCAL_MODEL_ID, checkedAt: new Date().toISOString(), dimensions: LOCAL_MODEL_DIMENSIONS, dtype: 'q8', pooling: 'cls', normalized: true, offline: true, networkAttempts, casesPassed: rows.length, casesTotal: rows.length, latencyMs: Date.now() - started, rows };
    writeFileSync(checkedTarget('verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`[验证通过] ${rows.length}/${rows.length} 中文语义匹配；${LOCAL_MODEL_DIMENSIONS} 维归一化；网络请求 ${networkAttempts} 次；耗时 ${report.latencyMs} ms`);
    return report;
  } finally { globalThis.fetch = fetchBefore; }
}

try {
  if (!VERIFY_ONLY) {
    console.log('仅从官方模型仓库下载公开模型文件；不读取或上传企业文档。');
    const metadata = await (await fetchPublic(metadataUrl)).json(); assert.equal(metadata.sha, LOCAL_MODEL_REVISION, '官方仓库版本不匹配');
    const files = [];
    for (const name of REQUIRED) { const meta = metadata.siblings?.find(file => file.rfilename === name); assert.ok(meta && meta.size > 0, `官方仓库缺少 ${name}`); files.push(await download(meta)); }
    const config = JSON.parse(readFileSync(checkedTarget('config.json'), 'utf8')); assert.equal(config.hidden_size, LOCAL_MODEL_DIMENSIONS, '模型实际维度不匹配');
    const upstream = await (await fetchPublic(sourceCard)).text(); writeFileSync(checkedTarget('README.upstream.md'), upstream);
    const manifest = { repository: LOCAL_MODEL_REPOSITORY, revision: LOCAL_MODEL_REVISION, modelId: LOCAL_MODEL_ID, downloadedAt: new Date().toISOString(), source: `https://huggingface.co/${LOCAL_MODEL_REPOSITORY}`, upstream: 'https://huggingface.co/BAAI/bge-small-zh-v1.5', upstreamCard: sourceCard, license: 'MIT', dimensions: LOCAL_MODEL_DIMENSIONS, dtype: 'q8', pooling: 'cls', normalized: true, queryInstruction: '为这个句子生成表示以用于检索相关文章：', files };
    writeFileSync(checkedTarget('manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`[模型已保存] ${LOCAL_MODEL_DIRECTORY}`);
  }
  await semanticCheck();
  console.log(JSON.stringify(localEmbeddingInfo(), null, 2));
} catch(error) { console.error(`本地模型准备未完成：${error.message}`); process.exitCode = 1; }
