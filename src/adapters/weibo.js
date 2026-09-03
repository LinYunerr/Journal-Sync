/**
 * 微博适配器
 * 通过 Obsidian requestUrl 调用微博开放平台 Open API 发送微博。
 * 认证：OAuth2.0 授权码模式，access_token 持久化保存在插件设置（data.json），
 *       由设置页「打开授权页面 → 粘贴 code → 换取 Token」流程写入。
 * 前置条件：用户需在微博开放平台创建"网站应用"（未审核应用创建者本人即可调用），
 *       授权回调页填官方默认页 https://api.weibo.com/oauth2/default.html。
 * 文本：默认 140 字上限，is_longtext=1 可发长文；带图走 statuses/upload 单图接口（无 is_longtext）。
 * 文档：https://open.weibo.com/wiki/2/statuses/update
 */
import { Setting, Notice, Platform } from 'obsidian';

export const manifest = {
    id: 'weibo',
    version: '1.0.0',
    name: '微博',
    description: '发布内容到新浪微博',
    enabledByDefault: false,
    displayOrder: 60,
    capabilities: {
        text: true,
        attachments: true,
        attachmentTypes: ['image/*'],
        maxAttachments: 1,                  // MVP 走 statuses/upload 单图；九宫格多图为高级接口，后续版本支持
        maxAttachmentSize: 5 * 1024 * 1024, // 5MB 安全线，超出仅预警
        warnOnAttachmentCount: true,
        warnOnAttachmentSize: true
    },
    settings: {
        // 面板整体走 renderSettings 自定义渲染；可见性 / 长文模式的默认值取 defaultConfig，
        // 不在 schema 中重复维护，避免两处描述漂移
        fields: [
            { key: 'appKey', type: 'text', label: 'App Key', required: true },
            { key: 'appSecret', type: 'password', label: 'App Secret', required: true },
            { key: 'accessToken', type: 'password', label: 'Access Token（授权产物，由「换取 Token」写入）', required: true }
        ]
    }
};

/**
 * 适配器默认配置（与旧版 DEFAULT_SETTINGS.adaptersConfig.weibo 一致，
 * 设置系统初始值，优先于 manifest.settings.fields 的 default）
 */
export const defaultConfig = {
    appKey: '',
    appSecret: '',
    accessToken: '',
    uid: '',
    tokenObtainedAt: 0,
    expiresIn: 0,
    visibility: 'public',
    longTextMode: 'longtext'
};

const API_BASE = 'https://api.weibo.com';
const UPLOAD_API_BASE = 'https://upload.api.weibo.com';
const DEFAULT_REDIRECT_URI = 'https://api.weibo.com/oauth2/default.html';
const MAX_TEXT_UNITS = 140;
const SUPPORTED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif']);

const WEIBO_ERROR_MESSAGES = {
    21301: '微博授权已失效，请到设置中重新授权',
    21332: '微博授权关系已被解除，请到设置中重新授权',
    10015: '应用缺少该接口权限，请到微博开放平台申请',
    10022: '请求过于频繁，请稍后再试',
    10023: '请求过于频繁，请稍后再试',
    10025: '请求过于频繁，请稍后再试',
    40308: '发布次数达到微博频次上限，请稍后再试',
    20201: '授权时未勾选发博权限，请重新授权微博'
};

// authorize 防伪 state（一次性，换取 Token 时校验，仅存内存）
let pendingAuthState = '';

/**
 * 微博字数：汉字等全角字符按 1，英文数字等半角按 0.5，不足 1 进位
 */
function weiboTextLength(text) {
    const chars = Array.from(String(text || ''));
    let units = 0;
    for (const ch of chars) units += ch.codePointAt(0) > 255 ? 1 : 0.5;
    return Math.ceil(units);
}

function truncateToWeiboLimit(text, maxUnits = MAX_TEXT_UNITS) {
    const chars = Array.from(String(text || ''));
    let units = 0;
    let out = '';
    for (const ch of chars) {
        const width = ch.codePointAt(0) > 255 ? 1 : 0.5;
        if (units + width > maxUnits) break;
        units += width;
        out += ch;
    }
    return out;
}

/**
 * 本地过期预判：仅有授权产物记录时才拦截，否则交给 API 判定
 */
function isTokenExpired(config) {
    const obtainedAt = Number(config?.tokenObtainedAt || 0);
    const expiresIn = Number(config?.expiresIn || 0);
    if (!obtainedAt || !expiresIn) return false;
    return Date.now() - obtainedAt >= expiresIn * 1000;
}

/**
 * 将微博非 2xx 响应转换为中文错误信息
 * @param {object} response - requestUrl 响应
 * @param {string} actionLabel - '发微博' / '图片微博发送' / '换取 Token' 等，用于兜底文案
 */
function weiboApiErrorMessage(response, actionLabel) {
    let body = {};
    try { body = response.json || {}; } catch {}

    const errorCode = Number(body.error_code || body.code || 0) || 0;
    const rawError = String(body.error || body.error_description || response.text || '');

    // 官方规则：连续两次发布的微博不可以重复
    if (rawError.includes('重复')) return '微博拒绝连续重复内容，请修改内容后再试';
    if (errorCode && WEIBO_ERROR_MESSAGES[errorCode]) return WEIBO_ERROR_MESSAGES[errorCode];
    if (response.status === 401) return '微博授权已失效，请到设置中重新授权';

    const detail = rawError || `HTTP ${response.status}`;
    return `${actionLabel}失败（HTTP ${response.status}：${detail}）`;
}

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function encodeBase62(num) {
    if (num === 0) return '0';
    let out = '';
    while (num > 0) {
        out = BASE62_ALPHABET[num % 62] + out;
        num = Math.floor(num / 62);
    }
    return out;
}

/**
 * 微博 mid → base62 短码（社区通识算法）：
 * 从左切分，首段长度为 len % 7（整除时为 7），非首段转 base62 后补零至 4 位
 */
function midToBase62(mid) {
    const s = String(mid || '');
    if (!/^\d+$/.test(s)) return '';
    const firstLen = s.length % 7 || 7;
    let result = '';
    let offset = 0;
    let first = true;
    while (offset < s.length) {
        const seg = s.slice(offset, offset + (first ? firstLen : 7));
        const encoded = encodeBase62(Number(seg));
        result += first ? encoded : encoded.padStart(4, '0');
        first = false;
        offset += first ? firstLen : 7;
    }
    return result;
}

/**
 * 拼帖子链接：优先 https://weibo.com/{uid}/{mid base62}，退回个人主页链接
 */
function buildPostUrl(result, config) {
    const uid = String(result?.user?.idstr || result?.user?.id || config?.uid || '').trim();
    const base62 = midToBase62(result?.mid || '');
    if (uid && base62) return `https://weibo.com/${uid}/${base62}`;
    if (uid) return `https://weibo.com/u/${uid}`;
    return '';
}

/**
 * 纯文本发送：statuses/update（支持 is_longtext）
 */
async function sendTextUpdate({ accessToken, visible, status, isLongText, requestUrl }) {
    const response = await requestUrl({
        url: `${API_BASE}/2/statuses/update.json`,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            access_token: accessToken,
            status,
            visible,
            is_longtext: isLongText ? '1' : '0'
        }).toString(),
        throw: false
    });

    if (response.status < 200 || response.status >= 300) {
        return { success: false, error: weiboApiErrorMessage(response, '发微博'), data: null };
    }
    let result = {};
    try { result = response.json || {}; } catch {}
    return { success: true, data: result, error: '' };
}

/**
 * 带图发送：statuses/upload 单图 + 文本一次发送（multipart，不支持 is_longtext）
 */
async function uploadWithImage({ accessToken, visible, status, buffer, filename, mimeType, requestUrl }) {
    const safeFilename = String(filename || 'image.png').replace(/["\r\n]/g, '_');
    const boundary = `----WeiboBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
    const encoder = new TextEncoder();

    const parts = [];
    const addField = (name, value) => {
        parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    };
    addField('access_token', accessToken);
    addField('status', status);
    addField('visible', visible);
    parts.push(encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="pic"; filename="${safeFilename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    ));
    parts.push(new Uint8Array(buffer));
    parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

    const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        body.set(part, offset);
        offset += part.byteLength;
    }

    const response = await requestUrl({
        url: `${UPLOAD_API_BASE}/2/statuses/upload.json`,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: body.buffer,
        throw: false
    });

    if (response.status < 200 || response.status >= 300) {
        return { success: false, error: weiboApiErrorMessage(response, '图片微博发送'), data: null };
    }
    let result = {};
    try { result = response.json || {}; } catch {}
    return { success: true, data: result, error: '' };
}

/**
 * 预检验证（发送前拦截，不出网络请求）
 */
export async function validate({ payload, config = {} }) {
    const warnings = [];
    const errors = [];

    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    const images = attachments.filter(a => a && a.kind === 'image');
    const supportedImages = images.filter(a => SUPPORTED_IMAGE_MIME.has(a.mimeType));
    const plainText = String(payload.plainText || '').trim();

    if (!plainText && supportedImages.length === 0) {
        errors.push(images.length > 0
            ? '正文为空，且图片格式均不受微博支持（仅支持 JPG/PNG/GIF）'
            : '内容不能为空');
        return { warnings, errors };
    }

    const longTextMode = ['longtext', 'truncate', 'error'].includes(config.longTextMode) ? config.longTextMode : 'longtext';
    const textUnits = weiboTextLength(plainText);
    if (textUnits > MAX_TEXT_UNITS) {
        if (longTextMode === 'error') {
            errors.push(`微博默认上限 ${MAX_TEXT_UNITS} 字，当前 ${textUnits} 字，请缩短内容或在设置中将长文模式改为「长文」`);
        } else if (supportedImages.length > 0) {
            warnings.push('带图微博暂不支持长文，发送时正文将截断至 140 字');
        }
    }

    return { warnings, errors };
}

/**
 * 统一执行接口
 * @param {object} options
 * @param {object} options.config - { appKey, appSecret, accessToken, uid, tokenObtainedAt, expiresIn, visibility, longTextMode }
 * @param {object} options.payload - 统一 payload
 * @param {Function} options.requestUrl
 */
export async function execute({ config = {}, payload = {}, requestUrl }) {
    const appKey = String(config.appKey || '').trim();
    const appSecret = String(config.appSecret || '').trim();
    const accessToken = String(config.accessToken || '').trim();

    if (!appKey || !appSecret || !accessToken) {
        return { success: false, error: '微博未配置或未授权，请先在设置中填写 App Key / App Secret 并完成授权' };
    }
    if (isTokenExpired(config)) {
        return { success: false, error: '微博授权已过期，请到设置中重新授权' };
    }

    const warnings = [];
    const visible = config.visibility === 'private' ? '1' : '0';
    const longTextMode = ['longtext', 'truncate', 'error'].includes(config.longTextMode) ? config.longTextMode : 'longtext';

    try {
        // 附件：过滤微博支持的格式，最多 1 张（statuses/upload 单图）
        const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
        const allImages = attachments.filter(a => a && a.kind === 'image');
        for (const image of allImages) {
            if (!SUPPORTED_IMAGE_MIME.has(image.mimeType)) {
                warnings.push(`微博不支持 ${image.filename || '图片'} 的格式（仅支持 JPG/PNG/GIF），已跳过`);
            }
        }
        const supportedImages = allImages.filter(a => SUPPORTED_IMAGE_MIME.has(a.mimeType));
        const maxImages = manifest.capabilities.maxAttachments;
        const images = supportedImages.slice(0, maxImages);
        if (supportedImages.length > maxImages) {
            warnings.push('微博暂只支持发送 1 张图片，已发送第 1 张（多图将在后续版本支持）');
        }

        const rawText = String(payload.plainText || '').trim();

        // 带图：statuses/upload 单图 + 文本一次发送（该接口无 is_longtext）
        if (images.length > 0) {
            let buffer = null;
            try {
                buffer = typeof payload.readAttachment === 'function'
                    ? await payload.readAttachment(images[0].vaultPath)
                    : null;
            } catch (error) {
                return { success: false, error: `图片读取失败：${images[0].filename}（${error.message || String(error)}）；未发送任何内容。`, warnings };
            }
            if (!buffer) {
                return { success: false, error: `图片读取失败：${images[0].filename}；未发送任何内容。`, warnings };
            }

            let statusText = rawText;
            if (weiboTextLength(statusText) > MAX_TEXT_UNITS) {
                if (longTextMode === 'error') {
                    return { success: false, error: `带图微博不支持长文：正文 ${weiboTextLength(statusText)} 字，超过 140 字上限。请缩短正文或改为纯文本发送`, warnings };
                }
                statusText = truncateToWeiboLimit(statusText);
                warnings.push('带图微博暂不支持长文，正文已截断至 140 字');
            }
            if (!statusText) statusText = '📷'; // 微博要求 status 必填

            const result = await uploadWithImage({
                accessToken, visible, status: statusText,
                buffer, filename: images[0].filename, mimeType: images[0].mimeType, requestUrl
            });
            if (!result.success) return { success: false, error: result.error, warnings };
            return { success: true, url: buildPostUrl(result.data, config), mediaCount: 1, warnings };
        }

        // 纯文本：statuses/update
        if (!rawText) {
            return { success: false, error: '内容不能为空', warnings };
        }
        let finalText = rawText;
        let isLongText = false;
        const textUnits = weiboTextLength(finalText);
        if (textUnits > MAX_TEXT_UNITS) {
            if (longTextMode === 'truncate') {
                finalText = truncateToWeiboLimit(finalText);
                warnings.push('正文已截断至 140 字');
            } else if (longTextMode === 'error') {
                return { success: false, error: `微博默认上限 140 字，当前 ${textUnits} 字，请缩短内容或在设置中将长文模式改为「长文」`, warnings };
            } else {
                isLongText = true; // longtext：交给服务端 is_longtext
            }
        }

        const result = await sendTextUpdate({ accessToken, visible, status: finalText, isLongText, requestUrl });
        if (!result.success) return { success: false, error: result.error, warnings };
        return { success: true, url: buildPostUrl(result.data, config), mediaCount: 0, warnings };
    } catch (error) {
        return { success: false, error: error.message || String(error), warnings };
    }
}

/**
 * 从用户粘贴内容中提取 code / state（支持直接粘贴回调页完整地址）
 */
function extractAuthCode(raw) {
    const input = String(raw || '').trim();
    if (!input) return { code: '', state: '' };

    const codeMatch = input.match(/[?&]code=([^&\s]+)/);
    if (codeMatch) {
        let code = codeMatch[1];
        try { code = decodeURIComponent(code); } catch {}
        const stateMatch = input.match(/[?&]state=([^&\s]+)/);
        let state = stateMatch ? stateMatch[1] : '';
        try { state = decodeURIComponent(state); } catch {}
        return { code, state };
    }
    if (/^https?:\/\//i.test(input)) {
        throw new Error('粘贴的地址中未找到授权 code，请在微博授权页登录后从地址栏复制 code 或完整回调地址');
    }
    return { code: input, state: '' };
}

/**
 * 设置页扩展动作
 * - getAuthorizeUrl：生成 OAuth2 authorize 链接（options.mobile 时用 open.weibo.cn H5 形态）
 * - exchangeToken：用 code + App Key/Secret 换取 access_token，返回授权产物供设置页写回
 * - testConnection：调 account/rate_limit_status 验证 token 有效性
 */
export async function runAction(actionId, config = {}, requestUrlFn, options = {}) {
    if (actionId === 'getAuthorizeUrl') {
        const appKey = String(config?.appKey || '').trim();
        if (!appKey) throw new Error('请先填写微博 App Key');

        pendingAuthState = `jsb${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
        const params = new URLSearchParams({
            client_id: appKey,
            redirect_uri: DEFAULT_REDIRECT_URI,
            response_type: 'code',
            state: pendingAuthState
        });
        const base = options.mobile ? 'https://open.weibo.cn/oauth2/authorize' : `${API_BASE}/oauth2/authorize`;
        if (options.mobile) params.set('display', 'mobile');
        return { success: true, data: { url: `${base}?${params.toString()}` }, message: '已生成微博授权链接' };
    }

    if (actionId === 'exchangeToken') {
        const appKey = String(config?.appKey || '').trim();
        const appSecret = String(config?.appSecret || '').trim();
        if (!appKey || !appSecret) throw new Error('请先填写微博 App Key 与 App Secret');

        const { code, state } = extractAuthCode(config?.code);
        if (!code) throw new Error('请先粘贴授权 code（登录授权后从回调页地址栏复制）');
        if (state && pendingAuthState && state !== pendingAuthState) {
            throw new Error('授权 state 校验失败，请重新点击「打开授权页面」再试');
        }

        const response = await requestUrlFn({
            url: `${API_BASE}/oauth2/access_token`,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: appKey,
                client_secret: appSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: DEFAULT_REDIRECT_URI
            }).toString(),
            throw: false
        });
        if (response.status < 200 || response.status >= 300) {
            throw new Error(weiboApiErrorMessage(response, '换取 Token'));
        }

        let result = {};
        try { result = response.json || {}; } catch {}
        if (!result.access_token) throw new Error('微博未返回 access_token，请重试');
        pendingAuthState = '';

        const uid = String(result.uid || result.id || '');
        const expiresIn = Number(result.expires_in || 0);
        return {
            success: true,
            data: {
                accessToken: String(result.access_token),
                uid,
                tokenObtainedAt: Date.now(),
                expiresIn
            },
            message: `已授权微博账号${uid ? ` uid=${uid}` : ''}${expiresIn ? `，token 有效期 ${expiresIn} 秒（短效请到开放平台配置长期授权）` : ''}`
        };
    }

    if (actionId === 'testConnection') {
        const accessToken = String(config?.accessToken || '').trim();
        if (!accessToken) throw new Error('请先完成微博授权');
        const response = await requestUrlFn({
            url: `${API_BASE}/2/account/rate_limit_status.json?access_token=${encodeURIComponent(accessToken)}`,
            method: 'GET',
            throw: false
        });
        if (response.status < 200 || response.status >= 300) {
            throw new Error(weiboApiErrorMessage(response, '测试连接'));
        }

        let result = {};
        try { result = response.json || {}; } catch {}
        const status = result.rate_limit_status || {};
        const remaining = status.user_remaining ?? status.remaining_user_hits;
        const limit = status.user_limit ?? status.limit_user_hits;
        const uid = String(config?.uid || '').trim();
        let message = '连接成功';
        if (uid) message += `（uid=${uid}）`;
        if (remaining !== undefined) message += `，本小时剩余请求 ${remaining}${limit !== undefined ? `/${limit}` : ''} 次`;
        return { success: true, message };
    }

    throw new Error(`微博适配器不支持操作：${actionId}`);
}

/**
 * 微博自定义设置面板（设置页在「启用 微博」后调用，启用开关由设置页渲染）
 * @param {HTMLElement} containerEl
 * @param {object} ctx - { plugin, containerEl, scheduleConfigSave(patch), saveConfig(patch), refresh(), requestUrl }
 */
export function renderSettings(containerEl, ctx) {
    const config = ctx.plugin.getAdapterConfig('weibo') || {};

    new Setting(containerEl)
        .setName('⚠️ 当前插件未经测试')
        .setDesc('微博适配器尚未经过完整测试，使用中如遇问题，欢迎在 GitHub 上提 issue 反馈。');

    new Setting(containerEl)
        .setName('微博开放平台')
        .setDesc('需在微博开放平台（open.weibo.com）创建应用后使用：① 注册开发者并完成个人身份认证；② 创建「网站应用」，授权回调页填 https://api.weibo.com/oauth2/default.html；③ 建议在「高级信息 → OAuth2.0 授权设置」中配置长期授权，避免 token 短时间过期。凭据仅保存在本地 data.json。');

    new Setting(containerEl)
        .setName('App Key')
        .setDesc('开放平台网站应用的 App Key。')
        .addText(text => text
            .setPlaceholder('App Key')
            .setValue(config.appKey || '')
            .onChange(value => ctx.scheduleConfigSave({ appKey: value.trim() })));

    new Setting(containerEl)
        .setName('App Secret')
        .setDesc('开放平台网站应用的 App Secret，仅保存在本地 data.json，请勿外传。')
        .addText(text => {
            text.inputEl.type = 'password';
            text.setPlaceholder('App Secret')
                .setValue(config.appSecret || '')
                .onChange(value => ctx.scheduleConfigSave({ appSecret: value.trim() }));
        });

    const obtainedAt = Number(config.tokenObtainedAt || 0);
    const expiresIn = Number(config.expiresIn || 0);
    const tokenExpired = obtainedAt && expiresIn && Date.now() - obtainedAt >= expiresIn * 1000;
    const authDesc = config.accessToken
        ? `已授权${config.uid ? ` uid=${config.uid}` : ''}${tokenExpired ? '，授权已过期，请重新授权' : ''}。`
        : '尚未授权。点击「打开授权页面」登录微博后，从回调页地址栏复制 code。';

    new Setting(containerEl)
        .setName('微博授权')
        .setDesc(authDesc)
        .addButton(btn => btn
            .setButtonText('打开授权页面')
            .onClick(async () => {
                try {
                    btn.setButtonText('打开中...');
                    btn.disabled = true;
                    const result = await runAction(
                        'getAuthorizeUrl',
                        ctx.plugin.getAdapterConfig('weibo'),
                        ctx.requestUrl,
                        { mobile: Platform.isMobile }
                    );
                    const url = result?.data?.url || '';
                    if (!url) throw new Error(result?.message || '未获取到授权链接');
                    if (Platform.isMobile) {
                        navigator.clipboard.writeText(url).then(() => {
                            new Notice('授权链接已复制，请在浏览器中打开并登录微博');
                        }).catch(() => {
                            new Notice(`复制失败，请手动打开授权页：${url}`);
                        });
                    } else {
                        window.open(url, '_blank');
                        new Notice('已在浏览器打开微博授权页，登录后从地址栏复制 code 或完整回调地址');
                    }
                } catch (error) {
                    new Notice(`打开授权页失败：${error.message}`);
                } finally {
                    btn.setButtonText('打开授权页面');
                    btn.disabled = false;
                }
            }));

    let authCode = '';
    new Setting(containerEl)
        .setName('授权 Code')
        .setDesc('粘贴回调页地址栏中的 code，或直接粘贴完整回调地址。')
        .addText(text => text
            .setPlaceholder('粘贴 code 或回调地址')
            .onChange(value => { authCode = value.trim(); }))
        .addButton(btn => btn
            .setButtonText('换取 Token')
            .onClick(async () => {
                if (!authCode) {
                    new Notice('请先粘贴授权 code');
                    return;
                }
                try {
                    btn.setButtonText('换取中...');
                    btn.disabled = true;
                    const result = await runAction(
                        'exchangeToken',
                        { ...ctx.plugin.getAdapterConfig('weibo'), code: authCode },
                        ctx.requestUrl
                    );
                    const data = result?.data || {};
                    await ctx.saveConfig({
                        accessToken: data.accessToken || '',
                        uid: data.uid || '',
                        tokenObtainedAt: data.tokenObtainedAt || 0,
                        expiresIn: data.expiresIn || 0
                    });
                    new Notice(result.message || '授权成功');
                    ctx.refresh();
                } catch (error) {
                    new Notice(`换取 Token 失败：${error.message}`);
                } finally {
                    btn.setButtonText('换取 Token');
                    btn.disabled = false;
                }
            }));

    new Setting(containerEl)
        .setName('测试连接')
        .setDesc('调用微博频次接口，验证授权是否有效。')
        .addButton(btn => btn
            .setButtonText('测试连接')
            .onClick(async () => {
                try {
                    btn.setButtonText('连接中...');
                    btn.disabled = true;
                    const result = await runAction(
                        'testConnection',
                        ctx.plugin.getAdapterConfig('weibo'),
                        ctx.requestUrl
                    );
                    new Notice(result.message || '连接成功');
                } catch (error) {
                    new Notice(`连接失败：${error.message}`);
                } finally {
                    btn.setButtonText('测试连接');
                    btn.disabled = false;
                }
            }));

    new Setting(containerEl)
        .setName('可见性')
        .setDesc('公开：所有人可见；仅自己可见：只有自己能看到这条微博。')
        .addDropdown(dropdown => dropdown
            .addOption('public', '公开')
            .addOption('private', '仅自己可见')
            .setValue(config.visibility || 'public')
            .onChange(value => ctx.scheduleConfigSave({ visibility: value })));

    new Setting(containerEl)
        .setName('长文模式')
        .setDesc('正文超过 140 字时的处理方式（带图发送不支持长文，会自动截断）。')
        .addDropdown(dropdown => dropdown
            .addOption('longtext', '长文（折叠为展开全文）')
            .addOption('truncate', '截断至 140 字')
            .addOption('error', '超长拒发')
            .setValue(config.longTextMode || 'longtext')
            .onChange(value => ctx.scheduleConfigSave({ longTextMode: value })));
}

export default { manifest, execute, validate, runAction, renderSettings, defaultConfig };
