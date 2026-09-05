'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPayload } = require('../src/core/payload');
const { deepMergeSettings } = require('../src/core/settings');
const { buildDiaryFilename, buildDiaryHeading } = require('../src/core/diary');
const { getMimeType } = require('../src/core/mime');
const { buildMultipartBody } = require('../src/core/multipart');

// ── payload：@图片N token 匹配 ──────────────────────────────

test('@图片1 is not treated as a prefix of @图片10', () => {
    const richDraft = {
        version: 1,
        blocks: [],
        images: [
            { token: '@图片1', filename: 'a.png', vaultPath: 'a.png' },
            { token: '@图片10', filename: 'b.png', vaultPath: 'b.png' }
        ]
    };
    const payload = buildPayload({
        content: '图一 @图片1 图十 @图片10',
        richDraft
    });
    const tokens = payload.attachments.map(a => a.token);
    assert.deepEqual(tokens, ['@图片1', '@图片10']);
    assert.equal(payload.attachments[0].filename, 'a.png');
    assert.equal(payload.attachments[1].filename, 'b.png');
});

test('non-contiguous tokens are matched by token, not array index', () => {
    const richDraft = {
        version: 1,
        blocks: [],
        images: [
            { token: '@图片1', filename: 'a.png', vaultPath: 'a.png' },
            { token: '@图片2', filename: 'b.png', vaultPath: 'b.png' },
            { token: '@图片3', filename: 'c.png', vaultPath: 'c.png' }
        ]
    };
    // 只引用 @图片1 和 @图片3，跳过 @图片2
    const payload = buildPayload({
        content: '首 @图片1 尾 @图片3',
        richDraft
    });
    const tokens = payload.attachments.map(a => a.token);
    assert.deepEqual(tokens, ['@图片1', '@图片3']);
});

test('unreferenced tokens are filtered out of attachments', () => {
    const richDraft = {
        version: 1,
        blocks: [],
        images: [
            { token: '@图片1', filename: 'a.png', vaultPath: 'a.png' },
            { token: '@图片2', filename: 'b.png', vaultPath: 'b.png' }
        ]
    };
    const payload = buildPayload({
        content: '只引用 @图片2',
        richDraft
    });
    const tokens = payload.attachments.map(a => a.token);
    assert.deepEqual(tokens, ['@图片2']);
});

// ── deepMergeSettings：升级不重置用户设置 ─────────────────

test('non-empty user arrays never absorb default arrays', () => {
    const target = { publishPresets: [{ id: 'p1' }] };
    const source = { publishPresets: [{ id: 'default' }] };
    const result = deepMergeSettings(target, source);
    assert.deepEqual(result.publishPresets, [{ id: 'p1' }]);
});

test('empty user array is replaced by default array', () => {
    const target = { publishPresets: [] };
    const source = { publishPresets: [{ id: 'default' }] };
    const result = deepMergeSettings(target, source);
    assert.deepEqual(result.publishPresets, [{ id: 'default' }]);
});

test('empty-string / null / undefined scalars are replaced by defaults', () => {
    const target = { a: '', b: null, c: undefined, d: 'keep' };
    const source = { a: 'default-a', b: 'default-b', c: 'default-c', d: 'default-d' };
    const result = deepMergeSettings(target, source);
    assert.equal(result.a, 'default-a');
    assert.equal(result.b, 'default-b');
    assert.equal(result.c, 'default-c');
    assert.equal(result.d, 'keep');
});

test('nested objects merge recursively without clobbering', () => {
    const target = { adaptersConfig: { mastodon: { serverUrl: 'https://m.social' } } };
    const source = { adaptersConfig: { mastodon: { visibility: 'public' }, flomo: { webhook: 'x' } } };
    const result = deepMergeSettings(target, source);
    assert.equal(result.adaptersConfig.mastodon.serverUrl, 'https://m.social');
    assert.equal(result.adaptersConfig.mastodon.visibility, 'public');
    assert.equal(result.adaptersConfig.flomo.webhook, 'x');
});

// ── diary：文件名 / 标题占位符渲染 ────────────────────────

test('buildDiaryFilename renders default rule with padded date', () => {
    assert.equal(buildDiaryFilename('2026-09-06'), '2026-09-06 日记.md');
});

test('buildDiaryFilename honors custom rule and sanitizes illegal chars', () => {
    assert.equal(buildDiaryFilename('2026-09-06', 'YYYY年MM月DD日'), '2026年09月06日.md');
    // 非法字符被替换为下划线
    assert.equal(buildDiaryFilename('2026-09-06', 'YYYY:MM:DD'), '2026_09_06.md');
});

test('buildDiaryFilename always ends with .md and strips existing extension', () => {
    assert.equal(buildDiaryFilename('2026-09-06', 'YYYY-MM-DD 日记.md'), '2026-09-06 日记.md');
});

test('buildDiaryHeading renders default HH:MM:SS rule', () => {
    const now = new Date(2026, 8, 6, 9, 5, 3); // 09:05:03
    assert.equal(buildDiaryHeading(now), '09:05:03');
});

test('buildDiaryHeading honors custom rule with single-letter tokens', () => {
    const now = new Date(2026, 8, 6, 9, 5, 3);
    assert.equal(buildDiaryHeading(now, 'H:M:S'), '9:5:3');
});

// ── mime / multipart ──────────────────────────────────────

test('getMimeType covers image and video extensions', () => {
    assert.equal(getMimeType('a.jpg'), 'image/jpeg');
    assert.equal(getMimeType('a.jpeg'), 'image/jpeg');
    assert.equal(getMimeType('a.png'), 'image/png');
    assert.equal(getMimeType('a.webp'), 'image/webp');
    assert.equal(getMimeType('a.gif'), 'image/gif');
    assert.equal(getMimeType('a.svg'), 'image/svg+xml');
    assert.equal(getMimeType('a.mp4'), 'video/mp4');
    assert.equal(getMimeType('a.mov'), 'video/quicktime');
    assert.equal(getMimeType('a.webm'), 'video/webm');
});

test('getMimeType falls back to octet-stream for unknown extensions', () => {
    assert.equal(getMimeType('a.xyz'), 'application/octet-stream');
    assert.equal(getMimeType(''), 'application/octet-stream');
});

test('buildMultipartBody builds a single-file body with closing boundary', () => {
    const buf = new TextEncoder().encode('DATA').buffer;
    const { boundary, body } = buildMultipartBody({
        boundaryPrefix: '----TestBoundary',
        fields: [{ name: 'file', filename: 'x.png', contentType: 'image/png', buffer: buf }]
    });
    const text = new TextDecoder().decode(new Uint8Array(body));
    assert.ok(text.includes('name="file"; filename="x.png"\r\nContent-Type: image/png'));
    assert.ok(text.includes('DATA'));
    assert.ok(text.endsWith(`--${boundary}--\r\n`));
});

test('buildMultipartBody preserves text-field-before-file ordering', () => {
    const buf = new TextEncoder().encode('DATA').buffer;
    const { body } = buildMultipartBody({
        boundaryPrefix: '----TestBoundary',
        fields: [
            { name: 'i', value: 'TOKEN' },
            { name: 'file', filename: 'x.jpg', contentType: 'image/jpeg', buffer: buf }
        ]
    });
    const text = new TextDecoder().decode(new Uint8Array(body));
    const iIdx = text.indexOf('name="i"');
    const fileIdx = text.indexOf('name="file"');
    assert.ok(iIdx >= 0 && fileIdx >= 0 && iIdx < fileIdx);
    assert.ok(text.includes('name="i"\r\n\r\nTOKEN\r\n'));
});