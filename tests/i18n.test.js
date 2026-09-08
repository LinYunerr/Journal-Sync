'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { t, setLanguage, getEffectiveLanguage, registerTranslations } = require('../src/core/i18n');

// ── i18n：语言切换与插值 ─────────────────────────────────

test('default language is zh (identity)', () => {
    setLanguage('zh');
    assert.equal(getEffectiveLanguage(), 'zh');
    assert.equal(t('单元测试专用键'), '单元测试专用键');
});

test('en language uses registered translation', () => {
    registerTranslations('en', { '单元测试专用键': 'Unit-test-only key' });
    setLanguage('en');
    assert.equal(getEffectiveLanguage(), 'en');
    assert.equal(t('单元测试专用键'), 'Unit-test-only key');
});

test('missing key falls back to original Chinese text', () => {
    setLanguage('en');
    assert.equal(t('不存在的翻译键'), '不存在的翻译键');
});

test('interpolation replaces {var} placeholders', () => {
    setLanguage('en');
    registerTranslations('en', { '找到 {count} 个测试频道': 'Found {count} test channels' });
    assert.equal(t('找到 {count} 个测试频道', { count: 3 }), 'Found 3 test channels');
});

test('interpolation works in zh too (identity key)', () => {
    setLanguage('zh');
    assert.equal(t('找到 {count} 个测试频道', { count: 5 }), '找到 5 个测试频道');
});

test('registerTranslations merges incrementally across calls', () => {
    registerTranslations('en', { 'A': 'a' });
    registerTranslations('en', { 'B': 'b' });
    setLanguage('en');
    assert.equal(t('A'), 'a');
    assert.equal(t('B'), 'b');
});

test('setLanguage with unknown value falls back to zh', () => {
    setLanguage('fr');
    assert.equal(getEffectiveLanguage(), 'zh');
    assert.equal(t('单元测试专用键'), '单元测试专用键');
});

test('registerTranslations ignores non-en languages', () => {
    registerTranslations('fr', { 'X': 'x' });
    setLanguage('en');
    assert.equal(t('X'), 'X'); // not registered, falls back to key
});

// ── key 覆盖率：源码静态 t() key 必须已注册，且跨文件字典不得冲突 ─────────────────────────────────
// 这组测试防止「写了 t() 忘记 registerTranslations」（英文界面回退中文）和
// 「两个适配器注册同一 key 不同译文」（后加载者静默覆盖前者）两类回归。

const fs = require('node:fs');
const path = require('node:path');
function extractRegisteredEntries(source) {
    const entries = [];
    for (const m of source.matchAll(/registerTranslations\('en',\s*\{/g)) {
        // 括号配对找字典块结尾（值内可能含 '});' 子串，不能非贪婪匹配到第一个 '});'）
        const start = source.indexOf('{', m.index);
        let depth = 0, end = -1;
        for (let i = start; i < source.length; i++) {
            const c = source[i];
            if (c === "'") { // 跳过字符串字面量
                i++;
                while (i < source.length && source[i] !== "'") {
                    if (source[i] === '\\') i++;
                    i++;
                }
                continue;
            }
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end < 0) continue;
        const block = source.slice(start + 1, end);
        for (const e of block.matchAll(/'((?:[^'\\]|\\.)*)'\s*:\s*'((?:[^'\\]|\\.)*)'/g)) {
            entries.push([e[1], e[2]]);
        }
    }
    return entries;
}

// 扫描清单：src 下所有使用 t()/registerTranslations 的源文件（下方清单自检测试保证无遗漏；src/core/i18n.js 由模板 key 测试单独扫描）。
// 注册为增量合并且同 key 异值冲突已被完全禁止，清单顺序不影响测试语义。
const I18N_SOURCE_FILES = [
    'src/core/adapter-registry.js',
    'src/core/send-log.js',
    'src/core/telegraph.js',
    'src/core/send-dispatcher.js',
    'src/adapters/flomo.js',
    'src/adapters/telegram.js',
    'src/adapters/mastodon.js',
    'src/adapters/missky.js',
    'src/adapters/notion.js',
    'src/adapters/bluesky.js',
    'src/adapters/weibo.js',
    'src/adapters/threads.js',
    'src/ui/log-modal.js',
    'src/ui/settings-tab.js',
    'src/ui/send-modal.js',
    'src/main.js'
];

const REPO_ROOT = path.join(__dirname, '..');


/** 提取一个文件全部静态 t('...') 调用的 key（模板字符串动态 key 另有测试把关） */
function extractStaticKeys(source) {
    const keys = new Set();
    for (const m of source.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(m[1]);
    return keys;
}

test('I18N_SOURCE_FILES covers every src file using t() or registerTranslations', () => {
    // 新增含翻译的源文件却忘记加清单时，其余守卫都会静默跳过它——本测试兜底。
    const srcFiles = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.endsWith('.js')) srcFiles.push(p);
        }
    })(path.join(REPO_ROOT, 'src'));
    const unlisted = srcFiles
        .map(p => path.relative(REPO_ROOT, p))
        .filter(rel => rel !== 'src/core/i18n.js')
        .filter(rel => /\bregisterTranslations\s*\(|\bt\s*\(/.test(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')))
        .filter(rel => !I18N_SOURCE_FILES.includes(rel));
    assert.deepEqual(unlisted, [], `以下文件使用了 t()/registerTranslations 但未加入 I18N_SOURCE_FILES（守卫不会覆盖它们）:\n${unlisted.join('\n')}`);
});

test('no cross-file dictionary conflicts (same key, different en value)', () => {
    const seen = new Map();
    const conflicts = [];
    for (const rel of I18N_SOURCE_FILES) {
        const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        for (const [key, value] of extractRegisteredEntries(source)) {
            const prev = seen.get(key);
            if (prev && prev.value !== value) {
                conflicts.push(`${key}: ${prev.file} vs ${rel}`);
            }
            seen.set(key, { file: rel, value });
        }
    }
    assert.deepEqual(conflicts, [], `跨文件字典冲突（后加载者会覆盖前者）:\n${conflicts.join('\n')}`);
});

test('every static t() key is registered for en', () => {
    // 按真实加载顺序注册全部字典，再切到 en 逐一查询
    for (const rel of I18N_SOURCE_FILES) {
        const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        for (const [key, value] of extractRegisteredEntries(source)) {
            registerTranslations('en', { [key]: value });
        }
    }
    setLanguage('en');
    const missing = [];
    for (const rel of I18N_SOURCE_FILES) {
        const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        for (const key of extractStaticKeys(source)) {
            // 英文下仍返回原文 = 未注册（或注册成了相同值，同样无法翻译）。
            // 除汉字外同时检查全角标点（U+3000-303F / U+FF00-FFEF），否则 'Telegram：' 这类无汉字 key 漏注册时会静默泄漏全角字符。
            if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(key) && t(key) === key) {
                missing.push(`${rel}: ${key}`);
            }
        }
    }
    assert.deepEqual(missing, [], `以下 t() key 未注册英文译文（英文界面会显示中文）:\n${missing.join('\n')}`);
    setLanguage('zh');
});

test('no dynamic template-string keys passed to t()', () => {
    // t(`...${x}`) 形式的 key 永远无法命中字典（flomo 曾因此 bug）
    const offenders = [];
    for (const rel of I18N_SOURCE_FILES.concat('src/core/i18n.js')) {
        const source = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        for (const m of source.matchAll(/\bt\(\s*`/g)) {
            const line = source.slice(0, m.index).split('\n').length;
            offenders.push(`${rel}:${line}`);
        }
    }
    assert.deepEqual(offenders, [], `t() 收到模板字符串动态 key（永远查不到字典）:\n${offenders.join('\n')}`);
});