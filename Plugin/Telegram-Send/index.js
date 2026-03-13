import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
        return {
            botToken: '',
            scriptPath: '/path/to/Journal-Sync/Plugin/Telegram-Send/telegram_send.py',
            defaultChannel: '@LinYunChannel'
        };
    }
}

export async function saveConfig(config) {
    configCache = config;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function execute({ content, options, suggestion }) {
    const config = await loadConfig();

    if (!config.scriptPath || !config.botToken) {
        return { success: false, error: 'Telegram 插件未配置' };
    }

    const tgContent = suggestion || content;
    const channel = options?.telegramChannel || config.defaultChannel || '@LinYunChannel';

    return new Promise((resolve) => {
        const env = { ...process.env, TELEGRAM_BOT_TOKEN: config.botToken };
        const tgProcess = spawn('python3', [config.scriptPath, channel], { env });

        let output = '';

        tgProcess.stdout.on('data', (data) => output += data.toString());
        tgProcess.stderr.on('data', (data) => output += data.toString());

        tgProcess.on('error', (err) => resolve({ success: false, error: err.message }));

        if (tgContent) {
            tgProcess.stdin.write(tgContent);
        }
        tgProcess.stdin.end();

        tgProcess.on('close', (code) => {
            resolve({ success: code === 0, output });
        });

        setTimeout(() => {
            tgProcess.kill();
            resolve({ success: false, error: 'timeout' });
        }, 60000);
    });
}

export default {
    execute,
    loadConfig,
    saveConfig
};
