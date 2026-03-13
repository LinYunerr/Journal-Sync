# Telegram Send 插件

## 功能说明

将日记或笔记内容发送到 Telegram 频道，支持 AI 优化内容格式。

## 配置说明

### 1. 配置文件

复制 `config.example.json` 为 `config.json`，并填入你的配置：

```json
{
  "botToken": "你的 Bot Token",
  "channels": [
    {
      "id": "频道 ID",
      "title": "频道名称",
      "type": "channel",
      "username": "@频道用户名"
    }
  ],
  "defaultChannel": "默认频道 ID",
  "optimizePrompt": "AI 优化提示词"
}
```

### 2. 获取 Bot Token

1. 在 Telegram 中搜索 `@BotFather`
2. 发送 `/newbot` 创建新机器人
3. 按提示设置机器人名称和用户名
4. 获取 Bot Token 并填入配置

### 3. 获取频道 ID

1. 将机器人添加为频道管理员
2. 使用 `telegram_send.py` 脚本的 `--list-channels` 参数获取频道列表
3. 复制频道 ID 到配置文件

### 4. 自定义优化提示词

`optimizePrompt` 字段用于 AI 优化内容格式，可根据需求自定义。

## 使用方法

### 在主程序中启用

1. 访问 http://localhost:3000/settings.html
2. 在"插件管理"中启用 Telegram 插件
3. 在日记或笔记页面使用 Telegram 发送功能

### 独立使用脚本

```bash
python3 telegram_send.py <频道ID或用户名> <消息内容>
```

## 安全提示

- ⚠️ **不要将 `config.json` 提交到版本控制**
- ⚠️ Bot Token 是敏感信息，请妥善保管
- ⚠️ 定期更换 Bot Token 以提高安全性

## 故障排查

### 发送失败

1. 检查 Bot Token 是否正确
2. 确认机器人已添加为频道管理员
3. 检查频道 ID 是否正确
4. 查看服务器日志获取详细错误信息

### 频道列表为空

1. 确认机器人已添加到频道
2. 确认机器人有发送消息权限
3. 尝试重新添加机器人

---

**版本**: 1.0
**最后更新**: 2026-03-11
