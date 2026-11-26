/**
 * 发送面板 Modal
 * 严格按照用户需求与 Journal Sync 原有架构精细实现：
 *
 * 1. 预设分组与选项目即时持久化保存 (Save Preset Selection on Every Click)：
 *    - 无论是取消/选中通用目标，还是取消/选中 Telegram 频道，所有修改瞬间同步更新到当前预设，并写入 Obsidian 的 data.json。
 *    - 重新打开发送面板或切换分组时，上一次的选择 100% 被完整保留！
 *
 * 2. Telegram 多频道同时发送修复：
 *    - 修复 Telegram 适配器以支持传入选中的 channelIds 数组，并循环将文本与图片同时成功发送到每一个勾选的 Telegram 频道。
 *
 * 3. 即时关窗 & 后台无阻塞异步发送：
 *    - 点击【发布】立即关窗 (this.close())，发送任务在 Obsidian 主线程后台独立异步传输。
 *    - 纯文本模式：正文使用当前编辑内容，并仅发送正文中仍被 @图片x token 引用的图片附件。
 */

const { Modal, Notice } = require('obsidian');
const { t, registerTranslations } = require('../core/i18n');

// 本文件用户可见文案的英文翻译（发送面板 UI 与发送流程 Notice）
registerTranslations('en', {
    '默认预设': 'Default preset',
    '选择发布目标': 'Choose publish targets',
    '发布': 'Publish',
    '发布（Ctrl/Cmd+Enter）': 'Publish (Ctrl/Cmd+Enter)',
    '选择图片占位符：': 'Choose an image placeholder:',
    '预设{index}': 'Preset {index}',
    '点击应用分组，双击重命名': 'Click to apply this preset; double-click to rename',
    '新增当前选择为预设分组': 'Save the current selection as a new preset',
    '重命名当前选中预设': 'Rename the selected preset',
    '删除当前选中预设': 'Delete the selected preset',
    '确认删除': 'Confirm delete',
    '再次点击确认删除当前预设': 'Click again to confirm deleting the selected preset',
    'Telegram：': 'Telegram: ',
    'Mastodon：': 'Mastodon: ',
    'Telegraph：': 'Telegraph: ',
    '点击使用 Telegraph 方式发送': 'Click to send via Telegraph',
    '预览': 'Preview',
    '当前为显示网址预览，点击关闭预览': 'Link preview is on; click to turn it off',
    '当前为关闭网址预览，点击显示预览': 'Link preview is off; click to turn it on',
    '富文本': 'Rich text',
    '当前为富文本发送，点击切换为纯文本': 'Rich-text mode; click to switch to plain text',
    '当前为纯文本发送，点击切换为富文本': 'Plain-text mode; click to switch to rich text',
    '尚未获取频道列表，请先在插件设置中获取频道。': 'No channel list yet. Please fetch channels in the plugin settings first.',
    '点击此处关闭 Telegraph 发送': 'Click here to disable Telegraph sending',
    '点击编辑标题': 'Click to edit the title',
    'Telegraph 模式：单击前缀关闭，单击标题编辑': 'Telegraph mode: click the prefix to disable; click the title to edit',
    '⚠️ {count} 项预警，确认发送': '⚠️ {count} warning(s). Confirm to send',
    '发送日志保存失败：无法写入快照': 'Failed to save send log: cannot write snapshot',
    '发送日志保存失败：{error}': 'Failed to save send log: {error}',
    '以下 Telegram 频道已不存在，已自动跳过：{channels}': 'The following Telegram channels no longer exist and were skipped: {channels}',
    '请至少选择一个发送目标': 'Please select at least one publish target',
    '未选择任何发送目标': 'No publish target selected',
    '没有可发送的内容，请保留文字或有效图片。': 'Nothing to send. Please keep some text or valid images.',
    '图片预检失败：{error}': 'Image pre-check failed: {error}',
    '发送预检失败：{error}': 'Send pre-check failed: {error}',
    '发送预检提示：{detail}': 'Send pre-check notice: {detail}',
    '发送预检未通过：{detail}': 'Send pre-check failed: {detail}',
    '🚀 已提交后台发送中...': '🚀 Send dispatched in the background...',
    '❌ 发送存在失败：{summary}': '❌ Send completed with failures: {summary}',
    '✅ 发送成功：{summary}': '✅ Sent successfully: {summary}',
    '微博': 'Weibo',
    '没有可发送的内容': 'Nothing to send',
    '、': ', ',
    '；': '; '
});

const { buildPayload, getMimeType } = require('../core/payload');
const { collectTargets, dispatchSends, buildDiagTargets, buildSummary } = require('../core/send-dispatcher');
const { matchImageMentionTrigger, removeImageTokenFromText } = require('../core/image-refs');
const sendLog = require('../core/send-log');

function hasRemoteImageReference(content) {
    return /!\[[^\]]*\]\(\s*https?:\/\/[^)]+\)/i.test(String(content || ''));
}


class JournalSyncSendModal extends Modal {
    /**
     * @param {App} app
     * @param {object} plugin
     * @param {string} content
     * @param {object} richDraft
     * @param {Function} readImageFile
     */
    constructor(app, plugin, { content, richDraft, readImageFile, notionTitle = '', restoreOptions = null, restorePresetId = null }) {
        super(app);
        this.plugin = plugin;
        this.rawContent = content || '';
        this.richDraft = richDraft || { version: 1, blocks: [], images: [] };
        this.readImageFile = readImageFile;
        this.notionTitle = notionTitle;
        // 从发送日志恢复：预设仍存在则仅内存中切换激活预设（不落盘），
        // 让 loadActivePresetSelection 勾选快照预设；取消重开不留下持久变更
        if (restorePresetId && Array.isArray(plugin.settings.publishPresets) &&
            plugin.settings.publishPresets.some(p => p?.id === restorePresetId)) {
            plugin.settings.activePresetId = restorePresetId;
        }

        this.tgSendMode = 'plain'; // 'plain' | 'rich' | 'telegraph'
        this.telegraphTitle = '';  // Telegraph 标题缓存（仅窗口生命周期内有效）
        this.tgShowLinkPreview = true; // 网址预览开关（从设置初始化，发送时可临时切换）
        this.selectedTargets = new Set();
        this.selectedTgChannels = new Set();
        this.selectedMastodonAccounts = new Set();

        this.editingPresetId = '';
        this._presetDeleteConfirmId = '';
        this._presetDeleteTimer = null;
        this.images = [];
        this._objectUrls = new Set(); // 跟踪当前缩略图预览 URL，关闭时统一释放
        this._imageGridRenderId = 0; // 使过期的异步缩略图加载失效
        this._warningConfirmActive = false;
        this._warningKey = '';
        this._warningTimer = null;
        this._sendKeyHandler = null;
        this._sendInFlight = false;
        this.initContentAndImages();

        this.loadActivePresetSelection();
        const _tgConfig = this.plugin.getAdapterConfig('telegram');
        this.tgShowLinkPreview = _tgConfig?.showLinkPreview !== false;
        // 从发送日志恢复：还原快照保存的 Telegram 单次发送选项（仅这三项，覆盖默认/配置值）
        if (restoreOptions) {
            if (restoreOptions.tgSendMode) this.tgSendMode = restoreOptions.tgSendMode;
            if (typeof restoreOptions.telegraphTitle === 'string') this.telegraphTitle = restoreOptions.telegraphTitle;
            if (typeof restoreOptions.tgShowLinkPreview === 'boolean') this.tgShowLinkPreview = restoreOptions.tgShowLinkPreview;
        }
    }

    /**
     * 初始化文本与图片 Token 逻辑
     */
    initContentAndImages() {
        const imgs = [];
        if (Array.isArray(this.richDraft.images)) {
            for (const img of this.richDraft.images) {
                if (img.filename) {
                    imgs.push({
                        filename: img.filename,
                        vaultPath: img.vaultPath || img.filename,
                        id: img.id || img.vaultPath || img.filename,
                        token: img.token || `@图片${imgs.length + 1}`
                    });
                }
            }
        }
        this.images = imgs;

        let text = this.rawContent;
        if (this.images.length > 0 && !/@图片\d+/.test(text)) {
            const tokenStr = this.images.map((_, i) => `@图片${i + 1}`).join(' ');
            text = text ? `${text}\n\n${tokenStr}` : tokenStr;
        }
        this.content = text;
    }

    /**
     * 加载当前激活预设的选中项
     */
    loadActivePresetSelection() {
        const presets = this.plugin.settings.publishPresets || [];
        const activeId = this.plugin.settings.activePresetId;
        const preset = presets.find(p => p.id === activeId) || presets[0];

        this.selectedTargets.clear();
        this.selectedTgChannels.clear();
        this.selectedMastodonAccounts.clear();

        if (preset && Array.isArray(preset.items)) {
            for (const item of preset.items) {
                const id = String(item.id || '');
                if (id.startsWith('plugin:')) {
                    const pluginId = id.replace('plugin:', '');
                    // 预设可能早于平台停用而保存；停用平台不得进入本次发送集合。
                    if (
                        pluginId !== 'telegram' &&
                        pluginId !== 'mastodon' &&
                        this.plugin.adapterRegistry.has(pluginId) &&
                        this.plugin.isAdapterEnabled(pluginId)
                    ) {
                        this.selectedTargets.add(pluginId);
                    }
                } else if (id.startsWith('telegram-channel:')) {
                    const chId = id.replace('telegram-channel:', '');
                    this.selectedTgChannels.add(chId);
                } else if (id.startsWith('mastodon-account:')) {
                    const acctId = id.replace('mastodon-account:', '');
                    if (this.plugin.isAdapterEnabled('mastodon') &&
                        this.plugin.getMastodonAccount(acctId)) {
                        this.selectedMastodonAccounts.add(acctId);
                    }
                }
            }
        } else {
            const adapters = this.plugin.adapterRegistry.getAll();
            for (const a of adapters) {
                if (a.manifest.id !== 'telegram' && a.manifest.id !== 'mastodon' && this.plugin.isAdapterEnabled(a.manifest.id)) {
                    this.selectedTargets.add(a.manifest.id);
                }
            }
            const tgConfig = this.plugin.getAdapterConfig('telegram');
            const homeChannels = Array.isArray(tgConfig?.homeChannels) ? tgConfig.homeChannels.map(String) : [];
            for (const chId of homeChannels) {
                this.selectedTgChannels.add(chId);
            }
            // 默认选中所有 Mastodon 账号
            if (this.plugin.isAdapterEnabled('mastodon')) {
                for (const acct of this.plugin.getMastodonAccounts()) {
                    this.selectedMastodonAccounts.add(acct.id);
                }
            }
        }
    }

    /**
     * 每次用户勾选/取消勾选任意目标时，即时持久化写入 settings
     */
    async savePresetSelection() {
        const presets = this.plugin.settings.publishPresets || [];
        let activeId = this.plugin.settings.activePresetId;

        let activePreset = presets.find(p => p.id === activeId);
        if (!activePreset) {
            activePreset = {
                id: `preset-${Date.now()}`,
                name: t('默认预设'),
                items: []
            };
            presets.push(activePreset);
            this.plugin.settings.activePresetId = activePreset.id;
        }

        activePreset.items = this.buildCurrentPresetItems();
        this.plugin.settings.publishPresets = presets;
        await this.plugin.saveSettings();
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        contentEl.addClass('js-bridge-send-modal');

        modalEl.style.width = '680px';
        modalEl.style.maxWidth = '92vw';
        modalEl.style.position = 'relative';

        // 1. 标题
        const headerRow = contentEl.createDiv({ cls: 'js-bridge-header-row' });
        headerRow.createEl('h2', { text: 'Journal-Sync', cls: 'js-bridge-send-title' });

        // 2. 文本编辑区域
        const inputPanel = contentEl.createDiv({ cls: 'js-bridge-panel' });
        this.inputPanelEl = inputPanel;


        const editorContainer = inputPanel.createDiv({ cls: 'js-bridge-editor-container' });
        this.renderEditorContent(editorContainer);

        // 缩略图网格
        if (this.images.length > 0) {
            const mediaGrid = inputPanel.createDiv({ cls: 'media-thumb-grid' });
            this.mediaGridEl = mediaGrid;
            this.renderImageGrid(mediaGrid);
        }

        // 3. 发布目标与预设分组区域
        const publishPanel = contentEl.createDiv({ cls: 'js-bridge-panel' });

        const publishTitleRow = publishPanel.createDiv({ cls: 'js-bridge-panel-title-row' });
        publishTitleRow.createEl('h4', { text: t('选择发布目标'), cls: 'js-bridge-section-title' });

        this.presetControlsEl = publishTitleRow.createDiv({ cls: 'publish-preset-controls' });
        this.renderPresetControls();

        // 通用目标 Blocks 容器
        this.simpleTargetsEl = publishPanel.createDiv({ cls: 'target-list' });

        // Mastodon 账号 Block 容器
        this.mstdSectionEl = publishPanel.createDiv({ cls: 'mstd-account-block' });

        // Telegram 频道平行 Block 容器
        this.tgSectionEl = publishPanel.createDiv({ cls: 'tg-channel-block' });

        this.renderAllTargetSections();

        // 4. 预警横幅与发送按钮
        this.warningBannerEl = contentEl.createDiv({ cls: 'js-bridge-warning-banner hidden' });
        const btnArea = contentEl.createDiv({ cls: 'js-bridge-btn-area' });

        this.sendBtn = btnArea.createEl('button', {
            text: t('发布'),
            cls: 'primary-btn simple-send-btn mod-cta'
        });
        this.sendBtn.addEventListener('click', () => this.doSend());
        this.sendBtn.title = t('发布（Ctrl/Cmd+Enter）');

        // Ctrl/Cmd+Enter 快捷发送；注册在冒泡阶段，让输入框自身的 Enter 保存逻辑先执行。
        this._sendKeyHandler = (e) => {
            if (e.key !== 'Enter' || e.repeat) return;
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            e.stopPropagation();
            this.doSend();
        };
        modalEl.addEventListener('keydown', this._sendKeyHandler);

        // Lightbox Modal
        this.previewModalEl = contentEl.createDiv({ cls: 'media-preview-modal' });
        this.previewModalEl.addEventListener('click', (e) => {
            if (e.target === this.previewModalEl) this.hideImagePreview();
        });
        const previewShell = this.previewModalEl.createDiv({ cls: 'media-preview-shell' });
        const closePreviewBtn = previewShell.createEl('button', {
            type: 'button',
            text: '×',
            cls: 'media-preview-close'
        });
        closePreviewBtn.addEventListener('click', () => this.hideImagePreview());
        this.previewImgEl = previewShell.createEl('img', { cls: 'media-preview-image' });
    }

    renderEditorContent(containerEl) {
        containerEl.empty();

        // 浮动 @图片 联想下拉菜单容器
        const mentionDropdown = containerEl.createDiv({ cls: 'image-mention-dropdown hidden' });

        const richDiv = containerEl.createDiv({ cls: 'rich-content-editor' });
        richDiv.contentEditable = 'true';

        this.editorEl = richDiv;
        if (this.content) {
            const parts = this.content.split(/(@图片\d+)/);
            parts.forEach(part => {
                if (/^@图片\d+$/.test(part)) {
                    const token = document.createElement('span');
                    token.className = 'image-token-chip';
                    token.contentEditable = 'false';
                    token.textContent = `📷 ${part}`;
                    token.setAttribute('data-token', part);
                    richDiv.appendChild(token);
                } else if (part) {
                    const textLines = part.split('\n');
                    textLines.forEach((line, lIdx) => {
                        if (lIdx > 0) richDiv.appendChild(document.createElement('br'));
                        if (line) richDiv.appendChild(document.createTextNode(line));
                    });
                }
            });
        }

        // 精确监听 Backspace 与 Delete 键，确保顺畅删除 Chip 标记
        richDiv.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0) return;
                const range = sel.getRangeAt(0);

                let chipToDelete = null;

                if (e.key === 'Backspace') {
                    if (range.collapsed) {
                        const container = range.startContainer;
                        const offset = range.startOffset;

                        if (container.nodeType === Node.ELEMENT_NODE) {
                            const prev = container.childNodes[offset - 1];
                            if (prev && prev.classList?.contains('image-token-chip')) {
                                chipToDelete = prev;
                            }
                        } else if (container.nodeType === Node.TEXT_NODE && offset === 0) {
                            let prev = container.previousSibling;
                            if (prev && prev.classList?.contains('image-token-chip')) {
                                chipToDelete = prev;
                            }
                        }
                    } else {
                        const fragment = range.cloneContents();
                        if (fragment.querySelector('.image-token-chip')) {
                            setTimeout(() => richDiv.dispatchEvent(new Event('input')), 10);
                            return;
                        }
                    }
                }

                if (e.key === 'Delete') {
                    if (range.collapsed) {
                        const container = range.startContainer;
                        const offset = range.startOffset;

                        if (container.nodeType === Node.ELEMENT_NODE) {
                            const next = container.childNodes[offset];
                            if (next && next.classList?.contains('image-token-chip')) {
                                chipToDelete = next;
                            }
                        } else if (container.nodeType === Node.TEXT_NODE && offset === container.textContent.length) {
                            let next = container.nextSibling;
                            if (next && next.classList?.contains('image-token-chip')) {
                                chipToDelete = next;
                            }
                        }
                    }
                }

                if (chipToDelete) {
                    e.preventDefault();
                    e.stopPropagation();
                    chipToDelete.remove();
                    richDiv.dispatchEvent(new Event('input'));
                }
            }
        });

        // 监听 @ 输入事件触发联想菜单
        const handleMentionCheck = () => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || this.images.length === 0) {
                mentionDropdown.addClass('hidden');
                return;
            }

            const range = sel.getRangeAt(0);
            if (!richDiv.contains(range.commonAncestorContainer)) {
                mentionDropdown.addClass('hidden');
                return;
            }

            const node = range.startContainer;
            if (node.nodeType !== Node.TEXT_NODE) {
                mentionDropdown.addClass('hidden');
                return;
            }

            const textBefore = node.textContent.slice(0, range.startOffset);
            const matched = matchImageMentionTrigger(textBefore);

            if (matched) {
                this.showMentionDropdown(mentionDropdown, richDiv, range, matched);
            } else {
                mentionDropdown.addClass('hidden');
            }
        };

        richDiv.addEventListener('keyup', (e) => {
            if (e.key === 'Escape') {
                mentionDropdown.addClass('hidden');
                return;
            }
            handleMentionCheck();
        });

        richDiv.addEventListener('click', () => mentionDropdown.addClass('hidden'));
        richDiv.addEventListener('input', () => {
            const walk = (node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && node.classList.contains('image-token-chip')) {
                        return node.getAttribute('data-token') || node.textContent.replace(/^📷\s*/, '');
                    } else if (node.tagName === 'BR') {
                        return '\n';
                    } else {
                        let s = '';
                        node.childNodes.forEach(child => { s += walk(child); });
                        return s;
                    }
                } else if (node.nodeType === Node.TEXT_NODE) {
                    return node.textContent;
                }
                return '';
            };
            let text = '';
            richDiv.childNodes.forEach(node => { text += walk(node); });
            this.content = text;
        });

        // 监听粘贴事件：拦截剪贴板中的图片转为 @图片N token；
        // 其余粘贴统一转为纯文本，避免网页/Word 复制的富文本混入
        // （内容提取 walk() 只认 textContent 和 <br>，富文本会丢换行）。
        richDiv.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            let imageItem = null;
            for (const item of items) {
                if (item.type && item.type.startsWith('image/')) {
                    imageItem = item;
                    break;
                }
            }

            if (imageItem) {
                e.preventDefault();
                e.stopPropagation();

                const file = imageItem.getAsFile();
                if (file) {
                    this.addPastedImage(file, richDiv);
                }
                return;
            }

            // 非图片粘贴：以纯文本插入，不保留任何格式
            e.preventDefault();

            const text = e.clipboardData.getData('text/plain');
            if (!text) return; // 无纯文本可插入，也不恢复默认行为，避免格式化内容混入

            this.insertTextAtCursor(richDiv, text);
        });
    }

    /**
     * 在当前光标处插入纯文本。
     * 换行统一规范为单个 \n 字符；编辑器为 pre-wrap，文本节点内的换行可直接渲染。
     * 注意：execCommand('insertText') 会把 \n 转成 <div> 块级元素，而内容提取
     * walk() 只认 textContent 和 <br>，会丢换行，因此逐段插入、段间用
     * insertLineBreak（pre-wrap 下为 \n 文本节点，否则为 <br>，walk() 均识别）。
     * execCommand 成功时自动触发 input 事件（同步 this.content）；
     * 失败时兑底用 Range 插入文本节点，并手动 dispatch input 事件。
     */
    insertTextAtCursor(richDiv, rawText) {
        const text = rawText.replace(/\r\n?/g, '\n');
        const lines = text.split('\n');

        let ok = true;
        let insertedAny = false;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i]) {
                ok = document.execCommand('insertText', false, lines[i]);
                if (!ok) break;
                insertedAny = true;
            }
            if (i < lines.length - 1) {
                ok = document.execCommand('insertLineBreak');
                if (!ok) break;
                insertedAny = true;
            }
        }
        // execCommand 全程可用（或已插入部分内容后中断）时不走兑底，
        // 避免重复插入；已插入部分会通过 input 事件同步。
        if (ok || insertedAny) return;

        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            sel.getRangeAt(0).insertNode(document.createTextNode(text));
        } else {
            richDiv.appendChild(document.createTextNode(text));
        }
        richDiv.dispatchEvent(new Event('input', { bubbles: true }));
    }
    showMentionDropdown(dropdownEl, richDiv, range, matchedText) {
        dropdownEl.empty();
        dropdownEl.removeClass('hidden');

        const rect = range.getBoundingClientRect();
        const editorRect = richDiv.getBoundingClientRect();

        dropdownEl.style.top = `${rect.bottom - editorRect.top + richDiv.offsetTop + 4}px`;
        dropdownEl.style.left = `${Math.min(Math.max(10, rect.left - editorRect.left + richDiv.offsetLeft), editorRect.width - 220)}px`;

        dropdownEl.createDiv({ text: t('选择图片占位符：'), cls: 'mention-dropdown-title' });

        this.images.forEach((img) => {
            const tokenName = img.token;
            const item = dropdownEl.createDiv({ cls: 'mention-dropdown-item' });

            item.createSpan({ cls: 'mention-item-icon', text: '📷' });
            item.createSpan({ cls: 'mention-item-label', text: tokenName });
            if (img.filename) {
                item.createSpan({ cls: 'mention-item-sub', text: img.filename });
            }

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                    const r = sel.getRangeAt(0);
                    if (r.startContainer.nodeType === Node.TEXT_NODE) {
                        const node = r.startContainer;
                        const start = Math.max(0, r.startOffset - matchedText.length);
                        node.textContent = node.textContent.slice(0, start) + node.textContent.slice(r.startOffset);
                        r.setStart(node, start);
                        r.setEnd(node, start);
                    }
                }

                this.insertTokenAtCursor(richDiv, tokenName);
                dropdownEl.addClass('hidden');
            });
        });
    }

    insertTokenAtCursor(richDiv, tokenText) {
        richDiv.focus();
        const sel = window.getSelection();
        let range;

        if (sel && sel.rangeCount > 0 && richDiv.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            range = sel.getRangeAt(0);
        } else {
            range = document.createRange();
            range.selectNodeContents(richDiv);
            range.collapse(false);
        }

        range.deleteContents();
        const token = document.createElement('span');
        token.className = 'image-token-chip';
        token.contentEditable = 'false';
        token.setAttribute('data-token', tokenText);
        token.textContent = `📷 ${tokenText}`;

        const spacer = document.createTextNode(' ');
        range.insertNode(spacer);
        range.insertNode(token);
        range.setStartAfter(spacer);
        range.collapse(true);

        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }

        richDiv.dispatchEvent(new Event('input'));
    }

    /**
     * 将粘贴的图片文件加入图片列表，在光标处插入 token chip，刷新缩略图网格。
     * 图片仅存于内存 Blob，不写入 vault；预览 URL 在渲染时创建，关闭窗口时释放。
     */
    getNextImageToken() {
        const usedNumbers = new Set();
        const collect = (value) => {
            const match = String(value || '').match(/^@图片(\d+)$/);
            if (match) usedNumbers.add(Number(match[1]));
        };

        for (const image of this.images) collect(image.token);
        for (const token of String(this.content || '').match(/@图片\d+/g) || []) collect(token);

        let next = 1;
        while (usedNumbers.has(next)) next += 1;
        return `@图片${next}`;
    }

    addPastedImage(file, richDiv) {
        const ext = (file.type && file.type.split('/')[1]) || 'png';
        const filename = `clipboard_${Date.now()}.${ext}`;
        const token = this.getNextImageToken();

        const imageEntry = {
            filename,
            vaultPath: filename,
            id: `paste_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            token,
            blob: file,
            blobUrl: ''
        };
        this.images.push(imageEntry);

        // 在光标位置插入 token chip
        this.insertTokenAtCursor(richDiv, token);

        if (!this.mediaGridEl && this.inputPanelEl) {
            this.mediaGridEl = this.inputPanelEl.createDiv({ cls: 'media-thumb-grid' });
        }
        if (this.mediaGridEl) {
            this.renderImageGrid(this.mediaGridEl);
        }
    }

    renderImageGrid(containerEl) {
        const renderId = ++this._imageGridRenderId;
        containerEl.empty();
        if (this.images.length === 0) return;

        // 每次重绘只释放上一轮预览 URL；粘贴图片的 Blob 数据仍保留，可重新生成 URL。
        for (const url of this._objectUrls) URL.revokeObjectURL(url);
        this._objectUrls.clear();

        this.images.forEach((img, index) => {
            const thumb = containerEl.createDiv({ cls: 'media-thumb' });
            const imgEl = thumb.createEl('img', { attr: { alt: img.filename } });

            // 粘贴图片从内存 Blob 重新创建预览 URL；Vault 图片走 readImageFile。
            if (img.blob) {
                const url = URL.createObjectURL(img.blob);
                img.blobUrl = url;
                this._objectUrls.add(url);
                imgEl.src = url;
            } else {
                this.readImageFile(img.vaultPath).then(arrayBuf => {
                    if (!arrayBuf) return;
                    const blob = new Blob([arrayBuf], { type: getMimeType(img.filename) });
                    const url = URL.createObjectURL(blob);
                    if (renderId !== this._imageGridRenderId) {
                        URL.revokeObjectURL(url);
                        return;
                    }
                    this._objectUrls.add(url);
                    imgEl.src = url;
                }).catch(() => {});
            }

            thumb.createEl('span', { cls: 'media-thumb-order', text: `${index + 1}` });

            const removeBtn = thumb.createEl('button', {
                type: 'button',
                text: '×',
                cls: 'media-thumb-remove'
            });
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (imgEl.src && imgEl.src.startsWith('blob:')) {
                    URL.revokeObjectURL(imgEl.src);
                    this._objectUrls.delete(imgEl.src);
                }
                const [removedImage] = this.images.splice(index, 1);
                if (removedImage) {
                    this.content = removeImageTokenFromText(this.content, removedImage.token);
                    this.editorEl?.querySelectorAll('.image-token-chip').forEach(chip => {
                        if (chip.getAttribute('data-token') === removedImage.token) chip.remove();
                    });
                    this.richDraft = {
                        ...this.richDraft,
                        blocks: (this.richDraft.blocks || []).filter(block => block.imageId !== removedImage.id),
                        images: (this.richDraft.images || []).filter(image => {
                            if (image.token && removedImage.token) return image.token !== removedImage.token;
                            return (image.vaultPath || image.filename) !== removedImage.vaultPath;
                        })
                    };
                }
                this.renderImageGrid(containerEl);
            });

            thumb.addEventListener('click', () => {
                if (imgEl.src && imgEl.complete && imgEl.naturalWidth > 0) this.showImagePreview(imgEl.src);
            });
        });
    }


    showImagePreview(src) {
        this.previewImgEl.src = src;
        this.previewModalEl.addClass('active');
        this._previewEscHandler = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.hideImagePreview();
            }
        };
        document.addEventListener('keydown', this._previewEscHandler, true);
    }

    hideImagePreview() {
        this.previewModalEl.removeClass('active');
        this.previewImgEl.src = '';
        if (this._previewEscHandler) {
            document.removeEventListener('keydown', this._previewEscHandler, true);
            this._previewEscHandler = null;
        }
    }

    _clearPresetDeleteConfirm() {
        if (this._presetDeleteTimer) window.clearTimeout(this._presetDeleteTimer);
        this._presetDeleteTimer = null;
        this._presetDeleteConfirmId = '';
    }

    renderPresetControls() {
        if (!this.presetControlsEl) return;
        this.presetControlsEl.empty();

        const presets = this.plugin.settings.publishPresets || [];
        const activeId = this.plugin.settings.activePresetId;

        presets.forEach((preset, index) => {
            if (this.editingPresetId === preset.id) {
                const input = this.presetControlsEl.createEl('input', {
                    type: 'text',
                    cls: 'publish-preset-name-input',
                    value: preset.name
                });
                setTimeout(() => { input.focus(); input.select(); }, 20);

                const saveName = async () => {
                    const newName = input.value.trim() || t('预设{index}', { index: index + 1 });
                    preset.name = newName;
                    this.editingPresetId = '';
                    await this.plugin.saveSettings();
                    this.renderPresetControls();
                };

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') {
                        this.editingPresetId = '';
                        this.renderPresetControls();
                    }
                });
                input.addEventListener('blur', saveName);
                return;
            }

            const btn = this.presetControlsEl.createEl('button', {
                type: 'button',
                text: preset.name,
                cls: `publish-preset-btn${preset.id === activeId ? ' active' : ''}`
            });
            btn.title = t('点击应用分组，双击重命名');

            btn.addEventListener('click', async () => {
                if (this.editingPresetId) return;
                this._clearPresetDeleteConfirm();
                this.plugin.settings.activePresetId = preset.id;
                await this.plugin.saveSettings();
                this.loadActivePresetSelection();

                this.presetControlsEl.querySelectorAll('.publish-preset-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                });
                this.renderAllTargetSections();
            });

            btn.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this._clearPresetDeleteConfirm();
                this.editingPresetId = preset.id;
                this.renderPresetControls();
            });
        });

        // + 新增
        if (presets.length < 5) {
            const addBtn = this.presetControlsEl.createEl('button', {
                type: 'button',
                cls: 'publish-preset-action add'
            });
            addBtn.title = t('新增当前选择为预设分组');
            addBtn.addEventListener('click', async () => {
                this._clearPresetDeleteConfirm();
                const newPreset = {
                    id: `preset-${Date.now()}`,
                    name: t('预设{index}', { index: presets.length + 1 }),
                    items: this.buildCurrentPresetItems()
                };
                presets.push(newPreset);
                this.plugin.settings.publishPresets = presets;
                this.plugin.settings.activePresetId = newPreset.id;
                await this.plugin.saveSettings();
                this.renderPresetControls();
            });
        }

        // 重命名 / 删除
        if (presets.length > 0 && activeId) {
            const editBtn = this.presetControlsEl.createEl('button', {
                type: 'button',
                cls: 'publish-preset-action edit'
            });
            editBtn.title = t('重命名当前选中预设');
            editBtn.addEventListener('click', () => {
                this._clearPresetDeleteConfirm();
                this.editingPresetId = activeId;
                this.renderPresetControls();
            });

            const isConfirmingDelete = this._presetDeleteConfirmId === activeId;
            const removeBtn = this.presetControlsEl.createEl('button', {
                type: 'button',
                text: isConfirmingDelete ? t('确认删除') : '',
                cls: `publish-preset-action remove${isConfirmingDelete ? ' confirming' : ''}`
            });
            removeBtn.title = isConfirmingDelete ? t('再次点击确认删除当前预设') : t('删除当前选中预设');
            removeBtn.addEventListener('click', async () => {
                if (this._presetDeleteConfirmId !== activeId) {
                    this._clearPresetDeleteConfirm();
                    this._presetDeleteConfirmId = activeId;
                    this._presetDeleteTimer = window.setTimeout(() => {
                        this._presetDeleteConfirmId = '';
                        this._presetDeleteTimer = null;
                        this.renderPresetControls();
                    }, 5000);
                    this.renderPresetControls();
                    return;
                }
                this._clearPresetDeleteConfirm();
                const currentPresets = this.plugin.settings.publishPresets || [];
                const currentActiveId = this.plugin.settings.activePresetId;
                const newPresets = currentPresets.filter(p => p.id !== currentActiveId);
                this.plugin.settings.publishPresets = newPresets;
                this.plugin.settings.activePresetId = newPresets[0]?.id || '';
                await this.plugin.saveSettings();
                this.loadActivePresetSelection();
                this.renderPresetControls();
                this.renderAllTargetSections();
            });
        }
    }

    buildCurrentPresetItems() {
        const items = [];
        for (const targetId of this.selectedTargets) {
            items.push({ id: `plugin:${targetId}` });
        }
        for (const chId of this.selectedTgChannels) {
            items.push({ id: `telegram-channel:${chId}` });
        }
        for (const acctId of this.selectedMastodonAccounts) {
            items.push({ id: `mastodon-account:${acctId}` });
        }
        return items;
    }

    renderAllTargetSections() {
        this.renderSimpleTargets();
        this.renderMastodonAccounts();
        this.renderTelegramChannels();
    }

    renderSimpleTargets() {
        if (!this.simpleTargetsEl) return;
        this.simpleTargetsEl.empty();

        const adapters = this.plugin.adapterRegistry.getAll().slice().sort((a, b) => {
            const ao = a?.manifest?.displayOrder ?? Infinity;
            const bo = b?.manifest?.displayOrder ?? Infinity;
            return ao - bo;
        });
        const generalAdapters = adapters.filter(a => a.manifest.id !== 'telegram' && a.manifest.id !== 'mastodon' && this.plugin.isAdapterEnabled(a.manifest.id));

        if (generalAdapters.length === 0) return;

        for (const adapter of generalAdapters) {
            const id = adapter.manifest.id;
            const isSelected = this.selectedTargets.has(id);

            const block = this.simpleTargetsEl.createEl('button', {
                type: 'button',
                cls: `plugin-toggle-block${isSelected ? ' active' : ''}`
            });

            block.createSpan({ cls: 'plugin-toggle-title', text: t(adapter.manifest.name) });

            block.addEventListener('click', async () => {
                if (this.selectedTargets.has(id)) {
                    this.selectedTargets.delete(id);
                } else {
                    this.selectedTargets.add(id);
                }
                block.classList.toggle('active', this.selectedTargets.has(id));
                await this.savePresetSelection();
            });
        }
    }

    renderMastodonAccounts() {
        if (!this.mstdSectionEl) return;
        this.mstdSectionEl.empty();

        if (!this.plugin.isAdapterEnabled('mastodon')) return;

        const accounts = this.plugin.getMastodonAccounts();
        if (accounts.length === 0) return;

        const labelRow = this.mstdSectionEl.createDiv({ cls: 'mstd-account-label-row' });
        labelRow.createEl('div', { text: t('Mastodon：'), cls: 'target-sub-label' });

        const accountGrid = this.mstdSectionEl.createDiv({ cls: 'target-list mstd-account-list' });

        for (const acct of accounts) {
            const isSelected = this.selectedMastodonAccounts.has(acct.id);
            const displayLabel = acct.label || acct.serverUrl || acct.id;

            const block = accountGrid.createEl('button', {
                type: 'button',
                cls: `plugin-toggle-block${isSelected ? ' active' : ''}`
            });

            const titleRow = block.createDiv({ cls: 'plugin-toggle-title-row' });
            titleRow.createSpan({ cls: 'plugin-toggle-title', text: displayLabel });
            if (acct.serverUrl) {
                titleRow.createSpan({ cls: 'plugin-toggle-sub', text: acct.serverUrl.replace(/^https?:\/\//, '') });
            }

            block.addEventListener('click', async () => {
                if (this.selectedMastodonAccounts.has(acct.id)) {
                    this.selectedMastodonAccounts.delete(acct.id);
                } else {
                    this.selectedMastodonAccounts.add(acct.id);
                }
                block.classList.toggle('active', this.selectedMastodonAccounts.has(acct.id));
                await this.savePresetSelection();
            });
        }
    }
    renderTelegramChannels() {
        if (!this.tgSectionEl) return;
        this.tgSectionEl.empty();

        if (!this.plugin.isAdapterEnabled('telegram')) return;

        const tgConfig = this.plugin.getAdapterConfig('telegram');
        const channels = Array.isArray(tgConfig?.channels) ? tgConfig.channels : [];

        const tgLabelRow = this.tgSectionEl.createDiv({ cls: 'tg-channel-label-row' });
        tgLabelRow.createEl('div', { text: t('Telegram：'), cls: 'target-sub-label' });

        // 按钮组：Telegraph + 富文本，紧贴右侧
        const tgBtnGroup = tgLabelRow.createDiv({ cls: 'tg-btn-group' });

        // Telegraph 按钮（放在富文本按钮左侧）
        const telegraphBtn = tgBtnGroup.createEl('button', {
            type: 'button',
            text: 'Telegraph',
            cls: `tg-input-mode-btn tg-telegraph-btn${this.tgSendMode === 'telegraph' ? ' active expanded' : ''}`
        });
        telegraphBtn.title = t('点击使用 Telegraph 方式发送');
        if (this.tgSendMode === 'telegraph') {
            this._expandTelegraphBtn(telegraphBtn);
        }

        // 网址预览开关：放在富文本左侧、Telegraph 右侧，样式与其它两个按钮一致。
        const previewToggleBtn = tgBtnGroup.createEl('button', {
            type: 'button',
            text: t('预览'),
            cls: `tg-input-mode-btn tg-preview-btn${this.tgShowLinkPreview ? ' active' : ''}`
        });
        previewToggleBtn.title = this.tgShowLinkPreview ? t('当前为显示网址预览，点击关闭预览') : t('当前为关闭网址预览，点击显示预览');
        previewToggleBtn.addEventListener('click', () => {
            this.tgShowLinkPreview = !this.tgShowLinkPreview;
            previewToggleBtn.classList.toggle('active', this.tgShowLinkPreview);
            previewToggleBtn.title = this.tgShowLinkPreview ? t('当前为显示网址预览，点击关闭预览') : t('当前为关闭网址预览，点击显示预览');
        });

        // 富文本开关：仅在 Telegram「启用富文本发送」开启时显示。
        // 按钮文字固定为「富文本」，灰态（未激活）表示当前实际为纯文本发送。
        if (tgConfig.richTextEnabled !== false) {
            const richToggleBtn = tgBtnGroup.createEl('button', {
                type: 'button',
                text: t('富文本'),
                cls: `tg-input-mode-btn${this.tgSendMode === 'rich' ? ' active' : ''}`
            });
            richToggleBtn.title = this.tgSendMode === 'rich' ? t('当前为富文本发送，点击切换为纯文本') : t('当前为纯文本发送，点击切换为富文本');
            richToggleBtn.addEventListener('click', () => {
                if (this.tgSendMode === 'rich') {
                    this.tgSendMode = 'plain';
                } else {
                    this.tgSendMode = 'rich';
                }
                richToggleBtn.classList.toggle('active', this.tgSendMode === 'rich');
                richToggleBtn.title = this.tgSendMode === 'rich' ? t('当前为富文本发送，点击切换为纯文本') : t('当前为纯文本发送，点击切换为富文本');
                // 取消 Telegraph 激活态并收起
                telegraphBtn.classList.remove('active', 'expanded');
                this._collapseTelegraphBtn(telegraphBtn);
            });
        }

        // Telegraph 按钮交互：单击展开/激活，单击标题编辑，单击前缀关闭
        telegraphBtn.addEventListener('click', (e) => {
            // 如果已展开，检查点击区域
            if (this.tgSendMode === 'telegraph') {
                if (telegraphBtn.querySelector('.tg-telegraph-title-input')) return;
                // 点击的是前缀区域 → 关闭
                const prefixEl = telegraphBtn.querySelector('.tg-telegraph-prefix');
                if (prefixEl && prefixEl.contains(e.target)) {
                    this.tgSendMode = 'plain';
                    telegraphBtn.classList.remove('active', 'expanded');
                    this._collapseTelegraphBtn(telegraphBtn);
                    return;
                }
                const titleEl = telegraphBtn.querySelector('.tg-telegraph-title');
                if (titleEl && titleEl.contains(e.target)) {
                    this._editTelegraphTitle(telegraphBtn, titleEl);
                }
                return;
            }

            // 激活 Telegraph 模式
            this.tgSendMode = 'telegraph';
            telegraphBtn.classList.add('active', 'expanded');
            // 取消富文本激活态
            const richBtn = tgLabelRow.querySelector('.tg-input-mode-btn:not(.tg-telegraph-btn):not(.tg-preview-btn)');
            if (richBtn) richBtn.classList.remove('active');

            // 展开按钮：显示 "Telegraph：标题"
            this._expandTelegraphBtn(telegraphBtn);
        });

        if (channels.length === 0) {
            this.tgSectionEl.createDiv({
                cls: 'target-sub',
                text: t('尚未获取频道列表，请先在插件设置中获取频道。')
            });
            return;
        }

        const channelGrid = this.tgSectionEl.createDiv({ cls: 'target-list tg-channel-list' });

        channels.forEach(ch => {
            const chId = String(ch.id);
            const isSelected = this.selectedTgChannels.has(chId);

            const chBlock = channelGrid.createEl('button', {
                type: 'button',
                cls: `plugin-toggle-block tg-channel-toggle${isSelected ? ' active' : ''}`
            });

            const row = chBlock.createDiv({ cls: 'plugin-toggle-title-row' });
            row.createSpan({ cls: 'plugin-toggle-title', text: ch.title || chId });

            if (ch.username) {
                row.createSpan({
                    cls: 'plugin-toggle-sub',
                    text: ch.username.startsWith('@') ? ch.username : `@${ch.username}`
                });
            }

            chBlock.addEventListener('click', async () => {
                if (this.selectedTgChannels.has(chId)) {
                    this.selectedTgChannels.delete(chId);
                } else {
                    this.selectedTgChannels.add(chId);
                }
                chBlock.classList.toggle('active', this.selectedTgChannels.has(chId));
                await this.savePresetSelection();
            });
        });
    }

    // ── Telegraph 按钮辅助方法 ─────────────────

    /**
     * 获取默认 Telegraph 标题：从正文提取或使用笔记标题
     */
    _getDefaultTelegraphTitle() {
        const tgConfig = this.plugin.getAdapterConfig('telegram');
        const titleLevel = tgConfig.telegraphTitleLevel || 1;
        const headingRe = new RegExp(`^#{${titleLevel}}\\s+(.+)$`, 'm');
        const match = this.content.match(headingRe);
        if (match) return match[1].trim();
        // 回退到 notionTitle（笔记标题/heading 标题）
        return this.notionTitle || 'Journal Sync';
    }

    /**
     * 展开 Telegraph 按钮：显示 "Telegraph：标题"
     */
    _expandTelegraphBtn(btn) {
        if (!this.telegraphTitle) {
            this.telegraphTitle = this._getDefaultTelegraphTitle();
        }
        btn.empty();
        const prefix = btn.createSpan({ cls: 'tg-telegraph-prefix', text: t('Telegraph：') });
        prefix.title = t('点击此处关闭 Telegraph 发送');
        const titleSpan = btn.createSpan({ cls: 'tg-telegraph-title', text: this.telegraphTitle });
        titleSpan.title = t('点击编辑标题');
        btn.title = t('Telegraph 模式：单击前缀关闭，单击标题编辑');
    }

    /**
     * 收起 Telegraph 按钮：恢复为 "Telegraph"
     */
    _collapseTelegraphBtn(btn) {
        btn.empty();
        btn.textContent = 'Telegraph';
        btn.title = t('点击使用 Telegraph 方式发送');
    }

    /**
     * 双击编辑 Telegraph 标题
     */
    _editTelegraphTitle(btn, titleEl) {
        const currentText = this.telegraphTitle || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tg-telegraph-title-input';
        input.value = currentText;
        input.style.width = `${Math.max(120, currentText.length * 14 + 20)}px`;
        titleEl.replaceWith(input);
        input.focus();
        input.select();

        let saved = false;
        const saveEdit = () => {
            if (saved) return;
            saved = true;
            const newTitle = input.value.trim();
            if (newTitle) {
                this.telegraphTitle = newTitle;
            }
            // 重建按钮内容
            this._expandTelegraphBtn(btn);
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                saved = true;
                this._expandTelegraphBtn(btn);
            }
        });
        input.addEventListener('blur', saveEdit);
    }

    _resetSendButton() {
        if (!this.sendBtn) return;
        this.sendBtn.textContent = t('发布');
        this.sendBtn.classList.remove('mod-warning');
        this.sendBtn.removeAttribute('title');
    }

    _clearAttachmentWarningState() {
        if (this._warningTimer) window.clearTimeout(this._warningTimer);
        this._warningTimer = null;
        this._warningConfirmActive = false;
        this._warningKey = '';
        if (this.warningBannerEl) {
            this.warningBannerEl.empty();
            this.warningBannerEl.addClass('hidden');
        }
        this._resetSendButton();
    }

    _showAttachmentWarnings(warnings) {
        const messages = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
        if (messages.length === 0) return;

        if (this._warningTimer) window.clearTimeout(this._warningTimer);
        this._warningConfirmActive = true;
        this._warningKey = messages.join('\n');
        if (this.warningBannerEl) {
            this.warningBannerEl.empty();
            for (const msg of messages) {
                this.warningBannerEl.createDiv({ cls: 'js-bridge-warning-item', text: `⚠️ ${msg}` });
            }
            this.warningBannerEl.removeClass('hidden');
        }
        if (this.sendBtn) {
            this.sendBtn.textContent = messages.length === 1
                ? `⚠️ ${messages[0]}`
                : t('⚠️ {count} 项预警，确认发送', { count: messages.length });
            this.sendBtn.title = messages.join('\n');
            this.sendBtn.classList.add('mod-warning');
        }
        this._warningTimer = window.setTimeout(() => {
            this._clearAttachmentWarningState();
        }, 5000);
    }

    /**
     * 采集当前正文引用的图片（用于发送日志快照）。
     * vault 图读取失败时跳过该张，不影响其余采集。
     */
    async _collectLogImages(content, imagesSource = null) {
        const text = String(content || '');
        const referencedTokens = new Set(text.match(/@图片\d+/g) || []);
        const collected = [];
        const images = Array.isArray(imagesSource) ? imagesSource : (Array.isArray(this.images) ? this.images : []);
        for (const img of images) {
            if (!img || !referencedTokens.has(img.token)) continue;
            let data = null;
            try {
                data = img.blob
                    ? await img.blob.arrayBuffer()
                    : await this.readImageFile(img.vaultPath);
            } catch (e) {
                continue; // 单张读取失败跳过，不让整条日志失败
            }
            if (!data) continue;
            const filename = String(img.filename || '');
            const extMatch = filename.match(/\.([A-Za-z0-9]+)$/);
            const ext = extMatch ? extMatch[1].toLowerCase() : 'bin';
            collected.push({
                token: img.token,
                filename,
                originVaultPath: img.vaultPath,
                pasted: Boolean(img.blob),
                data,
                cacheFile: `img-${collected.length + 1}.${ext}`
            });
        }
        return collected;
    }

    /**
     * 写入一条发送日志快照。失败仅 Notice，绝不 throw，不影响发送本身。
     */
    async _writeSendLog(entry) {
        try {
            const ok = await sendLog.writeSnapshot({ plugin: this.plugin }, entry);
            if (!ok) {
                new Notice(t('发送日志保存失败：无法写入快照'), 10000);
            }
        } catch (err) {
            new Notice(t('发送日志保存失败：{error}', { error: err?.message || err }), 10000);
        }
    }

    /**
     * 组装发送日志快照的公共字段。
     */
    _buildLogEntryBase(extra) {
        const presets = this.plugin.settings.publishPresets || [];
        const presetId = this.plugin.settings.activePresetId || '';
        const preset = presets.find(p => p.id === presetId);
        return Object.assign({
            version: 1,
            sentAt: new Date().toISOString(),
            dispatched: true,
            failStage: null,
            failReason: null,
            pluginVersion: this.plugin.manifest?.version || '',
            title: this.notionTitle || '',
            content: this.content || '',
            images: [],
            presetId,
            presetName: preset ? String(preset.name || '') : '',
            tgSendMode: this.tgSendMode,
            telegraphTitle: this.telegraphTitle || '',
            tgShowLinkPreview: this.tgShowLinkPreview !== false,
            diagnostics: { targets: [], validationWarnings: [], attachmentWarnings: [] }
        }, extra || {});
    }


    /**
     * 执行发送（即时关窗 + 后台无阻塞异步发送）
     * 外层防重入：预检 await 期间连按 Ctrl+Enter 或双击按钮不会重复提交。
     */
    async doSend() {
        if (this._sendInFlight) return;
        this._sendInFlight = true;
        try {
            await this._doSendInternal();
        } finally {
            this._sendInFlight = false;
        }
    }

    async _doSendInternal() {
        const plugin = this.plugin;
        // 二次校验：设置可能在弹窗打开后被停用，停用适配器不得发送。
        // 目标收集/过滤（停用平台、stale 频道、失效账号）由 send-dispatcher 纯函数完成
        const { targetAdapters, tgChannels, mstdAccountIds, staleTgChannelIds } = collectTargets({
            selectedTargets: this.selectedTargets,
            selectedTgChannels: this.selectedTgChannels,
            selectedMastodonAccounts: this.selectedMastodonAccounts,
            plugin
        });
        if (staleTgChannelIds.length > 0) {
            new Notice(t('以下 Telegram 频道已不存在，已自动跳过：{channels}', { channels: staleTgChannelIds.join(t('、')) }), 8000);
        }

        if (targetAdapters.length === 0 && tgChannels.length === 0 && mstdAccountIds.length === 0) {
            new Notice(t('请至少选择一个发送目标'));
            await this._writeSendLog(this._buildLogEntryBase({
                dispatched: false,
                failStage: 'no-target',
                failReason: t('未选择任何发送目标'),
                images: await this._collectLogImages(this.content),
                diagnostics: { targets: [], validationWarnings: [], attachmentWarnings: [] }
            }));
            return;
        }

        // 提取待发送参数
        const rawContent = this.content;
        const referencedTokens = new Set(rawContent.match(/@图片\d+/g) || []);
        const images = this.images.filter(image => referencedTokens.has(image.token));

        // 包装 readImageFile：粘贴的图片从内存 Blob 读取，vault 图片走原逻辑
        const vaultReadImageFile = this.readImageFile;
        const readAttachment = (vaultPath) => {
            const img = images.find(i => i.vaultPath === vaultPath && i.blob);
            if (img && img.blob) return Promise.resolve(img.blob.arrayBuffer());
            return vaultReadImageFile(vaultPath);
        };

        // 量大小优先走文件元数据（TFile.stat.size / blob.size），避免为预检读取完整二进制。
        const statAttachment = (vaultPath) => {
            const img = images.find(i => i.vaultPath === vaultPath && i.blob);
            if (img && img.blob) return img.blob.size || null;
            const file = plugin.app.vault.getAbstractFileByPath(vaultPath);
            if (!file || Array.isArray(file.children)) return null;
            const size = Number(file.stat?.size);
            return Number.isFinite(size) && size > 0 ? size : null;
        };

        // 构建统一 payload；图片实体沿用发送面板当前状态，保证编辑后的 token 与附件一致。
        const payload = buildPayload({
            content: rawContent,
            richDraft: { ...this.richDraft, images },
            title: this.notionTitle || '',
            readAttachment,
            statAttachment
        });

        // 统一检查最终要发送的内容，避免用户在弹窗中删空后仍创建空页面，
        // 或者仅剩未知的 @图片N token 时被误判为发送成功。
        const hasSendableContent = Boolean(
            payload.plainText.trim()
            || payload.attachments.length > 0
            || hasRemoteImageReference(payload.content)
        );
        if (!hasSendableContent) {
            new Notice(t('没有可发送的内容，请保留文字或有效图片。'));
            await this._writeSendLog(this._buildLogEntryBase({
                dispatched: false,
                failStage: 'empty-content',
                failReason: t('没有可发送的内容'),
                images: await this._collectLogImages(this.content),
                diagnostics: { targets: [], validationWarnings: [], attachmentWarnings: [] }
            }));
            return;
        }

        const targetConfigOverrides = {};
        if (tgChannels.length > 0) {
            targetConfigOverrides.telegram = {
                tgSendMode: this.tgSendMode,
                channelIds: tgChannels,
                telegraphTitle: this.telegraphTitle,
                showLinkPreview: this.tgShowLinkPreview
            };
        }

        const configs = {};
        for (const adapterId of targetAdapters) {
            if (adapterId === 'mastodon') {
                configs['mastodon'] = {
                    accounts: mstdAccountIds.map(id => plugin.getMastodonAccount(id)).filter(Boolean)
                };
            } else {
                configs[adapterId] = {
                    ...plugin.getAdapterConfig(adapterId),
                    ...(targetConfigOverrides[adapterId] || {})
                };
            }
        }

        // 按目标适配器的能力声明与适配器预警钩子做统一预检预警；预警状态只保留 5 秒。
        let capabilityWarnings;
        try {
            capabilityWarnings = await plugin.adapterRegistry.getAttachmentWarnings(targetAdapters, payload, configs);
        } catch (error) {
            new Notice(t('图片预检失败：{error}', { error: error.message || String(error) }), 10000);
            await this._writeSendLog(this._buildLogEntryBase({
                dispatched: false,
                failStage: 'attachment-warnings',
                failReason: t('图片预检失败：{error}', { error: error.message || String(error) }),
                images: await this._collectLogImages(this.content),
                diagnostics: { targets: [], validationWarnings: [], attachmentWarnings: [] }
            }));
            return;
        }
        const warningMessages = capabilityWarnings.warnings || [];
        const warningKey = warningMessages.join('\n');
        if (warningMessages.length > 0) {
            if (!this._warningConfirmActive || this._warningKey !== warningKey) {
                this._showAttachmentWarnings(warningMessages);
                return;
            }
            this._clearAttachmentWarningState();
        } else {
            this._clearAttachmentWarningState();
        }
        // 发布前执行所有目标适配器的预检。预检策略沿用各适配器现有声明，不在此处改写风险等级。
        let validation;
        try {
            validation = await plugin.adapterRegistry.validateAll(targetAdapters, payload, configs);
        } catch (error) {
            new Notice(t('发送预检失败：{error}', { error: error.message || String(error) }), 10000);
            await this._writeSendLog(this._buildLogEntryBase({
                dispatched: false,
                failStage: 'validate-exception',
                failReason: error.message || String(error),
                images: await this._collectLogImages(this.content),
                diagnostics: {
                    targets: [],
                    validationWarnings: [],
                    attachmentWarnings: Array.isArray(warningMessages) ? warningMessages : []
                }
            }));
            return;
        }
        if (validation.warnings.length > 0) {
            new Notice(t('发送预检提示：{detail}', { detail: validation.warnings.join(t('；')) }), 10000);
        }
        if (validation.errors.length > 0) {
            new Notice(t('发送预检未通过：{detail}', { detail: validation.errors.join(t('；')) }), 10000);
            await this._writeSendLog(this._buildLogEntryBase({
                dispatched: false,
                failStage: 'validate-errors',
                failReason: validation.errors.join(t('；')),
                images: await this._collectLogImages(this.content),
                diagnostics: {
                    targets: [],
                    validationWarnings: Array.isArray(validation.warnings) ? validation.warnings : [],
                    attachmentWarnings: Array.isArray(warningMessages) ? warningMessages : []
                }
            }));
            return;
        }

        // 1. 立即关闭弹窗，不阻塞用户操作
        this.close();
        new Notice(t('🚀 已提交后台发送中...'), 3000);

        // 记录点击发布的时间戳，供发送日志使用（发送完成时再取会偏晚）
        const dispatchStartedAt = new Date().toISOString();

        // 2. 在独立异步任务中运行网络传输，保证关窗后进程绝不中断
        //    调度（组间并行、组内串行）由 send-dispatcher 完成
        //    （telegram 频道在 adapter 内部并行发送）
        (async () => {
            const results = await dispatchSends({
                plugin,
                payload,
                targetAdapters,
                tgChannels,
                mstdAccountIds,
                targetConfigOverrides
            });

            // 发送完成，在 Obsidian 弹出非阻塞结果 Notice 提示
            const anyFailure = Object.values(results).some(r => !r.success && !r.skipped);
            // 写入发送日志快照（在 finally 释放 Blob 前完成图片缓存采集）
            try {
                const diagTargets = buildDiagTargets({ targetAdapters, mstdAccountIds, results });
                await this._writeSendLog(this._buildLogEntryBase({
                    dispatched: true,
                    failStage: null,
                    failReason: null,
                    sentAt: dispatchStartedAt,
                    images: await this._collectLogImages(rawContent, images),
                    diagnostics: {
                        targets: diagTargets,
                        validationWarnings: Array.isArray(validation?.warnings) ? validation.warnings : [],
                        attachmentWarnings: Array.isArray(warningMessages) ? warningMessages : []
                    }
                }));
            } catch (e) {
                // 日志写入绝不影响发送结果本身
            }
            const summary = buildSummary(results);

            if (anyFailure) {
                new Notice(t('❌ 发送存在失败：{summary}', { summary }), 20000);
            } else {
                new Notice(t('✅ 发送成功：{summary}', { summary }), 6000);
            }
        })().finally(() => {
            // 后台发送完成后释放对粘贴图片 Blob 的引用；发送期间必须保留它们。
            for (const image of images) {
                if (image?.blob) image.blob = null;
                image.blobUrl = '';
            }
            images.length = 0;
        });

    }

    onClose() {
        // 快捷发送可能绕过预览浮层的点击关闭路径，关窗时统一释放其 Esc 监听。
        this.hideImagePreview();
        this._imageGridRenderId += 1;
        // 释放所有缩略图预览 URL，避免内存泄漏。
        for (const url of this._objectUrls) URL.revokeObjectURL(url);
        this._objectUrls.clear();
        this.images = [];
        // 附件警告确认态计时器、预设删除确认态与快捷键监听在关窗时统一清理，避免关窗后仍触发。
        this._clearAttachmentWarningState();
        this._clearPresetDeleteConfirm();
        if (this._sendKeyHandler) {
            this.modalEl.removeEventListener('keydown', this._sendKeyHandler);
            this._sendKeyHandler = null;
        }
        this.contentEl.empty();
    }
}

module.exports = JournalSyncSendModal;
