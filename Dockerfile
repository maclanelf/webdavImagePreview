# 使用官方 Node.js 20 Alpine 镜像作为基础镜像
FROM node:20-alpine AS base

# 安装依赖项
RUN apk add --no-cache libc6-compat
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖项
RUN npm ci --only=production

# 复制源代码
COPY . .

# 创建数据目录
RUN mkdir -p /app/data

# 构建应用
RUN npm run build

# 生产镜像
FROM node:20-alpine AS runner
WORKDIR /app

# 创建非root用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 复制构建产物
COPY --from=base /app/public ./public
COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static

# 创建数据目录并设置权限
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# 切换到非root用户
USER nextjs

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# 启动应用
CMD ["node", "server.js"]
