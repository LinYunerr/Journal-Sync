# Stop 脚本改进 - 2026-03-10

## 问题描述

原来的 `stop.sh` 脚本只能查找包含完整路径的进程：
```bash
PIDS=$(ps aux | grep "node.*$SERVER_FILE" | grep -v grep | awk '{print $2}')
```

这导致以下问题：
- 用 `nohup node src/web/server.js` 启动的进程无法被找到
- 调试时启动的进程无法通过 `npm stop` 关闭
- 必须手动 `pkill` 或 `kill` 进程

## 解决方案

改进 grep 模式，支持多种启动方式：

```bash
# 查找所有可能的进程模式
# 1. 完整路径：node /path/to/src/web/server.js
# 2. 相对路径：node src/web/server.js
# 3. nohup 启动：nohup node src/web/server.js
PIDS=$(ps aux | grep -E "node.*(src/web/server\.js|$PROJECT_DIR/src/web/server\.js)" | grep -v grep | awk '{print $2}')
```

## 改进内容

### 1. 更灵活的进程匹配

使用 `grep -E` 支持正则表达式，匹配：
- 相对路径：`src/web/server.js`
- 绝对路径：`/path/to/Journal-Sync/src/web/server.js`

### 2. 更好的错误提示

如果找不到进程，显示所有 node 进程供参考：
```bash
echo "尝试查找所有 node 进程..."
ps aux | grep "node" | grep -v grep | head -5
```

### 3. 保持原有功能

- 优雅停止（先 `kill`，等待 3 秒）
- 强制停止（如果进程未响应，使用 `kill -9`）
- 支持多个进程同时停止
- 详细的进度提示

## 使用方法

### 方法 1：npm 命令（推荐）

```bash
npm stop
```

### 方法 2：直接执行脚本

```bash
./stop.sh
```

### 方法 3：从任意目录执行

```bash
/path/to/Journal-Sync/stop.sh
```

## 测试验证

### 测试 1：nohup 启动的进程

```bash
# 启动服务器
nohup node src/web/server.js > logs/server.log 2>&1 &

# 停止服务器
npm stop
```

✅ 结果：成功找到并停止进程

### 测试 2：npm start 启动的进程

```bash
# 启动服务器
npm start &

# 停止服务器
npm stop
```

✅ 结果：成功找到并停止进程

### 测试 3：多个进程

```bash
# 启动多个服务器（模拟误操作）
node src/web/server.js &
nohup node src/web/server.js > logs/server.log 2>&1 &

# 停止所有服务器
npm stop
```

✅ 结果：找到并停止所有进程

## 输出示例

### 成功停止

```
🔍 查找 Journal Sync 服务器进程...
项目目录: /path/to/Journal-Sync

找到以下进程：
linyun           70873   0.0  0.4 436116608  62608   ??  SN   11:09下午   0:00.11 node src/web/server.js

准备停止 1 个进程...
  ⏹️  停止进程 70873
  ✅ 进程 70873 已停止

✅ 所有服务器进程已停止
```

### 未找到进程

```
🔍 查找 Journal Sync 服务器进程...
项目目录: /path/to/Journal-Sync

❌ 未找到运行中的服务器进程

提示：如果服务器正在运行，请检查：
  1. 是否在正确的项目目录执行此脚本
  2. 运行 'ps aux | grep server.js' 查看进程

尝试查找所有 node 进程...
linyun           12345   0.0  0.3 ...  node other-app.js
```

### 强制停止

```
准备停止 1 个进程...
  ⏹️  停止进程 70873
  ⚠️  进程 70873 未响应，强制停止...
  ✅ 进程 70873 已强制停止

✅ 所有服务器进程已停止
```

## 技术细节

### grep 正则表达式

```bash
grep -E "node.*(src/web/server\.js|$PROJECT_DIR/src/web/server\.js)"
```

- `-E`：启用扩展正则表达式
- `node.*`：匹配 node 命令及其参数
- `src/web/server\.js`：匹配相对路径
- `$PROJECT_DIR/src/web/server\.js`：匹配绝对路径
- `|`：或运算符

### 进程停止流程

1. 发送 `SIGTERM` 信号（优雅停止）
2. 等待最多 3 秒（每 0.5 秒检查一次）
3. 如果进程仍在运行，发送 `SIGKILL` 信号（强制停止）

### 安全性

- 只停止匹配 `src/web/server.js` 的进程
- 不会误杀其他 node 进程
- 支持在项目目录外执行（通过 `$PROJECT_DIR` 变量）

## 故障排查

### 问题：npm stop 报错 "permission denied"

**解决**：
```bash
chmod +x stop.sh
```

### 问题：找不到进程但服务器在运行

**解决**：
1. 手动查看进程：
```bash
ps aux | grep node
```

2. 找到 PID 后手动停止：
```bash
kill <PID>
```

3. 如果还是停不了：
```bash
kill -9 <PID>
```

### 问题：停止后端口仍被占用

**解决**：
```bash
# 查找占用 3000 端口的进程
lsof -i :3000

# 停止该进程
kill -9 <PID>
```

## 相关命令

```bash
# 查看服务器状态
ps aux | grep "node.*server.js" | grep -v grep

# 查看端口占用
lsof -i :3000

# 查看服务器日志
tail -f logs/server.log

# 启动服务器
npm start

# 停止服务器
npm stop
```

---

修改时间：2026-03-10 23:10
修改人：Claude (Sonnet 4.6)
