const { PluginSettingTab, Setting, Notice } = require('obsidian');

class JournalSyncSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.activeSection = 'main';
        this.activePlugin = 'flomo';
    }

    async display() {
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

    _renderMainSettings(containerEl) {
        containerEl.createEl('h3', { text: '主设置', cls: 'js-bridge-section-heading' });
        containerEl.createEl('p', {
            text: '管理日记创建和发送时通用的行为。',
            cls: 'js-bridge-settings-section-desc'
        });

        new Setting(containerEl)
            .setName('日记存放路径')
            .setDesc('Obsidian Vault 内的相对路径（如 日记/2024）')
            .addText(text => text.setPlaceholder('日记').setValue(this.plugin.settings.diaryPath || '').onChange(async value => {
                this.plugin.settings.diaryPath = value.trim();
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('日记文件名规则')
            .setDesc('支持 YYYY MM DD 占位符，例如 YYYY-MM-DD 日记')
            .addText(text => text.setPlaceholder('YYYY-MM-DD 日记').setValue(this.plugin.settings.filenameRule || 'YYYY-MM-DD 日记').onChange(async value => {
                this.plugin.settings.filenameRule = value.trim() || 'YYYY-MM-DD 日记';
                await this.plugin.saveSettings();
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
                    await this.plugin.saveSettings();
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
            .addText(text => text.setPlaceholder('HH:MM:SS').setValue(this.plugin.settings.diaryHeadingRule || 'HH:MM:SS').onChange(async value => {
                this.plugin.settings.diaryHeadingRule = value.trim() || 'HH:MM:SS';
                await this.plugin.saveSettings();
            }));
    }

    _renderPluginSettings(containerEl) {
        containerEl.createEl('h3', { text: '插件设置', cls: 'js-bridge-section-heading' });
        containerEl.createEl('p', {
            text: '选择发布平台，配置连接信息与发送行为。',
            cls: 'js-bridge-settings-section-desc'
        });

        const tabsEl = containerEl.createDiv({ cls: 'js-bridge-plugin-tabs' });
        for (const plugin of [
            { id: 'flomo', label: 'Flomo' },
            { id: 'telegram', label: 'Telegram' },
            { id: 'mastodon', label: 'Mastodon' },
            { id: 'missky', label: 'Misskey' },
            { id: 'notion', label: 'Notion' }
        ]) {
            const button = tabsEl.createEl('button', { text: plugin.label, cls: 'js-bridge-plugin-tab' });
            button.toggleClass('is-active', this.activePlugin === plugin.id);
            button.addEventListener('click', () => {
                this.activePlugin = plugin.id;
                this.display();
            });
        }

        const panelEl = containerEl.createDiv({ cls: 'js-bridge-plugin-panel' });
        if (this.activePlugin === 'flomo') this._renderFlomo(panelEl);
        if (this.activePlugin === 'telegram') this._renderTelegram(panelEl);
        if (this.activePlugin === 'mastodon') this._renderMastodon(panelEl);
        if (this.activePlugin === 'missky') this._renderMisskey(panelEl);
        if (this.activePlugin === 'notion') this._renderNotion(panelEl);
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

    _renderFlomo(containerEl) {
        this._addEnabledToggle(containerEl, 'flomo', 'Flomo');
        if (!this.plugin.isAdapterEnabled('flomo')) return;
        new Setting(containerEl).setName('Flomo API Webhook').setDesc('在 flomo 网页版“API”页面获取').addText(text => {
            text.inputEl.type = 'password';
            text.setPlaceholder('https://flomoapp.com/iwh/...').setValue(this.plugin.getAdapterConfig('flomo')?.apiUrl || '').onChange(async value => {
                await this.plugin.setAdapterConfig('flomo', { apiUrl: value.trim() });
            });
        });
    }

    _renderTelegram(containerEl) {
        this._addEnabledToggle(containerEl, 'telegram', 'Telegram');
        if (!this.plugin.isAdapterEnabled('telegram')) return;
        const tgConfig = this.plugin.getAdapterConfig('telegram') || {};
        new Setting(containerEl).setName('Bot Token').setDesc('从 @BotFather 获取').addText(text => {
            text.inputEl.type = 'password';
            text.setPlaceholder('123456789:ABCdef...').setValue(tgConfig.botToken || '').onChange(async value => {
                await this.plugin.setAdapterConfig('telegram', { ...this.plugin.getAdapterConfig('telegram'), botToken: value.trim() });
            });
        });

        new Setting(containerEl).setName('频道列表').setDesc(this._buildChannelDesc(tgConfig)).addButton(btn => btn
            .setButtonText('获取频道列表').onClick(async () => {
                try {
                    btn.setButtonText('获取中...');
                    btn.disabled = true;
                    const result = await this.plugin.adapterRegistry.get('telegram').runAction('discoverChannels', this.plugin.getAdapterConfig('telegram'), this.plugin.requestUrl.bind(this.plugin));
                    const channels = result.data?.channels || [];
                    const config = this.plugin.getAdapterConfig('telegram') || {};
                    await this.plugin.setAdapterConfig('telegram', { ...config, channels, homeChannels: channels.map(channel => String(channel.id)) });
                    new Notice(result.message || '获取成功');
                    this.display();
                } catch (error) {
                    new Notice(`获取频道失败：${error.message}`);
                } finally {
                    btn.setButtonText('获取频道列表');
                    btn.disabled = false;
                }
            }));

        this._renderChannelSelection(containerEl, tgConfig);
        new Setting(containerEl).setName('普通发送时显示网址预览').setDesc('仅普通文本发送时生效。关闭后，消息中的网址不会展开预览卡片。').addToggle(toggle => toggle
            .setValue(tgConfig.showLinkPreview !== false).onChange(async value => {
                await this.plugin.setAdapterConfig('telegram', { ...this.plugin.getAdapterConfig('telegram'), showLinkPreview: value });
            }));

        new Setting(containerEl)
            .setName('启用富文本发送')
            .setDesc('开启后使用 Telegram 原生媒体上传发送图文混排内容。关闭后以普通附件方式发送图片。')
            .addToggle(toggle => toggle.setValue(tgConfig.richTextEnabled !== false).onChange(async value => {
                const config = this.plugin.getAdapterConfig('telegram') || {};
                await this.plugin.setAdapterConfig('telegram', { ...config, richTextEnabled: value });
            }));
    }

    _renderChannelSelection(containerEl, tgConfig) {
        const channels = Array.isArray(tgConfig.channels) ? tgConfig.channels : [];
        if (channels.length === 0) return;
        const groupEl = containerEl.createDiv({ cls: 'js-bridge-channel-group' });
        groupEl.createEl('p', { text: '默认发送频道：', cls: 'js-bridge-channel-group-label' });
        const homeChannels = Array.isArray(tgConfig.homeChannels) ? tgConfig.homeChannels.map(String) : [];
        for (const channel of channels) {
            const channelId = String(channel.id);
            const row = groupEl.createDiv({ cls: 'js-bridge-channel-row' });
            const checkbox = row.createEl('input', { type: 'checkbox', attr: { id: `tg-ch-${channelId}` } });
            checkbox.checked = homeChannels.includes(channelId);
            row.createEl('label', { text: `${channel.title || channelId}${channel.username ? ` (${channel.username})` : ''}`, attr: { for: `tg-ch-${channelId}` } });
            checkbox.addEventListener('change', async () => {
                const config = this.plugin.getAdapterConfig('telegram') || {};
                const selected = Array.isArray(config.homeChannels) ? config.homeChannels.map(String) : [];
                const index = selected.indexOf(channelId);
                if (checkbox.checked && index < 0) selected.push(channelId);
                if (!checkbox.checked && index >= 0) selected.splice(index, 1);
                await this.plugin.setAdapterConfig('telegram', { ...config, homeChannels: selected });
            });
        }
    }

    _renderMastodon(containerEl) {
        this._addEnabledToggle(containerEl, 'mastodon', 'Mastodon');
        if (!this.plugin.isAdapterEnabled('mastodon')) return;
        const config = this.plugin.getAdapterConfig('mastodon') || {};
        new Setting(containerEl).setName('实例地址').setDesc('例如 https://mastodon.social').addText(text => text.setPlaceholder('https://mastodon.social').setValue(config.serverUrl || '').onChange(async value => this.plugin.setAdapterConfig('mastodon', { ...config, serverUrl: value.trim() })));
        new Setting(containerEl).setName('Access Token').addText(text => { text.inputEl.type = 'password'; text.setPlaceholder('你的 Mastodon Access Token').setValue(config.accessToken || '').onChange(async value => this.plugin.setAdapterConfig('mastodon', { ...config, accessToken: value.trim() })); });
        new Setting(containerEl).setName('可见性').addDropdown(dropdown => dropdown.addOption('public', '公开').addOption('unlisted', '不列出').addOption('private', '仅关注者').setValue(config.visibility || 'public').onChange(async value => this.plugin.setAdapterConfig('mastodon', { ...config, visibility: value })));
    }

    _renderMisskey(containerEl) {
        this._addEnabledToggle(containerEl, 'missky', 'Misskey');
        if (!this.plugin.isAdapterEnabled('missky')) return;
        const config = this.plugin.getAdapterConfig('missky') || {};
        new Setting(containerEl).setName('实例地址').setDesc('例如 https://misskey.io').addText(text => text.setPlaceholder('https://misskey.io').setValue(config.serverUrl || '').onChange(async value => this.plugin.setAdapterConfig('missky', { ...config, serverUrl: value.trim() })));
        new Setting(containerEl).setName('API Token').addText(text => { text.inputEl.type = 'password'; text.setPlaceholder('你的 Misskey API Token').setValue(config.apiToken || '').onChange(async value => this.plugin.setAdapterConfig('missky', { ...config, apiToken: value.trim() })); });
        new Setting(containerEl).setName('可见性').addDropdown(dropdown => dropdown.addOption('public', '公开').addOption('home', '主页').addOption('followers', '仅关注者').setValue(config.visibility || 'public').onChange(async value => this.plugin.setAdapterConfig('missky', { ...config, visibility: value })));
    }

    _renderNotion(containerEl) {
        this._addEnabledToggle(containerEl, 'notion', 'Notion');
        if (!this.plugin.isAdapterEnabled('notion')) return;
        const config = this.plugin.getAdapterConfig('notion') || {};

        new Setting(containerEl)
            .setName('Notion Token')
            .setDesc('使用 Notion Personal Access Token，仅保存在 Obsidian 插件设置中。')
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('ntn_...').setValue(config.token || '').onChange(async value => {
                    await this.plugin.setAdapterConfig('notion', { ...this.plugin.getAdapterConfig('notion'), token: value.trim() });
                });
            });

        new Setting(containerEl)
            .setName('保存目标')
            .setDesc('选择每次发送创建 Notion 页面，或在 Data Source 中创建一条记录页面。')
            .addDropdown(dropdown => dropdown
                .addOption('page', '保存为页面')
                .addOption('database', '保存到数据库')
                .setValue(config.targetType || 'page')
                .onChange(async value => {
                    await this.plugin.setAdapterConfig('notion', { ...this.plugin.getAdapterConfig('notion'), targetType: value });
                    this.display();
                }));

        if ((config.targetType || 'page') === 'page') {
            new Setting(containerEl)
                .setName('日记父页面 Page ID')
                .setDesc('创建子页面或每日页面的 Notion 父页面 ID。请先将该页面连接到你的 Notion Integration。')
                .addText(text => text.setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx').setValue(config.pageId || '').onChange(async value => {
                    await this.plugin.setAdapterConfig('notion', { ...this.plugin.getAdapterConfig('notion'), pageId: value.trim() });
                }));
            new Setting(containerEl)
                .setName('页面写入方式')
                .setDesc('新建子页面会为每次发送创建一个页面；每日追加会查找或创建当天 YYYY-MM-DD 页面并持续追加内容。')
                .addDropdown(dropdown => dropdown
                    .addOption('new_page', '每次新建子页面')
                    .addOption('daily_append', '追加到每日日记页面')
                    .setValue(config.pageWriteMode || 'new_page')
                    .onChange(async value => {
                        await this.plugin.setAdapterConfig('notion', { ...this.plugin.getAdapterConfig('notion'), pageWriteMode: value });
                        this.display();
                    }));
            if ((config.pageWriteMode || 'new_page') === 'new_page') {
                new Setting(containerEl)
                    .setName('页面标题来源')
                    .setDesc('按发送范围标题：标题块用该标题，整页用文件名，选中文本允许无标题。正文首标题：从正文第一个 Markdown 标题取名。无标题：不设置标题。')
                    .addDropdown(dropdown => dropdown
                        .addOption('scope', '按发送范围标题')
                        .addOption('first_heading', '按正文第一个标题')
                        .addOption('none', '无标题')
                        .setValue(config.titleSource || 'scope')
                        .onChange(async value => this.plugin.setAdapterConfig('notion', { ...this.plugin.getAdapterConfig('notion'), titleSource: value })));
            }
        } else {
            new Setting(containerEl)
                .setName('Data Source ID')
                .setDesc('目标 Notion Data Source 的 ID，而不是旧版教程中的 database ID。')
                .addText(text => text.setPlaceholder('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx').setValue(config.dataSourceId || '').onChange(async value => {
                    await this.plugin.setAdapterConfig('notion', { ...this.plugin.getAdapterConfig('notion'), dataSourceId: value.trim() });
                }));
            new Setting(containerEl)
                .setName('读取标题字段')
                .setDesc(config.titleProperty ? `当前标题字段：${config.titleProperty}` : '读取 Data Source 后选择 title 类型字段。')
                .addButton(button => button.setButtonText('读取字段').onClick(async () => {
                    try {
                        button.setButtonText('读取中...');
                        button.disabled = true;
                        const adapter = this.plugin.adapterRegistry.get('notion');
                        const result = await adapter.retrieveDataSource({ config: this.plugin.getAdapterConfig('notion'), requestUrl: this.plugin.requestUrl.bind(this.plugin) });
                        if (result.titles.length === 0) throw new Error('该 Data Source 没有 title 类型字段');
                        const activeConfig = this.plugin.getAdapterConfig('notion');
                        const selected = result.titles.includes(activeConfig.titleProperty) ? activeConfig.titleProperty : result.titles[0];
                        await this.plugin.setAdapterConfig('notion', { ...activeConfig, titleProperty: selected, titleProperties: result.titles });
                        new Notice(`已读取 ${result.titles.length} 个标题字段`);
                        this.display();
                    } catch (error) {
                        new Notice(`读取 Notion 字段失败：${error.message}`);
                    } finally {
                        button.setButtonText('读取字段');
                        button.disabled = false;
                    }
                }));
            const titleProperties = Array.isArray(config.titleProperties) ? config.titleProperties : [];
            if (titleProperties.length > 0) {
                new Setting(containerEl)
                    .setName('数据库标题字段')
                    .setDesc('每条数据库记录均会创建一个完整页面，正文和图片写入该页面的 blocks。')
                    .addDropdown(dropdown => {
                        for (const property of titleProperties) dropdown.addOption(property, property);
                        dropdown.setValue(config.titleProperty || titleProperties[0]).onChange(async value => {
                            await this.plugin.setAdapterConfig('notion', { ...this.plugin.getAdapterConfig('notion'), titleProperty: value });
                        });
                    });
            }
            new Setting(containerEl)
                .setName('页面标题来源')
                .setDesc('标题块使用该标题，整页使用文件名，选中文本允许无标题。')
                .addDropdown(dropdown => dropdown
                    .addOption('scope', '按发送范围标题')
                    .addOption('first_heading', '按正文第一个标题')
                    .addOption('none', '无标题')
                    .setValue(config.titleSource || 'scope')
                    .onChange(async value => this.plugin.setAdapterConfig('notion', { ...this.plugin.getAdapterConfig('notion'), titleSource: value })));
        }

        new Setting(containerEl)
            .setName('超过 5 MB 时自动压缩图片')
            .setDesc('发送前在内存中将可处理的 JPEG、PNG、WebP 压缩为 WebP，不会修改 Vault 原文件。GIF 和 SVG 不压缩。')
            .addToggle(toggle => toggle.setValue(Boolean(config.autoCompressLargeImages)).onChange(async value => {
                await this.plugin.setAdapterConfig('notion', { ...this.plugin.getAdapterConfig('notion'), autoCompressLargeImages: value });
            }));
    }

    _headingLevelLabel(level) {
        const names = ['一', '二', '三', '四', '五', '六'];
        const n = Math.min(6, Math.max(1, Number(level) || 1));
        return `${names[n - 1]}级标题`;
    }

    _buildChannelDesc(tgConfig) {
        const channels = Array.isArray(tgConfig?.channels) ? tgConfig.channels : [];
        if (channels.length === 0) return '尚未获取频道列表，请点击右侧按钮获取';
        return `已发现 ${channels.length} 个频道：${channels.map(channel => channel.title || channel.id).join('、')}`;
    }
}

module.exports = JournalSyncSettingTab;
