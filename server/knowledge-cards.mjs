import { now, uid } from './database.mjs';
import { canDocument, canEdit, cleanString, requireValue } from './security.mjs';

const KIND_CARD = 'knowledgeCard';
const KIND_TEMPLATE = 'cardTemplate';

const DEFAULT_CARD_TEMPLATES = [
  { id: 'card_concept', name: '概念解释', fields: ['questions', 'conditions', 'conclusion', 'exceptions', 'ownerDept'] },
  { id: 'card_rule', name: '规则说明', fields: ['questions', 'conditions', 'conclusion', 'exceptions', 'ownerDept'] },
  { id: 'card_guide', name: '操作指引', fields: ['questions', 'conditions', 'conclusion', 'steps', 'materials', 'exceptions', 'ownerDept'] },
  { id: 'card_faq', name: '常见问答', fields: ['questions', 'conditions', 'conclusion', 'exceptions'] },
];

function ensureCardTemplates(store) {
  for (const template of DEFAULT_CARD_TEMPLATES) {
    if (!store.get(KIND_TEMPLATE, template.id)) store.put(KIND_TEMPLATE, { ...template, revision: 1, updatedAt: now(), builtin: true });
  }
}

function actorOf(context) {
  return context.currentActor ? context.currentActor() : context.user;
}

function canSeeCard(store, user, card) {
  if (!card) return false;
  if (!card.sourceDocumentIds?.length) return canEdit(user);
  return card.sourceDocumentIds.every(id => {
    const doc = store.get('document', id);
    return doc && canDocument(user, doc, store);
  });
}

function publicCard(store, user, card) {
  if (!canSeeCard(store, user, card)) return null;
  const sources = (card.sourceDocumentIds || []).map(id => store.get('document', id)).filter(Boolean).map(doc => ({
    id: doc.id, title: doc.title, version: doc.version, status: doc.status,
  }));
  return {
    ...card,
    sources,
    canManage: canEdit(user) && (card.sourceDocumentIds || []).every(id => {
      const doc = store.get('document', id);
      return !doc || canDocument(user, doc, store, { write: true });
    }),
  };
}

function normalizeFields(input = {}) {
  return {
    questions: Array.isArray(input.questions) ? input.questions.map(v => cleanString(v, 200)).filter(Boolean).slice(0, 20) : [],
    conditions: cleanString(input.conditions, 2000),
    conclusion: cleanString(input.conclusion, 4000),
    steps: Array.isArray(input.steps) ? input.steps.map(v => cleanString(v, 500)).filter(Boolean).slice(0, 30) : [],
    materials: Array.isArray(input.materials) ? input.materials.map(v => cleanString(v, 200)).filter(Boolean).slice(0, 30) : [],
    exceptions: cleanString(input.exceptions, 2000),
    ownerDept: cleanString(input.ownerDept, 120),
  };
}

function normalizeEvidence(refs = []) {
  return (Array.isArray(refs) ? refs : []).slice(0, 40).map(ref => ({
    documentId: cleanString(ref.documentId, 120),
    blockId: cleanString(ref.blockId, 120),
    title: cleanString(ref.title, 200),
    page: Number(ref.page) || null,
    text: cleanString(ref.text, 800),
  })).filter(ref => ref.documentId);
}

export function listCardTemplates(store) {
  ensureCardTemplates(store);
  return { templates: store.list(KIND_TEMPLATE).sort((a, b) => a.name.localeCompare(b.name, 'zh')) };
}

export function saveCardTemplates(store, user, input = {}) {
  requireValue(canEdit(user), 403, 'EDITOR_REQUIRED', '配置卡片模板需要编辑权限。');
  ensureCardTemplates(store);
  const templates = Array.isArray(input.templates) ? input.templates : [];
  requireValue(templates.length <= 20, 400, 'INVALID_TEMPLATES', '模板过多。');
  const saved = [];
  for (const row of templates) {
    const id = cleanString(row.id, 80) || uid('cardtmpl_');
    const existing = store.get(KIND_TEMPLATE, id);
    const next = {
      id,
      name: cleanString(row.name, 80),
      fields: Array.isArray(row.fields) ? row.fields.map(f => cleanString(f, 40)).filter(Boolean).slice(0, 20) : [],
      builtin: existing?.builtin || false,
      revision: (existing?.revision || 0) + 1,
      updatedAt: now(),
    };
    requireValue(next.name && next.fields.length, 400, 'INVALID_TEMPLATE', '模板名称与字段不能为空。');
    saved.push(store.put(KIND_TEMPLATE, next));
  }
  return { templates: saved };
}

export function listKnowledgeCards(store, user, query = {}) {
  ensureCardTemplates(store);
  const status = cleanString(query.status, 40);
  const q = cleanString(query.q, 200).toLowerCase();
  const object = cleanString(query.object, 120).toLowerCase();
  const cards = store.list(KIND_CARD)
    .map(card => publicCard(store, user, card))
    .filter(Boolean)
    .filter(card => (!status || card.status === status)
      && (!q || `${card.title} ${card.fields?.conclusion || ''} ${(card.fields?.questions || []).join(' ')}`.toLowerCase().includes(q))
      && (!object || `${card.title} ${card.fields?.conclusion || ''} ${(card.fields?.questions || []).join(' ')}`.toLowerCase().includes(object)))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { cards: cards.slice(0, 200), templates: listCardTemplates(store).templates };
}

export function createKnowledgeCard(store, user, input = {}) {
  requireValue(canEdit(user), 403, 'EDITOR_REQUIRED', '创建知识卡片需要编辑权限。');
  ensureCardTemplates(store);
  const title = cleanString(input.title, 200);
  requireValue(title, 400, 'TITLE_REQUIRED', '请填写卡片标题。');
  const template = cleanString(input.template, 40) || 'card_concept';
  requireValue(store.get(KIND_TEMPLATE, template) || DEFAULT_CARD_TEMPLATES.some(t => t.id === template), 400, 'INVALID_TEMPLATE', '卡片模板无效。');
  const sourceDocumentIds = [...new Set((Array.isArray(input.sourceDocumentIds) ? input.sourceDocumentIds : []).map(id => cleanString(id, 120)).filter(Boolean))].slice(0, 20);
  for (const id of sourceDocumentIds) {
    const doc = store.get('document', id);
    requireValue(doc && canDocument(user, doc, store), 404, 'DOCUMENT_NOT_FOUND', '关联资料不存在或无权访问。');
  }
  const evidenceRefs = normalizeEvidence(input.evidenceRefs);
  // Draft from system must not be treated as confirmed standard wording.
  const status = input.fromSystem ? 'draft' : (['draft', 'review'].includes(input.status) ? input.status : 'draft');
  const card = {
    id: uid('kcard_'),
    title,
    template,
    status,
    fields: normalizeFields(input.fields),
    evidenceRefs,
    relatedCardIds: [...new Set((input.relatedCardIds || []).map(id => cleanString(id, 120)).filter(Boolean))].slice(0, 20),
    sourceDocumentIds,
    conflicts: Array.isArray(input.conflicts) ? input.conflicts.slice(0, 10).map(c => cleanString(c, 500)).filter(Boolean) : [],
    version: 1,
    revision: 1,
    createdAt: now(),
    updatedAt: now(),
    createdBy: user.id,
    fromSystem: !!input.fromSystem,
  };
  store.put(KIND_CARD, card);
  store.audit(user, 'knowledge.card.created', { target: card.id, message: card.title });
  return { card: publicCard(store, user, card) };
}

export function updateKnowledgeCard(store, user, id, input = {}) {
  requireValue(canEdit(user), 403, 'EDITOR_REQUIRED', '编辑知识卡片需要编辑权限。');
  const card = store.get(KIND_CARD, id);
  requireValue(card && publicCard(store, user, card)?.canManage, 404, 'CARD_NOT_FOUND', '卡片不存在或无权编辑。');
  requireValue(Number(input.revision) === card.revision, 409, 'REVISION_CONFLICT', '卡片已被更新，请刷新后重试。');
  const sourceDocumentIds = input.sourceDocumentIds ? [...new Set(input.sourceDocumentIds.map(v => cleanString(v, 120)).filter(Boolean))].slice(0, 20) : card.sourceDocumentIds;
  for (const docId of sourceDocumentIds) {
    const doc = store.get('document', docId);
    requireValue(doc && canDocument(user, doc, store), 404, 'DOCUMENT_NOT_FOUND', '关联资料不存在或无权访问。');
  }
  const next = {
    ...card,
    title: input.title !== undefined ? cleanString(input.title, 200) : card.title,
    template: input.template ? cleanString(input.template, 40) : card.template,
    fields: input.fields ? normalizeFields(input.fields) : card.fields,
    evidenceRefs: input.evidenceRefs ? normalizeEvidence(input.evidenceRefs) : card.evidenceRefs,
    relatedCardIds: input.relatedCardIds ? [...new Set(input.relatedCardIds.map(v => cleanString(v, 120)).filter(Boolean))].slice(0, 20) : card.relatedCardIds,
    sourceDocumentIds,
    conflicts: input.conflicts ? input.conflicts.slice(0, 10).map(c => cleanString(c, 500)).filter(Boolean) : card.conflicts,
    revision: card.revision + 1,
    updatedAt: now(),
    updatedBy: user.id,
  };
  requireValue(next.title, 400, 'TITLE_REQUIRED', '请填写卡片标题。');
  // Source change on published cards requests recheck.
  if (card.status === 'published' && JSON.stringify(card.sourceDocumentIds) !== JSON.stringify(sourceDocumentIds)) next.status = 'recheck';
  store.put(KIND_CARD, next);
  store.audit(user, 'knowledge.card.updated', { target: id });
  return { card: publicCard(store, user, next) };
}

export function knowledgeCardAction(store, user, id, input = {}) {
  requireValue(canEdit(user), 403, 'EDITOR_REQUIRED', '卡片审核需要编辑权限。');
  const card = store.get(KIND_CARD, id);
  requireValue(card && publicCard(store, user, card)?.canManage, 404, 'CARD_NOT_FOUND', '卡片不存在或无权操作。');
  requireValue(Number(input.revision) === card.revision, 409, 'REVISION_CONFLICT', '卡片已被更新，请刷新后重试。');
  const action = cleanString(input.action, 40);
  const transitions = {
    submit: { from: ['draft', 'returned', 'recheck'], to: 'review' },
    publish: { from: ['review'], to: 'published' },
    disable: { from: ['published', 'recheck'], to: 'disabled' },
    recheck: { from: ['published'], to: 'recheck' },
    reopen: { from: ['disabled', 'review'], to: 'draft' },
  };
  requireValue(transitions[action], 400, 'INVALID_ACTION', '不支持的卡片动作。');
  requireValue(transitions[action].from.includes(card.status), 409, 'INVALID_STATUS', '当前状态不能执行该操作。');
  if (action === 'publish') {
    requireValue(card.fields?.conclusion, 400, 'CONCLUSION_REQUIRED', '发布前请填写核心结论。');
    requireValue((card.evidenceRefs || []).length > 0, 400, 'EVIDENCE_REQUIRED', '关键结论须关联原文依据。');
    // Do not auto-merge conflicting multi-source content.
    requireValue(!(card.conflicts || []).length || input.acknowledgeConflicts === true, 409, 'CONFLICTS_PENDING', '存在多来源差异，请确认后保留差异再发布。');
  }
  const next = {
    ...card,
    status: transitions[action].to,
    version: action === 'publish' ? card.version + (card.status === 'published' ? 0 : 0) || card.version : card.version,
    revision: card.revision + 1,
    updatedAt: now(),
    updatedBy: user.id,
    publishedAt: action === 'publish' ? now() : card.publishedAt,
  };
  if (action === 'publish') next.version = card.version + 1;
  store.put(KIND_CARD, next);
  store.audit(user, 'knowledge.card.' + action, { target: id, message: next.title });
  return { card: publicCard(store, user, next) };
}

export function draftCardFromDocuments(store, user, input = {}) {
  requireValue(canEdit(user), 403, 'EDITOR_REQUIRED', '生成卡片草稿需要编辑权限。');
  const documentIds = [...new Set((input.documentIds || []).map(id => cleanString(id, 120)).filter(Boolean))].slice(0, 5);
  requireValue(documentIds.length, 400, 'DOCUMENTS_REQUIRED', '请指定至少一份资料。');
  const docs = documentIds.map(id => store.get('document', id));
  requireValue(docs.every(doc => doc && canDocument(user, doc, store)), 404, 'DOCUMENT_NOT_FOUND', '资料不存在或无权访问。');
  const evidenceRefs = [];
  const conflicts = [];
  const conclusions = [];
  for (const doc of docs) {
    const chunk = store.chunks(doc.id)[0];
    if (chunk) {
      evidenceRefs.push({ documentId: doc.id, blockId: chunk.id, title: doc.title, page: chunk.page, text: chunk.text.slice(0, 400) });
      conclusions.push(`《${doc.title}》：${(chunk.text || doc.summary || '').slice(0, 120)}`);
    }
  }
  if (docs.length > 1) conflicts.push('多份资料内容已并列保留，尚未确认为同一口径，请人工核对后发布。');
  return createKnowledgeCard(store, user, {
    title: cleanString(input.title, 200) || `${docs[0].title}相关说明`,
    template: cleanString(input.template, 40) || 'card_concept',
    fromSystem: true,
    sourceDocumentIds: documentIds,
    evidenceRefs,
    conflicts,
    fields: {
      questions: [cleanString(input.question, 200) || `关于${docs[0].title}的要点是什么？`],
      conditions: docs.map(d => d.applicability || '').filter(Boolean).join('；') || '请核对各资料适用范围',
      conclusion: conclusions.join('\n') || '系统草稿：请对照原文完善核心结论',
      exceptions: conflicts[0] || '',
      ownerDept: docs[0].department || '',
    },
  });
}

export async function handleKnowledgeCards(context) {
  const { pathname, method, store, res, send, url } = context;
  if (!pathname.startsWith('/api/knowledge-cards') && pathname !== '/api/card-templates') return false;
  const user = actorOf(context);
  const body = async () => context.bodyOf(context.req);
  if (pathname === '/api/card-templates' && method === 'GET') {
    send(res, 200, listCardTemplates(store));
    return true;
  }
  if (pathname === '/api/card-templates' && method === 'PUT') {
    send(res, 200, saveCardTemplates(store, actorOf(context), await body()));
    return true;
  }
  if (pathname === '/api/knowledge-cards' && method === 'GET') {
    send(res, 200, listKnowledgeCards(store, user, Object.fromEntries(url.searchParams)));
    return true;
  }
  if (pathname === '/api/knowledge-cards' && method === 'POST') {
    send(res, 201, createKnowledgeCard(store, actorOf(context), await body()));
    return true;
  }
  if (pathname === '/api/knowledge-cards/draft-from-documents' && method === 'POST') {
    send(res, 201, draftCardFromDocuments(store, actorOf(context), await body()));
    return true;
  }
  const match = pathname.match(/^\/api\/knowledge-cards\/([^/]+)(?:\/(actions))?$/);
  if (match && method === 'PATCH' && !match[2]) {
    send(res, 200, updateKnowledgeCard(store, actorOf(context), match[1], await body()));
    return true;
  }
  if (match && match[2] === 'actions' && method === 'POST') {
    send(res, 200, knowledgeCardAction(store, actorOf(context), match[1], await body()));
    return true;
  }
  return false;
}

export function publishedCardsForSearch(store, user, query = '') {
  const q = cleanString(query, 200).toLowerCase();
  return store.list(KIND_CARD)
    .map(card => publicCard(store, user, card))
    .filter(card => card && card.status === 'published')
    .filter(card => !q || `${card.title} ${(card.fields?.questions || []).join(' ')} ${card.fields?.conclusion || ''}`.toLowerCase().includes(q))
    .slice(0, 12);
}
