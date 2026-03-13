import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');

let configCache = null;

export async function loadConfig() {
    if (configCache) return configCache;
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        configCache = JSON.parse(data);
        return configCache;
    } catch (error) {
        console.error('[Mastodon Plugin] 配置文件读取失败:', error.message);
        return { instanceUrl: '', accessToken: '', visibility: 'unlisted' };
    }
}

export async function saveConfig(config) {
    configCache = config;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function execute({ content, options }) {
    const config = await loadConfig();

    if (!config.instanceUrl || !config.accessToken) {
        return { success: false, error: 'Mastodon 插件未配置 (Instance URL 或 Access Token 缺失)' };
    }

    try {
        const url = new URL('/api/v1/statuses', config.instanceUrl).href;
        const visibility = config.visibility || 'unlisted';

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.accessToken}`
            },
            body: JSON.stringify({
                status: content,
                visibility: visibility
            })
        });

        const result = await response.json();

        if (!response.ok) {
            return { success: false, error: result.error || 'Mastodon 发布失败' };
        }

        return { success: true, response: result };
    } catch (error) {
        console.error('[Mastodon Plugin] 发送失败:', error);
        return { success: false, error: error.message };
    }
}

export default {
    execute,
    loadConfig,
    saveConfig
};
