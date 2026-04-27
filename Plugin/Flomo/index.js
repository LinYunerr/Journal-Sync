import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CORE_CONFIG_FILE = path.join(__dirname, '../../data/config.json');
const MAX_FLOMO_IMAGES = 9;

let configCache = null;
const defaultConfig = { apiUrl: '' };

export const manifest = {
    id: 'flomo',
    version: '1.0.0',
    name: 'flomo',
    description: '同步内容到 flomo',
    category: 'diary-sync',
    enabledByDefault: true,
    ui: {
        homeV2: {
            section: 'publish_simple',
            order: 10,
            label: 'Flomo'
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
                        key: 'apiUrl',
                        type: 'password',
                        label: 'flomo API Webhook',
                        required: true,
                        sensitive: true,
                        validate: {
                            pattern: '^https?://.+',
                            message: 'flomo API Webhook 必须以 http:// 或 https:// 开头'
                        },
                        placeholder: 'https://flomoapp.com/iwh/...'
                    }
                ]
            }
        ],
        actions: []
    },
    capabilities: {
        execute: true,
        configure: true,
        test: false,
        media: {
            acceptsImages: true,
            acceptsInputImages: false,
            mode: 'public_urls',
            maxImages: MAX_FLOMO_IMAGES,
            summary: '官方支持 image_urls，但必须是公网可访问图片 URL',
            withImagesSummary: '会接收当前输入图片，但本地拖拽/粘贴图片无法直接传给 flomo',
            withImagesNote: '若没有公网 URL，发布时只会发送文字内容，并返回提示。'
        }
    }
};

function extractRemoteImageUrls(content) {
    // flomo Webhook 只接收公网可访问的 image_urls；本地拖拽或粘贴的图片不会直传。
    // 因此这里只从正文提取公网图片 URL，并截取前 MAX_FLOMO_IMAGES 张提交。
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

async function loadLegacyConfig() {
    try {
        const raw = await fs.readFile(CORE_CONFIG_FILE, 'utf-8');
        const coreConfig = JSON.parse(raw);
        return {
            apiUrl: coreConfig?.diary?.flomoApi || ''
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
        if (error.code !== 'ENOENT') {
            console.error('[Flomo Plugin] 配置读取失败:', error.message);
        }
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

export async function execute({ content, images = [] }) {
    const config = await loadConfig();
    const normalizedContent = String(content || '');
    const imageList = Array.isArray(images) ? images : [];

    if (!config.apiUrl) {
        return { success: false, error: 'Flomo API URL 未配置' };
    }

    // 过滤掉 Markdown 图片引用（flomo 不支持图片上传）
    const textContent = normalizedContent.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();
    const warnings = [];
    const imageUrls = extractRemoteImageUrls(normalizedContent);

    if (imageList.length > 0) {
        warnings.push('flomo 官方只接受公网 image_urls，本地拖拽/粘贴图片未随请求发送');
    }

    if (!textContent && imageUrls.length === 0) {
        return { success: true, skipped: true, message: '没有可发送到 flomo 的文本或公网图片 URL', warnings };
    }

    if (!textContent && imageUrls.length > 0) {
        warnings.push('当前仅发送图片 URL，未包含正文');
    }

    try {
        const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...(textContent ? { content: textContent } : {}),
                ...(imageUrls.length > 0 ? { image_urls: imageUrls.slice(0, MAX_FLOMO_IMAGES) } : {})
            })
        });

        const result = await response.json();
        return {
            success: result.code === 0,
            response: result,
            warnings,
            imageUrlCount: imageUrls.length
        };
    } catch (error) {
        return { success: false, error: error.message, warnings };
    }
}

export default {
    manifest,
    execute,
    loadConfig,
    saveConfig
};
