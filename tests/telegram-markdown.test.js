'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  convertToTelegramHtml,
  restoreImageTokens,
  extractQuotes,
  extractTelegramPlainText,
  willTelegramPlainSplitCaption,
  truncate,
  textLength,
  MESSAGE_LIMIT,
  CAPTION_LIMIT,
} = require('../src/core/telegram-markdown');

// ── 行内格式 ──────────────────────────────────

test('bold **x** converts to <b> in plain and rich', () => {
  assert.equal(convertToTelegramHtml('**加粗**', { rich: false }), '<b>加粗</b>');
  assert.ok(convertToTelegramHtml('**加粗**', { rich: true }).includes('<b>加粗</b>'));
});

test('italic *x* converts to <i> (not bold)', () => {
  assert.equal(convertToTelegramHtml('*斜体*', { rich: false }), '<i>斜体</i>');
  assert.ok(convertToTelegramHtml('*斜体*', { rich: true }).includes('<i>斜体</i>'));
});

test('strikethrough ~~x~~ converts to <s>', () => {
  assert.equal(convertToTelegramHtml('~~删除~~', { rich: false }), '<s>删除</s>');
  assert.ok(convertToTelegramHtml('~~删除~~', { rich: true }).includes('<s>删除</s>'));
});

test('snake_case is not misdetected as italic', () => {
  assert.equal(convertToTelegramHtml('use snake_case here', { rich: false }), 'use snake_case here');
});

test('inline code converts to <code>', () => {
  assert.equal(convertToTelegramHtml('a `code` b', { rich: false }), 'a <code>code</code> b');
});

// ── HTML 转义 ────────────────────────────────

test('raw ampersand is escaped for parse_mode=HTML', () => {
  assert.equal(convertToTelegramHtml('a & b', { rich: false }), 'a &amp; b');
});

test('raw angle brackets are escaped', () => {
  assert.equal(convertToTelegramHtml('1 < 2 > 0', { rich: false }), '1 &lt; 2 &gt; 0');
});

test('pre-escaped entity is not double-escaped', () => {
  // 已转义实体应原样保留，避免渲染出字面 &amp;
  assert.equal(convertToTelegramHtml('AT&amp;T', { rich: false }), 'AT&amp;T');
});

// ── 块级格式 ──────────────────────────────────

test('heading degrades to bold in plain, h1 in rich', () => {
  assert.equal(convertToTelegramHtml('# 标题', { rich: false }), '<b>标题</b>');
  assert.equal(convertToTelegramHtml('# 标题', { rich: true }), '<h1>标题</h1>');
});

test('list degrades to bullets in plain, ul in rich', () => {
  assert.equal(convertToTelegramHtml('- a\n- b', { rich: false }), '• a\n• b');
  assert.equal(convertToTelegramHtml('- a\n- b', { rich: true }), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
});

// ── 引用：内容不丢失 + 无非法嵌套 ────────────
const BQ = '<block' + 'quote>';
const CBQ = '</block' + 'quote>';
const PBQ = '<p><block' + 'quote>';
const PRE = '<pr' + 'e>';

test('rich quote is wrapped in blockquote without outer <p>', () => {
  const rich = convertToTelegramHtml('> 引用内容', { rich: true });
  assert.ok(rich.includes(BQ + '引用内容' + CBQ), `rich lost content: ${rich}`);
  assert.ok(!rich.includes(PBQ), `illegal nesting: ${rich}`);
});

test('plain quote renders as blockquote (Bot API 7.0+)', () => {
  const plain = convertToTelegramHtml('> 引用内容', { rich: false });
  assert.ok(plain.includes(BQ + '引用内容' + CBQ), `plain lost content: ${plain}`);
  assert.ok(!plain.includes(PBQ), `illegal nesting: ${plain}`);
});

test('quote with inline formatting preserves content', () => {
  const rich = convertToTelegramHtml('> **加粗** 引用', { rich: true });
  assert.ok(rich.includes('加粗'), `rich lost bold: ${rich}`);
  assert.ok(rich.includes('引用'), `rich lost text: ${rich}`);
  assert.ok(!rich.includes(PBQ), `illegal nesting: ${rich}`);
});

test('multi-line quote is preserved as one block', () => {
  const rich = convertToTelegramHtml('> 第一行\n> 第二行', { rich: true });
  assert.ok(rich.includes('第一行'), `rich lost line1: ${rich}`);
  assert.ok(rich.includes('第二行'), `rich lost line2: ${rich}`);
  assert.ok(!rich.includes(PBQ), `illegal nesting: ${rich}`);
});

// ── 回归：围栏代码块内 > 行不丢失 ────────────

test('code block with a > line preserves all lines (plain)', () => {
  const plain = convertToTelegramHtml('```\nline1\n> q\nline3\n```', { rich: false });
  assert.ok(plain.includes('line1'), `lost line1: ${plain}`);
  assert.ok(plain.includes('line3'), `lost line3: ${plain}`);
  assert.ok(plain.includes('> q') || plain.includes('&gt; q'), `lost quote line: ${plain}`);
  assert.ok(plain.includes(PRE), `no pre block: ${plain}`);
});

test('code block with a > line preserves all lines (rich)', () => {
  const rich = convertToTelegramHtml('```\nline1\n> q\nline3\n```', { rich: true });
  assert.ok(rich.includes('line1'), `lost line1: ${rich}`);
  assert.ok(rich.includes('line3'), `lost line3: ${rich}`);
  assert.ok(rich.includes('> q') || rich.includes('&gt; q'), `lost quote line: ${rich}`);
  assert.ok(rich.includes(PRE), `no pre block: ${rich}`);
});

// ── 回归：引用紧贴正文（无空行）不丢失 ────────

test('quote after text without blank line preserves both (plain)', () => {
  const plain = convertToTelegramHtml('text\n> quote', { rich: false });
  assert.ok(plain.includes('text'), `lost text: ${plain}`);
  assert.ok(plain.includes(BQ + 'quote' + CBQ), `lost quote: ${plain}`);
});

test('quote after text without blank line preserves both (rich)', () => {
  const rich = convertToTelegramHtml('text\n> quote', { rich: true });
  assert.ok(rich.includes('text'), `lost text: ${rich}`);
  assert.ok(rich.includes(BQ + 'quote' + CBQ), `lost quote: ${rich}`);
  assert.ok(!rich.includes(PBQ), `illegal nesting: ${rich}`);
});

test('quote before text without blank line preserves both (plain)', () => {
  const plain = convertToTelegramHtml('> quote\ntext', { rich: false });
  assert.ok(plain.includes('text'), `lost text: ${plain}`);
  assert.ok(plain.includes(BQ + 'quote' + CBQ), `lost quote: ${plain}`);
});

test('quote before text without blank line preserves both (rich)', () => {
  const rich = convertToTelegramHtml('> quote\ntext', { rich: true });
  assert.ok(rich.includes('text'), `lost text: ${rich}`);
  assert.ok(rich.includes(BQ + 'quote' + CBQ), `lost quote: ${rich}`);
  assert.ok(!rich.includes(PBQ), `illegal nesting: ${rich}`);
});

test('multiple separate quote blocks all preserved (plain)', () => {
  const plain = convertToTelegramHtml('a\n> q1\nb\n\n> q2', { rich: false });
  assert.ok(plain.includes('a'), `lost a: ${plain}`);
  assert.ok(plain.includes(BQ + 'q1' + CBQ), `lost q1: ${plain}`);
  assert.ok(plain.includes('b'), `lost b: ${plain}`);
  assert.ok(plain.includes(BQ + 'q2' + CBQ), `lost q2: ${plain}`);
});

test('multiple separate quote blocks all preserved (rich)', () => {
  const rich = convertToTelegramHtml('a\n> q1\nb\n\n> q2', { rich: true });
  assert.ok(rich.includes('a'), `lost a: ${rich}`);
  assert.ok(rich.includes(BQ + 'q1' + CBQ), `lost q1: ${rich}`);
  assert.ok(rich.includes('b'), `lost b: ${rich}`);
  assert.ok(rich.includes(BQ + 'q2' + CBQ), `lost q2: ${rich}`);
  assert.ok(!rich.includes(PBQ), `illegal nesting: ${rich}`);
});

test('nested quote is extracted as one block, content preserved', () => {
  const { text, quotes } = extractQuotes('> > inner');
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0], '> inner');
  assert.ok(!text.includes('inner'), `quote leaked into text: ${text}`);
  const plain = convertToTelegramHtml('> > inner', { rich: false });
  assert.ok(plain.includes('inner'), `lost inner: ${plain}`);
  assert.ok(!plain.includes('\u0001'), `placeholder leaked: ${plain}`);
});
// ── 图片 token ────────────────────────────────

test('image token restores to tg:// syntax when id is valid', () => {
  const html = convertToTelegramHtml('文字 @图片1 更多', { rich: true });
  const restored = restoreImageTokens(html, ['image_1']);
  assert.ok(restored.includes('![](tg://photo?id=image_1)'), `not restored: ${restored}`);
});

test('image token is left intact when id is not in validIds', () => {
  const html = convertToTelegramHtml('文字 @图片1 更多', { rich: true });
  const restored = restoreImageTokens(html, ['image_9']);
  assert.ok(restored.includes('@图片1'), `should keep token: ${restored}`);
  assert.ok(!restored.includes('tg://photo'), `should not restore: ${restored}`);
});

test('image token restores without validIds (backward compat)', () => {
  const html = convertToTelegramHtml('文字 @图片1 更多', { rich: true });
  const restored = restoreImageTokens(html);
  assert.ok(restored.includes('![](tg://photo?id=image_1)'), `not restored: ${restored}`);
});

// ── 长度截断 ─────────────────────────────────

test('truncate caps visible text at MESSAGE_LIMIT', () => {
  const long = 'a'.repeat(MESSAGE_LIMIT + 100);
  const html = convertToTelegramHtml(long, { rich: false });
  const truncated = truncate(html, MESSAGE_LIMIT);
  assert.ok(textLength(truncated) <= MESSAGE_LIMIT, `len=${textLength(truncated)}`);
});

test('truncate caps visible text at CAPTION_LIMIT', () => {
  const long = 'a'.repeat(CAPTION_LIMIT + 50);
  const html = convertToTelegramHtml(long, { rich: false });
  const truncated = truncate(html, CAPTION_LIMIT);
  assert.ok(textLength(truncated) <= CAPTION_LIMIT, `len=${textLength(truncated)}`);
});

test('entity expansion does not overflow after truncate', () => {
  const ampersands = '&'.repeat(500); // 转换后 ~2500 字符
  const html = convertToTelegramHtml(ampersands, { rich: false });
  const truncated = truncate(html, CAPTION_LIMIT);
  assert.ok(textLength(truncated) <= CAPTION_LIMIT, `len=${textLength(truncated)}`);
});

// ── extractQuotes ─────────────────────────────

test('extractQuotes separates quotes from body', () => {
  const { text, quotes } = extractQuotes('前文\n> 引用\n后文');
  assert.ok(!text.includes('引用'), `quote leaked into text: ${text}`);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0], '引用');
});

// ── 普通模式超 1024 字图文拆分判断 ───────────────

test('willTelegramPlainSplitCaption returns false without image attachments', () => {
  assert.equal(willTelegramPlainSplitCaption({
    content: '字'.repeat(CAPTION_LIMIT + 50),
    attachments: []
  }), false);
});

test('willTelegramPlainSplitCaption respects exact CAPTION_LIMIT boundary with images', () => {
  const attachments = [{ kind: 'image', filename: 'a.png' }];
  assert.equal(willTelegramPlainSplitCaption({
    content: '字'.repeat(CAPTION_LIMIT),
    attachments
  }), false);
  assert.equal(willTelegramPlainSplitCaption({
    content: '字'.repeat(CAPTION_LIMIT + 1),
    attachments
  }), true);
});

test('willTelegramPlainSplitCaption counts Unicode code points and excludes @图片N tokens', () => {
  const attachments = [{ kind: 'image', filename: 'a.png' }];
  const exactlyAtLimitWithTokens = `${'😀'.repeat(CAPTION_LIMIT)} @图片1`;
  assert.equal(willTelegramPlainSplitCaption({
    content: exactlyAtLimitWithTokens,
    attachments
  }), false);

  const overLimitSplitAroundToken = `${'a'.repeat(512)}\n@图片1\n${'b'.repeat(511)}`;
  // 分段合并时插入 '\n\n'（2 个字符）：512 + 2 + 511 = 1025 > 1024
  assert.equal(extractTelegramPlainText(overLimitSplitAroundToken).length, 1025);
  assert.equal(willTelegramPlainSplitCaption({
    content: overLimitSplitAroundToken,
    attachments
  }), true);
});