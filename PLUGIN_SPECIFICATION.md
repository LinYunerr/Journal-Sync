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

## Required Exports

```js
export const manifest = {
  id: 'example',
  version: '1.0.0',
  name: 'Example Plugin',
  description: 'Example description',
  category: 'general',
  enabledByDefault: false,
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
- `settings`: 配置 schema
- `capabilities`: 能力声明

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
