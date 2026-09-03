/**
 * Journal Sync Plugin - Main Entry
 *
 * 架构说明：
 * - src/main.js         本文件：插件主类，负责生命周期与命令注册
 * - src/core/           核心模块（内容渲染、适配器注册表）
 * - src/adapters/       各平台发送适配器（flomo / telegram / mastodon / missky / notion / bluesky / weibo）
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
const JournalSyncSendModal = require('./ui/send-modal');
const JournalSyncSettingTab = require('./ui/settings-tab');

// 适配器（各自独立，按需 require）；数组顺序即注册顺序：flomo、telegram、mastodon、missky、notion、bluesky、weibo
const ADAPTER_MODULES = [
  require('./adapters/flomo'),
  require('./adapters/telegram'),
  require('./adapters/mastodon'),
  require('./adapters/missky'),
  require('./adapters/notion'),
  require('./adapters/bluesky'),
  require('./adapters/weibo')
];

// ──────────────────────────────────────────────
// 工具函数（沿用原插件，无外部依赖）
// ──────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function padNumber(v, size = 2) { return String(v).padStart(size, '0'); }
function formatDate(d = new Date()) {
  return `${d.getFullYear()}-${padNumber(d.getMonth()+1)}-${padNumber(d.getDate())}`;
}
function formatTime(d = new Date()) {
  return `${padNumber(d.getHours())}:${padNumber(d.getMinutes())}:${padNumber(d.getSeconds())}`;
}

function parseDateInput(dateInput) {
  const m = String(dateInput || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) };
  const n = new Date();
  return { year: String(n.getFullYear()), month: String(n.getMonth()+1), day: String(n.getDate()) };
}

function formatDateToken(v, w) {
  const d = String(v||'').replace(/\D/g,'');
  if (!d) return '';
  return w <= d.length ? d.slice(-w) : d.padStart(w,'0');
}

function sanitizeFilename(v) {
  return String(v||'').trim().split(/[\\\/]/).pop().replace(/[:*?"<>|]/g,'_');
}

function buildDiaryFilename(dateInput, rule = 'YYYY-MM-DD 日记') {
  const {year,month,day} = parseDateInput(dateInput);
  const fallback = `${year.padStart(4,'0')}-${month.padStart(2,'0')}-${day.padStart(2,'0')} 日记`;
  const rendered = String(rule||'YYYY-MM-DD 日记').trim()
    .replace(/Y+|M+|D+/g, tok => {
      if (tok.startsWith('Y')) return formatDateToken(year, tok.length);
      if (tok.startsWith('M')) return formatDateToken(month, tok.length);
      return formatDateToken(day, tok.length);
    });
  return `${(sanitizeFilename(rendered)||fallback).replace(/\.md$/i,'')}.md`;
}

function buildDiaryHeading(now, rule = 'HH:MM:SS') {
  const fallback = `${padNumber(now.getHours())}:${padNumber(now.getMinutes())}:${padNumber(now.getSeconds())}`;
  const rendered = String(rule || 'HH:MM:SS').trim()
    .replace(/H+|M+|S+/g, tok => {
      if (tok.startsWith('H')) return formatDateToken(String(now.getHours()), tok.length);
      if (tok.startsWith('M')) return formatDateToken(String(now.getMinutes()), tok.length);
      return formatDateToken(String(now.getSeconds()), tok.length);
    });
  return rendered || fallback;
}

function normalizeVaultPath(v) {
  return String(v||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
}

function joinVaultPath(...parts) {
  return parts.map(normalizeVaultPath).filter(Boolean).join('/');
}

function dirnameVaultPath(p) {
  const n = normalizeVaultPath(p);
  const i = n.lastIndexOf('/');
  return i >= 0 ? n.slice(0,i) : '';
}

function isImagePath(v) {
  const clean = String(v||'').split('#')[0].split('?')[0];
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  return IMAGE_EXTENSIONS.has(ext);
}
function isRemoteUrl(v) { return /^https?:\/\//i.test(String(v||'').trim()); }
function isDataUrl(v)   { return /^data:/i.test(String(v||'').trim()); }

function parseImageRefs(markdown) {
  const refs = [];
  const wiki = /!\[\[([^\]]+)\]\]/g;
  const md   = /!\[[^\]]*\]\(([^)]+)\)/g;
  const bare = /(^|\n)([^\n]+?\.(?:png|jpe?g|gif|webp|svg))(?=\n|$)/gi;
  let m;

  while ((m = wiki.exec(markdown)) !== null) {
    const t = String(m[1]||'').split('|')[0].trim();
    if (!t) continue;
    refs.push({ raw: m[0], target: t, type: 'wiki', index: m.index, end: m.index+m[0].length });
  }
  while ((m = md.exec(markdown)) !== null) {
    const t = String(m[1]||'').trim().replace(/^<|>$/g,'');
    if (!t) continue;
    try { refs.push({ raw: m[0], target: decodeURIComponent(t), type: 'markdown', index: m.index, end: m.index+m[0].length }); }
    catch { refs.push({ raw: m[0], target: t, type: 'markdown', index: m.index, end: m.index+m[0].length }); }
  }
  while ((m = bare.exec(markdown)) !== null) {
    const t = String(m[2]||'').trim();
    if (!t || /[\[\]()]/.test(t)) continue;
    const idx = m.index + m[1].length;
    refs.push({ raw: m[2], target: t, type: 'bare', index: idx, end: idx+m[2].length });
  }

  // 排除代码围栏内的引用
  const codeRanges = [];
  const fenceRe = /```[^\n]*[\s\S]*?```/g;
  let fm;
  while ((fm = fenceRe.exec(markdown)) !== null) {
    codeRanges.push([fm.index, fm.index + fm[0].length]);
  }
  const filtered = codeRanges.length === 0
    ? refs
    : refs.filter(ref => !codeRanges.some(([s, e]) => ref.index >= s && ref.index < e));

  return filtered.sort((a,b) => a.index - b.index);
}

function getSelectedOrBlockContent(editor, scope = 2) {
  const selected = editor.getSelection();
  if (selected && selected.trim()) {
    return { content: selected.trim(), heading: '', source: 'selection' };
  }

  const doc   = editor.getValue().replace(/\r\n/g,'\n');
  const lines = doc.split('\n');
  const cursorLine = editor.getCursor().line;

  // scope = 0：发送整个页面
  if (Number(scope) === 0) {
    const content = doc.trim();
    return content
      ? { content, heading: '', source: 'page' }
      : null;
  }

  // scope = 1-6：发送光标上方最近一级该级别标题下的内容（不含标题本身）。
  // 遇到同级或更高级标题时结束，避免跨越到下一个父级章节。
  const level = Math.min(6, Math.max(1, Number(scope) || 2));
  const headingRe = new RegExp(`^#{${level}}\\s+`);
  const anyHeadingRe = /^(#{1,6})\s+/;
  let startLine = -1;
  for (let i = Math.min(cursorLine, lines.length-1); i >= 0; i--) {
    if (headingRe.test(lines[i])) { startLine = i; break; }
  }
  if (startLine >= 0) {
    let endLine = lines.length;
    for (let i = startLine+1; i < lines.length; i++) {
      const nextHeading = lines[i].match(anyHeadingRe);
      if (nextHeading && nextHeading[1].length <= level) {
        endLine = i;
        break;
      }
    }
    const content = lines.slice(startLine+1, endLine).join('\n').trim();
    if (!content) return null;
    return {
      content,
      heading: lines[startLine].replace(headingRe, '').trim(),
      source: 'heading'
    };
  }

  // 未选中且光标不在所选级别标题下时视为无效操作，禁止整篇文档兜底发送。
  return null;
}

function deepMergeSettings(target, source) {
  if (!target || typeof target !== 'object') target = {};
  if (!source || typeof source !== 'object') return target;

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (Array.isArray(sourceVal)) {
      if (!Array.isArray(targetVal) || targetVal.length === 0) {
        target[key] = JSON.parse(JSON.stringify(sourceVal));
      }
    } else if (sourceVal && typeof sourceVal === 'object') {
      if (!targetVal || typeof targetVal !== 'object') target[key] = {};
      deepMergeSettings(target[key], sourceVal);
    } else {
      if (targetVal === undefined || targetVal === '' || targetVal === null) {
        target[key] = sourceVal;
      }
    }
  }
  return target;
}

function buildRichDraftFromUploadedMarkdown(markdown, uploadedRefs = []) {
  const blocks = [];
  const images = [];
  let cursor = 0;
  const refs = (Array.isArray(uploadedRefs) ? uploadedRefs : [])
    .filter(r => r && typeof r.index === 'number' && r.end <= markdown.length && r.filename)
    .sort((a,b) => a.index - b.index);

  for (const ref of refs) {
    if (ref.index < cursor) continue;
    const txt = markdown.slice(cursor, ref.index);
    if (txt) {
      const prev = blocks[blocks.length-1];
      if (prev?.type === 'text') prev.text += txt;
      else blocks.push({ type:'text', text: txt });
    }
    const imgId = `obsidian_${images.length}_${ref.filename}`;
    images.push({ id: imgId, filename: ref.filename, vaultPath: ref.vaultPath || ref.filename, previewUrl: '', createdAt: '' });
    blocks.push({ type:'image', imageId: imgId });
    cursor = ref.end;
  }

  const remaining = markdown.slice(cursor);
  if (remaining) {
    const prev = blocks[blocks.length-1];
    if (prev?.type === 'text') prev.text += remaining;
    else blocks.push({ type:'text', text: remaining });
  }

  return { version: 1, blocks, images };
}

// ──────────────────────────────────────────────
// 默认设置（已迁移用户原 Journal Sync 所有配置）
// ──────────────────────────────────────────────

const DEFAULT_SETTINGS = {
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

    // 初始化适配器注册表。必须先于默认设置合并：
    // adaptersEnabled / adaptersConfig 的默认值要从各适配器 manifest 派生。
    this.adapterRegistry = new AdapterRegistry();
    for (const adapter of ADAPTER_MODULES) {
      this.adapterRegistry.register(adapter);
    }

    // 深度合并默认迁移设置（老用户 data.json 的已有值不受影响）
    this.settings = deepMergeSettings(loadedData, buildDefaultSettings(this.adapterRegistry));
    // 迁移 Mastodon 单账号旧格式 → accounts 数组
    this._migrateMastodonAccounts();
    await this.saveSettings();

    // Ribbon 按钮：新建日记
    this.addRibbonIcon('pencil', 'Journal Sync: 新建日记记录', () => this.createTodayDiaryEntry());

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

    // 注册设置面板
    this.addSettingTab(new JournalSyncSettingTab(this.app, this));
  }

  async onunload() {}

  async saveSettings() {
    await this.saveData(this.settings);
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
          reason: error?.message || '读取失败'
        });
        failedRefs.push(ref);
        continue;
      }
      if (!file) {
        failed.push({ target: ref.target, raw: ref.raw, reason: 'Vault 中未找到该文件' });
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

  // ── requestUrl 包装 ─────────────────────────

  async requestUrl(options) {
    return requestUrl(options);
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
    if (!adapter) return { success: false, error: '适配器不存在' };

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
      const rule      = this.settings.filenameRule || 'YYYY-MM-DD 日记';
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

      new Notice('已创建 Journal Sync 日记记录块。');
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
        new Notice('请先打开或选中一份笔记');
        return;
      }

      const current = getSelectedOrBlockContent(editor, this.settings.sendScope);
      if (!current || !current.content.trim()) {
        new Notice('没有可发送的内容：请先选中文本，或将光标置于所选级别的标题下。');
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
        const suffix = failedNames.length > 0 ? `：${failedNames.slice(0, 3).join('、')}${failedNames.length > 3 ? ' 等' : ''}` : '';
        new Notice(`部分图片无法读取（${processResult.failed.length} 处），本次发送将跳过${suffix}`, 10000);
      }

      const preparedContent = processResult.content ?? current.content;
      const preparedImages = processResult.richDraft?.images || [];
      if (!preparedContent.trim() && preparedImages.length === 0) {
        new Notice('图片读取失败后没有剩余可发送内容。');
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
}

module.exports = JournalSyncPlugin;
