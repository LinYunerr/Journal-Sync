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

// 简单内存缓存：1 小时过期
let folderCache = null;
let folderCacheTime = 0;
const CACHE_TTL = 3600 * 1000;

/**
 * 1. 获取文件夹结构（附带内存缓存）
 */
async function getFolderStructure(baseDir) {
  if (folderCache && Date.now() - folderCacheTime < CACHE_TTL) {
    return folderCache;
  }

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
    folderCache = folders;
    folderCacheTime = Date.now();
    return folders;
  } catch (error) {
    console.error('读取文件夹结构失败:', error);
    return [];
  }
}

/**
 * 清除文件夹缓存（供外部调用或文件变更时复位）
 */
export function clearFolderCache() {
  folderCache = null;
  folderCacheTime = 0;
}

/**
 * 2. 核心 AI 处理：提取元数据、生成标签、并规划分类文件夹（单次 API 调用完成）
 */
export async function processNoteAI(content, config, baseDir) {
  const folders = await getFolderStructure(baseDir);

  const customRules = config?.classification?.rules || [];
  const rulesText = customRules.length > 0
    ? `\n\n用户自定义分类规则（优先级最高）：\n${customRules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}`
    : '';

  const systemPrompt = `你是一个全能的知识库整理分析助手。你需要对笔记进行综合评估分析。

任务范围：
1. 元数据提取：提取笔记的 "title"(若无则简短生成), "author", "source", "published"(YYYY-MM-DD，若无返回null)。不要虚构。
2. 语义标签生成：生成 1-3 个中文精准语义标签(tags)，避免宽泛词汇，优先使用领域专业术语。
3. 文件夹分类：从下方提供的[现有文件夹列表]中选择最符合主题的一个完整路径作为 "folder" 或者依据规则建议同级新建。如果有对应规则，则优先按照规则分类。返回 "isNew"(是否属于新建议的文件夹)及 "reason"(分类理由)。

${rulesText}

现有文件目录层级结构参考：
${folders.length > 0 ? folders.map(f => `- ${f}`).join('\n') : '目前为空请建议一个新主分类。'}

必须返回严谨的 JSON 结构，并严格参照如下键名：
{
  "metadata": {
    "title": "文章标题",
    "author": "作者信息或null",
    "source": "来源信息或null",
    "published": "日期或null"
  },
  "tags": ["标签1", "标签2"],
  "classification": {
    "folder": "现有的确切路径，比如 'J 艺术/J4 摄影艺术 与电影艺术/视频技术'",
    "reason": "简短的一句分类理由",
    "isNew": false
  }
}

仅输出正确的 JSON（不要带 Markdown block 和多余文字），确保它能被直接解析。`;

  const userPrompt = `请对以下内容进行处理：
  
${content.substring(0, 1500)}${content.length > 1500 ? '...' : ''}`;

  let result = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      let response = await callAI(config, systemPrompt, userPrompt);
      response = response.trim();

      if (response.startsWith('\`\`\`json')) {
        response = response.replace(/\`\`\`json\n?/g, '').replace(/\`\`\`\n?/g, '');
      } else if (response.startsWith('\`\`\`')) {
        response = response.replace(/\`\`\`\n?/g, '');
      }

      result = JSON.parse(response);
      console.log(`[processNoteAI] 第 ${attempt} 次响应成功.`);
      break;
    } catch (error) {
      console.error(`[processNoteAI] 尝试 ${attempt} 失败: ${error.message}`);
      if (attempt === 2) {
        result = null;
      }
    }
  }

  // 默认 Fallback
  const defaultMeta = { title: '未命名笔记', author: null, source: null, published: null };
  const defaultRes = {
    metadata: defaultMeta,
    tags: ['默认归档'],
    classification: { folder: '', reason: '分析失败使用根目录', isNew: false }
  };

  if (!result) return defaultRes;

  // 保证 metadata 全面
  if (!result.metadata) result.metadata = defaultMeta;
  if (!result.metadata.title) result.metadata.title = '未命名笔记';
  if (!Array.isArray(result.tags)) result.tags = ['默认归档'];

  // 核对分类
  if (result.classification && result.classification.folder) {
    const isExist = folders.includes(result.classification.folder);
    if (isExist) {
      result.classification.isNew = false;
    } else if (!result.classification.isNew) {
      // AI 自作主张塞了个不存在的且说不是新的，强行置空作为回退避免后续出错
      result.classification.folder = '';
    }
  } else {
    result.classification = defaultRes.classification;
  }

  return result;
}

/**
 * 3. AI 总结内容：生成结构化笔记（保持原有功能不变）
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

export default {
  processNoteAI,
  summarizeContent,
  clearFolderCache
};
