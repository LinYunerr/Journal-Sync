/**
 * 发送日志弹窗
 * 展示最近 10 条发送快照，每条提供「重新编辑」入口：
 * 点击后调用 plugin.restoreFromSendLog(entry) 打开预填的发送面板，然后关闭自身。
 */

'use strict';

const { Modal, Notice } = require('obsidian');
const { t, registerTranslations } = require('../core/i18n');

// 本文件用户可见字符串的英文翻译
registerTranslations('en', {
    '发送日志': 'Send log',
    '加载中…': 'Loading…',
    '日志读取失败': 'Failed to read log',
    '暂无发送记录': 'No send records yet',
    '未发出': 'Not sent',
    '重新编辑': 'Re-edit',
    '打开发送面板失败：{error}': 'Failed to open send panel: {error}',
    'Telegram 频道': 'Telegram channel',
    'Mastodon 账号': 'Mastodon account'
});
const sendLog = require('../core/send-log');

/** sentAt（ISO 字符串）→ 本地时间 MM-DD HH:mm */
function formatLogTime(sentAt) {
    const d = new Date(sentAt);
    if (isNaN(d.getTime())) return '';
    const pad = (v) => String(v).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 目标 kind → 可读名称；adapter 取 manifest 名，取不到回退 id */
function targetKindLabel(plugin, kind, id) {
    if (kind === 'adapter') {
        const name = plugin?.adapterRegistry?.get?.(id)?.manifest?.name;
        return t(name) || id;
    }
    if (kind === 'telegram-channel') return t('Telegram 频道');
    if (kind === 'mastodon-account') return t('Mastodon 账号');
    return kind;
}

/** 错误信息截断到 120 字符，超出加 … */
function truncateError(message) {
    const text = String(message || '').trim();
    if (!text) return '';
    return text.length > 120 ? text.slice(0, 120) + '…' : text;
}

/** 渲染逐目标发送结果列表（diagnostics.targets 非空时） */
function renderTargetResults(infoEl, plugin, targets) {
    const listEl = infoEl.createDiv({ cls: 'js-bridge-log-targets' });
    for (const target of targets) {
        if (!target || typeof target !== 'object') continue;
        const rowEl = listEl.createDiv({ cls: 'js-bridge-log-target-row' });

        const success = Boolean(target.success);
        rowEl.createSpan({
            text: success ? '✓' : '✗',
            cls: success ? 'js-bridge-log-target-success' : 'js-bridge-log-target-fail'
        });

        const kindName = targetKindLabel(plugin, target.kind, target.id);
        let label = String(target.label || target.id || '');
        // telegram-channel 的 label 形如 "telegram <channelId>"，去掉冗余前缀
        if (target.kind === 'telegram-channel') label = label.replace(/^telegram\s+/i, '');
        const nameText = (label && label.toLowerCase() !== String(kindName).toLowerCase())
            ? `${kindName} · ${label}`
            : kindName;
        rowEl.createSpan({ text: nameText, cls: 'js-bridge-log-target-name' });

        if (!success) {
            const errorText = truncateError(target.error);
            if (errorText) {
                rowEl.createSpan({ text: errorText, cls: 'js-bridge-log-target-error' });
            }
        }
    }
}

class JournalSyncLogModal extends Modal {
    /**
     * @param {App} app
     * @param {object} plugin
     */
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this._restoreInFlight = false;
    }

    async onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        contentEl.addClass('js-bridge-log-modal');

        modalEl.style.width = '560px';
        modalEl.style.maxWidth = '92vw';

        contentEl.createEl('h2', { text: t('发送日志'), cls: 'js-bridge-send-title' });
        const listEl = contentEl.createDiv({ cls: 'js-bridge-log-list' });
        listEl.setText(t('加载中…'));

        let entries;
        try {
            entries = await sendLog.listEntries({ plugin: this.plugin });
        } catch (e) {
            listEl.setText(t('日志读取失败'));
            return;
        }

        listEl.empty();
        if (!Array.isArray(entries) || entries.length === 0) {
            listEl.setText(t('暂无发送记录'));
            return;
        }

        for (const entry of entries) {
            const row = listEl.createDiv({ cls: 'js-bridge-log-entry' });

            const info = row.createDiv({ cls: 'js-bridge-log-info' });
            const metaRow = info.createDiv({ cls: 'js-bridge-log-meta' });
            metaRow.createSpan({ text: formatLogTime(entry.sentAt), cls: 'js-bridge-log-time' });
            if (entry.dispatched === false) {
                metaRow.createSpan({ text: t('未发出'), cls: 'js-bridge-log-badge' });
            }
            info.createDiv({ text: entry.preview || '', cls: 'js-bridge-log-preview' });
            const diagTargets = entry.snapshot?.diagnostics?.targets;
            if (entry.dispatched === false) {
                const failReason = entry.snapshot?.failReason;
                if (failReason) {
                    info.createDiv({ text: truncateError(failReason), cls: 'js-bridge-log-fail-reason' });
                }
            } else if (Array.isArray(diagTargets) && diagTargets.length > 0) {
                renderTargetResults(info, this.plugin, diagTargets);
            }

            const btn = row.createEl('button', {
                type: 'button',
                text: t('重新编辑'),
                cls: 'js-bridge-log-restore-btn'
            });
            btn.addEventListener('click', async () => {
                if (this._restoreInFlight) return;
                this._restoreInFlight = true;
                btn.disabled = true;
                try {
                    const ok = await this.plugin.restoreFromSendLog(entry);
                    if (ok) {
                        this.close();
                    } else {
                        this._restoreInFlight = false;
                        btn.disabled = false;
                    }
                } catch (e) {
                    this._restoreInFlight = false;
                    btn.disabled = false;
                    new Notice(t('打开发送面板失败：{error}', { error: e?.message || e }), 10000);
                }
            });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

module.exports = JournalSyncLogModal;
