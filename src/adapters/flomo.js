/**
 * Flomo 适配器
 * 通过 Obsidian requestUrl 直接发送到 flomo Webhook
 * 无需后端服务、无文件系统依赖
 */

const MAX_FLOMO_IMAGES = 9;

export const manifest = {
    id: 'flomo',
    version: '1.0.0',
    name: 'Flomo',
    description: '同步内容到 flomo',
    enabledByDefault: true,
    settings: {
        fields: [
            {
                key: 'apiUrl',
                type: 'password',
                label: 'Flomo API Webhook',
                required: true,
                placeholder: 'https://flomoapp.com/iwh/...'
            }
        ]
    }
};

function extractRemoteImageUrls(content) {
    const urls = [];
    const markdownMatches = String(content || '').match(/!\[[^\]]*]\((https?:\/\/[^)]+)\)/g) || [];
    const plainMatches = String(content || '').match(/https?:\/\/[^\s<>"']+/g) || [];

    for (const rawChunk of [...markdownMatches, ...plainMatches]) {
        const rawUrl = rawChunk.startsWith('![')
            ? rawChunk.replace(/^!\[[^\]]*]\((https?:\/\/[^)]+)\)$/i, '$1')
            : rawChunk;
        const normalized = String(rawUrl).replace(/[),.!?;:，。！？；：》」』】）]+$/g, '');
        if (!normalized) continue;
        if (!/^https?:\/\//i.test(normalized)) continue;
        if (!/\.(png|jpe?g|gif|webp|heic|heif)(?:$|[?#])/i.test(normalized)) continue;
        if (urls.includes(normalized)) continue;
        urls.push(normalized);
        if (urls.length >= MAX_FLOMO_IMAGES) break;
    }

    return urls;
}

export async function execute({ content, apiUrl, requestUrl }) {
    const normalizedContent = String(content || '');

    if (!apiUrl) {
        return { success: false, error: 'Flomo API URL 未配置' };
    }

    const imageUrls = extractRemoteImageUrls(normalizedContent);

    // 移除正文中的 Markdown 图片和 Obsidian 本地图片嵌入
    const textContent = normalizedContent
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/!\[\[[^\]]+\]\]/g, '')
        .trim();

    const warnings = [];

    if (!textContent && imageUrls.length === 0) {
        return { success: true, skipped: true, message: '没有可发送到 flomo 的内容', warnings };
    }

    try {
        const response = await requestUrl({
            url: apiUrl.trim(),
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...(textContent ? { content: textContent } : {}),
                ...(imageUrls.length > 0 ? { image_urls: imageUrls.slice(0, MAX_FLOMO_IMAGES) } : {})
            }),
            throw: false
        });

        let result = {};
        try {
            if (response.json) {
                result = response.json;
            } else if (response.text) {
                result = JSON.parse(response.text);
            }
        } catch {}

        if (!result || typeof result !== 'object') {
            result = {};
        }

        const isSuccess = response.status >= 200 && response.status < 300 && result.code === 0;

        return {
            success: isSuccess,
            response: result,
            error: isSuccess ? undefined : (result.message || `HTTP ${response.status}: ${response.text}`),
            warnings
        };
    } catch (error) {
        return { success: false, error: error.message, warnings };
    }
}

export default { manifest, execute };
