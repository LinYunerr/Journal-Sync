/**
 * 富文本内容渲染器
 * 从 src/sync/rich-content-renderer.js 移植，无任何外部依赖
 * 可在 Obsidian 插件环境中直接运行
 */

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n');
}

function sanitizeImageEntity(rawImage = {}, index = 0) {
  if (!rawImage || typeof rawImage !== 'object') return null;
  const filename = String(rawImage.filename || '').trim();
  if (!filename) return null;
  const id = String(rawImage.id || '').trim() || `legacy_${index}_${filename}`;
  return {
    id,
    filename,
    vaultPath: String(rawImage.vaultPath || filename).trim(),
    previewUrl: String(rawImage.previewUrl || '').trim(),
    createdAt: String(rawImage.createdAt || '').trim()
  };
}

export function createImageEntity(filename, index = 0) {
  const normalizedFilename = String(filename || '').trim();
  return {
    id: `legacy_${index}_${normalizedFilename}`,
    filename: normalizedFilename,
    vaultPath: normalizedFilename,
    previewUrl: '',
    createdAt: ''
  };
}

export function normalizeRichDraft(rawDraft = {}, fallbackContent = '', fallbackImageFilenames = []) {
  const draft = rawDraft && typeof rawDraft === 'object' && !Array.isArray(rawDraft) ? rawDraft : {};
  const fallbackImages = (Array.isArray(fallbackImageFilenames) ? fallbackImageFilenames : [])
    .map((filename, index) => createImageEntity(filename, index))
    .filter(image => image.filename);
  const images = (Array.isArray(draft.images) ? draft.images : fallbackImages)
    .map((image, index) => sanitizeImageEntity(image, index))
    .filter(Boolean);
  const blocks = Array.isArray(draft.blocks)
    ? draft.blocks.map(block => {
      if (!block || typeof block !== 'object') return null;
      if (block.type === 'image') {
        const imageId = String(block.imageId || '').trim();
        return imageId ? { type: 'image', imageId } : null;
      }
      if (block.type === 'text') {
        return { type: 'text', text: normalizeText(block.text) };
      }
      return null;
    }).filter(Boolean)
    : [{ type: 'text', text: normalizeText(fallbackContent) }].filter(block => block.text);

  return { version: 1, blocks, images };
}

function pushTextBlock(blocks, text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return;
  const previous = blocks[blocks.length - 1];
  if (previous?.type === 'text') {
    previous.text += normalizedText;
    return;
  }
  blocks.push({ type: 'text', text: normalizedText });
}

function buildOrderedBlocks(draft, warnings) {
  const imageById = new Map(draft.images.map(image => [image.id, image]));
  const referencedIds = new Set();
  const ordered = [];

  for (const block of draft.blocks) {
    if (block.type === 'text') {
      pushTextBlock(ordered, block.text);
      continue;
    }
    if (block.type !== 'image') continue;
    const image = imageById.get(block.imageId);
    if (!image) {
      warnings.push(`图片 token 引用不存在: ${block.imageId}`);
      continue;
    }
    if (referencedIds.has(image.id)) continue;
    referencedIds.add(image.id);
    ordered.push({ type: 'image', image });
  }

  for (const image of draft.images) {
    if (!referencedIds.has(image.id)) {
      ordered.push({ type: 'image', image });
      referencedIds.add(image.id);
    }
  }

  return ordered;
}

function renderPlainText(orderedBlocks) {
  return orderedBlocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .replace(/@图片\d+/g, '')
    .trim();
}

function renderObsidianMarkdown(orderedBlocks) {
  const parts = [];
  for (let index = 0; index < orderedBlocks.length; index += 1) {
    const block = orderedBlocks[index];
    if (block.type === 'text') {
      const previousIsImage = orderedBlocks[index - 1]?.type === 'image';
      const nextIsImage = orderedBlocks[index + 1]?.type === 'image';
      let text = block.text;
      if (previousIsImage) text = text.replace(/^\s+/, '');
      if (nextIsImage) text = text.replace(/\s+$/, '');
      parts.push(text);
    } else if (block.type === 'image') {
      parts.push(`\n\n![[${block.image.filename}]]\n`);
    }
  }
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function renderTelegramSegments(orderedBlocks) {
  const segments = [];
  for (const block of orderedBlocks) {
    if (block.type === 'text') {
      const markdown = block.text.trim();
      if (markdown) segments.push({ type: 'richText', markdown });
    } else if (block.type === 'image') {
      segments.push({
        type: 'image',
        filename: block.image.filename,
        vaultPath: block.image.vaultPath || block.image.filename
      });
    }
  }
  return segments;
}

/**
 * 渲染富文本草稿为各平台需要的格式
 */
export function renderRichContent({ richDraft, fallbackContent = '', fallbackImageFilenames = [] } = {}) {
  const warnings = [];
  const draft = normalizeRichDraft(richDraft, fallbackContent, fallbackImageFilenames);
  const orderedBlocks = buildOrderedBlocks(draft, warnings);
  const orderedImageFilenames = [];
  const seenFilenames = new Set();

  for (const block of orderedBlocks) {
    if (block.type !== 'image') continue;
    if (seenFilenames.has(block.image.filename)) continue;
    seenFilenames.add(block.image.filename);
    orderedImageFilenames.push(block.image.filename);
  }

  return {
    plainText: renderPlainText(orderedBlocks),
    obsidianMarkdown: renderObsidianMarkdown(orderedBlocks),
    telegramSegments: renderTelegramSegments(orderedBlocks),
    orderedImageFilenames,
    warnings
  };
}

/**
 * 简单内容优化：去除多余空白
 */
export default { renderRichContent, normalizeRichDraft, createImageEntity };
