import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGINS_DIR = path.join(__dirname, '../../Plugin');

// Plugin registry
const plugins = {};

/**
 * 自动发现并加载所有的插件
 */
export async function loadPlugins() {
    try {
        const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                const pluginName = entry.name.toLowerCase();
                const indexPath = path.join(PLUGINS_DIR, entry.name, 'index.js');

                try {
                    await fs.access(indexPath);
                    const pluginModule = await import(indexPath);

                    if (pluginModule.default) {
                        plugins[pluginName] = {
                            name: entry.name,
                            module: pluginModule.default
                        };
                        console.log(`[PluginManager] 已加载插件: ${entry.name}`);
                    }
                } catch (err) {
                    // 不存在 index.js 或者加载失败（旧版插件忽略处理直到重构完毕）
                    console.warn(`[PluginManager] 跳过目录 或没找到正确的 index.js: ${entry.name}`);
                }
            }
        }

        return plugins;
    } catch (error) {
        console.error('[PluginManager] 加载插件目录失败:', error);
        return {};
    }
}

/**
 * 获取所有的已加载插件
 */
export function getLoadedPlugins() {
    return plugins;
}

/**
 * 执行启用的插件
 * @param {string} content - 待同步的文本或 JSON 内容
 * @param {string} type - 'diary' 或 'note'
 * @param {object} options - 前端传来的控制参数
 * @param {object} coreConfig - 主控制参数（启用了哪些插件等）
 * @param {function} onUpdate - 用于 SSE 实时流式响应的回调 (pluginName, isSuccess) => {}
 * @param {string[]} images - 从 content 中提取的图片绝对路径列表（可选）
 */
export async function executePlugins(content, type, options, coreConfig, onUpdate, images = []) {
    const pluginSettings = coreConfig?.plugins || {};
    const promises = [];
    const results = {};

    // 用于收集 MemU 之类的推荐或依赖结果
    let context = {
        content,
        type,
        options,
        images,       // 图片绝对路径列表，插件可按需使用
        suggestion: null
    };

    // 按照插件的优先级排序（例如 memu 需要在 telegram 之前执行以提供建议）
    // 简易依赖解决机制：MemU -> Telegram -> 其他
    const loadedKeys = Object.keys(plugins);
    loadedKeys.sort((a, b) => {
        if (a === 'memu') return -1;
        if (b === 'memu') return 1;
        if (a === 'telegram-send') return 1;
        if (b === 'telegram-send') return -1;
        return 0;
    });

    // 1. 顺序执行具备依赖属性的插件 (比如 MemU 可能生成供 Telegram 使用的 suggestion)
    for (const key of loadedKeys) {
        // 检查核心配置是否启用了此插件 (支持 telegram-send 对应 telegram)
        let configKey = key;
        if (key === 'telegram-send' || key === 'telegram') configKey = 'telegram';

        const isEnabled = pluginSettings[configKey] !== false;
        let shouldExecute = isEnabled;

        // 如果属于前端控制的屏蔽，则跳过
        if (key === 'flomo' && options.enableFlomo === false) shouldExecute = false;
        if (key === 'mastodon' && options.enableMastodon === false) shouldExecute = false;
        if (key === 'telegram' && !options.sendToTelegram) shouldExecute = false;
        if (key === 'telegram-send' && !options.sendToTelegram) shouldExecute = false;

        // Mem0 默认只有日记模式才会执行
        if (key === 'mem0' && type !== 'diary') shouldExecute = false;

        if (shouldExecute) {
            const plugin = plugins[key];
            try {
                const result = await plugin.module.execute(context);
                results[key] = result;

                // 如果插件吐出了 suggestion，注入到 context 以供后续的插件（如 Telegram）使用
                if (result.suggestion) {
                    context.suggestion = result.suggestion;
                }

                if (onUpdate) onUpdate(configKey, result.success);
            } catch (error) {
                console.error(`[PluginManager] 执行插件 ${plugin.name} 时挂掉:`, error);
                results[key] = { success: false, error: error.message };
                if (onUpdate) onUpdate(configKey, false);
            }
        } else {
            results[key] = { success: false, skipped: true };
        }
    }

    return results;
}

export default {
    loadPlugins,
    getLoadedPlugins,
    executePlugins
};
