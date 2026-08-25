/**
 * 统一 Payload 构建工具
 * 管道负责收集中性 payload，所有适配器接收同一结构。
 */

'use strict';

/**
 * 从富文本草稿和原始内容构建统一 payload。
 *
 * @param {object} options
 * @param {string} options.content      - 原始 Markdown（含 @图片N token）
 * @param {object} [options.richDraft]  - 富文本草稿 { version, blocks, images }
 * @param {string} [options.title]      - 笔记/范围标题
 * @param {Function} [options.readAttachment] - (vaultPath) => ArrayBuffer
 * @returns {object} unified payload
 */
function buildPayload({ content = '', richDraft, title = '', readAttachment } = {}) {
  const plainText = String(content || '')
    .replace(/@图片\d+/g, '')
    .replace(/!\[\[[^\]]+\]\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const attachments = extractAttachments(richDraft, content);

  return {
    content: String(content || ''),
    plainText,
    title: String(title || ''),
    attachments,
    readAttachment: typeof readAttachment === 'function' ? readAttachment : null
  };
}

/**
 * 从 richDraft.images 或正文中的 @图片N token 提取附件列表。
 * 每个附件包含 token、filename、vaultPath、mimeType、kind。
 */
function extractAttachments(richDraft, content) {
  const images = Array.isArray(richDraft?.images) ? richDraft.images : [];
  const referencedTokens = new Set(String(content || '').match(/@图片\d+/g) || []);
  const result = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img || !img.filename) continue;
    const token = String(img.token || `@图片${i + 1}`).trim();
    if (!/^@图片\d+$/.test(token) || !referencedTokens.has(token)) continue;
    result.push({
      token,
      filename: img.filename,
      vaultPath: img.vaultPath || img.filename,
      mimeType: getMimeType(img.filename),
      kind: 'image'
    });
  }

  return result;
}

function getMimeType(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  const types = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml'
  };
  return types[ext] || 'application/octet-stream';
}

module.exports = { buildPayload, getMimeType };
