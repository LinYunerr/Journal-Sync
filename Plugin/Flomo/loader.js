import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_CONFIG_FILE = path.join(__dirname, 'config.json');

/**
 * 加载 Flomo 插件配置
 */
export async function loadFlomoConfig() {
  try {
    const data = await fs.readFile(PLUGIN_CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);

    return {
      apiUrl: config.apiUrl
    };
  } catch (error) {
    console.error('[Flomo Plugin] 加载配置失败:', error.message);
    return null;
  }
}

/**
 * 保存 Flomo 插件配置
 */
export async function saveFlomoConfig(config) {
  try {
    await fs.writeFile(PLUGIN_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('[Flomo Plugin] 保存配置失败:', error.message);
    return { success: false, error: error.message };
  }
}

export default {
  loadFlomoConfig,
  saveFlomoConfig
};
