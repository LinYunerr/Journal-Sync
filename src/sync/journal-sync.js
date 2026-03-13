import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyNote, generateTags, summarizeContent, extractMetadata } from './note-classifier.js';
import { loadTelegramConfig } from '../../Plugin/Telegram-Send/loader.js';
import { loadFlomoConfig } from '../../Plugin/Flomo/loader.js';
import { loadMem0Config } from '../../Plugin/Mem0/loader.js';
import Mem0Client from '../../Plugin/Mem0/mem0_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置路径
const CONFIG_FILE = path.join(__dirname, '../../data/config.json');
const DEFAULT_OBSIDIAN_DIR = '/path/to/obsidian/notes';
const MEMU_BRIDGE_SCRIPT = '/path/to/memu_bridge.py';
const MEMU_USER_ID = 'linyun';
const TG_DIARY_CHANNEL = '@LinYunChannel';

/**
 * 加载配置
 */
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { obsidianPath: DEFAULT_OBSIDIAN_DIR };
  }
}

/**
 * 优化内容：删除多余空格和重复行
 */
function optimizeContent(content) {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter((line, index, arr) => index === 0 || line !== arr[index - 1])
    .join('\n')
    .trim();
}

/**
 * 保存到 Obsidian
 * 日记：简单保存，按日期追加
 * 笔记：AI 分类、生成元数据、支持总结模式
 */
async function saveToObsidian(content, type = 'diary', options = {}) {
  const config = await loadConfig();

  // 根据类型选择不同的路径
  let OBSIDIAN_DIR;
  if (type === 'note') {
    // 笔记使用 note.vaultPath
    OBSIDIAN_DIR = config?.note?.vaultPath || config?.obsidianPath || DEFAULT_OBSIDIAN_DIR;
  } else {
    // 日记使用 diary.obsidianPath
    OBSIDIAN_DIR = config?.diary?.obsidianPath || config?.obsidianPath || DEFAULT_OBSIDIAN_DIR;
  }

  const today = new Date();

  // 获取本地时区的日期和时间
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const hours = String(today.getHours()).padStart(2, '0');
  const minutes = String(today.getMinutes()).padStart(2, '0');
  const seconds = String(today.getSeconds()).padStart(2, '0');

  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours}:${minutes}`;
  const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

  try {
    // 日记模式：简单保存
    if (type === 'diary') {
      const fileName = `${dateStr} 日记.md`;
      const filePath = path.join(OBSIDIAN_DIR, fileName);
      const title = `${dateStr} 日记`;

      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);

      if (fileExists) {
        // 追加到现有文件
        const appendContent = `\n## ${timeStr}\n\n${content}\n`;
        await fs.appendFile(filePath, appendContent, 'utf-8');
        return { success: true, path: filePath, action: 'appended' };
      } else {
        // 创建新文件
        const frontmatter = `---
title: ${title}
date: ${dateStr}
source: user-input
date created: ${dateStr}
date modified: ${timestamp}
tags:
  - 日记
  - flomo
---

${content}
`;
        await fs.writeFile(filePath, frontmatter, 'utf-8');
        return { success: true, path: filePath, action: 'created' };
      }
    }

    // 笔记模式：AI 增强处理
    if (type === 'note') {
      console.log('[笔记保存] 开始 AI 处理流程...');

      // 1. 提取元数据
      console.log('[笔记保存] 步骤 1/4: 提取元数据...');
      const metadata = await extractMetadata(content, config);

      // 2. 生成标签
      console.log('[笔记保存] 步骤 2/4: 生成标签...');
      const tags = await generateTags(content, config);

      // 3. AI 分类到文件夹
      console.log('[笔记保存] 步骤 3/4: 分类到文件夹...');
      const classification = await classifyNote(content, config, OBSIDIAN_DIR);

      // 4. 处理内容（总结或原文）
      console.log('[笔记保存] 步骤 4/4: 处理内容...');
      let finalContent = content;
      if (options.summarize) {
        try {
          finalContent = await summarizeContent(content, config);
          console.log('[笔记保存] 内容已总结');
        } catch (error) {
          console.error('[笔记保存] 总结失败，使用原文:', error);
          finalContent = content;
        }
      }

      // 生成文件名（使用标题，清理特殊字符）
      const safeTitle = metadata.title
        .replace(/[\/\\:*?"<>|]/g, '') // 移除非法字符
        .substring(0, 100); // 限制长度
      const fileName = `${safeTitle}.md`;

      // 确定保存路径
      const targetDir = classification.folder
        ? path.join(OBSIDIAN_DIR, classification.folder)
        : OBSIDIAN_DIR;

      // 确保目标目录存在
      await fs.mkdir(targetDir, { recursive: true });

      const filePath = path.join(targetDir, fileName);

      // 构建 frontmatter
      const frontmatter = `---
title: ${metadata.title}
source: ${metadata.source || '用户输入'}
author: ${metadata.author || ''}
published: ${metadata.published || ''}
date created: ${dateStr}
date modified: ${timestamp}
tags:
${tags.map(tag => `  - ${tag}`).join('\n')}
---

${finalContent}
`;

      // 检查文件是否已存在
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);

      if (fileExists) {
        // 文件已存在，添加时间戳避免覆盖
        const uniqueFileName = `${safeTitle}_${Date.now()}.md`;
        const uniqueFilePath = path.join(targetDir, uniqueFileName);
        await fs.writeFile(uniqueFilePath, frontmatter, 'utf-8');
        console.log(`[笔记保存] 文件已存在，保存为: ${uniqueFileName}`);
        return {
          success: true,
          path: uniqueFilePath,
          action: 'created',
          folder: classification.folder,
          metadata
        };
      } else {
        await fs.writeFile(filePath, frontmatter, 'utf-8');
        console.log(`[笔记保存] 已保存到: ${classification.folder || '根目录'}/${fileName}`);
        return {
          success: true,
          path: filePath,
          action: 'created',
          folder: classification.folder,
          metadata
        };
      }
    }

    return { success: false, error: '未知类型' };
  } catch (error) {
    console.error('Obsidian save error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 同步到 flomo
 */
async function syncToFlomo(content) {
  // 加载插件配置
  const pluginConfig = await loadFlomoConfig();

  if (!pluginConfig || !pluginConfig.apiUrl) {
    return { success: false, error: 'flomo plugin not configured' };
  }

  try {
    const response = await fetch(pluginConfig.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    const result = await response.json();
    return { success: result.code === 0, response: result };
  } catch (error) {
    console.error('flomo sync error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 同步到 memU 并获取 AI 建议
 */
async function syncToMemU(content) {
  const config = await loadConfig();
  const memuBridgeScript = config?.diary?.memuBridgeScript || MEMU_BRIDGE_SCRIPT;
  const memuUserId = config?.diary?.memuUserId || MEMU_USER_ID;

  if (!memuBridgeScript || !memuUserId) {
    return { success: false, error: 'memU not configured' };
  }

  return new Promise((resolve) => {
    const memuProcess = spawn('python3', [
      memuBridgeScript,
      '--user-id', memuUserId,
      '--format', 'text'
    ]);

    let output = '';
    let errorOutput = '';

    memuProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    memuProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    memuProcess.on('error', (err) => {
      resolve({
        success: false,
        error: `memU process error: ${err.message}`
      });
    });

    // 写入内容到 stdin
    memuProcess.stdin.write(content);
    memuProcess.stdin.end();

    memuProcess.on('close', (code) => {
      if (code === 0) {
        // 提取建议
        const suggestion = extractSuggestion(output);
        resolve({
          success: true,
          output,
          suggestion
        });
      } else {
        resolve({
          success: false,
          error: errorOutput || 'memU process failed'
        });
      }
    });

    // 超时处理
    setTimeout(() => {
      memuProcess.kill();
      resolve({ success: false, error: 'timeout' });
    }, 30000);
  });
}

/**
 * 从 memU 输出中提取建议
 */
function extractSuggestion(output) {
  // 查找 "建议：" 标记
  const suggestionMatch = output.match(/建议：\s*([\s\S]*?)(?=\n\n|$)/);
  if (suggestionMatch) {
    return suggestionMatch[1].trim();
  }

  // 查找 "相关提醒" 标记
  const reminderMatch = output.match(/相关提醒[\s\S]*?(?=\n\n|$)/);
  if (reminderMatch) {
    return reminderMatch[0].trim();
  }

  return null;
}

/**
 * 发送到 Telegram
 */
async function sendToTelegram(content, channel) {
  // 加载插件配置
  const pluginConfig = await loadTelegramConfig();

  if (!pluginConfig) {
    return { success: false, error: 'Telegram plugin not configured' };
  }

  const tgBotToken = pluginConfig.botToken;
  const tgSendScript = pluginConfig.scriptPath;
  const tgChannel = channel || pluginConfig.defaultChannel || TG_DIARY_CHANNEL;

  if (!tgSendScript) {
    return { success: false, error: 'Telegram script not configured' };
  }

  if (!tgBotToken) {
    return { success: false, error: 'Telegram bot token not configured' };
  }

  return new Promise((resolve) => {
    // 设置环境变量传递 bot token
    const env = { ...process.env, TELEGRAM_BOT_TOKEN: tgBotToken };
    const tgProcess = spawn('python3', [tgSendScript, tgChannel, content], { env });

    let output = '';

    tgProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    tgProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    tgProcess.on('error', (err) => {
      resolve({
        success: false,
        error: `Telegram process error: ${err.message}`
      });
    });

    tgProcess.on('close', (code) => {
      resolve({ success: code === 0, output });
    });

    setTimeout(() => {
      tgProcess.kill();
      resolve({ success: false, error: 'timeout' });
    }, 10000);
  });
}

/**
 * 主同步函数
 */
export async function syncJournal(content, type = 'diary', options = {}) {
  const optimized = optimizeContent(content);
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const title = type === 'diary' ? `${dateStr} 日记` : `${dateStr} 笔记`;

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
    timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
    type,
    content: optimized
  };

  // 1. 保存到 Obsidian（必选，不受插件控制）
  results.obsidian = await saveToObsidian(optimized, type, options);

  // 2. 同步到 flomo（根据插件状态和单独的 flomo 开关）
  if (plugins.flomo && options.enableFlomo !== false) {
    results.flomo = await syncToFlomo(optimized);
  } else {
    results.flomo = { success: false, skipped: true, message: '插件已禁用' };
  }

  // 3. 同步到 memU 并获取建议（根据插件状态）
  if (plugins.memu) {
    results.memu = await syncToMemU(optimized);
  } else {
    results.memu = { success: false, skipped: true, message: '插件已禁用' };
  }

  // 4. 可选：发送到 Telegram（根据插件状态和用户选项）
  if (plugins.telegram && options.sendToTelegram) {
    const tgContent = results.memu?.suggestion || optimized;
    const channel = options.telegramChannel || config?.diary?.tgDiaryChannel || TG_DIARY_CHANNEL;
    results.telegram = await sendToTelegram(tgContent, channel);
  } else if (!plugins.telegram) {
    results.telegram = { success: false, skipped: true, message: '插件已禁用' };
  }

  // 5. 同步到 Mem0（仅日记模式，根据插件状态）
  if (type === 'diary' && plugins.mem0) {
    try {
      const mem0Config = await loadMem0Config();
      if (mem0Config) {
        const client = new Mem0Client(mem0Config);
        const mem0Result = await client.storeMemory(optimized, {
          type: 'diary',
          date: dateStr
        });

        results.mem0 = {
          success: mem0Result.success,
          tasks: mem0Result.tasks || [],
          tags: mem0Result.memory?.tags || [],
          entities: mem0Result.memory?.entities || []
        };
      } else {
        results.mem0 = { success: false, skipped: true, message: '配置未找到' };
      }
    } catch (error) {
      console.error('[Mem0] 同步失败:', error);
      results.mem0 = { success: false, error: error.message };
    }
  } else if (!plugins.mem0) {
    results.mem0 = { success: false, skipped: true, message: '插件已禁用' };
  }

  return results;
}

export default {
  syncJournal,
  saveToObsidian,
  syncToFlomo,
  syncToMemU,
  sendToTelegram
};
