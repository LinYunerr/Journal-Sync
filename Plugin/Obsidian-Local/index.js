import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ConfigManager from '../../src/utils/config-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');
const IMAGE_CACHE_DIR = path.join(__dirname, '../../data/image-cache');
const DEFAULT_DIARY_PATH = process.env.JOURNAL_SYNC_OBSIDIAN_PATH || '';
const DEFAULT_FILENAME_RULE = 'YYYY-MM-DD 日记';

let configCache = null;

function cloneValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeLineEndings(value) {
    return String(value || '').replace(/\r\n/g, '\n');
}

function sanitizeFilename(rawValue) {
    if (typeof rawValue !== 'string') return '';
    const normalized = path.basename(rawValue.trim());
    if (!normalized || normalized === '.' || normalized === '..') {
        return '';
    }
    return normalized;
}

function resolveDefaultImageSavePath(diaryPath) {
    if (!diaryPath) return '';
    return path.join(diaryPath, 'assets');
}

async function loadLegacyFallback() {
    try {
        const config = await ConfigManager.loadConfig();
        return {
            diaryPath: config?.diary?.obsidianPath || config?.obsidianPath || DEFAULT_DIARY_PATH,
            noteVaultPath: config?.note?.vaultPath || '',
            imageSavePath: '',
            filenameRule: DEFAULT_FILENAME_RULE
        };
    } catch {
        return {
            diaryPath: DEFAULT_DIARY_PATH,
            noteVaultPath: '',
            imageSavePath: '',
            filenameRule: DEFAULT_FILENAME_RULE
        };
    }
}

function normalizeConfig(config = {}) {
    const diaryPath = String(config.diaryPath || '').trim() || DEFAULT_DIARY_PATH;
    const noteVaultPath = String(config.noteVaultPath || '').trim();
    const imageSavePath = String(config.imageSavePath || '').trim() || resolveDefaultImageSavePath(diaryPath);
    const filenameRule = String(config.filenameRule || '').trim() || DEFAULT_FILENAME_RULE;

    return {
        diaryPath,
        noteVaultPath,
        imageSavePath,
        filenameRule
    };
}

export async function loadConfig() {
    if (configCache) {
        return cloneValue(configCache);
    }

    try {
        const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
        configCache = normalizeConfig(JSON.parse(raw));
        return cloneValue(configCache);
    } catch {
        const legacy = await loadLegacyFallback();
        configCache = normalizeConfig(legacy);
        return cloneValue(configCache);
    }
}

export async function saveConfig(config) {
    const normalized = normalizeConfig(config);
    configCache = normalized;
    await fs.writeFile(CONFIG_FILE, JSON.stringify(normalized, null, 2), 'utf-8');
}

function formatDateParts(now = new Date()) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return {
        date: `${year}-${month}-${day}`,
        time: `${hours}:${minutes}:${seconds}`
    };
}

function parseDateInput(dateInput) {
    if (dateInput instanceof Date) {
        return {
            year: String(dateInput.getFullYear()),
            month: String(dateInput.getMonth() + 1),
            day: String(dateInput.getDate())
        };
    }

    const matched = String(dateInput || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (matched) {
        return {
            year: matched[1],
            month: String(Number(matched[2])),
            day: String(Number(matched[3]))
        };
    }

    const now = new Date();
    return {
        year: String(now.getFullYear()),
        month: String(now.getMonth() + 1),
        day: String(now.getDate())
    };
}

function formatDateTokenValue(rawValue, width) {
    const digits = String(rawValue || '').replace(/\D/g, '');
    if (!digits) return '';
    if (width <= digits.length) {
        return digits.slice(-width);
    }
    return digits.padStart(width, '0');
}

export function buildDiaryFilename(dateInput, filenameRule = DEFAULT_FILENAME_RULE) {
    const { year, month, day } = parseDateInput(dateInput);
    const dateStr = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const trimmedRule = String(filenameRule || '').trim() || DEFAULT_FILENAME_RULE;
    const rendered = trimmedRule.replace(/Y+|M+|D+/g, (token) => {
        if (token.startsWith('Y')) return formatDateTokenValue(year, token.length);
        if (token.startsWith('M')) return formatDateTokenValue(month, token.length);
        return formatDateTokenValue(day, token.length);
    });
    const baseName = sanitizeFilename(rendered) || `${dateStr} 日记`;

    return `${baseName.replace(/\.md$/i, '')}.md`;
}

function buildEntryContent(content, imageFilenames, timeStr) {
    const body = normalizeLineEndings(content).trim();
    const sections = [`## ${timeStr}`];

    if (body) {
        sections.push(body);
    }

    if (imageFilenames.length > 0) {
        sections.push(imageFilenames.map(filename => `![[${filename}]]`).join('\n'));
    }

    return `${sections.join('\n\n')}\n`;
}

async function resolveImageInputPaths(images = [], imageFilenames = [], targetDir = '') {
    const resolved = [];
    const seen = new Set();

    for (const candidate of Array.isArray(images) ? images : []) {
        const absolutePath = typeof candidate === 'string' ? candidate.trim() : '';
        if (!absolutePath || seen.has(absolutePath)) continue;
        try {
            await fs.access(absolutePath);
            resolved.push(absolutePath);
            seen.add(absolutePath);
        } catch {}
    }

    for (const rawFilename of Array.isArray(imageFilenames) ? imageFilenames : []) {
        const filename = sanitizeFilename(rawFilename);
        if (!filename) continue;
        const cachePath = path.join(IMAGE_CACHE_DIR, filename);
        if (seen.has(cachePath)) continue;
        try {
            await fs.access(cachePath);
            resolved.push(cachePath);
            seen.add(cachePath);
            continue;
        } catch {}

        if (!targetDir) continue;
        const targetPath = path.join(targetDir, filename);
        if (seen.has(targetPath)) continue;
        try {
            await fs.access(targetPath);
            resolved.push(targetPath);
            seen.add(targetPath);
        } catch {}
    }

    return resolved;
}

async function copyImagesToTarget(images, targetDir) {
    if (!Array.isArray(images) || images.length === 0) {
        return [];
    }

    await fs.mkdir(targetDir, { recursive: true });

    const saved = [];
    for (const sourcePath of images) {
        const filename = sanitizeFilename(path.basename(sourcePath));
        if (!filename) continue;

        const targetPath = path.join(targetDir, filename);
        if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
            await fs.copyFile(sourcePath, targetPath);
        }

        saved.push(filename);
    }

    return saved;
}

async function saveDiaryEntry(content, images = [], imageFilenames = []) {
    const config = await loadConfig();
    const { date, time } = formatDateParts();
    const diaryFileName = buildDiaryFilename(date, config.filenameRule);
    const diaryFilePath = path.join(config.diaryPath, diaryFileName);
    // 图片会复制到配置的本地图片目录，并在正文下方追加 Obsidian 的 ![[文件名]] 引用。
    // 未显式配置时，图片目录默认使用日记路径下的 assets 子目录。
    const imageNames = await copyImagesToTarget(
        await resolveImageInputPaths(images, imageFilenames, config.imageSavePath),
        config.imageSavePath
    );
    const entryContent = buildEntryContent(content, imageNames, time);

    await fs.mkdir(config.diaryPath, { recursive: true });

    let prefix = '';
    try {
        const existing = await fs.readFile(diaryFilePath, 'utf-8');
        prefix = existing.trimEnd() ? '\n\n' : '';
    } catch {}

    await fs.appendFile(diaryFilePath, `${prefix}${entryContent}`, 'utf-8');

    return {
        success: true,
        message: `已保存到 ${path.basename(diaryFilePath)}`,
        filePath: diaryFilePath,
        imageFilenames: imageNames
    };
}

export const manifest = {
    id: 'obsidian-local',
    version: '1.1.0',
    name: 'Obsidian 本地保存',
    description: '保存到本地 Obsidian 日记',
    category: 'save-local',
    enabledByDefault: true,
    ui: {
        homeV2: {
            section: 'save_local',
            order: 1,
            label: 'Obsidian 本地保存'
        }
    },
    settings: {
        storage: 'plugin',
        sections: [
            {
                id: 'paths',
                title: '路径与显示',
                fields: [
                    {
                        key: 'diaryPath',
                        type: 'text',
                        label: '日记 Obsidian 路径',
                        required: true,
                        validate: {
                            pattern: '^/.+',
                            message: '日记 Obsidian 路径必须是绝对路径'
                        },
                        placeholder: DEFAULT_DIARY_PATH
                    },
                    {
                        key: 'noteVaultPath',
                        type: 'text',
                        label: '笔记 Vault 路径',
                        description: '当前保存按钮不会使用这个路径，先保留在这里供后续笔记链路继续接入。',
                        placeholder: '/Users/username/Documents/Obsidian'
                    },
                    {
                        key: 'imageSavePath',
                        type: 'text',
                        label: '图片保存路径',
                        required: true,
                        validate: {
                            pattern: '^/.+',
                            message: '图片保存路径必须是绝对路径'
                        },
                        description: '默认使用日记路径下的 assets 文件夹。',
                        placeholder: `${DEFAULT_DIARY_PATH}/assets`
                    },
                    {
                        key: 'filenameRule',
                        type: 'text',
                        label: '文件名规则设定',
                        required: true,
                        description: '支持连续的 Y/M/D 占位符自由组合；位数不足取末尾，位数超出时左侧补 0，例如 YY、YYYYY、MM、MMM、D、DD。',
                        placeholder: DEFAULT_FILENAME_RULE
                    }
                ]
            }
        ],
        actions: []
    },
    capabilities: {
        execute: true,
        configure: true,
        test: false,
        media: {
            acceptsImages: true,
            acceptsInputImages: true,
            mode: 'assets',
            maxImages: 9,
            summary: '保存到今日日记，并把图片写入本地目录',
            withImagesSummary: '会把图片写入图片保存路径，并在正文下方追加 ![[文件名]]',
            withImagesNote: '图片默认进入日记路径下的 assets 子目录。'
        }
    }
};

export async function execute({ content, images = [], imageFilenames = [] }) {
    const normalizedContent = normalizeLineEndings(content).trim();
    if (!normalizedContent && (!Array.isArray(images) || images.length === 0) && (!Array.isArray(imageFilenames) || imageFilenames.length === 0)) {
        return { success: false, message: '内容不能为空' };
    }

    return saveDiaryEntry(normalizedContent, images, imageFilenames);
}

export default {
    manifest,
    loadConfig,
    saveConfig,
    execute
};
