/**
 * 富文本内容渲染器
 * 通用工具函数，不含任何平台专属逻辑。
 * 各适配器自行决定如何从 richDraft 或 payload 渲染内容。
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

export default { normalizeRichDraft, createImageEntity };
