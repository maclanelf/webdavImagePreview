#!/bin/bash

echo "开始构建Docker镜像..."

# 构建镜像
docker build -t webdav-image-preview:latest .

if [ $? -eq 0 ]; then
    echo "✅ Docker镜像构建成功！"
    echo ""
    echo "镜像信息："
    docker images webdav-image-preview:latest
    echo ""
    echo "下一步操作："
    echo "1. 使用 docker-compose 启动："
    echo "   docker compose up -d"
    echo ""
    echo "2. 或者直接运行容器："
    echo "   docker run -d --name webdav-image-preview -p 3000:3000 -e TZ=Asia/Shanghai -v webdav_data:/app/data -v webdav_logs:/app/logs --restart unless-stopped webdav-image-preview:latest"
    echo ""
    echo "3. 查看日志："
    echo "   docker logs -f webdav-image-preview"
else
    echo "❌ Docker镜像构建失败！"
    exit 1
fi
