import { scheduleStreamRequest } from '@/lib/clientRequestScheduler'
import type { CreatorSummary, GroupRating, MediaRating } from '@/types'

function getGroupPathFromFilepath(filepath: string): string {
  const lastSlashIndex = filepath.lastIndexOf('/')
  return lastSlashIndex > 0 ? filepath.substring(0, lastSlashIndex) : '/'
}

type CachedMediaMetadata = {
  id?: number
  blob: Blob
  url: string
  timestamp: number
  filepath: string
  size: number
  lastmod: string
  creator?: CreatorSummary | null
  creatorResolved?: boolean
  mediaRatingData?: MediaRating | null
  groupRatingData?: GroupRating | null
}

type TakenCachedMediaMetadata = {
  id?: number
  blob: Blob
  filepath: string
  size: number
  lastmod: string
  creator?: CreatorSummary | null
  creatorResolved?: boolean
  mediaRatingData?: MediaRating | null
  groupRatingData?: GroupRating | null
}

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
  //#region 状态管理
  
  // 当前组缓存：存储当前正在浏览的图组文件
  private cache = new Map<string, CachedMediaMetadata>()
  
  // 图组模式专用：下一组预加载缓存
  private nextGroupCache = new Map<string, CachedMediaMetadata>()
  
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
  private localViewedFileIds = new Set<number>()
  
  // 图组模式相关状态
  private currentGroupFiles: any[] = []
  private nextGroupFiles: any[] = []
  private currentGroupPreloadTriggered = false

  // 并发控制（所有模式统一限制为最多 4 个文件请求并发，避免触发风控）
  private activePreloadCount = 0
  private maxConcurrentPreloads = 4
  private pendingPreloadQueue: Array<() => void> = []
  private concurrencyLimitEnabled = true

  // 单个预加载文件请求的总超时时间。
  // 目的不是限制正常下载速度，而是避免 /api/webdav/stream 长时间无响应时把智能预加载永久卡死。
  private preloadRequestTimeoutMs = 15_000

  // 取消预加载控制
  private abortController: AbortController | null = null
  private preloadCancelled = false
  
  //#endregion

  //#region 配置管理
  
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

  // 随机模式缓存池配置：基础阈值=预加载数量，目标池容量=预加载数量 x 5
  getRandomPoolConfig(preloadCount: number) {
    const baseCount = Math.max(1, preloadCount || 1)
    return {
      baseCount,
      targetCount: baseCount * 5,
    }
  }
  
  //#endregion

  //#region 取消控制
  
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
  
  //#endregion

  //#region 并发控制
  
  // 获取预加载许可
  private async acquirePreloadSlot(): Promise<void> {
    console.log(`[并发控制] 请求许可，当前活跃: ${this.activePreloadCount}/${this.maxConcurrentPreloads}，限制: ${this.concurrencyLimitEnabled}`)
    
    if (!this.concurrencyLimitEnabled) {
      this.activePreloadCount++
      console.log(`[并发控制] 无限制模式，活跃数: ${this.activePreloadCount}`)
      return
    }
    
    if (this.activePreloadCount < this.maxConcurrentPreloads) {
      this.activePreloadCount++
      console.log(`[并发控制] ✅ 获得许可，活跃数: ${this.activePreloadCount}/${this.maxConcurrentPreloads}`)
      return
    }
    
    console.log(`[并发控制] ⏸️ 达到上限，加入等待队列，队列长度: ${this.pendingPreloadQueue.length + 1}`)
    
    return new Promise(resolve => {
      this.pendingPreloadQueue.push(() => {
        this.activePreloadCount++
        console.log(`[并发控制] ✅ 从队列获得许可，活跃数: ${this.activePreloadCount}/${this.maxConcurrentPreloads}`)
        resolve()
      })
    })
  }

  // 释放预加载许可
  private releasePreloadSlot(): void {
    this.activePreloadCount--
    console.log(`[并发控制] 🔓 释放许可，活跃数: ${this.activePreloadCount}/${this.maxConcurrentPreloads}，队列长度: ${this.pendingPreloadQueue.length}`)
    
    if (!this.concurrencyLimitEnabled) {
      return
    }
    
    if (this.pendingPreloadQueue.length > 0) {
      console.log(`[并发控制] 🔔 唤醒等待队列中的任务`)
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
  
  //#endregion

  //#region 图组筛选参数辅助

  private appendAdvancedFilterParams(params: URLSearchParams, advancedFilters?: {
    ratings?: number[]
    evaluations?: string[]
    categories?: string[]
    reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
    reasonKeyword?: string
    ratingEmptyFilter?: boolean
    evaluationEmptyFilter?: boolean
    categoryEmptyFilter?: boolean
  }) {
    if (!advancedFilters) {
      return
    }

    if (advancedFilters.ratings && advancedFilters.ratings.length > 0) {
      params.set('ratings', JSON.stringify(advancedFilters.ratings))
    }
    if (advancedFilters.evaluations && advancedFilters.evaluations.length > 0) {
      params.set('evaluations', JSON.stringify(advancedFilters.evaluations))
    }
    if (advancedFilters.categories && advancedFilters.categories.length > 0) {
      params.set('categories', JSON.stringify(advancedFilters.categories))
    }
    if (advancedFilters.reasonFilter && advancedFilters.reasonFilter !== 'all') {
      params.set('reasonFilter', advancedFilters.reasonFilter)
    }
    if (advancedFilters.reasonKeyword) {
      params.set('reasonKeyword', advancedFilters.reasonKeyword)
    }
    if (advancedFilters.ratingEmptyFilter !== undefined) {
      params.set('ratingEmptyFilter', String(advancedFilters.ratingEmptyFilter))
    }
    if (advancedFilters.evaluationEmptyFilter !== undefined) {
      params.set('evaluationEmptyFilter', String(advancedFilters.evaluationEmptyFilter))
    }
    if (advancedFilters.categoryEmptyFilter !== undefined) {
      params.set('categoryEmptyFilter', String(advancedFilters.categoryEmptyFilter))
    }
  }
  
  //#endregion

  //#region 文件预加载核心方法

  private async fetchPreloadStreamWithTimeout(config: any, filepath: string): Promise<Response> {
    const requestController = new AbortController()
    const upstreamAbortSignal = this.getAbortSignal()
    let timedOut = false

    const handleUpstreamAbort = () => {
      requestController.abort()
    }

    if (upstreamAbortSignal?.aborted) {
      requestController.abort()
    } else if (upstreamAbortSignal) {
      upstreamAbortSignal.addEventListener('abort', handleUpstreamAbort, { once: true })
    }

    const timeoutId = setTimeout(() => {
      timedOut = true
      requestController.abort()
    }, this.preloadRequestTimeoutMs)

    try {
      return await scheduleStreamRequest(() => fetch('/api/webdav/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          filepath,
        }),
        signal: requestController.signal,
      }))
    } catch (error: any) {
      if (timedOut) {
        throw new Error(`获取文件流超时(${Math.round(this.preloadRequestTimeoutMs / 1000)}s): ${filepath}`)
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
      if (upstreamAbortSignal) {
        upstreamAbortSignal.removeEventListener('abort', handleUpstreamAbort)
      }
    }
  }
  
  // 预加载单个文件（带并发控制和快速重试）
  private async preloadFile(config: any, file: any): Promise<void> {
    const filepath = file.filename
    const maxQuickRetries = 2  // 快速重试2次
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log(`[数据库模式] 预加载已取消，跳过: ${file.basename}`)
      return
    }
    
    // ✅ 在获取许可前检查，避免不必要的等待
    if (this.cache.has(filepath)) return
    if (this.queue.has(filepath)) return

    // ✅ 快速重试循环
    for (let attempt = 0; attempt <= maxQuickRetries; attempt++) {
      let slotAcquired = false  // 🔧 跟踪是否获取了许可
      
      try {
        await this.acquirePreloadSlot()
        slotAcquired = true  // 🔧 标记已获取许可
        
        // 再次检查是否已取消（等待期间可能被取消）
        if (this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载已取消，跳过: ${file.basename}`)
          return
        }
        
        // ✅ 获取许可后再次检查，如果已在缓存中，直接返回
        if (this.cache.has(filepath)) {
          console.log(`[数据库模式] 文件已在缓存中，跳过: ${file.basename}`)
          return
        }
        
        this.queue.add(filepath)

        const streamResponse = await this.fetchPreloadStreamWithTimeout(config, file.filename)

        // 检查是否已取消
        if (this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载已取消，丢弃响应: ${file.basename}`)
          return
        }

        if (!streamResponse.ok) {
          throw new Error(`获取文件流失败: ${streamResponse.status}`)
        }

        const blob = await streamResponse.blob()
        
        // 再次检查是否已取消
        if (this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载已取消，丢弃blob: ${file.basename}`)
          return
        }
        
        const url = URL.createObjectURL(blob)
        
        this.cache.set(filepath, {
          id: Number.isFinite(Number(file.id)) ? Number(file.id) : undefined,
          blob,
          url,
          timestamp: Date.now(),
          filepath,
          size: file.size || 0,
          lastmod: file.lastmod || '',
          creator: file.creator || null,
          creatorResolved: Boolean(file.creatorResolved),
          mediaRatingData: file.mediaRatingData ?? null,
          groupRatingData: file.groupRatingData ?? null,
        })

        // 图组模式下不驱逐缓存（允许缓存整个图组）
        // 只在随机模式下才限制缓存大小
        if (this.cache.size > this.maxCacheSize && this.currentGroupFiles.length === 0) {
          this.evictOldestCache()
        }

        console.log(`[数据库模式] 预加载完成: ${file.basename}，当前缓存=${this.cache.size}，队列=${this.queue.size}`)
        return  // ✅ 成功，直接返回

      } catch (error: any) {
        // 如果是取消导致的错误，不记录为错误
        if (error.name === 'AbortError' || this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载被取消: ${file.basename}`)
          slotAcquired = false  // 🔧 取消时标记为不需要释放（因为已经被 cancelAllPreloads 重置了）
          return
        }
        
        // 如果还有重试机会，进行快速重试
        if (attempt < maxQuickRetries) {
          console.warn(`[数据库模式] 预加载失败，快速重试 ${attempt + 1}/${maxQuickRetries}: ${file.basename}`, error.message)
          await new Promise(resolve => setTimeout(resolve, 500))  // 等待500ms后重试
          // 继续下一次循环
        } else {
          console.error(`[数据库模式] 预加载失败，已达快速重试上限: ${file.basename}`, error)
          throw error  // 重试失败，抛出错误
        }
      } finally {
        this.queue.delete(filepath)
        console.log(`[数据库模式][preloadFile] finally块执行: ${file.basename}，删除队列后队列大小=${this.queue.size}`)
        // 🔧 只有在成功获取许可且未被取消时才释放
        if (slotAcquired) {
          this.releasePreloadSlot()
        }
      }
    }
  }

  // 预加载文件但不限制缓存大小（带快速重试）
  private async preloadFileWithoutLimit(config: any, file: any): Promise<void> {
    const filepath = file.filename
    const maxQuickRetries = 2  // 快速重试2次
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log(`[数据库模式] 预加载已取消，跳过: ${file.basename}`)
      return
    }
    
    if (this.cache.has(filepath)) return
    if (this.queue.has(filepath)) return
    
    // ✅ 快速重试循环
    for (let attempt = 0; attempt <= maxQuickRetries; attempt++) {
      let slotAcquired = false  // 🔧 跟踪是否获取了许可
      
      try {
        await this.acquirePreloadSlot()
        slotAcquired = true  // 🔧 标记已获取许可
        
        // 再次检查是否已取消
        if (this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载已取消，跳过: ${file.basename}`)
          return
        }
        
        if (this.cache.has(filepath)) return
        
        this.queue.add(filepath)
        
        const streamResponse = await this.fetchPreloadStreamWithTimeout(config, file.filename)
        
        // 检查是否已取消
        if (this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载已取消，丢弃响应: ${file.basename}`)
          return
        }
        
        if (!streamResponse.ok) {
          throw new Error(`获取文件流失败: ${streamResponse.status}`)
        }
        
        const blob = await streamResponse.blob()
        
        // 再次检查是否已取消
        if (this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载已取消，丢弃blob: ${file.basename}`)
          return
        }
        
        const url = URL.createObjectURL(blob)
        
        // 只在图组模式下检查文件是否还属于当前图组
        if (this.currentGroupFiles.length > 0) {
          const isFileInCurrentGroup = this.currentGroupFiles.some(f => f.filename === filepath)
          
          if (!isFileInCurrentGroup) {
            URL.revokeObjectURL(url)
            console.log(`[数据库模式] 预加载完成但图组已切换，丢弃文件: ${file.basename}`)
            return
          }
        }
        
        if (this.cache.has(filepath)) {
          URL.revokeObjectURL(url)
          return
        }
        
        this.cache.set(filepath, {
          id: Number.isFinite(Number(file.id)) ? Number(file.id) : undefined,
          blob,
          url,
          timestamp: Date.now(),
          filepath,
          size: file.size || 0,
          lastmod: file.lastmod || '',
          creator: file.creator || null,
          creatorResolved: Boolean(file.creatorResolved),
          mediaRatingData: file.mediaRatingData ?? null,
          groupRatingData: file.groupRatingData ?? null,
        })
        
        console.log(`[数据库模式] 预加载完成: ${file.basename}`)
        return  // ✅ 成功，直接返回
        
      } catch (error: any) {
        // 如果是取消导致的错误，不记录为错误
        if (error.name === 'AbortError' || this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载被取消: ${file.basename}`)
          slotAcquired = false  // 🔧 取消时标记为不需要释放（因为已经被 cancelAllPreloads 重置了）
          return
        }
        
        // 如果还有重试机会，进行快速重试
        if (attempt < maxQuickRetries) {
          console.warn(`[数据库模式] 预加载失败，快速重试 ${attempt + 1}/${maxQuickRetries}: ${file.basename}`, error.message)
          await new Promise(resolve => setTimeout(resolve, 500))
        } else {
          console.error(`[数据库模式] 预加载失败，已达快速重试上限: ${file.basename}`, error)
          throw error
        }
      } finally {
        this.queue.delete(filepath)
        // 🔧 只有在成功获取许可且未被取消时才释放
        if (slotAcquired) {
          this.releasePreloadSlot()
        }
      }
    }
  }

  // 预加载文件到下一组缓存（带快速重试）
  private async preloadFileToNextGroup(config: any, file: any): Promise<void> {
    const filepath = file.filename
    const maxQuickRetries = 2  // 快速重试2次
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log(`[数据库模式] 预加载已取消，跳过下一组: ${file.basename}`)
      return
    }
    
    if (this.nextGroupCache.has(filepath)) return
    if (this.queue.has(filepath)) return
    
    // ✅ 快速重试循环
    for (let attempt = 0; attempt <= maxQuickRetries; attempt++) {
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
        
        const streamResponse = await this.fetchPreloadStreamWithTimeout(config, file.filename)
        
        // 检查是否已取消
        if (this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载已取消，丢弃下一组响应: ${file.basename}`)
          return
        }
        
        if (!streamResponse.ok) {
          throw new Error(`获取文件流失败: ${streamResponse.status}`)
        }
        
        const blob = await streamResponse.blob()
        
        // 再次检查是否已取消
        if (this.isPreloadCancelled()) {
          console.log(`[数据库模式] 预加载已取消，丢弃下一组blob: ${file.basename}`)
          return
        }
        
        const url = URL.createObjectURL(blob)
        
        this.nextGroupCache.set(filepath, {
          id: Number.isFinite(Number(file.id)) ? Number(file.id) : undefined,
          blob,
          url,
          timestamp: Date.now(),
          filepath,
          size: file.size || 0,
          lastmod: file.lastmod || '',
          creator: file.creator || null,
          creatorResolved: Boolean(file.creatorResolved),
          mediaRatingData: file.mediaRatingData ?? null,
          groupRatingData: file.groupRatingData ?? null,
        })
        
        if (this.nextGroupCache.size > this.maxCacheSize) {
          this.evictOldestNextGroupCache()
        }
        
        console.log(`[数据库模式] 下一组预加载完成: ${file.basename}`)
        return  // ✅ 成功，直接返回
        
      } catch (error: any) {
        // 如果是取消导致的错误，不记录为错误
        if (error.name === 'AbortError' || this.isPreloadCancelled()) {
          console.log(`[数据库模式] 下一组预加载被取消: ${file.basename}`)
          return
        }
        
        // 如果还有重试机会，进行快速重试
        if (attempt < maxQuickRetries) {
          console.warn(`[数据库模式] 下一组预加载失败，快速重试 ${attempt + 1}/${maxQuickRetries}: ${file.basename}`, error.message)
          await new Promise(resolve => setTimeout(resolve, 500))
        } else {
          console.error(`[数据库模式] 下一组预加载失败，已达快速重试上限: ${file.basename}`, error)
          throw error
        }
      } finally {
        this.queue.delete(filepath)
        this.releasePreloadSlot()
      }
    }
  }
  
  //#endregion

  //#region 缓存管理
  
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
  
  //#endregion

  //#region 缓存查询与状态
  
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
    
    // 🔧 重置并发控制计数器（修复切换模式时计数器错误的问题）
    this.activePreloadCount = 0
    this.pendingPreloadQueue = []
    console.log('[数据库模式] 缓存已清空，并发控制已重置')
  }

  // 清理下一组缓存
  clearNextGroupCache() {
    for (const cached of this.nextGroupCache.values()) {
      URL.revokeObjectURL(cached.url)
    }
    this.nextGroupCache.clear()
  }

  // 清理图组模式运行时状态
  clearGalleryRuntimeState() {
    this.currentGroupFiles = []
    this.nextGroupFiles = []
    this.currentGroupPreloadTriggered = false
  }

  // 获取缓存状态
  getCacheStatus() {
    return {
      cacheSize: this.cache.size,
      maxCacheSize: this.maxCacheSize,
      queueSize: this.queue.size,
      pendingQueueSize: this.pendingPreloadQueue.length,  // 新增：等待许可的任务数
      cachedFiles: Array.from(this.cache.keys())
    }
  }

  // 获取所有缓存的文件路径
  getCachedFilepaths(): string[] {
    return Array.from(this.cache.keys())
  }

  // 获取所有缓存的文件信息（包含元数据）
  getCachedFiles(): Array<{
    id?: number
    filename: string
    basename: string
    size: number
    lastmod: string
    creator?: CreatorSummary | null
    creatorResolved?: boolean
    mediaRatingData?: MediaRating | null
    groupRatingData?: GroupRating | null
  }> {
    return Array.from(this.cache.entries()).map(([filepath, cached]) => ({
      id: cached.id,
      filename: filepath,
      basename: filepath.substring(filepath.lastIndexOf('/') + 1),
      size: cached.size,
      lastmod: cached.lastmod,
      creator: cached.creator || null,
      creatorResolved: Boolean(cached.creatorResolved),
      mediaRatingData: cached.mediaRatingData ?? null,
      groupRatingData: cached.groupRatingData ?? null,
    }))
  }

  // 取出一个已缓存文件，并立刻从缓存池中消费掉。
  // 用于随机模式：用户真正浏览到该文件后，不再长期保留在预加载池内存中。
  takePreloadedFile(filepath: string): TakenCachedMediaMetadata | null {
    const cached = this.cache.get(filepath)
    if (!cached) {
      return null
    }

    this.cache.delete(filepath)
    URL.revokeObjectURL(cached.url)

    return {
      id: cached.id,
      blob: cached.blob,
      filepath: cached.filepath,
      size: cached.size,
      lastmod: cached.lastmod,
      creator: cached.creator || null,
      creatorResolved: Boolean(cached.creatorResolved),
      mediaRatingData: cached.mediaRatingData ?? null,
      groupRatingData: cached.groupRatingData ?? null,
    }
  }

  // 从缓存中随机获取文件
  getRandomCachedFile(): string | null {
    const cachedPaths = this.getCachedFilepaths()
    if (cachedPaths.length === 0) return null
    
    const randomIndex = Math.floor(Math.random() * cachedPaths.length)
    return cachedPaths[randomIndex]
  }

  getCachedFileIds(): number[] {
    return Array.from(this.cache.values())
      .map((cached) => cached.id)
      .filter((value): value is number => Number.isFinite(value))
  }
  
  //#endregion

  //#region 已观看文件管理
  
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

  // 同步更新文件的博主元数据
  patchFileCreatorMetadata(filepath: string, creator: CreatorSummary | null, creatorResolved: boolean): void {
    const nextCreator = creator || null
    const nextCreatorResolved = Boolean(creatorResolved)

    const cached = this.cache.get(filepath)
    if (cached) {
      cached.creator = nextCreator
      cached.creatorResolved = nextCreatorResolved
    }

    const nextGroupCached = this.nextGroupCache.get(filepath)
    if (nextGroupCached) {
      nextGroupCached.creator = nextCreator
      nextGroupCached.creatorResolved = nextCreatorResolved
    }

    this.currentGroupFiles = this.currentGroupFiles.map((file) => (
      file.filename === filepath
        ? {
            ...file,
            creator: nextCreator,
            creatorResolved: nextCreatorResolved,
          }
        : file
    ))

    this.nextGroupFiles = this.nextGroupFiles.map((file) => (
      file.filename === filepath
        ? {
            ...file,
            creator: nextCreator,
            creatorResolved: nextCreatorResolved,
          }
        : file
    ))
  }

  // 同步更新文件的媒体评分快照
  patchFileRatingMetadata(filepath: string, mediaRatingData: MediaRating | null): void {
    const nextMediaRatingData = mediaRatingData ?? null

    const cached = this.cache.get(filepath)
    if (cached) {
      cached.mediaRatingData = nextMediaRatingData
    }

    const nextGroupCached = this.nextGroupCache.get(filepath)
    if (nextGroupCached) {
      nextGroupCached.mediaRatingData = nextMediaRatingData
    }

    this.currentGroupFiles = this.currentGroupFiles.map((file) => (
      file.filename === filepath
        ? {
            ...file,
            mediaRatingData: nextMediaRatingData,
          }
        : file
    ))

    this.nextGroupFiles = this.nextGroupFiles.map((file) => (
      file.filename === filepath
        ? {
            ...file,
            mediaRatingData: nextMediaRatingData,
          }
        : file
    ))
  }

  // 同步更新图组评分快照
  patchGroupRatingMetadata(groupPath: string, groupRatingData: GroupRating | null): void {
    const nextGroupRatingData = groupRatingData ?? null

    this.cache.forEach((cached, filepath) => {
      if (getGroupPathFromFilepath(filepath) === groupPath) {
        cached.groupRatingData = nextGroupRatingData
      }
    })

    this.nextGroupCache.forEach((cached, filepath) => {
      if (getGroupPathFromFilepath(filepath) === groupPath) {
        cached.groupRatingData = nextGroupRatingData
      }
    })

    this.currentGroupFiles = this.currentGroupFiles.map((file) => (
      getGroupPathFromFilepath(file.filename) === groupPath
        ? {
            ...file,
            groupRatingData: nextGroupRatingData,
          }
        : file
    ))

    this.nextGroupFiles = this.nextGroupFiles.map((file) => (
      getGroupPathFromFilepath(file.filename) === groupPath
        ? {
            ...file,
            groupRatingData: nextGroupRatingData,
          }
        : file
    ))
  }

  // 直接添加文件到缓存
  addToCacheDirectly(
    filepath: string,
    blob: Blob,
    size: number = 0,
    lastmod: string = '',
    creator?: CreatorSummary | null,
    creatorResolved: boolean = false,
    mediaRatingData?: MediaRating | null,
    groupRatingData?: GroupRating | null,
    fileId?: number,
  ): void {
    if (this.cache.has(filepath)) return

    const url = URL.createObjectURL(blob)
    
    this.cache.set(filepath, {
      id: Number.isFinite(Number(fileId)) ? Number(fileId) : undefined,
      blob,
      url,
      timestamp: Date.now(),
      filepath,
      size,
      lastmod,
      creator: creator || null,
      creatorResolved,
      mediaRatingData: mediaRatingData ?? null,
      groupRatingData: groupRatingData ?? null,
    })
  }

  async preloadProvidedFiles(
    config: any,
    files: Array<{
      id?: number
      filename: string
      basename: string
      size?: number
      lastmod?: string
      creator?: CreatorSummary | null
      creatorResolved?: boolean
      mediaRatingData?: MediaRating | null
      groupRatingData?: GroupRating | null
    }>,
    maxCount: number = files.length,
    onProgress?: (current: number, total: number) => void,
  ): Promise<{
    successCount: number
    failedCount: number
  }> {
    if (files.length === 0) {
      return {
        successCount: 0,
        failedCount: 0,
      }
    }

    if (this.isPreloadCancelled()) {
      this.resetCancelState()
    }

    this.setConcurrencyLimitEnabled(true)
    this.setMaxCacheSize(Math.max(1, maxCount || files.length))

    const progressTotal = Math.max(1, maxCount || files.length)
    onProgress?.(this.cache.size, progressTotal)

    const results = await Promise.allSettled(
      files.map((file) => this.preloadFile(config, file)
        .finally(() => {
          onProgress?.(this.cache.size, progressTotal)
        })),
    )

    return {
      successCount: results.filter((result) => result.status === 'fulfilled').length,
      failedCount: results.filter((result) => result.status === 'rejected').length,
    }
  }

  // 本地已看过文件管理
  addLocalViewedFile(fileOrPath: string | { filename: string; id?: number }) {
    if (typeof fileOrPath === 'string') {
      this.localViewedFiles.add(fileOrPath)
      return
    }

    this.localViewedFiles.add(fileOrPath.filename)
    const fileId = Number(fileOrPath.id)
    if (Number.isFinite(fileId) && fileId > 0) {
      this.localViewedFileIds.add(fileId)
    }
  }

  isLocalViewed(filepath: string): boolean {
    return this.localViewedFiles.has(filepath)
  }  
  clearLocalViewedFiles() {
    this.localViewedFiles.clear()
    this.localViewedFileIds.clear()
  }

  getLocalViewedCount(): number {
    return this.localViewedFiles.size
  }

  // 获取本地已看过的文件名列表
  getLocalViewedFilenames(): Set<string> {
    return new Set(this.localViewedFiles)
  }

  getLocalViewedFileIds(): Set<number> {
    return new Set(this.localViewedFileIds)
  }
  
  //#endregion

  //#region 图组模式管理
  
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
  
  //#endregion

  //#region 数据库模式核心方法
  
  // 从数据库随机获取文件并预加载（随机模式）
  async preloadFromDatabase(
    config: any,
    count: number = 10,
    viewedFilter: string = 'unviewed',
    onProgress?: (current: number, total: number) => void,
    advancedFilters?: {
      ratings?: number[]
      evaluations?: string[]
      categories?: string[]
      reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
      reasonKeyword?: string
      ratingEmptyFilter?: boolean // undefined=不筛选, true=为空, false=不为空
      evaluationEmptyFilter?: boolean // undefined=不筛选, true=为空, false=不为空
      categoryEmptyFilter?: boolean // undefined=不筛选, true=为空, false=不为空
    }
  ): Promise<{
    successCount: number
    failedCount: number
    message: string
  }> {
    console.log(`[数据库模式] 随机预加载开始，目标数量: ${count}，筛选条件: ${viewedFilter}`)
    
    // 重置取消状态
    this.resetCancelState()
    
    // 初始/切换模式也保持最多 4 个文件并发，刷新页面后同样受限。
    this.setConcurrencyLimitEnabled(true)
    this.setMaxCacheSize(count)
    this.clearCache()
    
    // 优化：移除重复的 loadViewedFilesFromDatabase 调用
    // 已看过文件列表由前端 loadViewedFiles 统一加载，SQL 层面通过 isViewed 参数过滤
    
    if (onProgress) {
      onProgress(0, count)
    }
    
    try {
      // 构建排除列表：缓存中的文件 ID + 已看过模式下的本地已看过文件 ID
      const cachedFileIds = this.getCachedFileIds()
      let excludeFileIds = [...cachedFileIds]
      
      // 已看过模式下，需要额外排除本地已看过的文件，避免短期内重复
      if (viewedFilter === 'viewed') {
        const localViewedIds = Array.from(this.localViewedFileIds)
        excludeFileIds = [...new Set([...excludeFileIds, ...localViewedIds])]
      }
      
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
          excludeFileIds: excludeFileIds.length > 0 ? excludeFileIds : undefined,
          maxFileSize: this.maxVideoSize, // 过滤大于100MB的视频
          // 高级过滤参数（仅已看过模式）
          ratings: advancedFilters?.ratings,
          evaluations: advancedFilters?.evaluations,
          categories: advancedFilters?.categories,
          reasonFilter: advancedFilters?.reasonFilter,
          reasonKeyword: advancedFilters?.reasonKeyword,
          ratingEmptyFilter: advancedFilters?.ratingEmptyFilter,
          evaluationEmptyFilter: advancedFilters?.evaluationEmptyFilter,
          categoryEmptyFilter: advancedFilters?.categoryEmptyFilter
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
      
      // 检查是否数量不足
      const isInsufficient = data.isInsufficient || files.length < count
      const insufficientMessage = isInsufficient 
        ? `仅找到 ${files.length} 个符合条件的文件，未达到预加载目标 ${count} 个` 
        : ''
      
      const filesToPreload = files.map((f: any) => ({
        id: Number.isFinite(Number(f.id)) ? Number(f.id) : undefined,
        filename: f.filename,
        basename: f.basename,
        size: f.file_size || 0,
        type: f.file_type,
        lastmod: f.lastmod || '',
        creator: f.creator || null,
        creatorResolved: Boolean(f.creatorResolved),
        mediaRatingData: f.mediaRatingData ?? null,
        groupRatingData: f.groupRatingData ?? null,
      }))
      
      // 统一使用受控并发预加载：最大 4 个文件同时请求。
      let completedCount = 0
      let successCount = 0
      let failedCount = 0
      
      const preloadPromises = filesToPreload.map((file: any) =>
        this.preloadFile(config, file)
          .then(() => {
            completedCount++
            successCount++
            if (onProgress) {
              onProgress(completedCount, count)
            }
          })
          .catch((error) => {
            completedCount++
            failedCount++
            console.error(`[数据库模式] 预加载文件失败: ${file.filename}`, error)
            if (onProgress) {
              onProgress(completedCount, count)
            }
          })
      )
      
      await Promise.allSettled(preloadPromises)
      
      this.setConcurrencyLimitEnabled(true)
      console.log('[数据库模式] 初始/切换模式预加载完成，全程已按最多4个并发执行')
      
      // 构建返回消息
      let message = `数据库预加载完成：成功 ${successCount} 个，失败 ${failedCount} 个`
      if (insufficientMessage) {
        message = `${insufficientMessage}。${message}`
      }
      
      return {
        successCount,
        failedCount,
        message
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
    onProgress?: (current: number, total: number) => void,
    advancedFilters?: { // 高级过滤参数（仅已看过模式）
      ratings?: number[]
      evaluations?: string[]
      categories?: string[]
      reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
      reasonKeyword?: string
      ratingEmptyFilter?: boolean
      evaluationEmptyFilter?: boolean
      categoryEmptyFilter?: boolean
    }
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
    
    // 初始/切换模式也保持最多 4 个文件并发，刷新页面后同样受限。
    this.setConcurrencyLimitEnabled(true)
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
        paths: config.mediaPaths.join(','),
        maxFileSize: String(this.maxVideoSize) // 过滤大于100MB的视频
      })
      
      if (viewedFilter === 'viewed') {
        params.set('isViewed', 'true')
      } else if (viewedFilter === 'unviewed') {
        params.set('isViewed', 'false')
      }
      
      if (excludeParentPath) {
        params.set('excludeParentPath', excludeParentPath)
      }
      this.appendAdvancedFilterParams(params, advancedFilters)
      
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
        id: Number.isFinite(Number(f.id)) ? Number(f.id) : undefined,
        filename: f.filename,
        basename: f.basename,
        size: f.file_size || 0,
        type: f.file_type,
        lastmod: f.lastmod || '',
        creator: f.creator || null,
        creatorResolved: Boolean(f.creatorResolved),
        mediaRatingData: f.mediaRatingData ?? null,
        groupRatingData: f.groupRatingData ?? null,
      }))
      this.currentGroupPreloadTriggered = false
      
      const filesToPreload = this.currentGroupFiles.slice(0, Math.min(count, files.length))
      
      console.log(`[数据库模式] 选择图组 ${data.parentPath}，共 ${files.length} 个文件，预加载前 ${filesToPreload.length} 个`)
      
      // 统一使用受控并发预加载：最大 4 个文件同时请求。
      let completedCount = 0
      let successCount = 0
      let failedCount = 0
      
      const preloadPromises = filesToPreload.map((file: any) =>
        this.preloadFile(config, file)
          .then(() => {
            completedCount++
            successCount++
            if (onProgress) {
              onProgress(completedCount, Math.min(count, files.length))
            }
          })
          .catch((error) => {
            completedCount++
            failedCount++
            console.error(`[数据库模式] 预加载文件失败: ${file.filename}`, error)
            if (onProgress) {
              onProgress(completedCount, Math.min(count, files.length))
            }
          })
      )
      
      await Promise.allSettled(preloadPromises)
      
      this.setConcurrencyLimitEnabled(true)
      console.log('[数据库模式] 初始/切换模式预加载完成，全程已按最多4个并发执行')
      
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
    viewedFilter: string = 'unviewed',
    advancedFilters?: {
      ratings?: number[]
      evaluations?: string[]
      categories?: string[]
      reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
      reasonKeyword?: string
      ratingEmptyFilter?: boolean
      evaluationEmptyFilter?: boolean
      categoryEmptyFilter?: boolean
    }
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
        paths: config.mediaPaths.join(','),
        maxFileSize: String(this.maxVideoSize) // 过滤大于100MB的视频
      })
      
      if (viewedFilter === 'viewed') {
        params.set('isViewed', 'true')
      } else if (viewedFilter === 'unviewed') {
        params.set('isViewed', 'false')
      }
      
      if (currentParentPath) {
        params.set('excludeParentPath', currentParentPath)
      }
      this.appendAdvancedFilterParams(params, advancedFilters)
      
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
        id: Number.isFinite(Number(f.id)) ? Number(f.id) : undefined,
        filename: f.filename,
        basename: f.basename,
        size: f.file_size || 0,
        type: f.file_type,
        lastmod: f.lastmod || '',
        creator: f.creator || null,
        creatorResolved: Boolean(f.creatorResolved),
        mediaRatingData: f.mediaRatingData ?? null,
        groupRatingData: f.groupRatingData ?? null,
      }))
      
      const filesToPreload = this.nextGroupFiles.slice(0, Math.min(count, data.files.length))
      
      console.log(`[数据库模式] 下一组预加载：图组 ${data.parentPath}，共 ${data.files.length} 个文件，预加载前 ${filesToPreload.length} 个`)
      
      // ✅ 下一组预加载：使用并发控制（4个），避免阻塞评分API
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
    mediaFilter: string = 'all', // 媒体类型筛选：all/images/videos
    advancedFilters?: { // 高级过滤参数（仅已看过模式）
      ratings?: number[]
      evaluations?: string[]
      categories?: string[]
      reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
      reasonKeyword?: string
      ratingEmptyFilter?: boolean
      evaluationEmptyFilter?: boolean
      categoryEmptyFilter?: boolean
    }
  ): Promise<{
    actualCount: number  // 实际找到的文件数量
    requestedCount: number  // 请求的文件数量
    isInsufficient: boolean  // 是否数量不足
    allViewed?: boolean  // 是否已看完所有文件（需要重新开始）
  }> {
    // ✅ 智能判断：如果缓存为空，自动当作初始加载（切换模式后的场景）
    const isActuallyInitialLoad = isInitialLoad || this.cache.size === 0
    
    // 初始加载时先重置取消状态（避免被旧的 AbortController 影响），
    // 但仍然保持最多 4 个文件并发。
    if (isActuallyInitialLoad) {
      this.resetCancelState()
      await new Promise(resolve => setTimeout(resolve, 50))
      this.setConcurrencyLimitEnabled(true)
      console.log('[数据库模式] 检测到初始/切换模式加载，已重置取消状态并启用最多4个并发限制')
    }
    else {
      this.setConcurrencyLimitEnabled(true)
      console.log('[数据库模式] 智能预加载补充，启用并发限制（最多4个）')
    }
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log('[数据库模式] 预加载已取消，跳过缓存补齐')
      return {
        actualCount: 0,
        requestedCount: targetCount,
        isInsufficient: true
      }
    }
    
    this.setMaxCacheSize(targetCount)
    
    const currentCacheSize = this.cache.size
    if (currentCacheSize >= targetCount) {
      console.log('[数据库模式] 缓存已满，无需补齐')
      if (onProgress) {
        onProgress(currentCacheSize, targetCount)
      }
      this.setConcurrencyLimitEnabled(true)
      return {
        actualCount: currentCacheSize,
        requestedCount: targetCount,
        isInsufficient: false
      }
    }
    
    const needCount = targetCount - currentCacheSize
    console.log(`[数据库模式] 缓存不足，需要补齐 ${needCount} 个文件，随机性: ${randomness}，媒体类型: ${mediaFilter}`)
    
    if (onProgress) {
      onProgress(currentCacheSize, targetCount)
    }
    
    try {
      // 构建排除列表：缓存中的文件 ID + 已看过模式下的本地已看过文件 ID
      const cachedFileIds = this.getCachedFileIds()
      let excludeFileIds = [...cachedFileIds]
      
      // 已看过模式下，需要额外排除本地已看过的文件，避免短期内重复
      if (viewedFilter === 'viewed') {
        const localViewedIds = Array.from(this.localViewedFileIds)
        excludeFileIds = [...new Set([...excludeFileIds, ...localViewedIds])]
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
          excludeFileIds: excludeFileIds.length > 0 ? excludeFileIds : undefined,
          maxFileSize: this.maxVideoSize, // 过滤大于100MB的视频
          // 高级过滤参数（仅已看过模式）
          ratings: advancedFilters?.ratings,
          evaluations: advancedFilters?.evaluations,
          categories: advancedFilters?.categories,
          reasonFilter: advancedFilters?.reasonFilter,
          reasonKeyword: advancedFilters?.reasonKeyword,
          ratingEmptyFilter: advancedFilters?.ratingEmptyFilter,
          evaluationEmptyFilter: advancedFilters?.evaluationEmptyFilter,
          categoryEmptyFilter: advancedFilters?.categoryEmptyFilter
        })
      })
      if (!response.ok) {
        throw new Error('从数据库获取文件失败')
      }
      
      const data = await response.json()
      
      if (!data.hasData || data.files.length === 0) {
        console.log('[数据库模式] 没有可用的文件进行补齐')
        
        // ✅ 检查是否因为已看完所有文件导致无文件可加载
        if (viewedFilter === 'viewed' && this.localViewedFiles.size > 0) {
          console.log(`[数据库模式] 已看过 ${this.localViewedFiles.size} 个文件，可能已看完所有符合条件的文件`)
          // 返回特殊标志，表示已看完一圈
          return {
            actualCount: 0,
            requestedCount: needCount,
            isInsufficient: true,
            allViewed: true  // 新增标志：已看完所有文件
          }
        }
        
        this.setConcurrencyLimitEnabled(true)
        return {
          actualCount: 0,
          requestedCount: needCount,
          isInsufficient: true
        }
      }
      
      // ✅ 关键：在这里就判断数量是否不足
      const actualFileCount = data.files.length
      const isInsufficient = data.isInsufficient || actualFileCount < needCount
      
      if (isInsufficient) {
        console.warn(`⚠️ [数据库模式] 补齐数量不足：仅找到 ${actualFileCount} 个文件，需要 ${needCount} 个`)
      }
      
      const filesToPreload = data.files.map((f: any) => ({
        id: Number.isFinite(Number(f.id)) ? Number(f.id) : undefined,
        filename: f.filename,
        basename: f.basename,
        size: f.file_size || 0,
        type: f.file_type,
        lastmod: f.lastmod || '',
        creator: f.creator || null,
        creatorResolved: Boolean(f.creatorResolved),
        mediaRatingData: f.mediaRatingData ?? null,
        groupRatingData: f.groupRatingData ?? null,
      }))
      
      // ✅ 立即返回结果（不等待文件下载完成）
      const result = {
        actualCount: actualFileCount,
        requestedCount: needCount,
        isInsufficient
      }
      
      // 🔥 在后台异步下载文件（不阻塞返回）
      Promise.allSettled(
        filesToPreload.map((file: any) =>
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
      ).then(() => {
        this.setConcurrencyLimitEnabled(true)
        if (isActuallyInitialLoad) {
          console.log('[数据库模式] 初始/切换模式加载完成，全程已按最多4个并发执行')
        }
      })
      
      return result
    } catch (error) {
      console.error('[数据库模式] 补充缓存失败:', error)
      this.setConcurrencyLimitEnabled(true)
      return {
        actualCount: 0,
        requestedCount: targetCount,
        isInsufficient: true
      }
    }
  }

  // 从数据库获取随机大视频文件（大视频模式）
  async getRandomLargeVideoFromDatabase(
    config: any,
    viewedFilter: string = 'unviewed',
    minFileSize: number = 100 * 1024 * 1024,
    excludeFileIds: number[] = []
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
          excludeFileIds: excludeFileIds.length > 0 ? excludeFileIds : undefined
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
        id: Number.isFinite(Number(data.files[0].id)) ? Number(data.files[0].id) : undefined,
        filename: data.files[0].filename,
        basename: data.files[0].basename,
        size: data.files[0].file_size || 0,
        type: 'file',
        lastmod: data.files[0].lastmod || '',
        creator: data.files[0].creator || null,
        creatorResolved: Boolean(data.files[0].creatorResolved),
        mediaRatingData: data.files[0].mediaRatingData ?? null,
        groupRatingData: data.files[0].groupRatingData ?? null,
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
    
    const currentGroupFilepaths = new Set(this.currentGroupFiles.map(f => f.filename))
    
    // ✅ 剩余文件预加载：使用并发控制（4个），避免阻塞评分API
    const preloadPromises = remainingFiles.map((file) => 
      this.preloadFile(config, file).then(() => {  // 使用带并发控制的方法
        // 检查文件是否还属于当前图组
        if (!currentGroupFilepaths.has(file.filename)) {
          console.log('[数据库模式] 检测到图组已切换，文件已不属于当前组')
        }
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
    
    await Promise.allSettled(preloadPromises)
    
    console.log('[数据库模式] 当前图组剩余文件预加载完成')
  }
  
  //#endregion

  //#region 兼容方法（用于替代 preloadManager）
  
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
    onProgress?: (current: number, total: number) => void,
    advancedFilters?: { // 高级过滤参数（仅已看过模式）
      ratings?: number[]
      evaluations?: string[]
      categories?: string[]
      reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
      reasonKeyword?: string
      ratingEmptyFilter?: boolean
      evaluationEmptyFilter?: boolean
      categoryEmptyFilter?: boolean
    }
  ): Promise<{
    successCount: number
    failedCount: number
    message: string
  }> {
    const result = await this.preloadGroupFromDatabase(config, count, viewedFilter, undefined, onProgress, advancedFilters)
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
    mediaFilter: string = 'all', // 媒体类型筛选：all/images/videos
    advancedFilters?: { // 高级过滤参数（仅已看过模式）
      ratings?: number[]
      evaluations?: string[]
      categories?: string[]
      reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
      reasonKeyword?: string
      ratingEmptyFilter?: boolean
      evaluationEmptyFilter?: boolean
      categoryEmptyFilter?: boolean
    }
  ): Promise<{
    actualCount: number
    requestedCount: number
    isInsufficient: boolean
    allViewed?: boolean
  }> {
    return this.refillCacheFromDatabase(config, targetCount, viewedFilter, onProgress, isInitialLoad, currentParentPath, randomness, mediaFilter, advancedFilters)
  }

  // 兼容 preloadManager.preloadNextGroup - 从数据库预加载下一个图组
  async preloadNextGroup(
    config: any,
    _allFiles: any[], // 忽略，数据库模式不需要文件列表
    count: number = 10,
    viewedFilter: string = 'unviewed',
    advancedFilters?: {
      ratings?: number[]
      evaluations?: string[]
      categories?: string[]
      reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
      reasonKeyword?: string
      ratingEmptyFilter?: boolean
      evaluationEmptyFilter?: boolean
      categoryEmptyFilter?: boolean
    }
  ): Promise<void> {
    return this.preloadNextGroupFromDatabase(config, count, viewedFilter, advancedFilters)
  }

  // 兼容 preloadManager.smartPreload - 智能预加载（支持一次预加载多个文件，带补充重试）
  async smartPreload(
    config: any,
    _allFiles: any[], // 忽略，数据库模式不需要文件列表
    currentFile: any, // 用于提取当前目录路径
    maxCount: number = 10,
    viewedFilter: string = 'unviewed',
    randomness: number = 1, // 随机性：0=优先当前目录，1=完全随机
    mediaFilter: string = 'all', // 媒体类型筛选：all/images/videos
    advancedFilters?: { // 高级过滤参数（仅已看过模式）
      ratings?: number[]
      evaluations?: string[]
      categories?: string[]
      reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
      reasonKeyword?: string
      ratingEmptyFilter?: boolean
      evaluationEmptyFilter?: boolean
      categoryEmptyFilter?: boolean
    },
    requestCount: number = 1 // ✅ 新增参数：需要预加载的数量（默认1）
  ): Promise<void> {
    if (!currentFile) return
    
    // 检查是否已取消
    if (this.isPreloadCancelled()) {
      console.log('[数据库模式] 预加载已取消，跳过智能预加载')
      return
    }
    
    // ✅ 确保并发限制已启用（智能预加载必须受限制）
    this.setConcurrencyLimitEnabled(true)
    
    // 更新最大缓存大小
    this.setMaxCacheSize(maxCount)
    
    // 检查缓存是否已满
    const currentCacheSize = this.cache.size
    if (currentCacheSize >= maxCount) {
      console.log('[数据库模式] 缓存已满，无需智能预加载')
      return
    }
    
    // 从当前文件提取父目录路径
    const currentParentPath = currentFile?.filename 
      ? currentFile.filename.substring(0, currentFile.filename.lastIndexOf('/'))
      : undefined
    
    // ✅ 补充重试逻辑：最多重试1次
    const maxRetries = 1
    let successCount = 0
    
    for (let retryAttempt = 0; retryAttempt <= maxRetries; retryAttempt++) {
      // 计算本次需要预加载的数量
      const currentCacheSize = this.cache.size
      const needCount = Math.min(
        requestCount - successCount,  // 还需要多少
        maxCount - currentCacheSize   // 缓存还能放多少
      )
      
      if (needCount <= 0) {
        console.log('[数据库模式] 缓存已满或已达目标数量，停止预加载')
        break
      }
      
      console.log(`[数据库模式] 智能预加载 (尝试 ${retryAttempt + 1}/${maxRetries + 1})：当前缓存 ${currentCacheSize} 个，本次预加载 ${needCount} 个，筛选条件: ${viewedFilter}，随机性: ${randomness}，媒体类型: ${mediaFilter}`)
      
      try {
        // 构建排除列表：当前文件 ID + 缓存中的文件 ID + 已看过模式下的本地已看过文件 ID
        const cachedFileIds = this.getCachedFileIds()
        let excludeFileIds = [...cachedFileIds]
        const currentFileId = Number(currentFile?.id)
        if (Number.isFinite(currentFileId) && currentFileId > 0 && !excludeFileIds.includes(currentFileId)) {
          excludeFileIds.push(currentFileId)
        }
        
        // 已看过模式下，需要额外排除本地已看过的文件，避免短期内重复
        if (viewedFilter === 'viewed') {
          const localViewedIds = Array.from(this.localViewedFileIds)
          excludeFileIds = [...new Set([...excludeFileIds, ...localViewedIds])]
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
            excludeFileIds: excludeFileIds.length > 0 ? excludeFileIds : undefined,
            maxFileSize: this.maxVideoSize, // 过滤大于100MB的视频
            // 高级过滤参数（仅已看过模式）
            ratings: advancedFilters?.ratings,
            evaluations: advancedFilters?.evaluations,
            categories: advancedFilters?.categories,
            reasonFilter: advancedFilters?.reasonFilter,
            reasonKeyword: advancedFilters?.reasonKeyword,
            ratingEmptyFilter: advancedFilters?.ratingEmptyFilter,
            evaluationEmptyFilter: advancedFilters?.evaluationEmptyFilter,
            categoryEmptyFilter: advancedFilters?.categoryEmptyFilter
          })
        })
        
        if (!response.ok) {
          throw new Error('从数据库获取文件失败')
        }
        
        const data = await response.json()
        
        if (!data.hasData || data.files.length === 0) {
          console.log('[数据库模式] 没有可用的文件进行智能预加载')
          break
        }
        
        // 检查是否数量不足
        const isInsufficient = data.isInsufficient || data.files.length < needCount
        if (isInsufficient) {
          console.warn(`⚠️ [数据库模式] 智能预加载数量不足：仅找到 ${data.files.length} 个文件，需要 ${needCount} 个`)
        }
        
        // ✅ 将所有文件转换为预加载格式
        const filesToPreload = data.files.map((f: any) => ({
          id: Number.isFinite(Number(f.id)) ? Number(f.id) : undefined,
          filename: f.filename,
          basename: f.basename,
          size: f.file_size || 0,
          type: f.file_type,
          lastmod: f.lastmod || '',
          creator: f.creator || null,
          creatorResolved: Boolean(f.creatorResolved),
          mediaRatingData: f.mediaRatingData ?? null,
          groupRatingData: f.groupRatingData ?? null,
        }))
        
        console.log(`[数据库模式] 开始并行预加载 ${filesToPreload.length} 个文件（受并发控制，最多4个同时进行）`)
        
        // ✅ 并行预加载所有文件（受并发控制，最多4个）
        // preloadFile 内部有 acquirePreloadSlot 控制，不会超过并发限制
        // preloadFile 内部也有快速重试机制（最多重试1次）
        const results = await Promise.allSettled(
          filesToPreload.map((file: any) => this.preloadFile(config, file))
        )
        
        // 统计本次结果
        const batchSuccess = results.filter(r => r.status === 'fulfilled').length
        const batchFailed = results.filter(r => r.status === 'rejected').length
        successCount += batchSuccess
        
        console.log(`[数据库模式] 本批次预加载完成: 成功 ${batchSuccess} 个，失败 ${batchFailed} 个`)
        
        // 如果有失败且还有重试机会，进行补充重试
        if (batchFailed > 0 && retryAttempt < maxRetries) {
          console.warn(`[数据库模式] 检测到 ${batchFailed} 个失败，将重新获取替代文件 (补充重试 ${retryAttempt + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, 1000))  // 等待1秒后重试
          // 继续下一次循环，重新获取失败数量的文件
        } else {
          // 没有失败或已达重试上限，结束循环
          break
        }
        
      } catch (error) {
        console.error('[数据库模式] 智能预加载失败:', error)
        // 如果还有重试机会，继续重试
        if (retryAttempt < maxRetries) {
          console.warn(`[数据库模式] 将进行补充重试 (${retryAttempt + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, 1000))
        } else {
          break
        }
      }
    }
    
    console.log(`[数据库模式] 智能预加载最终完成: 请求 ${requestCount} 个，成功 ${successCount} 个`)
  }
  
  //#endregion
}

// 创建全局数据库预加载管理器实例
export const databasePreloadManager = new DatabasePreloadManager()

export default databasePreloadManager
