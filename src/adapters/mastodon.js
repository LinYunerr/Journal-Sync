/**
 * Mastodon 适配器
 * 通过 Obsidian requestUrl 直接发送到 Mastodon 实例
 */

import { Setting, Notice } from 'obsidian';
const { getMimeType } = require('../core/mime');
const { buildMultipartBody } = require('../core/multipart');
const { t, registerTranslations } = require('../core/i18n');

// 本适配器用户可见字符串的英文翻译（manifest 字段由 settings-tab 通用渲染器包 t()）
registerTranslations('en', {
    '（{detail}）': ' ({detail})',
    'Mastodon 实例地址': 'Mastodon instance URL',
    '你的 Mastodon Access Token': 'Your Mastodon Access Token',
    '可见性': 'Visibility',
    '公开': 'Public',
    '不列出': 'Unlisted',
    '仅关注者': 'Followers only',
    '私信': 'Direct message',
    'Mastodon 未返回媒体 ID': 'Mastodon did not return a media ID',
    '内容不能为空': 'Content cannot be empty',
    'Mastodon 实例地址或 Access Token 未配置': 'Mastodon instance URL or Access Token is not configured',
    'Mastodon 超过 {max} 张图片，只发送前 {max} 张': 'Over {max} images; only the first {max} will be sent',
    '图片读取失败：{filename}；未发送任何内容。': 'Failed to read image: {filename}; nothing was sent.',
    '图片上传失败：{filename}{detail}；未发送任何内容。': 'Image upload failed: {filename}{detail}; nothing was sent.',
    '图片处理失败：{filename}（{error}）；未发送任何内容。': 'Image processing failed: {filename} ({error}); nothing was sent.',
    '添加账号': 'Add account',
    '添加一个新的 Mastodon 实例账号': 'Add a new Mastodon instance account',
    '+ 添加': '+ Add',
    '账号 {index}': 'Account {index}',
    '未配置': 'Not configured',
    '删除': 'Delete',
    '确定删除账号「{title}」？': 'Delete account "{title}"?',
    '显示名称': 'Display name',
    '在发送面板中显示的文字，如「主账号」「长毛象」': 'Text shown in the send panel, e.g. "Main account" or "Mastodon"',
    '主账号': 'Main account',
    '实例地址': 'Instance URL',
    '例如 https://mastodon.social': 'e.g. https://mastodon.social',
    '测试连接': 'Test connection',
    '验证当前账号的实例地址和 Access Token 是否有效。': 'Verify that the current account\'s instance URL and Access Token are valid.',
    '请先配置实例地址和 Access Token': 'Please configure the instance URL and Access Token first',
    '连接中...': 'Connecting...',
    '未知': 'Unknown',
    'Mastodon 连接成功（{display}）': 'Mastodon connection successful ({display})',
    'Mastodon 连接失败：{error}': 'Mastodon connection failed: {error}',
    'Mastodon 账号「{name}」实例地址或 Access Token 未配置': 'Mastodon account "{name}" is missing instance URL or Access Token'
});

export const manifest = {
    id: 'mastodon',
    version: '1.0.0',
    name: 'Mastodon',
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

/**
 * 上传单张图片到 Mastodon /api/v1/media，返回 media_id
 */
async function uploadImageToMastodon(arrayBuffer, filename, baseUrl, accessToken, requestUrl) {
    const mimeType = getMimeType(filename);
    const { boundary, body } = buildMultipartBody({
        boundaryPrefix: '----MastodonBoundary',
        fields: [
            { name: 'file', filename, contentType: mimeType, buffer: arrayBuffer }
        ]
    });

    const response = await requestUrl({
        url: `${baseUrl}/api/v1/media`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body,
        throw: false
    });

    let result = {};
    try { result = response.json || {}; } catch {}

    if (response.status < 200 || response.status >= 300) {
        return { id: null, error: `HTTP ${response.status}: ${result.error || response.text || ''}` };
    }

    if (!result.id) {
        return { id: null, error: t('Mastodon 未返回媒体 ID') };
    }
    return { id: result.id, error: '' };
}

/**
 * 预检验证
 */
export async function validate({ payload, config = {} }) {
    const warnings = [];
    const errors = [];

    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const images = attachments.filter(a => a.kind === 'image');


    if (!payload.plainText && images.length === 0) {
        errors.push(t('内容不能为空'));
    }

    if (Array.isArray(config?.accounts)) {
        for (const acct of config.accounts) {
            if (!String(acct?.serverUrl || '').trim() || !String(acct?.accessToken || '').trim()) {
                const name = acct?.label || String(acct?.serverUrl || '').trim() || acct?.id || t('未配置');
                errors.push(t('Mastodon 账号「{name}」实例地址或 Access Token 未配置', { name }));
            }
        }
    } else if (config && (Object.prototype.hasOwnProperty.call(config, 'serverUrl') || Object.prototype.hasOwnProperty.call(config, 'accessToken'))) {
        if (!String(config.serverUrl || '').trim() || !String(config.accessToken || '').trim()) {
            errors.push(t('Mastodon 实例地址或 Access Token 未配置'));
        }
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
        return { success: false, error: t('Mastodon 实例地址或 Access Token 未配置') };
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
            warnings.push(t('Mastodon 超过 {max} 张图片，只发送前 {max} 张', { max: MAX_MASTODON_IMAGES }));
        }

        for (const img of images) {
            try {
                const buffer = typeof payload.readAttachment === 'function'
                    ? await payload.readAttachment(img.vaultPath)
                    : null;
                if (!buffer) {
                    return { success: false, error: t('图片读取失败：{filename}；未发送任何内容。', { filename: img.filename }) };
                }
                const uploadResult = await uploadImageToMastodon(buffer, img.filename, baseUrl, accessToken, requestUrl);
                if (!uploadResult.id) {
                    return {
                        success: false,
                        error: t('图片上传失败：{filename}{detail}；未发送任何内容。', {
                            filename: img.filename,
                            detail: uploadResult.error ? t('（{detail}）', { detail: uploadResult.error }) : ''
                        })
                    };
                }
                mediaIds.push(uploadResult.id);
            } catch (error) {
                return { success: false, error: t('图片处理失败：{filename}（{error}）；未发送任何内容。', { filename: img.filename, error: error.message || String(error) }) };
            }
        }

        if (!textContent && mediaIds.length === 0) {
            return { success: false, error: t('内容不能为空') };
        }

        const response = await requestUrl({
            url: `${baseUrl}/api/v1/statuses`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...(textContent ? { status: textContent } : {}),
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
        .setName(t('添加账号'))
        .setDesc(t('添加一个新的 Mastodon 实例账号'))
        .addButton(btn => btn
            .setButtonText(t('+ 添加'))
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
    const titleText = acct.label || acct.serverUrl || t('账号 {index}', { index: index + 1 });
    headerEl.createEl('span', { text: titleText, cls: 'js-bridge-mstd-card-title' });
    headerEl.createEl('span', { text: acct.serverUrl || t('未配置'), cls: 'js-bridge-mstd-card-url' });

    // 删除按钮
    const deleteBtn = headerEl.createEl('button', {
        type: 'button',
        text: t('删除'),
        cls: 'js-bridge-mstd-card-delete'
    });
    deleteBtn.addEventListener('click', async () => {
        if (!confirm(t('确定删除账号「{title}」？', { title: titleText }))) return;
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
        .setName(t('显示名称'))
        .setDesc(t('在发送面板中显示的文字，如「主账号」「长毛象」'))
        .addText(text => text
            .setPlaceholder(t('主账号'))
            .setValue(acct.label || '')
            .onChange(value => {
                updateMastodonAccount(ctx, acct.id, { label: value.trim() });
            }));

    // 字段：实例地址
    new Setting(cardEl)
        .setName(t('实例地址'))
        .setDesc(t('例如 https://mastodon.social'))
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
            text.setPlaceholder(t('你的 Mastodon Access Token'))
                .setValue(acct.accessToken || '')
                .onChange(value => {
                    updateMastodonAccount(ctx, acct.id, { accessToken: value.trim() });
                });
        });

    // 字段：可见性
    new Setting(cardEl)
        .setName(t('可见性'))
        .addDropdown(dropdown => dropdown
            .addOption('public', t('公开'))
            .addOption('unlisted', t('不列出'))
            .addOption('private', t('仅关注者'))
            .addOption('direct', t('私信'))
            .setValue(acct.visibility || 'public')
            .onChange(value => {
                updateMastodonAccount(ctx, acct.id, { visibility: value });
            }));

    // 测试连接按钮
    new Setting(cardEl)
        .setName(t('测试连接'))
        .setDesc(t('验证当前账号的实例地址和 Access Token 是否有效。'))
        .addButton(btn => btn
            .setButtonText(t('测试连接'))
            .onClick(async () => {
                const currentConfig = ctx.plugin.getMastodonAccount(acct.id) || {};
                const serverUrl = String(currentConfig.serverUrl || '').trim();
                const accessToken = String(currentConfig.accessToken || '').trim();
                if (!serverUrl || !accessToken) {
                    new Notice(t('请先配置实例地址和 Access Token'));
                    return;
                }
                btn.setButtonText(t('连接中...'));
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
                        const display = result.display_name || result.username || t('未知');
                        new Notice(t('Mastodon 连接成功（{display}）', { display }));
                    } else {
                        let errMsg = '';
                        try { errMsg = response.json?.error || response.text || `HTTP ${response.status}`; } catch { errMsg = `HTTP ${response.status}`; }
                        new Notice(t('Mastodon 连接失败：{error}', { error: errMsg }));
                    }
                } catch (error) {
                    new Notice(t('Mastodon 连接失败：{error}', { error: error.message || String(error) }));
                } finally {
                    btn.setButtonText(t('测试连接'));
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
