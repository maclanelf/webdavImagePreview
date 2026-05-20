/**
 * 扫描队列管理器
 * 
 * 功能：
 * 1. 串行执行扫描任务，防止并发触发风控
 * 2. 任务持久化到数据库，服务重启后可恢复
 * 3. 任务间随机延迟 1-5 分钟
 * 4. 风控检测：基于 webdav-optimized 中的 rateLimitTriggered 标记
 * 5. 风控退避重试（15分钟、20分钟、30分钟、1小时、之后每小时）
 * 6. 风控触发后暂停整个队列，等待解除后重试当前任务
 */

import { recursiveScanTasks } from './database'
import { getWebDAVClient, recursiveScanDirectory } from './webdav-optimized'
import { scanCache } from './scanCacheRepository'
import { scanFiles } from './scanFilesRepository'
import { writeScanLog } from './scanLogger'

// 风控退避时间（毫秒）
const RATE_LIMIT_BACKOFF = [
  15 * 60 * 1000,   // 15 分钟
  20 * 60 * 1000,   // 20 分钟
  30 * 60 * 1000,   // 30 分钟
  60 * 60 * 1000,   // 1 小时
  60 * 60 * 1000,   // 之后每小时重试
]

// 任务间延迟范围（毫秒）
const MIN_TASK_DELAY = 1 * 60 * 1000  // 1 分钟
const MAX_TASK_DELAY = 5 * 60 * 1000  // 5 分钟

// 数据库更新间隔（毫秒）
const DB_UPDATE_INTERVAL = 3000  // 每 3 秒更新一次

// 队列任务状态（与数据库保持一致）
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'rate_limited' | 'waiting' | 'paused' | 'cancelled'

// 队列任务接口
interface QueueTask {
  taskId: string
  webdavUrl: string
  webdavUsername: string
  webdavPassword: string
  path: string
  concurrency: number
  forceRescan: boolean
  status: TaskStatus
  createdAt: Date
  delayUntil?: Date
  error?: string
  retryCount: number
}

// 队列状态接口
interface QueueStatus {
  isProcessing: boolean
  currentTask: QueueTask | null
  pendingTasks: QueueTask[]
  queueLength: number
  rateLimited: boolean
  rateLimitedUntil: Date | null
  nextTaskDelay: number | null
}

class ScanQueueManager {
  private queue: QueueTask[] = []
  private isProcessing = false
  private currentTask: QueueTask | null = null
  private rateLimitRetryIndex = 0  // 当前风控退避索引
  private rateLimited = false
  private rateLimitedUntil: Date | null = null
  private nextTaskDelayUntil: Date | null = null
  private processLoopTimer: NodeJS.Timeout | null = null

  constructor() {
    // 服务启动时从数据库恢复未完成的任务
    this.recoverFromDatabase()
  }

  // 从数据库恢复未完成的任务
  private async recoverFromDatabase() {
    try {
      const activeTasks = await recursiveScanTasks.getActive() as any[]
      
      // 首先检查是否有任何任务处于风控状态
      // 即使没有活跃任务，也要恢复风控状态
      let maxRateLimitedUntil: Date | null = null
      let maxRetryCount = 0
      
      if (activeTasks.length > 0) {
        console.log(`🔄 [扫描队列] 从数据库恢复 ${activeTasks.length} 个未完成任务`)
        
        for (const task of activeTasks) {
          // 将 running 状态的任务重置为 pending（因为服务重启了，之前的执行已中断）
          if (task.status === 'running') {
            console.log(`⚠️ [扫描队列] 任务 ${task.root_path} 状态为 running，重置为 pending`)
            await recursiveScanTasks.updateStatus(task.task_id, 'pending', {
              errorMessage: '服务重启，任务重新排队'
            })
          }
          
          const scanSettings = JSON.parse(task.scan_settings || '{}')
          
          // 检查是否有风控状态（找最大的风控时间）
          if (task.rate_limited_until) {
            const rateLimitedUntil = new Date(task.rate_limited_until)
            if (rateLimitedUntil > new Date()) {
              if (!maxRateLimitedUntil || rateLimitedUntil > maxRateLimitedUntil) {
                maxRateLimitedUntil = rateLimitedUntil
                maxRetryCount = task.retry_count || 0
              }
            }
          }
          
          // 检查是否有延迟等待
          let delayUntil: Date | undefined
          if (task.delay_until) {
            const delay = new Date(task.delay_until)
            if (delay > new Date()) {
              delayUntil = delay
            }
          }
          
          this.queue.push({
            taskId: task.task_id,
            webdavUrl: task.webdav_url,
            webdavUsername: task.webdav_username,
            webdavPassword: task.webdav_password,
            path: task.root_path,
            concurrency: scanSettings.concurrency || 10,
            forceRescan: scanSettings.forceRescan || false,
            status: 'pending',
            createdAt: new Date(task.created_at),
            delayUntil,
            retryCount: task.retry_count || 0
          })
        }
        
        // 恢复风控状态
        if (maxRateLimitedUntil) {
          this.rateLimited = true
          this.rateLimitedUntil = maxRateLimitedUntil
          this.rateLimitRetryIndex = maxRetryCount
          console.log(`⚠️ [扫描队列] 恢复风控状态，等待至 ${maxRateLimitedUntil.toLocaleString()}，重试次数: ${maxRetryCount}`)
        }
        
        // 开始处理队列
        this.startProcessLoop()
      } else {
        console.log(`📭 [扫描队列] 没有未完成的任务需要恢复`)
      }
    } catch (error) {
      console.error('❌ [扫描队列] 恢复任务失败:', error)
    }
  }

  // 生成唯一任务ID
  private generateTaskId(): string {
    return `scan_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
  }

  // 生成随机延迟时间（1-5分钟）
  private generateRandomDelay(): number {
    return Math.floor(Math.random() * (MAX_TASK_DELAY - MIN_TASK_DELAY + 1)) + MIN_TASK_DELAY
  }

  // 添加任务到队列
  async addTask(params: {
    webdavUrl: string
    webdavUsername: string
    webdavPassword: string
    path: string
    concurrency?: number
    forceRescan?: boolean
  }): Promise<{ taskId: string; position: number; isRunning: boolean; delayUntil?: Date }> {
    // 检查是否已有相同路径的任务在队列中或正在执行
    const existingTask = this.findExistingTask(
      params.webdavUrl,
      params.webdavUsername,
      params.path
    )
    
    if (existingTask) {
      const position = this.getTaskPosition(existingTask.taskId)
      return {
        taskId: existingTask.taskId,
        position,
        isRunning: existingTask.status === 'running',
        delayUntil: existingTask.delayUntil
      }
    }

    const taskId = this.generateTaskId()
    
    // 注意：不在添加任务时设置 delayUntil
    // delayUntil 应该在上一个任务完成后才设置（通过 setNextTaskDelay 方法）
    // 这样可以确保延迟时间是从上一个任务完成时开始计算，而不是从加入队列时开始
    
    const task: QueueTask = {
      taskId,
      webdavUrl: params.webdavUrl,
      webdavUsername: params.webdavUsername,
      webdavPassword: params.webdavPassword,
      path: params.path,
      concurrency: params.concurrency || 10,
      forceRescan: params.forceRescan || false,
      status: 'pending',
      createdAt: new Date(),
      delayUntil: undefined,  // 不在添加时设置延迟
      retryCount: 0
    }

    // 保存到数据库
    try {
      await recursiveScanTasks.create({
        taskId,
        webdavUrl: params.webdavUrl,
        webdavUsername: params.webdavUsername,
        webdavPassword: params.webdavPassword,
        rootPath: params.path,
        scanSettings: {
          concurrency: params.concurrency || 10,
          forceRescan: params.forceRescan || false
        }
      })
    } catch (error) {
      console.error('❌ [扫描队列] 保存任务到数据库失败:', error)
    }

    // 添加到队列
    this.queue.push(task)
    console.log(`📥 [扫描队列] 添加任务: ${params.path}, 队列位置: ${this.queue.length}`)

    // 开始处理队列
    this.startProcessLoop()

    return {
      taskId,
      position: this.queue.length,
      isRunning: false,
      delayUntil: undefined  // 新任务没有延迟，延迟会在前一个任务完成后设置
    }
  }

  // 查找已存在的任务
  private findExistingTask(
    webdavUrl: string,
    webdavUsername: string,
    path: string
  ): QueueTask | null {
    // 检查当前正在执行的任务
    if (
      this.currentTask &&
      this.currentTask.webdavUrl === webdavUrl &&
      this.currentTask.webdavUsername === webdavUsername &&
      this.currentTask.path === path &&
      (this.currentTask.status === 'running' || this.currentTask.status === 'waiting' || this.currentTask.status === 'rate_limited')
    ) {
      return this.currentTask
    }

    // 检查队列中的任务
    return this.queue.find(
      t =>
        t.webdavUrl === webdavUrl &&
        t.webdavUsername === webdavUsername &&
        t.path === path &&
        (t.status === 'pending' || t.status === 'running' || t.status === 'waiting' || t.status === 'rate_limited')
    ) || null
  }

  // 获取任务在队列中的位置
  private getTaskPosition(taskId: string): number {
    if (this.currentTask?.taskId === taskId) {
      return 0 // 正在执行
    }
    const index = this.queue.findIndex(t => t.taskId === taskId)
    return index >= 0 ? index + 1 : -1
  }

  // 启动处理循环
  private startProcessLoop() {
    if (this.processLoopTimer) {
      return // 已经在运行
    }
    
    this.processLoop()
  }

  // 处理循环
  private async processLoop() {
    // 清除之前的定时器
    if (this.processLoopTimer) {
      clearTimeout(this.processLoopTimer)
      this.processLoopTimer = null
    }

    // 检查风控状态
    if (this.rateLimited && this.rateLimitedUntil) {
      const now = new Date()
      if (now < this.rateLimitedUntil) {
        const waitTime = this.rateLimitedUntil.getTime() - now.getTime()
        console.log(`⏳ [扫描队列] 风控等待中，剩余 ${Math.ceil(waitTime / 60000)} 分钟`)
        this.processLoopTimer = setTimeout(() => this.processLoop(), Math.min(waitTime, 60000))
        return
      } else {
        // 风控时间已过，尝试恢复
        console.log(`✅ [扫描队列] 风控等待结束，尝试恢复扫描`)
        // 不立即清除风控状态，等任务成功后再清除
      }
    }

    // 如果正在处理或队列为空，退出
    if (this.isProcessing) {
      return
    }
    
    // 获取要处理的任务（优先处理 currentTask，即风控后重试的任务）
    let task: QueueTask | null = this.currentTask
    
    if (!task && this.queue.length > 0) {
      task = this.queue[0]
      
      // 检查任务延迟
      // delayUntil 是在上一个任务完成后设置的，表示需要等待一段时间再执行
      if (task.delayUntil && task.delayUntil > new Date()) {
        const waitTime = task.delayUntil.getTime() - Date.now()
        const waitMinutes = Math.floor(waitTime / 60000)
        const waitSeconds = Math.ceil((waitTime % 60000) / 1000)
        console.log(`⏳ [扫描队列] 任务 ${task.path} 等待中，剩余 ${waitMinutes}分${waitSeconds}秒`)
        this.nextTaskDelayUntil = task.delayUntil
        // 每 10 秒检查一次，或者等待时间到
        this.processLoopTimer = setTimeout(() => this.processLoop(), Math.min(waitTime, 10000))
        return
      }
      
      // 清除延迟状态
      this.nextTaskDelayUntil = null
      
      // 从队列中取出任务
      this.queue.shift()
      this.currentTask = task
    }
    
    if (!task) {
      console.log('📭 [扫描队列] 队列为空')
      return
    }
    
    this.nextTaskDelayUntil = null

    // 开始处理任务
    this.isProcessing = true
    task.status = 'running'

    console.log(`🚀 [扫描队列] 开始执行任务: ${task.path}, 剩余队列: ${this.queue.length}, 重试次数: ${task.retryCount}`)

    try {
      const result = await this.executeTask(task)
      
      // 检查是否触发风控
      if (result.rateLimitTriggered) {
        console.warn(`🚨 [扫描队列] 任务 ${task.path} 触发风控`)
        this.handleRateLimit(task)
      } else {
        // 任务成功完成
        task.status = 'completed'
        this.currentTask = null
        
        // 清除风控状态（如果有）
        if (this.rateLimited) {
          this.rateLimited = false
          this.rateLimitedUntil = null
          this.rateLimitRetryIndex = 0
          console.log(`✅ [扫描队列] 风控解除，恢复正常扫描`)
        }
        
        console.log(`✅ [扫描队列] 任务完成: ${task.path}`)
        
        // 设置下一个任务的延迟
        this.setNextTaskDelay()
      }
    } catch (error: any) {
      console.error(`❌ [扫描队列] 任务异常: ${task.path}`, error.message)
      
      // 异常也视为可能触发风控
      this.handleRateLimit(task, error.message)
    }

    this.isProcessing = false

    // 继续处理循环
    this.processLoopTimer = setTimeout(() => this.processLoop(), 1000)
  }

  // 处理风控
  private handleRateLimit(task: QueueTask, errorMessage?: string) {
    task.retryCount++
    task.status = 'rate_limited'
    task.error = errorMessage || '触发风控'
    
    // 计算退避时间
    const backoffIndex = Math.min(this.rateLimitRetryIndex, RATE_LIMIT_BACKOFF.length - 1)
    const backoffTime = RATE_LIMIT_BACKOFF[backoffIndex]
    
    this.rateLimited = true
    this.rateLimitedUntil = new Date(Date.now() + backoffTime)
    this.rateLimitRetryIndex++
    
    console.log(`🚨 [扫描队列] 触发风控！任务 ${task.path} 将在 ${Math.ceil(backoffTime / 60000)} 分钟后重试（第 ${this.rateLimitRetryIndex} 次退避）`)
    
    // 更新当前任务状态到数据库
    void recursiveScanTasks.updateStatus(task.taskId, 'rate_limited', {
      rateLimitedUntil: this.rateLimitedUntil.toISOString(),
      retryCount: task.retryCount,
      errorMessage: task.error
    })
    
    // 更新队列中所有任务的风控状态
    for (const queueTask of this.queue) {
      void recursiveScanTasks.updateStatus(queueTask.taskId, 'rate_limited', {
        rateLimitedUntil: this.rateLimitedUntil.toISOString()
      })
    }
    
    // 保持 currentTask 不变，等待风控解除后重试
  }

  // 设置下一个任务的延迟（在当前任务完成后调用）
  private setNextTaskDelay() {
    if (this.queue.length > 0) {
      const nextTask = this.queue[0]
      // 只有当任务没有延迟时才设置新的延迟
      // 这确保延迟是从当前任务完成时开始计算
      if (!nextTask.delayUntil || nextTask.delayUntil <= new Date()) {
        const delay = this.generateRandomDelay()
        nextTask.delayUntil = new Date(Date.now() + delay)
        
        const delayMinutes = Math.floor(delay / 60000)
        const delaySeconds = Math.ceil((delay % 60000) / 1000)
        
        // 更新数据库
        void recursiveScanTasks.updateStatus(nextTask.taskId, 'waiting', {
          delayUntil: nextTask.delayUntil.toISOString()
        })
        
        console.log(`⏰ [扫描队列] 下一个任务 ${nextTask.path} 将在 ${delayMinutes}分${delaySeconds}秒后执行`)
      }
    }
  }

  // 执行单个扫描任务
  private async executeTask(task: QueueTask): Promise<{ rateLimitTriggered: boolean }> {
    const { webdavUrl, webdavUsername, webdavPassword, path, concurrency, forceRescan, taskId } = task

    // 更新数据库状态为 running
    await recursiveScanTasks.updateStatus(taskId, 'running', {
      currentPath: path
    })

    // 记录扫描开始日志
    writeScanLog({
      webdavUrl,
      webdavUsername,
      path,
      scanType: 'recursive',
      status: 'started'
    })

    const startTime = Date.now()
    const progressLogs: string[] = []
    let batchCount = 0
    let lastDbUpdateTime = Date.now()

    try {
      const client = getWebDAVClient({ url: webdavUrl, username: webdavUsername, password: webdavPassword })

      // 执行递归扫描
      const result = await recursiveScanDirectory(client, path, {
        concurrency,
        onProgress: (progress) => {
          batchCount++
          const logMessage = `批次 ${batchCount}: ${progress.scannedDirectories} 目录, ${progress.foundFiles} 文件 (${progress.percentage}%)`
          progressLogs.push(logMessage)

          // 间隔写入数据库（每 3 秒更新一次）
          const now = Date.now()
          if (now - lastDbUpdateTime >= DB_UPDATE_INTERVAL) {
            lastDbUpdateTime = now
            recursiveScanTasks.updateStatus(taskId, 'running', {
              currentPath: progress.currentPath || path,
              scannedDirectories: progress.scannedDirectories,
              totalDirectories: progress.totalDirectories,
              foundFiles: progress.foundFiles
            })
          }
        }
      })

      const duration = Date.now() - startTime

      // 检查是否触发风控
      if (result.rateLimitTriggered) {
        // 记录风控日志
        writeScanLog({
          webdavUrl,
          webdavUsername,
          path,
          scanType: 'recursive',
          status: 'failed',
          durationMs: duration,
          errorMessage: '触发风控，扫描中断',
          logDetails: [...progressLogs, `扫描被风控中断，已扫描 ${result.totalFiles} 个文件`].join('\n')
        })
        
        return { rateLimitTriggered: true }
      }

      if (!result || !result.files) {
        throw new Error('扫描结果无效')
      }

      // 如果强制重新扫描，清除旧缓存
      if (forceRescan) {
        await scanCache.delete(webdavUrl, webdavUsername, path)
      }

      // 保存到缓存
      const filesData = result.files.map(file => ({
        filename: file.filename,
        basename: file.basename,
        size: file.size,
        type: file.type,
        lastmod: file.lastmod,
      }))

      await scanCache.save({
        webdavUrl,
        webdavUsername,
        path,
        filesData: JSON.stringify(filesData),
        totalFiles: result.totalFiles,
        imageCount: result.imageCount,
        videoCount: result.videoCount,
        scanSettings: JSON.stringify({ concurrency })
      })
      console.log(`✅ [扫描队列] scan_cache 写入完成: ${path}, ${result.totalFiles} 个文件`)

      // 写入 scan_files 表
      const savedCache = await scanCache.get(webdavUrl, webdavUsername, path) as any
      let scanFilesLog = ''
      if (savedCache && savedCache.id) {
        const beforeStats = await scanFiles.getStats(savedCache.id)
        const beforeTotal = beforeStats.total
        const beforeViewed = beforeStats.viewed
        
        await scanFiles.deleteByCache(savedCache.id)
        await scanFiles.batchInsert(savedCache.id, filesData)
        const syncResult = await scanFiles.syncViewedFromRatings(savedCache.id)
        
        const afterStats = await scanFiles.getStats(savedCache.id)
        const afterTotal = afterStats.total
        const afterViewed = afterStats.viewed
        
        scanFilesLog = `写入前: 文件数量 ${beforeTotal}, 已看过 ${beforeViewed} | 写入后: 文件数量 ${afterTotal}, 同步已看过 ${afterViewed}`
        console.log(`✅ [扫描队列] scan_files ${scanFilesLog}`)
      }

      // 更新数据库状态为 completed
      await recursiveScanTasks.updateStatus(taskId, 'completed', {
        scannedDirectories: batchCount,
        foundFiles: result.totalFiles
      })

      // 记录扫描完成日志
      const logDetails = [
        ...progressLogs,
        `扫描完成: ${result.totalFiles} 文件 (图片: ${result.imageCount}, 视频: ${result.videoCount}), 耗时 ${duration}ms`,
        scanFilesLog
      ].filter(Boolean).join('\n')

      writeScanLog({
        webdavUrl,
        webdavUsername,
        path,
        scanType: 'recursive',
        status: 'completed',
        totalFiles: result.totalFiles,
        imageCount: result.imageCount,
        videoCount: result.videoCount,
        durationMs: duration,
        logDetails
      })

      return { rateLimitTriggered: false }

    } catch (error: any) {
      const duration = Date.now() - startTime

      // 更新数据库状态为 failed
      await recursiveScanTasks.updateStatus(taskId, 'failed', {
        errorMessage: error.message,
        retryCount: task.retryCount + 1
      })

      // 记录扫描失败日志
      writeScanLog({
        webdavUrl,
        webdavUsername,
        path,
        scanType: 'recursive',
        status: 'failed',
        durationMs: duration,
        errorMessage: error.message,
        logDetails: [...progressLogs, `扫描失败: ${error.message}`].join('\n')
      })

      throw error
    }
  }

  // 获取队列状态
  getQueueStatus(): QueueStatus {
    return {
      isProcessing: this.isProcessing,
      currentTask: this.currentTask,
      pendingTasks: [...this.queue],
      queueLength: this.queue.length,
      rateLimited: this.rateLimited,
      rateLimitedUntil: this.rateLimitedUntil,
      nextTaskDelay: this.nextTaskDelayUntil ? this.nextTaskDelayUntil.getTime() - Date.now() : null
    }
  }

  // 获取任务状态
  getTaskStatus(taskId: string): QueueTask | null {
    if (this.currentTask?.taskId === taskId) {
      return this.currentTask
    }
    return this.queue.find(t => t.taskId === taskId) || null
  }

  // 检查路径是否在队列中或正在扫描
  isPathInQueue(webdavUrl: string, webdavUsername: string, path: string): boolean {
    return this.findExistingTask(webdavUrl, webdavUsername, path) !== null
  }

  // 取消任务（仅限 pending 状态）
  cancelTask(taskId: string): boolean {
    const index = this.queue.findIndex(t => t.taskId === taskId && t.status === 'pending')
    if (index >= 0) {
      this.queue.splice(index, 1)
      recursiveScanTasks.updateStatus(taskId, 'cancelled')
      console.log(`🚫 [扫描队列] 取消任务: ${taskId}`)
      return true
    }
    return false
  }

  // 清空队列（仅限 pending 状态的任务）
  clearPendingTasks(): number {
    const pendingCount = this.queue.filter(t => t.status === 'pending').length
    this.queue = this.queue.filter(t => t.status !== 'pending')
    console.log(`🧹 [扫描队列] 清空 ${pendingCount} 个待处理任务`)
    return pendingCount
  }

  // 重置风控状态（手动恢复）
  resetRateLimit() {
    this.rateLimited = false
    this.rateLimitedUntil = null
    this.rateLimitRetryIndex = 0
    
    // 如果有当前任务，重置其状态
    if (this.currentTask) {
      this.currentTask.status = 'pending'
      this.currentTask.retryCount = 0
      void recursiveScanTasks.updateStatus(this.currentTask.taskId, 'pending', {
        rateLimitedUntil: undefined,
        retryCount: 0
      })
    }
    
    // 恢复队列中的任务状态
    for (const task of this.queue) {
        void recursiveScanTasks.updateStatus(task.taskId, 'pending', {
          rateLimitedUntil: undefined
        })
    }
    
    console.log(`🔄 [扫描队列] 手动重置风控状态`)
    
    // 重新开始处理
    this.startProcessLoop()
  }
}

// 创建全局单例
export const scanQueueManager = new ScanQueueManager()

export default scanQueueManager
