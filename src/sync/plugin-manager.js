import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLUGINS_DIR = path.join(__dirname, '../../Plugin');
const SENSITIVE_VALUE_MASK = '__SECRET_PRESENT__';

// Plugin registry
const plugins = {};

export class PluginValidationError extends Error {
    constructor(message, errors = []) {
        super(message);
        this.name = 'PluginValidationError';
        this.errors = errors;
    }
}

function slugifyDirectoryName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cloneValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getValueAtPath(target, keyPath) {
    if (!target || !keyPath) return undefined;
    return keyPath.split('.').reduce((current, segment) => {
        if (current == null) return undefined;
        return current[segment];
    }, target);
}

function setValueAtPath(target, keyPath, value) {
    const segments = keyPath.split('.');
    let current = target;

    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (typeof current[segment] !== 'object' || current[segment] === null || Array.isArray(current[segment])) {
            current[segment] = {};
        }
        current = current[segment];
    }

    current[segments[segments.length - 1]] = value;
}

function getManifestFields(manifest) {
    return manifest?.settings?.sections?.flatMap(section => section.fields || []) || [];
}

function isEmptyValue(value) {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

function getFieldOptions(field, config) {
    const staticOptions = Array.isArray(field.options) ? field.options : [];
    const source = field.optionsSource;
    if (!source?.path) {
        return staticOptions;
    }

    const sourceItems = getValueAtPath(config, source.path);
    if (!Array.isArray(sourceItems)) {
        return staticOptions;
    }

    const dynamicOptions = sourceItems.map(item => {
        if (typeof item !== 'object' || item === null) {
            return { value: item, label: String(item) };
        }

        const value = item[source.valueKey || 'value'];
        const label = item[source.labelKey || 'label'] ?? value;
        const caption = source.captionKey ? item[source.captionKey] : null;
        return {
            value,
            label: caption ? `${label} (${caption})` : label
        };
    });

    return [...staticOptions, ...dynamicOptions].filter(option => option?.value !== undefined);
}

function validateFieldValue(field, value, config) {
    const errors = [];
    const label = field.label || field.key;

    if (field.required && isEmptyValue(value)) {
        errors.push(`${label}不能为空`);
        return errors;
    }

    if (isEmptyValue(value)) {
        return errors;
    }

    if (field.type === 'number') {
        const numericValue = typeof value === 'number' ? value : Number(value);
        if (Number.isNaN(numericValue)) {
            errors.push(`${label}必须是数字`);
            return errors;
        }
    }

    if (field.type === 'select' && !field.allowCustomValue) {
        const optionValues = getFieldOptions(field, config).map(option => (
            typeof option === 'string' ? option : option.value
        ));
        if (optionValues.length > 0 && !optionValues.includes(value)) {
            errors.push(`${label}必须从可选项中选择`);
        }
    }

    const validate = field.validate || {};
    if (typeof value === 'string') {
        if (validate.minLength && value.length < validate.minLength) {
            errors.push(validate.message || `${label}至少需要 ${validate.minLength} 个字符`);
        }
        if (validate.maxLength && value.length > validate.maxLength) {
            errors.push(validate.message || `${label}不能超过 ${validate.maxLength} 个字符`);
        }
        if (validate.pattern) {
            const regex = new RegExp(validate.pattern);
            if (!regex.test(value)) {
                errors.push(validate.message || `${label}格式不正确`);
            }
        }
    }

    if (field.type === 'number') {
        const numericValue = typeof value === 'number' ? value : Number(value);
        if (validate.min !== undefined && numericValue < validate.min) {
            errors.push(validate.message || `${label}不能小于 ${validate.min}`);
        }
        if (validate.max !== undefined && numericValue > validate.max) {
            errors.push(validate.message || `${label}不能大于 ${validate.max}`);
        }
    }

    return errors;
}

export function validatePluginConfigData(config, manifest) {
    const errors = [];
    const normalizedConfig = cloneValue(config) || {};

    for (const field of getManifestFields(manifest)) {
        const value = getValueAtPath(normalizedConfig, field.key);
        const fieldErrors = validateFieldValue(field, value, normalizedConfig);
        for (const message of fieldErrors) {
            errors.push({ field: field.key, message });
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

export function normalizeActionResult(result = {}) {
    if (result instanceof Error) {
        return {
            success: false,
            message: result.message,
            warnings: [],
            data: {}
        };
    }

    if (typeof result !== 'object' || result === null) {
        return {
            success: true,
            message: String(result),
            warnings: [],
            data: {}
        };
    }

    const {
        success,
        message,
        error,
        warnings,
        data,
        ...rest
    } = result;

    const normalizedWarnings = Array.isArray(warnings)
        ? warnings.filter(Boolean).map(String)
        : (warnings ? [String(warnings)] : []);

    return {
        success: success ?? !error,
        message: message || error || '',
        warnings: normalizedWarnings,
        data: {
            ...(data && typeof data === 'object' ? cloneValue(data) : {}),
            ...rest
        }
    };
}

function sanitizeConfigByManifest(config, manifest) {
    const sanitized = cloneValue(config) || {};
    for (const field of getManifestFields(manifest)) {
        if (field.sensitive) {
            const currentValue = getValueAtPath(sanitized, field.key);
            setValueAtPath(
                sanitized,
                field.key,
                isEmptyValue(currentValue) ? '' : SENSITIVE_VALUE_MASK
            );
        }
    }
    return sanitized;
}

function mergeConfigByManifest(existingConfig, incomingConfig, manifest) {
    const merged = cloneValue(existingConfig) || {};
    const payload = cloneValue(incomingConfig) || {};

    for (const field of getManifestFields(manifest)) {
        const nextValue = getValueAtPath(payload, field.key);
        if (nextValue === undefined) {
            continue;
        }

        if (field.sensitive && (
            nextValue === '' ||
            nextValue === '****' ||
            nextValue === SENSITIVE_VALUE_MASK
        )) {
            continue;
        }

        setValueAtPath(merged, field.key, nextValue);
    }

    return merged;
}

function normalizeManifest(manifest, entryName) {
    const pluginId = manifest?.id || slugifyDirectoryName(entryName);
    const dependsOn = Array.isArray(manifest?.dependsOn)
        ? manifest.dependsOn.filter(item => typeof item === 'string' && item.trim())
        : [];

    return {
        id: pluginId,
        version: manifest?.version || '1.0.0',
        name: manifest?.name || entryName,
        description: manifest?.description || '',
        category: manifest?.category || 'general',
        enabledByDefault: manifest?.enabledByDefault ?? false,
        dependsOn,
        capabilities: {
            execute: manifest?.capabilities?.execute ?? true,
            configure: manifest?.capabilities?.configure ?? true,
            test: manifest?.capabilities?.test ?? Boolean(manifest?.settings?.actions?.length),
            ...(manifest?.capabilities || {})
        },
        settings: {
            storage: manifest?.settings?.storage || 'plugin',
            sections: manifest?.settings?.sections || [],
            actions: manifest?.settings?.actions || []
        }
    };
}

function getLegacyExecutionPriority(pluginId) {
    if (pluginId === 'memu') return -10;
    if (pluginId === 'telegram') return 10;
    return 0;
}

export function resolvePluginExecutionOrder(pluginEntries) {
    const indegree = new Map();
    const edges = new Map();
    const allIds = new Set(pluginEntries.map(([id]) => id));

    for (const [pluginId] of pluginEntries) {
        indegree.set(pluginId, 0);
        edges.set(pluginId, new Set());
    }

    for (const [pluginId, plugin] of pluginEntries) {
        const dependencies = Array.isArray(plugin?.manifest?.dependsOn) ? plugin.manifest.dependsOn : [];
        for (const dependency of dependencies) {
            if (!allIds.has(dependency) || dependency === pluginId) continue;
            if (!edges.get(dependency).has(pluginId)) {
                edges.get(dependency).add(pluginId);
                indegree.set(pluginId, indegree.get(pluginId) + 1);
            }
        }
    }

    const ordered = [];
    const available = pluginEntries
        .filter(([id]) => indegree.get(id) === 0)
        .map(([id]) => id);

    const sortAvailable = () => {
        available.sort((a, b) => {
            const diff = getLegacyExecutionPriority(a) - getLegacyExecutionPriority(b);
            if (diff !== 0) return diff;
            return a.localeCompare(b);
        });
    };
    sortAvailable();

    while (available.length > 0) {
        const current = available.shift();
        ordered.push(current);
        for (const next of edges.get(current)) {
            indegree.set(next, indegree.get(next) - 1);
            if (indegree.get(next) === 0) {
                available.push(next);
                sortAvailable();
            }
        }
    }

    if (ordered.length !== pluginEntries.length) {
        const fallback = pluginEntries.map(([id]) => id);
        fallback.sort((a, b) => getLegacyExecutionPriority(a) - getLegacyExecutionPriority(b));
        return fallback;
    }
    return ordered;
}

/**
 * 自动发现并加载所有的插件
 */
export async function loadPlugins() {
    try {
        for (const key of Object.keys(plugins)) {
            delete plugins[key];
        }

        const entries = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                const indexPath = path.join(PLUGINS_DIR, entry.name, 'index.js');

                try {
                    await fs.access(indexPath);
                    const pluginModule = await import(indexPath);
                    const moduleExports = pluginModule.default || pluginModule;
                    const manifest = normalizeManifest(
                        pluginModule.manifest || moduleExports.manifest,
                        entry.name
                    );

                    plugins[manifest.id] = {
                        id: manifest.id,
                        directoryName: entry.name,
                        name: manifest.name,
                        manifest,
                        module: moduleExports
                    };
                    console.log(`[PluginManager] 已加载插件: ${manifest.id} (${entry.name})`);
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

export function getPlugin(pluginId) {
    return plugins[pluginId] || null;
}

export function getPluginRegistry() {
    return Object.values(plugins).map(plugin => ({
        id: plugin.id,
        name: plugin.name,
        directoryName: plugin.directoryName,
        manifest: cloneValue(plugin.manifest)
    }));
}

export async function getPluginConfig(pluginId, { sanitize = false } = {}) {
    const plugin = getPlugin(pluginId);
    if (!plugin) {
        throw new Error(`Plugin not found: ${pluginId}`);
    }

    const config = typeof plugin.module.loadConfig === 'function'
        ? await plugin.module.loadConfig()
        : {};

    if (!sanitize) {
        return cloneValue(config) || {};
    }

    return sanitizeConfigByManifest(config, plugin.manifest);
}

export async function savePluginConfig(pluginId, config) {
    const plugin = getPlugin(pluginId);
    if (!plugin) {
        throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (typeof plugin.module.saveConfig !== 'function') {
        throw new Error(`Plugin does not support saveConfig: ${pluginId}`);
    }

    const existing = await getPluginConfig(pluginId);
    const merged = mergeConfigByManifest(existing, config, plugin.manifest);
    const validation = validatePluginConfigData(merged, plugin.manifest);
    if (!validation.valid) {
        throw new PluginValidationError(`插件配置校验失败: ${pluginId}`, validation.errors);
    }
    await plugin.module.saveConfig(merged);
    return merged;
}

export async function runPluginAction(pluginId, actionId, payload = {}) {
    const plugin = getPlugin(pluginId);
    if (!plugin) {
        throw new Error(`Plugin not found: ${pluginId}`);
    }

    const declaredActions = plugin.manifest.settings?.actions || [];
    const action = declaredActions.find(item => item.id === actionId);
    if (!action) {
        throw new Error(`Unknown action "${actionId}" for plugin "${pluginId}"`);
    }

    if (typeof plugin.module.runAction !== 'function') {
        throw new Error(`Plugin does not support actions: ${pluginId}`);
    }

    const actionPayload = cloneValue(payload) || {};

    if (actionPayload?.config) {
        const existing = await getPluginConfig(pluginId);
        const merged = mergeConfigByManifest(existing, actionPayload.config, plugin.manifest);
        const validation = validatePluginConfigData(merged, plugin.manifest);
        if (!validation.valid) {
            throw new PluginValidationError(`插件配置校验失败: ${pluginId}`, validation.errors);
        }
        // 运行 action 时也使用合并后的配置，避免敏感字段掩码值覆盖真实配置。
        actionPayload.config = merged;
    }

    const result = await plugin.module.runAction(actionId, actionPayload);
    return normalizeActionResult(result);
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
    const results = {};

    // 用于收集 MemU 之类的推荐或依赖结果
    let context = {
        content,
        type,
        options,
        images,       // 图片绝对路径列表，插件可按需使用
        suggestion: null
    };

    const loadedKeys = resolvePluginExecutionOrder(Object.entries(plugins));

    // 1. 顺序执行具备依赖属性的插件 (比如 MemU 可能生成供 Telegram 使用的 suggestion)
    for (const key of loadedKeys) {
        const plugin = plugins[key];
        const configKey = plugin.manifest.id;
        const isEnabled = pluginSettings[configKey] ?? plugin.manifest.enabledByDefault;
        let shouldExecute = isEnabled;

        // 如果属于前端控制的屏蔽，则跳过
        if (key === 'flomo' && options.enableFlomo === false) shouldExecute = false;
        if (key === 'mastodon' && options.enableMastodon === false) shouldExecute = false;
        if (key === 'telegram' && !options.sendToTelegram) shouldExecute = false;

        // Mem0 默认只有日记模式才会执行
        if (key === 'mem0' && type !== 'diary') shouldExecute = false;

        if (shouldExecute) {
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
    getPlugin,
    getPluginRegistry,
    getPluginConfig,
    savePluginConfig,
    runPluginAction,
    executePlugins
};
