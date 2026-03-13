# Journal Sync 插件管理规范

## 插件架构设计原则

### 1. 解耦原则
- 插件功能与主程序解耦
- 敏感信息（API Key、Token、频道列表等）与主配置分离
- 插件配置独立存储在插件目录下

### 2. 目录结构

```
Journal-Sync/
├── Plugin/                          # 插件根目录
│   ├── Telegram-Send/               # Telegram 发送插件
│   │   ├── config.json              # 插件私有配置（敏感信息）
│   │   ├── telegram_send.py         # 发送脚本
│   │   └── README.md                # 插件说明文档
│   ├── [其他插件]/
│   │   ├── config.json
│   │   └── ...
├── data/
│   └── config.json                  # 主配置（不含敏感信息）
├── src/
└── public/
```

### 3. 配置分离规范

#### 主配置 (`data/config.json`)
存储非敏感的功能配置：
- 插件启用状态 (`plugins.telegram: true/false`)
- 插件路径引用 (`telegram.pluginPath`)
- 功能开关和 UI 状态

#### 插件配置 (`Plugin/[插件名]/config.json`)
存储插件私有的敏感信息：
- API Token / API Key
- 频道列表、用户 ID 等
- 插件特定的提示词模板

### 4. Telegram 插件配置示例

#### 主配置 (`data/config.json`)
```json
{
  "plugins": {
    "telegram": true
  },
  "telegram": {
    "pluginPath": "/path/to/Journal-Sync/Plugin/Telegram-Send"
  }
}
```

#### 插件配置 (`Plugin/Telegram-Send/config.json`)
```json
{
  "botToken": "YOUR_BOT_TOKEN_HERE",
  "channels": [
    {
      "id": "-1003026692370",
      "title": "LinYun's Life 林云窝",
      "type": "channel",
      "username": "@LinYunChannel"
    },
    {
      "id": "-1001420767960",
      "title": "笔记本：Lin's 文字世界",
      "type": "channel",
      "username": "@LinsBookA"
    },
    {
      "id": "-1001166669531",
      "title": "小林的碎片",
      "type": "channel",
      "username": null
    }
  ],
  "defaultChannel": "-1003026692370",
  "optimizePrompt": "请根据以下要求对视频字幕内容进行优化：\n\n提取视频中最具冲击力、最有感触的几个核心亮点或细节..."
}
```

### 5. 插件加载流程

1. 主程序读取 `data/config.json`，检查插件启用状态
2. 如果插件启用，读取 `pluginPath` 获取插件目录
3. 加载插件目录下的 `config.json` 获取敏感配置
4. 合并配置后使用

### 6. 安全建议

- ✅ 插件配置文件 (`Plugin/*/config.json`) 应添加到 `.gitignore`
- ✅ 提供配置模板文件 (`config.example.json`) 供用户参考
- ✅ 敏感信息仅存储在插件目录，不提交到版本控制
- ✅ 主配置文件可以提交，但需移除所有敏感信息

### 7. 插件开发规范

每个插件应包含：
- `config.json` - 插件私有配置
- `config.example.json` - 配置模板（不含敏感信息）
- `README.md` - 插件说明文档
- 功能脚本文件（如 `telegram_send.py`）

### 8. 未来扩展

其他插件（flomo、nmem、memU）也应遵循此规范：
- 创建独立插件目录
- 分离敏感配置
- 提供配置模板和文档

---

**版本**: 1.0
**创建时间**: 2026-03-11
**最后更新**: 2026-03-11
