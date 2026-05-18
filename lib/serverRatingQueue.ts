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
  private failedTasks: FailedTask[] = []
  private isProcessing = false
  private maxRetries = 3
  private processingInterval: NodeJS.Timeout | null = null
  private maxFailedTasks = 100

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
      createdAt: new Date(),
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
      return
    }

    this.processingInterval = setInterval(() => {
      void this.processQueue()
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
      const batchSize = Math.min(10, this.queue.length)

      for (let i = 0; i < batchSize; i += 1) {
        if (this.queue.length === 0) break

        const task = this.queue[0]
        const success = await this.processTask(task)

        if (success) {
          this.queue.shift()
          console.log(`✅ [评分队列] 任务完成: ${task.fileName}, 剩余: ${this.queue.length}`)
        } else if (task.retryCount >= this.maxRetries) {
          this.failedTasks.push({
            task,
            failedAt: new Date(),
            reason: task.errorMessage || '未知错误',
          })

          if (this.failedTasks.length > this.maxFailedTasks) {
            this.failedTasks.shift()
          }

          this.queue.shift()
          console.error(`❌ [评分队列] 任务失败: ${task.fileName}, 原因: ${task.errorMessage}`)
        } else {
          this.queue.shift()
          this.queue.push(task)
          console.log(`🔄 [评分队列] 任务重试 (${task.retryCount}/${this.maxRetries}): ${task.fileName}`)
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

      ensureInitialized()

      mediaRatings.save({
        filePath: task.filePath,
        fileName: task.fileName,
        fileType: task.fileType,
        rating: task.rating,
        recommendationReason: task.recommendationReason,
        customEvaluation: task.customEvaluation,
        category: task.category,
        isViewed: task.isViewed,
      })

      if (task.customEvaluation) {
        const evaluations = Array.isArray(task.customEvaluation)
          ? task.customEvaluation
          : [task.customEvaluation]

        evaluations.forEach((evaluation) => {
          if (typeof evaluation === 'string' && evaluation.trim()) {
            customEvaluations.add(evaluation.trim())
          }
        })
      }

      if (task.category) {
        const categoriesList = Array.isArray(task.category)
          ? task.category
          : [task.category]

        categoriesList.forEach((category) => {
          if (typeof category === 'string' && category.trim()) {
            categories.add(category.trim())
          }
        })
      }

      return true
    } catch (error: any) {
      console.error(`❌ [评分队列] 处理失败: ${task.fileName}`, error)
      task.retryCount += 1
      task.errorMessage = error.message
      return false
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
      tasks: this.queue.map((task) => ({
        taskId: task.taskId,
        fileName: task.fileName,
        retryCount: task.retryCount,
        createdAt: task.createdAt,
      })),
    }
  }

  /**
   * 获取失败的任务列表
   */
  getFailedTasks() {
    return this.failedTasks.map((failed) => ({
      taskId: failed.task.taskId,
      fileName: failed.task.fileName,
      filePath: failed.task.filePath,
      failedAt: failed.failedAt,
      reason: failed.reason,
      retryCount: failed.task.retryCount,
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
    this.failedTasks.forEach((failed) => {
      failed.task.retryCount = 0
      failed.task.errorMessage = undefined
      this.queue.push(failed.task)
    })
    this.failedTasks = []
    console.log(`🔄 [评分队列] 已重新添加 ${count} 个失败任务到队列`)
    return count
  }
}

export const serverRatingQueue = global.__serverRatingQueue || new ServerRatingQueue()

if (process.env.NODE_ENV !== 'production') {
  global.__serverRatingQueue = serverRatingQueue
}
