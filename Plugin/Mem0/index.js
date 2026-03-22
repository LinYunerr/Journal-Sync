import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Mem0Client from './mem0_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');

let configCache = null;
const defaultConfig = {
    llm: {
        provider: 'openai',
        config: {
            base_url: 'https://api.openai.com/v1',
            api_key: '',
            model: 'gpt-4o-mini'
        }
    },
    vectorStore: {
        provider: 'local',
        config: {
            path: './data/mem0_vectors'
        }
    },
    version: 'v1.1'
};

export const manifest = {
    id: 'mem0',
    version: '1.0.0',
    name: 'Mem0',
    description: '提取任务、标签和洞察',
    category: 'diary-sync',
    enabledByDefault: false,
    settings: {
        storage: 'plugin',
        sections: [
            {
                id: 'llm',
                title: 'LLM 配置',
                fields: [
                    {
                        key: 'llm.config.base_url',
                        type: 'text',
                        label: 'API Base URL',
                        required: true,
                        validate: {
                            pattern: '^https?://.+',
                            message: 'API Base URL 必须以 http:// 或 https:// 开头'
                        },
                        placeholder: 'https://api.openai.com/v1'
                    },
                    {
                        key: 'llm.config.api_key',
                        type: 'password',
                        label: 'API Key',
                        required: true,
                        sensitive: true,
                        validate: {
                            minLength: 10,
                            message: 'API Key 不能为空'
                        },
                        placeholder: 'sk-...'
                    },
                    {
                        key: 'llm.config.model',
                        type: 'text',
                        label: '模型名称',
                        required: true,
                        validate: {
                            minLength: 1,
                            message: '模型名称不能为空'
                        },
                        placeholder: 'gpt-4o-mini'
                    }
                ]
            }
        ],
        actions: [
            {
                id: 'testConnection',
                label: '测试连通性',
                kind: 'test'
            }
        ]
    },
    capabilities: {
        execute: true,
        configure: true,
        test: true
    }
};

export async function loadConfig() {
    if (configCache) return configCache;
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        configCache = JSON.parse(data);
        return configCache;
    } catch (error) {
        console.error('[Mem0 Plugin] 配置找不到:', error.message);
        return { ...defaultConfig };
    }
}

export async function saveConfig(config) {
    configCache = config;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function runAction(actionId, payload = {}) {
    if (actionId !== 'testConnection') {
        throw new Error(`Unknown action: ${actionId}`);
    }

    const currentConfig = await loadConfig();
    const nextConfig = {
        ...currentConfig,
        ...(payload.config || {}),
        llm: {
            ...(currentConfig.llm || {}),
            ...((payload.config || {}).llm || {}),
            config: {
                ...(currentConfig.llm?.config || {}),
                ...((payload.config || {}).llm?.config || {})
            }
        }
    };
    const client = new Mem0Client(nextConfig);
    return client.testConnection();
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
    manifest,
    execute,
    loadConfig,
    saveConfig,
    runAction
};
