var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core/adapter-registry.js
var require_adapter_registry = __commonJS({
  "src/core/adapter-registry.js"(exports2, module2) {
    "use strict";
    var AdapterRegistry2 = class {
      constructor() {
        this._adapters = /* @__PURE__ */ new Map();
      }
      register(adapter) {
        var _a;
        if (!((_a = adapter == null ? void 0 : adapter.manifest) == null ? void 0 : _a.id)) throw new Error("adapter must have manifest.id");
        this._adapters.set(adapter.manifest.id, adapter);
      }
      get(id) {
        return this._adapters.get(id) || null;
      }
      getAll() {
        return Array.from(this._adapters.values());
      }
      has(id) {
        return this._adapters.has(id);
      }
    };
    module2.exports = AdapterRegistry2;
  }
});

// src/ui/send-modal.js
var require_send_modal = __commonJS({
  "src/ui/send-modal.js"(exports2, module2) {
    var { Modal, Notice: Notice2 } = require("obsidian");
    function getPlainTextWithoutImageTokens(text) {
      return String(text || "").replace(/@图片\d+/g, "").replace(/!\[\[[^\]]+\]\]/g, "").replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
    }
    function buildTelegramSegmentsFromEditor(content, images) {
      const imageByToken = new Map(
        (Array.isArray(images) ? images : []).filter((image) => (image == null ? void 0 : image.token) && (image == null ? void 0 : image.filename)).map((image) => [image.token, image])
      );
      const segments = [];
      const tokenPattern = /@图片\d+/g;
      const source = String(content || "");
      let cursor = 0;
      let match;
      const pushText = (text) => {
        if (!text) return;
        const previous = segments[segments.length - 1];
        if ((previous == null ? void 0 : previous.type) === "richText") previous.markdown += text;
        else segments.push({ type: "richText", markdown: text });
      };
      while ((match = tokenPattern.exec(source)) !== null) {
        pushText(source.slice(cursor, match.index));
        const image = imageByToken.get(match[0]);
        if (image) {
          segments.push({
            type: "image",
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
    var JournalSyncSendModal2 = class extends Modal {
      /**
       * @param {App} app
       * @param {object} plugin
       * @param {string} content
       * @param {object} richDraft
       * @param {Array} telegramSegments
       * @param {Function} readImageFile
       */
      constructor(app, plugin, { content, richDraft, telegramSegments, readImageFile, notionTitle = "" }) {
        super(app);
        this.plugin = plugin;
        this.rawContent = content || "";
        this.richDraft = richDraft || { version: 1, blocks: [], images: [] };
        this.telegramSegments = telegramSegments || [];
        this.readImageFile = readImageFile;
        this.notionTitle = notionTitle;
        this.notionImageWarnings = [];
        this.tgSendMode = "plain";
        this.telegraphTitle = "";
        this.selectedTargets = /* @__PURE__ */ new Set();
        this.selectedTgChannels = /* @__PURE__ */ new Set();
        this.editingPresetId = "";
        this.images = [];
        this._objectUrls = /* @__PURE__ */ new Set();
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
            if (seg.type === "image" && seg.filename) {
              imgs.push({
                filename: seg.filename,
                vaultPath: seg.vaultPath || seg.filename,
                id: seg.vaultPath || seg.filename,
                token: `@\u56FE\u7247${imgs.length + 1}`
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
                token: `@\u56FE\u7247${imgs.length + 1}`
              });
            }
          }
        }
        this.images = imgs;
        let text = this.rawContent;
        if (this.images.length > 0 && !/@图片\d+/.test(text)) {
          const tokenStr = this.images.map((_, i) => `@\u56FE\u7247${i + 1}`).join(" ");
          text = text ? `${text}

${tokenStr}` : tokenStr;
        }
        this.content = text;
      }
      /**
       * 加载当前激活预设的选中项
       */
      loadActivePresetSelection() {
        const presets = this.plugin.settings.publishPresets || [];
        const activeId = this.plugin.settings.activePresetId;
        const preset = presets.find((p) => p.id === activeId) || presets[0];
        this.selectedTargets.clear();
        this.selectedTgChannels.clear();
        if (preset && Array.isArray(preset.items)) {
          for (const item of preset.items) {
            const id = String(item.id || "");
            if (id.startsWith("plugin:")) {
              const pluginId = id.replace("plugin:", "");
              if (pluginId !== "telegram" && this.plugin.adapterRegistry.has(pluginId) && this.plugin.isAdapterEnabled(pluginId)) {
                this.selectedTargets.add(pluginId);
              }
            } else if (id.startsWith("telegram-channel:")) {
              const chId = id.replace("telegram-channel:", "");
              this.selectedTgChannels.add(chId);
            }
          }
        } else {
          const adapters = this.plugin.adapterRegistry.getAll();
          for (const a of adapters) {
            if (a.manifest.id !== "telegram" && this.plugin.isAdapterEnabled(a.manifest.id)) {
              this.selectedTargets.add(a.manifest.id);
            }
          }
          const tgConfig = this.plugin.getAdapterConfig("telegram");
          const homeChannels = Array.isArray(tgConfig == null ? void 0 : tgConfig.homeChannels) ? tgConfig.homeChannels.map(String) : [];
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
        let activePreset = presets.find((p) => p.id === activeId);
        if (!activePreset) {
          activePreset = {
            id: `preset-${Date.now()}`,
            name: "\u9ED8\u8BA4\u9884\u8BBE",
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
        contentEl.addClass("js-bridge-send-modal");
        modalEl.style.width = "680px";
        modalEl.style.maxWidth = "92vw";
        modalEl.style.position = "relative";
        const headerRow = contentEl.createDiv({ cls: "js-bridge-header-row" });
        headerRow.createEl("h2", { text: "Journal Sync \xB7 \u53D1\u9001\u5185\u5BB9", cls: "js-bridge-send-title" });
        const inputPanel = contentEl.createDiv({ cls: "js-bridge-panel" });
        const inputTitleRow = inputPanel.createDiv({ cls: "js-bridge-panel-title-row" });
        inputTitleRow.createEl("h4", { text: "1. \u5185\u5BB9\u7F16\u8F91\u4E0E\u9884\u89C8", cls: "js-bridge-section-title" });
        const editorContainer = inputPanel.createDiv({ cls: "js-bridge-editor-container" });
        this.renderEditorContent(editorContainer);
        if (this.images.length > 0) {
          const mediaGrid = inputPanel.createDiv({ cls: "media-thumb-grid" });
          this.renderImageGrid(mediaGrid);
          this.notionImageWarningEl = inputPanel.createDiv({ cls: "notion-image-warning-list" });
          this.updateNotionImageWarnings();
        }
        const publishPanel = contentEl.createDiv({ cls: "js-bridge-panel" });
        const publishTitleRow = publishPanel.createDiv({ cls: "js-bridge-panel-title-row" });
        publishTitleRow.createEl("h4", { text: "2. \u9009\u62E9\u53D1\u5E03\u76EE\u6807", cls: "js-bridge-section-title" });
        this.presetControlsEl = publishTitleRow.createDiv({ cls: "publish-preset-controls" });
        this.renderPresetControls();
        this.simpleTargetsEl = publishPanel.createDiv({ cls: "target-list" });
        this.tgSectionEl = publishPanel.createDiv({ cls: "tg-channel-block" });
        this.renderAllTargetSections();
        const btnArea = contentEl.createDiv({ cls: "js-bridge-btn-area" });
        this.sendBtn = btnArea.createEl("button", {
          text: "\u53D1\u5E03",
          cls: "primary-btn simple-send-btn mod-cta"
        });
        this.sendBtn.addEventListener("click", () => this.doSend());
        this.previewModalEl = contentEl.createDiv({ cls: "media-preview-modal" });
        const previewShell = this.previewModalEl.createDiv({ cls: "media-preview-shell" });
        const closePreviewBtn = previewShell.createEl("button", {
          type: "button",
          text: "\xD7",
          cls: "media-preview-close"
        });
        closePreviewBtn.addEventListener("click", () => this.hideImagePreview());
        this.previewImgEl = previewShell.createEl("img", { cls: "media-preview-image" });
      }
      renderEditorContent(containerEl) {
        containerEl.empty();
        const mentionDropdown = containerEl.createDiv({ cls: "image-mention-dropdown hidden" });
        const richDiv = containerEl.createDiv({ cls: "rich-content-editor" });
        richDiv.contentEditable = "true";
        this.editorEl = richDiv;
        if (this.content) {
          const parts = this.content.split(/(@图片\d+)/);
          parts.forEach((part) => {
            if (/^@图片\d+$/.test(part)) {
              const token = document.createElement("span");
              token.className = "image-token-chip";
              token.contentEditable = "false";
              token.textContent = `\u{1F4F7} ${part}`;
              token.setAttribute("data-token", part);
              richDiv.appendChild(token);
            } else if (part) {
              const textLines = part.split("\n");
              textLines.forEach((line, lIdx) => {
                if (lIdx > 0) richDiv.appendChild(document.createElement("br"));
                if (line) richDiv.appendChild(document.createTextNode(line));
              });
            }
          });
        }
        richDiv.addEventListener("keydown", (e) => {
          var _a, _b, _c, _d;
          if (e.key === "Backspace" || e.key === "Delete") {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            let chipToDelete = null;
            if (e.key === "Backspace") {
              if (range.collapsed) {
                const container = range.startContainer;
                const offset = range.startOffset;
                if (container.nodeType === Node.ELEMENT_NODE) {
                  const prev = container.childNodes[offset - 1];
                  if (prev && ((_a = prev.classList) == null ? void 0 : _a.contains("image-token-chip"))) {
                    chipToDelete = prev;
                  }
                } else if (container.nodeType === Node.TEXT_NODE && offset === 0) {
                  let prev = container.previousSibling;
                  if (prev && ((_b = prev.classList) == null ? void 0 : _b.contains("image-token-chip"))) {
                    chipToDelete = prev;
                  }
                }
              } else {
                const fragment = range.cloneContents();
                if (fragment.querySelector(".image-token-chip")) {
                  setTimeout(() => richDiv.dispatchEvent(new Event("input")), 10);
                  return;
                }
              }
            }
            if (e.key === "Delete") {
              if (range.collapsed) {
                const container = range.startContainer;
                const offset = range.startOffset;
                if (container.nodeType === Node.ELEMENT_NODE) {
                  const next = container.childNodes[offset];
                  if (next && ((_c = next.classList) == null ? void 0 : _c.contains("image-token-chip"))) {
                    chipToDelete = next;
                  }
                } else if (container.nodeType === Node.TEXT_NODE && offset === container.textContent.length) {
                  let next = container.nextSibling;
                  if (next && ((_d = next.classList) == null ? void 0 : _d.contains("image-token-chip"))) {
                    chipToDelete = next;
                  }
                }
              }
            }
            if (chipToDelete) {
              e.preventDefault();
              e.stopPropagation();
              chipToDelete.remove();
              richDiv.dispatchEvent(new Event("input"));
            }
          }
        });
        const handleMentionCheck = () => {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0 || this.images.length === 0) {
            mentionDropdown.addClass("hidden");
            return;
          }
          const range = sel.getRangeAt(0);
          if (!richDiv.contains(range.commonAncestorContainer)) {
            mentionDropdown.addClass("hidden");
            return;
          }
          const node = range.startContainer;
          if (node.nodeType !== Node.TEXT_NODE) {
            mentionDropdown.addClass("hidden");
            return;
          }
          const textBefore = node.textContent.slice(0, range.startOffset);
          const match = textBefore.match(/@(?:图|图片)?$/);
          if (match) {
            this.showMentionDropdown(mentionDropdown, richDiv, range, match[0]);
          } else {
            mentionDropdown.addClass("hidden");
          }
        };
        richDiv.addEventListener("keyup", (e) => {
          if (e.key === "Escape") {
            mentionDropdown.addClass("hidden");
            return;
          }
          handleMentionCheck();
        });
        richDiv.addEventListener("click", () => mentionDropdown.addClass("hidden"));
        richDiv.addEventListener("input", () => {
          let text = "";
          richDiv.childNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.classList && node.classList.contains("image-token-chip")) {
                text += node.getAttribute("data-token") || node.textContent.replace(/^📷\s*/, "");
              } else if (node.tagName === "BR") {
                text += "\n";
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
        dropdownEl.removeClass("hidden");
        const rect = range.getBoundingClientRect();
        const editorRect = richDiv.getBoundingClientRect();
        dropdownEl.style.top = `${rect.bottom - editorRect.top + richDiv.offsetTop + 4}px`;
        dropdownEl.style.left = `${Math.min(Math.max(10, rect.left - editorRect.left + richDiv.offsetLeft), editorRect.width - 220)}px`;
        dropdownEl.createDiv({ text: "\u9009\u62E9\u56FE\u7247\u5360\u4F4D\u7B26\uFF1A", cls: "mention-dropdown-title" });
        this.images.forEach((img) => {
          const tokenName = img.token;
          const item = dropdownEl.createDiv({ cls: "mention-dropdown-item" });
          item.createSpan({ cls: "mention-item-icon", text: "\u{1F4F7}" });
          item.createSpan({ cls: "mention-item-label", text: tokenName });
          if (img.filename) {
            item.createSpan({ cls: "mention-item-sub", text: img.filename });
          }
          item.addEventListener("mousedown", (e) => {
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
            dropdownEl.addClass("hidden");
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
        const token = document.createElement("span");
        token.className = "image-token-chip";
        token.contentEditable = "false";
        token.setAttribute("data-token", tokenText);
        token.textContent = `\u{1F4F7} ${tokenText}`;
        const spacer = document.createTextNode(" ");
        range.insertNode(spacer);
        range.insertNode(token);
        range.setStartAfter(spacer);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        richDiv.dispatchEvent(new Event("input"));
      }
      renderImageGrid(containerEl) {
        containerEl.empty();
        if (this.images.length === 0) return;
        for (const url of this._objectUrls) URL.revokeObjectURL(url);
        this._objectUrls.clear();
        this.images.forEach((img, index) => {
          const thumb = containerEl.createDiv({ cls: "media-thumb" });
          const imgEl = thumb.createEl("img", { attr: { alt: img.filename } });
          this.readImageFile(img.vaultPath).then((arrayBuf) => {
            if (!arrayBuf) return;
            const blob = new Blob([arrayBuf]);
            const url = URL.createObjectURL(blob);
            this._objectUrls.add(url);
            imgEl.src = url;
          }).catch(() => {
          });
          thumb.createEl("span", { cls: "media-thumb-order", text: `${index + 1}` });
          const removeBtn = thumb.createEl("button", {
            type: "button",
            text: "\xD7",
            cls: "media-thumb-remove"
          });
          removeBtn.addEventListener("click", (e) => {
            var _a;
            e.stopPropagation();
            if (imgEl.src && imgEl.src.startsWith("blob:")) {
              URL.revokeObjectURL(imgEl.src);
              this._objectUrls.delete(imgEl.src);
            }
            const [removedImage] = this.images.splice(index, 1);
            if (removedImage) {
              const tokenPattern = new RegExp(removedImage.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
              this.content = this.content.replace(tokenPattern, "").replace(/\n{3,}/g, "\n\n").trim();
              (_a = this.editorEl) == null ? void 0 : _a.querySelectorAll(".image-token-chip").forEach((chip) => {
                if (chip.getAttribute("data-token") === removedImage.token) chip.remove();
              });
              this.telegramSegments = this.telegramSegments.filter((segment) => {
                return segment.type !== "image" || segment.vaultPath !== removedImage.vaultPath;
              });
              this.richDraft = {
                ...this.richDraft,
                blocks: (this.richDraft.blocks || []).filter((block) => block.imageId !== removedImage.id),
                images: (this.richDraft.images || []).filter((image) => {
                  return (image.vaultPath || image.filename) !== removedImage.vaultPath;
                })
              };
            }
            this.renderImageGrid(containerEl);
            this.updateNotionImageWarnings();
          });
          thumb.addEventListener("click", () => {
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
            if ((buffer == null ? void 0 : buffer.byteLength) > threshold) warningItems.push({ filename: image.filename, bytes: buffer.byteLength });
          } catch (e) {
          }
        }
        this.notionImageWarnings = warningItems;
        this.notionImageWarningEl.empty();
        for (const warning of warningItems) {
          const size = (warning.bytes / 1024 / 1024).toFixed(1);
          this.notionImageWarningEl.createDiv({ cls: "notion-image-warning", text: `Notion \u63D0\u793A\uFF1A${warning.filename} \u4E3A ${size} MB\uFF0C\u53EF\u80FD\u8D85\u8FC7\u5F53\u524D\u65B9\u6848\u7684 5 MB \u9650\u5236\uFF0C\u56FE\u7247\u53EF\u80FD\u53D1\u9001\u5931\u8D25\u3002` });
        }
      }
      showImagePreview(src) {
        this.previewImgEl.src = src;
        this.previewModalEl.addClass("active");
      }
      hideImagePreview() {
        this.previewModalEl.removeClass("active");
        this.previewImgEl.src = "";
      }
      renderPresetControls() {
        if (!this.presetControlsEl) return;
        this.presetControlsEl.empty();
        const presets = this.plugin.settings.publishPresets || [];
        const activeId = this.plugin.settings.activePresetId;
        presets.forEach((preset, index) => {
          if (this.editingPresetId === preset.id) {
            const input = this.presetControlsEl.createEl("input", {
              type: "text",
              cls: "publish-preset-name-input",
              value: preset.name
            });
            setTimeout(() => {
              input.focus();
              input.select();
            }, 20);
            const saveName = async () => {
              const newName = input.value.trim() || `\u9884\u8BBE${index + 1}`;
              preset.name = newName;
              this.editingPresetId = "";
              await this.plugin.saveSettings();
              this.renderPresetControls();
            };
            input.addEventListener("keydown", (e) => {
              if (e.key === "Enter") saveName();
              if (e.key === "Escape") {
                this.editingPresetId = "";
                this.renderPresetControls();
              }
            });
            input.addEventListener("blur", saveName);
            return;
          }
          const btn = this.presetControlsEl.createEl("button", {
            type: "button",
            text: preset.name,
            cls: `publish-preset-btn${preset.id === activeId ? " active" : ""}`
          });
          btn.title = "\u70B9\u51FB\u5E94\u7528\u5206\u7EC4\uFF0C\u53CC\u51FB\u91CD\u547D\u540D";
          btn.addEventListener("click", async () => {
            if (this.editingPresetId) return;
            this.plugin.settings.activePresetId = preset.id;
            await this.plugin.saveSettings();
            this.loadActivePresetSelection();
            this.presetControlsEl.querySelectorAll(".publish-preset-btn").forEach((b) => {
              b.classList.toggle("active", b === btn);
            });
            this.renderAllTargetSections();
          });
          btn.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            this.editingPresetId = preset.id;
            this.renderPresetControls();
          });
        });
        if (presets.length < 5) {
          const addBtn = this.presetControlsEl.createEl("button", {
            type: "button",
            cls: "publish-preset-action add"
          });
          addBtn.title = "\u65B0\u589E\u5F53\u524D\u9009\u62E9\u4E3A\u9884\u8BBE\u5206\u7EC4";
          addBtn.addEventListener("click", async () => {
            const newPreset = {
              id: `preset-${Date.now()}`,
              name: `\u9884\u8BBE${presets.length + 1}`,
              items: this.buildCurrentPresetItems()
            };
            presets.push(newPreset);
            this.plugin.settings.publishPresets = presets;
            this.plugin.settings.activePresetId = newPreset.id;
            await this.plugin.saveSettings();
            this.renderPresetControls();
          });
        }
        if (presets.length > 0 && activeId) {
          const removeBtn = this.presetControlsEl.createEl("button", {
            type: "button",
            cls: "publish-preset-action remove"
          });
          removeBtn.title = "\u5220\u9664\u5F53\u524D\u9009\u4E2D\u9884\u8BBE";
          removeBtn.addEventListener("click", async () => {
            var _a;
            const currentPresets = this.plugin.settings.publishPresets || [];
            const currentActiveId = this.plugin.settings.activePresetId;
            const newPresets = currentPresets.filter((p) => p.id !== currentActiveId);
            this.plugin.settings.publishPresets = newPresets;
            this.plugin.settings.activePresetId = ((_a = newPresets[0]) == null ? void 0 : _a.id) || "";
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
        const generalAdapters = adapters.filter((a) => a.manifest.id !== "telegram" && this.plugin.isAdapterEnabled(a.manifest.id));
        if (generalAdapters.length === 0) return;
        for (const adapter of generalAdapters) {
          const id = adapter.manifest.id;
          const isSelected = this.selectedTargets.has(id);
          const block = this.simpleTargetsEl.createEl("button", {
            type: "button",
            cls: `plugin-toggle-block${isSelected ? " active" : ""}`
          });
          block.createSpan({ cls: "plugin-toggle-title", text: adapter.manifest.name });
          block.addEventListener("click", async () => {
            if (this.selectedTargets.has(id)) {
              this.selectedTargets.delete(id);
            } else {
              this.selectedTargets.add(id);
            }
            block.classList.toggle("active", this.selectedTargets.has(id));
            await this.savePresetSelection();
          });
        }
      }
      renderTelegramChannels() {
        if (!this.tgSectionEl) return;
        this.tgSectionEl.empty();
        if (!this.plugin.isAdapterEnabled("telegram")) return;
        const tgConfig = this.plugin.getAdapterConfig("telegram");
        const channels = Array.isArray(tgConfig == null ? void 0 : tgConfig.channels) ? tgConfig.channels : [];
        const tgLabelRow = this.tgSectionEl.createDiv({ cls: "tg-channel-label-row" });
        tgLabelRow.createEl("div", { text: "Telegram \u76EE\u6807\u9891\u9053\uFF1A", cls: "target-sub-label" });
        const tgBtnGroup = tgLabelRow.createDiv({ cls: "tg-btn-group" });
        const telegraphBtn = tgBtnGroup.createEl("button", {
          type: "button",
          text: "Telegraph",
          cls: `tg-input-mode-btn tg-telegraph-btn${this.tgSendMode === "telegraph" ? " active expanded" : ""}`
        });
        telegraphBtn.title = "\u70B9\u51FB\u4F7F\u7528 Telegraph \u65B9\u5F0F\u53D1\u9001";
        if (tgConfig.richTextEnabled !== false) {
          const richToggleBtn = tgBtnGroup.createEl("button", {
            type: "button",
            text: "\u5BCC\u6587\u672C",
            cls: `tg-input-mode-btn${this.tgSendMode === "rich" ? " active" : ""}`
          });
          richToggleBtn.title = this.tgSendMode === "rich" ? "\u5F53\u524D\u4E3A\u5BCC\u6587\u672C\u53D1\u9001\uFF0C\u70B9\u51FB\u5207\u6362\u4E3A\u7EAF\u6587\u672C" : "\u5F53\u524D\u4E3A\u7EAF\u6587\u672C\u53D1\u9001\uFF0C\u70B9\u51FB\u5207\u6362\u4E3A\u5BCC\u6587\u672C";
          richToggleBtn.addEventListener("click", () => {
            if (this.tgSendMode === "rich") {
              this.tgSendMode = "plain";
            } else {
              this.tgSendMode = "rich";
            }
            richToggleBtn.classList.toggle("active", this.tgSendMode === "rich");
            richToggleBtn.title = this.tgSendMode === "rich" ? "\u5F53\u524D\u4E3A\u5BCC\u6587\u672C\u53D1\u9001\uFF0C\u70B9\u51FB\u5207\u6362\u4E3A\u7EAF\u6587\u672C" : "\u5F53\u524D\u4E3A\u7EAF\u6587\u672C\u53D1\u9001\uFF0C\u70B9\u51FB\u5207\u6362\u4E3A\u5BCC\u6587\u672C";
            telegraphBtn.classList.remove("active", "expanded");
            this._collapseTelegraphBtn(telegraphBtn);
          });
        }
        telegraphBtn.addEventListener("click", (e) => {
          if (this.tgSendMode === "telegraph") {
            const prefixEl = telegraphBtn.querySelector(".tg-telegraph-prefix");
            if (prefixEl && prefixEl.contains(e.target)) {
              this.tgSendMode = "plain";
              telegraphBtn.classList.remove("active", "expanded");
              this._collapseTelegraphBtn(telegraphBtn);
              return;
            }
            return;
          }
          this.tgSendMode = "telegraph";
          telegraphBtn.classList.add("active", "expanded");
          const richBtn = tgLabelRow.querySelector(".tg-input-mode-btn:not(.tg-telegraph-btn)");
          if (richBtn) richBtn.classList.remove("active");
          this._expandTelegraphBtn(telegraphBtn);
        });
        telegraphBtn.addEventListener("dblclick", (e) => {
          if (this.tgSendMode !== "telegraph") return;
          const titleEl = telegraphBtn.querySelector(".tg-telegraph-title");
          if (!titleEl || !titleEl.contains(e.target)) return;
          this._editTelegraphTitle(telegraphBtn, titleEl);
        });
        if (channels.length === 0) {
          this.tgSectionEl.createDiv({
            cls: "target-sub",
            text: "\u5C1A\u672A\u83B7\u53D6\u9891\u9053\u5217\u8868\uFF0C\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u83B7\u53D6\u9891\u9053\u3002"
          });
          return;
        }
        const channelGrid = this.tgSectionEl.createDiv({ cls: "target-list tg-channel-list" });
        channels.forEach((ch) => {
          const chId = String(ch.id);
          const isSelected = this.selectedTgChannels.has(chId);
          const chBlock = channelGrid.createEl("button", {
            type: "button",
            cls: `plugin-toggle-block tg-channel-toggle${isSelected ? " active" : ""}`
          });
          const row = chBlock.createDiv({ cls: "plugin-toggle-title-row" });
          row.createSpan({ cls: "plugin-toggle-title", text: ch.title || chId });
          if (ch.username) {
            row.createSpan({
              cls: "plugin-toggle-sub",
              text: ch.username.startsWith("@") ? ch.username : `@${ch.username}`
            });
          }
          chBlock.addEventListener("click", async () => {
            if (this.selectedTgChannels.has(chId)) {
              this.selectedTgChannels.delete(chId);
            } else {
              this.selectedTgChannels.add(chId);
            }
            chBlock.classList.toggle("active", this.selectedTgChannels.has(chId));
            await this.savePresetSelection();
          });
        });
      }
      // ── Telegraph 按钮辅助方法 ─────────────────
      /**
       * 获取默认 Telegraph 标题：从正文提取或使用笔记标题
       */
      _getDefaultTelegraphTitle() {
        const tgConfig = this.plugin.getAdapterConfig("telegram");
        const titleLevel = tgConfig.telegraphTitleLevel || 1;
        const headingRe = new RegExp(`^#{${titleLevel}}\\s+(.+)$`, "m");
        const match = this.content.match(headingRe);
        if (match) return match[1].trim();
        return this.notionTitle || "Journal Sync";
      }
      /**
       * 展开 Telegraph 按钮：显示 "Telegraph：标题"
       */
      _expandTelegraphBtn(btn) {
        if (!this.telegraphTitle) {
          this.telegraphTitle = this._getDefaultTelegraphTitle();
        }
        btn.empty();
        const prefix = btn.createSpan({ cls: "tg-telegraph-prefix", text: "Telegraph\uFF1A" });
        prefix.title = "\u70B9\u51FB\u6B64\u5904\u5173\u95ED Telegraph \u53D1\u9001";
        const titleSpan = btn.createSpan({ cls: "tg-telegraph-title", text: this.telegraphTitle });
        titleSpan.title = "\u53CC\u51FB\u7F16\u8F91\u6807\u9898";
        btn.title = "Telegraph \u6A21\u5F0F\uFF1A\u5355\u51FB\u524D\u7F00\u5173\u95ED\uFF0C\u53CC\u51FB\u6807\u9898\u7F16\u8F91";
      }
      /**
       * 收起 Telegraph 按钮：恢复为 "Telegraph"
       */
      _collapseTelegraphBtn(btn) {
        btn.empty();
        btn.textContent = "Telegraph";
        btn.title = "\u70B9\u51FB\u4F7F\u7528 Telegraph \u65B9\u5F0F\u53D1\u9001";
      }
      /**
       * 双击编辑 Telegraph 标题
       */
      _editTelegraphTitle(btn, titleEl) {
        const currentText = this.telegraphTitle || "";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "tg-telegraph-title-input";
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
          this._expandTelegraphBtn(btn);
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            saveEdit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            saved = true;
            this._expandTelegraphBtn(btn);
          }
        });
        input.addEventListener("blur", saveEdit);
      }
      /**
       * 执行发送（即时关窗 + 后台无阻塞异步发送）
       */
      doSend() {
        const plugin = this.plugin;
        const targetAdapters = Array.from(this.selectedTargets).filter(
          (adapterId) => adapterId !== "telegram" && plugin.adapterRegistry.has(adapterId) && plugin.isAdapterEnabled(adapterId)
        );
        const tgChannels = Array.from(this.selectedTgChannels);
        if (targetAdapters.length === 0 && tgChannels.length === 0) {
          new Notice2("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u4E2A\u53D1\u9001\u76EE\u6807\u6216 Telegram \u9891\u9053");
          return;
        }
        const tgSendMode = this.tgSendMode;
        const isRich = tgSendMode === "rich";
        const isTelegraph = tgSendMode === "telegraph";
        const telegraphTitle = this.telegraphTitle;
        const rawContent = this.content;
        const plainTextContent = getPlainTextWithoutImageTokens(rawContent);
        const richDraft = this.richDraft;
        const readImageFile = this.readImageFile;
        const referencedTokens = new Set(rawContent.match(/@图片\d+/g) || []);
        const images = this.images.filter((image) => referencedTokens.has(image.token));
        this.close();
        new Notice2("\u{1F680} \u5DF2\u63D0\u4EA4\u540E\u53F0\u53D1\u9001\u4E2D...", 3e3);
        (async () => {
          const results = {};
          for (const adapterId of targetAdapters) {
            try {
              if (adapterId === "notion") {
                const notionConfig = plugin.getAdapterConfig("notion") || {};
                const prepared = await plugin.prepareNotionImages(images, readImageFile, Boolean(notionConfig.autoCompressLargeImages));
                let notionTitle = this.notionTitle;
                if (notionConfig.titleSource === "none") notionTitle = "";
                if (notionConfig.titleSource === "first_heading") {
                  const headingMatch = rawContent.match(/^#\s+(.+)$/m);
                  notionTitle = headingMatch ? headingMatch[1].trim() : "";
                }
                const result = await plugin.executeAdapter(adapterId, {
                  content: rawContent,
                  title: notionTitle,
                  localImages: prepared.localImages,
                  externalImages: {}
                });
                result.warnings = prepared.warnings.map((item) => `${item.filename} \u8D85\u8FC7 5 MB \u9884\u8B66\u9608\u503C`);
                results[adapterId] = result;
              } else {
                const result = await plugin.executeAdapter(adapterId, {
                  content: plainTextContent,
                  richDraft: {
                    ...richDraft,
                    images
                  },
                  images: images.map((img) => img.vaultPath).filter(Boolean),
                  readImageFile
                });
                results[adapterId] = result;
              }
            } catch (error) {
              results[adapterId] = { success: false, error: error.message };
            }
          }
          if (tgChannels.length > 0 && plugin.isAdapterEnabled("telegram")) {
            if (isTelegraph) {
              try {
                const tgConfig = plugin.getAdapterConfig("telegram");
                const titleLevel = tgConfig.telegraphTitleLevel || 1;
                const tgResult = await plugin.executeTelegraphSend({
                  content: rawContent,
                  images,
                  readImageFile,
                  channelIds: tgChannels,
                  telegraphTitle,
                  titleLevel
                });
                results["Telegram"] = tgResult;
              } catch (error) {
                results["Telegram"] = { success: false, error: error.message };
              }
            } else {
              try {
                const tgSegs = buildTelegramSegmentsFromEditor(rawContent, images);
                const tgResult = await plugin.executeAdapter("telegram", {
                  content: isRich ? rawContent : plainTextContent,
                  telegramSegments: tgSegs,
                  readImageFile,
                  channelIds: tgChannels,
                  isRichText: isRich
                });
                results["Telegram"] = tgResult;
              } catch (error) {
                results["Telegram"] = { success: false, error: error.message };
              }
            }
          }
          const anyFailure = Object.values(results).some((r) => !r.success && !r.skipped);
          const summary = Object.entries(results).flatMap(([id, result]) => {
            const channelResults = Array.isArray(result.results) ? result.results : null;
            if (id === "Telegram" && channelResults) {
              return channelResults.map((channel) => {
                return `Telegram ${channel.channelId}: ${channel.success ? "\u6210\u529F" : `\u5931\u8D25(${channel.error || "\u672A\u77E5\u9519\u8BEF"})`}`;
              });
            }
            const warn = Array.isArray(result.warnings) && result.warnings.length > 0 ? `\uFF08${result.warnings.join("\uFF1B")}\uFF09` : "";
            return result.success ? result.skipped ? `${id}: \u8DF3\u8FC7` : `${id}: \u6210\u529F${warn}` : `${id}: \u5931\u8D25(${result.error || "\u672A\u77E5\u9519\u8BEF"})`;
          }).join("\uFF1B\n");
          if (anyFailure) {
            new Notice2(`\u274C \u53D1\u9001\u5B58\u5728\u5931\u8D25\uFF1A${summary}`, 1e4);
          } else {
            new Notice2(`\u2705 \u53D1\u9001\u6210\u529F\uFF1A${summary}`, 6e3);
          }
        })();
      }
      onClose() {
        for (const url of this._objectUrls) URL.revokeObjectURL(url);
        this._objectUrls.clear();
        this.contentEl.empty();
      }
    };
    module2.exports = JournalSyncSendModal2;
  }
});

// src/core/telegraph.js
var require_telegraph = __commonJS({
  "src/core/telegraph.js"(exports2, module2) {
    "use strict";
    var TELEGRAPH_API_BASE = "https://api.telegra.ph";
    var TELEGRAPH_UPLOAD_URL = "https://telegra.ph/upload";
    async function telegraphApi(method, params, requestUrlFn) {
      const url = `${TELEGRAPH_API_BASE}/${method}`;
      const body = JSON.stringify(params || {});
      const response = await requestUrlFn({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        throw: false
      });
      const data = response.json;
      if (!data || data.ok !== true) {
        throw new Error((data == null ? void 0 : data.error) || `Telegraph API ${method} \u5931\u8D25 (HTTP ${response.status})`);
      }
      return data.result;
    }
    async function createAccount(shortName, authorName, requestUrlFn) {
      const params = { short_name: shortName };
      if (authorName) params.author_name = authorName;
      return telegraphApi("createAccount", params, requestUrlFn);
    }
    async function getAccountInfo(accessToken, requestUrlFn) {
      return telegraphApi("getAccountInfo", { access_token: accessToken, fields: ["short_name", "author_name"] }, requestUrlFn);
    }
    async function createPage2(accessToken, title, content, authorName, authorUrl, requestUrlFn) {
      const params = {
        access_token: accessToken,
        title: String(title || "").slice(0, 256),
        content: JSON.stringify(content)
      };
      if (authorName) params.author_name = authorName;
      if (authorUrl) params.author_url = authorUrl;
      return telegraphApi("createPage", params, requestUrlFn);
    }
    async function uploadImage(arrayBuffer, filename, requestUrlFn) {
      var _a;
      const formData = new FormData();
      const blob = new Blob([arrayBuffer]);
      formData.append("file", blob, filename || "image.jpg");
      const response = await requestUrlFn({
        url: TELEGRAPH_UPLOAD_URL,
        method: "POST",
        body: formData,
        throw: false
      });
      const data = response.json;
      if (!Array.isArray(data) || data.length === 0 || !data[0].src) {
        const errMsg = Array.isArray(data) && ((_a = data[0]) == null ? void 0 : _a.error) ? data[0].error : "\u4E0A\u4F20\u5931\u8D25";
        throw new Error(`Telegraph \u56FE\u7247\u4E0A\u4F20\u5931\u8D25: ${errMsg}`);
      }
      return `https://telegra.ph${data[0].src}`;
    }
    function markdownToNodes(markdown, imageUrls, titleLevel) {
      const lines = String(markdown || "").split("\n");
      const titleLevelNum = Math.max(1, Math.min(6, Number(titleLevel) || 1));
      let pageTitle = "";
      let titleLineIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
        if (m) {
          const level = m[1].length;
          if (level === titleLevelNum) {
            pageTitle = m[2].trim();
            titleLineIndex = i;
            break;
          }
        }
      }
      const bodyLines = lines.filter((_, i) => i !== titleLineIndex);
      const content = parseBodyLines(bodyLines, imageUrls, titleLevelNum);
      return { title: pageTitle, content };
    }
    function bodyHeadingTag(headingLevel, titleLevel) {
      const offset = headingLevel - titleLevel;
      if (offset <= 1) return "h3";
      return "h4";
    }
    function parseBodyLines(lines, imageUrls, titleLevelNum) {
      const nodes = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
          i++;
          continue;
        }
        const tokenMatch = line.trim().match(/^@图片(\d+)$/);
        if (tokenMatch) {
          const url = imageUrls.get(`@\u56FE\u7247${tokenMatch[1]}`);
          if (url) {
            nodes.push({ tag: "img", attrs: { src: url } });
          }
          i++;
          continue;
        }
        const imgMatch = line.trim().match(/^!\[[^\]]*\]\(([^)]+)\)$/);
        if (imgMatch) {
          const src = imgMatch[1].replace(/^<|>$/g, "");
          if (/^https?:\/\//i.test(src)) {
            nodes.push({ tag: "img", attrs: { src } });
          }
          i++;
          continue;
        }
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const text = headingMatch[2].trim();
          const tag = bodyHeadingTag(level, titleLevelNum);
          nodes.push({ tag, children: parseInline2(text, imageUrls) });
          i++;
          continue;
        }
        if (/^---+\s*$/.test(line.trim()) || /^\*\*\*+\s*$/.test(line.trim())) {
          nodes.push({ tag: "hr" });
          i++;
          continue;
        }
        if (line.trim().startsWith("```")) {
          const codeLines = [];
          i++;
          while (i < lines.length && !lines[i].trim().startsWith("```")) {
            codeLines.push(lines[i]);
            i++;
          }
          i++;
          nodes.push({ tag: "pre", children: [codeLines.join("\n")] });
          continue;
        }
        if (line.trim().startsWith(">")) {
          const quoteLines = [];
          while (i < lines.length && lines[i].trim().startsWith(">")) {
            quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
            i++;
          }
          const quoteContent = [];
          for (const qLine of quoteLines) {
            quoteContent.push(...parseInline2(qLine, imageUrls));
            quoteContent.push({ tag: "br" });
          }
          if (quoteContent.length > 0 && quoteContent[quoteContent.length - 1].tag === "br") {
            quoteContent.pop();
          }
          nodes.push({ tag: "blockquote", children: quoteContent });
          continue;
        }
        if (/^[-*+]\s+/.test(line.trim())) {
          const items = [];
          while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
            const itemText = lines[i].trim().replace(/^[-*+]\s+/, "");
            items.push({ tag: "li", children: parseInline2(itemText, imageUrls) });
            i++;
          }
          nodes.push({ tag: "ul", children: items });
          continue;
        }
        if (/^\d+\.\s+/.test(line.trim())) {
          const items = [];
          while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
            const itemText = lines[i].trim().replace(/^\d+\.\s+/, "");
            items.push({ tag: "li", children: parseInline2(itemText, imageUrls) });
            i++;
          }
          nodes.push({ tag: "ol", children: items });
          continue;
        }
        if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
          const tableLines = [];
          while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
            tableLines.push(lines[i].trim());
            i++;
          }
          const tableText = tableLines.map((row) => row.replace(/^\||\|$/g, "").replace(/\|/g, " | ")).join("\n");
          nodes.push({ tag: "p", children: [tableText] });
          continue;
        }
        const paraLines = [];
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) break;
          if (/^(#{1,6})\s+/.test(l)) break;
          if (/^[-*+]\s+/.test(l.trim())) break;
          if (/^\d+\.\s+/.test(l.trim())) break;
          if (l.trim().startsWith(">")) break;
          if (l.trim().startsWith("```")) break;
          if (/^---+\s*$/.test(l.trim()) || /^\*\*\*+\s*$/.test(l.trim())) break;
          if (l.trim().startsWith("|") && l.trim().endsWith("|")) break;
          const tokM = l.trim().match(/^@图片(\d+)$/);
          if (tokM) break;
          const imgM = l.trim().match(/^!\[[^\]]*\]\(([^)]+)\)$/);
          if (imgM) break;
          paraLines.push(l);
          i++;
        }
        if (paraLines.length > 0) {
          const paraText = paraLines.join("\n");
          const inlineParts = splitByImageTokens(paraText, imageUrls);
          if (inlineParts.length > 1 || inlineParts.length === 1 && inlineParts[0].type === "image") {
            const children = [];
            for (const part of inlineParts) {
              if (part.type === "image") {
                children.push({ tag: "img", attrs: { src: part.url } });
              } else if (part.text) {
                children.push(...parseInline2(part.text, imageUrls));
              }
            }
            nodes.push({ tag: "p", children });
          } else {
            const inlineNodes = parseInline2(paraText, imageUrls);
            if (inlineNodes.length > 0) {
              nodes.push({ tag: "p", children: inlineNodes });
            }
          }
        }
      }
      return nodes;
    }
    function splitByImageTokens(text, imageUrls) {
      const parts = [];
      const pattern = /@图片\d+/g;
      let cursor = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > cursor) {
          parts.push({ type: "text", text: text.slice(cursor, match.index) });
        }
        const url = imageUrls.get(match[0]);
        if (url) {
          parts.push({ type: "image", url });
        } else {
          parts.push({ type: "text", text: match[0] });
        }
        cursor = match.index + match[0].length;
      }
      if (cursor < text.length) {
        parts.push({ type: "text", text: text.slice(cursor) });
      }
      return parts;
    }
    function parseInline2(text, imageUrls) {
      if (!text) return [];
      const tokenParts = splitByImageTokens(text, imageUrls);
      const result = [];
      for (const part of tokenParts) {
        if (part.type === "image") {
          result.push({ tag: "img", attrs: { src: part.url } });
        } else if (part.text) {
          result.push(...parseInlineFormatting(part.text));
        }
      }
      return result;
    }
    function parseInlineFormatting(text) {
      const nodes = [];
      let remaining = text;
      const pattern = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(_(.+?)_)|(`(.+?)`)|(~~(.+?)~~)|(\[([^\]]+)\]\(([^)]+)\))/g;
      let lastIndex = 0;
      let match;
      while ((match = pattern.exec(remaining)) !== null) {
        if (match.index > lastIndex) {
          nodes.push(remaining.slice(lastIndex, match.index));
        }
        if (match[1]) {
          nodes.push({ tag: "strong", children: [match[2]] });
        } else if (match[3]) {
          nodes.push({ tag: "em", children: [match[4]] });
        } else if (match[5]) {
          nodes.push({ tag: "em", children: [match[6]] });
        } else if (match[7]) {
          nodes.push({ tag: "code", children: [match[8]] });
        } else if (match[9]) {
          nodes.push({ tag: "s", children: [match[10]] });
        } else if (match[11]) {
          nodes.push({ tag: "a", attrs: { href: match[13] }, children: [match[12]] });
        }
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < remaining.length) {
        nodes.push(remaining.slice(lastIndex));
      }
      const finalNodes = [];
      for (const node of nodes) {
        if (typeof node === "string") {
          const parts = node.split("\n");
          for (let j = 0; j < parts.length; j++) {
            if (parts[j]) finalNodes.push(parts[j]);
            if (j < parts.length - 1) finalNodes.push({ tag: "br" });
          }
        } else {
          finalNodes.push(node);
        }
      }
      return finalNodes;
    }
    module2.exports = {
      createAccount,
      createPage: createPage2,
      uploadImage,
      markdownToNodes,
      telegraphApi,
      getAccountInfo
    };
  }
});

// src/ui/settings-tab.js
var require_settings_tab = __commonJS({
  "src/ui/settings-tab.js"(exports2, module2) {
    var { PluginSettingTab, Setting, Notice: Notice2 } = require("obsidian");
    var JournalSyncSettingTab2 = class extends PluginSettingTab {
      constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
        this.activeSection = "main";
        this.activePlugin = "flomo";
      }
      async display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("js-bridge-settings");
        containerEl.createEl("h2", { text: "Journal Sync" });
        containerEl.createEl("p", {
          cls: "js-bridge-settings-desc",
          text: "\u4E00\u952E\u5C06\u7B14\u8BB0\u53D1\u9001\u81F3\u5176\u5B83\u5E73\u53F0"
        });
        const layoutEl = containerEl.createDiv({ cls: "js-bridge-settings-layout" });
        const navEl = layoutEl.createDiv({ cls: "js-bridge-settings-nav" });
        const contentEl = layoutEl.createDiv({ cls: "js-bridge-settings-content" });
        this._addNavButton(navEl, "main", "\u4E3B\u8BBE\u7F6E");
        this._addNavButton(navEl, "plugins", "\u63D2\u4EF6\u8BBE\u7F6E");
        if (this.activeSection === "main") {
          this._renderMainSettings(contentEl);
        } else {
          this._renderPluginSettings(contentEl);
        }
      }
      _addNavButton(containerEl, section, label) {
        const button = containerEl.createEl("button", {
          text: label,
          cls: "js-bridge-settings-nav-button"
        });
        button.toggleClass("is-active", this.activeSection === section);
        button.addEventListener("click", () => {
          this.activeSection = section;
          this.display();
        });
      }
      _renderMainSettings(containerEl) {
        containerEl.createEl("h3", { text: "\u4E3B\u8BBE\u7F6E", cls: "js-bridge-section-heading" });
        containerEl.createEl("p", {
          text: "\u7BA1\u7406\u65E5\u8BB0\u521B\u5EFA\u548C\u53D1\u9001\u65F6\u901A\u7528\u7684\u884C\u4E3A\u3002",
          cls: "js-bridge-settings-section-desc"
        });
        new Setting(containerEl).setName("\u65E5\u8BB0\u5B58\u653E\u8DEF\u5F84").setDesc("Obsidian Vault \u5185\u7684\u76F8\u5BF9\u8DEF\u5F84\uFF08\u5982 \u65E5\u8BB0/2024\uFF09").addText((text) => text.setPlaceholder("\u65E5\u8BB0").setValue(this.plugin.settings.diaryPath || "").onChange(async (value) => {
          this.plugin.settings.diaryPath = value.trim();
          await this.plugin.saveSettings();
        }));
        new Setting(containerEl).setName("\u65E5\u8BB0\u6587\u4EF6\u540D\u89C4\u5219").setDesc("\u652F\u6301 YYYY MM DD \u5360\u4F4D\u7B26\uFF0C\u4F8B\u5982 YYYY-MM-DD \u65E5\u8BB0").addText((text) => text.setPlaceholder("YYYY-MM-DD \u65E5\u8BB0").setValue(this.plugin.settings.filenameRule || "YYYY-MM-DD \u65E5\u8BB0").onChange(async (value) => {
          this.plugin.settings.filenameRule = value.trim() || "YYYY-MM-DD \u65E5\u8BB0";
          await this.plugin.saveSettings();
        }));
        new Setting(containerEl).setName("\u81EA\u52A8\u4E0A\u4F20\u672C\u5730\u56FE\u7247").setDesc("\u53D1\u9001\u65F6\u81EA\u52A8\u8BFB\u53D6\u5E76\u53D1\u9001 Obsidian Vault \u4E2D\u5F15\u7528\u7684\u672C\u5730\u56FE\u7247\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoUploadImages !== false).onChange(async (value) => {
          this.plugin.settings.autoUploadImages = value;
          await this.plugin.saveSettings();
        }));
        new Setting(containerEl).setName("\u53D1\u9001\u8303\u56F4\uFF08\u672A\u9009\u4E2D\u6587\u672C\u65F6\uFF09").setDesc("\u4F7F\u7528\u53D1\u9001\u547D\u4EE4\u4E14\u672A\u9009\u4E2D\u6587\u672C\u65F6\uFF0C\u53D1\u9001\u5149\u6807\u6240\u5728\u4F4D\u7F6E\u7684\u5185\u5BB9\u8303\u56F4\u3002\u9009\u62E9\u4EFB\u610F\u6807\u9898\u7EA7\u522B\u65F6\uFF0C\u4E0D\u5305\u542B\u6807\u9898\u672C\u8EAB\u3002").addDropdown((dropdown) => {
          var _a;
          dropdown.addOption("0", "\u6574\u4E2A\u9875\u9762");
          for (let i = 1; i <= 6; i++) dropdown.addOption(String(i), this._headingLevelLabel(i));
          dropdown.setValue(String((_a = this.plugin.settings.sendScope) != null ? _a : 2)).onChange(async (value) => {
            this.plugin.settings.sendScope = Number(value);
            const newScope = Number(value);
            const maxLv = newScope === 0 ? 6 : Math.min(6, newScope);
            const tgCfg = this.plugin.getAdapterConfig("telegram");
            const currentLv = tgCfg.telegraphTitleLevel || 1;
            if (currentLv > maxLv) {
              await this.plugin.setAdapterConfig("telegram", { ...tgCfg, telegraphTitleLevel: maxLv });
            }
            await this.plugin.saveSettings();
            this.display();
          });
        });
        new Setting(containerEl).setName("\u65B0\u5EFA\u6807\u9898\u7EA7\u522B").setDesc("\u4F7F\u7528\u65B0\u5EFA\u65E5\u8BB0\u547D\u4EE4\u65F6\uFF0C\u65F6\u95F4\u6233\u8BB0\u5F55\u4F7F\u7528\u7684\u6807\u9898\u7EA7\u522B\u3002").addDropdown((dropdown) => {
          var _a;
          for (let i = 1; i <= 6; i++) dropdown.addOption(String(i), this._headingLevelLabel(i));
          dropdown.setValue(String((_a = this.plugin.settings.diaryTimestampLevel) != null ? _a : 2)).onChange(async (value) => {
            this.plugin.settings.diaryTimestampLevel = Number(value);
            await this.plugin.saveSettings();
          });
        });
        new Setting(containerEl).setName("\u65B0\u5EFA\u6807\u9898\u683C\u5F0F").setDesc("\u652F\u6301 H M S \u5360\u4F4D\u7B26\uFF08H=\u65F6\u3001M=\u5206\u3001S=\u79D2\uFF09\uFF0C\u4F8B\u5982 HH:MM:SS \u6216 HH:MM").addText((text) => text.setPlaceholder("HH:MM:SS").setValue(this.plugin.settings.diaryHeadingRule || "HH:MM:SS").onChange(async (value) => {
          this.plugin.settings.diaryHeadingRule = value.trim() || "HH:MM:SS";
          await this.plugin.saveSettings();
        }));
      }
      _renderPluginSettings(containerEl) {
        containerEl.createEl("h3", { text: "\u63D2\u4EF6\u8BBE\u7F6E", cls: "js-bridge-section-heading" });
        containerEl.createEl("p", {
          text: "\u9009\u62E9\u53D1\u5E03\u5E73\u53F0\uFF0C\u914D\u7F6E\u8FDE\u63A5\u4FE1\u606F\u4E0E\u53D1\u9001\u884C\u4E3A\u3002",
          cls: "js-bridge-settings-section-desc"
        });
        const tabsEl = containerEl.createDiv({ cls: "js-bridge-plugin-tabs" });
        for (const plugin of [
          { id: "flomo", label: "Flomo" },
          { id: "telegram", label: "Telegram" },
          { id: "mastodon", label: "Mastodon" },
          { id: "missky", label: "Misskey" },
          { id: "notion", label: "Notion" }
        ]) {
          const button = tabsEl.createEl("button", { text: plugin.label, cls: "js-bridge-plugin-tab" });
          button.toggleClass("is-active", this.activePlugin === plugin.id);
          button.addEventListener("click", () => {
            this.activePlugin = plugin.id;
            this.display();
          });
        }
        const panelEl = containerEl.createDiv({ cls: "js-bridge-plugin-panel" });
        if (this.activePlugin === "flomo") this._renderFlomo(panelEl);
        if (this.activePlugin === "telegram") this._renderTelegram(panelEl);
        if (this.activePlugin === "mastodon") this._renderMastodon(panelEl);
        if (this.activePlugin === "missky") this._renderMisskey(panelEl);
        if (this.activePlugin === "notion") this._renderNotion(panelEl);
      }
      _addEnabledToggle(containerEl, id, label) {
        new Setting(containerEl).setName(`\u542F\u7528 ${label}`).addToggle((toggle) => toggle.setValue(this.plugin.isAdapterEnabled(id)).onChange(async (value) => {
          this.plugin.setAdapterEnabled(id, value);
          await this.plugin.saveSettings();
          this.display();
        }));
      }
      _renderFlomo(containerEl) {
        this._addEnabledToggle(containerEl, "flomo", "Flomo");
        if (!this.plugin.isAdapterEnabled("flomo")) return;
        new Setting(containerEl).setName("Flomo API Webhook").setDesc("\u5728 flomo \u7F51\u9875\u7248\u201CAPI\u201D\u9875\u9762\u83B7\u53D6").addText((text) => {
          var _a;
          text.inputEl.type = "password";
          text.setPlaceholder("https://flomoapp.com/iwh/...").setValue(((_a = this.plugin.getAdapterConfig("flomo")) == null ? void 0 : _a.apiUrl) || "").onChange(async (value) => {
            await this.plugin.setAdapterConfig("flomo", { apiUrl: value.trim() });
          });
        });
      }
      _renderTelegram(containerEl) {
        this._addEnabledToggle(containerEl, "telegram", "Telegram");
        if (!this.plugin.isAdapterEnabled("telegram")) return;
        const tgConfig = this.plugin.getAdapterConfig("telegram") || {};
        new Setting(containerEl).setName("Bot Token").setDesc("\u4ECE @BotFather \u83B7\u53D6").addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("123456789:ABCdef...").setValue(tgConfig.botToken || "").onChange(async (value) => {
            await this.plugin.setAdapterConfig("telegram", { ...this.plugin.getAdapterConfig("telegram"), botToken: value.trim() });
          });
        });
        new Setting(containerEl).setName("\u9891\u9053\u5217\u8868").setDesc(this._buildChannelDesc(tgConfig)).addButton((btn) => btn.setButtonText("\u83B7\u53D6\u9891\u9053\u5217\u8868").onClick(async () => {
          var _a;
          try {
            btn.setButtonText("\u83B7\u53D6\u4E2D...");
            btn.disabled = true;
            const result = await this.plugin.adapterRegistry.get("telegram").runAction("discoverChannels", this.plugin.getAdapterConfig("telegram"), this.plugin.requestUrl.bind(this.plugin));
            const channels = ((_a = result.data) == null ? void 0 : _a.channels) || [];
            const config = this.plugin.getAdapterConfig("telegram") || {};
            await this.plugin.setAdapterConfig("telegram", { ...config, channels, homeChannels: channels.map((channel) => String(channel.id)) });
            new Notice2(result.message || "\u83B7\u53D6\u6210\u529F");
            this.display();
          } catch (error) {
            new Notice2(`\u83B7\u53D6\u9891\u9053\u5931\u8D25\uFF1A${error.message}`);
          } finally {
            btn.setButtonText("\u83B7\u53D6\u9891\u9053\u5217\u8868");
            btn.disabled = false;
          }
        }));
        this._renderChannelSelection(containerEl, tgConfig);
        new Setting(containerEl).setName("\u666E\u901A\u53D1\u9001\u65F6\u663E\u793A\u7F51\u5740\u9884\u89C8").setDesc("\u4EC5\u666E\u901A\u6587\u672C\u53D1\u9001\u65F6\u751F\u6548\u3002\u5173\u95ED\u540E\uFF0C\u6D88\u606F\u4E2D\u7684\u7F51\u5740\u4E0D\u4F1A\u5C55\u5F00\u9884\u89C8\u5361\u7247\u3002").addToggle((toggle) => toggle.setValue(tgConfig.showLinkPreview !== false).onChange(async (value) => {
          await this.plugin.setAdapterConfig("telegram", { ...this.plugin.getAdapterConfig("telegram"), showLinkPreview: value });
        }));
        new Setting(containerEl).setName("\u542F\u7528\u5BCC\u6587\u672C\u53D1\u9001").setDesc("\u5F00\u542F\u540E\u4F7F\u7528 Telegram \u539F\u751F\u5A92\u4F53\u4E0A\u4F20\u53D1\u9001\u56FE\u6587\u6DF7\u6392\u5185\u5BB9\u3002\u5173\u95ED\u540E\u4EE5\u666E\u901A\u9644\u4EF6\u65B9\u5F0F\u53D1\u9001\u56FE\u7247\u3002").addToggle((toggle) => toggle.setValue(tgConfig.richTextEnabled !== false).onChange(async (value) => {
          const config = this.plugin.getAdapterConfig("telegram") || {};
          await this.plugin.setAdapterConfig("telegram", { ...config, richTextEnabled: value });
        }));
        new Setting(containerEl).setName("Telegraph \u4F5C\u8005\u540D").setDesc("\u663E\u793A\u5728 Telegraph \u9875\u9762\u4E0A\u7684\u4F5C\u8005\u540D\u79F0\uFF0C\u53EF\u7559\u7A7A\u3002").addText((text) => {
          text.setPlaceholder("Journal Sync").setValue(tgConfig.telegraphAuthorName || "").onChange(async (value) => {
            await this.plugin.setAdapterConfig("telegram", { ...this.plugin.getAdapterConfig("telegram"), telegraphAuthorName: value.trim() });
          });
        });
        const sendScope = this.plugin.settings.sendScope || 2;
        const maxTitleLevel = sendScope === 0 ? 6 : Math.min(6, sendScope);
        const titleLevelDesc = maxTitleLevel === 1 ? "\u5F53\u524D\u53D1\u9001\u5C42\u7EA7\u4E3A 1\uFF0C\u4EC5\u53EF\u4F7F\u7528\u4E00\u7EA7\u6807\u9898\u4F5C\u4E3A Telegraph \u6807\u9898\u3002" : `\u9009\u62E9\u54EA\u4E00\u7EA7\u6807\u9898\u4F5C\u4E3A Telegraph \u9875\u9762\u6807\u9898\uFF081-${maxTitleLevel}\uFF09\u3002\u6B63\u6587\u4E2D\u7684\u6807\u9898\u4F1A\u76F8\u5E94\u504F\u79FB\u3002\u7ED1\u5B9A\u53D1\u9001\u5C42\u7EA7\uFF08\u5F53\u524D: ${sendScope === 0 ? "\u6574\u9875" : sendScope}\uFF09\u3002`;
        new Setting(containerEl).setName("Telegraph \u6807\u9898\u5C42\u7EA7").setDesc(titleLevelDesc).addDropdown((dropdown) => {
          const currentLevel = tgConfig.telegraphTitleLevel || 1;
          for (let lv = 1; lv <= maxTitleLevel; lv++) {
            dropdown.addOption(String(lv), `H${lv}`);
          }
          dropdown.setValue(String(Math.min(currentLevel, maxTitleLevel))).onChange(async (value) => {
            await this.plugin.setAdapterConfig("telegram", { ...this.plugin.getAdapterConfig("telegram"), telegraphTitleLevel: Number(value) });
          });
        });
        new Setting(containerEl).setName("Telegraph \u8D26\u53F7").setDesc(tgConfig.telegraphAccessToken ? "\u5DF2\u8FDE\u63A5\u3002\u53EF\u9A8C\u8BC1\u65B0 token\u3001\u521B\u5EFA\u65B0\u8D26\u53F7\u6216\u590D\u5236\u5F53\u524D token\u3002" : '\u8F93\u5165\u5DF2\u6709 Telegraph token\uFF0C\u6216\u70B9\u51FB"\u521B\u5EFA\u65B0\u8D26\u53F7"\u83B7\u53D6\u3002\u9996\u6B21\u53D1\u9001\u65F6\u4E5F\u4F1A\u81EA\u52A8\u521B\u5EFA\u3002').addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("\u8F93\u5165 Telegraph access_token");
          text.setValue(tgConfig.telegraphAccessToken || "");
          this._telegraphTokenInput = text.inputEl;
        }).addButton((btn) => btn.setButtonText("\u9A8C\u8BC1\u5E76\u4FDD\u5B58").onClick(async () => {
          var _a;
          const token = (((_a = this._telegraphTokenInput) == null ? void 0 : _a.value) || "").trim();
          if (!token) {
            new Notice2("\u8BF7\u5148\u8F93\u5165 token");
            return;
          }
          try {
            btn.setButtonText("\u9A8C\u8BC1\u4E2D...");
            btn.disabled = true;
            const telegraph2 = require_telegraph();
            await telegraph2.getAccountInfo(token, this.plugin.requestUrl.bind(this.plugin));
            await this.plugin.setAdapterConfig("telegram", { ...this.plugin.getAdapterConfig("telegram"), telegraphAccessToken: token });
            new Notice2("Telegraph token \u9A8C\u8BC1\u6210\u529F");
            this.display();
          } catch (error) {
            new Notice2(`Token \u9A8C\u8BC1\u5931\u8D25: ${error.message}`);
          } finally {
            btn.setButtonText("\u9A8C\u8BC1\u5E76\u4FDD\u5B58");
            btn.disabled = false;
          }
        })).addButton((btn) => btn.setButtonText("\u521B\u5EFA\u65B0\u8D26\u53F7").onClick(async () => {
          var _a;
          if (tgConfig.telegraphAccessToken) {
            if (!confirm("\u5DF2\u6709\u8D26\u53F7\u8FDE\u63A5\uFF0C\u521B\u5EFA\u65B0\u8D26\u53F7\u540E\u5C06\u65E0\u6CD5\u7528\u65B0 token \u7F16\u8F91\u65E7\u9875\u9762\u3002\u786E\u5B9A\u7EE7\u7EED\uFF1F")) return;
          }
          try {
            btn.setButtonText("\u521B\u5EFA\u4E2D...");
            btn.disabled = true;
            const telegraph2 = require_telegraph();
            const authorName = ((_a = this.plugin.getAdapterConfig("telegram")) == null ? void 0 : _a.telegraphAuthorName) || "";
            const account = await telegraph2.createAccount("JournalSync", authorName, this.plugin.requestUrl.bind(this.plugin));
            await this.plugin.setAdapterConfig("telegram", { ...this.plugin.getAdapterConfig("telegram"), telegraphAccessToken: account.access_token });
            new Notice2("Telegraph \u8D26\u53F7\u521B\u5EFA\u6210\u529F");
            this.display();
          } catch (error) {
            new Notice2(`Telegraph \u8D26\u53F7\u521B\u5EFA\u5931\u8D25: ${error.message}`);
          } finally {
            btn.setButtonText("\u521B\u5EFA\u65B0\u8D26\u53F7");
            btn.disabled = false;
          }
        })).addButton((btn) => btn.setButtonText("\u590D\u5236 token").setDisabled(!tgConfig.telegraphAccessToken).onClick(() => {
          var _a;
          const token = ((_a = this.plugin.getAdapterConfig("telegram")) == null ? void 0 : _a.telegraphAccessToken) || "";
          if (!token) {
            new Notice2("\u6682\u65E0 token \u53EF\u590D\u5236");
            return;
          }
          navigator.clipboard.writeText(token).then(() => {
            new Notice2("Token \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F");
          }).catch(() => {
            new Notice2("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236");
          });
        }));
      }
      _renderChannelSelection(containerEl, tgConfig) {
        const channels = Array.isArray(tgConfig.channels) ? tgConfig.channels : [];
        if (channels.length === 0) return;
        const groupEl = containerEl.createDiv({ cls: "js-bridge-channel-group" });
        groupEl.createEl("p", { text: "\u9ED8\u8BA4\u53D1\u9001\u9891\u9053\uFF1A", cls: "js-bridge-channel-group-label" });
        const homeChannels = Array.isArray(tgConfig.homeChannels) ? tgConfig.homeChannels.map(String) : [];
        for (const channel of channels) {
          const channelId = String(channel.id);
          const row = groupEl.createDiv({ cls: "js-bridge-channel-row" });
          const checkbox = row.createEl("input", { type: "checkbox", attr: { id: `tg-ch-${channelId}` } });
          checkbox.checked = homeChannels.includes(channelId);
          row.createEl("label", { text: `${channel.title || channelId}${channel.username ? ` (${channel.username})` : ""}`, attr: { for: `tg-ch-${channelId}` } });
          checkbox.addEventListener("change", async () => {
            const config = this.plugin.getAdapterConfig("telegram") || {};
            const selected = Array.isArray(config.homeChannels) ? config.homeChannels.map(String) : [];
            const index = selected.indexOf(channelId);
            if (checkbox.checked && index < 0) selected.push(channelId);
            if (!checkbox.checked && index >= 0) selected.splice(index, 1);
            await this.plugin.setAdapterConfig("telegram", { ...config, homeChannels: selected });
          });
        }
      }
      _renderMastodon(containerEl) {
        this._addEnabledToggle(containerEl, "mastodon", "Mastodon");
        if (!this.plugin.isAdapterEnabled("mastodon")) return;
        const config = this.plugin.getAdapterConfig("mastodon") || {};
        new Setting(containerEl).setName("\u5B9E\u4F8B\u5730\u5740").setDesc("\u4F8B\u5982 https://mastodon.social").addText((text) => text.setPlaceholder("https://mastodon.social").setValue(config.serverUrl || "").onChange(async (value) => this.plugin.setAdapterConfig("mastodon", { ...config, serverUrl: value.trim() })));
        new Setting(containerEl).setName("Access Token").addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("\u4F60\u7684 Mastodon Access Token").setValue(config.accessToken || "").onChange(async (value) => this.plugin.setAdapterConfig("mastodon", { ...config, accessToken: value.trim() }));
        });
        new Setting(containerEl).setName("\u53EF\u89C1\u6027").addDropdown((dropdown) => dropdown.addOption("public", "\u516C\u5F00").addOption("unlisted", "\u4E0D\u5217\u51FA").addOption("private", "\u4EC5\u5173\u6CE8\u8005").setValue(config.visibility || "public").onChange(async (value) => this.plugin.setAdapterConfig("mastodon", { ...config, visibility: value })));
      }
      _renderMisskey(containerEl) {
        this._addEnabledToggle(containerEl, "missky", "Misskey");
        if (!this.plugin.isAdapterEnabled("missky")) return;
        const config = this.plugin.getAdapterConfig("missky") || {};
        new Setting(containerEl).setName("\u5B9E\u4F8B\u5730\u5740").setDesc("\u4F8B\u5982 https://misskey.io").addText((text) => text.setPlaceholder("https://misskey.io").setValue(config.serverUrl || "").onChange(async (value) => this.plugin.setAdapterConfig("missky", { ...config, serverUrl: value.trim() })));
        new Setting(containerEl).setName("API Token").addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("\u4F60\u7684 Misskey API Token").setValue(config.apiToken || "").onChange(async (value) => this.plugin.setAdapterConfig("missky", { ...config, apiToken: value.trim() }));
        });
        new Setting(containerEl).setName("\u53EF\u89C1\u6027").addDropdown((dropdown) => dropdown.addOption("public", "\u516C\u5F00").addOption("home", "\u4E3B\u9875").addOption("followers", "\u4EC5\u5173\u6CE8\u8005").setValue(config.visibility || "public").onChange(async (value) => this.plugin.setAdapterConfig("missky", { ...config, visibility: value })));
      }
      _renderNotion(containerEl) {
        this._addEnabledToggle(containerEl, "notion", "Notion");
        if (!this.plugin.isAdapterEnabled("notion")) return;
        const config = this.plugin.getAdapterConfig("notion") || {};
        new Setting(containerEl).setName("Notion Token").setDesc("\u4F7F\u7528 Notion Personal Access Token\uFF0C\u4EC5\u4FDD\u5B58\u5728 Obsidian \u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u3002").addText((text) => {
          text.inputEl.type = "password";
          text.setPlaceholder("ntn_...").setValue(config.token || "").onChange(async (value) => {
            await this.plugin.setAdapterConfig("notion", { ...this.plugin.getAdapterConfig("notion"), token: value.trim() });
          });
        });
        new Setting(containerEl).setName("\u4FDD\u5B58\u76EE\u6807").setDesc("\u9009\u62E9\u6BCF\u6B21\u53D1\u9001\u521B\u5EFA Notion \u9875\u9762\uFF0C\u6216\u5728 Data Source \u4E2D\u521B\u5EFA\u4E00\u6761\u8BB0\u5F55\u9875\u9762\u3002").addDropdown((dropdown) => dropdown.addOption("page", "\u4FDD\u5B58\u4E3A\u9875\u9762").addOption("database", "\u4FDD\u5B58\u5230\u6570\u636E\u5E93").setValue(config.targetType || "page").onChange(async (value) => {
          await this.plugin.setAdapterConfig("notion", { ...this.plugin.getAdapterConfig("notion"), targetType: value });
          this.display();
        }));
        if ((config.targetType || "page") === "page") {
          new Setting(containerEl).setName("\u65E5\u8BB0\u7236\u9875\u9762 Page ID").setDesc("\u521B\u5EFA\u5B50\u9875\u9762\u6216\u6BCF\u65E5\u9875\u9762\u7684 Notion \u7236\u9875\u9762 ID\u3002\u8BF7\u5148\u5C06\u8BE5\u9875\u9762\u8FDE\u63A5\u5230\u4F60\u7684 Notion Integration\u3002").addText((text) => text.setPlaceholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx").setValue(config.pageId || "").onChange(async (value) => {
            await this.plugin.setAdapterConfig("notion", { ...this.plugin.getAdapterConfig("notion"), pageId: value.trim() });
          }));
          new Setting(containerEl).setName("\u9875\u9762\u5199\u5165\u65B9\u5F0F").setDesc("\u65B0\u5EFA\u5B50\u9875\u9762\u4F1A\u4E3A\u6BCF\u6B21\u53D1\u9001\u521B\u5EFA\u4E00\u4E2A\u9875\u9762\uFF1B\u6BCF\u65E5\u8FFD\u52A0\u4F1A\u67E5\u627E\u6216\u521B\u5EFA\u5F53\u5929 YYYY-MM-DD \u9875\u9762\u5E76\u6301\u7EED\u8FFD\u52A0\u5185\u5BB9\u3002").addDropdown((dropdown) => dropdown.addOption("new_page", "\u6BCF\u6B21\u65B0\u5EFA\u5B50\u9875\u9762").addOption("daily_append", "\u8FFD\u52A0\u5230\u6BCF\u65E5\u65E5\u8BB0\u9875\u9762").setValue(config.pageWriteMode || "new_page").onChange(async (value) => {
            await this.plugin.setAdapterConfig("notion", { ...this.plugin.getAdapterConfig("notion"), pageWriteMode: value });
            this.display();
          }));
          if ((config.pageWriteMode || "new_page") === "new_page") {
            new Setting(containerEl).setName("\u9875\u9762\u6807\u9898\u6765\u6E90").setDesc("\u6309\u53D1\u9001\u8303\u56F4\u6807\u9898\uFF1A\u6807\u9898\u5757\u7528\u8BE5\u6807\u9898\uFF0C\u6574\u9875\u7528\u6587\u4EF6\u540D\uFF0C\u9009\u4E2D\u6587\u672C\u5141\u8BB8\u65E0\u6807\u9898\u3002\u6B63\u6587\u9996\u6807\u9898\uFF1A\u4ECE\u6B63\u6587\u7B2C\u4E00\u4E2A Markdown \u6807\u9898\u53D6\u540D\u3002\u65E0\u6807\u9898\uFF1A\u4E0D\u8BBE\u7F6E\u6807\u9898\u3002").addDropdown((dropdown) => dropdown.addOption("scope", "\u6309\u53D1\u9001\u8303\u56F4\u6807\u9898").addOption("first_heading", "\u6309\u6B63\u6587\u7B2C\u4E00\u4E2A\u6807\u9898").addOption("none", "\u65E0\u6807\u9898").setValue(config.titleSource || "scope").onChange(async (value) => this.plugin.setAdapterConfig("notion", { ...this.plugin.getAdapterConfig("notion"), titleSource: value })));
          }
        } else {
          new Setting(containerEl).setName("Data Source ID").setDesc("\u76EE\u6807 Notion Data Source \u7684 ID\uFF0C\u800C\u4E0D\u662F\u65E7\u7248\u6559\u7A0B\u4E2D\u7684 database ID\u3002").addText((text) => text.setPlaceholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx").setValue(config.dataSourceId || "").onChange(async (value) => {
            await this.plugin.setAdapterConfig("notion", { ...this.plugin.getAdapterConfig("notion"), dataSourceId: value.trim() });
          }));
          new Setting(containerEl).setName("\u8BFB\u53D6\u6807\u9898\u5B57\u6BB5").setDesc(config.titleProperty ? `\u5F53\u524D\u6807\u9898\u5B57\u6BB5\uFF1A${config.titleProperty}` : "\u8BFB\u53D6 Data Source \u540E\u9009\u62E9 title \u7C7B\u578B\u5B57\u6BB5\u3002").addButton((button) => button.setButtonText("\u8BFB\u53D6\u5B57\u6BB5").onClick(async () => {
            try {
              button.setButtonText("\u8BFB\u53D6\u4E2D...");
              button.disabled = true;
              const adapter = this.plugin.adapterRegistry.get("notion");
              const result = await adapter.retrieveDataSource({ config: this.plugin.getAdapterConfig("notion"), requestUrl: this.plugin.requestUrl.bind(this.plugin) });
              if (result.titles.length === 0) throw new Error("\u8BE5 Data Source \u6CA1\u6709 title \u7C7B\u578B\u5B57\u6BB5");
              const activeConfig = this.plugin.getAdapterConfig("notion");
              const selected = result.titles.includes(activeConfig.titleProperty) ? activeConfig.titleProperty : result.titles[0];
              await this.plugin.setAdapterConfig("notion", { ...activeConfig, titleProperty: selected, titleProperties: result.titles });
              new Notice2(`\u5DF2\u8BFB\u53D6 ${result.titles.length} \u4E2A\u6807\u9898\u5B57\u6BB5`);
              this.display();
            } catch (error) {
              new Notice2(`\u8BFB\u53D6 Notion \u5B57\u6BB5\u5931\u8D25\uFF1A${error.message}`);
            } finally {
              button.setButtonText("\u8BFB\u53D6\u5B57\u6BB5");
              button.disabled = false;
            }
          }));
          const titleProperties = Array.isArray(config.titleProperties) ? config.titleProperties : [];
          if (titleProperties.length > 0) {
            new Setting(containerEl).setName("\u6570\u636E\u5E93\u6807\u9898\u5B57\u6BB5").setDesc("\u6BCF\u6761\u6570\u636E\u5E93\u8BB0\u5F55\u5747\u4F1A\u521B\u5EFA\u4E00\u4E2A\u5B8C\u6574\u9875\u9762\uFF0C\u6B63\u6587\u548C\u56FE\u7247\u5199\u5165\u8BE5\u9875\u9762\u7684 blocks\u3002").addDropdown((dropdown) => {
              for (const property of titleProperties) dropdown.addOption(property, property);
              dropdown.setValue(config.titleProperty || titleProperties[0]).onChange(async (value) => {
                await this.plugin.setAdapterConfig("notion", { ...this.plugin.getAdapterConfig("notion"), titleProperty: value });
              });
            });
          }
          new Setting(containerEl).setName("\u9875\u9762\u6807\u9898\u6765\u6E90").setDesc("\u6807\u9898\u5757\u4F7F\u7528\u8BE5\u6807\u9898\uFF0C\u6574\u9875\u4F7F\u7528\u6587\u4EF6\u540D\uFF0C\u9009\u4E2D\u6587\u672C\u5141\u8BB8\u65E0\u6807\u9898\u3002").addDropdown((dropdown) => dropdown.addOption("scope", "\u6309\u53D1\u9001\u8303\u56F4\u6807\u9898").addOption("first_heading", "\u6309\u6B63\u6587\u7B2C\u4E00\u4E2A\u6807\u9898").addOption("none", "\u65E0\u6807\u9898").setValue(config.titleSource || "scope").onChange(async (value) => this.plugin.setAdapterConfig("notion", { ...this.plugin.getAdapterConfig("notion"), titleSource: value })));
        }
        new Setting(containerEl).setName("\u8D85\u8FC7 5 MB \u65F6\u81EA\u52A8\u538B\u7F29\u56FE\u7247").setDesc("\u53D1\u9001\u524D\u5728\u5185\u5B58\u4E2D\u5C06\u53EF\u5904\u7406\u7684 JPEG\u3001PNG\u3001WebP \u538B\u7F29\u4E3A WebP\uFF0C\u4E0D\u4F1A\u4FEE\u6539 Vault \u539F\u6587\u4EF6\u3002GIF \u548C SVG \u4E0D\u538B\u7F29\u3002").addToggle((toggle) => toggle.setValue(Boolean(config.autoCompressLargeImages)).onChange(async (value) => {
          await this.plugin.setAdapterConfig("notion", { ...this.plugin.getAdapterConfig("notion"), autoCompressLargeImages: value });
        }));
      }
      _headingLevelLabel(level) {
        const names = ["\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"];
        const n = Math.min(6, Math.max(1, Number(level) || 1));
        return `${names[n - 1]}\u7EA7\u6807\u9898`;
      }
      _buildChannelDesc(tgConfig) {
        const channels = Array.isArray(tgConfig == null ? void 0 : tgConfig.channels) ? tgConfig.channels : [];
        if (channels.length === 0) return "\u5C1A\u672A\u83B7\u53D6\u9891\u9053\u5217\u8868\uFF0C\u8BF7\u70B9\u51FB\u53F3\u4FA7\u6309\u94AE\u83B7\u53D6";
        return `\u5DF2\u53D1\u73B0 ${channels.length} \u4E2A\u9891\u9053\uFF1A${channels.map((channel) => channel.title || channel.id).join("\u3001")}`;
      }
    };
    module2.exports = JournalSyncSettingTab2;
  }
});

// src/core/content-renderer.js
var content_renderer_exports = {};
__export(content_renderer_exports, {
  createImageEntity: () => createImageEntity,
  default: () => content_renderer_default,
  normalizeRichDraft: () => normalizeRichDraft,
  renderRichContent: () => renderRichContent
});
function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}
function sanitizeImageEntity(rawImage = {}, index = 0) {
  if (!rawImage || typeof rawImage !== "object") return null;
  const filename = String(rawImage.filename || "").trim();
  if (!filename) return null;
  const id = String(rawImage.id || "").trim() || `legacy_${index}_${filename}`;
  return {
    id,
    filename,
    vaultPath: String(rawImage.vaultPath || filename).trim(),
    previewUrl: String(rawImage.previewUrl || "").trim(),
    createdAt: String(rawImage.createdAt || "").trim()
  };
}
function createImageEntity(filename, index = 0) {
  const normalizedFilename = String(filename || "").trim();
  return {
    id: `legacy_${index}_${normalizedFilename}`,
    filename: normalizedFilename,
    vaultPath: normalizedFilename,
    previewUrl: "",
    createdAt: ""
  };
}
function normalizeRichDraft(rawDraft = {}, fallbackContent = "", fallbackImageFilenames = []) {
  const draft = rawDraft && typeof rawDraft === "object" && !Array.isArray(rawDraft) ? rawDraft : {};
  const fallbackImages = (Array.isArray(fallbackImageFilenames) ? fallbackImageFilenames : []).map((filename, index) => createImageEntity(filename, index)).filter((image) => image.filename);
  const images = (Array.isArray(draft.images) ? draft.images : fallbackImages).map((image, index) => sanitizeImageEntity(image, index)).filter(Boolean);
  const blocks = Array.isArray(draft.blocks) ? draft.blocks.map((block) => {
    if (!block || typeof block !== "object") return null;
    if (block.type === "image") {
      const imageId = String(block.imageId || "").trim();
      return imageId ? { type: "image", imageId } : null;
    }
    if (block.type === "text") {
      return { type: "text", text: normalizeText(block.text) };
    }
    return null;
  }).filter(Boolean) : [{ type: "text", text: normalizeText(fallbackContent) }].filter((block) => block.text);
  return { version: 1, blocks, images };
}
function pushTextBlock(blocks, text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return;
  const previous = blocks[blocks.length - 1];
  if ((previous == null ? void 0 : previous.type) === "text") {
    previous.text += normalizedText;
    return;
  }
  blocks.push({ type: "text", text: normalizedText });
}
function buildOrderedBlocks(draft, warnings) {
  const imageById = new Map(draft.images.map((image) => [image.id, image]));
  const referencedIds = /* @__PURE__ */ new Set();
  const ordered = [];
  for (const block of draft.blocks) {
    if (block.type === "text") {
      pushTextBlock(ordered, block.text);
      continue;
    }
    if (block.type !== "image") continue;
    const image = imageById.get(block.imageId);
    if (!image) {
      warnings.push(`\u56FE\u7247 token \u5F15\u7528\u4E0D\u5B58\u5728: ${block.imageId}`);
      continue;
    }
    if (referencedIds.has(image.id)) continue;
    referencedIds.add(image.id);
    ordered.push({ type: "image", image });
  }
  for (const image of draft.images) {
    if (!referencedIds.has(image.id)) {
      ordered.push({ type: "image", image });
      referencedIds.add(image.id);
    }
  }
  return ordered;
}
function renderPlainText(orderedBlocks) {
  return orderedBlocks.filter((block) => block.type === "text").map((block) => block.text).join("").replace(/@图片\d+/g, "").trim();
}
function renderObsidianMarkdown(orderedBlocks) {
  var _a, _b;
  const parts = [];
  for (let index = 0; index < orderedBlocks.length; index += 1) {
    const block = orderedBlocks[index];
    if (block.type === "text") {
      const previousIsImage = ((_a = orderedBlocks[index - 1]) == null ? void 0 : _a.type) === "image";
      const nextIsImage = ((_b = orderedBlocks[index + 1]) == null ? void 0 : _b.type) === "image";
      let text = block.text;
      if (previousIsImage) text = text.replace(/^\s+/, "");
      if (nextIsImage) text = text.replace(/\s+$/, "");
      parts.push(text);
    } else if (block.type === "image") {
      parts.push(`

![[${block.image.filename}]]
`);
    }
  }
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}
function renderTelegramSegments(orderedBlocks) {
  const segments = [];
  for (const block of orderedBlocks) {
    if (block.type === "text") {
      const markdown = block.text.trim();
      if (markdown) segments.push({ type: "richText", markdown });
    } else if (block.type === "image") {
      segments.push({
        type: "image",
        filename: block.image.filename,
        vaultPath: block.image.vaultPath || block.image.filename
      });
    }
  }
  return segments;
}
function renderRichContent({ richDraft, fallbackContent = "", fallbackImageFilenames = [] } = {}) {
  const warnings = [];
  const draft = normalizeRichDraft(richDraft, fallbackContent, fallbackImageFilenames);
  const orderedBlocks = buildOrderedBlocks(draft, warnings);
  const orderedImageFilenames = [];
  const seenFilenames = /* @__PURE__ */ new Set();
  for (const block of orderedBlocks) {
    if (block.type !== "image") continue;
    if (seenFilenames.has(block.image.filename)) continue;
    seenFilenames.add(block.image.filename);
    orderedImageFilenames.push(block.image.filename);
  }
  return {
    plainText: renderPlainText(orderedBlocks),
    obsidianMarkdown: renderObsidianMarkdown(orderedBlocks),
    telegramSegments: renderTelegramSegments(orderedBlocks),
    orderedImageFilenames,
    warnings
  };
}
var content_renderer_default;
var init_content_renderer = __esm({
  "src/core/content-renderer.js"() {
    content_renderer_default = { renderRichContent, normalizeRichDraft, createImageEntity };
  }
});

// src/adapters/flomo.js
var flomo_exports = {};
__export(flomo_exports, {
  default: () => flomo_default,
  execute: () => execute,
  manifest: () => manifest
});
function extractRemoteImageUrls(content) {
  const urls = [];
  const markdownMatches = String(content || "").match(/!\[[^\]]*]\((https?:\/\/[^)]+)\)/g) || [];
  const plainMatches = String(content || "").match(/https?:\/\/[^\s<>"']+/g) || [];
  for (const rawChunk of [...markdownMatches, ...plainMatches]) {
    const rawUrl = rawChunk.startsWith("![") ? rawChunk.replace(/^!\[[^\]]*]\((https?:\/\/[^)]+)\)$/i, "$1") : rawChunk;
    const normalized = String(rawUrl).replace(/[),.!?;:，。！？；：》」』】）]+$/g, "");
    if (!normalized) continue;
    if (!/^https?:\/\//i.test(normalized)) continue;
    if (!/\.(png|jpe?g|gif|webp|heic|heif)(?:$|[?#])/i.test(normalized)) continue;
    if (urls.includes(normalized)) continue;
    urls.push(normalized);
    if (urls.length >= MAX_FLOMO_IMAGES) break;
  }
  return urls;
}
async function execute({ content, apiUrl, requestUrl: requestUrl2 }) {
  const normalizedContent = String(content || "");
  if (!apiUrl) {
    return { success: false, error: "Flomo API URL \u672A\u914D\u7F6E" };
  }
  const imageUrls = extractRemoteImageUrls(normalizedContent);
  const textContent = normalizedContent.replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/!\[\[[^\]]+\]\]/g, "").trim();
  const warnings = [];
  if (!textContent && imageUrls.length === 0) {
    return { success: true, skipped: true, message: "\u6CA1\u6709\u53EF\u53D1\u9001\u5230 flomo \u7684\u5185\u5BB9", warnings };
  }
  try {
    const response = await requestUrl2({
      url: apiUrl.trim(),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...textContent ? { content: textContent } : {},
        ...imageUrls.length > 0 ? { image_urls: imageUrls.slice(0, MAX_FLOMO_IMAGES) } : {}
      }),
      throw: false
    });
    let result = {};
    try {
      if (response.json) {
        result = response.json;
      } else if (response.text) {
        result = JSON.parse(response.text);
      }
    } catch (e) {
    }
    if (!result || typeof result !== "object") {
      result = {};
    }
    const isSuccess = response.status >= 200 && response.status < 300 && result.code === 0;
    return {
      success: isSuccess,
      response: result,
      error: isSuccess ? void 0 : result.message || `HTTP ${response.status}: ${response.text}`,
      warnings
    };
  } catch (error) {
    return { success: false, error: error.message, warnings };
  }
}
var MAX_FLOMO_IMAGES, manifest, flomo_default;
var init_flomo = __esm({
  "src/adapters/flomo.js"() {
    MAX_FLOMO_IMAGES = 9;
    manifest = {
      id: "flomo",
      version: "1.0.0",
      name: "Flomo",
      description: "\u540C\u6B65\u5185\u5BB9\u5230 flomo",
      enabledByDefault: true,
      settings: {
        fields: [
          {
            key: "apiUrl",
            type: "password",
            label: "Flomo API Webhook",
            required: true,
            placeholder: "https://flomoapp.com/iwh/..."
          }
        ]
      }
    };
    flomo_default = { manifest, execute };
  }
});

// src/adapters/telegram.js
var telegram_exports = {};
__export(telegram_exports, {
  default: () => telegram_default,
  execute: () => execute2,
  listChannels: () => listChannels,
  manifest: () => manifest2,
  runAction: () => runAction
});
async function tgApi(botToken, method, body, requestUrlFn) {
  const url = `${TG_API_BASE}/bot${botToken}/${method}`;
  const response = await requestUrlFn({
    url,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    throw: false
  });
  let result = {};
  try {
    result = response.json || {};
  } catch (e) {
  }
  return { status: response.status, result };
}
async function listChannels(botToken, existingChannels = [], requestUrlFn) {
  var _a, _b, _c;
  if (!botToken) throw new Error("Bot Token \u672A\u914D\u7F6E");
  const channelMap = /* @__PURE__ */ new Map();
  const initialChannels = Array.isArray(existingChannels) ? existingChannels : [];
  for (const ch of initialChannels) {
    const chId = String(ch.id || ch);
    if (!chId) continue;
    channelMap.set(chId, {
      id: chId,
      title: ch.title || chId,
      type: ch.type || "channel",
      username: ch.username ? ch.username.startsWith("@") ? ch.username : `@${ch.username}` : null
    });
  }
  try {
    const { status, result } = await tgApi(botToken, "getUpdates", {
      limit: 100,
      allowed_updates: ["channel_post", "my_chat_member", "message"]
    }, requestUrlFn);
    if (status >= 200 && status < 300 && (result == null ? void 0 : result.ok)) {
      for (const update of result.result || []) {
        const chat = ((_a = update.channel_post) == null ? void 0 : _a.chat) || ((_b = update.message) == null ? void 0 : _b.chat) || ((_c = update.my_chat_member) == null ? void 0 : _c.chat);
        if (!chat) continue;
        if (chat.type !== "channel" && chat.type !== "supergroup" && chat.type !== "group") continue;
        const id = String(chat.id);
        channelMap.set(id, {
          id,
          title: chat.title || chat.username || id,
          type: chat.type,
          username: chat.username ? `@${chat.username}` : null
        });
      }
    }
  } catch (e) {
  }
  for (const [chId, chInfo] of Array.from(channelMap.entries())) {
    try {
      const ref = chInfo.username || chId;
      const { status, result } = await tgApi(botToken, "getChat", { chat_id: ref }, requestUrlFn);
      if (status >= 200 && status < 300 && (result == null ? void 0 : result.ok) && result.result) {
        const chat = result.result;
        const actualId = String(chat.id || chId);
        channelMap.set(actualId, {
          id: actualId,
          title: chat.title || chat.username || chInfo.title,
          type: chat.type || "channel",
          username: chat.username ? `@${chat.username}` : chInfo.username || null
        });
      }
    } catch (e) {
    }
  }
  return Array.from(channelMap.values());
}
async function sendSingleTextMessage(botToken, chatId, text, options, requestUrlFn) {
  var _a, _b, _c;
  if (!text || !text.trim()) return { success: true };
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: !(options == null ? void 0 : options.showLinkPreview) }
  };
  const { status, result } = await tgApi(botToken, "sendMessage", body, requestUrlFn);
  if (!result.ok) {
    const errorDesc = String(result.description || ((_a = result.result) == null ? void 0 : _a.description) || "").toUpperCase();
    if (errorDesc.includes("WEBPAGE_CURL_FAILED")) {
      body.link_preview_options = { is_disabled: true };
      const retryRes = await tgApi(botToken, "sendMessage", body, requestUrlFn);
      if (retryRes.result.ok) return { success: true };
    }
    delete body.parse_mode;
    const { status: s2, result: r2 } = await tgApi(botToken, "sendMessage", body, requestUrlFn);
    if (!r2.ok) {
      const errorDesc2 = String(r2.description || ((_b = r2.result) == null ? void 0 : _b.description) || "").toUpperCase();
      if (errorDesc2.includes("WEBPAGE_CURL_FAILED")) {
        body.link_preview_options = { is_disabled: true };
        const finalRes = await tgApi(botToken, "sendMessage", body, requestUrlFn);
        if (finalRes.result.ok) return { success: true };
        return { success: false, error: finalRes.result.description || finalRes.description || `sendMessage \u5931\u8D25: HTTP ${finalRes.status}` };
      }
      return { success: false, error: ((_c = r2.result) == null ? void 0 : _c.description) || r2.description || `sendMessage \u5931\u8D25: HTTP ${s2}` };
    }
  }
  return { success: true };
}
function splitTelegramText(text, maxLength = 4096) {
  const characters = Array.from(String(text || ""));
  const chunks = [];
  let offset = 0;
  while (offset < characters.length) {
    let end = Math.min(offset + maxLength, characters.length);
    if (end < characters.length) {
      const candidate = characters.slice(offset, end).join("");
      const newline = candidate.lastIndexOf("\n");
      const space = candidate.lastIndexOf(" ");
      const boundary = Math.max(newline, space);
      if (boundary >= Math.floor(maxLength * 0.6)) end = offset + Array.from(candidate.slice(0, boundary)).length;
    }
    chunks.push(characters.slice(offset, end).join("").trim());
    offset = end;
    while (offset < characters.length && /\s/.test(characters[offset])) offset += 1;
  }
  return chunks.filter(Boolean);
}
async function sendTextMessage(botToken, chatId, text, options, requestUrlFn) {
  for (const chunk of splitTelegramText(text)) {
    const result = await sendSingleTextMessage(botToken, chatId, chunk, options, requestUrlFn);
    if (!result.success) return result;
  }
  return { success: true };
}
function richCharacterCount(text) {
  return Array.from(String(text || "")).length;
}
async function sendPhotoByBuffer(botToken, chatId, arrayBuffer, filename, caption, requestUrlFn) {
  const boundary = `----TgBridge${Date.now()}${Math.random().toString(16).slice(2)}`;
  const ext = filename.split(".").pop().toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
  const encoder = new TextEncoder();
  const parts = [];
  parts.push(encoder.encode(
    `--${boundary}\r
Content-Disposition: form-data; name="chat_id"\r
\r
${chatId}\r
`
  ));
  const safeFilename = `image.${ext}`;
  parts.push(encoder.encode(
    `--${boundary}\r
Content-Disposition: form-data; name="photo"; filename="${safeFilename}"\r
Content-Type: ${mime}\r
\r
`
  ));
  parts.push(new Uint8Array(arrayBuffer));
  parts.push(encoder.encode("\r\n"));
  if (caption && caption.trim()) {
    parts.push(encoder.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="caption"\r
\r
${caption.trim()}\r
`
    ));
    parts.push(encoder.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="parse_mode"\r
\r
Markdown\r
`
    ));
  }
  parts.push(encoder.encode(`--${boundary}--\r
`));
  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  const url = `${TG_API_BASE}/bot${botToken}/sendPhoto`;
  const response = await requestUrlFn({
    url,
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: body.buffer.slice(0, totalLength),
    throw: false
  });
  let result = {};
  try {
    result = response.json || {};
  } catch (e) {
  }
  return { status: response.status, result };
}
async function sendMediaGroupByBuffer(botToken, chatId, imageItems, caption, requestUrlFn) {
  const boundary = `----TgBridgeMedia${Date.now()}${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  const parts = [];
  parts.push(encoder.encode(
    `--${boundary}\r
Content-Disposition: form-data; name="chat_id"\r
\r
${chatId}\r
`
  ));
  const mediaList = imageItems.map((item, idx) => {
    const entry = { type: "photo", media: `attach://photo${idx}` };
    if (idx === 0 && caption && caption.trim()) {
      entry.caption = caption.trim();
      entry.parse_mode = "Markdown";
    }
    return entry;
  });
  parts.push(encoder.encode(
    `--${boundary}\r
Content-Disposition: form-data; name="media"\r
\r
${JSON.stringify(mediaList)}\r
`
  ));
  imageItems.forEach((item, idx) => {
    const filename = item.filename || `photo${idx}.jpg`;
    const ext = filename.split(".").pop().toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
    const safeFilename = `image${idx}.${ext}`;
    parts.push(encoder.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="photo${idx}"; filename="${safeFilename}"\r
Content-Type: ${mime}\r
\r
`
    ));
    parts.push(new Uint8Array(item.buffer));
    parts.push(encoder.encode("\r\n"));
  });
  parts.push(encoder.encode(`--${boundary}--\r
`));
  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  const url = `${TG_API_BASE}/bot${botToken}/sendMediaGroup`;
  const response = await requestUrlFn({
    url,
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: body.buffer.slice(0, totalLength),
    throw: false
  });
  let result = {};
  try {
    result = response.json || {};
  } catch (e) {
  }
  return { status: response.status, result, _bodyObj: { caption } };
}
function getImageMimeType(filename = "") {
  const ext = String(filename).split(".").pop().toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}
function buildRichMarkdown(parts) {
  const isPlainText = (block) => {
    const firstLine = block.split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
    const patterns = [
      /^#{1,6}\s+/,
      /^>/,
      /^([-*+]\s+|\d+[.)]\s+)/,
      /^- \[[ xX]\]\s+/,
      /^```/,
      /^\|/,
      /^---+$/,
      /^!\[[^\]]*\]\((?:https?:\/\/|tg:\/\/photo\?id=)[^)]+\)$/,
      /^<(\/?)(p|h[1-6]|blockquote|ul|ol|li|pre|hr|figure|img|video|audio|tg-)\b/
    ];
    return !patterns.some((pattern) => pattern.test(firstLine));
  };
  let richText2 = "";
  let previousIsPlainText = false;
  for (const part of parts) {
    const normalized = String(part || "").replace(/\r\n/g, "\n").trim();
    if (!normalized) continue;
    for (const block of normalized.split(/\n{2,}/)) {
      const current = block.trim();
      if (!current) continue;
      const currentIsPlainText = isPlainText(current);
      if (richText2) {
        richText2 += "\n\n";
        if (previousIsPlainText && currentIsPlainText) richText2 += "<p>&nbsp;</p>\n\n";
      }
      richText2 += current;
      previousIsPlainText = currentIsPlainText;
    }
  }
  return richText2;
}
async function sendRichMessageWithMedia(botToken, chatId, segments, imageBuffers, requestUrlFn) {
  const boundary = `----TgBridgeRich${Date.now()}${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  const parts = [];
  const media = [];
  const richParts = [];
  let imageIndex = 0;
  for (const seg of segments) {
    if (seg.type === "richText" || seg.type === "text") {
      const text = String(seg.markdown || seg.text || "").trim();
      if (text) richParts.push(text);
      continue;
    }
    if (seg.type !== "image") continue;
    const imageKey = seg.imageKey || seg.vaultPath || seg.filename;
    const buffer = imageBuffers.get(imageKey);
    if (!buffer) continue;
    const mediaId = `image_${imageIndex + 1}`;
    const attachmentName = `file_${imageIndex + 1}`;
    const filename = seg.filename || `image_${imageIndex + 1}.jpg`;
    richParts.push(`![](tg://photo?id=${mediaId})`);
    media.push({
      id: mediaId,
      media: { type: "photo", media: `attach://${attachmentName}` }
    });
    parts.push({ attachmentName, filename, buffer });
    imageIndex += 1;
  }
  const markdown = buildRichMarkdown(richParts);
  if (!markdown) return { success: false, error: "\u5BCC\u6587\u672C\u5185\u5BB9\u4E3A\u7A7A\uFF0C\u672A\u53D1\u9001 Telegram \u6D88\u606F" };
  if (richCharacterCount(markdown) > 32768) {
    return { success: false, error: "Telegram \u5BCC\u6587\u672C\u8D85\u8FC7 32768 \u5B57\u7B26\u9650\u5236" };
  }
  if (media.length > 50) {
    return { success: false, error: "Telegram \u5BCC\u6587\u672C\u8D85\u8FC7 50 \u4E2A\u5A92\u4F53\u9644\u4EF6\u9650\u5236" };
  }
  const formParts = [];
  formParts.push(encoder.encode(`--${boundary}\r
Content-Disposition: form-data; name="chat_id"\r
\r
${chatId}\r
`));
  formParts.push(encoder.encode(`--${boundary}\r
Content-Disposition: form-data; name="rich_message"\r
\r
${JSON.stringify({ markdown, media })}\r
`));
  for (const file of parts) {
    formParts.push(encoder.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="${file.attachmentName}"; filename="${file.filename.replace(/[\\\"\r\n]/g, "_")}"\r
Content-Type: ${getImageMimeType(file.filename)}\r
\r
`
    ));
    formParts.push(new Uint8Array(file.buffer));
    formParts.push(encoder.encode("\r\n"));
  }
  formParts.push(encoder.encode(`--${boundary}--\r
`));
  const totalLength = formParts.reduce((sum, part) => sum + part.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of formParts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  const response = await requestUrlFn({
    url: `${TG_API_BASE}/bot${botToken}/sendRichMessage`,
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: body.buffer.slice(0, totalLength),
    throw: false
  });
  let result = {};
  try {
    result = response.json || {};
  } catch (e) {
  }
  return { success: Boolean(result.ok), status: response.status, result, markdown };
}
async function sendRichContent(botToken, chatId, segments, imageBuffers, config, requestUrlFn, isRichText = true) {
  var _a, _b, _c, _d;
  try {
    if (isRichText) {
      const nativeResult = await sendRichMessageWithMedia(botToken, chatId, segments, imageBuffers, requestUrlFn);
      if (nativeResult.success) return { success: true };
      return {
        success: false,
        error: ((_a = nativeResult.result) == null ? void 0 : _a.description) || ((_c = (_b = nativeResult.result) == null ? void 0 : _b.result) == null ? void 0 : _c.description) || `sendRichMessage \u5931\u8D25: HTTP ${nativeResult.status}`
      };
    }
    let textPart = "";
    const imageItems = [];
    for (const seg of segments) {
      if (seg.type === "richText" || seg.type === "text") {
        const t = String(seg.markdown || seg.text || "").trim();
        if (t) textPart = textPart ? `${textPart}

${t}` : t;
      } else if (seg.type === "image" && seg.filename) {
        const buf = imageBuffers.get(seg.imageKey || seg.vaultPath || seg.filename);
        if (buf) {
          imageItems.push({ filename: seg.filename, buffer: buf });
        }
      }
    }
    if (imageItems.length === 0) {
      return await sendTextMessage(botToken, chatId, textPart, config, requestUrlFn);
    }
    const caption = richCharacterCount(textPart) <= 1024 ? textPart : "";
    let textToSendSeparately = caption ? "" : textPart;
    const sendImages = async (items, mediaCaption) => {
      if (items.length === 1) {
        return sendPhotoByBuffer(
          botToken,
          chatId,
          items[0].buffer,
          items[0].filename,
          mediaCaption,
          requestUrlFn
        );
      }
      return sendMediaGroupByBuffer(botToken, chatId, items, mediaCaption, requestUrlFn);
    };
    const chunks = [];
    for (let index = 0; index < imageItems.length; ) {
      const remaining = imageItems.length - index;
      const size = remaining === 1 ? 1 : Math.min(10, remaining);
      chunks.push(imageItems.slice(index, index + size));
      index += size;
    }
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const chunkCaption = index === 0 ? caption : "";
      let { status, result } = await sendImages(chunk, chunkCaption);
      if (!(result == null ? void 0 : result.ok) && chunkCaption) {
        const retry = await sendImages(chunk, "");
        if ((_d = retry.result) == null ? void 0 : _d.ok) {
          textToSendSeparately = textPart;
          status = retry.status;
          result = retry.result;
        }
      }
      if (!(result == null ? void 0 : result.ok)) {
        const method = chunk.length === 1 ? "sendPhoto" : "sendMediaGroup";
        return { success: false, error: (result == null ? void 0 : result.description) || `${method} \u5931\u8D25: HTTP ${status}` };
      }
    }
    if (textToSendSeparately) {
      const textResult = await sendTextMessage(botToken, chatId, textToSendSeparately, config, requestUrlFn);
      if (!textResult.success) return textResult;
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
async function execute2({ content, config, telegramSegments, requestUrl: requestUrl2, readImageFile, channelId, channelIds, isRichText = true }) {
  var _a;
  const botToken = config == null ? void 0 : config.botToken;
  if (!botToken) {
    return { success: false, error: "Telegram Bot Token \u672A\u914D\u7F6E" };
  }
  const targets = Array.isArray(channelIds) && channelIds.length > 0 ? channelIds.map(String) : channelId ? [String(channelId)] : [];
  if (targets.length === 0) {
    const homeChannelIds = Array.isArray(config.homeChannels) ? config.homeChannels.map(String) : [];
    const configuredChannels = Array.isArray(config.channels) ? config.channels : [];
    const firstHomeChannel = homeChannelIds.find(Boolean);
    const firstKnownChannel = (_a = configuredChannels.find((c) => c == null ? void 0 : c.id)) == null ? void 0 : _a.id;
    if (firstHomeChannel || firstKnownChannel) {
      targets.push(String(firstHomeChannel || firstKnownChannel));
    }
  }
  if (targets.length === 0) {
    return { success: false, error: "Telegram \u9891\u9053\u672A\u914D\u7F6E\uFF0C\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u83B7\u53D6\u9891\u9053\u5217\u8868" };
  }
  const segments = Array.isArray(telegramSegments) && telegramSegments.length > 0 ? telegramSegments : [{ type: "richText", markdown: String(content || "").trim() }];
  const imageBuffers = /* @__PURE__ */ new Map();
  const missingImages = /* @__PURE__ */ new Set();
  for (const seg of segments) {
    const imageKey = seg.vaultPath || seg.filename;
    if (seg.type !== "image" || !seg.filename || !imageKey || imageBuffers.has(imageKey) || missingImages.has(imageKey)) continue;
    if (typeof readImageFile !== "function") {
      missingImages.add(imageKey);
      continue;
    }
    try {
      const buffer = await readImageFile(imageKey);
      if (buffer) imageBuffers.set(imageKey, buffer);
      else missingImages.add(imageKey);
    } catch (e) {
      missingImages.add(imageKey);
    }
  }
  if (missingImages.size > 0) {
    return {
      success: false,
      error: `\u65E0\u6CD5\u8BFB\u53D6 Telegram \u56FE\u7247\uFF1A${Array.from(missingImages).join("\u3001")}`
    };
  }
  const resolvedSegments = segments.map((segment) => {
    if (segment.type !== "image") return segment;
    return { ...segment, imageKey: segment.vaultPath || segment.filename };
  });
  const results = await Promise.all(targets.map(async (targetCh) => {
    try {
      const res = await sendRichContent(botToken, targetCh, resolvedSegments, imageBuffers, config, requestUrl2, isRichText);
      return { channelId: targetCh, ...res };
    } catch (error) {
      return { success: false, channelId: targetCh, error: error.message || String(error) };
    }
  }));
  const allOk = results.every((result) => result.success);
  const errors = results.filter((result) => !result.success).map((result) => `${result.channelId}: ${result.error || result.message || "\u672A\u77E5\u9519\u8BEF"}`).join("; ");
  return {
    success: allOk,
    error: allOk ? void 0 : errors,
    results
  };
}
async function runAction(actionId, config, requestUrlFn) {
  if (actionId === "discoverChannels" || actionId === "testConnection") {
    const channels = await listChannels(config.botToken, config.channels || [], requestUrlFn);
    return {
      success: true,
      message: channels.length > 0 ? `\u627E\u5230 ${channels.length} \u4E2A\u53EF\u7528\u9891\u9053` : "\u8FDE\u63A5\u6210\u529F\uFF0C\u4F46\u6682\u672A\u53D1\u73B0\u53EF\u7528\u9891\u9053",
      data: { channels }
    };
  }
  throw new Error(`\u672A\u77E5\u64CD\u4F5C: ${actionId}`);
}
var TG_API_BASE, manifest2, telegram_default;
var init_telegram = __esm({
  "src/adapters/telegram.js"() {
    TG_API_BASE = "https://api.telegram.org";
    manifest2 = {
      id: "telegram",
      version: "2.0.0",
      name: "Telegram",
      description: "\u53D1\u9001\u5185\u5BB9\u5230 Telegram \u9891\u9053",
      enabledByDefault: false,
      settings: {
        fields: [
          {
            key: "botToken",
            type: "password",
            label: "Bot Token",
            required: true,
            placeholder: "\u8F93\u5165\u4F60\u7684 Telegram Bot Token"
          },
          {
            key: "channels",
            type: "info",
            label: "\u9891\u9053\u5217\u8868",
            description: "\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u70B9\u51FB\u300C\u83B7\u53D6\u9891\u9053\u5217\u8868\u300D\u6309\u94AE\u81EA\u52A8\u53D1\u73B0"
          },
          {
            key: "homeChannels",
            type: "checkboxGroup",
            label: "\u9ED8\u8BA4\u53D1\u9001\u9891\u9053",
            description: "\u52FE\u9009\u5728\u53D1\u9001\u9762\u677F\u4E2D\u9ED8\u8BA4\u51FA\u73B0\u7684\u9891\u9053"
          },
          {
            key: "showLinkPreview",
            type: "boolean",
            label: "\u666E\u901A\u53D1\u9001\u65F6\u663E\u793A\u7F51\u5740\u9884\u89C8",
            description: "\u5173\u95ED\u540E\uFF0CTelegram \u666E\u901A\u6587\u672C\u6D88\u606F\u4E0D\u4F1A\u5C55\u5F00\u7F51\u5740\u9884\u89C8\u3002",
            default: true
          }
        ]
      }
    };
    telegram_default = { manifest: manifest2, execute: execute2, listChannels, runAction };
  }
});

// src/adapters/mastodon.js
var mastodon_exports = {};
__export(mastodon_exports, {
  default: () => mastodon_default,
  execute: () => execute3,
  manifest: () => manifest3
});
function getMimeType(filename) {
  const ext = String(filename || "").split(".").pop().toLowerCase();
  const mimeTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    svg: "image/svg+xml"
  };
  return mimeTypes[ext] || "application/octet-stream";
}
async function uploadImageToMastodon(arrayBuffer, filename, baseUrl, accessToken, requestUrl2) {
  const safeFilename = String(filename || "image").replace(/["\r\n]/g, "_");
  const mimeType = getMimeType(filename);
  const boundary = `----MastodonBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  const parts = [];
  parts.push(encoder.encode(
    `--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r
Content-Type: ${mimeType}\r
\r
`
  ));
  parts.push(new Uint8Array(arrayBuffer));
  parts.push(encoder.encode(`\r
--${boundary}--\r
`));
  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  const response = await requestUrl2({
    url: `${baseUrl}/api/v1/media`,
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    // requestUrl accepts string or ArrayBuffer; pass the exact binary range.
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    throw: false
  });
  let result = {};
  try {
    result = response.json || {};
  } catch (e) {
  }
  if (response.status < 200 || response.status >= 300) {
    const message = result.error || result.description || response.text || `HTTP ${response.status}`;
    return { id: null, error: String(message).trim() || `HTTP ${response.status}` };
  }
  if (!result.id) {
    return { id: null, error: "Mastodon \u672A\u8FD4\u56DE\u5A92\u4F53 ID" };
  }
  return { id: result.id, error: "" };
}
async function execute3({ content, serverUrl, accessToken, visibility = "public", requestUrl: requestUrl2, images = [], readImageFile }) {
  var _a;
  if (!serverUrl || !accessToken) {
    return { success: false, error: "Mastodon \u5B9E\u4F8B\u5730\u5740\u6216 Access Token \u672A\u914D\u7F6E" };
  }
  const normalizedContent = String(content || "").trim();
  const textContent = normalizedContent.replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/!\[\[[^\]]+\]\]/g, "").trim();
  const baseUrl = String(serverUrl).trim().replace(/\/+$/, "");
  const warnings = [];
  try {
    const mediaIds = [];
    const imageList = Array.isArray(images) ? images.filter(Boolean) : [];
    if (imageList.length > MAX_MASTODON_IMAGES) {
      return {
        success: false,
        error: `Mastodon \u5355\u6761\u6700\u591A\u652F\u6301 ${MAX_MASTODON_IMAGES} \u5F20\u56FE\u7247\uFF0C\u672C\u6B21\u9009\u62E9\u4E86 ${imageList.length} \u5F20\uFF1B\u672A\u53D1\u9001\u4EFB\u4F55\u5185\u5BB9\u3002`
      };
    }
    for (const filename of imageList) {
      try {
        const buffer = typeof readImageFile === "function" ? await readImageFile(filename) : null;
        if (!buffer) {
          return { success: false, error: `\u56FE\u7247\u8BFB\u53D6\u5931\u8D25\uFF1A${filename}\uFF1B\u672A\u53D1\u9001\u4EFB\u4F55\u5185\u5BB9\u3002` };
        }
        const uploadResult = await uploadImageToMastodon(buffer, filename, baseUrl, accessToken, requestUrl2);
        if (!uploadResult.id) {
          return {
            success: false,
            error: `\u56FE\u7247\u4E0A\u4F20\u5931\u8D25\uFF1A${filename}${uploadResult.error ? `\uFF08${uploadResult.error}\uFF09` : ""}\uFF1B\u672A\u53D1\u9001\u4EFB\u4F55\u5185\u5BB9\u3002`
          };
        }
        mediaIds.push(uploadResult.id);
      } catch (error) {
        return { success: false, error: `\u56FE\u7247\u5904\u7406\u5931\u8D25\uFF1A${filename}\uFF08${error.message || String(error)}\uFF09\uFF1B\u672A\u53D1\u9001\u4EFB\u4F55\u5185\u5BB9\u3002` };
      }
    }
    if (!textContent && mediaIds.length === 0) {
      return { success: false, error: "\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A" };
    }
    const response = await requestUrl2({
      url: `${baseUrl}/api/v1/statuses`,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        status: textContent || "\u{1F4F7}",
        visibility,
        ...mediaIds.length > 0 ? { media_ids: mediaIds } : {}
      }),
      throw: false
    });
    if (response.status >= 200 && response.status < 300) {
      let result = {};
      try {
        result = response.json;
      } catch (e) {
      }
      return { success: true, url: result.url || "", mediaCount: mediaIds.length, warnings };
    } else {
      let errMsg = "";
      try {
        errMsg = ((_a = response.json) == null ? void 0 : _a.error) || response.text || `HTTP ${response.status}`;
      } catch (e) {
        errMsg = `HTTP ${response.status}`;
      }
      return { success: false, error: errMsg, warnings };
    }
  } catch (error) {
    return { success: false, error: error.message, warnings };
  }
}
var manifest3, MAX_MASTODON_IMAGES, mastodon_default;
var init_mastodon = __esm({
  "src/adapters/mastodon.js"() {
    manifest3 = {
      id: "mastodon",
      version: "1.0.0",
      name: "Mastodon",
      description: "\u53D1\u5E03\u5185\u5BB9\u5230 Mastodon",
      enabledByDefault: false,
      settings: {
        fields: [
          {
            key: "serverUrl",
            type: "text",
            label: "Mastodon \u5B9E\u4F8B\u5730\u5740",
            required: true,
            placeholder: "https://mastodon.social"
          },
          {
            key: "accessToken",
            type: "password",
            label: "Access Token",
            required: true,
            placeholder: "\u4F60\u7684 Mastodon Access Token"
          },
          {
            key: "visibility",
            type: "select",
            label: "\u53EF\u89C1\u6027",
            options: [
              { value: "public", label: "\u516C\u5F00" },
              { value: "unlisted", label: "\u4E0D\u5217\u51FA" },
              { value: "private", label: "\u4EC5\u5173\u6CE8\u8005" },
              { value: "direct", label: "\u79C1\u4FE1" }
            ],
            default: "public"
          }
        ]
      }
    };
    MAX_MASTODON_IMAGES = 4;
    mastodon_default = { manifest: manifest3, execute: execute3 };
  }
});

// src/adapters/missky.js
var missky_exports = {};
__export(missky_exports, {
  default: () => missky_default,
  execute: () => execute4,
  manifest: () => manifest4
});
function getMimeType2(filename) {
  const ext = String(filename || "").split(".").pop().toLowerCase();
  const mimeTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    svg: "image/svg+xml"
  };
  return mimeTypes[ext] || "application/octet-stream";
}
async function uploadImageToMissky(arrayBuffer, filename, baseUrl, apiToken, requestUrl2) {
  const safeFilename = String(filename || "image").replace(/["\r\n]/g, "_");
  const mimeType = getMimeType2(filename);
  const boundary = `----MisskeyBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  const parts = [];
  parts.push(encoder.encode(
    `--${boundary}\r
Content-Disposition: form-data; name="i"\r
\r
${apiToken}\r
`
  ));
  parts.push(encoder.encode(
    `--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r
Content-Type: ${mimeType}\r
\r
`
  ));
  parts.push(new Uint8Array(arrayBuffer));
  parts.push(encoder.encode(`\r
--${boundary}--\r
`));
  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  const response = await requestUrl2({
    url: `${baseUrl}/api/drive/files/create`,
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: body.buffer.slice(0, totalLength),
    throw: false
  });
  if (response.status < 200 || response.status >= 300) {
    return null;
  }
  const result = response.json || {};
  return result.id || null;
}
async function execute4({ content, serverUrl, apiToken, visibility = "public", requestUrl: requestUrl2, images = [], readImageFile }) {
  var _a, _b, _c;
  if (!serverUrl || !apiToken) {
    return { success: false, error: "Misskey \u5B9E\u4F8B\u5730\u5740\u6216 API Token \u672A\u914D\u7F6E" };
  }
  const normalizedContent = String(content || "").trim();
  const textContent = normalizedContent.replace(/!\[[^\]]*\]\([^)]+\)/g, "").replace(/!\[\[[^\]]+\]\]/g, "").trim();
  const baseUrl = String(serverUrl).trim().replace(/\/+$/, "");
  const warnings = [];
  try {
    const fileIds = [];
    const imageList = Array.isArray(images) ? images.filter(Boolean) : [];
    for (const filename of imageList) {
      try {
        const buffer = typeof readImageFile === "function" ? await readImageFile(filename) : null;
        if (!buffer) {
          warnings.push(`\u56FE\u7247\u8BFB\u53D6\u5931\u8D25\uFF0C\u5DF2\u8DF3\u8FC7\uFF1A${filename}`);
          continue;
        }
        const fileId = await uploadImageToMissky(buffer, filename, baseUrl, apiToken, requestUrl2);
        if (fileId) {
          fileIds.push(fileId);
        } else {
          warnings.push(`\u56FE\u7247\u4E0A\u4F20\u5931\u8D25\uFF0C\u5DF2\u8DF3\u8FC7\uFF1A${filename}`);
        }
      } catch (error) {
        warnings.push(`\u56FE\u7247\u5904\u7406\u5931\u8D25\uFF0C\u5DF2\u8DF3\u8FC7\uFF1A${filename}`);
      }
    }
    if (!textContent && fileIds.length === 0) {
      return { success: false, error: "\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A" };
    }
    const response = await requestUrl2({
      url: `${baseUrl}/api/notes/create`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        i: apiToken,
        ...textContent ? { text: textContent } : {},
        visibility,
        ...fileIds.length > 0 ? { fileIds } : {}
      }),
      throw: false
    });
    if (response.status >= 200 && response.status < 300) {
      let result = {};
      try {
        result = response.json;
      } catch (e) {
      }
      return { success: true, noteId: ((_a = result.createdNote) == null ? void 0 : _a.id) || "", mediaCount: fileIds.length, warnings };
    } else {
      let errMsg = "";
      try {
        errMsg = ((_c = (_b = response.json) == null ? void 0 : _b.error) == null ? void 0 : _c.message) || response.text || `HTTP ${response.status}`;
      } catch (e) {
        errMsg = `HTTP ${response.status}`;
      }
      return { success: false, error: errMsg, warnings };
    }
  } catch (error) {
    return { success: false, error: error.message, warnings };
  }
}
var manifest4, missky_default;
var init_missky = __esm({
  "src/adapters/missky.js"() {
    manifest4 = {
      id: "missky",
      version: "1.0.0",
      name: "Misskey",
      description: "\u53D1\u5E03\u5185\u5BB9\u5230 Misskey / Calckey / Firefish \u5B9E\u4F8B",
      enabledByDefault: false,
      settings: {
        fields: [
          {
            key: "serverUrl",
            type: "text",
            label: "Misskey \u5B9E\u4F8B\u5730\u5740",
            required: true,
            placeholder: "https://misskey.io"
          },
          {
            key: "apiToken",
            type: "password",
            label: "API Token",
            required: true,
            placeholder: "\u4F60\u7684 Misskey API Token"
          },
          {
            key: "visibility",
            type: "select",
            label: "\u53EF\u89C1\u6027",
            options: [
              { value: "public", label: "\u516C\u5F00" },
              { value: "home", label: "\u4E3B\u9875" },
              { value: "followers", label: "\u4EC5\u5173\u6CE8\u8005" },
              { value: "specified", label: "\u79C1\u4FE1" }
            ],
            default: "public"
          }
        ]
      }
    };
    missky_default = { manifest: manifest4, execute: execute4 };
  }
});

// src/adapters/notion.js
var notion_exports = {};
__export(notion_exports, {
  default: () => notion_default,
  execute: () => execute5,
  manifest: () => manifest5,
  retrieveDataSource: () => retrieveDataSource
});
function getResponseError(response) {
  const json = (response == null ? void 0 : response.json) || {};
  return json.message || json.error || (response == null ? void 0 : response.text) || `HTTP ${(response == null ? void 0 : response.status) || "\u672A\u77E5"}`;
}
function getHeader(response, name) {
  const headers = response == null ? void 0 : response.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || "";
}
function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
async function notionRequest(requestUrl2, token, options, retryCount = 0) {
  const response = await requestUrl2({
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      ...options.headers || {}
    },
    throw: false
  });
  if ((response.status === 429 || response.status === 529) && retryCount < MAX_RETRIES) {
    const retryAfter = Number(getHeader(response, "Retry-After"));
    await wait(Math.max(1e3, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1e3 : 1e3 * (retryCount + 1)));
    return notionRequest(requestUrl2, token, options, retryCount + 1);
  }
  return response;
}
function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}
function pageTitleProperty(title) {
  return { title: { title: richText(title || "\u200B") } };
}
function splitText(text, maxLength = 1900) {
  const value = String(text || "");
  if (!value) return [""];
  const result = [];
  let remaining = value;
  while (remaining.length > maxLength) {
    let at = remaining.lastIndexOf("\n", maxLength);
    if (at < Math.floor(maxLength * 0.6)) at = remaining.lastIndexOf(" ", maxLength);
    if (at < Math.floor(maxLength * 0.6)) at = maxLength;
    result.push(remaining.slice(0, at));
    remaining = remaining.slice(at).replace(/^\s+/, "");
  }
  result.push(remaining);
  return result;
}
function richText(text) {
  return splitText(text).filter(Boolean).map((content) => ({ type: "text", text: { content } }));
}
function heading(level, text) {
  const type = `heading_${level}`;
  return { object: "block", type, [type]: { rich_text: richText(text) } };
}
function quote(text) {
  return { object: "block", type: "quote", quote: { rich_text: richText(text) } };
}
function code(text, language = "plain text") {
  return { object: "block", type: "code", code: { rich_text: richText(text), language } };
}
function divider() {
  return { object: "block", type: "divider", divider: {} };
}
function listItem(type, text, checked) {
  const value = { rich_text: richText(text) };
  if (type === "to_do") value.checked = Boolean(checked);
  return { object: "block", type, [type]: value };
}
function parseInline(text) {
  const parts = [];
  const pattern = /(\[([^\]]+)]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_)/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ type: "text", text: { content: text.slice(cursor, match.index) } });
    if (match[2]) parts.push({ type: "text", text: { content: match[2], link: { url: match[3] } } });
    else if (match[4]) parts.push({ type: "text", text: { content: match[4] }, annotations: { code: true } });
    else if (match[5] || match[6]) parts.push({ type: "text", text: { content: match[5] || match[6] }, annotations: { bold: true } });
    else if (match[7]) parts.push({ type: "text", text: { content: match[7] }, annotations: { strikethrough: true } });
    else parts.push({ type: "text", text: { content: match[8] || match[9] }, annotations: { italic: true } });
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) parts.push({ type: "text", text: { content: text.slice(cursor) } });
  return parts.length ? parts : richText(text);
}
function textBlock(type, text, extra = {}) {
  return { object: "block", type, [type]: { rich_text: parseInline(text), ...extra } };
}
function normalizeImageCandidate(image) {
  if (!image || typeof image !== "object") return null;
  if (image.kind === "external" && /^https?:\/\//i.test(image.url || "")) return { kind: "external", url: image.url };
  if (image.kind === "local" && image.fileUploadId) return { kind: "file_upload", fileUploadId: image.fileUploadId };
  return null;
}
function imageBlock(image) {
  const candidate = normalizeImageCandidate(image);
  if (!candidate) return null;
  const value = candidate.kind === "external" ? { type: "external", external: { url: candidate.url } } : { type: "file_upload", file_upload: { id: candidate.fileUploadId } };
  return { object: "block", type: "image", image: value };
}
function markdownToBlocks(markdown, imagesByToken = {}) {
  const blocks = [];
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  let paragraphLines = [];
  const flushParagraph = () => {
    const text = paragraphLines.join("\n").trim();
    if (!text) {
      paragraphLines = [];
      return;
    }
    const parts = text.split(/(@图片\d+|!\[[^\]]*]\(https?:\/\/[^)]+\))/i);
    for (const part of parts) {
      const imageToken = part.match(/^@图片(\d+)$/);
      const externalImage = part.match(/^!\[[^\]]*]\((https?:\/\/[^)]+)\)$/i);
      if (imageToken && imagesByToken[imageToken[1]]) {
        const block = imageBlock(imagesByToken[imageToken[1]]);
        if (block) blocks.push(block);
      } else if (externalImage) {
        const block = imageBlock({ kind: "external", url: externalImage[1] });
        if (block) blocks.push(block);
      } else if (part.trim()) {
        blocks.push(textBlock("paragraph", part.trim()));
      }
    }
    paragraphLines = [];
  };
  while (index < lines.length) {
    const line = lines[index];
    const externalImage = line.trim().match(/^!\[[^\]]*]\((https?:\/\/[^)]+)\)$/i);
    if (externalImage) {
      flushParagraph();
      const block = imageBlock({ kind: "external", url: externalImage[1] });
      if (block) blocks.push(block);
      index += 1;
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push(heading(headingMatch[1].length, headingMatch[2]));
      index += 1;
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph();
      blocks.push(divider());
      index += 1;
      continue;
    }
    if (/^```/.test(line)) {
      flushParagraph();
      const language = line.replace(/^```/, "").trim() || "plain text";
      index += 1;
      const codeLines = [];
      while (index < lines.length && !/^```/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(code(codeLines.join("\n"), language));
      continue;
    }
    const todoMatch = line.match(/^\s*-\s+\[([ xX])]\s+(.+)$/);
    if (todoMatch) {
      flushParagraph();
      blocks.push(listItem("to_do", todoMatch[2], /x/i.test(todoMatch[1])));
      index += 1;
      continue;
    }
    const bulletMatch = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      blocks.push(listItem("bulleted_list_item", bulletMatch[1]));
      index += 1;
      continue;
    }
    const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      blocks.push(listItem("numbered_list_item", orderedMatch[1]));
      index += 1;
      continue;
    }
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      blocks.push(quote(quoteMatch[1]));
      index += 1;
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }
    paragraphLines.push(line);
    index += 1;
  }
  flushParagraph();
  return blocks;
}
async function uploadFile(requestUrl2, token, file) {
  var _a;
  const createResponse = await notionRequest(requestUrl2, token, {
    url: `${NOTION_API_BASE}/file_uploads`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "single_part", filename: file.filename, content_type: file.mimeType }),
    throw: false
  });
  if (createResponse.status < 200 || createResponse.status >= 300) throw new Error(`\u56FE\u7247 ${file.filename} \u521B\u5EFA\u4E0A\u4F20\u5931\u8D25\uFF1A${getResponseError(createResponse)}`);
  const fileUploadId = (_a = createResponse.json) == null ? void 0 : _a.id;
  if (!fileUploadId) throw new Error(`\u56FE\u7247 ${file.filename} \u521B\u5EFA\u4E0A\u4F20\u5931\u8D25\uFF1A\u672A\u8FD4\u56DE\u4E0A\u4F20 ID`);
  const boundary = `----JournalSyncNotion${Date.now()}${Math.random().toString(16).slice(2)}`;
  const safeFilename = String(file.filename || "image").replace(/[\"\r\n]/g, "_");
  const mimeType = file.mimeType || "application/octet-stream";
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${safeFilename}"\r
Content-Type: ${mimeType}\r
\r
`
  );
  const suffix = encoder.encode(`\r
--${boundary}--\r
`);
  const binary = new Uint8Array(file.buffer);
  const body = new Uint8Array(prefix.byteLength + binary.byteLength + suffix.byteLength);
  body.set(prefix, 0);
  body.set(binary, prefix.byteLength);
  body.set(suffix, prefix.byteLength + binary.byteLength);
  const sendResponse = await notionRequest(requestUrl2, token, {
    url: `${NOTION_API_BASE}/file_uploads/${fileUploadId}/send`,
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: body.buffer,
    throw: false
  });
  if (sendResponse.status < 200 || sendResponse.status >= 300) throw new Error(`\u56FE\u7247 ${file.filename} \u4E0A\u4F20\u5931\u8D25\uFF1A${getResponseError(sendResponse)}`);
  return fileUploadId;
}
async function prepareImages({ requestUrl: requestUrl2, token, localImages = [], externalImages = [] }) {
  const localByToken = {};
  for (const image of localImages) {
    const id = await uploadFile(requestUrl2, token, image);
    localByToken[image.token] = { kind: "local", fileUploadId: id };
  }
  return { ...localByToken, ...externalImages };
}
async function appendBlocks(requestUrl2, token, pageId, children) {
  for (let index = 0; index < children.length; index += MAX_BLOCKS_PER_REQUEST) {
    const response = await notionRequest(requestUrl2, token, {
      url: `${NOTION_API_BASE}/blocks/${pageId}/children`,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ children: children.slice(index, index + MAX_BLOCKS_PER_REQUEST) }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) throw new Error(getResponseError(response));
  }
}
async function findDailyPage(requestUrl2, token, parentPageId, dateTitle) {
  var _a, _b, _c, _d;
  const matches = [];
  let cursor = "";
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const response = await notionRequest(requestUrl2, token, {
      url: `${NOTION_API_BASE}/blocks/${parentPageId}/children?${params.toString()}`,
      method: "GET",
      headers: { "Content-Type": "application/json" },
      throw: false
    });
    if (response.status < 200 || response.status >= 300) throw new Error(getResponseError(response));
    for (const block of ((_a = response.json) == null ? void 0 : _a.results) || []) {
      if ((block == null ? void 0 : block.type) === "child_page" && String(((_b = block.child_page) == null ? void 0 : _b.title) || "").trim() === dateTitle) {
        matches.push({ id: block.id });
      }
    }
    cursor = ((_c = response.json) == null ? void 0 : _c.has_more) ? String(((_d = response.json) == null ? void 0 : _d.next_cursor) || "") : "";
  } while (cursor);
  if (matches.length > 1) throw new Error(`Notion \u4E2D\u627E\u5230\u591A\u4E2A\u201C${dateTitle}\u201D\u6BCF\u65E5\u9875\u9762\uFF0C\u8BF7\u4FDD\u7559\u4E00\u4E2A\u540E\u91CD\u8BD5`);
  return matches[0] || null;
}
async function createPage(requestUrl2, token, parent, title, children) {
  var _a;
  const properties = parent.type === "data_source_id" ? { [parent.titleProperty]: { title: richText(title) } } : void 0;
  const body = {
    parent: parent.type === "data_source_id" ? { data_source_id: parent.id } : { page_id: parent.id },
    ...properties ? { properties } : {},
    ...children.length <= MAX_BLOCKS_PER_REQUEST ? { children } : {}
  };
  if (!properties) body.properties = pageTitleProperty(title);
  const response = await notionRequest(requestUrl2, token, {
    url: `${NOTION_API_BASE}/pages`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    throw: false
  });
  if (response.status < 200 || response.status >= 300) throw new Error(getResponseError(response));
  const pageId = (_a = response.json) == null ? void 0 : _a.id;
  if (!pageId) throw new Error("Notion \u672A\u8FD4\u56DE\u65B0\u9875\u9762 ID");
  if (children.length > MAX_BLOCKS_PER_REQUEST) await appendBlocks(requestUrl2, token, pageId, children);
  return pageId;
}
async function execute5({ config = {}, requestUrl: requestUrl2, content, title = "", localImages = [], externalImages = [] }) {
  const token = String(config.token || "").trim();
  if (!token) return { success: false, error: "Notion Token \u672A\u914D\u7F6E" };
  if (!requestUrl2) return { success: false, error: "Notion \u8BF7\u6C42\u63A5\u53E3\u4E0D\u53EF\u7528" };
  try {
    const imageMap = await prepareImages({ requestUrl: requestUrl2, token, localImages, externalImages });
    const children = markdownToBlocks(content, imageMap);
    const targetType = config.targetType || "page";
    const normalizedTitle = cleanText(title);
    if (targetType === "database") {
      if (!config.dataSourceId || !config.titleProperty) return { success: false, error: "Notion Data Source ID \u6216\u6807\u9898\u5B57\u6BB5\u672A\u914D\u7F6E" };
      const pageId2 = await createPage(requestUrl2, token, { type: "data_source_id", id: config.dataSourceId, titleProperty: config.titleProperty }, normalizedTitle, children);
      return { success: true, pageId: pageId2 };
    }
    if (!config.pageId) return { success: false, error: "Notion \u7236\u9875\u9762 ID \u672A\u914D\u7F6E" };
    if (config.pageWriteMode === "daily_append") {
      const today = /* @__PURE__ */ new Date();
      const dateTitle = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const appendChildren = normalizedTitle ? [heading(2, normalizedTitle), ...children, divider()] : [...children, divider()];
      let dailyPage = await findDailyPage(requestUrl2, token, config.pageId, dateTitle);
      if (!dailyPage) {
        const pageId2 = await createPage(requestUrl2, token, { type: "page_id", id: config.pageId }, dateTitle, appendChildren);
        return { success: true, pageId: pageId2, daily: true };
      }
      await appendBlocks(requestUrl2, token, dailyPage.id, appendChildren);
      return { success: true, pageId: dailyPage.id, daily: true };
    }
    const pageId = await createPage(requestUrl2, token, { type: "page_id", id: config.pageId }, normalizedTitle, children);
    return { success: true, pageId };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}
async function retrieveDataSource({ config = {}, requestUrl: requestUrl2 }) {
  var _a;
  const token = String(config.token || "").trim();
  const dataSourceId = String(config.dataSourceId || "").trim();
  if (!token || !dataSourceId) throw new Error("\u8BF7\u5148\u586B\u5199 Notion Token \u548C Data Source ID");
  const response = await notionRequest(requestUrl2, token, {
    url: `${NOTION_API_BASE}/data_sources/${dataSourceId}`,
    method: "GET",
    headers: { "Content-Type": "application/json" },
    throw: false
  });
  if (response.status < 200 || response.status >= 300) throw new Error(getResponseError(response));
  const properties = ((_a = response.json) == null ? void 0 : _a.properties) || {};
  const titles = Object.entries(properties).filter(([, property]) => (property == null ? void 0 : property.type) === "title").map(([name]) => name);
  return { titles, properties };
}
var NOTION_API_BASE, NOTION_VERSION, MAX_RETRIES, MAX_BLOCKS_PER_REQUEST, manifest5, notion_default;
var init_notion = __esm({
  "src/adapters/notion.js"() {
    NOTION_API_BASE = "https://api.notion.com/v1";
    NOTION_VERSION = "2026-03-11";
    MAX_RETRIES = 3;
    MAX_BLOCKS_PER_REQUEST = 100;
    manifest5 = {
      id: "notion",
      version: "1.0.0",
      name: "Notion",
      description: "\u53D1\u9001\u5185\u5BB9\u5230 Notion \u9875\u9762\u6216 Data Source",
      enabledByDefault: false
    };
    notion_default = { manifest: manifest5, execute: execute5, retrieveDataSource };
  }
});

// src/main.js
var {
  Plugin,
  Notice,
  MarkdownView,
  requestUrl
} = require("obsidian");
var AdapterRegistry = require_adapter_registry();
var JournalSyncSendModal = require_send_modal();
var JournalSyncSettingTab = require_settings_tab();
var { renderRichContent: renderRichContent2 } = (init_content_renderer(), __toCommonJS(content_renderer_exports));
var flomoAdapter = (init_flomo(), __toCommonJS(flomo_exports));
var telegramAdapter = (init_telegram(), __toCommonJS(telegram_exports));
var mastodonAdapter = (init_mastodon(), __toCommonJS(mastodon_exports));
var misskeyAdapter = (init_missky(), __toCommonJS(missky_exports));
var notionAdapter = (init_notion(), __toCommonJS(notion_exports));
var telegraph = require_telegraph();
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
function padNumber(v, size = 2) {
  return String(v).padStart(size, "0");
}
function formatDate(d = /* @__PURE__ */ new Date()) {
  return `${d.getFullYear()}-${padNumber(d.getMonth() + 1)}-${padNumber(d.getDate())}`;
}
function parseDateInput(dateInput) {
  const m = String(dateInput || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) };
  const n = /* @__PURE__ */ new Date();
  return { year: String(n.getFullYear()), month: String(n.getMonth() + 1), day: String(n.getDate()) };
}
function formatDateToken(v, w) {
  const d = String(v || "").replace(/\D/g, "");
  if (!d) return "";
  return w <= d.length ? d.slice(-w) : d.padStart(w, "0");
}
function sanitizeFilename(v) {
  return String(v || "").trim().split(/[\\\/]/).pop().replace(/[:*?"<>|]/g, "_");
}
function buildDiaryFilename(dateInput, rule = "YYYY-MM-DD \u65E5\u8BB0") {
  const { year, month, day } = parseDateInput(dateInput);
  const fallback = `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")} \u65E5\u8BB0`;
  const rendered = String(rule || "YYYY-MM-DD \u65E5\u8BB0").trim().replace(/Y+|M+|D+/g, (tok) => {
    if (tok.startsWith("Y")) return formatDateToken(year, tok.length);
    if (tok.startsWith("M")) return formatDateToken(month, tok.length);
    return formatDateToken(day, tok.length);
  });
  return `${(sanitizeFilename(rendered) || fallback).replace(/\.md$/i, "")}.md`;
}
function buildDiaryHeading(now, rule = "HH:MM:SS") {
  const fallback = `${padNumber(now.getHours())}:${padNumber(now.getMinutes())}:${padNumber(now.getSeconds())}`;
  const rendered = String(rule || "HH:MM:SS").trim().replace(/H+|M+|S+/g, (tok) => {
    if (tok.startsWith("H")) return formatDateToken(String(now.getHours()), tok.length);
    if (tok.startsWith("M")) return formatDateToken(String(now.getMinutes()), tok.length);
    return formatDateToken(String(now.getSeconds()), tok.length);
  });
  return rendered || fallback;
}
function normalizeVaultPath(v) {
  return String(v || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
function joinVaultPath(...parts) {
  return parts.map(normalizeVaultPath).filter(Boolean).join("/");
}
function dirnameVaultPath(p) {
  const n = normalizeVaultPath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i) : "";
}
function normalizeAbsPath(v) {
  return String(v || "").replace(/\\/g, "/").replace(/\/+$/, "");
}
function isImagePath(v) {
  const clean = String(v || "").split("#")[0].split("?")[0];
  const ext = clean.includes(".") ? clean.split(".").pop().toLowerCase() : "";
  return IMAGE_EXTENSIONS.has(ext);
}
function isRemoteUrl(v) {
  return /^https?:\/\//i.test(String(v || "").trim());
}
function isDataUrl(v) {
  return /^data:/i.test(String(v || "").trim());
}
function positionToOffset(doc, pos) {
  if (!pos || typeof pos.line !== "number") return 0;
  const lines = doc.split("\n");
  const line = Math.max(0, Math.min(pos.line, lines.length - 1));
  let off = 0;
  for (let i = 0; i < line; i++) off += lines[i].length + 1;
  return off + Math.max(0, Math.min(pos.ch, lines[line].length));
}
function parseImageRefs(markdown) {
  const refs = [];
  const wiki = /!\[\[([^\]]+)\]\]/g;
  const md = /!\[[^\]]*\]\(([^)]+)\)/g;
  const bare = /(^|\n)([^\n]+?\.(?:png|jpe?g|gif|webp|svg))(?=\n|$)/gi;
  let m;
  while ((m = wiki.exec(markdown)) !== null) {
    const t = String(m[1] || "").split("|")[0].trim();
    if (!t) continue;
    refs.push({ raw: m[0], target: t, type: "wiki", index: m.index, end: m.index + m[0].length });
  }
  while ((m = md.exec(markdown)) !== null) {
    const t = String(m[1] || "").trim().replace(/^<|>$/g, "");
    if (!t) continue;
    try {
      refs.push({ raw: m[0], target: decodeURIComponent(t), type: "markdown", index: m.index, end: m.index + m[0].length });
    } catch (e) {
      refs.push({ raw: m[0], target: t, type: "markdown", index: m.index, end: m.index + m[0].length });
    }
  }
  while ((m = bare.exec(markdown)) !== null) {
    const t = String(m[2] || "").trim();
    if (!t || /[\[\]()]/.test(t)) continue;
    const idx = m.index + m[1].length;
    refs.push({ raw: m[2], target: t, type: "bare", index: idx, end: idx + m[2].length });
  }
  return refs.sort((a, b) => a.index - b.index);
}
function getSelectedOrBlockContent(editor, scope = 2) {
  const selected = editor.getSelection();
  if (selected && selected.trim()) {
    const doc2 = editor.getValue().replace(/\r\n/g, "\n");
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    return {
      content: selected.trim(),
      heading: "",
      source: "selection",
      selectionStart: positionToOffset(doc2, from),
      selectionEnd: positionToOffset(doc2, to),
      doc: doc2
    };
  }
  const doc = editor.getValue().replace(/\r\n/g, "\n");
  const lines = doc.split("\n");
  const cursorLine = editor.getCursor().line;
  if (Number(scope) === 0) {
    const content = doc.trim();
    return content ? { content, heading: "", source: "page" } : null;
  }
  const level = Math.min(6, Math.max(1, Number(scope) || 2));
  const headingRe = new RegExp(`^#{${level}}\\s+`);
  const anyHeadingRe = /^(#{1,6})\s+/;
  let startLine = -1;
  for (let i = Math.min(cursorLine, lines.length - 1); i >= 0; i--) {
    if (headingRe.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine >= 0) {
    let endLine = lines.length;
    for (let i = startLine + 1; i < lines.length; i++) {
      const nextHeading = lines[i].match(anyHeadingRe);
      if (nextHeading && nextHeading[1].length <= level) {
        endLine = i;
        break;
      }
    }
    const content = lines.slice(startLine + 1, endLine).join("\n").trim();
    if (!content) return null;
    return {
      content,
      heading: lines[startLine].replace(headingRe, "").trim(),
      source: "heading"
    };
  }
  return null;
}
function deepMergeSettings(target, source) {
  if (!target || typeof target !== "object") target = {};
  if (!source || typeof source !== "object") return target;
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (Array.isArray(sourceVal)) {
      if (!Array.isArray(targetVal) || targetVal.length === 0) {
        target[key] = JSON.parse(JSON.stringify(sourceVal));
      }
    } else if (sourceVal && typeof sourceVal === "object") {
      if (!targetVal || typeof targetVal !== "object") target[key] = {};
      deepMergeSettings(target[key], sourceVal);
    } else {
      if (targetVal === void 0 || targetVal === "" || targetVal === null) {
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
  const refs = (Array.isArray(uploadedRefs) ? uploadedRefs : []).filter((r) => r && typeof r.index === "number" && r.end <= markdown.length && r.filename).sort((a, b) => a.index - b.index);
  for (const ref of refs) {
    if (ref.index < cursor) continue;
    const txt = markdown.slice(cursor, ref.index);
    if (txt) {
      const prev = blocks[blocks.length - 1];
      if ((prev == null ? void 0 : prev.type) === "text") prev.text += txt;
      else blocks.push({ type: "text", text: txt });
    }
    const imgId = `obsidian_${images.length}_${ref.filename}`;
    images.push({ id: imgId, filename: ref.filename, vaultPath: ref.vaultPath || ref.filename, previewUrl: "", createdAt: "" });
    blocks.push({ type: "image", imageId: imgId });
    cursor = ref.end;
  }
  const remaining = markdown.slice(cursor);
  if (remaining) {
    const prev = blocks[blocks.length - 1];
    if ((prev == null ? void 0 : prev.type) === "text") prev.text += remaining;
    else blocks.push({ type: "text", text: remaining });
  }
  return { version: 1, blocks, images };
}
var DEFAULT_SETTINGS = {
  diaryPath: "\u65E5\u8BB0",
  filenameRule: "YYYY-MM-DD \u65E5\u8BB0",
  autoUploadImages: true,
  // 发送范围：未选中文本时发送的内容范围（0 = 整个页面，1-6 = 对应级别标题下的内容，不含标题本身）
  sendScope: 2,
  // 新建日记标题设置
  diaryTimestampLevel: 2,
  // 新建标题级别（1-6）
  diaryHeadingRule: "HH:MM:SS",
  // 新建标题格式（H=时、M=分、S=秒 占位符）
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
      telegraphAccessToken: "",
      telegraphAuthorName: "",
      telegraphTitleLevel: 1
    },
    mastodon: { visibility: "public" },
    missky: { visibility: "public" },
    notion: {
      targetType: "page",
      pageWriteMode: "new_page",
      titleSource: "scope",
      autoCompressLargeImages: false
    }
  },
  // 发布预设分组：不内置任何用户特定数据（频道 ID 等均存于 data.json），
  // 首次使用时由发送面板根据用户选择自动创建
  publishPresets: [],
  activePresetId: ""
};
var JournalSyncPlugin = class extends Plugin {
  async onload() {
    const loadedData = await this.loadData() || {};
    this.settings = deepMergeSettings(loadedData, DEFAULT_SETTINGS);
    await this.saveSettings();
    this.adapterRegistry = new AdapterRegistry();
    this.adapterRegistry.register(flomoAdapter);
    this.adapterRegistry.register(telegramAdapter);
    this.adapterRegistry.register(mastodonAdapter);
    this.adapterRegistry.register(misskeyAdapter);
    this.adapterRegistry.register(notionAdapter);
    this.addRibbonIcon("pencil", "Journal Sync: \u65B0\u5EFA\u65E5\u8BB0\u8BB0\u5F55", () => this.createTodayDiaryEntry());
    this.addCommand({
      id: "journal-sync-new",
      name: "JournalSync-New",
      callback: () => this.createTodayDiaryEntry()
    });
    this.addCommand({
      id: "journal-sync-send",
      name: "JournalSync-Send",
      editorCallback: (editor, view) => this.sendCurrentContent(editor, view)
    });
    this.addSettingTab(new JournalSyncSettingTab(this.app, this));
  }
  async onunload() {
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  // ── 适配器管理 ──────────────────────────────
  isAdapterEnabled(id) {
    var _a;
    return Boolean((_a = this.settings.adaptersEnabled) == null ? void 0 : _a[id]);
  }
  setAdapterEnabled(id, enabled) {
    if (!this.settings.adaptersEnabled) this.settings.adaptersEnabled = {};
    this.settings.adaptersEnabled[id] = enabled;
  }
  getAdapterConfig(id) {
    var _a;
    return ((_a = this.settings.adaptersConfig) == null ? void 0 : _a[id]) || {};
  }
  async setAdapterConfig(id, config) {
    if (!this.settings.adaptersConfig) this.settings.adaptersConfig = {};
    this.settings.adaptersConfig[id] = config;
    await this.saveSettings();
  }
  // ── Obsidian Vault 工具 ──────────────────────
  getVaultBasePath() {
    const adapter = this.app.vault.adapter;
    if (adapter && typeof adapter.getBasePath === "function") {
      return normalizeAbsPath(adapter.getBasePath());
    }
    return "";
  }
  absoluteToVaultPath(absPath) {
    const base = this.getVaultBasePath();
    const norm = normalizeAbsPath(absPath);
    if (!norm) return "";
    if (!base) return !/^(?:[a-zA-Z]|\/)/.test(norm) ? normalizeVaultPath(norm) : "";
    if (norm === base) return "";
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
    const cleaned = normalizeVaultPath(String(target || "").split("|")[0]);
    const dir = contextFile ? dirnameVaultPath(contextFile.path) : "";
    const candidates = [];
    if (dir) candidates.push(joinVaultPath(dir, cleaned));
    candidates.push(cleaned);
    for (const c of candidates) {
      const f = this.app.vault.getAbstractFileByPath(c);
      if (f && !f.children) return f;
    }
    const linked = this.app.metadataCache.getFirstLinkpathDest(cleaned, (contextFile == null ? void 0 : contextFile.path) || "");
    if (linked && !linked.children) return linked;
    return null;
  }
  /**
   * 收集正文中的本地图片引用，返回文件名列表与富文本草稿。
   * 注意：本函数不执行任何上传（无后端服务），仅解析图片引用位置。
   */
  async processImagesFromMarkdown(markdown, currentFile, extraRefs = []) {
    const refs = [...parseImageRefs(markdown), ...extraRefs];
    const uploadedByPath = /* @__PURE__ */ new Map();
    const failed = [];
    const uploadedRefs = [];
    for (const ref of refs) {
      if (!isImagePath(ref.target) || isRemoteUrl(ref.target) || isDataUrl(ref.target)) continue;
      const file = await this._resolveImageFile(ref.target, currentFile);
      if (!file) continue;
      if (!uploadedByPath.has(file.path)) {
        uploadedByPath.set(file.path, { filename: file.name, vaultPath: file.path });
      }
      uploadedRefs.push(Object.assign({}, ref, uploadedByPath.get(file.path)));
    }
    const sortedRefs = uploadedRefs.slice().sort((a, b) => a.index - b.index);
    let content = "";
    let cursor = 0;
    sortedRefs.forEach((ref, idx) => {
      if (ref.index < cursor) return;
      content += markdown.slice(cursor, ref.index);
      content += `@\u56FE\u7247${idx + 1}`;
      cursor = ref.end;
    });
    content += markdown.slice(cursor);
    return {
      content: content.trim(),
      imageFilenames: Array.from(uploadedByPath.values()).map((image) => image.vaultPath).filter(Boolean),
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
      const vaultPath = (image == null ? void 0 : image.vaultPath) || (image == null ? void 0 : image.filename);
      if (!vaultPath || typeof readImageFile !== "function") continue;
      const buffer = await readImageFile(vaultPath);
      if (!buffer) throw new Error(`\u65E0\u6CD5\u8BFB\u53D6\u56FE\u7247\uFF1A${image.filename || vaultPath}`);
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
            filename = filename.replace(/\.[^.]+$/, "") + ".webp";
            mimeType = "image/webp";
          }
        }
      }
      const tokenMatch = String((image == null ? void 0 : image.token) || "").match(/^@图片(\d+)$/);
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
    const ext = String(filename || "").split(".").pop().toLowerCase();
    const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
    return types[ext] || "application/octet-stream";
  }
  async compressImageToWebp(arrayBuffer, mimeType) {
    const source = new Blob([arrayBuffer], { type: mimeType });
    const bitmap = await createImageBitmap(source);
    const maxDimension = 2560;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
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
    if (!adapter) return { success: false, error: "\u9002\u914D\u5668\u4E0D\u5B58\u5728" };
    const config = this.getAdapterConfig(adapterId);
    if (adapterId === "flomo") {
      return adapter.execute({
        content: payload.content,
        apiUrl: config.apiUrl,
        requestUrl
      });
    }
    if (adapterId === "telegram") {
      return adapter.execute({
        content: payload.content,
        config,
        telegramSegments: payload.telegramSegments,
        requestUrl,
        readImageFile: payload.readImageFile,
        channelIds: payload.channelIds,
        isRichText: payload.isRichText
      });
    }
    if (adapterId === "mastodon") {
      return adapter.execute({
        content: payload.content,
        serverUrl: config.serverUrl,
        accessToken: config.accessToken,
        visibility: config.visibility,
        requestUrl,
        images: payload.images,
        readImageFile: payload.readImageFile
      });
    }
    if (adapterId === "missky") {
      return adapter.execute({
        content: payload.content,
        serverUrl: config.serverUrl,
        apiToken: config.apiToken,
        visibility: config.visibility,
        requestUrl,
        images: payload.images,
        readImageFile: payload.readImageFile
      });
    }
    if (adapterId === "notion") {
      return adapter.execute({
        config,
        content: payload.content,
        title: payload.title,
        localImages: payload.localImages,
        externalImages: payload.externalImages,
        requestUrl
      });
    }
    return { success: false, error: `\u4E0D\u652F\u6301\u7684\u9002\u914D\u5668: ${adapterId}` };
  }
  // ── Telegraph 发送编排 ──────────────────────
  /**
   * 确保 Telegraph access_token 存在，无则自动创建账号
   * @returns {Promise<string>} access_token
   */
  async ensureTelegraphToken() {
    const tgConfig = this.getAdapterConfig("telegram");
    if (tgConfig.telegraphAccessToken) return tgConfig.telegraphAccessToken;
    const account = await telegraph.createAccount("JournalSync", tgConfig.telegraphAuthorName || "", requestUrl);
    await this.setAdapterConfig("telegram", {
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
  async executeTelegraphSend({ content, images, readImageFile, channelIds, telegraphTitle, titleLevel }) {
    var _a;
    let accessToken;
    try {
      accessToken = await this.ensureTelegraphToken();
    } catch (error) {
      return { success: false, error: `Telegraph \u8D26\u53F7\u521B\u5EFA\u5931\u8D25: ${error.message}` };
    }
    const tgConfig = this.getAdapterConfig("telegram");
    const authorName = tgConfig.telegraphAuthorName || "";
    const imageUrls = /* @__PURE__ */ new Map();
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
          return { success: false, error: `\u65E0\u6CD5\u8BFB\u53D6\u56FE\u7247: ${img.filename || vaultPath}` };
        }
        const url = await telegraph.uploadImage(buffer, img.filename || "image.jpg", requestUrl);
        imageUrls.set(token, url);
      } catch (error) {
        return { success: false, error: `\u56FE\u7247\u4E0A\u4F20\u5931\u8D25 (${img.filename || vaultPath}): ${error.message}` };
      }
    }
    const sendScope = (_a = this.settings.sendScope) != null ? _a : 2;
    const maxLevel = sendScope === 0 ? 6 : Math.min(6, sendScope);
    const titleLevelNum = Math.max(1, Math.min(maxLevel, Number(titleLevel) || 1));
    const { title: extractedTitle, content: nodes } = telegraph.markdownToNodes(content, imageUrls, titleLevelNum);
    const finalTitle = telegraphTitle || extractedTitle || "Journal Sync";
    let pageUrl;
    try {
      const page = await telegraph.createPage(accessToken, finalTitle, nodes, authorName, "", requestUrl);
      pageUrl = page.url;
    } catch (error) {
      return { success: false, error: `Telegraph \u521B\u5EFA\u9875\u9762\u5931\u8D25: ${error.message}` };
    }
    const botToken = tgConfig.botToken;
    if (!botToken) {
      return { success: false, error: "Telegram Bot Token \u672A\u914D\u7F6E", url: pageUrl };
    }
    const targets = Array.isArray(channelIds) && channelIds.length > 0 ? channelIds.map(String) : [];
    if (targets.length === 0) {
      return { success: false, error: "Telegram \u9891\u9053\u672A\u914D\u7F6E", url: pageUrl };
    }
    const showLinkPreview = tgConfig.showLinkPreview !== false;
    const linkText = `${finalTitle}
${pageUrl}`;
    const results = await Promise.all(targets.map(async (targetCh) => {
      try {
        const response = await requestUrl({
          url: `https://api.telegram.org/bot${botToken}/sendMessage`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: targetCh,
            text: linkText,
            disable_web_page_preview: !showLinkPreview
          }),
          throw: false
        });
        const data = response.json;
        if (!data || !data.ok) {
          return { success: false, channelId: targetCh, error: (data == null ? void 0 : data.description) || "\u53D1\u9001\u5931\u8D25" };
        }
        return { success: true, channelId: targetCh };
      } catch (error) {
        return { success: false, channelId: targetCh, error: error.message || String(error) };
      }
    }));
    const allOk = results.every((r) => r.success);
    const errors = results.filter((r) => !r.success).map((r) => `${r.channelId}: ${r.error}`).join("; ");
    return {
      success: allOk,
      error: allOk ? void 0 : errors,
      url: pageUrl,
      results
    };
  }
  /**
   * 新建今日日记（无需后端服务）
   */
  async createTodayDiaryEntry() {
    try {
      const diaryDir = normalizeVaultPath(this.settings.diaryPath || "");
      const rule = this.settings.filenameRule || "YYYY-MM-DD \u65E5\u8BB0";
      const now = /* @__PURE__ */ new Date();
      const filename = buildDiaryFilename(formatDate(now), rule);
      const diaryPath = diaryDir ? joinVaultPath(diaryDir, filename) : filename;
      let file = this.app.vault.getAbstractFileByPath(diaryPath);
      let existing = "";
      if (!file) {
        if (diaryDir) {
          await this.app.vault.createFolder(diaryDir).catch(() => {
          });
        }
        file = await this.app.vault.create(diaryPath, "");
      } else {
        existing = await this.app.vault.read(file);
      }
      const prefix = existing.length === 0 ? "" : existing.endsWith("\n\n") ? "" : "\n";
      const tsLevel = Math.min(6, Math.max(1, Number(this.settings.diaryTimestampLevel) || 2));
      const tsRule = this.settings.diaryHeadingRule || "HH:MM:SS";
      const heading2 = `${"#".repeat(tsLevel)} ${buildDiaryHeading(now, tsRule)}`;
      const appendText = `${prefix}${heading2}

`;
      await this.app.vault.append(file, appendText);
      await this.app.workspace.getLeaf(false).openFile(file);
      const cursorLine = (existing + appendText).split("\n").length - 1;
      window.setTimeout(() => {
        var _a;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || ((_a = view.file) == null ? void 0 : _a.path) !== file.path) return;
        view.editor.setCursor({ line: cursorLine, ch: 0 });
        view.editor.focus();
      }, 50);
      new Notice("\u5DF2\u521B\u5EFA Journal Sync \u65E5\u8BB0\u8BB0\u5F55\u5757\u3002");
    } catch (error) {
      new Notice(error.message || String(error));
    }
  }
  getNoteTitle(file, source) {
    if (source === "selection") return "";
    return (file == null ? void 0 : file.basename) || "";
  }
  /**
   * 发送当前内容（触发 Send Modal）
   */
  async sendCurrentContent(editor, view) {
    try {
      if (!editor) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        editor = activeView == null ? void 0 : activeView.editor;
      }
      if (!editor) {
        new Notice("\u8BF7\u5148\u6253\u5F00\u6216\u9009\u4E2D\u4E00\u4EFD\u7B14\u8BB0");
        return;
      }
      const current = getSelectedOrBlockContent(editor, this.settings.sendScope);
      if (!current || !current.content.trim()) {
        new Notice("\u6CA1\u6709\u53EF\u53D1\u9001\u7684\u5185\u5BB9\uFF1A\u8BF7\u5148\u9009\u4E2D\u6587\u672C\uFF0C\u6216\u5C06\u5149\u6807\u7F6E\u4E8E\u6240\u9009\u7EA7\u522B\u7684\u6807\u9898\u4E0B\u3002");
        return;
      }
      const currentFile = (view == null ? void 0 : view.file) || this.app.workspace.getActiveFile();
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
      const renderResult = renderRichContent2({
        richDraft: processResult.richDraft,
        fallbackContent: processResult.content,
        fallbackImageFilenames: processResult.imageFilenames
      });
      if (processResult.failed.length > 0) {
        new Notice(`\u90E8\u5206\u56FE\u7247\u65E0\u6CD5\u8BFB\u53D6\uFF08${processResult.failed.length} \u5F20\uFF09\uFF0C\u53D1\u9001\u65F6\u5C06\u8DF3\u8FC7\u3002`);
      }
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
};
module.exports = JournalSyncPlugin;
