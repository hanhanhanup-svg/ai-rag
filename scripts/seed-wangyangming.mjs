/**
 * Seed 王阳明专题知识库 + 业务咨询场景
 * Usage (API must be running):
 *   node --env-file-if-exists=.env.local scripts/seed-wangyangming.mjs
 * Env:
 *   SEED_USER / SEED_PASSWORD (default admin / WangYangming2026!)
 *   API_BASE (default http://127.0.0.1:8787)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const USER = process.env.SEED_USER || 'admin';
const PASS = process.env.SEED_PASSWORD || 'WangYangming2026!';

const FILES = [
  { path: 'C:/Users/Administrator/Downloads/王阳明传习录详注集评.pdf', title: '王阳明传习录详注集评', kind: 'pdf' },
  { path: path.join(root, 'data/wangyangming-transcripts/王阳明传奇·家世渊源.md'), title: '王阳明传奇·家世渊源（音频转写）', kind: 'transcript', audio: '077.王阳明传奇：家世渊源.mp3' },
  { path: path.join(root, 'data/wangyangming-transcripts/王阳明传奇·不羁少年.md'), title: '王阳明传奇·不羁少年（音频转写）', kind: 'transcript', audio: '078.王阳明传奇：不羁少年.mp3' },
  { path: path.join(root, 'data/wangyangming-transcripts/王阳明传奇·龙场悟道.md'), title: '王阳明传奇·龙场悟道（音频转写）', kind: 'transcript', audio: '079.王阳明传奇：龙场悟道.mp3' },
  { path: path.join(root, 'data/wangyangming-transcripts/王阳明传奇·平定叛乱.md'), title: '王阳明传奇·平定叛乱（音频转写）', kind: 'transcript', audio: '080.王阳明传奇：平定叛乱.mp3' },
];

let cookie = '';

async function api(method, route, body, { raw = false, retries = 8 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(API + route, {
        method,
        headers: {
          Origin: ORIGIN,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.() || [];
      for (const line of set) {
        const m = String(line).match(/^xrag_session=[^;]+/);
        if (m) cookie = m[0];
      }
      const single = res.headers.get('set-cookie');
      if (single) {
        const m = single.match(/^xrag_session=[^;]+/);
        if (m) cookie = m[0];
      }
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (res.status === 401 && attempt === 0 && route !== '/api/auth/login') {
        await fetch(API + '/api/auth/login', {
          method: 'POST',
          headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: USER, password: PASS }),
        }).then(async r => {
          const sc = r.headers.get('set-cookie');
          const m = sc && sc.match(/^xrag_session=[^;]+/);
          if (m) cookie = m[0];
        });
        continue;
      }
      if (!res.ok) {
        const err = new Error(`${method} ${route} → ${res.status} ${data?.error?.message || text.slice(0, 200)}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return raw ? { status: res.status, data, headers: res.headers } : data;
    } catch (error) {
      lastError = error;
      if (error.status && error.status < 500 && error.status !== 401) throw error;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastError;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitDocument(id, { timeoutMs = 45 * 60 * 1000 } = {}) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const { document } = await api('GET', `/api/documents/${encodeURIComponent(id)}`);
    const stamp = `${document.status}:${document.stage}:${document.progress}:${document.chunkCount || 0}`;
    if (stamp !== last) {
      console.log(`  … ${document.title || id} → ${document.status} / ${document.stage || '-'} / ${document.progress || 0}% / chunks=${document.chunkCount || 0}`);
      last = stamp;
    }
    if (document.status === 'review' || document.status === 'published') return document;
    if (document.status === 'failed') {
      throw new Error(`解析失败：${document.error || document.message || id}`);
    }
    await sleep(5000);
  }
  throw new Error(`等待文档超时：${id}`);
}

async function main() {
  console.log('1) 登录…');
  try {
    await api('POST', '/api/auth/login', { username: USER, password: PASS });
  } catch (error) {
    if (error.status === 409 || String(error.message).includes('LOCAL_ACCESS')) {
      console.log('  本机免登录模式，跳过账号登录');
      cookie = '';
    } else {
      console.warn('  登录失败，尝试本机免登录继续：', error.message);
      cookie = '';
    }
  }
  console.log('2) 创建/复用知识库…');
  const { bases } = await api('GET', '/api/bases');
  let base = bases.find(b => b.name === '王阳明专题知识库');
  if (!base) {
    ({ base } = await api('POST', '/api/bases', {
      name: '王阳明专题知识库',
      description: '围绕王阳明生平传奇音频与《传习录》详注集评的专题咨询知识库，用于心学要义、龙场悟道、事功经历等问答。',
      visibility: 'company',
      department: '人文研习',
    }));
    console.log('  已创建', base.id);
  } else {
    console.log('  已存在', base.id);
  }

  const publishedIds = [];
  console.log('3) 上传并发布资料…');
  const { documents: existingDocs } = await api('GET', `/api/documents?baseId=${encodeURIComponent(base.id)}&limit=200`);
  for (const file of FILES) {
    if (!fs.existsSync(file.path)) {
      console.warn('  暂缺，稍后补传：', file.title);
      continue;
    }
    const fileName = path.basename(file.path);
    const already = (existingDocs || []).find(d => d.fileName === fileName && ['published', 'review', 'queued', 'processing', 'failed'].includes(d.status));
    if (already?.status === 'published') {
      console.log(`  跳过已发布 ${fileName} → ${already.id}`);
      publishedIds.push(already.id);
      continue;
    }
    if (already?.status === 'failed') {
      console.log(`  重试失败文档 ${fileName} → ${already.id}`);
      await api('POST', `/api/documents/${encodeURIComponent(already.id)}/actions`, {
        action: 'retry', revision: already.revision, reason: '专题入库重试解析',
      });
      let doc = await waitDocument(already.id);
      if (doc.status === 'review') {
        const pub = await api('POST', `/api/documents/${encodeURIComponent(doc.id)}/actions`, {
          action: 'publish', revision: doc.revision, reason: '王阳明专题资料入库发布',
        });
        doc = pub.document;
      }
      publishedIds.push(doc.id);
      continue;
    }
    if (already && (already.status === 'queued' || already.status === 'processing' || already.status === 'review')) {
      console.log(`  续传已有任务 ${fileName} → ${already.id} (${already.status})`);
      let doc = await waitDocument(already.id);
      if (doc.status === 'review') {
        const pub = await api('POST', `/api/documents/${encodeURIComponent(doc.id)}/actions`, {
          action: 'publish', revision: doc.revision, reason: '王阳明专题资料入库发布',
        });
        doc = pub.document;
      }
      publishedIds.push(doc.id);
      continue;
    }
    const bytes = fs.readFileSync(file.path);
    console.log(`  上传 ${fileName} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)…`);
    const uploaded = await api('POST', '/api/documents', {
      baseId: base.id,
      fileName,
      title: file.title,
      contentBase64: bytes.toString('base64'),
      sensitivity: 'internal',
      sourceKind: 'reference',
      applicability: file.kind === 'transcript'
        ? `王阳明传奇音频「${file.audio}」的本地转写稿，用于生平与心学专题咨询；专名与引文需对照《传习录》详注及原音核对。`
        : '王阳明生平、心学思想、传习录解读与专题咨询；回答须区分典籍注释与传奇口述，并回引原文证据。',
      businessOwner: '人文研习',
      duplicateAction: 'version',
    });
    let doc = uploaded.document;
    console.log(`  已接收 ${doc.id} status=${doc.status}`);
    doc = await waitDocument(doc.id);
    if (doc.status === 'review') {
      const pub = await api('POST', `/api/documents/${encodeURIComponent(doc.id)}/actions`, {
        action: 'publish',
        revision: doc.revision,
        reason: '王阳明专题资料入库发布',
      });
      doc = pub.document;
      console.log(`  已发布 ${doc.id}`);
    }
    publishedIds.push(doc.id);
  }

  console.log('4) 创建专题咨询业务场景…');
  const evaluationCases = [
    {
      question: '王阳明龙场悟道大致发生在什么背景？他悟到了什么？',
      expectedTerms: ['龙场', '心即理'],
      mustRefuse: false,
      baseId: base.id,
    },
    {
      question: '根据专题资料，简要说明《传习录》主要讨论什么？',
      expectedTerms: ['传习录', '心学'],
      mustRefuse: false,
      baseId: base.id,
    },
    {
      question: '王阳明少年时期有哪些不羁的表现？请依据音频资料说明。',
      expectedTerms: ['少年'],
      mustRefuse: false,
      baseId: base.id,
    },
    {
      question: '请给出2026年上海地铁最新票价表。',
      mustRefuse: true,
      baseId: base.id,
    },
  ];

  const created = await api('POST', '/api/scenarios', {
    name: '王阳明专题咨询',
    scenario: 'wangyangming_consulting',
    goal: '面向读者与研习者，基于本库《王阳明传奇》音频转写与《传习录详注集评》回答王阳明家世、生平、龙场悟道、事功与心学要义。答复必须引用库内证据；区分传奇口述与典籍注释；资料不足时明确说明依据不足，不得编造语录出处、年代或军功细节。',
    allowedTools: [],
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', title: '关注点（可选）', description: '如龙场悟道、传习录、平定宁王等' },
      },
      required: [],
    },
    outputSchema: {
      type: 'object',
      properties: {
        answer: { type: 'string', title: '专题答复' },
        limitations: { type: 'string', title: '依据范围与待核对事项' },
      },
      required: ['answer'],
    },
    evaluationCases,
  });

  const scenario = created.scenario || created;
  const version = (scenario.versions || []).sort((a, b) => b.version - a.version)[0]
    || created.version
    || (await api('GET', `/api/scenarios/${scenario.id}`)).scenario?.versions?.[0];

  console.log('  场景', scenario.id, '版本', version?.id, version?.status);

  let published = false;
  if (version?.id) {
    console.log('5) 运行场景评测…');
    try {
      const evalRes = await api('POST', `/api/scenario-versions/${encodeURIComponent(version.id)}/evaluate`, {
        revision: version.revision,
        clientRequestId: crypto.randomUUID(),
      });
      let evaluation = evalRes.evaluation;
      const evalId = evaluation?.id || version.evaluationRef;
      for (let i = 0; i < 120 && evaluation && evaluation.status !== 'completed' && evaluation.status !== 'failed'; i++) {
        await sleep(3000);
        if (evalId) {
          try { evaluation = (await api('GET', `/api/scenario-evaluations/${encodeURIComponent(evalId)}`)).evaluation; }
          catch { /* keep */ }
        }
        const detail = await api('GET', `/api/scenarios/${encodeURIComponent(scenario.id)}`);
        const v = detail.scenario?.versions?.find(row => row.id === version.id);
        if (v?.evaluation) evaluation = v.evaluation;
        process.stdout.write(`  评测状态 ${evaluation?.status || '…'} passed=${evaluation?.passed ?? '-'} / ${evaluation?.total ?? '-'}\r`);
      }
      console.log('');
      console.log('  评测结果', JSON.stringify({ status: evaluation?.status, passed: evaluation?.passed, total: evaluation?.total }, null, 2));

      const fresh = await api('GET', `/api/scenarios/${encodeURIComponent(scenario.id)}`);
      const current = fresh.scenario?.versions?.find(row => row.id === version.id) || version;
      if (current.status === 'review' || evaluation?.passed === evaluation?.total) {
        console.log('6) 发布场景…');
        await api('POST', `/api/scenario-versions/${encodeURIComponent(version.id)}/publish`, {
          revision: current.revision,
          clientRequestId: crypto.randomUUID(),
        });
        published = true;
      }
    } catch (error) {
      console.warn('  评测/发布未完成：', error.message);
    }
  }

  console.log('\n完成摘要');
  console.log(JSON.stringify({
    baseId: base.id,
    baseName: base.name,
    documents: publishedIds,
    scenarioId: scenario.id,
    scenarioVersionId: version?.id,
    scenarioPublished: published,
    chatUrl: `http://localhost:5173/application/chat?baseId=${encodeURIComponent(base.id)}`,
    scenarioChatUrl: version?.id
      ? `http://localhost:5173/application/chat?scenarioVersionId=${encodeURIComponent(version.id)}&baseId=${encodeURIComponent(base.id)}`
      : null,
    findUrl: 'http://localhost:5173/application/find?q=' + encodeURIComponent('王阳明龙场悟道'),
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
