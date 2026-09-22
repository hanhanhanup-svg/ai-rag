import test from 'node:test';
import assert from 'node:assert/strict';
import { INDEX_MAX_ATTEMPTS, indexRetryAfterFailure, indexRetryAllowed, indexSnapshot, indexSnapshotCurrent, clearIndexRetry } from './index-scheduling.mjs';

const signature = 'local://bge|local:model';
const at = Date.parse('2026-09-08T00:00:00Z');
const original = { id: 'doc-1', contentRevision: 1, status: 'review', embeddingStatus: 'pending', embeddingSignature: signature };

test('transient failures retry after 30 seconds then two minutes, with three total attempts', () => {
  let document = { ...original, embeddingStatus: 'failed', embeddingUpdatedAt: new Date(at).toISOString() };
  document.embeddingRetry = indexRetryAfterFailure(document, signature, { code: 'MODEL_UNAVAILABLE' }, at);
  assert.equal(document.embeddingRetry.failures, 1);
  assert.equal(indexRetryAllowed(document, signature, { now: at + 29999 }), false);
  assert.equal(indexRetryAllowed(document, signature, { now: at + 30000 }), true);
  document.embeddingRetry = indexRetryAfterFailure(document, signature, { code: 'MODEL_RATE_LIMIT' }, at + 30000);
  assert.equal(indexRetryAllowed(document, signature, { now: at + 149999 }), false);
  assert.equal(indexRetryAllowed(document, signature, { now: at + 150000 }), true);
  document.embeddingRetry = indexRetryAfterFailure(document, signature, { code: 'MODEL_UNAVAILABLE' }, at + 150000);
  assert.equal(document.embeddingRetry.failures, INDEX_MAX_ATTEMPTS);
  assert.equal(document.embeddingRetry.nextAttemptAt, null);
  assert.equal(document.embeddingRetry.exhausted, true);
  assert.equal(indexRetryAllowed(document, signature, { now: at + 86400000 }), false);
});

test('permanent credential or invalid-output failures do not repeatedly spend calls', () => {
  for (const code of ['MODEL_AUTH_FAILED', 'MODEL_NOT_CONFIGURED', 'MODEL_ADDRESS_DENIED', 'EMBEDDING_INVALID_RESPONSE']) {
    const document = { ...original, embeddingStatus: 'failed', embeddingRetry: indexRetryAfterFailure(original, signature, { code }, at) };
    assert.equal(document.embeddingRetry.retryable, false);
    assert.equal(indexRetryAllowed(document, signature, { now: at + 86400000 }), false);
    assert.equal(indexRetryAllowed(document, signature, { force: true, now: at }), true);
  }
});

test('legacy failed documents recover automatically with a finite new attempt budget', () => {
  const document = { ...original, embeddingStatus: 'failed', embeddingUpdatedAt: new Date(at).toISOString() };
  assert.equal(indexRetryAllowed(document, signature, { now: at + 29999 }), false);
  assert.equal(indexRetryAllowed(document, signature, { now: at + 30000 }), true);
  document.embeddingRetry = indexRetryAfterFailure(document, signature, {}, at + 30000);
  assert.equal(document.embeddingRetry.failures, 1);
});

test('new content/model and successful indexing reset the attempt budget', () => {
  let document = { ...original, embeddingStatus: 'failed' };
  document.embeddingRetry = indexRetryAfterFailure(document, signature, {}, at);
  document.embeddingRetry = indexRetryAfterFailure(document, signature, {}, at);
  const changed = { ...document, contentRevision: 2, embeddingStatus: 'pending' };
  assert.equal(indexRetryAfterFailure(changed, signature, {}, at).failures, 1);
  assert.equal(indexRetryAfterFailure(document, 'different-model', {}, at).failures, 1);
  assert.equal(indexRetryAllowed(document, 'different-model', { now: at }), true);
  assert.deepEqual(clearIndexRetry(), { embeddingRetry: null });
  assert.equal(indexRetryAfterFailure({ ...document, ...clearIndexRetry() }, signature, {}, at).failures, 1);
});

test('in-flight vectors cannot commit against edited content, a changed model, or removed knowledge', () => {
  const snapshot = indexSnapshot(original, signature);
  assert.equal(indexSnapshotCurrent(snapshot, { ...original, status: 'published' }, signature), true);
  assert.equal(indexSnapshotCurrent(snapshot, { ...original, contentRevision: 2 }, signature), false);
  assert.equal(indexSnapshotCurrent(snapshot, original, 'different-model'), false);
  assert.equal(indexSnapshotCurrent(snapshot, null, signature), false);
  assert.equal(indexSnapshotCurrent(snapshot, { ...original, id: 'doc-2' }, signature), false);
  for (const status of ['archived', 'superseded']) assert.equal(indexSnapshotCurrent(snapshot, { ...original, status }, signature), false);
  assert.equal(indexSnapshot({ id: 'legacy' }, signature).contentRevision, 1);
});
