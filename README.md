# WebDAV 媒体预览器

一个基于 Next.js 和 Material UI 开发的 WebDAV 图片/视频预览应用。通过 WebDAV 协议连接到您的云存储，随机浏览和预览图片及视频文件。

## ✨ 功能特性

- 🔐 **可配置的 WebDAV 连接** - 支持自定义 WebDAV 服务器配置
- 📁 **多目录挂载** - 同时挂载多个目录，从所有目录中随机选择
- 🗂️ **可视化目录浏览** - 直观的目录浏览器，支持选择式挂载
- 🎲 **智能随机预览** - 从多个目录中随机加载并显示媒体文件
- 🎯 **媒体类型筛选** - 可选择仅查看图片、仅视频或全部
- 🖼️ **图片支持** - JPG, PNG, GIF, WebP, BMP 等格式
- 🎬 **视频支持** - MP4, WebM, MOV, AVI, MKV 等格式
- 📊 **详细统计** - 每个目录独立统计图片、视频数量
- 🎨 **沉浸式界面** - 专注于内容展示，配置优雅隐藏 ⭐ NEW
- 🎪 **侧边抽屉** - 筛选和统计功能收纳在侧边栏 ⭐ NEW
- 📱 **响应式设计** - 支持桌面和移动设备
- 💾 **本地存储** - 配置信息和偏好自动保存
- 🔄 **递归扫描** - 自动扫描指定目录及子目录
- ♻️ **向后兼容** - 自动迁移旧版本配置

## 🚀 快速开始

### 环境要求

- **Node.js 18.18.0 或更高版本**（推荐 20.x LTS）
- npm 或 yarn

> ⚠️ **重要**：Next.js 15 要求 Node.js >= 18.18.0。如果您使用的是 Node.js 16，请先升级 Node.js，或查看 `INSTALL_GUIDE.md` 了解详细解决方案。

### 安装

1. 克隆项目：
```bash
git clone https://github.com/maclanelf/webdavImagePreview.git
cd webdavImagePreview
```

2. 安装依赖：
```bash
npm install
```

3. 启动开发服务器：
```bash
npm run dev
```

4. 在浏览器中打开 [http://localhost:3000](http://localhost:3000)

## 📖 使用说明

### 配置 WebDAV

1. 首次访问应用时，点击"配置 WebDAV"按钮
2. 填写基本连接信息：
   - **WebDAV 服务器地址**：您的 WebDAV 服务器 URL（如：`https://example.com/webdav`）
   - **用户名**：WebDAV 账户用户名
   - **密码**：WebDAV 账户密码
3. 点击"测试连接"验证配置是否正确
4. 点击"浏览并选择目录"打开目录浏览器
5. 在目录浏览器中：
   - 点击文件夹图标进入子目录
   - 使用面包屑导航返回上级目录
   - 点击复选框选择要挂载的目录
   - 系统会自动扫描并显示该目录的文件统计
6. 可以选择多个目录同时挂载
7. 点击"保存配置"保存设置

### 浏览媒体文件

1. 配置完成后，返回首页
2. 页面自动最大化显示媒体内容（沉浸式体验）
3. 点击"开始预览"或右下角悬浮按钮开始浏览
4. 需要筛选时：
   - 点击右上角的**筛选图标** 🔍
   - 侧边抽屉滑出，显示筛选选项
   - 选择：**全部** / **仅图片** / **仅视频**
   - 查看文件统计和已挂载目录
   - 点击遮罩或关闭按钮关闭抽屉
5. 点击右下角的**悬浮按钮**换下一个
6. 对于视频文件，支持在线播放和控制

**界面特点**：
- ✨ 专注于内容展示，配置功能隐藏在侧边抽屉
- 🎯 简洁的顶部工具栏
- 🔀 固定的悬浮按钮，随时可用
- 📱 最大化的媒体展示区域

**提示**：筛选偏好会自动保存，下次访问时保持您的选择。

## 🛠️ 技术栈

- **前端框架**：Next.js 15 (App Router)
- **UI 库**：Material UI (MUI)
- **类型支持**：TypeScript
- **WebDAV 客户端**：webdav
- **样式解决方案**：Emotion

## 📁 项目结构

```
webdavImagePreview/
├── app/
│   ├── api/
│   │   └── webdav/          # WebDAV API 路由
│   │       ├── test/         # 测试连接
│   │       ├── files/        # 获取文件列表
│   │       ├── random/       # 获取随机文件
│   │       └── stream/       # 文件流处理
│   ├── config/              # 配置页面
│   ├── layout.tsx           # 根布局
│   ├── page.tsx             # 首页
│   └── theme.ts             # MUI 主题配置
├── lib/
│   └── webdav.ts            # WebDAV 工具函数
├── env.example              # 环境变量示例
├── next.config.js           # Next.js 配置
├── tsconfig.json            # TypeScript 配置
└── package.json             # 项目依赖

```

## 🔧 配置选项

### 环境变量（可选）

如果不想使用浏览器配置，可以通过环境变量预设 WebDAV 连接：

创建 `.env.local` 文件：

```env
WEBDAV_URL=https://your-webdav-server.com
WEBDAV_USERNAME=your-username
WEBDAV_PASSWORD=your-password
WEBDAV_MEDIA_PATH=/photos
```

## 🌐 部署

### Vercel 部署

1. 将项目推送到 GitHub
2. 在 [Vercel](https://vercel.com) 导入项目
3. 添加环境变量（如需要）
4. 部署完成

### 自托管部署

```bash
# 构建生产版本
npm run build

# 启动生产服务器
npm run start
```

## 🔒 安全注意事项

- 配置信息存储在浏览器 localStorage 中，请勿在公共设备上使用
- 建议使用 HTTPS 协议的 WebDAV 服务器
- 请妥善保管您的 WebDAV 账户密码
- 生产环境部署时，建议配置适当的访问控制

## 📝 许可证

ISC

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 👨‍💻 作者

[Your Name]

## 🙏 致谢

感谢所有开源项目的贡献者！
