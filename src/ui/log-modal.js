/**
 * 发送日志弹窗
 * 展示最近 10 条发送快照，每条提供「重新编辑」入口：
 * 点击后调用 plugin.restoreFromSendLog(entry) 打开预填的发送面板，然后关闭自身。
 */

'use strict';

const { Modal, Notice } = require('obsidian');
const sendLog = require('../core/send-log');

/** sentAt（ISO 字符串）→ 本地时间 MM-DD HH:mm */
function formatLogTime(sentAt) {
    const d = new Date(sentAt);
    if (isNaN(d.getTime())) return '';
    const pad = (v) => String(v).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

        contentEl.createEl('h2', { text: '发送日志', cls: 'js-bridge-send-title' });
        const listEl = contentEl.createDiv({ cls: 'js-bridge-log-list' });
        listEl.setText('加载中…');

        let entries;
        try {
            entries = await sendLog.listEntries({ plugin: this.plugin });
        } catch (e) {
            listEl.setText('日志读取失败');
            return;
        }

        listEl.empty();
        if (!Array.isArray(entries) || entries.length === 0) {
            listEl.setText('暂无发送记录');
            return;
        }

        for (const entry of entries) {
            const row = listEl.createDiv({ cls: 'js-bridge-log-entry' });

            const info = row.createDiv({ cls: 'js-bridge-log-info' });
            const metaRow = info.createDiv({ cls: 'js-bridge-log-meta' });
            metaRow.createSpan({ text: formatLogTime(entry.sentAt), cls: 'js-bridge-log-time' });
            if (entry.dispatched === false) {
                metaRow.createSpan({ text: '未发出', cls: 'js-bridge-log-badge' });
            }
            info.createDiv({ text: entry.preview || '', cls: 'js-bridge-log-preview' });

            const btn = row.createEl('button', {
                type: 'button',
                text: '重新编辑',
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
                    new Notice('打开发送面板失败：' + (e?.message || e), 10000);
                }
            });
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

module.exports = JournalSyncLogModal;
