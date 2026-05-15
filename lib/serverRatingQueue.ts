import fs from 'fs'
import { ChildProcess, fork } from 'child_process'
import path from 'path'
import {
  clearFailedRatingTasks,
  enqueueRatingTask,
  getFailedRatingTasks,
  getRatingQueueStatusSnapshot,
  hasRecoverableRatingTasks,
  retryFailedRatingTasks,
} from './ratingTaskQueueRepository'

export interface RatingTaskPayload {
  filePath: string
  fileName: string
  fileType: string
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}

export interface AddTaskResult {
  taskId: string
  workerStarted: boolean
}

export interface RetryFailedTasksResult {
  retryCount: number
  workerStarted: boolean
}

interface QueueStatusTask {
  taskId: string
  fileName: string
  retryCount: number
  createdAt: string
}

interface QueueStatus {
  pending: number
  isProcessing: boolean
  failed: number
  tasks: QueueStatusTask[]
  workerPid: number | null
}

interface FailedTaskInfo {
  taskId: string
  fileName: string
  filePath: string
  failedAt: string
  reason: string
  retryCount: number
}

interface WorkerRequestMessage {
  type: 'wakeUp'
}

interface WorkerLaunchConfig {
  scriptPath: string
  execArgv: string[]
  env: NodeJS.ProcessEnv
  mode: 'runtime-js' | 'ts-source'
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

export class RatingQueueUnavailableError extends Error {
  override cause?: unknown
  readonly recoverable: boolean

  constructor(message: string, cause?: unknown, options?: { recoverable?: boolean }) {
    super(message)
    this.name = 'RatingQueueUnavailableError'
    this.cause = cause
    this.recoverable = options?.recoverable ?? true
  }
}

declare global {
  var __serverRatingQueue: ServerRatingQueue | undefined
}

class ServerRatingQueue {
  private worker: ChildProcess | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private readonly runtimeWorkerScriptPath = path.join(process.cwd(), 'dist-runtime', 'workers', 'ratingQueueWorker.js')
  private readonly sourceWorkerScriptPath = path.join(process.cwd(), 'workers', 'ratingQueueWorker.ts')

  constructor() {
    if (hasRecoverableRatingTasks()) {
      console.log('🔄 [评分队列] 检测到可恢复评分任务，准备恢复 Worker 消费')
      void this.kickWorkerProcessing().catch((error) => {
        console.error('❌ [评分队列] 恢复 Worker 消费失败:', error)
      })
    }
  }

  private resolveSourceWorkerLaunchConfig(): WorkerLaunchConfig | null {
    if (!fs.existsSync(this.sourceWorkerScriptPath)) {
      return null
    }

    const tsNodeRegisterModule = 'ts-node/register/transpile-only'

    try {
      require.resolve(tsNodeRegisterModule)
    } catch {
      console.warn(`⚠️ [评分队列] 源码 Worker 运行时依赖缺失，跳过 ts-source 模式: ${tsNodeRegisterModule}`)
      return null
    }

    return {
      scriptPath: this.sourceWorkerScriptPath,
      execArgv: ['-r', tsNodeRegisterModule],
      env: {
        ...process.env,
        TS_NODE_PROJECT: path.join(process.cwd(), 'tsconfig.scripts.json'),
      },
      mode: 'ts-source' as const,
    }
  }

  private resolveWorkerLaunchConfig(): WorkerLaunchConfig {
    const runtimeWorkerConfig = fs.existsSync(this.runtimeWorkerScriptPath)
      ? {
          scriptPath: this.runtimeWorkerScriptPath,
          execArgv: [],
          env: {
            ...process.env,
          },
          mode: 'runtime-js' as const,
        }
      : null

    const sourceWorkerConfig = this.resolveSourceWorkerLaunchConfig()

    const preferredConfig = process.env.NODE_ENV === 'production'
      ? runtimeWorkerConfig ?? sourceWorkerConfig
      : sourceWorkerConfig ?? runtimeWorkerConfig

    if (preferredConfig) {
      return preferredConfig
    }

    throw new RatingQueueUnavailableError(
      `评分 Worker 启动失败：未找到可执行脚本（${this.runtimeWorkerScriptPath} / ${this.sourceWorkerScriptPath}）`,
      undefined,
      { recoverable: false }
    )
  }

  private isWorkerUsable() {
    return Boolean(
      this.worker
      && this.worker.connected
      && !this.worker.killed
      && this.worker.exitCode === null
    )
  }

  private getWorkerPid() {
    return this.isWorkerUsable() ? (this.worker?.pid ?? null) : null
  }

  private scheduleRestart() {
    if (this.restartTimer || !hasRecoverableRatingTasks()) {
      return
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.kickWorkerProcessing().catch((error) => {
        console.error('❌ [评分队列] Worker 重启失败:', error)
      })
    }, 500)
  }

  private ensureWorker() {
    if (this.isWorkerUsable()) {
      return this.worker!
    }

    const launchConfig = this.resolveWorkerLaunchConfig()

    const worker = fork(launchConfig.scriptPath, [], {
      cwd: process.cwd(),
      execArgv: launchConfig.execArgv,
      env: launchConfig.env,
    })

    worker.on('error', (error) => {
      console.error('❌ [评分队列] Worker 进程错误:', error)
    })

    worker.on('exit', (code, signal) => {
      console.warn(`⚠️ [评分队列] Worker 已退出，code=${code ?? 'null'}, signal=${signal ?? 'null'}`)
      if (this.worker === worker) {
        this.worker = null
      }
      this.scheduleRestart()
    })

    this.worker = worker
    console.log(`✅ [评分队列] Worker 已启动，模式=${launchConfig.mode}，pid=${worker.pid ?? 'unknown'}`)
    return worker
  }

  private async kickWorkerProcessing(): Promise<void> {
    try {
      const worker = this.ensureWorker()
      const message: WorkerRequestMessage = { type: 'wakeUp' }

      await new Promise<void>((resolve, reject) => {
        worker.send(message, (error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    } catch (error) {
      console.error('❌ [评分队列] 启动 Worker 失败:', error)

      if (error instanceof RatingQueueUnavailableError) {
        if (error.recoverable) {
          this.scheduleRestart()
        }
        throw error
      }

      this.scheduleRestart()
      throw new RatingQueueUnavailableError(`评分 Worker 不可用: ${getErrorMessage(error)}`, error)
    }
  }

  async addTask(data: RatingTaskPayload): Promise<AddTaskResult> {
    const enqueueResult = enqueueRatingTask(data)
    let workerStarted = false

    try {
      await this.kickWorkerProcessing()
      workerStarted = true
    } catch (error) {
      if (error instanceof RatingQueueUnavailableError && !error.recoverable) {
        throw error
      }

      console.warn('⚠️ [评分队列] 任务已入队，但 Worker 暂时不可用，等待自动恢复:', error)
    }

    return {
      taskId: enqueueResult.taskId,
      workerStarted,
    }
  }

  async getStatus(): Promise<QueueStatus> {
    const snapshot = getRatingQueueStatusSnapshot()
    return {
      ...snapshot,
      workerPid: this.getWorkerPid(),
    }
  }

  async getFailedTasks(): Promise<FailedTaskInfo[]> {
    return getFailedRatingTasks()
  }

  async clearFailedTasks(): Promise<number> {
    return clearFailedRatingTasks()
  }

  async retryFailedTasks(): Promise<RetryFailedTasksResult> {
    const retryCount = retryFailedRatingTasks()
    let workerStarted = false

    if (retryCount > 0) {
      try {
        await this.kickWorkerProcessing()
        workerStarted = true
      } catch (error) {
        if (error instanceof RatingQueueUnavailableError && !error.recoverable) {
          throw error
        }

        console.warn('⚠️ [评分队列] 失败任务已重新入队，但 Worker 暂时不可用，等待自动恢复:', error)
      }
    }

    return {
      retryCount,
      workerStarted,
    }
  }
}

export const serverRatingQueue = global.__serverRatingQueue || new ServerRatingQueue()

if (process.env.NODE_ENV !== 'production') {
  global.__serverRatingQueue = serverRatingQueue
}
