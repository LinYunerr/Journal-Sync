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
        console.error('[Flomo Plugin] 配置找不到:', error.message);
        return { apiUrl: '' };
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

    try {
        const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });

        const result = await response.json();
        return { success: result.code === 0, response: result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export default {
    execute,
    loadConfig,
    saveConfig
};
