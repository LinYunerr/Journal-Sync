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

function getPlainTextWithoutImageTokens(text) {
    return String(text || '')
        .replace(/@图片\d+/g, '')
        .replace(/!\[\[[^\]]+\]\]/g, '')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function buildTelegramSegmentsFromEditor(content, images) {
    const imageByToken = new Map(
        (Array.isArray(images) ? images : [])
            .filter(image => image?.token && image?.filename)
            .map(image => [image.token, image])
    );
    const segments = [];
    const tokenPattern = /@图片\d+/g;
    const source = String(content || '');
    let cursor = 0;
    let match;

    const pushText = (text) => {
        if (!text) return;
        const previous = segments[segments.length - 1];
        if (previous?.type === 'richText') previous.markdown += text;
        else segments.push({ type: 'richText', markdown: text });
    };

    while ((match = tokenPattern.exec(source)) !== null) {
        pushText(source.slice(cursor, match.index));
        const image = imageByToken.get(match[0]);
        if (image) {
            segments.push({
                type: 'image',
                filename: image.filename,
                vaultPath: image.vaultPath || image.filename
            });
        } else {
            pushText(match[0]);
        }
        cursor = match.index + match[0].length;
    }
    pushText(source.slice(cursor));
    return segments;
}

class JournalSyncSendModal extends Modal {
    /**
     * @param {App} app
     * @param {object} plugin
     * @param {string} content
     * @param {object} richDraft
     * @param {Array} telegramSegments
     * @param {Function} readImageFile
     */
    constructor(app, plugin, { content, richDraft, telegramSegments, readImageFile, notionTitle = '' }) {
        super(app);
        this.plugin = plugin;
        this.rawContent = content || '';
        this.richDraft = richDraft || { version: 1, blocks: [], images: [] };
        this.telegramSegments = telegramSegments || [];
        this.readImageFile = readImageFile;
        this.notionTitle = notionTitle;
        this.notionImageWarnings = [];

        this.isRichTextMode = false; // 默认模式为纯文本
        this.selectedTargets = new Set();
        this.selectedTgChannels = new Set();

        this.editingPresetId = '';
        this.images = [];
        this._objectUrls = new Set(); // 跟踪缩略图预览 URL，关闭时统一释放
        this.initContentAndImages();
        this.loadActivePresetSelection();
    }

    /**
     * 初始化文本与图片 Token 逻辑
     */
    initContentAndImages() {
        const imgs = [];
        if (Array.isArray(this.telegramSegments)) {
            for (const seg of this.telegramSegments) {
                if (seg.type === 'image' && seg.filename) {
                    imgs.push({
                        filename: seg.filename,
                        vaultPath: seg.vaultPath || seg.filename,
                        id: seg.vaultPath || seg.filename,
                        token: `@图片${imgs.length + 1}`
                    });
                }
            }
        }
        if (imgs.length === 0 && Array.isArray(this.richDraft.images)) {
            for (const img of this.richDraft.images) {
                if (img.filename) {
                    imgs.push({
                        filename: img.filename,
                        vaultPath: img.vaultPath || img.filename,
                        id: img.id || img.vaultPath || img.filename,
                        token: `@图片${imgs.length + 1}`
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

        if (preset && Array.isArray(preset.items)) {
            for (const item of preset.items) {
                const id = String(item.id || '');
                if (id.startsWith('plugin:')) {
                    const pluginId = id.replace('plugin:', '');
                    // 预设可能早于平台停用而保存；停用平台不得进入本次发送集合。
                    if (
                        pluginId !== 'telegram' &&
                        this.plugin.adapterRegistry.has(pluginId) &&
                        this.plugin.isAdapterEnabled(pluginId)
                    ) {
                        this.selectedTargets.add(pluginId);
                    }
                } else if (id.startsWith('telegram-channel:')) {
                    const chId = id.replace('telegram-channel:', '');
                    this.selectedTgChannels.add(chId);
                }
            }
        } else {
            const adapters = this.plugin.adapterRegistry.getAll();
            for (const a of adapters) {
                if (a.manifest.id !== 'telegram' && this.plugin.isAdapterEnabled(a.manifest.id)) {
                    this.selectedTargets.add(a.manifest.id);
                }
            }
            const tgConfig = this.plugin.getAdapterConfig('telegram');
            const homeChannels = Array.isArray(tgConfig?.homeChannels) ? tgConfig.homeChannels.map(String) : [];
            for (const chId of homeChannels) {
                this.selectedTgChannels.add(chId);
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
                name: '默认预设',
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
        headerRow.createEl('h2', { text: 'Journal Sync · 发送内容', cls: 'js-bridge-send-title' });

        // 2. 文本编辑区域
        const inputPanel = contentEl.createDiv({ cls: 'js-bridge-panel' });

        const inputTitleRow = inputPanel.createDiv({ cls: 'js-bridge-panel-title-row' });
        inputTitleRow.createEl('h4', { text: '1. 内容编辑与预览', cls: 'js-bridge-section-title' });

        const inputActions = inputTitleRow.createDiv({ cls: 'js-bridge-input-actions' });

        // 富文本开关：仅在 Telegram「启用富文本发送」开启时显示。
        // 按钮文字固定为「富文本」，灰态（未激活）表示当前实际为纯文本发送。
        const tgConfig = this.plugin.getAdapterConfig('telegram') || {};
        if (tgConfig.richTextEnabled !== false) {
            const richToggleBtn = inputActions.createEl('button', {
                type: 'button',
                text: '富文本',
                cls: `tg-input-mode-btn${this.isRichTextMode ? ' active' : ''}`
            });
            richToggleBtn.title = this.isRichTextMode ? '当前为富文本发送，点击切换为纯文本' : '当前为纯文本发送，点击切换为富文本';
            richToggleBtn.addEventListener('click', () => {
                this.isRichTextMode = !this.isRichTextMode;
                richToggleBtn.classList.toggle('active', this.isRichTextMode);
                richToggleBtn.title = this.isRichTextMode ? '当前为富文本发送，点击切换为纯文本' : '当前为纯文本发送，点击切换为富文本';
            });
        }

        const editorContainer = inputPanel.createDiv({ cls: 'js-bridge-editor-container' });
        this.renderEditorContent(editorContainer);

        // 缩略图网格
        if (this.images.length > 0) {
            const mediaGrid = inputPanel.createDiv({ cls: 'media-thumb-grid' });
            this.renderImageGrid(mediaGrid);
            this.notionImageWarningEl = inputPanel.createDiv({ cls: 'notion-image-warning-list' });
            this.updateNotionImageWarnings();
        }

        // 3. 发布目标与预设分组区域
        const publishPanel = contentEl.createDiv({ cls: 'js-bridge-panel' });

        const publishTitleRow = publishPanel.createDiv({ cls: 'js-bridge-panel-title-row' });
        publishTitleRow.createEl('h4', { text: '2. 选择发布目标', cls: 'js-bridge-section-title' });

        this.presetControlsEl = publishTitleRow.createDiv({ cls: 'publish-preset-controls' });
        this.renderPresetControls();

        // 通用目标 Blocks 容器
        this.simpleTargetsEl = publishPanel.createDiv({ cls: 'target-list' });

        // Telegram 频道平行 Block 容器
        this.tgSectionEl = publishPanel.createDiv({ cls: 'tg-channel-block' });

        this.renderAllTargetSections();

        // 4. 发送按钮
        const btnArea = contentEl.createDiv({ cls: 'js-bridge-btn-area' });

        this.sendBtn = btnArea.createEl('button', {
            text: '发布',
            cls: 'primary-btn simple-send-btn mod-cta'
        });
        this.sendBtn.addEventListener('click', () => this.doSend());

        // Lightbox Modal
        this.previewModalEl = contentEl.createDiv({ cls: 'media-preview-modal' });
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
            const match = textBefore.match(/@(?:图|图片)?$/);

            if (match) {
                this.showMentionDropdown(mentionDropdown, richDiv, range, match[0]);
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
            let text = '';
            richDiv.childNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && node.classList.contains('image-token-chip')) {
                        text += node.getAttribute('data-token') || node.textContent.replace(/^📷\s*/, '');
                    } else if (node.tagName === 'BR') {
                        text += '\n';
                    } else {
                        text += node.innerText || node.textContent;
                    }
                } else if (node.nodeType === Node.TEXT_NODE) {
                    text += node.textContent;
                }
            });
            this.content = text;
        });
    }

    showMentionDropdown(dropdownEl, richDiv, range, matchedText) {
        dropdownEl.empty();
        dropdownEl.removeClass('hidden');

        const rect = range.getBoundingClientRect();
        const editorRect = richDiv.getBoundingClientRect();

        dropdownEl.style.top = `${rect.bottom - editorRect.top + richDiv.offsetTop + 4}px`;
        dropdownEl.style.left = `${Math.min(Math.max(10, rect.left - editorRect.left + richDiv.offsetLeft), editorRect.width - 220)}px`;

        dropdownEl.createDiv({ text: '选择图片占位符：', cls: 'mention-dropdown-title' });

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

        sel.removeAllRanges();
        sel.addRange(range);

        richDiv.dispatchEvent(new Event('input'));
    }

    renderImageGrid(containerEl) {
        containerEl.empty();
        if (this.images.length === 0) return;

        // 释放上一轮渲染创建的预览 URL，避免内存泄漏
        for (const url of this._objectUrls) URL.revokeObjectURL(url);
        this._objectUrls.clear();

        this.images.forEach((img, index) => {
            const thumb = containerEl.createDiv({ cls: 'media-thumb' });
            const imgEl = thumb.createEl('img', { attr: { alt: img.filename } });

            this.readImageFile(img.vaultPath).then(arrayBuf => {
                if (!arrayBuf) return;
                const blob = new Blob([arrayBuf]);
                const url = URL.createObjectURL(blob);
                this._objectUrls.add(url);
                imgEl.src = url;
            }).catch(() => {});

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
                    const tokenPattern = new RegExp(removedImage.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                    this.content = this.content.replace(tokenPattern, '').replace(/\n{3,}/g, '\n\n').trim();
                    this.editorEl?.querySelectorAll('.image-token-chip').forEach(chip => {
                        if (chip.getAttribute('data-token') === removedImage.token) chip.remove();
                    });
                    this.telegramSegments = this.telegramSegments.filter(segment => {
                        return segment.type !== 'image' || segment.vaultPath !== removedImage.vaultPath;
                    });
                    this.richDraft = {
                        ...this.richDraft,
                        blocks: (this.richDraft.blocks || []).filter(block => block.imageId !== removedImage.id),
                        images: (this.richDraft.images || []).filter(image => {
                            return (image.vaultPath || image.filename) !== removedImage.vaultPath;
                        })
                    };
                }
                this.renderImageGrid(containerEl);
                this.updateNotionImageWarnings();
            });

            thumb.addEventListener('click', () => {
                if (imgEl.src) this.showImagePreview(imgEl.src);
            });
        });
    }

    async updateNotionImageWarnings() {
        if (!this.notionImageWarningEl) return;
        const threshold = 5 * 1024 * 1024;
        const warningItems = [];
        for (const image of this.images) {
            try {
                const buffer = await this.readImageFile(image.vaultPath);
                if (buffer?.byteLength > threshold) warningItems.push({ filename: image.filename, bytes: buffer.byteLength });
            } catch {}
        }
        this.notionImageWarnings = warningItems;
        this.notionImageWarningEl.empty();
        for (const warning of warningItems) {
            const size = (warning.bytes / 1024 / 1024).toFixed(1);
            this.notionImageWarningEl.createDiv({ cls: 'notion-image-warning', text: `Notion 提示：${warning.filename} 为 ${size} MB，可能超过当前方案的 5 MB 限制，图片可能发送失败。` });
        }
    }

    showImagePreview(src) {
        this.previewImgEl.src = src;
        this.previewModalEl.addClass('active');
    }

    hideImagePreview() {
        this.previewModalEl.removeClass('active');
        this.previewImgEl.src = '';
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
                    const newName = input.value.trim() || `预设${index + 1}`;
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
            btn.title = '点击应用分组，双击重命名';

            btn.addEventListener('click', async () => {
                if (this.editingPresetId) return;
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
            addBtn.title = '新增当前选择为预设分组';
            addBtn.addEventListener('click', async () => {
                const newPreset = {
                    id: `preset-${Date.now()}`,
                    name: `预设${presets.length + 1}`,
                    items: this.buildCurrentPresetItems()
                };
                presets.push(newPreset);
                this.plugin.settings.publishPresets = presets;
                this.plugin.settings.activePresetId = newPreset.id;
                await this.plugin.saveSettings();
                this.renderPresetControls();
            });
        }

        // - 删除
        if (presets.length > 0 && activeId) {
            const removeBtn = this.presetControlsEl.createEl('button', {
                type: 'button',
                cls: 'publish-preset-action remove'
            });
            removeBtn.title = '删除当前选中预设';
            removeBtn.addEventListener('click', async () => {
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
        return items;
    }

    renderAllTargetSections() {
        this.renderSimpleTargets();
        this.renderTelegramChannels();
    }

    renderSimpleTargets() {
        if (!this.simpleTargetsEl) return;
        this.simpleTargetsEl.empty();

        const adapters = this.plugin.adapterRegistry.getAll();
        const generalAdapters = adapters.filter(a => a.manifest.id !== 'telegram' && this.plugin.isAdapterEnabled(a.manifest.id));

        if (generalAdapters.length === 0) return;

        for (const adapter of generalAdapters) {
            const id = adapter.manifest.id;
            const isSelected = this.selectedTargets.has(id);

            const block = this.simpleTargetsEl.createEl('button', {
                type: 'button',
                cls: `plugin-toggle-block${isSelected ? ' active' : ''}`
            });

            block.createSpan({ cls: 'plugin-toggle-title', text: adapter.manifest.name });

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

    renderTelegramChannels() {
        if (!this.tgSectionEl) return;
        this.tgSectionEl.empty();

        if (!this.plugin.isAdapterEnabled('telegram')) return;

        const tgConfig = this.plugin.getAdapterConfig('telegram');
        const channels = Array.isArray(tgConfig?.channels) ? tgConfig.channels : [];

        this.tgSectionEl.createEl('div', { text: 'Telegram 目标频道：', cls: 'target-sub-label' });

        if (channels.length === 0) {
            this.tgSectionEl.createDiv({
                cls: 'target-sub',
                text: '尚未获取频道列表，请先在插件设置中获取频道。'
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

    /**
     * 执行发送（即时关窗 + 后台无阻塞异步发送）
     */
    doSend() {
        const plugin = this.plugin;
        // 二次校验：设置可能在弹窗打开后被停用，停用适配器不得发送。
        const targetAdapters = Array.from(this.selectedTargets).filter(adapterId =>
            adapterId !== 'telegram' &&
            plugin.adapterRegistry.has(adapterId) &&
            plugin.isAdapterEnabled(adapterId)
        );
        const tgChannels = Array.from(this.selectedTgChannels);

        if (targetAdapters.length === 0 && tgChannels.length === 0) {
            new Notice('请至少选择一个发送目标或 Telegram 频道');
            return;
        }

        // 提取待发送参数
        const isRich = this.isRichTextMode;
        const rawContent = this.content;
        const plainTextContent = getPlainTextWithoutImageTokens(rawContent);
        const richDraft = this.richDraft;
        const readImageFile = this.readImageFile;
        const referencedTokens = new Set(rawContent.match(/@图片\d+/g) || []);
        const images = this.images.filter(image => referencedTokens.has(image.token));

        // 1. 立即关闭弹窗，不阻塞用户操作
        this.close();
        new Notice('🚀 已提交后台发送中...', 3000);

        // 2. 在独立异步任务中运行网络传输，保证关窗后进程绝不中断
        (async () => {
            const results = {};

            // 发送通用目标（Flomo, Mastodon, Misskey, Notion 等）
            for (const adapterId of targetAdapters) {
                try {
                    if (adapterId === 'notion') {
                        const notionConfig = plugin.getAdapterConfig('notion') || {};
                        const prepared = await plugin.prepareNotionImages(images, readImageFile, Boolean(notionConfig.autoCompressLargeImages));
                        let notionTitle = this.notionTitle;
                        if (notionConfig.titleSource === 'none') notionTitle = '';
                        if (notionConfig.titleSource === 'first_heading') {
                            const headingMatch = rawContent.match(/^#\s+(.+)$/m);
                            notionTitle = headingMatch ? headingMatch[1].trim() : '';
                        }
                        const result = await plugin.executeAdapter(adapterId, {
                            content: rawContent,
                            title: notionTitle,
                            localImages: prepared.localImages,
                            externalImages: {}
                        });
                        result.warnings = prepared.warnings.map(item => `${item.filename} 超过 5 MB 预警阈值`);
                        results[adapterId] = result;
                    } else {
                        const result = await plugin.executeAdapter(adapterId, {
                            content: plainTextContent,
                            richDraft: {
                                ...richDraft,
                                images
                            },
                            images: images.map(img => img.vaultPath).filter(Boolean),
                            readImageFile
                        });
                        results[adapterId] = result;
                    }
                } catch (error) {
                    results[adapterId] = { success: false, error: error.message };
                }
            }

            // 发送 Telegram 频道
            if (tgChannels.length > 0 && plugin.isAdapterEnabled('telegram')) {
                try {
                    // 始终从发布时的编辑器内容重建段落，避免发送弹窗打开时的旧草稿。
                    const tgSegs = buildTelegramSegmentsFromEditor(rawContent, images);

                    const tgResult = await plugin.executeAdapter('telegram', {
                        content: isRich ? rawContent : plainTextContent,
                        telegramSegments: tgSegs,
                        readImageFile,
                        channelIds: tgChannels,
                        isRichText: isRich
                    });
                    results['Telegram'] = tgResult;
                } catch (error) {
                    results['Telegram'] = { success: false, error: error.message };
                }
            }

            // 发送完成，在 Obsidian 弹出非阻塞结果 Notice 提示
            const anyFailure = Object.values(results).some(r => !r.success && !r.skipped);
            const summary = Object.entries(results)
                .flatMap(([id, result]) => {
                    const channelResults = Array.isArray(result.results) ? result.results : null;
                    if (id === 'Telegram' && channelResults) {
                        return channelResults.map(channel => {
                            return `Telegram ${channel.channelId}: ${channel.success ? '成功' : `失败(${channel.error || '未知错误'})`}`;
                        });
                    }
                    const warn = Array.isArray(result.warnings) && result.warnings.length > 0 ? `（${result.warnings.join('；')}）` : '';
                    return result.success
                        ? (result.skipped ? `${id}: 跳过` : `${id}: 成功${warn}`)
                        : `${id}: 失败(${result.error || '未知错误'})`;
                })
                .join('；\n');

            if (anyFailure) {
                new Notice(`❌ 发送存在失败：${summary}`, 10000);
            } else {
                new Notice(`✅ 发送成功：${summary}`, 6000);
            }
        })();
    }

    onClose() {
        // 释放所有缩略图预览 URL，避免内存泄漏
        for (const url of this._objectUrls) URL.revokeObjectURL(url);
        this._objectUrls.clear();
        this.contentEl.empty();
    }
}

module.exports = JournalSyncSendModal;
