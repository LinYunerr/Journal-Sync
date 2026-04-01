# Journal Sync

Journal Sync 是一个本地优先的日记/笔记同步工具。内容先落地到 Obsidian，再按插件配置分发到 flomo、Telegram、Mastodon、Mem0、MemU 等目标。

## 功能总览

- 日记/笔记双模式录入（同一页面切换）
- 本地草稿自动保存与恢复（`localStorage`）
- 图片拖拽/粘贴上传，保存时自动写入 Obsidian `assets/`
- 保存过程实时状态反馈（Obsidian + 各插件）
- 历史记录时间线展示（含图片预览、状态标签）
- Telegram 频道发布（支持多频道、图片、内容优化、来源链接）
- 插件中心（启停、配置、动作执行）
- 设置页统一管理 AI/代理/分类/目录等配置
- Mem0 任务与洞察展示（在主页面侧栏）

## 页面与入口

- 主页：`http://localhost:3000/`
  - 日记/笔记编辑、保存、插件分发、TG 发布、任务与洞察
- 历史页：`http://localhost:3000/history.html`
  - 展示最近记录与分发状态（自动刷新）
- 设置页：`http://localhost:3000/settings.html`
  - Obsidian 路径、AI、代理、分类规则、目录管理等
- 插件页：`http://localhost:3000/plugins.html`
  - 插件注册表、配置编辑、启停、动作测试

## 技术栈与要求

- Node.js `>=18`
- 本地可写 Obsidian 目录
- 如启用第三方同步/AI：需准备对应凭据（Token/API Key）

## 快速开始

```bash
npm install
npm start
```

默认访问 `http://localhost:3000`。

停止服务：

```bash
npm stop
```

运行测试：

```bash
npm test
```

## 插件系统

插件位于 `Plugin/*`，通过 `index.js` 暴露统一接口。

最小接口示例：

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

已支持字段类型：

- `text`
- `password`
- `textarea`
- `boolean`
- `select`
- `number`

配置存储策略：

- 主配置：`data/config.json`
- 插件私有配置：`Plugin/<plugin>/config.json`
- 敏感字段读取时会脱敏，保存空字符串时保留旧值

## 常用 API

核心写入与历史：

- `POST /api/save-stream`：保存并流式返回插件状态
- `POST /api/save`：兼容旧接口
- `GET /api/history` / `DELETE /api/history`
- `GET /api/stats`

Telegram：

- `POST /api/telegram/test`
- `POST /api/telegram/optimize`
- `POST /api/telegram/publish`

插件：

- `GET /api/plugins`
- `GET /api/plugins/registry`
- `GET /api/plugins/:id/config`
- `POST /api/plugins/:id/config`
- `POST /api/plugins/:id/toggle`
- `POST /api/plugins/:id/actions/:actionId`

## 目录结构

```text
.
├── Plugin/                   # 各插件实现与私有配置
├── public/                   # 前端页面与静态资源
├── src/
│   ├── sync/                 # 保存与插件执行逻辑
│   ├── utils/                # 配置/代理等工具
│   └── web/                  # Express 服务
├── data/                     # 运行时数据（history、config、tasks 等）
├── test/                     # Node 内置测试
├── README.md
├── QUICKSTART.md
└── PLUGIN_SPECIFICATION.md
```

## 数据与安全说明

- 不要提交 `Plugin/*/config.json`（含敏感凭据）
- 不要提交 `data/` 下运行时数据
- 本地服务默认只允许 `localhost/127.0.0.1:3000` 的 CORS 来源
- 代理配置可在设置中启用（用于 AI/外部请求）

## 已知限制

- 当前历史记录默认只保留最近 `100` 条
- 图片上传单张限制 `20MB`，前端最多选择 `9` 张

## 许可证

仓库当前未包含 License 文件；若准备公开发布，建议补充正式许可证。
