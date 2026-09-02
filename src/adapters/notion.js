/**
 * Notion adapter
 * Uses the official Notion API directly through Obsidian requestUrl.
 * 图片压缩、标题来源选择等逻辑已内化到适配器内部。
 */
import { Setting, Notice } from 'obsidian';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const MAX_RETRIES = 3;
const MAX_BLOCKS_PER_REQUEST = 100;

export const manifest = {
    id: 'notion',
    version: '1.0.0',
    name: 'Notion',
    description: '发送内容到 Notion 页面或 Data Source',
    enabledByDefault: false,
    displayOrder: 70,
    capabilities: {
        text: true,
        attachments: true,
        attachmentTypes: ['image/*'],
        maxAttachments: 100,
        maxAttachmentSize: 5 * 1024 * 1024,
        warnOnAttachmentCount: false,
        warnOnAttachmentSize: true
    }
};
const MAX_NOTION_ATTACHMENT_SIZE = manifest.capabilities.maxAttachmentSize;

/**
 * 适配器默认配置（设置系统初始值，优先于 manifest.settings.fields 的 default）
 */
export const defaultConfig = {
    targetType: 'page',
    pageWriteMode: 'new_page',
    titleSource: 'scope',
    autoCompressLargeImages: false
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

    if (matches.length > 1) throw new Error(`Notion 中找到多个"${dateTitle}"每日页面，请保留一个后重试`);
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

// ── 图片压缩（从 main.js 移入） ──────────────

function getImageMimeType(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
    return types[ext] || 'application/octet-stream';
}

async function compressImageToWebp(arrayBuffer, mimeType) {
    const source = new Blob([arrayBuffer], { type: mimeType });
    const bitmap = await createImageBitmap(source);
    const maxDimension = 2560;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    return blob ? await blob.arrayBuffer() : null;
}

/**
 * 从 payload.attachments 准备 Notion 本地图片列表。
 * 包含自动压缩逻辑（超过 5MB 的图片压缩为 WebP）。
 */
async function prepareLocalImages(payload, autoCompress) {
    const localImages = [];
    const warnings = [];
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

    for (let index = 0; index < attachments.length; index += 1) {
        const img = attachments[index];
        if (img.kind !== 'image') continue;
        const vaultPath = img.vaultPath || img.filename;
        if (!vaultPath || typeof payload.readAttachment !== 'function') continue;

        const buffer = await payload.readAttachment(vaultPath);
        if (!buffer) throw new Error(`无法读取图片：${img.filename || vaultPath}`);

        const source = new Uint8Array(buffer);
        let uploadBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
        let filename = img.filename || `image-${index + 1}`;
        let mimeType = getImageMimeType(filename);
        const originalBytes = source.byteLength;

        if (originalBytes > MAX_NOTION_ATTACHMENT_SIZE) {
            warnings.push({ filename, bytes: originalBytes, canCompress: /^(image\/(png|jpe?g|webp))$/i.test(mimeType) });
            if (autoCompress && /^(image\/(png|jpe?g|webp))$/i.test(mimeType)) {
                const compressed = await compressImageToWebp(uploadBuffer, mimeType);
                if (compressed && compressed.byteLength < originalBytes) {
                    uploadBuffer = compressed;
                    filename = filename.replace(/\.[^.]+$/, '') + '.webp';
                    mimeType = 'image/webp';
                }
            }
        }

        const tokenMatch = String(img.token || '').match(/^@图片(\d+)$/);
        localImages.push({
            token: tokenMatch ? tokenMatch[1] : String(index + 1),
            filename,
            mimeType,
            buffer: uploadBuffer
        });
    }

    return { localImages, warnings };
}

/**
 * 根据 config.titleSource 决定最终标题。
 * - 'scope': 使用 payload.title（来自发送范围标题/文件名）
 * - 'first_heading': 从正文提取第一个 Markdown 标题
 * - 'none': 不设标题
 */
function resolveTitle(config, payload) {
    const titleSource = config.titleSource || 'scope';
    if (titleSource === 'none') return '';
    if (titleSource === 'first_heading') {
        const headingMatch = String(payload.content || '').match(/^#\s+(.+)$/m);
        return headingMatch ? headingMatch[1].trim() : '';
    }
    return String(payload.title || '');
}

/**
 * 预检验证
 */
export async function validate({ payload }) {
    const warnings = [];
    const errors = [];

    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const images = attachments.filter(a => a.kind === 'image');

    for (const img of images) {
        // 预检无法知道文件大小（需要读取），只检查类型
        const ext = String(img.filename || '').split('.').pop().toLowerCase();
        if (!['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) {
            warnings.push(`Notion 可能不支持图片格式：${img.filename}`);
        }
    }

    return { warnings, errors };
}

/**
 * 统一执行接口
 * @param {object} options
 * @param {object} options.config - Notion 配置 { token, pageId, targetType, pageWriteMode, titleSource, ... }
 * @param {object} options.payload - 统一 payload { content, title, attachments, readAttachment }
 * @param {Function} options.requestUrl
 */
export async function execute({ config = {}, payload = {}, requestUrl }) {
    const token = String(config.token || '').trim();
    if (!token) return { success: false, error: 'Notion Token 未配置' };
    if (!requestUrl) return { success: false, error: 'Notion 请求接口不可用' };

    try {
        // 准备图片（含压缩）
        const autoCompress = Boolean(config.autoCompressLargeImages);
        const { localImages, warnings: imageWarnings } = await prepareLocalImages(payload, autoCompress);
        const imageMap = await prepareImages({ requestUrl, token, localImages, externalImages: {} });

        // 构建内容块
        const children = markdownToBlocks(payload.content, imageMap);

        // 解析标题
        const title = resolveTitle(config, payload);
        const normalizedTitle = cleanText(title);

        const targetType = config.targetType || 'page';

        if (targetType === 'database') {
            if (!config.dataSourceId || !config.titleProperty) return { success: false, error: 'Notion Data Source ID 或标题字段未配置' };
            const pageId = await createPage(requestUrl, token, { type: 'data_source_id', id: config.dataSourceId, titleProperty: config.titleProperty }, normalizedTitle, children);
            return { success: true, pageId, warnings: imageWarnings.map(item => `${item.filename} 超过 ${Math.round(MAX_NOTION_ATTACHMENT_SIZE / 1024 / 1024)} MB 预警阈值`) };
        }

        if (!config.pageId) return { success: false, error: 'Notion 父页面 ID 未配置' };
        if (config.pageWriteMode === 'daily_append') {
            const today = new Date();
            const dateTitle = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const appendChildren = normalizedTitle ? [heading(2, normalizedTitle), ...children, divider()] : [...children, divider()];
            let dailyPage = await findDailyPage(requestUrl, token, config.pageId, dateTitle);
            if (!dailyPage) {
                const pageId = await createPage(requestUrl, token, { type: 'page_id', id: config.pageId }, dateTitle, appendChildren);
                return { success: true, pageId, daily: true, warnings: imageWarnings.map(item => `${item.filename} 超过 ${Math.round(MAX_NOTION_ATTACHMENT_SIZE / 1024 / 1024)} MB 预警阈值`) };
            }
            await appendBlocks(requestUrl, token, dailyPage.id, appendChildren);
            return { success: true, pageId: dailyPage.id, daily: true, warnings: imageWarnings.map(item => `${item.filename} 超过 ${Math.round(MAX_NOTION_ATTACHMENT_SIZE / 1024 / 1024)} MB 预警阈值`) };
        }

        const pageId = await createPage(requestUrl, token, { type: 'page_id', id: config.pageId }, normalizedTitle, children);
        return { success: true, pageId, warnings: imageWarnings.map(item => `${item.filename} 超过 ${Math.round(MAX_NOTION_ATTACHMENT_SIZE / 1024 / 1024)} MB 预警阈值`) };
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

/**
 * Notion 自定义设置面板（设置页在「启用 Notion」后调用，启用开关由设置页渲染）
 * @param {HTMLElement} containerEl
 * @param {object} ctx - { plugin, containerEl, scheduleConfigSave(patch), saveConfig(patch), refresh(), requestUrl }
 */
export function renderSettings(containerEl, ctx) {
    const config = ctx.plugin.getAdapterConfig('notion') || {};

    new Setting(containerEl)
        .setName('Notion Token')
        .setDesc('使用 Notion Personal Access Token，仅保存在 Obsidian 插件设置中。')
        .addText(text => {
            text.inputEl.type = 'password';
            text.setPlaceholder('ntn_...').setValue(config.token || '').onChange(value => {
                ctx.scheduleConfigSave({ token: value.trim() });
            });
        });

    new Setting(containerEl)
        .setName('保存目标')
        .setDesc('选择每次发送创建 Notion 页面，或在 Data Source 中创建一条记录页面。')
        .addDropdown(dropdown => dropdown
            .addOption('page', '保存为页面')
            .addOption('database', '保存到数据库')
            .setValue(config.targetType || 'page')
            .onChange(async value => {
                await ctx.saveConfig({ targetType: value });
                ctx.refresh();
            }));

    if ((config.targetType || 'page') === 'page') {
        new Setting(containerEl)
            .setName('日记父页面 Page ID')
            .setDesc('创建子页面或每日页面的 Notion 父页面 ID。请先将该页面连接到你的 Notion Integration。')
            .addText(text => text.setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx').setValue(config.pageId || '').onChange(value => {
                ctx.scheduleConfigSave({ pageId: value.trim() });
            }));
        new Setting(containerEl)
            .setName('页面写入方式')
            .setDesc('新建子页面会为每次发送创建一个页面；每日追加会查找或创建当天 YYYY-MM-DD 页面并持续追加内容。')
            .addDropdown(dropdown => dropdown
                .addOption('new_page', '每次新建子页面')
                .addOption('daily_append', '追加到每日日记页面')
                .setValue(config.pageWriteMode || 'new_page')
                .onChange(async value => {
                    await ctx.saveConfig({ pageWriteMode: value });
                    ctx.refresh();
                }));
        if ((config.pageWriteMode || 'new_page') === 'new_page') {
            new Setting(containerEl)
                .setName('页面标题来源')
                .setDesc('按发送范围标题：标题块用该标题，整页用文件名，选中文本允许无标题。正文首标题：从正文第一个 Markdown 标题取名。无标题：不设置标题。')
                .addDropdown(dropdown => dropdown
                    .addOption('scope', '按发送范围标题')
                    .addOption('first_heading', '按正文第一个标题')
                    .addOption('none', '无标题')
                    .setValue(config.titleSource || 'scope')
                    .onChange(async value => ctx.saveConfig({ titleSource: value })));
        }
    } else {
        new Setting(containerEl)
            .setName('Data Source ID')
            .setDesc('目标 Notion Data Source 的 ID，而不是旧版教程中的 database ID。')
            .addText(text => text.setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx').setValue(config.dataSourceId || '').onChange(value => {
                ctx.scheduleConfigSave({ dataSourceId: value.trim() });
            }));
        new Setting(containerEl)
            .setName('读取标题字段')
            .setDesc(config.titleProperty ? `当前标题字段：${config.titleProperty}` : '读取 Data Source 后选择 title 类型字段。')
            .addButton(button => button.setButtonText('读取字段').onClick(async () => {
                try {
                    button.setButtonText('读取中...');
                    button.disabled = true;
                    const result = await retrieveDataSource({ config: ctx.plugin.getAdapterConfig('notion'), requestUrl: ctx.requestUrl });
                    if (result.titles.length === 0) throw new Error('该 Data Source 没有 title 类型字段');
                    const activeConfig = ctx.plugin.getAdapterConfig('notion');
                    const selected = result.titles.includes(activeConfig.titleProperty) ? activeConfig.titleProperty : result.titles[0];
                    await ctx.saveConfig({ titleProperty: selected, titleProperties: result.titles });
                    new Notice(`已读取 ${result.titles.length} 个标题字段`);
                    ctx.refresh();
                } catch (error) {
                    new Notice(`读取 Notion 字段失败：${error.message}`);
                } finally {
                    button.setButtonText('读取字段');
                    button.disabled = false;
                }
            }));
        const titleProperties = Array.isArray(config.titleProperties) ? config.titleProperties : [];
        if (titleProperties.length > 0) {
            new Setting(containerEl)
                .setName('数据库标题字段')
                .setDesc('每条数据库记录均会创建一个完整页面，正文和图片写入该页面的 blocks。')
                .addDropdown(dropdown => {
                    for (const property of titleProperties) dropdown.addOption(property, property);
                    dropdown.setValue(config.titleProperty || titleProperties[0]).onChange(async value => {
                        await ctx.saveConfig({ titleProperty: value });
                    });
                });
        }
        new Setting(containerEl)
            .setName('页面标题来源')
            .setDesc('标题块使用该标题，整页使用文件名，选中文本允许无标题。')
            .addDropdown(dropdown => dropdown
                .addOption('scope', '按发送范围标题')
                .addOption('first_heading', '按正文第一个标题')
                .addOption('none', '无标题')
                .setValue(config.titleSource || 'scope')
                .onChange(async value => ctx.saveConfig({ titleSource: value })));
    }

    new Setting(containerEl)
        .setName('超过 5 MB 时自动压缩图片')
        .setDesc('发送前在内存中将可处理的 JPEG、PNG、WebP 压缩为 WebP，不会修改 Vault 原文件。GIF 和 SVG 不压缩。')
        .addToggle(toggle => toggle.setValue(Boolean(config.autoCompressLargeImages)).onChange(async value => {
            await ctx.saveConfig({ autoCompressLargeImages: value });
        }));
}

export default { manifest, execute, validate, retrieveDataSource, renderSettings, defaultConfig };
