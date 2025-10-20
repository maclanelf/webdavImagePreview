@echo off
chcp 65001 >nul
echo 🚀 WebDAV 图片预览应用 Docker 部署脚本
echo ========================================

REM 检查 Docker 是否安装
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker 未安装，请先安装 Docker
    pause
    exit /b 1
)

REM 检查 Docker Compose 是否安装
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker Compose 未安装，请先安装 Docker Compose
    pause
    exit /b 1
)

REM 检查是否存在环境变量文件
if not exist ".env" (
    echo 📝 创建环境变量配置文件...
    copy docker.env.example .env
    echo ✅ 已创建 .env 文件，请编辑该文件配置您的 WebDAV 信息
    echo 💡 提示：如果不配置环境变量，可以在应用启动后通过 Web 界面配置
    set /p edit_env="是否现在编辑 .env 文件？(y/n): "
    if /i "%edit_env%"=="y" (
        notepad .env
    )
)

REM 构建并启动应用
echo 🔨 构建并启动应用...
docker-compose up -d --build

REM 等待应用启动
echo ⏳ 等待应用启动...
timeout /t 10 /nobreak >nul

REM 检查应用状态
docker-compose ps | findstr "Up" >nul
if errorlevel 1 (
    echo ❌ 应用启动失败，请检查日志：
    docker-compose logs
) else (
    echo ✅ 应用启动成功！
    echo 🌐 访问地址: http://localhost:3000
    echo.
    echo 📋 管理命令：
    echo   查看日志: docker-compose logs -f
    echo   重启应用: docker-compose restart
    echo   停止应用: docker-compose down
    echo   更新应用: docker-compose up -d --build
)

pause
