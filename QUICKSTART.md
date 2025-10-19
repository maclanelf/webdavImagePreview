# 快速开始指南

## 🎯 快速启动步骤

### 1. 安装依赖（已完成）

项目依赖已经安装完成，包括：
- Next.js 15
- React 19
- Material UI
- WebDAV 客户端
- TypeScript

### 2. 启动开发服务器

```bash
npm run dev
```

服务器将在 http://localhost:3000 启动

### 3. 配置 WebDAV 连接

首次访问时，您会看到欢迎页面：

1. 点击 **"配置 WebDAV"** 按钮
2. 填写您的 WebDAV 服务器信息：
   - **服务器地址**: 例如 `https://example.com/webdav`
   - **用户名**: 您的 WebDAV 账户用户名
   - **密码**: 您的 WebDAV 账户密码
   - **媒体路径**: 图片/视频所在目录，默认 `/`

3. 点击 **"测试连接"** 验证配置
4. 点击 **"保存配置"** 保存设置

### 4. 开始预览媒体文件

配置保存后，您将被重定向到主页：

1. **选择媒体类型**（可选）：
   - 全部 - 显示所有图片和视频
   - 仅图片 - 只显示图片
   - 仅视频 - 只显示视频

2. 点击 **"开始预览"** 按钮

3. 系统会从所有目录中随机选择符合筛选条件的文件

4. 点击 **"换一个"** 按钮查看下一个随机文件

5. 视频文件支持在线播放和控制

**提示**：您的筛选偏好会自动保存！

## 📋 支持的文件格式

### 图片格式
- JPG / JPEG
- PNG
- GIF
- WebP
- BMP

### 视频格式
- MP4
- WebM
- MOV
- AVI
- MKV

## 🔧 可选：使用环境变量

如果您想预设 WebDAV 配置（跳过界面配置），可以创建 `.env.local` 文件：

```bash
# 复制示例文件
cp env.example .env.local
```

然后编辑 `.env.local` 文件，填入您的配置：

```env
WEBDAV_URL=https://your-webdav-server.com
WEBDAV_USERNAME=your-username
WEBDAV_PASSWORD=your-password
WEBDAV_MEDIA_PATH=/photos
```

## 🎨 界面功能

### 主页面功能
- 🎯 **媒体类型筛选**: 选择查看图片、视频或全部
- 📊 **统计信息**: 显示图片、视频总数
- 🎲 **随机预览**: 随机加载媒体文件
- 🖼️ **图片查看**: 自适应大小显示
- 🎬 **视频播放**: 内置播放器支持
- ℹ️ **文件信息**: 显示文件名、路径、大小、修改时间

### 配置页面功能
- ✅ **连接测试**: 验证 WebDAV 配置
- 💾 **保存配置**: 本地存储配置信息
- 👁️ **密码显示/隐藏**: 密码输入框切换
- 📝 **输入提示**: 友好的表单提示信息

## ⚡ 常见问题

### Q: 连接失败怎么办？
**A:** 请检查：
- WebDAV 服务器地址是否正确
- 用户名和密码是否正确
- 服务器是否可访问（网络连接）
- 是否使用了 HTTPS（推荐）

### Q: 找不到媒体文件？
**A:** 请确认：
- 媒体路径是否正确
- 目录中是否包含支持的文件格式
- 是否有足够的访问权限

### Q: 视频无法播放？
**A:** 可能原因：
- 浏览器不支持该视频编码
- 文件损坏或格式不标准
- 建议使用 MP4 格式（兼容性最好）

### Q: 配置信息保存在哪里？
**A:** 配置信息保存在浏览器的 localStorage 中，仅在当前浏览器可用。

## 🚀 生产部署

### 构建生产版本

```bash
npm run build
```

### 启动生产服务器

```bash
npm run start
```

### 使用 PM2 守护进程（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start npm --name "webdav-preview" -- start

# 开机自启动
pm2 startup
pm2 save
```

## 📦 项目文件说明

- `app/` - Next.js 应用目录
  - `page.tsx` - 主页面（媒体预览）
  - `config/page.tsx` - 配置页面
  - `api/webdav/` - API 路由
  - `layout.tsx` - 根布局
  - `theme.ts` - MUI 主题配置

- `lib/` - 工具函数
  - `webdav.ts` - WebDAV 客户端封装

- `env.example` - 环境变量示例
- `next.config.js` - Next.js 配置
- `tsconfig.json` - TypeScript 配置

## 💡 提示

- 首次加载文件列表可能需要一些时间（取决于文件数量）
- 大文件加载速度取决于 WebDAV 服务器速度
- 建议使用现代浏览器（Chrome、Firefox、Edge、Safari）
- 移动设备也可以正常使用

## 🎉 开始使用

现在您已经准备好了！运行 `npm run dev`，然后在浏览器中访问 http://localhost:3000 开始使用吧！

如有问题，请查看 README.md 或提交 Issue。

