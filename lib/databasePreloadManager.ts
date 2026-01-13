/**
 * 数据库预加载管理器
 * 
 * 专门用于从 scan_files 数据库表获取文件数据的预加载管理器。
 * 相比内存模式（preloadManager.ts），数据库模式不需要将所有文件加载到内存中，
 * 适合处理大规模文件集合（100M+ 记录）。
 * 
 * 原来的 preloadManager.ts 保留作为"缓存加载模式"的备份。
 */

// 数据库预加载管理器
class DatabasePreloadManager {
  // 当前组缓存：存储当前正在浏览的图组文件
  private cache = new Map<string, {
    blob: Blob
    url: string
    timestamp: number
    filepath: string
    size: number
    lastmod: string
  }>()
  
  // 图组模式专用：下一组预加载缓存
  private nextGroupCache = new Map<string, {
    blob: Blob
    url: string
    timestamp: number
    filepath: string
    size: number
    lastmod: string
  }>()
  
  // 预加载队列：正在预加载的文件路径集合
  private queue = new Set<string>()
  
  // 最大缓存数量
  private maxCacheSize = 10
  
  // 最大视频文件大小（字节）
  private maxVideoSize = 100 * 1024 * 1024 // 100MB
  
  // 缓存过期时间（毫秒）
  private cacheExpireTime = 300 * 60 * 1000 // 300分钟
  
  // 本地已观看文件（当前会话，用于避免重复标记请求）
  private localViewedFiles = new Set<string>()
  
  // 图组模式相关状态
  private currentGroupFiles: any[] = []
  private nextGroupFiles: any[] = []
  private currentGroupPreloadTriggered = false

  // 并发控制
  private activePreloadCount = 0
  private maxConcurrentPreloads = 4
  private pendingPreloadQueue: Array<() => void> = []
  private concurrencyLimitEnabled = true

  // 取消预加载控制
  private abortController: AbortController | null = null
  private preloadCancelled = false

  // 设置缓存大小
  setMaxCacheSize(size: number) {
    this.maxCacheSize = size
  }

  // 设置最大并发预加载数
  setMaxConcurrentPreloads(count: number) {
    this.maxConcurrentPreloads = count
  }

  // 启用/禁用并发限制
  setConcurrencyLimitEnabled(enabled: boolean) {
    this.concurrencyLimitEnabled = enabled
    console.log(`[数据库模式][并发控制] 并发限制${enabled ? '已启用' : '已禁用'}`)
  }

  // 取消所有正在进行的预加载请求
  cancelAllPreloads(): void {
    console.log('[数据库模式] 取消所有预加载请求')
    this.preloadCancelled = true
    
    // 中止当前的 AbortController
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    
    // 清空待处理队列
    this.pendingPreloadQueue = []
    
    // 清空预加载队列
    this.queue.clear()
    
    // 重置活动计数
    this.activePreloadCount = 0
    
    console.log('[数据库模式] 预加载请求已取消')
  }

  // 重置取消状态（在开始新的预加载前调用）
  private resetCancelState(): void {
    this.preloadCancelled = false
    this.abortController = new AbortController()
  }

  // 检查预加载是否已被取消
  private isPreloadCancelled(): boolean {
    return this.preloadCancelled
  }

  // 获取当前的 AbortSignal
  private getAbortSignal(): AbortSignal | undefined {
    return this.abortController?.signal
  }

  // 获取预加载许可
  private async acquirePreloadSlot(): Promise<void> {
    if (!this.concurrencyLimitEnabled) {
      this.activePreloadCount++
      return
    }
    
    if (this.activePreloadCount < this.maxConcurrentPreloads) {
      this.activePreloadCount++
      return
    }
    
    return new Promise(resolve => {
      this.pendingPreloadQueue.push(() => {
        this.activePreloadCount++
        resolve()
      })
    })
  }

  // 释放预加载许可
  private releasePreloadSlot(): void {
    this.activePreloadCount--
    
    if (!this.concurrencyLimitEnabled) {
      return
    }
    
    if (this.pendingPreloadQueue.length > 0) {
      const next = this.pendingPreloadQueue.shift()
      next?.()
    }
  }

  // 获取并发状态
  getConcurrencyStatus() {
    return {
      activeCount: this.activePreloadCount,
      maxConcurrent: this.maxConcurrentPreloads,
      pendingCount: this.pendingPreloadQueue.length,
      limitEnabled: this.concurrencyLimitEnabled
    }
  }

  // 统一的文件过滤方法
  private isFileEligibleForPreload(file: any): boolean {
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(file.basename)
    const isVideo = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(file.basename)
    
    if (isImage) return true
    if (isVideo && file.size <= this.maxVideoSize) return true
    return false
  }

  // 预加载单个文件（带并发控制）
  private async preloadFile(config: any, file: any): Promise<void> {
    const filepath = file.filename
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log(`[数据库模式] 预加载已取消，跳过: ${file.basename}`)
      return
    }
    
    if (this.cache.has(filepath)) return
    if (this.queue.has(filepath)) return

    await this.acquirePreloadSlot()
    
    // 再次检查是否已取消（等待期间可能被取消）
    if (this.isPreloadCancelled()) {
      this.releasePreloadSlot()
      console.log(`[数据库模式] 预加载已取消，跳过: ${file.basename}`)
      return
    }
    
    try {
      if (this.cache.has(filepath)) return
      
      this.queue.add(filepath)

      const streamResponse = await fetch('/api/webdav/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          filepath: file.filename,
        }),
        signal: this.getAbortSignal(),
      })

      // 检查是否已取消
      if (this.isPreloadCancelled()) {
        console.log(`[数据库模式] 预加载已取消，丢弃响应: ${file.basename}`)
        return
      }

      if (!streamResponse.ok) {
        throw new Error('获取文件流失败')
      }

      const blob = await streamResponse.blob()
      
      // 再次检查是否已取消
      if (this.isPreloadCancelled()) {
        console.log(`[数据库模式] 预加载已取消，丢弃blob: ${file.basename}`)
        return
      }
      
      const url = URL.createObjectURL(blob)
      
      this.cache.set(filepath, {
        blob,
        url,
        timestamp: Date.now(),
        filepath,
        size: file.size || 0,
        lastmod: file.lastmod || ''
      })

      if (this.cache.size > this.maxCacheSize) {
        this.evictOldestCache()
      }

      console.log(`[数据库模式] 预加载完成: ${file.basename}`)

    } catch (error: any) {
      // 如果是取消导致的错误，不记录为错误
      if (error.name === 'AbortError' || this.isPreloadCancelled()) {
        console.log(`[数据库模式] 预加载被取消: ${file.basename}`)
        return
      }
      console.error(`[数据库模式] 预加载失败 ${file.basename}:`, error)
      throw error
    } finally {
      this.queue.delete(filepath)
      this.releasePreloadSlot()
    }
  }

  // 预加载文件但不限制缓存大小
  private async preloadFileWithoutLimit(config: any, file: any): Promise<void> {
    const filepath = file.filename
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log(`[数据库模式] 预加载已取消，跳过: ${file.basename}`)
      return
    }
    
    if (this.cache.has(filepath)) return
    if (this.queue.has(filepath)) return
    
    await this.acquirePreloadSlot()
    
    // 再次检查是否已取消
    if (this.isPreloadCancelled()) {
      this.releasePreloadSlot()
      console.log(`[数据库模式] 预加载已取消，跳过: ${file.basename}`)
      return
    }
    
    try {
      if (this.cache.has(filepath)) return
      
      this.queue.add(filepath)
      
      const streamResponse = await fetch('/api/webdav/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          filepath: file.filename,
        }),
        signal: this.getAbortSignal(),
      })
      
      // 检查是否已取消
      if (this.isPreloadCancelled()) {
        console.log(`[数据库模式] 预加载已取消，丢弃响应: ${file.basename}`)
        return
      }
      
      if (!streamResponse.ok) {
        throw new Error('获取文件流失败')
      }
      
      const blob = await streamResponse.blob()
      
      // 再次检查是否已取消
      if (this.isPreloadCancelled()) {
        console.log(`[数据库模式] 预加载已取消，丢弃blob: ${file.basename}`)
        return
      }
      
      const url = URL.createObjectURL(blob)
      
      // 检查文件是否还属于当前图组
      const isFileInCurrentGroup = this.currentGroupFiles.some(f => f.filename === filepath)
      
      if (!isFileInCurrentGroup) {
        URL.revokeObjectURL(url)
        console.log(`[数据库模式] 预加载完成但图组已切换，丢弃文件: ${file.basename}`)
        return
      }
      
      if (this.cache.has(filepath)) {
        URL.revokeObjectURL(url)
        return
      }
      
      this.cache.set(filepath, {
        blob,
        url,
        timestamp: Date.now(),
        filepath,
        size: file.size || 0,
        lastmod: file.lastmod || ''
      })
      
      console.log(`[数据库模式] 预加载完成: ${file.basename}`)
      
    } catch (error: any) {
      // 如果是取消导致的错误，不记录为错误
      if (error.name === 'AbortError' || this.isPreloadCancelled()) {
        console.log(`[数据库模式] 预加载被取消: ${file.basename}`)
        return
      }
      console.error(`[数据库模式] 预加载失败 ${file.basename}:`, error)
      throw error
    } finally {
      this.queue.delete(filepath)
      this.releasePreloadSlot()
    }
  }

  // 预加载文件到下一组缓存
  private async preloadFileToNextGroup(config: any, file: any): Promise<void> {
    const filepath = file.filename
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log(`[数据库模式] 预加载已取消，跳过下一组: ${file.basename}`)
      return
    }
    
    if (this.nextGroupCache.has(filepath)) return
    if (this.queue.has(filepath)) return
    
    await this.acquirePreloadSlot()
    
    // 再次检查是否已取消
    if (this.isPreloadCancelled()) {
      this.releasePreloadSlot()
      console.log(`[数据库模式] 预加载已取消，跳过下一组: ${file.basename}`)
      return
    }
    
    try {
      if (this.nextGroupCache.has(filepath)) return
      
      this.queue.add(filepath)
      
      const streamResponse = await fetch('/api/webdav/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          filepath: file.filename,
        }),
        signal: this.getAbortSignal(),
      })
      
      // 检查是否已取消
      if (this.isPreloadCancelled()) {
        console.log(`[数据库模式] 预加载已取消，丢弃下一组响应: ${file.basename}`)
        return
      }
      
      if (!streamResponse.ok) {
        throw new Error('获取文件流失败')
      }
      
      const blob = await streamResponse.blob()
      
      // 再次检查是否已取消
      if (this.isPreloadCancelled()) {
        console.log(`[数据库模式] 预加载已取消，丢弃下一组blob: ${file.basename}`)
        return
      }
      
      const url = URL.createObjectURL(blob)
      
      this.nextGroupCache.set(filepath, {
        blob,
        url,
        timestamp: Date.now(),
        filepath,
        size: file.size || 0,
        lastmod: file.lastmod || ''
      })
      
      if (this.nextGroupCache.size > this.maxCacheSize) {
        this.evictOldestNextGroupCache()
      }
      
      console.log(`[数据库模式] 下一组预加载完成: ${file.basename}`)
    } catch (error: any) {
      // 如果是取消导致的错误，不记录为错误
      if (error.name === 'AbortError' || this.isPreloadCancelled()) {
        console.log(`[数据库模式] 下一组预加载被取消: ${file.basename}`)
        return
      }
      console.error(`[数据库模式] 下一组预加载失败 ${file.basename}:`, error)
      throw error
    } finally {
      this.queue.delete(filepath)
      this.releasePreloadSlot()
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

  // 删除最旧的下一组缓存
  private evictOldestNextGroupCache() {
    let oldestKey = ''
    let oldestTime = Date.now()
    
    for (const [key, cached] of this.nextGroupCache.entries()) {
      if (cached.timestamp < oldestTime) {
        oldestTime = cached.timestamp
        oldestKey = key
      }
    }
    
    if (oldestKey) {
      const oldest = this.nextGroupCache.get(oldestKey)
      if (oldest) {
        URL.revokeObjectURL(oldest.url)
        this.nextGroupCache.delete(oldestKey)
      }
    }
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

  // ========== 公共方法 ==========

  // 获取预加载的文件
  getPreloadedFile(filepath: string): Blob | null {
    const cached = this.cache.get(filepath)
    if (cached) {
      cached.timestamp = Date.now()
      return cached.blob
    }
    return null
  }
  
  // 从下一组缓存获取文件
  getNextGroupFile(filepath: string): Blob | null {
    const cached = this.nextGroupCache.get(filepath)
    if (cached) {
      cached.timestamp = Date.now()
      return cached.blob
    }
    return null
  }

  // 检查文件是否已预加载
  isPreloaded(filepath: string): boolean {
    return this.cache.has(filepath)
  }

  // 检查文件是否正在预加载中
  isPreloading(filepath: string): boolean {
    return this.queue.has(filepath)
  }

  // 等待文件预加载完成
  async waitForPreload(filepath: string, maxWaitTime: number = 10000): Promise<Blob | null> {
    if (!this.queue.has(filepath)) {
      return this.getPreloadedFile(filepath)
    }
    
    const startTime = Date.now()
    while (this.queue.has(filepath)) {
      if (Date.now() - startTime > maxWaitTime) {
        console.warn(`[数据库模式] 等待预加载超时: ${filepath}`)
        return null
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    return this.getPreloadedFile(filepath)
  }

  // 清理所有缓存
  clearCache() {
    for (const cached of this.cache.values()) {
      URL.revokeObjectURL(cached.url)
    }
    this.cache.clear()
    this.queue.clear()
  }

  // 清理下一组缓存
  clearNextGroupCache() {
    for (const cached of this.nextGroupCache.values()) {
      URL.revokeObjectURL(cached.url)
    }
    this.nextGroupCache.clear()
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

  // 获取所有缓存的文件路径
  getCachedFilepaths(): string[] {
    return Array.from(this.cache.keys())
  }

  // 获取所有缓存的文件信息（包含元数据）
  getCachedFiles(): Array<{ filename: string, basename: string, size: number, lastmod: string }> {
    return Array.from(this.cache.entries()).map(([filepath, cached]) => ({
      filename: filepath,
      basename: filepath.substring(filepath.lastIndexOf('/') + 1),
      size: cached.size,
      lastmod: cached.lastmod
    }))
  }

  // 从缓存中随机获取文件
  getRandomCachedFile(): string | null {
    const cachedPaths = this.getCachedFilepaths()
    if (cachedPaths.length === 0) return null
    
    const randomIndex = Math.floor(Math.random() * cachedPaths.length)
    return cachedPaths[randomIndex]
  }

  // 标记文件为已观看
  // 优化：使用 localViewedFiles 避免重复请求，不再维护全量 viewedFiles
  async markAsViewed(filepath: string): Promise<void> {
    // 使用本地会话缓存避免重复请求
    if (this.localViewedFiles.has(filepath)) {
      return
    }
    
    this.localViewedFiles.add(filepath)
    
    try {
      const response = await fetch('/api/ratings/viewed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: filepath,
          isViewed: true
        })
      })
      
      if (!response.ok) {
        console.error('[数据库模式] 更新数据库已看过状态失败:', filepath)
      }
    } catch (error) {
      console.error('[数据库模式] 更新数据库已看过状态失败:', error)
    }
  }

  // 检查文件是否已观看（当前会话）
  isViewed(filepath: string): boolean {
    return this.localViewedFiles.has(filepath)
  }

  // 从缓存中移除文件
  removeFromCache(filepath: string) {
    const cached = this.cache.get(filepath)
    if (cached) {
      URL.revokeObjectURL(cached.url)
      this.cache.delete(filepath)
    }
  }

  // 直接添加文件到缓存
  addToCacheDirectly(filepath: string, blob: Blob, size: number = 0, lastmod: string = ''): void {
    if (this.cache.has(filepath)) return

    const url = URL.createObjectURL(blob)
    
    this.cache.set(filepath, {
      blob,
      url,
      timestamp: Date.now(),
      filepath,
      size,
      lastmod
    })
  }

  // 本地已看过文件管理
  addLocalViewedFile(filepath: string) {
    this.localViewedFiles.add(filepath)
  }

  isLocalViewed(filepath: string): boolean {
    return this.localViewedFiles.has(filepath)
  }  
  clearLocalViewedFiles() {
    this.localViewedFiles.clear()
  }

  getLocalViewedCount(): number {
    return this.localViewedFiles.size
  }

  // 获取本地已看过的文件名列表
  getLocalViewedFilenames(): Set<string> {
    return new Set(this.localViewedFiles)
  }

  // 获取当前图组信息
  getCurrentGroup(): any[] {
    return [...this.currentGroupFiles]
  }
  
  // 获取下一组信息
  getNextGroup(): any[] {
    return [...this.nextGroupFiles]
  }
  
  // 检查是否有下一组缓存
  hasNextGroupCache(): boolean {
    return this.nextGroupCache.size > 0 && this.nextGroupFiles.length > 0
  }
  
  // 检查是否有当前图组缓存
  hasCurrentGroupCache(): boolean {
    return this.currentGroupFiles.length > 0 && this.cache.size > 0
  }
  
  // 检查是否应该预加载剩余文件
  isBrowseHalfway(currentIndex: number): boolean {
    if (this.currentGroupFiles.length === 0) return false
    
    if (this.currentGroupFiles.length <= this.maxCacheSize) {
      return false
    }
    
    return currentIndex >= Math.floor(this.maxCacheSize / 2)
  }

  // 切换到下一组
  switchToNextGroup(): void {
    console.log('[数据库模式] 切换到下一组图组')
    
    this.clearCache()
    
    for (const [key, cached] of this.nextGroupCache.entries()) {
      this.cache.set(key, cached)
    }
    
    this.nextGroupCache.clear()
    
    this.currentGroupFiles = [...this.nextGroupFiles]
    this.nextGroupFiles = []
    this.currentGroupPreloadTriggered = false
    
    console.log('[数据库模式] 切换完成，当前缓存大小:', this.cache.size)
  }


  // ========== 数据库模式核心方法 ==========

  // 从数据库随机获取文件并预加载（随机模式）
  async preloadFromDatabase(
    config: any,
    count: number = 10,
    viewedFilter: string = 'unviewed',
    onProgress?: (current: number, total: number) => void
  ): Promise<{
    successCount: number
    failedCount: number
    message: string
  }> {
    console.log(`[数据库模式] 随机预加载开始，目标数量: ${count}，筛选条件: ${viewedFilter}`)
    
    // 重置取消状态
    this.resetCancelState()
    
    this.setConcurrencyLimitEnabled(false)
    this.setMaxCacheSize(count)
    this.clearCache()
    
    // 优化：移除重复的 loadViewedFilesFromDatabase 调用
    // 已看过文件列表由前端 loadViewedFiles 统一加载，SQL 层面通过 isViewed 参数过滤
    
    if (onProgress) {
      onProgress(0, count)
    }
    
    try {
      const cachedPaths = this.getCachedFilepaths()
      
      // 使用 POST 请求避免 URL 过长导致 431 错误
      const response = await fetch('/api/scan-files/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdavUrl: config.url,
          webdavUsername: config.username,
          paths: config.mediaPaths,
          count: count,
          isViewed: viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined,
          excludeFilenames: cachedPaths.length > 0 ? cachedPaths : undefined
        })
      })
      if (!response.ok) {
        throw new Error('从数据库获取文件失败')
      }
      
      const data = await response.json()
      
      if (!data.hasData) {
        this.setConcurrencyLimitEnabled(true)
        return {
          successCount: 0,
          failedCount: 0,
          message: data.message || '数据尚未迁移'
        }
      }
      
      const files = data.files || []
      if (files.length === 0) {
        this.setConcurrencyLimitEnabled(true)
        return {
          successCount: 0,
          failedCount: 0,
          message: '未找到符合条件的文件'
        }
      }
      
      const filesToPreload = files.map((f: any) => ({
        filename: f.filename,
        basename: f.basename,
        size: f.file_size || 0,
        type: f.file_type,
        lastmod: f.lastmod || ''
      }))
      
      let completedCount = 0
      const preloadPromises = filesToPreload.map((file: any) =>
        this.preloadFileWithoutLimit(config, file)
          .then(() => {
            completedCount++
            if (onProgress) {
              onProgress(completedCount, count)
            }
          })
          .catch((error) => {
            completedCount++
            console.error(`[数据库模式] 预加载文件失败: ${file.filename}`, error)
            if (onProgress) {
              onProgress(completedCount, count)
            }
            throw error
          })
      )
      
      const results = await Promise.allSettled(preloadPromises)
      
      this.setConcurrencyLimitEnabled(true)
      
      const successCount = results.filter(r => r.status === 'fulfilled').length
      const failedCount = results.filter(r => r.status === 'rejected').length
      
      return {
        successCount,
        failedCount,
        message: `数据库预加载完成：成功 ${successCount} 个，失败 ${failedCount} 个`
      }
      
    } catch (error: any) {
      this.setConcurrencyLimitEnabled(true)
      console.error('[数据库模式] 预加载失败:', error)
      return {
        successCount: 0,
        failedCount: 0,
        message: `预加载失败: ${error.message}`
      }
    }
  }

  // 从数据库获取随机图组并预加载（图组模式）
  async preloadGroupFromDatabase(
    config: any,
    count: number = 10,
    viewedFilter: string = 'unviewed',
    excludeParentPath?: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<{
    successCount: number
    failedCount: number
    message: string
    parentPath: string | null
    totalFiles: number
  }> {
    console.log(`[数据库模式] 图组预加载开始，目标数量: ${count}，筛选条件: ${viewedFilter}`)
    
    // 重置取消状态
    this.resetCancelState()
    
    this.setConcurrencyLimitEnabled(false)
    this.setMaxCacheSize(count)
    this.clearCache()
    
    // 优化：移除重复的 loadViewedFilesFromDatabase 调用
    // 已看过文件列表由前端 loadViewedFiles 统一加载，SQL 层面通过 isViewed 参数过滤
    
    if (onProgress) {
      onProgress(0, count)
    }
    
    try {
      const params = new URLSearchParams({
        webdavUrl: config.url,
        webdavUsername: config.username,
        paths: config.mediaPaths.join(',')
      })
      
      if (viewedFilter === 'viewed') {
        params.set('isViewed', 'true')
      } else if (viewedFilter === 'unviewed') {
        params.set('isViewed', 'false')
      }
      
      if (excludeParentPath) {
        params.set('excludeParentPath', excludeParentPath)
      }
      
      const response = await fetch(`/api/scan-files/random-group?${params.toString()}`)
      if (!response.ok) {
        throw new Error('从数据库获取图组失败')
      }
      
      const data = await response.json()
      
      if (!data.hasData) {
        this.setConcurrencyLimitEnabled(true)
        return {
          successCount: 0,
          failedCount: 0,
          message: data.message || '数据尚未迁移',
          parentPath: null,
          totalFiles: 0
        }
      }
      
      const files = data.files || []
      if (files.length === 0) {
        this.setConcurrencyLimitEnabled(true)
        return {
          successCount: 0,
          failedCount: 0,
          message: '未找到符合条件的图组',
          parentPath: null,
          totalFiles: 0
        }
      }
      
      this.currentGroupFiles = files.map((f: any) => ({
        filename: f.filename,
        basename: f.basename,
        size: f.file_size || 0,
        type: f.file_type,
        lastmod: f.lastmod || ''
      }))
      this.currentGroupPreloadTriggered = false
      
      const filesToPreload = this.currentGroupFiles.slice(0, Math.min(count, files.length))
      
      console.log(`[数据库模式] 选择图组 ${data.parentPath}，共 ${files.length} 个文件，预加载前 ${filesToPreload.length} 个`)
      
      let completedCount = 0
      const preloadPromises = filesToPreload.map((file: any) =>
        this.preloadFileWithoutLimit(config, file)
          .then(() => {
            completedCount++
            if (onProgress) {
              onProgress(completedCount, Math.min(count, files.length))
            }
          })
          .catch((error) => {
            completedCount++
            console.error(`[数据库模式] 预加载文件失败: ${file.filename}`, error)
            if (onProgress) {
              onProgress(completedCount, Math.min(count, files.length))
            }
            throw error
          })
      )
      
      const results = await Promise.allSettled(preloadPromises)
      
      this.setConcurrencyLimitEnabled(true)
      
      const successCount = results.filter(r => r.status === 'fulfilled').length
      const failedCount = results.filter(r => r.status === 'rejected').length
      
      return {
        successCount,
        failedCount,
        message: `图组预加载完成：成功 ${successCount} 个，失败 ${failedCount} 个`,
        parentPath: data.parentPath,
        totalFiles: files.length
      }
      
    } catch (error: any) {
      this.setConcurrencyLimitEnabled(true)
      console.error('[数据库模式] 图组预加载失败:', error)
      return {
        successCount: 0,
        failedCount: 0,
        message: `预加载失败: ${error.message}`,
        parentPath: null,
        totalFiles: 0
      }
    }
  }

  // 从数据库预加载下一个图组（后台任务）
  async preloadNextGroupFromDatabase(
    config: any,
    count: number = 10,
    viewedFilter: string = 'unviewed'
  ): Promise<void> {
    console.log(`[数据库模式] 开始后台预加载下一组图组...`)
    
    // 检查是否已取消（不重置状态，因为这是后台任务）
    if (this.isPreloadCancelled()) {
      console.log('[数据库模式] 预加载已取消，跳过下一组图组预加载')
      return
    }
    
    try {
      const currentParentPath = this.currentGroupFiles.length > 0
        ? this.currentGroupFiles[0].filename.substring(0, this.currentGroupFiles[0].filename.lastIndexOf('/'))
        : ''
      
      const params = new URLSearchParams({
        webdavUrl: config.url,
        webdavUsername: config.username,
        paths: config.mediaPaths.join(',')
      })
      
      if (viewedFilter === 'viewed') {
        params.set('isViewed', 'true')
      } else if (viewedFilter === 'unviewed') {
        params.set('isViewed', 'false')
      }
      
      if (currentParentPath) {
        params.set('excludeParentPath', currentParentPath)
      }
      
      const response = await fetch(`/api/scan-files/random-group?${params.toString()}`)
      if (!response.ok) {
        throw new Error('从数据库获取下一图组失败')
      }
      
      const data = await response.json()
      
      if (!data.hasData || data.files.length === 0) {
        console.log('[数据库模式] 没有可用的下一图组')
        return
      }
      
      this.nextGroupFiles = data.files.map((f: any) => ({
        filename: f.filename,
        basename: f.basename,
        size: f.file_size || 0,
        type: f.file_type,
        lastmod: f.lastmod || ''
      }))
      
      const filesToPreload = this.nextGroupFiles.slice(0, Math.min(count, data.files.length))
      
      console.log(`[数据库模式] 下一组预加载：图组 ${data.parentPath}，共 ${data.files.length} 个文件，预加载前 ${filesToPreload.length} 个`)
      
      const preloadPromises = filesToPreload.map((file: any) => this.preloadFileToNextGroup(config, file))
      await Promise.allSettled(preloadPromises)
      
      console.log(`[数据库模式] 下一组预加载完成`)
      
    } catch (error) {
      console.error('[数据库模式] 预加载下一组失败:', error)
    }
  }

  // 从数据库补充缓存（智能预加载，支持随机性控制）
  async refillCacheFromDatabase(
    config: any,
    targetCount: number = 10,
    viewedFilter: string = 'unviewed',
    onProgress?: (current: number, total: number) => void,
    isInitialLoad: boolean = false,
    currentParentPath?: string,  // 当前目录路径
    randomness: number = 1,      // 随机性：0=优先当前目录，1=完全随机
    mediaFilter: string = 'all'  // 媒体类型筛选：all/images/videos
  ): Promise<void> {
    // 初始加载时重置取消状态
    if (isInitialLoad) {
      this.resetCancelState()
      this.setConcurrencyLimitEnabled(false)
    }
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log('[数据库模式] 预加载已取消，跳过缓存补齐')
      return
    }
    
    this.setMaxCacheSize(targetCount)
    
    const currentCacheSize = this.cache.size
    if (currentCacheSize >= targetCount) {
      console.log('[数据库模式] 缓存已满，无需补齐')
      if (onProgress) {
        onProgress(currentCacheSize, targetCount)
      }
      // 恢复并发限制
      if (isInitialLoad) {
        this.setConcurrencyLimitEnabled(true)
      }
      return
    }
    
    const needCount = targetCount - currentCacheSize
    console.log(`[数据库模式] 缓存不足，需要补齐 ${needCount} 个文件，随机性: ${randomness}，媒体类型: ${mediaFilter}`)
    
    if (onProgress) {
      onProgress(currentCacheSize, targetCount)
    }
    
    try {
      const cachedPaths = this.getCachedFilepaths()
      
      // 使用 POST 请求避免 URL 过长导致 431 错误
      const response = await fetch('/api/scan-files/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdavUrl: config.url,
          webdavUsername: config.username,
          paths: config.mediaPaths,
          count: needCount,
          randomness: randomness,
          isViewed: viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined,
          fileType: mediaFilter === 'images' ? 'image' : mediaFilter === 'videos' ? 'video' : undefined,
          currentParentPath: currentParentPath || undefined,
          excludeFilenames: cachedPaths.length > 0 ? cachedPaths : undefined
        })
      })
      if (!response.ok) {
        throw new Error('从数据库获取文件失败')
      }
      
      const data = await response.json()
      
      if (!data.hasData || data.files.length === 0) {
        console.log('[数据库模式] 没有可用的文件进行补齐')
        // 恢复并发限制
        if (isInitialLoad) {
          this.setConcurrencyLimitEnabled(true)
        }
        return
      }
      
      const filesToPreload = data.files.map((f: any) => ({
        filename: f.filename,
        basename: f.basename,
        size: f.file_size || 0,
        type: f.file_type,
        lastmod: f.lastmod || ''
      }))
      
      const preloadPromises = filesToPreload.map((file: any) =>
        this.preloadFile(config, file)
          .then(() => {
            if (onProgress) {
              onProgress(this.cache.size, targetCount)
            }
          })
          .catch((error) => {
            console.error(`[数据库模式] 预加载文件失败: ${file.filename}`, error)
            if (onProgress) {
              onProgress(this.cache.size, targetCount)
            }
          })
      )
      
      await Promise.allSettled(preloadPromises)
      
      // 恢复并发限制
      if (isInitialLoad) {
        this.setConcurrencyLimitEnabled(true)
      }
    } catch (error) {
      console.error('[数据库模式] 补充缓存失败:', error)
      // 恢复并发限制
      if (isInitialLoad) {
        this.setConcurrencyLimitEnabled(true)
      }
    }
  }

  // 从数据库获取随机大视频文件（大视频模式）
  async getRandomLargeVideoFromDatabase(
    config: any,
    viewedFilter: string = 'unviewed',
    minFileSize: number = 100 * 1024 * 1024,
    excludeFilenames: string[] = []
  ): Promise<{
    file: any | null
    hasData: boolean
    message: string
  }> {
    try {
      // 使用 POST 请求避免 URL 过长导致 431 错误
      const response = await fetch('/api/scan-files/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdavUrl: config.url,
          webdavUsername: config.username,
          paths: config.mediaPaths,
          count: 1,
          fileType: 'video',
          minFileSize: minFileSize,
          isViewed: viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined,
          excludeFilenames: excludeFilenames.length > 0 ? excludeFilenames : undefined
        })
      })
      if (!response.ok) {
        throw new Error('从数据库获取大视频失败')
      }
      
      const data = await response.json()
      
      if (!data.hasData) {
        return {
          file: null,
          hasData: false,
          message: data.message || '数据尚未迁移'
        }
      }
      
      if (data.files.length === 0) {
        return {
          file: null,
          hasData: true,
          message: '未找到符合条件的大视频文件'
        }
      }
      
      const file = {
        filename: data.files[0].filename,
        basename: data.files[0].basename,
        size: data.files[0].file_size || 0,
        type: 'file',
        lastmod: data.files[0].lastmod || ''
      }
      
      return {
        file,
        hasData: true,
        message: '获取成功'
      }
      
    } catch (error: any) {
      console.error('[数据库模式] 从数据库获取大视频失败:', error)
      return {
        file: null,
        hasData: false,
        message: `获取失败: ${error.message}`
      }
    }
  }

  // 预加载当前图组剩余的所有文件
  async preloadRemainingCurrentGroup(config: any, onProgress?: (current: number) => void): Promise<void> {
    if (this.currentGroupFiles.length === 0) {
      console.log('[数据库模式] 没有当前图组，跳过剩余文件预加载')
      return
    }
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log('[数据库模式] 预加载已取消，跳过剩余文件预加载')
      return
    }
    
    if (this.currentGroupPreloadTriggered) {
      console.log('[数据库模式] 当前图组已经触发过预加载，跳过')
      return
    }
    
    const cachedPaths = this.getCachedFilepaths()
    const remainingFiles = this.currentGroupFiles.filter(file => !cachedPaths.includes(file.filename))
    
    if (remainingFiles.length === 0) {
      console.log('[数据库模式] 当前图组所有文件已缓存')
      this.currentGroupPreloadTriggered = true
      return
    }
    
    this.currentGroupPreloadTriggered = true
    
    console.log(`[数据库模式] 开始预加载当前图组剩余 ${remainingFiles.length} 个文件`)
    
    const maxConcurrent = 3
    let currentIndex = 0
    
    const currentGroupFilepaths = new Set(this.currentGroupFiles.map(f => f.filename))
    
    while (currentIndex < remainingFiles.length) {
      // 检查是否已取消
      if (this.isPreloadCancelled()) {
        console.log('[数据库模式] 预加载已取消，停止剩余文件预加载')
        break
      }
      
      const firstFileInBatch = remainingFiles[currentIndex]
      if (!currentGroupFilepaths.has(firstFileInBatch.filename)) {
        console.log('[数据库模式] 检测到图组已切换，停止预加载上一图组的剩余文件')
        break
      }
      
      const batch = remainingFiles.slice(currentIndex, currentIndex + maxConcurrent)
      
      const batchPromises = batch.map((file) => 
        this.preloadFileWithoutLimit(config, file).then(() => {
          if (onProgress) {
            onProgress(this.cache.size)
          }
        }).catch(error => {
          console.error(`[数据库模式] 预加载文件失败: ${file.filename}`, error)
          if (onProgress) {
            onProgress(this.cache.size)
          }
        })
      )
      
      await Promise.allSettled(batchPromises)
      currentIndex += maxConcurrent
    }
    
    console.log('[数据库模式] 当前图组剩余文件预加载完成')
  }

  // ========== 兼容方法（用于替代 preloadManager） ==========
  
  // 兼容 preloadManager.preloadFiles - 从数据库随机获取文件并预加载
  async preloadFiles(
    config: any, 
    _files: any[], // 忽略，数据库模式不需要文件列表
    count: number = 10, 
    viewedFilter: string = 'unviewed',
    _skipLoadViewedFiles: boolean = false
  ): Promise<{
    successCount: number
    failedCount: number
    message: string
  }> {
    return this.preloadFromDatabase(config, count, viewedFilter)
  }

  // 兼容 preloadManager.preloadForGalleryMode - 从数据库获取随机图组并预加载
  async preloadForGalleryMode(
    config: any,
    _allFiles: any[], // 忽略，数据库模式不需要文件列表
    count: number = 10,
    viewedFilter: string = 'unviewed',
    onProgress?: (current: number, total: number) => void
  ): Promise<{
    successCount: number
    failedCount: number
    message: string
  }> {
    const result = await this.preloadGroupFromDatabase(config, count, viewedFilter, undefined, onProgress)
    return {
      successCount: result.successCount,
      failedCount: result.failedCount,
      message: result.message
    }
  }

  // 兼容 preloadManager.refillCache - 从数据库补充缓存
  async refillCache(
    config: any,
    _allFiles: any[], // 忽略，数据库模式不需要文件列表
    targetCount: number = 10,
    viewedFilter: string = 'unviewed',
    onProgress?: (current: number, total: number) => void,
    randomness: number = 1, // 随机性：0=优先当前目录，1=完全随机
    isInitialLoad: boolean = false,
    currentParentPath?: string, // 当前目录路径（用于随机性控制）
    mediaFilter: string = 'all' // 媒体类型筛选：all/images/videos
  ): Promise<void> {
    return this.refillCacheFromDatabase(config, targetCount, viewedFilter, onProgress, isInitialLoad, currentParentPath, randomness, mediaFilter)
  }

  // 兼容 preloadManager.preloadNextGroup - 从数据库预加载下一个图组
  async preloadNextGroup(
    config: any,
    _allFiles: any[], // 忽略，数据库模式不需要文件列表
    count: number = 10,
    viewedFilter: string = 'unviewed'
  ): Promise<void> {
    return this.preloadNextGroupFromDatabase(config, count, viewedFilter)
  }

  // 兼容 preloadManager.smartPreload - 智能预加载（每次只预加载1个文件）
  async smartPreload(
    config: any,
    _allFiles: any[], // 忽略，数据库模式不需要文件列表
    currentFile: any, // 用于提取当前目录路径
    maxCount: number = 10,
    viewedFilter: string = 'unviewed',
    randomness: number = 1, // 随机性：0=优先当前目录，1=完全随机
    mediaFilter: string = 'all' // 媒体类型筛选：all/images/videos
  ): Promise<void> {
    if (!currentFile) return
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log('[数据库模式] 预加载已取消，跳过智能预加载')
      return
    }
    
    // 更新最大缓存大小
    this.setMaxCacheSize(maxCount)
    
    // 检查缓存是否已满
    const currentCacheSize = this.cache.size
    if (currentCacheSize >= maxCount) {
      console.log('[数据库模式] 缓存已满，无需智能预加载')
      return
    }
    
    // 每次只预加载1个文件，避免并发调用时重复计算
    const needCount = 1
    console.log(`[数据库模式] 智能预加载：当前缓存 ${currentCacheSize} 个，预加载 ${needCount} 个，筛选条件: ${viewedFilter}，随机性: ${randomness}，媒体类型: ${mediaFilter}`)
    
    // 从当前文件提取父目录路径
    const currentParentPath = currentFile?.filename 
      ? currentFile.filename.substring(0, currentFile.filename.lastIndexOf('/'))
      : undefined
    
    try {
      // 排除当前文件和已缓存的文件
      const cachedPaths = this.getCachedFilepaths()
      const excludeList = [...cachedPaths]
      if (currentFile?.filename && !excludeList.includes(currentFile.filename)) {
        excludeList.push(currentFile.filename)
      }
      
      // 使用 POST 请求避免 URL 过长导致 431 错误
      const response = await fetch('/api/scan-files/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdavUrl: config.url,
          webdavUsername: config.username,
          paths: config.mediaPaths,
          count: needCount,
          randomness: randomness,
          isViewed: viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined,
          fileType: mediaFilter === 'images' ? 'image' : mediaFilter === 'videos' ? 'video' : undefined,
          currentParentPath: currentParentPath || undefined,
          excludeFilenames: excludeList.length > 0 ? excludeList : undefined
        })
      })
      if (!response.ok) {
        throw new Error('从数据库获取文件失败')
      }
      
      const data = await response.json()
      
      if (!data.hasData || data.files.length === 0) {
        console.log('[数据库模式] 没有可用的文件进行智能预加载')
        return
      }
      
      const fileToPreload = {
        filename: data.files[0].filename,
        basename: data.files[0].basename,
        size: data.files[0].file_size || 0,
        type: data.files[0].file_type,
        lastmod: data.files[0].lastmod || ''
      }
      
      // 预加载单个文件
      await this.preloadFile(config, fileToPreload)
      console.log(`[数据库模式] 智能预加载完成: ${fileToPreload.basename}`)
      
    } catch (error) {
      console.error('[数据库模式] 智能预加载失败:', error)
    }
  }
}

// 创建全局数据库预加载管理器实例
export const databasePreloadManager = new DatabasePreloadManager()

export default databasePreloadManager
