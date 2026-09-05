/**
 * 从上传后的图片引用构建富文本草稿（纯函数）。
 *
 * 原实现埋在 src/main.js 中。将 Markdown 按图片引用切分为文本块与图片块，
 * 供发送面板的图片墙与 payload 构建使用。
 */

'use strict';

function buildRichDraftFromUploadedMarkdown(markdown, uploadedRefs = []) {
    const blocks = [];
    const images = [];
    let cursor = 0;
    const refs = (Array.isArray(uploadedRefs) ? uploadedRefs : [])
        .filter(r => r && typeof r.index === 'number' && r.end <= markdown.length && r.filename)
        .sort((a, b) => a.index - b.index);

    for (const ref of refs) {
        if (ref.index < cursor) continue;
        const txt = markdown.slice(cursor, ref.index);
        if (txt) {
            const prev = blocks[blocks.length - 1];
            if (prev?.type === 'text') prev.text += txt;
            else blocks.push({ type: 'text', text: txt });
        }
        const imgId = `obsidian_${images.length}_${ref.filename}`;
        images.push({
            id: imgId,
            filename: ref.filename,
            vaultPath: ref.vaultPath || ref.filename,
            previewUrl: '',
            createdAt: ''
        });
        blocks.push({ type: 'image', imageId: imgId });
        cursor = ref.end;
    }

    const remaining = markdown.slice(cursor);
    if (remaining) {
        const prev = blocks[blocks.length - 1];
        if (prev?.type === 'text') prev.text += remaining;
        else blocks.push({ type: 'text', text: remaining });
    }

    return { version: 1, blocks, images };
}

module.exports = { buildRichDraftFromUploadedMarkdown };