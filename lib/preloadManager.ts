// 预加载管理器
class PreloadManager {
  private cache = new Map<string, {
    blob: Blob
    url: string
    timestamp: number
    filepath: string
  }>()
  
  private queue = new Set<string>()
  private maxCacheSize = 20
  private maxVideoSize = 100 * 1024 * 1024 // 100MB
  private cacheExpireTime = 5 * 60 * 1000 // 5分钟

  // 预加载文件列表
  async preloadFiles(config: any, files: any[], count: number = 20): Promise<{
    successCount: number
    failedCount: number
    message: string
  }> {
    // 筛选符合条件的文件
    const eligibleFiles = files.filter(file => {
      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(file.basename)
      const isVideo = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(file.basename)
      
      if (isImage) return true
      if (isVideo && file.size <= this.maxVideoSize) return true
      return false
    })

    if (eligibleFiles.length === 0) {
      return {
        successCount: 0,
        failedCount: 0,
        message: '未找到符合条件的媒体文件'
      }
    }

    // 清理过期缓存
    this.cleanupExpiredCache()

    // 随机选择文件进行预加载
    const shuffledFiles = [...eligibleFiles].sort(() => Math.random() - 0.5)
    const filesToPreload = shuffledFiles.slice(0, Math.min(count, eligibleFiles.length))

    // 开始预加载
    const preloadPromises = filesToPreload.map(file => this.preloadFile(config, file))
    const results = await Promise.allSettled(preloadPromises)

    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.filter(result => result.status === 'rejected').length

    return {
      successCount,
      failedCount,
      message: `预加载完成：成功 ${successCount} 个，失败 ${failedCount} 个`
    }
  }

  // 预加载单个文件
  private async preloadFile(config: any, file: any): Promise<void> {
    const filepath = file.filename
    
    // 如果已经在缓存中，跳过
    if (this.cache.has(filepath)) {
      return
    }

    // 如果正在预加载队列中，跳过
    if (this.queue.has(filepath)) {
      return
    }

    try {
      this.queue.add(filepath)

      // 获取文件流
      const streamResponse = await fetch('/api/webdav/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          filepath: file.filename,
        }),
      })

      if (!streamResponse.ok) {
        throw new Error('获取文件流失败')
      }

      const blob = await streamResponse.blob()
      const url = URL.createObjectURL(blob)
      
      // 存储到缓存
      this.cache.set(filepath, {
        blob,
        url,
        timestamp: Date.now(),
        filepath
      })

      // 如果缓存超过最大数量，删除最旧的
      if (this.cache.size > this.maxCacheSize) {
        this.evictOldestCache()
      }

      console.log(`预加载完成: ${file.basename}`)

    } catch (error) {
      console.error(`预加载失败 ${file.basename}:`, error)
      throw error
    } finally {
      this.queue.delete(filepath)
    }
  }

  // 获取预加载的文件
  getPreloadedFile(filepath: string): Blob | null {
    const cached = this.cache.get(filepath)
    if (cached) {
      // 更新访问时间
      cached.timestamp = Date.now()
      return cached.blob
    }
    return null
  }

  // 检查文件是否已预加载
  isPreloaded(filepath: string): boolean {
    return this.cache.has(filepath)
  }

  // 清理过期缓存
  private cleanupExpiredCache() {
    const now = Date.now()
    for (const [key, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.cacheExpireTime) {
        URL.revokeObjectURL(cached.url)
        this.cache.delete(key)
      }
    }
  }

  // 删除最旧的缓存
  private evictOldestCache() {
    let oldestKey = ''
    let oldestTime = Date.now()
    
    for (const [key, cached] of this.cache.entries()) {
      if (cached.timestamp < oldestTime) {
        oldestTime = cached.timestamp
        oldestKey = key
      }
    }
    
    if (oldestKey) {
      const oldest = this.cache.get(oldestKey)
      if (oldest) {
        URL.revokeObjectURL(oldest.url)
        this.cache.delete(oldestKey)
      }
    }
  }

  // 清理所有缓存
  clearCache() {
    for (const cached of this.cache.values()) {
      URL.revokeObjectURL(cached.url)
    }
    this.cache.clear()
    this.queue.clear()
  }

  // 获取缓存状态
  getCacheStatus() {
    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.maxCacheSize,
      queueSize: this.queue.size,
      cachedFiles: Array.from(this.cache.keys())
    }
  }

  // 智能预加载 - 根据当前文件预测下一个可能查看的文件
  async smartPreload(config: any, allFiles: any[], currentFile: any, count: number = 10): Promise<void> {
    if (!currentFile) return

    // 获取当前文件所在目录的其他文件
    const currentDir = currentFile.filename.substring(0, currentFile.filename.lastIndexOf('/'))
    const dirFiles = allFiles.filter(file => 
      file.filename.startsWith(currentDir) && file.filename !== currentFile.filename
    )

    // 如果目录内文件不够，从其他目录随机选择
    const remainingCount = count - dirFiles.length
    if (remainingCount > 0) {
      const otherFiles = allFiles.filter(file => !file.filename.startsWith(currentDir))
      const randomFiles = [...otherFiles].sort(() => Math.random() - 0.5).slice(0, remainingCount)
      dirFiles.push(...randomFiles)
    }

    // 预加载这些文件
    await this.preloadFiles(config, dirFiles.slice(0, count), count)
  }
}

// 创建全局预加载管理器实例
export const preloadManager = new PreloadManager()

export default preloadManager
