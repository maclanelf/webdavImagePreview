# 使用官方 Node.js 20 Alpine 镜像作为基础镜像
FROM node:20-alpine AS base

# 安装依赖项和时区数据
RUN apk add --no-cache libc6-compat tzdata
WORKDIR /app

# 复制 package.json 和 package-lock.json（显式指定，避免匹配失败）
COPY package.json package-lock.json ./

# 安装依赖项（构建需要 devDependencies）
RUN npm ci

# 复制源代码
COPY . .

# 创建数据目录和日志目录
RUN mkdir -p /app/data /app/logs

# 构建应用
RUN npm run build

# 生产镜像
FROM node:20-alpine AS runner
WORKDIR /app

# 安装时区数据
RUN apk add --no-cache tzdata

# 设置时区为上海时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 创建非root用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 复制构建产物
COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static

# 创建数据目录和日志目录并设置权限
RUN mkdir -p /app/data /app/logs && chown -R nextjs:nodejs /app/data /app/logs

# 切换到非root用户
USER nextjs

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
ENV TZ=Asia/Shanghai

# 启动应用
CMD ["node", "server.js"]
