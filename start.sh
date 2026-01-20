#!/bin/sh

# 启动脚本 - 同时运行 Nginx 和 Next.js

# 启动 Next.js 应用（后台运行）
echo "Starting Next.js application..."
node server.js &

# 等待 Next.js 启动
echo "Waiting for Next.js to start..."
sleep 5

# 检查 Next.js 是否启动成功
until wget --spider -q http://localhost:3000/api/test-db 2>/dev/null; do
    echo "Waiting for Next.js to be ready..."
    sleep 2
done

echo "Next.js is ready!"

# 启动 Nginx（前台运行）
echo "Starting Nginx..."
nginx -g 'daemon off;'
