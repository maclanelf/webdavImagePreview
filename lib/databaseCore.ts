import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

export const dbPath = path.join(process.cwd(), 'data', 'media_ratings.db')
export const dataDir = path.join(process.cwd(), 'data')

declare global {
  var __db: Database.Database | undefined
  var __dbClosed: boolean | undefined
  var __dbInitialized: boolean | undefined
  var __checkpointTimer: NodeJS.Timeout | undefined
  var __dbCleanupInProgress: boolean | undefined
  var __processCleanupHandlersRegistered: boolean | undefined
  var __checkpointBeforeExitHandlerRegistered: boolean | undefined
}

function ensureDataDirectory() {
  if (fs.existsSync(dataDir)) {
    return
  }

  try {
    fs.mkdirSync(dataDir, { recursive: true })
    console.log('创建数据目录:', dataDir)
  } catch (error) {
    console.error('创建数据目录失败:', error)
    throw error
  }
}

function isExpectedStreamLifecycleError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.trim().toLowerCase()

  return name === 'ResponseAborted'
    || /Stream closed: (客户端断开|切换到新视频|新请求替代旧请求|PassThrough 关闭)/.test(message)
    || normalized.includes('premature close')
    || normalized.includes('client closed')
    || normalized.includes('failed to pipe response')
    || normalized.includes('responseaborted')
    || normalized.includes('invalid state: controller is already closed')
    || (
      name === 'AbortError'
      && (
        normalized === 'the operation was aborted'
        || normalized === 'this operation was aborted'
      )
    )
}

export function getActiveDatabaseConnection(): Database.Database | null {
  try {
    if (globalThis.__db && (globalThis.__db as any).open !== false) {
      return globalThis.__db
    }
  } catch {
    // ignore
  }

  try {
    if (db && (db as any).open !== false) {
      return db
    }
  } catch {
    // ignore
  }

  return null
}

export function performCheckpoint(mode: 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE' = 'RESTART'): any {
  try {
    const connection = getActiveDatabaseConnection()
    if (!connection) {
      console.log(`ℹ️ [Checkpoint] 跳过 ${mode} checkpoint：数据库连接未打开`)
      return null
    }

    const result = connection.pragma(`wal_checkpoint(${mode})`, { simple: true })
    console.log(`✅ [Checkpoint] 执行 ${mode} checkpoint 成功:`, result)
    return result
  } catch (error) {
    console.warn(`⚠️ [Checkpoint] 执行 ${mode} checkpoint 失败:`, error)
    return null
  }
}

export function getDatabaseStatus() {
  try {
    const connection = getActiveDatabaseConnection()
    if (!connection) {
      return null
    }

    const journalMode = connection.pragma('journal_mode', { simple: true })
    const walCheckpoint = connection.pragma('wal_checkpoint')
    const pageCount = connection.pragma('page_count', { simple: true })
    const pageSize = connection.pragma('page_size', { simple: true })

    return {
      journalMode,
      walCheckpoint,
      pageCount,
      pageSize,
      dbSize: `${((pageCount as number) * (pageSize as number) / 1024 / 1024).toFixed(2)} MB`,
    }
  } catch (error) {
    console.warn('⚠️ [Database] 获取数据库状态失败:', error)
    return null
  }
}

function startCheckpointTimer() {
  if (globalThis.__checkpointTimer) {
    clearInterval(globalThis.__checkpointTimer)
  }

  const intervalMinutes = 1
  const intervalMs = intervalMinutes * 60 * 1000

  console.log(`🕐 [Checkpoint] 启动定时 checkpoint 任务（每 ${intervalMinutes} 分钟）`)

  globalThis.__checkpointTimer = setInterval(() => {
    console.log(`🕐 [Checkpoint] 定时任务触发（间隔 ${intervalMinutes} 分钟）`)
    const result = performCheckpoint('PASSIVE')

    if (result) {
      try {
        const walPath = `${dbPath}-wal`
        if (fs.existsSync(walPath)) {
          const walSize = fs.statSync(walPath).size
          console.log(`📊 [Checkpoint] WAL 文件大小: ${(walSize / 1024).toFixed(2)} KB`)
        }
      } catch {
        // ignore
      }
    }
  }, intervalMs)

  if (!globalThis.__checkpointBeforeExitHandlerRegistered) {
    globalThis.__checkpointBeforeExitHandlerRegistered = true
    process.on('beforeExit', () => {
      if (globalThis.__checkpointTimer) {
        clearInterval(globalThis.__checkpointTimer)
        console.log('🛑 [Checkpoint] 清理定时 checkpoint 任务')
      }
    })
  }
}

export function stopCheckpointTimer() {
  if (globalThis.__checkpointTimer) {
    clearInterval(globalThis.__checkpointTimer)
    globalThis.__checkpointTimer = undefined
    console.log('🛑 [Checkpoint] 停止定时 checkpoint 任务')
  }
}

export function cleanupDatabase(closeDatabase: boolean = true) {
  if (globalThis.__dbCleanupInProgress) {
    console.log('ℹ️ [Cleanup] 已有清理进行中，跳过重复调用')
    return
  }

  globalThis.__dbCleanupInProgress = true
  console.log(`🧹 [Cleanup] 开始清理服务端资源... (关闭数据库: ${closeDatabase})`)

  try {
    try {
      const { clearCreatorAliasCache } = require('./creatorRepository') as typeof import('./creatorRepository')
      clearCreatorAliasCache()
    } catch {
      // ignore
    }

    try {
      const { cleanupWebDAVCache } = require('./webdav') as typeof import('./webdav')
      cleanupWebDAVCache()
    } catch {
      // ignore
    }

    try {
      const { cleanupWebDAVCache } = require('./webdav-optimized') as typeof import('./webdav-optimized')
      cleanupWebDAVCache()
    } catch {
      // ignore
    }

    const connection = getActiveDatabaseConnection()
    if (connection) {
      console.log('🔄 [Cleanup] 执行 checkpoint...')
      performCheckpoint('PASSIVE')
    }

    if (closeDatabase) {
      if (globalThis.__dbClosed) {
        console.log('ℹ️ [Cleanup] 数据库连接已关闭，跳过重复关闭')
      } else {
        console.log('🔒 [Cleanup] 关闭数据库连接...')
        stopCheckpointTimer()
        performCheckpoint('RESTART')

        const activeConnection = getActiveDatabaseConnection()
        if (activeConnection) {
          activeConnection.close()
        }

        globalThis.__db = undefined
        globalThis.__dbInitialized = undefined
        globalThis.__dbClosed = true
      }
    }

    console.log('✅ [Cleanup] 服务端资源清理完成')
  } catch (error) {
    console.error('❌ [Cleanup] 清理服务端资源失败:', error)
  } finally {
    globalThis.__dbCleanupInProgress = false
  }
}

function registerProcessCleanupHandlers() {
  if (typeof process === 'undefined' || globalThis.__processCleanupHandlersRegistered) {
    return
  }

  globalThis.__processCleanupHandlersRegistered = true

  process.on('exit', () => {
    console.log('🚪 [Process] 进程退出，清理资源...')
    cleanupDatabase()
  })

  process.on('SIGINT', () => {
    console.log('🛑 [Process] 收到 SIGINT 信号，清理资源...')
    cleanupDatabase()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    console.log('🛑 [Process] 收到 SIGTERM 信号，清理资源...')
    cleanupDatabase()
    process.exit(0)
  })

  process.on('uncaughtException', (error) => {
    if (isExpectedStreamLifecycleError(error)) {
      console.warn('ℹ️ [Process] 忽略预期内的流关闭异常:', error)
      return
    }

    console.error('💥 [Process] 未捕获的异常:', error)
    cleanupDatabase()
    process.exit(1)
  })
}

function createDatabaseConnection() {
  ensureDataDirectory()

  console.log('尝试连接数据库:', dbPath)
  console.log('当前工作目录:', process.cwd())
  console.log('数据目录是否存在:', fs.existsSync(dataDir))

  const connection = new Database(dbPath)

  try {
    connection.pragma('busy_timeout = 10000')

    const currentMode = connection.pragma('journal_mode', { simple: true })
    console.log('当前日志模式:', currentMode)

    if (currentMode !== 'wal') {
      console.log('尝试切换到 WAL 模式...')
      const newMode = connection.pragma('journal_mode = WAL', { simple: true })
      console.log('新日志模式:', newMode)
    }

    connection.pragma('synchronous = NORMAL')
    connection.pragma('cache_size = -64000')
    connection.pragma('wal_autocheckpoint = 100')

    console.log('数据库配置完成')
  } catch (pragmaError) {
    console.warn('设置数据库pragma失败，使用默认配置:', pragmaError)
  }

  console.log('数据库连接成功:', dbPath)
  globalThis.__db = connection
  globalThis.__dbClosed = false
  startCheckpointTimer()
  return connection
}

export let db: Database.Database

if (globalThis.__db && (globalThis.__db as any).open !== false) {
  db = globalThis.__db
  globalThis.__dbClosed = false
  console.log('♻️ 复用已有数据库连接')
} else {
  db = createDatabaseConnection()
}

registerProcessCleanupHandlers()
startCheckpointTimer()

export default db
