import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CORE_CONFIG_FILE = path.join(__dirname, '../../data/config.json');

let configCache = null;
const defaultConfig = { apiUrl: '' };

export const manifest = {
    id: 'flomo',
    version: '1.0.0',
    name: 'flomo',
    description: '同步内容到 flomo',
    category: 'diary-sync',
    enabledByDefault: true,
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
        test: false
    }
};

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
        console.error('[Flomo Plugin] 配置找不到:', error.message);
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

export async function execute({ content }) {
    const config = await loadConfig();

    if (!config.apiUrl) {
        return { success: false, error: 'Flomo API URL 未配置' };
    }

    // 过滤掉 Markdown 图片引用（flomo 不支持图片上传）
    const textContent = content.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();

    if (!textContent) {
        return { success: true, skipped: true, note: '内容仅含图片，flomo 跳过发送' };
    }

    try {
        const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: textContent })
        });

        const result = await response.json();
        return { success: result.code === 0, response: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export default {
    manifest,
    execute,
    loadConfig,
    saveConfig
};
