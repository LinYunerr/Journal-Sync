import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Mem0Client from './mem0_client.js';

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
        console.error('[Mem0 Plugin] 配置找不到:', error.message);
        return null;
    }
}

export async function saveConfig(config) {
    configCache = config;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function execute({ content, type }) {
    // Mem0 目前主要是针对日记模式同步
    if (type !== 'diary') {
        return { success: false, skipped: true, message: '仅支持 diary 类型' };
    }

    const config = await loadConfig();
    if (!config) {
        return { success: false, error: 'Mem0 配置未找到' };
    }

    try {
        const client = new Mem0Client(config);
        const today = new Date().toISOString().split('T')[0];

        // 存储记忆
        const mem0Result = await client.storeMemory(content, {
            type: 'diary',
            date: today
        });

        // 提取书影音等 insights
        await client.updateInsights(content, {
            type: 'diary',
            date: today
        });

        return {
            success: mem0Result.success,
            tasks: mem0Result.tasks || [],
            tags: mem0Result.memory?.tags || [],
            entities: mem0Result.memory?.entities || [],
            error: mem0Result.error
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export default {
    execute,
    loadConfig,
    saveConfig
};
