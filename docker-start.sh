#!/bin/bash

# WebDAV 图片预览应用 Docker 快速启动脚本

echo "🚀 WebDAV 图片预览应用 Docker 部署脚本"
echo "========================================"

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装 Docker Desktop 或 Docker Compose"
    exit 1
fi

# 检查是否存在环境变量文件
if [ ! -f ".env" ]; then
    echo "📝 创建环境变量配置文件..."
    cp docker.env.example .env
    echo "✅ 已创建 .env 文件，请编辑该文件配置您的 WebDAV 信息"
    echo "💡 提示：如果不配置环境变量，可以在应用启动后通过 Web 界面配置"
    read -p "是否现在编辑 .env 文件？(y/n): " edit_env
    if [ "$edit_env" = "y" ] || [ "$edit_env" = "Y" ]; then
        ${EDITOR:-nano} .env
    fi
fi

# 构建并启动应用
echo "🔨 构建并启动应用..."
docker compose up -d --build

# 等待应用启动
echo "⏳ 等待应用启动..."
sleep 10

# 检查应用状态
if docker compose ps | grep -q "Up"; then
    echo "✅ 应用启动成功！"
    echo "🌐 访问地址: http://localhost:3000"
    echo ""
    echo "📋 管理命令："
    echo "  查看日志: docker compose logs -f"
    echo "  重启应用: docker compose restart"
    echo "  停止应用: docker compose down"
    echo "  更新应用: docker compose up -d --build"
else
    echo "❌ 应用启动失败，请检查日志："
    docker compose logs
fi
