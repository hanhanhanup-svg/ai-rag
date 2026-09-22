import { setTimeout as sleep } from 'node:timers/promises';

const API = 'http://127.0.0.1:8787';
const ORIGIN = 'http://localhost:5173';
const baseId = 'base_a066d077-f1ad-406b-8216-dc7f05793277';
const scenarioId = 'scenario_003b446d-6213-428d-86f6-3b385b794099';

async function api(method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${data?.error?.message || text}`);
  return data;
}

const created = await api('POST', `/api/scenarios/${scenarioId}/versions`, {
  name: '王阳明专题咨询',
  scenario: 'wangyangming_consulting',
  goal: '面向读者与研习者，基于本库《王阳明传奇》音频转写与《传习录详注集评》回答王阳明家世、生平、龙场悟道、事功与心学要义。答复必须引用库内证据；区分传奇口述与典籍注释；资料不足时明确说明依据不足。',
  allowedTools: [],
  inputSchema: { type: 'object', properties: { focus: { type: 'string', title: '关注点' } }, required: [] },
  outputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string', title: '专题答复' },
      limitations: { type: 'string', title: '依据范围' },
    },
    required: ['answer'],
  },
  evaluationCases: [
    {
      question: '《传习录》这部书与王阳明有什么关系？请依据库内资料简要说明。',
      expectedTerms: ['传习录'],
      mustRefuse: false,
      baseId,
    },
    {
      question: '请给出2026年上海地铁最新票价表与购票二维码。',
      mustRefuse: true,
      baseId,
    },
  ],
});

const version = created.version;
console.log('version', version.id, 'v' + version.version);

await api('POST', `/api/scenario-versions/${version.id}/evaluate`, {
  revision: version.revision,
  clientRequestId: crypto.randomUUID(),
});

let evaluation;
for (let i = 0; i < 90; i += 1) {
  await sleep(4000);
  const fresh = await api('GET', `/api/scenarios/${scenarioId}`);
  const cur = fresh.scenario.versions.find(v => v.id === version.id);
  if (cur?.evaluationRef) {
    try { evaluation = (await api('GET', `/api/scenario-evaluations/${cur.evaluationRef}`)).evaluation; }
    catch { /* keep polling */ }
  }
  console.log(`tick ${i} ${cur?.status} ${evaluation?.status} ${evaluation?.passed}/${evaluation?.total}`);
  if (evaluation?.status === 'completed' || evaluation?.status === 'failed') break;
}

console.log(JSON.stringify(evaluation?.results?.map(r => ({
  i: r.index, passed: r.passed, mode: r.mode, missing: r.missingTerms,
})), null, 2));

if (evaluation?.passed === evaluation?.total && evaluation?.total > 0) {
  const cur = (await api('GET', `/api/scenarios/${scenarioId}`)).scenario.versions.find(v => v.id === version.id);
  const pub = await api('POST', `/api/scenario-versions/${version.id}/publish`, {
    revision: cur.revision,
    clientRequestId: crypto.randomUUID(),
  });
  console.log('PUBLISHED', pub.version.status, pub.version.id);
  console.log('chat', `http://localhost:5173/application/chat?scenarioVersionId=${pub.version.id}&baseId=${baseId}`);
} else {
  console.log('NOT_PUBLISHED');
  process.exitCode = 2;
}
