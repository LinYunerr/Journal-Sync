/**
 * 从编辑器提取发送内容（纯逻辑，依赖 CodeMirror editor 接口）。
 *
 * 原实现埋在 src/main.js 中。规则：
 * - 有选中文本 → 发送选区
 * - scope = 0 → 发送整个页面
 * - scope = 1-6 → 发送光标上方最近一级该级别标题下的内容（不含标题本身）
 * - 未选中且光标不在所选级别标题下 → 返回 null（禁止整篇文档兜底发送）
 */

'use strict';

function getSelectedOrBlockContent(editor, scope = 2) {
    const selected = editor.getSelection();
    if (selected && selected.trim()) {
        return { content: selected.trim(), heading: '', source: 'selection' };
    }

    const doc = editor.getValue().replace(/\r\n/g, '\n');
    const lines = doc.split('\n');
    const cursorLine = editor.getCursor().line;

    // scope = 0：发送整个页面
    if (Number(scope) === 0) {
        const content = doc.trim();
        return content
            ? { content, heading: '', source: 'page' }
            : null;
    }

    // scope = 1-6：发送光标上方最近一级该级别标题下的内容（不含标题本身）。
    // 遇到同级或更高级标题时结束，避免跨越到下一个父级章节。
    const level = Math.min(6, Math.max(1, Number(scope) || 2));
    const headingRe = new RegExp(`^#{${level}}\\s+`);
    const anyHeadingRe = /^(#{1,6})\s+/;
    let startLine = -1;
    for (let i = Math.min(cursorLine, lines.length - 1); i >= 0; i--) {
        if (headingRe.test(lines[i])) { startLine = i; break; }
    }
    if (startLine >= 0) {
        let endLine = lines.length;
        for (let i = startLine + 1; i < lines.length; i++) {
            const nextHeading = lines[i].match(anyHeadingRe);
            if (nextHeading && nextHeading[1].length <= level) {
                endLine = i;
                break;
            }
        }
        const content = lines.slice(startLine + 1, endLine).join('\n').trim();
        if (!content) return null;
        return {
            content,
            heading: lines[startLine].replace(headingRe, '').trim(),
            source: 'heading'
        };
    }

    // 未选中且光标不在所选级别标题下时视为无效操作，禁止整篇文档兜底发送。
    return null;
}

module.exports = { getSelectedOrBlockContent };