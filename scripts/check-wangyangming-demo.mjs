/**
 * Demo readiness check for 王阳明专题咨询
 */
const API = (process.env.API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
let cookie = '';

async function api(method, route, body) {
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
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 800) }; }
  return { status: res.status, data };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitRun(id, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status, data } = await api('GET', `/api/chat/runs/${encodeURIComponent(id)}`);
    if (status !== 200) return { httpStatus: status, status: 'http_error', data, result: null };
    const run = data.run || data;
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) return run;
    await sleep(1500);
  }
  throw new Error('run timeout: ' + id);
}

async function main() {
  const report = { ok: true, checks: [] };
  const push = (name, pass, detail) => {
    report.checks.push({ name, pass, detail });
    if (!pass) report.ok = false;
  };

  let me = await api('GET', '/api/auth/me');
  if (me.status === 404) me = await api('GET', '/api/session');
  if (me.status === 404) me = await api('GET', '/api/users/me');
  push('auth', me.status === 200 && !!(me.data?.user || me.data?.id || me.data?.username), {
    status: me.status,
    user: me.data?.user
      ? { username: me.data.user.username, role: me.data.user.role }
      : me.data && { username: me.data.username, role: me.data.role },
  });

  const caps = await api('GET', '/api/intelligence/capabilities');
  push('model_configured', caps.status === 200 && caps.data?.model?.configured === true, {
    status: caps.status,
    model: caps.data?.model,
  });

  const bases = await api('GET', '/api/bases');
  const base = (bases.data?.bases || []).find(b => String(b.name || '').includes('王阳明'));
  push('knowledge_base', !!base, base ? { id: base.id, name: base.name } : { status: bases.status });

  let publishedDocs = [];
  if (base) {
    const docs = await api('GET', `/api/documents?baseId=${encodeURIComponent(base.id)}&limit=100`);
    const list = docs.data?.documents || [];
    publishedDocs = list.filter(d => d.status === 'published');
    push('published_docs', publishedDocs.length >= 4, {
      published: publishedDocs.map(d => ({ title: d.title, chunks: d.chunkCount, fileName: d.fileName })),
      other: list.filter(d => d.status !== 'published').map(d => ({ title: d.title, status: d.status })),
    });
  }

  const scenarios = await api('GET', '/api/scenarios');
  const sc = (scenarios.data?.scenarios || []).find(s => String(s.name || '').includes('王阳明'));
  const versions = sc?.versions || [];
  const active = versions.find(v => v.id === sc.activeVersionId) || versions.find(v => v.status === 'published' || v.published);
  push('scenario_published', !!(sc && active), {
    scenario: sc && { id: sc.id, name: sc.name, activeVersionId: sc.activeVersionId },
    active: active && { id: active.id, version: active.version, status: active.status },
    allVersions: versions.map(v => ({ id: v.id, version: v.version, status: v.status })),
  });

  if (!base || !active) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const question = '王阳明龙场悟道是怎么回事？请结合知识库说明。';
  const created = await api('POST', '/api/chat/runs', {
    question,
    baseId: base.id,
    scenarioVersionId: active.id,
    clientRequestId: `demo-check-${Date.now()}`,
  });
  push('chat_enqueue', created.status === 202 && !!(created.data?.run?.id || created.data?.id), {
    status: created.status,
    error: created.data?.error,
    runId: created.data?.run?.id || created.data?.id,
  });

  if (created.status === 202) {
    const runId = created.data.run?.id || created.data.id;
    const run = await waitRun(runId);
    const result = run.result || {};
    const answer = result.answer || result.content || '';
    const citations = result.citations || [];
    const mode = result.mode;
    const good = run.status === 'succeeded' && mode === 'model' && answer.length > 40 && citations.length > 0;
    push('chat_answer', good, {
      runStatus: run.status,
      mode,
      citationCount: citations.length,
      answerPreview: String(answer).slice(0, 280),
      warning: result.warning,
      error: run.error || run.errorCode,
    });
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 2);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
