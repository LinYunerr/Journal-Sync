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

function getMimeType(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const mimeTypes = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg',
        png: 'image/png', gif: 'image/gif',
        webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
        svg: 'image/svg+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * 上传单张图片到 Misskey Drive（/api/drive/files/create），返回 fileId
 * （从原 Journal-Sync 项目的 uploadImageToMissky 迁移，改用 Obsidian requestUrl + Vault ArrayBuffer）
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
        body: body.buffer.slice(0, totalLength),
        throw: false
    });

    if (response.status < 200 || response.status >= 300) {
        return null;
    }
    const result = response.json || {};
    return result.id || null;
}

/**
 * @param {object} payload
 * @param {string} payload.content
 * @param {string} payload.serverUrl
 * @param {string} payload.apiToken
 * @param {string} [payload.visibility]
 * @param {Function} payload.requestUrl
 * @param {string[]} [payload.images] - 需要附带的本地图片文件名列表
 * @param {Function} [payload.readImageFile] - 按文件名读取 Vault 图片为 ArrayBuffer
 */
export async function execute({ content, serverUrl, apiToken, visibility = 'public', requestUrl, images = [], readImageFile }) {
    if (!serverUrl || !apiToken) {
        return { success: false, error: 'Misskey 实例地址或 API Token 未配置' };
    }

    const normalizedContent = String(content || '').trim();
    // 清理正文中的 Markdown / Obsidian 图片引用，避免发布残留语法
    const textContent = normalizedContent
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/!\[\[[^\]]+\]\]/g, '')
        .trim();

    const baseUrl = String(serverUrl).trim().replace(/\/+$/, '');
    const warnings = [];

    try {
        // 先上传图片到 Drive，拿到 fileIds 后再发动态
        const fileIds = [];
        const imageList = Array.isArray(images) ? images.filter(Boolean) : [];
        for (const filename of imageList) {
            try {
                const buffer = typeof readImageFile === 'function' ? await readImageFile(filename) : null;
                if (!buffer) {
                    warnings.push(`图片读取失败，已跳过：${filename}`);
                    continue;
                }
                const fileId = await uploadImageToMissky(buffer, filename, baseUrl, apiToken, requestUrl);
                if (fileId) {
                    fileIds.push(fileId);
                } else {
                    warnings.push(`图片上传失败，已跳过：${filename}`);
                }
            } catch (error) {
                warnings.push(`图片处理失败，已跳过：${filename}`);
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

export default { manifest, execute };
