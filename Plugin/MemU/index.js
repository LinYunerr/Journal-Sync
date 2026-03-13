import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');

let configCache = null;

async function loadConfig() {
    if (configCache) return configCache;
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf-8');
        configCache = JSON.parse(data);
        return configCache;
    } catch (error) {
        return {
            memuBridgeScript: '/path/to/memu_bridge.py',
            memuUserId: 'linyun'
        };
    }
}

export async function saveConfig(config) {
    configCache = config;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export async function execute(context) {
    const { content } = context;
    const config = await loadConfig();

    if (!config.memuBridgeScript || !config.memuUserId) {
        return { success: false, error: 'MemU 未配置' };
    }

    return new Promise((resolve) => {
        const memuProcess = spawn('python3', [
            config.memuBridgeScript,
            '--user-id', config.memuUserId,
            '--format', 'text'
        ]);

        let output = '';
        let errorOutput = '';

        memuProcess.stdout.on('data', (data) => output += data.toString());
        memuProcess.stderr.on('data', (data) => errorOutput += data.toString());

        memuProcess.on('error', (err) => resolve({ success: false, error: `Process err: ${err.message}` }));

        memuProcess.stdin.write(content);
        memuProcess.stdin.end();

        memuProcess.on('close', (code) => {
            if (code === 0) {
                let suggestion = null;
                const suggestionMatch = output.match(/建议：\s*([\s\S]*?)(?=\n\n|$)/);
                if (suggestionMatch) suggestion = suggestionMatch[1].trim();
                else {
                    const reminderMatch = output.match(/相关提醒[\s\S]*?(?=\n\n|$)/);
                    if (reminderMatch) suggestion = reminderMatch[0].trim();
                }

                resolve({ success: true, output, suggestion });
            } else {
                resolve({ success: false, error: errorOutput || 'Process failed' });
            }
        });

        setTimeout(() => {
            memuProcess.kill();
            resolve({ success: false, error: 'timeout' });
        }, 30000);
    });
}

export default {
    execute,
    loadConfig,
    saveConfig
};
