# 插件设置独立化设计草案

## 背景

当前项目已经具备“插件执行层”的动态加载能力，但“插件设置层”仍然耦合在主程序中：

- `src/sync/plugin-manager.js` 会自动发现并加载 `Plugin/*/index.js`
- `public/settings.html` 仍然硬编码了各插件的设置表单
- `src/web/server.js` 仍然硬编码了各插件配置的读取、保存和测试逻辑
- `public/plugins.html` 仍然硬编码了插件开关列表

这导致当前的“插件系统”并不完整。新增一个插件时，除了写插件本身，还必须同步修改：

- 设置页 HTML
- 设置页 JS
- 后端配置 API
- 插件管理页

这与“每个插件应尽量独立”的目标不一致。

## 目标

本设计希望实现以下目标：

1. 插件的设置项定义由插件自己提供，而不是写死在主程序中。
2. 主程序启动时动态读取插件定义，自动生成设置页和插件管理页。
3. 主程序不再关心某个插件有哪些具体字段名。
4. 插件的配置读写仍由插件自己负责。
5. 对“测试连接”“发现频道”等插件动作提供统一协议。
6. 保留主程序对少量核心设置的控制，例如 Obsidian 路径、AI 模型等全局设置。

## 非目标

本设计不追求以下事情：

1. 不让插件自带任意 HTML/JS 注入主页面。
2. 不把整个前端改成新的框架。
3. 不在第一阶段重做插件执行依赖关系。
4. 不要求所有插件立刻支持高级 UI 组件。

原因很简单：当前项目是原生 HTML/JS，直接让插件注入前端代码会显著增加复杂度和安全风险。更合适的方式是让插件提供结构化元数据，由主页面统一渲染。

## 当前问题总结

### 1. 设置 schema 不在插件内

当前每个插件只暴露类似下面的能力：

- `execute(context)`
- `loadConfig()`
- `saveConfig(config)`

但插件没有描述自己的设置结构，例如：

- 插件 ID
- 展示名称
- 描述文案
- 是否默认启用
- 有哪些设置项
- 每个设置项的数据类型
- 默认值
- 是否敏感
- 是否支持测试动作

### 2. 插件 ID 不统一

例如 Telegram 相关逻辑目前同时存在多种标识：

- 目录名：`Telegram-Send`
- 自动发现 key：`telegram-send`
- 主配置开关 key：`telegram`

这会在多个地方引入特殊映射逻辑，长期会变得越来越难维护。

### 3. 插件列表来源不统一

当前实际插件来自 `Plugin/*` 目录，但插件管理页和默认启用状态又由主程序手写一份，二者可能不一致。

### 4. 插件动作没有统一抽象

例如：

- Telegram 有“测试连通性并获取频道列表”
- Mastodon 有“测试连通性”
- Mem0 有“测试连通性”

这些动作都存在，但接口风格不统一，无法作为插件能力动态暴露给设置页。

## 设计原则

### 1. 主程序负责框架，插件负责声明

主程序负责：

- 发现插件
- 读取插件元信息
- 提供统一 API
- 根据 schema 渲染表单

插件负责：

- 描述自己的设置项
- 读写自己的配置
- 执行自己的测试/发现动作

### 2. 结构化优先于模板注入

插件不直接提供 HTML，而是提供结构化 manifest，例如字段列表、动作列表、分组信息。主程序根据这些结构通用渲染。

### 3. 最小协议先行

第一版只支持常见字段类型：

- `text`
- `password`
- `textarea`
- `boolean`
- `select`
- `number`

先满足 80% 的插件设置需求，再考虑扩展。

### 4. 向后兼容渐进迁移

现有插件的 `loadConfig/saveConfig/execute` 不必立刻重写，只需要补上 manifest 和少量包装逻辑即可分阶段迁移。

## 总体方案

核心思路是引入一套正式的插件元信息协议：

1. 每个插件导出 `manifest`
2. `PluginManager` 在启动时读取所有插件的 `manifest`
3. 后端暴露通用插件注册表 API
4. 设置页和插件页完全根据注册表动态渲染
5. 配置保存走统一接口，再由插件自己的 `saveConfig` 落盘

## 插件模块建议协议

每个插件的 `index.js` 未来建议统一导出以下内容：

```js
export const manifest = {
  id: 'telegram',
  version: '1.0.0',
  name: 'Telegram',
  description: '发送内容到 Telegram 频道',
  category: 'diary-sync',
  enabledByDefault: false,
  settings: {
    storage: 'plugin',
    sections: [
      {
        id: 'basic',
        title: '基础配置',
        fields: [
          {
            key: 'botToken',
            type: 'password',
            label: 'Bot Token',
            required: true,
            sensitive: true,
            placeholder: '输入你的 Telegram Bot Token'
          },
          {
            key: 'defaultChannel',
            type: 'text',
            label: '默认频道',
            placeholder: '@LinYunChannel'
          },
          {
            key: 'showLinkPreview',
            type: 'boolean',
            label: '网址显示预览',
            default: true
          }
        ]
      }
    ],
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

export default {
  manifest,
  loadConfig,
  saveConfig,
  execute,
  runAction
};
```

## manifest 字段设计

### 顶层字段

建议字段如下：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 插件唯一标识，必须稳定，例如 `telegram` |
| `version` | `string` | 插件版本 |
| `name` | `string` | 展示名称 |
| `description` | `string` | 简短说明 |
| `category` | `string` | 插件分类，例如 `diary-sync` |
| `enabledByDefault` | `boolean` | 默认启用状态 |
| `settings` | `object` | 设置 schema |
| `capabilities` | `object` | 插件能力声明 |

### settings 字段

建议包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `storage` | `string` | 配置存储位置，建议先支持 `plugin` 和 `core` |
| `sections` | `array` | 表单分组 |
| `actions` | `array` | 插件动作 |

### section 字段

建议包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 分组标识 |
| `title` | `string` | 分组标题 |
| `description` | `string` | 可选的提示文案 |
| `fields` | `array` | 分组字段 |

### field 字段

建议基础字段如下：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `key` | `string` | 配置键名 |
| `type` | `string` | `text/password/textarea/boolean/select/number` |
| `label` | `string` | 字段标题 |
| `description` | `string` | 辅助说明 |
| `required` | `boolean` | 是否必填 |
| `default` | `any` | 默认值 |
| `placeholder` | `string` | 输入提示 |
| `sensitive` | `boolean` | 是否敏感字段 |
| `options` | `array` | `select` 类型选项 |
| `validate` | `object` | 可选校验规则 |

### action 字段

建议字段如下：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 动作标识 |
| `label` | `string` | 按钮文案 |
| `kind` | `string` | 如 `test`、`fetch`、`custom` |
| `description` | `string` | 动作说明 |
| `confirm` | `boolean` | 是否需要确认 |

## PluginManager 建议改造

当前 `PluginManager` 主要负责发现和执行插件。建议扩展为同时维护“插件注册表”。

### 建议职责

新增职责：

1. 读取每个插件的 `manifest`
2. 建立以 `manifest.id` 为唯一键的注册表
3. 提供统一方法获取插件列表
4. 提供统一方法加载某插件配置
5. 提供统一方法保存某插件配置
6. 提供统一方法执行某插件动作

### 建议接口

```js
loadPlugins()
getPluginRegistry()
getPlugin(pluginId)
getPluginConfig(pluginId)
savePluginConfig(pluginId, config)
runPluginAction(pluginId, actionId, payload)
executePlugins(...)
```

### ID 规范

关键要求：

1. `manifest.id` 才是唯一可信 ID
2. 目录名只作为发现入口，不参与业务逻辑
3. `data/config.json.plugins` 的 key 必须与 `manifest.id` 完全一致

例如：

- `Plugin/Telegram-Send/` 的目录名可以保留
- 但插件 ID 应统一为 `telegram`
- 从此以后主程序只认 `telegram`

## 配置存储设计

### 核心配置

继续保留 `data/config.json`，只存放主程序配置与插件启用状态，例如：

```json
{
  "obsidianPath": "/path/to/obsidian",
  "plugins": {
    "flomo": true,
    "memu": true,
    "telegram": false,
    "mem0": false,
    "mastodon": false
  },
  "ai": {
    "baseUrl": "",
    "apiKey": "",
    "model": ""
  }
}
```

### 插件私有配置

继续保留每个插件目录下自己的 `config.json`，例如：

- `Plugin/Flomo/config.json`
- `Plugin/Telegram-Send/config.json`
- `Plugin/Mastodon/config.json`

敏感信息仍只存在于插件私有配置中。

### 读取策略

后端启动后：

1. 先加载主配置
2. 再加载插件注册表
3. 请求插件设置时，通过注册表遍历插件并调用各自 `loadConfig()`

## 后端 API 设计

建议新增或替换为以下通用接口。

### 1. 获取插件注册表

`GET /api/plugins/registry`

返回示例：

```json
{
  "ok": true,
  "plugins": [
    {
      "id": "flomo",
      "name": "flomo",
      "description": "同步到 flomo",
      "enabled": true,
      "manifest": {
        "settings": {
          "sections": [...]
        }
      },
      "config": {
        "apiUrl": "https://..."
      }
    }
  ]
}
```

注意：

1. 对敏感字段可做脱敏返回，例如密码类字段只返回空值或掩码。
2. 是否脱敏可由字段的 `sensitive` 属性决定。

### 2. 设置插件启用状态

`POST /api/plugins/:id/toggle`

请求：

```json
{
  "enabled": true
}
```

### 3. 获取单个插件配置

`GET /api/plugins/:id/config`

### 4. 保存单个插件配置

`POST /api/plugins/:id/config`

请求：

```json
{
  "config": {
    "botToken": "xxx",
    "defaultChannel": "@abc"
  }
}
```

### 5. 执行插件动作

`POST /api/plugins/:id/actions/:actionId`

请求：

```json
{
  "payload": {}
}
```

返回：

```json
{
  "ok": true,
  "result": {
    "success": true,
    "message": "连接成功",
    "channels": []
  }
}
```

## 前端设置页设计

### 目标

让 `public/settings.html` 不再关心具体插件名和具体字段名，只负责：

1. 加载核心设置
2. 拉取插件注册表
3. 动态渲染插件设置区
4. 根据字段类型绑定自动保存
5. 根据动作列表渲染按钮

### 页面结构建议

保留两部分：

1. 核心设置区
2. 插件设置区

建议结构如下：

```html
<div id="core-settings"></div>
<div id="plugin-settings-container"></div>
```

### 动态渲染逻辑

前端流程建议如下：

1. 打开设置页
2. 请求 `/api/plugins/registry`
3. 遍历插件列表
4. 只渲染已启用插件，或提供“显示已禁用插件”能力
5. 根据 `manifest.settings.sections` 生成通用表单
6. 根据字段类型渲染输入组件
7. 根据 `config[key]` 填充当前值
8. 根据 `actions` 渲染按钮

### 通用字段渲染规则

建议第一版支持：

- `text` -> `<input type="text">`
- `password` -> `<input type="password">`
- `textarea` -> `<textarea>`
- `boolean` -> `<input type="checkbox">`
- `select` -> `<select>`
- `number` -> `<input type="number">`

### 自动保存

前端不再维护这种硬编码映射：

```js
{ id: 'flomoApi', path: 'diary.flomoApi' }
```

而是改成：

1. 每个字段渲染时带上 `pluginId` 和 `field.key`
2. 值变化时把整个插件配置对象发给 `/api/plugins/:id/config`

这样前端完全不需要知道某字段属于哪个插件内部结构。

## 插件管理页设计

`public/plugins.html` 也建议动态化。

### 当前问题

当前页面把 flomo、memU、Telegram、Mem0、Mastodon 写死了。

### 建议方案

插件管理页通过 `/api/plugins/registry` 获取：

- `id`
- `name`
- `description`
- `enabled`

然后动态渲染列表和开关。

这样新增插件时，不需要再修改插件管理页。

## 插件动作设计

为了覆盖“测试连接”“发现频道”等需求，建议增加 `runAction(actionId, payload)`。

### 插件侧示例

```js
export async function runAction(actionId, payload = {}) {
  if (actionId === 'testConnection') {
    return await testConnection();
  }

  if (actionId === 'discoverChannels') {
    return await discoverChannels();
  }

  throw new Error(`Unknown action: ${actionId}`);
}
```

### 后端侧处理

后端统一转发：

1. 校验插件是否存在
2. 校验插件是否暴露 `runAction`
3. 调用插件动作
4. 将结果统一返回

### 前端侧处理

前端根据 `actions` 数组自动渲染按钮，并将结果展示在插件区块内的消息框中。

## 安全考虑

### 1. 不允许插件注入任意前端代码

插件只提供结构化 manifest，不直接提供 HTML/JS 片段。这样主程序仍然掌控页面结构和行为。

### 2. 配置写入边界清晰

核心配置只能写 `data/config.json`。  
插件配置只能通过插件自己的 `saveConfig()` 写入插件目录配置。

### 3. 敏感字段脱敏

对于 `password` 或 `sensitive: true` 的字段：

1. API 返回时可置空
2. 前端如果用户未修改，不重复覆盖

这样可以避免把明文密钥反复回传到浏览器。

### 4. 动作接口要限制范围

`runAction` 只允许执行插件内部已声明动作，不能让前端传任意函数名或任意脚本路径。

## 迁移方案

建议分三步迁移，避免一次性推翻。

### 阶段一：注册表化

目标：

1. 每个插件补充 `manifest.id/name/description/enabledByDefault`
2. `PluginManager` 建立统一注册表
3. `/api/plugins` 改为真正从注册表生成
4. `public/plugins.html` 动态渲染

收益：

- 先解决插件列表与启用状态来源不统一的问题
- 改动小，风险低

### 阶段二：设置 schema 化

目标：

1. 每个插件补充 `settings.sections/fields`
2. 新增 `/api/plugins/registry`
3. 新增 `/api/plugins/:id/config`
4. `public/settings.html` 改成动态渲染插件设置

收益：

- 设置项不再写死在主程序
- 新增插件无需再改设置页

### 阶段三：动作协议化

目标：

1. 每个插件按需补充 `runAction`
2. 统一替换 Telegram/Mastodon/Mem0 的测试接口
3. 设置页动态渲染动作按钮和结果区域

收益：

- 测试与发现逻辑也进入插件边界
- 主程序对插件行为更少感知

## 与当前插件的适配建议

### Flomo

适合最先迁移。

原因：

- 配置简单
- 只有一个主要字段 `apiUrl`
- 无复杂动作

### MemU

也适合较早迁移。

建议字段：

- `memuBridgeScript`
- `memuUserId`

### Telegram

需要动作协议支持。

建议字段：

- `botToken`
- `defaultChannel`
- `optimizePrompt`
- `showLinkPreview`
- `boldFirstLine`

建议动作：

- `testConnection`
- `discoverChannels`

### Mastodon

适合迁移到 schema + action 模式。

建议字段：

- `instanceUrl`
- `accessToken`
- `visibility`

建议动作：

- `testConnection`

### Mem0

会稍复杂，因为它现在除了插件配置，还有一部分 UI 开关写在主配置里，例如洞察卡片开关。

这里建议拆清楚：

1. Mem0 真正运行所需的 API 配置，属于插件私有配置
2. 页面展示开关如果只影响主页面 UI，可以继续留在主配置

也可以进一步抽象为：

- 插件运行配置
- 插件 UI 偏好配置

但第一阶段不必一步做到。

## 建议的数据边界

建议明确区分三类配置：

### 1. 核心配置

属于主程序，不属于任何插件。

例如：

- Obsidian 路径
- 全局 AI 模型配置
- 分类规则

### 2. 插件运行配置

属于插件自身。

例如：

- flomo webhook
- Telegram bot token
- Mastodon access token
- memU bridge script

### 3. 插件 UI 偏好配置

是否属于插件，需要按实际影响范围判断。

例如：

- Mem0 洞察卡片显示开关

如果这个配置只控制主页面布局，而不影响插件执行，理论上可保留在主配置中，不强求并入插件私有配置。

## 建议优先级

如果只看性价比，建议优先做：

1. 统一插件 ID
2. 给每个插件补 `manifest`
3. 动态化插件管理页
4. 动态化设置页字段渲染

动作协议可以稍后补。

## 风险与注意事项

### 1. schema 不要过度设计

第一版不要引入太多字段类型或过于复杂的联动逻辑，否则实现成本会迅速膨胀。

### 2. 敏感字段的回显策略要提前定

如果后端返回空值，前端要避免“页面一保存就把原值清空”。这需要单独处理“未修改字段不覆盖”。

### 3. 现有特殊 API 需要过渡期

例如：

- `/api/telegram/test`
- `/api/mastodon/test`
- `/api/mem0/test`

迁移时建议先保留兼容接口，等前端切换完成后再删。

### 4. 执行依赖关系还未完全抽象

例如 `memu -> telegram` 的 suggestion 依赖还在主程序调度逻辑里。这个问题与设置独立化不同，但未来可以继续抽象为“插件依赖/优先级声明”。

## 最终建议

建议采用：

**插件 manifest/schema + 主程序通用渲染 + 插件动作接口**

不建议采用：

**插件自带整段 HTML/JS 注入设置页**

原因是前者更适合当前项目形态，复杂度低、边界清晰、安全性更可控，也足以实现“设置项不再写死在 `public/settings.html` 和 `src/web/server.js`”的目标。

## 一句话结论

可以实现插件设置独立化，且推荐通过“插件自描述 schema”来实现，而不是让主程序继续为每个插件手写表单和接口分支。
