/**
 * Bluesky 适配器
 * 通过 Obsidian requestUrl 直接调用 AT Protocol（XRPC）发送到 Bluesky。
 * 认证：App Password 换取临时会话 JWT，仅存内存，不持久化。
 * 文档：https://atproto.com/specs/xrpc
 */

const {
    MAX_GRAPHEMES,
    MAX_TEXT_BYTES,
    MAX_IMAGE_BYTES,
    MAX_IMAGES,
    SUPPORTED_IMAGE_MIME_TYPES,
    isSupportedImageMime,
    measurePostText,
    buildLinkFacets
} = require('./bluesky-core');

const { t, registerTranslations } = require('../core/i18n');

// 本适配器用户可见字符串的英文翻译（manifest 字段由 settings-tab 通用渲染器包 t()）
registerTranslations('en', {
    '；': '; ',
    '账号': 'Account',
    'Bluesky handle（如 alice.bsky.social）、DID 或注册邮箱。': 'Bluesky handle (e.g. alice.bsky.social), DID, or registered email.',
    '在 Bluesky 设置 → Privacy & security → App passwords 中生成，请勿填写账号主密码。': 'Generate it in Bluesky Settings → Privacy & security → App passwords. Do not use your account main password.',
    'Service 地址': 'Service URL',
    '默认官方服务 https://bsky.social，自建 PDS 可修改。': 'Default official service https://bsky.social; can be changed for a self-hosted PDS.',
    '测试连接': 'Test connection',
    '使用当前配置登录一次 Bluesky，验证账号与 App Password 是否有效。': 'Log in to Bluesky once with the current config to verify the account and App Password are valid.',
    '连接中...': 'Connecting...',
    '账号开启了邮箱两步验证，请使用 App Password 或关闭邮箱两步验证后重试': 'Email two-step verification is enabled on the account. Use an App Password or disable email two-step verification and retry.',
    '触发 Bluesky 限流，请 {seconds} 秒后重试': 'Bluesky rate limit triggered, retry in {seconds} seconds',
    '触发 Bluesky 限流，请稍后再试': 'Bluesky rate limit triggered, please try again later',
    'Bluesky 账号或 App Password 无效': 'Bluesky account or App Password is invalid',
    '{actionLabel}失败（HTTP {status}：{detail}）': '{actionLabel} failed (HTTP {status}: {detail})',
    'Bluesky 登录': 'Bluesky login',
    'Bluesky 登录响应缺少会话信息': 'Bluesky login response is missing session info',
    '图片上传': 'Image upload',
    'Bluesky 未返回图片引用': 'Bluesky did not return an image reference',
    'Bluesky 图片': 'Image',
    'Bluesky 不支持 {name} 的格式，已跳过': 'Bluesky does not support the format of {name}, skipped',
    'Bluesky 超过 {max} 张图片，只发送前 {max} 张': 'Over {max} images, only the first {max} will be sent',
    '正文为空，且图片格式均不受 Bluesky 支持（仅支持 JPEG/PNG/WebP/GIF）': 'Body is empty, and none of the image formats are supported by Bluesky (only JPEG/PNG/WebP/GIF)',
    '内容不能为空': 'Content cannot be empty',
    'Bluesky 单帖上限 {max} 字符（当前 {current}），请缩短内容': 'Bluesky single-post limit is {max} characters (currently {current}), please shorten the content',
    'Bluesky 单帖 UTF-8 上限 {max} 字节（当前 {current}），请缩短内容': 'Bluesky single-post UTF-8 limit is {max} bytes (currently {current}), please shorten the content',
    '图片读取接口不可用': 'Image reading interface is unavailable',
    '图片读取失败：{name}（{detail}）': 'Failed to read image: {name} ({detail})',
    '图片读取失败：{name}（文件为空）': 'Failed to read image: {name} (file is empty)',
    'Bluesky 单张图片上限 2 MB：{name}（当前 {size} 字节）': 'Bluesky single-image limit is 2 MB: {name} (currently {size} bytes)',
    'Bluesky 账号或 App Password 未配置': 'Bluesky account or App Password is not configured',
    '图片上传失败：{name}（{error}）；未发送任何内容。': 'Image upload failed: {name} ({error}); nothing was sent.',
    '发帖': 'Post',
    'Bluesky 适配器不支持操作：{action}': 'Bluesky adapter does not support action: {action}',
    '请先填写 Bluesky 账号与 App Password': 'Please fill in the Bluesky account and App Password first',
    '已连接 {name}': 'Connected to {name}'
});

const manifest = {
    id: 'bluesky',
    version: '1.0.0',
    name: 'Bluesky',
    enabledByDefault: false,
    displayOrder: 50,
    capabilities: {
        text: true,
        attachments: true,
        attachmentTypes: [...SUPPORTED_IMAGE_MIME_TYPES],
        maxAttachments: MAX_IMAGES,
        maxAttachmentSize: MAX_IMAGE_BYTES,
        warnOnAttachmentCount: true,
        // This is a hard record constraint, enforced by validate/execute.
        warnOnAttachmentSize: false
    },
    settings: {
        fields: [
            {
                key: 'identifier',
                type: 'text',
                label: '账号',
                desc: 'Bluesky handle（如 alice.bsky.social）、DID 或注册邮箱。',
                required: true,
                placeholder: 'alice.bsky.social'
            },
            {
                key: 'appPassword',
                type: 'password',
                label: 'App Password',
                desc: '在 Bluesky 设置 → Privacy & security → App passwords 中生成，请勿填写账号主密码。',
                required: true,
                placeholder: 'xxxx-xxxx-xxxx-xxxx'
            },
            {
                key: 'serviceUrl',
                type: 'text',
                label: 'Service 地址',
                desc: '默认官方服务 https://bsky.social，自建 PDS 可修改。',
                default: 'https://bsky.social'
            },
            {
                type: 'action',
                label: '测试连接',
                desc: '使用当前配置登录一次 Bluesky，验证账号与 App Password 是否有效。',
                action: 'testConnection',
                buttonLabel: '测试连接',
                busyLabel: '连接中...'
            }
        ]
    }
};

const DEFAULT_SERVICE_URL = 'https://bsky.social';

function normalizeServiceUrl(value) {
    let raw = String(value || '').trim().replace(/\/+$/, '');
    if (!raw) return DEFAULT_SERVICE_URL;
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    return raw;
}

/**
 * 将 XRPC 非 2xx 响应转换为中文错误信息。
 * @param {object} response - requestUrl 响应
 * @param {string} actionLabel - '登录' / '图片上传' / '发帖'，用于兜底文案
 */
function xrpcErrorMessage(response, actionLabel) {
    let body = {};
    try { body = response.json || {}; } catch {}

    const error = String(body.error || '');
    const message = String(body.message || '');

    if (error === 'AuthFactorTokenRequired') {
        return t('账号开启了邮箱两步验证，请使用 App Password 或关闭邮箱两步验证后重试');
    }
    if (response.status === 429) {
        const retryAfter = response.headers && (response.headers['retry-after'] || response.headers['Retry-After']);
        return retryAfter ? t('触发 Bluesky 限流，请 {seconds} 秒后重试', { seconds: retryAfter }) : t('触发 Bluesky 限流，请稍后再试');
    }
    if (response.status === 401 || error === 'AuthenticationRequired') {
        return t('Bluesky 账号或 App Password 无效');
    }
    if (error === 'InvalidRecordError' && message) return message;

    const detail = message || error || `HTTP ${response.status}`;
    return t('{actionLabel}失败（HTTP {status}：{detail}）', { actionLabel, status: response.status, detail });
}

/**
 * 创建会话，返回 { did, handle, accessJwt }
 */
async function createSession(serviceUrl, identifier, appPassword, requestUrl) {
    const response = await requestUrl({
        url: `${serviceUrl}/xrpc/com.atproto.server.createSession`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password: appPassword }),
        throw: false
    });

    if (response.status < 200 || response.status >= 300) {
        throw new Error(xrpcErrorMessage(response, t('Bluesky 登录')));
    }

    let result = {};
    try { result = response.json || {}; } catch {}
    if (!result.accessJwt || !result.did) {
        throw new Error(t('Bluesky 登录响应缺少会话信息'));
    }
    return result;
}

/**
 * 上传单张图片到 com.atproto.repo.uploadBlob（raw 二进制 body，非 multipart），返回 blob 引用
 */
async function uploadBlob(serviceUrl, accessJwt, buffer, mimeType, requestUrl) {
    const response = await requestUrl({
        url: `${serviceUrl}/xrpc/com.atproto.repo.uploadBlob`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessJwt}`,
            'Content-Type': mimeType
        },
        body: buffer,
        throw: false
    });

    if (response.status < 200 || response.status >= 300) {
        return { blob: null, error: xrpcErrorMessage(response, t('图片上传')) };
    }

    let result = {};
    try { result = response.json || {}; } catch {}
    const blob = result.blob;
    if (!blob || !blob.ref || !blob.ref.$link) {
        return { blob: null, error: t('Bluesky 未返回图片引用') };
    }
    return { blob, error: '' };
}

function buildPostUrl(uri, session) {
    const rkey = String(uri || '').split('/').pop();
    if (!rkey) return '';
    return `https://bsky.app/profile/${session.handle || session.did}/post/${rkey}`;
}

function imageLabel(image) {
    return image?.filename || image?.vaultPath || t('Bluesky 图片');
}

/**
 * Build a send-ready payload without issuing network requests. Both the modal
 * preflight and execute() use this path so direct adapter calls cannot bypass
 * protocol limits. Returned image buffers are reused by execute() for upload.
 */
async function preparePayload(payload = {}) {
    const warnings = [];
    const errors = [];

    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const images = attachments.filter(a => a && a.kind === 'image');
    const supportedImages = images.filter(a => isSupportedImageMime(a.mimeType));
    const selectedImages = supportedImages.slice(0, MAX_IMAGES);
    const text = String(payload.plainText || '').trim();

    for (const image of images) {
        if (!isSupportedImageMime(image.mimeType)) {
            warnings.push(t('Bluesky 不支持 {name} 的格式，已跳过', { name: imageLabel(image) }));
        }
    }
    if (supportedImages.length > MAX_IMAGES) {
        warnings.push(t('Bluesky 超过 {max} 张图片，只发送前 {max} 张', { max: MAX_IMAGES }));
    }

    if (!text && selectedImages.length === 0) {
        errors.push(images.length > 0
            ? t('正文为空，且图片格式均不受 Bluesky 支持（仅支持 JPEG/PNG/WebP/GIF）')
            : t('内容不能为空'));
    }

    const { graphemes, utf8Bytes } = measurePostText(text);
    if (graphemes > MAX_GRAPHEMES) {
        errors.push(t('Bluesky 单帖上限 {max} 字符（当前 {current}），请缩短内容', { max: MAX_GRAPHEMES, current: graphemes }));
    }
    if (utf8Bytes > MAX_TEXT_BYTES) {
        errors.push(t('Bluesky 单帖 UTF-8 上限 {max} 字节（当前 {current}），请缩短内容', { max: MAX_TEXT_BYTES, current: utf8Bytes }));
    }

    if (errors.length > 0) {
        return { text, images: [], warnings, errors };
    }

    if (selectedImages.length > 0 && typeof payload.readAttachment !== 'function') {
        errors.push(t('图片读取接口不可用'));
        return { text, images: [], warnings, errors };
    }

    const preparedImages = [];
    for (const image of selectedImages) {
        let buffer;
        try {
            buffer = await payload.readAttachment(image.vaultPath);
        } catch (error) {
            const detail = error?.message || String(error);
            errors.push(t('图片读取失败：{name}（{detail}）', { name: imageLabel(image), detail }));
            continue;
        }

        const size = Number(buffer?.byteLength) || 0;
        if (size <= 0) {
            errors.push(t('图片读取失败：{name}（文件为空）', { name: imageLabel(image) }));
            continue;
        }
        if (size > MAX_IMAGE_BYTES) {
            errors.push(t('Bluesky 单张图片上限 2 MB：{name}（当前 {size} 字节）', { name: imageLabel(image), size }));
            continue;
        }
        preparedImages.push({ attachment: image, buffer });
    }

    return { text, images: preparedImages, warnings, errors };
}

/**
 * 预检验证（发送前拦截，不出网络请求）
 */
async function validate({ payload = {} } = {}) {
    const prepared = await preparePayload(payload);
    return { warnings: prepared.warnings, errors: prepared.errors };
}

/**
 * 统一执行接口
 * @param {object} options
 * @param {object} options.config - { identifier, appPassword, serviceUrl }
 * @param {object} options.payload - 统一 payload
 * @param {Function} options.requestUrl
 */
async function execute({ config = {}, payload = {}, requestUrl }) {
    const identifier = String(config.identifier || '').trim();
    const appPassword = String(config.appPassword || '').trim();
    const serviceUrl = normalizeServiceUrl(config.serviceUrl);

    if (!identifier || !appPassword) {
        return { success: false, error: t('Bluesky 账号或 App Password 未配置') };
    }

    const warnings = [];

    try {
        const prepared = await preparePayload(payload);
        warnings.push(...prepared.warnings);
        if (prepared.errors.length > 0) {
            return { success: false, error: prepared.errors.join(t('；')), warnings };
        }

        const session = await createSession(serviceUrl, identifier, appPassword, requestUrl);

        // 逐张上传图片，任一失败则整体失败、不创建帖子
        const blobs = [];
        for (const { attachment: image, buffer } of prepared.images) {
            const upload = await uploadBlob(serviceUrl, session.accessJwt, buffer, image.mimeType, requestUrl);
            if (!upload.blob) {
                return { success: false, error: t('图片上传失败：{name}（{error}）；未发送任何内容。', { name: imageLabel(image), error: upload.error }), warnings };
            }
            blobs.push(upload.blob);
        }

        const record = {
            $type: 'app.bsky.feed.post',
            text: prepared.text,
            createdAt: new Date().toISOString()
        };
        const facets = buildLinkFacets(prepared.text);
        if (facets.length > 0) record.facets = facets;
        if (blobs.length > 0) {
            record.embed = {
                $type: 'app.bsky.embed.images',
                images: blobs.map(blob => ({ alt: '', image: blob }))
            };
        }

        const response = await requestUrl({
            url: `${serviceUrl}/xrpc/com.atproto.repo.createRecord`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.accessJwt}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                repo: session.did,
                collection: 'app.bsky.feed.post',
                record
            }),
            throw: false
        });

        if (response.status >= 200 && response.status < 300) {
            let result = {};
            try { result = response.json || {}; } catch {}
            return { success: true, url: buildPostUrl(result.uri, session), mediaCount: blobs.length, warnings };
        }
        return { success: false, error: xrpcErrorMessage(response, t('发帖')), warnings };
    } catch (error) {
        return { success: false, error: error.message || String(error), warnings };
    }
}

/**
 * 设置页扩展动作
 */
async function runAction(actionId, config, requestUrlFn) {
    if (actionId !== 'testConnection') {
        throw new Error(t('Bluesky 适配器不支持操作：{action}', { action: actionId }));
    }
    const identifier = String(config?.identifier || '').trim();
    const appPassword = String(config?.appPassword || '').trim();
    if (!identifier || !appPassword) {
        throw new Error(t('请先填写 Bluesky 账号与 App Password'));
    }
    const serviceUrl = normalizeServiceUrl(config.serviceUrl);
    const session = await createSession(serviceUrl, identifier, appPassword, requestUrlFn);
    return { success: true, message: t('已连接 {name}', { name: session.handle || identifier }) };
}

module.exports = { manifest, execute, validate, runAction };
