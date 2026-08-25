/**
 * Telegram 适配器
 * 对照原 telegram_send.py 完全还原：
 * 1. 单图使用 sendPhoto 上传
 * 2. 多图使用 sendMediaGroup 组合 Album 发送
 * 3. 详细抓取 Telegram 官方 API 返回的 error description
 * 4. 支持纯文本直传与本地图片富文本混排
 */

const TG_API_BASE = 'https://api.telegram.org';

export const manifest = {
    id: 'telegram',
    version: '2.0.0',
    name: 'Telegram',
    description: '发送内容到 Telegram 频道',
    enabledByDefault: false,
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

/**
 * 调用 Telegram Bot API
 */
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

    // 不内置任何预设频道：仅从已保存的频道和 Telegram 更新中收集
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

/**
 * 发送普通文本消息
 */
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
            // URL 抓取失败，禁用预览重试
            body.link_preview_options = { is_disabled: true };
            const retryRes = await tgApi(botToken, 'sendMessage', body, requestUrlFn);
            if (retryRes.result.ok) return { success: true };
            // 如果禁用预览还是失败，继续下面的 markdown 回退逻辑
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

/**
 * 发送多图 Media Group (sendMediaGroup)
 * 对照原 telegram_send.py 中的 send_media_group 函数实现
 */
async function sendMediaGroupByBuffer(botToken, chatId, imageItems, caption, requestUrlFn) {
    const boundary = `----TgBridgeMedia${Date.now()}${Math.random().toString(16).slice(2)}`;
    const encoder = new TextEncoder();
    const parts = [];

    // 1. chat_id 字段
    parts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`
    ));

    // 2. media JSON 元数据
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

    // 3. 各图片二进制数据
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
    return { status: response.status, result, _bodyObj: { caption } }; // pass caption for retry logic
}

/**
 * 发送图文消息
 */
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

        // 纯文本 / 附件模式（普通发送，Fallback）：对照 telegram_send.py 中的 send_segments_as_attachments 逻辑
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
                // 没有图片，仅发送文本
                return await sendTextMessage(botToken, chatId, textPart, config, requestUrlFn);
            }

            // 有图片附件：不截断 caption。长正文完整地作为独立消息发送，避免内容重复。
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

            // Telegram media groups require 2-10 items. A trailing single image is sent separately.
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

/**
 * 主执行函数
 */
export async function execute({ content, config, telegramSegments, requestUrl, readImageFile, channelId, channelIds, isRichText = true, showLinkPreview }) {
    const botToken = config?.botToken;
    if (!botToken) {
        return { success: false, error: 'Telegram Bot Token 未配置' };
    }

    const targets = Array.isArray(channelIds) && channelIds.length > 0
        ? channelIds.map(String)
        : (channelId ? [String(channelId)] : []);

    if (targets.length === 0) {
        const homeChannelIds = Array.isArray(config.homeChannels) ? config.homeChannels.map(String) : [];
        const configuredChannels = Array.isArray(config.channels) ? config.channels : [];
        const firstHomeChannel = homeChannelIds.find(Boolean);
        const firstKnownChannel = configuredChannels.find(c => c?.id)?.id;
        if (firstHomeChannel || firstKnownChannel) {
            targets.push(String(firstHomeChannel || firstKnownChannel));
        }
    }

    if (targets.length === 0) {
        return { success: false, error: 'Telegram 频道未配置，请先在设置中获取频道列表' };
    }

    const segments = Array.isArray(telegramSegments) && telegramSegments.length > 0
        ? telegramSegments
        : [{ type: 'richText', markdown: String(content || '').trim() }];

    // 收集需要加载的图片 Buffer。图片 token 已进入待发送内容时，读取失败必须显式报错。
    const imageBuffers = new Map();
    const missingImages = new Set();
    for (const seg of segments) {
        const imageKey = seg.vaultPath || seg.filename;
        if (seg.type !== 'image' || !seg.filename || !imageKey || imageBuffers.has(imageKey) || missingImages.has(imageKey)) continue;
        if (typeof readImageFile !== 'function') {
            missingImages.add(imageKey);
            continue;
        }
        try {
            const buffer = await readImageFile(imageKey);
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

    // 发送面板的预览开关覆盖设置中的默认值
    const effectiveConfig = showLinkPreview !== undefined
        ? { ...config, showLinkPreview }
        : config;
    const results = await Promise.all(targets.map(async targetCh => {
        try {
            const res = await sendRichContent(botToken, targetCh, resolvedSegments, imageBuffers, effectiveConfig, requestUrl, isRichText);
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
        results
    };
}

/**
 * 运行配置相关操作
 */
export async function runAction(actionId, config, requestUrlFn) {
    if (actionId === 'discoverChannels' || actionId === 'testConnection') {
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

export default { manifest, execute, listChannels, runAction };
