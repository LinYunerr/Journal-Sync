#!/bin/bash

# Journal Sync 服务器停止脚本
# 安全地停止在当前项目目录运行的 node 服务器

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_FILE="server.js"

echo "🔍 查找 Journal Sync 服务器进程..."
echo "项目目录: $PROJECT_DIR"
echo ""

# 查找所有可能的进程模式
# 1. 完整路径：node /path/to/src/web/server.js
# 2. 相对路径：node src/web/server.js
# 3. nohup 启动：nohup node src/web/server.js
PIDS=$(ps aux | grep -E "node.*(src/web/server\.js|$PROJECT_DIR/src/web/server\.js)" | grep -v grep | awk '{print $2}')

if [ -z "$PIDS" ]; then
    echo "❌ 未找到运行中的服务器进程"
    echo ""
    echo "提示：如果服务器正在运行，请检查："
    echo "  1. 是否在正确的项目目录执行此脚本"
    echo "  2. 运行 'ps aux | grep server.js' 查看进程"
    echo ""
    echo "尝试查找所有 node 进程..."
    ps aux | grep "node" | grep -v grep | head -5
    exit 1
fi

echo "找到以下进程："
ps aux | grep -E "node.*(src/web/server\.js|$PROJECT_DIR/src/web/server\.js)" | grep -v grep
echo ""

# 统计进程数量
COUNT=$(echo "$PIDS" | wc -l | tr -d ' ')

if [ "$COUNT" -eq 1 ]; then
    echo "准备停止 1 个进程..."
else
    echo "准备停止 $COUNT 个进程..."
fi

# 逐个停止进程
for PID in $PIDS; do
    echo "  ⏹️  停止进程 $PID"
    kill $PID 2>/dev/null

    # 等待进程结束（最多 3 秒）
    for i in {1..6}; do
        if ! ps -p $PID > /dev/null 2>&1; then
            echo "  ✅ 进程 $PID 已停止"
            break
        fi
        sleep 0.5
    done

    # 如果还没停止，强制杀掉
    if ps -p $PID > /dev/null 2>&1; then
        echo "  ⚠️  进程 $PID 未响应，强制停止..."
        kill -9 $PID 2>/dev/null
        echo "  ✅ 进程 $PID 已强制停止"
    fi
done

echo ""
echo "✅ 所有服务器进程已停止"

