# Journal Sync Bridge

> 在 Obsidian 中直接记录日记，并发布到 flomo、Telegram、Mastodon、Misskey、Notion 等平台。
> **无需安装 Node.js、Python 或任何后端服务。**

当前稳定版本：`1.0.0`。源码与 Obsidian 可直接加载的构建产物一并发布，采用 [MIT License](LICENSE)。

> GitHub Release 已提供安装文件；Obsidian Community Plugins 收录需按官方目录流程另行审核。

---

## 功能

| 功能 | 说明 |
|---|---|
| 新建日记 | 一键在指定目录创建今日日记文件，并自动定位到当前时间的二级标题 |
| 发送内容 | 选中文字或将光标置于二级标题下，触发 Send 命令打开发送面板 |
| 多平台发布 | 勾选目标平台，一键发送。支持 flomo、Telegram、Mastodon、Misskey、Notion |
| 图片支持 | 读取 Vault 本地图片；Telegram 支持官方原生图文混排，Notion 支持页面图片上传 |

---

## 安装

### 从 GitHub Release 安装

1. 打开仓库的 **Releases** 页面，选择版本 `1.0.0`。
2. 下载 `main.js`、`manifest.json` 和 `styles.css`。
3. 按下方手动安装步骤放入插件目录并启用。

### 手动安装

#### 需要复制的文件（仅 3 个）

```
main.js
manifest.json
styles.css
```

> **不需要**复制 `src/`、`node_modules/`、`package.json`、`esbuild.config.mjs` 等开发文件，也不要复制含账号配置的 `data.json`。

### 操作步骤

1. 在你的 Obsidian Vault 中找到插件目录：
   ```
   <你的 Vault>/.obsidian/plugins/
   ```

2. 在该目录下新建文件夹：
   ```
   <你的 Vault>/.obsidian/plugins/journal-sync-bridge/
   ```

3. 将以下 3 个文件复制进去：
   ```
   journal-sync-bridge/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

4. 打开 Obsidian → 设置 → 第三方插件 → 刷新列表 → 找到 **Journal Sync** → 启用。

---

## 快速配置

启用插件后，进入 **设置 → Journal Sync**：

1. **日记配置**：设置日记存放路径（如 `日记/2024`）和文件名规则（如 `YYYY-MM-DD 日记`）
2. **启用目标平台**：在设置中开启需要的平台，填写对应的 API Token / Webhook
3. **Telegram 频道**：填写 Bot Token 后点击「获取频道列表」，勾选默认发送频道

---

## 使用命令

| 命令 | 触发方式 | 说明 |
|---|---|---|
| `JournalSync-New` | 命令面板 / Ribbon 铅笔图标 | 新建今日日记记录块 |
| `JournalSync-Send` | 命令面板（需在编辑器中） | 发送当前内容到已配置平台 |

**Send 命令的使用方式：**
- 选中一段文字 → 触发命令 → 发送选中内容
- 光标在某个 `## HH:MM:SS` 标题下 → 触发命令 → 发送该标题块下的全部内容

---

## Telegram 图文发送

Telegram 使用官方 Bot API 直接上传 Vault 本地图片，不需要 OSS 或其他外部存储服务。

- **普通模式**：单图使用 `sendPhoto`，多图使用 `sendMediaGroup`；较长正文会作为独立文本消息分段发送。
- **富文本模式**：使用官方 `sendRichMessage`，保留正文中的图片位置和受支持的 Markdown 格式。
- 发送面板中的 `@图片N` 表示对应图片；删除或移动 token 会改变 Telegram 实际发送的图片和顺序。

Telegram 官方限制仍然适用，包括普通消息 4096 字符、caption 1024 字符、媒体组 2 至 10 项，以及单条富消息最多 32768 字符和 50 个媒体附件。

---

## 开发说明

### 目录结构

```
journal-sync-bridge/
├── main.js                ← 构建产物（发布用，Obsidian 加载此文件）
├── manifest.json          ← 插件元信息
├── styles.css             ← 样式
├── package.json           ← 构建依赖
├── esbuild.config.mjs     ← 构建配置
├── versions.json          ← 插件版本与最低 Obsidian 版本映射
├── version-bump.mjs       ← npm 版本号同步脚本
├── LICENSE                ← MIT 开源许可证
├── .github/workflows/     ← GitHub Release 自动构建流程
└── src/                   ← 源码
    ├── main.js            ← 插件主类（生命周期 + 命令注册）
    ├── adapters/          ← 各平台发送适配器（独立文件）
    │   ├── flomo.js
    │   ├── telegram.js
    │   ├── mastodon.js
    │   ├── missky.js
    │   └── notion.js
    ├── core/
    │   ├── content-renderer.js   ← 富文本渲染
    │   └── adapter-registry.js   ← 适配器注册表
    └── ui/
        ├── send-modal.js         ← 发送面板
        └── settings-tab.js       ← 设置面板
```

### 构建命令

```bash
# 首次安装依赖（严格按 package-lock.json）
npm ci
# 生产构建（生成 main.js）
npm run build

# 开发模式（文件变更时自动重新构建）
npm run dev
```

修改 `src/` 下的源码后，运行 `npm run build`，然后将新生成的 `main.js` 复制到 Obsidian 插件目录即可生效（需在 Obsidian 中重新加载插件）。

### 版本与发布

正式版本使用标准的 `x.y.z` 版本号，Git tag 不加 `v` 前缀。以下命令会同步 `package.json`、`manifest.json` 和 `versions.json`：

```bash
npm version patch
npm version minor
npm version major
```

推送对应 tag 后，GitHub Actions 会执行生产构建并创建 Release，附带 `main.js`、`manifest.json` 和 `styles.css`。执行提交、打 tag 或推送前，应先确认本地没有 `data.json`、凭据或个人信息进入 Git 暂存区。

### 增加新的发送平台

1. 在 `src/adapters/` 新建 `yourplatform.js`，参考 `flomo.js` 实现 `manifest` 和 `execute()`
2. 在 `src/main.js` 顶部 `require` 并 `this.adapterRegistry.register()` 注册
3. 在 `src/ui/settings-tab.js` 添加对应设置项
4. 运行 `npm run build` 重新打包

---

## 数据存储

所有配置（含 API Token、Webhook 等）保存在 Obsidian 插件目录的 `data.json` 中：

```
<Vault>/.obsidian/plugins/journal-sync-bridge/data.json
```

这是 Obsidian 插件的标准存储方式，备份 Vault 时会一并备份。

`data.json` 已被 `.gitignore` 排除，不属于源码或 Release 内容。请勿把该文件、真实 Token、Webhook、频道 ID 或其他账号信息粘贴到 Issue、日志或提交中。若凭据曾经意外公开，应立即在对应平台撤销并重新生成。

---

## 兼容性

- **操作系统**：Windows、macOS、Linux（Obsidian 桌面端）
- **Obsidian 最低版本**：1.5.0
- **移动端**：`isDesktopOnly: false`，基础流程可用；各平台上传能力仍建议在实际设备上验证

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
