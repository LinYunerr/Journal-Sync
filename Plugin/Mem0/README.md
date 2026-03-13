# Mem0 插件

AI 记忆系统插件，用于自动提取任务、标签和记忆。

## 功能

- 🧠 自动提取日记中的任务（Task）
- 🏷️ 智能标签分类（媒体、事件、人物等）
- 📝 记忆存储和检索
- ✅ 任务状态管理

## 配置

### 1. LLM 配置

支持 OpenAI 兼容的 API：

```json
{
  "llm": {
    "provider": "openai",
    "config": {
      "model": "gpt-4o-mini",
      "api_key": "YOUR_API_KEY",
      "base_url": "https://api.openai.com/v1"
    }
  }
}
```

### 2. 向量存储配置

使用本地文件存储：

```json
{
  "vector_store": {
    "provider": "local",
    "config": {
      "path": "./data/mem0_vectors"
    }
  }
}
```

## 使用

1. 在插件管理页面启用 Mem0 插件
2. 在设置页面配置 LLM API
3. 点击"测试连接"验证配置
4. 保存日记时自动提取任务和标签

## 任务提取

系统会自动识别以下类型的任务：

- "要做某事"
- "老板布置了任务"
- "明天需要..."
- "记得..."

提取的任务会显示在主页右侧的任务列表中。

## 标签系统

自动为内容添加标签：

- **媒体类**：电影、书籍、音乐等
- **事件类**：会议、活动、旅行等
- **人物类**：朋友、同事、家人等
- **情感类**：开心、难过、焦虑等

## API

### 测试连接

```
POST /api/mem0/test
```

### 获取任务列表

```
GET /api/mem0/tasks
```

### 删除任务

```
DELETE /api/mem0/tasks/:id
```

## 数据存储

- 配置文件：`Plugin/Mem0/config.json`
- 任务数据：`data/tasks.json`
- 向量数据：`data/mem0_vectors/`
