/**
 * Threads 适配器（Meta Threads）
 * 通过 Obsidian requestUrl 调用 Threads Graph API（https://graph.threads.net/v1.0/）发布纯文本。
 * 认证：OAuth 2.0 用户自建 Meta App，长期 token（60 天）存 data.json，
 *       发送前按需自动刷新（刷新端点不需要 client_secret），经 saveConfig 持久化。
 * 发布是两步流：先创建 TEXT 媒体容器，再 threads_publish，最后取 permalink。
 * 设计文档：docs/research-threads-support.md（Phase 1 纯文本）
 *
 * runAction 扩展：
 * - connectCode(options.code)：授权码（或完整回调 URL）换取长期 token，
 *   返回 { success, message, configPatch }，由设置页负责持久化 configPatch。
 * - testConnection()：GET /me + threads_publishing_limit，返回配额摘要。
 * 另导出 authorizeUrl(config)，供设置页「打开授权页」拼装授权地址。
 */

export const manifest = {
    id: 'threads',
    version: '1.0.0',
    name: 'Threads',
    description: '发布内容到 Threads (Meta)',
    enabledByDefault: false,
    capabilities: {
        text: true
        // Phase 2 图片上线时追加：
        // attachments: true, attachmentTypes: ['image/jpeg', 'image/png'],
        // maxAttachments: 20, maxAttachmentSize: 8000000,
        // warnOnAttachmentCount: true, warnOnAttachmentSize: true
    },
    settings: {
        fields: [
            { key: 'clientId', type: 'text', label: 'Threads App ID', required: true, placeholder: '纯数字 App ID' },
            { key: 'clientSecret', type: 'password', label: 'App Secret', required: true },
            { key: 'redirectUri', type: 'text', label: '重定向 URI', default: 'https://localhost:3000/callback' },
            { key: 'accessToken', type: 'password', label: 'Access Token', required: true },
            {
                key: 'replyControl',
                type: 'select',
                label: '回复权限',
                options: [
                    { value: 'everyone', label: '所有人' },
                    { value: 'accounts_you_follow', label: '你关注的账号' },
                    { value: 'mentioned_only', label: '仅限提及的账号' }
                ],
                default: 'everyone'
            }
        ]
    }
};

const API_BASE = 'https://graph.threads.net/v1.0';
const OAUTH_BASE = 'https://graph.threads.net';
const DEFAULT_REDIRECT_URI = 'https://localhost:3000/callback';
const MAX_TEXT_LENGTH = 500; // 官方口径：emoji 按 UTF-8 字节数计
const MAX_LINKS = 5;         // 2025-12 起正文链接 + link_attachment 合计上限
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 3600 * 1000;
const DEFAULT_TOKEN_TTL_MS = 60 * 24 * 3600 * 1000;

const REPLY_CONTROL_VALUES = new Set(['everyone', 'accounts_you_follow', 'mentioned_only']);

function normalizeReplyControl(value) {
    const v = String(value || '').trim();
    return REPLY_CONTROL_VALUES.has(v) ? v : '';
}

/**
 * Threads 文本长度：BMP 码点记 1，增补平面（绝大多数 emoji）按 UTF-8 记 4。
 */
function threadsTextLength(text) {
    let len = 0;
    for (const ch of String(text || '')) {
        len += ch.codePointAt(0) >= 0x10000 ? 4 : 1;
    }
    return len;
}

function countUniqueUrls(text) {
    const matches = String(text || '').match(/https?:\/\/[^\s<>"']+/g) || [];
    const urls = new Set();
    for (const raw of matches) {
        const url = raw.replace(/[.,;:!?)\]}>'"。，；：！？）」』]+$/g, '').toLowerCase();
        if (/^https?:\/\//.test(url)) urls.add(url);
    }
    return urls.size;
}

function responseJson(response) {
    try { return response.json || {}; } catch { return {}; }
}

/**
 * Graph API 非 2xx 响应 → 中文错误信息（兼容 error 嵌套与平铺两种错误体）
 */
function graphErrorMessage(response, actionLabel) {
    const body = responseJson(response);
    const err = (body.error && typeof body.error === 'object') ? body.error : {};
    const code = Number(err.code ?? body.code) || 0;
    const detail = String(err.message || err.error_message || body.error_message || body.message
        || (typeof body.error === 'string' ? body.error : '') || `HTTP ${response.status}`);
    const userMsg = String(err.error_user_msg || body.error_user_msg || '');
    const combined = `${detail} ${userMsg}`;

    if (code === 190 || /access token|token has expired|invalid oauth/i.test(combined)) {
        return 'Threads 授权已失效，请到设置页重新授权';
    }
    if (combined.includes('LINK_LIMIT')) {
        return `Threads 单帖最多 ${MAX_LINKS} 个链接（正文与链接卡片合并计算），请减少链接后重试`;
    }
    if (response.status === 429) {
        return '触发 Threads 限流，请稍后再试';
    }
    if (/quota|publishing limit/i.test(combined)) {
        return '已达 Threads 24 小时发布上限（250 帖），请稍后再试';
    }
    return `${actionLabel}失败（HTTP ${response.status}：${userMsg || detail}）`;
}

/**
 * OAuth 换 token 端点非 2xx 响应 → 中文错误信息。
 * 重点覆盖 redirect_uri 不一致与 code 复用这两个最常见故障。
 */
function oauthExchangeErrorMessage(response) {
    const body = responseJson(response);
    const err = (body.error && typeof body.error === 'object') ? body.error : {};
    const detail = String(err.message || err.error_message || body.error_message || body.error_description
        || (typeof body.error === 'string' ? body.error : '') || `HTTP ${response.status}`);

    if (/redirect/i.test(detail) || /url blocked/i.test(detail)) {
        return '重定向 URI 与 Meta App 后台登记不一致，请逐字符核对（注意后台可能自动补尾斜杠）';
    }
    if (/code.*(?:used|expired|invalid)|invalid.*code/i.test(detail)) {
        return '授权码无效或已被使用（code 只能用一次），请重新打开授权页获取新的 code';
    }
    if (Number(err.code ?? body.code) === 190) {
        return 'Threads 授权已失效，请到设置页重新授权';
    }
    return `Threads 授权失败（HTTP ${response.status}：${detail}）`;
}

async function fetchProfile(requestUrlFn, accessToken) {
    const response = await requestUrlFn({
        url: `${API_BASE}/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
        method: 'GET',
        throw: false
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(graphErrorMessage(response, '获取 Threads 用户信息'));
    }
    const body = responseJson(response);
    if (!body.id) throw new Error('Threads 未返回用户信息');
    return { id: String(body.id), username: String(body.username || '') };
}

/**
 * 刷新长期 token。响应 { access_token, expires_in(秒) }。
 */
async function refreshAccessToken(accessToken, requestUrlFn) {
    const response = await requestUrlFn({
        url: `${OAUTH_BASE}/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(accessToken)}`,
        method: 'GET',
        throw: false
    });
    if (response.status < 200 || response.status >= 300) {
        const body = responseJson(response);
        const err = (body.error && typeof body.error === 'object') ? body.error : {};
        const detail = String(err.message || err.error_message || body.error_message || body.message
            || `HTTP ${response.status}`);
        throw new Error(`Threads token 刷新失败（HTTP ${response.status}：${detail}）`);
    }
    const body = responseJson(response);
    if (!body.access_token) throw new Error('Threads 未返回刷新后的 token');
    return {
        accessToken: String(body.access_token),
        expiresInMs: (Number(body.expires_in) > 0 ? Number(body.expires_in) * 1000 : DEFAULT_TOKEN_TTL_MS)
    };
}

/**
 * 发送前 token 有效性保障：
 * 已过期 → 直接失败；7 天内到期（或缺失过期时间）且颁发满 24h → 自动刷新并 saveConfig；
 * 刷新失败但旧 token 未过期 → 不阻塞发送，仅预警。
 * @returns {Promise<{ token: string, warnings: string[] }>}
 */
async function getValidToken({ config, requestUrl, saveConfig }) {
    const token = String(config.accessToken || '').trim();
    if (!token) throw new Error('Threads 未授权：请到设置页完成连接或手动粘贴长期 Access Token');

    const now = Date.now();
    const expiresAt = Number(config.tokenExpiresAt) || 0;
    const issuedAt = Number(config.tokenIssuedAt) || 0;

    if (expiresAt && now >= expiresAt) {
        throw new Error('Threads 授权已过期，请到设置页重新授权');
    }

    const expiringSoon = !expiresAt || expiresAt - now <= SEVEN_DAYS_MS;
    const refreshable = issuedAt > 0 && now - issuedAt >= TWENTY_FOUR_HOURS_MS;
    if (expiringSoon && refreshable) {
        try {
            const refreshed = await refreshAccessToken(token, requestUrl);
            const issuedNow = Date.now();
            if (typeof saveConfig === 'function') {
                await saveConfig({
                    accessToken: refreshed.accessToken,
                    tokenIssuedAt: issuedNow,
                    tokenExpiresAt: issuedNow + refreshed.expiresInMs
                });
            }
            return { token: refreshed.accessToken, warnings: [] };
        } catch (error) {
            const message = error.message || String(error);
            if (!expiresAt || now < expiresAt) {
                return { token, warnings: [`Threads token 自动刷新失败，已使用现有 token（${message}）`] };
            }
            throw new Error(`Threads token 刷新失败：${message}，请到设置页重新授权`);
        }
    }

    return { token, warnings: [] };
}

/**
 * threadsUserId 缺失（如手动粘贴 token 的用户）时通过 /me 兜底获取并回写 config。
 */
async function ensureUserId(config, token, requestUrlFn, saveConfig) {
    const known = String(config.threadsUserId || '').trim();
    if (known) return known;
    const profile = await fetchProfile(requestUrlFn, token);
    try {
        if (typeof saveConfig === 'function') {
            await saveConfig({ threadsUserId: profile.id, username: profile.username });
        }
    } catch { /* 回写失败不影响发送 */ }
    return profile.id;
}

/**
 * 从「完整回调 URL」或「裸 code」中提取授权码（回调尾部带 #_，code= 匹配到 &/# 即止）。
 */
function extractAuthCode(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    if (raw.includes('code=')) {
        const match = raw.match(/code=([^&#\s]+)/);
        return match ? match[1] : '';
    }
    return raw;
}

/**
 * 授权页地址（导出供设置页「打开授权页」使用，不含任何 secret）。
 */
export function authorizeUrl(config = {}) {
    const clientId = String(config.clientId || '').trim();
    const redirectUri = String(config.redirectUri || '').trim() || DEFAULT_REDIRECT_URI;
    if (!clientId) return '';
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'threads_basic,threads_content_publish'
    });
    return `https://threads.net/oauth/authorize?${params.toString()}`;
}

/**
 * 预检验证（发送前拦截，不出网络请求）
 */
export async function validate({ payload = {}, config = {} } = {}) {
    const warnings = [];
    const errors = [];

    if (!String(config.accessToken || '').trim()) {
        errors.push('Threads 未授权：请到设置页完成连接或手动粘贴长期 Access Token');
    }

    const plainText = String(payload.plainText || '').trim();
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

    if (!plainText) {
        errors.push(attachments.length > 0
            ? 'Threads 暂不支持发送图片（仅支持纯文本），请补充正文'
            : '内容不能为空');
    } else {
        const length = threadsTextLength(plainText);
        if (length > MAX_TEXT_LENGTH) {
            errors.push(`Threads 单帖上限 ${MAX_TEXT_LENGTH} 字符（当前 ${length}），请缩短内容`);
        }
        if (countUniqueUrls(plainText) > MAX_LINKS) {
            warnings.push(`Threads 单帖最多 ${MAX_LINKS} 个链接，超出部分可能被服务端拒绝`);
        }
    }

    return { warnings, errors };
}

/**
 * 统一执行接口（Phase 1：纯文本）
 * @param {object} options
 * @param {object} options.config - { accessToken, threadsUserId, replyControl, tokenIssuedAt, tokenExpiresAt, ... }
 * @param {object} options.payload - 统一 payload（plainText / attachments / readAttachment）
 * @param {Function} options.requestUrl
 * @param {Function} [options.saveConfig] - token 自动刷新后的持久化入口
 */
export async function execute({ config = {}, payload = {}, requestUrl, saveConfig } = {}) {
    const warnings = [];

    try {
        if (!requestUrl) return { success: false, error: '缺少 requestUrl', warnings };

        const { token, warnings: tokenWarnings } = await getValidToken({ config, requestUrl, saveConfig });
        warnings.push(...tokenWarnings);

        const text = String(payload.plainText || '').trim();
        if (!text) {
            const hasImages = Array.isArray(payload.attachments) && payload.attachments.length > 0;
            return { success: false, error: hasImages ? 'Threads 暂不支持发送图片（仅支持纯文本）' : '内容不能为空', warnings };
        }
        if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
            warnings.push('Threads 暂不支持发送图片，本次仅发送文本');
        }

        const userId = await ensureUserId(config, token, requestUrl, saveConfig);

        // 第一步：创建 TEXT 媒体容器（参数 form-encode 后放 body，避免长文本进 query）
        const createForm = new URLSearchParams({
            access_token: token,
            media_type: 'TEXT',
            text
        });
        const replyControl = normalizeReplyControl(config.replyControl);
        if (replyControl && replyControl !== 'everyone') createForm.set('reply_control', replyControl);

        const createResponse = await requestUrl({
            url: `${API_BASE}/${encodeURIComponent(userId)}/threads`,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: createForm.toString(),
            throw: false
        });
        if (createResponse.status < 200 || createResponse.status >= 300) {
            return { success: false, error: graphErrorMessage(createResponse, '创建 Threads 帖子'), warnings };
        }
        const containerId = responseJson(createResponse).id;
        if (!containerId) {
            return { success: false, error: 'Threads 未返回媒体容器 ID', warnings };
        }

        // 第二步：发布（TEXT 容器可立即发布，无需等待处理状态）
        const publishForm = new URLSearchParams({
            access_token: token,
            creation_id: containerId
        });
        const publishResponse = await requestUrl({
            url: `${API_BASE}/${encodeURIComponent(userId)}/threads_publish`,
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: publishForm.toString(),
            throw: false
        });
        if (publishResponse.status < 200 || publishResponse.status >= 300) {
            return { success: false, error: graphErrorMessage(publishResponse, '发布 Threads 帖子'), warnings };
        }
        const postId = responseJson(publishResponse).id;

        // 第三步：取 permalink（失败不影响发送结果，仅影响返回链接）
        let url = '';
        if (postId) {
            try {
                const permalinkResponse = await requestUrl({
                    url: `${API_BASE}/${encodeURIComponent(postId)}?fields=permalink&access_token=${encodeURIComponent(token)}`,
                    method: 'GET',
                    throw: false
                });
                if (permalinkResponse.status >= 200 && permalinkResponse.status < 300) {
                    url = String(responseJson(permalinkResponse).permalink || '');
                }
            } catch { /* permalink 获取失败不回滚已发布的帖子 */ }
        }

        return { success: true, url, warnings };
    } catch (error) {
        return { success: false, error: error.message || String(error), warnings };
    }
}

/**
 * 授权码（或完整回调 URL）换长期 token，并获取用户信息。
 * @param {string} actionId - 'connectCode'
 * @param {object} config - 需含 clientId / clientSecret / redirectUri
 * @param {Function} requestUrlFn
 * @param {{ code?: string }} [options] - code：用户从浏览器地址栏复制的完整 URL 或裸授权码
 * @returns {Promise<{ success: boolean, message: string, configPatch: object }>}
 *          configPatch 由设置页负责写入 adaptersConfig.threads
 */
async function connectCode(config, requestUrlFn, options = {}) {
    const clientId = String(config.clientId || '').trim();
    const clientSecret = String(config.clientSecret || '').trim();
    const redirectUri = String(config.redirectUri || '').trim() || DEFAULT_REDIRECT_URI;
    if (!clientId || !clientSecret) {
        throw new Error('请先填写 Threads App ID 与 App Secret');
    }
    const code = extractAuthCode(options.code);
    if (!code) {
        throw new Error('请粘贴授权后浏览器地址栏中的完整链接或其中的 code');
    }

    // 1. code → 短期 token（1 小时，一次性）；redirect_uri 必须与授权时逐字符一致
    const shortForm = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
    });
    const shortResponse = await requestUrlFn({
        url: `${OAUTH_BASE}/oauth/access_token`,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: shortForm.toString(),
        throw: false
    });
    if (shortResponse.status < 200 || shortResponse.status >= 300) {
        throw new Error(oauthExchangeErrorMessage(shortResponse));
    }
    const shortBody = responseJson(shortResponse);
    if (!shortBody.access_token) throw new Error('Threads 授权响应缺少短期 token');

    // 2. 短期 token → 长期 token（60 天），短期 token 绝不落盘
    const longResponse = await requestUrlFn({
        url: `${OAUTH_BASE}/access_token?grant_type=th_exchange_token`
            + `&client_secret=${encodeURIComponent(clientSecret)}`
            + `&access_token=${encodeURIComponent(shortBody.access_token)}`,
        method: 'GET',
        throw: false
    });
    if (longResponse.status < 200 || longResponse.status >= 300) {
        throw new Error(oauthExchangeErrorMessage(longResponse));
    }
    const longBody = responseJson(longResponse);
    if (!longBody.access_token) throw new Error('Threads 授权响应缺少长期 token');
    const expiresInMs = Number(longBody.expires_in) > 0
        ? Number(longBody.expires_in) * 1000
        : DEFAULT_TOKEN_TTL_MS;

    // 3. 获取用户 id / 用户名
    const profile = await fetchProfile(requestUrlFn, longBody.access_token);

    const issuedAt = Date.now();
    return {
        success: true,
        message: `已连接 Threads 账号 @${profile.username || profile.id}`,
        configPatch: {
            accessToken: String(longBody.access_token),
            tokenIssuedAt: issuedAt,
            tokenExpiresAt: issuedAt + expiresInMs,
            threadsUserId: profile.id || String(shortBody.user_id || ''),
            username: profile.username
        }
    };
}

/**
 * 测试连接：验证 token 并展示 24h 发帖配额。
 */
async function testConnection(config, requestUrlFn) {
    const token = String(config.accessToken || '').trim();
    if (!token) {
        throw new Error('请先完成 Threads 授权（「完成连接」或手动粘贴长期 Access Token）');
    }
    const profile = await fetchProfile(requestUrlFn, token);

    let quotaText = '';
    const userId = profile.id || String(config.threadsUserId || '').trim();
    if (userId) {
        try {
            const response = await requestUrlFn({
                url: `${API_BASE}/${encodeURIComponent(userId)}/threads_publishing_limit?access_token=${encodeURIComponent(token)}`,
                method: 'GET',
                throw: false
            });
            if (response.status >= 200 && response.status < 300) {
                const body = responseJson(response);
                const data = Array.isArray(body.data) ? (body.data[0] || {}) : body;
                const total = Number(data.quota_total) || 0;
                const used = Number(data.quota_usage) || 0;
                if (total > 0) quotaText = `，24h 发帖配额剩余 ${Math.max(total - used, 0)}/${total}`;
            }
        } catch { /* 配额查询失败不影响连接验证结论 */ }
    }

    return { success: true, message: `已连接 @${profile.username || profile.id}${quotaText}` };
}

/**
 * 设置页扩展动作
 */
export async function runAction(actionId, config, requestUrlFn, options = {}) {
    if (actionId === 'connectCode') return connectCode(config, requestUrlFn, options);
    if (actionId === 'testConnection') return testConnection(config, requestUrlFn);
    throw new Error(`Threads 适配器不支持操作：${actionId}`);
}

export default { manifest, execute, validate, runAction };
