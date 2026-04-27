# Plugin Guide

本文件定义 Journal Sync 当前代码库里的插件制作规范。

目标不是讨论理想设计，而是把“现在主程序真正支持什么、插件应该怎么接入”写清楚，作为后续新增插件的统一约定。

## 1. 适用范围

当前插件体系由以下部分组成：

- 插件目录：`Plugin/<PluginName>/`
- 插件加载器：`src/sync/plugin-manager.js`
- 插件中心与设置 UI：`public/home-v2.js`
- 插件 API：`src/web/server.js`
- 插件启停状态：`data/config.json` 中的 `plugins` 字段

本规范以这些文件的现有实现为准。

## 2. 插件目录结构

每个插件放在 `Plugin/` 目录下的一个独立子目录中，建议结构如下：

```text
Plugin/
└── ExamplePlugin/
    ├── index.js
    ├── config.example.json
    ├── README.md
    └── config.json
```

说明：

- `index.js`：插件入口，必须存在。
- `config.example.json`：示例配置，推荐提供，不能放真实凭据。
- `README.md`：插件说明，推荐提供。
- `config.json`：插件私有配置，本地使用，不提交版本库。

当前仓库 `.gitignore` 已忽略 `Plugin/*/config.json`。

## 3. 插件发现与加载规则

主程序会自动扫描 `Plugin/*/index.js`。

加载规则如下：

- 只有 `Plugin/<目录名>/index.js` 会被自动发现。
- 加载成功后，插件会进入注册表，并出现在 `/api/plugins/registry` 返回结果里。
- 如果目录下没有 `index.js`，或者模块加载失败，该目录会被跳过。

建议：

- 每个插件都显式导出 `manifest`，不要依赖目录名推断。
- `manifest.id` 一旦发布就不要轻易改，否则会影响启用状态、配置键和前端识别。

## 4. 必须导出的内容

插件入口文件建议至少导出以下内容：

```js
export const manifest = {
  id: 'example',
  version: '1.0.0',
  name: 'Example Plugin',
  description: '示例插件',
  category: 'general',
  enabledByDefault: false,
  dependsOn: [],
  ui: {
    homeV2: {
      section: 'publish_simple',
      order: 100,
      label: 'Example'
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
    test: false
  }
};

export async function loadConfig() {}
export async function saveConfig(config) {}
export async function execute(context) {}
export async function runAction(actionId, payload) {}

export default {
  manifest,
  loadConfig,
  saveConfig,
  execute,
  runAction
};
```

注意：

- `loadConfig`、`saveConfig`、`execute` 不是语法层面强制，但当前体系默认插件应该提供。
- 如果插件声明了 `settings.actions`，就应同时实现 `runAction`。
- `default export` 建议保留。当前加载器会优先把 `default` 当作插件方法集合；`manifest` 则优先读取命名导出的 `manifest`，再回退到 `default.manifest`。

## 5. manifest 规范

### 5.1 顶层字段

| 字段 | 是否建议必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 插件唯一标识，必须稳定 |
| `version` | 是 | 插件版本 |
| `name` | 是 | 展示名称 |
| `description` | 是 | 简短说明 |
| `category` | 是 | 分类，例如 `diary-sync`、`save-local` |
| `enabledByDefault` | 是 | 默认启用状态 |
| `dependsOn` | 否 | 依赖的其他插件 `id` 列表 |
| `ui.homeV2` | 否 | 首页入口声明 |
| `settings` | 是 | 设置页 schema |
| `capabilities` | 是 | 能力声明 |

### 5.2 `dependsOn`

`plugin-manager` 会根据 `dependsOn` 做执行顺序排序。

约束：

- 值为插件 `id` 数组。
- 只用于执行顺序，不会自动帮你启用依赖插件。
- 建议只声明真实依赖，不要把展示上的先后顺序写成依赖。

### 5.3 `ui.homeV2`

这个字段决定插件在新版主页中的入口位置。

当前支持的 `section` 只有：

- `edit`
- `publish_simple`
- `publish_advanced`
- `save_local`

字段说明：

- `section`：插件归属分区。
- `order`：同分区排序，数字越小越靠前。
- `label`：主页按钮或目标标签的显示文案。

规范要求：

- 需要在主页出现的插件，必须声明 `ui.homeV2`。
- 不希望在主页直接显示的插件，可以不声明。
- 插件关闭后，主页不应再作为可用目标出现。

补充：

- 当前代码对 `flomo`、`mastodon`、`missky`、`telegram`、`obsidian-local` 保留了少量旧插件分区 fallback。
- 新插件不要依赖 fallback，必须显式声明 `ui.homeV2`。

推荐映射：

- 一键发布类插件：`publish_simple`
- 高级发布或需要额外处理的插件：`publish_advanced`
- 本地保存类插件：`save_local`

### 5.4 `settings`

当前主程序采用“插件声明 schema，前端通用渲染”的模式。

插件中心会基于 `/api/plugins/registry` 返回的注册表动态渲染设置字段与动作按钮。新增插件通常不需要改 `public/home-v2.js` 来硬编码设置表单；只要把字段写进 `manifest.settings.sections`，把按钮写进 `manifest.settings.actions`，前端就会按通用组件渲染。

结构如下：

```js
settings: {
  storage: 'plugin',
  sections: [
    {
      id: 'basic',
      title: '基础配置',
      description: '可选',
      fields: []
    }
  ],
  actions: []
}
```

#### `settings.storage`

当前统一使用：

```js
storage: 'plugin'
```

表示配置保存在插件自己的 `Plugin/<PluginName>/config.json` 中。

#### `settings.sections`

每个 section 会在插件中心渲染成一个设置卡片。

字段：

- `id`：分组唯一标识
- `title`：分组标题
- `description`：分组说明，可选
- `fields`：字段数组

#### `settings.sections[].fields[]`

当前前后端已支持的字段类型：

- `text`
- `password`
- `textarea`
- `boolean`
- `select`
- `checkboxGroup`
- `number`

字段通用属性：

| 字段 | 说明 |
| --- | --- |
| `key` | 配置键，支持点路径，如 `auth.token` |
| `type` | 字段类型 |
| `label` | 展示名称 |
| `description` | 字段说明，可选 |
| `required` | 是否必填 |
| `sensitive` | 是否敏感字段 |
| `default` | 默认值，仅作为声明信息 |
| `placeholder` | 输入框占位文案 |
| `options` | `select` / `checkboxGroup` 的静态选项 |
| `optionsSource` | `select` / `checkboxGroup` 的动态选项来源 |
| `allowCustomValue` | `select` 是否允许自定义值 |
| `validate` | 校验规则 |

说明：

- `field.key` 是通用配置保存接口的合并白名单。只有在 manifest 里声明过的字段，`POST /api/plugins/:id/config` 才会从前端提交里合并。
- 因此不要指望前端额外提交一个未声明字段，后端自动帮你存下来。
- 但插件自己的 `loadConfig/saveConfig/runAction` 仍可维护内部字段，例如 Telegram 的 `channels`。这类字段不应依赖前端普通保存接口写入。

`validate` 当前支持：

- 文本：`minLength`、`maxLength`、`pattern`、`message`
- 数字：`min`、`max`、`message`

校验行为：

- `required: true` 且值为空时，后端会拒绝保存。
- `type: 'number'` 时，后端会校验是否可转成数字。
- `type: 'select'` 且 `allowCustomValue !== true` 时，值必须落在选项范围内。
- `type: 'checkboxGroup'` 时，值必须是数组；若声明了选项，数组值必须落在选项范围内。
- `validate.pattern` 使用正则表达式字符串。

#### `optionsSource`

适用于配置里某个 `select` 或 `checkboxGroup` 字段要引用同一份配置中的动态列表，例如 Telegram 的频道列表：

```js
{
  key: 'defaultChannel',
  type: 'select',
  optionsSource: {
    path: 'channels',
    valueKey: 'id',
    labelKey: 'title',
    captionKey: 'username'
  },
  allowCustomValue: true
}
```

规范要求：

- `path` 指向当前插件配置对象中的数组字段。
- 数组元素可以是对象，也可以是简单值。
- 若是对象，建议显式声明 `valueKey` 与 `labelKey`。

#### `settings.actions`

插件动作会在设置页自动渲染为按钮。

示例：

```js
actions: [
  {
    id: 'testConnection',
    label: '测试连通性',
    kind: 'test'
  },
  {
    id: 'discoverChannels',
    label: '获取频道列表',
    kind: 'fetch'
  }
]
```

约束：

- `id` 必须稳定且唯一。
- `label` 是按钮展示文案。
- `kind` 目前主要用于语义区分，常见值有 `test`、`fetch`。
- 声明了 action，就要在 `runAction(actionId, payload)` 中处理它。

### 5.5 `capabilities`

当前建议至少声明：

```js
capabilities: {
  execute: true,
  configure: true,
  test: false
}
```

说明：

- `execute`：插件是否支持参与主流程执行。
- `configure`：插件是否可配置。
- `test`：插件是否支持测试动作。当前默认值会根据是否存在 action 推断，但建议显式声明。

实现现状：

- `capabilities` 当前主要用于能力展示和前端说明，不是执行权限系统。
- 当前执行链路不会因为 `capabilities.execute === false` 自动跳过插件；真正决定是否执行的是插件启停状态、主页选择的目标，以及插件模块是否实现了 `execute`。
- 因此不参与主流程的插件不要只依赖 `capabilities.execute: false`，应避免暴露到可执行分区，或让 `execute` 明确返回 `skipped`。

### 5.6 `capabilities.media`

这部分不是摆设。新版主页会读取它来解释插件如何处理图片输入。

推荐结构：

```js
capabilities: {
  media: {
    acceptsImages: true,
    acceptsInputImages: true,
    mode: 'upload',
    maxImages: 9,
    settingsDescription: '说明这个插件如何处理图片',
    summary: '摘要说明',
    withImagesSummary: '有图时的摘要说明',
    withImagesNote: '有图时的额外提示'
  }
}
```

字段含义建议：

- `acceptsImages`：插件逻辑上是否支持图片。
- `acceptsInputImages`：是否能直接处理当前页面拖拽/粘贴的本地图片。
- `mode`：图片处理方式，现有插件中已使用 `upload`、`media_group`、`public_urls`、`assets`。
- `maxImages`：单次处理上限。
- `settingsDescription`：插件中心里的技术说明。
- `summary` / `withImagesSummary` / `withImagesNote`：插件自描述文案，现有插件已填写；当前 `public/home-v2.js` 主要消费 `acceptsImages`、`acceptsInputImages`、`mode`、`maxImages` 和 `settingsDescription`。

规范要求：

- 只要插件涉及图片，必须写清楚 `capabilities.media`。
- 如果插件不能直接接收本地图片，要把限制写进 `settingsDescription` 和 `withImagesNote`。

## 6. 配置存储规范

### 6.1 存储位置

- 主程序总配置：`data/config.json`
- 插件私有配置：`Plugin/<PluginName>/config.json`
- 插件启停状态：`data/config.json` 的 `plugins.<pluginId>`，不是插件私有配置

约束：

- 插件自己的账号、密钥、频道列表、实例地址等，优先存放在插件私有配置中。
- 不要再把新插件配置塞进主配置。
- 不要把“是否启用插件”写进插件私有配置；启停由主程序统一管理。
- Token、API Key、Webhook、密码等敏感字段必须放在插件私有配置中，并在 `manifest.settings.sections[].fields` 中声明 `sensitive: true`。主程序只会对 manifest schema 中声明为敏感的字段做统一脱敏和保留旧值处理。

### 6.2 `loadConfig`

职责：

- 读取插件自己的 `config.json`
- 必要时合并默认值
- 必要时兼容旧配置迁移
- 返回普通对象

建议：

- 在函数内部做 normalize，保证返回结构稳定。
- 可做内存缓存，但对外返回值最好可安全复制。

### 6.3 `saveConfig`

职责：

- 接收已经过主程序校验的配置对象
- 做必要的 normalize
- 落盘保存到插件目录

约束：

- 不要在 `saveConfig` 里偷偷忽略 schema 里声明的字段。
- 不要把额外的临时数据写入不相关路径。
- 如果某个用户可编辑配置项需要通过通用设置页保存，就必须先在 `manifest.settings.sections[].fields` 里声明。
- 如果 action 会生成内部缓存字段，例如频道列表，action 可以自行调用插件的 `saveConfig` 保存，但要保证这些字段可以安全返回给前端。

### 6.4 敏感字段

如果字段声明了 `sensitive: true`，主程序会：

- 在读取给前端时把值替换成 `__SECRET_PRESENT__`
- 在保存时，如果传回空字符串、`****` 或 `__SECRET_PRESENT__`，则保留旧值

因此插件作者需要遵守：

- Token、API Key、Webhook、密码类字段都应标记 `sensitive: true`
- 不要自己再做另一套前端掩码协议
- 插件自身仍要在 `execute` / `runAction` 中做业务级校验，例如真实连通性、第三方 token 是否有效、远端 API 是否接受当前参数。主程序的 manifest 校验只覆盖必填、类型、选项、长度、正则和数字范围这类 schema 规则。

## 7. `execute(context)` 规范

插件主执行入口为 `execute(context)`。

当前通用执行链路里，主程序传入的 `context` 至少包含：

```js
{
  content,
  type,
  options,
  images
}
```

字段说明：

- `content`：本次要处理的文本内容。
- `type`：当前通常是 `diary` 或 `note`。
- `options`：前端传入的执行选项。
- `images`：图片绝对路径数组。

补充说明：

- 某些专用路由可能会额外注入字段，例如 `imageFilenames`。
- 因此插件可以按需接收扩展字段，但不要反过来要求所有调用方都必须提供这些扩展字段。

实现要求：

- 插件必须自己调用 `loadConfig()` 获取配置，不要假设主程序会把配置注入到 `context`。
- 要对空内容、未配置、图片超限等情况返回明确结果。
- 不要直接抛业务错误，尽量返回结构化结果；真正异常再抛出。

推荐返回格式：

```js
{
  success: true,
  message: '发布成功',
  warnings: [],
  data: {}
}
```

可接受的扩展字段：

- `error`
- `warnings`
- `skipped`
- 其他业务字段

主程序会在 action 场景中统一做结果标准化；普通执行场景虽然不会强制重写结构，但也应尽量遵守同一格式。

## 8. `runAction(actionId, payload)` 规范

插件设置页里的按钮统一走：

- `POST /api/plugins/:id/actions/:actionId`

当前前端调用动作前会先保存插件配置，然后再把草稿配置作为 `payload.config` 发给后端。后端也会再次做基于 manifest 的合并与校验。

因此 `runAction` 的职责应该是：

- 根据 `actionId` 分派逻辑
- 读取当前配置，必要时与 `payload.config` 合并
- 返回结构化结果

推荐模式：

```js
export async function runAction(actionId, payload = {}) {
  if (actionId !== 'testConnection') {
    throw new Error(`Unknown action: ${actionId}`);
  }

  const currentConfig = await loadConfig();
  const nextConfig = { ...currentConfig, ...(payload.config || {}) };

  return {
    success: true,
    message: '连接成功',
    data: {}
  };
}
```

动作返回结果的统一目标格式：

```json
{
  "success": true,
  "message": "连接成功",
  "warnings": [],
  "data": {}
}
```

规则：

- 如果你直接返回 `channels`、`username` 之类的顶层字段，主程序会把它们归并进 `data`。
- 如果返回 `Error` 对象，主程序会转成 `success: false`。
- 动作应尽量无副作用，除非动作本身就是“拉取列表并回填配置”这种明确行为。
- 当前前端会把 `data.channels` 回填到设置草稿里用于立即刷新动态下拉框；如果这个列表需要长期保存，插件 action 自己也应调用 `saveConfig` 落盘。

## 9. 插件中心相关接口

当前插件体系依赖以下接口：

- `GET /api/plugins/registry`
- `GET /api/plugins/:id/config`
- `POST /api/plugins/:id/config`
- `POST /api/plugins/:id/toggle`
- `POST /api/plugins/:id/actions/:actionId`

插件作者通常不需要自己新增这些接口，但必须保证插件实现与这些接口契合。

### 9.1 `/api/plugins/registry`

返回每个插件的：

- `id`
- `name`
- `description`
- `enabled`
- `manifest`
- `config`（敏感字段已脱敏）

这意味着：

- 前端展示什么，主要取决于你的 `manifest`
- 你的配置结构必须能安全返回给前端

### 9.2 保存配置失败

当 manifest 校验失败时，后端会返回：

```json
{
  "ok": false,
  "error": "插件配置校验失败: xxx",
  "validationErrors": [
    { "field": "botToken", "message": "Bot Token 格式不正确" }
  ]
}
```

因此：

- 字段级错误信息要写得明确
- `field` 必须能对应到你声明的 `field.key`

## 10. 推荐实现约束

### 10.1 文件与路径安全

- 所有本地文件写入都要避免路径穿越。
- 若插件会处理文件名，必须先做 `basename` 或等价清洗。
- 若插件接收目录路径配置，建议只接受绝对路径，并通过 `validate.pattern` 明确限制。

### 10.2 网络与第三方 API

- 插件内自行处理超时、HTTP 错误和错误消息提取。
- 返回给前端的错误文案应可直接展示给人看。
- 不要把原始敏感响应直接打印或返回。

### 10.3 配置迁移

如果历史版本把配置放在 `data/config.json`，新插件实现可以在 `loadConfig()` 中读取旧值并迁移为 fallback，但规范上新字段应写回插件自己的 `config.json`。

### 10.4 可观测性

- 日志中打印插件名和动作名。
- 对外返回 `message`，对内保留必要日志。
- 网络失败、脚本启动失败、第三方返回非 2xx 时，错误要能区分来源。

## 11. 最小插件模板

```js
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, 'config.json');

const defaultConfig = {
  endpoint: '',
  token: ''
};

let configCache = null;

export const manifest = {
  id: 'example',
  version: '1.0.0',
  name: 'Example',
  description: '示例插件',
  category: 'general',
  enabledByDefault: false,
  dependsOn: [],
  ui: {
    homeV2: {
      section: 'publish_simple',
      order: 100,
      label: 'Example'
    }
  },
  settings: {
    storage: 'plugin',
    sections: [
      {
        id: 'basic',
        title: '基础配置',
        fields: [
          {
            key: 'endpoint',
            type: 'text',
            label: '接口地址',
            required: true,
            validate: {
              pattern: '^https?://.+',
              message: '接口地址必须以 http:// 或 https:// 开头'
            }
          },
          {
            key: 'token',
            type: 'password',
            label: '访问令牌',
            required: true,
            sensitive: true,
            validate: {
              minLength: 8,
              message: '访问令牌不能为空'
            }
          }
        ]
      }
    ],
    actions: [
      {
        id: 'testConnection',
        label: '测试连通性',
        kind: 'test'
      }
    ]
  },
  capabilities: {
    execute: true,
    configure: true,
    test: true,
    media: {
      acceptsImages: false,
      acceptsInputImages: false,
      mode: 'metadata',
      maxImages: 0,
      settingsDescription: '该插件只处理文本内容',
      summary: '只发送文本',
      withImagesSummary: '有图片时仍只发送文本',
      withImagesNote: '图片会被忽略'
    }
  }
};

export async function loadConfig() {
  if (configCache) return { ...configCache };
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    configCache = { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    configCache = { ...defaultConfig };
  }
  return { ...configCache };
}

export async function saveConfig(config) {
  configCache = { ...defaultConfig, ...(config || {}) };
  await fs.writeFile(CONFIG_FILE, JSON.stringify(configCache, null, 2), 'utf-8');
}

export async function execute({ content }) {
  const config = await loadConfig();

  if (!config.endpoint || !config.token) {
    return { success: false, message: '插件未配置完成' };
  }

  if (!String(content || '').trim()) {
    return { success: false, message: '内容不能为空' };
  }

  return {
    success: true,
    message: '执行成功'
  };
}

export async function runAction(actionId, payload = {}) {
  if (actionId !== 'testConnection') {
    throw new Error(`Unknown action: ${actionId}`);
  }

  const currentConfig = await loadConfig();
  const nextConfig = { ...currentConfig, ...(payload.config || {}) };

  if (!nextConfig.endpoint || !nextConfig.token) {
    return { success: false, message: '配置不完整' };
  }

  return {
    success: true,
    message: '连接成功',
    data: {
      endpoint: nextConfig.endpoint
    }
  };
}

export default {
  manifest,
  loadConfig,
  saveConfig,
  execute,
  runAction
};
```

## 12. 新插件接入检查清单

新增插件前，至少完成下面这些项：

- 在 `Plugin/<PluginName>/index.js` 中导出 `manifest`
- `manifest.id` 已明确且稳定
- 设置页所需字段都写进 `settings.sections[].fields`
- 测试按钮或拉取动作都写进 `settings.actions`
- 敏感字段都标了 `sensitive: true`
- 插件配置保存到 `Plugin/<PluginName>/config.json`
- `ui.homeV2` 已声明主页分区和排序
- 如涉及图片，已补全 `capabilities.media`
- `execute` 返回结构化结果
- `runAction` 能处理未知 action 并报错
- `config.example.json` 不含真实密钥
- `README.md` 写明最基本的配置和使用方式

## 13. 当前结论

在这个项目里，插件的核心边界已经很清楚：

- 主程序负责发现插件、管理启停、校验配置、渲染设置页、暴露统一 API。
- 插件负责声明自己的元信息、设置 schema、动作、图片能力，以及真正的业务执行逻辑。

后续新增插件时，优先遵守这个边界，不要再把插件专属设置写死到主程序页面或单独新增一套专用设置接口。
