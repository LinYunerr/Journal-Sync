const { PluginSettingTab, Setting, Notice } = require('obsidian');

class JournalSyncSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.activeSection = 'main';
        this.activePlugin = 'flomo';
        this._saveTimer = null;
        this._savePending = false;
        this._savePromise = null;
    }

    async display() {
        await this._flushPendingSaves();
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('js-bridge-settings');

        containerEl.createEl('h2', { text: 'Journal Sync' });
        containerEl.createEl('p', {
            cls: 'js-bridge-settings-desc',
            text: '一键将笔记发送至其它平台'
        });

        const layoutEl = containerEl.createDiv({ cls: 'js-bridge-settings-layout' });
        const navEl = layoutEl.createDiv({ cls: 'js-bridge-settings-nav' });
        const contentEl = layoutEl.createDiv({ cls: 'js-bridge-settings-content' });
        this._addNavButton(navEl, 'main', '主设置');
        this._addNavButton(navEl, 'plugins', '插件设置');

        if (this.activeSection === 'main') {
            this._renderMainSettings(contentEl);
        } else {
            this._renderPluginSettings(contentEl);
        }
    }

    _addNavButton(containerEl, section, label) {
        const button = containerEl.createEl('button', {
            text: label,
            cls: 'js-bridge-settings-nav-button'
        });
        button.toggleClass('is-active', this.activeSection === section);
        button.addEventListener('click', () => {
            this.activeSection = section;
            this.display();
        });
    }

    /**
     * 文本框的 onChange 会在输入每个字符时触发。统一延迟保存，
     * 并在切换设置页面前先 flush，避免高频写 data.json 或丢失最后一次输入。
     */
    _scheduleSettingsSave(update) {
        update();
        this._savePending = true;
        if (this._saveTimer) window.clearTimeout(this._saveTimer);
        this._saveTimer = window.setTimeout(() => {
            this._saveTimer = null;
            void this._flushPendingSaves();
        }, 400);
    }

    async _flushPendingSaves() {
        if (this._saveTimer) {
            window.clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (this._savePromise) await this._savePromise;
        if (!this._savePending) return;

        this._savePending = false;
        this._savePromise = this.plugin.saveSettings().catch(error => {
            new Notice(`设置保存失败：${error.message || String(error)}`);
        });
        await this._savePromise;
        this._savePromise = null;

        // 保存期间如果又有输入，立即再保存一次最新状态。
        if (this._savePending) await this._flushPendingSaves();
    }

    _scheduleAdapterConfigSave(id, patch) {
        this._scheduleSettingsSave(() => {
            if (!this.plugin.settings.adaptersConfig) this.plugin.settings.adaptersConfig = {};
            this.plugin.settings.adaptersConfig[id] = {
                ...this.plugin.getAdapterConfig(id),
                ...patch
            };
        });
    }

    _renderMainSettings(containerEl) {
        containerEl.createEl('h3', { text: '主设置', cls: 'js-bridge-section-heading' });
        containerEl.createEl('p', {
            text: '管理日记创建和发送时通用的行为。',
            cls: 'js-bridge-settings-section-desc'
        });

        new Setting(containerEl)
            .setName('日记存放路径')
            .setDesc('Obsidian Vault 内的相对路径（如 日记/2024）')
            .addText(text => text.setPlaceholder('日记').setValue(this.plugin.settings.diaryPath || '').onChange(value => {
                this._scheduleSettingsSave(() => {
                    this.plugin.settings.diaryPath = value.trim();
                });
            }));

        new Setting(containerEl)
            .setName('日记文件名规则')
            .setDesc('支持 YYYY MM DD 占位符，例如 YYYY-MM-DD 日记')
            .addText(text => text.setPlaceholder('YYYY-MM-DD 日记').setValue(this.plugin.settings.filenameRule || 'YYYY-MM-DD 日记').onChange(value => {
                this._scheduleSettingsSave(() => {
                    this.plugin.settings.filenameRule = value.trim() || 'YYYY-MM-DD 日记';
                });
            }));

        new Setting(containerEl)
            .setName('自动上传本地图片')
            .setDesc('发送时自动读取并发送 Obsidian Vault 中引用的本地图片。')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.autoUploadImages !== false).onChange(async value => {
                this.plugin.settings.autoUploadImages = value;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('发送范围（未选中文本时）')
            .setDesc('使用发送命令且未选中文本时，发送光标所在位置的内容范围。选择任意标题级别时，不包含标题本身。')
            .addDropdown(dropdown => {
                dropdown.addOption('0', '整个页面');
                for (let i = 1; i <= 6; i++) dropdown.addOption(String(i), this._headingLevelLabel(i));
                dropdown.setValue(String(this.plugin.settings.sendScope ?? 2)).onChange(async value => {
                    this.plugin.settings.sendScope = Number(value);
                    // 登记在案的跨适配器特例：Telegraph 标题层级上限受全局发送范围约束，详见 AGENTS.md
                    const newScope = Number(value);
                    const maxLv = newScope === 0 ? 6 : Math.min(6, newScope);
                    const tgCfg = this.plugin.getAdapterConfig('telegram');
                    const currentLv = tgCfg.telegraphTitleLevel || 1;
                    if (currentLv > maxLv) {
                        await this.plugin.setAdapterConfig('telegram', { ...tgCfg, telegraphTitleLevel: maxLv });
                    }
                    await this.plugin.saveSettings();
                    // Refresh settings display so the title-level dropdown updates
                    this.display();
                });
            });

        new Setting(containerEl)
            .setName('新建标题级别')
            .setDesc('使用新建日记命令时，时间戳记录使用的标题级别。')
            .addDropdown(dropdown => {
                for (let i = 1; i <= 6; i++) dropdown.addOption(String(i), this._headingLevelLabel(i));
                dropdown.setValue(String(this.plugin.settings.diaryTimestampLevel ?? 2)).onChange(async value => {
                    this.plugin.settings.diaryTimestampLevel = Number(value);
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('新建标题格式')
            .setDesc('支持 H M S 占位符（H=时、M=分、S=秒），例如 HH:MM:SS 或 HH:MM')
            .addText(text => text.setPlaceholder('HH:MM:SS').setValue(this.plugin.settings.diaryHeadingRule || 'HH:MM:SS').onChange(value => {
                this._scheduleSettingsSave(() => {
                    this.plugin.settings.diaryHeadingRule = value.trim() || 'HH:MM:SS';
                });
            }));
    }

    // ── 插件设置：注册表驱动（manifest 通用渲染 + 适配器自定义面板） ──────────────────────────

    /**
     * 从注册表取全部适配器，按 manifest.displayOrder 升序排序；
     * 缺失 displayOrder 的排最后，并列时保持注册顺序（sort 稳定）。
     */
    _getSortedAdapters() {
        const adapters = this.plugin.adapterRegistry ? this.plugin.adapterRegistry.getAll() : [];
        const orderOf = adapter => {
            const order = Number(adapter?.manifest?.displayOrder);
            return Number.isFinite(order) ? order : Number.POSITIVE_INFINITY;
        };
        return adapters.slice().sort((a, b) => orderOf(a) - orderOf(b));
    }

    _renderPluginSettings(containerEl) {
        containerEl.createEl('h3', { text: '插件设置', cls: 'js-bridge-section-heading' });
        containerEl.createEl('p', {
            text: '选择发布平台，配置连接信息与发送行为。',
            cls: 'js-bridge-settings-section-desc'
        });

        const adapters = this._getSortedAdapters();
        const adapterIds = adapters.map(adapter => adapter?.manifest?.id).filter(Boolean);
        if (adapterIds.length === 0) return;
        if (!adapterIds.includes(this.activePlugin)) this.activePlugin = adapterIds[0];

        const tabsEl = containerEl.createDiv({ cls: 'js-bridge-plugin-tabs' });
        for (const adapter of adapters) {
            const id = adapter.manifest.id;
            const button = tabsEl.createEl('button', { text: adapter.manifest.name || id, cls: 'js-bridge-plugin-tab' });
            button.toggleClass('is-active', this.activePlugin === id);
            button.addEventListener('click', () => {
                this.activePlugin = id;
                this.display();
            });
        }

        const panelEl = containerEl.createDiv({ cls: 'js-bridge-plugin-panel' });
        const adapter = adapters.find(item => item?.manifest?.id === this.activePlugin);
        if (!adapter) return;

        // 启用开关由设置页统一渲染；未启用时不渲染其它内容
        this._addEnabledToggle(panelEl, adapter.manifest.id, adapter.manifest.name || adapter.manifest.id);
        if (!this.plugin.isAdapterEnabled(adapter.manifest.id)) return;

        try {
            if (typeof adapter.renderSettings === 'function') {
                adapter.renderSettings(panelEl, this._adapterContext(adapter.manifest.id, panelEl));
            } else {
                this._renderGenericAdapterSettings(panelEl, adapter);
            }
        } catch (error) {
            new Notice(`${adapter.manifest.name || adapter.manifest.id} 设置渲染失败：${error?.message || String(error)}`);
        }
    }

    _addEnabledToggle(containerEl, id, label) {
        new Setting(containerEl).setName(`启用 ${label}`).addToggle(toggle => toggle
            .setValue(this.plugin.isAdapterEnabled(id))
            .onChange(async value => {
                this.plugin.setAdapterEnabled(id, value);
                await this.plugin.saveSettings();
                this.display();
            }));
    }

    /**
     * 传给适配器自定义面板 renderSettings(panelEl, ctx) 的上下文。
     */
    _adapterContext(id, containerEl) {
        return {
            plugin: this.plugin,
            containerEl,
            scheduleConfigSave: patch => this._scheduleAdapterConfigSave(id, patch),
            saveConfig: async patch => this.plugin.setAdapterConfig(id, { ...this.plugin.getAdapterConfig(id), ...patch }),
            refresh: () => this.display(),
            requestUrl: this.plugin.requestUrl.bind(this.plugin)
        };
    }

    /**
     * 通用渲染：按 manifest.settings.fields 的字段类型生成设置项。
     * 仅处理契约定义的类型（text / password / toggle / select / action / info），
     * 未识别的类型跳过，避免把结构化配置当文本写坏。
     */
    _renderGenericAdapterSettings(panelEl, adapter) {
        const id = adapter?.manifest?.id;
        const fields = Array.isArray(adapter?.manifest?.settings?.fields) ? adapter.manifest.settings.fields : [];
        if (!id || fields.length === 0) return;
        const ctx = this._adapterContext(id, panelEl);

        for (const field of fields) {
            if (!field || typeof field !== 'object') continue;
            switch (field.type) {
                case 'text':
                case 'password':
                    this._renderGenericText(panelEl, id, field, ctx, field.type === 'password');
                    break;
                case 'toggle':
                    this._renderGenericToggle(panelEl, id, field, ctx);
                    break;
                case 'select':
                    this._renderGenericSelect(panelEl, id, field, ctx);
                    break;
                case 'action':
                    this._renderGenericAction(panelEl, id, adapter, field, ctx);
                    break;
                case 'info':
                    this._renderGenericInfo(panelEl, field);
                    break;
                default:
                    break;
            }
        }
    }

    _renderGenericText(panelEl, id, field, ctx, isPassword) {
        if (!field.key) return;
        const current = this.plugin.getAdapterConfig(id)[field.key];
        const setting = new Setting(panelEl).setName(field.label || field.key);
        const desc = field.desc ?? field.description;
        if (desc) setting.setDesc(desc);
        setting.addText(text => {
            if (isPassword) text.inputEl.type = 'password';
            if (field.placeholder) text.setPlaceholder(field.placeholder);
            text.setValue(String(current ?? field.default ?? '')).onChange(value => {
                ctx.scheduleConfigSave({ [field.key]: value.trim() });
            });
        });
    }

    _renderGenericToggle(panelEl, id, field, ctx) {
        if (!field.key) return;
        const current = this.plugin.getAdapterConfig(id)[field.key];
        const setting = new Setting(panelEl).setName(field.label || field.key);
        const desc = field.desc ?? field.description;
        if (desc) setting.setDesc(desc);
        setting.addToggle(toggle => toggle
            .setValue(Boolean(current ?? field.default ?? false))
            .onChange(async value => {
                await ctx.saveConfig({ [field.key]: value });
            }));
    }

    _renderGenericSelect(panelEl, id, field, ctx) {
        if (!field.key) return;
        const current = this.plugin.getAdapterConfig(id)[field.key];
        const options = Array.isArray(field.options) ? field.options : [];
        const setting = new Setting(panelEl).setName(field.label || field.key);
        const desc = field.desc ?? field.description;
        if (desc) setting.setDesc(desc);
        setting.addDropdown(dropdown => {
            for (const option of options) {
                if (!option) continue;
                dropdown.addOption(option.value, option.label ?? option.value);
            }
            dropdown.setValue(String(current ?? field.default ?? '')).onChange(async value => {
                await ctx.saveConfig({ [field.key]: value });
            });
        });
    }

    _renderGenericAction(panelEl, id, adapter, field, ctx) {
        if (!field.action || typeof adapter.runAction !== 'function') return;
        const buttonText = field.buttonLabel || field.label;
        const setting = new Setting(panelEl).setName(field.label || '');
        const desc = field.desc ?? field.description;
        if (desc) setting.setDesc(desc);
        setting.addButton(btn => btn
            .setButtonText(buttonText || '执行')
            .onClick(async () => {
                if (field.busyLabel) btn.setButtonText(field.busyLabel);
                btn.disabled = true;
                try {
                    const result = await adapter.runAction(field.action, this.plugin.getAdapterConfig(id), ctx.requestUrl);
                    new Notice(result?.message || field.successMessage || '操作完成');
                    this.display();
                } catch (error) {
                    new Notice(`${buttonText || '操作'}失败：${error?.message || String(error)}`);
                } finally {
                    btn.setButtonText(buttonText || '执行');
                    btn.disabled = false;
                }
            }));
    }

    _renderGenericInfo(panelEl, field) {
        const desc = field.desc ?? field.description;
        if (!field.label && !desc) return;
        const setting = new Setting(panelEl).setName(field.label || '');
        if (desc) setting.setDesc(desc);
    }

    _headingLevelLabel(level) {
        const names = ['一', '二', '三', '四', '五', '六'];
        const n = Math.min(6, Math.max(1, Number(level) || 1));
        return `${names[n - 1]}级标题`;
    }
}

module.exports = JournalSyncSettingTab;
