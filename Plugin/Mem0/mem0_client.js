import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mem0 客户端封装
 * 提供记忆存储、任务提取、标签生成功能
 */
export class Mem0Client {
  constructor(config) {
    this.config = config;
    this.llmConfig = config.llm?.config || {};
    this.vectorStorePath = path.join(process.cwd(), config.vectorStore?.config?.path || 'data/mem0_vectors');
    this.tasksPath = path.join(process.cwd(), 'data/tasks.json');
    this.insightsPath = path.join(process.cwd(), 'data/mem0_insights.json');
  }

  /**
   * 测试 LLM 连接
   */
  async testConnection() {
    try {
      const response = await fetch(`${this.llmConfig.base_url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.llmConfig.api_key}`
        },
        body: JSON.stringify({
          model: this.llmConfig.model,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `API 错误: ${response.status} - ${error}` };
      }

      return { success: true, message: '连接成功' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 调用 LLM
   */
  async callLLM(messages, options = {}) {
    try {
      const response = await fetch(`${this.llmConfig.base_url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.llmConfig.api_key}`
        },
        body: JSON.stringify({
          model: this.llmConfig.model,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 1000
        })
      });

      if (!response.ok) {
        throw new Error(`LLM API 错误: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('[Mem0Client] LLM 调用失败:', error);
      throw error;
    }
  }

  /**
   * 提取任务
   */
  async extractTasks(content) {
    const prompt = `分析以下日记内容，提取其中的任务（Task）。

任务特征：
- 包含"要做"、"需要"、"记得"、"布置了任务"等关键词
- 明确的行动项
- 未来需要完成的事情

日记内容：
${content}

请以 JSON 格式返回任务列表，格式如下：
[
  {
    "title": "任务标题",
    "description": "任务描述",
    "priority": "high/medium/low",
    "dueDate": "截止日期（如果有）",
    "context": "任务上下文"
  }
]

如果没有任务，返回空数组 []。只返回 JSON，不要其他文字。`;

    try {
      const response = await this.callLLM([
        { role: 'system', content: '你是一个任务提取助手，擅长从文本中识别任务。' },
        { role: 'user', content: prompt }
      ]);

      // 清理响应，提取 JSON
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '');
      }

      const tasks = JSON.parse(jsonStr);
      return Array.isArray(tasks) ? tasks : [];
    } catch (error) {
      console.error('[Mem0Client] 任务提取失败:', error);
      return [];
    }
  }

  /**
   * 生成标签
   */
  async generateTags(content) {
    const prompt = `分析以下内容，生成合适的标签。

内容类型：
- 媒体类：电影、书籍、音乐、游戏等
- 事件类：会议、活动、旅行等
- 人物类：朋友、同事、家人等
- 情感类：开心、难过、焦虑等
- 主题类：工作、学习、生活等

内容：
${content}

请以 JSON 格式返回标签，格式如下：
{
  "tags": ["标签1", "标签2"],
  "entities": [
    {
      "name": "实体名称",
      "type": "movie/book/person/event/etc",
      "sentiment": "positive/negative/neutral"
    }
  ]
}

只返回 JSON，不要其他文字。`;

    try {
      const response = await this.callLLM([
        { role: 'system', content: '你是一个标签生成助手，擅长从文本中提取实体和标签。' },
        { role: 'user', content: prompt }
      ]);

      // 清理响应，提取 JSON
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '');
      }

      return JSON.parse(jsonStr);
    } catch (error) {
      console.error('[Mem0Client] 标签生成失败:', error);
      return { tags: [], entities: [] };
    }
  }

  /**
   * 存储记忆
   */
  async storeMemory(content, metadata = {}) {
    try {
      // 确保向量存储目录存在
      await fs.mkdir(this.vectorStorePath, { recursive: true });

      // 生成标签
      const tagsData = await this.generateTags(content);

      // 提取任务
      const tasks = await this.extractTasks(content);

      // 构建记忆对象
      const memory = {
        id: Date.now().toString(),
        content,
        tags: tagsData.tags || [],
        entities: tagsData.entities || [],
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
          type: metadata.type || 'diary'
        },
        tasks: tasks.length
      };

      // 保存到本地文件
      const memoryFile = path.join(this.vectorStorePath, `${memory.id}.json`);
      await fs.writeFile(memoryFile, JSON.stringify(memory, null, 2), 'utf-8');

      // 保存任务
      if (tasks.length > 0) {
        await this.saveTasks(tasks, memory.id);
      }

      return {
        success: true,
        memory,
        tasks
      };
    } catch (error) {
      console.error('[Mem0Client] 存储记忆失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 保存任务到任务列表
   */
  async saveTasks(newTasks, memoryId) {
    try {
      // 读取现有任务
      let existingTasks = [];
      try {
        const data = await fs.readFile(this.tasksPath, 'utf-8');
        existingTasks = JSON.parse(data);
      } catch (error) {
        // 文件不存在，使用空数组
      }

      // 检查任务是否已存在（基于标题相似度）
      const tasksToAdd = [];
      for (const newTask of newTasks) {
        const isDuplicate = existingTasks.some(existing =>
          existing.title.toLowerCase() === newTask.title.toLowerCase() ||
          this.calculateSimilarity(existing.title, newTask.title) > 0.8
        );

        if (!isDuplicate) {
          tasksToAdd.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            ...newTask,
            status: 'extracted',
            memoryId,
            createdAt: new Date().toISOString()
          });
        }
      }

      // 添加新任务
      if (tasksToAdd.length > 0) {
        existingTasks.push(...tasksToAdd);
        await fs.writeFile(this.tasksPath, JSON.stringify(existingTasks, null, 2), 'utf-8');
      }

      return tasksToAdd;
    } catch (error) {
      console.error('[Mem0Client] 保存任务失败:', error);
      return [];
    }
  }

  /**
   * 计算字符串相似度（简单实现）
   */
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * 计算编辑距离
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * 获取所有任务
   */
  async getTasks() {
    try {
      const data = await fs.readFile(this.tasksPath, 'utf-8');
      const tasks = JSON.parse(data);
      return tasks.filter(task => task.status !== 'deleted');
    } catch (error) {
      return [];
    }
  }

  /**
   * 删除任务
   */
  async deleteTask(taskId) {
    try {
      const data = await fs.readFile(this.tasksPath, 'utf-8');
      const tasks = JSON.parse(data);

      const updatedTasks = tasks.map(task =>
        task.id === taskId ? { ...task, status: 'deleted' } : task
      );

      await fs.writeFile(this.tasksPath, JSON.stringify(updatedTasks, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('[Mem0Client] 删除任务失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 读取洞察数据
   */
  async loadInsights() {
    try {
      const data = await fs.readFile(this.insightsPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return {
        emotions: { weeklyKeywords: [], history: [], lastUpdated: null },
        media: { items: [], history: [] },
        work: { items: [], history: [] },
        life: { items: [], history: [] }
      };
    }
  }

  /**
   * 保存洞察数据
   */
  async saveInsights(insights) {
    try {
      await fs.writeFile(this.insightsPath, JSON.stringify(insights, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      console.error('[Mem0Client] 保存洞察失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 分析情绪（过去7天）
   */
  async analyzeEmotions() {
    try {
      // 读取过去7天的记忆
      const memories = await this.getRecentMemories(7);
      if (memories.length === 0) {
        return { weeklyKeywords: [], sentiment: 'neutral' };
      }

      const allContent = memories.map(m => m.content).join('\n\n');

      const prompt = `分析以下过去7天的日记内容，提取情感关键词。

日记内容：
${allContent}

请识别：
1. 主要情绪状态（如：焦虑、忙碌、开心、疲惫、充实等）
2. 情感极性（正向/负向/中性）

以 JSON 格式返回：
{
  "weeklyKeywords": ["关键词1", "关键词2", "关键词3"],
  "sentiment": "positive/negative/neutral",
  "summary": "一句话总结本周情绪"
}

只返回 JSON，不要其他文字。`;

      const response = await this.callLLM([
        { role: 'system', content: '你是一个情感分析专家，擅长从日记中识别情绪状态。' },
        { role: 'user', content: prompt }
      ]);

      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '');
      }

      const result = JSON.parse(jsonStr);

      // 保存到历史
      const insights = await this.loadInsights();
      insights.emotions.weeklyKeywords = result.weeklyKeywords || [];
      insights.emotions.lastUpdated = new Date().toISOString();
      insights.emotions.history.push({
        date: new Date().toISOString(),
        keywords: result.weeklyKeywords,
        sentiment: result.sentiment,
        summary: result.summary
      });

      // 只保留最近30条历史
      if (insights.emotions.history.length > 30) {
        insights.emotions.history = insights.emotions.history.slice(-30);
      }

      await this.saveInsights(insights);

      return result;
    } catch (error) {
      console.error('[Mem0Client] 情绪分析失败:', error);
      return { weeklyKeywords: [], sentiment: 'neutral' };
    }
  }

  /**
   * 提取书影音
   */
  async extractMedia(content) {
    const prompt = `分析以下日记内容，提取提到的书籍、电影、音乐、游戏等媒体内容。

日记内容：
${content}

识别规则：
- 明确提到的书名、电影名、音乐、游戏
- 包含"看了"、"读了"、"听了"、"玩了"、"推荐"等关键词
- 提取用户的态度（感兴趣/已完成/不喜欢）

以 JSON 格式返回：
[
  {
    "type": "movie/book/music/game",
    "name": "名称",
    "description": "简短描述（如：某人推荐的科幻电影）",
    "status": "interested/completed/dismissed",
    "source": "来源（如：朋友推荐、自己发现）"
  }
]

如果没有，返回空数组 []。只返回 JSON，不要其他文字。`;

    try {
      const response = await this.callLLM([
        { role: 'system', content: '你是一个媒体内容提取助手。' },
        { role: 'user', content: prompt }
      ]);

      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '');
      }

      const items = JSON.parse(jsonStr);
      return Array.isArray(items) ? items : [];
    } catch (error) {
      console.error('[Mem0Client] 书影音提取失败:', error);
      return [];
    }
  }

  /**
   * 提取工作相关事项
   */
  async extractWorkItems(content) {
    const prompt = `分析以下日记内容，提取工作相关的重要事项。

日记内容：
${content}

识别规则：
- 工作会议、项目、任务
- 工作相关的决策、问题、进展
- 与同事、客户的互动
- 工作成果、里程碑

以 JSON 格式返回最近5件事：
[
  {
    "title": "事项标题",
    "description": "详细描述",
    "date": "提及的日期",
    "importance": "high/medium/low"
  }
]

如果没有，返回空数组 []。只返回 JSON，不要其他文字。`;

    try {
      const response = await this.callLLM([
        { role: 'system', content: '你是一个工作事项提取助手。' },
        { role: 'user', content: prompt }
      ]);

      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '');
      }

      const items = JSON.parse(jsonStr);
      return Array.isArray(items) ? items : [];
    } catch (error) {
      console.error('[Mem0Client] 工作事项提取失败:', error);
      return [];
    }
  }

  /**
   * 提取生活相关事项
   */
  async extractLifeItems(content) {
    const prompt = `分析以下日记内容，提取生活相关的重要事项。

日记内容：
${content}

识别规则：
- 个人生活、家庭、朋友
- 健康、运动、饮食
- 兴趣爱好、娱乐活动
- 旅行、购物、日常琐事

以 JSON 格式返回最近5件事：
[
  {
    "title": "事项标题",
    "description": "详细描述",
    "date": "提及的日期",
    "category": "health/social/hobby/daily"
  }
]

如果没有，返回空数组 []。只返回 JSON，不要其他文字。`;

    try {
      const response = await this.callLLM([
        { role: 'system', content: '你是一个生活事项提取助手。' },
        { role: 'user', content: prompt }
      ]);

      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '');
      }

      const items = JSON.parse(jsonStr);
      return Array.isArray(items) ? items : [];
    } catch (error) {
      console.error('[Mem0Client] 生活事项提取失败:', error);
      return [];
    }
  }

  /**
   * 更新洞察（在保存日记时调用）
   */
  async updateInsights(content, metadata = {}) {
    try {
      const insights = await this.loadInsights();

      // 提取书影音
      const mediaItems = await this.extractMedia(content);
      for (const item of mediaItems) {
        const itemWithId = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          ...item,
          createdAt: new Date().toISOString(),
          visible: item.status === 'interested' // 只有感兴趣的显示在前端
        };

        // 添加到历史
        insights.media.history.push(itemWithId);

        // 如果是感兴趣的，添加到当前列表
        if (item.status === 'interested') {
          insights.media.items.push(itemWithId);
        }

        // 如果是已完成或不喜欢，从当前列表移除
        if (item.status === 'completed' || item.status === 'dismissed') {
          insights.media.items = insights.media.items.filter(i =>
            i.name.toLowerCase() !== item.name.toLowerCase()
          );
        }
      }

      // 提取工作事项
      const workItems = await this.extractWorkItems(content);
      for (const item of workItems) {
        const itemWithId = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          ...item,
          createdAt: new Date().toISOString(),
          visible: true
        };
        insights.work.items.unshift(itemWithId);
        insights.work.history.push(itemWithId);
      }

      // 只保留最近5条工作事项
      insights.work.items = insights.work.items.slice(0, 5);

      // 提取生活事项
      const lifeItems = await this.extractLifeItems(content);
      for (const item of lifeItems) {
        const itemWithId = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          ...item,
          createdAt: new Date().toISOString(),
          visible: true
        };
        insights.life.items.unshift(itemWithId);
        insights.life.history.push(itemWithId);
      }

      // 只保留最近5条生活事项
      insights.life.items = insights.life.items.slice(0, 5);

      await this.saveInsights(insights);

      return {
        success: true,
        media: mediaItems.length,
        work: workItems.length,
        life: lifeItems.length
      };
    } catch (error) {
      console.error('[Mem0Client] 更新洞察失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取最近的记忆
   */
  async getRecentMemories(days = 7) {
    try {
      const files = await fs.readdir(this.vectorStorePath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const memories = [];
      for (const file of jsonFiles) {
        const filePath = path.join(this.vectorStorePath, file);
        const data = await fs.readFile(filePath, 'utf-8');
        const memory = JSON.parse(data);

        const memoryDate = new Date(memory.metadata.timestamp);
        if (memoryDate >= cutoffDate) {
          memories.push(memory);
        }
      }

      return memories.sort((a, b) =>
        new Date(b.metadata.timestamp) - new Date(a.metadata.timestamp)
      );
    } catch (error) {
      console.error('[Mem0Client] 获取记忆失败:', error);
      return [];
    }
  }

  /**
   * 获取洞察数据
   */
  async getInsights() {
    return await this.loadInsights();
  }

  /**
   * 更新媒体项可见性
   */
  async updateMediaVisibility(itemId, visible) {
    try {
      const insights = await this.loadInsights();

      // 更新历史记录中的可见性
      const historyItem = insights.media.history.find(i => i.id === itemId);
      if (historyItem) {
        historyItem.visible = visible;
      }

      // 更新当前列表
      if (visible) {
        if (historyItem && !insights.media.items.find(i => i.id === itemId)) {
          insights.media.items.push(historyItem);
        }
      } else {
        insights.media.items = insights.media.items.filter(i => i.id !== itemId);
      }

      await this.saveInsights(insights);
      return { success: true };
    } catch (error) {
      console.error('[Mem0Client] 更新媒体可见性失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 更新工作/生活项可见性
   */
  async updateItemVisibility(category, itemId, visible) {
    try {
      const insights = await this.loadInsights();

      if (category !== 'work' && category !== 'life') {
        throw new Error('Invalid category');
      }

      const historyItem = insights[category].history.find(i => i.id === itemId);
      if (historyItem) {
        historyItem.visible = visible;
      }

      if (visible) {
        if (historyItem && !insights[category].items.find(i => i.id === itemId)) {
          insights[category].items.push(historyItem);
        }
      } else {
        insights[category].items = insights[category].items.filter(i => i.id !== itemId);
      }

      await this.saveInsights(insights);
      return { success: true };
    } catch (error) {
      console.error('[Mem0Client] 更新项可见性失败:', error);
      return { success: false, error: error.message };
    }
  }
}

export default Mem0Client;
