import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { optimizeContent } from '../sync/journal-sync.js';
import { promises as fsPromises } from 'fs';
import ConfigManager from '../utils/config-manager.js';
import { applyNetworkProxy, normalizeNetworkProxy } from '../utils/network-proxy.js';
import PluginManager from '../sync/plugin-manager.js';
import multer from 'multer';
import {
  loadConfig as loadObsidianLocalPluginConfig
} from '../../Plugin/Obsidian-Local/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OBSIDIAN_DIR = process.env.JOURNAL_SYNC_OBSIDIAN_PATH || '';

function normalizeAiApiType(rawApiType) {
  const normalized = String(rawApiType || '').trim().toLowerCase();
  if (normalized === 'responses' || normalized === 'response') {
    return 'responses';
  }
  return 'chat_completions';
}

function getAiEndpointUrl(baseUrl, apiType = 'chat_completions') {
  const trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    throw new Error('AI baseUrl 不能为空');
  }
  const url = new URL(trimmed);
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  const strippedPath = normalizedPath.replace(/\/(chat\/completions|responses)$/i, '');
  const endpointPath = normalizeAiApiType(apiType) === 'responses'
    ? '/responses'
    : '/chat/completions';
  if (!normalizedPath.endsWith(endpointPath)) {
    url.pathname = `${strippedPath || ''}${endpointPath}`;
  }
  return url.toString();
}

function buildAiRequestBody(aiConfig = {}, {
  systemPrompt,
  userPrompt,
  temperature = 0.3,
  maxTokens = 256
} = {}) {
  const apiType = normalizeAiApiType(aiConfig.apiType);

  if (apiType === 'responses') {
    const payload = {
      model: aiConfig.model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };
    if (typeof temperature === 'number') {
      payload.temperature = temperature;
    }
    if (Number.isFinite(maxTokens) && maxTokens > 0) {
      payload.max_output_tokens = maxTokens;
    }
    return payload;
  }

  const payload = {
    model: aiConfig.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };
  if (typeof temperature === 'number') {
    payload.temperature = temperature;
  }
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    payload.max_tokens = maxTokens;
  }
  return payload;
}

function extractAiText(result) {
  if (!result || typeof result !== 'object') return '';

  if (typeof result.output_text === 'string' && result.output_text.trim()) {
    return result.output_text.trim();
  }

  const firstChoice = Array.isArray(result.choices) ? result.choices[0] : null;
  if (firstChoice && typeof firstChoice === 'object') {
    if (typeof firstChoice.text === 'string' && firstChoice.text.trim()) {
      return firstChoice.text.trim();
    }

    const message = firstChoice.message;
    if (message && typeof message === 'object') {
      if (typeof message.content === 'string' && message.content.trim()) {
        return message.content.trim();
      }

      if (Array.isArray(message.content)) {
        const text = message.content.map((part) => {
          if (typeof part === 'string') return part;
          if (!part || typeof part !== 'object') return '';
          if (typeof part.text === 'string') return part.text;
          if (typeof part.content === 'string') return part.content;
          return '';
        }).join('').trim();

        if (text) return text;
      }
    }
  }

  if (Array.isArray(result.output)) {
    const text = result.output.map((item) => {
      if (!item || typeof item !== 'object' || !Array.isArray(item.content)) return '';
      return item.content.map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        return '';
      }).join('');
    }).join('').trim();

    if (text) return text;
  }

  return '';
}

function sanitizeAssetFilename(rawFilename) {
  if (typeof rawFilename !== 'string') return null;
  const trimmed = rawFilename.trim();
  if (!trimmed) return null;
  const normalized = path.basename(trimmed);
  if (!normalized || normalized === '.' || normalized === '..') return null;
  return normalized;
}

function isPathInsideDir(targetPath, baseDir) {
  const relative = path.relative(baseDir, targetPath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function trimTrailingUrlPunctuation(url) {
  return String(url || '').replace(/[)\],.!?;:，。！？；：》」』】）]+$/g, '');
}

function extractLastHttpsUrl(content) {
  const text = String(content || '');
  let cursor = text.length;

  while (cursor > 0) {
    const httpsIndex = text.lastIndexOf('https', cursor - 1);
    if (httpsIndex < 0) return '';

    const candidate = text.slice(httpsIndex);
    const match = candidate.match(/^https:\/\/[^\s<>"']+/i);
    if (match) {
      return trimTrailingUrlPunctuation(match[0]);
    }

    cursor = httpsIndex;
  }

  return '';
}

function normalizeSourceUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';

  if (url.toLowerCase().includes('bilibili')) {
    const bvMatch = url.match(/BV[0-9A-Za-z]{10}/);
    if (bvMatch) {
      return `https://www.bilibili.com/video/${bvMatch[0]}`;
    }
  }

  return url;
}

async function loadObsidianStorageConfig(coreConfig = null) {
  const config = coreConfig || await ConfigManager.loadConfig();
  const pluginConfig = await loadObsidianLocalPluginConfig().catch(() => ({}));
  const diaryPath = pluginConfig?.diaryPath || config?.diary?.obsidianPath || config?.obsidianPath || DEFAULT_OBSIDIAN_DIR;
  const noteVaultPath = pluginConfig?.noteVaultPath || config?.note?.vaultPath || config?.obsidianPath || diaryPath || DEFAULT_OBSIDIAN_DIR;
  const imageSavePath = pluginConfig?.imageSavePath || path.join(diaryPath, 'assets');

  return {
    diaryPath,
    noteVaultPath,
    imageSavePath,
    filenameRule: pluginConfig?.filenameRule || 'YYYY-MM-DD 日记'
  };
}

async function resolveCachedImagePaths(filenames = []) {
  const resolved = [];

  for (const rawFilename of Array.isArray(filenames) ? filenames : []) {
    const filename = sanitizeAssetFilename(rawFilename);
    if (!filename) continue;

    const cachePath = path.resolve(IMAGE_CACHE_DIR, filename);
    if (!isPathInsideDir(cachePath, IMAGE_CACHE_DIR)) continue;

    try {
      await fsPromises.access(cachePath);
      resolved.push(cachePath);
    } catch {}
  }

  return resolved;
}

function validateTelegramPublishPayload(body = {}) {
  const payload = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const { content, channel, type, imageFilenames, sourceUrl, tgFormattingApplied } = payload;
  if (content !== undefined && typeof content !== 'string') return 'content 必须是字符串';
  if (channel !== undefined && typeof channel !== 'string') return 'channel 必须是字符串';
  if (type !== undefined && !['diary', 'note'].includes(type)) return 'type 必须是 diary 或 note';
  if (sourceUrl !== undefined && typeof sourceUrl !== 'string') return 'sourceUrl 必须是字符串';
  if (tgFormattingApplied !== undefined && typeof tgFormattingApplied !== 'boolean') return 'tgFormattingApplied 必须是布尔值';
  if (imageFilenames !== undefined && (!Array.isArray(imageFilenames) || !imageFilenames.every(item => typeof item === 'string'))) {
    return 'imageFilenames 必须是字符串数组';
  }
  return null;
}

function validatePublishPayload(body = {}) {
  const payload = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const { content, targets, telegram, imageFilenames } = payload;
  if (content !== undefined && typeof content !== 'string') return 'content 必须是字符串';
  if (!Array.isArray(targets) || !targets.every(item => typeof item === 'string')) return 'targets 必须是字符串数组';
  if (telegram !== undefined && (typeof telegram !== 'object' || telegram === null || Array.isArray(telegram))) {
    return 'telegram 必须是对象';
  }
  if (telegram?.channel !== undefined && typeof telegram.channel !== 'string') return 'telegram.channel 必须是字符串';
  if (telegram?.content !== undefined && typeof telegram.content !== 'string') return 'telegram.content 必须是字符串';
  if (imageFilenames !== undefined && (!Array.isArray(imageFilenames) || !imageFilenames.every(item => typeof item === 'string'))) {
    return 'imageFilenames 必须是字符串数组';
  }
  return null;
}

function validateSaveLocalPayload(body = {}) {
  const payload = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const { content, type, options, imageFilenames } = payload;
  if (content !== undefined && typeof content !== 'string') return 'content 必须是字符串';
  if (type !== undefined && !['diary', 'note'].includes(type)) return 'type 必须是 diary 或 note';
  if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
    return 'options 必须是对象';
  }
  if (imageFilenames !== undefined && (!Array.isArray(imageFilenames) || !imageFilenames.every(item => typeof item === 'string'))) {
    return 'imageFilenames 必须是字符串数组';
  }
  return null;
}

// 初始化数据目录和基础配置
async function initDataFiles() {
  const dataDir = path.join(__dirname, '../../data');
  try {
    await fsPromises.mkdir(dataDir, { recursive: true });

    const defaults = {
      'config.json': {
        "obsidianPath": DEFAULT_OBSIDIAN_DIR,
        "plugins": {}
      },
      'tasks.json': []
    };

    for (const [file, defaultData] of Object.entries(defaults)) {
      const filePath = path.join(dataDir, file);
      try {
        await fsPromises.access(filePath);
      } catch (err) {
        if (err.code === 'ENOENT') {
          await fsPromises.writeFile(filePath, JSON.stringify(defaultData, null, 2), 'utf-8');
          console.log(`[Init] Created default ${file}`);
        } else {
          console.error(`[Init] File access error for ${file}:`, err);
        }
      }
    }
  } catch (error) {
    console.error('[Init] Error initializing data files:', error);
  }
}

async function initNetworkProxy() {
  try {
    const config = await ConfigManager.loadConfig();
    const proxyValue = config?.network?.proxy || '';
    if (!proxyValue) return;

    applyNetworkProxy(proxyValue);
    console.log(`[Proxy] 已启用全局代理: ${proxyValue}`);
  } catch (error) {
    console.error('[Proxy] 初始化失败:', error.message);
  }
}

// 启动时初始化文件然后加载插件
await initDataFiles();
await initNetworkProxy();
await PluginManager.loadPlugins();

const app = express();
const PORT = process.env.PORT || 3000;

// multer 配置：内存存储，限制单张图片 20MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  }
});

// 中间件
// 限制 CORS，防止跨站请求伪造利用本地服务 RCE
app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
app.use(express.json({ limit: '10mb' }));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/home-v2.html'));
});
app.get('/home-v2.html', (req, res) => {
  res.redirect('/');
});
app.use(express.static(path.join(__dirname, '../../public')));

// 运行时缓存
const IMAGE_CACHE_DIR = path.join(__dirname, '../../data/image-cache');
const DRAFT_CACHE_DIR = path.join(__dirname, '../../data/draft-cache');
const HOME_V2_DRAFT_FILE = path.join(DRAFT_CACHE_DIR, 'home-v2.json');

function createDefaultPluginStates(registry) {
  return registry.reduce((states, plugin) => {
    states[plugin.id] = plugin.manifest.enabledByDefault ?? false;
    return states;
  }, {});
}

async function loadPluginStates() {
  const config = await ConfigManager.loadConfig();
  const registry = PluginManager.getPluginRegistry();
  const defaults = createDefaultPluginStates(registry);
  return {
    ...defaults,
    ...(config.plugins || {})
  };
}

function normalizeDraftContent(rawContent) {
  return String(rawContent || '').replace(/\r\n/g, '\n');
}

function normalizeDraftImageFilenames(rawFilenames = []) {
  const seen = new Set();
  const normalized = [];

  for (const rawFilename of Array.isArray(rawFilenames) ? rawFilenames : []) {
    const filename = sanitizeAssetFilename(rawFilename);
    if (!filename || seen.has(filename)) continue;
    seen.add(filename);
    normalized.push(filename);
  }

  return normalized;
}

function buildHomeV2DraftPayload(rawDraft = {}) {
  return {
    content: normalizeDraftContent(rawDraft.content),
    imageFilenames: normalizeDraftImageFilenames(rawDraft.imageFilenames),
    updatedAt: typeof rawDraft.updatedAt === 'string' ? rawDraft.updatedAt : ''
  };
}

function isHomeV2DraftEmpty(draft) {
  const normalized = buildHomeV2DraftPayload(draft);
  return !normalized.content.trim() && normalized.imageFilenames.length === 0;
}

async function loadHomeV2Draft() {
  try {
    const data = await fsPromises.readFile(HOME_V2_DRAFT_FILE, 'utf-8');
    return buildHomeV2DraftPayload(JSON.parse(data));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[HomeV2Draft] 读取草稿失败:', error.message);
    }
    return buildHomeV2DraftPayload();
  }
}

async function deleteCachedImages(filenames = []) {
  for (const filename of normalizeDraftImageFilenames(filenames)) {
    const cachePath = path.resolve(IMAGE_CACHE_DIR, filename);
    if (!isPathInsideDir(cachePath, IMAGE_CACHE_DIR)) continue;
    await fsPromises.unlink(cachePath).catch(() => {});
  }
}

let homeV2DraftWriteQueue = Promise.resolve();

async function saveHomeV2DraftInternal(rawDraft = {}) {
  const previousDraft = await loadHomeV2Draft();
  const nextDraft = {
    content: normalizeDraftContent(rawDraft.content),
    imageFilenames: normalizeDraftImageFilenames(rawDraft.imageFilenames),
    updatedAt: new Date().toISOString()
  };

  const removedImages = previousDraft.imageFilenames.filter(filename => !nextDraft.imageFilenames.includes(filename));
  if (removedImages.length > 0) {
    await deleteCachedImages(removedImages);
  }

  if (isHomeV2DraftEmpty(nextDraft)) {
    await fsPromises.unlink(HOME_V2_DRAFT_FILE).catch(() => {});
    return buildHomeV2DraftPayload();
  }

  await fsPromises.mkdir(DRAFT_CACHE_DIR, { recursive: true });
  await fsPromises.writeFile(HOME_V2_DRAFT_FILE, JSON.stringify(nextDraft, null, 2), 'utf-8');
  return nextDraft;
}

async function saveHomeV2Draft(rawDraft = {}) {
  const task = homeV2DraftWriteQueue.then(() => saveHomeV2DraftInternal(rawDraft));
  homeV2DraftWriteQueue = task.catch(() => {});
  return task;
}

function validateHomeV2DraftPayload(body = {}) {
  const payload = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const { content, imageFilenames } = payload;
  if (content !== undefined && typeof content !== 'string') return 'content 必须是字符串';
  if (imageFilenames !== undefined && (!Array.isArray(imageFilenames) || !imageFilenames.every(item => typeof item === 'string'))) {
    return 'imageFilenames 必须是字符串数组';
  }
  return null;
}

async function savePluginToggle(pluginId, enabled) {
  const config = await ConfigManager.loadConfig();
  const registry = PluginManager.getPluginRegistry();
  const defaults = createDefaultPluginStates(registry);
  config.plugins = {
    ...defaults,
    ...(config.plugins || {}),
    [pluginId]: enabled
  };
  await ConfigManager.saveConfig(config);
}

async function buildPluginRegistryResponse() {
  const states = await loadPluginStates();
  const registry = PluginManager.getPluginRegistry();

  const plugins = await Promise.all(registry.map(async (plugin) => ({
    id: plugin.id,
    name: plugin.manifest.name,
    description: plugin.manifest.description,
    enabled: states[plugin.id] ?? plugin.manifest.enabledByDefault ?? false,
    manifest: plugin.manifest,
    config: await PluginManager.getPluginConfig(plugin.id, { sanitize: true })
  })));

  return { ok: true, plugins };
}

function sendPluginError(res, error) {
  if (error?.name === 'PluginValidationError') {
    return res.status(400).json({
      ok: false,
      error: error.message,
      validationErrors: error.errors || []
    });
  }

  return res.status(500).json({
    ok: false,
    error: error.message
  });
}
// API 路由

/**
 * 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/home-v2-draft', async (req, res) => {
  try {
    const draft = await loadHomeV2Draft();
    res.json({
      ok: true,
      hasDraft: !isHomeV2DraftEmpty(draft),
      draft
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/home-v2-draft', async (req, res) => {
  try {
    const payloadError = validateHomeV2DraftPayload(req.body);
    if (payloadError) {
      return res.status(400).json({ ok: false, error: payloadError });
    }

    const payload = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const draft = await saveHomeV2Draft(payload);
    res.json({
      ok: true,
      hasDraft: !isHomeV2DraftEmpty(draft),
      draft
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.delete('/api/home-v2-draft', async (req, res) => {
  try {
    const draft = await saveHomeV2Draft({ content: '', imageFilenames: [] });
    res.json({
      ok: true,
      hasDraft: false,
      draft
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 图片上传：保存到临时缓存目录 data/image-cache/（不直接写入 Obsidian）
 * 发布链路只读取缓存图片；Obsidian 本地保存插件会按需复制到本地图片目录。
 * 返回: { success, filename, previewUrl }
 */

app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '没有收到图片文件' });
    }

    // 确保缓存目录存在
    await fsPromises.mkdir(IMAGE_CACHE_DIR, { recursive: true });

    // 生成安全文件名：{YYYY-MM-DD}_{HHmmss}_{ms}_{originalname}
    const now = new Date();
    const datePrefix = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
    const timePrefix = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');
    const ms = String(now.getMilliseconds()).padStart(3, '0');

    // 对文件名做安全处理
    const safeOriginal = req.file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .substring(0, 80);
    const filename = `${datePrefix}_${timePrefix}_${ms}_${safeOriginal}`;
    const cachePath = path.join(IMAGE_CACHE_DIR, filename);

    // 写入缓存目录
    await fsPromises.writeFile(cachePath, req.file.buffer);

    console.log(`[ImageUpload] 图片已缓存到: ${cachePath}`);

    res.json({
      success: true,
      filename,
      previewUrl: `/api/image-cache/${encodeURIComponent(filename)}`
    });
  } catch (error) {
    console.error('[ImageUpload] 图片上传失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 图片预览：先查缓存目录，再查 obsidian/assets/ 目录
 */
app.get('/api/image-cache/:filename', async (req, res) => {
  try {
    const filename = sanitizeAssetFilename(req.params.filename);
    if (!filename) {
      return res.status(400).json({ error: '非法文件名' });
    }

    // 1. 先查缓存目录
    const cachePath = path.join(IMAGE_CACHE_DIR, filename);
    try {
      await fsPromises.access(cachePath);
      return res.sendFile(cachePath);
    } catch {}

    // 2. 再查 obsidian/assets/ 目录
    const storageConfig = await loadObsidianStorageConfig();
    const assetsPath = path.join(storageConfig.imageSavePath, filename);
    try {
      await fsPromises.access(assetsPath);
      return res.sendFile(assetsPath);
    } catch {}

    res.status(404).json({ error: '图片不存在' });
  } catch (error) {
    res.status(404).json({ error: '图片不存在' });
  }
});

/**
 * 发布编排接口：仅执行发布目标，不保存 Obsidian
 */
app.post('/api/publish', async (req, res) => {
  try {
    const payloadError = validatePublishPayload(req.body);
    if (payloadError) {
      return res.status(400).json({ ok: false, error: payloadError });
    }

    const payload = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const { content = '', targets = [], telegram = {}, imageFilenames = [] } = payload;
    const normalizedContent = optimizeContent(content || '');
    const requestedTargets = [...new Set(targets.map(item => String(item).trim()).filter(Boolean))];

    if (!normalizedContent && imageFilenames.length === 0) {
      return res.status(400).json({ ok: false, error: '内容不能为空' });
    }
    if (requestedTargets.length === 0) {
      return res.status(400).json({ ok: false, error: '至少要选择一个发布目标' });
    }

    const pluginStates = await loadPluginStates();
    const cachedImagePaths = await resolveCachedImagePaths(imageFilenames);
    const results = {};

    for (const targetId of requestedTargets) {
      const plugin = PluginManager.getPlugin(targetId);
      if (!plugin) {
        results[targetId] = { success: false, message: '插件不存在' };
        continue;
      }

      const isEnabled = pluginStates[targetId] ?? plugin.manifest.enabledByDefault ?? false;
      if (!isEnabled) {
        results[targetId] = { success: false, skipped: true, message: '插件未启用' };
        continue;
      }

      if (typeof plugin.module.execute !== 'function') {
        results[targetId] = { success: false, message: '插件不支持 execute' };
        continue;
      }

      try {
        if (targetId === 'telegram') {
          const telegramConfig = await PluginManager.getPluginConfig('telegram').catch(() => ({}));
          const telegramChannel = (telegram.channel || '').trim() || (telegramConfig.defaultChannel || '').trim();
          const telegramContent = optimizeContent(telegram.content || normalizedContent);

          if (!telegramChannel) {
            results[targetId] = { success: false, message: 'Telegram 频道不能为空' };
            continue;
          }

          const executeResult = await plugin.module.execute({
            content: telegramContent,
            type: 'diary',
            options: { telegramChannel },
            images: cachedImagePaths
          });
          results[targetId] = executeResult;
          continue;
        }

        const executeResult = await plugin.module.execute({
          content: normalizedContent,
          type: 'diary',
          options: {},
          images: cachedImagePaths
        });
        results[targetId] = executeResult;
      } catch (error) {
        results[targetId] = { success: false, message: error.message };
      }
    }

    const failedTargets = Object.entries(results)
      .filter(([, result]) => result?.success === false && !result?.skipped)
      .map(([id]) => id);

    res.json({
      ok: failedTargets.length === 0,
      requestedTargets,
      failedTargets,
      results
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 主页保存链路：仅执行 Obsidian 今日日记保存
 */
app.post('/api/save-local-v2', async (req, res) => {
  try {
    const payloadError = validateSaveLocalPayload(req.body);
    if (payloadError) {
      return res.status(400).json({ ok: false, error: payloadError });
    }

    const payload = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const {
      content = '',
      options = {},
      imageFilenames = []
    } = payload;
    const rawContent = String(content || '').replace(/\r\n/g, '\n').trim();

    if (!rawContent && imageFilenames.length === 0) {
      return res.status(400).json({ ok: false, error: '内容不能为空' });
    }

    const pluginStates = await loadPluginStates();
    const pluginResults = {};
    const pluginId = 'obsidian-local';
    const plugin = PluginManager.getPlugin(pluginId);
    if (!plugin) {
      return res.status(500).json({
        ok: false,
        error: 'Obsidian 本地保存插件不存在'
      });
    }

    const isEnabled = pluginStates[pluginId] ?? plugin.manifest.enabledByDefault ?? false;
    if (!isEnabled) {
      return res.status(400).json({
        ok: false,
        error: 'Obsidian 本地保存插件未启用'
      });
    }

    const cachedImagePaths = await resolveCachedImagePaths(imageFilenames);

    try {
      pluginResults[pluginId] = await plugin.module.execute({
        content: rawContent,
        type: 'diary',
        options,
        images: cachedImagePaths,
        imageFilenames
      });
    } catch (error) {
      pluginResults[pluginId] = { success: false, message: error.message };
    }

    const failedPlugins = Object.entries(pluginResults)
      .filter(([, result]) => result?.success === false && !result?.skipped)
      .map(([pluginId]) => pluginId);

    res.json({
      ok: failedPlugins.length === 0,
      requestedPlugins: [pluginId],
      failedPlugins,
      results: {
        plugins: pluginResults
      }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 获取完整配置（用于新版插件中心）
 */
app.get('/api/config/full', async (req, res) => {
  try {
    const config = await ConfigManager.loadConfig();
    res.json({
      ok: true,
      config: {
        ai: {
          baseUrl: config?.ai?.baseUrl || '',
          apiKey: config?.ai?.apiKey || '',
          model: config?.ai?.model || '',
          apiType: normalizeAiApiType(config?.ai?.apiType)
        },
        network: {
          proxy: config?.network?.proxy || ''
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 设置配置值
 */
app.post('/api/config/set', async (req, res) => {
  try {
    const { path: configPath, value } = req.body;

    if (!configPath || typeof configPath !== 'string' || value === undefined) {
      return res.status(400).json({
        ok: false,
        error: '缺少必要参数'
      });
    }

    const allowedConfigPaths = new Set([
      'ai.baseUrl',
      'ai.apiKey',
      'ai.model',
      'ai.apiType',
      'network.proxy'
    ]);
    if (!allowedConfigPaths.has(configPath)) {
      return res.status(400).json({
        ok: false,
        error: '不支持的配置路径'
      });
    }

    const config = await ConfigManager.loadConfig();

    // 解析路径并设置值，防御原型污染
    const keys = configPath.split('.');
    if (keys.some(k => k === '__proto__' || k === 'constructor' || k === 'prototype')) {
      return res.status(400).json({ ok: false, error: '非法的配置安全范围' });
    }

    let normalizedNetworkProxy = null;
    if (configPath === 'network.proxy') {
      try {
        normalizedNetworkProxy = normalizeNetworkProxy(value);
      } catch (error) {
        return res.status(400).json({
          ok: false,
          error: error.message
        });
      }
    }

    let current = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    const normalizedAiApiType = configPath === 'ai.apiType'
      ? normalizeAiApiType(value)
      : null;

    current[keys[keys.length - 1]] = configPath === 'network.proxy'
      ? normalizedNetworkProxy
      : (configPath === 'ai.apiType' ? normalizedAiApiType : value);

    await ConfigManager.saveConfig(config);

    if (configPath === 'network.proxy') {
      applyNetworkProxy(normalizedNetworkProxy);
      return res.json({
        ok: true,
        message: normalizedNetworkProxy
          ? '代理已更新并立即生效'
          : '代理已清除，已恢复直连',
        value: normalizedNetworkProxy
      });
    }

    res.json({
      ok: true,
      message: '配置已更新',
      ...(configPath === 'ai.apiType' ? { value: normalizedAiApiType } : {})
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * AI 连通性测试
 */
app.post('/api/config/test-ai', async (req, res) => {
  try {
    const config = await ConfigManager.loadConfig();
    const payload = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
      ? req.body
      : {};
    const aiPayload = (payload.ai && typeof payload.ai === 'object' && !Array.isArray(payload.ai))
      ? payload.ai
      : null;
    const aiConfig = {
      ...(config?.ai || {}),
      ...(aiPayload || {})
    };
    aiConfig.apiType = normalizeAiApiType(aiConfig.apiType);

    if (!aiConfig?.baseUrl || !aiConfig?.apiKey || !aiConfig?.model) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'AI 配置不完整，请先配置 API 地址、密钥和模型'
      });
    }

    // 简单的测试请求
    const startTime = Date.now();
    const apiUrl = getAiEndpointUrl(aiConfig.baseUrl, aiConfig.apiType);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`
      },
      body: JSON.stringify(buildAiRequestBody(aiConfig, {
        systemPrompt: '你是一个测试助手。',
        userPrompt: '请返回 "连接成功"',
        maxTokens: 10,
        temperature: 0
      }))
    });

    const duration = Date.now() - startTime;

    const rawData = await response.text();
    let result = null;
    if (rawData && rawData.trim()) {
      try {
        result = JSON.parse(rawData);
      } catch {
        result = rawData;
      }
    }

    if (response.ok) {
      const outputText = extractAiText(result);
      if (!outputText) {
        return res.status(500).json({
          ok: false,
          success: false,
          error: 'AI 返回空内容，请更换支持文本输出的模型或接口',
          message: 'AI 连接测试失败',
          response: result
        });
      }

      res.json({
        ok: true,
        success: true,
        message: 'AI 连接测试成功',
        duration: `${duration}ms`,
        model: aiConfig.model,
        apiType: aiConfig.apiType,
        response: result
      });
    } else {
      res.status(500).json({
        ok: false,
        success: false,
        error: result?.error?.message || String(result || '').slice(0, 300),
        message: 'AI 连接测试失败'
      });
    }
  } catch (error) {
    res.status(500).json({
      ok: false,
      success: false,
      error: error.message,
      message: 'AI 连接测试失败'
    });
  }
});

app.get('/api/plugins/registry', async (req, res) => {
  try {
    res.json(await buildPluginRegistryResponse());
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get('/api/plugins/:id/config', async (req, res) => {
  try {
    const plugin = PluginManager.getPlugin(req.params.id);
    if (!plugin) {
      return res.status(404).json({ ok: false, error: '插件不存在' });
    }

    res.json({
      ok: true,
      config: await PluginManager.getPluginConfig(req.params.id, { sanitize: true })
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post('/api/plugins/:id/config', async (req, res) => {
  try {
    const plugin = PluginManager.getPlugin(req.params.id);
    if (!plugin) {
      return res.status(404).json({ ok: false, error: '插件不存在' });
    }

    const nextConfig = req.body?.config || req.body || {};
    const savedConfig = await PluginManager.savePluginConfig(req.params.id, nextConfig);
    res.json({
      ok: true,
      config: await PluginManager.getPluginConfig(req.params.id, { sanitize: true }),
      saved: savedConfig
    });
  } catch (error) {
    sendPluginError(res, error);
  }
});

app.post('/api/plugins/:id/toggle', async (req, res) => {
  try {
    const plugin = PluginManager.getPlugin(req.params.id);
    if (!plugin) {
      return res.status(404).json({ ok: false, error: '插件不存在' });
    }

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'enabled 必须是 boolean' });
    }

    await savePluginToggle(req.params.id, enabled);
    res.json({
      ok: true,
      message: `插件 ${req.params.id} 已${enabled ? '启用' : '禁用'}`
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/plugins/:id/actions/:actionId', async (req, res) => {
  try {
    const plugin = PluginManager.getPlugin(req.params.id);
    if (!plugin) {
      return res.status(404).json({ ok: false, error: '插件不存在' });
    }

    const result = await PluginManager.runPluginAction(
      req.params.id,
      req.params.actionId,
      req.body?.payload || {}
    );

    res.json({
      ok: true,
      result
    });
  } catch (error) {
    sendPluginError(res, error);
  }
});

/**
 * 优化内容为 Telegram 发布格式
 */
app.post('/api/telegram/optimize', async (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: '内容不能为空'
      });
    }

    const config = await ConfigManager.loadConfig();
    const telegramConfigMod = await import('../../Plugin/Telegram-Send/index.js');
    const telegramConfig = await telegramConfigMod.loadConfig();
    const tgAiConfig = telegramConfig?.ai || {};
    const useGeneralAi = tgAiConfig.useGeneral !== false;
    const aiConfig = useGeneralAi
      ? { ...(config?.ai || {}) }
      : {
        baseUrl: tgAiConfig.baseUrl || '',
        apiKey: tgAiConfig.apiKey || '',
        model: tgAiConfig.model || '',
        apiType: normalizeAiApiType(tgAiConfig.apiType)
      };
    aiConfig.apiType = normalizeAiApiType(aiConfig.apiType);

    if (!aiConfig || !aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
      return res.json({
        ok: false,
        success: false,
        error: useGeneralAi
          ? 'AI 配置不完整，请先在常规设置中配置 AI 模型'
          : 'Telegram 插件 AI 配置不完整，请先在 Telegram 插件设置中配置'
      });
    }

    // TG 优化提示词属于 Telegram 插件配置
    const customPrompt = telegramConfig?.optimizePrompt;
    const systemPrompt = customPrompt || '你是一个专业的内容编辑，擅长将笔记内容优化为适合 Telegram 频道发布的格式。要求：1. 保持原意，简洁明了 2. 适当使用 emoji 3. 分段清晰 4. 适合社交媒体阅读';

    // 调用 AI 优化内容（使用 fetch，复用全局代理）
    const apiUrl = getAiEndpointUrl(aiConfig.baseUrl, aiConfig.apiType);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`
      },
      body: JSON.stringify(buildAiRequestBody(aiConfig, {
        systemPrompt,
        userPrompt: `请将以下内容优化为适合 Telegram 发布的格式：\n\n${content}`,
        temperature: 0.7
      }))
    });
    const rawData = await response.text();
    if (!rawData || rawData.trim() === '') {
      return res.json({
        ok: false,
        success: false,
        error: 'AI 返回空响应'
      });
    }
    let result;
    try {
      result = JSON.parse(rawData);
    } catch (parseError) {
      return res.json({
        ok: false,
        success: false,
        error: '解析 AI 响应失败: ' + parseError.message + '\n原始响应: ' + rawData.substring(0, 200)
      });
    }
    if (!response.ok) {
      return res.json({
        ok: false,
        success: false,
        error: result?.error?.message || rawData.substring(0, 200)
      });
    }
    if (result.error) {
      return res.json({
        ok: false,
        success: false,
        error: `AI 错误: ${result.error.message || JSON.stringify(result.error)} `
      });
    }
    const optimized = extractAiText(result);
    if (optimized) {
      return res.json({
        ok: true,
        success: true,
        optimized: optimized
      });
    }
    res.json({
      ok: false,
      success: false,
      error: 'AI 返回空内容，请检查模型是否支持文本输出'
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      success: false,
      error: error.message
    });
  }
});

/**
 * 发布内容到 Telegram
 */
app.post('/api/telegram/publish', async (req, res) => {
  try {
    const payloadError = validateTelegramPublishPayload(req.body);
    if (payloadError) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: payloadError
      });
    }

    const payload = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const { content, channel, type = 'diary', imageFilenames = [], sourceUrl = '', tgFormattingApplied = false } = payload;

    if (!content && imageFilenames.length === 0) {
      return res.status(400).json({
        ok: false,
        error: '内容不能为空'
      });
    }

    if (!channel) {
      return res.status(400).json({
        ok: false,
        error: '频道不能为空'
      });
    }

    const config = await ConfigManager.loadConfig();
    const telegramConfig = await PluginManager.getPluginConfig('telegram').catch(() => ({}));
    const tgSendScript = telegramConfig?.scriptPath
      || config?.diary?.tgSendScript
      || path.join(__dirname, '../../Plugin/Telegram-Send/telegram_send.py');
    const tgBotToken = telegramConfig?.botToken || config?.diary?.tgBotToken;

    if (!tgSendScript) {
      return res.json({
        ok: false,
        error: 'Telegram 脚本路径未配置'
      });
    }

    if (!tgBotToken) {
      return res.json({
        ok: false,
        error: 'Telegram Bot Token 未配置'
      });
    }

    // 收集图片文件名：来自前端传入 + 从 content 中解析
    const allFilenames = new Set(imageFilenames);

    // 从 content 中提取 ![...](assets/xxx) 引用
    const contentImgRegex = /!\[[^\]]*\]\(assets\/([^)]+)\)/g;
    let imgMatch;
    while ((imgMatch = contentImgRegex.exec(content || '')) !== null) {
      allFilenames.add(imgMatch[1]);
    }

    // 发布只读取输入缓存图片，不把图片写入 Obsidian assets。
    const validImagePaths = await resolveCachedImagePaths(Array.from(allFilenames));

    // 构建 Python 脚本参数
    const { spawn } = await import('child_process');
    const env = { ...process.env, TELEGRAM_BOT_TOKEN: tgBotToken };
    // 去掉内容中的图片 markdown 引用
    const textContent = (content || '').replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();

    // 始终使用 Plugin 的 telegram_send.py（支持 --images 和 stdin）
    const pluginScript = path.join(__dirname, '../../Plugin/Telegram-Send/telegram_send.py');
    const scriptToUse = pluginScript;

    const args = [scriptToUse, channel];
    const isNotePublish = type === 'note';
    // TG 发布优化设置只在“TG 按钮 + 本地生成格式”后生效，避免普通发布误触发。
    const shouldApplyTgOptimizeSettings = isNotePublish && tgFormattingApplied === true;
    const enableBoldFirstLineForNote = shouldApplyTgOptimizeSettings && Boolean(telegramConfig?.boldFirstLine);
    const enableLineBreakPerLineForNote = shouldApplyTgOptimizeSettings && Boolean(telegramConfig?.addLineBreakPerLine);
    const enableAppendSourceForNote = shouldApplyTgOptimizeSettings && Boolean(telegramConfig?.appendSourceTag);
    const sourceUrlFromPayload = typeof sourceUrl === 'string' ? sourceUrl.trim() : '';
    const sourceUrlFromContent = normalizeSourceUrl(extractLastHttpsUrl(content || ''));
    const normalizedSourceUrl = enableAppendSourceForNote
      ? normalizeSourceUrl(sourceUrlFromPayload || sourceUrlFromContent)
      : '';

    if (enableBoldFirstLineForNote) {
      args.push('--bold-first-line');
    }
    if (enableLineBreakPerLineForNote) {
      args.push('--line-break-per-line');
    }

    if (normalizedSourceUrl) {
      if (!/^https?:\/\//i.test(normalizedSourceUrl)) {
        return res.status(400).json({
          ok: false,
          error: 'source 链接必须以 http:// 或 https:// 开头'
        });
      }
      args.push('--source-url', normalizedSourceUrl);
    }

    // 如果有图片，追加 --images 参数
    if (validImagePaths.length > 0) {
      args.push('--images', ...validImagePaths);
      console.log(`[TG Publish] 发送含 ${validImagePaths.length} 张图片的消息到 ${channel}`);
    }

    const pythonProcess = spawn('python3', args, { env });

    const stdoutChunks = [];
    const stderrChunks = [];
    let isResolved = false;

    pythonProcess.stdout.on('data', (data) => {
      stdoutChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });

    pythonProcess.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        res.json({
          ok: false,
          error: `执行脚本失败: ${err.message} `
        });
      }
    });

    // 通过 stdin 传递文字内容
    if (textContent) {
      pythonProcess.stdin.write(textContent);
    }
    pythonProcess.stdin.end();

    pythonProcess.on('close', (code) => {
      if (isResolved) return;
      isResolved = true;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code === 0) {
        res.json({
          ok: true,
          message: '发布成功'
        });
      } else {
        res.json({
          ok: false,
          error: `发布失败(退出码 ${code}): ${stderr || stdout} `
        });
      }
    });

    // 10 秒超时
    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        pythonProcess.kill();
        res.json({
          ok: false,
          error: '发布超时'
        });
      }
    }, 60000);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 启动服务器
app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  📝 Journal Sync Server');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  🌐 Server running at: http://localhost:${PORT}`);
  console.log(`  📁 Public directory: ${path.join(__dirname, '../../public')}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Press Ctrl+C to stop');
  console.log('');
});

export default app;
