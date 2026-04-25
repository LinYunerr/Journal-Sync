# Plugin Specification

本文件描述 Journal Sync 当前使用的插件协议。

## Goals

- 插件功能与主程序解耦
- 插件配置由插件自己声明
- 敏感信息与主配置分离
- 前后端共享同一套配置 schema

## Directory Layout

```text
Plugin/
└── ExamplePlugin/
    ├── index.js
    ├── config.example.json
    ├── config.json
    └── README.md
```

## Discovery & Registration

- 主程序会自动扫描 `Plugin/*/index.js` 并加载插件。
- 被成功加载的插件会自动出现在 `/api/plugins/registry` 返回结果中。
- 插件中心基于注册表动态渲染，无需在前端硬编码插件列表。
- 插件若声明 `manifest.settings.sections/actions`，插件中心会自动渲染设置字段与动作按钮。
- 插件若声明 `manifest.ui.homeV2`，重构主页会自动识别分区；插件关闭时不应在主页显示。

## Required Exports

```js
export const manifest = {
  id: 'example',
  version: '1.0.0',
  name: 'Example Plugin',
  description: 'Example description',
  category: 'general',
  enabledByDefault: false,
  ui: {
    homeV2: {
      section: 'publish_simple',
      order: 10,
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
```

## Manifest Fields

顶层字段：

- `id`: 稳定且唯一的插件 ID
- `version`: 插件版本
- `name`: 展示名称
- `description`: 简短说明
- `category`: 插件分类
- `enabledByDefault`: 默认是否启用
- `ui.homeV2`: 重构主页分区声明（可选）
- `settings`: 配置 schema
- `capabilities`: 能力声明

`ui.homeV2` 字段说明：

- `section`: 所属分区，当前支持 `edit | publish_simple | publish_advanced | save_local`
- `order`: 同分区排序（数字，越小越靠前）
- `label`: 分区展示名（可选，默认使用 `name`）

`settings.sections[].fields[]` 当前支持：

- `text`
- `password`
- `textarea`
- `boolean`
- `select`
- `number`

字段可选属性：

- `required`
- `sensitive`
- `default`
- `placeholder`
- `options`
- `optionsSource`
- `allowCustomValue`
- `validate`

## Config Storage

- 主配置位于 `data/config.json`
- 插件私有配置位于 `Plugin/<PluginName>/config.json`
- 敏感字段只能出现在插件私有配置中

读取插件配置时，敏感字段应被脱敏返回；保存时若敏感字段传入空字符串，应保留旧值。

## Action API

插件动作通过统一接口暴露：

- `POST /api/plugins/:id/actions/:actionId`

动作结果应被标准化为：

```json
{
  "success": true,
  "message": "连接成功",
  "warnings": [],
  "data": {}
}
```

## Security

- 不要在示例配置中放入真实凭据
- `config.json` 必须加入 `.gitignore`
- 插件应自行校验配置合法性
- 插件写入文件时应避免路径穿越
