# Changelog

All notable changes to Journal Sync are documented in this file.

## [Unreleased]

## [1.0.9] - 2026-09-08

### Added

- **发送日志（`JournalSync-Log`）**：每次发布都会在插件目录 `send-log/` 下保存一份快照（内容、图片、目标预设、诊断信息），最多保留最近 10 条。`JournalSync-Log` 命令打开日志弹窗，可对任意一条记录点「重新编辑」，恢复内容与图片后再次发布。派发前失败（未发出）也会记录。
- **Telegram Markdown→HTML 转换**：新增 `src/core/telegram-markdown.js`，基于 `@borodin/mdgram` 将 Obsidian Markdown 统一转换为 Telegram HTML（普通链路 classic HTML、富文本链路 Rich HTML），替代原先的 `parse_mode=Markdown` 与手写富文本拼装。
- **Send log (`JournalSync-Log`)**：every publish saves a snapshot (content, images, target preset, diagnostics) under `send-log/` in the plugin directory, keeping the latest 10 entries. The `JournalSync-Log` command opens a log modal; any entry can be re-edited and re-sent with content and images restored. Failed pre-dispatch attempts are recorded too.
- **Telegram Markdown→HTML conversion**：new `src/core/telegram-markdown.js` based on `@borodin/mdgram` converts Obsidian Markdown to Telegram HTML uniformly (classic HTML for the plain path, Rich HTML for the rich path), replacing the old `parse_mode=Markdown` and hand-built rich-text assembly.

### Changed

- **核心逻辑收拢到 `src/core/`**：统一 MIME 类型推断（图片+视频）到 `src/core/mime.js`，共享 multipart 表单构造到 `src/core/multipart.js`，消除 mastodon/missky/notion/telegram/payload 中重复的 `getMimeType` 与重复的表单构造。纯逻辑（日记文件名/标题、vault 路径、图片引用解析、富文本草稿、内容提取、设置合并）从 `src/main.js` 迁出到 `src/core/` 独立模块，`src/main.js` 只保留生命周期与调度。行为不变。
- **核心规则补测试**：新增 `tests/core.test.js`，覆盖图片 token 匹配、设置深度合并、日记文件名/标题占位符、MIME、multipart。`npm test` 同时运行 Bluesky 与 core 两套测试。
- **Telegram 发送改用 HTML 解析模式**：`sendMessage`、`sendPhoto` 与 `sendMediaGroup` 的文本与图片说明统一经 Markdown→HTML 转换后以 `parse_mode=HTML` 发送；标题/列表等 Markdown 块级语法在普通链路降级为加粗/圆点，富文本链路保留完整标签。新增 `tests/telegram-markdown.test.js` 覆盖行内格式、转义、引用、代码块与图片 token 还原。
- **中英文双语界面（i18n）**：新增 `uiLanguage` 设置（`auto` 跟随 Obsidian 语言，或手动 zh/en）。发送面板、设置页、日志弹窗与全部适配器文案接入翻译引擎，`manifest.name` 在消费点统一翻译；跨适配器同文案冲突按平台前缀区分。
- **跨平台发送并行化**：通用适配器并发执行；telegram（单次调用、频道在 adapter 内并行）与 mastodon（账号串行）作为并行组运行。调度逻辑收拢到 `src/core/send-dispatcher.js`，新增 `tests/send-dispatcher.test.js`（20 例）。
- **附件大小预检优化**：优先读取文件元数据（`TFile.stat.size` / `Blob.size`），仅元数据缺失时回退读取完整二进制；单适配器内检查并行执行。
- **编辑器粘贴优化**：非图片内容统一以纯文本插入，避免网页/Word 复制内容因富文本丢失换行。
- **Core logic consolidated into `src/core/`**：unified MIME inference (image+video) in `src/core/mime.js` and shared multipart body construction in `src/core/multipart.js`, removing duplicated `getMimeType` and form builders across mastodon/missky/notion/telegram/payload. Pure logic (diary filename/heading, vault paths, image-ref parsing, rich-draft, content extraction, settings merge) moved out of `src/main.js` into standalone `src/core/` modules; `src/main.js` keeps only lifecycle and orchestration. No behavior change.
- **Core rules now tested**：new `tests/core.test.js` covers image-token matching, settings deep-merge, diary filename/heading placeholders, MIME and multipart. `npm test` runs it alongside the Bluesky suite.
- **Telegram sends with HTML parse mode**：text and captions of `sendMessage`/`sendPhoto`/`sendMediaGroup` are converted via Markdown→HTML and sent with `parse_mode=HTML`; block-level syntax (headings/lists) degrades to bold/bullets on the plain path and keeps full tags on the rich path. New `tests/telegram-markdown.test.js` covers inline formatting, escaping, quotes, code blocks and image-token restoration.
- **Bilingual UI (i18n)**：new `uiLanguage` setting (`auto` follows Obsidian's language, or zh/en). Send modal, settings page, log modal and all adapter messages are wired into the translation engine; `manifest.name` is translated at every consumption point; cross-adapter duplicate strings are platform-prefixed.
- **Parallel cross-platform sends**：generic adapters run concurrently; telegram (single call, channels in parallel inside the adapter) and mastodon (accounts serial) run as parallel groups. Dispatch logic consolidated in `src/core/send-dispatcher.js`, covered by `tests/send-dispatcher.test.js` (20 cases).
- **Faster attachment size pre-check**：file metadata (`TFile.stat.size` / `Blob.size`) is read first; full-buffer read is only a fallback. Checks within one adapter run in parallel.
- **Paste handling**：non-image pastes are inserted as plain text only, so web/Word formatted content can no longer lose newlines.

### Fixed

- **Telegram 引用与代码块内容丢失**：修复 Markdown→HTML 转换中两个内容丢失缺陷——围栏代码块（```` ``` ```` / `~~~`）内以 `>` 开头的行被误当作引用提取而丢失；引用紧贴正文（无空行分隔）时占位符被解析器吞掉导致引用内容整体丢失。现在围栏感知 + 占位符空行隔离，引用与代码内容完整保留。
- **部分渠道发送图片时不再附带相机 emoji**：微博纯图片微博空正文由 `📷` 占位改为空格；Mastodon 空正文时不再发送 `status: '📷'`，仅发送图片。
- **Telegram quote/code-block content loss**：two Markdown→HTML conversion defects fixed — lines starting with `>` inside fenced code blocks were wrongly extracted as quotes and lost; quotes adjacent to body text (no blank line) had their placeholder swallowed, dropping the whole quote. Now fence-aware with blank-line placeholder isolation.
- **No more camera emoji when sending images on some platforms**：Weibo image-only posts use a space placeholder instead of `📷`; Mastodon omits the `status` field entirely for image-only posts.

## [1.0.8] - 2026-09-04

### Added

- **Threads 适配器上线**：注册 Threads (Meta) 适配器，支持通过 Threads Graph API 发布纯文本。设置页面提供完整 OAuth 授权流程（打开授权页 → 粘贴 code → 换取长期 Token），支持测试连接与回复权限配置。

## [1.0.7] - 2026-09-04

### Added

- **测试连接**：flomo、Mastodon、Misskey、Notion 适配器新增「测试连接」按钮，可在设置页面一键验证 API 凭据是否有效。
- **Threads 适配器**：文本长度计算改为 UTF-8 字节计数，对齐 Threads API 官方 500 字节限制。
- **CHANGELOG.md**：新增变更日志，后续每个版本都会记录更新说明。

### Changed

- **content-renderer → payload 迁移**：删除 `src/core/content-renderer.js`，统一内容与图片构建逻辑到 `src/core/payload.js`，减少冗余抽象层。
- **esbuild 构建配置**：禁用 top-level await（target ES2018 不支持），避免潜在构建问题。
- **文档更新**：README、AGENTS.md、docs/development.md 中的平台列表和文件引用同步更新，包含 Weibo 和 Bluesky。
- **manifest.json 描述**：更新插件描述，包含所有支持的发布平台。

### Fixed

- **Weibo 错误解析**：修正错误字段从 `error_request` 为 `error_description`，符合 OAuth2 规范。
- **send-modal 防御**：增加 `sel` 空值守卫，避免无选区时崩溃。
- **settings-tab 保存**：修复 `saveSettings` 双重保存问题，`display()` 改为异步处理。
- **Telegram 过期频道**：发送对话框中自动过滤已失效的 Telegram 频道并提示用户。

## [1.0.6] - 2025-08-25

### Added

- Bluesky 和 Weibo 适配器。
- Registry-driven 设置页面架构。
- Threads 适配器基础实现（未注册）。

### Changed

- 设置页面重构为适配器注册表驱动，新增适配器无需修改 `settings-tab.js`。

## [1.0.5] - 2025-08-22

### Added

- Misskey 适配器。

## [1.0.4] - 2025-08-20

### Added

- 发送对话框链接预览开关。
- 剪贴板图片粘贴支持。
- 超大图片确认提示。
- UI 界面优化。

## [1.0.3] - 2025-08-18

### Fixed

- Telegraph 适配器审查问题修复 (#1 #3 #5 #8)。

## [1.0.2] - 2025-08-15

### Added

- Mastodon 适配器。
- Notion 适配器。

## [1.0.1] - 2025-08-10

### Added

- Telegram 适配器，支持 Telegraph 长文和频道选择。

## [1.0.0] - 2025-08-05

### Added

- 初始发布：flomo 适配器、日记创建命令、选区/标题段/全文发送。