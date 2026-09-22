// Scheduling policy only. This module never calls a model or modifies storage.
export const INDEX_MAX_ATTEMPTS = 3;
export const INDEX_RETRY_DELAYS_MS = Object.freeze([30000, 120000]);
const PERMANENT_ERRORS = new Set(['MODEL_AUTH_FAILED', 'MODEL_NOT_CONFIGURED', 'INVALID_MODEL_URL', 'MODEL_HTTPS_REQUIRED', 'MODEL_ADDRESS_DENIED', 'EMBEDDING_INVALID_RESPONSE', 'DOCUMENT_NOT_FOUND']);

export function indexContentRevision(document) { return document?.contentRevision || 1; }

/** Check immediately after every await, before writing any vector or ready/failed state. */
export function indexSnapshotCurrent(snapshot, currentDocument, currentSignature) {
  return !!currentDocument && !currentDocument.deletedAt && currentDocument.id === snapshot.documentId && indexContentRevision(currentDocument) === snapshot.contentRevision && currentSignature === snapshot.signature && !['archived', 'superseded'].includes(currentDocument.status);
}

export function indexSnapshot(document, signature) {
  return { documentId: document.id, contentRevision: indexContentRevision(document), signature };
}

function matchingRetry(document, signature) {
  const state = document?.embeddingRetry;
  return state?.signature === signature && state.contentRevision === indexContentRevision(document) ? state : null;
}

/** Persist this object with failed state; each new task keeps the earlier failed task intact. */
export function indexRetryAfterFailure(document, signature, error, now = Date.now()) {
  const previous = matchingRetry(document, signature);
  const failures = (Number.isSafeInteger(previous?.failures) ? previous.failures : 0) + 1;
  const errorCode = typeof error?.code === 'string' ? error.code : 'INDEX_FAILED';
  const retryable = !PERMANENT_ERRORS.has(errorCode);
  const exhausted = failures >= INDEX_MAX_ATTEMPTS;
  return {
    signature, contentRevision: indexContentRevision(document), failures, errorCode, retryable, exhausted,
    failedAt: new Date(now).toISOString(),
    nextAttemptAt: retryable && !exhausted ? new Date(now + INDEX_RETRY_DELAYS_MS[failures - 1]).toISOString() : null,
  };
}

/** Called only after model availability and complete-vector checks in queueIndex. */
export function indexRetryAllowed(document, signature, { force = false, now = Date.now() } = {}) {
  if (!document || document.deletedAt || ['archived', 'superseded'].includes(document.status)) return false;
  if (force || document.embeddingStatus !== 'failed' || document.embeddingSignature !== signature) return true;
  const state = matchingRetry(document, signature);
  if (!state) {
    // An old failure has no attempt ledger. Allow a bounded recovery sequence,
    // while still waiting briefly after its last recorded attempt.
    const failedAt = Date.parse(document.embeddingUpdatedAt || '') || 0;
    return now >= failedAt + INDEX_RETRY_DELAYS_MS[0];
  }
  return state.retryable === true && state.exhausted !== true && state.failures < INDEX_MAX_ATTEMPTS && !!state.nextAttemptAt && now >= Date.parse(state.nextAttemptAt);
}

/** Successful indexing, explicit rebuild, or materially new input starts a fresh budget. */
export function clearIndexRetry() { return { embeddingRetry: null }; }
