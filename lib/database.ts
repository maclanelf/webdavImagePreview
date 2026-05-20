import fs from 'fs'
import path from 'path'
import mysql, {
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type ResultSetHeader,
} from 'mysql2/promise'

import { getMysqlConfigSignature, getRequiredMysqlConfig, type MysqlRuntimeConfig } from './mysqlConfigFile'

export { mediaRatings } from './mediaRatingRepository'
export { groupRatings } from './groupRatingRepository'
export { customEvaluations, categories, statistics } from './ratingMetadataRepository'
export { scanCache } from './scanCacheRepository'
export { scanFiles } from './scanFilesRepository'
export { creators, scanFileCreators } from './creatorRepository'
export { videoHighlights } from './videoHighlightRepository'

declare global {
  var __mysqlPool: Pool | undefined
  var __mysqlSchemaInitialized: boolean | undefined
  var __mysqlSchemaInitializedSignature: string | undefined
  var __mysqlSchemaInitializationPromise: Promise<void> | undefined
  var __mysqlSchemaInitializationSignature: string | undefined
  var __dbCleanupInProgress: boolean | undefined
  var __dbClosed: boolean | undefined
  var __processCleanupHandlersRegistered: boolean | undefined
  var __mysqlPoolConfigSignature: string | undefined
}

function createMysqlPoolConfig(config: MysqlRuntimeConfig): PoolOptions {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: config.charset,
    timezone: config.timezone,
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: 0,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
  }
}

function getMysqlInitSql() {
  const sqlPath = path.join(process.cwd(), 'database', 'mysql', 'init.sql')
  return fs.readFileSync(sqlPath, 'utf8')
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

function getMySqlPool(): Pool {
  const config = getRequiredMysqlConfig()
  const configSignature = getMysqlConfigSignature(config)

  if (!globalThis.__mysqlPool || globalThis.__mysqlPoolConfigSignature !== configSignature) {
    if (globalThis.__mysqlPool) {
      const oldPool = globalThis.__mysqlPool
      void oldPool.end().catch((error) => {
        console.error('❌ [MySQL] 关闭旧连接池失败:', error)
      })
    }

    globalThis.__mysqlPool = mysql.createPool(createMysqlPoolConfig(config))
    globalThis.__mysqlPoolConfigSignature = configSignature
    globalThis.__dbClosed = false
    globalThis.__mysqlSchemaInitialized = globalThis.__mysqlSchemaInitializedSignature === configSignature
    console.log('✅ [MySQL] 连接池已创建')
  }

  return globalThis.__mysqlPool
}

export async function getMySqlConnection(): Promise<PoolConnection> {
  return getMySqlPool().getConnection()
}

export async function queryMySqlRows<T = any[]>(sql: string, params: any[] = []) {
  const [rows] = await getMySqlPool().query(sql, params)
  return rows as T
}

export async function executeMySqlStatement(sql: string, params: any[] = []) {
  const [result] = await getMySqlPool().execute<ResultSetHeader>(sql, params)
  return result
}

export async function queryMySqlOne<T = any>(sql: string, params: any[] = []) {
  const rows = await queryMySqlRows<any[]>(sql, params)
  return (rows[0] ?? null) as T | null
}

export async function withMySqlTransaction<T>(handler: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getMySqlConnection()
  try {
    await connection.beginTransaction()
    const result = await handler(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function testMySqlConnection() {
  const connection = await getMySqlConnection()
  try {
    await connection.ping()
    return true
  } finally {
    connection.release()
  }
}

export async function ensureMySqlInitialized(force = false) {
  const config = getRequiredMysqlConfig()
  const configSignature = getMysqlConfigSignature(config)

  if (globalThis.__mysqlSchemaInitialized && globalThis.__mysqlSchemaInitializedSignature === configSignature && !force) {
    return
  }

  if (globalThis.__mysqlSchemaInitializationPromise && globalThis.__mysqlSchemaInitializationSignature === configSignature && !force) {
    await globalThis.__mysqlSchemaInitializationPromise
    return
  }

  const initializationPromise = (async () => {
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      charset: config.charset,
      timezone: config.timezone,
      multipleStatements: true,
    })

    try {
      await connection.query(getMysqlInitSql())
      globalThis.__mysqlSchemaInitialized = true
      globalThis.__mysqlSchemaInitializedSignature = configSignature
      console.log('✅ [MySQL] 数据库结构初始化完成')
    } finally {
      await connection.end()
    }
  })()

  globalThis.__mysqlSchemaInitializationPromise = initializationPromise
  globalThis.__mysqlSchemaInitializationSignature = configSignature

  try {
    await initializationPromise
  } finally {
    globalThis.__mysqlSchemaInitializationPromise = undefined
    globalThis.__mysqlSchemaInitializationSignature = undefined
  }
}

export function getDatabaseStatus() {
  return {
    type: 'mysql',
    poolActive: Boolean(globalThis.__mysqlPool),
    schemaInitialized: Boolean(globalThis.__mysqlSchemaInitialized),
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

    try {
      const { resetScanFilesRandomKeySchemaState } = require('./scanFilesRepository') as typeof import('./scanFilesRepository')
      resetScanFilesRandomKeySchemaState()
    } catch {
      // ignore
    }

    if (closeDatabase && globalThis.__mysqlPool) {
      const pool = globalThis.__mysqlPool
      globalThis.__mysqlPool = undefined
      globalThis.__mysqlPoolConfigSignature = undefined
      globalThis.__dbClosed = true
      void pool.end().catch((error) => {
        console.error('❌ [Cleanup] 关闭 MySQL 连接池失败:', error)
      })
    }

    console.log('✅ [Cleanup] 服务端资源清理完成')
  } catch (error) {
    console.error('❌ [Cleanup] 清理服务端资源失败:', error)
  } finally {
    globalThis.__dbCleanupInProgress = false
  }
}

registerProcessCleanupHandlers()

export const scheduledScans = {
  getAll: async () => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM scheduled_scans ORDER BY created_at DESC')
  },

  getActive: async () => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM scheduled_scans WHERE is_active = 1 ORDER BY next_run ASC')
  },

  create: async (data: {
    webdavUrl: string
    webdavUsername: string
    webdavPassword: string
    mediaPaths: string[]
    scanSettings: any
    cronExpression: string
    isActive?: boolean
  }) => {
    await ensureMySqlInitialized()
    return executeMySqlStatement(
      `
        INSERT INTO scheduled_scans
        (webdav_url, webdav_username, webdav_password, media_paths, scan_settings, cron_expression, next_run, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        data.webdavUrl,
        data.webdavUsername,
        data.webdavPassword,
        JSON.stringify(data.mediaPaths),
        JSON.stringify(data.scanSettings),
        data.cronExpression,
        calculateNextRun(data.cronExpression),
        data.isActive !== false ? 1 : 0,
      ],
    )
  },

  update: async (id: number, data: {
    webdavUrl?: string
    webdavUsername?: string
    webdavPassword?: string
    mediaPaths?: string[]
    scanSettings?: any
    cronExpression?: string
    isActive?: boolean
  }) => {
    await ensureMySqlInitialized()
    const updates: string[] = []
    const values: any[] = []

    if (data.webdavUrl !== undefined) {
      updates.push('webdav_url = ?')
      values.push(data.webdavUrl)
    }
    if (data.webdavUsername !== undefined) {
      updates.push('webdav_username = ?')
      values.push(data.webdavUsername)
    }
    if (data.webdavPassword !== undefined) {
      updates.push('webdav_password = ?')
      values.push(data.webdavPassword)
    }
    if (data.mediaPaths !== undefined) {
      updates.push('media_paths = ?')
      values.push(JSON.stringify(data.mediaPaths))
    }
    if (data.scanSettings !== undefined) {
      updates.push('scan_settings = ?')
      values.push(JSON.stringify(data.scanSettings))
    }
    if (data.cronExpression !== undefined) {
      updates.push('cron_expression = ?')
      updates.push('next_run = ?')
      values.push(data.cronExpression, calculateNextRun(data.cronExpression))
    }
    if (data.isActive !== undefined) {
      updates.push('is_active = ?')
      values.push(data.isActive ? 1 : 0)
    }

    if (updates.length === 0) {
      return { affectedRows: 0, insertId: 0, warningStatus: 0 }
    }

    values.push(id)
    return executeMySqlStatement(`UPDATE scheduled_scans SET ${updates.join(', ')} WHERE id = ?`, values)
  },

  delete: async (id: number) => {
    await ensureMySqlInitialized()
    return executeMySqlStatement('DELETE FROM scheduled_scans WHERE id = ?', [id])
  },

  updateLastRun: async (id: number) => {
    await ensureMySqlInitialized()
    const task = await queryMySqlOne<{ cron_expression: string }>('SELECT cron_expression FROM scheduled_scans WHERE id = ?', [id])
    if (!task) {
      return null
    }

    return executeMySqlStatement(
      'UPDATE scheduled_scans SET last_run = CURRENT_TIMESTAMP, next_run = ? WHERE id = ?',
      [calculateNextRun(task.cron_expression), id],
    )
  },
}

export const recursiveScanTasks = {
  create: async (data: {
    taskId: string
    webdavUrl: string
    webdavUsername: string
    webdavPassword: string
    rootPath: string
    scanSettings: any
  }) => {
    await ensureMySqlInitialized()
    return executeMySqlStatement(
      `
        INSERT INTO recursive_scan_tasks
        (task_id, webdav_url, webdav_username, webdav_password, root_path, scan_settings, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `,
      [
        data.taskId,
        data.webdavUrl,
        data.webdavUsername,
        data.webdavPassword,
        data.rootPath,
        JSON.stringify(data.scanSettings),
      ],
    )
  },

  get: async (taskId: string) => {
    await ensureMySqlInitialized()
    return queryMySqlOne('SELECT * FROM recursive_scan_tasks WHERE task_id = ?', [taskId])
  },

  updateStatus: async (taskId: string, status: string, data?: {
    currentPath?: string
    scannedDirectories?: number
    totalDirectories?: number
    foundFiles?: number
    pendingDirectories?: string[]
    completedDirectories?: string[]
    errorMessage?: string
    retryCount?: number
    nextRetryAt?: string
    rateLimitedUntil?: string
    delayUntil?: string
  }) => {
    await ensureMySqlInitialized()
    const updates = ['status = ?']
    const values: any[] = [status]

    if (data) {
      if (data.currentPath !== undefined) {
        updates.push('current_path = ?')
        values.push(data.currentPath)
      }
      if (data.scannedDirectories !== undefined) {
        updates.push('scanned_directories = ?')
        values.push(data.scannedDirectories)
      }
      if (data.totalDirectories !== undefined) {
        updates.push('total_directories = ?')
        values.push(data.totalDirectories)
      }
      if (data.foundFiles !== undefined) {
        updates.push('found_files = ?')
        values.push(data.foundFiles)
      }
      if (data.pendingDirectories !== undefined) {
        updates.push('pending_directories = ?')
        values.push(JSON.stringify(data.pendingDirectories))
      }
      if (data.completedDirectories !== undefined) {
        updates.push('completed_directories = ?')
        values.push(JSON.stringify(data.completedDirectories))
      }
      if (data.errorMessage !== undefined) {
        updates.push('error_message = ?')
        values.push(data.errorMessage)
      }
      if (data.retryCount !== undefined) {
        updates.push('retry_count = ?')
        values.push(data.retryCount)
      }
      if (data.nextRetryAt !== undefined) {
        updates.push('next_retry_at = ?')
        values.push(data.nextRetryAt)
      }
      if (data.rateLimitedUntil !== undefined) {
        updates.push('rate_limited_until = ?')
        values.push(data.rateLimitedUntil)
      }
      if (data.delayUntil !== undefined) {
        updates.push('delay_until = ?')
        values.push(data.delayUntil)
      }
    }

    if (status === 'running') {
      updates.push('started_at = COALESCE(started_at, CURRENT_TIMESTAMP)')
    }
    if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = CURRENT_TIMESTAMP')
    }

    values.push(taskId)
    return executeMySqlStatement(`UPDATE recursive_scan_tasks SET ${updates.join(', ')} WHERE task_id = ?`, values)
  },

  getAll: async () => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM recursive_scan_tasks ORDER BY created_at DESC')
  },

  getActive: async () => {
    await ensureMySqlInitialized()
    return queryMySqlRows("SELECT * FROM recursive_scan_tasks WHERE status IN ('pending', 'running', 'paused', 'rate_limited', 'waiting') ORDER BY created_at ASC")
  },

  delete: async (taskId: string) => {
    await ensureMySqlInitialized()
    return executeMySqlStatement('DELETE FROM recursive_scan_tasks WHERE task_id = ?', [taskId])
  },

  cleanup: async () => {
    await ensureMySqlInitialized()
    return executeMySqlStatement('DELETE FROM recursive_scan_tasks WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)')
  },
}

export const webdavConfigs = {
  getAll: async () => {
    try {
      await ensureMySqlInitialized()
      const rows = await queryMySqlRows<any[]>('SELECT * FROM webdav_configs ORDER BY is_default DESC, created_at DESC')
      return rows.map((row: any) => ({
        ...row,
        mediaPaths: JSON.parse(row.media_paths || '[]'),
        scanSettings: JSON.parse(row.scan_settings || '{}'),
        isDefault: row.is_default === 1,
        sourceType: row.source_type || 'clouddrive2',
        directLinkUrl: row.direct_link_url || null,
        enableDirectLink: row.enable_direct_link === 1,
      }))
    } catch (error) {
      console.error('获取 WebDAV 配置失败:', error)
      return []
    }
  },

  getDefault: async () => {
    try {
      await ensureMySqlInitialized()
      const row: any = await queryMySqlOne('SELECT * FROM webdav_configs WHERE is_default = 1 LIMIT 1')
      if (!row) return null

      return {
        ...row,
        mediaPaths: JSON.parse(row.media_paths || '[]'),
        scanSettings: JSON.parse(row.scan_settings || '{}'),
        isDefault: true,
        sourceType: row.source_type || 'clouddrive2',
        directLinkUrl: row.direct_link_url || null,
        enableDirectLink: row.enable_direct_link === 1,
      }
    } catch (error) {
      console.error('获取默认配置失败:', error)
      return null
    }
  },

  get: async (url: string, username: string) => {
    try {
      await ensureMySqlInitialized()
      const row: any = await queryMySqlOne('SELECT * FROM webdav_configs WHERE url = ? AND username = ? LIMIT 1', [url, username])
      if (!row) return null

      return {
        ...row,
        mediaPaths: JSON.parse(row.media_paths || '[]'),
        scanSettings: JSON.parse(row.scan_settings || '{}'),
        isDefault: row.is_default === 1,
        sourceType: row.source_type || 'clouddrive2',
        directLinkUrl: row.direct_link_url || null,
        enableDirectLink: row.enable_direct_link === 1,
      }
    } catch (error) {
      console.error('获取 WebDAV 配置失败:', error)
      return null
    }
  },

  save: async (data: {
    url: string
    username: string
    password: string
    mediaPaths: string[]
    scanSettings?: any
    isDefault?: boolean
    sourceType?: string
    directLinkUrl?: string
    enableDirectLink?: boolean
  }) => {
    try {
      await ensureMySqlInitialized()
      const existing = await webdavConfigs.get(data.url, data.username)

      if (data.isDefault) {
        await executeMySqlStatement('UPDATE webdav_configs SET is_default = 0 WHERE is_default = 1')
      }

      const mediaPathsStr = JSON.stringify(data.mediaPaths || [])
      const scanSettingsStr = JSON.stringify(data.scanSettings || {})
      const sourceType = data.sourceType || 'clouddrive2'
      const directLinkUrl = data.directLinkUrl || null
      const enableDirectLink = data.enableDirectLink ? 1 : 0

      if (existing) {
        return executeMySqlStatement(
          `
            UPDATE webdav_configs
            SET password = ?, media_paths = ?, scan_settings = ?,
                is_default = ?, source_type = ?, direct_link_url = ?, enable_direct_link = ?
            WHERE url = ? AND username = ?
          `,
          [
            data.password,
            mediaPathsStr,
            scanSettingsStr,
            data.isDefault ? 1 : 0,
            sourceType,
            directLinkUrl,
            enableDirectLink,
            data.url,
            data.username,
          ],
        )
      }

      const allConfigs = await webdavConfigs.getAll()
      const shouldBeDefault = data.isDefault !== false && allConfigs.length === 0

      return executeMySqlStatement(
        `
          INSERT INTO webdav_configs
          (url, username, password, media_paths, scan_settings, is_default, source_type, direct_link_url, enable_direct_link)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          data.url,
          data.username,
          data.password,
          mediaPathsStr,
          scanSettingsStr,
          shouldBeDefault ? 1 : (data.isDefault ? 1 : 0),
          sourceType,
          directLinkUrl,
          enableDirectLink,
        ],
      )
    } catch (error) {
      console.error('保存 WebDAV 配置失败:', error)
      throw error
    }
  },

  delete: async (url: string, username: string) => {
    try {
      await ensureMySqlInitialized()
      return executeMySqlStatement('DELETE FROM webdav_configs WHERE url = ? AND username = ?', [url, username])
    } catch (error) {
      console.error('删除 WebDAV 配置失败:', error)
      throw error
    }
  },

  setDefault: async (url: string, username: string) => {
    try {
      await ensureMySqlInitialized()
      await executeMySqlStatement('UPDATE webdav_configs SET is_default = 0')
      return executeMySqlStatement('UPDATE webdav_configs SET is_default = 1 WHERE url = ? AND username = ?', [url, username])
    } catch (error) {
      console.error('设置默认配置失败:', error)
      throw error
    }
  },
}

function calculateNextRun(cronExpression: string): string {
  try {
    const parts = cronExpression.split(' ')
    if (parts.length !== 5) {
      const nextHour = new Date()
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0)
      return nextHour.toISOString()
    }

    const [minute, hour] = parts
    const now = new Date()
    const nextRun = new Date(now)

    if (minute !== '*') {
      if (minute.includes('/')) {
        const [, interval] = minute.split('/')
        const intervalNum = parseInt(interval) || 1
        const currentMinute = now.getMinutes()
        const nextMinute = Math.ceil((currentMinute + 1) / intervalNum) * intervalNum

        if (nextMinute >= 60) {
          nextRun.setHours(nextRun.getHours() + 1)
          nextRun.setMinutes(nextMinute % 60, 0, 0)
        } else {
          nextRun.setMinutes(nextMinute, 0, 0)
        }
      } else {
        const targetMinute = parseInt(minute)
        if (isNaN(targetMinute) || targetMinute < 0 || targetMinute > 59) {
          nextRun.setMinutes(0, 0, 0)
        } else {
          nextRun.setMinutes(targetMinute, 0, 0)
        }
      }
    } else {
      nextRun.setMinutes(0, 0, 0)
    }

    if (hour !== '*') {
      if (hour.includes('/')) {
        const [, interval] = hour.split('/')
        const intervalNum = parseInt(interval) || 1
        const currentHour = now.getHours()
        const nextHour = Math.ceil((currentHour + 1) / intervalNum) * intervalNum

        if (nextHour >= 24) {
          nextRun.setDate(nextRun.getDate() + 1)
          nextRun.setHours(nextHour % 24)
        } else {
          nextRun.setHours(nextHour)
        }
      } else {
        const targetHour = parseInt(hour)
        if (isNaN(targetHour) || targetHour < 0 || targetHour > 23) {
          nextRun.setHours(nextRun.getHours() + 1)
          return nextRun.toISOString()
        }

        nextRun.setHours(targetHour)
      }
    }

    if (nextRun <= now) {
      if (hour === '*') {
        nextRun.setHours(nextRun.getHours() + 1)
      } else if (hour.includes('/')) {
        const [, interval] = hour.split('/')
        const intervalNum = parseInt(interval) || 1
        const currentHour = now.getHours()
        const nextHour = Math.ceil((currentHour + 1) / intervalNum) * intervalNum

        if (nextHour >= 24) {
          nextRun.setDate(nextRun.getDate() + 1)
          nextRun.setHours(nextHour % 24)
        } else {
          nextRun.setHours(nextHour)
        }
      } else {
        nextRun.setDate(nextRun.getDate() + 1)
      }
    }

    if (isNaN(nextRun.getTime())) {
      const fallback = new Date()
      fallback.setHours(fallback.getHours() + 1, 0, 0, 0)
      return fallback.toISOString()
    }

    return nextRun.toISOString()
  } catch (error) {
    console.error('计算下次运行时间失败:', error)
    const fallback = new Date()
    fallback.setHours(fallback.getHours() + 1, 0, 0, 0)
    return fallback.toISOString()
  }
}
