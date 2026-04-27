# Journal Sync

Journal Sync 是一个本地优先的日记/笔记发布与保存工具。主页输入会先进入本地草稿缓存；发布和保存是两条独立链路：发布会直接分发到 flomo、Telegram、Mastodon/Missky 等目标，只有点击“保存到 Obsidian”时才会写入本地 Obsidian 日记。

## 功能总览

- 主页采用“输入 / 发布 / 保存”三段式工作流
- 输入区自动缓存与恢复（服务端文件缓存，文字 + 图片）
- 图片拖拽/粘贴上传，输入阶段只写入临时缓存
- 主页图片输入桥接：输入区独立管理图片，发布/保存插件统一作为接收端
- 主页图片缩略图与大图预览（点击缩略图放大，点空白/右上角/`Esc` 关闭）
- 保存和发布过程状态反馈（Obsidian 本地保存 + 各发布插件）
- Telegram 频道发布（支持多频道、图片、本地格式优化、来源链接）
- 插件中心（启停、配置、动作执行）
- 插件中心统一管理 AI、代理、插件配置和插件动作
- 输入框自适应高度（按内容自动增高，已抽为全局可复用能力）

## 页面与入口

- 主页：`http://localhost:3000/`
  - 单输入框 + 发布/保存解耦工作流 + 插件分区渲染
  - 支持拖拽/粘贴图片到输入框，显示方形缩略图，并按插件差异展示图片状态
  - 通过插件中心弹窗管理全局和插件配置
  - 文字和图片会自动同步到 `data/draft-cache/home-v2.json`，程序重启后仍可恢复
- 插件中心直达：`http://localhost:3000/?open=plugin-center`
  - 统一处理插件启停、配置与动作执行

## 技术栈与要求

- Node.js `>=18`
- 如启用本地保存：需准备本地可写 Obsidian 目录
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

设计规范（主页与插件中心）：

- 解耦：插件只通过 `manifest + execute/loadConfig/saveConfig/runAction` 与主程序协作，不直接耦合页面实现。
- 自动发现：后端会自动扫描 `Plugin/*/index.js`，发现后加入注册表，无需手工硬编码插件列表。
- 自动注册到插件中心：插件中心基于 `/api/plugins/registry` 动态渲染，目录存在且可加载的插件会自动出现在设置侧栏。
- 设置自动识别：插件在 `manifest.settings.sections/actions` 中声明字段与动作后，插件中心会自动渲染对应设置页面与按钮。
- 主页自动识别：插件声明 `manifest.ui.homeV2` 后，可自动进入对应分区；未启用插件不会在主页显示，启用后立即可见。

最小接口示例：

```js
export const manifest = {
  id: 'example-publisher',
  version: '1.0.0',
  name: 'Example Publisher',
  description: '发送内容到示例目标',
  dependsOn: [], // 可选：声明执行依赖
  enabledByDefault: false,
  ui: {
    homeV2: {
      section: 'publish_simple', // edit | publish_simple | publish_advanced | save_local
      order: 10,
      label: 'Telegram'
    }
  },
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
- `checkboxGroup`
- `number`

配置存储策略：

- 主配置：`data/config.json`
- 插件私有配置：`Plugin/<plugin>/config.json`
- 敏感字段读取时会脱敏，保存空字符串时保留旧值
- 插件执行顺序支持显式依赖：`manifest.dependsOn: string[]`
- 主页分区声明：`manifest.ui.homeV2`

### 图片输入与插件通信

主页的图片机制不是把上传逻辑塞进每个发布按钮，而是拆成了独立输入层：

- 输入层：`public/input-media-bridge.js`
  - 负责输入框拖拽/粘贴图片、缩略图渲染、预览弹层、删除图片、拖动排序
  - 调用 `POST /api/upload-image` 将图片先缓存到 `data/image-cache/`
  - 只负责输入 UI 和上传，不再单独承担恢复逻辑
- 页面层：`public/home-v2.js`
  - 维护文本输入和图片状态（`state.inputMedia`）
  - 在文本输入、图片新增、图片删除、图片重排时防抖同步整份草稿到服务端
  - 发布时把文本与 `imageFilenames` 一起交给接收端
  - 当输入区没有图片时，不展示任何图片状态
  - 当输入区有图片时，只根据插件能力渲染短状态：`无图片` / `上传x张图` / `上传前x张图`
  - 技术性图片说明只显示在插件中心的各插件设置页顶部
- 服务层：`src/web/server.js`
  - 通过 `GET/POST/DELETE /api/home-v2-draft` 维护 `data/draft-cache/home-v2.json`
  - 草稿文件只保存文字和图片文件名列表，图片实体仍在 `data/image-cache/`
  - 草稿更新时会删除已从输入区移除且仍位于 `data/image-cache/` 的缓存图
  - 在 `publish/save-local/telegram-publish` 入口统一校验 `imageFilenames`
  - 发布入口只解析缓存图片路径，不写入 Obsidian `assets/`
  - 本地保存入口把缓存图片路径交给 Obsidian 本地保存插件，由插件自行写入图片目录
  - 发布时把图片路径数组 `images[]` 交给各发布插件
- 插件层：
  - 各插件通过 `execute({ content, type, options, images })` 接收图片
  - 各自决定是上传附件、忽略，还是附带 warning

这套结构的目标是把“输入部分”和“输出部分”分开维护：

- 输入部分只负责收集文本与图片
- 输出部分的每个插件只负责解释和消费 `images[]`
- 二者通过统一 payload 和插件接口连接，后续新增插件时不需要重写输入区

### 插件图片能力声明

插件可以在 `manifest.capabilities.media` 中声明图片能力，主页会自动识别：

```js
capabilities: {
  execute: true,
  configure: true,
  test: true,
  media: {
    acceptsImages: true,
    acceptsInputImages: true,
    mode: 'upload', // upload | assets | public_urls | media_group | metadata
    maxImages: 4,
    settingsDescription: '插件设置页顶部显示的图片技术说明',
    summary: '默认说明',
    withImagesSummary: '当前已有图片时的说明',
    withImagesNote: '额外限制或行为说明'
  }
}
```

当前 `mode` 语义：

- `upload`：插件会把本地图片上传到目标平台，再发表正文
- `assets`：图片保存到 Obsidian `assets/`，正文追加 Markdown 引用
- `public_urls`：插件只接受公网图片 URL，不能直接接收本地拖拽图片
- `media_group`：插件按媒体组或平台图片接口发送
- `metadata`：插件只接收图片数量等上下文，不解析图片内容本身

主页当前对图片状态的前端展示规则：

- 没有输入图片时：所有插件都不显示图片状态
- 有输入图片时：
  - 不能接收当前输入图片的插件显示 `无图片`
  - 输入图片数量不超过插件上限时显示 `上传x张图`
  - 输入图片数量超过插件上限时显示 `上传前x张图`

图片顺序规则：

- 输入区缩略图出现顺序，就是初始图片顺序
- 用户拖动缩略图后，会直接改写输入层保存的图片顺序
- 发布、保存、Telegram 单独发送时，后端都按这个顺序读取 `imageFilenames`
- 各插件只消费顺序后的 `images[]`，不需要知道拖拽 UI 的实现细节

### 当前各插件的图片行为

- `Obsidian Local`
  - 完整保存链路
  - 图片会被复制到配置的图片保存路径，并作为 `![[xxx]]` 追加到正文
- `Telegram`
  - 单图走 `sendPhoto`
  - 多图走 `sendMediaGroup`
  - 若文案超过 Telegram caption 长度限制，会在图片成功后拆分补发文字
- `CMX`（`Plugin/Mastodon`）
  - 先上传图片到实例，再通过 `media_ids` 发表状态
  - 单条状态最多附带 4 张图，超过部分会被忽略并返回 warning
- `Missky`
  - 先上传到 Drive，再通过 `fileIds` 发 note
  - 逻辑与 CMX 一致，但上游 API 是 Misskey 的 `drive/files/create` + `notes/create`
- `flomo`
  - 官方 Webhook 支持 `content` 和 `image_urls`
  - 但 `image_urls` 必须是公网可访问 URL
  - 这意味着本地拖拽/粘贴图片无法直接发送给 flomo；当前实现会发送文字，并在有本地图片时返回 warning

## 常用 API

核心写入：

- `GET/POST/DELETE /api/home-v2-draft`
  - 主页输入区草稿读写与清空
- `POST /api/save-local-v2`
  - 当前主页的本地保存接口，只执行 Obsidian 本地保存插件

Telegram：

- `POST /api/telegram/publish`
  - 请求体会进行基础校验（`content/channel/type/imageFilenames/sourceUrl`）
- `POST /api/publish`
  - 发布编排接口（只发布，不保存）
  - 也支持 `imageFilenames`，服务端只从 `data/image-cache/` 解析图片路径后分发给插件

图片相关：

- `GET /api/home-v2-draft`
  - 读取主页当前草稿
  - 返回文字内容和图片文件名列表
- `POST /api/home-v2-draft`
  - 用当前输入区完整状态覆盖草稿文件
  - 草稿文件位置：`data/draft-cache/home-v2.json`
- `DELETE /api/home-v2-draft`
  - 当输入区清空时删除草稿文件
  - 同时清理本次草稿中不再引用的缓存图片
- `POST /api/upload-image`
  - 前端拖拽/粘贴图片时使用
  - 只写入 `data/image-cache/`，不会直接落到 Obsidian
- `GET /api/image-cache/:filename`
  - 先从缓存目录取图
  - 缓存不存在时会回退查询 Obsidian `assets/`

插件：

- `GET /api/plugins/registry`
- `GET /api/plugins/:id/config`
- `POST /api/plugins/:id/config`
- `POST /api/plugins/:id/toggle`
- `POST /api/plugins/:id/actions/:actionId`
  - 插件测试、频道发现等动作统一走这个入口

主页本地保存：

- `POST /api/save-local-v2`
  - 仅执行 `obsidian-local` 插件，保存到 Obsidian 本地日记

## 输入框自适应高度（全局能力）

- 共享实现：`public/global-input-traits.js`
- 全局对象：`window.GlobalInputTraits`
- 现有接入：
  - 主页 `public/home-v2.html` + `public/home-v2.js`

常用调用方式：

```js
window.GlobalInputTraits.mountAutoGrowTextarea('unique-key', textareaElement, {
  reserveLines: 2
});
```

可用方法：

- `autoGrowTextarea(textarea, options)`
- `mountAutoGrowTextarea(key, textarea, options)`
- `unmountAutoGrowTextarea(key, options)`
- `refreshAutoGrowTextarea(key)`

## 主页图片输入实现

涉及文件：

- `public/home-v2.html`
  - 输入区增加图片状态栏、缩略图网格、预览弹层
- `public/home-v2.css`
  - 输入框拖拽高亮、缩略图样式、拖动排序态、预览弹层样式、插件图片状态标签样式
- `public/input-media-bridge.js`
  - 抽离的图片输入桥接层
  - 负责缩略图 UI、排序和上传
- `public/home-v2.js`
  - 读取桥接层状态
  - 将文字内容和 `imageFilenames` 防抖同步到 `/api/home-v2-draft`
  - 将 `imageFilenames` 发给 `/api/publish`、`/api/save-local-v2`、`/api/telegram/publish`
  - 根据插件的 `capabilities.media` 动态渲染短状态
  - 插件中心设置页顶部单独渲染图片技术说明
- `src/web/server.js`
  - 维护主页草稿文件和缓存图片清理
  - 校验图片参数
  - 发布时只读取缓存图片路径
  - 本地保存时把缓存图片路径交给 Obsidian 本地保存插件

关键流程：

1. 用户在 `#v2ContentInput` 中输入文字，或拖拽 / 粘贴图片
2. `input-media-bridge.js` 调用 `/api/upload-image`，服务端将图片暂存到 `data/image-cache/`
3. `home-v2.js` 在文本变化、图片新增、图片删除、图片重排后，防抖调用 `/api/home-v2-draft`
4. 服务端把当前整份输入态写入 `data/draft-cache/home-v2.json`
5. 如果某张图已从输入区移除，服务端会把仍留在 `data/image-cache/` 的对应缓存文件删掉
6. 页面重开或程序崩溃重启后，前端先读取 `/api/home-v2-draft` 恢复文字和图片
7. 用户点击发布或保存时，前端按当前顺序把 `imageFilenames` 连同文本一起提交
8. 发布链路只从 `data/image-cache/` 解析图片路径并交给发布插件
9. Obsidian 本地保存插件单独把缓存图片写入本地图片目录

这样做的几个原因：

- 避免插件直接依赖前端上传细节
- 输入层与输出层边界清晰，后续维护时更容易替换任何一边
- 这套后端图片缓存/落盘能力可以被多个页面复用

## 目录结构

```text
.
├── Plugin/                   # 各插件实现与私有配置
├── public/                   # 前端页面与静态资源
├── src/
│   ├── sync/                 # 保存与插件执行逻辑
│   ├── utils/                # 配置/代理等工具
│   └── web/                  # Express 服务
├── data/                     # 运行时数据（config、tasks、draft-cache、image-cache 等）
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
- 图片文件名在写入 `assets/` 前会做路径约束，拒绝路径穿越输入
- AI 地址会根据接口类型自动规范到 `.../chat/completions` 或 `.../responses`

## 已知限制

- 图片上传单张限制 `20MB`，前端最多选择 `9` 张
- flomo 对图片的“可行性”依赖公网 `image_urls`；本地图片当前不会被直接发到 flomo
- Mastodon/CMX 单条状态最多发送 `4` 张图

## 许可证

仓库当前未包含 License 文件；若准备公开发布，建议补充正式许可证。
