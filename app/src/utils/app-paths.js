import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.resolve(__dirname, '../..');
const PROJECT_DIR = path.basename(APP_DIR) === 'app'
    ? path.dirname(APP_DIR)
    : APP_DIR;
const DEFAULT_USER_DATA_DIR = path.join(PROJECT_DIR, 'user-data');

const LEGACY_DATA_FILES = [
    'config.json',
    'history.json',
    'tasks.json',
    'mem0_insights.json'
];

const LEGACY_DATA_DIRS = [
    'mem0_vectors',
    'image-cache',
    'draft-cache'
];

const RUNTIME_DATA_DIRS = [
    ...LEGACY_DATA_DIRS,
    'plugins'
];

const LEGACY_PLUGIN_CONFIGS = [
    ['Flomo', 'flomo'],
    ['Telegram-Send', 'telegram'],
    ['Mastodon', 'mastodon'],
    ['Missky', 'missky'],
    ['Obsidian-Local', 'obsidian-local']
];

function resolveConfiguredDataDir() {
    const configured = process.env.JOURNAL_SYNC_DATA_DIR?.trim();
    if (!configured) return DEFAULT_USER_DATA_DIR;
    return path.resolve(configured);
}

async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function isNonEmptyDir(targetPath) {
    try {
        const entries = await fs.readdir(targetPath);
        return entries.length > 0;
    } catch {
        return false;
    }
}

async function copyIfMissing(sourcePath, targetPath) {
    if (!await pathExists(sourcePath) || await pathExists(targetPath)) {
        return false;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.cp(sourcePath, targetPath, {
        recursive: true,
        force: false,
        errorOnExist: false
    });
    return true;
}

async function copyFirstExistingIfMissing(sourcePaths, targetPath) {
    for (const sourcePath of sourcePaths) {
        if (await copyIfMissing(sourcePath, targetPath)) {
            return true;
        }
    }
    return false;
}

export function getAppDir() {
    return APP_DIR;
}

export function getProjectDir() {
    return PROJECT_DIR;
}

export function getUserDataDir() {
    return resolveConfiguredDataDir();
}

export function getDataPath(...segments) {
    return path.join(getUserDataDir(), ...segments);
}

export function getDataDirPath(...segments) {
    return getDataPath(...segments);
}

export function getPluginDataPath(pluginId, ...segments) {
    return getDataPath('plugins', pluginId, ...segments);
}

export function getPluginConfigPath(pluginId) {
    return getPluginDataPath(pluginId, 'config.json');
}

export async function ensureUserDataDir() {
    const userDataDir = getUserDataDir();
    await fs.mkdir(userDataDir, { recursive: true });
    return userDataDir;
}

export async function ensureDataDir(...segments) {
    const dirPath = getDataDirPath(...segments);
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
}

export async function ensureUserDataLayout() {
    const userDataDir = await ensureUserDataDir();

    for (const dir of RUNTIME_DATA_DIRS) {
        await ensureDataDir(dir);
    }

    return userDataDir;
}

export async function hasUserData() {
    const userDataDir = getUserDataDir();

    for (const file of LEGACY_DATA_FILES) {
        if (await pathExists(path.join(userDataDir, file))) return true;
    }

    for (const dir of LEGACY_DATA_DIRS) {
        if (await isNonEmptyDir(path.join(userDataDir, dir))) return true;
    }

    for (const [, pluginId] of LEGACY_PLUGIN_CONFIGS) {
        if (await pathExists(getPluginConfigPath(pluginId))) return true;
    }

    return false;
}

export async function migrateLegacyUserData(options = {}) {
    if (await hasUserData()) {
        await ensureUserDataDir();
        return { migrated: false, reason: 'user-data-exists' };
    }

    const legacyDataDirs = options.legacyDataDirs || [
        path.join(PROJECT_DIR, 'data'),
        path.join(APP_DIR, 'data')
    ];
    const legacyPluginDirs = options.legacyPluginDirs || [
        path.join(PROJECT_DIR, 'Plugin'),
        path.join(APP_DIR, 'Plugin')
    ];
    const userDataDir = await ensureUserDataDir();
    let copied = 0;

    for (const file of LEGACY_DATA_FILES) {
        if (await copyFirstExistingIfMissing(
            legacyDataDirs.map(dir => path.join(dir, file)),
            path.join(userDataDir, file)
        )) {
            copied += 1;
        }
    }

    for (const dir of LEGACY_DATA_DIRS) {
        if (await copyFirstExistingIfMissing(
            legacyDataDirs.map(legacyDir => path.join(legacyDir, dir)),
            path.join(userDataDir, dir)
        )) {
            copied += 1;
        }
    }

    for (const [legacyDirName, pluginId] of LEGACY_PLUGIN_CONFIGS) {
        if (await copyFirstExistingIfMissing(
            legacyPluginDirs.map(dir => path.join(dir, legacyDirName, 'config.json')),
            getPluginConfigPath(pluginId)
        )) {
            copied += 1;
        }
    }

    if (copied === 0) {
        return { migrated: false, reason: 'no-legacy-data' };
    }

    const markerPath = getDataPath('.migration.json');
    await fs.writeFile(markerPath, JSON.stringify({
        from: 'legacy-project-layout',
        migratedAt: new Date().toISOString(),
        version: 1,
        copied
    }, null, 2), 'utf-8');

    return { migrated: true, copied, markerPath };
}
