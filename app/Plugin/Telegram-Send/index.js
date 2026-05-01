import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    getDataPath,
    getPluginConfigPath
} from '../../src/utils/app-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = getPluginConfigPath('telegram');
const CORE_CONFIG_FILE = getDataPath('config.json');
const SCRIPT_PATH = path.join(__dirname, 'telegram_send.py');

let configCache = null;
const defaultConfig = {
    botToken: '',
    channels: [],
    homeChannels: [],
    showLinkPreview: true,
    boldFirstLine: false,
    appendSourceTag: false,
    addLineBreakPerLine: false
};

function normalizeConfig(config = {}) {
    const normalized = { ...config };
    delete normalized.scriptPath;
    delete normalized.defaultChannel;
    if (!Array.isArray(normalized.channels)) {
        normalized.channels = [];
    }
    if (!Array.isArray(normalized.homeChannels)) {
        normalized.homeChannels = [];
    }
    return normalized;
}

export const manifest = {
    id: 'telegram',
    version: '1.0.0',
    name: 'Telegram',
    description: '发送内容到 Telegram 频道',
    category: 'diary-sync',
    dependsOn: [],
    enabledByDefault: false,
    ui: {
        homeV2: {
            section: 'publish_advanced',
            order: 10,
            label: 'Telegram'
        }
    },
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
                    }
                ]
            },
            {
                id: 'channels',
                title: '频道设置',
                actions: [
                    {
                        id: 'discoverChannels',
                        label: '获取频道列表',
                        kind: 'fetch'
                    }
                ],
                fields: [
                    {
                        key: 'homeChannels',
                        type: 'checkboxGroup',
                        label: '选择需要出现在主页的频道',
                        optionsSource: {
                            path: 'channels',
                            valueKey: 'id',
                            labelKey: 'title',
                            captionKey: 'username'
                        }
                    }
                ]
            },
            {
                id: 'tgOptimize',
                title: 'TG发布优化设置',
                description: '点击“Telegram”按钮后生成TG发布格式时的相关设置',
                fields: [
                    {
                        key: 'showLinkPreview',
                        type: 'boolean',
                        label: '网址显示预览',
                        description: '当有网址时，发布内容是否出现网址发布预览',
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
                        description: '将原文中的最后一个网址改为source标识并放在尾段末尾',
                        default: false
                    },
                    {
                        key: 'addLineBreakPerLine',
                        type: 'boolean',
                        label: '为每一行添加换行',
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
            }
        ]
    },
    capabilities: {
        execute: true,
        configure: true,
        test: true,
        media: {
            acceptsImages: true,
            acceptsInputImages: true,
            mode: 'media_group',
            maxImages: 9,
            summary: '单张图片走 sendPhoto，多张图片走媒体组',
            withImagesSummary: '当前会携带图片发送到 Telegram 频道',
            withImagesNote: '若文案超过 caption 长度限制，会在图片成功后拆分补发文字。'
        }
    }
};

async function loadLegacyConfig() {
    try {
        const raw = await fs.readFile(CORE_CONFIG_FILE, 'utf-8');
        const coreConfig = JSON.parse(raw);
        const diary = coreConfig?.diary || {};
        return {
            botToken: diary.tgBotToken || '',
            channels: diary.tgChannels ? JSON.parse(diary.tgChannels) : [],
            homeChannels: diary.tgDiaryChannel ? [diary.tgDiaryChannel] : [],
            showLinkPreview: diary.tgShowLinkPreview !== undefined ? Boolean(diary.tgShowLinkPreview) : true,
            boldFirstLine: Boolean(diary.tgBoldFirstLine),
            appendSourceTag: Boolean(diary.tgAppendSource),
            addLineBreakPerLine: Boolean(diary.tgAddLineBreakPerLine)
        };
    } catch (error) {
        return {};
    }
}

async function listChannels(botToken) {
    if (!botToken) {
        throw new Error('Bot Token 未配置');
    }

    return new Promise((resolve, reject) => {
        const env = {
            ...process.env,
            TELEGRAM_BOT_TOKEN: botToken,
            JOURNAL_SYNC_TELEGRAM_CONFIG_FILE: CONFIG_FILE
        };
        const tgProcess = spawn('python3', [SCRIPT_PATH, '--list-channels'], { env });
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
        const fileConfig = JSON.parse(data);
        configCache = normalizeConfig({
            ...defaultConfig,
            ...legacyConfig,
            ...fileConfig
        });
        return configCache;
    } catch (error) {
        configCache = normalizeConfig({
            ...defaultConfig,
            ...legacyConfig
        });
        return configCache;
    }
}

export async function saveConfig(config) {
    configCache = normalizeConfig(config);
    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(configCache, null, 2), 'utf-8');
}

export async function runAction(actionId, payload = {}) {
    const currentConfig = await loadConfig();
    const mergedConfig = { ...currentConfig, ...(payload.config || {}) };

    if (actionId === 'discoverChannels') {
        const channels = await listChannels(mergedConfig.botToken);
        const channelIds = new Set(channels.map(channel => String(channel.id)));
        const previousHomeChannels = Array.isArray(mergedConfig.homeChannels) ? mergedConfig.homeChannels : [];
        const homeChannels = previousHomeChannels
            .map(channel => String(channel))
            .filter(channel => channelIds.has(channel));
        const nextConfig = {
            ...currentConfig,
            ...mergedConfig,
            channels,
            homeChannels: homeChannels.length > 0 ? homeChannels : channels.map(channel => String(channel.id))
        };
        await saveConfig(nextConfig);
        return {
            success: true,
            message: channels.length > 0
                ? `找到 ${channels.length} 个可用频道`
                : '连接成功，但暂未发现可用频道',
            data: {
                channels,
                homeChannels: nextConfig.homeChannels
            }
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

export async function execute({ content, type, options, images = [] }) {
    const config = await loadConfig();

    if (!config.botToken) {
        return { success: false, error: 'Telegram 插件未配置' };
    }

    const tgContent = content;
    const homeChannelIds = Array.isArray(config.homeChannels) ? config.homeChannels.map(String) : [];
    const configuredChannels = Array.isArray(config.channels) ? config.channels : [];
    const firstHomeChannel = homeChannelIds.find(Boolean);
    const firstKnownChannel = configuredChannels.find(channel => channel?.id)?.id;
    const channel = options?.telegramChannel || firstHomeChannel || firstKnownChannel;

    if (!channel) {
        return { success: false, error: 'Telegram 频道未配置' };
    }

    // 过滤掉正文中的 Markdown 图片引用，避免与实际图片发送重复
    const textContent = tgContent.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();

    // 构建 Python 脚本的命令行参数
    // 基础参数：脚本路径 + 频道
    const args = [SCRIPT_PATH, channel];
    const shouldBoldFirstLineForNote = type === 'note' && Boolean(config.boldFirstLine);
    const shouldAddLineBreakPerLineForNote = type === 'note' && Boolean(config.addLineBreakPerLine);

    if (shouldBoldFirstLineForNote) {
        args.push('--bold-first-line');
    }
    if (shouldAddLineBreakPerLineForNote) {
        args.push('--line-break-per-line');
    }

    // 按当前图片顺序交给脚本：单张图片走 sendPhoto，多张图片走 sendMediaGroup。
    // 如果文字超过 caption 限制，脚本会先发图，再把剩余文字拆分补发。
    if (images.length > 0) {
        args.push('--images', ...images);
        console.log(`[Telegram Plugin] 发送含 ${images.length} 张图片的消息到 ${channel}`);
    }

    return new Promise((resolve) => {
        const env = {
            ...process.env,
            TELEGRAM_BOT_TOKEN: config.botToken,
            JOURNAL_SYNC_TELEGRAM_CONFIG_FILE: CONFIG_FILE
        };
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
