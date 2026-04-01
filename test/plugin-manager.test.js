import test from 'node:test';
import assert from 'node:assert/strict';
import PluginManager, {
  normalizeActionResult,
  validatePluginConfigData
} from '../src/sync/plugin-manager.js';

test('plugin registry exposes expected plugins and telegram dynamic select metadata', async () => {
  await PluginManager.loadPlugins();

  const registry = PluginManager.getPluginRegistry();
  const ids = registry.map(plugin => plugin.id).sort();

  assert.deepEqual(ids, ['flomo', 'mastodon', 'mem0', 'memu', 'telegram']);

  const telegram = registry.find(plugin => plugin.id === 'telegram');
  const telegramFields = telegram.manifest.settings.sections[0].fields;
  const defaultChannelField = telegram.manifest.settings.sections[0].fields.find(
    field => field.key === 'defaultChannel'
  );
  const appendSourceField = telegramFields.find(field => field.key === 'appendSourceTag');
  const boldFirstLineField = telegramFields.find(field => field.key === 'boldFirstLine');
  const boldFirstLineIndex = telegramFields.findIndex(field => field.key === 'boldFirstLine');
  const appendSourceIndex = telegramFields.findIndex(field => field.key === 'appendSourceTag');

  assert.equal(defaultChannelField.type, 'select');
  assert.equal(defaultChannelField.optionsSource.path, 'channels');
  assert.equal(appendSourceField.type, 'boolean');
  assert.equal(boldFirstLineField.label, '笔记发布TG时首行加粗');
  assert.equal(appendSourceField.label, '笔记发布TG时结尾增加source标识');
  assert.ok(appendSourceIndex > boldFirstLineIndex);
});

test('plugin config validation rejects invalid manifest-driven payloads', async () => {
  await PluginManager.loadPlugins();

  const flomo = PluginManager.getPlugin('flomo');
  const invalid = validatePluginConfigData({ apiUrl: '' }, flomo.manifest);

  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors[0].field, 'apiUrl');
});

test('validatePluginConfigData and normalizeActionResult return structured results', async () => {
  await PluginManager.loadPlugins();

  const telegram = PluginManager.getPlugin('telegram');
  const invalid = validatePluginConfigData({
    botToken: 'bad-token',
    defaultChannel: '@demo'
  }, telegram.manifest);

  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors[0].field, 'botToken');

  const normalized = normalizeActionResult({
    success: true,
    message: '连接成功',
    channels: [{ id: '1', title: 'Demo' }]
  });

  assert.deepEqual(normalized, {
    success: true,
    message: '连接成功',
    warnings: [],
    data: {
      channels: [{ id: '1', title: 'Demo' }]
    }
  });
});
