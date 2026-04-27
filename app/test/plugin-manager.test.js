import test from 'node:test';
import assert from 'node:assert/strict';
import PluginManager, {
  normalizeActionResult,
  resolvePluginExecutionOrder,
  validatePluginConfigData
} from '../src/sync/plugin-manager.js';

test('plugin registry exposes expected plugins and telegram channel visibility metadata', async () => {
  await PluginManager.loadPlugins();

  const registry = PluginManager.getPluginRegistry();
  const ids = registry.map(plugin => plugin.id).sort();

  assert.deepEqual(ids, ['flomo', 'mastodon', 'missky', 'obsidian-local', 'telegram']);

  const telegram = registry.find(plugin => plugin.id === 'telegram');
  const telegramSections = telegram.manifest.settings.sections;
  const telegramFields = telegramSections.flatMap(section => section.fields || []);
  const homeChannelsField = telegramFields.find(field => field.key === 'homeChannels');
  const appendSourceField = telegramFields.find(field => field.key === 'appendSourceTag');
  const boldFirstLineField = telegramFields.find(field => field.key === 'boldFirstLine');
  const lineBreakPerLineField = telegramFields.find(field => field.key === 'addLineBreakPerLine');
  const channelsSection = telegramSections.find(section => section.id === 'channels');
  const tgOptimizeSection = telegramSections.find(section => section.id === 'tgOptimize');
  const boldFirstLineIndex = telegramFields.findIndex(field => field.key === 'boldFirstLine');
  const appendSourceIndex = telegramFields.findIndex(field => field.key === 'appendSourceTag');
  const lineBreakPerLineIndex = telegramFields.findIndex(field => field.key === 'addLineBreakPerLine');

  assert.equal(channelsSection.title, '频道设置');
  assert.equal(channelsSection.actions[0].id, 'discoverChannels');
  assert.equal(homeChannelsField.type, 'checkboxGroup');
  assert.equal(homeChannelsField.optionsSource.path, 'channels');
  assert.equal(tgOptimizeSection.title, 'TG发布优化设置');
  assert.equal(tgOptimizeSection.description, '点击“Telegram”按钮后生成TG发布格式时的相关设置');
  assert.equal(appendSourceField.type, 'boolean');
  assert.equal(boldFirstLineField.label, '笔记发布TG时首行加粗');
  assert.equal(boldFirstLineField.description, undefined);
  assert.equal(appendSourceField.label, '笔记发布TG时结尾增加source标识');
  assert.equal(appendSourceField.description, '将原文中的最后一个网址改为source标识并放在尾段末尾');
  assert.equal(lineBreakPerLineField.label, '为每一行添加换行');
  assert.equal(lineBreakPerLineField.description, undefined);
  assert.ok(appendSourceIndex > boldFirstLineIndex);
  assert.ok(lineBreakPerLineIndex > appendSourceIndex);

  const flomo = registry.find(plugin => plugin.id === 'flomo');
  const mastodon = registry.find(plugin => plugin.id === 'mastodon');
  const missky = registry.find(plugin => plugin.id === 'missky');
  const obsidianLocal = registry.find(plugin => plugin.id === 'obsidian-local');

  assert.equal(flomo.manifest.ui.homeV2.section, 'publish_simple');
  assert.equal(mastodon.manifest.ui.homeV2.label, 'CMX');
  assert.equal(missky.manifest.ui.homeV2.section, 'publish_simple');
  assert.equal(telegram.manifest.ui.homeV2.section, 'publish_advanced');
  assert.equal(obsidianLocal.manifest.ui.homeV2.section, 'save_local');
  for (const plugin of [flomo, mastodon, missky, obsidianLocal, telegram]) {
    assert.equal(plugin.manifest.capabilities.media.settingsDescription, undefined);
    assert.equal(typeof plugin.manifest.capabilities.media.maxImages, 'number');
  }
  const obsidianFields = obsidianLocal.manifest.settings.sections.flatMap(section => section.fields || []);
  assert.deepEqual(
    obsidianFields.map(field => field.key),
    ['diaryPath', 'noteVaultPath', 'imageSavePath', 'filenameRule']
  );
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
    homeChannels: ['@demo']
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

test('resolvePluginExecutionOrder honors manifest dependsOn graph', () => {
  const order = resolvePluginExecutionOrder([
    ['telegram', { manifest: { dependsOn: ['flomo'] } }],
    ['flomo', { manifest: { dependsOn: [] } }]
  ]);

  assert.ok(order.indexOf('flomo') < order.indexOf('telegram'));
});
