/**
 * 统一 MIME 类型推断（图片 + 视频）。
 *
 * 原各适配器各自声明一份 getMimeType，且不完全一致：
 * - payload.js / notion.js 只认图片，默认 application/octet-stream
 * - mastodon.js / missky.js 额外支持视频，默认 application/octet-stream
 * - telegram.js 只认图片，默认 image/jpeg（未知扩展名的兜底不同）
 *
 * 本模块取并集：图片 + 视频，默认 application/octet-stream。
 * 所有适配器统一引用此实现，避免改一处漏一处导致平台间行为漂移。
 */

'use strict';

const MIME_TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm'
};

/**
 * 根据文件名后缀推断 MIME 类型。
 * @param {string} filename
 * @returns {string} MIME 类型；未知后缀返回 application/octet-stream
 */
function getMimeType(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

module.exports = { getMimeType };