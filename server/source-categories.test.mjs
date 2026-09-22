import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from './database.mjs';
import { listSourceCategories, updateSourceCategories, resolveSourceCategory } from './source-categories.mjs';

function fixture(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const dir = mkdtempSync(path.join(temporaryRoot, 'xrag-source-categories-'));
  const context = { dir, store: createStore(dir) };
  context.admin = { id: 'category-admin', role: 'admin', active: true, name: '类别管理员' };
  context.editor = { id: 'category-editor', role: 'editor', active: true, name: '资料维护人' };
  context.viewer = { id: 'category-viewer', role: 'viewer', active: true, name: '资料使用人' };
  for (const user of [context.admin, context.editor, context.viewer]) context.store.put('user', user);
  context.list = (user = context.admin) => listSourceCategories(context.store, user);
  context.save = (config, user = context.admin) => updateSourceCategories(context.store, user, config);
  t.after(() => {
    context.store.close();
    assert.ok(path.resolve(dir).startsWith(temporaryRoot + path.sep));
    rmSync(dir, { recursive: true, force: true });
  });
  return context;
}

function addCategory(f, overrides = {}) {
  const config = f.list();
  return f.save({ ...config, categories: [...config.categories, { name: '企业制度与规程', sourceKind: 'internal_controlled', enabled: true, ...overrides }] });
}

test('source categories are available to active users and persist additions with administrator auditing', t => {
  const f = fixture(t), defaults = f.list();
  assert.equal(defaults.revision, 1);
  assert.equal(defaults.categories.length, 5);
  assert.ok(defaults.categories.every(category => category.id === category.sourceKind && category.builtin && category.enabled));
  assert.equal(f.list(f.editor).canManage, false);
  assert.equal(f.list(f.viewer).canManage, false);
  assert.equal(f.store.get('setting', 'sourceCategories'), null, 'reading defaults must not write a configuration');
  const saved = addCategory(f), custom = saved.categories.at(-1);
  assert.equal(saved.revision, 2);
  assert.match(custom.id, /^source_category_/);
  assert.equal(custom.builtin, false);
  assert.equal(custom.sourceKind, 'internal_controlled');
  assert.equal(saved.canManage, true);
  assert.equal(f.store.events(10)[0].action, 'source_categories.updated');
  f.store.close();
  f.store = createStore(f.dir);
  assert.deepEqual(f.list(), saved);
});

test('source category settings reject non-admin, inactive and stale actor permissions', t => {
  const f = fixture(t), config = f.list();
  for (const user of [f.editor, f.viewer]) assert.throws(() => f.save(config, user), { status: 403, code: 'ADMIN_REQUIRED' });
  f.store.put('user', { ...f.admin, role: 'editor' });
  assert.throws(() => f.save(config), { status: 403, code: 'ADMIN_REQUIRED' });
  f.store.put('user', { ...f.admin, active: false });
  assert.throws(() => f.save(config), { status: 401, code: 'AUTH_REQUIRED' });
  assert.throws(() => f.list(), { status: 401, code: 'AUTH_REQUIRED' });
  assert.throws(() => listSourceCategories(f.store, { id: 'missing', role: 'admin', active: true }), { status: 401 });
  assert.equal(f.store.get('setting', 'sourceCategories'), null);
});

test('full-list edits require matching revisions and reject malformed or conflicting category names', t => {
  const f = fixture(t), first = f.list(), saved = addCategory(f);
  assert.throws(() => f.save(first), { status: 409, code: 'SOURCE_CATEGORIES_CHANGED' });
  assert.throws(() => f.save({ categories: saved.categories }), { status: 409, code: 'SOURCE_CATEGORIES_CHANGED' });
  const failNew = (category, code) => assert.throws(() => f.save({ ...saved, categories: [...saved.categories, category] }), { code });
  failNew({ name: '   ', sourceKind: 'reference' }, 'SOURCE_CATEGORY_NAME_REQUIRED');
  failNew({ name: '资料'.repeat(31), sourceKind: 'reference' }, 'SOURCE_CATEGORY_NAME_TOO_LONG');
  failNew({ name: '  官方公开资料  ', sourceKind: 'reference' }, 'DUPLICATE_SOURCE_CATEGORY_NAME');
  failNew({ name: '异常\u0000名称', sourceKind: 'reference' }, 'INVALID_SOURCE_CATEGORY_NAME');
  failNew({ name: '新类别', sourceKind: 'trusted_automatic' }, 'INVALID_SOURCE_KIND');
  failNew({ name: '新类别', sourceKind: 'reference', enabled: 'true' }, 'INVALID_SOURCE_CATEGORY_ENABLED');
  failNew({ name: '新类别', sourceKind: 'reference', enabled: null }, 'INVALID_SOURCE_CATEGORY_ENABLED');
  assert.throws(() => f.save(null), { code: 'INVALID_SOURCE_CATEGORIES' });
  failNew({ name: '伪造类别', sourceKind: 'reference', id: 'injected-id' }, 'INVALID_SOURCE_CATEGORY_ID');
  failNew(saved.categories[0], 'DUPLICATE_SOURCE_CATEGORY_ID');
  assert.throws(() => f.save({ ...saved, categories: saved.categories.slice(1) }), { code: 'SOURCE_CATEGORY_REMOVAL_FORBIDDEN' });
  assert.throws(() => f.save({ ...saved, categories: saved.categories.map(category => category.id === 'unspecified' ? { ...category, enabled: false } : category) }), { code: 'SOURCE_CATEGORY_FALLBACK_REQUIRED' });
  assert.deepEqual(f.list(), saved, 'invalid saves must not change revision or categories');
});

test('renaming and disabling preserve stored document classification, name snapshots and safe core meaning', t => {
  const f = fixture(t), saved = addCategory(f, { name: '培训模拟资料', sourceKind: 'synthetic' }), custom = saved.categories.at(-1);
  const metadata = resolveSourceCategory(f.store, { sourceCategoryId: custom.id, sourceKind: 'synthetic' });
  const document = { id: 'historical-document', title: '模拟培训课件', ...metadata };
  f.store.put('document', document);
  assert.throws(() => f.save({ ...saved, categories: saved.categories.map(category => category.id === custom.id ? { ...category, sourceKind: 'official_public' } : category) }), { code: 'SOURCE_CATEGORY_KIND_IMMUTABLE' });
  const renamed = f.save({ ...saved, categories: saved.categories.map(category => category.id === custom.id ? { ...category, name: '演练和合成资料', enabled: false } : category) });
  assert.equal(renamed.categories.at(-1).name, '演练和合成资料');
  assert.equal(renamed.categories.at(-1).enabled, false);
  assert.deepEqual(f.store.get('document', document.id), document);
  assert.deepEqual(resolveSourceCategory(f.store, { sourceCategoryId: custom.id }, document), metadata);
  assert.throws(() => resolveSourceCategory(f.store, { sourceCategoryId: custom.id }), { code: 'SOURCE_CATEGORY_DISABLED' });
  assert.throws(() => resolveSourceCategory(f.store, { sourceCategoryId: custom.id }, { ...document, sourceKind: 'official_public' }), { code: 'SOURCE_CATEGORY_DISABLED' });
  const stored = f.store.get('setting', 'sourceCategories').categories.at(-1);
  assert.deepEqual(stored.previousNames, ['培训模拟资料']);
  assert.equal(stored.sourceKind, 'synthetic');
});

test('resolution preserves legacy kinds and replaces stale custom mapping only when explicitly requested', t => {
  const f = fixture(t), saved = addCategory(f), custom = saved.categories.at(-1);
  assert.deepEqual(resolveSourceCategory(f.store, {}), {});
  assert.deepEqual(resolveSourceCategory(f.store, { sourceKind: 'official_public', sourceCategoryName: '伪造名称' }), { sourceKind: 'official_public', sourceCategoryId: 'official_public', sourceCategoryName: '官方公开资料' });
  const previous = { id: 'doc', ...resolveSourceCategory(f.store, { sourceCategoryId: custom.id }) };
  assert.deepEqual(resolveSourceCategory(f.store, { businessOwner: '资料维护人' }, previous), {});
  const changed = resolveSourceCategory(f.store, { sourceKind: 'reference' }, previous);
  assert.equal(changed.sourceCategoryId, 'reference');
  assert.equal(changed.sourceCategoryName, '参考资料');
  assert.equal(changed.sourceKind, 'reference');
  assert.throws(() => resolveSourceCategory(f.store, { sourceCategoryId: custom.id, sourceKind: 'official_public' }), { code: 'SOURCE_CATEGORY_KIND_MISMATCH' });
  assert.throws(() => resolveSourceCategory(f.store, { sourceCategoryId: 'nonexistent' }), { code: 'SOURCE_CATEGORY_NOT_FOUND' });
  assert.throws(() => resolveSourceCategory(f.store, { sourceCategoryId: '' }), { code: 'INVALID_SOURCE_CATEGORY_ID' });
  const disabled = f.save({ ...saved, categories: saved.categories.map(category => category.id === 'reference' ? { ...category, enabled: false } : category) });
  assert.throws(() => resolveSourceCategory(f.store, { sourceKind: 'reference' }), { code: 'SOURCE_CATEGORY_DISABLED' });
  assert.equal(resolveSourceCategory(f.store, { sourceKind: 'reference' }, { id: 'legacy', sourceKind: 'reference' }).sourceCategoryId, 'reference');
  assert.throws(() => f.save({ ...disabled, categories: disabled.categories.filter(category => category.id !== custom.id) }), { code: 'SOURCE_CATEGORY_REMOVAL_FORBIDDEN' });
});

