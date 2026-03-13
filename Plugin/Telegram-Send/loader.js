import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_SCRIPT_PATH = path.join(__dirname, 'telegram_send.py');

/**
 * 加载 Telegram 插件配置
 */
export async function loadTelegramConfig() {
  try {
    const data = await fs.readFile(PLUGIN_CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);

    return {
      botToken: config.botToken,
      channels: config.channels || [],
      defaultChannel: config.defaultChannel,
      optimizePrompt: config.optimizePrompt,
      scriptPath: DEFAULT_SCRIPT_PATH
    };
  } catch (error) {
    console.error('[Telegram Plugin] 加载配置失败:', error.message);
    return null;
  }
}

/**
 * 保存 Telegram 插件配置
 */
export async function saveTelegramConfig(config) {
  try {
    await fs.writeFile(PLUGIN_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('[Telegram Plugin] 保存配置失败:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 获取频道列表
 */
export async function getChannels() {
  try {
    const config = await loadTelegramConfig();
    return config?.channels || [];
  } catch (error) {
    console.error('[Telegram Plugin] 获取频道列表失败:', error.message);
    return [];
  }
}

/**
 * 更新频道列表
 */
export async function updateChannels(channels) {
  try {
    const config = await loadTelegramConfig();
    if (!config) {
      return { success: false, error: '配置文件不存在' };
    }

    config.channels = channels;
    return await saveTelegramConfig(config);
  } catch (error) {
    console.error('[Telegram Plugin] 更新频道列表失败:', error.message);
    return { success: false, error: error.message };
  }
}

export default {
  loadTelegramConfig,
  saveTelegramConfig,
  getChannels,
  updateChannels
};
