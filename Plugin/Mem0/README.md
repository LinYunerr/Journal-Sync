# Mem0 Plugin

Mem0 插件用于提取任务、标签和本地记忆数据。

## Config

插件配置位于 `Plugin/Mem0/config.json`。核心包括：

- LLM 提供方与模型配置
- 本地向量存储路径

示例：

```json
{
  "llm": {
    "provider": "openai",
    "config": {
      "model": "gpt-4o-mini",
      "api_key": "YOUR_API_KEY",
      "base_url": "https://api.openai.com/v1"
    }
  },
  "vector_store": {
    "provider": "local",
    "config": {
      "path": "./data/mem0_vectors"
    }
  }
}
```

## Usage

1. 打开 `http://localhost:3000/plugins.html` 启用插件
2. 在 `http://localhost:3000/settings.html` 完成配置
3. 使用插件动作测试连接

## Data

- 任务数据：`data/tasks.json`
- 向量数据：`data/mem0_vectors/`
