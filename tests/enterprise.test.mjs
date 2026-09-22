import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createApp } from '../server/api.mjs';
import { restoreBackup } from '../scripts/restore.mjs';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PASSWORD = 'OnlyLocalTestPassword123!';
const VIEWER_EMAIL = 'reader@example.invalid';
const CLIENT_ID = 'xrag-integration-test';

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
}
async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function cookieValue(response, name) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') || ''];
  return values.find(value => value.startsWith(name + '='))?.split(';')[0] || '';
}
function jsonResponse(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

// This IdP has no upstream provider and cannot obtain any real credentials.
async function mockIdentityProvider() {
  const valid = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  const rogue = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  const jwk = { ...(await exportJWK(valid.publicKey)), kid: 'local-test-key', alg: 'RS256', use: 'sig' };
  const codes = new Map(), exchanges = [];
  let issuer, applicationOrigin;
  const { server, origin } = await listen(async (req, res) => {
    try {
      const url = new URL(req.url, issuer);
      if (url.pathname === '/.well-known/openid-configuration') {
        return jsonResponse(res, 200, { issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks', response_types_supported: ['code'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'] });
      }
      if (url.pathname === '/jwks') return jsonResponse(res, 200, { keys: [jwk] });
      if (url.pathname === '/authorize') {
        assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
        assert.equal(url.searchParams.get('response_type'), 'code');
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(url.searchParams.get('redirect_uri'), applicationOrigin + '/api/auth/sso/callback');
        assert.match(url.searchParams.get('scope'), /openid/);
        const state = url.searchParams.get('state'), nonce = url.searchParams.get('nonce'), challenge = url.searchParams.get('code_challenge');
        assert.ok(state?.length >= 40 && nonce?.length >= 40 && challenge?.length >= 40);
        const code = crypto.randomBytes(24).toString('base64url');
        codes.set(code, { state, nonce, challenge, variant: url.searchParams.get('test_case') || 'valid', redirect: url.searchParams.get('redirect_uri') });
        const redirect = new URL(applicationOrigin + '/api/auth/sso/callback');
        redirect.searchParams.set('code', code); redirect.searchParams.set('state', state);
        res.writeHead(302, { Location: redirect.toString() }); res.end(); return;
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const parts = []; for await (const part of req) parts.push(part);
        const body = new URLSearchParams(Buffer.concat(parts).toString());
        const code = body.get('code'), saved = codes.get(code);
        if (!saved) return jsonResponse(res, 400, { error: 'invalid_grant' });
        codes.delete(code);
        const actualChallenge = crypto.createHash('sha256').update(body.get('code_verifier') || '').digest('base64url');
        exchanges.push({ variant: saved.variant, pkce: actualChallenge === saved.challenge, redirect: body.get('redirect_uri'), client: body.get('client_id') });
        if (actualChallenge !== saved.challenge || body.get('redirect_uri') !== saved.redirect || body.get('client_id') !== CLIENT_ID || body.get('grant_type') !== 'authorization_code') return jsonResponse(res, 400, { error: 'invalid_grant' });
        const variant = saved.variant;
        const claims = {
          sub: variant === 'different_subject' ? 'another-subject' : 'local-reader-subject',
          email: variant === 'unknown_email' ? 'unprovisioned@example.invalid' : variant === 'email_case' ? VIEWER_EMAIL.toUpperCase() : VIEWER_EMAIL,
          email_verified: variant === 'unverified' ? false : variant === 'string_verified' ? 'true' : true,
          nonce: variant === 'wrong_nonce' ? 'attacker-nonce' : saved.nonce,
          role: 'admin', groups: ['administrators'], name: 'Local Test Identity'
        };
        if (variant === 'missing_nonce') delete claims.nonce;
        if (variant === 'missing_verification') delete claims.email_verified;
        const clock = Math.floor(Date.now() / 1000);
        const audience = variant === 'wrong_audience' ? 'some-other-client' : variant === 'multiple_audience' ? [CLIENT_ID, 'another-client'] : CLIENT_ID;
        const token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'local-test-key' })
          .setIssuer(variant === 'wrong_issuer' ? issuer + '/different' : issuer).setAudience(audience)
          .setIssuedAt(variant === 'expired' ? clock - 7200 : clock).setExpirationTime(variant === 'expired' ? clock - 3600 : clock + 300)
          .sign(variant === 'forged_signature' ? rogue.privateKey : valid.privateKey);
        return jsonResponse(res, 200, { token_type: 'Bearer', id_token: token, expires_in: 300 });
      }
      return jsonResponse(res, 404, { error: 'not_found' });
    } catch (error) { return jsonResponse(res, 500, { error: 'local_mock_assertion', message: error.message }); }
  });
  issuer = origin;
  return { server, issuer, exchanges, setApplicationOrigin(value) { applicationOrigin = value; } };
}

test('enterprise service tokens, evaluations, OIDC and verified recovery', { timeout: 120_000 }, async t => {
  const originalEnvironment = { ...process.env }, originalFetch = globalThis.fetch;
  const directory = mkdtempSync(path.join(os.tmpdir(), 'xrag-enterprise-'));
  const allowedOrigins = new Set(), networkCalls = [];
  let app, apiServer, identity, restoredApp, restoredServer;
  try {
    for (const key of ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'AI_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'EMBEDDING_API_KEY', 'APP_ENCRYPTION_KEY', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'PUBLIC_ORIGIN', 'COOKIE_SECURE', 'CONNECTOR_ROOTS', 'BACKUP_INTERVAL_HOURS']) delete process.env[key];
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
      assert.ok(allowedOrigins.has(url.origin), 'An integration test attempted a non-test network request: ' + url.origin);
      networkCalls.push({ origin: url.origin, path: url.pathname });
      return originalFetch(input, init);
    };
    app = await createApp({ dataDir: path.join(directory, 'live'), startWorker: false });
    app.store.put('setting', { id: 'model', provider: 'disabled', embeddingModel: '', embeddingBaseUrl: '' });
    const listening = await listen(app.handler); apiServer = listening.server;
    const origin = listening.origin; allowedOrigins.add(origin);
    process.env.ALLOWED_ORIGINS = origin;
    let adminCookie = '';
    async function request(method, route, body, options = {}) {
      const target = options.target || origin;
      const headers = {};
      const selectedCookie = options.cookie === undefined ? adminCookie : options.cookie;
      if (selectedCookie) headers.cookie = selectedCookie;
      if (options.origin !== false) headers.origin = typeof options.origin === 'string' ? options.origin : origin;
      if (options.bearer) headers.authorization = 'Bearer ' + options.bearer;
      if (options.authorization) headers.authorization = options.authorization;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(target + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
      const bodyText = await response.text();
      const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bodyText || '{}') : bodyText;
      return { status: response.status, data, response, cookie: cookieValue(response, 'xrag_session') };
    }
    const setup = await request('POST', '/api/setup', { username: 'enterprise-admin', name: '测试管理员', password: PASSWORD }, { cookie: '' });
    assert.equal(setup.status, 201, JSON.stringify(setup.data)); adminCookie = setup.cookie;
    const createBase = async name => {
      const response = await request('POST', '/api/bases', { name, visibility: 'private', department: '审计' });
      assert.equal(response.status, 201, JSON.stringify(response.data)); return response.data.base;
    };
    const scopeA = await createBase('应用授权制度库'), scopeB = await createBase('其他受限制度库');
    async function publishText(base, title, content) {
      const uploaded = await request('POST', '/api/documents', { baseId: base.id, fileName: title + '.txt', title, contentBase64: Buffer.from(content).toString('base64'), duplicateAction: 'copy' });
      assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data)); await app.runQueue();
      const parsed = (await request('GET', '/api/documents/' + uploaded.data.document.id)).data.document;
      assert.equal(parsed.status, 'review');
      const published = await request('POST', '/api/documents/' + parsed.id + '/actions', { action: 'publish', revision: parsed.revision });
      assert.equal(published.status, 200, JSON.stringify(published.data)); return published.data.document;
    }
    const textA = '# 采购审批制度\n采购审批须由部门负责人确认，金额超过十万元需追加财务复核。';
    const documentA = await publishText(scopeA, '采购审批制度', textA);
    const documentB = await publishText(scopeB, '采购保密定价', '# 采购定价\n采购报价底价属于受限资料，仅授权项目成员可阅读。');
    const createdViewer = await request('POST', '/api/users', { username: VIEWER_EMAIL, password: PASSWORD, name: '只读用户', role: 'viewer', department: '普通员工' });
    assert.equal(createdViewer.status, 201); const viewer = createdViewer.data.user;
    const viewerCookie = (await request('POST', '/api/auth/login', { username: VIEWER_EMAIL, password: PASSWORD }, { cookie: '' })).cookie;
    const secondaryCreated = await request('POST', '/api/users', { username: 'service-owner@example.invalid', password: PASSWORD, name: '应用负责人', role: 'admin', department: '应用管理' });
    assert.equal(secondaryCreated.status, 201); const secondary = secondaryCreated.data.user;
    const secondaryCookie = (await request('POST', '/api/auth/login', { username: secondary.username, password: PASSWORD }, { cookie: '' })).cookie;
    let originalToken;
    const tokenCreate = async (name, as = adminCookie) => {
      const result = await request('POST', '/api/service-tokens', { name, baseIds: [scopeA.id], days: 7 }, { cookie: as });
      assert.equal(result.status, 201, JSON.stringify(result.data)); assert.match(result.data.secret, /^xrag_[A-Za-z0-9_-]{40,}$/);
      return result.data;
    };

    await t.test('service secrets are returned once and never exposed by listing or audit', async () => {
      originalToken = await tokenCreate('一次展示访问令牌');
      const raw = originalToken.secret;
      assert.equal('tokenHash' in originalToken.token, false);
      const persisted = app.store.get('serviceToken', originalToken.token.id);
      assert.equal(persisted.tokenHash, sha256(raw)); assert.notEqual(persisted.tokenHash, raw);
      const listed = await request('GET', '/api/service-tokens');
      assert.equal(listed.status, 200); assert.equal(listed.data.tokens.length, 1);
      assert.equal('tokenHash' in listed.data.tokens[0], false); assert.equal('secret' in listed.data.tokens[0], false);
      assert.ok(!JSON.stringify(listed.data).includes(raw));
      assert.ok(!JSON.stringify((await request('GET', '/api/audit')).data).includes(raw));
      assert.equal((await request('POST', '/api/service-tokens', { name: 'unauthorized', baseIds: [scopeA.id] }, { cookie: viewerCookie })).status, 403);
    });

    await t.test('Bearer-only service access enforces base scope without granting management access', async () => {
      const bearer = originalToken.secret;
      const found = await request('GET', '/api/service/search?q=' + encodeURIComponent('采购'), undefined, { bearer, cookie: '', origin: false });
      assert.equal(found.status, 200, JSON.stringify(found.data)); assert.ok(found.data.results.length > 0);
      assert.ok(found.data.results.every(row => row.baseId === scopeA.id && row.documentId === documentA.id));
      assert.ok(found.data.results.every(row => row.documentId !== documentB.id));
      const outside = await request('GET', '/api/service/search?q=采购&baseId=' + scopeB.id, undefined, { bearer, cookie: '', origin: false });
      assert.equal(outside.status, 403); assert.equal(outside.data.error.code, 'SERVICE_SCOPE_DENIED');
      const answer = await request('POST', '/api/service/answer', { baseId: scopeA.id, question: '采购审批' }, { bearer, cookie: '', origin: false });
      assert.equal(answer.status, 200, JSON.stringify(answer.data)); assert.equal(answer.data.mode, 'extractive');
      assert.ok(answer.data.citations.length > 0 && answer.data.citations.every(row => row.baseId === scopeA.id));
      assert.equal((await request('POST', '/api/service/answer', { baseId: scopeB.id, question: '采购' }, { bearer, cookie: '', origin: false })).status, 403);
      assert.equal((await request('GET', '/api/service/search?q=采购', undefined, { cookie: adminCookie, origin: false })).status, 401);
      assert.equal((await request('GET', '/api/service/search?q=采购&token=' + bearer, undefined, { cookie: '', origin: false })).status, 401);
      assert.equal((await request('GET', '/api/service/search?q=采购', undefined, { cookie: '', origin: false, authorization: 'Basic ' + bearer })).status, 401);
      assert.equal((await request('GET', '/api/users', undefined, { bearer, cookie: '', origin: false })).status, 401);
      assert.equal((await request('POST', '/api/service-tokens', { name: 'token escalation', baseIds: [scopeA.id] }, { bearer, cookie: '' })).status, 401);
      assert.equal((await request('GET', '/api/service/users', undefined, { bearer, cookie: '', origin: false })).status, 404);
    });

    await t.test('revocation, expiry, account disabling and current account permissions take effect', async () => {
      const revoke = await request('DELETE', '/api/service-tokens/' + originalToken.token.id);
      assert.equal(revoke.status, 200);
      const revoked = await request('GET', '/api/service/search?q=采购', undefined, { bearer: originalToken.secret, cookie: '', origin: false });
      assert.equal(revoked.status, 401); assert.equal(revoked.data.error.code, 'SERVICE_TOKEN_INVALID');
      const expired = await tokenCreate('过期检查');
      app.store.put('serviceToken', { ...app.store.get('serviceToken', expired.token.id), expiresAt: new Date(Date.now() - 1000).toISOString() });
      assert.equal((await request('GET', '/api/service/search?q=采购', undefined, { bearer: expired.secret, cookie: '', origin: false })).status, 401);
      const ownership = await tokenCreate('账号状态检查', secondaryCookie);
      assert.equal((await request('PATCH', '/api/users/' + secondary.id, { active: false })).status, 200);
      const disabled = await request('GET', '/api/service/search?q=采购', undefined, { bearer: ownership.secret, cookie: '', origin: false });
      assert.equal(disabled.status, 401); assert.equal(disabled.data.error.code, 'SERVICE_ACCOUNT_DISABLED');
      assert.equal((await request('PATCH', '/api/users/' + secondary.id, { active: true, role: 'viewer' })).status, 200);
      const removed = await request('GET', '/api/service/search?q=采购&baseId=' + scopeA.id, undefined, { bearer: ownership.secret, cookie: '', origin: false });
      assert.equal(removed.status, 403); assert.equal(removed.data.error.code, 'SERVICE_SCOPE_DENIED');
    });

    await t.test('retrieval evaluation records actual evidence hits and actual no-evidence refusal', async () => {
      const positive = await request('POST', '/api/evaluations/cases', { question: '采购审批', baseId: scopeA.id, expectedDocumentId: documentA.id, expectedText: '十万元' });
      assert.equal(positive.status, 201);
      const negative = await request('POST', '/api/evaluations/cases', { question: 'quantum-flux-no-evidence-987654321', baseId: scopeA.id, mustRefuse: true });
      assert.equal(negative.status, 201);
      assert.equal((await request('POST', '/api/evaluations/run', { mode: 'retrieval' }, { cookie: viewerCookie })).status, 403);
      const started = await request('POST', '/api/evaluations/run', { mode: 'retrieval' });
      assert.equal(started.status, 202, JSON.stringify(started.data));
      let completed;
      for (let i = 0; i < 100; i++) {
        const latest = await request('GET', '/api/evaluations');
        completed = latest.data.runs.find(run => run.id === started.data.run.id);
        if (completed?.status !== 'running') break;
        await sleep(25);
      }
      assert.equal(completed.status, 'completed'); assert.equal(completed.total, 2); assert.equal(completed.completed, 2); assert.equal(completed.passed, 2); assert.equal(completed.passRate, 1);
      const hit = completed.results.find(result => result.caseId === positive.data.case.id), refusal = completed.results.find(result => result.caseId === negative.data.case.id);
      assert.equal(hit.passed, true); assert.equal(hit.sourceHit, true); assert.equal(hit.textHit, true);
      assert.deepEqual(hit.documentIds, [documentA.id]); assert.match(hit.excerpt, /十万元/); assert.equal(hit.answerMode, 'retrieval');
      assert.equal(refusal.passed, true); assert.equal(refusal.refusal, true); assert.deepEqual(refusal.documentIds, []); assert.equal(refusal.excerpt, '');
      assert.ok(completed.results.every(result => Number.isFinite(result.latencyMs)));
      assert.deepEqual(app.store.get('evalRun', completed.id).results, completed.results);
    });

    identity = await mockIdentityProvider(); allowedOrigins.add(identity.issuer); identity.setApplicationOrigin(origin);
    process.env.OIDC_ISSUER = identity.issuer; process.env.OIDC_CLIENT_ID = CLIENT_ID;
    process.env.PUBLIC_ORIGIN = origin; process.env.OIDC_ALLOW_HTTP_LOOPBACK = 'true';
    async function startFlow(variant = 'valid') {
      const started = await request('GET', '/api/auth/sso/start', undefined, { cookie: '', origin: false });
      assert.equal(started.status, 302, JSON.stringify(started.data));
      const stateCookie = cookieValue(started.response, 'xrag_oidc');
      assert.ok(stateCookie); assert.match(started.response.headers.get('set-cookie'), /HttpOnly/); assert.match(started.response.headers.get('set-cookie'), /SameSite=Lax/);
      const authorizationUrl = new URL(started.response.headers.get('location'));
      authorizationUrl.searchParams.set('test_case', variant);
      const authorized = await fetch(authorizationUrl, { redirect: 'manual' });
      assert.equal(authorized.status, 302, await authorized.clone().text());
      return { callback: new URL(authorized.headers.get('location')), stateCookie, authorizationUrl };
    }
    const callback = (flow, overrides = {}) => request('GET', flow.callback.pathname + flow.callback.search, undefined, { cookie: flow.stateCookie, origin: false, ...overrides });

    await t.test('OIDC requires explicit HTTP loopback exception and binds state to a browser cookie', async () => {
      delete process.env.OIDC_ALLOW_HTTP_LOOPBACK;
      const insecure = await request('GET', '/api/auth/sso/start', undefined, { cookie: '', origin: false });
      assert.equal(insecure.status, 400); assert.equal(insecure.data.error.code, 'OIDC_HTTPS_REQUIRED');
      process.env.OIDC_ALLOW_HTTP_LOOPBACK = 'true';
      const status = await request('GET', '/api/auth/sso/status', undefined, { cookie: '', origin: false }); assert.equal(status.data.enabled, true);
      const flow = await startFlow();
      assert.equal((await callback(flow, { cookie: '' })).data.error.code, 'SSO_STATE_INVALID');
      assert.equal((await callback(flow, { cookie: 'xrag_oidc=another-browser' })).data.error.code, 'SSO_STATE_INVALID');
      const wrongState = { ...flow, callback: new URL(flow.callback) }; wrongState.callback.searchParams.set('state', 'made-up-state');
      assert.equal((await callback(wrongState)).data.error.code, 'SSO_STATE_INVALID');
      const expired = await startFlow();
      const id = sha256(expired.callback.searchParams.get('state'));
      app.store.put('oidcState', { ...app.store.get('oidcState', id), expiresAt: Date.now() - 1000 });
      assert.equal((await callback(expired)).data.error.code, 'SSO_STATE_INVALID');
    });

    await t.test('OIDC validates PKCE and verified mailbox, retains provisioned viewer access, and blocks replay', async () => {
      const count = app.store.list('user').length;
      const flow = await startFlow('email_case');
      const loggedIn = await callback(flow);
      assert.equal(loggedIn.status, 302, JSON.stringify(loggedIn.data)); assert.ok(loggedIn.cookie);
      const exchange = identity.exchanges.at(-1);
      assert.equal(exchange.pkce, true); assert.equal(exchange.client, CLIENT_ID); assert.equal(exchange.redirect, origin + '/api/auth/sso/callback');
      const current = await request('GET', '/api/auth/me', undefined, { cookie: loggedIn.cookie });
      assert.equal(current.status, 200); assert.equal(current.data.user.id, viewer.id); assert.equal(current.data.user.role, 'viewer');
      assert.equal(app.store.list('user').length, count);
      assert.equal((await request('GET', '/api/users', undefined, { cookie: loggedIn.cookie })).status, 403);
      assert.equal((await request('GET', '/api/documents/' + documentA.id, undefined, { cookie: loggedIn.cookie })).status, 404);
      assert.equal((await request('POST', '/api/documents', {}, { cookie: loggedIn.cookie })).status, 403);
      const binding = app.store.get('oidcBinding', viewer.id); assert.equal(binding.issuer, identity.issuer); assert.equal(binding.subject, 'local-reader-subject');
      const replay = await callback(flow); assert.equal(replay.status, 400); assert.equal(replay.data.error.code, 'SSO_STATE_INVALID');
    });

    await t.test('OIDC rejects nonce or email verification failures, unknown accounts and changed subjects', async () => {
      const count = app.store.list('user').length;
      for (const variant of ['wrong_nonce', 'missing_nonce', 'unverified', 'string_verified', 'missing_verification', 'multiple_audience']) {
        const flow = await startFlow(variant); const response = await callback(flow);
        assert.equal(response.status, 401, variant + ': ' + JSON.stringify(response.data));
        assert.equal(response.data.error.code, 'SSO_IDENTITY_INVALID'); assert.equal(response.cookie, '');
        assert.equal((await callback(flow)).data.error.code, 'SSO_STATE_INVALID');
      }
      const unknown = await callback(await startFlow('unknown_email'));
      assert.equal(unknown.status, 403); assert.equal(unknown.data.error.code, 'SSO_ACCOUNT_NOT_PROVISIONED');
      const changed = await callback(await startFlow('different_subject'));
      assert.equal(changed.status, 403); assert.equal(changed.data.error.code, 'SSO_BINDING_MISMATCH');
      assert.equal(app.store.list('user').length, count);
      assert.equal((await request('PATCH', '/api/users/' + viewer.id, { active: false })).status, 200);
      const inactive = await callback(await startFlow()); assert.equal(inactive.status, 403); assert.equal(inactive.data.error.code, 'SSO_ACCOUNT_NOT_PROVISIONED');
      assert.equal((await request('PATCH', '/api/users/' + viewer.id, { active: true })).status, 200);
    });

    await t.test('OIDC rejects forged signatures, foreign audience/issuer and expired identity tokens', async () => {
      for (const variant of ['forged_signature', 'wrong_audience', 'wrong_issuer', 'expired']) {
        const response = await callback(await startFlow(variant));
        assert.equal(response.status, 401, variant + ': ' + JSON.stringify(response.data));
        assert.equal(response.data.error.code, 'SSO_TOKEN_INVALID'); assert.equal(response.cookie, '');
      }
      assert.ok(identity.exchanges.every(exchange => exchange.pkce));
    });

    await t.test('a verified online backup restores originals, searchable data and encrypted settings without old sessions', async () => {
      app.store.put('setting', { id: 'restoreProbe', secret: app.store.seal('synthetic-backup-secret') });
      await startFlow(); // A pending login must not survive restoration.
      assert.ok(app.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n > 0);
      assert.ok(app.store.list('oidcState').length > 0);
      const result = await request('POST', '/api/operations/backup', {});
      assert.equal(result.status, 201, JSON.stringify(result.data)); assert.equal(result.data.backup.verified, true);
      const backupDirectory = path.join(directory, 'live', 'backups', result.data.backup.id);
      assert.ok(existsSync(path.join(backupDirectory, 'manifest.json')));
      const manifest = JSON.parse(readFileSync(path.join(backupDirectory, 'manifest.json'), 'utf8'));
      assert.equal(manifest.files.length, 2);
      assert.equal((await request('GET', '/ready.json')).status, 200, 'The source service must remain available during online backup');
      const postBackupFeedback = await request('POST', '/api/feedback', { question: '仅备份后存在的测试问题', comment: '此记录不得出现在之前的快照中' });
      assert.equal(postBackupFeedback.status, 201);
      const target = path.join(directory, 'restored');
      const receipt = restoreBackup(backupDirectory, target); assert.equal(receipt.verified, true); assert.equal(receipt.files, 2);
      assert.equal(existsSync(path.join(target, '.restore-incomplete')), false);
      restoredApp = await createApp({ dataDir: target, startWorker: false });
      assert.equal(restoredApp.store.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
      assert.equal(restoredApp.store.list('oidcState').length, 0);
      assert.equal(restoredApp.store.unseal(restoredApp.store.get('setting', 'restoreProbe').secret), 'synthetic-backup-secret');
      const restoredListening = await listen(restoredApp.handler); restoredServer = restoredListening.server; allowedOrigins.add(restoredListening.origin);
      assert.equal((await request('GET', '/api/auth/me', undefined, { target: restoredListening.origin, cookie: adminCookie })).status, 401);
      const login = await request('POST', '/api/auth/login', { username: 'enterprise-admin', password: PASSWORD }, { target: restoredListening.origin, cookie: '' });
      assert.equal(login.status, 200); const asRestored = { target: restoredListening.origin, cookie: login.cookie };
      const found = await request('GET', '/api/search?q=采购审批&baseId=' + scopeA.id, undefined, asRestored);
      assert.equal(found.status, 200); assert.ok(found.data.results.some(row => row.documentId === documentA.id && row.text.includes('十万元')));
      const download = await request('GET', '/api/documents/' + documentA.id + '/file', undefined, asRestored);
      assert.equal(download.status, 200); assert.equal(download.data, textA);
      assert.ok(!(await request('GET', '/api/feedback', undefined, asRestored)).data.feedback.some(item => item.id === postBackupFeedback.data.feedback.id));
      const restoredDocument = restoredApp.store.get('document', documentA.id);
      assert.equal(sha256(readFileSync(path.join(target, 'uploads', restoredDocument.storageName))), restoredDocument.sha256);
      await closeServer(restoredServer); restoredServer = null; await restoredApp.close(); restoredApp = null;
      const corrupted = path.join(directory, 'corrupted-backup'); cpSync(backupDirectory, corrupted, { recursive: true });
      const wrongManifest = JSON.parse(readFileSync(path.join(corrupted, 'manifest.json'), 'utf8')); wrongManifest.files[0].sha256 = '0'.repeat(64);
      writeFileSync(path.join(corrupted, 'manifest.json'), JSON.stringify(wrongManifest));
      const rejectedTarget = path.join(directory, 'must-not-be-created');
      assert.throws(() => restoreBackup(corrupted, rejectedTarget), /原件校验失败/); assert.equal(existsSync(rejectedTarget), false);
      const occupied = path.join(directory, 'occupied'); mkdirSync(occupied); writeFileSync(path.join(occupied, 'keep.txt'), 'preserve existing data');
      assert.throws(() => restoreBackup(backupDirectory, occupied), /新的空目录/); assert.equal(readFileSync(path.join(occupied, 'keep.txt'), 'utf8'), 'preserve existing data');
    });

    assert.ok(networkCalls.length > 0);
    assert.ok(networkCalls.every(call => allowedOrigins.has(call.origin)));
    assert.equal(networkCalls.filter(call => /chat\/completions|\/embeddings$/.test(call.path)).length, 0, 'No generation or embedding model may be called by this suite');
  } finally {
    if (restoredServer) await closeServer(restoredServer);
    if (restoredApp) await restoredApp.close();
    if (apiServer) await closeServer(apiServer);
    if (app) await app.close();
    if (identity) await closeServer(identity.server);
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in originalEnvironment)) delete process.env[key];
    Object.assign(process.env, originalEnvironment);
    const resolved = path.resolve(directory), temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(temporaryRoot) && path.basename(resolved).startsWith('xrag-enterprise-'));
    rmSync(resolved, { recursive: true, force: true });
  }
});