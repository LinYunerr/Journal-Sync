# Journal Sync Quick Start

## 1. Install

需要 Node.js `>=18`。

从外层 `Journal-Sync/` 进入应用目录：

```bash
cd app
npm install
```

## 2. Start

```bash
npm start
```

打开主页：

- `http://localhost:3000/`

## 3. Configure

打开插件中心，配置 Obsidian 本地保存和需要发布的插件：

- `http://localhost:3000/?open=plugin-center`

常见配置：

- `Obsidian Local`：本地保存路径、Vault 路径、图片保存路径
- `Telegram` / `CMX` / `Missky` / `flomo`：对应平台的 Token、频道或实例信息
- 全局 AI、代理和插件启停也在插件中心管理

配置会写入 `user-data/config.json` 或 `user-data/plugins/<plugin>/config.json`。敏感字段读取时会脱敏，保存空字符串时保留旧值。

这里的 `user-data/` 指外层 `Journal-Sync/user-data/`，与 `app/` 同级。

首次启动新版时，程序会尝试把旧版 `data/`、`Plugin/*/config.json`、`app/data/` 和 `app/Plugin/*/config.json` 中的历史数据复制到外层 `user-data/`。迁移只复制、不删除旧数据，也不会覆盖已有的 `user-data/`。

## 4. Use

主页是“输入 / 发布 / 保存”三段式工作流：

- 在主页输入文字，或拖拽/粘贴图片到输入框
- 输入内容会自动缓存到 `user-data/draft-cache/home-v2.json`，图片先缓存到 `user-data/image-cache/`
- 点击发布按钮时，只发送到已启用的发布插件，不会自动写入 Obsidian
- 点击“保存到 Obsidian”时，才会执行本地保存插件

本地保存行为：

- 写入当天同一个 `YYYY-MM-DD 日记.md`
- 每次保存以 `## HH:mm:ss` 分段追加
- 图片默认写入日记目录下的 `assets/`，正文追加 `![[filename]]` 引用

图片发布限制：

- 前端最多选择 `9` 张，单张限制 `20MB`
- CMX/Mastodon 单条最多发送 `4` 张图
- flomo Webhook 只支持公网 `image_urls`，本地拖拽图片当前不会直接发到 flomo

## 5. Stop

```bash
npm stop
```

## 6. Update

更新软件时只替换外层 `Journal-Sync/app/`，保留外层 `Journal-Sync/user-data/`。

替换后重新进入应用目录安装依赖并启动：

```bash
cd app
npm install
npm start
```

不要删除 `user-data/`，除非明确想清空配置、历史、草稿和缓存。

## Notes

- 默认端口是 `3000`
- 如需改端口，可使用 `PORT=3001 npm start`
- 运行数据默认写入外层 `Journal-Sync/user-data/`
- 如需自定义数据目录，可设置 `JOURNAL_SYNC_DATA_DIR=/path/to/data`，建议使用绝对路径
- 更新软件时只替换 `Journal-Sync/app/`，保留 `Journal-Sync/user-data/`
- 运行测试：`npm test`
- 更完整的项目说明见 `README.md`
