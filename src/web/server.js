import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveToObsidian, optimizeContent } from '../sync/journal-sync.js';
import { promises as fsPromises } from 'fs';
import ConfigManager from '../utils/config-manager.js';
import { applyNetworkProxy, normalizeNetworkProxy } from '../utils/network-proxy.js';
import PluginManager from '../sync/plugin-manager.js';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 初始化数据目录和基础配置
async function initDataFiles() {
  const dataDir = path.join(__dirname, '../../data');
  try {
    await fsPromises.mkdir(dataDir, { recursive: true });

    const defaults = {
      'config.json': {
        "obsidianPath": "/path/to/obsidian/notes",
        "plugins": {}
      },
      'history.json': [],
      'tasks.json': [],
      'mem0_insights.json': {}
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
app.use(express.static(path.join(__dirname, '../../public')));

/**
 * 从 Markdown 内容中提取图片引用，转换为绝对路径列表
 * @param {string} content - 包含 ![...](assets/xxx) 的 markdown 内容
 * @param {string} obsidianPath - obsidian 保存目录（绝对路径）
 * @returns {{ text: string, images: string[] }}
 */
function parseContentImages(content, obsidianPath) {
  // 匹配 ![任意文字](路径)，提取路径部分
  const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  const images = [];
  let match;
  while ((match = imageRegex.exec(content)) !== null) {
    const imgPath = match[1].trim();
    // 转为绝对路径（支持相对路径如 assets/xxx.png）
    const absPath = path.isAbsolute(imgPath)
      ? imgPath
      : path.join(obsidianPath, imgPath);
    images.push(absPath);
  }
  return { text: content, images };
}

// 历史记录存储
const HISTORY_FILE = path.join(__dirname, '../../data/history.json');
const CONFIG_FILE = path.join(__dirname, '../../data/config.json');

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



/**
 * 加载历史记录
 */
async function loadHistory() {
  try {
    const data = await fsPromises.readFile(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

/**
 * 保存历史记录
 */
async function saveHistory(history) {
  try {
    await fsPromises.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save history:', error);
  }
}

/**
 * 添加或更新历史记录
 */
async function updateOrAddToHistory(entry) {
  const history = await loadHistory();
  const existingIndex = history.findIndex(item => item.id === entry.id);

  if (existingIndex !== -1) {
    // 存在则更新状态
    history[existingIndex] = {
      ...history[existingIndex],
      ...entry,
      status: {
        ...history[existingIndex].status,
        ...(entry.status || {})
      },
      // 特殊处理 telegramSends
      telegramSends: Array.from(new Set([
        ...(history[existingIndex].telegramSends || []),
        ...(entry.telegramSends || [])
      ]))
    };
  } else {
    // 不存在则新增
    history.unshift(entry);
  }

  // 只保留最近 100 条
  if (history.length > 100) {
    history.splice(100);
  }

  await saveHistory(history);
}

// API 路由

/**
 * 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * 图片上传：保存到临时缓存目录 data/image-cache/（不直接写入 Obsidian）
 * 只有在用户点击保存后，才会在 save-stream 中将缓存图片移入 obsidian/assets/
 * 返回: { success, filename, previewUrl }
 */
const IMAGE_CACHE_DIR = path.join(__dirname, '../../data/image-cache');

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
    const filename = req.params.filename;
    // 防止路径穿越
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '非法文件名' });
    }

    // 1. 先查缓存目录
    const cachePath = path.join(IMAGE_CACHE_DIR, filename);
    try {
      await fsPromises.access(cachePath);
      return res.sendFile(cachePath);
    } catch {}

    // 2. 再查 obsidian/assets/ 目录
    const config = await ConfigManager.loadConfig();
    const obsidianPath = config?.diary?.obsidianPath
      || config?.obsidianPath
      || '/path/to/obsidian/notes';
    const assetsPath = path.join(obsidianPath, 'assets', filename);
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
 * 确保图片出现在 obsidianPath/assets/ 目录（幂等）
 * - 如果文件在缓存目录：移过去
 * - 如果文件已在 assets 目录：直接用
 * - 否则：跳过并打印 warning
 * @param {string[]} filenames
 * @param {string} obsidianPath
 * @returns {string[]} assets 目录下的绝对路径列表
 */
async function ensureImagesInAssets(filenames, obsidianPath) {
  if (!filenames || filenames.length === 0) return [];

  const assetsDir = path.join(obsidianPath, 'assets');
  await fsPromises.mkdir(assetsDir, { recursive: true });

  const result = [];
  for (const filename of filenames) {
    const destPath = path.join(assetsDir, filename);

    // 1. 已经在 assets 了，直接用
    try {
      await fsPromises.access(destPath);
      result.push(destPath);
      console.log(`[ImageAssets] 已在 assets: ${filename}`);
      continue;
    } catch {}

    // 2. 在缓存目录，移过去
    const cachePath = path.join(IMAGE_CACHE_DIR, filename);
    try {
      await fsPromises.access(cachePath);
      await fsPromises.copyFile(cachePath, destPath);
      await fsPromises.unlink(cachePath).catch(() => {});
      result.push(destPath);
      console.log(`[ImageAssets] 移动到 assets: ${filename}`);
      continue;
    } catch {}

    console.warn(`[ImageAssets] 找不到图片: ${filename}`);
  }
  return result;
}


/**
 * 保存日记/笔记（流式响应，实时更新状态）
 */
app.post('/api/save-stream', async (req, res) => {
  try {
    const { content, type = 'diary', options = {}, saveId, imageFilenames = [] } = req.body;

    if ((!content || !content.trim()) && imageFilenames.length === 0) {
      return res.status(400).json({ error: '内容不能为空' });
    }
    if (!['diary', 'note'].includes(type)) return res.status(400).json({ error: '类型必须是 diary 或 note' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const optimized = optimizeContent(content || '');
    const config = await ConfigManager.loadConfig();

    const obsidianPath = type === 'note'
      ? (config?.note?.vaultPath || config?.obsidianPath || '/path/to/obsidian/notes')
      : (config?.diary?.obsidianPath || config?.obsidianPath || '/path/to/obsidian/notes');

    // 保存时：确保图片在 obsidianPath/assets/（幂等，无论图片在缓存还是已在 assets）
    const movedImagePaths = await ensureImagesInAssets(imageFilenames, obsidianPath);

    // 将图片的 Markdown 引用追加到 content 中（给 Obsidian 保存用）
    let contentWithImages = optimized;
    if (movedImagePaths.length > 0) {
      const imageRefs = movedImagePaths.map(p => {
        const fname = path.basename(p);
        return `![image](assets/${fname})`;
      }).join('\n');
      contentWithImages = optimized
        ? optimized + '\n\n' + imageRefs
        : imageRefs;
    }

    const obsidianResult = await saveToObsidian(contentWithImages, type, options);
    res.write(`data: ${JSON.stringify({ type: 'status', plugin: 'obsidian', success: obsidianResult.success })}\n\n`);

    // 插件收到原始文字 content + 图片绝对路径列表
    const pluginResults = await PluginManager.executePlugins(optimized, type, options, config, (plugin, success) => {
      res.write(`data: ${JSON.stringify({ type: 'status', plugin, success })}\n\n`);
    }, movedImagePaths);

    const historyStatus = { obsidian: obsidianResult.success ? 'success' : 'failed' };
    for (const [key, result] of Object.entries(pluginResults)) {
      if (result.skipped) historyStatus[key] = 'skipped';
      else historyStatus[key] = result.success ? 'success' : 'failed';
    }

    await updateOrAddToHistory({
      id: saveId,
      timestamp: new Date().toISOString(),
      type,
      content: contentWithImages,
      status: historyStatus,
      suggestion: pluginResults.memu?.suggestion || null
    });

    res.write(`data: ${JSON.stringify({ type: 'complete', suggestion: pluginResults.memu?.suggestion })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

/**
 * 保存日记/笔记（原有端点，保持兼容）
 */
app.post('/api/save', async (req, res) => {
  try {
    const { content, type = 'diary', options = {} } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: '内容不能为空' });
    if (!['diary', 'note'].includes(type)) return res.status(400).json({ error: '类型必须是 diary 或 note' });

    const optimized = optimizeContent(content);
    const config = await ConfigManager.loadConfig();

    const obsidianResult = await saveToObsidian(optimized, type, options);
    const pluginResults = await PluginManager.executePlugins(optimized, type, options, config, null);

    const historyStatus = { obsidian: obsidianResult.success };
    for (const [key, result] of Object.entries(pluginResults)) {
      historyStatus[key] = result.success || false;
    }

    await updateOrAddToHistory({
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      type,
      content,
      status: historyStatus,
      suggestion: pluginResults.memu?.suggestion || null
    });

    res.json({ success: true, results: { obsidian: obsidianResult, ...pluginResults }, message: '保存成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取历史记录
 */
app.get('/api/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = await loadHistory();
    res.json({
      success: true,
      history: history.slice(0, limit)
    });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 清空历史记录
 */
app.delete('/api/history', async (req, res) => {
  try {
    await saveHistory([]);
    res.json({ success: true, message: '历史记录已清空' });
  } catch (error) {
    console.error('Clear history error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取统计信息
 */
app.get('/api/stats', async (req, res) => {
  try {
    const history = await loadHistory();

    const stats = {
      total: history.length,
      diary: history.filter(h => h.type === 'diary').length,
      note: history.filter(h => h.type === 'note').length,
      today: history.filter(h => {
        const today = new Date().toISOString().split('T')[0];
        return h.timestamp.startsWith(today);
      }).length
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 浏览文件夹（用于文件选择器）
 */
app.post('/api/browse-folder', async (req, res) => {
  try {
    let { startPath } = req.body;

    // 路径规范化，防止类似于 startPath=../../../../ 形式的不受限遍历
    let basePath = require('os').homedir();
    if (startPath && typeof startPath === 'string') {
      basePath = path.resolve(startPath);
    }

    const entries = await fsPromises.readdir(basePath, { withFileTypes: true });
    const folders = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        path: path.join(basePath, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    res.json({
      ok: true,
      currentPath: basePath,
      parentPath: path.dirname(basePath),
      folders
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 获取 Obsidian 配置
 */
app.get('/api/config/obsidian', async (req, res) => {
  try {
    const config = await ConfigManager.loadConfig();
    res.json({
      success: true,
      path: config.obsidianPath
    });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取日记配置
 */
app.get('/api/config/diary', async (req, res) => {
  try {
    const config = await ConfigManager.loadConfig();
    const telegramConfig = await PluginManager.getPluginConfig('telegram').catch(() => ({}));
    const flomoConfig = await PluginManager.getPluginConfig('flomo').catch(() => ({}));
    const mastodonConfig = await PluginManager.getPluginConfig('mastodon').catch(() => ({}));
    const memuConfig = await PluginManager.getPluginConfig('memu').catch(() => ({}));

    // 默认值（从 journal-sync.js 中的常量）
    const defaults = {
      obsidianPath: '/path/to/obsidian/notes',
      flomoApi: '',
      memuBridgeScript: '/path/to/memu_bridge.py',
      memuUserId: 'linyun',
      tgDiaryChannel: '@LinYunChannel',
      tgBotToken: '',
      tgChannels: '[]',
      tgOptimizePrompt: '',
      tgShowLinkPreview: true,
      tgBoldFirstLine: false,
      tgAppendSource: false
    };

    res.json({
      ok: true,
      config: {
        obsidianPath: config?.diary?.obsidianPath || config?.obsidianPath || defaults.obsidianPath,
        flomoApi: '',
        memuBridgeScript: memuConfig?.memuBridgeScript || config?.diary?.memuBridgeScript || defaults.memuBridgeScript,
        memuUserId: memuConfig?.memuUserId || config?.diary?.memuUserId || defaults.memuUserId,
        tgDiaryChannel: telegramConfig?.defaultChannel || defaults.tgDiaryChannel,
        tgBotToken: '',
        tgChannels: JSON.stringify(telegramConfig?.channels || []),
        tgOptimizePrompt: telegramConfig?.optimizePrompt || defaults.tgOptimizePrompt,
        tgShowLinkPreview: telegramConfig?.showLinkPreview ?? defaults.tgShowLinkPreview,
        tgBoldFirstLine: telegramConfig?.boldFirstLine ?? defaults.tgBoldFirstLine,
        tgAppendSource: telegramConfig?.appendSourceTag ?? defaults.tgAppendSource,
        mastodonInstanceUrl: mastodonConfig?.instanceUrl || '',
        mastodonAccessToken: '',
        mastodonVisibility: mastodonConfig?.visibility || 'unlisted',
        mem0Insights: config?.mem0Insights || {}
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
 * 获取笔记配置
 */
app.get('/api/config/note', async (req, res) => {
  try {
    const config = await ConfigManager.loadConfig();
    res.json({
      ok: true,
      config: {
        vaultPath: config?.note?.vaultPath || ''
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
 * 保存 Obsidian 配置
 */
app.post('/api/config/obsidian', async (req, res) => {
  try {
    const { path: obsidianPath } = req.body;

    if (!obsidianPath || !obsidianPath.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Obsidian 路径不能为空'
      });
    }

    const config = await ConfigManager.loadConfig();
    config.obsidianPath = obsidianPath.trim();
    await ConfigManager.saveConfig(config);

    res.json({
      success: true,
      message: '配置保存成功'
    });
  } catch (error) {
    console.error('Save config error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取完整配置（用于设置页面）
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
          model: config?.ai?.model || ''
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

    if (!configPath || value === undefined) {
      return res.status(400).json({
        ok: false,
        error: '缺少必要参数'
      });
    }

    // 特殊处理 Telegram 配置，保存到插件配置文件
    if (configPath.startsWith('diary.tg')) {
      const telegramConfigMod = await import('../../Plugin/Telegram-Send/index.js');
      const telegramConfig = await telegramConfigMod.loadConfig() || {
        botToken: '',
        channels: [],
        defaultChannel: '',
        optimizePrompt: '',
        showLinkPreview: true,
        boldFirstLine: false,
        appendSourceTag: false
      };

      if (configPath === 'diary.tgBotToken') {
        telegramConfig.botToken = value;
      } else if (configPath === 'diary.tgDiaryChannel') {
        telegramConfig.defaultChannel = value;
      } else if (configPath === 'diary.tgOptimizePrompt') {
        telegramConfig.optimizePrompt = value;
      } else if (configPath === 'diary.tgChannels') {
        telegramConfig.channels = JSON.parse(value);
      } else if (configPath === 'diary.tgShowLinkPreview') {
        telegramConfig.showLinkPreview = Boolean(value);
      } else if (configPath === 'diary.tgBoldFirstLine') {
        telegramConfig.boldFirstLine = Boolean(value);
      } else if (configPath === 'diary.tgAppendSource') {
        telegramConfig.appendSourceTag = Boolean(value);
      }

      await telegramConfigMod.saveConfig(telegramConfig);

      res.json({
        ok: true,
        message: 'Telegram 配置已更新'
      });
      return;
    }

    // 特殊处理 Flomo 配置，保存到插件配置文件
    if (configPath === 'diary.flomoApi') {
      const flomoConfig = await PluginManager.getPluginConfig('flomo').catch(() => ({ apiUrl: '' }));
      flomoConfig.apiUrl = value;
      await PluginManager.savePluginConfig('flomo', flomoConfig);

      res.json({
        ok: true,
        message: 'Flomo 配置已更新'
      });
      return;
    }

    if (configPath === 'diary.memuBridgeScript' || configPath === 'diary.memuUserId') {
      const memuConfig = await PluginManager.getPluginConfig('memu').catch(() => ({}));
      if (configPath === 'diary.memuBridgeScript') {
        memuConfig.memuBridgeScript = value;
      } else {
        memuConfig.memuUserId = value;
      }
      await PluginManager.savePluginConfig('memu', memuConfig);

      res.json({
        ok: true,
        message: 'MemU 配置已更新'
      });
      return;
    }

    // 特殊处理 Mastodon 配置
    if (configPath.startsWith('diary.mastodon')) {
      const mastodonConfig = await PluginManager.getPluginConfig('mastodon').catch(() => ({
        instanceUrl: '',
        accessToken: '',
        visibility: 'unlisted'
      }));

      if (configPath === 'diary.mastodonInstanceUrl') {
        mastodonConfig.instanceUrl = value;
      } else if (configPath === 'diary.mastodonAccessToken') {
        mastodonConfig.accessToken = value;
      } else if (configPath === 'diary.mastodonVisibility') {
        mastodonConfig.visibility = value;
      }

      await PluginManager.savePluginConfig('mastodon', mastodonConfig);

      res.json({
        ok: true,
        message: 'Mastodon 配置已更新'
      });
      return;
    }

    // 其他配置保存到主配置文件
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
    current[keys[keys.length - 1]] = configPath === 'network.proxy'
      ? normalizedNetworkProxy
      : value;

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
      message: '配置已更新'
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

    if (!config?.ai?.baseUrl || !config?.ai?.apiKey || !config?.ai?.model) {
      return res.status(400).json({
        ok: false,
        error: 'AI 配置不完整，请先配置 API 地址、密钥和模型'
      });
    }

    // 简单的测试请求
    const startTime = Date.now();
    const baseUrl = config.ai.baseUrl.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ai.apiKey}`
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [
          { role: 'system', content: '你是一个测试助手。' },
          { role: 'user', content: '请返回 "连接成功"' }
        ],
        max_tokens: 10
      })
    });

    const duration = Date.now() - startTime;

    if (response.ok) {
      const result = await response.json();
      res.json({
        ok: true,
        message: 'AI 连接测试成功',
        duration: `${duration}ms`,
        model: config.ai.model,
        response: result
      });
    } else {
      const error = await response.text();
      res.status(500).json({
        ok: false,
        error: error,
        message: 'AI 连接测试失败'
      });
    }
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      message: 'AI 连接测试失败'
    });
  }
});

/**
 * 获取分类规则
 */
app.get('/api/classification-rules', async (req, res) => {
  try {
    const config = await ConfigManager.loadConfig();
    const rules = config?.classification?.rules || [];
    res.json({
      ok: true,
      rules
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 保存分类规则
 */
app.post('/api/classification-rules', async (req, res) => {
  try {
    const { rules } = req.body;

    if (!Array.isArray(rules)) {
      return res.status(400).json({
        ok: false,
        error: '规则必须是数组'
      });
    }

    const config = await ConfigManager.loadConfig();

    if (!config.classification) {
      config.classification = {};
    }
    config.classification.rules = rules;

    await ConfigManager.saveConfig(config);

    res.json({
      ok: true,
      message: '规则保存成功'
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 获取文件夹索引
 */
app.get('/api/folders', async (req, res) => {
  try {
    const config = await ConfigManager.loadConfig();
    const folders = config?.folders || [];

    res.json({
      ok: true,
      folders: folders,
      count: folders.length,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 重建文件夹索引
 */
app.post('/api/folders/rebuild', async (req, res) => {
  try {
    const config = await ConfigManager.loadConfig();
    const vaultPath = config?.note?.vaultPath;

    if (!vaultPath) {
      return res.status(400).json({
        ok: false,
        error: '笔记 Vault 路径未配置，请先在设置中配置路径'
      });
    }

    // 扫描文件夹
    const folders = await scanFolders(vaultPath);

    config.folders = folders;
    await ConfigManager.saveConfig(config);

    res.json({
      ok: true,
      count: folders.length,
      message: '索引已重建'
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 添加文件夹到索引
 */
app.post('/api/folders/add', async (req, res) => {
  try {
    const { folder } = req.body;

    if (!folder || typeof folder !== 'string') {
      return res.status(400).json({
        ok: false,
        error: '文件夹路径不能为空'
      });
    }

    const config = await ConfigManager.loadConfig();
    const folders = config?.folders || [];

    if (folders.includes(folder)) {
      return res.status(400).json({
        ok: false,
        error: '文件夹已存在'
      });
    }

    folders.push(folder);
    folders.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

    config.folders = folders;
    await ConfigManager.saveConfig(config);

    res.json({
      ok: true,
      message: '文件夹添加成功',
      count: folders.length
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 从索引删除文件夹
 */
app.post('/api/folders/delete', async (req, res) => {
  try {
    const { folder } = req.body;

    if (!folder || typeof folder !== 'string') {
      return res.status(400).json({
        ok: false,
        error: '文件夹路径不能为空'
      });
    }

    const config = await ConfigManager.loadConfig();
    const folders = config?.folders || [];

    const index = folders.indexOf(folder);
    if (index === -1) {
      return res.status(400).json({
        ok: false,
        error: '文件夹不存在'
      });
    }

    folders.splice(index, 1);
    config.folders = folders;
    await ConfigManager.saveConfig(config);

    res.json({
      ok: true,
      message: '文件夹删除成功',
      count: folders.length
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 获取插件状态
 */
app.get('/api/plugins', async (req, res) => {
  try {
    const registry = await buildPluginRegistryResponse();
    const plugins = registry.plugins.reduce((states, plugin) => {
      states[plugin.id] = plugin.enabled;
      return states;
    }, {});

    res.json({
      ok: true,
      plugins
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 切换插件状态
 */
app.post('/api/plugins/toggle', async (req, res) => {
  try {
    const { plugin, enabled } = req.body;

    if (!plugin || typeof enabled !== 'boolean') {
      return res.status(400).json({
        ok: false,
        error: '参数错误'
      });
    }

    const pluginEntry = PluginManager.getPlugin(plugin);
    if (!pluginEntry) {
      return res.status(404).json({
        ok: false,
        error: '插件不存在'
      });
    }

    await savePluginToggle(plugin, enabled);

    res.json({
      ok: true,
      message: `插件 ${plugin} 已${enabled ? '启用' : '禁用'}`
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
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
 * 获取分类方法
 */
app.get('/api/classification-method', async (req, res) => {
  try {
    const config = await ConfigManager.loadConfig();
    const method = config?.classification?.method || '中图法分类';

    res.json({
      ok: true,
      method
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 设置分类方法
 */
app.post('/api/classification-method', async (req, res) => {
  try {
    const { method } = req.body;

    if (!method || typeof method !== 'string') {
      return res.status(400).json({
        ok: false,
        error: '分类方法不能为空'
      });
    }

    const config = await ConfigManager.loadConfig();

    if (!config.classification) {
      config.classification = {};
    }
    config.classification.method = method;

    await ConfigManager.saveConfig(config);

    res.json({
      ok: true,
      message: '分类方法保存成功'
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 测试 Telegram 连接并获取频道列表
 * 使用 Python 脚本的 --list-channels 功能
 */
app.post('/api/telegram/test', async (req, res) => {
  try {
    const { botToken } = req.body;

    if (!botToken) {
      return res.status(400).json({
        ok: false,
        error: 'Bot Token 不能为空'
      });
    }
    await PluginManager.savePluginConfig('telegram', { botToken });
    const result = await PluginManager.runPluginAction('telegram', 'discoverChannels', {
      config: { botToken }
    });
    res.json({
      ok: true,
      channels: result.channels || [],
      message: result.message
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
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
        error: '内容不能为空'
      });
    }

    const config = await ConfigManager.loadConfig();
    const aiConfig = config?.ai;
    const telegramConfigMod = await import('../../Plugin/Telegram-Send/index.js');
    const telegramConfig = await telegramConfigMod.loadConfig();

    if (!aiConfig || !aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
      return res.json({
        ok: false,
        error: 'AI 配置不完整，请先在设置中配置 AI 模型'
      });
    }

    // TG 优化提示词属于 Telegram 插件配置
    const customPrompt = telegramConfig?.optimizePrompt;
    const systemPrompt = customPrompt || '你是一个专业的内容编辑，擅长将笔记内容优化为适合 Telegram 频道发布的格式。要求：1. 保持原意，简洁明了 2. 适当使用 emoji 3. 分段清晰 4. 适合社交媒体阅读';

    // 调用 AI 优化内容
    const https = await import('https');
    const { URL } = await import('url');

    // 拼接完整的 API 路径
    const baseUrl = aiConfig.baseUrl.replace(/\/$/, '');
    const fullUrl = `${baseUrl}/chat/completions`;
    const apiUrl = new URL(fullUrl);

    const postData = JSON.stringify({
      model: aiConfig.model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `请将以下内容优化为适合 Telegram 发布的格式：\n\n${content}`
        }
      ],
      temperature: 0.7
    });

    const options = {
      hostname: apiUrl.hostname,
      port: apiUrl.port || 443,
      path: apiUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const request = https.default.request(options, (apiRes) => {
      const dataChunks = [];

      apiRes.on('data', (chunk) => {
        dataChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      apiRes.on('end', () => {
        const data = Buffer.concat(dataChunks).toString('utf8');

        try {
          // 检查是否有数据
          if (!data || data.trim() === '') {
            return res.json({
              ok: false,
              error: 'AI 返回空响应'
            });
          }

          const result = JSON.parse(data);

          // 检查是否有错误
          if (result.error) {
            return res.json({
              ok: false,
              error: `AI 错误: ${result.error.message || JSON.stringify(result.error)} `
            });
          }

          if (result.choices && result.choices[0] && result.choices[0].message) {
            const optimized = result.choices[0].message.content;
            res.json({
              ok: true,
              optimized: optimized
            });
          } else {
            res.json({
              ok: false,
              error: 'AI 返回格式错误: ' + JSON.stringify(result)
            });
          }
        } catch (parseError) {
          res.json({
            ok: false,
            error: '解析 AI 响应失败: ' + parseError.message + '\n原始响应: ' + data.substring(0, 200)
          });
        }
      });
    });

    request.on('error', (err) => {
      res.json({
        ok: false,
        error: '调用 AI 失败: ' + err.message
      });
    });

    request.write(postData);
    request.end();
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/**
 * 发布内容到 Telegram
 */
app.post('/api/telegram/publish', async (req, res) => {
  try {
    const { content, channel, saveId, type = 'diary', channelName, imageFilenames = [], sourceUrl = '' } = req.body;

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
      || '/path/to/telegram_channel_send.py';
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

    // 收集图片文件名：来自前端传入 + 从 content 中解析 + 从历史记录查找
    const allFilenames = new Set(imageFilenames);

    // 从 content 中提取 ![...](assets/xxx) 引用
    const contentImgRegex = /!\[[^\]]*\]\(assets\/([^)]+)\)/g;
    let imgMatch;
    while ((imgMatch = contentImgRegex.exec(content || '')) !== null) {
      allFilenames.add(imgMatch[1]);
    }

    // 从历史记录中查找同 saveId 的条目的图片引用
    if (saveId) {
      try {
        const history = await loadHistory();
        const historyItem = history.find(h => h.id === saveId);
        if (historyItem?.content) {
          const histContentRegex = /!\[[^\]]*\]\(assets\/([^)]+)\)/g;
          let hm;
          while ((hm = histContentRegex.exec(historyItem.content)) !== null) {
            allFilenames.add(hm[1]);
          }
        }
      } catch {}
    }

    // 确保所有图片都在 assets/ 目录（幂等移动）
    const obsidianPath = config?.diary?.obsidianPath
      || config?.obsidianPath
      || '/path/to/obsidian/notes';

    const validImagePaths = await ensureImagesInAssets(Array.from(allFilenames), obsidianPath);

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
    const enableBoldFirstLineForNote = isNotePublish && Boolean(telegramConfig?.boldFirstLine);
    const enableAppendSourceForNote = isNotePublish && Boolean(telegramConfig?.appendSourceTag);
    const normalizedSourceUrl = enableAppendSourceForNote && typeof sourceUrl === 'string'
      ? sourceUrl.trim()
      : '';

    if (enableBoldFirstLineForNote) {
      args.push('--bold-first-line');
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

    // 构建带图片引用的 content 用于历史记录
    const imageRefs = validImagePaths.map(p => `![image](assets/${path.basename(p)})`).join('\n');
    const contentWithImages = textContent
      ? (imageRefs ? textContent + '\n\n' + imageRefs : textContent)
      : imageRefs;

    pythonProcess.on('close', async (code) => {
      if (isResolved) return;
      isResolved = true;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code === 0) {
        if (saveId && channelName) {
          await updateOrAddToHistory({
            id: saveId,
            timestamp: new Date().toISOString(),
            type: type,
            content: contentWithImages,
            telegramSends: [channelName],
            status: { telegram: 'success' }
          });
        }
        res.json({
          ok: true,
          message: '发布成功'
        });
      } else {
        if (saveId) {
          await updateOrAddToHistory({
            id: saveId,
            timestamp: new Date().toISOString(),
            type: type,
            content: contentWithImages,
            status: { telegram: 'failed' }
          });
        }
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

/**
 * 扫描文件夹（辅助函数）
 */
async function scanFolders(basePath) {
  const folders = [];

  async function scan(dir, relativePath = '') {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const folderPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          folders.push(folderPath);

          const fullPath = path.join(dir, entry.name);
          await scan(fullPath, folderPath);
        }
      }
    } catch (error) {
      console.error(`扫描文件夹失败: ${dir}`, error);
    }
  }

  await scan(basePath);
  folders.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  return folders;
}

/**
 * Mem0 配置 API
 */
// 获取 Mem0 配置
app.get('/api/mem0/config', async (req, res) => {
  try {
    const config = await PluginManager.getPluginConfig('mem0', { sanitize: true });
    res.json({
      ok: true,
      config
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 保存 Mem0 配置
app.post('/api/mem0/config', async (req, res) => {
  try {
    await PluginManager.savePluginConfig('mem0', req.body);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// 测试 Mem0 连接
app.post('/api/mem0/test', async (req, res) => {
  try {
    const result = await PluginManager.runPluginAction('mem0', 'testConnection', {
      config: req.body?.config || {}
    });

    res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 测试长毛象连接
app.post('/api/mastodon/test', async (req, res) => {
  try {
    const result = await PluginManager.runPluginAction('mastodon', 'testConnection', {
      config: req.body || {}
    });
    res.json({
      ok: result.success,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: '连接出现异常: ' + error.message
    });
  }
});

// 获取任务列表
app.get('/api/mem0/tasks', async (req, res) => {
  try {
    const mem0ConfigMod = await import('../../Plugin/Mem0/index.js');
    const config = await mem0ConfigMod.loadConfig();
    if (!config) {
      return res.json({ ok: true, tasks: [] });
    }

    const mem0ClientMod = await import('../../Plugin/Mem0/mem0_client.js');
    const Mem0Client = mem0ClientMod.default || mem0ClientMod.Mem0Client;
    const client = new Mem0Client(config);
    const tasks = await client.getTasks();

    res.json({
      ok: true,
      tasks
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 删除任务
app.delete('/api/mem0/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const mem0ConfigMod = await import('../../Plugin/Mem0/index.js');
    const config = await mem0ConfigMod.loadConfig();

    if (!config) {
      return res.status(404).json({
        ok: false,
        error: 'Mem0 配置未找到'
      });
    }

    const mem0ClientMod = await import('../../Plugin/Mem0/mem0_client.js');
    const Mem0Client = mem0ClientMod.default || mem0ClientMod.Mem0Client;
    const client = new Mem0Client(config);
    const result = await client.deleteTask(id);

    if (result.success) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ ok: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 获取洞察数据
app.get('/api/mem0/insights', async (req, res) => {
  try {
    const mem0ConfigMod = await import('../../Plugin/Mem0/index.js');
    const config = await mem0ConfigMod.loadConfig();
    if (!config) {
      return res.json({ ok: true, insights: null });
    }

    const mem0ClientMod = await import('../../Plugin/Mem0/mem0_client.js');
    const Mem0Client = mem0ClientMod.default || mem0ClientMod.Mem0Client;
    const client = new Mem0Client(config);
    const insights = await client.getInsights();

    res.json({ ok: true, insights });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 分析情绪
app.post('/api/mem0/analyze-emotions', async (req, res) => {
  try {
    const mem0ConfigMod = await import('../../Plugin/Mem0/index.js');
    const config = await mem0ConfigMod.loadConfig();
    if (!config) {
      return res.status(404).json({
        ok: false,
        error: 'Mem0 配置未找到'
      });
    }

    const mem0ClientMod = await import('../../Plugin/Mem0/mem0_client.js');
    const Mem0Client = mem0ClientMod.default || mem0ClientMod.Mem0Client;
    const client = new Mem0Client(config);
    const result = await client.analyzeEmotions();

    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 更新媒体项可见性
app.post('/api/mem0/media/:id/visibility', async (req, res) => {
  try {
    const { id } = req.params;
    const { visible } = req.body;
    const mem0ConfigMod = await import('../../Plugin/Mem0/index.js');
    const config = await mem0ConfigMod.loadConfig();

    if (!config) {
      return res.status(404).json({
        ok: false,
        error: 'Mem0 配置未找到'
      });
    }

    const mem0ClientMod = await import('../../Plugin/Mem0/mem0_client.js');
    const Mem0Client = mem0ClientMod.default || mem0ClientMod.Mem0Client;
    const client = new Mem0Client(config);
    const result = await client.updateMediaVisibility(id, visible);

    if (result.success) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ ok: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 更新工作/生活项可见性
app.post('/api/mem0/:category/:id/visibility', async (req, res) => {
  try {
    const { category, id } = req.params;
    const { visible } = req.body;
    const mem0ConfigMod = await import('../../Plugin/Mem0/index.js');
    const config = await mem0ConfigMod.loadConfig();

    if (!config) {
      return res.status(404).json({
        ok: false,
        error: 'Mem0 配置未找到'
      });
    }

    const mem0ClientMod = await import('../../Plugin/Mem0/mem0_client.js');
    const Mem0Client = mem0ClientMod.default || mem0ClientMod.Mem0Client;
    const client = new Mem0Client(config);
    const result = await client.updateItemVisibility(category, id, visible);

    if (result.success) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ ok: false, error: result.error });
    }
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
  console.log(`  💾 History file: ${HISTORY_FILE}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Press Ctrl+C to stop');
  console.log('');
});

export default app;
