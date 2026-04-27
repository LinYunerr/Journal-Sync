# Telegram Send Plugin

将内容发送到 Telegram 频道。

## Config

在插件中心保存后，配置会写入外层 `Journal-Sync/user-data/plugins/telegram/config.json`。如需手工准备，可参考 `config.example.json`：

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
  "homeChannels": [
    "-1000000000000"
  ],
  "showLinkPreview": true,
  "boldFirstLine": false,
  "appendSourceTag": false,
  "addLineBreakPerLine": false
}
```

## Usage

1. 打开 `http://localhost:3000/?open=plugin-center`
2. 在插件中心启用 Telegram 插件并完成配置
3. 通过插件动作测试连接或拉取频道列表

如需独立调试脚本：

```bash
python3 telegram_send.py <channel> <message>
```

脚本会优先读取主程序传入的 `JOURNAL_SYNC_TELEGRAM_CONFIG_FILE` 和 `TELEGRAM_CHANNELS_FILE`；独立运行时默认读取外层 `Journal-Sync/user-data/plugins/telegram/config.json`，频道缓存默认写入 `Journal-Sync/user-data/plugins/telegram/channels.json`。

## Notes

- `Journal-Sync/user-data/plugins/telegram/config.json` 不应提交到版本控制，也不应随 `app/` 更新包覆盖
- 机器人需要具备目标频道的发言权限
- `channels` 可通过插件动作或脚本辅助发现
