/**
 * Journal Sync Plugin - Main Entry
 *
 * 架构说明：
 * - src/main.js         本文件：插件主类，负责生命周期与命令注册
 * - src/core/           核心模块（内容渲染、适配器注册表）
 * - src/adapters/       各平台发送适配器（flomo / telegram / mastodon / missky / notion / bluesky / weibo / threads）
 * - src/ui/             UI 组件（Send Modal、Settings Tab）；设置页为 manifest 驱动（通用 schema 渲染 + 适配器可选 renderSettings 自定义面板）
 *
 * 构建方式：npm run build → 打包为 main.js
 */

const {
  Plugin,
  Notice,
  MarkdownView,
  requestUrl
} = require('obsidian');

const AdapterRegistry     = require('./core/adapter-registry');
const sendLog             = require('./core/send-log');
const JournalSyncSendModal = require('./ui/send-modal');
const JournalSyncSettingTab = require('./ui/settings-tab');
const JournalSyncLogModal  = require('./ui/log-modal');
// 纯逻辑工具（从本文件拆出，便于复用与单元测试）
const {
    formatDate,
    buildDiaryFilename,
    buildDiaryHeading
} = require('./core/diary');
const {
    normalizeVaultPath,
    joinVaultPath,
    dirnameVaultPath,
    isImagePath,
    isRemoteUrl,
    isDataUrl
} = require('./core/vault-path');
const { parseImageRefs } = require('./core/image-refs');
const { getSelectedOrBlockContent } = require('./core/content');
const { t, setLanguage, registerTranslations } = require('./core/i18n');
const { deepMergeSettings, resolveInitialDiaryDefaults } = require('./core/settings');
const { buildRichDraftFromUploadedMarkdown } = require('./core/rich-draft');

// 本文件用户可见文案的英文翻译（ribbon 提示、命令 Notice、图片读取错误）
registerTranslations('en', {
  'Journal Sync: 新建日记记录': 'Journal Sync: New journal entry',
  'YYYY-MM-DD 日记': 'YYYY-MM-DD Journal',
  '读取失败': 'Failed to read',
  'Vault 中未找到该文件': 'File not found in the vault',
  '已创建 Journal Sync 日记记录块。': 'Created the Journal Sync journal entry.',
  '请先打开或选中一份笔记': 'Please open or select a note first',
  '没有可发送的内容：请先选中文本，或将光标置于所选级别的标题下。': 'Nothing to send. Please select some text or place the cursor under a heading of the chosen level.',
  '部分图片无法读取（{count} 处），本次发送将跳过{suffix}': 'Some images could not be read ({count} spot(s)); this send will skip them{suffix}',
  '图片读取失败后没有剩余可发送内容。': 'No sendable content left after failed image reads.',
  '日志快照已失效': 'The log snapshot is no longer valid',
  '：{names}': ': {names}',
  '、': ', ',
  ' 等': ' ...'
});

// 适配器（各自独立，按需 require）；数组顺序即注册顺序：flomo、telegram、mastodon、missky、notion、bluesky、weibo、threads
const ADAPTER_MODULES = [
  require('./adapters/flomo'),
  require('./adapters/telegram'),
  require('./adapters/mastodon'),
  require('./adapters/missky'),
  require('./adapters/notion'),
  require('./adapters/bluesky'),
  require('./adapters/weibo'),
  require('./adapters/threads')
];

// ──────────────────────────────────────────────
// 默认设置（已迁移用户原 Journal Sync 所有配置）
const DEFAULT_SETTINGS = {
  // 界面语言：'auto' = 跟随 Obsidian 应用语言；'zh' / 'en' = 手动指定
  uiLanguage: 'auto',
  diaryPath: '日记',
  filenameRule: 'YYYY-MM-DD 日记',
  autoUploadImages: true,
  // 发送范围：未选中文本时发送的内容范围（0 = 整个页面，1-6 = 对应级别标题下的内容，不含标题本身）
  sendScope: 2,
  // 新建日记标题设置
  diaryTimestampLevel: 2,       // 新建标题级别（1-6）
  diaryHeadingRule: 'HH:MM:SS', // 新建标题格式（H=时、M=分、S=秒 占位符）
  // 发布预设分组：不内置任何用户特定数据（频道 ID 等均存于 data.json），
  // 首次使用时由发送面板根据用户选择自动创建
  publishPresets: [],
  activePresetId: ''
};

/**
 * 由适配器注册表派生各平台默认设置，并与 DEFAULT_SETTINGS 组成完整默认值：
 * - adaptersEnabled[id] = manifest.enabledByDefault === true
 * - adaptersConfig[id]  = manifest.settings.fields 中所有带 default 字段的默认值，
 *                         再被 adapter.defaultConfig 覆盖（适配器导出的 defaultConfig 优先）。
 * 注意：必须在适配器注册完成后调用（onload 中先建 registry 再合并设置）。
 */
function buildDefaultSettings(registry) {
  const adaptersEnabled = {};
  const adaptersConfig = {};
  for (const adapter of registry.getAll()) {
    const id = adapter?.manifest?.id;
    if (!id) continue;
    adaptersEnabled[id] = adapter.manifest.enabledByDefault === true;

    const fieldDefaults = {};
    const fields = Array.isArray(adapter.manifest?.settings?.fields)
      ? adapter.manifest.settings.fields
      : [];
    for (const field of fields) {
      if (field && field.key && field.default !== undefined) {
        fieldDefaults[field.key] = field.default;
      }
    }

    adaptersConfig[id] = { ...fieldDefaults, ...(adapter.defaultConfig || {}) };
  }
  return { ...DEFAULT_SETTINGS, adaptersEnabled, adaptersConfig };
}

// ──────────────────────────────────────────────
// 主插件类
// ──────────────────────────────────────────────

class JournalSyncPlugin extends Plugin {
  async onload() {
    // 加载用户已保存的数据
    const loadedData = (await this.loadData()) || {};
    const loadedSnapshot = JSON.stringify(loadedData);

    // 初始化适配器注册表。必须先于默认设置合并：
    // adaptersEnabled / adaptersConfig 的默认值要从各适配器 manifest 派生。
    this.adapterRegistry = new AdapterRegistry();
    for (const adapter of ADAPTER_MODULES) {
      this.adapterRegistry.register(adapter);
    }

    // 深度合并默认迁移设置（老用户 data.json 的已有值不受影响），再解析界面语言
    const effectiveLang = this._resolveEffectiveLanguage(loadedData.uiLanguage || 'auto');
    const baseDefaults = {
      ...buildDefaultSettings(this.adapterRegistry),
      ...resolveInitialDiaryDefaults(loadedData, effectiveLang)
    };
    this.settings = deepMergeSettings(loadedData, baseDefaults);
    // 解析界面语言：'auto' 跟随 Obsidian 应用语言，否则用用户指定值
    this._applyLanguage();
    // 迁移 Mastodon 单账号旧格式 → accounts 数组
    this._migrateMastodonAccounts();
    // 仅在合并或迁移真正改写了设置时落盘，避免每次启动无故重写 data.json
    if (JSON.stringify(this.settings) !== loadedSnapshot) {
      await this.saveSettings();
    }

    this.ribbonIconEl = this.addRibbonIcon('pencil', t('Journal Sync: 新建日记记录'), () => this.createTodayDiaryEntry());

    // 命令：新建日记
    this.addCommand({
      id: 'journal-sync-new',
      name: 'JournalSync-New',
      callback: () => this.createTodayDiaryEntry()
    });
    // 命令：发送（Send）
    this.addCommand({
      id: 'journal-sync-send',
      name: 'JournalSync-Send',
      editorCallback: (editor, view) => this.sendCurrentContent(editor, view)
    });

    // 命令：打开发送日志（最近 10 条快照，可重新编辑）
    this.addCommand({
      id: 'journal-sync-log',
      name: 'JournalSync-Log',
      callback: () => { new JournalSyncLogModal(this.app, this).open(); }
    });

    // 注册设置面板
    this.addSettingTab(new JournalSyncSettingTab(this.app, this));
  }

  async onunload() {}

  async saveSettings() {
    await this.saveData(this.settings);
  }


  /**
   * 解析界面语言并注入 i18n 引擎。
   * 'auto' 跟随 Obsidian 应用语言（getLanguage() 返回 ISO 码，如 'zh'/'en'）；
   * 否则使用用户手动指定的 'zh' / 'en'。
   * 语言变更后的 UI 刷新：settings-tab 语言下拉 onChange 调用本方法后自行重渲染设置页；
   * ribbon 悬浮提示在 onload 求值一次，由本方法在语言变化时直接刷新。
   */
  _resolveEffectiveLanguage(choice = 'auto') {
    if (choice === 'zh' || choice === 'en') return choice;
    try {
      const appLang = (this.app?.getLanguage?.() || '').toLowerCase();
      return appLang.startsWith('zh') ? 'zh' : 'en';
    } catch (e) {
      return 'en';
    }
  }

  _applyLanguage() {
    const lang = this._resolveEffectiveLanguage(this.settings?.uiLanguage || 'auto');
    setLanguage(lang);
    // ribbon 提示在 onload 求值一次，语言切换后在此刷新（Obsidian 用 aria-label 显示悬浮提示）
    if (this.ribbonIconEl) {
      this.ribbonIconEl.setAttribute('aria-label', t('Journal Sync: 新建日记记录'));
    }
  }

  // ── 适配器管理 ──────────────────────────────

  isAdapterEnabled(id) {
    return Boolean(this.settings.adaptersEnabled?.[id]);
  }

  setAdapterEnabled(id, enabled) {
    if (!this.settings.adaptersEnabled) this.settings.adaptersEnabled = {};
    this.settings.adaptersEnabled[id] = enabled;
  }

  getAdapterConfig(id) {
    return this.settings.adaptersConfig?.[id] || {};
  }

  async setAdapterConfig(id, config) {
    if (!this.settings.adaptersConfig) this.settings.adaptersConfig = {};
    this.settings.adaptersConfig[id] = config;
    await this.saveSettings();
  }
  // ┌──────────────────────────────────────────────────────────────────┐
  // │ TEMPORARY MIGRATION CODE — Mastodon 单账号 → 多账号格式迁移       │
  // │ 计划在 5–6 个版本后删除此方法及其调用。                           │
  // │ 如果届时所有用户已完成迁移，可安全移除。                           │
  // └──────────────────────────────────────────────────────────────────┘
  /**
   * 迁移 Mastodon 单账号旧格式 { serverUrl, accessToken, visibility } → accounts 数组。
   * deepMergeSettings 会先用 DEFAULT_SETTINGS 注入 accounts:[]，所以不能靠
   * Array.isArray(mstd.accounts) 判断是否需要迁移——那样守卫永远命中、迁移被跳过。
   * 改为检测旧字段是否存在：只要旧字段还在且 accounts 为空，就执行迁移。
   */
  _migrateMastodonAccounts() {
    const mstd = this.settings.adaptersConfig?.mastodon;
    if (!mstd) return;
    // 检测旧字段是否存在而非依赖 accounts 是否为数组
    if ((mstd.serverUrl || mstd.accessToken) && (!Array.isArray(mstd.accounts) || mstd.accounts.length === 0)) {
      const { serverUrl, accessToken, visibility } = mstd;
      const label = serverUrl ? serverUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '') : 'Mastodon';
      mstd.accounts = [{
        id: `mstd-${Date.now()}-migrate`,
        label,
        serverUrl: serverUrl || '',
        accessToken: accessToken || '',
        visibility: visibility || 'public'
      }];
      delete mstd.serverUrl;
      delete mstd.accessToken;
      delete mstd.visibility;
    }
    if (!Array.isArray(mstd.accounts)) mstd.accounts = [];
  }
  getMastodonAccounts() {
    const mstd = this.settings.adaptersConfig?.mastodon;
    return Array.isArray(mstd?.accounts) ? mstd.accounts : [];
  }

  getMastodonAccount(accountId) {
    return this.getMastodonAccounts().find(a => a.id === accountId) || null;
  }

  /**
   * 从 Vault 读取图片为 ArrayBuffer
   * @param {string} filename - 图片文件名或 vault 路径
   * @param {TFile} [contextFile] - 当前笔记文件（用于相对路径解析）
   */
  async readImageFromVault(filename, contextFile) {
    const file = await this._resolveImageFile(filename, contextFile);
    if (!file) return null;
    return await this.app.vault.readBinary(file);
  }

  async _resolveImageFile(target, contextFile) {
    const cleaned = normalizeVaultPath(String(target||'').split('|')[0]);
    const dir = contextFile ? dirnameVaultPath(contextFile.path) : '';
    const candidates = [];
    if (dir) candidates.push(joinVaultPath(dir, cleaned));
    candidates.push(cleaned);

    for (const c of candidates) {
      const f = this.app.vault.getAbstractFileByPath(c);
      if (f && !f.children) return f;
    }

    const linked = this.app.metadataCache.getFirstLinkpathDest(cleaned, contextFile?.path || '');
    if (linked && !linked.children) return linked;

    return null;
  }

  /**
   * 收集正文中的本地图片引用，返回文件名列表与富文本草稿。
   * 注意：本函数不执行任何上传（无后端服务），仅解析图片引用位置。
   */
  async processImagesFromMarkdown(markdown, currentFile, extraRefs = []) {
    const refs = [...parseImageRefs(markdown), ...extraRefs];
    const uploadedByPath = new Map();
    const failed = [];
    const uploadedRefs = [];
    const failedRefs = [];

    for (const ref of refs) {
      if (!isImagePath(ref.target) || isRemoteUrl(ref.target) || isDataUrl(ref.target)) continue;
      let file = null;
      try {
        file = await this._resolveImageFile(ref.target, currentFile);
      } catch (error) {
        failed.push({
          target: ref.target,
          raw: ref.raw,
          reason: error?.message || t('读取失败')
        });
        failedRefs.push(ref);
        continue;
      }
      if (!file) {
        failed.push({ target: ref.target, raw: ref.raw, reason: t('Vault 中未找到该文件') });
        failedRefs.push(ref);
        continue;
      }

      if (!uploadedByPath.has(file.path)) {
        // 保留 Vault 相对路径，避免同名图片在回读时被错误解析。
        uploadedByPath.set(file.path, { filename: file.name, vaultPath: file.path });
      }
      uploadedRefs.push(Object.assign({}, ref, uploadedByPath.get(file.path)));
    }

    // 将成功解析的图片引用替换为 @图片1、@图片2 等 Token，失败的引用移除。
    // 基于位置而非字符串匹配，同一张图出现多次时每一处都能正确替换。
    const sortedRefs = [...uploadedRefs, ...failedRefs].sort((a, b) => a.index - b.index);
    let content = '';
    let cursor = 0;
    let imageIndex = 0;
    sortedRefs.forEach(ref => {
      if (ref.index < cursor) return;
      content += markdown.slice(cursor, ref.index);
      if (uploadedRefs.includes(ref)) {
        imageIndex += 1;
        content += `@图片${imageIndex}`;
      }
      cursor = ref.end;
    });
    content += markdown.slice(cursor);

    return {
      content: content.trim(),
      richDraft: buildRichDraftFromUploadedMarkdown(markdown, uploadedRefs),
      failed
    };
  }

  // ── 执行适配器 ──────────────────────────────

  /**
   * 执行单个适配器的发送（统一接口）
   * @param {string} adapterId
   * @param {object} payload - 统一 payload { content, plainText, title, attachments, readAttachment }
   * @param {object} [extraConfig] - 单次执行的配置覆盖，不写入持久化设置
   */
  async executeAdapter(adapterId, payload, extraConfig = {}) {
    const adapter = this.adapterRegistry.get(adapterId);
    if (!adapter) return { success: false, error: t('适配器不存在') };

    const config = { ...this.getAdapterConfig(adapterId), ...extraConfig };
    const saveConfig = async (patch = {}) => this.setAdapterConfig(adapterId, {
      ...this.getAdapterConfig(adapterId),
      ...patch
    });

    return adapter.execute({ config, payload, requestUrl, saveConfig });
  }

  /**
   * 新建今日日记（无需后端服务）
   */
  async createTodayDiaryEntry() {
    try {
      const diaryDir  = normalizeVaultPath(this.settings.diaryPath || '');
      const rule      = this.settings.filenameRule || t('YYYY-MM-DD 日记');
      const now       = new Date();
      const filename  = buildDiaryFilename(formatDate(now), rule);
      const diaryPath = diaryDir ? joinVaultPath(diaryDir, filename) : filename;

      let file = this.app.vault.getAbstractFileByPath(diaryPath);
      let existing = '';

      if (!file) {
        if (diaryDir) {
          await this.app.vault.createFolder(diaryDir).catch(() => {});
        }
        file = await this.app.vault.create(diaryPath, '');
      } else {
        existing = await this.app.vault.read(file);
      }

      const prefix     = existing.length === 0 ? '' : (existing.endsWith('\n\n') ? '' : '\n');
      const tsLevel    = Math.min(6, Math.max(1, Number(this.settings.diaryTimestampLevel) || 2));
      const tsRule     = this.settings.diaryHeadingRule || 'HH:MM:SS';
      const heading    = `${'#'.repeat(tsLevel)} ${buildDiaryHeading(now, tsRule)}`;
      const appendText = `${prefix}${heading}\n\n`;
      await this.app.vault.append(file, appendText);

      await this.app.workspace.getLeaf(false).openFile(file);
      const cursorLine = (existing + appendText).split('\n').length - 1;
      window.setTimeout(() => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || view.file?.path !== file.path) return;
        view.editor.setCursor({ line: cursorLine, ch: 0 });
        view.editor.focus();
      }, 50);

      new Notice(t('已创建 Journal Sync 日记记录块。'));
    } catch (error) {
      new Notice(error.message || String(error));
    }
  }

  getNoteTitle(file, source) {
    if (source === 'selection') return '';
    return file?.basename || '';
  }

  /**
   * 发送当前内容（触发 Send Modal）
   */
  async sendCurrentContent(editor, view) {
    try {
      if (!editor) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        editor = activeView?.editor;
      }
      if (!editor) {
        new Notice(t('请先打开或选中一份笔记'));
        return;
      }

      const current = getSelectedOrBlockContent(editor, this.settings.sendScope);
      if (!current || !current.content.trim()) {
        new Notice(t('没有可发送的内容：请先选中文本，或将光标置于所选级别的标题下。'));
        return;
      }

      const currentFile = view?.file || this.app.workspace.getActiveFile();

      // 处理图片（收集图片引用，构建富文本草稿）
      let processResult;
      if (this.settings.autoUploadImages) {
        processResult = await this.processImagesFromMarkdown(current.content, currentFile);
      } else {
        processResult = {
          content: current.content,
          richDraft: buildRichDraftFromUploadedMarkdown(current.content, []),
          failed: []
        };
      }

      if (processResult.failed.length > 0) {
        const failedNames = [...new Set(processResult.failed.map(item => item.target).filter(Boolean))];
        const suffix = failedNames.length > 0
          ? t('：{names}', { names: failedNames.slice(0, 3).join(t('、')) }) + (failedNames.length > 3 ? t(' 等') : '')
          : '';
        new Notice(t('部分图片无法读取（{count} 处），本次发送将跳过{suffix}', {
          count: processResult.failed.length,
          suffix
        }), 10000);
      }

      const preparedContent = processResult.content ?? current.content;
      const preparedImages = processResult.richDraft?.images || [];
      if (!preparedContent.trim() && preparedImages.length === 0) {
        new Notice(t('图片读取失败后没有剩余可发送内容。'));
        return;
      }

      // 打开 Send Modal
      const readImageFile = (vaultPath) => this.readImageFromVault(vaultPath, currentFile);

      const noteTitle = current.heading || this.getNoteTitle(currentFile, current.source);
      new JournalSyncSendModal(this.app, this, {
        content: preparedContent,
        richDraft: processResult.richDraft,
        readImageFile,
        notionTitle: noteTitle
      }).open();

    } catch (error) {
      new Notice(error.message || String(error));
    }
  }

  /**
   * 从发送日志快照恢复发送面板（重新编辑）。
   * @param {object} entry - log-modal 传入的 listEntries 条目（含 dirName 与 snapshot）
   * @returns {Promise<boolean>} 成功 true；失败（含快照失效）false（已 Notice，不 throw）
   */
  async restoreFromSendLog(entry) {
    try {
      const snapshot = entry?.snapshot || await sendLog.readSnapshot({ plugin: this }, entry?.dirName);
      if (!snapshot) {
        new Notice(t('日志快照已失效'));
        return false;
      }

      // 预设指针恢复：预设仍存在则把 restorePresetId 交给发送面板（构造时仅内存中切换激活预设，
      // 不落盘 saveSettings）；预设被删则不动 activePresetId（现有兜底：退回当前激活预设或默认全选）
      let restorePresetId = null;
      if (snapshot.presetId && Array.isArray(this.settings.publishPresets) &&
          this.settings.publishPresets.some(p => p?.id === snapshot.presetId)) {
        restorePresetId = snapshot.presetId;
      }

      const dirName = entry.dirName;
      const cacheBase = `${this.manifest.dir}/${sendLog.SEND_LOG_DIR}/${dirName}`;

      new JournalSyncSendModal(this.app, this, {
        content: snapshot.content,
        richDraft: {
          version: 1,
          blocks: [],
          images: (Array.isArray(snapshot.images) ? snapshot.images : []).map(im => ({
            id: `restore_${im.token}`,
            filename: im.filename,
            vaultPath: im.cacheFile,
            token: im.token
          }))
        },
        readImageFile: (p) => this.app.vault.adapter.readBinary(`${cacheBase}/${p}`),
        notionTitle: snapshot.title || '',
        restoreOptions: {
          tgSendMode: snapshot.tgSendMode,
          telegraphTitle: snapshot.telegraphTitle,
          tgShowLinkPreview: snapshot.tgShowLinkPreview
        },
        restorePresetId
      }).open();
      return true;
    } catch (error) {
      new Notice(error.message || String(error));
      return false;
    }
  }
}

module.exports = JournalSyncPlugin;
