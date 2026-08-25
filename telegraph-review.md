# Telegraph 分支自检报告

> 审查日期：2026-08-25
> 分支：`telegraph`（未提交的工作区改动）
> 构建状态：通过（`npm run build` → 168.3kb，无错误）

---

## 🔴 需要修复的问题

### 1. `package.json` 版本号不一致

- `manifest.json` = `1.0.3`，`versions.json` 新增了 `"1.0.3"`，但 `package.json` 仍为 `1.0.2`。
- AGENTS.md 要求三者对齐。

### 2. `uploadImage` 使用 FormData 但未设 Content-Type — 潜在 BUG

`src/core/telegraph.js:87-97` 用 `new FormData()` + `Blob` 上传图片，但没有设置 `Content-Type: multipart/form-data; boundary=...`。同仓库的 Telegram adapter（`src/adapters/telegram.js`）手动构造 multipart body 并显式设置 boundary header，说明团队之前可能遇到过 Obsidian `requestUrl` 不自动处理 FormData 的问题。如果 `requestUrl` 不自动为 FormData 设置 boundary，`telegra.ph/upload` 会返回错误，**所有含本地图片的 Telegraph 发送都会失败**。需要在 Obsidian 中实测验证。

### 3. Telegraph API 调用缺少 `throw: false`

`src/core/telegraph.js` 的 `telegraphApi`、`uploadImage`，以及 `src/main.js:714` 的 `sendMessage` 调用，均未传 `throw: false`。Obsidian `requestUrl` 在非 2xx 状态码时默认抛异常，错误信息是 HTTP 状态文本而非 API 返回的具体错误描述。对比 `src/adapters/telegram.js` 中所有 `requestUrlFn` 调用都显式传了 `throw: false`，然后从 `response.json` 中提取 `data.description`。当前 Telegraph 路径的错误提示会不够具体（用户看到 "Request failed, status 400" 而非 "CHAT_ID_INVALID" 之类）。

---

## 🟡 UX / 设计问题

### 4. Telegraph 页面 URL 未在发送结果中展示

`executeTelegraphSend` 返回 `{ success, url, results }`，但 `send-modal.js:1047-1060` 的 summary 代码只展示 `channelResults` 的成功/失败，**不显示 `result.url`**。用户看到 "Telegram channelId: 成功" 但不知道 Telegraph 链接是什么。在部分失败场景（页面已创建但 Telegram 发送失败）更严重——`url` 在返回值里但 Notice 里看不到，用户无法手动补救。

### 5. 标题编辑 `saveEdit` 可能被调用两次

`_editTelegraphTitle` 中，Enter 键触发 `saveEdit()` → `_expandTelegraphBtn` 重建按钮（input 从 DOM 移除）→ 可能触发 input 的 `blur` 事件 → 再次调用 `saveEdit()`。不会出错（幂等），但有视觉闪烁。建议加一个 `saved` flag 或在 `saveEdit` 中先移除 blur listener。

### 6. 标题编辑输入框宽度对 CJK 偏窄

`input.style.width = Math.max(120, currentText.length * 14 + 20)px` — 14px/字符对中文偏窄（CJK 通常 16-20px）。

### 7. 设置中 "创建/刷新账号" 按钮总是创建新账号 ✅ 已修复

**原问题**：点击后无条件调用 `createAccount`，旧 token 被覆盖，旧 Telegraph 页面将无法再通过新 token 编辑。

**修复方案**：将原来的单按钮拆分为完整的 token 管理界面：
- **Token 输入框**（password 类型）：用户可手动输入已有 token，预填当前值。
- **"验证并保存" 按钮**：调用 `getAccountInfo` API 验证 token 有效性后才保存，无效则提示具体错误，不覆盖旧 token。
- **"创建新账号" 按钮**：保留原创建逻辑，但已有 token 时弹出 `confirm` 确认对话框，避免误操作覆盖。
- **"复制 token" 按钮**：一键复制当前 token 到剪贴板，无 token 时禁用。
- 描述文字不再暴露 token 前 8 位（顺带修复第 9 点）。

涉及文件：`src/ui/settings-tab.js`（Setting 项重写）、`src/core/telegraph.js`（新增 `getAccountInfo` 函数并导出）。

### 8. `telegraphTitleLevel` 可能超出 `maxTitleLevel`

用户先设 `telegraphTitleLevel=3`，再将 `sendScope` 改为 1，下拉框只显示 H1 但存储值仍为 3。`executeTelegraphSend` 中 `titleLevelNum = Math.max(1, Math.min(6, Number(titleLevel) || 1))` 不约束到 `sendScope`，导致标题提取层级与发送范围不匹配。

### 9. 设置页展示 token 前 8 位

`settings-tab.js:238` 显示 `token: ${access_token.slice(0,8)}...`。AGENTS.md 要求 "Do not print settings objects that could reveal credentials"。8 字符虽非完整 token，但属于不必要的暴露。

---

## 🟢 已知限制（非 bug，可后续优化）

| 限制 | 说明 |
|---|---|
| 嵌套行内格式 | `*italic **bold** italic*` 解析为 3 个 `<em>` 而非嵌套 |
| `_italic_` 误匹配 | `hello_world` 被解析为 `hello<em>world</em>` |
| Wiki-link `[[note]]` | 不处理，原样输出 `[[note]]` |
| Obsidian callout `> [!note]` | 作为 blockquote，`[!note]` 原样保留 |
| Obsidian 高亮 `==text==` | 不处理，原样输出 |
| Obsidian 注释 `%%text%%` | 不处理，原样输出 |
| 任务列表 `- [ ]` | checkbox 语法原样保留在 `<li>` 中 |
| 表格 | 转为纯文本段落，分隔行 `\|---\|` 保留为文本 |
| 嵌套列表 | 缩进被 `trim()` 抹平，所有项同级 |
| Frontmatter | 整页发送时 `---` 被渲染为 `<hr>`，YAML 内容作为段落 |
| 图片尺寸别名 `![[img.png\|400]]` | `\|400` 在 `parseImageRefs` 中被丢弃 |
| 内部链接 `[text](note)` | href 为 `note`，非有效 URL |

---

## ✅ 确认正确的部分

- 构建通过（`npm run build` → 168.3kb，无错误）
- `@图片N` token 在 send-modal → executeTelegraphSend → markdownToNodes 之间格式一致
- 标题提取逻辑（`markdownToNodes` 与 `_getDefaultTelegraphTitle`）行为一致
- 代码块、引用块、列表、hr 的检测优先级正确（互不干扰）
- Telegraph Node 使用的 tag 均在 Telegraph 支持范围内
- `ensureTelegraphToken` 自动创建 token 的流程正确
- Telegraph 模式不影响其他平台（flomo/Mastodon/Misskey/Notion）的发送
- 富文本按钮不存在时 Telegraph 按钮的降级处理正确
- 事件顺序（click → dblclick）处理正确
- `.target-sub-label` margin 迁移到 `.tg-channel-label-row` 正确
- `requestUrl.bind(this.plugin)` 安全（wrapper 不使用 `this`）

---

## 优先级建议

1. **P0** — #1 版本对齐 + #3 `throw: false`
2. **P0** — #2 FormData 上传在 Obsidian 中实测验证
3. **P1** — #4 Telegraph URL 展示在发送结果 Notice 中
4. **P2** — #5–#9 UX 改善项
