import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_CONFIG_FILE = path.join(__dirname, 'config.json');

/**
 * 加载 Mem0 插件配置
 */
export async function loadMem0Config() {
  try {
    const data = await fs.readFile(PLUGIN_CONFIG_FILE, 'utf-8');
    const config = JSON.parse(data);

    return {
      llm: config.llm || {},
      vectorStore: config.vector_store || {},
      version: config.version || 'v1.1'
    };
  } catch (error) {
    console.error('[Mem0 Plugin] 加载配置失败:', error.message);
    return null;
  }
}

/**
 * 保存 Mem0 插件配置
 */
export async function saveMem0Config(config) {
  try {
    const fullConfig = {
      llm: config.llm || {},
      vector_store: config.vectorStore || config.vector_store || {},
      version: config.version || 'v1.1'
    };

    await fs.writeFile(PLUGIN_CONFIG_FILE, JSON.stringify(fullConfig, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('[Mem0 Plugin] 保存配置失败:', error.message);
    return { success: false, error: error.message };
  }
}

export default {
  loadMem0Config,
  saveMem0Config
};
