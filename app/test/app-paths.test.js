import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  getAppDir,
  getDataDirPath,
  getDataPath,
  getPluginConfigPath,
  getPluginDataPath,
  getProjectDir,
  getUserDataDir,
  hasUserData,
  ensureUserDataLayout,
  migrateLegacyUserData
} from '../src/utils/app-paths.js';

const originalDataDir = process.env.JOURNAL_SYNC_DATA_DIR;

test.afterEach(() => {
  if (originalDataDir === undefined) {
    delete process.env.JOURNAL_SYNC_DATA_DIR;
  } else {
    process.env.JOURNAL_SYNC_DATA_DIR = originalDataDir;
  }
});

test('default user-data dir is outside app in portable layout', () => {
  delete process.env.JOURNAL_SYNC_DATA_DIR;

  assert.equal(path.basename(getAppDir()), 'app');
  assert.equal(getProjectDir(), path.dirname(getAppDir()));
  assert.equal(getUserDataDir(), path.join(getProjectDir(), 'user-data'));
  assert.equal(getDataPath('config.json'), path.join(getProjectDir(), 'user-data', 'config.json'));
  assert.equal(
    getPluginConfigPath('telegram'),
    path.join(getProjectDir(), 'user-data', 'plugins', 'telegram', 'config.json')
  );
  assert.equal(
    getPluginDataPath('telegram', 'channels.json'),
    path.join(getProjectDir(), 'user-data', 'plugins', 'telegram', 'channels.json')
  );
});

test('JOURNAL_SYNC_DATA_DIR overrides every runtime data path', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-sync-paths-'));
  process.env.JOURNAL_SYNC_DATA_DIR = tempDir;

  assert.equal(getUserDataDir(), tempDir);
  assert.equal(getDataPath('config.json'), path.join(tempDir, 'config.json'));
  assert.equal(getDataDirPath('image-cache'), path.join(tempDir, 'image-cache'));
  assert.equal(getPluginConfigPath('flomo'), path.join(tempDir, 'plugins', 'flomo', 'config.json'));
  assert.equal(getPluginDataPath('telegram', 'channels.json'), path.join(tempDir, 'plugins', 'telegram', 'channels.json'));

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('ensureUserDataLayout creates first-run runtime directories', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-sync-layout-'));
  process.env.JOURNAL_SYNC_DATA_DIR = tempDir;

  const userDataDir = await ensureUserDataLayout();

  assert.equal(userDataDir, tempDir);
  await fs.access(tempDir);
  await fs.access(path.join(tempDir, 'draft-cache'));
  await fs.access(path.join(tempDir, 'image-cache'));
  await fs.access(path.join(tempDir, 'mem0_vectors'));
  await fs.access(path.join(tempDir, 'plugins'));

  assert.equal(await hasUserData(), false);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('hasUserData detects core files, cache dirs, and plugin configs', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-sync-user-data-'));
  process.env.JOURNAL_SYNC_DATA_DIR = tempDir;

  assert.equal(await hasUserData(), false);

  await fs.mkdir(path.join(tempDir, 'draft-cache'), { recursive: true });
  assert.equal(await hasUserData(), false);

  await fs.writeFile(path.join(tempDir, 'draft-cache', 'home-v2.json'), '{}', 'utf-8');
  assert.equal(await hasUserData(), true);

  await fs.rm(tempDir, { recursive: true, force: true });

  const pluginOnlyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-sync-plugin-data-'));
  process.env.JOURNAL_SYNC_DATA_DIR = pluginOnlyDir;
  await fs.mkdir(path.join(pluginOnlyDir, 'plugins', 'obsidian-local'), { recursive: true });
  await fs.writeFile(path.join(pluginOnlyDir, 'plugins', 'obsidian-local', 'config.json'), '{}', 'utf-8');

  assert.equal(await hasUserData(), true);

  await fs.rm(pluginOnlyDir, { recursive: true, force: true });
});

test('migrateLegacyUserData copies legacy data and plugin configs into user-data', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-sync-migration-'));
  const targetDir = path.join(tempRoot, 'user-data');
  const legacyDataDir = path.join(tempRoot, 'legacy-data');
  const legacyPluginDir = path.join(tempRoot, 'legacy-plugins');
  process.env.JOURNAL_SYNC_DATA_DIR = targetDir;

  await fs.mkdir(path.join(legacyDataDir, 'draft-cache'), { recursive: true });
  await fs.mkdir(path.join(legacyPluginDir, 'Flomo'), { recursive: true });
  await fs.writeFile(path.join(legacyDataDir, 'history.json'), '{"items":[1]}', 'utf-8');
  await fs.writeFile(path.join(legacyDataDir, 'draft-cache', 'home-v2.json'), '{"content":"draft"}', 'utf-8');
  await fs.writeFile(path.join(legacyPluginDir, 'Flomo', 'config.json'), '{"apiUrl":"https://example.com"}', 'utf-8');

  const result = await migrateLegacyUserData({
    legacyDataDirs: [legacyDataDir],
    legacyPluginDirs: [legacyPluginDir]
  });

  assert.equal(result.migrated, true);
  assert.equal(result.copied, 3);
  assert.equal(await fs.readFile(path.join(targetDir, 'history.json'), 'utf-8'), '{"items":[1]}');
  assert.equal(
    await fs.readFile(path.join(targetDir, 'draft-cache', 'home-v2.json'), 'utf-8'),
    '{"content":"draft"}'
  );
  assert.equal(
    await fs.readFile(path.join(targetDir, 'plugins', 'flomo', 'config.json'), 'utf-8'),
    '{"apiUrl":"https://example.com"}'
  );

  const marker = JSON.parse(await fs.readFile(path.join(targetDir, '.migration.json'), 'utf-8'));
  assert.equal(marker.from, 'legacy-project-layout');
  assert.equal(marker.version, 1);
  assert.equal(marker.copied, 3);

  assert.equal(await fs.readFile(path.join(legacyDataDir, 'history.json'), 'utf-8'), '{"items":[1]}');
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('migrateLegacyUserData does not overwrite existing user-data', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'journal-sync-migration-skip-'));
  const targetDir = path.join(tempRoot, 'user-data');
  const legacyDataDir = path.join(tempRoot, 'legacy-data');
  process.env.JOURNAL_SYNC_DATA_DIR = targetDir;

  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(legacyDataDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'config.json'), '{"existing":true}', 'utf-8');
  await fs.writeFile(path.join(legacyDataDir, 'config.json'), '{"legacy":true}', 'utf-8');

  const result = await migrateLegacyUserData({
    legacyDataDirs: [legacyDataDir],
    legacyPluginDirs: []
  });

  assert.deepEqual(result, { migrated: false, reason: 'user-data-exists' });
  assert.equal(await fs.readFile(path.join(targetDir, 'config.json'), 'utf-8'), '{"existing":true}');
  await assert.rejects(
    fs.access(path.join(targetDir, '.migration.json')),
    error => error.code === 'ENOENT'
  );

  await fs.rm(tempRoot, { recursive: true, force: true });
});
