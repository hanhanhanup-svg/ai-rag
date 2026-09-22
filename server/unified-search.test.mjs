import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeUnifiedIntent, unifiedSearchSpec } from './unified-search.mjs';

test('graph-oriented questions prefer the graph channel', () => {
  const intent = analyzeUnifiedIntent('设备台账与维修工单有什么关联？');
  assert.equal(intent.channels.find(row => row.id === 'graph')?.selected, true);
  assert.ok(intent.matchedScenarios.some(row => row.id === 'maintenance'));
});

test('scenario keywords surface business scenarios', () => {
  const intent = analyzeUnifiedIntent('交接班需要准备哪些运营资料');
  assert.equal(intent.channels.find(row => row.id === 'scenarios')?.selected, true);
  assert.ok(intent.matchedScenarios.some(row => row.id === 'operations'));
});

test('spec documents the public contract', () => {
  const spec = unifiedSearchSpec();
  assert.equal(spec.endpoint, 'GET /api/unified-search');
  assert.ok(spec.query.some(row => row.name === 'q' && row.required));
});
