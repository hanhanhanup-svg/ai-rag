import { now, uid } from './database.mjs';
import { canEdit, cleanString, requireValue, isAdmin } from './security.mjs';
import { search } from './retrieval.mjs';
import { publishedCardsForSearch } from './knowledge-cards.mjs';

const KIND = 'answerCompleteness';
const SETTING_ID = 'answerCompletenessConfig';

const POINT_PATTERNS = [
  { id: 'approver', label: '审批主体', patterns: [/谁审批|审批人|审批主体|由谁批|哪个部门批/] },
  { id: 'materials', label: '所需材料', patterns: [/提交什么|需要什么材料|所需材料|带什么|准备哪些/] },
  { id: 'deadline', label: '办理时限', patterns: [/多久|时限|几个工作日|办完|办理期限|几天内/] },
  { id: 'process', label: '办理步骤', patterns: [/怎么办理|如何办理|流程|步骤|怎么办/] },
  { id: 'conditions', label: '适用条件', patterns: [/适用|条件|范围|什么情况|是否可以/] },
  { id: 'exceptions', label: '例外说明', patterns: [/例外|特殊情况|不适用|但书/] },
  { id: 'owner', label: '责任部门', patterns: [/责任部门|归口|主管部门|联系谁/] },
];

function actorOf(context) {
  return context.currentActor ? context.currentActor() : context.user;
}

function defaultConfig() {
  return {
    id: SETTING_ID,
    defaultMode: 'hybrid',
    autoComplete: false,
    requireReview: true,
    createDemandOnGap: true,
    allowedBaseIds: [],
    updatedAt: now(),
  };
}

export function getCompletenessConfig(store) {
  return store.get('setting', SETTING_ID) || defaultConfig();
}

export function saveCompletenessConfig(store, user, input = {}) {
  requireValue(isAdmin(user), 403, 'ADMIN_REQUIRED', '补全配置需要管理员权限。');
  const current = getCompletenessConfig(store);
  const next = {
    ...current,
    defaultMode: ['smart', 'knowledge', 'hybrid'].includes(input.defaultMode) ? input.defaultMode : current.defaultMode,
    autoComplete: input.autoComplete === true,
    requireReview: input.requireReview !== false,
    createDemandOnGap: input.createDemandOnGap !== false,
    allowedBaseIds: Array.isArray(input.allowedBaseIds) ? input.allowedBaseIds.map(id => cleanString(id, 120)).filter(Boolean).slice(0, 50) : current.allowedBaseIds,
    updatedAt: now(),
  };
  store.put('setting', next);
  store.audit(user, 'completeness.config.updated', {});
  return { config: next };
}

function detectPoints(question) {
  const q = String(question || '');
  const points = POINT_PATTERNS.filter(p => p.patterns.some(re => re.test(q))).map(p => ({ id: p.id, label: p.label }));
  if (!points.length) {
    return [
      { id: 'core', label: '核心答复' },
      { id: 'conditions', label: '适用条件' },
      { id: 'basis', label: '依据说明' },
    ];
  }
  return points;
}

function statusForPoint(point, answer, citations) {
  const text = String(answer || '');
  const hasCite = (citations || []).length > 0;
  const keywords = {
    approver: [/审批|批准|审核|签批/],
    materials: [/材料|资料|表格|附件|证件/],
    deadline: [/工作日|日内|时限|期限|小时|天内/],
    process: [/步骤|流程|首先|然后|提交/],
    conditions: [/适用|条件|范围|情形/],
    exceptions: [/例外|特殊|不适用于/],
    owner: [/部门|归口|负责/],
    core: [/.+/],
    basis: [/依据|根据|原文|规定/],
  };
  const matched = (keywords[point.id] || [/./]).some(re => re.test(text));
  if (!matched) return hasCite ? 'missing' : 'insufficient';
  if (point.id === 'deadline' && !/(工作日|日内|小时|天内|\d+\s*日)/.test(text)) return 'partial';
  if (point.id === 'materials' && !/(材料|资料|表|证)/.test(text)) return 'partial';
  if (!hasCite && point.id !== 'core') return 'partial';
  return 'answered';
}

export function analyzeAnswerCompleteness(store, user, input = {}) {
  const question = cleanString(input.question, 2000);
  requireValue(question, 400, 'QUESTION_REQUIRED', '请提供用户问题。');
  const answer = cleanString(input.answer, 8000);
  const citations = Array.isArray(input.citations) ? input.citations : [];
  const runId = cleanString(input.runId, 120);
  const traceId = cleanString(input.traceId, 120);
  const points = detectPoints(question);
  const checklist = points.map(point => {
    let status = statusForPoint(point, answer, citations);
    if (/哪个单位|所属单位|哪个线路/.test(question) && !/(单位|线路|车站|部门)/.test(answer || '')) {
      if (['approver', 'deadline', 'materials'].includes(point.id)) status = 'need_condition';
    }
    return {
      id: point.id,
      label: point.label,
      status,
      note: ({
        answered: '已提供与当前条件相符、具有依据的答复',
        partial: '已涉及该事项，但缺少关键条件、步骤、例外或必要说明',
        missing: '答案遗漏该事项',
        need_condition: '缺少决定答案的业务条件，应向用户澄清',
        insufficient: '当前检索范围内依据不足或存在冲突',
      })[status],
    };
  });
  const record = {
    id: uid('ac_'),
    runId: runId || null,
    traceId: traceId || null,
    question,
    answer,
    citations,
    checklist,
    completionMode: null,
    suggestions: [],
    demandIds: [],
    createdAt: now(),
    updatedAt: now(),
    createdBy: user.id,
  };
  store.put(KIND, record);
  return { analysis: record, config: getCompletenessConfig(store) };
}

function smartSuggestions(checklist, question) {
  // Smart mode may suggest structure/clarifications, never invent enterprise facts.
  return checklist.filter(item => ['missing', 'partial', 'need_condition', 'insufficient'].includes(item.status)).map(item => ({
    pointId: item.id,
    mode: 'smart',
    kind: item.status === 'need_condition' ? 'clarification' : 'structure',
    title: item.status === 'need_condition' ? `澄清「${item.label}」所需条件` : `补全「${item.label}」的结构说明`,
    content: item.status === 'need_condition'
      ? `回答「${item.label}」前，需要用户补充所属单位/业务类型等条件。`
      : `建议补充「${item.label}」的完整说明，并关联原文依据；在未找到依据前不得填写具体企业规定数值。`,
    evidenceRefs: [],
    pendingConfirm: true,
    factual: false,
  }));
}

async function knowledgeSuggestions(store, user, checklist, question, baseId) {
  const gaps = checklist.filter(item => ['missing', 'partial', 'insufficient'].includes(item.status));
  const suggestions = [];
  for (const item of gaps) {
    const query = `${question} ${item.label}`;
    const found = await search(store, user, query, { baseId: baseId || '', limit: 4 });
    const cards = publishedCardsForSearch(store, user, item.label);
    const evidenceRefs = (found.results || []).slice(0, 3).map(row => ({
      documentId: row.documentId,
      blockId: row.id,
      title: row.title,
      page: row.page,
      text: row.text?.slice(0, 300),
    }));
    for (const card of cards.slice(0, 2)) {
      evidenceRefs.push({
        documentId: card.sourceDocumentIds?.[0] || card.id,
        blockId: card.id,
        title: card.title,
        page: null,
        text: (card.fields?.conclusion || '').slice(0, 300),
        cardId: card.id,
      });
    }
    if (!evidenceRefs.length) {
      suggestions.push({
        pointId: item.id,
        mode: 'knowledge',
        kind: 'gap',
        title: `「${item.label}」未找到有效依据`,
        content: `当前检索范围内未找到明确的「${item.label}」，不能自动补成具体企业规定。`,
        evidenceRefs: [],
        pendingConfirm: true,
        factual: false,
      });
      continue;
    }
    suggestions.push({
      pointId: item.id,
      mode: 'knowledge',
      kind: 'fact',
      title: `基于现有知识补全「${item.label}」`,
      content: evidenceRefs.map(ref => ref.text).filter(Boolean).join('\n---\n').slice(0, 1200),
      evidenceRefs,
      pendingConfirm: true,
      factual: true,
    });
  }
  return suggestions;
}

export async function completeAnswerAnalysis(store, user, input = {}) {
  requireValue(canEdit(user) || isAdmin(user), 403, 'FORBIDDEN', '执行补全需要相应权限。');
  const id = cleanString(input.id, 120);
  const record = store.get(KIND, id);
  requireValue(record, 404, 'ANALYSIS_NOT_FOUND', '完整性分析结果不存在。');
  const config = getCompletenessConfig(store);
  const mode = ['smart', 'knowledge', 'hybrid'].includes(input.mode) ? input.mode : config.defaultMode;
  let suggestions = [];
  if (mode === 'smart' || mode === 'hybrid') suggestions = suggestions.concat(smartSuggestions(record.checklist, record.question));
  if (mode === 'knowledge' || mode === 'hybrid') {
    suggestions = suggestions.concat(await knowledgeSuggestions(store, user, record.checklist, record.question, input.baseId || config.allowedBaseIds?.[0] || ''));
  }
  // Re-check: factual smart suggestions are forbidden.
  suggestions = suggestions.filter(s => !(s.mode === 'smart' && s.factual));
  const checklist = record.checklist.map(item => {
    const filled = suggestions.find(s => s.pointId === item.id && s.kind === 'fact' && s.evidenceRefs?.length);
    if (filled && item.status !== 'answered') return { ...item, status: 'partial', note: '已提供基于现有知识的补全建议，待确认后纳入答复' };
    return item;
  });
  const demandIds = [...(record.demandIds || [])];
  const unresolved = checklist.filter(item => ['missing', 'insufficient'].includes(item.status));
  if ((input.createDemand === true || (input.createDemand !== false && config.createDemandOnGap)) && unresolved.length) {
    const { createKnowledgeDemand } = await import('./knowledge-demands.mjs');
    const demand = createKnowledgeDemand(store, user, {
      question: record.question,
      category: 'knowledge_gap',
      missingPoints: unresolved.map(item => item.label),
      relatedRunId: record.runId,
      source: 'completeness',
      answer: record.answer,
      auto: true,
    });
    demandIds.push(demand.demand.id);
  }
  const next = {
    ...record,
    checklist,
    completionMode: mode,
    suggestions,
    demandIds,
    updatedAt: now(),
  };
  store.put(KIND, next);
  store.audit(user, 'completeness.completed', { target: id, mode });
  return { analysis: next };
}

export function getAnswerCompleteness(store, user, query = {}) {
  const runId = cleanString(query.runId, 120);
  const id = cleanString(query.id, 120);
  if (id) {
    const row = store.get(KIND, id);
    requireValue(row, 404, 'ANALYSIS_NOT_FOUND', '记录不存在。');
    return { analysis: row, config: getCompletenessConfig(store) };
  }
  const rows = store.list(KIND)
    .filter(row => !runId || row.runId === runId)
    .filter(row => isAdmin(user) || row.createdBy === user.id)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 50);
  return { items: rows, config: getCompletenessConfig(store) };
}

export async function handleAnswerCompleteness(context) {
  const { pathname, method, store, res, send, url } = context;
  if (!pathname.startsWith('/api/answer-completeness')) return false;
  const user = actorOf(context);
  const body = async () => context.bodyOf(context.req);
  if (pathname === '/api/answer-completeness/config' && method === 'GET') {
    send(res, 200, { config: getCompletenessConfig(store) });
    return true;
  }
  if (pathname === '/api/answer-completeness/config' && method === 'PUT') {
    send(res, 200, saveCompletenessConfig(store, actorOf(context), await body()));
    return true;
  }
  if (pathname === '/api/answer-completeness' && method === 'GET') {
    send(res, 200, getAnswerCompleteness(store, user, Object.fromEntries(url.searchParams)));
    return true;
  }
  if (pathname === '/api/answer-completeness/analyze' && method === 'POST') {
    send(res, 200, analyzeAnswerCompleteness(store, actorOf(context), await body()));
    return true;
  }
  if (pathname === '/api/answer-completeness/complete' && method === 'POST') {
    send(res, 200, await completeAnswerAnalysis(store, actorOf(context), await body()));
    return true;
  }
  return false;
}
