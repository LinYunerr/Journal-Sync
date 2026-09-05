/**
 * Vault 路径工具（纯函数，不依赖插件类）。
 *
 * 原实现埋在 src/main.js 中。Vault 文件一律使用 vault 相对路径，
 * 统一在此处理路径规范化、拼接、取目录与图片/URL 判断。
 */

'use strict';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function normalizeVaultPath(v) {
    return String(v || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function joinVaultPath(...parts) {
    return parts.map(normalizeVaultPath).filter(Boolean).join('/');
}

function dirnameVaultPath(p) {
    const n = normalizeVaultPath(p);
    const i = n.lastIndexOf('/');
    return i >= 0 ? n.slice(0, i) : '';
}

function isImagePath(v) {
    const clean = String(v || '').split('#')[0].split('?')[0];
    const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
    return IMAGE_EXTENSIONS.has(ext);
}

function isRemoteUrl(v) {
    return /^https?:\/\//i.test(String(v || '').trim());
}

function isDataUrl(v) {
    return /^data:/i.test(String(v || '').trim());
}

module.exports = {
    normalizeVaultPath,
    joinVaultPath,
    dirnameVaultPath,
    isImagePath,
    isRemoteUrl,
    isDataUrl
};