import { now, uid } from './database.mjs';
import { SOURCE_KINDS } from './governance.mjs';
import { isAdmin, requireValue } from './security.mjs';

const SETTING_ID = 'sourceCategories';
const MAX_CATEGORIES = 100;
const MAX_NAME_LENGTH = 60;
const DEFAULT_CATEGORIES = [
  { id: 'unspecified', name: '尚未分类', sourceKind: 'unspecified', enabled: true, builtin: true },
  { id: 'official_public', name: '官方公开资料', sourceKind: 'official_public', enabled: true, builtin: true },
  { id: 'internal_controlled', name: '内部受控文件', sourceKind: 'internal_controlled', enabled: true, builtin: true },
  { id: 'synthetic', name: '行业示例 / 合成资料', sourceKind: 'synthetic', enabled: true, builtin: true },
  { id: 'reference', name: '参考资料', sourceKind: 'reference', enabled: true, builtin: true },
];

function currentUser(store, user) {
  const current = user?.id ? store.get('user', user.id) : null;
  requireValue(current?.active, 401, 'AUTH_REQUIRED', '会话权限已更新，请重新登录。');
  return current;
}

function configuration(store) {
  return store.get('setting', SETTING_ID) || { id: SETTING_ID, revision: 1, categories: DEFAULT_CATEGORIES.map(category => ({ ...category })), updatedAt: null };
}

function publicConfiguration(config, user) {
  return {
    revision: config.revision,
    categories: config.categories.map(({ id, name, sourceKind, enabled, builtin }) => ({ id, name, sourceKind, enabled, builtin })),
    canManage: isAdmin(user),
    updatedAt: config.updatedAt,
  };
}

export function listSourceCategories(store, user) {
  return publicConfiguration(configuration(store), currentUser(store, user));
}

function categoryName(value) {
  requireValue(typeof value === 'string', 400, 'SOURCE_CATEGORY_NAME_REQUIRED', '请填写资料来源类别名称。');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  requireValue(name.length > 0, 400, 'SOURCE_CATEGORY_NAME_REQUIRED', '请填写资料来源类别名称。');
  requireValue([...name].length <= MAX_NAME_LENGTH, 400, 'SOURCE_CATEGORY_NAME_TOO_LONG', `资料来源类别名称最多 ${MAX_NAME_LENGTH} 个字符。`);
  requireValue(!/[\u0000-\u001f\u007f]/u.test(name), 400, 'INVALID_SOURCE_CATEGORY_NAME', '资料来源类别名称包含无效字符。');
  return name;
}

// Saving the complete list makes ordering explicit. Existing IDs are retained
// permanently; disable a category to stop new selection without changing history.
export function updateSourceCategories(store, user, input = {}) {
  return store.transaction(() => {
    const actor = currentUser(store, user);
    requireValue(isAdmin(actor), 403, 'ADMIN_REQUIRED', '仅管理员可以设置资料来源类别。');
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 400, 'INVALID_SOURCE_CATEGORIES', '资料来源类别设置格式不正确。');
    const previous = configuration(store);
    requireValue(Number.isSafeInteger(input.revision) && input.revision === previous.revision, 409, 'SOURCE_CATEGORIES_CHANGED', '资料来源类别已更新，请刷新后再保存。');
    requireValue(Array.isArray(input.categories) && input.categories.length > 0 && input.categories.length <= MAX_CATEGORIES, 400, 'INVALID_SOURCE_CATEGORIES', `请保留已有类别，类别总数不能超过 ${MAX_CATEGORIES} 个。`);
    const previousById = new Map(previous.categories.map(category => [category.id, category]));
    const seenIds = new Set(), seenNames = new Set(), timestamp = now();
    const categories = input.categories.map(item => {
      requireValue(item && typeof item === 'object' && !Array.isArray(item), 400, 'INVALID_SOURCE_CATEGORY', '资料来源类别格式不正确。');
      requireValue(item.id === undefined || (typeof item.id === 'string' && item.id.length > 0), 400, 'INVALID_SOURCE_CATEGORY_ID', '资料来源类别标识无效。');
      const existing = item.id === undefined ? null : previousById.get(item.id);
      requireValue(item.id === undefined || existing, 400, 'INVALID_SOURCE_CATEGORY_ID', '新增类别无需填写标识；已有类别请刷新后重试。');
      const id = existing?.id || uid('source_category_');
      requireValue(!seenIds.has(id), 400, 'DUPLICATE_SOURCE_CATEGORY_ID', '资料来源类别不能重复。');
      seenIds.add(id);
      const name = categoryName(item.name), normalizedName = name.toLocaleLowerCase('zh-CN');
      requireValue(!seenNames.has(normalizedName), 400, 'DUPLICATE_SOURCE_CATEGORY_NAME', '资料来源类别名称不能重复。');
      seenNames.add(normalizedName);
      const sourceKind = item.sourceKind ?? existing?.sourceKind;
      requireValue(SOURCE_KINDS.includes(sourceKind), 400, 'INVALID_SOURCE_KIND', '请为资料来源类别选择有效的来源性质。');
      requireValue(!existing || sourceKind === existing.sourceKind, 409, 'SOURCE_CATEGORY_KIND_IMMUTABLE', '已有类别的来源性质不能更改；请新增类别并停用旧类别。');
      const enabled = item.enabled === undefined ? (existing?.enabled ?? true) : item.enabled;
      requireValue(typeof enabled === 'boolean', 400, 'INVALID_SOURCE_CATEGORY_ENABLED', '类别启用状态无效。');
      requireValue(id !== 'unspecified' || enabled, 400, 'SOURCE_CATEGORY_FALLBACK_REQUIRED', '尚未分类须保持启用，以便接收待确认来源的资料。');
      const previousNames = existing?.previousNames || [];
      return {
        id, name, sourceKind, enabled, builtin: existing?.builtin || false,
        createdAt: existing?.createdAt || timestamp, updatedAt: timestamp,
        previousNames: existing && existing.name !== name ? [...new Set([...previousNames, existing.name])] : [...previousNames],
      };
    });
    requireValue(previous.categories.every(category => seenIds.has(category.id)), 409, 'SOURCE_CATEGORY_REMOVAL_FORBIDDEN', '已有类别不能删除，请改为停用，以保留历史资料的来源记录。');
    const next = { id: SETTING_ID, revision: previous.revision + 1, categories, updatedAt: timestamp, updatedBy: actor.id };
    store.put('setting', next);
    store.audit(actor, 'source_categories.updated', {
      target: SETTING_ID, revision: next.revision,
      categories: categories.map(({ id, name, sourceKind, enabled, builtin }) => ({ id, name, sourceKind, enabled, builtin })),
    });
    return publicConfiguration(next, actor);
  });
}

// Call only after checking the caller's document/base write permission. Store the
// returned name alongside the ID: later category renames must not rewrite history.
export function resolveSourceCategory(store, input = {}, existingDoc = null) {
  if (input.sourceCategoryId === undefined && input.sourceKind === undefined) return {};
  const config = configuration(store);
  const categoryId = input.sourceCategoryId ?? input.sourceKind;
  requireValue(typeof categoryId === 'string' && categoryId.length > 0, 400, 'INVALID_SOURCE_CATEGORY_ID', '请选择资料来源类别。');
  const category = config.categories.find(item => item.id === categoryId);
  requireValue(category, 400, 'SOURCE_CATEGORY_NOT_FOUND', '资料来源类别不存在，请刷新后重新选择。');
  requireValue(input.sourceKind === undefined || input.sourceKind === category.sourceKind, 400, 'SOURCE_CATEGORY_KIND_MISMATCH', '资料来源类别与来源性质不一致，请重新选择类别。');
  const existingCategoryId = existingDoc?.sourceCategoryId || existingDoc?.sourceKind;
  const unchanged = existingCategoryId === category.id && existingDoc?.sourceKind === category.sourceKind;
  requireValue(category.enabled || unchanged, 409, 'SOURCE_CATEGORY_DISABLED', '该资料来源类别已停用，请选择其他类别。');
  return {
    sourceCategoryId: category.id,
    sourceCategoryName: unchanged && existingDoc.sourceCategoryName ? existingDoc.sourceCategoryName : category.name,
    sourceKind: category.sourceKind,
  };
}

