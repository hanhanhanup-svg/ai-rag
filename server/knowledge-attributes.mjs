import { now, uid } from './database.mjs';
import { canDocument, canEdit, cleanString, requireValue, isAdmin } from './security.mjs';

const KIND_TEMPLATE = 'attributeTemplate';
const KIND_ANNOTATION = 'attributeAnnotation';

const DEFAULT_TEMPLATES = [
  {
    id: 'tmpl_policy',
    knowledgeType: 'policy',
    name: '制度文件',
    fields: [
      { key: 'topic', label: '内容主题', required: true, valueType: 'string' },
      { key: 'businessDomain', label: '业务领域', required: true, valueType: 'string' },
      { key: 'issuer', label: '发布单位', required: false, valueType: 'string' },
      { key: 'docNo', label: '文号', required: false, valueType: 'string' },
      { key: 'audience', label: '适用对象', required: true, valueType: 'string' },
      { key: 'effectiveAt', label: '生效日期', required: false, valueType: 'date' },
      { key: 'validity', label: '有效状态', required: true, valueType: 'enum', enum: ['effective', 'expiring', 'expired', 'unknown'] },
      { key: 'sourceBasis', label: '来源依据', required: false, valueType: 'string' },
    ],
  },
  {
    id: 'tmpl_manual',
    knowledgeType: 'manual',
    name: '操作手册',
    fields: [
      { key: 'topic', label: '内容主题', required: true, valueType: 'string' },
      { key: 'businessDomain', label: '业务领域', required: true, valueType: 'string' },
      { key: 'audience', label: '适用对象', required: true, valueType: 'string' },
      { key: 'ownerDept', label: '责任部门', required: false, valueType: 'string' },
      { key: 'validity', label: '有效状态', required: true, valueType: 'enum', enum: ['effective', 'expiring', 'expired', 'unknown'] },
    ],
  },
  {
    id: 'tmpl_product',
    knowledgeType: 'product',
    name: '产品资料',
    fields: [
      { key: 'topic', label: '内容主题', required: true, valueType: 'string' },
      { key: 'businessDomain', label: '业务领域', required: false, valueType: 'string' },
      { key: 'audience', label: '适用对象', required: false, valueType: 'string' },
      { key: 'validity', label: '有效状态', required: true, valueType: 'enum', enum: ['effective', 'expiring', 'expired', 'unknown'] },
    ],
  },
  {
    id: 'tmpl_case',
    knowledgeType: 'case',
    name: '项目案例',
    fields: [
      { key: 'topic', label: '内容主题', required: true, valueType: 'string' },
      { key: 'businessDomain', label: '业务领域', required: true, valueType: 'string' },
      { key: 'audience', label: '适用对象', required: false, valueType: 'string' },
      { key: 'ownerDept', label: '责任部门', required: false, valueType: 'string' },
      { key: 'validity', label: '有效状态', required: false, valueType: 'enum', enum: ['effective', 'expiring', 'expired', 'unknown'] },
    ],
  },
];

function ensureTemplates(store) {
  for (const template of DEFAULT_TEMPLATES) {
    if (!store.get(KIND_TEMPLATE, template.id)) {
      store.put(KIND_TEMPLATE, { ...template, revision: 1, updatedAt: now(), builtin: true });
    }
  }
}

function actorOf(context) {
  return context.currentActor ? context.currentActor() : context.user;
}

function publicTemplate(row) {
  return row;
}

function publicAnnotation(store, user, row) {
  if (!row) return null;
  const doc = row.documentId ? store.get('document', row.documentId) : null;
  if (row.documentId && (!doc || !canDocument(user, doc, store))) return null;
  return {
    ...row,
    documentTitle: doc?.title || null,
    canManage: canEdit(user) && (!row.documentId || canDocument(user, doc, store, { write: true })),
  };
}

function extractHints(document, chunks) {
  const text = [document.title, document.summary, document.applicability, ...(document.tags || []), ...(chunks || []).slice(0, 5).map(c => c.text)].join('\n');
  const values = [];
  const push = (key, value, source, evidenceRef) => {
    if (!value) return;
    values.push({ key, value: String(value).slice(0, 200), source, status: source === 'explicit' ? 'pending_review' : 'pending_review', evidenceRef: evidenceRef || null });
  };
  push('topic', document.title, document.title ? 'explicit' : 'inferred');
  if (document.applicability) push('audience', document.applicability, 'explicit');
  if (document.department) push('ownerDept', document.department, 'explicit');
  if (document.businessOwner) push('issuer', document.businessOwner, 'inferred');
  if (document.effectiveAt) push('effectiveAt', document.effectiveAt.slice(0, 10), 'explicit');
  if (document.expiresAt && Date.parse(document.expiresAt) <= Date.now()) push('validity', 'expired', 'explicit');
  else if (document.status === 'published') push('validity', 'effective', 'inferred');
  else push('validity', 'unknown', 'inferred');
  const domains = ['客运', '运营', '维修', '培训', '设备', '安监'];
  const hit = domains.find(d => text.includes(d));
  if (hit) push('businessDomain', hit, 'inferred');
  if ((document.tags || []).length) push('sourceBasis', document.tags.slice(0, 5).join('、'), 'explicit');
  return values;
}

export function listAttributeTemplates(store) {
  ensureTemplates(store);
  return { templates: store.list(KIND_TEMPLATE).sort((a, b) => a.name.localeCompare(b.name, 'zh')).map(publicTemplate) };
}

export function saveAttributeTemplates(store, user, input = {}) {
  requireValue(isAdmin(user) || canEdit(user), 403, 'EDITOR_REQUIRED', '配置属性模板需要编辑权限。');
  ensureTemplates(store);
  const templates = Array.isArray(input.templates) ? input.templates : null;
  requireValue(templates && templates.length <= 20, 400, 'INVALID_TEMPLATES', '模板列表无效。');
  const saved = [];
  store.transaction(() => {
    for (const row of templates) {
      const id = cleanString(row.id, 80) || uid('tmpl_');
      const existing = store.get(KIND_TEMPLATE, id);
      const fields = Array.isArray(row.fields) ? row.fields.slice(0, 30).map(field => ({
        key: cleanString(field.key, 40),
        label: cleanString(field.label, 80),
        required: !!field.required,
        valueType: ['string', 'date', 'enum'].includes(field.valueType) ? field.valueType : 'string',
        enum: Array.isArray(field.enum) ? field.enum.map(v => cleanString(v, 40)).filter(Boolean).slice(0, 20) : undefined,
      })).filter(f => f.key && f.label) : [];
      requireValue(fields.length > 0, 400, 'TEMPLATE_FIELDS_REQUIRED', '模板至少包含一个字段。');
      const next = {
        id,
        knowledgeType: cleanString(row.knowledgeType, 40) || 'custom',
        name: cleanString(row.name, 80),
        fields,
        builtin: existing?.builtin || false,
        revision: (existing?.revision || 0) + 1,
        updatedAt: now(),
      };
      requireValue(next.name, 400, 'NAME_REQUIRED', '请填写模板名称。');
      saved.push(store.put(KIND_TEMPLATE, next));
    }
  });
  store.audit(user, 'attribute.templates.updated', { message: `更新 ${saved.length} 个属性模板` });
  return { templates: saved };
}

export function listAttributeAnnotations(store, user, query = {}) {
  ensureTemplates(store);
  const documentId = cleanString(query.documentId, 120);
  const targetType = cleanString(query.targetType, 40);
  const status = cleanString(query.status, 40);
  const rows = store.list(KIND_ANNOTATION)
    .map(row => publicAnnotation(store, user, row))
    .filter(Boolean)
    .filter(row => (!documentId || row.documentId === documentId) && (!targetType || row.targetType === targetType) && (!status || row.values?.some(v => v.status === status) || row.status === status))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { annotations: rows.slice(0, 200), templates: listAttributeTemplates(store).templates };
}

export function suggestAttributeAnnotation(store, user, input = {}) {
  requireValue(canEdit(user), 403, 'EDITOR_REQUIRED', '智能标注需要编辑权限。');
  const documentId = cleanString(input.documentId, 120);
  const document = store.get('document', documentId);
  requireValue(document && canDocument(user, document, store), 404, 'DOCUMENT_NOT_FOUND', '文档不存在或无权访问。');
  ensureTemplates(store);
  const templateId = cleanString(input.templateId, 80) || 'tmpl_policy';
  const template = store.get(KIND_TEMPLATE, templateId) || store.get(KIND_TEMPLATE, 'tmpl_policy');
  requireValue(template, 404, 'TEMPLATE_NOT_FOUND', '属性模板不存在。');
  const chunks = store.chunks(documentId);
  const hinted = extractHints(document, chunks);
  const allowed = new Set(template.fields.map(f => f.key));
  const values = hinted.filter(v => allowed.has(v.key)).map(v => {
    const field = template.fields.find(f => f.key === v.key);
    // Inferred values stay pending_review; never auto-confirm sensitive fields.
    const sensitive = ['validity', 'audience', 'effectiveAt'].includes(v.key);
    return {
      ...v,
      source: v.source === 'explicit' ? 'explicit' : 'inferred',
      status: 'pending_review',
      note: sensitive && v.source === 'inferred' ? '推断结果，需人工确认后生效' : (v.source === 'inferred' ? '模型/规则推断，待确认' : '来自原文登记字段，待确认'),
      label: field?.label || v.key,
    };
  });
  // Do not invent missing required fields.
  for (const field of template.fields.filter(f => f.required)) {
    if (!values.some(v => v.key === field.key)) {
      values.push({ key: field.key, label: field.label, value: '', source: 'inferred', status: 'pending_review', note: '未能识别，请人工补充，不得填造', evidenceRef: null });
    }
  }
  const annotation = {
    id: uid('attr_'),
    targetType: cleanString(input.targetType, 20) || 'document',
    targetId: cleanString(input.targetId, 120) || documentId,
    documentId,
    templateId: template.id,
    values,
    status: 'draft',
    revision: 1,
    createdAt: now(),
    updatedAt: now(),
    createdBy: user.id,
  };
  store.put(KIND_ANNOTATION, annotation);
  store.audit(user, 'attribute.suggested', { target: documentId, message: '生成属性标注草稿' });
  return { annotation: publicAnnotation(store, user, annotation) };
}

export function saveAttributeAnnotation(store, user, input = {}) {
  requireValue(canEdit(user), 403, 'EDITOR_REQUIRED', '维护属性需要编辑权限。');
  const id = cleanString(input.id, 120);
  const existing = id ? store.get(KIND_ANNOTATION, id) : null;
  const documentId = cleanString(input.documentId || existing?.documentId, 120);
  const document = store.get('document', documentId);
  requireValue(document && canDocument(user, document, store, { write: true }), 404, 'DOCUMENT_NOT_FOUND', '文档不存在或无权写入。');
  if (existing) requireValue(Number(input.revision) === existing.revision, 409, 'REVISION_CONFLICT', '标注已被更新，请刷新后重试。');
  const values = Array.isArray(input.values) ? input.values.slice(0, 40).map(v => ({
    key: cleanString(v.key, 40),
    label: cleanString(v.label, 80),
    value: cleanString(v.value, 500),
    source: ['explicit', 'inferred', 'manual'].includes(v.source) ? v.source : 'manual',
    status: ['draft', 'pending_review', 'confirmed'].includes(v.status) ? v.status : 'pending_review',
    evidenceRef: v.evidenceRef || null,
    note: cleanString(v.note, 300),
    inheritedFrom: v.inheritedFrom || null,
    override: !!v.override,
  })).filter(v => v.key) : [];
  const next = {
    id: existing?.id || uid('attr_'),
    targetType: cleanString(input.targetType || existing?.targetType, 20) || 'document',
    targetId: cleanString(input.targetId || existing?.targetId, 120) || documentId,
    documentId,
    templateId: cleanString(input.templateId || existing?.templateId, 80) || 'tmpl_policy',
    values,
    status: cleanString(input.status || existing?.status, 40) || 'draft',
    revision: (existing?.revision || 0) + 1,
    createdAt: existing?.createdAt || now(),
    updatedAt: now(),
    createdBy: existing?.createdBy || user.id,
    updatedBy: user.id,
  };
  store.put(KIND_ANNOTATION, next);
  store.audit(user, 'attribute.saved', { target: next.id, documentId });
  return { annotation: publicAnnotation(store, user, next) };
}

export function attributeAnnotationAction(store, user, id, input = {}) {
  requireValue(canEdit(user), 403, 'EDITOR_REQUIRED', '审核属性需要编辑权限。');
  const row = store.get(KIND_ANNOTATION, id);
  requireValue(row, 404, 'ANNOTATION_NOT_FOUND', '标注不存在。');
  requireValue(Number(input.revision) === row.revision, 409, 'REVISION_CONFLICT', '标注已被更新，请刷新后重试。');
  const document = store.get('document', row.documentId);
  requireValue(document && canDocument(user, document, store, { write: true }), 403, 'FORBIDDEN', '无权审核该文档标注。');
  const action = cleanString(input.action, 40);
  requireValue(['submit_review', 'confirm', 'reject', 'batch_confirm'].includes(action), 400, 'INVALID_ACTION', '不支持的标注动作。');
  let values = row.values || [];
  if (action === 'submit_review') values = values.map(v => ({ ...v, status: v.value ? 'pending_review' : v.status }));
  if (action === 'confirm' || action === 'batch_confirm') {
    // Important attrs require explicit confirmation; never auto-fill empty required.
    values = values.map(v => {
      if (!v.value) return { ...v, status: 'pending_review', note: v.note || '空值不能确认' };
      if (v.source === 'inferred' && !input.allowInferred && ['validity', 'audience', 'effectiveAt'].includes(v.key)) {
        return { ...v, status: 'pending_review', note: '重要属性的推断结果需逐项确认' };
      }
      return { ...v, status: 'confirmed' };
    });
  }
  if (action === 'reject') values = values.map(v => ({ ...v, status: 'draft' }));
  const next = {
    ...row,
    values,
    status: action === 'confirm' || action === 'batch_confirm' ? (values.every(v => !v.value || v.status === 'confirmed') ? 'confirmed' : 'pending_review') : action === 'submit_review' ? 'pending_review' : 'draft',
    revision: row.revision + 1,
    updatedAt: now(),
    updatedBy: user.id,
  };
  store.put(KIND_ANNOTATION, next);
  store.audit(user, 'attribute.' + action, { target: id, documentId: row.documentId });
  return { annotation: publicAnnotation(store, user, next) };
}

export async function handleKnowledgeAttributes(context) {
  const { pathname, method, store, res, send, url } = context;
  if (!pathname.startsWith('/api/attribute-')) return false;
  const user = actorOf(context);
  const body = async () => {
    const input = await context.bodyOf(context.req);
    return input;
  };
  if (pathname === '/api/attribute-templates' && method === 'GET') {
    send(res, 200, listAttributeTemplates(store));
    return true;
  }
  if (pathname === '/api/attribute-templates' && method === 'PUT') {
    const input = await body();
    send(res, 200, saveAttributeTemplates(store, actorOf(context), input));
    return true;
  }
  if (pathname === '/api/attribute-annotations' && method === 'GET') {
    send(res, 200, listAttributeAnnotations(store, user, Object.fromEntries(url.searchParams)));
    return true;
  }
  if (pathname === '/api/attribute-annotations' && method === 'POST') {
    const input = await body();
    send(res, 201, saveAttributeAnnotation(store, actorOf(context), input));
    return true;
  }
  if (pathname === '/api/attribute-annotations/suggest' && method === 'POST') {
    const input = await body();
    send(res, 200, suggestAttributeAnnotation(store, actorOf(context), input));
    return true;
  }
  const actionMatch = pathname.match(/^\/api\/attribute-annotations\/([^/]+)\/actions$/);
  if (actionMatch && method === 'POST') {
    const input = await body();
    send(res, 200, attributeAnnotationAction(store, actorOf(context), actionMatch[1], input));
    return true;
  }
  return false;
}
