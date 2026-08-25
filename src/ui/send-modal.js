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
const { buildPayload } = require('../core/payload');


class JournalSyncSendModal extends Modal {
    /**
     * @param {App} app
     * @param {object} plugin
     * @param {string} content
     * @param {object} richDraft
     * @param {Function} readImageFile
     */
    constructor(app, plugin, { content, richDraft, readImageFile, notionTitle = '' }) {
        super(app);
        this.plugin = plugin;
        this.rawContent = content || '';
        this.richDraft = richDraft || { version: 1, blocks: [], images: [] };
        this.readImageFile = readImageFile;
        this.notionTitle = notionTitle;

        this.tgSendMode = 'plain'; // 'plain' | 'rich' | 'telegraph'
        this.telegraphTitle = '';  // Telegraph 标题缓存（仅窗口生命周期内有效）
        this.tgShowLinkPreview = true; // 网址预览开关（从设置初始化，发送时可临时切换）
        this.selectedTargets = new Set();
        this.selectedTgChannels = new Set();

        this.editingPresetId = '';
        this.images = [];
        this._objectUrls = new Set(); // 跟踪当前缩略图预览 URL，关闭时统一释放
        this._imageGridRenderId = 0; // 使过期的异步缩略图加载失效
        this._warningConfirmActive = false;
        this._warningKey = '';
        this._warningTimer = null;
        this.initContentAndImages();

        this.loadActivePresetSelection();
        const _tgConfig = this.plugin.getAdapterConfig('telegram');
        this.tgShowLinkPreview = _tgConfig?.showLinkPreview !== false;
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
        publishTitleRow.createEl('h4', { text: '选择发布目标', cls: 'js-bridge-section-title' });

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

        // 监听粘贴事件：拦截剪贴板中的图片，转为 @图片N token
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
            if (!imageItem) return; // 纯文本粘贴走默认行为

            e.preventDefault();
            e.stopPropagation();

            const file = imageItem.getAsFile();
            if (!file) return;

            this.addPastedImage(file, richDiv);
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

    /**
     * 将粘贴的图片文件加入图片列表，在光标处插入 token chip，刷新缩略图网格。
     * 图片仅存于内存 Blob，不写入 vault；预览 URL 在渲染时创建，关闭窗口时释放。
     */
    addPastedImage(file, richDiv) {
        const ext = (file.type && file.type.split('/')[1]) || 'png';
        const filename = `clipboard_${Date.now()}.${ext}`;
        const token = `@图片${this.images.length + 1}`;

        const imageEntry = {
            filename,
            vaultPath: filename,
            id: `paste_${Date.now()}`,
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
                    const blob = new Blob([arrayBuf]);
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
                    const tokenPattern = new RegExp(removedImage.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
                    this.content = this.content.replace(tokenPattern, '').replace(/\n{3,}/g, '\n\n').trim();
                    this.editorEl?.querySelectorAll('.image-token-chip').forEach(chip => {
                        if (chip.getAttribute('data-token') === removedImage.token) chip.remove();
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

        const tgLabelRow = this.tgSectionEl.createDiv({ cls: 'tg-channel-label-row' });
        tgLabelRow.createEl('div', { text: 'Telegram：', cls: 'target-sub-label' });

        // 按钮组：Telegraph + 富文本，紧贴右侧
        const tgBtnGroup = tgLabelRow.createDiv({ cls: 'tg-btn-group' });

        // Telegraph 按钮（放在富文本按钮左侧）
        const telegraphBtn = tgBtnGroup.createEl('button', {
            type: 'button',
            text: 'Telegraph',
            cls: `tg-input-mode-btn tg-telegraph-btn${this.tgSendMode === 'telegraph' ? ' active expanded' : ''}`
        });
        telegraphBtn.title = '点击使用 Telegraph 方式发送';

        // 网址预览开关：放在富文本左侧、Telegraph 右侧，样式与其它两个按钮一致。
        const previewToggleBtn = tgBtnGroup.createEl('button', {
            type: 'button',
            text: '预览',
            cls: `tg-input-mode-btn tg-preview-btn${this.tgShowLinkPreview ? ' active' : ''}`
        });
        previewToggleBtn.title = this.tgShowLinkPreview ? '当前为显示网址预览，点击关闭预览' : '当前为关闭网址预览，点击显示预览';
        previewToggleBtn.addEventListener('click', () => {
            this.tgShowLinkPreview = !this.tgShowLinkPreview;
            previewToggleBtn.classList.toggle('active', this.tgShowLinkPreview);
            previewToggleBtn.title = this.tgShowLinkPreview ? '当前为显示网址预览，点击关闭预览' : '当前为关闭网址预览，点击显示预览';
        });

        // 富文本开关：仅在 Telegram「启用富文本发送」开启时显示。
        // 按钮文字固定为「富文本」，灰态（未激活）表示当前实际为纯文本发送。
        if (tgConfig.richTextEnabled !== false) {
            const richToggleBtn = tgBtnGroup.createEl('button', {
                type: 'button',
                text: '富文本',
                cls: `tg-input-mode-btn${this.tgSendMode === 'rich' ? ' active' : ''}`
            });
            richToggleBtn.title = this.tgSendMode === 'rich' ? '当前为富文本发送，点击切换为纯文本' : '当前为纯文本发送，点击切换为富文本';
            richToggleBtn.addEventListener('click', () => {
                if (this.tgSendMode === 'rich') {
                    this.tgSendMode = 'plain';
                } else {
                    this.tgSendMode = 'rich';
                }
                richToggleBtn.classList.toggle('active', this.tgSendMode === 'rich');
                richToggleBtn.title = this.tgSendMode === 'rich' ? '当前为富文本发送，点击切换为纯文本' : '当前为纯文本发送，点击切换为富文本';
                // 取消 Telegraph 激活态并收起
                telegraphBtn.classList.remove('active', 'expanded');
                this._collapseTelegraphBtn(telegraphBtn);
            });
        }

        // Telegraph 按钮交互：单击展开/激活，双击标题编辑，单击前缀关闭
        telegraphBtn.addEventListener('click', (e) => {
            // 如果已展开，检查点击区域
            if (this.tgSendMode === 'telegraph') {
                // 点击的是前缀区域 → 关闭
                const prefixEl = telegraphBtn.querySelector('.tg-telegraph-prefix');
                if (prefixEl && prefixEl.contains(e.target)) {
                    this.tgSendMode = 'plain';
                    telegraphBtn.classList.remove('active', 'expanded');
                    this._collapseTelegraphBtn(telegraphBtn);
                    return;
                }
                // 点击标题区域不做操作（双击由 dblclick 处理）
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

        telegraphBtn.addEventListener('dblclick', (e) => {
            if (this.tgSendMode !== 'telegraph') return;
            const titleEl = telegraphBtn.querySelector('.tg-telegraph-title');
            if (!titleEl || !titleEl.contains(e.target)) return;
            this._editTelegraphTitle(telegraphBtn, titleEl);
        });

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
        const prefix = btn.createSpan({ cls: 'tg-telegraph-prefix', text: 'Telegraph：' });
        prefix.title = '点击此处关闭 Telegraph 发送';
        const titleSpan = btn.createSpan({ cls: 'tg-telegraph-title', text: this.telegraphTitle });
        titleSpan.title = '双击编辑标题';
        btn.title = 'Telegraph 模式：单击前缀关闭，双击标题编辑';
    }

    /**
     * 收起 Telegraph 按钮：恢复为 "Telegraph"
     */
    _collapseTelegraphBtn(btn) {
        btn.empty();
        btn.textContent = 'Telegraph';
        btn.title = '点击使用 Telegraph 方式发送';
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
        this.sendBtn.textContent = '发布';
        this.sendBtn.classList.remove('mod-warning');
        this.sendBtn.removeAttribute('title');
    }

    _clearAttachmentWarningState() {
        if (this._warningTimer) window.clearTimeout(this._warningTimer);
        this._warningTimer = null;
        this._warningConfirmActive = false;
        this._warningKey = '';
        this._resetSendButton();
    }

    _showAttachmentWarnings(warnings) {
        const messages = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
        if (messages.length === 0) return;

        if (this._warningTimer) window.clearTimeout(this._warningTimer);
        this._warningConfirmActive = true;
        this._warningKey = messages.join('\n');
        if (this.sendBtn) {
            this.sendBtn.textContent = messages.length === 1
                ? `⚠️ ${messages[0]}`
                : `⚠️ ${messages.length} 项预警，确认发送`;
            this.sendBtn.title = messages.join('\n');
            this.sendBtn.classList.add('mod-warning');
        }
        this._warningTimer = window.setTimeout(() => {
            this._clearAttachmentWarningState();
        }, 5000);
    }


    /**
     * 执行发送（即时关窗 + 后台无阻塞异步发送）
     */
    async doSend() {
        const plugin = this.plugin;
        // 二次校验：设置可能在弹窗打开后被停用，停用适配器不得发送。
        const targetAdapters = Array.from(this.selectedTargets).filter(adapterId =>
            adapterId !== 'telegram' &&
            plugin.adapterRegistry.has(adapterId) &&
            plugin.isAdapterEnabled(adapterId)
        );
        const tgChannels = plugin.adapterRegistry.has('telegram') && plugin.isAdapterEnabled('telegram')
            ? Array.from(this.selectedTgChannels)
            : [];
        if (tgChannels.length > 0) {
            targetAdapters.push('telegram');
        }

        if (targetAdapters.length === 0 && tgChannels.length === 0) {
            new Notice('请至少选择一个发送目标或 Telegram 频道');
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

        // 构建统一 payload；图片实体沿用发送面板当前状态，保证编辑后的 token 与附件一致。
        const payload = buildPayload({
            content: rawContent,
            richDraft: { ...this.richDraft, images },
            title: this.notionTitle || '',
            readAttachment
        });
        const targetConfigOverrides = {};
        if (tgChannels.length > 0) {
            targetConfigOverrides.telegram = {
                tgSendMode: this.tgSendMode,
                channelIds: tgChannels,
                telegraphTitle: this.telegraphTitle,
                showLinkPreview: this.tgShowLinkPreview
            };
        }

        // 按目标适配器的能力声明做统一图片预警；预警状态只保留 5 秒。
        let capabilityWarnings;
        try {
            capabilityWarnings = await plugin.adapterRegistry.getAttachmentWarnings(targetAdapters, payload);
        } catch (error) {
            new Notice(`图片预检失败：${error.message || String(error)}`, 10000);
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
            const configs = {};
            for (const adapterId of targetAdapters) {
                configs[adapterId] = {
                    ...plugin.getAdapterConfig(adapterId),
                    ...(targetConfigOverrides[adapterId] || {})
                };
            }
            validation = await plugin.adapterRegistry.validateAll(targetAdapters, payload, configs);
        } catch (error) {
            new Notice(`发送预检失败：${error.message || String(error)}`, 10000);
            return;
        }
        if (validation.warnings.length > 0) {
            new Notice(`发送预检提示：${validation.warnings.join('；')}`, 10000);
        }
        if (validation.errors.length > 0) {
            new Notice(`发送预检未通过：${validation.errors.join('；')}`, 10000);
            return;
        }

        // 1. 立即关闭弹窗，不阻塞用户操作
        this.close();
        new Notice('🚀 已提交后台发送中...', 3000);

        // 2. 在独立异步任务中运行网络传输，保证关窗后进程绝不中断
        (async () => {
            const results = {};
            for (const adapterId of targetAdapters) {
                try {
                    const result = await plugin.executeAdapter(
                        adapterId,
                        payload,
                        targetConfigOverrides[adapterId] || {}
                    );
                    results[adapterId] = result;
                } catch (error) {
                    results[adapterId] = { success: false, error: error.message };
                }
            }

            // 发送完成，在 Obsidian 弹出非阻塞结果 Notice 提示
            const anyFailure = Object.values(results).some(r => !r.success && !r.skipped);
            const summary = Object.entries(results)
                .flatMap(([id, result]) => {
                    const channelResults = Array.isArray(result.results) ? result.results : null;
                    if ((id === 'Telegram' || id === 'telegram') && channelResults) {
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
        this._clearAttachmentWarningState();
        this._imageGridRenderId += 1;
        // 释放所有缩略图预览 URL，避免内存泄漏。
        for (const url of this._objectUrls) URL.revokeObjectURL(url);
        this._objectUrls.clear();
        // 关闭窗口后不再保留粘贴图片的内存 Blob；后台发送使用自己的 images 引用。
        this.images = [];
        this.contentEl.empty();
    }
}

module.exports = JournalSyncSendModal;
