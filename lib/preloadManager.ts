// 预加载管理器
class PreloadManager {
  private cache = new Map<string, {
    blob: Blob
    url: string
    timestamp: number
    filepath: string
  }>()
  
  // 图组模式专用：下一组预加载缓存（独立缓存，不占用当前组缓存）
  private nextGroupCache = new Map<string, {
    blob: Blob
    url: string
    timestamp: number
    filepath: string
  }>()
  
  private queue = new Set<string>()
  private maxCacheSize = 10
  private maxVideoSize = 100 * 1024 * 1024 // 100MB
  private cacheExpireTime = 5 * 60 * 1000 // 5分钟
  private viewedFiles = new Set<string>() // 已观看的文件路径（缓存）
  private localViewedFiles = new Set<string>() // 本地已观看的文件路径（用于已看过模式）
  
  // 图组模式相关状态
  private currentGroupFiles: any[] = [] // 当前图组的所有文件
  private nextGroupFiles: any[] = [] // 下一组预加载的文件列表
  private currentGroupPreloadTriggered = false // 当前图组是否已经触发过剩余文件预加载

  // 设置缓存大小
  setMaxCacheSize(size: number) {
    this.maxCacheSize = size
  }

  // 预加载文件列表
  async preloadFiles(config: any, files: any[], count: number = 10, viewedFilter: string = 'unviewed'): Promise<{
    successCount: number
    failedCount: number
    message: string
  }> {
    // 从数据库获取已看过的文件列表
    await this.loadViewedFilesFromDatabase()
    
    // 筛选符合条件的文件（根据viewedFilter参数决定是否包含已观看的文件）
    const eligibleFiles = files.filter(file => {
      // 根据筛选条件决定是否包含已观看的文件
      if (viewedFilter === 'viewed') {
        // 只选择已看过的文件
        if (!this.viewedFiles.has(file.filename)) {
          return false
        }
      } else if (viewedFilter === 'unviewed') {
        // 只选择未看过的文件
        if (this.viewedFiles.has(file.filename)) {
          return false
        }
      }
      // viewedFilter === 'all' 时不进行已看过状态筛选
      
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
    // 从当前组缓存获取
    const cached = this.cache.get(filepath)
    if (cached) {
      // 更新访问时间
      cached.timestamp = Date.now()
      return cached.blob
    }
    
    return null
  }
  
  // 从下一组缓存获取文件（专门用于图组切换时）
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

  // 等待文件预加载完成（如果正在预加载）
  async waitForPreload(filepath: string, maxWaitTime: number = 10000): Promise<Blob | null> {
    if (!this.queue.has(filepath)) {
      // 如果不在队列中，直接返回当前缓存（如果存在）
      return this.getPreloadedFile(filepath)
    }
    
    // 等待文件完成预加载
    const startTime = Date.now()
    while (this.queue.has(filepath)) {
      // 检查是否超时
      if (Date.now() - startTime > maxWaitTime) {
        console.warn(`等待预加载超时: ${filepath}`)
        return null
      }
      // 等待一小段时间后重试
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // 预加载完成，返回缓存中的文件
    return this.getPreloadedFile(filepath)
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

  // 从缓存中随机获取文件
  getRandomCachedFile(): string | null {
    const cachedPaths = this.getCachedFilepaths()
    if (cachedPaths.length === 0) return null
    
    const randomIndex = Math.floor(Math.random() * cachedPaths.length)
    return cachedPaths[randomIndex]
  }

  // 从数据库加载已看过的文件列表
  private async loadViewedFilesFromDatabase(): Promise<void> {
    try {
      const response = await fetch('/api/ratings/viewed?viewed=true')
      if (response.ok) {
        const data = await response.json()
        this.viewedFiles.clear()
        data.filePaths.forEach((filePath: string) => {
          this.viewedFiles.add(filePath)
        })
        console.log(`从数据库加载已看过文件: ${data.count} 个`)
      }
    } catch (error) {
      console.error('从数据库加载已看过文件失败:', error)
    }
  }

  // 标记文件为已观看
  async markAsViewed(filepath: string): Promise<void> {
    // 更新内存缓存
    this.viewedFiles.add(filepath)
    
    // 更新数据库
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
        console.error('更新数据库已看过状态失败:', filepath)
      }
    } catch (error) {
      console.error('更新数据库已看过状态失败:', error)
    }
  }

  // 检查文件是否已观看
  isViewed(filepath: string): boolean {
    return this.viewedFiles.has(filepath)
  }

  // 从缓存中移除文件
  removeFromCache(filepath: string) {
    const cached = this.cache.get(filepath)
    if (cached) {
      URL.revokeObjectURL(cached.url)
      this.cache.delete(filepath)
      console.log(`从缓存中移除: ${filepath}`)
    }
  }

  // 清除已观看记录
  clearViewedFiles() {
    this.viewedFiles.clear()
  }

  // 直接添加文件到缓存（用于已经加载的文件）
  addToCacheDirectly(filepath: string, blob: Blob): void {
    // 如果已经在缓存中，跳过
    if (this.cache.has(filepath)) {
      return
    }

    const url = URL.createObjectURL(blob)
    
    // 存储到缓存
    this.cache.set(filepath, {
      blob,
      url,
      timestamp: Date.now(),
      filepath
    })

    console.log(`直接添加到缓存: ${filepath}`)
  }

  // 本地已看过文件管理（用于已看过模式）
  addLocalViewedFile(filepath: string) {
    this.localViewedFiles.add(filepath)
  }

  // 检查文件是否在本地已看过
  isLocalViewed(filepath: string): boolean {
    return this.localViewedFiles.has(filepath)
  }

  // 清除本地已看过记录
  clearLocalViewedFiles() {
    this.localViewedFiles.clear()
  }

  // 获取本地已看过的文件数量
  getLocalViewedCount(): number {
    return this.localViewedFiles.size
  }

  // 智能预加载 - 根据当前文件预测下一个可能查看的文件
  async smartPreload(config: any, allFiles: any[], currentFile: any, maxCount: number = 10, viewedFilter: string = 'unviewed'): Promise<void> {
    if (!currentFile) return

    // 从数据库获取已看过的文件列表
    await this.loadViewedFilesFromDatabase()

    // 计算需要预加载的文件数量（考虑当前缓存状态）
    const currentCacheSize = this.cache.size
    const needCount = Math.max(0, maxCount - currentCacheSize)
    
    if (needCount <= 0) {
      console.log('缓存已满，无需智能预加载')
      return
    }

    console.log(`智能预加载：当前缓存 ${currentCacheSize} 个，需要补齐 ${needCount} 个，筛选条件: ${viewedFilter}`)

    // 根据筛选条件过滤文件
    const filteredFiles = allFiles.filter(file => {
      if (viewedFilter === 'viewed') {
        return this.viewedFiles.has(file.filename)
      } else if (viewedFilter === 'unviewed') {
        return !this.viewedFiles.has(file.filename)
      }
      return true // viewedFilter === 'all'
    })

    // 获取当前文件所在目录的其他文件（排除当前文件和已缓存的）
    const currentDir = currentFile.filename.substring(0, currentFile.filename.lastIndexOf('/'))
    const cachedPaths = this.getCachedFilepaths()
    
    const dirFiles = filteredFiles.filter(file => 
      file.filename.startsWith(currentDir) && 
      file.filename !== currentFile.filename &&
      !cachedPaths.includes(file.filename)
    )

    // 如果目录内文件不够，从其他目录随机选择（排除已缓存的）
    const remainingCount = needCount - dirFiles.length
    if (remainingCount > 0) {
      const otherFiles = filteredFiles.filter(file => 
        !file.filename.startsWith(currentDir) &&
        !cachedPaths.includes(file.filename)
      )
      const randomFiles = [...otherFiles].sort(() => Math.random() - 0.5).slice(0, remainingCount)
      dirFiles.push(...randomFiles)
    }

    // 只预加载需要的数量
    const filesToPreload = dirFiles.slice(0, needCount)
    if (filesToPreload.length > 0) {
      await this.preloadFiles(config, filesToPreload, filesToPreload.length, viewedFilter)
    }
  }

  // 为图组模式优化的预加载方法（初始化时使用）
  async preloadForGalleryMode(
    config: any, 
    allFiles: any[], 
    count: number = 10, 
    viewedFilter: string = 'unviewed',
    onProgress?: (current: number, total: number) => void
  ): Promise<{
    successCount: number
    failedCount: number
    message: string
  }> {
    console.log(`[DEBUG] 图组模式预加载：目标数量 ${count}，筛选条件 ${viewedFilter}`)
    
    // 清除现有缓存（不清理下一组缓存）
    this.clearCache()
    
    // 从数据库获取已看过的文件列表
    await this.loadViewedFilesFromDatabase()
    
    // 筛选符合条件的文件
    const eligibleFiles = allFiles.filter(file => {
      // 根据筛选条件决定是否包含已观看的文件
      if (viewedFilter === 'viewed') {
        if (!this.viewedFiles.has(file.filename)) {
          return false
        }
      } else if (viewedFilter === 'unviewed') {
        if (this.viewedFiles.has(file.filename)) {
          return false
        }
      }
      
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

    // 随机选择一个图组
    const groups = this.groupFilesByFolder(eligibleFiles)
    
    if (groups.length === 0) {
      return {
        successCount: 0,
        failedCount: 0,
        message: '未找到图组'
      }
    }
    
    // 随机选择一个图组
    const randomGroup = groups[Math.floor(Math.random() * groups.length)]
    const selectedGroup = randomGroup.files
    
    // 记录当前图组
    this.currentGroupFiles = selectedGroup
    // 重置预加载触发标志（切换到新图组时重置）
    this.currentGroupPreloadTriggered = false
    
    // 只预加载当前图组的前 count 个文件
    const filesToPreload = selectedGroup.slice(0, Math.min(count, selectedGroup.length))
    
    console.log(`[DEBUG] 图组模式预加载：选择了图组 ${randomGroup.folderPath}，包含 ${selectedGroup.length} 个文件，预加载前 ${filesToPreload.length} 个`)
    
    // 并发预加载当前组的文件（图组模式需要预加载完10个文件后才能预览，可以使用并发提高速度）
    const totalFiles = filesToPreload.length
    
    // 触发初始进度（0/total）
    if (onProgress) {
      onProgress(0, totalFiles)
    }
    
    // 使用计数器跟踪已完成的文件数量
    let completedCount = 0
    
    // 并发预加载所有文件，每个文件完成时更新进度
    const preloadPromises = filesToPreload.map((file) =>
      this.preloadFileWithoutLimit(config, file)
        .then(() => {
          completedCount++
          // 触发进度更新
          if (onProgress) {
            onProgress(completedCount, totalFiles)
          }
        })
        .catch((error) => {
          completedCount++
          console.error(`预加载文件失败: ${file.filename}`, error)
          
          // 使用 Material UI 的 Snackbar 进行错误提示
          if (typeof window !== 'undefined' && (window as any).enqueueSnackbar) {
            (window as any).enqueueSnackbar(`❌ 预加载失败: ${file.basename || file.filename}`, { 
              variant: 'error',
              autoHideDuration: 2500,
              anchorOrigin: { vertical: 'top', horizontal: 'center' }
            })
          }
          
          // 即使失败也更新进度
          if (onProgress) {
            onProgress(completedCount, totalFiles)
          }
          
          // 重新抛出错误，让 Promise.allSettled 正确标记为 rejected
          throw error
        })
    )
    
    // 等待所有文件预加载完成
    const results = await Promise.allSettled(preloadPromises)
    
    // 当前组加载完成后，再异步预加载下一组（不阻塞后续流程）
    this.preloadNextGroup(config, allFiles, count, viewedFilter).catch(error => {
      console.error('预加载下一组失败:', error)
    })

    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.filter(result => result.status === 'rejected').length

    return {
      successCount,
      failedCount,
      message: `图组模式预加载完成：成功 ${successCount} 个，失败 ${failedCount} 个`
    }
  }

  // 预加载下一组图组（异步后台任务，不占用当前组缓存）
  async preloadNextGroup(config: any, allFiles: any[], count: number = 10, viewedFilter: string = 'unviewed'): Promise<void> {
    console.log(`[DEBUG] 开始后台预加载下一组图组...`)
    
    // 从数据库获取已看过的文件列表
    await this.loadViewedFilesFromDatabase()
    
    // 筛选符合条件的文件
    const eligibleFiles = allFiles.filter(file => {
      if (viewedFilter === 'viewed') {
        if (!this.viewedFiles.has(file.filename)) {
          return false
        }
      } else if (viewedFilter === 'unviewed') {
        if (this.viewedFiles.has(file.filename)) {
          return false
        }
      }
      
      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(file.basename)
      const isVideo = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(file.basename)
      
      if (isImage) return true
      if (isVideo && file.size <= this.maxVideoSize) return true
      return false
    })
    
    // 排除当前图组
    const currentGroupFolderPath = this.currentGroupFiles.length > 0 
      ? this.currentGroupFiles[0].filename.substring(0, this.currentGroupFiles[0].filename.lastIndexOf('/'))
      : ''
    
    const availableFiles = eligibleFiles.filter(file => {
      const folderPath = file.filename.substring(0, file.filename.lastIndexOf('/'))
      return folderPath !== currentGroupFolderPath
    })
    
    if (availableFiles.length === 0) {
      console.log('[DEBUG] 没有可用的图组进行预加载')
      return
    }
    
    // 随机选择一个图组
    const groups = this.groupFilesByFolder(availableFiles)
    if (groups.length === 0) {
      console.log('[DEBUG] 没有找到可用的图组')
      return
    }
    
    const randomGroup = groups[Math.floor(Math.random() * groups.length)]
    const selectedGroup = randomGroup.files
    
    // 记录下一组
    this.nextGroupFiles = selectedGroup
    
    // 只预加载下一组的前 count 个文件到独立的下一组缓存
    const filesToPreload = selectedGroup.slice(0, Math.min(count, selectedGroup.length))
    
    console.log(`[DEBUG] 下一组预加载：图组 ${randomGroup.folderPath}，包含 ${selectedGroup.length} 个文件，预加载前 ${filesToPreload.length} 个`)
    
    // 预加载到下一组缓存（使用独立的预加载方法）
    const preloadPromises = filesToPreload.map(file => this.preloadFileToNextGroup(config, file))
    await Promise.allSettled(preloadPromises)
    
    console.log(`[DEBUG] 下一组预加载完成`)
  }
  
  // 预加载文件到下一组缓存（独立方法）
  private async preloadFileToNextGroup(config: any, file: any): Promise<void> {
    const filepath = file.filename
    
    // 如果已经在下组缓存中，跳过
    if (this.nextGroupCache.has(filepath)) {
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
      
      // 存储到下一组缓存
      this.nextGroupCache.set(filepath, {
        blob,
        url,
        timestamp: Date.now(),
        filepath
      })
      
      // 限制下一组缓存大小
      if (this.nextGroupCache.size > this.maxCacheSize) {
        this.evictOldestNextGroupCache()
      }
      
      console.log(`下一组预加载完成: ${file.basename}`)
    } catch (error) {
      console.error(`下一组预加载失败 ${file.basename}:`, error)
      throw error
    } finally {
      this.queue.delete(filepath)
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
  
  // 切换到下一组（将下一组缓存转移到当前缓存）
  switchToNextGroup(): void {
    console.log('[DEBUG] 切换到下一组图组')
    
    // 清除当前组缓存
    this.clearCache()
    
    // 将下一组缓存转移到当前缓存
    for (const [key, cached] of this.nextGroupCache.entries()) {
      this.cache.set(key, cached)
    }
    
    // 清空下一组缓存
    this.nextGroupCache.clear()
    
    // 更新当前组文件列表
    this.currentGroupFiles = [...this.nextGroupFiles]
    this.nextGroupFiles = []
    // 重置预加载触发标志（切换到新图组时重置）
    this.currentGroupPreloadTriggered = false
    
    console.log('[DEBUG] 切换完成，当前缓存大小:', this.cache.size)
  }
  
  // 预加载当前图组剩余的所有文件
  async preloadRemainingCurrentGroup(config: any, onProgress?: (current: number) => void): Promise<void> {
    if (this.currentGroupFiles.length === 0) {
      console.log('[DEBUG] 没有当前图组，跳过剩余文件预加载')
      return
    }
    
    // 如果当前图组已经触发过预加载，跳过（避免重复触发）
    if (this.currentGroupPreloadTriggered) {
      console.log('[DEBUG] 当前图组已经触发过预加载，跳过')
      return
    }
    
    // 获取已缓存的当前组文件
    const cachedPaths = this.getCachedFilepaths()
    const remainingFiles = this.currentGroupFiles.filter(file => !cachedPaths.includes(file.filename))
    
    if (remainingFiles.length === 0) {
      console.log('[DEBUG] 当前图组所有文件已缓存')
      // 即使没有剩余文件，也标记为已触发，避免重复检查
      this.currentGroupPreloadTriggered = true
      return
    }
    
    // 标记为已触发，避免重复触发
    this.currentGroupPreloadTriggered = true
    
    console.log(`[DEBUG] 开始预加载当前图组剩余 ${remainingFiles.length} 个文件`)
    
    // 限制并发数量，避免阻塞其他API请求（如评分加载）
    // 最多同时进行3个预加载请求，为评分API等留出资源
    const maxConcurrent = 3
    let currentIndex = 0
    let completedCount = 0
    
    // 保存当前图组的文件路径集合，用于验证（防止切换图组后仍然处理上一图组的文件）
    const currentGroupFilepaths = new Set(this.currentGroupFiles.map(f => f.filename))
    
    // 并发控制：每次最多启动maxConcurrent个请求
    while (currentIndex < remainingFiles.length) {
      // 检查是否已经切换图组（通过检查文件是否还在当前图组中）
      const firstFileInBatch = remainingFiles[currentIndex]
      if (!currentGroupFilepaths.has(firstFileInBatch.filename)) {
        // 已经切换图组，停止预加载
        console.log('[DEBUG] 检测到图组已切换，停止预加载上一图组的剩余文件')
        break
      }
      
      // 获取当前批次需要预加载的文件
      const batch = remainingFiles.slice(currentIndex, currentIndex + maxConcurrent)
      
      // 并发预加载当前批次，每个文件完成时更新进度
      const batchPromises = batch.map((file) => 
        this.preloadFileWithoutLimit(config, file).then(() => {
          completedCount++
          // 每个文件加载完成时更新进度
          if (onProgress) {
            const currentLoaded = this.cache.size
            onProgress(currentLoaded)
          }
        }).catch(error => {
          completedCount++
          console.error(`预加载文件失败: ${file.filename}`, error)
          // 即使失败也更新进度
          if (onProgress) {
            const currentLoaded = this.cache.size
            onProgress(currentLoaded)
          }
        })
      )
      
      // 等待当前批次完成
      await Promise.allSettled(batchPromises)
      
      // 移动到下一批次
      currentIndex += maxConcurrent
    }
    
    console.log('[DEBUG] 当前图组剩余文件预加载完成')
  }
  
  // 预加载文件但不限制缓存大小（用于预加载当前组的所有文件）
  private async preloadFileWithoutLimit(config: any, file: any): Promise<void> {
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
      
      // 检查文件是否还属于当前图组（可能在预加载过程中切换了图组）
      const isFileInCurrentGroup = this.currentGroupFiles.some(f => f.filename === filepath)
      
      if (!isFileInCurrentGroup) {
        // 已经切换图组，丢弃这个文件，不添加到缓存
        URL.revokeObjectURL(url)
        console.log(`[DEBUG] 预加载完成但图组已切换，丢弃文件: ${file.basename}`)
        return
      }
      
      // 再次检查文件是否已经在缓存中（可能在预加载过程中已经被其他方式加载）
      if (this.cache.has(filepath)) {
        // 已经存在，丢弃这个文件
        URL.revokeObjectURL(url)
        console.log(`[DEBUG] 预加载完成但文件已在缓存中，丢弃: ${file.basename}`)
        return
      }
      
      // 存储到缓存（不检查缓存大小限制）
      this.cache.set(filepath, {
        blob,
        url,
        timestamp: Date.now(),
        filepath
      })
      
      console.log(`预加载完成: ${file.basename}`)
      
    } catch (error) {
      console.error(`预加载失败 ${file.basename}:`, error)
      throw error
    } finally {
      this.queue.delete(filepath)
    }
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
    
    // 如果文件数量小于等于预加载数量，不需要预加载剩余文件
    if (this.currentGroupFiles.length <= this.maxCacheSize) {
      return false
    }
    
    // 如果文件数量大于预加载数量，当浏览超过已预加载文件的一半时触发
    // 例如：预加载了10个，在浏览到第5个时开始预加载剩余的
    return currentIndex >= Math.floor(this.maxCacheSize / 2)
  }

  // 按文件夹分组（图组模式专用）
  private groupFilesByFolder(files: any[]): Array<{folderPath: string, files: any[]}> {
    const groups = new Map<string, any[]>()
    
    files.forEach(file => {
      const folderPath = file.filename.substring(0, file.filename.lastIndexOf('/'))
      
      if (!groups.has(folderPath)) {
        groups.set(folderPath, [])
      }
      groups.get(folderPath)!.push(file)
    })
    
    return Array.from(groups.entries())
      .map(([folderPath, files]) => ({ folderPath, files }))
      .sort((a, b) => b.files.length - a.files.length)
  }

  // 智能预加载当前图组
  async preloadCurrentGroup(config: any, currentGroup: any[], viewedFilter: string = 'unviewed'): Promise<void> {
    if (!currentGroup || currentGroup.length === 0) return

    console.log(`[DEBUG] 智能预加载当前图组：${currentGroup.length} 个文件`)
    
    // 限制预加载数量，避免阻塞UI
    const maxPreloadCount = Math.min(currentGroup.length, 5) // 最多预加载5个文件
    const filesToPreload = currentGroup.slice(0, maxPreloadCount)
    
    console.log(`[DEBUG] 实际预加载：${filesToPreload.length} 个文件（限制最大5个）`)
    
    // 预加载当前图组中的文件（限制数量）
    const preloadPromises = filesToPreload.map(file => this.preloadFile(config, file))
    await Promise.allSettled(preloadPromises)
    
    console.log(`[DEBUG] 当前图组预加载完成`)
  }

  // 自动补齐缓存到目标数量
  async refillCache(
    config: any, 
    allFiles: any[], 
    targetCount: number = 10, 
    viewedFilter: string = 'unviewed',
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    // 从数据库获取已看过的文件列表
    await this.loadViewedFilesFromDatabase()
    
    const currentCacheSize = this.cache.size
    if (currentCacheSize >= targetCount) {
      console.log('缓存已满，无需补齐')
      // 如果缓存已满，也触发一次进度回调
      if (onProgress) {
        onProgress(currentCacheSize, targetCount)
      }
      return // 缓存已满，无需补齐
    }

    const needCount = targetCount - currentCacheSize
    console.log(`缓存不足，需要补齐 ${needCount} 个文件，筛选条件: ${viewedFilter}`)

    // 触发初始进度
    if (onProgress) {
      onProgress(currentCacheSize, targetCount)
    }

    // 根据筛选条件过滤文件
    const filteredFiles = allFiles.filter(file => {
      if (viewedFilter === 'viewed') {
        return this.viewedFiles.has(file.filename)
      } else if (viewedFilter === 'unviewed') {
        return !this.viewedFiles.has(file.filename)
      }
      return true // viewedFilter === 'all'
    })

    // 在已看过模式下，使用本地已看过记录来管理缓存
    if (viewedFilter === 'viewed') {
      const cachedPaths = this.getCachedFilepaths()
      
      // 从未缓存且未在本地标记为已看过的文件中选择
      const availableFiles = filteredFiles.filter(file => 
        !cachedPaths.includes(file.filename) && 
        !this.localViewedFiles.has(file.filename)
      )

      if (availableFiles.length === 0) {
        console.log('已看过模式下：所有文件都已缓存或已看过，无法补齐')
        return
      }

      // 只预加载需要的数量
      const filesToPreload = availableFiles.slice(0, needCount)
      // 并发预加载，每个文件完成时更新进度
      const preloadPromises = filesToPreload.map((file) => 
        this.preloadFile(config, file).then(() => {
          // 每个文件加载完成时更新进度
          if (onProgress) {
            const currentLoaded = this.cache.size
            onProgress(currentLoaded, targetCount)
          }
        }).catch(error => {
          console.error(`预加载文件失败: ${file.filename}`, error)
          // 即使失败也更新进度
          if (onProgress) {
            const currentLoaded = this.cache.size
            onProgress(currentLoaded, targetCount)
          }
        })
      )
      await Promise.allSettled(preloadPromises)
    } else {
      // 其他模式使用原有逻辑
      const cachedPaths = this.getCachedFilepaths()
      const availableFiles = filteredFiles.filter(file => 
        !cachedPaths.includes(file.filename)
      )

      if (availableFiles.length === 0) {
        console.log('没有可用的文件进行补齐')
        return
      }

      // 只预加载需要的数量
      const filesToPreload = availableFiles.slice(0, needCount)
      // 并发预加载，每个文件完成时更新进度
      const preloadPromises = filesToPreload.map((file) => 
        this.preloadFile(config, file).then(() => {
          // 每个文件加载完成时更新进度
          if (onProgress) {
            const currentLoaded = this.cache.size
            onProgress(currentLoaded, targetCount)
          }
        }).catch(error => {
          console.error(`预加载文件失败: ${file.filename}`, error)
          // 即使失败也更新进度
          if (onProgress) {
            const currentLoaded = this.cache.size
            onProgress(currentLoaded, targetCount)
          }
        })
      )
      await Promise.allSettled(preloadPromises)
    }
  }
}

// 创建全局预加载管理器实例
export const preloadManager = new PreloadManager()

export default preloadManager
