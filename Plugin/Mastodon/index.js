import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CORE_CONFIG_FILE = path.join(__dirname, '../../data/config.json');

let configCache = null;
const defaultConfig = { instanceUrl: '', accessToken: '', visibility: 'unlisted' };

export const manifest = {
    id: 'mastodon',
    version: '1.0.0',
    name: 'Mastodon',
    description: '同步内容到 Mastodon',
    category: 'diary-sync',
    enabledByDefault: false,
    settings: {
        storage: 'plugin',
        sections: [
            {
                id: 'basic',
                title: '基础配置',
                fields: [
                    {
                        key: 'instanceUrl',
                        type: 'text',
                        label: '实例地址',
                        required: true,
                        validate: {
                            pattern: '^https?://.+',
                            message: '实例地址必须以 http:// 或 https:// 开头'
                        },
                        placeholder: 'https://mastodon.social'
                    },
                    {
                        key: 'accessToken',
                        type: 'password',
                        label: 'Access Token',
                        required: true,
                        sensitive: true,
                        validate: {
                            minLength: 10,
                            message: 'Access Token 不能为空'
                        },
                        placeholder: '输入 Access Token'
                    },
                    {
                        key: 'visibility',
                        type: 'select',
                        label: '帖子可见性',
                        default: 'unlisted',
                        options: [
                            { label: '公开', value: 'public' },
                            { label: '不公开', value: 'unlisted' },
                            { label: '仅关注者', value: 'private' },
                            { label: '仅提及对象', value: 'direct' }
                        ]
                    }
                ]
            }
        ],
        actions: [
            {
                id: 'testConnection',
                label: '测试连通性',
                kind: 'test'
            }
        ]
    },
    capabilities: {
        execute: true,
        configure: true,
        test: true
    }
};

async function loadLegacyConfig() {
    try {
        const raw = await fs.readFile(CORE_CONFIG_FILE, 'utf-8');
        const coreConfig = JSON.parse(raw);
        const diary = coreConfig?.diary || {};
        return {
            instanceUrl: diary.mastodonInstanceUrl || '',
            accessToken: diary.mastodonAccessToken || '',
            visibility: diary.mastodonVisibility || defaultConfig.visibility
        };
    } catch (error) {
        return {};
    }
}

export async function loadConfig() {
    if (configCache) return configCache;
    const legacyConfig = await loadLegacyConfig();
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        configCache = {
            ...defaultConfig,
            ...legacyConfig,
            ...JSON.parse(data)
        };
        return configCache;
    } catch (error) {
        console.error('[Mastodon Plugin] 配置文件读取失败:', error.message);
        configCache = {
            ...defaultConfig,
            ...legacyConfig
        };
        return configCache;
    }
}

export async function saveConfig(config) {
    configCache = config;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function runAction(actionId, payload = {}) {
    if (actionId !== 'testConnection') {
        throw new Error(`Unknown action: ${actionId}`);
    }

    const currentConfig = await loadConfig();
    const nextConfig = { ...currentConfig, ...(payload.config || {}) };

    if (!nextConfig.instanceUrl || !nextConfig.accessToken) {
        return { success: false, error: '实例地址和 Access Token 不能为空' };
    }

    const url = new URL('/api/v1/accounts/verify_credentials', nextConfig.instanceUrl).href;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${nextConfig.accessToken}`
        }
    });

    if (!response.ok) {
        const result = await response.json().catch(async () => ({ error: await response.text() }));
        return {
            success: false,
            error: result.error || '验证失败'
        };
    }

    const data = await response.json();
    return {
        success: true,
        message: `连接成功: ${data.display_name || data.username}`,
        data: {
            username: data.username,
            displayName: data.display_name
        }
    };
}

/**
 * 上传单张图片到 Mastodon，返回 media_id
 * @param {string} imagePath - 图片绝对路径
 * @param {object} config - Mastodon 配置
 * @returns {string|null} media_id 或 null（失败时）
 */
async function uploadImageToMastodon(imagePath, config) {
    try {
        const fileBuffer = await fs.readFile(imagePath);
        const filename = path.basename(imagePath);

        // 简单通过扩展名判断 MIME 类型
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png', '.gif': 'image/gif',
            '.webp': 'image/webp', '.heic': 'image/heic'
        };
        const mimeType = mimeTypes[ext] || 'image/jpeg';

        // 构造 multipart/form-data（手动拼接，避免额外依赖）
        const boundary = `----FormBoundary${Date.now()}`;
        const CRLF = '\r\n';
        const head = Buffer.from(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
            `Content-Type: ${mimeType}${CRLF}${CRLF}`
        );
        const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
        const body = Buffer.concat([head, fileBuffer, tail]);

        const mediaUrl = new URL('/api/v1/media', config.instanceUrl).href;
        const response = await fetch(mediaUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.accessToken}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length.toString()
            },
            body
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Mastodon Plugin] 图片上传失败 (${filename}):`, errText);
            return null;
        }

        const result = await response.json();
        console.log(`[Mastodon Plugin] 图片上传成功 (${filename}): media_id=${result.id}`);
        return result.id;
    } catch (error) {
        console.error(`[Mastodon Plugin] 图片上传异常 (${imagePath}):`, error.message);
        return null;
    }
}

export async function execute({ content, options, images = [] }) {
    const config = await loadConfig();

    if (!config.instanceUrl || !config.accessToken) {
        return { success: false, error: 'Mastodon 插件未配置 (Instance URL 或 Access Token 缺失)' };
    }

    try {
        const url = new URL('/api/v1/statuses', config.instanceUrl).href;
        const visibility = config.visibility || 'unlisted';

        // 去掉正文中的图片 Markdown 引用，避免与实际上传的图片重复
        const textContent = content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();

        // 上传图片（最多 4 张，Mastodon 限制）
        let mediaIds = [];
        if (images.length > 0) {
            const toUpload = images.slice(0, 4);
            if (images.length > 4) {
                console.warn(`[Mastodon Plugin] 图片数量 ${images.length} 超过4张限制，仅发送前4张`);
            }
            const uploaded = await Promise.all(
                toUpload.map(imgPath => uploadImageToMastodon(imgPath, config))
            );
            mediaIds = uploaded.filter(id => id !== null);
        }

        const requestBody = {
            status: textContent || '📷',  // 若内容仅图片，给个默认占位
            visibility
        };
        if (mediaIds.length > 0) {
            requestBody.media_ids = mediaIds;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.accessToken}`
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        if (!response.ok) {
            return { success: false, error: result.error || 'Mastodon 发布失败' };
        }

        return { success: true, response: result, mediaCount: mediaIds.length };
    } catch (error) {
        console.error('[Mastodon Plugin] 发送失败:', error);
        return { success: false, error: error.message };
    }
}

export default {
    manifest,
    execute,
    loadConfig,
    saveConfig,
    runAction
};
