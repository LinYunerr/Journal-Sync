/**
 * 解析 Markdown 中的图片引用（纯函数）。
 *
 * 原实现埋在 src/main.js 中。识别三种引用形式（wiki、markdown、裸路径），
 * 排除代码围栏内的引用，按位置排序返回。
 * 注意：`@图片1` 与 `@图片10` 是两个不同标记，匹配必须按 token 精确匹配，
 * 绝不能把 `@图片1` 当作 `@图片10` 的前缀。
 */

'use strict';

function parseImageRefs(markdown) {
    const refs = [];
    const wiki = /!\[\[([^\]]+)\]\]/g;
    const md = /!\[[^\]]*\]\(([^)]+)\)/g;
    const bare = /(^|\n)([^\n]+?\.(?:png|jpe?g|gif|webp|svg))(?=\n|$)/gi;
    let m;

    while ((m = wiki.exec(markdown)) !== null) {
        const t = String(m[1] || '').split('|')[0].trim();
        if (!t) continue;
        refs.push({ raw: m[0], target: t, type: 'wiki', index: m.index, end: m.index + m[0].length });
    }
    while ((m = md.exec(markdown)) !== null) {
        const t = String(m[1] || '').trim().replace(/^<|>$/g, '');
        if (!t) continue;
        try {
            refs.push({ raw: m[0], target: decodeURIComponent(t), type: 'markdown', index: m.index, end: m.index + m[0].length });
        } catch {
            refs.push({ raw: m[0], target: t, type: 'markdown', index: m.index, end: m.index + m[0].length });
        }
    }
    while ((m = bare.exec(markdown)) !== null) {
        const t = String(m[2] || '').trim();
        if (!t || /[\[\]()]/.test(t)) continue;
        const idx = m.index + m[1].length;
        refs.push({ raw: m[2], target: t, type: 'bare', index: idx, end: idx + m[2].length });
    }

    // 排除代码围栏内的引用
    const codeRanges = [];
    const fenceRe = /```[^\n]*[\s\S]*?```/g;
    let fm;
    while ((fm = fenceRe.exec(markdown)) !== null) {
        codeRanges.push([fm.index, fm.index + fm[0].length]);
    }
    const filtered = codeRanges.length === 0
        ? refs
        : refs.filter(ref => !codeRanges.some(([s, e]) => ref.index >= s && ref.index < e));

    return filtered.sort((a, b) => a.index - b.index);
}

module.exports = { parseImageRefs };