/**
 * Journal Sync Plugin - Main Entry
 *
 * 架构说明：
 * - src/main.js         本文件：插件主类，负责生命周期与命令注册
 * - src/core/           核心模块（内容渲染、适配器注册表）
 * - src/adapters/       各平台发送适配器（flomo / telegram / mastodon / missky）
 * - src/ui/             UI 组件（Send Modal、Settings Tab）
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
const { renderRichContent } = require('./core/content-renderer');

// 适配器（各自独立，按需 require）
const flomoAdapter    = require('./adapters/flomo');
const telegramAdapter = require('./adapters/telegram');
const mastodonAdapter = require('./adapters/mastodon');
const misskeyAdapter  = require('./adapters/missky');
const notionAdapter   = require('./adapters/notion');

// Telegraph 核心模块
const telegraph = require('./core/telegraph');

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

function normalizeAbsPath(v) {
  return String(v||'').replace(/\\/g,'/').replace(/\/+$/,'');
}

function isImagePath(v) {
  const clean = String(v||'').split('#')[0].split('?')[0];
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  return IMAGE_EXTENSIONS.has(ext);
}
function isRemoteUrl(v) { return /^https?:\/\//i.test(String(v||'').trim()); }
function isDataUrl(v)   { return /^data:/i.test(String(v||'').trim()); }

function positionToOffset(doc, pos) {
  if (!pos || typeof pos.line !== 'number') return 0;
  const lines = doc.split('\n');
  const line = Math.max(0, Math.min(pos.line, lines.length-1));
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i].length + 1;
  return off + Math.max(0, Math.min(pos.ch, lines[line].length));
}

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

  return refs.sort((a,b) => a.index - b.index);
}

function getSelectedOrBlockContent(editor, scope = 2) {
  const selected = editor.getSelection();
  if (selected && selected.trim()) {
    const doc = editor.getValue().replace(/\r\n/g,'\n');
    const from = editor.getCursor('from');
    const to   = editor.getCursor('to');
    return {
      content: selected.trim(), heading: '', source: 'selection',
      selectionStart: positionToOffset(doc, from),
      selectionEnd: positionToOffset(doc, to),
      doc
    };
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
  // 各适配器启用状态
  adaptersEnabled: {
    flomo: true,
    telegram: true,
    mastodon: true,
    missky: true,
    notion: false
  },
  // 各适配器配置（连接信息）
  adaptersConfig: {
    flomo: {},
    telegram: {
      showLinkPreview: false,
      richTextEnabled: true,
      telegraphAccessToken: '',
      telegraphAuthorName: '',
      telegraphTitleLevel: 1
    },
    mastodon: { visibility: 'public' },
    missky: { visibility: 'public' },
    notion: {
      targetType: 'page',
      pageWriteMode: 'new_page',
      titleSource: 'scope',
      autoCompressLargeImages: false
    }
  },
  // 发布预设分组：不内置任何用户特定数据（频道 ID 等均存于 data.json），
  // 首次使用时由发送面板根据用户选择自动创建
  publishPresets: [],
  activePresetId: ''
};

// ──────────────────────────────────────────────
// 主插件类
// ──────────────────────────────────────────────

class JournalSyncPlugin extends Plugin {
  async onload() {
    // 加载并深度合并默认迁移设置
    const loadedData = (await this.loadData()) || {};
    this.settings = deepMergeSettings(loadedData, DEFAULT_SETTINGS);
    await this.saveSettings();

    // 初始化适配器注册表
    this.adapterRegistry = new AdapterRegistry();
    this.adapterRegistry.register(flomoAdapter);
    this.adapterRegistry.register(telegramAdapter);
    this.adapterRegistry.register(mastodonAdapter);
    this.adapterRegistry.register(misskeyAdapter);
    this.adapterRegistry.register(notionAdapter);

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

  // ── Obsidian Vault 工具 ──────────────────────

  getVaultBasePath() {
    const adapter = this.app.vault.adapter;
    if (adapter && typeof adapter.getBasePath === 'function') {
      return normalizeAbsPath(adapter.getBasePath());
    }
    return '';
  }

  absoluteToVaultPath(absPath) {
    const base = this.getVaultBasePath();
    const norm = normalizeAbsPath(absPath);
    if (!norm) return '';
    if (!base) return !/^(?:[a-zA-Z]|\/)/.test(norm) ? normalizeVaultPath(norm) : '';
    if (norm === base) return '';
    if (!norm.startsWith(`${base}/`)) {
      return !/^(?:[a-zA-Z]|\/)/.test(norm) ? normalizeVaultPath(norm) : null;
    }
    return normalizeVaultPath(norm.slice(base.length + 1));
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

    for (const ref of refs) {
      if (!isImagePath(ref.target) || isRemoteUrl(ref.target) || isDataUrl(ref.target)) continue;
      const file = await this._resolveImageFile(ref.target, currentFile);
      if (!file) continue;

      if (!uploadedByPath.has(file.path)) {
        // 保留 Vault 相对路径，避免同名图片在回读时被错误解析。
        uploadedByPath.set(file.path, { filename: file.name, vaultPath: file.path });
      }
      uploadedRefs.push(Object.assign({}, ref, uploadedByPath.get(file.path)));
    }

    // 将 Markdown 中的图片引用按原文位置逐个替换为 @图片1、@图片2 等 Token。
    // 基于位置而非字符串匹配，同一张图出现多次时每一处都能正确替换。
    const sortedRefs = uploadedRefs.slice().sort((a, b) => a.index - b.index);
    let content = '';
    let cursor = 0;
    sortedRefs.forEach((ref, idx) => {
      if (ref.index < cursor) return;
      content += markdown.slice(cursor, ref.index);
      content += `@图片${idx + 1}`;
      cursor = ref.end;
    });
    content += markdown.slice(cursor);

    return {
      content: content.trim(),
      imageFilenames: Array.from(uploadedByPath.values()).map(image => image.vaultPath).filter(Boolean),
      richDraft: buildRichDraftFromUploadedMarkdown(markdown, uploadedRefs),
      imageRefs: uploadedRefs,
      failed
    };
  }

  // ── requestUrl 包装 ─────────────────────────

  async requestUrl(options) {
    return requestUrl(options);
  }

  async prepareNotionImages(images, readImageFile, autoCompressLargeImages) {
    const localImages = [];
    const warnings = [];
    const imageList = Array.isArray(images) ? images : [];

    for (let index = 0; index < imageList.length; index += 1) {
      const image = imageList[index];
      const vaultPath = image?.vaultPath || image?.filename;
      if (!vaultPath || typeof readImageFile !== 'function') continue;
      const buffer = await readImageFile(vaultPath);
      if (!buffer) throw new Error(`无法读取图片：${image.filename || vaultPath}`);
      const source = new Uint8Array(buffer);
      let uploadBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
      let filename = image.filename || `image-${index + 1}`;
      let mimeType = this.getImageMimeType(filename);
      const originalBytes = source.byteLength;

      if (originalBytes > 5 * 1024 * 1024) {
        warnings.push({ filename, bytes: originalBytes, canCompress: /^(image\/(png|jpe?g|webp))$/i.test(mimeType) });
        if (autoCompressLargeImages && /^(image\/(png|jpe?g|webp))$/i.test(mimeType)) {
          const compressed = await this.compressImageToWebp(uploadBuffer, mimeType);
          if (compressed && compressed.byteLength < originalBytes) {
            uploadBuffer = compressed;
            filename = filename.replace(/\.[^.]+$/, '') + '.webp';
            mimeType = 'image/webp';
          }
        }
      }

      const tokenMatch = String(image?.token || '').match(/^@图片(\d+)$/);
      localImages.push({
        token: tokenMatch ? tokenMatch[1] : String(index + 1),
        filename,
        mimeType,
        buffer: uploadBuffer
      });
    }

    return { localImages, warnings };
  }

  getImageMimeType(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase();
    const types = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
    return types[ext] || 'application/octet-stream';
  }

  async compressImageToWebp(arrayBuffer, mimeType) {
    const source = new Blob([arrayBuffer], { type: mimeType });
    const bitmap = await createImageBitmap(source);
    const maxDimension = 2560;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    return blob ? await blob.arrayBuffer() : null;
  }

  // ── 执行适配器 ──────────────────────────────

  /**
   * 执行单个适配器的发送
   * @param {string} adapterId
   * @param {object} payload - { content, richDraft, telegramSegments, readImageFile, channelIds }
   */
  async executeAdapter(adapterId, payload) {
    const adapter = this.adapterRegistry.get(adapterId);
    if (!adapter) return { success: false, error: '适配器不存在' };

    const config = this.getAdapterConfig(adapterId);

    if (adapterId === 'flomo') {
      return adapter.execute({
        content: payload.content,
        apiUrl: config.apiUrl,
        requestUrl: requestUrl
      });
    }

    if (adapterId === 'telegram') {
      return adapter.execute({
        content: payload.content,
        config,
        telegramSegments: payload.telegramSegments,
        requestUrl: requestUrl,
        readImageFile: payload.readImageFile,
        channelIds: payload.channelIds,
        isRichText: payload.isRichText,
        showLinkPreview: payload.showLinkPreview
      });
    }

    if (adapterId === 'mastodon') {
      return adapter.execute({
        content: payload.content,
        serverUrl: config.serverUrl,
        accessToken: config.accessToken,
        visibility: config.visibility,
        requestUrl: requestUrl,
        images: payload.images,
        readImageFile: payload.readImageFile
      });
    }

    if (adapterId === 'missky') {
      return adapter.execute({
        content: payload.content,
        serverUrl: config.serverUrl,
        apiToken: config.apiToken,
        visibility: config.visibility,
        requestUrl: requestUrl,
        images: payload.images,
        readImageFile: payload.readImageFile
      });
    }

    if (adapterId === 'notion') {
      return adapter.execute({
        config,
        content: payload.content,
        title: payload.title,
        localImages: payload.localImages,
        externalImages: payload.externalImages,
        requestUrl: requestUrl
      });
    }

    return { success: false, error: `不支持的适配器: ${adapterId}` };
  }

  // ── Telegraph 发送编排 ──────────────────────

  /**
   * 确保 Telegraph access_token 存在，无则自动创建账号
   * @returns {Promise<string>} access_token
   */
  async ensureTelegraphToken() {
    const tgConfig = this.getAdapterConfig('telegram');
    if (tgConfig.telegraphAccessToken) return tgConfig.telegraphAccessToken;

    const account = await telegraph.createAccount('JournalSync', tgConfig.telegraphAuthorName || '', requestUrl);
    await this.setAdapterConfig('telegram', {
      ...tgConfig,
      telegraphAccessToken: account.access_token
    });
    return account.access_token;
  }

  /**
   * Telegraph 发送编排：
   * 1. 确保 access_token
   * 2. 上传本地图片到 telegra.ph/upload
   * 3. Markdown → Telegraph Node
   * 4. createPage → 获得 telegra.ph 链接
   * 5. 链接发送到所有选中的 Telegram 频道
   *
   * @param {object} params - { content, images, readImageFile, channelIds, telegraphTitle, titleLevel }
   * @returns {Promise<object>} { success, url, results }
   */
  async executeTelegraphSend({ content, images, readImageFile, channelIds, telegraphTitle, titleLevel, showLinkPreview }) {
    // 1. 确保 access_token
    let accessToken;
    try {
      accessToken = await this.ensureTelegraphToken();
    } catch (error) {
      return { success: false, error: `Telegraph 账号创建失败: ${error.message}` };
    }

    const tgConfig = this.getAdapterConfig('telegram');
    const authorName = tgConfig.telegraphAuthorName || '';

    // 2. 上传本地图片，构建 @图片N → 公网 URL 映射
    const imageUrls = new Map();
    const referencedImages = Array.isArray(images) ? images : [];

    for (const img of referencedImages) {
      const token = img.token;
      const vaultPath = img.vaultPath || img.filename;
      if (!token || !vaultPath) continue;

      if (isRemoteUrl(vaultPath)) {
        imageUrls.set(token, vaultPath);
        continue;
      }

      try {
        const buffer = await readImageFile(vaultPath);
        if (!buffer) {
          return { success: false, error: `无法读取图片: ${img.filename || vaultPath}` };
        }
        const url = await telegraph.uploadImage(buffer, img.filename || 'image.jpg', requestUrl);
        imageUrls.set(token, url);
      } catch (error) {
        return { success: false, error: `图片上传失败 (${img.filename || vaultPath}): ${error.message}` };
      }
    }

    // 3. Markdown → Telegraph Node
    // Clamp titleLevel to sendScope: when sendScope > 0, only headings up to that level
    // are included in the sent content, so the title level must not exceed it.
    const sendScope = this.settings.sendScope ?? 2;
    const maxLevel = sendScope === 0 ? 6 : Math.min(6, sendScope);
    const titleLevelNum = Math.max(1, Math.min(maxLevel, Number(titleLevel) || 1));
    const { title: extractedTitle, content: nodes } = telegraph.markdownToNodes(content, imageUrls, titleLevelNum);

    // 标题优先级：用户在发送面板编辑的 > 从正文提取的 > 默认
    const finalTitle = telegraphTitle || extractedTitle || 'Journal Sync';

    // 4. createPage
    let pageUrl;
    try {
      const page = await telegraph.createPage(accessToken, finalTitle, nodes, authorName, '', requestUrl);
      pageUrl = page.url;
    } catch (error) {
      return { success: false, error: `Telegraph 创建页面失败: ${error.message}` };
    }

    // 5. 将链接发送到所有选中的 Telegram 频道
    const botToken = tgConfig.botToken;
    if (!botToken) {
      return { success: false, error: 'Telegram Bot Token 未配置', url: pageUrl };
    }

    const targets = Array.isArray(channelIds) && channelIds.length > 0
      ? channelIds.map(String)
      : [];

    if (targets.length === 0) {
      return { success: false, error: 'Telegram 频道未配置', url: pageUrl };
    }

    const linkPreviewEnabled = showLinkPreview !== undefined ? showLinkPreview : (tgConfig.showLinkPreview !== false);
    const linkText = `${finalTitle}\n${pageUrl}`;

    const results = await Promise.all(targets.map(async targetCh => {
      try {
        const response = await requestUrl({
          url: `https://api.telegram.org/bot${botToken}/sendMessage`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetCh,
            text: linkText,
            disable_web_page_preview: !linkPreviewEnabled
          }),
          throw: false
        });
        const data = response.json;
        if (!data || !data.ok) {
          return { success: false, channelId: targetCh, error: data?.description || '发送失败' };
        }
        return { success: true, channelId: targetCh };
      } catch (error) {
        return { success: false, channelId: targetCh, error: error.message || String(error) };
      }
    }));

    const allOk = results.every(r => r.success);
    const errors = results
      .filter(r => !r.success)
      .map(r => `${r.channelId}: ${r.error}`)
      .join('; ');

    return {
      success: allOk,
      error: allOk ? undefined : errors,
      url: pageUrl,
      results
    };
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
          imageFilenames: [],
          richDraft: buildRichDraftFromUploadedMarkdown(current.content, []),
          imageRefs: [],
          failed: []
        };
      }

      // 渲染富文本（含 Telegram segments）
      const renderResult = renderRichContent({
        richDraft: processResult.richDraft,
        fallbackContent: processResult.content,
        fallbackImageFilenames: processResult.imageFilenames
      });

      if (processResult.failed.length > 0) {
        new Notice(`部分图片无法读取（${processResult.failed.length} 张），发送时将跳过。`);
      }

      // 打开 Send Modal
      const readImageFile = (vaultPath) => this.readImageFromVault(vaultPath, currentFile);

      const noteTitle = current.heading || this.getNoteTitle(currentFile, current.source);
      new JournalSyncSendModal(this.app, this, {
        content: processResult.content || current.content,
        richDraft: processResult.richDraft,
        telegramSegments: renderResult.telegramSegments,
        readImageFile,
        notionTitle: noteTitle
      }).open();

    } catch (error) {
      new Notice(error.message || String(error));
    }
  }
}

module.exports = JournalSyncPlugin;
