/**
 * 发送调度核心模块（纯逻辑，不依赖 obsidian / DOM）
 *
 * 职责拆分自 send-modal 的 _doSendInternal：
 * 1. collectTargets  —— 发送目标收集与过滤（停用平台、stale Telegram 频道、失效 Mastodon 账号）
 * 2. dispatchSends   —— 后台发送执行：通用适配器之间并行；telegram（单调用，adapter 内部按频道
 *                       并行）与 mastodon（账号循环串行）各成一组，三组之间并行。
 * 3. buildDiagTargets / buildSummary —— 发送结果聚合（日志快照 targets 字段、Notice 汇总文案）
 *
 * 发送原子性规则与拆分前一致：跨平台允许部分成功；单目标内 all-or-nothing；不重试不回滚。
 */

const { t, registerTranslations } = require('./i18n');

registerTranslations('en', {
    'Telegram {channel}: {result}': 'Telegram {channel}: {result}',
    '成功': 'success',
    '失败({error})': 'failed ({error})',
    '发送未知错误': 'unknown error',
    '{id}: 跳过': '{id}: skipped',
    '{id}: 成功{warn}': '{id}: success{warn}',
    '{id}: 失败({error})': '{id}: failed ({error})',
    '；': '; ',
    '（{detail}）': ' ({detail})'
});

/**
 * 收集并过滤发送目标。
 *
 * @param {object} input
 * @param {Iterable<string>} input.selectedTargets 当前勾选的通用目标适配器 id（可含 telegram/mastodon 占位）
 * @param {Iterable<string>} input.selectedTgChannels 当前勾选的 Telegram 频道 id
 * @param {Iterable<string>} input.selectedMastodonAccounts 当前勾选的 Mastodon 账号 id
 * @param {object} input.plugin 插件实例（adapterRegistry / isAdapterEnabled / getAdapterConfig / getMastodonAccount）
 * @returns {{ targetAdapters: string[], tgChannels: string[], mstdAccountIds: string[], staleTgChannelIds: string[] }}
 *   targetAdapters 含被压入的 'telegram' / 'mastodon' 占位（与原 _doSendInternal 行为一致）；
 *   staleTgChannelIds 供调用方展示 Notice，本函数不做任何 UI 操作。
 */
function collectTargets({ selectedTargets, selectedTgChannels, selectedMastodonAccounts, plugin }) {
    // 二次校验：设置可能在弹窗打开后被停用，停用适配器不得发送。
    const targetAdapters = Array.from(selectedTargets || []).filter(adapterId =>
        adapterId !== 'telegram' &&
        adapterId !== 'mastodon' &&
        plugin.adapterRegistry.has(adapterId) &&
        plugin.isAdapterEnabled(adapterId)
    );

    let tgChannels = [];
    let staleTgChannelIds = [];
    if (plugin.adapterRegistry.has('telegram') && plugin.isAdapterEnabled('telegram')) {
        const tgConfig = plugin.getAdapterConfig('telegram');
        const validIds = new Set((Array.isArray(tgConfig.channels) ? tgConfig.channels : []).map(ch => String(ch.id)));
        staleTgChannelIds = Array.from(selectedTgChannels || []).filter(id => !validIds.has(String(id)));
        tgChannels = Array.from(selectedTgChannels || []).filter(id => validIds.has(String(id)));
    }
    if (tgChannels.length > 0) {
        targetAdapters.push('telegram');
    }

    // Mastodon 多账号
    const mstdAccountIds = plugin.isAdapterEnabled('mastodon')
        ? Array.from(selectedMastodonAccounts || []).filter(id => plugin.getMastodonAccount(id))
        : [];
    if (mstdAccountIds.length > 0) {
        targetAdapters.push('mastodon');
    }

    return { targetAdapters, tgChannels, mstdAccountIds, staleTgChannelIds };
}

/**
 * 执行后台发送。
 *
 * 并行规则：通用适配器（flomo/misskey/notion/bluesky/weibo/threads 等）互相并行；
 * telegram 一次调用（adapter 内部按 channelIds 并行循环）作为一组；
 * mastodon 按账号串行循环作为一组；三组之间并行。
 *
 * @param {object} input
 * @param {object} input.plugin 插件实例（executeAdapter / getMastodonAccount）
 * @param {object} input.payload buildPayload 产物
 * @param {string[]} input.targetAdapters 通用适配器 id 列表（不含 telegram/mastodon）
 * @param {string[]} input.tgChannels 生效的 Telegram 频道 id（空数组表示不发送 telegram）
 * @param {string[]} input.mstdAccountIds 生效的 Mastodon 账号 id（按选择顺序）
 * @param {object} input.targetConfigOverrides 目标级配置覆盖（telegram 的 channelIds 等）
 * @returns {Promise<object>} results：key 为 adapterId / 'telegram' / 'mastodon:<acctId>'，
 *   值为各 adapter 返回结果（mastodon 附带 displayLabel）；异常捕获为 { success: false, error }。
 */
async function dispatchSends({ plugin, payload, targetAdapters, tgChannels, mstdAccountIds, targetConfigOverrides }) {
    const overrides = targetConfigOverrides || {};
    // targetAdapters 来自 collectTargets，含 telegram / mastodon 占位；二者由下方专用组处理，通用循环必须排除
    const genericAdapters = (targetAdapters || []).filter(adapterId =>
        adapterId !== 'telegram' && adapterId !== 'mastodon'
    );

    // 通用适配器：互相并行，单个失败不影响其他目标
    const runGeneric = async (adapterId) => {
        try {
            const result = await plugin.executeAdapter(adapterId, payload, overrides[adapterId] || {});
            return [adapterId, result];
        } catch (error) {
            return [adapterId, { success: false, error: error.message }];
        }
    };

    // Telegram（adapter 内部按 channelIds 并行循环）
    const runTelegram = async () => {
        if (!(tgChannels && tgChannels.length > 0)) return null;
        try {
            const result = await plugin.executeAdapter('telegram', payload, overrides.telegram);
            return ['telegram', result];
        } catch (error) {
            return ['telegram', { success: false, error: error.message }];
        }
    };

    // Mastodon 多账号：每个账号独立调用 adapter，组内串行
    const runMastodon = async () => {
        const entries = [];
        for (const acctId of mstdAccountIds || []) {
            const acct = plugin.getMastodonAccount(acctId);
            if (!acct) continue;
            const displayLabel = acct.label || acct.serverUrl || acctId;
            const key = `mastodon:${acctId}`;
            try {
                const result = await plugin.executeAdapter('mastodon', payload, {
                    serverUrl: acct.serverUrl,
                    accessToken: acct.accessToken,
                    visibility: acct.visibility || 'public'
                });
                result.displayLabel = displayLabel;
                entries.push([key, result]);
            } catch (error) {
                entries.push([key, { success: false, error: error.message, displayLabel }]);
            }
        }
        return entries;
    };

    // 三组之间并行；各组内部已自行捕获异常，allSettled 兜底保证单组意外崩溃不拖垮其他组
    const [genericSettled, tgSettled, mstdSettled] = await Promise.all([
        Promise.all(genericAdapters.map(runGeneric)),
        runTelegram(),
        runMastodon()
    ]);

    // 按原串行实现的插入顺序组装 results：通用 → telegram → mastodon
    const results = {};
    for (const entry of genericSettled) {
        results[entry[0]] = entry[1];
    }
    const tgEntry = tgSettled;
    if (Array.isArray(tgEntry)) {
        results[tgEntry[0]] = tgEntry[1];
    }
    for (const entry of mstdSettled) {
        results[entry[0]] = entry[1];
    }
    return results;
}

/**
 * 截断 Telegram 频道名称为前 maxChars 个字符（超长追加 …）。
 */
function truncateChannelLabel(name, maxChars = 12) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '';
    const chars = Array.from(trimmed);
    if (chars.length <= maxChars) return trimmed;
    return chars.slice(0, maxChars).join('') + '…';
}

function formatTelegramChannelName(channel) {
    const title = String(channel?.channelTitle || '').trim();
    if (title) return truncateChannelLabel(title, 12);
    return String(channel?.channelId || '');
}

/**
 * 构建发送日志快照的 diagnostics.targets 字段。
 *
 * @param {object} input
 * @param {string[]} input.targetAdapters 通用适配器 id 列表（collectTargets 产物，含 telegram/mastodon 占位）
 * @param {string[]} input.mstdAccountIds Mastodon 账号 id（保持选择顺序）
 * @param {object} input.results dispatchSends 返回值
 * @returns {Array<object>} diagTargets
 */
function buildDiagTargets({ targetAdapters, mstdAccountIds, results }) {
    const diagTargets = [];
    for (const adapterId of targetAdapters || []) {
        if (adapterId === 'telegram' || adapterId === 'mastodon') continue;
        const result = results[adapterId];
        if (!result) continue;
        diagTargets.push({
            kind: 'adapter',
            id: adapterId,
            label: adapterId,
            success: Boolean(result.success) && !result.skipped,
            error: result.error || null,
            durationMs: null
        });
    }
    const tgResult = results['telegram'];
    if (tgResult && Array.isArray(tgResult.results) && tgResult.results.length > 0) {
        for (const channel of tgResult.results) {
            diagTargets.push({
                kind: 'telegram-channel',
                id: channel.channelId,
                label: `telegram ${formatTelegramChannelName(channel)}`,
                success: Boolean(channel.success),
                error: channel.error || null,
                durationMs: null
            });
        }
    } else if (tgResult) {
        diagTargets.push({
            kind: 'adapter',
            id: 'telegram',
            label: 'telegram',
            success: Boolean(tgResult.success) && !tgResult.skipped,
            error: tgResult.error || null,
            durationMs: null
        });
    }
    for (const acctId of mstdAccountIds || []) {
        const result = results[`mastodon:${acctId}`];
        if (!result) continue;
        diagTargets.push({
            kind: 'mastodon-account',
            id: acctId,
            label: result.displayLabel || acctId,
            success: Boolean(result.success) && !result.skipped,
            error: result.error || null,
            durationMs: null
        });
    }
    return diagTargets;
}

/**
 * 拼接发送结果汇总文案（Notice 展示用）。
 *
 * @param {object} results dispatchSends 返回值
 * @returns {string} 形如 "flomo: 成功；\nTelegram xxx: 失败(...)" 的多行汇总
 */
function buildSummary(results) {
    return Object.entries(results || {})
        .flatMap(([id, result]) => {
            const channelResults = Array.isArray(result.results) ? result.results : null;
            if (id === 'telegram' && channelResults) {
                return channelResults.map(channel => {
                    return t('Telegram {channel}: {result}', { channel: formatTelegramChannelName(channel), result: channel.success ? t('成功') : t('失败({error})', { error: channel.error || t('发送未知错误') }) });
                });
            }
            // Mastodon 多账号结果使用 displayLabel 展示，key 仅为内部唯一标识
            const displayId = result.displayLabel || id;
            const warn = Array.isArray(result.warnings) && result.warnings.length > 0
                ? t('（{detail}）', { detail: result.warnings.join(t('；')) })
                : '';
            return result.success
                ? (result.skipped ? t('{id}: 跳过', { id: displayId }) : t('{id}: 成功{warn}', { id: displayId, warn }))
                : t('{id}: 失败({error})', { id: displayId, error: result.error || t('发送未知错误') });
        })
        .join(t('；') + '\n');
}

module.exports = {
    collectTargets,
    dispatchSends,
    buildDiagTargets,
    buildSummary,
    truncateChannelLabel
};
