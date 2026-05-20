# Docker 部署指南

本指南将帮助您使用 Docker 部署 WebDAV 图片预览应用。

## 📋 前置要求

- Docker 20.10+ 
- Docker Compose 2.0+
- 至少 1GB 可用内存
- 至少 2GB 可用磁盘空间

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/maclanelf/webdavImagePreview.git
cd webdavImagePreview
```

### 2. 配置挂载目录与配置文件

复制环境变量模板文件：

```bash
cp docker.env.example .env
```

编辑 `.env` 文件，至少指定 MySQL 配置文件路径：

```env
# MySQL 配置文件路径（容器内）
MYSQL_CONFIG_FILE=/app/data/mysql-config.json

# WebDAV 配置
WEBDAV_URL=https://your-webdav-server.com
WEBDAV_USERNAME=your-username
WEBDAV_PASSWORD=your-password
WEBDAV_MEDIA_PATH=/photos

# 应用配置
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
TZ=Asia/Shanghai
```

> **注意**：现在推荐通过挂载文件保存 MySQL 配置。首次启动后可直接在配置页填写 MySQL 信息，系统会自动写入宿主机挂载的 [`/app/data/mysql-config.json`](docker-compose.yml:27)，后续重启仍会生效。

### 3. 启动应用

使用 Docker Compose 启动：

```bash
docker compose up -d
```

或者使用 Docker 命令：

```bash
# 构建镜像
docker build -t webdav-image-preview .
# 如果出现需要导出导出
# 导出为tar
docker save -o webdav-image-preview_1.0.0.tar webdav-image-preview:1.0.0
# 导入加载tar
docker load -i webdav-image-preview_1.0.0.tar

# 运行容器
docker run -d \
  --name webdav-image-preview \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  -e MYSQL_CONFIG_FILE=/app/data/mysql-config.json \
  -v webdav_data:/app/data \
  -v webdav_logs:/app/logs \
  --restart unless-stopped \
  webdav-image-preview
```

### 4. 访问应用

打开浏览器访问：http://localhost:3000

## ⏰ 时区配置

应用已配置为使用上海时区（Asia/Shanghai），确保：

1. **数据库时间**：所有数据库记录使用本地时间而非UTC时间
2. **日志时间**：扫描日志和系统日志显示正确的本地时间
3. **定时任务**：定时扫描任务按本地时间执行

如果您的服务器在其他时区，可以修改 `TZ` 环境变量：

```bash
# 例如设置为东京时区
TZ=Asia/Tokyo

# 例如设置为纽约时区  
TZ=America/New_York
```

## 🔧 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| `MYSQL_CONFIG_FILE` | MySQL 配置文件路径 | `/app/data/mysql-config.json` | 否 |
| `WEBDAV_URL` | WebDAV 服务器地址 | - | 否 |
| `WEBDAV_USERNAME` | WebDAV 用户名 | - | 否 |
| `WEBDAV_PASSWORD` | WebDAV 密码 | - | 否 |
| `WEBDAV_MEDIA_PATH` | 媒体文件路径 | `/` | 否 |
| `NODE_ENV` | 运行环境 | `production` | 否 |
| `PORT` | 应用端口 | `3000` | 否 |
| `HOSTNAME` | 绑定地址 | `0.0.0.0` | 否 |
| `TZ` | 时区设置 | `Asia/Shanghai` | 否 |

### 数据持久化

应用容器中的卷用于持久化本地缓存、日志以及 MySQL 配置文件：

- `webdav_data` 卷：
  - `mysql-config.json` 配置文件
  - 应用运行数据缓存
  - 本地临时运行文件

- `webdav_logs` 卷：
  - 扫描日志文件
  - 应用运行日志

补充说明：

- 如果 MySQL 部署在其他服务器，MySQL 的真实数据文件保存在那台服务器上，与 `/app/data` 无关。
- 即使把容器内 `/app/data` 映射到宿主机，也不能“映射出”外部 MySQL 服务器上的数据库文件。
- 这个挂载目录保存的是当前应用自己的 MySQL 连接配置文件，而不是 MySQL 服务器的数据文件。

### 端口映射

默认映射端口 `3000`，您可以通过修改 `docker-compose.yml` 或 Docker 运行命令来更改：

```yaml
ports:
  - "8080:3000"  # 将容器端口 3000 映射到主机端口 8080
```

## 🐬 关于 MySQL Docker 配置是否还有必要

如果您的 MySQL 已经部署在其他服务器：

1. **不需要** 在当前项目的 `docker-compose.yml` 中再额外启动一个 MySQL 容器。
2. **建议** 保留 `MYSQL_CONFIG_FILE`，让应用从挂载文件读取数据库连接配置。
3. `/app/data` 负责当前应用自己的缓存、日志和 `mysql-config.json`，不负责外部 MySQL 的物理数据落盘。

因此，当前最合理的做法是：

- 继续保留应用容器的 `MYSQL_CONFIG_FILE` 挂载配置；
- 不再添加或维护本地 MySQL 服务容器；
- 不把 `/app/data` 当作数据库数据目录使用。

## ️ 管理命令

### 查看日志

```bash
docker compose logs -f webdav-image-preview
```

### 重启应用

```bash
docker compose restart webdav-image-preview
```

### 停止应用

```bash
docker compose down
```

### 更新应用

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker compose up -d --build
```

### 备份数据

```bash
# 备份数据卷
docker run --rm -v webdav_data:/data -v $(pwd):/backup alpine tar czf /backup/webdav_data_backup.tar.gz -C /data .
```

### 恢复数据

```bash
# 恢复数据卷
docker run --rm -v webdav_data:/data -v $(pwd):/backup alpine tar xzf /backup/webdav_data_backup.tar.gz -C /data
```

## 🔍 故障排除

### 无法拉取node:20-alpine镜像
1.采用手动拉取
  ```bash
  docker pull --platform=linux/amd64 node:20-alpine
  ```

### 应用无法启动

1. 检查端口是否被占用：
   ```bash
   netstat -tulpn | grep :3000
   ```

2. 查看容器日志：
   ```bash
   docker-compose logs webdav-image-preview
   ```

3. 检查环境变量配置是否正确

### WebDAV 连接失败

1. 确认 WebDAV 服务器地址、用户名和密码正确
2. 检查网络连接是否正常
3. 确认 WebDAV 服务器支持 CORS（如果通过浏览器访问）

### 数据丢失

1. 检查 Docker 卷是否正确挂载：
   ```bash
   docker volume inspect webdav_data
   ```

2. 确认没有意外删除数据卷

### 性能问题

1. 增加容器内存限制：
   ```yaml
   services:
     webdav-image-preview:
       deploy:
         resources:
           limits:
             memory: 1G
   ```

2. 优化 WebDAV 连接设置

## 🔒 安全建议

### 生产环境部署

1. **使用 HTTPS**：配置反向代理（如 Nginx）启用 HTTPS
2. **限制访问**：使用防火墙限制访问来源
3. **定期备份**：设置自动备份策略
4. **监控日志**：设置日志监控和告警
5. **更新维护**：定期更新应用和依赖

### 反向代理配置示例（Nginx）

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 📊 监控和健康检查

应用内置了健康检查端点：

- **健康检查**：`http://localhost:3000/api/test-db`
- **检查间隔**：30秒
- **超时时间**：10秒
- **重试次数**：3次

您可以使用以下命令检查应用状态：

```bash
# 检查容器健康状态
docker ps

# 手动健康检查
curl http://localhost:3000/api/test-db
```

## 🆘 获取帮助

如果遇到问题，请：

1. 查看 [GitHub Issues](https://github.com/maclanelf/webdavImagePreview/issues)
2. 检查应用日志
3. 确认系统要求是否满足
4. 验证 WebDAV 服务器配置

## 📝 更新日志

- **v1.0.0**：初始 Docker 支持
- 支持数据持久化
- 支持环境变量配置
- 内置健康检查
- 支持 Docker Compose 部署
