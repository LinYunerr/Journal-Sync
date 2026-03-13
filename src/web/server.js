import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { syncJournal } from '../sync/journal-sync.js';
import { promises as fs } from 'fs';
import { loadTelegramConfig, saveTelegramConfig, updateChannels } from '../../Plugin/Telegram-Send/loader.js';
import { loadFlomoConfig, saveFlomoConfig } from '../../Plugin/Flomo/loader.js';
import { loadMem0Config, saveMem0Config } from '../../Plugin/Mem0/loader.js';
import Mem0Client from '../../Plugin/Mem0/mem0_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
// 限制 CORS，防止跨站请求伪造利用本地服务 RCE
app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../../public')));

// 历史记录存储
const HISTORY_FILE = path.join(__dirname, '../../data/history.json');
const CONFIG_FILE = path.join(__dirname, '../../data/config.json');

/**
 * 加载配置
 */
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // 返回默认配置
    return {
      obsidianPath: '/path/to/obsidian/notes'
    };
  }
}

/**
 * 保存配置
 */
async function saveConfig(config) {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

/**
 * 加载历史记录
 */
async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf-8');
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
    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save history:', error);
  }
}

/**
 * 添加到历史记录
 */
async function addToHistory(entry) {
  const history = await loadHistory();
  history.unshift(entry); // 最新的在前面

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
 * 保存日记/笔记（流式响应，实时更新状态）
 */
app.post('/api/save-stream', async (req, res) => {
  try {
    const { content, type = 'diary', options = {}, saveId } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: '内容不能为空' });
    }

    if (!['diary', 'note'].includes(type)) {
      return res.status(400).json({ error: '类型必须是 diary 或 note' });
    }

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log(`[${new Date().toISOString()}] Saving ${type}:`, content.substring(0, 50) + '...');
    console.log(`[${new Date().toISOString()}] Options:`, JSON.stringify(options));

    // 执行同步，使用流式更新
    // 注意：笔记的 AI 处理（分类、标签、总结）现在在 saveToObsidian 中完成
    const results = await syncJournalWithStream(content, type, options, (plugin, success) => {
      // 发送状态更新
      res.write(`data: ${JSON.stringify({ type: 'status', plugin, success })}\n\n`);
    });

    // 添加到历史记录（使用实际结果）
    const historyStatus = {};

    // Obsidian 总是显示
    historyStatus.obsidian = results.obsidian?.success ? 'success' : 'failed';

    // 其他插件：如果被跳过则标记为 'skipped'，否则显示实际结果
    if (results.flomo?.skipped) {
      historyStatus.flomo = 'skipped';
    } else if (results.flomo) {
      historyStatus.flomo = results.flomo.success ? 'success' : 'failed';
    }

    if (results.nmem?.skipped) {
      historyStatus.nmem = 'skipped';
    } else if (results.nmem) {
      historyStatus.nmem = results.nmem.success ? 'success' : 'failed';
    }

    if (results.memu?.skipped) {
      historyStatus.memu = 'skipped';
    } else if (results.memu) {
      historyStatus.memu = results.memu.success ? 'success' : 'failed';
    }

    if (results.telegram?.skipped) {
      historyStatus.telegram = 'skipped';
    } else if (results.telegram) {
      historyStatus.telegram = results.telegram.success ? 'success' : 'failed';
    }

    if (results.mem0?.skipped) {
      historyStatus.mem0 = 'skipped';
    } else if (results.mem0) {
      historyStatus.mem0 = results.mem0.success ? 'success' : 'failed';
    }

    await addToHistory({
      id: saveId,
      timestamp: new Date().toISOString(),
      type,
      content: content, // 保存完整内容，前端负责截断显示
      status: historyStatus,
      suggestion: results.memu?.suggestion || null
    });

    // 发送完成信号
    res.write(`data: ${JSON.stringify({ type: 'complete', suggestion: results.memu?.suggestion })}\n\n`);
    res.end();

    console.log(`[${new Date().toISOString()}] Save completed`);

  } catch (error) {
    console.error('Save error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

/**
 * 同步日记（带流式更新）- 并行执行，实时反馈
 */
async function syncJournalWithStream(content, type, options, onUpdate) {
  const journalSync = await import('../sync/journal-sync.js');
  const {
    saveToObsidian,
    syncToFlomo,
    syncToNmem,
    syncToMemU,
    sendToTelegram
  } = journalSync.default;

  const optimized = content.trim();
  const today = new Date().toISOString().split('T')[0];
  const title = type === 'diary' ? `${today} 日记` : `${today} 笔记`;

  // 加载配置和插件状态
  const config = await loadConfig();
  const plugins = config?.plugins || {
    flomo: true,
    nmem: true,
    memu: true,
    telegram: false,
    mem0: false
  };

  const results = {
    timestamp: new Date().toISOString(),
    type,
    content: optimized
  };

  // 1. 立即保存到 Obsidian（最快，优先执行）
  // 对于笔记，options.summarize 控制是否使用 AI 总结
  const obsidianPromise = saveToObsidian(optimized, type, options).then(result => {
    results.obsidian = result;
    onUpdate('obsidian', result.success);
    return result;
  });

  // 2. 并行执行其他插件
  const promises = [obsidianPromise];

  // flomo（检查全局插件开关和单独的 flomo 开关）
  if (plugins.flomo && options.enableFlomo !== false) {
    promises.push(
      syncToFlomo(optimized).then(result => {
        results.flomo = result;
        onUpdate('flomo', result.success);
        return result;
      })
    );
  } else {
    results.flomo = { success: false, skipped: true };
  }

  // nmem
  if (plugins.nmem) {
    promises.push(
      syncToNmem(optimized, title).then(result => {
        results.nmem = result;
        onUpdate('nmem', result.success);
        return result;
      })
    );
  } else {
    results.nmem = { success: false, skipped: true };
  }

  // memU
  if (plugins.memu) {
    promises.push(
      syncToMemU(optimized).then(result => {
        results.memu = result;
        onUpdate('memu', result.success);
        return result;
      })
    );
  } else {
    results.memu = { success: false, skipped: true };
  }

  // 等待所有插件完成
  await Promise.allSettled(promises);

  // mem0（仅日记模式）
  if (type === 'diary' && plugins.mem0) {
    try {
      const { loadMem0Config } = await import('../../Plugin/Mem0/loader.js');
      const { Mem0Client } = await import('../../Plugin/Mem0/mem0_client.js');

      const mem0Config = await loadMem0Config();
      if (mem0Config) {
        const client = new Mem0Client(mem0Config);
        const mem0Result = await client.storeMemory(optimized, {
          type: 'diary',
          date: today
        });

        // 更新洞察数据（书影音、工作、生活）
        await client.updateInsights(optimized, {
          type: 'diary',
          date: today
        });

        results.mem0 = {
          success: mem0Result.success,
          tasks: mem0Result.tasks || [],
          tags: mem0Result.memory?.tags || [],
          entities: mem0Result.memory?.entities || []
        };
        onUpdate('mem0', mem0Result.success);
      } else {
        results.mem0 = { success: false, skipped: true, message: '配置未找到' };
      }
    } catch (error) {
      console.error('[Mem0] 同步失败:', error);
      results.mem0 = { success: false, error: error.message };
      onUpdate('mem0', false);
    }
  } else if (!plugins.mem0) {
    results.mem0 = { success: false, skipped: true };
  }

  // telegram（依赖 memU 的建议，所以在最后执行）
  if (plugins.telegram && options.sendToTelegram) {
    const tgContent = results.memu?.suggestion || optimized;
    const channel = options.telegramChannel || config?.diary?.tgDiaryChannel;
    results.telegram = await sendToTelegram(tgContent, channel);
    onUpdate('telegram', results.telegram.success);
  } else if (!plugins.telegram) {
    results.telegram = { success: false, skipped: true };
  }

  return results;
}

/**
 * 保存日记/笔记（原有端点，保持兼容）
 */
app.post('/api/save', async (req, res) => {
  try {
    const { content, type = 'diary', options = {} } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: '内容不能为空' });
    }

    if (!['diary', 'note'].includes(type)) {
      return res.status(400).json({ error: '类型必须是 diary 或 note' });
    }

    console.log(`[${new Date().toISOString()}] Saving ${type}:`, content.substring(0, 50) + '...');

    // 如果是笔记且需要总结，调用 AI 总结
    let processedContent = content;
    if (type === 'note' && options.summarize) {
      try {
        processedContent = await summarizeNote(content);
        console.log(`[${new Date().toISOString()}] Note summarized`);
      } catch (error) {
        console.error('Summarization error:', error);
        // 总结失败时使用原文
        processedContent = content;
      }
    }

    // 执行同步
    const results = await syncJournal(processedContent, type, options);

    // 添加到历史记录
    await addToHistory({
      id: Date.now().toString(),
      timestamp: results.timestamp,
      type,
      content: content, // 保存完整内容，前端负责截断显示
      status: {
        obsidian: results.obsidian?.success || false,
        flomo: results.flomo?.success || false,
        nmem: results.nmem?.success || false,
        memu: results.memu?.success || false,
        telegram: results.telegram?.success || false
      },
      suggestion: results.memu?.suggestion || null
    });

    console.log(`[${new Date().toISOString()}] Save completed:`, {
      obsidian: results.obsidian?.success,
      flomo: results.flomo?.success,
      nmem: results.nmem?.success,
      memu: results.memu?.success,
      telegram: results.telegram?.success
    });

    res.json({
      success: true,
      results,
      message: '保存成功'
    });

  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * AI 总结笔记内容
 */
async function summarizeNote(content) {
  const config = await loadConfig();

  if (!config?.ai?.baseUrl || !config?.ai?.apiKey || !config?.ai?.model) {
    throw new Error('AI 配置不完整');
  }

  const systemPrompt = `你是一个专业的笔记整理助手。你的任务是将用户提供的网页、文章或长文本内容整理成结构化的笔记。

## 输出要求

1. **提取标题**：识别文章的主标题
2. **生成摘要**：用 2-3 句话概括核心内容
3. **提取关键要点**：
   - 正文 < 1000 字：提取 3 条关键要点
   - 正文 1000-3000 字：提取 4-5 条关键要点
   - 正文 > 3000 字：提取 5-7 条关键要点
4. **结构化整理**：
   - 保留原文的逻辑结构
   - 使用小标题分段
   - 去除广告、导航等无关内容
   - 保留重要的数据、引用和例子

## 输出格式

使用 Markdown 格式，结构如下：

\`\`\`markdown
# [文章标题]

## 摘要
[2-3 句话的核心概括]

## 关键要点
- [要点 1]
- [要点 2]
- [要点 3]
...

## 详细内容
[结构化的正文内容，使用小标题分段]
\`\`\`

请直接输出整理后的笔记，不要添加任何解释性文字。`;

  const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.ai.apiKey}`
    },
    body: JSON.stringify({
      model: config.ai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: content }
      ],
      temperature: 0.3,
      max_tokens: 4000
    })
  });

  if (!response.ok) {
    throw new Error(`AI API error: ${response.statusText}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

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

    const entries = await fs.readdir(basePath, { withFileTypes: true });
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
    const config = await loadConfig();
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
    const config = await loadConfig();
    const telegramConfig = await loadTelegramConfig();
    const flomoConfig = await loadFlomoConfig();

    // 默认值（从 journal-sync.js 中的常量）
    const defaults = {
      obsidianPath: '/path/to/obsidian/notes',
      flomoApi: '',
      memuBridgeScript: '/path/to/memu_bridge.py',
      memuUserId: 'linyun',
      tgDiaryChannel: '@LinYunChannel',
      tgBotToken: '',
      tgChannels: '[]',
      tgOptimizePrompt: ''
    };

    res.json({
      ok: true,
      config: {
        obsidianPath: config?.diary?.obsidianPath || config?.obsidianPath || defaults.obsidianPath,
        flomoApi: flomoConfig?.apiUrl || defaults.flomoApi,
        memuBridgeScript: config?.diary?.memuBridgeScript || defaults.memuBridgeScript,
        memuUserId: config?.diary?.memuUserId || defaults.memuUserId,
        tgDiaryChannel: telegramConfig?.defaultChannel || defaults.tgDiaryChannel,
        tgBotToken: telegramConfig?.botToken || defaults.tgBotToken,
        tgChannels: JSON.stringify(telegramConfig?.channels || []),
        tgOptimizePrompt: telegramConfig?.optimizePrompt || defaults.tgOptimizePrompt
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
    const config = await loadConfig();
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

    const config = await loadConfig();
    config.obsidianPath = obsidianPath.trim();
    await saveConfig(config);

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
    const config = await loadConfig();
    res.json({
      ok: true,
      config: {
        ai: {
          baseUrl: config?.ai?.baseUrl || '',
          apiKey: config?.ai?.apiKey || '',
          model: config?.ai?.model || ''
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
      const telegramConfig = await loadTelegramConfig() || {
        botToken: '',
        channels: [],
        defaultChannel: '',
        optimizePrompt: ''
      };

      if (configPath === 'diary.tgBotToken') {
        telegramConfig.botToken = value;
      } else if (configPath === 'diary.tgDiaryChannel') {
        telegramConfig.defaultChannel = value;
      } else if (configPath === 'diary.tgOptimizePrompt') {
        telegramConfig.optimizePrompt = value;
      }

      await saveTelegramConfig(telegramConfig);

      res.json({
        ok: true,
        message: 'Telegram 配置已更新'
      });
      return;
    }

    // 特殊处理 Flomo 配置，保存到插件配置文件
    if (configPath === 'diary.flomoApi') {
      const flomoConfig = await loadFlomoConfig() || { apiUrl: '' };
      flomoConfig.apiUrl = value;
      await saveFlomoConfig(flomoConfig);

      res.json({
        ok: true,
        message: 'Flomo 配置已更新'
      });
      return;
    }

    // 其他配置保存到主配置文件
    const config = await loadConfig();

    // 解析路径并设置值，防御原型污染
    const keys = configPath.split('.');
    if (keys.some(k => k === '__proto__' || k === 'constructor' || k === 'prototype')) {
      return res.status(400).json({ ok: false, error: '非法的配置安全范围' });
    }

    let current = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;

    await saveConfig(config);

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
    const config = await loadConfig();

    if (!config?.ai?.baseUrl || !config?.ai?.apiKey || !config?.ai?.model) {
      return res.status(400).json({
        ok: false,
        error: 'AI 配置不完整，请先配置 API 地址、密钥和模型'
      });
    }

    // 简单的测试请求
    const startTime = Date.now();
    const response = await fetch(`${config.ai.baseUrl}/chat/completions`, {
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
    const config = await loadConfig();
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

    const config = await loadConfig();

    if (!config.classification) {
      config.classification = {};
    }
    config.classification.rules = rules;

    await saveConfig(config);

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
    const config = await loadConfig();
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
    const config = await loadConfig();
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
    await saveConfig(config);

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

    const config = await loadConfig();
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
    await saveConfig(config);

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

    const config = await loadConfig();
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
    await saveConfig(config);

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
    const config = await loadConfig();
    const plugins = config?.plugins || {
      flomo: true,
      nmem: true,
      memu: true,
      telegram: false,
      mem0: false
    };

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

    const config = await loadConfig();

    if (!config.plugins) {
      config.plugins = {
        flomo: true,
        nmem: true,
        memu: true,
        telegram: false,
        mem0: false
      };
    }

    config.plugins[plugin] = enabled;
    await saveConfig(config);

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

/**
 * 获取分类方法
 */
app.get('/api/classification-method', async (req, res) => {
  try {
    const config = await loadConfig();
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

    const config = await loadConfig();

    if (!config.classification) {
      config.classification = {};
    }
    config.classification.method = method;

    await saveConfig(config);

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

    // 加载插件配置获取脚本路径
    const pluginConfig = await loadTelegramConfig();
    const tgSendScript = pluginConfig?.scriptPath || path.join(__dirname, '../../Plugin/Telegram-Send/telegram_send.py');

    if (!tgSendScript) {
      return res.json({
        ok: false,
        error: 'Telegram 脚本路径未配置'
      });
    }

    // 使用 Python 脚本获取频道列表
    const { spawn } = await import('child_process');

    const env = { ...process.env, TELEGRAM_BOT_TOKEN: botToken };
    const pythonProcess = spawn('python3', [tgSendScript, '--list-channels'], { env });

    let stdout = '';
    let stderr = '';
    let isResolved = false;

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        res.json({
          ok: false,
          error: `执行脚本失败: ${err.message}`
        });
      }
    });

    pythonProcess.on('close', async (code) => {
      if (isResolved) return;
      isResolved = true;

      if (code !== 0) {
        res.json({
          ok: false,
          error: `脚本执行失败 (退出码 ${code}): ${stderr || stdout}`
        });
        return;
      }

      try {
        // 解析 Python 脚本的 JSON 输出
        const result = JSON.parse(stdout);

        if (result.action === 'list' && result.channels) {
          // 格式化频道列表
          const channels = result.channels.map(ch => ({
            id: String(ch.id),
            title: ch.title || ch.username || String(ch.id),
            type: 'channel',
            username: ch.username ? `@${ch.username}` : null
          }));

          // 保存频道列表到插件配置
          await updateChannels(channels);

          // 同时保存 Bot Token 到插件配置
          if (pluginConfig) {
            pluginConfig.botToken = botToken;
            await saveTelegramConfig(pluginConfig);
          }

          res.json({
            ok: true,
            channels,
            message: channels.length > 0
              ? `找到 ${channels.length} 个可用频道`
              : 'Bot Token 有效，但未找到频道。请确保 Bot 已被添加到频道并有发送消息的权限。'
          });
        } else {
          res.json({
            ok: false,
            error: '脚本返回格式错误'
          });
        }
      } catch (parseError) {
        res.json({
          ok: false,
          error: `解析脚本输出失败: ${parseError.message}`,
          output: stdout
        });
      }
    });

    // 超时处理
    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        pythonProcess.kill();
        res.json({
          ok: false,
          error: '请求超时'
        });
      }
    }, 30000);
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

    const config = await loadConfig();
    const aiConfig = config?.ai;

    if (!aiConfig || !aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
      return res.json({
        ok: false,
        error: 'AI 配置不完整，请先在设置中配置 AI 模型'
      });
    }

    // 获取自定义提示词，如果没有则使用默认提示词
    const customPrompt = config?.diary?.tgOptimizePrompt;
    const systemPrompt = customPrompt || '你是一个专业的内容编辑，擅长将笔记内容优化为适合 Telegram 频道发布的格式。要求：1. 保持原意，简洁明了 2. 适当使用 emoji 3. 分段清晰 4. 适合社交媒体阅读';

    // 调用 AI 优化内容
    const https = await import('https');
    const { URL } = await import('url');

    // 拼接完整的 API 路径
    const fullUrl = `${aiConfig.baseUrl}/chat/completions`;
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
      let data = '';

      apiRes.on('data', (chunk) => {
        data += chunk;
      });

      apiRes.on('end', () => {
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
              error: `AI 错误: ${result.error.message || JSON.stringify(result.error)}`
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
    const { content, channel } = req.body;

    if (!content) {
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

    const config = await loadConfig();
    const tgSendScript = config?.diary?.tgSendScript || '/path/to/telegram_channel_send.py';
    const tgBotToken = config?.diary?.tgBotToken;

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

    // 使用 Python 脚本发送消息
    const { spawn } = await import('child_process');

    const env = { ...process.env, TELEGRAM_BOT_TOKEN: tgBotToken };
    const pythonProcess = spawn('python3', [tgSendScript, channel, content], { env });

    let stdout = '';
    let stderr = '';
    let isResolved = false;

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('error', (err) => {
      if (!isResolved) {
        isResolved = true;
        res.json({
          ok: false,
          error: `执行脚本失败: ${err.message}`
        });
      }
    });

    pythonProcess.on('close', (code) => {
      if (isResolved) return;
      isResolved = true;

      if (code === 0) {
        res.json({
          ok: true,
          message: '发布成功'
        });
      } else {
        res.json({
          ok: false,
          error: `发布失败 (退出码 ${code}): ${stderr || stdout}`
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
    }, 10000);
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
      const entries = await fs.readdir(dir, { withFileTypes: true });

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
    const config = await loadMem0Config();
    res.json({
      ok: true,
      config
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// 保存 Mem0 配置
app.post('/api/mem0/config', async (req, res) => {
  try {
    const result = await saveMem0Config(req.body);
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

// 测试 Mem0 连接
app.post('/api/mem0/test', async (req, res) => {
  try {
    const config = await loadMem0Config();
    if (!config) {
      return res.json({
        ok: false,
        error: 'Mem0 配置未找到'
      });
    }

    const client = new Mem0Client(config);
    const result = await client.testConnection();

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

// 获取任务列表
app.get('/api/mem0/tasks', async (req, res) => {
  try {
    const config = await loadMem0Config();
    if (!config) {
      return res.json({ ok: true, tasks: [] });
    }

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
    const config = await loadMem0Config();

    if (!config) {
      return res.status(404).json({
        ok: false,
        error: 'Mem0 配置未找到'
      });
    }

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
    const config = await loadMem0Config();
    if (!config) {
      return res.json({ ok: true, insights: null });
    }

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
    const config = await loadMem0Config();
    if (!config) {
      return res.status(404).json({
        ok: false,
        error: 'Mem0 配置未找到'
      });
    }

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
    const config = await loadMem0Config();

    if (!config) {
      return res.status(404).json({
        ok: false,
        error: 'Mem0 配置未找到'
      });
    }

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
    const config = await loadMem0Config();

    if (!config) {
      return res.status(404).json({
        ok: false,
        error: 'Mem0 配置未找到'
      });
    }

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
