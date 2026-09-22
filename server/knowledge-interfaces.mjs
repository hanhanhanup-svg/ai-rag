import crypto from 'node:crypto';
import { now, uid } from './database.mjs';
import { requireValue, failure, isAdmin, canBase, canDocument, isRetrievable, cleanString } from './security.mjs';
import { SCENARIOS } from './recommendations.mjs';
import { evidenceBundleCurrent } from './intelligence.mjs';
import { learningBundleWithinSourceBase } from './learning-guidance.mjs';

const KIND = 'knowledgeInterface';
const secretHash = value => crypto.createHash('sha256').update(value).digest('hex');
const endpoint = id => '/api/service/knowledge/' + encodeURIComponent(id) + '/answer';
const timestamp = () => now();
function admin(store, user) {
  const current = user?.id && store.get('user', user.id);
  requireValue(current?.active, 401, 'AUTH_REQUIRED', '请先登录，或账号已停用。');
  requireValue(isAdmin(current), 403, 'ADMIN_REQUIRED', '标准接口管理需要管理员权限。');
  return current;
}
function ordinaryBase(store, user, baseId) {
  const base = store.get('base', baseId);
  requireValue(base && !base.deletedAt && !base.systemKind && canBase(user, base), 403, 'INTERFACE_SCOPE_UNAVAILABLE', '请选择有权访问的普通知识库；知识库可能已删除或不可用。');
  return base;
}
function daysOf(value = 90) {
  requireValue(Number.isSafeInteger(value) && value >= 1 && value <= 365, 400, 'INVALID_DAYS', '接口密钥有效期须为 1 至 365 天的整数。');
  return value;
}
function checkRevision(row, value) {
  requireValue(Number.isSafeInteger(value) && value > 0, 400, 'INTERFACE_REVISION_REQUIRED', '请提供当前接口版本后重试。');
  requireValue(row.revision === value, 409, 'INTERFACE_REVISION_CONFLICT', '接口已被更新，请刷新后重试。');
}
function catalogContext(input) {
  const scenario = cleanString(input.scenario, 40), task = cleanString(input.task, 100);
  const entry = SCENARIOS.find(item => item.id === scenario);
  requireValue(!scenario || entry, 400, 'INVALID_SCENARIO', '请选择已有业务场景。');
  requireValue(scenario ? entry.tasks.includes(task) : !task, 400, 'INVALID_TASK', '任务须属于所选场景；通用问答不指定任务。');
  requireValue(input.object === undefined || typeof input.object === 'string' && input.object.length <= 200, 400, 'INVALID_OBJECT', '业务对象最多 200 字。');
  return { scenario, scenarioLabel: entry?.label || '通用问答', task, object: cleanString(input.object, 200) };
}
export function publicKnowledgeInterface(store, row) {
  return {
    id: row.id, name: row.name, baseId: row.baseId, baseName: store.get('base', row.baseId)?.name || row.baseName,
    scenario: row.scenario, scenarioLabel: row.scenarioLabel, task: row.task, object: row.object || '',
    active: row.active, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
    expiresAt: row.expiresAt, lastUsedAt: row.lastUsedAt || null, calls: row.calls || 0,
    endpoint: endpoint(row.id), method: 'POST',
  };
}
function mintedSecret() { const secret = 'ki_' + crypto.randomBytes(36).toString('base64url'); return { secret, secretHash: secretHash(secret) }; }
function rowFor(store, id) { const row = store.get(KIND, id); requireValue(row, 404, 'INTERFACE_NOT_FOUND', '标准接口不存在。'); return row; }
function authorizationSnapshot(row) { return JSON.stringify([row.id, row.userId, row.baseId, row.scenario, row.task, row.object, row.active, row.revision, row.secretHash, row.expiresAt]); }
function serviceAccess(store, id, raw, expected) {
  const row = store.get(KIND, id), hash = secretHash(raw || '');
  const expectedHash = typeof row?.secretHash === 'string' && /^[a-f0-9]{64}$/.test(row.secretHash) ? row.secretHash : '0'.repeat(64);
  const matches = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  requireValue(raw?.startsWith('ki_') && matches && row?.active === true && Date.parse(row.expiresAt) > Date.now(), 401, 'INTERFACE_AUTH_INVALID', '接口密钥无效、已过期或接口已停用。');
  const user = store.get('user', row.userId);
  requireValue(user?.active && isAdmin(user), 401, 'INTERFACE_AUTH_INVALID', '接口发布账号已停用或权限已变化。');
  const base = ordinaryBase(store, user, row.baseId);
  requireValue(!expected || authorizationSnapshot(row) === expected, 409, 'INTERFACE_AUTH_CHANGED', '接口授权已更新，本次结果未返回，请使用当前密钥重试。');
  return { row, user, base };
}
export function knowledgeInterfaceOpenApi(store, row) {
  const info = publicKnowledgeInterface(store, row), error = { description: '请求失败', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } } } } };
  return {
    openapi: '3.0.3', info: { title: info.name, version: String(info.revision), description: '绑定单个知识库的只读知识问答。已发布的场景、任务和对象作为固定业务背景；不执行场景助手的工具流程。' },
    servers: [{ url: '/' }],
    paths: { [info.endpoint]: { post: { operationId: 'answer_' + row.id.replace(/\W/g, '_'), summary: info.name,
      description: ['知识库：' + info.baseName, '场景：' + info.scenarioLabel, info.task && '任务：' + info.task, info.object && '对象：' + info.object].filter(Boolean).join('；'),
      security: [{ InterfaceBearer: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', minLength: 1, maxLength: 4000, description: '本次业务问题' } } } } } },
      responses: { '200': { description: '有依据的回答，或依据不足时的明确说明。mode 为 model、extractive 或 insufficient。', content: { 'application/json': { schema: { type: 'object', required: ['answer', 'mode', 'citations'], properties: { answer: { type: 'string' }, mode: { type: 'string', enum: ['model', 'extractive', 'insufficient'] }, citations: { type: 'array', items: { type: 'object', properties: { documentId: { type: 'string' }, title: { type: 'string' }, version: { type: 'integer' }, page: { type: 'integer' }, text: { type: 'string' } }, additionalProperties: true } }, warning: { type: 'string', nullable: true } }, additionalProperties: true } } } }, '400': error, '401': error, '403': error, '409': error, '429': error, '500': error },
    } } }, components: { securitySchemes: { InterfaceBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'API key', description: '仅使用本接口创建或轮换时一次显示的专属密钥。' } } },
  };
}
/** Recursively check citations, graph paths and nested evidence against the currently bound base. */
export function knowledgeInterfaceEvidenceWithinBase(store, value, baseId, user) {
  function walk(item, depth = 0) {
    if (depth > 20) return false;
    if (!item || typeof item !== 'object') return true;
    if (Array.isArray(item)) return item.every(child => walk(child, depth + 1));
    if (item.documentId) {
      const doc = store.get('document', item.documentId);
      if (!doc || doc.baseId !== baseId || !canDocument(user, doc, store) || !isRetrievable(doc)) return false;
    }
    if (item.baseId && item.baseId !== baseId) return false;
    return Object.entries(item).every(([key, child]) => ['learningEvidenceRefs', 'learningGuidance'].includes(key) || walk(child, depth + 1));
  }
  return walk(value) && learningBundleWithinSourceBase(store, value, baseId);
}
function publicAnswer(answer) {
  const fields = ['answer', 'mode', 'citations', 'warning', 'coverage', 'conflicts', 'graphPaths', 'structuredOutput', 'usage', 'validationAttempts'];
  const privateFields = new Set(['learningGuidance', 'learningEvidenceRefs', 'contextEvidenceRefs', 'traceId', 'spanId', 'runId', 'toolResults']);
  const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !privateFields.has(key)).map(([key, child]) => [key, clean(child)])) : value;
  return clean(Object.fromEntries(fields.filter(key => Object.hasOwn(answer, key)).map(key => [key, answer[key]])));
}

export async function handleKnowledgeInterfaces(ctx) {
  const { req, res, pathname, method, store } = ctx;
  const respond = (status, value) => { ctx.send(res, status, value); return true; };
  if (pathname.startsWith('/api/service/knowledge/')) {
    const match = pathname.match(/^\/api\/service\/knowledge\/([^/]+)\/answer$/);
    requireValue(match, 404, 'INTERFACE_ROUTE_NOT_FOUND', '标准接口地址不存在。');
    requireValue(method === 'POST', 405, 'METHOD_NOT_ALLOWED', '此标准接口仅支持 POST 请求。');
    ctx.rate?.('knowledge-interface-source:' + (req.socket.remoteAddress || 'unknown'), 120, 60000);
    const raw = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/i)?.[1];
    const initial = serviceAccess(store, match[1], raw), expected = authorizationSnapshot(initial.row);
    ctx.rate?.('knowledge-interface:' + initial.row.id, 30, 60000);
    const input = await ctx.bodyOf(req);
    const current = serviceAccess(store, match[1], raw, expected);
    requireValue(Object.keys(input).every(key => key === 'question'), 400, 'INTERFACE_INPUT_INVALID', '此接口仅接受 question；知识库、场景、任务和对象已固定。');
    requireValue(typeof input.question === 'string' && input.question.trim().length > 0 && input.question.length <= 4000, 400, 'QUESTION_REQUIRED', '请提供 1 至 4000 字的问题。');
    const question = input.question.trim(), { row, user } = current;
    const context = { businessContext: { scenario: row.scenario, scenarioLabel: row.scenarioLabel, task: row.task, object: row.object || '', baseId: row.baseId } };
    const goal = ['仅在绑定知识库中回答当前问题。', row.scenario && '业务场景：' + row.scenarioLabel, row.task && '当前任务：' + row.task, row.object && '业务对象：' + row.object].filter(Boolean).join('\n');
    const controller = new AbortController(), abort = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', abort);
    try {
      const answer = await ctx.answerQuestion(store, user, question, { baseId: row.baseId, learningSourceBaseId: row.baseId, context, template: { goal }, signal: controller.signal, feature: 'knowledge_interface' });
      const fresh = serviceAccess(store, row.id, raw, expected);
      requireValue(evidenceBundleCurrent(store, fresh.user, answer) && knowledgeInterfaceEvidenceWithinBase(store, answer, fresh.row.baseId, fresh.user), 409, 'INTERFACE_EVIDENCE_CHANGED', '回答依据已变化或超出绑定知识库，本次结果未返回，请重新提问。');
      if (controller.signal.aborted) return true;
      store.transaction(() => {
        const live = serviceAccess(store, row.id, raw, expected);
        store.put(KIND, { ...live.row, lastUsedAt: timestamp(), calls: (live.row.calls || 0) + 1 });
        store.audit(live.user, 'knowledge_interface.called', { target: row.id, baseId: row.baseId, mode: answer.mode });
      });
      return respond(200, publicAnswer(answer));
    } finally { res.off('close', abort); }
  }
  if (pathname !== '/api/knowledge-interfaces' && !pathname.startsWith('/api/knowledge-interfaces/')) return false;
  const currentAdmin = () => admin(store, ctx.currentActor ? ctx.currentActor() : ctx.user);
  let user = currentAdmin();
  if (pathname === '/api/knowledge-interfaces' && method === 'GET') return respond(200, { interfaces: store.list(KIND).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(row => publicKnowledgeInterface(store, row)) });
  if (pathname === '/api/knowledge-interfaces' && method === 'POST') {
    const input = await ctx.bodyOf(req); user = currentAdmin();
    const name = cleanString(input.name, 120); requireValue(name, 400, 'NAME_REQUIRED', '请填写标准接口名称。');
    const baseId = cleanString(input.baseId, 200), context = catalogContext(input), days = daysOf(input.days), createdAt = timestamp(), key = mintedSecret();
    const row = store.transaction(() => {
      user = currentAdmin(); const base = ordinaryBase(store, user, baseId);
      const item = { id: uid('interface_'), name, baseId, baseName: base.name, ...context, userId: user.id, secretHash: key.secretHash, active: true, revision: 1, createdAt, updatedAt: createdAt, expiresAt: new Date(Date.now() + days * 86400000).toISOString(), lastUsedAt: null, calls: 0 };
      store.put(KIND, item); store.audit(user, 'knowledge_interface.created', { target: item.id, baseId, message: name }); return item;
    });
    return respond(201, { interface: publicKnowledgeInterface(store, row), secret: key.secret });
  }
  const match = pathname.match(/^\/api\/knowledge-interfaces\/([^/]+)(?:\/(rotate-secret|openapi))?$/);
  requireValue(match, 404, 'INTERFACE_ROUTE_NOT_FOUND', '标准接口管理地址不存在。');
  if (match[2] === 'openapi' && method === 'GET') return respond(200, knowledgeInterfaceOpenApi(store, rowFor(store, match[1])));
  if ((!match[2] && method === 'PATCH') || (match[2] === 'rotate-secret' && method === 'POST')) {
    const input = await ctx.bodyOf(req); user = currentAdmin();
    const rotating = match[2] === 'rotate-secret';
    if (!rotating) requireValue(typeof input.active === 'boolean' && Object.keys(input).every(key => ['active', 'expectedRevision'].includes(key)), 400, 'INVALID_INTERFACE_UPDATE', '仅可更新接口启停状态。');
    const days = rotating ? daysOf(input.days) : null, key = rotating ? mintedSecret() : null;
    const row = store.transaction(() => {
      user = currentAdmin(); const previous = rowFor(store, match[1]); checkRevision(previous, input.expectedRevision);
      if (rotating || input.active) ordinaryBase(store, user, previous.baseId);
      const next = { ...previous, ...(rotating ? { secretHash: key.secretHash, expiresAt: new Date(Date.now() + days * 86400000).toISOString() } : { active: input.active }), revision: previous.revision + 1, updatedAt: timestamp() };
      store.put(KIND, next); store.audit(user, rotating ? 'knowledge_interface.secret_rotated' : 'knowledge_interface.state_updated', { target: next.id, baseId: next.baseId, ...(rotating ? {} : { active: next.active }) }); return next;
    });
    return respond(200, { interface: publicKnowledgeInterface(store, row), ...(key ? { secret: key.secret } : {}) });
  }
  throw failure(405, 'METHOD_NOT_ALLOWED', '此标准接口操作不支持当前请求方式。');
}
