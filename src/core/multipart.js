/**
 * 共享 multipart/form-data 请求体构造。
 *
 * 原 mastodon.js / missky.js 各自声明一份几乎逐行相同的构造逻辑，
 * 仅边界前缀与是否带额外文本字段（Misskey 的 `i` 字段）不同。
 * 本模块统一构造，适配器传入字段列表即可，避免复制粘贴式耦合。
 */

'use strict';

/**
 * 构造 multipart/form-data 请求体。
 *
 * @param {object} options
 * @param {string} options.boundaryPrefix - 边界前缀（如 '----MastodonBoundary'），实际边界会追加时间戳与随机串
 * @param {Array<object>} options.fields - 字段列表，顺序即请求体顺序：
 *   - 文本字段：{ name, value }
 *   - 文件字段：{ name, filename, contentType, buffer }（buffer 为 ArrayBuffer）
 * @returns {{ boundary: string, body: ArrayBuffer }}
 */
function buildMultipartBody({ boundaryPrefix = '----Boundary', fields = [] }) {
    const boundary = `${boundaryPrefix}${Date.now()}${Math.random().toString(16).slice(2)}`;
    const encoder = new TextEncoder();
    const parts = [];

    for (const field of fields) {
        if (field.buffer !== undefined && field.buffer !== null) {
            const safeFilename = String(field.filename || 'image').replace(/["\r\n]/g, '_');
            const contentType = String(field.contentType || 'application/octet-stream');
            parts.push(encoder.encode(
                `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"; filename="${safeFilename}"\r\nContent-Type: ${contentType}\r\n\r\n`
            ));
            parts.push(new Uint8Array(field.buffer));
            parts.push(encoder.encode('\r\n'));
        } else {
            parts.push(encoder.encode(
                `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${String(field.value ?? '')}\r\n`
            ));
        }
    }

    parts.push(encoder.encode(`--${boundary}--\r\n`));

    const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        body.set(part, offset);
        offset += part.byteLength;
    }

    return { boundary, body: body.buffer };
}

module.exports = { buildMultipartBody };