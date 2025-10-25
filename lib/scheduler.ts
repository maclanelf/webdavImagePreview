import { scheduledScans } from './database'

class Scheduler {
  private intervalId: NodeJS.Timeout | null = null
  private isRunning = false
  private checkInterval = 5 * 60 * 1000 // 默认5分钟

  // 启动调度器
  start() {
    if (this.isRunning) {
      console.log('调度器已经在运行中')
      return
    }

    console.log('启动内置定时任务调度器...')
    this.isRunning = true
    
    // 动态调整检查间隔
    this.adjustCheckInterval()
    
    // 每5分钟检查一次
    this.intervalId = setInterval(() => {
      this.checkAndExecuteTasks()
      // 每次检查后重新调整间隔
      this.adjustCheckInterval()
    }, this.checkInterval)

    // 立即执行一次检查
    this.checkAndExecuteTasks()
  }

  // 停止调度器
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.isRunning = false
    console.log('定时任务调度器已停止')
  }

  // 动态调整检查间隔
  private adjustCheckInterval() {
    try {
      const activeTasks = scheduledScans.getActive()
      let minInterval = 5 * 60 * 1000 // 默认5分钟
      
      for (const task of activeTasks) {
        const taskData = task as any
        const cronExpression = taskData.cron_expression
        
        // 解析cron表达式获取最小间隔
        const interval = this.parseMinInterval(cronExpression)
        if (interval < minInterval) {
          minInterval = interval
        }
      }
      
      // 限制最小间隔为1分钟，避免过于频繁的检查
      minInterval = Math.max(minInterval, 60 * 1000)
      
      if (minInterval !== this.checkInterval) {
        console.log(`调整检查间隔: ${this.checkInterval / 1000}秒 -> ${minInterval / 1000}秒`)
        this.checkInterval = minInterval
        
        // 重新设置定时器
        if (this.intervalId) {
          clearInterval(this.intervalId)
          this.intervalId = setInterval(() => {
            this.checkAndExecuteTasks()
            this.adjustCheckInterval()
          }, this.checkInterval)
        }
      }
    } catch (error) {
      console.error('调整检查间隔失败:', error)
    }
  }

  // 解析cron表达式获取最小间隔（毫秒）
  private parseMinInterval(cronExpression: string): number {
    try {
      const parts = cronExpression.split(' ')
      if (parts.length !== 5) return 5 * 60 * 1000
      
      const [minute, hour] = parts
      
      // 如果分钟不是*，计算分钟间隔
      if (minute !== '*') {
        if (minute.includes('/')) {
          const [, interval] = minute.split('/')
          const intervalNum = parseInt(interval) || 1
          return intervalNum * 60 * 1000 // 转换为毫秒
        } else {
          return 60 * 1000 // 每分钟
        }
      }
      
      // 如果小时不是*，计算小时间隔
      if (hour !== '*') {
        if (hour.includes('/')) {
          const [, interval] = hour.split('/')
          const intervalNum = parseInt(interval) || 1
          return intervalNum * 60 * 60 * 1000 // 转换为毫秒
        } else {
          return 60 * 60 * 1000 // 每小时
        }
      }
      
      return 5 * 60 * 1000 // 默认5分钟
    } catch (error) {
      console.error('解析cron表达式失败:', error)
      return 5 * 60 * 1000
    }
  }

  // 检查并执行到期的任务
  private async checkAndExecuteTasks() {
    try {
      const now = new Date()
      console.log(`[${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}] 检查定时任务...`)

      // 获取所有活跃的定时扫描任务
      const activeTasks = scheduledScans.getActive()
      console.log(`找到 ${activeTasks.length} 个活跃的定时扫描任务`)

      const executedTasks = []

      for (const task of activeTasks) {
        const taskData = task as any
        const nextRun = new Date(taskData.next_run)
        
        // 检查是否到了执行时间（允许检查间隔的误差）
        const timeDiff = now.getTime() - nextRun.getTime()
        const tolerance = Math.min(this.checkInterval, 5 * 60 * 1000) // 最大容忍5分钟误差
        if (timeDiff >= 0 && timeDiff <= tolerance) {
          console.log(`执行定时扫描任务: ${taskData.id} (${taskData.webdav_url})`)
          
          try {
            // 调用定时扫描执行API
            const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
            
            // 在Node.js环境中，我们需要使用不同的方式调用API
            // 这里直接调用数据库操作而不是通过HTTP API
            const { scheduledScans } = await import('./database')
            const { getWebDAVClient, getMediaFiles } = await import('./webdav')
            const { scanCache } = await import('./database')
            
            const client = getWebDAVClient({
              url: taskData.webdav_url,
              username: taskData.webdav_username,
              password: taskData.webdav_password
            })

            const mediaPaths = taskData.media_paths ? JSON.parse(taskData.media_paths) : []
            const scanSettings = taskData.scan_settings ? JSON.parse(taskData.scan_settings) : {}
            
            let totalFiles = 0
            let totalImages = 0
            let totalVideos = 0

            // 扫描所有路径
            for (const path of mediaPaths) {
              console.log(`执行定时扫描: ${path}`)
              
              const files = await getMediaFiles(client, path, {
                maxDepth: scanSettings.maxDepth,
                maxFiles: Math.floor(scanSettings.maxFiles / mediaPaths.length),
                timeout: Math.floor(scanSettings.timeout / mediaPaths.length),
                onProgress: (currentPath, fileCount) => {
                  console.log(`定时扫描 ${path}: ${currentPath} (已找到 ${fileCount} 个文件)`)
                }
              })

              // 统计信息
              const imageCount = files.filter(f => 
                /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename)
              ).length
              
              const videoCount = files.filter(f => 
                /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename)
              ).length

              // 保存到缓存
              const filesData = files.map(file => ({
                filename: file.filename,
                basename: file.basename,
                size: file.size,
                type: file.type,
                lastmod: file.lastmod,
              }))

              scanCache.save({
                webdavUrl: taskData.webdav_url,
                webdavUsername: taskData.webdav_username,
                path,
                filesData: JSON.stringify(filesData),
                totalFiles: files.length,
                imageCount,
                videoCount,
                scanSettings: JSON.stringify(scanSettings)
              })

              totalFiles += files.length
              totalImages += imageCount
              totalVideos += videoCount
            }

            // 更新任务最后运行时间
            scheduledScans.updateLastRun(taskData.id)
            
            console.log(`任务 ${taskData.id} 执行成功: 扫描了 ${mediaPaths.length} 个路径，找到 ${totalFiles} 个文件`)
            executedTasks.push({
              id: taskData.id,
              url: taskData.webdav_url,
              status: 'success',
              result: {
                totalFiles,
                totalImages,
                totalVideos,
                scannedPaths: mediaPaths.length
              }
            })
          } catch (error: any) {
            console.error(`任务 ${taskData.id} 执行异常:`, error.message)
            executedTasks.push({
              id: taskData.id,
              url: taskData.webdav_url,
              status: 'error',
              error: error.message
            })
          }
        } else {
          console.log(`任务 ${taskData.id} 未到执行时间，下次运行: ${nextRun.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`)
        }
      }

      if (executedTasks.length > 0) {
        console.log(`本次执行了 ${executedTasks.length} 个任务`)
      }
    } catch (error: any) {
      console.error('定时任务检查失败:', error)
    }
  }

  // 获取调度器状态
  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalId: this.intervalId !== null,
      checkInterval: this.checkInterval,
      checkIntervalMinutes: Math.round(this.checkInterval / (60 * 1000))
    }
  }
}

// 创建全局调度器实例
const scheduler = new Scheduler()

export default scheduler
