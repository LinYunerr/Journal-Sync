/**
 * Mastodon 适配器
 * 通过 Obsidian requestUrl 直接发送到 Mastodon 实例
 */

import { Setting, Notice } from 'obsidian';

export const manifest = {
    id: 'mastodon',
    version: '1.0.0',
    name: 'Mastodon',
    description: '发布内容到 Mastodon',
    displayOrder: 30,
    enabledByDefault: false,
    capabilities: {
        text: true,
        attachments: true,
        attachmentTypes: ['image/*'],
        maxAttachments: 4,
        maxAttachmentSize: 0,
        warnOnAttachmentCount: true,
        warnOnAttachmentSize: false
    },
    settings: {
        fields: [
            {
                key: 'serverUrl',
                type: 'text',
                label: 'Mastodon 实例地址',
                required: true,
                placeholder: 'https://mastodon.social'
            },
            {
                key: 'accessToken',
                type: 'password',
                label: 'Access Token',
                required: true,
                placeholder: '你的 Mastodon Access Token'
            },
            {
                key: 'visibility',
                type: 'select',
                label: '可见性',
                options: [
                    { value: 'public', label: '公开' },
                    { value: 'unlisted', label: '不列出' },
                    { value: 'private', label: '仅关注者' },
                    { value: 'direct', label: '私信' }
                ],
                default: 'public'
            }
        ]
    }
};

export const defaultConfig = { accounts: [] };

const MAX_MASTODON_IMAGES = manifest.capabilities.maxAttachments;

function getMimeType(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const mimeTypes = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * 上传单张图片到 Mastodon /api/v1/media，返回 media_id
 */
async function uploadImageToMastodon(arrayBuffer, filename, baseUrl, accessToken, requestUrl) {
    const safeFilename = String(filename || 'image').replace(/["\r\n]/g, '_');
    const mimeType = getMimeType(filename);
    const boundary = `----MastodonBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;

    const encoder = new TextEncoder();
    const parts = [];
    parts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    ));
    parts.push(new Uint8Array(arrayBuffer));
    parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

    const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        body.set(part, offset);
        offset += part.byteLength;
    }

    const response = await requestUrl({
        url: `${baseUrl}/api/v1/media`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: body.buffer,
        throw: false
    });

    let result = {};
    try { result = response.json || {}; } catch {}

    if (response.status < 200 || response.status >= 300) {
        return { id: null, error: `HTTP ${response.status}: ${result.error || response.text || ''}` };
    }

    if (!result.id) {
        return { id: null, error: 'Mastodon 未返回媒体 ID' };
    }
    return { id: result.id, error: '' };
}

/**
 * 预检验证
 */
export async function validate({ payload }) {
    const warnings = [];
    const errors = [];

    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const images = attachments.filter(a => a.kind === 'image');


    if (!payload.plainText && images.length === 0) {
        errors.push('内容不能为空');
    }

    return { warnings, errors };
}

/**
 * 统一执行接口
 * @param {object} options
 * @param {object} options.config - { serverUrl, accessToken, visibility }
 * @param {object} options.payload - 统一 payload
 * @param {Function} options.requestUrl
 */
export async function execute({ config = {}, payload = {}, requestUrl }) {
    const serverUrl = String(config.serverUrl || '').trim();
    const accessToken = String(config.accessToken || '').trim();
    const visibility = config.visibility || 'public';

    if (!serverUrl || !accessToken) {
        return { success: false, error: 'Mastodon 实例地址或 Access Token 未配置' };
    }

    const textContent = String(payload.plainText || '').trim();
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const warnings = [];

    try {
        // 上传图片，拿到 media_ids
        const mediaIds = [];
        const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
        const allImages = attachments.filter(a => a.kind === 'image');
        const images = allImages.slice(0, MAX_MASTODON_IMAGES);

        if (allImages.length > MAX_MASTODON_IMAGES) {
            warnings.push(`超过 ${MAX_MASTODON_IMAGES} 张图片，只发送前 ${MAX_MASTODON_IMAGES} 张`);
        }

        for (const img of images) {
            try {
                const buffer = typeof payload.readAttachment === 'function'
                    ? await payload.readAttachment(img.vaultPath)
                    : null;
                if (!buffer) {
                    return { success: false, error: `图片读取失败：${img.filename}；未发送任何内容。` };
                }
                const uploadResult = await uploadImageToMastodon(buffer, img.filename, baseUrl, accessToken, requestUrl);
                if (!uploadResult.id) {
                    return {
                        success: false,
                        error: `图片上传失败：${img.filename}${uploadResult.error ? `（${uploadResult.error}）` : ''}；未发送任何内容。`
                    };
                }
                mediaIds.push(uploadResult.id);
            } catch (error) {
                return { success: false, error: `图片处理失败：${img.filename}（${error.message || String(error)}）；未发送任何内容。` };
            }
        }

        if (!textContent && mediaIds.length === 0) {
            return { success: false, error: '内容不能为空' };
        }

        const response = await requestUrl({
            url: `${baseUrl}/api/v1/statuses`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: textContent || '📷',
                visibility,
                ...(mediaIds.length > 0 ? { media_ids: mediaIds } : {})
            }),
            throw: false
        });

        if (response.status >= 200 && response.status < 300) {
            let result = {};
            try { result = response.json; } catch {}
            return { success: true, url: result.url || '', mediaCount: mediaIds.length, warnings };
        } else {
            let errMsg = '';
            try { errMsg = response.json?.error || response.text || `HTTP ${response.status}`; } catch { errMsg = `HTTP ${response.status}`; }
            return { success: false, error: errMsg, warnings };
        }
    } catch (error) {
        return { success: false, error: error.message, warnings };
    }
}

// ── 自定义设置面板（多账号管理） ──────────────────────────

/**
 * 设置页在「启用 Mastodon」开关开启后调用，渲染多账号管理界面。
 * 启用开关由设置页统一渲染，这里不要重复渲染。
 */
export function renderSettings(containerEl, ctx) {
    const plugin = ctx.plugin;
    const accounts = plugin.getMastodonAccounts();

    // 逐账号卡片
    for (let i = 0; i < accounts.length; i++) {
        const acct = accounts[i];
        renderMastodonAccountCard(containerEl, ctx, acct, i);
    }

    // 添加账号按钮
    new Setting(containerEl)
        .setName('添加账号')
        .setDesc('添加一个新的 Mastodon 实例账号')
        .addButton(btn => btn
            .setButtonText('+ 添加')
            .onClick(async () => {
                const newAcct = {
                    id: `mstd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    label: '',
                    serverUrl: '',
                    accessToken: '',
                    visibility: 'public'
                };
                const freshAccounts = plugin.getMastodonAccounts();
                const updated = [...freshAccounts, newAcct];
                await ctx.saveConfig({ accounts: updated });
                ctx.refresh();
            }));
}

function renderMastodonAccountCard(containerEl, ctx, acct, index) {
    const cardEl = containerEl.createDiv({ cls: 'js-bridge-mstd-card' });

    // 卡片标题行
    const headerEl = cardEl.createDiv({ cls: 'js-bridge-mstd-card-header' });
    const titleText = acct.label || acct.serverUrl || `账号 ${index + 1}`;
    headerEl.createEl('span', { text: titleText, cls: 'js-bridge-mstd-card-title' });
    headerEl.createEl('span', { text: acct.serverUrl || '未配置', cls: 'js-bridge-mstd-card-url' });

    // 删除按钮
    const deleteBtn = headerEl.createEl('button', {
        type: 'button',
        text: '删除',
        cls: 'js-bridge-mstd-card-delete'
    });
    deleteBtn.addEventListener('click', async () => {
        if (!confirm(`确定删除账号「${titleText}」？`)) return;
        // 读取最新数据，避免闭包捕获过期快照导致编辑后删除其他账号时数据回退
        const freshAccounts = ctx.plugin.getMastodonAccounts();
        const updated = freshAccounts.filter(a => a.id !== acct.id);
        await ctx.saveConfig({ accounts: updated });
        // 清理预设中已删除账号的引用，避免 data.json 无限累积
        cleanupMastodonPresets(ctx, acct.id);
        ctx.refresh();
    });

    // 字段：显示名称
    new Setting(cardEl)
        .setName('显示名称')
        .setDesc('在发送面板中显示的文字，如「主账号」「长毛象」')
        .addText(text => text
            .setPlaceholder('主账号')
            .setValue(acct.label || '')
            .onChange(value => {
                updateMastodonAccount(ctx, acct.id, { label: value.trim() });
            }));

    // 字段：实例地址
    new Setting(cardEl)
        .setName('实例地址')
        .setDesc('例如 https://mastodon.social')
        .addText(text => text
            .setPlaceholder('https://mastodon.social')
            .setValue(acct.serverUrl || '')
            .onChange(value => {
                updateMastodonAccount(ctx, acct.id, { serverUrl: value.trim() });
            }));

    // 字段：Access Token
    new Setting(cardEl)
        .setName('Access Token')
        .addText(text => {
            text.inputEl.type = 'password';
            text.setPlaceholder('你的 Mastodon Access Token')
                .setValue(acct.accessToken || '')
                .onChange(value => {
                    updateMastodonAccount(ctx, acct.id, { accessToken: value.trim() });
                });
        });

    // 字段：可见性
    new Setting(cardEl)
        .setName('可见性')
        .addDropdown(dropdown => dropdown
            .addOption('public', '公开')
            .addOption('unlisted', '不列出')
            .addOption('private', '仅关注者')
            .addOption('direct', '私信')
            .setValue(acct.visibility || 'public')
            .onChange(value => {
                updateMastodonAccount(ctx, acct.id, { visibility: value });
            }));

    // 测试连接按钮
    new Setting(cardEl)
        .setName('测试连接')
        .setDesc('验证当前账号的实例地址和 Access Token 是否有效。')
        .addButton(btn => btn
            .setButtonText('测试连接')
            .onClick(async () => {
                const currentConfig = ctx.plugin.getMastodonAccount(acct.id) || {};
                const serverUrl = String(currentConfig.serverUrl || '').trim();
                const accessToken = String(currentConfig.accessToken || '').trim();
                if (!serverUrl || !accessToken) {
                    new Notice('请先配置实例地址和 Access Token');
                    return;
                }
                btn.setButtonText('连接中...');
                btn.disabled = true;
                try {
                    const baseUrl = serverUrl.replace(/\/+$/, '');
                    const response = await ctx.requestUrl({
                        url: `${baseUrl}/api/v1/accounts/verify_credentials`,
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${accessToken}` },
                        throw: false
                    });
                    if (response.status >= 200 && response.status < 300) {
                        const result = response.json || {};
                        const display = result.display_name || result.username || '未知';
                        new Notice(`Mastodon 连接成功（${display}）`);
                    } else {
                        let errMsg = '';
                        try { errMsg = response.json?.error || response.text || `HTTP ${response.status}`; } catch { errMsg = `HTTP ${response.status}`; }
                        new Notice(`Mastodon 连接失败：${errMsg}`);
                    }
                } catch (error) {
                    new Notice(`Mastodon 连接失败：${error.message || String(error)}`);
                } finally {
                    btn.setButtonText('测试连接');
                    btn.disabled = false;
                }
            }));
}

/**
 * 逐字符输入时防抖合并保存：每次都从插件重新读取最新账号列表再更新，
 * 避免闭包捕获过期快照导致不同输入框互相覆盖。
 */
function updateMastodonAccount(ctx, accountId, patch) {
    const accounts = ctx.plugin.getMastodonAccounts();
    const updated = accounts.map(a => a.id === accountId ? { ...a, ...patch } : a);
    ctx.scheduleConfigSave({ accounts: updated });
}

/**
 * 删除账号后清理预设中残留的 mastodon-account:<accountId> 引用，
 * 避免 data.json 无限累积已删除账号的条目。
 */
function cleanupMastodonPresets(ctx, accountId) {
    const presets = ctx.plugin.settings.publishPresets;
    if (!Array.isArray(presets) || presets.length === 0) return;
    const staleKey = `mastodon-account:${accountId}`;
    let changed = false;
    for (const preset of presets) {
        if (!Array.isArray(preset.items)) continue;
        const before = preset.items.length;
        preset.items = preset.items.filter(item => item.id !== staleKey);
        if (preset.items.length !== before) changed = true;
    }
    if (changed) {
        ctx.plugin.settings.publishPresets = presets;
        ctx.plugin.saveSettings();
    }
}

export default { manifest, execute, validate, renderSettings, defaultConfig };
