# Plugin Settings Progress

更新时间：2026-03-22

## 已完成

1. 插件协议落地到现有插件：
   - `flomo`
   - `memu`
   - `telegram`
   - `mastodon`
   - `mem0`
2. `PluginManager` 支持：
   - 注册表
   - 统一插件 ID
   - 配置读取
   - 敏感字段脱敏
   - 按 schema 合并保存
   - 动作转发
3. 后端新增通用 API：
   - `GET /api/plugins/registry`
   - `GET /api/plugins/:id/config`
   - `POST /api/plugins/:id/config`
   - `POST /api/plugins/:id/toggle`
   - `POST /api/plugins/:id/actions/:actionId`
4. 插件管理页已改为动态渲染。
5. 设置页已改为根据注册表动态渲染已启用插件。
6. 旧接口保留兼容。
7. README 已更新。
8. Telegram `defaultChannel` 已改为基于 `channels` 的动态下拉选择。
9. `manifest` 字段级校验已在前后端接入。
10. 插件动作结果已统一为 `success / message / warnings / data` 结构。
11. 增加了不依赖真实外部服务的 `PluginManager` 静态单测。

## 当前设计边界

1. 插件只提供结构化 manifest，不允许注入自定义 HTML/JS。
2. 敏感字段在设置页默认不回显；若提交空字符串，后端保留旧值。
3. `mem0Insights` 仍留在核心配置，因为它控制的是主页面 UI 偏好。

## 已知限制

1. 动态设置页目前只支持基础字段类型：
   - `text`
   - `password`
   - `textarea`
   - `boolean`
   - `select`
   - `number`
2. 插件动作结果仍以统一文本块 + JSON 预览展示，没有更复杂的结果组件。
3. 前端校验目前以基础规则为主，不支持复杂联动和跨字段校验。

## 本次验证记录

已完成验证：

1. `node --check` 通过：
   - `src/sync/plugin-manager.js`
   - `src/web/server.js`
   - `Plugin/Flomo/index.js`
   - `Plugin/MemU/index.js`
   - `Plugin/Telegram-Send/index.js`
   - `Plugin/Mastodon/index.js`
   - `Plugin/Mem0/index.js`
2. 本地服务已成功启动并加载全部插件。
3. `GET /api/plugins/registry` 返回正常，且敏感字段已脱敏。
4. `GET /api/plugins/telegram/config` 返回正常，`botToken` 已脱敏。
5. `GET /api/config/diary` 兼容接口仍可用，且已改为不返回敏感字段明文。
6. 通过代码检查确认：
   - Telegram `defaultChannel` 已切到动态 `select`
   - 前端对敏感字段空值做了保留兼容，不会因默认不回显而误判
   - 后端配置保存和动作执行都会返回结构化校验错误
7. 已补充 `test/plugin-manager.test.js`，用于覆盖：
   - 插件注册表 schema 解析
   - 配置校验失败分支
   - 动作结果标准化

未完成的验证：

1. 浏览器层面的交互点击验证没有自动化覆盖。
2. 插件动作的真实外部连通性测试未执行；本次按要求未做实际场景测试。
3. `npm test` 本次未执行，仅完成代码级检查与静态审阅。

## 本次会话摘要

1. 按 `PLUGIN_SETTINGS_ARCHITECTURE_DRAFT.md` 实现了 manifest 驱动的插件设置架构。
2. 把目录名驱动改为稳定的 `manifest.id` 驱动。
3. 用统一插件 API 替换了前端写死的插件页面结构。
4. 补了 README，并把续做信息和验证结果写入本文件，作为本地断点记录。

## 建议下一步

1. 如果需要更细的交互体验，可以为动作结果增加表格或列表组件，而不是只显示 JSON。
2. 可以继续扩展 `validate`，支持跨字段校验和条件必填。
3. 如果后续允许安全地跑本地服务，可再补插件 API 的无网络集成测试。
4. 浏览器层面的动态设置页交互仍适合补 Playwright 级别自动化。

## 断点续做入口

优先从这些文件继续：

- `src/sync/plugin-manager.js`
- `src/web/server.js`
- `public/settings.html`
- `public/plugins.html`
- `PLUGIN_SETTINGS_ARCHITECTURE_DRAFT.md`
