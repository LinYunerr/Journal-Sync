import { promises as fs } from 'fs';
import path from 'path';
import { getDataPath } from './app-paths.js';

const CONFIG_FILE = getDataPath('config.json');

// Memory cache for config
let cachedConfig = null;
let lastModified = 0;

/**
 * 加载核心配置 (附带内存缓存及热重载机制)
 */
export async function loadConfig(forceReload = false) {
    try {
        const stats = await fs.stat(CONFIG_FILE).catch(() => null);

        // 如果文件不存在，返回空或初始配置
        if (!stats) {
            return {
                obsidianPath: process.env.JOURNAL_SYNC_OBSIDIAN_PATH || '',
                plugins: {}
            };
        }

        // 如果未要求强制重载且缓存依然是最新的，直接返回
        if (!forceReload && cachedConfig && stats.mtimeMs <= lastModified) {
            return cachedConfig;
        }

        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        cachedConfig = JSON.parse(data);
        lastModified = stats.mtimeMs;

        return cachedConfig;
    } catch (error) {
        console.error('[ConfigManager] 加载配置失败:', error);
        return cachedConfig || {}; // 若解析失败，退回到上一次有效的缓存
    }
}

/**
 * 保存核心配置
 */
export async function saveConfig(config) {
    try {
        const data = JSON.stringify(config, null, 2);
        await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
        await fs.writeFile(CONFIG_FILE, data, 'utf-8');

        // 更新缓存
        cachedConfig = config;
        const stats = await fs.stat(CONFIG_FILE).catch(() => null);
        if (stats) {
            lastModified = stats.mtimeMs;
        }
        return true;
    } catch (error) {
        console.error('[ConfigManager] 保存配置失败:', error);
        throw error;
    }
}

export default {
    loadConfig,
    saveConfig
};
