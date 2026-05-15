import { persistRatingTask, type RatingTaskPersistencePayload } from '../lib/ratingTaskPersistence'
import {
  claimNextPendingRatingTask,
  completeRatingTask,
  failRatingTask,
  hasPendingRatingTasks,
  resetStaleProcessingRatingTasks,
} from '../lib/ratingTaskQueueRepository'

interface RatingTask extends RatingTaskPersistencePayload {
  taskId: string
  retryCount: number
  createdAt: string
  errorMessage?: string
}

interface WorkerRequestMessage {
  type: 'wakeUp'
}

let isProcessing = false
const maxRetries = 3
let processTimer: NodeJS.Timeout | null = null
let isTerminating = false

function scheduleProcess(delayMs = 0) {
  if (processTimer) {
    return
  }

  processTimer = setTimeout(() => {
    processTimer = null
    void processQueue()
  }, delayMs)
}

async function processTask(task: RatingTask) {
  try {
    console.log(`🚀 [评分 Worker] 开始处理: ${task.fileName}`)
    persistRatingTask(task)
    completeRatingTask(task.taskId)
    console.log(`✅ [评分 Worker] 任务完成: ${task.fileName}`)
    return true as const
  } catch (error) {
    console.error(`❌ [评分 Worker] 处理失败: ${task.fileName}`, error)
    const retryCount = task.retryCount + 1
    const errorMessage = error instanceof Error ? error.message : String(error)
    const nextStatus = failRatingTask(task.taskId, retryCount, errorMessage, maxRetries)

    if (nextStatus === 'failed') {
      console.error(`❌ [评分 Worker] 任务失败: ${task.fileName}, 原因: ${errorMessage}`)
    } else {
      console.log(`🔄 [评分 Worker] 任务重试 (${retryCount}/${maxRetries}): ${task.fileName}`)
    }

    return false as const
  }
}

async function processQueue() {
  if (isProcessing || !hasPendingRatingTasks()) {
    return
  }

  isProcessing = true

  try {
    const batchSize = 10

    for (let i = 0; i < batchSize; i++) {
      const task = claimNextPendingRatingTask()
      if (!task) {
        break
      }

      await processTask(task)
    }
  } catch (error) {
    console.error('❌ [评分 Worker] 处理队列失败:', error)
  } finally {
    isProcessing = false
    if (hasPendingRatingTasks()) {
      scheduleProcess(100)
    }
  }
}

function shutdown() {
  if (processTimer) {
    clearTimeout(processTimer)
    processTimer = null
  }
}

function terminateWorker(exitCode: number, reason: string, error?: unknown) {
  if (isTerminating) {
    return
  }

  isTerminating = true

  if (error !== undefined) {
    console.error(`❌ [评分 Worker] ${reason}:`, error)
  } else {
    console.error(`❌ [评分 Worker] ${reason}`)
  }

  shutdown()
  process.exit(exitCode)
}

process.on('message', (message: WorkerRequestMessage | undefined) => {
  if (!message || message.type !== 'wakeUp') {
    return
  }

  scheduleProcess()
})

process.on('disconnect', () => {
  shutdown()
  process.exit(0)
})

process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})

process.on('exit', () => {
  shutdown()
})

process.on('uncaughtException', (error) => {
  terminateWorker(1, '未捕获异常，Worker 即将退出并等待父进程恢复', error)
})

process.on('unhandledRejection', (reason) => {
  terminateWorker(1, '未处理 Promise 拒绝，Worker 即将退出并等待父进程恢复', reason)
})

console.log(`✅ [评分 Worker] 进程已启动，pid=${process.pid}`)
const recoveredTaskCount = resetStaleProcessingRatingTasks()
if (recoveredTaskCount > 0) {
  console.warn(`⚠️ [评分 Worker] 已恢复 ${recoveredTaskCount} 个中断中的评分任务`)
}
scheduleProcess(10)
