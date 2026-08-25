# 适配器解耦改造计划

## 目标

将"内容编辑/收集"与"内容分发"彻底分离。管道只负责收集中性 payload 并分发给各适配器；每个适配器自行决定如何发送、自行声明限制条件、自行返回警告和错误。

### 核心原则

1. **管道不知道适配器内部细节** — 不再有 per-adapter 的 if/else 分支
2. **适配器自包含** — 富文本渲染、图片压缩、Telegraph 流程等全部内化到适配器
3. **适配器声明能力** — manifest 中声明 capabilities 和 constraints，管道据此做预检
4. **统一调用接口** — `adapter.execute({ config, payload, requestUrl })` 一个签名走天下

---

## 当前问题清单

| 问题 | 位置 | 说明 |
|---|---|---|
| `executeAdapter` 是 if/else 链 | `src/main.js` ~L580-640 | 每个适配器有不同的参数签名，管道必须知道每个适配器需要什么 |
| `doSend` 有 per-adapter 分支 | `src/ui/send-modal.js` ~L1110-1200 | notion 走 prepareNotionImages，其他走另一套；telegraph 单独路径 |
| `content-renderer` 为 Telegram 预渲染 | `src/core/content-renderer.js` | `renderTelegramSegments` 是 Telegram 专属逻辑，却在共享模块 |
| 图片压缩在 main.js | `src/main.js` ~L470-490 | `prepareNotionImages` / `compressImageToWebp` 是 Notion 专属逻辑 |
| Telegraph 编排在 main.js | `src/main.js` ~L530-600 | `executeTelegraphSend` 是 Telegram 专属逻辑 |
| 适配器签名不统一 | 各 adapter | flomo 收 `{content, apiUrl}`，telegram 收 `{content, config, telegramSegments, ...}`，notion 收 `{config, content, title, localImages, ...}` |
| 无能力声明 | 各 manifest | 没有声明支持什么类型、限制多少张图、多大文件 |
| 无预检 | send-modal | 用户点发布后才知道某个平台不支持 |

---

## 改造步骤

### 阶段一：定义统一接口（基础设施）

**1.1 统一 payload 结构**

管道组装的中性 payload，所有适配器接收同一结构：

```js
{
  content: string,          // 原始 Markdown（含 @图片N token）
  plainText: string,        // 去除图片 token 后的纯文本
  title: string,            // 笔记标题（供需要的适配器使用）
  attachments: [            // 附件列表（图片 + 未来文件）
    {
      token: '@图片1',      // 在 content 中的占位符
      filename: string,
      vaultPath: string,
      mimeType: string,
      kind: 'image'         // | 'file' | 'video' | 'audio'
    }
  ],
  readAttachment: Function, // (vaultPath) => ArrayBuffer
  // 适配器可从 config 中读取自身特有的 UI 选项（如 tgSendMode）
}
```

**1.2 统一 adapter 接口**

```js
{
  manifest: {
    id, version, name, description, enabledByDefault,
    settings: { fields: [...] },
    capabilities: {
      text: true,
      attachments: true,
      attachmentTypes: ['image/*'],
      maxAttachments: 4,
      maxAttachmentSize: 0,
      warnOnAttachmentCount: true,
      warnOnAttachmentSize: false
    }
  },
  validate({ payload, config }) → { warnings: [], errors: [] },
  execute({ config, payload, requestUrl }) → { success, error, warnings, ... },
  // 可选：
  listChannels?, runAction?, retrieveDataSource?
}
```

**1.3 更新 AdapterRegistry**

增加 `getCapabilities(id)`、`getAttachmentWarnings(targets, payload)` 和 `validateAll(targets, payload)` 方法。

**改动文件：**
- `src/core/adapter-registry.js` — 增加 capabilities 查询、图片预警识别和批量 validate
- 新建 `src/core/payload.js` — payload 构建工具函数

---

### 阶段二：适配器自包含改造（逐个迁移）

每个适配器改为统一签名 `execute({ config, payload, requestUrl })`，内部自行从 `config` 和 `payload` 取所需数据。

**2.1 Flomo**
- 从 `payload.content` 取内容
- 从 `payload.attachments` 中提取远程图片 URL（本地图片不支持，不预警）
- capabilities: `{ text: true, attachments: false, warnOnAttachmentCount: false, warnOnAttachmentSize: false }`
- **复杂度：低**

**2.2 Mastodon**
- 从 `payload.attachments` 取图片，自行上传
- 超过 4 张时由前端预警，确认后只发送前 4 张
- capabilities: `{ text: true, attachments: true, attachmentTypes: ['image/*'], maxAttachments: 4, warnOnAttachmentCount: true }`
- **复杂度：低**

**2.3 Misskey**
- 同 Mastodon 模式，自行上传到 Drive
- 超过 16 张时由前端预警，确认后只发送前 16 张
- capabilities: `{ text: true, attachments: true, attachmentTypes: ['image/*'], maxAttachments: 16, warnOnAttachmentCount: true }`
- **复杂度：低**

**2.4 Notion**
- 将 `prepareNotionImages` + `compressImageToWebp` 从 main.js 移入 notion 适配器
- 从 `payload.attachments` 取图片，自行上传为 file_upload
- 从 `payload.title` 取标题
- 从 `config.titleSource` / `config.pageWriteMode` 等读取自身配置
- capabilities: `{ text: true, attachments: true, attachmentTypes: ['image/*'], maxAttachments: 100, maxAttachmentSize: 5 * 1024 * 1024, warnOnAttachmentSize: true }`
- **复杂度：中**

**2.5 Telegram（最复杂）**
- 将 `executeTelegraphSend` 从 main.js 移入 telegram 适配器
- 将 `renderTelegramSegments` / `buildTelegramSegmentsFromEditor` 从 send-modal / content-renderer 移入 telegram 适配器（作为内部工具函数）
- 从 `config.tgSendMode`（'plain' | 'rich' | 'telegraph'）决定发送方式
- 从 `config.telegraphTitle` / `config.telegraphTitleLevel` / `config.showLinkPreview` 读取 Telegraph 相关配置
- 从 `payload.attachments` 取图片，自行读取 buffer 并发送
- capabilities: `{ text: true, attachments: true, attachmentTypes: ['image/*'], maxAttachments: 9, warnOnAttachmentCount: true }`
- **复杂度：高** — 需要吸收 Telegraph 模块依赖和三模式切换

**改动文件：**
- `src/adapters/flomo.js`
- `src/adapters/mastodon.js`
- `src/adapters/missky.js`
- `src/adapters/notion.js`
- `src/adapters/telegram.js`

---

### 阶段三：管道瘦身

**3.1 简化 `executeAdapter`**

从 if/else 链改为：
```js
async executeAdapter(adapterId, payload) {
  const adapter = this.adapterRegistry.get(adapterId);
  const config = this.getAdapterConfig(adapterId);
  return adapter.execute({ config, payload, requestUrl });
}
```

**3.2 从 main.js 移除以下逻辑**
- `prepareNotionImages` → 已移入 Notion 适配器
- `compressImageToWebp` → 已移入 Notion 适配器
- `getImageMimeType` → 已移入各适配器
- `executeTelegraphSend` → 已移入 Telegram 适配器
- `ensureTelegraphToken` → 已移入 Telegram 适配器

**3.3 简化 `send-modal.doSend`**

去掉 per-adapter 分支，统一为：
```js
for (const adapterId of targetAdapters) {
  const result = await plugin.executeAdapter(adapterId, payload);
  results[adapterId] = result;
}
// Telegram 也走统一路径，channelIds 从 config 中读取
```

**3.4 去掉 `content-renderer` 的 Telegram 专属逻辑**

`renderTelegramSegments` 移入 Telegram 适配器。`content-renderer` 保留通用的 richDraft 构建逻辑（如果还有其他适配器用），否则也可简化。

**3.5 发送面板预检提示**

在 `doSend` 发布前，先按各适配器的能力声明识别图片数量和大小预警。命中预警时，发送按钮进入 5 秒确认状态；确认后再调用 `adapterRegistry.validateAll(targets, payload)`。如果有 errors 则阻止发送，普通 warnings 仍汇总提示。

**改动文件：**
- `src/main.js` — 大幅瘦身
- `src/ui/send-modal.js` — doSend 简化，增加预检
- `src/core/content-renderer.js` — 移除 Telegram 专属逻辑

---

### 阶段四：验证

- `npm run build` 确认构建通过
- 逐平台手动测试发送流程（文本 / 图片 / 多图）
- 确认 Telegraph 模式仍正常工作
- 确认 Notion 图片压缩仍正常工作
- 确认发送面板预检提示正确显示

---

## 不做的事

- 不改 settings-tab 的 UI 结构（适配器设置面板保持现有渲染方式）
- 不改 send-modal 的 UI 布局（目标选择、图片预览等保持不变）
- 不新增文件类型支持（本次只做架构解耦，不扩展功能）
- 不改 manifest.json 版本号
- 不做 Git 发布操作

---

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Telegram 三模式切换逻辑复杂，迁移可能遗漏 | 迁移后逐模式测试：plain / rich / telegraph |
| Notion 图片压缩依赖 Canvas API，移入适配器后环境不变 | Canvas API 在 Obsidian Electron 环境可用，移动位置不影响 |
| payload 结构设计不当导致后续扩展困难 | 先满足当前所有适配器的需求，不过度设计 |
| send-modal 中 Telegram 频道选择 UI 需要特殊处理 | channelIds 仍从 send-modal 传入 payload，适配器从 payload 取 |

---

## 执行审查记录

> 审查结论：本次解耦改造**尚未执行完善，不应视为可发布状态**。统一适配器主体已经迁移，但预检链路没有接通，并且至少存在一个 Telegram 设置功能回归和一个 Flomo 内容回归。以下记录仅描述检查结果；本次审查未修改任何源代码、生成文件或配置文件。

### 检查范围与证据

- 当前工作区包含本计划涉及的源文件变更：`src/main.js`、`src/ui/send-modal.js`、5 个适配器、`src/core/adapter-registry.js`、`src/core/content-renderer.js`，以及新增的 `src/core/payload.js`；生成的 `main.js` 也已变化。
- `git diff --check` 通过，没有发现空白错误或未解决冲突标记。
- 使用临时输出路径执行了一次 esbuild bundle 检查，构建解析通过；没有执行 `npm run build`，因此生产构建产物尚未由本次审查独立确认。
- 没有执行 Obsidian 内的逐平台手动发送、Telegram 三模式、Notion 图片压缩或发送面板预检场景；阶段四不能标记为完成。

### 各阶段进度

| 阶段 | 状态 | 现状 |
|---|---|---|
| 阶段一：统一接口 | 部分完成 | `AdapterRegistry.getCapabilities()`、`validateAll()` 和 `src/core/payload.js` 已添加；但发送面板仍手写 payload，`buildPayload()` 没有调用，`main.js` 只是导入未使用。统一 payload 的实际生产链路尚未建立。 |
| 阶段二：适配器迁移 | 基本完成但有回归 | 5 个适配器均提供统一 `execute({ config, payload, requestUrl })`，Notion 压缩和 Telegraph 编排已移入适配器；Mastodon 的超量策略没有按计划改为 warning，Telegram 设置操作返回值契约发生回归。 |
| 阶段三：管道瘦身 | 部分完成 | `main.js.executeAdapter()` 已去掉 per-adapter if/else；`content-renderer.js` 中 Telegram 渲染逻辑已移除。但 `send-modal.doSend()` 仍保留 Telegram 专属分支和 `extraConfig` 组装，且 `validateAll()` 完全没有被调用。 |
| 阶段四：验证 | 未完成 | 只确认了临时 bundle 和 diff 空白检查；未完成计划列出的生产构建、逐平台发送、Telegraph、Notion 压缩和预检提示验证。 |

### 必须修复的严重问题

#### 1. Telegram 频道发现功能已回归（高严重度）

- `src/adapters/telegram.js:840-844` 的 `runAction('discoverChannels')` 返回 `{ channels }`。
- `src/ui/settings-tab.js:188-191` 仍读取 `result.data?.channels`。
- 因此即使 Telegram API 成功发现频道，设置页也会得到空数组，并把空的 `channels` / `homeChannels` 保存回设置；用户无法正常保存发现到的频道。
- 这是本次适配器接口迁移造成的返回值契约不一致，发布前必须统一返回结构并实际点击验证。

#### 2. Flomo 会把本地图片 token 发到正文（高严重度）

- `src/ui/send-modal.js:1036-1042` 构造的 `payload.content` 是包含 `@图片N` 的原始内容，同时 `payload.plainText` 才是去除图片 token 后的文本。
- `src/adapters/flomo.js:82-95` 使用 `payload.content`，只移除 Markdown / Obsidian 图片语法，没有移除 `@图片N`。
- 发送带本地图片的内容到 Flomo 时，正文可能出现 `@图片1` 等内部占位符；适配器的 warning 也不能消除这个问题。
- Flomo 应使用 `payload.plainText`，同时保留从原始内容提取远程图片 URL 的逻辑。

#### 3. 预检功能实际上没有接入发送路径（高严重度）

- `src/core/adapter-registry.js:37-64` 实现了 `validateAll()`，但 `src/ui/send-modal.js:1085-1113` 发送前没有调用它。
- 发送面板也没有从 `getAdapterConfig()` 组装并传入各适配器的预检配置。
- 所有 manifest capabilities 和各适配器 `validate()` 当前都不会在发布前向用户显示；errors 不会阻止发送，warnings 不会显示。
- 用户点击发布后弹窗立即关闭，错误只能在后台发送完成后出现，完全不符合阶段三第 3.5 项。

#### 4. Mastodon 的超量行为与计划相反（高严重度）

- 计划要求超过 4 张图片时返回 warning、不再硬失败。
- 当前 `src/adapters/mastodon.js:121-123` 的 `validate()` 返回 error，`src/adapters/mastodon.js:158-163` 的 `execute()` 仍直接失败并声明“未发送任何内容”。
- 即使将来接通预检，也会阻止发送；当前未接通预检时则会在关闭弹窗后异步失败。必须先明确并实现计划要求的 warning / 截断或分批策略，再进行手动验证。

### 其他未完成或高风险项

1. **Payload 契约仍有两套来源。** `src/core/payload.js` 的 `extractAttachments()` 按图片数组位置生成 token；发送面板却在 `src/ui/send-modal.js:1027-1042` 手动生成 attachments，并把 `mimeType` 留为空字符串。后续适配器并未真正共享 `buildPayload()`，容易出现 token、图片顺序和正文不一致。
2. **Telegram 仍不是完全无平台分支的管道。** `send-modal.doSend()` 仍单独判断 Telegram、注入 `tgSendMode`、`channelIds`、Telegraph 标题和预览开关。这与“管道不感知适配器内部细节”的目标不一致；目前属于架构目标未完成，而不只是代码风格问题。
3. **Telegram Telegraph 自动保存可能污染持久化配置。** `executeAdapter()` 将临时 `extraConfig` 合并进 config；Telegraph 首次创建 token 时，`ensureTelegraphToken()` 会通过 `saveConfig()` 保存整个合并对象，可能把本次发送的 `channelIds`、`tgSendMode`、临时标题和预览开关写入长期设置。应只持久化 Telegraph token，或明确这些字段是否应持久化。
4. **能力声明与当前附件生产范围不完全一致。** Mastodon / Misskey manifest 声明支持 `video/*`，但 `src/main.js` 的 `IMAGE_EXTENSIONS` 和图片处理流程只收集图片；本计划又明确“不新增文件类型支持”。应删除视频能力声明或明确后续不属于本次改造，避免预检给出错误能力信息。
5. **Notion 的 5 MB 限制目前只是提示。** manifest 声明 `maxAttachmentSize` 为 5 MB，`validate()` 只检查扩展名，不检查大小；实际执行在未开启压缩时仍会继续上传超限图片。预检接通后仍需决定是阻止、压缩还是 warning，并保持 manifest、UI 提示和执行行为一致。
6. **现有 Telegram 富文本路径需要单独确认。** `src/adapters/telegram.js:441` 请求的是 `https://api.telegram.org/bot.../sendRichMessage`，这不是标准 Telegram Bot API 方法。该调用在改造前已存在，不能直接归因于本次解耦，但阶段四必须在真实环境确认；如果没有额外兼容服务，富文本模式本身就会失败。

### 发布前最低验收清单

- 修复 Telegram `runAction` 与 settings-tab 的返回值契约，并验证“获取频道列表”能保存非空频道。
- 让发送面板统一调用 `validateAll()`，为每个 adapter 传入真实 config；验证 warnings 展示、errors 阻止发送。
- 修复 Flomo 使用 `plainText` 的 token 泄漏；用带本地图片和远程图片的内容验证请求正文。
- 按明确的新策略验证 Mastodon 5 张图片、Misskey 超过 16 张、Notion 超过 5 MB 图片。
- 重新执行 `npm run build`，然后在 Obsidian 中验证纯文本、单图、多图，以及 Telegram plain / rich / telegraph、Notion 压缩。
- 构建后只复制本次实际变化的 `main.js`、`manifest.json`、`styles.css` 到 Obsidian 插件目录；不要复制 `src/` 或 `data.json`。

---

## 本次修复记录

### 已完成

- `src/ui/send-modal.js` 现在通过 `src/core/payload.js` 统一构建 payload，附件 token、MIME 类型、正文纯文本和附件读取函数由同一条路径生成。
- 发送面板把已选目标整理为统一适配器列表，Telegram 不再拥有单独的发送分支；Telegram 的频道、模式、Telegraph 标题和预览开关作为本次执行的临时配置覆盖传入，不写入持久化设置。
- 发布前先按 manifest 中的图片能力声明做统一预警；确认后再执行 `adapterRegistry.validateAll()`，warnings 仍通过 Notice 提示，errors 阻止发送。
- `src/main.js.executeAdapter()` 保持统一适配器调用，并保留通用的单次配置覆盖能力；Telegraph token 保存只写入 token patch，避免把临时 Telegram 选项污染到长期配置。
- Flomo 正文改为使用 `payload.plainText`，同时继续从原始内容提取远程图片 URL，不再把 `@图片N` 发送到正文。
- Telegram `runAction()` 恢复与 `settings-tab.js` 现有调用方兼容的 `{ success, message, data: { channels } }` 返回结构，并保留 `testConnection` 操作兼容性；没有改变任何 Telegram HTTP API 方法或地址。
- payload 附件提取只保留正文实际引用的 token，并支持显式 token，避免 `@图片1` 与 `@图片10` 的前缀误匹配。
- 各适配器新增 `maxAttachments`、`maxAttachmentSize`、`warnOnAttachmentCount`、`warnOnAttachmentSize` 四个图片边界字段；Mastodon、Misskey、Telegram 超量后分别只发送前 4、16、9 张，Flomo 不对本地图片预警，Notion 超过 5 MB 走通用预警。
- 发送按钮的预警确认状态只保留 5 秒；超时后再次点击会重新检查，而不是直接发送。
- 适配器的数量/大小执行阈值统一从自身 `manifest.capabilities` 读取，避免能力声明与内部常量再次漂移。

### 有意保留的策略

- Notion 超过 5 MB 目前只做预警；用户确认后继续现有流程，压缩行为仍由 Notion 配置决定。
- 未修改 Telegram 当前 `sendRichMessage` 调用方式；本次只打通能力预警、图片数量处理、内部配置、调度和结果处理逻辑。
- 不新增视频等文件类型支持；Mastodon / Misskey 的声明已按当前实际输入范围收敛为图片。

### 修复后验证

- `npm run build` 通过；本次构建实际更新的 Obsidian 插件文件是 `main.js` 和 `styles.css`。`manifest.json` 未变化。
- `git diff --check` 通过。
- 通用图片预警 smoke check 已通过：数量预警只对启用预警的平台出现，Notion 超过 5 MB 能被识别，Flomo 不产生本地图片预警。
- payload 附件映射行为已验证：正文引用 `@图片1`、`@图片10` 时只生成对应附件，不误包含未引用图片。
- Flomo 适配器行为已验证：请求正文使用纯文本，不包含 `@图片1`，远程图片仍进入 `image_urls`。
- Telegram `discoverChannels` 返回契约已通过适配器级调用验证。
- `AdapterRegistry.validateAll()` 的配置传递和聚合结果已通过适配器级调用验证。
- 尚未在 Obsidian 实际界面执行逐平台发送；生产发布前仍需完成真实 Vault、单图、多图、Telegram plain/rich/telegraph、Notion 压缩和 5 秒确认窗口场景验证。
---

## 当前能力声明（以实际行为为准）

> 前面的“执行审查记录”是修复前的检查快照；当前状态以“本次修复记录”和本节为准。

本次把图片相关能力统一成四个声明字段：

```js
{
  maxAttachments: 4,          // 图片数量上限；0 表示不声明数量上限
  maxAttachmentSize: 0,       // 单张图片大小上限（字节）；0 表示不做通用大小预警
  warnOnAttachmentCount: true,
  warnOnAttachmentSize: false
}
```

前端只按这四个字段做通用识别，不为某个平台写专门的判断分支。数量超限时，适配器负责落实“只发送前 N 张”；大小超限目前只做预警，是否压缩或继续发送仍由适配器自己的发送逻辑决定。

| 适配器 | 图片能力声明 | 预警开关 | 确认后的行为 | 当前状态 |
|---|---|---|---|---|
| Flomo | 不支持本地图片 | 数量：否；大小：否 | 本地图片不上传；正文中的远程图片 URL 仍按原逻辑处理 | 符合当前要求 |
| Mastodon | 最多 4 张图片 | 数量：是；大小：否 | 预警后只发送前 4 张 | 已实现 |
| Misskey | 最多 16 张图片 | 数量：是；大小：否 | 预警后只发送前 16 张 | 已实现 |
| Notion | 单张图片超过 5 MB | 数量：否；大小：是 | 用户确认后继续现有流程；开启压缩时尝试压缩，否则可能继续上传并由平台决定是否接受 | 预警已接入，是否强制限制仍未定稿 |
| Telegram | 最多 9 张图片 | 数量：是；大小：否 | 预警后只发送前 9 张 | 已实现 |

### 预警在前端的表现

1. 第一次点击“发布”时，前端按当前目标和当前图片重新读取数量、文件大小。
2. 如果命中任一目标的预警条件，发送按钮改成提示文字，并进入确认状态，状态只保留 5 秒。
3. 5 秒内再次点击，视为用户确认，继续执行普通预检和发送。
4. 5 秒内没有再次点击，按钮恢复为“发布”；之后再次点击会重新检查，并再次显示预警，不会因为上一次看过提示就自动发送。
5. 没有预警时，第一次点击直接进入普通预检和发送。Flomo 的本地图片不会触发预警。

### 能力声明在程序中的作用

能力声明是适配器和发送管道之间的通用契约：适配器声明边界，注册表负责解释边界，前端负责把边界转换成用户能理解的确认提示，适配器最终负责落实发送结果。

它不是权限控制，也不是单独的发送实现。声明只解决“什么时候需要提醒、提醒什么”；真正的数量截断、图片压缩、上传失败处理，仍然要由适配器保证。这样可以避免前端为 Flomo、Mastodon、Misskey、Notion、Telegram 分别增加一套判断逻辑。

## 当前还没做完的事

1. **真实 Obsidian 界面验收未完成。** 还没有在真实 Vault 中逐个平台验证纯文本、单图、多图、删除图片、重复图片、Telegram 三种模式、Notion 压缩和多频道发送。
2. **Notion 的 5 MB 是预警阈值，不是硬限制。** 这符合本次“预警后确认”的方向，但还需要决定压缩失败、格式不适合压缩以及用户确认后仍超限时的最终策略。
3. **Notion 的 100 张数量声明还没有对应的用户预警或截断策略。** 当前需求没有指定 Notion 超量时的处理方式，暂不擅自改变它的发送行为。
4. **Telegram rich 模式的外部接口仍未完成真实验证。** 当前调用的 `sendRichMessage` 不是标准 Telegram Bot API 方法，本次仍未改动它。
5. **5 秒确认窗口还没有在 Obsidian 中验证实际交互。** 特别是提示文字较长、同时命中多个平台、以及提示消失后再次点击的行为。

## 本次改动仍可能带来的问题

- **大小检查会在第一次点击时读取图片。** 大文件或网络盘 Vault 可能让第一次点击等待较久；读取失败时前端无法判断大小，用户可能看不到预警，但后续发送仍可能失败。
- **大小预警不是拦截。** Notion 用户确认后仍可能上传超限图片；预警只保证用户知情，不保证平台接受。
- **数量截断会改变用户原始内容。** Mastodon、Misskey、Telegram 会只发送前 N 张，后面的图片不会发出；多平台同时发送时，不同平台看到的图片数量可能不同。
- **后台发送仍然没有事务回滚和重试。** 一个目标成功、另一个目标失败时，成功结果不会撤回；Obsidian 退出或网络中断时，也没有任务恢复机制。
- **预警确认可能造成误操作。** 用户等待超过 5 秒后再次点击不会发送，而是再次看到预警；这是按要求设计的安全行为，但需要在界面上让用户容易理解。

## 风险项与优先级

| 优先级 | 风险 | 为什么需要关注 | 收口动作 |
|---|---|---|---|
| 高 | Telegram rich 外部接口不确定 | 结构迁移完成不代表实际发送可用，可能导致富文本模式整体失败 | 用真实 Bot 和频道单独验证，再决定保留、兼容或降级 |
| 高 | Notion 超过 5 MB 后仍可能继续上传 | 用户可能把“预警”理解成“已经处理好”，但压缩失败时平台仍可能拒绝 | 明确压缩失败和超限后的最终策略，并同步声明、提示和执行行为 |
| 高 | 能力声明和执行边界不一致 | 新增或修改能力字段时仍可能只改一侧 | 保持执行逻辑读取 manifest，并补充适配器级 smoke check |
| 中 | 第一次点击需要读取多个图片文件 | 大 Vault 或慢存储环境下，预警出现前可能有明显等待 | 完成真实 Vault 验证；必要时再考虑缓存文件大小，不在本次先行增加缓存复杂度 |
| 中 | 多平台部分成功 | 用户重试时可能重复发布已经成功的平台 | 保持结果提示清楚；不要把自动重试混入本次改造 |
| 中 | 5 秒确认窗口的可理解性 | 长提示、多目标提示和超时后的再次预警可能让用户误以为按钮失效 | 在真实 Obsidian 界面验证按钮文字、悬浮提示和超时行为 |
| 中 | UI 回归覆盖不足 | 适配器级 smoke check 不能证明 Vault 读取、编辑 token 和真实网络组合都正确 | 完成发布前的真实界面验收清单 |

## 当前结论

通用图片能力声明、前端预警识别、5 秒确认窗口，以及 Mastodon / Misskey / Telegram 的超量截断已经接通；Flomo 也不会再对本地图片做预警。构建和通用预警 smoke check 已通过，但真实 Obsidian 发送场景、Telegram rich 接口和 Notion 超大图片策略仍未收口。因此当前仍属于“代码路径已接通、发布验收未完成”，不能直接视为发布完成。
