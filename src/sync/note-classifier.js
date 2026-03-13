import https from 'https';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * AI 辅助笔记分类和元数据生成模块
 * 每个 AI 任务独立调用，实现功能解耦
 */

/**
 * 调用 AI API 的通用函数
 */
async function callAI(config, systemPrompt, userPrompt) {
  if (!config?.ai?.baseUrl || !config?.ai?.apiKey || !config?.ai?.model) {
    throw new Error('AI 配置不完整');
  }

  // Ensure the URL ends with /chat/completions
  let apiUrl = config.ai.baseUrl;
  if (!apiUrl.endsWith('/chat/completions')) {
    apiUrl = apiUrl.replace(/\/$/, '') + '/chat/completions';
  }

  const url = new URL(apiUrl);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ai.apiKey}`
      }
    };

    const request = https.request(options, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk.toString();
      });

      response.on('end', () => {
        try {
          if (!data || data.trim() === '') {
            console.error('[callAI] HTTP 状态码:', response.statusCode);
            console.error('[callAI] 请求 URL:', apiUrl);
            return reject(new Error('AI 返回空响应'));
          }

          const result = JSON.parse(data);

          if (result.error) {
            return reject(new Error(`AI 错误: ${result.error.message || JSON.stringify(result.error)}`));
          }

          if (result.choices && result.choices[0] && result.choices[0].message) {
            resolve(result.choices[0].message.content);
          } else {
            reject(new Error('AI 返回格式错误'));
          }
        } catch (error) {
          reject(new Error(`解析 AI 响应失败: ${error.message}`));
        }
      });
    });

    request.on('error', (error) => {
      reject(new Error(`AI 请求失败: ${error.message}`));
    });

    request.write(JSON.stringify({
      model: config.ai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3
    }));

    request.end();
  });
}

/**
 * 1. 获取文件夹结构（递归读取所有子文件夹）
 */
async function getFolderStructure(baseDir) {
  try {
    const folders = [];

    async function scanDir(dir, prefix = '') {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'assets') {
          const folderPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          folders.push(folderPath);

          // 递归扫描子文件夹
          const fullPath = path.join(dir, entry.name);
          await scanDir(fullPath, folderPath);
        }
      }
    }

    await scanDir(baseDir);
    return folders;
  } catch (error) {
    console.error('读取文件夹结构失败:', error);
    return [];
  }
}

/**
 * 2. AI 分类：决定笔记应该存储到哪个文件夹
 * 如果没有合适的文件夹，AI 可以建议创建新文件夹
 */
export async function classifyNote(content, config, baseDir) {
  const folders = await getFolderStructure(baseDir);

  // 读取用户自定义的分类规则
  const customRules = config?.classification?.rules || [];
  const rulesText = customRules.length > 0
    ? `\n\n用户自定义分类规则（优先级从高到低）：\n${customRules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}`
    : '';

  const systemPrompt = `你是一个专业的笔记分类助手。根据笔记内容，选择或建议一个合适的文件夹路径。

规则：
1. 仔细分析笔记的主题和内容
2. **优先遵循用户自定义的分类规则**（如果有）
3. **必须从现有文件夹列表中选择一个完整路径**（包括所有层级，如 "J 艺术/J4 摄影艺术 与电影艺术/视频技术"）
4. 如果现有文件夹都不合适，可以建议创建新文件夹，但必须基于现有的顶级分类（如在 "J 艺术" 下创建子文件夹）
5. 返回的 folder 字段必须是完整的相对路径，使用 "/" 分隔层级
${rulesText}

${folders.length > 0 ? `现有文件夹列表（完整路径）：\n${folders.map(f => `- ${f}`).join('\n')}` : '当前没有分类文件夹，请建议一个新的文件夹名称。'}

请以 JSON 格式返回：
{
  "folder": "完整的文件夹路径（如 'J 艺术/J4 摄影艺术 与电影艺术/视频技术'）",
  "reason": "选择或创建理由（简短说明）",
  "isNew": true/false
}`;

  const userPrompt = `请为以下笔记内容选择或建议合适的文件夹：

${content.substring(0, 1000)}${content.length > 1000 ? '...' : ''}`;

  // 最多尝试 2 次
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await callAI(config, systemPrompt, userPrompt);
      console.log(`[classifyNote] 第 ${attempt} 次尝试，AI 响应:`, response.substring(0, 200));
      const result = JSON.parse(response);

      // 验证返回的文件夹路径
      if (result.folder) {
        // 检查是否在现有文件夹列表中
        const folderExists = folders.includes(result.folder);

        if (folderExists) {
          console.log(`[笔记分类] ✅ 选择现有文件夹: ${result.folder}`);
          return { ...result, isNew: false };
        } else if (result.isNew) {
          // AI 建议创建新文件夹，验证路径格式
          const newFolderPath = path.join(baseDir, result.folder);
          try {
            await fs.mkdir(newFolderPath, { recursive: true });
            console.log(`[笔记分类] ✅ 创建新文件夹: ${result.folder}`);
            return result;
          } catch (error) {
            console.error(`[笔记分类] ❌ 创建文件夹失败:`, error);
            if (attempt === 2) {
              // 第二次尝试仍失败，使用根目录
              return { folder: '', reason: '创建文件夹失败，使用根目录', isNew: false };
            }
            // 继续下一次尝试
            continue;
          }
        } else {
          // AI 返回的文件夹不存在，且标记为非新建
          console.warn(`[笔记分类] ⚠️ 第 ${attempt} 次尝试：AI 返回的文件夹不存在: ${result.folder}`);
          if (attempt === 2) {
            // 第二次尝试仍失败，使用根目录
            return { folder: '', reason: 'AI 返回的文件夹不存在，使用根目录', isNew: false };
          }
          // 继续下一次尝试
          continue;
        }
      } else {
        console.warn(`[笔记分类] ⚠️ 第 ${attempt} 次尝试：AI 未返回文件夹`);
        if (attempt === 2) {
          return { folder: '', reason: 'AI 未返回有效文件夹，使用根目录', isNew: false };
        }
        continue;
      }
    } catch (error) {
      console.error(`[classifyNote] 第 ${attempt} 次尝试失败:`, error.message);
      if (attempt === 2) {
        console.error('[classifyNote] 错误详情:', error);
        return { folder: '', reason: '分类失败，使用根目录', isNew: false };
      }
      // 继续下一次尝试
      continue;
    }
  }

  // 理论上不会到这里，但以防万一
  return { folder: '', reason: '分类失败，使用根目录', isNew: false };
}

/**
 * 3. AI 生成标签：根据内容生成 1-3 个语义标签
 */
export async function generateTags(content, config) {
  const systemPrompt = `你是一个专业的标签生成助手。根据笔记内容生成 1-3 个精准的语义标签。

规则：
1. 标签应该反映内容的核心主题
2. 使用中文，简洁明了（2-4 个字）
3. 避免过于宽泛的标签（如"学习"、"工作"）
4. 优先使用专业术语和领域词汇
5. 生成 1-3 个标签即可

请以 JSON 数组格式返回：
["标签1", "标签2", "标签3"]`;

  const userPrompt = `请为以下内容生成标签：

${content.substring(0, 1500)}${content.length > 1500 ? '...' : ''}`;

  try {
    const response = await callAI(config, systemPrompt, userPrompt);
    console.log('[generateTags] AI 响应:', response.substring(0, 200));
    const tags = JSON.parse(response);

    if (Array.isArray(tags) && tags.length > 0) {
      return tags.slice(0, 3); // 最多 3 个标签
    }

    return ['网页内容']; // 默认标签
  } catch (error) {
    console.error('[generateTags] AI 生成标签失败:', error.message);
    console.error('[generateTags] 错误详情:', error);
    return ['网页内容'];
  }
}

/**
 * 4. AI 总结内容：生成结构化笔记
 */
export async function summarizeContent(content, config) {
  const systemPrompt = `你是一个专业的笔记整理助手。将内容整理成结构化的笔记格式。

输出格式要求：
## 摘要
（用 2-3 句话概括核心内容）

## 关键信息
- 要点1
- 要点2
- 要点3

## 正文
（结构化整理的主要内容，保持逻辑清晰）

## 原文摘录（可选）
> 重要的原文引用

规则：
1. 保持客观，不添加个人观点
2. 提取核心信息，去除冗余
3. 保持原意，不曲解内容
4. 使用 Markdown 格式`;

  const userPrompt = `请整理以下内容：

${content}`;

  try {
    const response = await callAI(config, systemPrompt, userPrompt);
    return response;
  } catch (error) {
    console.error('AI 总结失败:', error);
    throw error;
  }
}

/**
 * 5. 提取元数据：从内容中提取标题、作者、来源等
 */
export async function extractMetadata(content, config) {
  const systemPrompt = `你是一个元数据提取助手。从内容中提取标题、作者、来源、发布时间等信息。

请以 JSON 格式返回：
{
  "title": "文章标题（如果无法提取，生成一个简短的描述性标题）",
  "author": "作者名称（如果没有则为 null）",
  "source": "来源说明（如：网站名、公众号名等，如果没有则为 null）",
  "published": "发布时间（YYYY-MM-DD 格式，如果没有则为 null）"
}

规则：
1. 标题必须提供，如果无法提取则根据内容生成
2. 其他字段如果无法确定则返回 null
3. 不要编造信息`;

  const userPrompt = `请从以下内容中提取元数据：

${content.substring(0, 1000)}${content.length > 1000 ? '...' : ''}`;

  try {
    const response = await callAI(config, systemPrompt, userPrompt);
    console.log('[extractMetadata] AI 响应:', response.substring(0, 200));
    const metadata = JSON.parse(response);

    // 确保标题存在
    if (!metadata.title) {
      metadata.title = '未命名笔记';
    }

    return metadata;
  } catch (error) {
    console.error('[extractMetadata] AI 提取元数据失败:', error.message);
    console.error('[extractMetadata] 错误详情:', error);
    // 返回默认值
    return {
      title: '未命名笔记',
      author: null,
      source: null,
      published: null
    };
  }
}

export default {
  classifyNote,
  generateTags,
  summarizeContent,
  extractMetadata
};
