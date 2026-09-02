/**
 * Misskey 适配器
 * 通过 Obsidian requestUrl 发送到 Misskey 实例
 */

export const manifest = {
    id: 'missky',
    version: '1.0.0',
    name: 'Misskey',
    description: '发布内容到 Misskey / Calckey / Firefish 实例',
    enabledByDefault: false,
    displayOrder: 40,
    capabilities: {
        text: true,
        attachments: true,
        attachmentTypes: ['image/*'],
        maxAttachments: 16,
        maxAttachmentSize: 0,
        warnOnAttachmentCount: true,
        warnOnAttachmentSize: false
    },
    settings: {
        fields: [
            {
                key: 'serverUrl',
                type: 'text',
                label: 'Misskey 实例地址',
                required: true,
                placeholder: 'https://misskey.io'
            },
            {
                key: 'apiToken',
                type: 'password',
                label: 'API Token',
                required: true,
                placeholder: '你的 Misskey API Token'
            },
            {
                key: 'visibility',
                type: 'select',
                label: '可见性',
                options: [
                    { value: 'public', label: '公开' },
                    { value: 'home', label: '主页' },
                    { value: 'followers', label: '仅关注者' },
                    { value: 'specified', label: '私信' }
                ],
                default: 'public'
            }
        ]
    }
};
const MAX_MISSKEY_IMAGES = manifest.capabilities.maxAttachments;

function getMimeType(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const mimeTypes = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * 上传单张图片到 Misskey Drive（/api/drive/files/create），返回 fileId
 */
async function uploadImageToMissky(arrayBuffer, filename, baseUrl, apiToken, requestUrl) {
    const safeFilename = String(filename || 'image').replace(/["\r\n]/g, '_');
    const mimeType = getMimeType(filename);
    const boundary = `----MisskeyBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;

    const encoder = new TextEncoder();
    const parts = [];
    parts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="i"\r\n\r\n${apiToken}\r\n`
    ));
    parts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    ));
    parts.push(new Uint8Array(arrayBuffer));
    parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

    const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        body.set(part, offset);
        offset += part.byteLength;
    }

    const response = await requestUrl({
        url: `${baseUrl}/api/drive/files/create`,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: body.buffer,
        throw: false
    });

    if (response.status < 200 || response.status >= 300) {
        return null;
    }
    const result = response.json || {};
    return result.id || null;
}

/**
 * 预检验证
 */
export async function validate({ payload }) {
    const warnings = [];
    const errors = [];

    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

    if (!payload.plainText && attachments.length === 0) {
        errors.push('内容不能为空');
    }

    return { warnings, errors };
}

/**
 * 统一执行接口
 * @param {object} options
 * @param {object} options.config - { serverUrl, apiToken, visibility }
 * @param {object} options.payload - 统一 payload
 * @param {Function} options.requestUrl
 */
export async function execute({ config = {}, payload = {}, requestUrl }) {
    const serverUrl = String(config.serverUrl || '').trim();
    const apiToken = String(config.apiToken || '').trim();
    const visibility = config.visibility || 'public';

    if (!serverUrl || !apiToken) {
        return { success: false, error: 'Misskey 实例地址或 API Token 未配置' };
    }

    const textContent = String(payload.plainText || '').trim();
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const warnings = [];

    try {
        // 上传图片到 Drive，拿到 fileIds
        const fileIds = [];
        const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
        const allImages = attachments.filter(a => a.kind === 'image');
        const images = allImages.slice(0, MAX_MISSKEY_IMAGES);

        if (allImages.length > MAX_MISSKEY_IMAGES) {
            warnings.push(`超过 ${MAX_MISSKEY_IMAGES} 张图片，只发送前 ${MAX_MISSKEY_IMAGES} 张`);
        }

        for (const img of images) {
            try {
                const buffer = typeof payload.readAttachment === 'function'
                    ? await payload.readAttachment(img.vaultPath)
                    : null;
                if (!buffer) {
                    warnings.push(`图片读取失败，已跳过：${img.filename}`);
                    continue;
                }
                const fileId = await uploadImageToMissky(buffer, img.filename, baseUrl, apiToken, requestUrl);
                if (fileId) {
                    fileIds.push(fileId);
                } else {
                    warnings.push(`图片上传失败，已跳过：${img.filename}`);
                }
            } catch (error) {
                warnings.push(`图片处理失败，已跳过：${img.filename}`);
            }
        }

        if (!textContent && fileIds.length === 0) {
            return { success: false, error: '内容不能为空' };
        }

        const response = await requestUrl({
            url: `${baseUrl}/api/notes/create`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                i: apiToken,
                ...(textContent ? { text: textContent } : {}),
                visibility,
                ...(fileIds.length > 0 ? { fileIds } : {})
            }),
            throw: false
        });

        if (response.status >= 200 && response.status < 300) {
            let result = {};
            try { result = response.json; } catch {}
            return { success: true, noteId: result.createdNote?.id || '', mediaCount: fileIds.length, warnings };
        } else {
            let errMsg = '';
            try { errMsg = response.json?.error?.message || response.text || `HTTP ${response.status}`; } catch { errMsg = `HTTP ${response.status}`; }
            return { success: false, error: errMsg, warnings };
        }
    } catch (error) {
        return { success: false, error: error.message, warnings };
    }
}

export default { manifest, execute, validate };
