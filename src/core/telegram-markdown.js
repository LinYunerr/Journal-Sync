/**
 * Telegram Markdown → HTML 转换器。
 *
 * 将 Obsidian Markdown 转换为 Telegram 可渲染的 HTML：
 * - 普通链路（sendMessage, parse_mode=HTML）：mdgram（classic HTML）
 * - 富文本链路（sendRichMessage, Rich HTML）：mdgramRich
 *
 * 依赖 @borodin/mdgram（纯 JS，esbuild 可打包）。
 *
 * 已知问题处理：
 * 1. mdgram 的 blockquote 渲染器会把引用内容整段丢失（库 bug，见下）。
 *    这里在转换前提取引用块，用占位符替换，转换后再手动还原为 blockquote。
 *    （注：mdgram 源码 blockquote() 实际返回 <blockquote>，但多行引用与
 *    占位符/实体组合下内容会丢失，故仍保留提取-还原机制以保证内容不丢。）
 * 2. rich 链路的图片占位符 ![](tg://photo?id=N) 会被 mdgramRich 丢弃（非 http 链接）。
 *    调用方需先用 @图片N 文本占位符保护，转换后再还原为 tg:// 语法。
 * 3. mdgram 无条件转义 & 为 &amp;，会把正文中已存在的实体二次转义（&amp; → &amp;amp;）。
 *    转换前先解码 mdgram 会转义的实体（& < >），避免双重转义。
 */

'use strict';

const { mdgram, mdgramRich, truncate, textLength, MESSAGE_LIMIT, CAPTION_LIMIT } = require('@borodin/mdgram');

/** 引用占位符：\u0001 控制字符避免与正文冲突 */
const QUOTE_PH = (n) => `\u0001Q${n}\u0001`;

/**
 * 解码已存在的 HTML 实体，避免 mdgram 二次转义（&amp; → &amp;amp;）。
 * 仅解码 mdgram 会转义的实体（& < >），其余实体原样保留。
 * 在 extractQuotes 之后、mdgram 之前调用，避免 &gt; 行首被误判为引用。
 */
function decodeHtmlEntities(str) {
  return String(str || '').replace(/&(amp|lt|gt);/g, (m, name) => {
    if (name === 'amp') return '&';
    if (name === 'lt') return '<';
    return '>';
  });
}


/**
 * 两个防内容丢失的要点：
 * 1. 围栏感知：``` / ~~~ 围栏内的 > 行是代码，原样保留，不当作引用提取。
 * 2. 占位符前后用空行隔开：引用紧贴正文（无空行）时，占位符若与正文同段
 *    会被 mdgram 吞掉，故在占位符与相邻非引用行之间补空行，保证还原后内容齐全。
 */
function extractQuotes(markdown) {
  const lines = String(markdown || '').split('\n');
  const quotes = [];
  const out = [];
  let i = 0;
  let fence = null; // 当前围栏标记（'```' 或 '~~~'），null 表示不在围栏内
  let lastWasQuote = false;

  // 行首围栏标记（``` 或 ~~~，至少 3 个字符）
  const fenceMarker = (line) => {
    const m = line.match(/^(`{3,}|~{3,})/);
    return m ? m[1] : null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const marker = fenceMarker(line);

    // 在围栏内：原样输出，不提取引用；遇到同类型围栏则关闭
    if (fence) {
      out.push(line);
      lastWasQuote = false;
      if (marker && marker[0] === fence[0]) fence = null;
      i++;
      continue;
    }
    // 行首围栏：开启围栏，原样输出
    if (marker) {
      fence = marker;
      out.push(line);
      lastWasQuote = false;
      i++;
      continue;
    }

    const qm = line.match(/^>\s?(.*)$/);
    if (qm) {
      const quoteLines = [];
      while (i < lines.length) {
        const inner = lines[i].match(/^>\s?(.*)$/);
        if (!inner) break;
        quoteLines.push(inner[1]);
        i++;
      }
      quotes.push(quoteLines.join('\n'));
      // 占位符前补空行：前一行是非空正文且不是引用时，避免占位符与正文同段被吞
      if (out.length && out[out.length - 1] !== '' && !lastWasQuote) {
        out.push('');
      }
      out.push(QUOTE_PH(quotes.length));
      lastWasQuote = true;
    } else {
      // 非引用行：前一个是引用占位符时补空行，避免占位符与后续正文同段被吞
      if (lastWasQuote) {
        out.push('');
        lastWasQuote = false;
      }
      out.push(line);
      i++;
    }
  }

  return { text: out.join('\n'), quotes };
}

/**
 * 将 Obsidian Markdown 转换为 Telegram HTML。
 *
 * @param {string} markdown - 原始 Markdown
 * @param {object} [options]
 * @param {boolean} [options.rich=false] - true 用 mdgramRich（Rich HTML），false 用 mdgram（classic HTML）
 * @returns {string} Telegram HTML
 */
function convertToTelegramHtml(markdown, { rich = false } = {}) {
  const { text, quotes } = extractQuotes(String(markdown || ''));

  let html = rich
    ? mdgramRich(decodeHtmlEntities(text), { paragraphMode: 'br' })
    : mdgram(decodeHtmlEntities(text));

  // 还原引用块
  quotes.forEach((content, idx) => {
    const inner = rich
      ? mdgramRich(decodeHtmlEntities(content), { paragraphMode: 'br' })
      : mdgram(decodeHtmlEntities(content));
    // classic HTML parse mode（sendMessage + parse_mode=HTML）自 Bot API 7.0
    // 起支持 <blockquote>，故 plain 链路同样还原为 blockquote，不再降级为 <b>。
    const tag = 'blockquote';
    html = html.split(QUOTE_PH(idx + 1)).join(`<${tag}>${inner}</${tag}>`);
  });

  // rich 模式下 mdgramRich 会把占位符包进 <p>，导致 <p><blockquote> 非法嵌套。
  // 这里把 <p><blockquote>...</blockquote></p> 解包为 <blockquote>...</blockquote>。
  if (rich) {
    html = html.replace(/<p><blockquote>([\s\S]*?)<\/blockquote><\/p>/g, '<blockquote>$1</blockquote>');
  }

  return html;
}

/**
 * 将 @图片N 文本占位符还原为 rich 链路的 tg:// 图片语法。
 * 调用方在转换前用 @图片N 保护图片位置，转换后调用本函数还原。
 *
 * @param {string} html - 已转换的 HTML（含 @图片N 占位符）
 * @param {Array<string>} [validIds] - 允许还原的媒体 id 集合（如 ['image_1','image_2']）。
 *   仅还原集合内存在的 token，避免把用户正文里恰好出现的 @图片N 字面文本误还原。
 * @returns {string} 还原图片语法后的 HTML
 */
function restoreImageTokens(html, validIds) {
  const allowed = validIds && validIds.length ? new Set(validIds) : null;
  return String(html || '').replace(/<p>@图片(\d+)<\/p>|@图片(\d+)/g, (m, numInP, numBare) => {
    const num = numInP || numBare;
    const id = `image_${num}`;
    if (allowed && !allowed.has(id)) return m;
    return `![](tg://photo?id=${id})`;
  });
}

function extractTelegramPlainText(content) {
  return String(content || '')
    .split(/@图片\d+/g)
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

function willTelegramPlainSplitCaption(payload = {}) {
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const hasImage = attachments.some(item => item?.kind === 'image' && item?.filename);
  if (!hasImage) return false;
  const textPart = extractTelegramPlainText(payload.content);
  return Array.from(textPart).length > CAPTION_LIMIT;
}

module.exports = {
  convertToTelegramHtml,
  restoreImageTokens,
  extractQuotes,
  extractTelegramPlainText,
  willTelegramPlainSplitCaption,
  truncate,
  textLength,
  MESSAGE_LIMIT,
  CAPTION_LIMIT,
};
