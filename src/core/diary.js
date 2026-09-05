/**
 * 日记文件名与标题占位符渲染。
 *
 * 原实现埋在 src/main.js 中，无法单独测试。本模块为纯函数，
 * 不依赖插件类或 Obsidian API，可被单元测试直接引用。
 */

'use strict';

function padNumber(v, size = 2) {
    return String(v).padStart(size, '0');
}

function formatDate(d = new Date()) {
    return `${d.getFullYear()}-${padNumber(d.getMonth() + 1)}-${padNumber(d.getDate())}`;
}

function formatTime(d = new Date()) {
    return `${padNumber(d.getHours())}:${padNumber(d.getMinutes())}:${padNumber(d.getSeconds())}`;
}

function parseDateInput(dateInput) {
    const m = String(dateInput || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) };
    const n = new Date();
    return { year: String(n.getFullYear()), month: String(n.getMonth() + 1), day: String(n.getDate()) };
}

function formatDateToken(v, w) {
    const d = String(v || '').replace(/\D/g, '');
    if (!d) return '';
    return w <= d.length ? d.slice(-w) : d.padStart(w, '0');
}

function sanitizeFilename(v) {
    return String(v || '').trim().split(/[\\\/]/).pop().replace(/[:*?"<>|]/g, '_');
}

/**
 * 根据日期与规则渲染日记文件名（始终以 .md 结尾）。
 * 规则占位符：Y/M/D（可重复，取末位或补零）。
 * @param {string|Date} dateInput - 'YYYY-MM-DD' 字符串或 Date
 * @param {string} [rule='YYYY-MM-DD 日记']
 * @returns {string}
 */
function buildDiaryFilename(dateInput, rule = 'YYYY-MM-DD 日记') {
    const { year, month, day } = parseDateInput(dateInput);
    const fallback = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')} 日记`;
    const rendered = String(rule || 'YYYY-MM-DD 日记').trim()
        .replace(/Y+|M+|D+/g, tok => {
            if (tok.startsWith('Y')) return formatDateToken(year, tok.length);
            if (tok.startsWith('M')) return formatDateToken(month, tok.length);
            return formatDateToken(day, tok.length);
        });
    return `${(sanitizeFilename(rendered) || fallback).replace(/\.md$/i, '')}.md`;
}

/**
 * 根据时间与规则渲染日记标题。
 * 规则占位符：H/M/S（可重复，取末位或补零）。
 * @param {Date} now
 * @param {string} [rule='HH:MM:SS']
 * @returns {string}
 */
function buildDiaryHeading(now, rule = 'HH:MM:SS') {
    const fallback = `${padNumber(now.getHours())}:${padNumber(now.getMinutes())}:${padNumber(now.getSeconds())}`;
    const rendered = String(rule || 'HH:MM:SS').trim()
        .replace(/H+|M+|S+/g, tok => {
            if (tok.startsWith('H')) return formatDateToken(String(now.getHours()), tok.length);
            if (tok.startsWith('M')) return formatDateToken(String(now.getMinutes()), tok.length);
            return formatDateToken(String(now.getSeconds()), tok.length);
        });
    return rendered || fallback;
}

module.exports = {
    padNumber,
    formatDate,
    formatTime,
    parseDateInput,
    formatDateToken,
    sanitizeFilename,
    buildDiaryFilename,
    buildDiaryHeading
};