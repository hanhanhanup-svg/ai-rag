import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from './database.mjs';
import {
  listPublicProviders,
  createModelProvider,
  setDefaultModelProvider,
  updateModelProvider,
  deleteModelProvider,
  catalogFromProviders,
} from './model-providers.mjs';
import { chatModelCatalog, publicModel } from './retrieval.mjs';

test('model providers can be added, switched, and listed for chat catalog', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xrag-providers-'));
  const store = createStore(dir);
  try {
    assert.equal(listPublicProviders(store).length, 0);

    const first = await createModelProvider(store, {
      kind: 'deepseek',
      name: 'DeepSeek 测试',
      provider: 'compatible',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-deepseek-key-not-real',
      model: 'deepseek-v4-flash',
      models: [{ id: 'deepseek-v4-flash', label: 'Flash' }, { id: 'deepseek-chat', label: 'Chat' }],
      setDefault: true,
    });
    assert.equal(first.isDefault, true);
    assert.equal(publicModel(store).model, 'deepseek-v4-flash');
    assert.ok(publicModel(store).hasApiKey);

    const second = await createModelProvider(store, {
      kind: 'openai',
      name: 'OpenAI 测试',
      provider: 'compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-openai-key-not-real',
      model: 'gpt-4.1-mini',
      models: [{ id: 'gpt-4.1-mini', label: 'Mini' }],
      setDefault: false,
    });
    assert.equal(second.isDefault, false);

    const switched = setDefaultModelProvider(store, { providerId: second.id, model: 'gpt-4.1-mini' });
    assert.equal(switched.model.model, 'gpt-4.1-mini');
    assert.equal(listPublicProviders(store).find(row => row.id === second.id)?.isDefault, true);

    const catalog = catalogFromProviders(store);
    assert.ok(catalog.models.some(row => row.id === 'deepseek-v4-flash'));
    assert.ok(catalog.models.some(row => row.id === 'gpt-4.1-mini'));
    assert.equal(chatModelCatalog(store).defaultModel, 'gpt-4.1-mini');

    await updateModelProvider(store, first.id, { enabled: false });
    assert.equal(listPublicProviders(store).find(row => row.id === first.id)?.enabled, false);

    assert.throws(() => deleteModelProvider(store, second.id), error => error.code === 'DEFAULT_PROVIDER');
    deleteModelProvider(store, first.id);
    assert.equal(listPublicProviders(store).some(row => row.id === first.id), false);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
