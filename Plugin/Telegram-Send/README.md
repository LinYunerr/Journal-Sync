# Telegram Send Plugin

将内容发送到 Telegram 频道。

## Config

复制 `config.example.json` 为 `config.json`，再填写真实值：

```json
{
  "botToken": "YOUR_BOT_TOKEN",
  "channels": [
    {
      "id": "-1000000000000",
      "title": "Example Channel",
      "type": "channel",
      "username": "@example"
    }
  ],
  "defaultChannel": "-1000000000000",
  "optimizePrompt": "Optional custom prompt"
}
```

## Usage

1. 打开 `http://localhost:3000/plugins.html` 启用插件
2. 打开 `http://localhost:3000/settings.html` 完成配置
3. 通过插件动作测试连接或拉取频道列表

如需独立调试脚本：

```bash
python3 telegram_send.py <channel> <message>
```

## Notes

- `config.json` 不应提交到版本控制
- 机器人需要具备目标频道的发言权限
- `channels` 可通过插件动作或脚本辅助发现
