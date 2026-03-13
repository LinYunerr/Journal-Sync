# TG 发布格式提示词自定义功能 - 2026-03-10

## 功能说明

在设置页面的"日记"标签 → "Telegram 配置"区域，新增了"生成 TG 发布格式的提示词"设置项。

## 使用方法

### 1. 访问设置页面

访问 http://localhost:3000/settings.html，切换到"日记"标签。

### 2. 找到提示词设置

在 Telegram 配置区域，找到"生成 TG 发布格式的提示词"文本框。

### 3. 自定义提示词

输入你想要的提示词，例如：

```
你是一个专业的内容编辑。请将笔记内容优化为适合 Telegram 发布的格式。

要求：
1. 保持原意，不要添加额外信息
2. 使用简洁明了的语言
3. 适当使用 emoji 增加可读性
4. 分段清晰，每段不超过 3 行
5. 突出重点信息
6. 适合移动端阅读

风格：轻松、友好、专业
```

### 4. 保存配置

点击"💾 保存日记配置"按钮。

### 5. 测试效果

1. 回到主页 http://localhost:3000
2. 切换到"笔记"标签
3. 输入测试内容
4. 点击"✨ 生成 TG 发布格式"
5. 查看 AI 优化后的内容

## 默认提示词

如果留空，系统会使用默认提示词：

```
你是一个专业的内容编辑，擅长将笔记内容优化为适合 Telegram 频道发布的格式。要求：1. 保持原意，简洁明了 2. 适当使用 emoji 3. 分段清晰 4. 适合社交媒体阅读
```

## 提示词编写建议

### 好的提示词特点

1. **明确角色**：告诉 AI 它是什么角色（如"内容编辑"、"社交媒体运营"）
2. **清晰要求**：列出具体的格式要求
3. **风格指导**：说明期望的语言风格
4. **约束条件**：设置字数、段落等限制

### 示例提示词

#### 简洁风格
```
将内容改写为 Telegram 帖子格式：简短、有趣、易读。使用 emoji，每段 1-2 句话。
```

#### 专业风格
```
你是一个专业的知识分享者。将笔记整理为结构化的 Telegram 帖子：
1. 开头用一句话概括核心观点
2. 分点列出关键信息（3-5 点）
3. 结尾可以加一个思考问题
4. 使用适当的 emoji 标记重点
5. 保持专业但不失亲和力
```

#### 新闻风格
```
你是一个新闻编辑。将内容改写为新闻快讯格式：
- 标题：简短有力（10 字以内）
- 导语：一句话说明核心事件
- 正文：2-3 段，每段 2-3 句
- 使用 📰 🔥 ⚡ 等 emoji
- 客观、准确、及时
```

## 技术实现

### 前端（settings.html）

1. 添加文本框：
```html
<textarea id="tgOptimizePrompt" rows="6" placeholder="..."></textarea>
```

2. 加载配置：
```javascript
document.getElementById('tgOptimizePrompt').value = data.config.tgOptimizePrompt || '';
```

3. 保存配置：
```javascript
{ path: 'diary.tgOptimizePrompt', value: document.getElementById('tgOptimizePrompt').value.trim() }
```

### 后端（server.js）

1. API 返回配置：
```javascript
tgOptimizePrompt: config?.diary?.tgOptimizePrompt || defaults.tgOptimizePrompt
```

2. 使用自定义提示词：
```javascript
const customPrompt = config?.diary?.tgOptimizePrompt;
const systemPrompt = customPrompt || '默认提示词...';
```

### 配置文件（config.json）

```json
{
  "diary": {
    "tgOptimizePrompt": "你的自定义提示词..."
  }
}
```

## 注意事项

1. **提示词长度**：建议不超过 500 字，过长可能影响 AI 响应速度
2. **测试效果**：修改提示词后，建议多测试几次，找到最适合的风格
3. **保持简洁**：提示词越简洁明确，AI 的输出越稳定
4. **避免冲突**：不要在提示词中包含与用户内容相关的具体指令

## 故障排查

### 问题：修改提示词后没有效果

**解决**：
1. 确认已点击"保存日记配置"
2. 刷新主页
3. 重新生成 TG 发布格式

### 问题：AI 输出不符合预期

**解决**：
1. 检查提示词是否清晰明确
2. 尝试更具体的要求
3. 参考示例提示词调整

### 问题：提示词保存失败

**解决**：
1. 检查服务器日志：`tail -f logs/server.log`
2. 确认配置文件权限正常
3. 尝试重启服务器

---

修改时间：2026-03-10 23:00
修改人：Claude (Sonnet 4.6)
服务器 PID：70703
