/**
 * Telegraph 核心模块
 *
 * 职责：
 * 1. Telegraph API 客户端（createAccount / createPage）
 * 2. 图片上传到 telegra.ph/upload
 * 3. Markdown → Telegraph Node 转换
 *
 * 无外部依赖，使用 Obsidian requestUrl 发起 HTTP 请求。
 */

'use strict';

const TELEGRAPH_API_BASE = 'https://api.telegra.ph';
const TELEGRAPH_UPLOAD_URL = 'https://telegra.ph/upload';

// ── Telegraph API 客户端 ──────────────────────

/**
 * 调用 Telegraph API
 * @param {string} method - API 方法名
 * @param {object} params - 参数对象
 * @param {Function} requestUrlFn - Obsidian requestUrl
 * @returns {Promise<object>} result 字段
 */
async function telegraphApi(method, params, requestUrlFn) {
  const url = `${TELEGRAPH_API_BASE}/${method}`;
  const body = JSON.stringify(params || {});

  const response = await requestUrlFn({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    throw: false
  });

  const data = response.json;
  if (!data || data.ok !== true) {
    throw new Error(data?.error || `Telegraph API ${method} 失败 (HTTP ${response.status})`);
  }
  return data.result;
}

/**
 * 创建 Telegraph 账号
 * @param {string} shortName - 1-32 字符
 * @param {string} [authorName] - 可选作者名
 * @param {Function} requestUrlFn
 * @returns {Promise<{access_token: string, short_name: string, author_name: string, author_url: string}>}
 */
async function createAccount(shortName, authorName, requestUrlFn) {
  const params = { short_name: shortName };
  if (authorName) params.author_name = authorName;
  return telegraphApi('createAccount', params, requestUrlFn);
}

/**
 * 查询 Telegraph 账号信息（用于验证 token 有效性）
 * @param {string} accessToken
 * @param {Function} requestUrlFn
 * @returns {Promise<object>} 账号信息
 */
async function getAccountInfo(accessToken, requestUrlFn) {
  return telegraphApi('getAccountInfo', { access_token: accessToken, fields: ['short_name', 'author_name'] }, requestUrlFn);
}

/**
 * 创建 Telegraph 页面
 * @param {string} accessToken
 * @param {string} title - 最长 256 字符
 * @param {Array} content - Telegraph Node 数组
 * @param {string} [authorName]
 * @param {string} [authorUrl]
 * @param {Function} requestUrlFn
 * @returns {Promise<{url: string, path: string, title: string}>}
 */
async function createPage(accessToken, title, content, authorName, authorUrl, requestUrlFn) {
  const params = {
    access_token: accessToken,
    title: String(title || '').slice(0, 256),
    content: JSON.stringify(content)
  };
  if (authorName) params.author_name = authorName;
  if (authorUrl) params.author_url = authorUrl;
  return telegraphApi('createPage', params, requestUrlFn);
}

// ── 图片上传 ──────────────────────────────────

/**
 * 上传图片到 telegra.ph/upload
 * @param {ArrayBuffer} arrayBuffer - 图片二进制数据
 * @param {string} filename - 文件名
 * @param {Function} requestUrlFn - Obsidian requestUrl
 * @returns {Promise<string>} 完整的 telegra.ph 图片 URL
 */
async function uploadImage(arrayBuffer, filename, requestUrlFn) {
  // telegra.ph/upload 需要 multipart/form-data，字段名 'file'
  // Obsidian requestUrl 支持 FormData
  const formData = new FormData();
  const blob = new Blob([arrayBuffer]);
  formData.append('file', blob, filename || 'image.jpg');

  const response = await requestUrlFn({
    url: TELEGRAPH_UPLOAD_URL,
    method: 'POST',
    body: formData,
    throw: false
  });

  const data = response.json;
  if (!Array.isArray(data) || data.length === 0 || !data[0].src) {
    const errMsg = Array.isArray(data) && data[0]?.error ? data[0].error : '上传失败';
    throw new Error(`Telegraph 图片上传失败: ${errMsg}`);
  }

  return `https://telegra.ph${data[0].src}`;
}

// ── Markdown → Telegraph Node 转换 ────────────

/**
 * 将 Markdown 文本转换为 Telegraph Node 数组
 *
 * @param {string} markdown - 原始 Markdown 文本（图片已替换为公网 URL 的 ![[](url) 语法或 @图片N token）
 * @param {Map<string, string>} imageUrls - @图片N → 公网 URL 的映射
 * @param {number} titleLevel - 用作标题的 Markdown 标题层级（1-6）
 * @returns {{title: string, content: Array}} { title, content }
 */
function markdownToNodes(markdown, imageUrls, titleLevel) {
  const lines = String(markdown || '').split('\n');
  const titleLevelNum = Math.max(1, Math.min(6, Number(titleLevel) || 1));

  // 提取标题：第一个 >= titleLevel 的标题作为页面标题
  let pageTitle = '';
  let titleLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      if (level === titleLevelNum) {
        pageTitle = m[2].trim();
        titleLineIndex = i;
        break;
      }
    }
  }

  // 正文：跳过标题行，处理其余所有行
  const bodyLines = lines.filter((_, i) => i !== titleLineIndex);
  const content = parseBodyLines(bodyLines, imageUrls, titleLevelNum);

  return { title: pageTitle, content };
}

/**
 * 计算正文标题的 Telegraph tag
 * 规则：body heading M，偏移 = M - titleLevel
 * 正文最高层级（offset 1）→ h3（Telegraph 一级标题）
 * offset >= 2 → h4
 */
function bodyHeadingTag(headingLevel, titleLevel) {
  const offset = headingLevel - titleLevel;
  if (offset <= 1) return 'h3';
  return 'h4';
}

/**
 * 解析正文行，生成 Telegraph Node 数组
 */
function parseBodyLines(lines, imageUrls, titleLevelNum) {
  const nodes = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // @图片N token（独立行）
    const tokenMatch = line.trim().match(/^@图片(\d+)$/);
    if (tokenMatch) {
      const url = imageUrls.get(`@图片${tokenMatch[1]}`);
      if (url) {
        nodes.push({ tag: 'img', attrs: { src: url } });
      }
      i++;
      continue;
    }

    // ![alt](url) 或 ![[...]] 图片语法
    const imgMatch = line.trim().match(/^!\[[^\]]*\]\(([^)]+)\)$/);
    if (imgMatch) {
      const src = imgMatch[1].replace(/^<|>$/g, '');
      if (/^https?:\/\//i.test(src)) {
        nodes.push({ tag: 'img', attrs: { src } });
      }
      i++;
      continue;
    }

    // 标题行
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const tag = bodyHeadingTag(level, titleLevelNum);
      nodes.push({ tag, children: parseInline(text, imageUrls) });
      i++;
      continue;
    }

    // 水平分割线
    if (/^---+\s*$/.test(line.trim()) || /^\*\*\*+\s*$/.test(line.trim())) {
      nodes.push({ tag: 'hr' });
      i++;
      continue;
    }

    // 代码块
    if (line.trim().startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束的 ```
      nodes.push({ tag: 'pre', children: [codeLines.join('\n')] });
      continue;
    }

    // 引用块
    if (line.trim().startsWith('>')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const quoteContent = [];
      for (const qLine of quoteLines) {
        quoteContent.push(...parseInline(qLine, imageUrls));
        quoteContent.push({ tag: 'br' });
      }
      // 去掉末尾多余的 br
      if (quoteContent.length > 0 && quoteContent[quoteContent.length - 1].tag === 'br') {
        quoteContent.pop();
      }
      nodes.push({ tag: 'blockquote', children: quoteContent });
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*+]\s+/, '');
        items.push({ tag: 'li', children: parseInline(itemText, imageUrls) });
        i++;
      }
      nodes.push({ tag: 'ul', children: items });
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, '');
        items.push({ tag: 'li', children: parseInline(itemText, imageUrls) });
        i++;
      }
      nodes.push({ tag: 'ol', children: items });
      continue;
    }

    // 表格：Telegraph 不支持 table，转为普通文本段落
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      // 将表格行转为文本，用换行连接
      const tableText = tableLines
        .map(row => row.replace(/^\||\|$/g, '').replace(/\|/g, ' | '))
        .join('\n');
      nodes.push({ tag: 'p', children: [tableText] });
      continue;
    }

    // 普通段落：收集连续非空、非特殊行
    const paraLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (/^(#{1,6})\s+/.test(l)) break;
      if (/^[-*+]\s+/.test(l.trim())) break;
      if (/^\d+\.\s+/.test(l.trim())) break;
      if (l.trim().startsWith('>')) break;
      if (l.trim().startsWith('```')) break;
      if (/^---+\s*$/.test(l.trim()) || /^\*\*\*+\s*$/.test(l.trim())) break;
      if (l.trim().startsWith('|') && l.trim().endsWith('|')) break;
      const tokM = l.trim().match(/^@图片(\d+)$/);
      if (tokM) break;
      const imgM = l.trim().match(/^!\[[^\]]*\]\(([^)]+)\)$/);
      if (imgM) break;
      paraLines.push(l);
      i++;
    }

    if (paraLines.length > 0) {
      const paraText = paraLines.join('\n');
      // 检查段落中是否包含 @图片N token（内联图片）
      const inlineParts = splitByImageTokens(paraText, imageUrls);
      if (inlineParts.length > 1 || (inlineParts.length === 1 && inlineParts[0].type === 'image')) {
        // 段落中混合了图片和文本
        const children = [];
        for (const part of inlineParts) {
          if (part.type === 'image') {
            children.push({ tag: 'img', attrs: { src: part.url } });
          } else if (part.text) {
            children.push(...parseInline(part.text, imageUrls));
          }
        }
        nodes.push({ tag: 'p', children });
      } else {
        const inlineNodes = parseInline(paraText, imageUrls);
        if (inlineNodes.length > 0) {
          nodes.push({ tag: 'p', children: inlineNodes });
        }
      }
    }
  }

  return nodes;
}

/**
 * 将文本按 @图片N token 分割为文本和图片片段
 */
function splitByImageTokens(text, imageUrls) {
  const parts = [];
  const pattern = /@图片\d+/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, match.index) });
    }
    const url = imageUrls.get(match[0]);
    if (url) {
      parts.push({ type: 'image', url });
    } else {
      // 无 URL 映射的 token 保留为文本
      parts.push({ type: 'text', text: match[0] });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor) });
  }

  return parts;
}

/**
 * 解析行内 Markdown 格式：粗体、斜体、链接、代码、删除线
 * 返回 Telegraph Node children 数组（字符串或嵌套对象）
 */
function parseInline(text, imageUrls) {
  if (!text) return [];

  // 先处理 @图片N token（行内图片）
  const tokenParts = splitByImageTokens(text, imageUrls);
  const result = [];

  for (const part of tokenParts) {
    if (part.type === 'image') {
      result.push({ tag: 'img', attrs: { src: part.url } });
    } else if (part.text) {
      result.push(...parseInlineFormatting(part.text));
    }
  }

  return result;
}

/**
 * 解析行内格式化：**bold** *italic* [link](url) `code` ~~strike~~
 */
function parseInlineFormatting(text) {
  const nodes = [];
  let remaining = text;
  // 使用正则按优先级匹配各种行内格式
  const pattern = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)|(`(.+?)`)|(~~(.+?)~~)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(remaining)) !== null) {
    // 前面的纯文本
    if (match.index > lastIndex) {
      nodes.push(remaining.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // **bold**
      nodes.push({ tag: 'strong', children: [match[2]] });
    } else if (match[3]) {
      // *italic*
      nodes.push({ tag: 'em', children: [match[4]] });
    } else if (match[5]) {
      // _italic_
      nodes.push({ tag: 'em', children: [match[6]] });
    } else if (match[7]) {
      // `code`
      nodes.push({ tag: 'code', children: [match[8]] });
    } else if (match[9]) {
      // ~~strike~~
      nodes.push({ tag: 's', children: [match[10]] });
    } else if (match[11]) {
      // [text](url)
      nodes.push({ tag: 'a', attrs: { href: match[13] }, children: [match[12]] });
    }

    lastIndex = match.index + match[0].length;
  }

  // 末尾纯文本
  if (lastIndex < remaining.length) {
    nodes.push(remaining.slice(lastIndex));
  }

  // 处理换行：将 \n 转为 {tag:"br"}
  const finalNodes = [];
  for (const node of nodes) {
    if (typeof node === 'string') {
      const parts = node.split('\n');
      for (let j = 0; j < parts.length; j++) {
        if (parts[j]) finalNodes.push(parts[j]);
        if (j < parts.length - 1) finalNodes.push({ tag: 'br' });
      }
    } else {
      finalNodes.push(node);
    }
  }

  return finalNodes;
}

// ── 导出 ──────────────────────────────────────

module.exports = {
  createAccount,
  createPage,
  uploadImage,
  markdownToNodes,
  telegraphApi,
  getAccountInfo,
};
