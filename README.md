# Journal Sync

Journal Sync 是一个本地优先的日记/笔记同步工具。它以 Obsidian 为主存储，通过插件把内容同步到 flomo、Telegram、Mastodon、Mem0、MemU 等目标。

## Features

- Web 界面录入日记和笔记
- 日记按日期追加保存到 Obsidian
- 笔记支持 AI 元数据提取、标签生成和分类存储
- 插件系统负责扩展同步目标
- 插件配置由 `manifest` 驱动，前后端共用同一套 schema
- 插件敏感配置与主配置分离存储

## Requirements

- Node.js 18+
- 本地可写的 Obsidian 目录
- 如果启用 AI 或第三方插件，需要对应服务凭据

## Quick Start

```bash
npm install
npm start
```

启动后访问 `http://localhost:3000`。

停止服务：

```bash
npm stop
```

## Configuration

主配置文件位于 `data/config.json`，用于保存：

- `obsidianPath`
- `diary.obsidianPath`
- `note.vaultPath`
- `ai.*`
- `plugins.<pluginId>`
- `mem0Insights.*`

每个插件的私有配置保存在各自目录下的 `config.json`，例如：

- `Plugin/Flomo/config.json`
- `Plugin/Telegram-Send/config.json`
- `Plugin/Mastodon/config.json`
- `Plugin/Mem0/config.json`

敏感信息只应保存在插件私有配置中，不应写入主配置。

## Project Structure

```text
.
├── Plugin/               # 插件实现与插件私有配置
├── public/               # 前端页面与静态资源
├── src/                  # 服务端与同步逻辑
│   ├── sync/
│   ├── utils/
│   └── web/
├── test/                 # 自动化测试
├── data/                 # 运行时数据（默认不提交）
└── docs/                 # 补充说明文档
```

## Plugin System

插件通过 `Plugin/*/index.js` 暴露统一接口。核心字段如下：

```js
export const manifest = {
  id: 'telegram',
  version: '1.0.0',
  name: 'Telegram',
  description: '发送内容到 Telegram 频道',
  enabledByDefault: false,
  settings: {
    storage: 'plugin',
    sections: [],
    actions: []
  },
  capabilities: {
    execute: true,
    configure: true,
    test: true
  }
};

export async function loadConfig() {}
export async function saveConfig(config) {}
export async function execute(context) {}
export async function runAction(actionId, payload) {}
```

当前已支持的字段类型：

- `text`
- `password`
- `textarea`
- `boolean`
- `select`
- `number`

## API Overview

常用插件相关接口：

- `GET /api/plugins/registry`
- `GET /api/plugins/:id/config`
- `POST /api/plugins/:id/config`
- `POST /api/plugins/:id/toggle`
- `POST /api/plugins/:id/actions/:actionId`

敏感字段在读取时会被脱敏；保存时如果传入空字符串，会保留原值。

## Development

启动开发环境：

```bash
npm start
```

运行测试：

```bash
npm test
```

主要代码入口：

- `src/web/server.js`
- `src/sync/journal-sync.js`
- `src/sync/plugin-manager.js`
- `public/index.html`
- `public/settings.html`
- `public/plugins.html`

## Publishing Notes

- 不要提交 `Plugin/*/config.json`
- 不要提交 `data/` 下的运行时数据
- 不要提交缓存文件、备份文件和本地调试产物

## License

当前仓库未包含许可证；如果准备公开发布到 GitHub，建议补充正式 License 文件。
