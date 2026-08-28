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
                    // Clamp telegraphTitleLevel to the new sendScope
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

        new Setting(containerEl)
            .setName('启用富文本发送')
            .setDesc('开启后使用 Telegram 原生媒体上传发送图文混排内容。关闭后以普通附件方式发送图片。')
            .addToggle(toggle => toggle.setValue(tgConfig.richTextEnabled !== false).onChange(async value => {
                const config = this.plugin.getAdapterConfig('telegram') || {};
                await this.plugin.setAdapterConfig('telegram', { ...config, richTextEnabled: value });
            }));

        // ── Telegraph 设置 ──────────────────────
        new Setting(containerEl)
            .setName('Telegraph 作者名')
            .setDesc('显示在 Telegraph 页面上的作者名称，可留空。')
            .addText(text => {
                text.setPlaceholder('Journal Sync').setValue(tgConfig.telegraphAuthorName || '').onChange(async value => {
                    await this.plugin.setAdapterConfig('telegram', { ...this.plugin.getAdapterConfig('telegram'), telegraphAuthorName: value.trim() });
                });
            });

        const sendScope = this.plugin.settings.sendScope || 2;
        const maxTitleLevel = sendScope === 0 ? 6 : Math.min(6, sendScope);
        const titleLevelDesc = maxTitleLevel === 1
            ? '当前发送层级为 1，仅可使用一级标题作为 Telegraph 标题。'
            : `选择哪一级标题作为 Telegraph 页面标题（1-${maxTitleLevel}）。正文中的标题会相应偏移。绑定发送层级（当前: ${sendScope === 0 ? '整页' : sendScope}）。`;

        new Setting(containerEl)
            .setName('Telegraph 标题层级')
            .setDesc(titleLevelDesc)
            .addDropdown(dropdown => {
                const currentLevel = tgConfig.telegraphTitleLevel || 1;
                for (let lv = 1; lv <= maxTitleLevel; lv++) {
                    dropdown.addOption(String(lv), `H${lv}`);
                }
                dropdown.setValue(String(Math.min(currentLevel, maxTitleLevel))).onChange(async value => {
                    await this.plugin.setAdapterConfig('telegram', { ...this.plugin.getAdapterConfig('telegram'), telegraphTitleLevel: Number(value) });
                });
            });

        new Setting(containerEl)
            .setName('Telegraph 账号')
            .setDesc(tgConfig.telegraphAccessToken
                ? '已连接。可验证新 token、创建新账号或复制当前 token。'
                : '输入已有 Telegraph token，或点击"创建新账号"获取。首次发送时也会自动创建。')
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('输入 Telegraph access_token');
                text.setValue(tgConfig.telegraphAccessToken || '');
                this._telegraphTokenInput = text.inputEl;
            })
            .addButton(btn => btn
                .setButtonText('验证并保存')
                .onClick(async () => {
                    const token = (this._telegraphTokenInput?.value || '').trim();
                    if (!token) {
                        new Notice('请先输入 token');
                        return;
                    }
                    try {
                        btn.setButtonText('验证中...');
                        btn.disabled = true;
                        const telegraph = require('../core/telegraph');
                        await telegraph.getAccountInfo(token, this.plugin.requestUrl.bind(this.plugin));
                        await this.plugin.setAdapterConfig('telegram', { ...this.plugin.getAdapterConfig('telegram'), telegraphAccessToken: token });
                        new Notice('Telegraph token 验证成功');
                        this.display();
                    } catch (error) {
                        new Notice(`Token 验证失败: ${error.message}`);
                    } finally {
                        btn.setButtonText('验证并保存');
                        btn.disabled = false;
                    }
                }))
            .addButton(btn => btn
                .setButtonText('创建新账号')
                .onClick(async () => {
                    if (tgConfig.telegraphAccessToken) {
                        if (!confirm('已有账号连接，创建新账号后将无法用新 token 编辑旧页面。确定继续？')) return;
                    }
                    try {
                        btn.setButtonText('创建中...');
                        btn.disabled = true;
                        const telegraph = require('../core/telegraph');
                        const authorName = this.plugin.getAdapterConfig('telegram')?.telegraphAuthorName || '';
                        const account = await telegraph.createAccount('JournalSync', authorName, this.plugin.requestUrl.bind(this.plugin));
                        await this.plugin.setAdapterConfig('telegram', { ...this.plugin.getAdapterConfig('telegram'), telegraphAccessToken: account.access_token });
                        new Notice('Telegraph 账号创建成功');
                        this.display();
                    } catch (error) {
                        new Notice(`Telegraph 账号创建失败: ${error.message}`);
                    } finally {
                        btn.setButtonText('创建新账号');
                        btn.disabled = false;
                    }
                }))
            .addButton(btn => btn
                .setButtonText('复制 token')
                .setDisabled(!tgConfig.telegraphAccessToken)
                .onClick(() => {
                    const token = this.plugin.getAdapterConfig('telegram')?.telegraphAccessToken || '';
                    if (!token) {
                        new Notice('暂无 token 可复制');
                        return;
                    }
                    navigator.clipboard.writeText(token).then(() => {
                        new Notice('Token 已复制到剪贴板');
                    }).catch(() => {
                        new Notice('复制失败，请手动复制');
                    });
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

        const accounts = this.plugin.getMastodonAccounts();

        // 逐账号卡片
        for (let i = 0; i < accounts.length; i++) {
            const acct = accounts[i];
            this._renderMastodonAccountCard(containerEl, acct, i);
        }

        // 添加账号按钮
        new Setting(containerEl)
            .setName('添加账号')
            .setDesc('添加一个新的 Mastodon 实例账号')
            .addButton(btn => btn
                .setButtonText('+ 添加')
                .onClick(async () => {
                    const newAcct = {
                        id: `mstd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        label: '',
                        serverUrl: '',
                        accessToken: '',
                        visibility: 'public'
                    };
                    const freshConfig = this.plugin.getAdapterConfig('mastodon') || {};
                    const freshAccounts = this.plugin.getMastodonAccounts();
                    const updated = [...freshAccounts, newAcct];
                    await this.plugin.setAdapterConfig('mastodon', { ...freshConfig, accounts: updated });
                    this.display();
                }));
    }
    _renderMastodonAccountCard(containerEl, acct, index) {
        const mstdConfig = this.plugin.getAdapterConfig('mastodon') || {};
        const accounts = this.plugin.getMastodonAccounts();
        const cardEl = containerEl.createDiv({ cls: 'js-bridge-mstd-card' });

        // 卡片标题行
        const headerEl = cardEl.createDiv({ cls: 'js-bridge-mstd-card-header' });
        const titleText = acct.label || acct.serverUrl || `账号 ${index + 1}`;
        headerEl.createEl('span', { text: titleText, cls: 'js-bridge-mstd-card-title' });
        headerEl.createEl('span', { text: acct.serverUrl || '未配置', cls: 'js-bridge-mstd-card-url' });

        // 删除按钮
        const deleteBtn = headerEl.createEl('button', {
            type: 'button',
            text: '删除',
            cls: 'js-bridge-mstd-card-delete'
        });
        deleteBtn.addEventListener('click', async () => {
            if (!confirm(`确定删除账号「${titleText}」？`)) return;
            // 读取最新数据，避免闭包捕获过期快照导致编辑后删除其他账号时数据回退
            const freshConfig = this.plugin.getAdapterConfig('mastodon') || {};
            const freshAccounts = this.plugin.getMastodonAccounts();
            const updated = freshAccounts.filter(a => a.id !== acct.id);
            await this.plugin.setAdapterConfig('mastodon', { ...freshConfig, accounts: updated });
            // 清理预设中已删除账号的引用，避免 data.json 无限累积
            this._cleanupMastodonPresets(acct.id);
            this.display();
        });

        // 字段：显示名称
        new Setting(cardEl)
            .setName('显示名称')
            .setDesc('在发送面板中显示的文字，如「主账号」「长毛象」')
            .addText(text => text
                .setPlaceholder('主账号')
                .setValue(acct.label || '')
                .onChange(async value => {
                    this._updateMastodonAccount(acct.id, { label: value.trim() });
                }));

        // 字段：实例地址
        new Setting(cardEl)
            .setName('实例地址')
            .setDesc('例如 https://mastodon.social')
            .addText(text => text
                .setPlaceholder('https://mastodon.social')
                .setValue(acct.serverUrl || '')
                .onChange(async value => {
                    this._updateMastodonAccount(acct.id, { serverUrl: value.trim() });
                }));

        // 字段：Access Token
        new Setting(cardEl)
            .setName('Access Token')
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('你的 Mastodon Access Token')
                    .setValue(acct.accessToken || '')
                    .onChange(async value => {
                        this._updateMastodonAccount(acct.id, { accessToken: value.trim() });
                    });
            });

        // 字段：可见性
        new Setting(cardEl)
            .setName('可见性')
            .addDropdown(dropdown => dropdown
                .addOption('public', '公开')
                .addOption('unlisted', '不列出')
                .addOption('private', '仅关注者')
                .addOption('direct', '私信')
                .setValue(acct.visibility || 'public')
                .onChange(async value => {
                    this._updateMastodonAccount(acct.id, { visibility: value });
                }));
    }

    async _updateMastodonAccount(accountId, patch) {
        const mstdConfig = this.plugin.getAdapterConfig('mastodon') || {};
        const accounts = this.plugin.getMastodonAccounts();
        const updated = accounts.map(a => a.id === accountId ? { ...a, ...patch } : a);
        await this.plugin.setAdapterConfig('mastodon', { ...mstdConfig, accounts: updated });
    }

    /**
     * 删除账号后清理预设中残留的 mastodon-account:<accountId> 引用，
     * 避免 data.json 无限累积已删除账号的条目。
     */
    _cleanupMastodonPresets(accountId) {
        const presets = this.plugin.settings.publishPresets;
        if (!Array.isArray(presets) || presets.length === 0) return;
        const staleKey = `mastodon-account:${accountId}`;
        let changed = false;
        for (const preset of presets) {
            if (!Array.isArray(preset.items)) continue;
            const before = preset.items.length;
            preset.items = preset.items.filter(item => item.id !== staleKey);
            if (preset.items.length !== before) changed = true;
        }
        if (changed) {
            this.plugin.settings.publishPresets = presets;
            this.plugin.saveSettings();
        }
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
