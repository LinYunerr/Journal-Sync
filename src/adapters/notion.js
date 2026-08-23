/**
 * Notion adapter
 * Uses the official Notion API directly through Obsidian requestUrl.
 */

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const MAX_RETRIES = 3;
const MAX_BLOCKS_PER_REQUEST = 100;

export const manifest = {
    id: 'notion',
    version: '1.0.0',
    name: 'Notion',
    description: '发送内容到 Notion 页面或 Data Source',
    enabledByDefault: false
};

function getResponseError(response) {
    const json = response?.json || {};
    return json.message || json.error || response?.text || `HTTP ${response?.status || '未知'}`;
}

function getHeader(response, name) {
    const headers = response?.headers;
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    return headers[name] || headers[name.toLowerCase()] || '';
}

function wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

async function notionRequest(requestUrl, token, options, retryCount = 0) {
    const response = await requestUrl({
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
            ...(options.headers || {})
        },
        throw: false
    });

    if ((response.status === 429 || response.status === 529) && retryCount < MAX_RETRIES) {
        const retryAfter = Number(getHeader(response, 'Retry-After'));
        await wait(Math.max(1000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (retryCount + 1)));
        return notionRequest(requestUrl, token, options, retryCount + 1);
    }

    return response;
}

function cleanText(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
}

function pageTitleProperty(title) {
    // A page parent requires a title property. A zero-width space preserves the
    // requested visual no-title behavior while keeping the request valid.
    return { title: { title: richText(title || '\u200B') } };
}

function splitText(text, maxLength = 1900) {
    const value = String(text || '');
    if (!value) return [''];
    const result = [];
    let remaining = value;
    while (remaining.length > maxLength) {
        let at = remaining.lastIndexOf('\n', maxLength);
        if (at < Math.floor(maxLength * 0.6)) at = remaining.lastIndexOf(' ', maxLength);
        if (at < Math.floor(maxLength * 0.6)) at = maxLength;
        result.push(remaining.slice(0, at));
        remaining = remaining.slice(at).replace(/^\s+/, '');
    }
    result.push(remaining);
    return result;
}

function richText(text) {
    return splitText(text).filter(Boolean).map(content => ({ type: 'text', text: { content } }));
}

function paragraph(text) {
    return { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(text) } };
}

function heading(level, text) {
    const type = `heading_${level}`;
    return { object: 'block', type, [type]: { rich_text: richText(text) } };
}

function quote(text) {
    return { object: 'block', type: 'quote', quote: { rich_text: richText(text) } };
}

function code(text, language = 'plain text') {
    return { object: 'block', type: 'code', code: { rich_text: richText(text), language } };
}

function divider() {
    return { object: 'block', type: 'divider', divider: {} };
}

function listItem(type, text, checked) {
    const value = { rich_text: richText(text) };
    if (type === 'to_do') value.checked = Boolean(checked);
    return { object: 'block', type, [type]: value };
}

function parseInline(text) {
    const parts = [];
    const pattern = /(\[([^\]]+)]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_)/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index > cursor) parts.push({ type: 'text', text: { content: text.slice(cursor, match.index) } });
        if (match[2]) parts.push({ type: 'text', text: { content: match[2], link: { url: match[3] } } });
        else if (match[4]) parts.push({ type: 'text', text: { content: match[4] }, annotations: { code: true } });
        else if (match[5] || match[6]) parts.push({ type: 'text', text: { content: match[5] || match[6] }, annotations: { bold: true } });
        else if (match[7]) parts.push({ type: 'text', text: { content: match[7] }, annotations: { strikethrough: true } });
        else parts.push({ type: 'text', text: { content: match[8] || match[9] }, annotations: { italic: true } });
        cursor = pattern.lastIndex;
    }
    if (cursor < text.length) parts.push({ type: 'text', text: { content: text.slice(cursor) } });
    return parts.length ? parts : richText(text);
}

function textBlock(type, text, extra = {}) {
    return { object: 'block', type, [type]: { rich_text: parseInline(text), ...extra } };
}

function normalizeImageCandidate(image) {
    if (!image || typeof image !== 'object') return null;
    if (image.kind === 'external' && /^https?:\/\//i.test(image.url || '')) return { kind: 'external', url: image.url };
    if (image.kind === 'local' && image.fileUploadId) return { kind: 'file_upload', fileUploadId: image.fileUploadId };
    return null;
}

function imageBlock(image) {
    const candidate = normalizeImageCandidate(image);
    if (!candidate) return null;
    const value = candidate.kind === 'external'
        ? { type: 'external', external: { url: candidate.url } }
        : { type: 'file_upload', file_upload: { id: candidate.fileUploadId } };
    return { object: 'block', type: 'image', image: value };
}

function markdownToBlocks(markdown, imagesByToken = {}) {
    const blocks = [];
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    let index = 0;
    let paragraphLines = [];

    const flushParagraph = () => {
        const text = paragraphLines.join('\n').trim();
        if (!text) {
            paragraphLines = [];
            return;
        }
        // Send-modal image tokens may be embedded within a paragraph. Split them
        // here so Notion blocks retain the user's original text/image order.
        const parts = text.split(/(@图片\d+|!\[[^\]]*]\(https?:\/\/[^)]+\))/i);
        for (const part of parts) {
            const imageToken = part.match(/^@图片(\d+)$/);
            const externalImage = part.match(/^!\[[^\]]*]\((https?:\/\/[^)]+)\)$/i);
            if (imageToken && imagesByToken[imageToken[1]]) {
                const block = imageBlock(imagesByToken[imageToken[1]]);
                if (block) blocks.push(block);
            } else if (externalImage) {
                const block = imageBlock({ kind: 'external', url: externalImage[1] });
                if (block) blocks.push(block);
            } else if (part.trim()) {
                blocks.push(textBlock('paragraph', part.trim()));
            }
        }
        paragraphLines = [];
    };

    while (index < lines.length) {
        const line = lines[index];
        const externalImage = line.trim().match(/^!\[[^\]]*]\((https?:\/\/[^)]+)\)$/i);
        if (externalImage) {
            flushParagraph();
            const block = imageBlock({ kind: 'external', url: externalImage[1] });
            if (block) blocks.push(block);
            index += 1;
            continue;
        }
        const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
        if (headingMatch) {
            flushParagraph();
            blocks.push(heading(headingMatch[1].length, headingMatch[2]));
            index += 1;
            continue;
        }
        if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
            flushParagraph();
            blocks.push(divider());
            index += 1;
            continue;
        }
        if (/^```/.test(line)) {
            flushParagraph();
            const language = line.replace(/^```/, '').trim() || 'plain text';
            index += 1;
            const codeLines = [];
            while (index < lines.length && !/^```/.test(lines[index])) codeLines.push(lines[index++]);
            if (index < lines.length) index += 1;
            blocks.push(code(codeLines.join('\n'), language));
            continue;
        }
        const todoMatch = line.match(/^\s*-\s+\[([ xX])]\s+(.+)$/);
        if (todoMatch) {
            flushParagraph();
            blocks.push(listItem('to_do', todoMatch[2], /x/i.test(todoMatch[1])));
            index += 1;
            continue;
        }
        const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
        if (bulletMatch) {
            flushParagraph();
            blocks.push(listItem('bulleted_list_item', bulletMatch[1]));
            index += 1;
            continue;
        }
        const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
        if (orderedMatch) {
            flushParagraph();
            blocks.push(listItem('numbered_list_item', orderedMatch[1]));
            index += 1;
            continue;
        }
        const quoteMatch = line.match(/^>\s?(.*)$/);
        if (quoteMatch) {
            flushParagraph();
            blocks.push(quote(quoteMatch[1]));
            index += 1;
            continue;
        }
        if (!line.trim()) {
            flushParagraph();
            index += 1;
            continue;
        }
        paragraphLines.push(line);
        index += 1;
    }
    flushParagraph();
    return blocks;
}

function getPageTitle(page) {
    const properties = page?.properties || {};
    for (const value of Object.values(properties)) {
        if (value?.type === 'title') return (value.title || []).map(item => item.plain_text || item.text?.content || '').join('');
    }
    return '';
}

async function uploadFile(requestUrl, token, file) {
    const createResponse = await notionRequest(requestUrl, token, {
        url: `${NOTION_API_BASE}/file_uploads`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'single_part', filename: file.filename, content_type: file.mimeType }),
        throw: false
    });
    if (createResponse.status < 200 || createResponse.status >= 300) throw new Error(`图片 ${file.filename} 创建上传失败：${getResponseError(createResponse)}`);
    const fileUploadId = createResponse.json?.id;
    if (!fileUploadId) throw new Error(`图片 ${file.filename} 创建上传失败：未返回上传 ID`);

    const boundary = `----JournalSyncNotion${Date.now()}${Math.random().toString(16).slice(2)}`;
    const safeFilename = String(file.filename || 'image').replace(/[\"\r\n]/g, '_');
    const mimeType = file.mimeType || 'application/octet-stream';
    const encoder = new TextEncoder();
    const prefix = encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
    const binary = new Uint8Array(file.buffer);
    const body = new Uint8Array(prefix.byteLength + binary.byteLength + suffix.byteLength);
    body.set(prefix, 0);
    body.set(binary, prefix.byteLength);
    body.set(suffix, prefix.byteLength + binary.byteLength);

    const sendResponse = await notionRequest(requestUrl, token, {
        url: `${NOTION_API_BASE}/file_uploads/${fileUploadId}/send`,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: body.buffer,
        throw: false
    });
    if (sendResponse.status < 200 || sendResponse.status >= 300) throw new Error(`图片 ${file.filename} 上传失败：${getResponseError(sendResponse)}`);
    return fileUploadId;
}

async function prepareImages({ requestUrl, token, localImages = [], externalImages = [] }) {
    const localByToken = {};
    for (const image of localImages) {
        const id = await uploadFile(requestUrl, token, image);
        localByToken[image.token] = { kind: 'local', fileUploadId: id };
    }
    return { ...localByToken, ...externalImages };
}

async function appendBlocks(requestUrl, token, pageId, children) {
    for (let index = 0; index < children.length; index += MAX_BLOCKS_PER_REQUEST) {
        const response = await notionRequest(requestUrl, token, {
            url: `${NOTION_API_BASE}/blocks/${pageId}/children`,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ children: children.slice(index, index + MAX_BLOCKS_PER_REQUEST) }),
            throw: false
        });
        if (response.status < 200 || response.status >= 300) throw new Error(getResponseError(response));
    }
}

async function findDailyPage(requestUrl, token, parentPageId, dateTitle) {
    // Search is eventually consistent and can miss a page created manually or
    // moments ago. Enumerating the configured parent's child blocks is exact.
    const matches = [];
    let cursor = '';
    do {
        const params = new URLSearchParams({ page_size: '100' });
        if (cursor) params.set('start_cursor', cursor);
        const response = await notionRequest(requestUrl, token, {
            url: `${NOTION_API_BASE}/blocks/${parentPageId}/children?${params.toString()}`,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            throw: false
        });
        if (response.status < 200 || response.status >= 300) throw new Error(getResponseError(response));
        for (const block of response.json?.results || []) {
            if (block?.type === 'child_page' && String(block.child_page?.title || '').trim() === dateTitle) {
                matches.push({ id: block.id });
            }
        }
        cursor = response.json?.has_more ? String(response.json?.next_cursor || '') : '';
    } while (cursor);

    if (matches.length > 1) throw new Error(`Notion 中找到多个“${dateTitle}”每日页面，请保留一个后重试`);
    return matches[0] || null;
}

async function createPage(requestUrl, token, parent, title, children) {
    const properties = parent.type === 'data_source_id'
        ? { [parent.titleProperty]: { title: richText(title) } }
        : undefined;
    const body = {
        parent: parent.type === 'data_source_id' ? { data_source_id: parent.id } : { page_id: parent.id },
        ...(properties ? { properties } : {}),
        ...(children.length <= MAX_BLOCKS_PER_REQUEST ? { children } : {})
    };
    if (!properties) body.properties = pageTitleProperty(title);
    const response = await notionRequest(requestUrl, token, {
        url: `${NOTION_API_BASE}/pages`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        throw: false
    });
    if (response.status < 200 || response.status >= 300) throw new Error(getResponseError(response));
    const pageId = response.json?.id;
    if (!pageId) throw new Error('Notion 未返回新页面 ID');
    if (children.length > MAX_BLOCKS_PER_REQUEST) await appendBlocks(requestUrl, token, pageId, children);
    return pageId;
}

export async function execute({ config = {}, requestUrl, content, title = '', localImages = [], externalImages = [] }) {
    const token = String(config.token || '').trim();
    if (!token) return { success: false, error: 'Notion Token 未配置' };
    if (!requestUrl) return { success: false, error: 'Notion 请求接口不可用' };

    try {
        const imageMap = await prepareImages({ requestUrl, token, localImages, externalImages });
        const children = markdownToBlocks(content, imageMap);
        const targetType = config.targetType || 'page';
        const normalizedTitle = cleanText(title);

        if (targetType === 'database') {
            if (!config.dataSourceId || !config.titleProperty) return { success: false, error: 'Notion Data Source ID 或标题字段未配置' };
            const pageId = await createPage(requestUrl, token, { type: 'data_source_id', id: config.dataSourceId, titleProperty: config.titleProperty }, normalizedTitle, children);
            return { success: true, pageId };
        }

        if (!config.pageId) return { success: false, error: 'Notion 父页面 ID 未配置' };
        if (config.pageWriteMode === 'daily_append') {
            const today = new Date();
            const dateTitle = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const appendChildren = normalizedTitle ? [heading(2, normalizedTitle), ...children, divider()] : [...children, divider()];
            let dailyPage = await findDailyPage(requestUrl, token, config.pageId, dateTitle);
            if (!dailyPage) {
                const pageId = await createPage(requestUrl, token, { type: 'page_id', id: config.pageId }, dateTitle, appendChildren);
                return { success: true, pageId, daily: true };
            }
            await appendBlocks(requestUrl, token, dailyPage.id, appendChildren);
            return { success: true, pageId: dailyPage.id, daily: true };
        }

        const pageId = await createPage(requestUrl, token, { type: 'page_id', id: config.pageId }, normalizedTitle, children);
        return { success: true, pageId };
    } catch (error) {
        return { success: false, error: error.message || String(error) };
    }
}

export async function retrieveDataSource({ config = {}, requestUrl }) {
    const token = String(config.token || '').trim();
    const dataSourceId = String(config.dataSourceId || '').trim();
    if (!token || !dataSourceId) throw new Error('请先填写 Notion Token 和 Data Source ID');
    const response = await notionRequest(requestUrl, token, {
        url: `${NOTION_API_BASE}/data_sources/${dataSourceId}`,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        throw: false
    });
    if (response.status < 200 || response.status >= 300) throw new Error(getResponseError(response));
    const properties = response.json?.properties || {};
    const titles = Object.entries(properties)
        .filter(([, property]) => property?.type === 'title')
        .map(([name]) => name);
    return { titles, properties };
}

export default { manifest, execute, retrieveDataSource };
