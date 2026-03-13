# Journal Sync 2.0

一个现代化的日记笔记同步工具，支持 Web 界面和多平台同步。

## ✨ 特性

- 🌐 **Web 界面** - 美观易用的浏览器界面
- 📔 **日记/笔记分类** - 支持两种类型的内容记录
- ⏱️ **时间线视图** - 实时展示保存历史
- 🤖 **AI 智能建议** - 基于历史记忆生成个性化建议
- 🔄 **多平台同步** - 自动同步到 Obsidian、flomo、Nowledge Mem、memU
- 📱 **Telegram 集成** - 可选发送 AI 建议到 Telegram
- 📊 **统计面板** - 实时显示记录统计
- ⚙️ **设置页面** - 可视化配置 Obsidian 路径和查看同步状态

## 🚀 快速开始

### 1. 安装依赖

```bash
cd /path/to/Journal-Sync
npm install
```

### 2. 启动服务器

```bash
npm start
```

### 3. 打开浏览器

访问 http://localhost:3000

### 4. 开始使用

1. 选择"日记"或"笔记"标签
2. 输入内容
3. 可选：勾选"发送到 Telegram"
4. 点击"保存到 Obsidian"
5. 完成！

### 5. 配置设置（可选）

点击右上角的"⚙️ 设置"按钮：
- 修改 Obsidian 存储路径
- 查看各平台同步状态
- 查看系统信息

## 📁 项目结构

```
/path/to/Journal-Sync/
├── package.json              # 项目配置
├── README.md                 # 本文件
├── src/
│   ├── web/
│   │   └── server.js        # Express 服务器
│   ├── sync/
│   │   └── journal-sync.js  # 同步逻辑
│   └── utils/               # 工具函数
├── public/
│   ├── index.html           # Web 界面
│   ├── app.js               # 前端逻辑
│   └── settings.html        # 设置页面
├── data/
│   ├── history.json         # 历史记录
│   └── config.json          # 配置文件
└── logs/                    # 修改日志
```

## 🔄 同步平台

### 1. Obsidian ✅ 必选
- 路径：`/path/to/obsidian/notes`
- 文件名：`YYYY-MM-DD 日记.md` 或 `YYYY-MM-DD 笔记.md`
- 同一天的内容会追加到同一文件

### 2. flomo ✅ 必选
- API：自动同步所有内容
- 支持标签和格式

### 3. Nowledge Mem ✅ 必选
- 通过 `nmem t create` 命令同步到时间线
- 标记来源为 `journal-sync`

### 4. memU ✅ 必选
- 使用 AI 提取关键记忆
- 生成基于历史记忆的智能建议
- 支持标签分类

### 5. Telegram 🔵 可选
- 发送 AI 生成的智能建议（不是原文）
- 支持日记频道和私密频道

## 🤖 AI 智能建议

当你保存日记时，系统会：

1. 从历史记忆中检索相关内容
2. 使用 AI 分析当前日记和历史记忆
3. 生成个性化的提醒和建议
4. 将建议发送到 Telegram（如果选择）

建议格式示例：
```
**相关提醒**
1. 根据之前你和XX的经历来看...
2. 上次你提到...

**下一步建议**
1. 建议你可以...
2. 考虑到你一直...
```

## 📊 Web 界面功能

### 标签切换
- 📔 日记：记录每日生活
- 📄 笔记：保存重要信息

### 时间线视图
- 实时显示保存历史
- 显示每条记录的同步状态
- 支持查看最近 20 条记录

### 统计面板
- 总记录数
- 日记/笔记分类统计
- 今日记录数

## 🔧 API 接口

### 保存内容
```
POST /api/save
Body: {
  "content": "内容",
  "type": "diary" | "note",
  "options": {
    "sendToTelegram": true
  }
}
```

### 获取历史
```
GET /api/history?limit=20
```

### 获取统计
```
GET /api/stats
```

### 清空历史
```
DELETE /api/history
```

## 🆚 与原版 journal-sync 的区别

| 特性 | 原版 (Bash) | 新版 (Web) |
|------|------------|-----------|
| 界面 | 命令行 | 浏览器 ✅ |
| 日记/笔记分类 | 无 | 支持 ✅ |
| 历史记录 | 无 | 时间线视图 ✅ |
| 统计信息 | 无 | 实时统计 ✅ |
| Telegram 总结 | 发送原文 | 发送 AI 建议 ✅ |
| 多行输入 | 需要特殊处理 | 完美支持 ✅ |

## 🐛 故障排查

### 端口被占用
```bash
PORT=3001 npm start
```

### Obsidian 同步失败
- 检查路径是否存在
- 确认有写入权限

### memU 建议生成失败
- 检查 `/path/to/memu_bridge.py` 是否存在
- 确认 Python 3 已安装
- 查看 memU 配置文件

### Telegram 发送失败
- 检查 TG 发送脚本是否存在
- 确认 Telegram bot 配置正确

## 📝 开发说明

### 技术栈
- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript
- **同步**: Python (memU bridge)

### 核心文件
- `src/web/server.js` - Express 服务器和 API
- `src/sync/journal-sync.js` - 同步逻辑
- `public/index.html` - Web 界面
- `public/app.js` - 前端交互

## 📦 依赖项

- Node.js >= 18
- Python 3
- nmem (Nowledge Mem CLI)
- memU (记忆桥接脚本)

## 🎉 开始使用

```bash
cd /path/to/Journal-Sync
npm install
npm start
```

然后在浏览器中打开 http://localhost:3000

享受全新的日记笔记体验！

---

版本：2.0.0
最后更新：2026-03-10
