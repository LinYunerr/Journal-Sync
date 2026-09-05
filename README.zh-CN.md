# Journal Sync

[English](README.md) · [安装](#安装) · [首次配置](#首次配置) · [开发说明](docs/development.md)

**写在 Obsidian，发布到你常用的平台。**

Journal Sync 可以把 Obsidian 中选中的文字、当前标题片段或整篇笔记发送到 **flomo、Telegram、Mastodon、Misskey、Bluesky、微博、Notion 和 Threads**。插件完全运行在 Obsidian 内，无需安装 Node.js、Python，也不需要单独部署后端服务。

![Journal Sync 发送面板：编辑内容并选择发布目标](docs/assets/send-dialog.png)

## 从记录到发布

1. 执行 **JournalSync-New**，打开今天的日记并插入一个时间标题。
2. 像平常一样记录，也可以直接引用 Vault 中的图片。
3. 选中想发布的文字，或把光标放在对应标题片段中，然后执行 **JournalSync-Send**。
4. 在发送面板中确认内容、选择一个或多个目标，点击发布或按 <kbd>Ctrl/Cmd+Enter</kbd> 快捷发送。

三个命令都通过命令面板运行：按 <kbd>Ctrl/Cmd+P</kbd>，输入部分名称（比如 `send`）回车即可找到 **JournalSync-Send**。最近使用过的命令会自动排在前面，日常发布就是三步：打开面板、执行 Send、点击发布。每次发布都会留快照，**JournalSync-Log** 可以重新打开最近 10 条发送记录，编辑后再次发布。

发送面板会记住不同场景的目标预设，支持同时选择多个 Telegram 频道；发布提交后在后台继续，不会挡住当前的记录工作。

## 主要功能

- **快速开始今天的记录**：自动创建或打开今日日记，并定位到新的时间标题下。
- **准确选择发送范围**：发送选中文字、指定级别的当前标题片段，或整篇笔记。
- **一次选择多个目标**：在同一个面板中勾选多个平台和 Telegram 频道，目标预设可一键切换。
- **识别 Vault 本地图片**：支持 Markdown 图片和 Wiki 链接，不依赖操作系统绝对路径；也可以直接粘贴剪贴板图片，不会写入 Vault。
- **发送前可编辑预览**：发布前调整文字、图片取舍和图片顺序。
- **发送历史**：最近 10 条发送记录在本地保存快照，可重新打开、编辑、再发送。
- **配置保存在本地**：账号信息由 Obsidian 保存，Journal Sync 不经过自建中转服务器。

## 安装

1. 打开[最新 GitHub Release](https://github.com/LinYunerr/Journal-Sync/releases/latest)。
2. 下载 `main.js`、`manifest.json` 和 `styles.css`。
3. 将这三个文件放入：

   ```text
   <你的 Vault>/.obsidian/plugins/journal-sync-bridge/
   ```

4. 打开 Obsidian 的 **设置 → 第三方插件**，刷新插件列表并启用 **Journal Sync**。

安装只需要上述三个文件。不要复制 `data.json`，其中保存着你的本地账号配置。

## 首次配置

启用插件后，打开 **设置 → Journal Sync**。

![Journal Sync 设置页面：主设置与各平台配置](docs/assets/settings.png)

1. 在 **主设置** 中选择日记目录、文件名规则、时间标题格式、默认发送范围和本地图片行为。
2. 在 **插件设置** 中启用需要的平台，并填写对应的连接信息。
3. 使用 Telegram 时，填写 Bot Token，获取频道列表，再选择默认频道。
4. 大多数平台都提供「测试连接」按钮，可在发布前验证凭据是否有效。flomo 的测试会发送一条真实笔记，其余平台只校验已保存的 Token。

## 使用 Journal Sync

三个命令都可以在命令面板（<kbd>Ctrl/Cmd+P</kbd>）中运行，也可以在 **设置 → 快捷键** 中绑定快捷键。

| 命令 | 作用 |
| --- | --- |
| `JournalSync-New` | 创建或打开今日日记，追加时间标题，并把光标放到标题下。也可以点击左侧 Ribbon 的铅笔图标。 |
| `JournalSync-Send` | 根据选中文字或光标位置打开发送面板。 |
| `JournalSync-Log` | 打开发送日志：列出最近 10 条发送快照，每条提供「重新编辑」按钮，可重新打开预填好的发送面板（正文、图片 token 和 Telegram 单次发送选项一并还原）。 |

如果已经选中文字，插件始终优先发送选中内容。没有选中文字时，则按照设置中的发送范围，发送光标上方最近的 `#` 到 `######` 标题片段或整篇笔记。标题片段指该标题行到下一个同级或更高级标题之间的内容，标题行本身不会包含在发送的正文中；发送到 Notion 时，这个标题的文字会用作页面标题。如果光标不在所选级别的标题之下，或该片段为空，插件会给出提示而不发送。发送范围默认为 `##`，与默认的时间标题级别一致。

### 发送面板中的图片

本地图片会在正文中显示为 `@图片1` 这样的 token，并在编辑区下方显示缩略图。Telegram 富文本发送会按照 token 的位置排列图片；移动 token 可以调整顺序，删除 token 则不会发送对应图片。也可以把剪贴板中的图片直接粘贴进编辑区，它会以同样的方式变成 token，发送时不会写入 Vault。

## 支持的平台

| 平台 | 文字 | Vault 图片 | 说明 |
| --- | :---: | :---: | --- |
| flomo | ✓ | — | 通过 flomo API Webhook 发布。测试连接会向 flomo 发送一条真实笔记。 |
| Telegram | ✓ | ✓ | 支持多个频道和三种发送模式：普通发送（图文一起发，每条消息最多 9 张图片）、保留图片位置和受支持 Markdown 的富文本发送，以及 Telegraph——长文发布为 Telegraph 页面后，把链接发到所选频道。 |
| Mastodon | ✓ | ✓ | 可配置实例、多个账号和可见性，每帖最多 4 张图片。 |
| Misskey | ✓ | ✓ | 可配置实例和可见性（公开 / 主页 / 仅关注者），每帖最多 16 张图片。不支持私信可见性。 |
| Bluesky | ✓ | ✓ | 使用 App Password 登录（在 Bluesky 设置 → Privacy & security → App passwords 生成）。单帖上限 300 个可见字符且不超过 3,000 个 UTF-8 字节，最多 4 张图片（JPEG/PNG/WebP/GIF，每张 2 MB）。 |
| 微博 | ✓ | ✓ | 通过微博开放平台 OAuth 授权发布（需自建应用获取 App Key/Secret）。纯文本超过 140 字可发送长文；带图发送支持单张 JPEG/PNG/GIF 图片，正文上限 140 字。可见性可选公开或仅自己可见。 |
| Notion | ✓ | ✓ | 可以创建页面或数据库记录，并上传正文引用的本地图片。超过 5 MB 的图片可在上传前在内存中压缩为 WebP（可选，默认关闭；不会修改 Vault 原文件）。 |
| Threads | ✓ | — | 通过 Threads Graph API 发布纯文本（每帖 500 UTF-8 字节上限，需自建 Meta 应用完成 OAuth）。回复权限可配置。暂不支持图片。 |

各平台自身的限制仍然适用。图片数量超过平台上限时，Journal Sync 会先警告确认，然后只发送前 N 张。较长的 Telegram 消息会自动分段，媒体数量和 caption 长度遵循 Telegram Bot API 的限制。多平台发送时各平台独立执行——某个平台失败不影响其他平台继续发布。

## 隐私与账号信息

Journal Sync 从 Obsidian 直接请求各目标平台。Token、Webhook、频道 ID 和其他设置保存在：

```text
<你的 Vault>/.obsidian/plugins/journal-sync-bridge/data.json
```

`data.json` 不会进入本仓库或 GitHub Release。不要把它上传到 Issue 或提交到 Git；如果凭据曾经公开，请立即到对应平台撤销并重新生成。

发送日志同样保存在插件目录下的 `send-log/` 中：最近 10 条发送各存一份本地快照（含引用图片的副本），「重新编辑」据此完整还原。删除该目录即可清空历史。

## 兼容性

- Obsidian `1.5.0` 或更高版本
- Windows、macOS、Linux
- 插件未限制为仅桌面端；移动端请按实际使用的平台进行验证

## 开发说明

架构、构建、发布流程和新增平台方式统一维护在 [docs/development.md](docs/development.md) 中。

Journal Sync 基于 [MIT License](LICENSE) 开源。
