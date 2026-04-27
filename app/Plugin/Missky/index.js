import { promises as fs } from 'fs';
import path from 'path';
import { getPluginConfigPath } from '../../src/utils/app-paths.js';

const CONFIG_FILE = getPluginConfigPath('missky');

let configCache = null;
const defaultConfig = {
    instanceUrl: '',
    apiKey: '',
    visibility: 'public',
    localOnly: false
};

export const manifest = {
    id: 'missky',
    version: '1.0.0',
    name: 'Missky',
    description: '同步内容到 Misskey 实例',
    category: 'diary-sync',
    enabledByDefault: false,
    ui: {
        homeV2: {
            section: 'publish_simple',
            order: 30,
            label: 'Missky'
        }
    },
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
                        placeholder: 'https://misskey.io'
                    },
                    {
                        key: 'apiKey',
                        type: 'password',
                        label: 'API Token',
                        required: true,
                        sensitive: true,
                        validate: {
                            minLength: 10,
                            message: 'API Token 不能为空'
                        },
                        placeholder: '输入 Misskey API Token'
                    },
                    {
                        key: 'visibility',
                        type: 'select',
                        label: '帖子可见性',
                        default: 'public',
                        options: [
                            { label: '公开', value: 'public' },
                            { label: '首页（home）', value: 'home' },
                            { label: '仅关注者', value: 'followers' },
                            { label: '指定用户', value: 'specified' }
                        ]
                    },
                    {
                        key: 'localOnly',
                        type: 'boolean',
                        label: '仅在本实例可见（localOnly）',
                        default: false
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
        test: true,
        media: {
            acceptsImages: true,
            acceptsInputImages: true,
            mode: 'upload',
            maxImages: 9,
            summary: '会先上传到 Drive，再用 fileIds 绑定到 note',
            withImagesSummary: '当前会上传图片到 Misskey Drive 并附在动态里',
            withImagesNote: '逻辑与 CMX 一致，先传图再发帖。'
        }
    }
};

function removeMarkdownImageRefs(content) {
    return String(content || '').replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();
}

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.heic': 'image/heic'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

function getErrorMessage(result, fallback) {
    if (!result) return fallback;
    if (typeof result.error === 'string') return result.error;
    if (typeof result.message === 'string') return result.message;
    if (typeof result.error?.message === 'string') return result.error.message;
    return fallback;
}

async function parseResponseBody(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json().catch(() => null);
    }
    return response.text().catch(() => null);
}

async function uploadImageToMissky(imagePath, config) {
    try {
        const fileBuffer = await fs.readFile(imagePath);
        const filename = path.basename(imagePath);
        const mimeType = getMimeType(filename);

        const formData = new FormData();
        formData.append('i', config.apiKey);
        formData.append('file', new Blob([fileBuffer], { type: mimeType }), filename);

        const url = new URL('/api/drive/files/create', config.instanceUrl).href;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.apiKey}`
            },
            body: formData
        });

        const result = await parseResponseBody(response);
        if (!response.ok) {
            console.error('[Missky Plugin] 图片上传失败:', getErrorMessage(result, `HTTP ${response.status}`));
            return null;
        }

        return result?.id || null;
    } catch (error) {
        console.error(`[Missky Plugin] 图片上传异常 (${imagePath}):`, error.message);
        return null;
    }
}

export async function loadConfig() {
    if (configCache) return configCache;
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        configCache = {
            ...defaultConfig,
            ...JSON.parse(data)
        };
        return configCache;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('[Missky Plugin] 配置文件读取失败:', error.message);
        }
        configCache = { ...defaultConfig };
        return configCache;
    }
}

export async function saveConfig(config) {
    configCache = config;
    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function runAction(actionId, payload = {}) {
    if (actionId !== 'testConnection') {
        throw new Error(`Unknown action: ${actionId}`);
    }

    const currentConfig = await loadConfig();
    const nextConfig = { ...currentConfig, ...(payload.config || {}) };

    if (!nextConfig.instanceUrl || !nextConfig.apiKey) {
        return { success: false, error: '实例地址和 API Token 不能为空' };
    }

    const url = new URL('/api/i', nextConfig.instanceUrl).href;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${nextConfig.apiKey}`
        },
        body: JSON.stringify({ i: nextConfig.apiKey })
    });
    const result = await parseResponseBody(response);

    if (!response.ok) {
        return {
            success: false,
            error: getErrorMessage(result, `验证失败 (HTTP ${response.status})`)
        };
    }

    return {
        success: true,
        message: `连接成功: ${result?.name || result?.username || result?.id || 'Misskey'}`,
        data: {
            id: result?.id,
            username: result?.username,
            name: result?.name
        }
    };
}

export async function execute({ content, images = [] }) {
    const config = await loadConfig();

    if (!config.instanceUrl || !config.apiKey) {
        return { success: false, error: 'Missky 插件未配置 (Instance URL 或 API Token 缺失)' };
    }

    try {
        const textContent = removeMarkdownImageRefs(content);
        const imageList = Array.isArray(images) ? images : [];
        const fileIds = [];

        if (imageList.length > 0) {
            // 按当前图片顺序先上传到 Misskey Drive，拿到 fileIds 后再创建 note。
            // 主页输入层最多传入 9 张图，整体链路与 CMX 一样都是先传图再发帖。
            const uploaded = await Promise.all(imageList.map(imagePath => uploadImageToMissky(imagePath, config)));
            for (const id of uploaded) {
                if (id) fileIds.push(id);
            }
        }

        if (!textContent && fileIds.length === 0) {
            return { success: false, error: '发送内容为空' };
        }

        const requestBody = {
            i: config.apiKey,
            visibility: config.visibility || 'public',
            localOnly: Boolean(config.localOnly)
        };

        if (textContent) requestBody.text = textContent;
        if (fileIds.length > 0) requestBody.fileIds = fileIds;

        const url = new URL('/api/notes/create', config.instanceUrl).href;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        const result = await parseResponseBody(response);
        if (!response.ok) {
            return {
                success: false,
                error: getErrorMessage(result, `Misskey 发布失败 (HTTP ${response.status})`)
            };
        }

        return {
            success: true,
            response: result,
            mediaCount: fileIds.length
        };
    } catch (error) {
        console.error('[Missky Plugin] 发送失败:', error);
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
