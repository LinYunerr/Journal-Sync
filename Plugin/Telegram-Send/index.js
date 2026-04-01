import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CORE_CONFIG_FILE = path.join(__dirname, '../../data/config.json');

let configCache = null;
const defaultConfig = {
    botToken: '',
    scriptPath: '/path/to/Journal-Sync/Plugin/Telegram-Send/telegram_send.py',
    channels: [],
    defaultChannel: '@LinYunChannel',
    optimizePrompt: '',
    showLinkPreview: true,
    boldFirstLine: false,
    appendSourceTag: false
};

export const manifest = {
    id: 'telegram',
    version: '1.0.0',
    name: 'Telegram',
    description: '发送内容到 Telegram 频道',
    category: 'diary-sync',
    dependsOn: ['memu'],
    enabledByDefault: false,
    settings: {
        storage: 'plugin',
        sections: [
            {
                id: 'basic',
                title: '基础配置',
                fields: [
                    {
                        key: 'botToken',
                        type: 'password',
                        label: 'Bot Token',
                        required: true,
                        sensitive: true,
                        validate: {
                            pattern: '^[0-9]{6,}:[A-Za-z0-9_-]{20,}$',
                            message: 'Bot Token 格式不正确'
                        },
                        placeholder: '输入你的 Telegram Bot Token'
                    },
                    {
                        key: 'scriptPath',
                        type: 'text',
                        label: '发送脚本路径',
                        required: true,
                        validate: {
                            minLength: 1,
                            message: '发送脚本路径不能为空'
                        },
                        placeholder: '/Users/username/path/to/telegram_send.py'
                    },
                    {
                        key: 'defaultChannel',
                        type: 'select',
                        label: '默认频道',
                        placeholder: '请先点击“获取频道列表”',
                        optionsSource: {
                            path: 'channels',
                            valueKey: 'id',
                            labelKey: 'title',
                            captionKey: 'username'
                        },
                        allowCustomValue: true
                    },
                    {
                        key: 'optimizePrompt',
                        type: 'textarea',
                        label: 'TG 发布优化提示词',
                        validate: {
                            maxLength: 4000,
                            message: 'TG 发布优化提示词过长'
                        },
                        placeholder: '留空则使用默认提示词'
                    },
                    {
                        key: 'showLinkPreview',
                        type: 'boolean',
                        label: '网址显示预览',
                        default: true
                    },
                    {
                        key: 'boldFirstLine',
                        type: 'boolean',
                        label: '笔记发布TG时首行加粗',
                        default: false
                    },
                    {
                        key: 'appendSourceTag',
                        type: 'boolean',
                        label: '笔记发布TG时结尾增加source标识',
                        default: false
                    }
                ]
            }
        ],
        actions: [
            {
                id: 'testConnection',
                label: '测试连通性',
                kind: 'test'
            },
            {
                id: 'discoverChannels',
                label: '获取频道列表',
                kind: 'fetch'
            }
        ]
    },
    capabilities: {
        execute: true,
        configure: true,
        test: true
    }
};

async function loadLegacyConfig() {
    try {
        const raw = await fs.readFile(CORE_CONFIG_FILE, 'utf-8');
        const coreConfig = JSON.parse(raw);
        const diary = coreConfig?.diary || {};
        return {
            botToken: diary.tgBotToken || '',
            scriptPath: diary.tgSendScript || '',
            channels: diary.tgChannels ? JSON.parse(diary.tgChannels) : [],
            defaultChannel: diary.tgDiaryChannel || '',
            optimizePrompt: diary.tgOptimizePrompt || '',
            showLinkPreview: diary.tgShowLinkPreview !== undefined ? Boolean(diary.tgShowLinkPreview) : true,
            boldFirstLine: Boolean(diary.tgBoldFirstLine),
            appendSourceTag: Boolean(diary.tgAppendSource)
        };
    } catch (error) {
        return {};
    }
}

async function listChannels(botToken) {
    const config = await loadConfig();
    const scriptPath = config.scriptPath || defaultConfig.scriptPath;

    if (!botToken) {
        throw new Error('Bot Token 未配置');
    }

    return new Promise((resolve, reject) => {
        const env = { ...process.env, TELEGRAM_BOT_TOKEN: botToken };
        const tgProcess = spawn('python3', [scriptPath, '--list-channels'], { env });
        const stdoutChunks = [];
        const stderrChunks = [];
        let settled = false;

        tgProcess.stdout.on('data', data => {
            stdoutChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        });
        tgProcess.stderr.on('data', data => {
            stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        });
        tgProcess.on('error', error => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });
        tgProcess.on('close', code => {
            if (settled) return;
            settled = true;
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');

            if (code !== 0) {
                reject(new Error(stderr || stdout || `脚本退出码 ${code}`));
                return;
            }

            try {
                const result = JSON.parse(stdout);
                const channels = (result.channels || []).map(channel => ({
                    id: String(channel.id),
                    title: channel.title || channel.username || String(channel.id),
                    type: channel.type || 'channel',
                    username: channel.username ? `@${String(channel.username).replace(/^@/, '')}` : null
                }));
                resolve(channels);
            } catch (error) {
                reject(new Error(`解析频道列表失败: ${error.message}`));
            }
        });

        setTimeout(() => {
            if (!settled) {
                settled = true;
                tgProcess.kill();
                reject(new Error('请求超时'));
            }
        }, 30000);
    });
}

export async function loadConfig() {
    if (configCache) return configCache;
    const legacyConfig = await loadLegacyConfig();
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        configCache = {
            ...defaultConfig,
            ...legacyConfig,
            ...JSON.parse(data)
        };
        return configCache;
    } catch (error) {
        configCache = {
            ...defaultConfig,
            ...legacyConfig
        };
        return configCache;
    }
}

export async function saveConfig(config) {
    configCache = config;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function runAction(actionId, payload = {}) {
    const currentConfig = await loadConfig();
    const mergedConfig = { ...currentConfig, ...(payload.config || {}) };

    if (actionId === 'discoverChannels') {
        const channels = await listChannels(mergedConfig.botToken);
        const nextConfig = { ...currentConfig, ...mergedConfig, channels };
        await saveConfig(nextConfig);
        return {
            success: true,
            message: channels.length > 0
                ? `找到 ${channels.length} 个可用频道`
                : '连接成功，但暂未发现可用频道',
            data: { channels }
        };
    }

    if (actionId === 'testConnection') {
        const channels = await listChannels(mergedConfig.botToken);
        return {
            success: true,
            message: `连接成功，可访问 ${channels.length} 个频道`,
            data: { channels }
        };
    }

    throw new Error(`Unknown action: ${actionId}`);
}

export async function execute({ content, type, options, suggestion, images = [] }) {
    const config = await loadConfig();

    if (!config.scriptPath || !config.botToken) {
        return { success: false, error: 'Telegram 插件未配置' };
    }

    const tgContent = suggestion || content;
    const channel = options?.telegramChannel || config.defaultChannel || '@LinYunChannel';

    // 过滤掉正文中的 Markdown 图片引用，避免与实际图片发送重复
    const textContent = tgContent.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();

    // 构建 Python 脚本的命令行参数
    // 基础参数：脚本路径 + 频道
    const args = [config.scriptPath, channel];
    const shouldBoldFirstLineForNote = type === 'note' && Boolean(config.boldFirstLine);

    if (shouldBoldFirstLineForNote) {
        args.push('--bold-first-line');
    }

    // 如果有图片，追加 --images 参数
    if (images.length > 0) {
        args.push('--images', ...images);
        console.log(`[Telegram Plugin] 发送含 ${images.length} 张图片的消息到 ${channel}`);
    }

    return new Promise((resolve) => {
        const env = { ...process.env, TELEGRAM_BOT_TOKEN: config.botToken };
        const tgProcess = spawn('python3', args, { env });

        const outputChunks = [];

        tgProcess.stdout.on('data', (data) => outputChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
        tgProcess.stderr.on('data', (data) => outputChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));

        tgProcess.on('error', (err) => resolve({ success: false, error: err.message }));

        if (textContent) {
            tgProcess.stdin.write(textContent);
        }
        tgProcess.stdin.end();

        tgProcess.on('close', (code) => {
            const output = Buffer.concat(outputChunks).toString('utf8');
            resolve({ success: code === 0, output });
        });

        setTimeout(() => {
            tgProcess.kill();
            resolve({ success: false, error: 'timeout' });
        }, 60000);
    });
}

export default {
    manifest,
    execute,
    loadConfig,
    saveConfig,
    runAction
};
