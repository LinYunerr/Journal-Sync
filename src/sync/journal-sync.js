import { promises as fs } from 'fs';
import path from 'path';
import { processNoteAI, summarizeContent } from './note-classifier.js';
import { loadConfig } from '../utils/config-manager.js';

const DEFAULT_OBSIDIAN_DIR = '/path/to/obsidian/notes';

/**
 * 优化内容：删除多余空格和重复行
 */
export function optimizeContent(content) {
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
export async function saveToObsidian(content, type = 'diary', options = {}) {
  const config = await loadConfig();

  // 根据类型选择不同的路径
  let OBSIDIAN_DIR;
  if (type === 'note') {
    OBSIDIAN_DIR = config?.note?.vaultPath || config?.obsidianPath || DEFAULT_OBSIDIAN_DIR;
  } else {
    OBSIDIAN_DIR = config?.diary?.obsidianPath || config?.obsidianPath || DEFAULT_OBSIDIAN_DIR;
  }

  const today = new Date();
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

    // 笔记模式：AI 增强处理 (一次调用，取代原本的 3 次)
    if (type === 'note') {
      console.log('[笔记保存] 开始 AI 处理流程...');

      const aiResult = await processNoteAI(content, config, OBSIDIAN_DIR);
      const { metadata, tags, classification } = aiResult;

      let finalContent = content;
      if (options.summarize) {
        try {
          finalContent = await summarizeContent(content, config);
          console.log('[笔记保存] 内容已总结');
        } catch (error) {
          console.error('[笔记保存] 总结失败，使用原文:', error);
        }
      }

      // 生成文件名（使用标题，清理特殊字符）
      const safeTitle = metadata.title
        .replace(/[\/\\:*?"<>|]/g, '')
        .substring(0, 100);
      const fileName = `${safeTitle}.md`;

      // 确定保存路径防范 AI 幻觉引发的路径穿越
      let targetDir = OBSIDIAN_DIR;
      if (classification.folder) {
        const safeFolder = classification.folder
          .replace(/\.\.[\/\\]/g, '')
          .replace(/^[\/\\]+/, '');

        const resolvedPath = path.resolve(OBSIDIAN_DIR, safeFolder);
        if (resolvedPath.startsWith(path.resolve(OBSIDIAN_DIR))) {
          targetDir = resolvedPath;
        }
      }

      await fs.mkdir(targetDir, { recursive: true });
      const filePath = path.join(targetDir, fileName);

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

      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);

      if (fileExists) {
        const uniqueFileName = `${safeTitle}_${Date.now()}.md`;
        const uniqueFilePath = path.join(targetDir, uniqueFileName);
        await fs.writeFile(uniqueFilePath, frontmatter, 'utf-8');
        return {
          success: true,
          path: uniqueFilePath,
          action: 'created',
          folder: classification.folder,
          metadata
        };
      } else {
        await fs.writeFile(filePath, frontmatter, 'utf-8');
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

export default {
  saveToObsidian,
  optimizeContent
};
