/**
 * Telegram 适配器
 * 对照原 telegram_send.py 完全还原：
 * 1. 单图使用 sendPhoto 上传
 * 2. 多图使用 sendMediaGroup 组合 Album 发送
 * 3. 详细抓取 Telegram 官方 API 返回的 error description
 * 4. 支持纯文本直传与本地图片富文本混排
 *
 * 三种发送模式（纯内部逻辑，管道不需要知道）：
 * - plain:  纯文本 + 图片附件
 * - rich:   富文本图文混排（sendRichMessage）
 * - telegraph: 创建 Telegraph 页面，将链接发送到频道
 */

const TG_API_BASE = 'https://api.telegram.org';

const telegraph = require('../core/telegraph');

export const manifest = {
    id: 'telegram',
    version: '2.0.0',
    name: 'Telegram',
    description: '发送内容到 Telegram 频道',
    enabledByDefault: false,
    capabilities: {
        text: true,
        attachments: true,
        attachmentTypes: ['image/*'],
        maxAttachments: 9,
        maxAttachmentSize: 0,
        warnOnAttachmentCount: true,
        warnOnAttachmentSize: false
    },
    settings: {
        fields: [
            {
                key: 'botToken',
                type: 'password',
                label: 'Bot Token',
                required: true,
                placeholder: '输入你的 Telegram Bot Token'
            },
            {
                key: 'channels',
                type: 'info',
                label: '频道列表',
                description: '在插件设置中点击「获取频道列表」按钮自动发现'
            },
            {
                key: 'homeChannels',
                type: 'checkboxGroup',
                label: '默认发送频道',
                description: '勾选在发送面板中默认出现的频道'
            },
            {
                key: 'showLinkPreview',
                type: 'boolean',
                label: '普通发送时显示网址预览',
                description: '关闭后，Telegram 普通文本消息不会展开网址预览。',
                default: true
            }
        ]
    }
};
const MAX_TELEGRAM_IMAGES = manifest.capabilities.maxAttachments;

// ── Telegram Bot API ──────────────────────────

async function tgApi(botToken, method, body, requestUrlFn) {
    const url = `${TG_API_BASE}/bot${botToken}/${method}`;
    const response = await requestUrlFn({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        throw: false
    });

    let result = {};
    try { result = response.json || {}; } catch {}
    return { status: response.status, result };
}

/**
 * 获取 Bot 可访问的频道列表
 */
export async function listChannels(botToken, existingChannels = [], requestUrlFn) {
    if (!botToken) throw new Error('Bot Token 未配置');

    const channelMap = new Map();

    const initialChannels = Array.isArray(existingChannels) ? existingChannels : [];

    for (const ch of initialChannels) {
        const chId = String(ch.id || ch);
        if (!chId) continue;
        channelMap.set(chId, {
            id: chId,
            title: ch.title || chId,
            type: ch.type || 'channel',
            username: ch.username ? (ch.username.startsWith('@') ? ch.username : `@${ch.username}`) : null
        });
    }

    try {
        const { status, result } = await tgApi(botToken, 'getUpdates', {
            limit: 100,
            allowed_updates: ['channel_post', 'my_chat_member', 'message']
        }, requestUrlFn);

        if (status >= 200 && status < 300 && result?.ok) {
            for (const update of (result.result || [])) {
                const chat = update.channel_post?.chat || update.message?.chat || update.my_chat_member?.chat;
                if (!chat) continue;
                if (chat.type !== 'channel' && chat.type !== 'supergroup' && chat.type !== 'group') continue;
                const id = String(chat.id);
                channelMap.set(id, {
                    id,
                    title: chat.title || chat.username || id,
                    type: chat.type,
                    username: chat.username ? `@${chat.username}` : null
                });
            }
        }
    } catch {}

    for (const [chId, chInfo] of Array.from(channelMap.entries())) {
        try {
            const ref = chInfo.username || chId;
            const { status, result } = await tgApi(botToken, 'getChat', { chat_id: ref }, requestUrlFn);
            if (status >= 200 && status < 300 && result?.ok && result.result) {
                const chat = result.result;
                const actualId = String(chat.id || chId);
                channelMap.set(actualId, {
                    id: actualId,
                    title: chat.title || chat.username || chInfo.title,
                    type: chat.type || 'channel',
                    username: chat.username ? `@${chat.username}` : (chInfo.username || null)
                });
            }
        } catch {}
    }

    return Array.from(channelMap.values());
}

// ── 文本发送 ──────────────────────────────────

async function sendSingleTextMessage(botToken, chatId, text, options, requestUrlFn) {
    if (!text || !text.trim()) return { success: true };

    const body = {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: !options?.showLinkPreview }
    };

    const { status, result } = await tgApi(botToken, 'sendMessage', body, requestUrlFn);

    if (!result.ok) {
        const errorDesc = String(result.description || result.result?.description || '').toUpperCase();
        if (errorDesc.includes('WEBPAGE_CURL_FAILED')) {
            body.link_preview_options = { is_disabled: true };
            const retryRes = await tgApi(botToken, 'sendMessage', body, requestUrlFn);
            if (retryRes.result.ok) return { success: true };
        }

        delete body.parse_mode;
        const { status: s2, result: r2 } = await tgApi(botToken, 'sendMessage', body, requestUrlFn);
        if (!r2.ok) {
            const errorDesc2 = String(r2.description || r2.result?.description || '').toUpperCase();
            if (errorDesc2.includes('WEBPAGE_CURL_FAILED')) {
                body.link_preview_options = { is_disabled: true };
                const finalRes = await tgApi(botToken, 'sendMessage', body, requestUrlFn);
                if (finalRes.result.ok) return { success: true };
                return { success: false, error: finalRes.result.description || finalRes.description || `sendMessage 失败: HTTP ${finalRes.status}` };
            }
            return { success: false, error: r2.result?.description || r2.description || `sendMessage 失败: HTTP ${s2}` };
        }
    }

    return { success: true };
}

function splitTelegramText(text, maxLength = 4096) {
    const characters = Array.from(String(text || ''));
    const chunks = [];
    let offset = 0;
    while (offset < characters.length) {
        let end = Math.min(offset + maxLength, characters.length);
        if (end < characters.length) {
            const candidate = characters.slice(offset, end).join('');
            const newline = candidate.lastIndexOf('\n');
            const space = candidate.lastIndexOf(' ');
            const boundary = Math.max(newline, space);
            if (boundary >= Math.floor(maxLength * 0.6)) end = offset + Array.from(candidate.slice(0, boundary)).length;
        }
        chunks.push(characters.slice(offset, end).join('').trim());
        offset = end;
        while (offset < characters.length && /\s/.test(characters[offset])) offset += 1;
    }
    return chunks.filter(Boolean);
}

async function sendTextMessage(botToken, chatId, text, options, requestUrlFn) {
    for (const chunk of splitTelegramText(text)) {
        const result = await sendSingleTextMessage(botToken, chatId, chunk, options, requestUrlFn);
        if (!result.success) return result;
    }
    return { success: true };
}

function richCharacterCount(text) {
    return Array.from(String(text || '')).length;
}

// ── 图片发送 ──────────────────────────────────

async function sendPhotoByBuffer(botToken, chatId, arrayBuffer, filename, caption, requestUrlFn) {
    const boundary = `----TgBridge${Date.now()}${Math.random().toString(16).slice(2)}`;
    const ext = filename.split('.').pop().toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'png' ? 'image/png'
        : ext === 'gif' ? 'image/gif'
        : ext === 'webp' ? 'image/webp'
        : 'image/jpeg';

    const encoder = new TextEncoder();
    const parts = [];

    parts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`
    ));

    const safeFilename = `image.${ext}`;
    parts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${safeFilename}"\r\nContent-Type: ${mime}\r\n\r\n`
    ));
    parts.push(new Uint8Array(arrayBuffer));
    parts.push(encoder.encode('\r\n'));

    if (caption && caption.trim()) {
        parts.push(encoder.encode(
            `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.trim()}\r\n`
        ));
        parts.push(encoder.encode(
            `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdown\r\n`
        ));
    }

    parts.push(encoder.encode(`--${boundary}--\r\n`));

    const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        body.set(part, offset);
        offset += part.byteLength;
    }

    const url = `${TG_API_BASE}/bot${botToken}/sendPhoto`;
    const response = await requestUrlFn({
        url,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: body.buffer.slice(0, totalLength),
        throw: false
    });

    let result = {};
    try { result = response.json || {}; } catch {}

    return { status: response.status, result };
}

async function sendMediaGroupByBuffer(botToken, chatId, imageItems, caption, requestUrlFn) {
    const boundary = `----TgBridgeMedia${Date.now()}${Math.random().toString(16).slice(2)}`;
    const encoder = new TextEncoder();
    const parts = [];

    parts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`
    ));

    const mediaList = imageItems.map((item, idx) => {
        const entry = { type: 'photo', media: `attach://photo${idx}` };
        if (idx === 0 && caption && caption.trim()) {
            entry.caption = caption.trim();
            entry.parse_mode = 'Markdown';
        }
        return entry;
    });

    parts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="media"\r\n\r\n${JSON.stringify(mediaList)}\r\n`
    ));

    imageItems.forEach((item, idx) => {
        const filename = item.filename || `photo${idx}.jpg`;
        const ext = filename.split('.').pop().toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'png' ? 'image/png'
            : ext === 'gif' ? 'image/gif'
            : ext === 'webp' ? 'image/webp'
            : 'image/jpeg';

        const safeFilename = `image${idx}.${ext}`;

        parts.push(encoder.encode(
            `--${boundary}\r\nContent-Disposition: form-data; name="photo${idx}"; filename="${safeFilename}"\r\nContent-Type: ${mime}\r\n\r\n`
        ));
        parts.push(new Uint8Array(item.buffer));
        parts.push(encoder.encode('\r\n'));
    });

    parts.push(encoder.encode(`--${boundary}--\r\n`));

    const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        body.set(part, offset);
        offset += part.byteLength;
    }

    const url = `${TG_API_BASE}/bot${botToken}/sendMediaGroup`;
    const response = await requestUrlFn({
        url,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: body.buffer.slice(0, totalLength),
        throw: false
    });

    let result = {};
    try { result = response.json || {}; } catch {}
    return { status: response.status, result, _bodyObj: { caption } };
}

// ── 富文本发送 ────────────────────────────────

function getImageMimeType(filename = '') {
    const ext = String(filename).split('.').pop().toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    return 'application/octet-stream';
}

function buildRichMarkdown(parts) {
    const isPlainText = (block) => {
        const firstLine = block.split('\n').map(line => line.trim()).filter(Boolean)[0] || '';
        const patterns = [
            /^#{1,6}\s+/, /^>/, /^([-*+]\s+|\d+[.)]\s+)/, /^- \[[ xX]\]\s+/,
            /^```/, /^\|/, /^---+$/, /^!\[[^\]]*\]\((?:https?:\/\/|tg:\/\/photo\?id=)[^)]+\)$/,
            /^<(\/?)(p|h[1-6]|blockquote|ul|ol|li|pre|hr|figure|img|video|audio|tg-)\b/
        ];
        return !patterns.some(pattern => pattern.test(firstLine));
    };

    let richText = '';
    let previousIsPlainText = false;
    for (const part of parts) {
        const normalized = String(part || '').replace(/\r\n/g, '\n').trim();
        if (!normalized) continue;
        for (const block of normalized.split(/\n{2,}/)) {
            const current = block.trim();
            if (!current) continue;
            const currentIsPlainText = isPlainText(current);
            if (richText) {
                richText += '\n\n';
                if (previousIsPlainText && currentIsPlainText) richText += '<p>&nbsp;</p>\n\n';
            }
            richText += current;
            previousIsPlainText = currentIsPlainText;
        }
    }
    return richText;
}

async function sendRichMessageWithMedia(botToken, chatId, segments, imageBuffers, requestUrlFn) {
    const boundary = `----TgBridgeRich${Date.now()}${Math.random().toString(16).slice(2)}`;
    const encoder = new TextEncoder();
    const parts = [];
    const media = [];
    const richParts = [];
    let imageIndex = 0;

    for (const seg of segments) {
        if (seg.type === 'richText' || seg.type === 'text') {
            const text = String(seg.markdown || seg.text || '').trim();
            if (text) richParts.push(text);
            continue;
        }
        if (seg.type !== 'image') continue;
        const imageKey = seg.imageKey || seg.vaultPath || seg.filename;
        const buffer = imageBuffers.get(imageKey);
        if (!buffer) continue;

        const mediaId = `image_${imageIndex + 1}`;
        const attachmentName = `file_${imageIndex + 1}`;
        const filename = seg.filename || `image_${imageIndex + 1}.jpg`;
        richParts.push(`![](tg://photo?id=${mediaId})`);
        media.push({
            id: mediaId,
            media: { type: 'photo', media: `attach://${attachmentName}` }
        });
        parts.push({ attachmentName, filename, buffer });
        imageIndex += 1;
    }

    const markdown = buildRichMarkdown(richParts);
    if (!markdown) return { success: false, error: '富文本内容为空，未发送 Telegram 消息' };
    if (richCharacterCount(markdown) > 32768) {
        return { success: false, error: 'Telegram 富文本超过 32768 字符限制' };
    }
    if (media.length > 50) {
        return { success: false, error: 'Telegram 富文本超过 50 个媒体附件限制' };
    }

    const formParts = [];
    formParts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));
    formParts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="rich_message"\r\n\r\n${JSON.stringify({ markdown, media })}\r\n`));
    for (const file of parts) {
        formParts.push(encoder.encode(
            `--${boundary}\r\nContent-Disposition: form-data; name="${file.attachmentName}"; filename="${file.filename.replace(/[\\\"\r\n]/g, '_')}"\r\nContent-Type: ${getImageMimeType(file.filename)}\r\n\r\n`
        ));
        formParts.push(new Uint8Array(file.buffer));
        formParts.push(encoder.encode('\r\n'));
    }
    formParts.push(encoder.encode(`--${boundary}--\r\n`));

    const totalLength = formParts.reduce((sum, part) => sum + part.byteLength, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of formParts) {
        body.set(part, offset);
        offset += part.byteLength;
    }

    const response = await requestUrlFn({
        url: `${TG_API_BASE}/bot${botToken}/sendRichMessage`,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: body.buffer.slice(0, totalLength),
        throw: false
    });
    let result = {};
    try { result = response.json || {}; } catch {}
    return { success: Boolean(result.ok), status: response.status, result, markdown };
}

async function sendRichContent(botToken, chatId, segments, imageBuffers, config, requestUrlFn, isRichText = true) {
    try {
        if (isRichText) {
            const nativeResult = await sendRichMessageWithMedia(botToken, chatId, segments, imageBuffers, requestUrlFn);
            if (nativeResult.success) return { success: true };
            return {
                success: false,
                error: nativeResult.result?.description || nativeResult.result?.result?.description || `sendRichMessage 失败: HTTP ${nativeResult.status}`
            };
        }

        // 纯文本 / 附件模式
        let textPart = '';
        const imageItems = [];

        for (const seg of segments) {
            if (seg.type === 'richText' || seg.type === 'text') {
                const t = String(seg.markdown || seg.text || '').trim();
                if (t) textPart = textPart ? `${textPart}\n\n${t}` : t;
            } else if (seg.type === 'image' && seg.filename) {
                const buf = imageBuffers.get(seg.imageKey || seg.vaultPath || seg.filename);
                if (buf) {
                    imageItems.push({ filename: seg.filename, buffer: buf });
                }
            }
        }

        if (imageItems.length === 0) {
            return await sendTextMessage(botToken, chatId, textPart, config, requestUrlFn);
        }

        const caption = richCharacterCount(textPart) <= 1024 ? textPart : '';
        let textToSendSeparately = caption ? '' : textPart;

        const sendImages = async (items, mediaCaption) => {
            if (items.length === 1) {
                return sendPhotoByBuffer(
                    botToken,
                    chatId,
                    items[0].buffer,
                    items[0].filename,
                    mediaCaption,
                    requestUrlFn
                );
            }
            return sendMediaGroupByBuffer(botToken, chatId, items, mediaCaption, requestUrlFn);
        };

        const chunks = [];
        for (let index = 0; index < imageItems.length;) {
            const remaining = imageItems.length - index;
            const size = remaining === 1 ? 1 : Math.min(10, remaining);
            chunks.push(imageItems.slice(index, index + size));
            index += size;
        }

        for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index];
            const chunkCaption = index === 0 ? caption : '';
            let { status, result } = await sendImages(chunk, chunkCaption);

            if (!result?.ok && chunkCaption) {
                const retry = await sendImages(chunk, '');
                if (retry.result?.ok) {
                    textToSendSeparately = textPart;
                    status = retry.status;
                    result = retry.result;
                }
            }

            if (!result?.ok) {
                const method = chunk.length === 1 ? 'sendPhoto' : 'sendMediaGroup';
                return { success: false, error: result?.description || `${method} 失败: HTTP ${status}` };
            }
        }

        if (textToSendSeparately) {
            const textResult = await sendTextMessage(botToken, chatId, textToSendSeparately, config, requestUrlFn);
            if (!textResult.success) return textResult;
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ── Segment 构建（从 send-modal 移入） ────────

/**
 * 从正文内容和附件列表构建 Telegram segments。
 * 将 @图片N token 处为 image segment，其余为 richText segment。
 */
function buildTelegramSegmentsFromContent(content, attachments) {
    const imageByToken = new Map(
        (Array.isArray(attachments) ? attachments : [])
            .filter(a => a?.token && a?.filename)
            .map(a => [a.token, a])
    );
    const segments = [];
    const tokenPattern = /@图片\d+/g;
    const source = String(content || '');
    let cursor = 0;
    let match;

    const pushText = (text) => {
        const trimmed = text.trim();
        if (trimmed) segments.push({ type: 'richText', markdown: trimmed });
    };

    while ((match = tokenPattern.exec(source)) !== null) {
        if (match.index > cursor) pushText(source.slice(cursor, match.index));
        const img = imageByToken.get(match[0]);
        if (img) {
            segments.push({
                type: 'image',
                filename: img.filename,
                vaultPath: img.vaultPath || img.filename
            });
        }
        cursor = match.index + match[0].length;
    }
    pushText(source.slice(cursor));
    return segments;
}

// ── Telegraph 编排（从 main.js 移入） ─────────

/**
 * 确保 Telegraph access_token 存在，无则自动创建账号
 */
async function ensureTelegraphToken(config, requestUrlFn, saveConfig) {
    if (config.telegraphAccessToken) return config.telegraphAccessToken;

    const account = await telegraph.createAccount('JournalSync', config.telegraphAuthorName || '', requestUrlFn);
    if (typeof saveConfig === 'function') {
        await saveConfig({ telegraphAccessToken: account.access_token });
    }
    return account.access_token;
}

/**
 * Telegraph 发送编排：
 * 1. 确保 access_token
 * 2. 上传本地图片到 telegra.ph/upload
 * 3. Markdown → Telegraph Node
 * 4. createPage → 获得 telegra.ph 链接
 * 5. 链接发送到所有选中的 Telegram 频道
 */
async function executeTelegraphSend({ botToken, config, payload, requestUrl, channelIds, telegraphTitle, titleLevel, showLinkPreview, saveConfig }) {
    // 1. 确保 access_token
    let accessToken;
    try {
        accessToken = await ensureTelegraphToken(config, requestUrl, saveConfig);
    } catch (error) {
        return { success: false, error: `Telegraph 账号创建失败: ${error.message}` };
    }

    const authorName = config.telegraphAuthorName || '';

    // 2. 上传本地图片，构建 @图片N → 公网 URL 映射
    const imageUrls = new Map();
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

    for (const img of attachments) {
        const token = img.token;
        const vaultPath = img.vaultPath || img.filename;
        if (!token || !vaultPath) continue;

        if (/^https?:\/\//i.test(vaultPath)) {
            imageUrls.set(token, vaultPath);
            continue;
        }

        try {
            const buffer = typeof payload.readAttachment === 'function' ? await payload.readAttachment(vaultPath) : null;
            if (!buffer) {
                return { success: false, error: `无法读取图片: ${img.filename || vaultPath}` };
            }
            const url = await telegraph.uploadImage(buffer, img.filename || 'image.jpg', requestUrl);
            imageUrls.set(token, url);
        } catch (error) {
            return { success: false, error: `图片上传失败 (${img.filename || vaultPath}): ${error.message}` };
        }
    }

    // 3. Markdown → Telegraph Node
    const titleLevelNum = Math.max(1, Math.min(6, Number(titleLevel) || 1));
    const { title: extractedTitle, content: nodes } = telegraph.markdownToNodes(payload.content, imageUrls, titleLevelNum);

    const finalTitle = telegraphTitle || extractedTitle || 'Journal Sync';

    // 4. createPage
    let pageUrl;
    try {
        const page = await telegraph.createPage(accessToken, finalTitle, nodes, authorName, '', requestUrl);
        pageUrl = page.url;
    } catch (error) {
        return { success: false, error: `Telegraph 创建页面失败: ${error.message}` };
    }

    // 5. 将链接发送到所有选中的 Telegram 频道
    if (!botToken) {
        return { success: false, error: 'Telegram Bot Token 未配置', url: pageUrl };
    }

    const targets = Array.isArray(channelIds) && channelIds.length > 0
        ? channelIds.map(String)
        : [];

    if (targets.length === 0) {
        return { success: false, error: 'Telegram 频道未配置', url: pageUrl };
    }

    const linkPreviewEnabled = showLinkPreview !== undefined ? showLinkPreview : (config.showLinkPreview !== false);
    const linkText = `${finalTitle}\n${pageUrl}`;

    const results = await Promise.all(targets.map(async targetCh => {
        try {
            const response = await requestUrl({
                url: `${TG_API_BASE}/bot${botToken}/sendMessage`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: targetCh,
                    text: linkText,
                    disable_web_page_preview: !linkPreviewEnabled
                }),
                throw: false
            });
            const data = response.json;
            if (!data || !data.ok) {
                return { success: false, channelId: targetCh, error: data?.description || '发送失败' };
            }
            return { success: true, channelId: targetCh };
        } catch (error) {
            return { success: false, channelId: targetCh, error: error.message || String(error) };
        }
    }));

    const allOk = results.every(r => r.success);
    const errors = results
        .filter(r => !r.success)
        .map(r => `${r.channelId}: ${r.error}`)
        .join('; ');

    return {
        success: allOk,
        error: allOk ? undefined : errors,
        url: pageUrl,
        results
    };
}

// ── 预检验证 ──────────────────────────────────

/**
 * 预检验证
 */
export async function validate({ payload, config }) {
    const warnings = [];
    const errors = [];

    const channelIds = Array.isArray(config.channelIds) ? config.channelIds : [];
    if (channelIds.length === 0 && !(Array.isArray(config.homeChannels) && config.homeChannels.length > 0)) {
        warnings.push('Telegram 频道未选择');
    }

    return { warnings, errors };
}

// ── 统一执行接口 ──────────────────────────────

/**
 * 统一执行接口
 * @param {object} options
 * @param {object} options.config - Telegram 配置（含 botToken, channels, tgSendMode, channelIds, ...）
 * @param {object} options.payload - 统一 payload { content, plainText, attachments, readAttachment }
 * @param {Function} options.requestUrl
 * @param {Function} [options.saveConfig] - 保存配置回调（用于 Telegraph token 持久化）
 */
export async function execute({ config = {}, payload = {}, requestUrl, saveConfig }) {
    const botToken = config.botToken;
    if (!botToken) {
        return { success: false, error: 'Telegram Bot Token 未配置' };
    }

    const warnings = [];
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const imageCount = attachments.filter(item => item?.kind === 'image').length;
    let effectivePayload = payload;
    if (imageCount > MAX_TELEGRAM_IMAGES) {
        let keptImages = 0;
        const limitedAttachments = attachments.filter(item => {
            if (item?.kind !== 'image') return true;
            keptImages += 1;
            return keptImages <= MAX_TELEGRAM_IMAGES;
        });
        effectivePayload = { ...payload, attachments: limitedAttachments };
        warnings.push(`超过 ${MAX_TELEGRAM_IMAGES} 张图片，只发送前 ${MAX_TELEGRAM_IMAGES} 张`);
    }

    // 发送模式、频道和 Telegraph 临时选项均来自本次 config 覆盖或持久化配置。
    const tgSendMode = config.tgSendMode || 'plain';  // 'plain' | 'rich' | 'telegraph'
    const isRich = tgSendMode === 'rich';
    const isTelegraph = tgSendMode === 'telegraph';
    const channelIds = (Array.isArray(config.channelIds) ? config.channelIds : []).map(String);

    if (channelIds.length === 0) {
        const homeChannelIds = Array.isArray(config.homeChannels) ? config.homeChannels.map(String) : [];
        const configuredChannels = Array.isArray(config.channels) ? config.channels : [];
        const firstHomeChannel = homeChannelIds.find(Boolean);
        const firstKnownChannel = configuredChannels.find(c => c?.id)?.id;
        if (firstHomeChannel || firstKnownChannel) {
            channelIds.push(String(firstHomeChannel || firstKnownChannel));
        }
    }

    if (channelIds.length === 0) {
        return { success: false, error: 'Telegram 频道未配置，请先在设置中获取频道列表' };
    }

    // ── Telegraph 模式 ──
    if (isTelegraph) {
        const result = await executeTelegraphSend({
            botToken,
            config,
            payload: effectivePayload,
            requestUrl,
            channelIds,
            telegraphTitle: config.telegraphTitle || '',
            titleLevel: config.telegraphTitleLevel || 1,
            showLinkPreview: config.showLinkPreview,
            saveConfig
        });
        return warnings.length > 0
            ? { ...result, warnings: [...(result.warnings || []), ...warnings] }
            : result;
    }

    // ── Plain / Rich 模式 ──
    const segments = buildTelegramSegmentsFromContent(effectivePayload.content, effectivePayload.attachments);

    // 收集需要加载的图片 Buffer
    const imageBuffers = new Map();
    const missingImages = new Set();
    for (const seg of segments) {
        const imageKey = seg.vaultPath || seg.filename;
        if (seg.type !== 'image' || !seg.filename || !imageKey || imageBuffers.has(imageKey) || missingImages.has(imageKey)) continue;
        if (typeof payload.readAttachment !== 'function') {
            missingImages.add(imageKey);
            continue;
        }
        try {
            const buffer = await payload.readAttachment(imageKey);
            if (buffer) imageBuffers.set(imageKey, buffer);
            else missingImages.add(imageKey);
        } catch {
            missingImages.add(imageKey);
        }
    }
    if (missingImages.size > 0) {
        return {
            success: false,
            error: `无法读取 Telegram 图片：${Array.from(missingImages).join('、')}`
        };
    }

    const resolvedSegments = segments.map(segment => {
        if (segment.type !== 'image') return segment;
        return { ...segment, imageKey: segment.vaultPath || segment.filename };
    });

    const effectiveConfig = { showLinkPreview: config.showLinkPreview };
    const results = await Promise.all(channelIds.map(async targetCh => {
        try {
            const res = await sendRichContent(botToken, targetCh, resolvedSegments, imageBuffers, effectiveConfig, requestUrl, isRich);
            return { channelId: targetCh, ...res };
        } catch (error) {
            return { success: false, channelId: targetCh, error: error.message || String(error) };
        }
    }));

    const allOk = results.every(result => result.success);
    const errors = results
        .filter(result => !result.success)
        .map(result => `${result.channelId}: ${result.error || result.message || '未知错误'}`)
        .join('; ');

    return {
        success: allOk,
        error: allOk ? undefined : errors,
        results,
        warnings
    };

}
/**
 * 运行配置相关操作
 */
export async function runAction(actionId, config, requestUrlFn) {
    if (actionId === 'discoverChannels' || actionId === 'testConnection') {
        if (!config?.botToken) throw new Error('Bot Token 未配置');
        const channels = await listChannels(config.botToken, config.channels || [], requestUrlFn);
        return {
            success: true,
            message: channels.length > 0
                ? `找到 ${channels.length} 个可用频道`
                : '连接成功，但暂未发现可用频道',
            data: { channels }
        };
    }
    throw new Error(`未知操作: ${actionId}`);
}

export default { manifest, execute, validate, listChannels, runAction };
