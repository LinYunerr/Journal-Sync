/**
 * Mastodon 适配器
 * 通过 Obsidian requestUrl 直接发送到 Mastodon 实例
 */

export const manifest = {
    id: 'mastodon',
    version: '1.0.0',
    name: 'Mastodon',
    description: '发布内容到 Mastodon',
    enabledByDefault: false,
    settings: {
        fields: [
            {
                key: 'serverUrl',
                type: 'text',
                label: 'Mastodon 实例地址',
                required: true,
                placeholder: 'https://mastodon.social'
            },
            {
                key: 'accessToken',
                type: 'password',
                label: 'Access Token',
                required: true,
                placeholder: '你的 Mastodon Access Token'
            },
            {
                key: 'visibility',
                type: 'select',
                label: '可见性',
                options: [
                    { value: 'public', label: '公开' },
                    { value: 'unlisted', label: '不列出' },
                    { value: 'private', label: '仅关注者' },
                    { value: 'direct', label: '私信' }
                ],
                default: 'public'
            }
        ]
    }
};

const MAX_MASTODON_IMAGES = 4;

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
 * 上传单张图片到 Mastodon /api/v1/media，返回 media_id
 * （从原 Journal-Sync 项目的 uploadImageToMastodon 迁移，改用 Obsidian requestUrl + Vault ArrayBuffer）
 */
async function uploadImageToMastodon(arrayBuffer, filename, baseUrl, accessToken, requestUrl) {
    const safeFilename = String(filename || 'image').replace(/["\r\n]/g, '_');
    const mimeType = getMimeType(filename);
    const boundary = `----MastodonBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;

    const encoder = new TextEncoder();
    const parts = [];
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
        url: `${baseUrl}/api/v1/media`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        // requestUrl accepts string or ArrayBuffer; pass the exact binary range.
        body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        throw: false
    });

    let result = {};
    try { result = response.json || {}; } catch {}
    if (response.status < 200 || response.status >= 300) {
        const message = result.error || result.description || response.text || `HTTP ${response.status}`;
        return { id: null, error: String(message).trim() || `HTTP ${response.status}` };
    }

    if (!result.id) {
        return { id: null, error: 'Mastodon 未返回媒体 ID' };
    }
    return { id: result.id, error: '' };
}

/**
 * @param {object} payload
 * @param {string} payload.content
 * @param {string} payload.serverUrl
 * @param {string} payload.accessToken
 * @param {string} [payload.visibility]
 * @param {Function} payload.requestUrl
 * @param {string[]} [payload.images] - 需要附带的本地图片文件名列表
 * @param {Function} [payload.readImageFile] - 按文件名读取 Vault 图片为 ArrayBuffer
 */
export async function execute({ content, serverUrl, accessToken, visibility = 'public', requestUrl, images = [], readImageFile }) {
    if (!serverUrl || !accessToken) {
        return { success: false, error: 'Mastodon 实例地址或 Access Token 未配置' };
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
        // 先上传图片，拿到 media_ids 后再发帖（Mastodon 单条最多 4 张）
        const mediaIds = [];
        const imageList = Array.isArray(images) ? images.filter(Boolean) : [];
        if (imageList.length > MAX_MASTODON_IMAGES) {
            return {
                success: false,
                error: `Mastodon 单条最多支持 ${MAX_MASTODON_IMAGES} 张图片，本次选择了 ${imageList.length} 张；未发送任何内容。`
            };
        }

        for (const filename of imageList) {
            try {
                const buffer = typeof readImageFile === 'function' ? await readImageFile(filename) : null;
                if (!buffer) {
                    return { success: false, error: `图片读取失败：${filename}；未发送任何内容。` };
                }
                const uploadResult = await uploadImageToMastodon(buffer, filename, baseUrl, accessToken, requestUrl);
                if (!uploadResult.id) {
                    return {
                        success: false,
                        error: `图片上传失败：${filename}${uploadResult.error ? `（${uploadResult.error}）` : ''}；未发送任何内容。`
                    };
                }
                mediaIds.push(uploadResult.id);
            } catch (error) {
                return { success: false, error: `图片处理失败：${filename}（${error.message || String(error)}）；未发送任何内容。` };
            }
        }

        if (!textContent && mediaIds.length === 0) {
            return { success: false, error: '内容不能为空' };
        }

        const response = await requestUrl({
            url: `${baseUrl}/api/v1/statuses`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: textContent || '📷',
                visibility,
                ...(mediaIds.length > 0 ? { media_ids: mediaIds } : {})
            }),
            throw: false
        });

        if (response.status >= 200 && response.status < 300) {
            let result = {};
            try { result = response.json; } catch {}
            return { success: true, url: result.url || '', mediaCount: mediaIds.length, warnings };
        } else {
            let errMsg = '';
            try { errMsg = response.json?.error || response.text || `HTTP ${response.status}`; } catch { errMsg = `HTTP ${response.status}`; }
            return { success: false, error: errMsg, warnings };
        }
    } catch (error) {
        return { success: false, error: error.message, warnings };
    }
}

export default { manifest, execute };
