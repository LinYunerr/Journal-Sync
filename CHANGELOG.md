# Changelog

All notable changes to Journal Sync are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
