import { now, uid } from './database.mjs';
import { canEdit, cleanString, requireValue, isAdmin } from './security.mjs';

const KIND = 'knowledgeDemand';

const STATUSES = ['pending_confirm', 'confirmed', 'assigned', 'in_progress', 'review', 'verifying', 'closed', 'returned'];
const CATEGORIES = ['knowledge_gap', 'knowledge_outdated', 'conflict', 'retrieval_miss', 'parse_error', 'other'];

function actorOf(context) {
  return context.currentActor ? context.currentActor() : context.user;
}

function publicDemand(store, row) {
  if (!row) return null;
  const assignee = row.assigneeId ? store.get('user', row.assigneeId) : null;
  const creator = row.createdBy ? store.get('user', row.createdBy) : null;
  return {
    ...row,
    assigneeName: assignee?.name || assignee?.username || null,
    creatorName: creator?.name || creator?.username || null,
  };
}

function pushHistory(row, user, action, note) {
  const history = Array.isArray(row.history) ? row.history.slice(-49) : [];
  history.push({ at: now(), by: user.id, action, note: cleanString(note, 500) });
  return history;
}

export function createKnowledgeDemand(store, user, input = {}) {
  requireValue(canEdit(user) || isAdmin(user), 403, 'FORBIDDEN', '创建知识需求需要相应权限。');
  const question = cleanString(input.question, 2000);
  requireValue(question, 400, 'QUESTION_REQUIRED', '请填写原始问题。');
  const category = CATEGORIES.includes(input.category) ? input.category : 'knowledge_gap';
  // Auto-discovered items start as pending_confirm to avoid noisy tickets.
  const status = input.auto ? 'pending_confirm' : (STATUSES.includes(input.status) ? input.status : 'confirmed');
  const demand = {
    id: uid('demand_'),
    status,
    category,
    priority: ['low', 'medium', 'high'].includes(input.priority) ? input.priority : 'medium',
    dueAt: cleanString(input.dueAt, 40) || null,
    question,
    conditions: cleanString(input.conditions, 2000),
    answer: cleanString(input.answer, 4000),
    missingPoints: Array.isArray(input.missingPoints) ? input.missingPoints.map(v => cleanString(v, 200)).filter(Boolean).slice(0, 20) : [],
    relatedRunId: cleanString(input.relatedRunId, 120) || null,
    relatedDocIds: Array.isArray(input.relatedDocIds) ? input.relatedDocIds.map(v => cleanString(v, 120)).filter(Boolean).slice(0, 20) : [],
    relatedCardIds: Array.isArray(input.relatedCardIds) ? input.relatedCardIds.map(v => cleanString(v, 120)).filter(Boolean).slice(0, 20) : [],
    businessDomain: cleanString(input.businessDomain, 80),
    assigneeId: cleanString(input.assigneeId, 120) || null,
    source: cleanString(input.source, 40) || 'manual',
    verification: null,
    history: [],
    createdAt: now(),
    updatedAt: now(),
    createdBy: user.id,
    revision: 1,
  };
  demand.history = pushHistory(demand, user, 'created', input.auto ? '完整性检查自动归集，待确认' : '人工创建需求');
  store.put(KIND, demand);
  store.audit(user, 'knowledge.demand.created', { target: demand.id, message: question.slice(0, 80) });
  return { demand: publicDemand(store, demand) };
}

export function listKnowledgeDemands(store, user, query = {}) {
  const status = cleanString(query.status, 40);
  const category = cleanString(query.category, 40);
  const q = cleanString(query.q, 200).toLowerCase();
  const rows = store.list(KIND)
    .map(row => publicDemand(store, row))
    .filter(row => (!status || row.status === status) && (!category || row.category === category) && (!q || `${row.question} ${row.missingPoints?.join(' ') || ''}`.toLowerCase().includes(q)))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const stats = {
    total: rows.length,
    pending_confirm: rows.filter(r => r.status === 'pending_confirm').length,
    open: rows.filter(r => !['closed', 'returned'].includes(r.status)).length,
    overdue: rows.filter(r => r.dueAt && Date.parse(r.dueAt) < Date.now() && !['closed', 'returned'].includes(r.status)).length,
    byCategory: Object.fromEntries(CATEGORIES.map(c => [c, rows.filter(r => r.category === c).length])),
  };
  return { demands: rows.slice(0, 300), stats, categories: CATEGORIES, statuses: STATUSES };
}

export function knowledgeDemandAction(store, user, id, input = {}) {
  requireValue(canEdit(user) || isAdmin(user), 403, 'FORBIDDEN', '处理知识需求需要相应权限。');
  const row = store.get(KIND, id);
  requireValue(row, 404, 'DEMAND_NOT_FOUND', '需求不存在。');
  requireValue(Number(input.revision) === row.revision, 409, 'REVISION_CONFLICT', '需求已被更新，请刷新后重试。');
  const action = cleanString(input.action, 40);
  const transitions = {
    confirm: { from: ['pending_confirm'], to: 'confirmed' },
    assign: { from: ['confirmed', 'returned', 'assigned'], to: 'assigned' },
    start: { from: ['assigned', 'confirmed'], to: 'in_progress' },
    submit_review: { from: ['in_progress'], to: 'review' },
    verify: { from: ['review', 'verifying'], to: 'verifying' },
    close: { from: ['verifying', 'review'], to: 'closed' },
    return: { from: ['review', 'verifying', 'assigned', 'in_progress'], to: 'returned' },
    merge: { from: STATUSES, to: null },
  };
  requireValue(transitions[action], 400, 'INVALID_ACTION', '不支持的需求动作。');
  if (action === 'merge') {
    const targetId = cleanString(input.targetId, 120);
    const target = store.get(KIND, targetId);
    requireValue(target && target.id !== row.id, 400, 'MERGE_TARGET_REQUIRED', '请指定要合并到的需求。');
    // Keep differences when units/time/conditions differ — only merge highly similar tickets.
    requireValue(!row.conditions || !target.conditions || row.conditions === target.conditions, 409, 'CONDITION_DIFF', '适用条件不同，应保留差异，不能合并。');
    const merged = {
      ...target,
      missingPoints: [...new Set([...(target.missingPoints || []), ...(row.missingPoints || [])])].slice(0, 30),
      relatedDocIds: [...new Set([...(target.relatedDocIds || []), ...(row.relatedDocIds || [])])].slice(0, 30),
      revision: target.revision + 1,
      updatedAt: now(),
      history: pushHistory(target, user, 'merge_from', `合并自 ${row.id}`),
    };
    store.put(KIND, merged);
    store.put(KIND, {
      ...row,
      status: 'closed',
      mergedInto: target.id,
      revision: row.revision + 1,
      updatedAt: now(),
      history: pushHistory(row, user, 'merged', `已合并到 ${target.id}`),
    });
    return { demand: publicDemand(store, merged), merged: publicDemand(store, store.get(KIND, row.id)) };
  }
  requireValue(transitions[action].from.includes(row.status), 409, 'INVALID_STATUS', '当前状态不能执行该操作。');
  // Closing without knowledge is forbidden if reason is retrieval_miss treated as gap wrongly — caller must classify.
  if (action === 'close' && row.category === 'retrieval_miss' && input.forceClose !== true) {
    requireValue(input.resolutionNote, 400, 'RESOLUTION_REQUIRED', '检索未命中类需求关闭前请说明检索优化结果，不能靠重复新增知识强行关闭。');
  }
  const next = {
    ...row,
    status: transitions[action].to,
    assigneeId: action === 'assign' ? (cleanString(input.assigneeId, 120) || row.assigneeId) : row.assigneeId,
    priority: input.priority && ['low', 'medium', 'high'].includes(input.priority) ? input.priority : row.priority,
    dueAt: input.dueAt !== undefined ? cleanString(input.dueAt, 40) || null : row.dueAt,
    relatedDocIds: input.relatedDocIds ? input.relatedDocIds.map(v => cleanString(v, 120)).filter(Boolean).slice(0, 20) : row.relatedDocIds,
    relatedCardIds: input.relatedCardIds ? input.relatedCardIds.map(v => cleanString(v, 120)).filter(Boolean).slice(0, 20) : row.relatedCardIds,
    verification: action === 'verify' || action === 'close' ? {
      at: now(),
      by: user.id,
      passed: input.verificationPassed !== false,
      note: cleanString(input.resolutionNote || input.note, 1000),
      question: row.question,
    } : row.verification,
    revision: row.revision + 1,
    updatedAt: now(),
    history: pushHistory(row, user, action, input.note || input.resolutionNote || ''),
  };
  store.put(KIND, next);
  store.audit(user, 'knowledge.demand.' + action, { target: id });
  return { demand: publicDemand(store, next) };
}

export async function verifyKnowledgeDemand(store, user, id, input = {}) {
  const row = store.get(KIND, id);
  requireValue(row, 404, 'DEMAND_NOT_FOUND', '需求不存在。');
  const { analyzeAnswerCompleteness } = await import('./answer-completeness.mjs');
  const analysis = analyzeAnswerCompleteness(store, user, {
    question: row.question,
    answer: cleanString(input.answer, 8000) || row.answer || '',
    citations: input.citations || [],
    runId: row.relatedRunId,
  });
  const unresolved = analysis.analysis.checklist.filter(item => !['answered'].includes(item.status));
  const passed = unresolved.length === 0;
  const next = {
    ...row,
    status: passed ? 'closed' : 'returned',
    verification: {
      at: now(),
      by: user.id,
      passed,
      note: passed ? '原问题复测通过' : `仍有未覆盖要点：${unresolved.map(i => i.label).join('、')}`,
      analysisId: analysis.analysis.id,
      question: row.question,
    },
    revision: row.revision + 1,
    updatedAt: now(),
    history: pushHistory(row, user, passed ? 'verified_closed' : 'verified_returned', ''),
  };
  store.put(KIND, next);
  return { demand: publicDemand(store, next), analysis: analysis.analysis };
}

export async function handleKnowledgeDemands(context) {
  const { pathname, method, store, res, send, url } = context;
  if (!pathname.startsWith('/api/knowledge-demands')) return false;
  const user = actorOf(context);
  const body = async () => context.bodyOf(context.req);
  if (pathname === '/api/knowledge-demands' && method === 'GET') {
    send(res, 200, listKnowledgeDemands(store, user, Object.fromEntries(url.searchParams)));
    return true;
  }
  if (pathname === '/api/knowledge-demands' && method === 'POST') {
    send(res, 201, createKnowledgeDemand(store, actorOf(context), await body()));
    return true;
  }
  const match = pathname.match(/^\/api\/knowledge-demands\/([^/]+)(?:\/(actions|verify))?$/);
  if (match && match[2] === 'actions' && method === 'POST') {
    send(res, 200, knowledgeDemandAction(store, actorOf(context), match[1], await body()));
    return true;
  }
  if (match && match[2] === 'verify' && method === 'POST') {
    send(res, 200, await verifyKnowledgeDemand(store, actorOf(context), match[1], await body()));
    return true;
  }
  return false;
}
