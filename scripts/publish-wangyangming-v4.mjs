import { setTimeout as sleep } from 'node:timers/promises';

const API = 'http://127.0.0.1:8787';
const ORIGIN = 'http://localhost:5173';
const scenarioId = 'scenario_003b446d-6213-428d-86f6-3b385b794099';
const versionId = 'prompt_f9c7c2f8-d67c-4017-a5ce-e535e0dd7ce7';

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

const detail0 = await api('GET', `/api/scenarios/${scenarioId}`);
const version0 = detail0.scenario.versions.find(v => v.id === versionId);
console.log('start', version0.status, version0.revision);

await api('POST', `/api/scenario-versions/${versionId}/evaluate`, {
  revision: version0.revision,
  clientRequestId: crypto.randomUUID(),
});

let evaluation;
for (let i = 0; i < 90; i++) {
  await sleep(4000);
  const fresh = await api('GET', `/api/scenarios/${scenarioId}`);
  const cur = fresh.scenario.versions.find(v => v.id === versionId);
  if (cur?.evaluationRef) {
    try { evaluation = (await api('GET', `/api/scenario-evaluations/${cur.evaluationRef}`)).evaluation; }
    catch { /* keep */ }
  }
  console.log(`tick ${i} status=${cur.status} eval=${evaluation?.status} ${evaluation?.passed}/${evaluation?.total}`);
  if (evaluation?.status === 'completed' || evaluation?.status === 'failed') break;
}

console.log(JSON.stringify(evaluation?.results?.map(r => ({
  i: r.index, passed: r.passed, mode: r.mode, missing: r.missingTerms, refusal: r.refusal,
})), null, 2));

if (evaluation?.passed === evaluation?.total && evaluation?.total > 0) {
  const cur = (await api('GET', `/api/scenarios/${scenarioId}`)).scenario.versions.find(v => v.id === versionId);
  const pub = await api('POST', `/api/scenario-versions/${versionId}/publish`, {
    revision: cur.revision,
    clientRequestId: crypto.randomUUID(),
  });
  console.log('PUBLISHED', pub.version.status, pub.version.id);
} else {
  console.log('NOT_PUBLISHED', evaluation?.passed, '/', evaluation?.total);
  process.exitCode = 2;
}
