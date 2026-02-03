/**
 * 服务器端评分队列管理器（简化版）
 * 
 * 特点：
 * 1. 完全在服务器端运行
 * 2. 使用内存存储队列（轻量、快速）
 * 3. 后台自动处理队列任务
 * 4. 记录失败任务，方便排查
 */

import { mediaRatings, customEvaluations, categories, ensureInitialized } from './database'

interface RatingTask {
  taskId: string
  filePath: string
  fileName: string
  fileType: string
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
  retryCount: number
  createdAt: Date
  errorMessage?: string
}

interface FailedTask {
  task: RatingTask
  failedAt: Date
  reason: string
}

// 使用 globalThis 缓存队列实例，避免开发模式下重复初始化
declare global {
  var __serverRatingQueue: ServerRatingQueue | undefined
}

class ServerRatingQueue {
  private queue: RatingTask[] = []
  private failedTasks: FailedTask[] = [] // 记录失败的任务
  private isProcessing = false
  private maxRetries = 3
  private processingInterval: NodeJS.Timeout | null = null
  private maxFailedTasks = 100 // 最多保留 100 个失败任务，防止内存泄漏

  constructor() {
    this.startProcessing()
  }

  /**
   * 添加评分任务到队列
   */
  addTask(data: {
    filePath: string
    fileName: string
    fileType: string
    rating?: number
    recommendationReason?: string
    customEvaluation?: string | string[]
    category?: string | string[]
    isViewed?: boolean
  }): string {
    const taskId = `rating_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    
    const task: RatingTask = {
      taskId,
      ...data,
      retryCount: 0,
      createdAt: new Date()
    }

    this.queue.push(task)
    console.log(`📥 [评分队列] 任务已添加: ${data.fileName}, 队列长度: ${this.queue.length}`)

    return taskId
  }

  /**
   * 启动后台处理
   */
  private startProcessing() {
    if (this.processingInterval) {
      return // 已经启动
    }

    // 每隔 100ms 检查一次队列
    this.processingInterval = setInterval(() => {
      this.processQueue()
    }, 100)

    console.log('✅ [评分队列] 后台处理已启动')
  }

  /**
   * 停止后台处理
   */
  stopProcessing() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval)
      this.processingInterval = null
      console.log('⏹️ [评分队列] 后台处理已停止')
    }
  }

  /**
   * 处理队列中的任务
   */
  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return
    }

    this.isProcessing = true

    try {
      // 一次处理最多 10 个任务
      const batchSize = Math.min(10, this.queue.length)
      
      for (let i = 0; i < batchSize; i++) {
        if (this.queue.length === 0) break
        
        const task = this.queue[0]
        const success = await this.processTask(task)
        
        if (success) {
          // 成功：从队列中移除
          this.queue.shift()
          console.log(`✅ [评分队列] 任务完成: ${task.fileName}, 剩余: ${this.queue.length}`)
        } else {
          // 失败：检查重试次数
          if (task.retryCount >= this.maxRetries) {
            // 超过最大重试次数，记录失败并移除
            this.failedTasks.push({
              task,
              failedAt: new Date(),
              reason: task.errorMessage || '未知错误'
            })
            
            // 限制失败任务数量，防止内存泄漏
            if (this.failedTasks.length > this.maxFailedTasks) {
              this.failedTasks.shift() // 移除最旧的失败任务
            }
            
            this.queue.shift()
            console.error(`❌ [评分队列] 任务失败: ${task.fileName}, 原因: ${task.errorMessage}`)
          } else {
            // 将任务移到队列末尾等待重试
            this.queue.shift()
            this.queue.push(task)
            console.log(`🔄 [评分队列] 任务重试 (${task.retryCount}/${this.maxRetries}): ${task.fileName}`)
          }
        }
      }
    } catch (error) {
      console.error('❌ [评分队列] 处理队列失败:', error)
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * 处理单个任务
   */
  private async processTask(task: RatingTask): Promise<boolean> {
    try {
      console.log(`🚀 [评分队列] 开始处理: ${task.fileName}`)

      // 确保数据库已初始化
      ensureInitialized()

      // 执行数据库写入
      mediaRatings.save({
        filePath: task.filePath,
        fileName: task.fileName,
        fileType: task.fileType,
        rating: task.rating,
        recommendationReason: task.recommendationReason,
        customEvaluation: task.customEvaluation,
        category: task.category,
        isViewed: task.isViewed
      })

      // 更新自定义评价标签
      if (task.customEvaluation) {
        const evaluations = Array.isArray(task.customEvaluation) 
          ? task.customEvaluation 
          : [task.customEvaluation]
        evaluations.forEach(evaluation => {
          if (typeof evaluation === 'string' && evaluation.trim()) {
            customEvaluations.add(evaluation.trim())
          }
        })
      }

      // 更新分类
      if (task.category) {
        const categoriesList = Array.isArray(task.category) 
          ? task.category 
          : [task.category]
        categoriesList.forEach(cat => {
          if (typeof cat === 'string' && cat.trim()) {
            categories.add(cat.trim())
          }
        })
      }

      return true // 成功
    } catch (error: any) {
      console.error(`❌ [评分队列] 处理失败: ${task.fileName}`, error)
      task.retryCount++
      task.errorMessage = error.message
      return false // 失败
    }
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      pending: this.queue.length,
      isProcessing: this.isProcessing,
      failed: this.failedTasks.length,
      tasks: this.queue.map(task => ({
        taskId: task.taskId,
        fileName: task.fileName,
        retryCount: task.retryCount,
        createdAt: task.createdAt
      }))
    }
  }

  /**
   * 获取失败的任务列表
   */
  getFailedTasks() {
    return this.failedTasks.map(failed => ({
      taskId: failed.task.taskId,
      fileName: failed.task.fileName,
      filePath: failed.task.filePath,
      failedAt: failed.failedAt,
      reason: failed.reason,
      retryCount: failed.task.retryCount
    }))
  }

  /**
   * 清除失败任务记录
   */
  clearFailedTasks() {
    const count = this.failedTasks.length
    this.failedTasks = []
    console.log(`🗑️ [评分队列] 已清除 ${count} 个失败任务记录`)
    return count
  }

  /**
   * 重试失败的任务
   */
  retryFailedTasks() {
    const count = this.failedTasks.length
    this.failedTasks.forEach(failed => {
      // 重置重试次数
      failed.task.retryCount = 0
      failed.task.errorMessage = undefined
      this.queue.push(failed.task)
    })
    this.failedTasks = []
    console.log(`🔄 [评分队列] 已重新添加 ${count} 个失败任务到队列`)
    return count
  }
}

// 使用全局缓存，避免开发模式下重复初始化
export const serverRatingQueue = global.__serverRatingQueue || new ServerRatingQueue()

if (process.env.NODE_ENV !== 'production') {
  global.__serverRatingQueue = serverRatingQueue
}
