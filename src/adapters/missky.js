/**
 * Misskey 适配器
 * 通过 Obsidian requestUrl 发送到 Misskey 实例
 */
const { getMimeType } = require('../core/mime');
const { buildMultipartBody } = require('../core/multipart');
const { t, registerTranslations } = require('../core/i18n');

// 本适配器用户可见字符串的英文翻译（manifest 字段由 settings-tab 通用渲染器包 t()）
registerTranslations('en', {
    'Misskey 实例地址': 'Misskey instance URL',
    '你的 Misskey API Token': 'Your Misskey API Token',
    '可见性': 'Visibility',
    '公开': 'Public',
    '主页': 'Home',
    '仅关注者': 'Followers only',
    '测试连接': 'Test connection',
    '连接中...': 'Connecting...',
    '验证 Misskey 实例地址和 API Token 是否有效。': 'Verify that the Misskey instance URL and API Token are valid.',
    '内容不能为空': 'Content cannot be empty',
    'Misskey 实例地址或 API Token 未配置': 'Misskey instance URL or API Token is not configured',
    '超过 {count} 张图片，只发送前 {count} 张': 'Over {count} images, only sending the first {count}',
    '（{detail}）': ' ({detail})',
    'Misskey 未返回文件 ID': 'Misskey did not return a file ID',
    'Misskey 图片读取失败：{name}；未发送任何内容。': 'Failed to read image: {name}; nothing was sent.',
    'Misskey 图片上传失败：{name}{detail}；未发送任何内容。': 'Image upload failed: {name}{detail}; nothing was sent.',
    'Misskey 图片处理失败：{name}（{error}）；未发送任何内容。': 'Image processing failed: {name} ({error}); nothing was sent.',
    'Misskey 适配器不支持操作：{action}': 'Misskey adapter does not support action: {action}',
    '请先配置 Misskey 实例地址和 API Token': 'Please configure the Misskey instance URL and API Token first',
    '未知': 'Unknown',
    'Misskey 连接成功（用户：{name}）': 'Misskey connection successful (user: {name})'
});

export const manifest = {
    id: 'missky',
    version: '1.0.0',
    name: 'Misskey',
    enabledByDefault: false,
    displayOrder: 40,
    capabilities: {
        text: true,
        attachments: true,
        attachmentTypes: ['image/*'],
        maxAttachments: 16,
        maxAttachmentSize: 0,
        warnOnAttachmentCount: true,
        warnOnAttachmentSize: false
    },
    settings: {
        fields: [
            {
                key: 'serverUrl',
                type: 'text',
                label: 'Misskey 实例地址',
                required: true,
                placeholder: 'https://misskey.io'
            },
            {
                key: 'apiToken',
                type: 'password',
                label: 'API Token',
                required: true,
                placeholder: '你的 Misskey API Token'
            },
            {
                key: 'visibility',
                type: 'select',
                label: '可见性',
                options: [
                    { value: 'public', label: '公开' },
                    { value: 'home', label: '主页' },
                    { value: 'followers', label: '仅关注者' }
                ],
                default: 'public'
            },
            {
                key: 'testConnection',
                type: 'action',
                label: '测试连接',
                action: 'testConnection',
                buttonLabel: '测试连接',
                busyLabel: '连接中...',
                desc: '验证 Misskey 实例地址和 API Token 是否有效。'
            }
        ]
    }
};

const MAX_MISSKEY_IMAGES = manifest.capabilities.maxAttachments;

/**
 * 上传单张图片到 Misskey Drive（/api/drive/files/create），返回 fileId
 */
async function uploadImageToMissky(arrayBuffer, filename, baseUrl, apiToken, requestUrl) {
    const mimeType = getMimeType(filename);
    const { boundary, body } = buildMultipartBody({
        boundaryPrefix: '----MisskeyBoundary',
        fields: [
            { name: 'i', value: apiToken },
            { name: 'file', filename, contentType: mimeType, buffer: arrayBuffer }
        ]
    });

    const response = await requestUrl({
        url: `${baseUrl}/api/drive/files/create`,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
        throw: false
    });

    if (response.status < 200 || response.status >= 300) {
        let errMsg = '';
        try { errMsg = response.json?.error?.message || response.text || `HTTP ${response.status}`; } catch { errMsg = `HTTP ${response.status}`; }
        return { id: null, error: errMsg };
    }
    const result = response.json || {};
    if (!result.id) {
        return { id: null, error: t('Misskey 未返回文件 ID') };
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

    if (!payload.plainText && attachments.length === 0) {
        errors.push(t('内容不能为空'));
    }

    return { warnings, errors };
}

/**
 * 统一执行接口
 * @param {object} options
 * @param {object} options.config - { serverUrl, apiToken, visibility }
 * @param {object} options.payload - 统一 payload
 * @param {Function} options.requestUrl
 */
export async function execute({ config = {}, payload = {}, requestUrl }) {
    const serverUrl = String(config.serverUrl || '').trim();
    const apiToken = String(config.apiToken || '').trim();
    const visibility = ['public', 'home', 'followers'].includes(config.visibility)
        ? config.visibility
        : 'public';

    if (!serverUrl || !apiToken) {
        return { success: false, error: t('Misskey 实例地址或 API Token 未配置') };
    }

    const textContent = String(payload.plainText || '').trim();
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const warnings = [];

    try {
        // 上传图片到 Drive，拿到 fileIds
        const fileIds = [];
        const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
        const allImages = attachments.filter(a => a.kind === 'image');
        const images = allImages.slice(0, MAX_MISSKEY_IMAGES);

        if (allImages.length > MAX_MISSKEY_IMAGES) {
            warnings.push(t('超过 {count} 张图片，只发送前 {count} 张', { count: MAX_MISSKEY_IMAGES }));
        }

        for (const img of images) {
            try {
                const buffer = typeof payload.readAttachment === 'function'
                    ? await payload.readAttachment(img.vaultPath)
                    : null;
                if (!buffer) {
                    return { success: false, error: t('Misskey 图片读取失败：{name}；未发送任何内容。', { name: img.filename }), warnings };
                }
                const uploadResult = await uploadImageToMissky(buffer, img.filename, baseUrl, apiToken, requestUrl);
                if (!uploadResult.id) {
                    return {
                        success: false,
                        error: t('Misskey 图片上传失败：{name}{detail}；未发送任何内容。', {
                            name: img.filename,
                            detail: uploadResult.error ? t('（{detail}）', { detail: uploadResult.error }) : ''
                        }),
                        warnings
                    };
                }
                fileIds.push(uploadResult.id);
            } catch (error) {
                return {
                    success: false,
                    error: t('Misskey 图片处理失败：{name}（{error}）；未发送任何内容。', {
                        name: img.filename,
                        error: error?.message || String(error)
                    }),
                    warnings
                };
            }
        }

        if (!textContent && fileIds.length === 0) {
            return { success: false, error: t('内容不能为空') };
        }

        const response = await requestUrl({
            url: `${baseUrl}/api/notes/create`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                i: apiToken,
                ...(textContent ? { text: textContent } : {}),
                visibility,
                ...(fileIds.length > 0 ? { fileIds } : {})
            }),
            throw: false
        });

        if (response.status >= 200 && response.status < 300) {
            let result = {};
            try { result = response.json; } catch {}
            return { success: true, noteId: result.createdNote?.id || '', mediaCount: fileIds.length, warnings };
        } else {
            let errMsg = '';
            try { errMsg = response.json?.error?.message || response.text || `HTTP ${response.status}`; } catch { errMsg = `HTTP ${response.status}`; }
            return { success: false, error: errMsg, warnings };
        }
    } catch (error) {
        return { success: false, error: error.message, warnings };
    }
}

export async function runAction(actionId, config = {}, requestUrlFn) {
    if (actionId !== 'testConnection') {
        throw new Error(t('Misskey 适配器不支持操作：{action}', { action: actionId }));
    }
    const serverUrl = String(config.serverUrl || '').trim();
    const apiToken = String(config.apiToken || '').trim();
    if (!serverUrl || !apiToken) throw new Error(t('请先配置 Misskey 实例地址和 API Token'));
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const response = await requestUrlFn({
        url: `${baseUrl}/api/i`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ i: apiToken }),
        throw: false
    });
    if (response.status < 200 || response.status >= 300) {
        let errMsg = '';
        try { errMsg = response.json?.error?.message || response.text || `HTTP ${response.status}`; } catch { errMsg = `HTTP ${response.status}`; }
        throw new Error(errMsg);
    }
    let result = {};
    try { result = response.json || {}; } catch {}
    const username = result.username || result.name || t('未知');
    return { success: true, message: t('Misskey 连接成功（用户：{name}）', { name: username }) };
}

export default { manifest, execute, validate, runAction };
