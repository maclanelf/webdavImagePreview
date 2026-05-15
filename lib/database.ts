import Database from 'better-sqlite3'
import path from 'path'
import { UNKNOWN_CREATOR_ID } from './constants'
import { clearCreatorAliasCache } from './creatorRepository'
import { ensureInitialized } from './databaseInitialization'

export { mediaRatings } from './mediaRatingRepository'
export { groupRatings } from './groupRatingRepository'
export { customEvaluations, categories, statistics } from './ratingMetadataRepository'
export { scanCache } from './scanCacheRepository'
export { scanFiles } from './scanFilesRepository'
export { creators, scanFileCreators } from './creatorRepository'
export { videoHighlights } from './videoHighlightRepository'

// 数据库文件路径
const dbPath = path.join(process.cwd(), 'data', 'media_ratings.db')

// 确保数据目录存在
import fs from 'fs'
const dataDir = path.join(process.cwd(), 'data')
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    console.log('创建数据目录:', dataDir)
  } catch (error) {
    console.error('创建数据目录失败:', error)
    throw error
  }
}

// 使用 globalThis 缓存数据库连接，避免开发模式下重复初始化
declare global {
  var __db: Database.Database | undefined
  var __dbInitialized: boolean | undefined
  var __checkpointTimer: NodeJS.Timeout | undefined
  var __dbCleanupInProgress: boolean | undefined
  var __dbClosed: boolean | undefined
  var __processCleanupHandlersRegistered: boolean | undefined
  var __checkpointBeforeExitHandlerRegistered: boolean | undefined
}

function getActiveDatabaseConnection(): Database.Database | null {
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

// 🔧 通用函数：执行 WAL checkpoint
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

// 🔧 通用函数：获取数据库状态信息
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
      dbSize: `${((pageCount as number) * (pageSize as number) / 1024 / 1024).toFixed(2)} MB`
    }
  } catch (error) {
    console.warn('⚠️ [Database] 获取数据库状态失败:', error)
    return null
  }
}

// 🔧 启动定时 checkpoint 任务
function startCheckpointTimer() {
  // 如果已经有定时器在运行，先清除
  if (globalThis.__checkpointTimer) {
    clearInterval(globalThis.__checkpointTimer)
  }
  
  // 每 1 分钟执行一次 PASSIVE checkpoint
  const intervalMinutes = 1
  const intervalMs = intervalMinutes * 60 * 1000
  
  console.log(`🕐 [Checkpoint] 启动定时 checkpoint 任务（每 ${intervalMinutes} 分钟）`)
  
  globalThis.__checkpointTimer = setInterval(() => {
    console.log(`🕐 [Checkpoint] 定时任务触发（间隔 ${intervalMinutes} 分钟）`)
    const result = performCheckpoint('PASSIVE')
    
    if (result) {
      // 获取 WAL 文件大小（如果可能）
      try {
        const fs = require('fs')
        const walPath = `${dbPath}-wal`
        if (fs.existsSync(walPath)) {
          const walSize = fs.statSync(walPath).size
          console.log(`📊 [Checkpoint] WAL 文件大小: ${(walSize / 1024).toFixed(2)} KB`)
        }
      } catch (e) {
        // 忽略错误
      }
    }
  }, intervalMs)
  
  // 确保进程退出时清理定时器
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

// 🔧 停止定时 checkpoint 任务
export function stopCheckpointTimer() {
  if (globalThis.__checkpointTimer) {
    clearInterval(globalThis.__checkpointTimer)
    globalThis.__checkpointTimer = undefined
    console.log('🛑 [Checkpoint] 停止定时 checkpoint 任务')
  }
}

// 🔧 清理所有缓存和资源
// 注意：只清理服务端资源，客户端资源（如 databasePreloadManager）由浏览器管理
// 
// @param closeDatabase - 是否关闭数据库连接（默认 true）
//   - true: 完全关闭（服务器退出时）
//   - false: 只清理缓存（浏览器关闭时，服务器继续运行）
export function cleanupDatabase(closeDatabase: boolean = true) {
  if (globalThis.__dbCleanupInProgress) {
    console.log('ℹ️ [Cleanup] 已有清理进行中，跳过重复调用')
    return
  }

  globalThis.__dbCleanupInProgress = true
  console.log(`🧹 [Cleanup] 开始清理服务端资源... (关闭数据库: ${closeDatabase})`)

  try {
    // 1. 清除博主别名缓存（服务端）
    clearCreatorAliasCache()

    // 2. 清理 WebDAV 客户端缓存（服务端）
    try {
      const { cleanupWebDAVCache: cleanupWebDAV } = require('./webdav')
      cleanupWebDAV()
    } catch (e) {
      // 模块可能未加载，忽略
    }

    try {
      const { cleanupWebDAVCache: cleanupWebDAVOptimized } = require('./webdav-optimized')
      cleanupWebDAVOptimized()
    } catch (e) {
      // 模块可能未加载，忽略
    }

    // 注意：不在这里清理 streamManager，因为它已经在 /api/cleanup 中单独清理了
    // 避免重复清理

    // 注意：不清理 databasePreloadManager，因为它是客户端资源
    // 客户端资源由浏览器在页面关闭时自动释放

    // 3. 执行 checkpoint（服务端）
    const connection = getActiveDatabaseConnection()
    if (connection) {
      console.log('🔄 [Cleanup] 执行 checkpoint...')
      performCheckpoint('PASSIVE') // 使用 PASSIVE 模式，不阻塞
    }

    // 4. 关闭数据库连接（仅在服务器退出时）
    if (closeDatabase) {
      if (globalThis.__dbClosed) {
        console.log('ℹ️ [Cleanup] 数据库连接已关闭，跳过重复关闭')
      } else {
        console.log('🔒 [Cleanup] 关闭数据库连接...')

        // 停止定时 checkpoint 任务
        stopCheckpointTimer()

        // 执行最终 checkpoint
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


// 注册进程退出时的清理函数
if (typeof process !== 'undefined' && !globalThis.__processCleanupHandlersRegistered) {
  globalThis.__processCleanupHandlersRegistered = true
  // 正常退出
  process.on('exit', () => {
    console.log('🚪 [Process] 进程退出，清理资源...')
    cleanupDatabase()
  })
  
  // SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    console.log('🛑 [Process] 收到 SIGINT 信号，清理资源...')
    cleanupDatabase()
    process.exit(0)
  })
  
  // SIGTERM
  process.on('SIGTERM', () => {
    console.log('🛑 [Process] 收到 SIGTERM 信号，清理资源...')
    cleanupDatabase()
    process.exit(0)
  })
  
  // 未捕获的异常
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

// 创建数据库连接（使用缓存）
let db: Database.Database
if (globalThis.__db) {
  db = globalThis.__db
  globalThis.__dbClosed = false
  console.log('♻️ 复用已有数据库连接')
} else {
  try {
    console.log('尝试连接数据库:', dbPath)
    console.log('当前工作目录:', process.cwd())
    console.log('数据目录是否存在:', fs.existsSync(dataDir))
    
    // 创建数据库连接
    db = new Database(dbPath)
    
    try {
      // 先设置忙碌超时，再启用 WAL 模式
      db.pragma('busy_timeout = 10000')
      
      // 尝试启用 WAL 模式
      const currentMode = db.pragma('journal_mode', { simple: true })
      console.log('当前日志模式:', currentMode)
      
      if (currentMode !== 'wal') {
        console.log('尝试切换到 WAL 模式...')
        const newMode = db.pragma('journal_mode = WAL', { simple: true })
        console.log('新日志模式:', newMode)
      }
      
      // 设置同步模式为 NORMAL 以平衡性能和安全性
      // FULL: 每次写入都等待磁盘完全同步（最安全，最慢）
      // NORMAL: 关键时刻同步（平衡，推荐）✅
      // OFF: 不等待同步（最快，断电可能丢失数据）
      db.pragma('synchronous = NORMAL')
      
      // 设置缓存大小
      db.pragma('cache_size = -64000') // 64MB
      
      // 🔧 设置 WAL 自动 checkpoint 阈值（每 100 页自动 checkpoint，约 400KB）
      // 更频繁的 checkpoint 可以减少 WAL 文件大小，提高数据一致性
      // 默认值是 1000，我们设置为 100 以更频繁地同步数据
      db.pragma('wal_autocheckpoint = 100')
      
      console.log('数据库配置完成')
      
      // 🔧 启动定时 checkpoint 任务
      startCheckpointTimer()
    } catch (pragmaError) {
      console.warn('设置数据库pragma失败，使用默认配置:', pragmaError)
      // 即使 pragma 失败，也继续使用数据库
    }
    
    console.log('数据库连接成功:', dbPath)
    
    // 缓存到 globalThis
    globalThis.__db = db
    globalThis.__dbClosed = false
  } catch (error) {
    console.error('数据库连接失败:', error)
    console.error('数据库路径:', dbPath)
    console.error('数据目录:', dataDir)
    console.error('数据目录权限:', fs.existsSync(dataDir) ? '存在' : '不存在')
    throw error
  }
}

// 初始化数据库表
export function initDatabase() {
  try {
    // 创建媒体评分表
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        recommendation_reason TEXT,
        custom_evaluation TEXT,
        category TEXT,
        is_viewed BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT (datetime(\'now\', \'localtime\')),
        updated_at DATETIME DEFAULT (datetime(\'now\', \'localtime\'))
      )
    `)

    // 创建图组评分表
    db.exec(`
      CREATE TABLE IF NOT EXISTS group_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_path TEXT NOT NULL UNIQUE,
        group_name TEXT NOT NULL,
        file_count INTEGER NOT NULL,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        recommendation_reason TEXT,
        custom_evaluation TEXT,
        category TEXT,
        is_viewed BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT (datetime(\'now\', \'localtime\')),
        updated_at DATETIME DEFAULT (datetime(\'now\', \'localtime\'))
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS video_highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        start_seconds REAL NOT NULL,
        end_seconds REAL NOT NULL,
        duration_seconds REAL NOT NULL,
        title TEXT,
        note TEXT,
        tags TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `)

    // 创建自定义评价标签表
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL UNIQUE,
        usage_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime(\'now\', \'localtime\'))
      )
    `)

    // 创建分类表
    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        usage_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime(\'now\', \'localtime\'))
      )
    `)

    // 创建博主/创作者表
    db.exec(`
      CREATE TABLE IF NOT EXISTS creators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        primary_name TEXT NOT NULL UNIQUE,
        other_names TEXT,
        appearance_rating INTEGER CHECK(appearance_rating >= 1 AND appearance_rating <= 5),
        body_rating INTEGER CHECK(body_rating >= 1 AND body_rating <= 5),
        bio TEXT,
        avatar_path TEXT,
        usage_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime(\'now\', \'localtime\')),
        updated_at DATETIME DEFAULT (datetime(\'now\', \'localtime\'))
      )
    `)
    
    // 创建 creators 索引
    db.exec(`CREATE INDEX IF NOT EXISTS idx_creators_primary_name ON creators(primary_name)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_creators_usage ON creators(usage_count DESC)`)
    
    // 创建通用索引
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_video_highlights_file_path ON video_highlights(file_path)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_video_highlights_file_range ON video_highlights(file_path, start_seconds, end_seconds)`)
      console.log('✅ 创建通用索引成功')
    } catch (e: any) {
      console.warn('⚠️ 创建通用索引失败:', e.message)
    }
    
    // 创建特殊的"不认识"博主记录（ID = -1，不影响 AUTOINCREMENT 序列）
    try {
      const existingUnknown = db.prepare('SELECT id FROM creators WHERE id = ?').get(UNKNOWN_CREATOR_ID)
      
      if (!existingUnknown) {
        db.prepare(`
          INSERT INTO creators (id, primary_name, bio, usage_count)
          VALUES (?, ?, ?, ?)
        `).run(UNKNOWN_CREATOR_ID, '不认识', '用于标记无法识别的博主', 0)
        console.log(`✅ 创建特殊"不认识"博主记录成功 (ID: ${UNKNOWN_CREATOR_ID})`)
      }
    } catch (e: any) {
      console.warn('⚠️ 创建"不认识"博主记录失败:', e.message)
    }
    
    // 创建扫描缓存表
    db.exec(`
      CREATE TABLE IF NOT EXISTS scan_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webdav_url TEXT NOT NULL,
        webdav_username TEXT NOT NULL,
        path TEXT NOT NULL,
        files_data TEXT NOT NULL,
        total_files INTEGER NOT NULL,
        image_count INTEGER NOT NULL,
        video_count INTEGER NOT NULL,
        scan_settings TEXT NOT NULL,
        last_scan DATETIME DEFAULT (datetime(\'now\', \'localtime\')),
        created_at DATETIME DEFAULT (datetime(\'now\', \'localtime\')),
        UNIQUE(webdav_url, webdav_username, path)
      )
    `)

    // 创建定时扫描任务表
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webdav_url TEXT NOT NULL,
        webdav_username TEXT NOT NULL,
        webdav_password TEXT NOT NULL,
        media_paths TEXT NOT NULL,
        scan_settings TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        last_run DATETIME,
        next_run DATETIME,
        created_at DATETIME DEFAULT (datetime(\'now\', \'localtime\')),
        updated_at DATETIME DEFAULT (datetime(\'now\', \'localtime\'))
      )
    `)

    // 创建递归扫描任务表
    db.exec(`
      CREATE TABLE IF NOT EXISTS recursive_scan_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL UNIQUE,
        webdav_url TEXT NOT NULL,
        webdav_username TEXT NOT NULL,
        webdav_password TEXT NOT NULL,
        root_path TEXT NOT NULL,
        scan_settings TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        current_path TEXT,
        scanned_directories INTEGER DEFAULT 0,
        total_directories INTEGER DEFAULT 0,
        found_files INTEGER DEFAULT 0,
        pending_directories TEXT,
        completed_directories TEXT,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        next_retry_at DATETIME,
        rate_limited_until DATETIME,
        delay_until DATETIME,
        created_at DATETIME DEFAULT (datetime(\'now\', \'localtime\')),
        updated_at DATETIME DEFAULT (datetime(\'now\', \'localtime\')),
        started_at DATETIME,
        completed_at DATETIME
      )
    `)
    /*
     * 字段说明：
     * - retry_count: 任务重试次数
     * - next_retry_at: 下次重试时间
     * - rate_limited_until: 风控限制解除时间
     * - delay_until: 任务延迟执行时间（队列间隔）
     */

    // 添加新字段（如果表已存在）
    try {
      db.exec(`ALTER TABLE recursive_scan_tasks ADD COLUMN retry_count INTEGER DEFAULT 0`)
    } catch (e) { /* 字段已存在 */ }
    try {
      db.exec(`ALTER TABLE recursive_scan_tasks ADD COLUMN next_retry_at DATETIME`)
    } catch (e) { /* 字段已存在 */ }
    try {
      db.exec(`ALTER TABLE recursive_scan_tasks ADD COLUMN rate_limited_until DATETIME`)
    } catch (e) { /* 字段已存在 */ }
    try {
      db.exec(`ALTER TABLE recursive_scan_tasks ADD COLUMN delay_until DATETIME`)
    } catch (e) { /* 字段已存在 */ }

    // 创建递归扫描进度表
    db.exec(`
    `)

    // 创建 WebDAV 配置表
    db.exec(`
      CREATE TABLE IF NOT EXISTS webdav_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        media_paths TEXT NOT NULL,
        scan_settings TEXT NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        source_type TEXT DEFAULT 'clouddrive2',
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(url, username)
      )
    `)
    
    // 添加 source_type 字段（如果表已存在）
    try {
      db.exec(`ALTER TABLE webdav_configs ADD COLUMN source_type TEXT DEFAULT 'clouddrive2'`)
      console.log('✅ 添加 source_type 字段成功')
    } catch (e: any) {
      if (!e.message?.includes('duplicate column name')) {
        console.warn('⚠️ 添加 source_type 字段失败:', e.message)
      }
    }
    
    // 添加 direct_link_url 字段（直链源 URL）
    try {
      db.exec(`ALTER TABLE webdav_configs ADD COLUMN direct_link_url TEXT`)
      console.log('✅ 添加 direct_link_url 字段成功')
    } catch (e: any) {
      if (!e.message?.includes('duplicate column name')) {
        console.warn('⚠️ 添加 direct_link_url 字段失败:', e.message)
      }
    }
    
    // 添加 enable_direct_link 字段（是否启用直链播放）
    try {
      db.exec(`ALTER TABLE webdav_configs ADD COLUMN enable_direct_link BOOLEAN DEFAULT FALSE`)
      console.log('✅ 添加 enable_direct_link 字段成功')
    } catch (e: any) {
      if (!e.message?.includes('duplicate column name')) {
        console.warn('⚠️ 添加 enable_direct_link 字段失败:', e.message)
      }
    }

    // 创建扫描文件表（核心表，支持亿级数据）
    db.exec(`
      CREATE TABLE IF NOT EXISTS scan_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        basename TEXT NOT NULL,
        parent_path TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        file_type TEXT NOT NULL,
        lastmod TEXT,
        is_viewed BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (cache_id) REFERENCES scan_cache(id) ON DELETE CASCADE
      )
    `)

    // 创建 scan_files 索引（亿级数据必备）
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_cache ON scan_files(cache_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_type ON scan_files(file_type)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_viewed ON scan_files(is_viewed)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_parent ON scan_files(parent_path)`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_files_unique ON scan_files(cache_id, filename)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_query ON scan_files(cache_id, file_type, is_viewed)`)
    // 为 filename 单独创建索引，用于 mediaRatings.save 中的同步更新
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_filename ON scan_files(filename)`)

    // 创建文件级博主关联表（以 file_path 作为唯一关联键）
    db.exec(`
      CREATE TABLE IF NOT EXISTS scan_file_creators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL UNIQUE,
        parent_path TEXT NOT NULL,
        creator_id INTEGER REFERENCES creators(id),
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `)

    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_file_creators_file_path ON scan_file_creators(file_path)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_file_creators_parent_path ON scan_file_creators(parent_path)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_file_creators_creator_id ON scan_file_creators(creator_id)`)

    try {
      const backfillFilesResult = db.prepare(`
        INSERT INTO scan_file_creators (file_path, parent_path)
        SELECT sf.filename, sf.parent_path
        FROM scan_files sf
        LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
        WHERE sfc.file_path IS NULL
      `).run()
      console.log(`✅ 回填 scan_file_creators 文件记录成功: ${backfillFilesResult.changes} 条`)
    } catch (error: any) {
      console.warn('⚠️ 回填 scan_file_creators 文件记录失败:', error.message)
    }

    // 创建 media_ratings 索引（支持高级过滤查询）
    console.log('创建 media_ratings 索引（支持高级过滤）...')
    try {
      // 评分索引（最常用的过滤条件）
      db.exec(`CREATE INDEX IF NOT EXISTS idx_media_ratings_rating ON media_ratings(rating)`)
      // 复合索引（覆盖常见查询模式：JOIN + 评分过滤）
      db.exec(`CREATE INDEX IF NOT EXISTS idx_media_ratings_file_rating ON media_ratings(file_path, rating)`)
      // 评价理由索引（支持关键词搜索）
      db.exec(`CREATE INDEX IF NOT EXISTS idx_media_ratings_reason ON media_ratings(recommendation_reason)`)
      // is_viewed 索引（支持已看过/未看过筛选）
      db.exec(`CREATE INDEX IF NOT EXISTS idx_media_ratings_viewed ON media_ratings(is_viewed)`)
      console.log('✅ media_ratings 索引创建成功')
    } catch (error: any) {
      console.warn('⚠️ media_ratings 索引创建失败:', error.message)
    }
    
    // 🚀 动态分桶索引（表达式索引，支持亿级数据高效随机查询）
    // 使用 id % bucketCount 动态计算桶号，无需额外字段
    // 根据数据量自动选择最优桶数：1024/4096/16384
    console.log('创建动态分桶索引...')
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_bucket_1024 ON scan_files((id % 1024), cache_id, file_type, is_viewed)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_bucket_4096 ON scan_files((id % 4096), cache_id, file_type, is_viewed)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_bucket_16384 ON scan_files((id % 16384), cache_id, file_type, is_viewed)`)
      console.log('✅ 动态分桶索引创建成功（支持 1024/4096/16384 桶）')
    } catch (error: any) {
      console.warn('⚠️ 动态分桶索引创建失败（可能是 SQLite 版本过低）:', error.message)
      console.warn('   降级使用基础索引，性能可能稍差')
    }

    // 创建 scan_cache 索引（加速批量查询）
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_cache_config ON scan_cache(webdav_url, webdav_username)`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_cache_unique ON scan_cache(webdav_url, webdav_username, path)`)

    console.log('数据库表创建完成')
  } catch (error) {
    console.error('数据库表创建失败:', error)
    throw error
  }
}

// 图组评分仓储已拆分到独立模块 [`groupRatingRepository`](lib/groupRatingRepository.ts:1)

// 视频精彩片段仓储已拆分到独立模块 [`videoHighlightRepository`](lib/videoHighlightRepository.ts:1)

// 评分元数据仓储已拆分到独立模块 [`ratingMetadataRepository`](lib/ratingMetadataRepository.ts:1)
// creators 与文件级创作者关联仓储已拆分到独立模块 [`creatorRepository`](lib/creatorRepository.ts:1)

// 评分统计仓储已拆分到独立模块 [`ratingMetadataRepository`](lib/ratingMetadataRepository.ts:1)

// 扫描缓存仓储已拆分到 [`scanCacheRepository`](lib/scanCacheRepository.ts:1)

// 定时扫描相关操作
export const scheduledScans = {
  // 获取所有定时扫描任务
  getAll: () => {
    const stmt = db.prepare('SELECT * FROM scheduled_scans ORDER BY created_at DESC')
    return stmt.all()
  },

  // 获取活跃的定时扫描任务
  getActive: () => {
    const stmt = db.prepare('SELECT * FROM scheduled_scans WHERE is_active = TRUE ORDER BY next_run ASC')
    return stmt.all()
  },

  // 创建定时扫描任务
  create: (data: {
    webdavUrl: string
    webdavUsername: string
    webdavPassword: string
    mediaPaths: string[]
    scanSettings: any
    cronExpression: string
    isActive?: boolean
  }) => {
    const stmt = db.prepare(`
      INSERT INTO scheduled_scans 
      (webdav_url, webdav_username, webdav_password, media_paths, scan_settings, cron_expression, next_run, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    return stmt.run(
      data.webdavUrl,
      data.webdavUsername,
      data.webdavPassword,
      JSON.stringify(data.mediaPaths),
      JSON.stringify(data.scanSettings),
      data.cronExpression,
      calculateNextRun(data.cronExpression),
      data.isActive !== false ? 1 : 0
    )
  },

  // 更新定时扫描任务
  update: (id: number, data: {
    webdavUrl?: string
    webdavUsername?: string
    webdavPassword?: string
    mediaPaths?: string[]
    scanSettings?: any
    cronExpression?: string
    isActive?: boolean
  }) => {
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
      values.push(data.cronExpression)
      values.push(calculateNextRun(data.cronExpression))
    }
    if (data.isActive !== undefined) {
      updates.push('is_active = ?')
      values.push(data.isActive ? 1 : 0)
    }
    
    updates.push('updated_at = datetime(\'now\', \'localtime\')')
    values.push(id)
    
    const stmt = db.prepare(`UPDATE scheduled_scans SET ${updates.join(', ')} WHERE id = ?`)
    return stmt.run(...values)
  },

  // 删除定时扫描任务
  delete: (id: number) => {
    const stmt = db.prepare('DELETE FROM scheduled_scans WHERE id = ?')
    return stmt.run(id)
  },

  // 更新最后运行时间
  updateLastRun: (id: number) => {
    const stmt = db.prepare(`
      UPDATE scheduled_scans 
      SET last_run = datetime(\'now\', \'localtime\'), next_run = ?
      WHERE id = ?
    `)
    const task = db.prepare('SELECT cron_expression FROM scheduled_scans WHERE id = ?').get(id) as { cron_expression: string } | undefined
    if (task) {
      const nextRun = calculateNextRun(task.cron_expression)
      return stmt.run(nextRun, id)
    }
    return null
  }
}

// 递归扫描任务相关操作
export const recursiveScanTasks = {
  // 创建扫描任务
  create: (data: {
    taskId: string
    webdavUrl: string
    webdavUsername: string
    webdavPassword: string
    rootPath: string
    scanSettings: any
  }) => {
    const stmt = db.prepare(`
      INSERT INTO recursive_scan_tasks 
      (task_id, webdav_url, webdav_username, webdav_password, root_path, scan_settings, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `)
    return stmt.run(
      data.taskId,
      data.webdavUrl,
      data.webdavUsername,
      data.webdavPassword,
      data.rootPath,
      JSON.stringify(data.scanSettings)
    )
  },

  // 获取任务
  get: (taskId: string) => {
    const stmt = db.prepare('SELECT * FROM recursive_scan_tasks WHERE task_id = ?')
    return stmt.get(taskId)
  },

  // 更新任务状态
  updateStatus: (taskId: string, status: string, data?: {
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
    const updates = ['status = ?', 'updated_at = datetime(\'now\', \'localtime\')']
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
    
    if (status === 'running' && !data?.currentPath) {
      updates.push('started_at = datetime(\'now\', \'localtime\')')
    }
    if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = datetime(\'now\', \'localtime\')')
    }
    
    values.push(taskId)
    
    const stmt = db.prepare(`UPDATE recursive_scan_tasks SET ${updates.join(', ')} WHERE task_id = ?`)
    return stmt.run(...values)
  },

  // 获取所有任务
  getAll: () => {
    const stmt = db.prepare('SELECT * FROM recursive_scan_tasks ORDER BY created_at DESC')
    return stmt.all()
  },

  // 获取活跃任务（包含所有未完成状态）
  getActive: () => {
    const stmt = db.prepare("SELECT * FROM recursive_scan_tasks WHERE status IN ('pending', 'running', 'paused', 'rate_limited', 'waiting') ORDER BY created_at ASC")
    return stmt.all()
  },

  // 删除任务
  delete: (taskId: string) => {
    const stmt = db.prepare('DELETE FROM recursive_scan_tasks WHERE task_id = ?')
    return stmt.run(taskId)
  },

  // 清理过期任务（超过7天）
  cleanup: () => {
    const stmt = db.prepare('DELETE FROM recursive_scan_tasks WHERE created_at < datetime("now", "-7 days")')
    return stmt.run()
  }
}

// WebDAV 配置相关操作
export const webdavConfigs = {
  // 获取所有配置
  getAll: () => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM webdav_configs ORDER BY is_default DESC, created_at DESC')
      const rows = stmt.all()
      // 解析 JSON 字段并映射字段名
      return rows.map((row: any) => ({
        ...row,
        mediaPaths: JSON.parse(row.media_paths || '[]'),
        scanSettings: JSON.parse(row.scan_settings || '{}'),
        isDefault: row.is_default === 1,
        sourceType: row.source_type || 'clouddrive2', // 映射 source_type 为 sourceType
        directLinkUrl: row.direct_link_url || null, // 映射 direct_link_url 为 directLinkUrl
        enableDirectLink: row.enable_direct_link === 1, // 映射 enable_direct_link 为 enableDirectLink
      }))
    } catch (error) {
      console.error('获取 WebDAV 配置失败:', error)
      return []
    }
  },

  // 获取默认配置
  getDefault: () => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM webdav_configs WHERE is_default = TRUE LIMIT 1')
      const row: any = stmt.get()
      if (!row) return null
      
      return {
        ...row,
        mediaPaths: JSON.parse(row.media_paths || '[]'),
        scanSettings: JSON.parse(row.scan_settings || '{}'),
        isDefault: true,
        sourceType: row.source_type || 'clouddrive2', // 映射 source_type 为 sourceType
        directLinkUrl: row.direct_link_url || null, // 映射 direct_link_url 为 directLinkUrl
        enableDirectLink: row.enable_direct_link === 1, // 映射 enable_direct_link 为 enableDirectLink
      }
    } catch (error) {
      console.error('获取默认配置失败:', error)
      return null
    }
  },

  // 根据 URL 和用户名获取配置
  get: (url: string, username: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM webdav_configs WHERE url = ? AND username = ?')
      const row: any = stmt.get(url, username)
      if (!row) return null
      
      return {
        ...row,
        mediaPaths: JSON.parse(row.media_paths || '[]'),
        scanSettings: JSON.parse(row.scan_settings || '{}'),
        isDefault: row.is_default === 1,
        sourceType: row.source_type || 'clouddrive2', // 映射 source_type 为 sourceType
        directLinkUrl: row.direct_link_url || null, // 映射 direct_link_url 为 directLinkUrl
        enableDirectLink: row.enable_direct_link === 1, // 映射 enable_direct_link 为 enableDirectLink
      }
    } catch (error) {
      console.error('获取 WebDAV 配置失败:', error)
      return null
    }
  },

  // 创建或更新配置
  save: (data: {
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
      ensureInitialized()
      const existing = webdavConfigs.get(data.url, data.username)
      
      // 如果设置为默认配置，先将其他配置取消默认
      if (data.isDefault) {
        const stmt = db.prepare('UPDATE webdav_configs SET is_default = FALSE WHERE is_default = TRUE')
        stmt.run()
      }
      
      const mediaPathsStr = JSON.stringify(data.mediaPaths || [])
      const scanSettingsStr = JSON.stringify(data.scanSettings || {})
      const sourceType = data.sourceType || 'clouddrive2'
      const directLinkUrl = data.directLinkUrl || null
      const enableDirectLink = data.enableDirectLink ? 1 : 0
      
      if (existing) {
        // 更新现有配置
        console.log('更新现有配置:', data.url, data.username)
        const stmt = db.prepare(`
          UPDATE webdav_configs 
          SET password = ?, media_paths = ?, scan_settings = ?, 
              is_default = ?, source_type = ?, direct_link_url = ?, enable_direct_link = ?,
              updated_at = datetime('now', 'localtime')
          WHERE url = ? AND username = ?
        `)
        return stmt.run(
          data.password,
          mediaPathsStr,
          scanSettingsStr,
          data.isDefault ? 1 : 0,
          sourceType,
          directLinkUrl,
          enableDirectLink,
          data.url,
          data.username
        )
      } else {
        // 插入新配置
        // 如果没有其他配置，第一个配置自动设为默认
        const allConfigs = webdavConfigs.getAll()
        const shouldBeDefault = data.isDefault !== false && allConfigs.length === 0
        
        console.log('插入新配置:', data.url, data.username)
        const stmt = db.prepare(`
          INSERT INTO webdav_configs 
          (url, username, password, media_paths, scan_settings, is_default, source_type, direct_link_url, enable_direct_link)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        return stmt.run(
          data.url,
          data.username,
          data.password,
          mediaPathsStr,
          scanSettingsStr,
          shouldBeDefault ? 1 : (data.isDefault ? 1 : 0),
          sourceType,
          directLinkUrl,
          enableDirectLink
        )
      }
    } catch (error) {
      console.error('保存 WebDAV 配置失败:', error)
      throw error
    }
  },

  // 删除配置
  delete: (url: string, username: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare('DELETE FROM webdav_configs WHERE url = ? AND username = ?')
      return stmt.run(url, username)
    } catch (error) {
      console.error('删除 WebDAV 配置失败:', error)
      throw error
    }
  },

  // 设置默认配置
  setDefault: (url: string, username: string) => {
    try {
      ensureInitialized()
      // 先取消所有默认
      const stmt1 = db.prepare('UPDATE webdav_configs SET is_default = FALSE')
      stmt1.run()
      
      // 设置新的默认
      const stmt2 = db.prepare(`
        UPDATE webdav_configs 
        SET is_default = TRUE, updated_at = datetime('now', 'localtime')
        WHERE url = ? AND username = ?
      `)
      return stmt2.run(url, username)
    } catch (error) {
      console.error('设置默认配置失败:', error)
      throw error
    }
  }
}

// 扫描文件仓储已拆分到 [`scanFilesRepository`](lib/scanFilesRepository.ts:1)

// 计算下次运行时间（简单的cron表达式解析）
function calculateNextRun(cronExpression: string): string {
  try {
    const parts = cronExpression.split(' ')
    if (parts.length !== 5) {
      // 默认每小时运行一次
      const nextHour = new Date()
      nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0)
      return nextHour.toISOString()
    }
    
    const [minute, hour, day, month, weekday] = parts
    const now = new Date()
    let nextRun = new Date(now)
    
    // 处理分钟
    if (minute !== '*') {
      if (minute.includes('/')) {
        // 处理 */15 格式（每15分钟）
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
        // 处理具体分钟，如 15
        const targetMinute = parseInt(minute)
        if (isNaN(targetMinute) || targetMinute < 0 || targetMinute > 59) {
          nextRun.setMinutes(0, 0, 0)
        } else {
          nextRun.setMinutes(targetMinute, 0, 0)
        }
      }
    } else {
      // 分钟为*，设置为0分
      nextRun.setMinutes(0, 0, 0)
    }
    
    // 处理小时
    if (hour !== '*') {
      if (hour.includes('/')) {
        // 处理 */2 格式（每2小时）
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
        // 处理具体小时，如 14
        const targetHour = parseInt(hour)
        if (isNaN(targetHour) || targetHour < 0 || targetHour > 23) {
          // 无效小时，默认1小时后
          nextRun.setHours(nextRun.getHours() + 1)
          return nextRun.toISOString()
        }
        
        nextRun.setHours(targetHour)
      }
    }
    
    // 如果计算出的时间已经过了，需要调整到下一个执行时间
    if (nextRun <= now) {
      if (hour === '*') {
        // 每小时执行，加1小时
        nextRun.setHours(nextRun.getHours() + 1)
      } else if (hour.includes('/')) {
        // 间隔执行，计算下一个间隔
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
        // 具体时间，设置为明天
        nextRun.setDate(nextRun.getDate() + 1)
      }
    }
    
    // 验证日期是否有效
    if (isNaN(nextRun.getTime())) {
      // 如果日期无效，设置为1小时后
      const fallback = new Date()
      fallback.setHours(fallback.getHours() + 1, 0, 0, 0)
      return fallback.toISOString()
    }
    
    return nextRun.toISOString()
  } catch (error) {
    console.error('计算下次运行时间失败:', error)
    // 出错时返回1小时后
    const fallback = new Date()
    fallback.setHours(fallback.getHours() + 1, 0, 0, 0)
    return fallback.toISOString()
  }
}

// 在模块加载时尝试初始化
try {
  ensureInitialized()
  startCheckpointTimer()
} catch (error) {
  console.warn('模块加载时数据库初始化失败，将在首次使用时重试')
}

export default db
export { ensureInitialized }
