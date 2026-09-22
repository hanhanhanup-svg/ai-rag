import crypto from 'node:crypto';
import { now, uid } from './database.mjs';
import { canDocument, canEdit, isRetrievable, cleanString, requireValue } from './security.mjs';

const POLICY_VERSION = 'business-search-2';
const REQUEST_TTL = 30 * 60 * 1000;
export const SCENARIOS = [
  { id: 'passenger', label: '客运服务', keywords: ['客运', '乘客', '失物', '投诉', '无障碍', '服务'], tasks: ['失物登记', '投诉材料核对', '乘客服务资料查阅'] },
  { id: 'operations', label: '运营记录', keywords: ['运营', '交接', '行车', '值班', '客流', '应急'], tasks: ['交接班记录整理', '运营资料核对', '客流资料查阅'] },
  { id: 'maintenance', label: '设备维修', keywords: ['设备', '维修', '检修', '故障', '工单', '台账', '巡检'], tasks: ['设备台账核对', '维修工单资料核对', '工单归档材料核对'] },
  { id: 'training', label: '岗位学习', keywords: ['培训', '学习', '岗位', '课程', '考试', '案例'], tasks: ['培训资料查阅', '岗位知识整理', '学习资料核对'] },
];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const recommendationSignature = d => hash([d.id, d.version, d.revision, d.contentRevision, d.sha256, d.sourceKind, d.applicability, d.effectiveAt, d.expiresAt]);
const active = (store, user) => { const latest = store.get('user', user?.id); requireValue(latest?.active, 401, 'AUTH_REQUIRED', '当前访问权限已更新。'); return latest; };
const visible = (store, user, d) => d && canDocument(user, d, store) && isRetrievable(d);
function contextOf(input = {}) {
  const scenario = cleanString(input.scenario, 40), task = cleanString(input.task, 100), contextId = cleanString(input.contextId, 120) || 'current';
  requireValue(!scenario || SCENARIOS.some(s => s.id === scenario), 400, 'INVALID_SCENARIO', '请选择已有工作场景。');
  requireValue(/^[a-zA-Z0-9_-]{1,120}$/.test(contextId), 400, 'INVALID_CONTEXT', '工作场景标识无效。');
  return { scenario, task, contextId, baseId: cleanString(input.baseId, 120), mode: 'local_context' };
}
const preferenceKey = (actorId, context, doc) => hash([actorId, context.contextId, context.scenario, context.task, doc.id, doc.version]);
const reasonLabel = kind => ({ official_public: '官方公开摘编', internal_controlled: '内部登记资料', synthetic: '行业示例', reference: '参考资料', unspecified: '来源待登记' })[kind] || '来源待登记';
const wordsOf = task => [...new Set(task.match(/[\p{L}\p{N}]{2,}/gu) || [])].flatMap(w => w.length > 4 ? [w, ...SCENARIOS.flatMap(s => s.keywords).filter(t => w.includes(t))] : [w]);
function liveLinks(store, user, context) {
  return store.list('recommendation_link').filter(link => {
    const d = store.get('document', link.documentId);
    return link.status === 'approved' && (!context.scenario || link.scenario === context.scenario) && (!context.task || !link.task || link.task === context.task) && visible(store, user, d) && link.documentSignature === recommendationSignature(d);
  });
}

export function getRecommendations(store, actor, input = {}, { policy = {}, searchResult = null } = {}) {
  const user = active(store, actor), context = contextOf(input), scenario = SCENARIOS.find(s => s.id === context.scenario);
  const blocked = new Set(policy.blockedDocumentIds || []), links = liveLinks(store, user, context);
  const groups = policy.equivalentGroups || [], represented = new Set();
  const groupFor = id => groups.find(g => g.documentIds?.includes(id))?.id;
  const time = Date.now(), taskWords = wordsOf(context.task);
  const candidates = store.list('document').filter(d => visible(store, user, d) && (!context.baseId || d.baseId === context.baseId) && !blocked.has(d.id) && (!input.documentId || d.id === input.documentId) && (!input.documentVersion || d.version === Number(input.documentVersion))).map(d => {
    const hit = searchResult?.results?.find(row => row.documentId === d.id);
    if (searchResult && !hit) return null;
    const chunks = store.chunks(d.id), titleAndTags = [d.title, ...(d.tags || [])].join(' '), searchable = [titleAndTags, d.summary || ''].join(' ');
    const link = links.find(l => l.documentId === d.id);
    const matched = (scenario?.keywords || []).filter(w => searchable.includes(w));
    const taskMatched = taskWords.filter(w => searchable.includes(w));
    if ((scenario || context.task) && !link && !matched.length && !taskMatched.length) return null;
    const reasonCodes = [], reasons = []; let score = 0;
    if (hit) { score += 30; reasonCodes.push("business_query"); reasons.push("与业务问题匹配，已定位原文依据：" + cleanString(input.q, 1000)); }
    if (link) { score += 100; reasonCodes.push('reviewed_task_link'); reasons.push('已确认的场景关联：' + link.reason); }
    if (taskMatched.length) { score += 12 * taskMatched.length; reasonCodes.push('task_terms'); reasons.push('与当前任务关键词匹配：' + taskMatched.slice(0, 3).join('、')); }
    if (matched.length) { score += 5 * matched.length; reasonCodes.push('scene_terms'); reasons.push('标题或标签包含场景主题：' + matched.slice(0, 3).join('、')); }
    if (!reasonCodes.length) { reasonCodes.push('recent_published'); reasons.push('当前可访问的已发布资料，按更新时间展示'); }
    const reviewOverdue = !!d.reviewDueAt && Date.parse(d.reviewDueAt) <= time;
    if (reviewOverdue) score -= 20;
    const pref = store.get('recommendation_preference', preferenceKey(user.id, context, d));
    if (pref?.read) score -= 3;
    const bestChunk = (hit ? {id:hit.id,text:hit.text,page:hit.page} : null) || chunks.find(c => [...taskMatched, ...matched].some(w => c.text?.includes(w))) || chunks[0];
    return { documentId: d.id, title: d.title, version: d.version, sourceKind: d.sourceKind || 'unspecified', sourceLabel: reasonLabel(d.sourceKind), applicability: d.applicability || '适用范围尚未登记，请结合原文核对', baseId: d.baseId,
      reasonCodes, reasons, excerpt: (bestChunk?.text || d.summary || '').slice(0, 380), chunkId: bestChunk?.id || null, page: bestChunk?.page || null, score, read: !!pref?.read, dismissed: !!pref?.dismissed, helpful: !!pref?.helpful,
      generatedAt: now(), expiresAt: d.expiresAt || null, reviewOverdue, updatedAt: d.updatedAt || d.createdAt, documentSignature: recommendationSignature(d), groupId: groupFor(d.id) || d.familyId || d.id };
  }).filter(Boolean).sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.documentId.localeCompare(b.documentId));
  const includeDismissed = input.includeDismissed === '1' || input.includeDismissed === true;
  const items = candidates.filter(item => {
    if (item.dismissed && !includeDismissed) return false;
    if (represented.has(item.groupId)) return false; represented.add(item.groupId); return true;
  }).slice(0, 12);
  const requestId = uid('recommendation_'), createdAt = now();
  store.put('recommendation_request', { id: requestId, userId: user.id, context, createdAt, expiresAt: new Date(time + REQUEST_TTL).toISOString(), policyVersion: POLICY_VERSION, items: items.map(i => ({ documentId: i.documentId, version: i.version, documentSignature: i.documentSignature })) });
  const requests = store.list('recommendation_request').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const request of requests) if (Date.parse(request.expiresAt) < time) store.del('recommendation_request', request.id);
  for (const request of requests.filter(r => r.userId === user.id).slice(100)) store.del('recommendation_request', request.id);
  return { requestId, items: items.map(({ documentSignature, groupId, ...item }) => item), context, scenarios: SCENARIOS.map(({ keywords, ...s }) => s), policyVersion: POLICY_VERSION, generatedAt: createdAt, coverage: searchResult?.coverage, graph: searchResult?.graph, emptyReason: items.length ? null : '当前范围暂无适用资料，可调整工作场景或提交知识补充反馈。' };
}

export function recommendationEvent(store, actor, input) {
  const user = active(store, actor), type = input.type;
  requireValue(['impression', 'open', 'mark_read', 'dismiss', 'restore', 'helpful', 'not_applicable'].includes(type), 400, 'INVALID_RECOMMENDATION_EVENT', '反馈类型无效。');
  const clientRequestId = cleanString(input.clientRequestId, 120); requireValue(clientRequestId, 400, 'REQUEST_ID_REQUIRED', '缺少反馈请求标识。');
  const id = hash([user.id, clientRequestId]), fingerprint = hash([input.requestId, input.documentId, input.version, input.contextId, type, input.reason || '']);
  return store.transaction(() => {
    const old = store.get('recommendation_event', id);
    if (old) { requireValue(old.fingerprint === fingerprint, 409, 'IDEMPOTENCY_CONFLICT', '同一请求标识的反馈内容不同。'); return { accepted: true, duplicate: true }; }
    const request = store.get('recommendation_request', input.requestId), d = store.get('document', input.documentId);
    requireValue(request?.userId === user.id && Date.parse(request.expiresAt) > Date.now() && (!input.contextId || request.context.contextId === input.contextId), 409, 'RECOMMENDATION_EXPIRED', '推荐已更新，请刷新后重试。');
    const item = request.items.find(i => i.documentId === input.documentId && i.version === Number(input.version));
    requireValue(item && visible(store, user, d) && item.documentSignature === recommendationSignature(d), 409, 'RECOMMENDATION_CHANGED', '资料权限、版本或状态已变化，请刷新。');
    const key = preferenceKey(user.id, request.context, d), pref = store.get('recommendation_preference', key) || { id: key, userId: user.id, context: request.context, documentId: d.id, version: d.version };
    const mutation = type === 'mark_read' ? { read: true } : type === 'dismiss' || type === 'not_applicable' ? { dismissed: true } : type === 'restore' ? { dismissed: false } : type === 'helpful' ? { helpful: true } : {};
    // One exposure/open per recommendation request and item. Reading is always explicit.
    const measurementKey = hash([user.id, request.id, d.id, type]);
    const measuredAlready = ['impression', 'open'].includes(type) && store.get('recommendation_measurement', measurementKey);
    store.put('recommendation_preference', { ...pref, ...mutation, updatedAt: now() });
    store.put('recommendation_event', { id, fingerprint, userId: user.id, actorKind: actor.authMode === 'local' ? 'local_workspace' : 'user', contextId: request.context.contextId, requestId: request.id, documentId: d.id, version: d.version, type, counted: !measuredAlready, createdAt: now() });
    if (['impression', 'open'].includes(type) && !measuredAlready) store.put('recommendation_measurement', { id: measurementKey, requestId: request.id, documentId: d.id, type, userId: user.id, createdAt: now() });
    return { accepted: true, duplicate: false, preference: { ...mutation } };
  });
}

function listLinks(store, actor) {
  const user = active(store, actor);
  return store.list('recommendation_link').filter(l => canDocument(user, store.get('document', l.documentId), store)).map(l => {
    const d = store.get('document', l.documentId);
    return { ...l, title: d.title, documentVersion: d.version, documentStatus: d.status, documentRetrievable: isRetrievable(d), currentDocumentSignature: recommendationSignature(d), stale: l.documentSignature !== recommendationSignature(d), canManage: canEdit(user) && canDocument(user, d, store, { write: true }) };
  });
}
function saveLink(store, actor, input) {
  const user = active(store, actor), d = store.get('document', input.documentId), context = contextOf(input);
  requireValue(canEdit(user) && canDocument(user, d, store, { write: true }), 403, 'LINK_PERMISSION_REQUIRED', '需要该资料的维护权限。');
  const status = input.status || 'approved';
  requireValue(context.scenario && ['draft', 'approved', 'disabled'].includes(status), 400, 'INVALID_LINK', '请选择工作场景和关联状态。');
  if (status === 'approved') requireValue(visible(store, user, d), 409, 'LINK_DOCUMENT_UNAVAILABLE', '资料尚未发布、已失效或来源不可用，暂不能启用关联。');
  if (status !== 'disabled' && Object.hasOwn(input, 'expectedDocumentSignature')) requireValue(input.expectedDocumentSignature === recommendationSignature(d), 409, 'LINK_DOCUMENT_CHANGED', '资料已更新，请刷新并核对当前原文后重试。');
  const reason = cleanString(input.reason, 1000); requireValue(reason, 400, 'LINK_REASON_REQUIRED', '请填写可核对的关联依据。');
  const old = input.id ? store.get('recommendation_link', input.id) : null;
  if (input.id) { requireValue(old && old.documentId === d.id, 404, 'LINK_NOT_FOUND', '关联不存在。'); requireValue(input.revision === old.revision, 409, 'REVISION_CONFLICT', '关联已更新，请刷新。'); }
  // Stopping an existing association must not refresh its evidence or confirm a changed source.
  const disabling = Boolean(old && status === 'disabled');
  const chunkIds = disabling ? old.chunkIds || [] : Array.isArray(input.chunkIds) ? [...new Set(input.chunkIds)].slice(0, 20) : [];
  if (!disabling) { const valid = new Set(store.chunks(d.id).map(c => c.id)); requireValue(chunkIds.every(c => valid.has(c)), 400, 'INVALID_LINK_EVIDENCE', '关联依据必须属于当前资料。'); }
  const link = { id: old?.id || uid('scene_link_'), documentId: d.id, documentSignature: disabling ? old.documentSignature : recommendationSignature(d), scenario: context.scenario, task: context.task, reason, chunkIds, status, revision: (old?.revision || 0) + 1, reviewedBy: user.id, reviewedAt: now(), createdAt: old?.createdAt || now() };
  store.transaction(() => {
    if (!old) requireValue(!store.list('recommendation_link').some(row => row.documentId === d.id && row.scenario === context.scenario && (row.task || '') === context.task), 409, 'LINK_ALREADY_EXISTS', '此资料已关联到该任务，请在已关联资料中编辑或重新启用。');
    store.put('recommendation_link', link); store.audit(user, 'recommendation.link_saved', { documentId: d.id, target: link.id, status: link.status, revision: link.revision });
  });
  return { link };
}

export async function handleRecommendations(context, { policy } = {}) {
  const { pathname, method, store, user, req, res, send, bodyOf, rate } = context;
  if (pathname === '/api/recommendations' && method === 'GET') { rate?.(`recommendations:${user.id}`, 120, 60000); const input = Object.fromEntries(context.url.searchParams); const q = cleanString(input.q, 1000); const searchResult = q ? await context.search(store, user, q, {baseId:input.baseId||'',documentId:input.documentId||'',documentVersion:input.documentVersion||undefined,limit:100}) : null; send(res, 200, getRecommendations(store, user, input, { policy, searchResult })); return true; }
  if (pathname === '/api/recommendations/events' && method === 'POST') { const input = await bodyOf(req); send(res, 200, recommendationEvent(store, context.currentActor?.() || user, input)); return true; }
  if (pathname === '/api/recommendation-links' && method === 'GET') { send(res, 200, { links: listLinks(store, user), scenarios: SCENARIOS.map(({ keywords, ...s }) => s) }); return true; }
  if (pathname === '/api/recommendation-links' && method === 'POST') { const input = await bodyOf(req); send(res, 200, saveLink(store, context.currentActor?.() || user, input)); return true; }
  return false;
}
