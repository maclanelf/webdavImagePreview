import Database from 'better-sqlite3'
import path from 'path'
import { getCurrentLocalISOString } from './timeUtils'
import { repairDatabase } from './repairDatabase'
import { UNKNOWN_CREATOR_ID } from './constants'

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

// 媒体评分相关操作
export const mediaRatings = {
  // 获取媒体评分
  get: (filePath: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM media_ratings WHERE file_path = ?')
      return stmt.get(filePath)
    } catch (error) {
      console.error('获取媒体评分失败:', error)
      return null
    }
  },

  // 保存或更新媒体评分
  save: (data: {
    filePath: string
    fileName: string
    fileType: string
    rating?: number
    recommendationReason?: string
    customEvaluation?: string | string[]
    category?: string | string[]
    isViewed?: boolean
    creatorId?: number | null
  }) => {
    const saveStartTime = Date.now()
    try {
      ensureInitialized()
      console.log(`⏱️ [mediaRatings.save] ensureInitialized: ${Date.now() - saveStartTime}ms`)
      
      const getStartTime = Date.now()
      const existing = mediaRatings.get(data.filePath)
      console.log(`⏱️ [mediaRatings.save] get existing: ${Date.now() - getStartTime}ms`)
    
    // 将数组转换为JSON字符串
    const customEvaluationStr = data.customEvaluation 
      ? (Array.isArray(data.customEvaluation) 
          ? JSON.stringify(data.customEvaluation) 
          : data.customEvaluation)
      : null
      
    const categoryStr = data.category
      ? (Array.isArray(data.category)
          ? JSON.stringify(data.category)
          : data.category)
      : null
    
    let result
    const dbStartTime = Date.now()
    if (existing) {
      // 更新
      const stmt = db.prepare(`
        UPDATE media_ratings 
        SET rating = ?, recommendation_reason = ?, custom_evaluation = ?, 
            category = ?, is_viewed = ?, updated_at = datetime('now', 'localtime')
        WHERE file_path = ?
      `)
      result = stmt.run(
        data.rating !== undefined ? data.rating : (existing as any).rating,
        data.recommendationReason !== undefined ? data.recommendationReason : (existing as any).recommendation_reason,
        customEvaluationStr !== null ? customEvaluationStr : (existing as any).custom_evaluation,
        categoryStr !== null ? categoryStr : (existing as any).category,
        data.isViewed !== undefined ? (data.isViewed ? 1 : 0) : (existing as any).is_viewed,
        data.filePath
      )
    } else {
      // 插入
      const stmt = db.prepare(`
        INSERT INTO media_ratings 
        (file_path, file_name, file_type, rating, recommendation_reason, 
         custom_evaluation, category, is_viewed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      result = stmt.run(
        data.filePath,
        data.fileName,
        data.fileType,
        data.rating || null,
        data.recommendationReason || null,
        customEvaluationStr,
        categoryStr,
        data.isViewed ? 1 : 0
      )
    }

    if (data.creatorId !== undefined) {
      scanFileCreators.save({
        filePath: data.filePath,
        parentPath: getParentPath(data.filePath),
        creatorId: data.creatorId,
      })
    }

    console.log(`⏱️ [mediaRatings.save] ${existing ? 'UPDATE' : 'INSERT'} media_ratings: ${Date.now() - dbStartTime}ms`)
    
    // 同步更新 scan_files 表的 is_viewed 状态
    if (data.isViewed !== undefined) {
      try {
        const scanUpdateStartTime = Date.now()
        const updateScanFilesStmt = db.prepare(`
          UPDATE scan_files 
          SET is_viewed = ?
          WHERE filename = ?
        `)
        const scanResult = updateScanFilesStmt.run(data.isViewed ? 1 : 0, data.filePath)
        console.log(`⏱️ [mediaRatings.save] UPDATE scan_files: ${Date.now() - scanUpdateStartTime}ms, changes=${scanResult.changes}`)
        
        if (scanResult.changes > 0) {
          console.log(`✅ [mediaRatings.save] 同步更新 scan_files 已看过状态: ${data.filePath}`)
        }
      } catch (scanError) {
        console.error(`⚠️ [mediaRatings.save] 同步更新 scan_files 失败:`, scanError)
        // 不影响主流程
      }
    }
    
    console.log(`⏱️ [mediaRatings.save] 总耗时: ${Date.now() - saveStartTime}ms`)
    return result
    } catch (error) {
      console.error('保存媒体评分失败:', error)
      throw error
    }
  },

  // 获取所有评分
  getAll: () => {
    const stmt = db.prepare('SELECT * FROM media_ratings ORDER BY updated_at DESC')
    return stmt.all()
  },

  // 删除评分
  delete: (filePath: string) => {
    const stmt = db.prepare('DELETE FROM media_ratings WHERE file_path = ?')
    return stmt.run(filePath)
  }
}

// 图组评分相关操作
export const groupRatings = {
  // 获取图组评分
  get: (groupPath: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM group_ratings WHERE group_path = ?')
      return stmt.get(groupPath)
    } catch (error) {
      console.error('获取图组评分失败:', error)
      return null
    }
  },

  // 保存或更新图组评分
  save: (data: {
    groupPath: string
    groupName: string
    fileCount: number
    rating?: number
    recommendationReason?: string
    customEvaluation?: string | string[]
    category?: string | string[]
    isViewed?: boolean
    creatorId?: number | null
  }) => {
    try {
      ensureInitialized()
      const existing = groupRatings.get(data.groupPath)
    
    // 将数组转换为JSON字符串
    const customEvaluationStr = data.customEvaluation 
      ? (Array.isArray(data.customEvaluation) 
          ? JSON.stringify(data.customEvaluation) 
          : data.customEvaluation)
      : null
      
    const categoryStr = data.category
      ? (Array.isArray(data.category)
          ? JSON.stringify(data.category)
          : data.category)
      : null
    
    let result
    if (existing) {
      // 更新
      const stmt = db.prepare(`
        UPDATE group_ratings 
        SET rating = ?, recommendation_reason = ?, custom_evaluation = ?, 
            category = ?, is_viewed = ?, updated_at = datetime(\'now\', \'localtime\')
        WHERE group_path = ?
      `)
      result = stmt.run(
        data.rating || null,
        data.recommendationReason || null,
        customEvaluationStr,
        categoryStr,
        data.isViewed ? 1 : 0,
        data.groupPath
      )
    } else {
      // 插入
      const stmt = db.prepare(`
        INSERT INTO group_ratings 
        (group_path, group_name, file_count, rating, recommendation_reason, 
         custom_evaluation, category, is_viewed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      result = stmt.run(
        data.groupPath,
        data.groupName,
        data.fileCount,
        data.rating || null,
        data.recommendationReason || null,
        customEvaluationStr,
        categoryStr,
        data.isViewed ? 1 : 0
      )
    }

    if (data.creatorId !== undefined) {
      scanFileCreators.setByParentPath(data.groupPath, data.creatorId ?? null)
    }

    return result

    } catch (error) {
      console.error('保存图组评分失败:', error)
      throw error
    }
  },

  // 获取所有图组评分
  getAll: () => {
    const stmt = db.prepare('SELECT * FROM group_ratings ORDER BY updated_at DESC')
    return stmt.all()
  },

  // 删除图组评分
  delete: (groupPath: string) => {
    const stmt = db.prepare('DELETE FROM group_ratings WHERE group_path = ?')
    return stmt.run(groupPath)
  }
}

// 自定义评价标签相关操作
export const videoHighlights = {
  getByFilePath: (filePath: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare(`
        SELECT *
        FROM video_highlights
        WHERE file_path = ?
        ORDER BY start_seconds ASC, id ASC
      `)
      return stmt.all(filePath)
    } catch (error) {
      console.error('获取精彩片段失败:', error)
      return []
    }
  },

  create: (data: {
    filePath: string
    fileName: string
    startSeconds: number
    endSeconds: number
    title?: string
    note?: string
    tags?: string[]
    sortOrder?: number
  }) => {
    ensureInitialized()

    const overlap = db.prepare(`
      SELECT id
      FROM video_highlights
      WHERE file_path = ?
        AND NOT (end_seconds <= ? OR start_seconds >= ?)
      LIMIT 1
    `).get(data.filePath, data.startSeconds, data.endSeconds) as { id: number } | undefined

    if (overlap) {
      throw new Error('时间重叠')
    }

    const durationSeconds = Number((data.endSeconds - data.startSeconds).toFixed(3))
    const stmt = db.prepare(`
      INSERT INTO video_highlights
      (file_path, file_name, start_seconds, end_seconds, duration_seconds, title, note, tags, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    return stmt.run(
      data.filePath,
      data.fileName,
      data.startSeconds,
      data.endSeconds,
      durationSeconds,
      data.title?.trim() || null,
      data.note?.trim() || null,
      data.tags && data.tags.length > 0 ? JSON.stringify(data.tags) : null,
      data.sortOrder ?? 0
    )
  },

  update: (id: number, data: {
    startSeconds: number
    endSeconds: number
    title?: string
    note?: string
    tags?: string[]
    sortOrder?: number
  }) => {
    ensureInitialized()

    const existing = db.prepare(`
      SELECT id, file_path
      FROM video_highlights
      WHERE id = ?
      LIMIT 1
    `).get(id) as { id: number; file_path: string } | undefined

    if (!existing) {
      throw new Error('精彩时刻不存在')
    }

    // 更新时也必须执行时间重叠校验。
    // 这里直接复用已查询到的 file_path，避免依赖 JOIN current 的隐式存在性；
    // 一旦目标记录不存在，上面的存在性检查会先返回 404，而不是静默更新 0 行。
    const overlap = db.prepare(`
      SELECT id
      FROM video_highlights
      WHERE file_path = ?
        AND id != ?
        AND NOT (end_seconds <= ? OR start_seconds >= ?)
      LIMIT 1
    `).get(existing.file_path, id, data.startSeconds, data.endSeconds) as { id: number } | undefined

    if (overlap) {
      // 与创建逻辑保持一致：一旦区间重叠，直接抛出业务错误，交由 API 层映射为 409。
      throw new Error('时间重叠')
    }

    const durationSeconds = Number((data.endSeconds - data.startSeconds).toFixed(3))
    const stmt = db.prepare(`
      UPDATE video_highlights
      SET start_seconds = ?, end_seconds = ?, duration_seconds = ?, title = ?, note = ?, tags = ?, sort_order = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `)

    const result = stmt.run(
      data.startSeconds,
      data.endSeconds,
      durationSeconds,
      data.title?.trim() || null,
      data.note?.trim() || null,
      data.tags && data.tags.length > 0 ? JSON.stringify(data.tags) : null,
      data.sortOrder ?? 0,
      id
    )

    if (result.changes === 0) {
      throw new Error('精彩时刻不存在')
    }

    return result
  },

  delete: (id: number) => {
    ensureInitialized()
    const stmt = db.prepare('DELETE FROM video_highlights WHERE id = ?')
    const result = stmt.run(id)

    if (result.changes === 0) {
      throw new Error('精彩时刻不存在')
    }

    return result
  }
}

export const customEvaluations = {
  // 获取所有标签
  getAll: () => {
    const stmt = db.prepare('SELECT * FROM custom_evaluations ORDER BY usage_count DESC, label ASC')
    return stmt.all()
  },

  // 添加或更新标签
  add: (label: string) => {
    const existing = db.prepare('SELECT * FROM custom_evaluations WHERE label = ?').get(label)
    
    if (existing) {
      // 增加使用次数
      const stmt = db.prepare('UPDATE custom_evaluations SET usage_count = usage_count + 1 WHERE label = ?')
      return stmt.run(label)
    } else {
      // 新增标签
      const stmt = db.prepare('INSERT INTO custom_evaluations (label) VALUES (?)')
      return stmt.run(label)
    }
  },

  // 删除标签
  delete: (label: string) => {
    try {
      const stmt = db.prepare('DELETE FROM custom_evaluations WHERE label = ?')
      return stmt.run(label)
    } catch (error: any) {
      if (error.code === 'SQLITE_BUSY') {
        console.warn('数据库繁忙，等待后重试...')
        // 等待一小段时间后重试
        const stmt = db.prepare('DELETE FROM custom_evaluations WHERE label = ?')
        return stmt.run(label)
      }
      throw error
    }
  }
}

// 分类相关操作
export const categories = {
  // 获取所有分类
  getAll: () => {
    const stmt = db.prepare('SELECT * FROM categories ORDER BY usage_count DESC, name ASC')
    return stmt.all()
  },

  // 添加或更新分类
  add: (name: string) => {
    const existing = db.prepare('SELECT * FROM categories WHERE name = ?').get(name)
    
    if (existing) {
      // 增加使用次数
      const stmt = db.prepare('UPDATE categories SET usage_count = usage_count + 1 WHERE name = ?')
      return stmt.run(name)
    } else {
      // 新增分类
      const stmt = db.prepare('INSERT INTO categories (name) VALUES (?)')
      return stmt.run(name)
    }
  },

  // 删除分类
  delete: (name: string) => {
    try {
      const stmt = db.prepare('DELETE FROM categories WHERE name = ?')
      return stmt.run(name)
    } catch (error: any) {
      if (error.code === 'SQLITE_BUSY') {
        console.warn('数据库繁忙，等待后重试...')
        // 等待一小段时间后重试
        const stmt = db.prepare('DELETE FROM categories WHERE name = ?')
        return stmt.run(name)
      }
      throw error
    }
  }
}

// 博主别名缓存（用于智能关联性能优化）
let creatorAliasCache: {
  data: Array<{ id: number; primaryName: string; aliases: string[] }> | null
  lastUpdate: number
  ttl: number // 缓存有效期（毫秒）
} = {
  data: null,
  lastUpdate: 0,
  ttl: 5 * 60 * 1000 // 5分钟
}

// 清除博主别名缓存（在创建/更新/删除博主时调用）
function clearCreatorAliasCache() {
  creatorAliasCache.data = null
  creatorAliasCache.lastUpdate = 0
  console.log('🗑️ [缓存] 博主别名缓存已清除')
}

// 获取博主别名缓存
function getCreatorAliasCache() {
  const now = Date.now()
  
  // 检查缓存是否有效
  if (creatorAliasCache.data && (now - creatorAliasCache.lastUpdate) < creatorAliasCache.ttl) {
    console.log('✅ [缓存] 使用博主别名缓存')
    return creatorAliasCache.data
  }
  
  // 重新加载缓存
  console.log('🔄 [缓存] 重新加载博主别名缓存')
  const stmt = db.prepare(`
    SELECT id, primary_name, other_names
    FROM creators 
    ORDER BY usage_count DESC, id ASC
  `)
  const creators = stmt.all()
  
  creatorAliasCache.data = creators.map((c: any) => ({
    id: c.id,
    primaryName: c.primary_name,  // 数据库字段名
    aliases: c.other_names ? JSON.parse(c.other_names) : []
  }))
  creatorAliasCache.lastUpdate = now
  
  return creatorAliasCache.data
}

// 博主/创作者相关操作
export const creators = {
  // 获取所有博主
  getAll: () => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM creators ORDER BY usage_count DESC, primary_name ASC')
      const rows = stmt.all()
      // 转换字段名：下划线 -> 驼峰，并解析 JSON 字段
      return rows.map((row: any) => ({
        id: row.id,
        primaryName: row.primary_name,
        otherNames: row.other_names ? JSON.parse(row.other_names) : [],
        appearanceRating: row.appearance_rating,
        bodyRating: row.body_rating,
        bio: row.bio,
        avatarPath: normalizeAvatarPath(row.avatar_path),
        usageCount: row.usage_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    } catch (error) {
      console.error('获取博主列表失败:', error)
      return []
    }
  },

  // 根据 ID 获取博主
  get: (id: number) => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM creators WHERE id = ?')
      const row: any = stmt.get(id)
      if (!row) return null
      
      // 转换字段名：下划线 -> 驼峰
      return {
        id: row.id,
        primaryName: row.primary_name,
        otherNames: row.other_names ? JSON.parse(row.other_names) : [],
        appearanceRating: row.appearance_rating,
        bodyRating: row.body_rating,
        bio: row.bio,
        avatarPath: normalizeAvatarPath(row.avatar_path),
        usageCount: row.usage_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    } catch (error) {
      console.error('获取博主失败:', error)
      return null
    }
  },

  // 搜索博主（支持模糊搜索主名称和别名）
  search: (keyword: string) => {
    try {
      ensureInitialized()
      const searchTerm = `%${keyword}%`
      
      // 搜索主名称或别名包含关键词的博主
      const stmt = db.prepare(`
        SELECT * FROM creators 
        WHERE primary_name LIKE ? OR other_names LIKE ?
        ORDER BY 
          CASE 
            WHEN primary_name = ? THEN 0
            WHEN primary_name LIKE ? THEN 1
            ELSE 2
          END,
          usage_count DESC,
          primary_name ASC
        LIMIT 20
      `)
      
      const rows = stmt.all(searchTerm, searchTerm, keyword, `${keyword}%`)
      
      // 转换字段名：下划线 -> 驼峰，并解析 JSON 字段
      return rows.map((row: any) => ({
        id: row.id,
        primaryName: row.primary_name,
        otherNames: row.other_names ? JSON.parse(row.other_names) : [],
        appearanceRating: row.appearance_rating,
        bodyRating: row.body_rating,
        bio: row.bio,
        avatarPath: normalizeAvatarPath(row.avatar_path),
        usageCount: row.usage_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    } catch (error) {
      console.error('搜索博主失败:', error)
      return []
    }
  },

  // 创建或更新博主
  save: (data: {
    id?: number
    primaryName: string
    otherNames?: string[]
    appearanceRating?: number
    bodyRating?: number
    bio?: string
    avatarPath?: string
  }) => {
    try {
      ensureInitialized()
      
      // 处理别名：确保主名称也在别名列表中
      let otherNames = data.otherNames ? [...data.otherNames] : []
      otherNames = Array.from(
        new Set(
          otherNames
            .map((name) => name.trim())
            .filter(Boolean)
        )
      )
      
      // 如果是新建博主，自动将主名称添加到别名列表
      if (!data.id && !otherNames.includes(data.primaryName)) {
        otherNames.push(data.primaryName)
      }
      
      const otherNamesStr = otherNames.length > 0 ? JSON.stringify(otherNames) : null
      
      let result
      let creatorId: number
      if (data.id) {
        // 更新现有博主
        const stmt = db.prepare(`
          UPDATE creators 
          SET primary_name = ?, other_names = ?, appearance_rating = ?, 
              body_rating = ?, bio = ?, avatar_path = ?,
              updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `)
        result = stmt.run(
          data.primaryName,
          otherNamesStr,
          data.appearanceRating || null,
          data.bodyRating || null,
          data.bio || null,
          data.avatarPath || null,
          data.id
        )
        creatorId = data.id
      } else {
        // 创建新博主 - 先检查是否已存在同名博主
        const existingByName = db.prepare('SELECT id FROM creators WHERE primary_name = ?').get(data.primaryName) as { id: number } | undefined
        if (existingByName) {
          // 已存在同名博主，改为更新
          const stmt = db.prepare(`
            UPDATE creators 
            SET other_names = ?, appearance_rating = ?, 
                body_rating = ?, bio = ?, avatar_path = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
          `)
          result = stmt.run(
            otherNamesStr,
            data.appearanceRating || null,
            data.bodyRating || null,
            data.bio || null,
            data.avatarPath || null,
            existingByName.id
          )
          // 让调用方知道实际使用的 id
          ;(result as any).existingId = existingByName.id
          creatorId = existingByName.id
        } else {
          const stmt = db.prepare(`
            INSERT INTO creators 
            (primary_name, other_names, appearance_rating, body_rating, bio, avatar_path)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          result = stmt.run(
            data.primaryName,
            otherNamesStr,
            data.appearanceRating || null,
            data.bodyRating || null,
            data.bio || null,
            data.avatarPath || null
          )
          creatorId = Number(result.lastInsertRowid)
        }
      }

      const aliasNamesToMerge = otherNames.filter((name) => name !== data.primaryName)
      if (aliasNamesToMerge.length > 0) {
        const placeholders = aliasNamesToMerge.map(() => '?').join(',')
        const aliasRows = db.prepare(`
          SELECT id
          FROM creators
          WHERE primary_name IN (${placeholders}) AND id != ?
        `).all(...aliasNamesToMerge, creatorId) as Array<{ id: number }>

        const sourceIds = Array.from(new Set(aliasRows.map((row) => row.id)))
        if (sourceIds.length > 0) {
          creators.merge(creatorId, sourceIds)
          ;(result as any).mergedSourceIds = sourceIds
        }
      }
      
      // 清除缓存
      clearCreatorAliasCache()
      
      return result
    } catch (error) {
      console.error('保存博主失败:', error)
      throw error
    }
  },

  // 更换主名称
  changePrimaryName: (id: number, newName: string, addOldToOthers: boolean = true) => {
    try {
      ensureInitialized()
      
      const creator = creators.get(id)
      if (!creator) {
        throw new Error('博主不存在')
      }
      
      const normalizedNewName = newName.trim()
      if (!normalizedNewName) {
        throw new Error('新主名称不能为空')
      }

      const allowedNames = new Set([creator.primaryName, ...creator.otherNames])
      if (!allowedNames.has(normalizedNewName)) {
        throw new Error('新主名称必须是当前主名称或已有别名')
      }

      const otherNames = [...creator.otherNames]
      
      // 如果需要，将旧的主名称添加到其他名称
      if (addOldToOthers && !otherNames.includes(creator.primaryName)) {
        otherNames.push(creator.primaryName)
      }
      
      
      const stmt = db.prepare(`
        UPDATE creators 
        SET primary_name = ?, other_names = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `)
      const result = stmt.run(normalizedNewName, JSON.stringify(otherNames), id)
      
      // 清除缓存
      clearCreatorAliasCache()
      
      return result
    } catch (error) {
      console.error('更换主名称失败:', error)
      throw error
    }
  },

  // 添加别名
  addOtherName: (id: number, name: string) => {
    try {
      ensureInitialized()
      
      const creator = creators.get(id)
      if (!creator) {
        throw new Error('博主不存在')
      }
      
      const otherNames = [...creator.otherNames]
      
      // 检查是否已存在
      if (otherNames.includes(name) || creator.primaryName === name) {
        return { success: false, message: '名称已存在' }
      }
      
      otherNames.push(name)
      
      const stmt = db.prepare(`
        UPDATE creators 
        SET other_names = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `)
      stmt.run(JSON.stringify(otherNames), id)
      
      // 清除缓存
      clearCreatorAliasCache()
      
      return { success: true }
    } catch (error) {
      console.error('添加别名失败:', error)
      throw error
    }
  },

  // 删除别名
  removeOtherName: (id: number, name: string) => {
    try {
      ensureInitialized()
      
      const creator = creators.get(id)
      if (!creator) {
        throw new Error('博主不存在')
      }
      
      const otherNames = creator.otherNames.filter((n: string) => n !== name)
      
      const stmt = db.prepare(`
        UPDATE creators 
        SET other_names = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `)
      const result = stmt.run(JSON.stringify(otherNames), id)
      
      // 清除缓存
      clearCreatorAliasCache()
      
      return result
    } catch (error) {
      console.error('删除别名失败:', error)
      throw error
    }
  },

  // 合并博主（将多个博主合并为一个）
  merge: (targetId: number, sourceIds: number[]) => {
    try {
      ensureInitialized()
      
      const target = creators.get(targetId)
      if (!target) {
        throw new Error('目标博主不存在')
      }
      
      // 使用事务确保数据一致性
      const normalizedSourceIds = Array.from(
        new Set(sourceIds.filter((sourceId) => Number.isInteger(sourceId) && sourceId !== targetId))
      )
      if (normalizedSourceIds.length === 0) {
        throw new Error('请至少选择一个待合并博主')
      }

      const mergeTransaction = db.transaction(() => {
        const allOtherNames = [...target.otherNames]
        
        for (const sourceId of normalizedSourceIds) {
          const source = creators.get(sourceId)
          if (!source) continue
          
          // 收集所有名称
          if (!allOtherNames.includes(source.primaryName)) {
            allOtherNames.push(source.primaryName)
          }
          source.otherNames.forEach((name: string) => {
            if (!allOtherNames.includes(name) && name !== target.primaryName) {
              allOtherNames.push(name)
            }
          })
          
          db.prepare(`
            UPDATE scan_file_creators
            SET creator_id = ?, updated_at = datetime('now', 'localtime')
            WHERE creator_id = ?
          `).run(targetId, sourceId)
          
          // 删除源博主
          db.prepare('DELETE FROM creators WHERE id = ?').run(sourceId)
        }
        
        // 更新目标博主的其他名称和使用次数
        const stmt = db.prepare(`
          UPDATE creators 
          SET other_names = ?, 
              usage_count = (
                SELECT COUNT(*) FROM scan_file_creators WHERE creator_id = ?
              ),
              updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `)
        stmt.run(JSON.stringify(allOtherNames), targetId, targetId)
      })
      
      mergeTransaction()
      
      // 清除缓存
      clearCreatorAliasCache()
      
      return { success: true }
    } catch (error) {
      console.error('合并博主失败:', error)
      throw error
    }
  },

  // 删除博主
  delete: (id: number) => {
    try {
      ensureInitialized()
      
      // 使用事务确保数据一致性
      const deleteTransaction = db.transaction(() => {
        db.prepare(`
          UPDATE scan_file_creators
          SET creator_id = NULL, updated_at = datetime('now', 'localtime')
          WHERE creator_id = ?
        `).run(id)
        
        // 删除博主
        db.prepare('DELETE FROM creators WHERE id = ?').run(id)
      })
      
      deleteTransaction()
      
      // 清除缓存
      clearCreatorAliasCache()
      
      return { success: true }
    } catch (error) {
      console.error('删除博主失败:', error)
      throw error
    }
  },

  // 获取博主的所有文件
  getFiles: (id: number, options?: { type?: 'media' | 'group' }) => {
    try {
      ensureInitialized()
      
      const { type } = options || {}
      const results: any = { media: [], groups: [] }
      
      if (!type || type === 'media') {
        const stmt = db.prepare(`
          SELECT
            sfc.file_path,
            sfc.parent_path,
            sfc.creator_id,
            sfc.created_at AS linked_at,
            sfc.updated_at AS linked_updated_at,
            mr.*
          FROM scan_file_creators sfc
          LEFT JOIN media_ratings mr ON mr.file_path = sfc.file_path
          WHERE sfc.creator_id = ?
          ORDER BY COALESCE(mr.updated_at, sfc.updated_at) DESC
        `)
        results.media = stmt.all(id)
      }
      
      if (!type || type === 'group') {
        const stmt = db.prepare(`
          SELECT
            sfc.parent_path AS group_path,
            COALESCE(gr.group_name, sfc.parent_path) AS group_name,
            COUNT(*) AS file_count,
            gr.rating,
            gr.recommendation_reason,
            gr.custom_evaluation,
            gr.category,
            gr.is_viewed,
            gr.created_at,
            gr.updated_at,
            ? AS creator_id
          FROM scan_file_creators sfc
          LEFT JOIN group_ratings gr ON gr.group_path = sfc.parent_path
          WHERE sfc.creator_id = ?
            AND sfc.parent_path IS NOT NULL
          GROUP BY sfc.parent_path, gr.group_name, gr.rating, gr.recommendation_reason, gr.custom_evaluation, gr.category, gr.is_viewed, gr.created_at, gr.updated_at
          ORDER BY COALESCE(gr.updated_at, MAX(sfc.updated_at)) DESC
        `)
        results.groups = stmt.all(id, id)
      }
      
      return results
    } catch (error) {
      console.error('获取博主文件失败:', error)
      return { media: [], groups: [] }
    }
  },

  // 获取博主统计信息
  getStats: (id: number) => {
    try {
      ensureInitialized()
      
      const mediaStmt = db.prepare(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as rated,
          AVG(rating) as avg_rating
        FROM scan_file_creators sfc
        LEFT JOIN media_ratings mr ON mr.file_path = sfc.file_path
        WHERE sfc.creator_id = ?
      `)
      const mediaStats = mediaStmt.get(id) as any
      
      const groupStmt = db.prepare(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN gr.rating IS NOT NULL THEN 1 END) as rated,
          AVG(gr.rating) as avg_rating
        FROM (
          SELECT DISTINCT sfc.parent_path
          FROM scan_file_creators sfc
          WHERE sfc.parent_path IS NOT NULL
            AND sfc.creator_id = ?
        ) creator_groups
        LEFT JOIN group_ratings gr ON gr.group_path = creator_groups.parent_path
      `)
      const groupStats = groupStmt.get(id) as any
      
      return {
        mediaFiles: mediaStats.total || 0,
        mediaRated: mediaStats.rated || 0,
        mediaAvgRating: mediaStats.avg_rating || 0,
        groupFiles: groupStats.total || 0,
        groupRated: groupStats.rated || 0,
        groupAvgRating: groupStats.avg_rating || 0,
        totalFiles: (mediaStats.total || 0) + (groupStats.total || 0)
      }
    } catch (error) {
      console.error('获取博主统计失败:', error)
      return {
        mediaFiles: 0,
        mediaRated: 0,
        mediaAvgRating: 0,
        groupFiles: 0,
        groupRated: 0,
        groupAvgRating: 0,
        totalFiles: 0
      }
    }
  },

  // 根据文件路径智能匹配博主（从别名列表匹配）
  // 使用缓存优化性能，避免每次都查询数据库
  findCreatorByPath: (filePath: string) => {
    try {
      ensureInitialized()
      
      // 提取第3个/到倒数第1个/之间的文字作为匹配路径
      // 例如: /115open/115/700+网红大合集/001/抖音 Booty徐莉芝/1.jpg
      // 提取: 700+网红大合集/001/抖音 Booty徐莉芝
      const pathParts = filePath.split('/')
      let matchPath = filePath
      
      if (pathParts.length > 4) {
        // 从第3个/（索引2）到倒数第1个/（length-2）
        const startIndex = 3 // 第3个/后面的内容
        const endIndex = pathParts.length - 1 // 倒数第1个/前面的内容
        matchPath = pathParts.slice(startIndex, endIndex).join('/')
        console.log(`🔍 [路径提取] 原始路径: ${filePath}`)
        console.log(`🔍 [路径提取] 匹配路径: ${matchPath}`)
      }
      
      // 使用缓存获取博主别名列表
      const cachedCreators = getCreatorAliasCache()
      
      // 遍历博主，检查路径是否包含其任何别名
      for (const creator of cachedCreators) {
        // 检查所有别名
        for (const alias of creator.aliases) {
          if (matchPath.includes(alias)) {
            console.log(`🎯 [智能关联] 路径匹配成功: "${matchPath}" 包含博主 "${creator.primaryName}" 的别名 "${alias}"`)
            
            // 返回完整的博主信息
            return creators.get(creator.id)
          }
        }
      }
      
      return null
    } catch (error) {
      console.error('智能匹配博主失败:', error)
      return null
    }
  },

  // 预览批量关联影响范围
  previewBatchLink: (namePattern: string) => {
    try {
      ensureInitialized()
      
      // 查询 media_ratings 中包含该名称的记录
      const mediaStmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM scan_files 
        WHERE filename LIKE ? OR parent_path LIKE ?
      `)
      const mediaResult = mediaStmt.get(`%${namePattern}%`, `%${namePattern}%`) as { count: number }
      
      // 查询匹配目录数量
      const groupStmt = db.prepare(`
        SELECT COUNT(DISTINCT parent_path) as count 
        FROM scan_files 
        WHERE parent_path LIKE ?
      `)
      const groupResult = groupStmt.get(`%${namePattern}%`) as { count: number }
      
      // 获取示例记录（前5条）
      const sampleMediaStmt = db.prepare(`
        SELECT filename as file_path, basename as file_name, file_type
        FROM scan_files 
        WHERE filename LIKE ? OR parent_path LIKE ?
        LIMIT 5
      `)
      const mediaSamples = sampleMediaStmt.all(`%${namePattern}%`, `%${namePattern}%`)
      
      const sampleGroupStmt = db.prepare(`
        SELECT DISTINCT parent_path as group_path, parent_path as group_name
        FROM scan_files 
        WHERE parent_path LIKE ?
        LIMIT 5
      `)
      const groupSamples = sampleGroupStmt.all(`%${namePattern}%`)
      
      return {
        mediaCount: mediaResult.count,
        groupCount: groupResult.count,
        totalCount: mediaResult.count + groupResult.count,
        mediaSamples,
        groupSamples
      }
    } catch (error) {
      console.error('预览批量关联失败:', error)
      throw error
    }
  },

  // 批量关联文件到博主
  batchLinkFilesByName: (creatorId: number, namePattern: string) => {
    try {
      ensureInitialized()
      
      // 验证博主是否存在
      const creator = creators.get(creatorId)
      if (!creator) {
        throw new Error('博主不存在')
      }
      
      console.log(`🔍 [批量关联] 开始: 博主ID=${creatorId}, 名称="${creator.primaryName}", 模式="${namePattern}"`)
      
      // 使用事务确保数据一致性
      const batchLinkTransaction = db.transaction(() => {
        const matchedFiles = db.prepare(`
          SELECT filename, parent_path
          FROM scan_files
          WHERE filename LIKE ? OR parent_path LIKE ?
        `).all(`%${namePattern}%`, `%${namePattern}%`) as Array<{ filename: string; parent_path: string }>

        matchedFiles.forEach((file) => {
          scanFileCreators.save({
            filePath: file.filename,
            parentPath: file.parent_path,
            creatorId,
          })
        })

        console.log(`📊 [批量关联] scan_file_creators 更新: ${matchedFiles.length} 条`)

        const distinctGroups = new Set(matchedFiles.map((file) => file.parent_path).filter(Boolean))
        const filesUpdated = matchedFiles.length
        const groupsAffected = distinctGroups.size
        
        // 更新博主的使用次数
        const updateUsageStmt = db.prepare(`
          UPDATE creators 
          SET usage_count = (
            SELECT COUNT(*) FROM scan_file_creators WHERE creator_id = ?
          ),
          updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `)
        updateUsageStmt.run(creatorId, creatorId)
        
        return {
          filesUpdated,
          groupsAffected,
          mediaUpdated: filesUpdated,
          groupUpdated: groupsAffected,
        }
      })
      
      const result = batchLinkTransaction()
      console.log(`✅ [批量关联] 完成: 关联 ${result.filesUpdated} 个文件，涉及 ${result.groupsAffected} 个图组`)
      
      // 验证更新结果
      const verifyStmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM scan_file_creators 
        WHERE creator_id = ? AND (file_path LIKE ? OR parent_path LIKE ?)
      `)
      const verifyResult = verifyStmt.get(creatorId, `%${namePattern}%`, `%${namePattern}%`) as { count: number }
      console.log(`🔍 [批量关联] 验证: scan_file_creators 中有 ${verifyResult.count} 条记录关联到博主 ${creatorId}`)
      
      return result
    } catch (error) {
      console.error('批量关联文件失败:', error)
      throw error
    }
  },

  // 添加别名并批量关联历史记录
  addOtherNameAndLinkFiles: (creatorId: number, newName: string, batchUpdate: boolean = false) => {
    try {
      ensureInitialized()
      
      // 检查博主是否存在
      const creator = creators.get(creatorId)
      if (!creator) {
        return { success: false, message: '博主不存在' }
      }
      
      // 检查别名是否已存在
      const aliasExists = creator.otherNames.includes(newName) || creator.primaryName === newName
      
      // 如果别名不存在，先添加
      if (!aliasExists) {
        const addResult = creators.addOtherName(creatorId, newName)
        if (!addResult.success) {
          return addResult
        }
      }
      
      // 如果需要批量更新
      if (batchUpdate) {
        const linkResult = creators.batchLinkFilesByName(creatorId, newName)
        const message = aliasExists 
          ? `别名已存在，关联了 ${linkResult.filesUpdated} 个文件，涉及 ${linkResult.groupsAffected} 个图组`
          : `别名添加成功，关联了 ${linkResult.filesUpdated} 个文件，涉及 ${linkResult.groupsAffected} 个图组`
        
        return {
          success: true,
          message,
          ...linkResult
        }
      }
      
        return {
          success: true,
          message: aliasExists ? '别名已存在' : '别名添加成功',
          filesUpdated: 0,
          groupsAffected: 0,
          mediaUpdated: 0,
          groupUpdated: 0,
        }
    } catch (error) {
      console.error('添加别名并批量关联失败:', error)
      throw error
    }
  }
}

// 统计相关操作
export const statistics = {
  // 获取媒体评分统计
  getMediaStats: () => {
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as rated,
        COUNT(CASE WHEN is_viewed = 1 THEN 1 END) as viewed,
        AVG(rating) as avg_rating
      FROM media_ratings
    `)
    return stmt.get()
  },

  // 获取图组评分统计
  getGroupStats: () => {
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as rated,
        COUNT(CASE WHEN is_viewed = 1 THEN 1 END) as viewed,
        AVG(rating) as avg_rating
      FROM group_ratings
    `)
    return stmt.get()
  },

  // 获取最常用的评价标签
  getTopEvaluations: (limit: number = 10) => {
    const stmt = db.prepare('SELECT * FROM custom_evaluations ORDER BY usage_count DESC LIMIT ?')
    return stmt.all(limit)
  },

  // 获取最常用的分类
  getTopCategories: (limit: number = 10) => {
    const stmt = db.prepare('SELECT * FROM categories ORDER BY usage_count DESC LIMIT ?')
    return stmt.all(limit)
  }
}

// 扫描缓存相关操作
export const scanCache = {
  // 获取缓存
  get: (webdavUrl: string, webdavUsername: string, path: string) => {
    const stmt = db.prepare('SELECT * FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? AND path = ?')
    return stmt.get(webdavUrl, webdavUsername, path)
  },

  // 获取表中总记录数
  count: () => {
    const result = db.prepare('SELECT COUNT(*) as count FROM scan_cache').get() as { count: number }
    return result.count
  },

  // 批量获取多个路径的缓存（一次查询，避免循环查询）
  getMultiple: (webdavUrl: string, webdavUsername: string, paths: string[]) => {
    if (paths.length === 0) return []
    const startTime = Date.now()
    const placeholders = paths.map(() => '?').join(',')
    const sql = `SELECT id, path FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? AND path IN (${placeholders})`
    const stmt = db.prepare(sql)
    const result = stmt.all(webdavUrl, webdavUsername, ...paths)
    console.log(`⏱️ [scanCache.getMultiple] SQL执行: ${Date.now() - startTime}ms, 返回${result.length}条`)
    return result
  },

  // 保存缓存
  save: (data: {
    webdavUrl: string
    webdavUsername: string
    path: string
    filesData: string
    totalFiles: number
    imageCount: number
    videoCount: number
    scanSettings: string
  }) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO scan_cache 
      (webdav_url, webdav_username, path, files_data, total_files, image_count, video_count, scan_settings, last_scan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\', \'localtime\'))
    `)
    return stmt.run(
      data.webdavUrl,
      data.webdavUsername,
      data.path,
      data.filesData,
      data.totalFiles,
      data.imageCount,
      data.videoCount,
      data.scanSettings
    )
  },

  // 删除缓存
  delete: (webdavUrl: string, webdavUsername: string, path: string) => {
    const stmt = db.prepare('DELETE FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? AND path = ?')
    return stmt.run(webdavUrl, webdavUsername, path)
  },

  // 清理过期缓存（超过7天）
  cleanup: () => {
    const stmt = db.prepare('DELETE FROM scan_cache WHERE last_scan < datetime("now", "-7 days")')
    return stmt.run()
  },

  // 获取所有缓存数据
  getAll: () => {
    const stmt = db.prepare('SELECT * FROM scan_cache ORDER BY last_scan DESC')
    return stmt.all()
  },

  // 根据WebDAV配置获取缓存数据
  getByWebDAVConfig: (webdavUrl: string, webdavUsername: string) => {
    const stmt = db.prepare('SELECT * FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? ORDER BY last_scan DESC')
    return stmt.all(webdavUrl, webdavUsername)
  }
}

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

// 辅助函数：获取父目录路径
function getParentPath(filename: string): string {
  const lastSlash = filename.lastIndexOf('/')
  return lastSlash > 0 ? filename.substring(0, lastSlash) : '/'
}

// 支持的图片格式
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.tiff', '.tif', '.svg', '.ico',
  '.heic', '.heif', '.avif', '.jxl',
  '.raw', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2', '.pef', '.srw',
  '.psd', '.ai', '.eps', '.pcx', '.tga', '.exr', '.hdr'
])

// 辅助函数：判断文件类型
function getFileType(basename: string): 'image' | 'video' {
  const ext = basename.substring(basename.lastIndexOf('.')).toLowerCase()
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image'
  }
  return 'video'
}

/**
 * 规范化博主头像路径。
 *
 * 历史数据里存在把未设置头像写成字符串 `0` 的情况，
 * 前端若直接把它作为图片地址，会自动请求 [`/0`](0)，属于无意义请求。
 */
function normalizeAvatarPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || trimmed === '0' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return null
  }

  return trimmed
}

function parseCreatorOtherNames(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      return filtered.length > 0 ? filtered : undefined
    }

    if (typeof parsed === 'string' && parsed.trim()) {
      return [parsed.trim()]
    }
  } catch {
    return [trimmed]
  }

  return undefined
}

function buildCreatorSummaryFromJoinedRow(row: any) {
  const linkedCreatorId = row.creator_linked_id
  if (typeof linkedCreatorId !== 'number') {
    return null
  }

  return {
    id: linkedCreatorId,
    primaryName: row.creator_primary_name,
    otherNames: parseCreatorOtherNames(row.creator_other_names),
    appearanceRating: row.creator_appearance_rating ?? null,
    bodyRating: row.creator_body_rating ?? null,
    bio: row.creator_bio ?? null,
    avatarPath: normalizeAvatarPath(row.creator_avatar_path),
  }
}

function attachCreatorInfoToScanFileRow(row: any) {
  const creatorId = typeof row.creator_id === 'number' ? row.creator_id : null
  const creator = buildCreatorSummaryFromJoinedRow(row)

  return {
    ...row,
    creator,
    creatorResolved: creatorId === UNKNOWN_CREATOR_ID || creator !== null,
  }
}

// 文件级博主关联表操作
export const scanFileCreators = {
  get: (filePath: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM scan_file_creators WHERE file_path = ?')
      return stmt.get(filePath)
    } catch (error) {
      console.error('获取文件博主关联失败:', error)
      return null
    }
  },

  getAll: () => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM scan_file_creators ORDER BY updated_at DESC, id DESC')
      return stmt.all()
    } catch (error) {
      console.error('获取全部文件博主关联失败:', error)
      return []
    }
  },

  getTopCreatorByParentPath: (parentPath: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare(`
        SELECT creator_id AS creatorId, COUNT(*) AS fileCount
        FROM scan_file_creators
        WHERE parent_path = ?
          AND creator_id IS NOT NULL
        GROUP BY creator_id
        ORDER BY fileCount DESC, creator_id ASC
        LIMIT 1
      `)
      return stmt.get(parentPath) || null
    } catch (error) {
      console.error('获取目录主博主关联失败:', error)
      return null
    }
  },

  save: (data: {
    filePath: string
    parentPath?: string
    creatorId?: number | null
  }) => {
    try {
      ensureInitialized()
      const existing = scanFileCreators.get(data.filePath) as any
      const parentPath = data.parentPath ?? getParentPath(data.filePath)

      if (existing) {
        const stmt = db.prepare(`
          UPDATE scan_file_creators
          SET parent_path = ?,
              creator_id = ?,
              updated_at = datetime('now', 'localtime')
          WHERE file_path = ?
        `)
        return stmt.run(
          parentPath,
          data.creatorId !== undefined ? data.creatorId : existing.creator_id,
          data.filePath
        )
      }

      const stmt = db.prepare(`
        INSERT INTO scan_file_creators (file_path, parent_path, creator_id)
        VALUES (?, ?, ?)
      `)
      return stmt.run(
        data.filePath,
        parentPath,
        data.creatorId !== undefined ? data.creatorId : null
      )
    } catch (error) {
      console.error('保存文件博主关联失败:', error)
      throw error
    }
  },

  batchEnsure: (files: Array<{ filePath: string; parentPath: string }>) => {
    try {
      ensureInitialized()
      if (files.length === 0) {
        return { inserted: 0 }
      }

      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO scan_file_creators (file_path, parent_path, creator_id)
        VALUES (?, ?, NULL)
      `)

      const updateParentPathStmt = db.prepare(`
        UPDATE scan_file_creators
        SET parent_path = ?,
            updated_at = datetime('now', 'localtime')
        WHERE file_path = ?
          AND parent_path != ?
      `)

      const insertMany = db.transaction((batch: Array<{ filePath: string; parentPath: string }>) => {
        let inserted = 0
        let parentPathUpdated = 0

        for (const file of batch) {
          const insertResult = insertStmt.run(file.filePath, file.parentPath)
          inserted += insertResult.changes

          // 只同步目录路径，绝不覆盖已存在的 creator_id 关联。
          const updateResult = updateParentPathStmt.run(file.parentPath, file.filePath, file.parentPath)
          parentPathUpdated += updateResult.changes
        }

        return { inserted, parentPathUpdated }
      })

      return insertMany(files)
    } catch (error) {
      console.error('批量补齐文件博主关联失败:', error)
      throw error
    }
  },

  setByParentPath: (parentPath: string, creatorId: number | null) => {
    try {
      ensureInitialized()
      const files = db.prepare(`
        SELECT filename, parent_path
        FROM scan_files
        WHERE parent_path = ?
      `).all(parentPath) as Array<{ filename: string; parent_path: string }>

      const saveMany = db.transaction((rows: Array<{ filename: string; parent_path: string }>) => {
        for (const row of rows) {
          scanFileCreators.save({
            filePath: row.filename,
            parentPath: row.parent_path,
            creatorId,
          })
        }
      })

      saveMany(files)
      return { updated: files.length }
    } catch (error) {
      console.error('按目录设置文件博主关联失败:', error)
      throw error
    }
  }
}

// 扫描文件表相关操作（支持亿级数据）
export const scanFiles = {
  // 批量插入文件（使用事务，每批1000条）
  batchInsert: (cacheId: number, files: Array<{
    filename: string
    basename: string
    size?: number
    type?: string
    lastmod?: string
  }>) => {
    try {
      ensureInitialized()
      
      const insert = db.prepare(`
        INSERT OR REPLACE INTO scan_files 
        (cache_id, filename, basename, parent_path, file_size, file_type, lastmod)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      
      const insertMany = db.transaction((batch: typeof files) => {
        for (const file of batch) {
          insert.run(
            cacheId,
            file.filename,
            file.basename,
            getParentPath(file.filename),
            file.size || 0,
            getFileType(file.basename),
            file.lastmod || null
          )
        }
      })
      
      // 分批处理，每批1000条
      const batchSize = 1000
      let inserted = 0
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        insertMany(batch)
        scanFileCreators.batchEnsure(batch.map((file) => ({
          filePath: file.filename,
          parentPath: getParentPath(file.filename)
        })))
        inserted += batch.length
      }
      
      return { inserted }
    } catch (error) {
      console.error('批量插入扫描文件失败:', error)
      throw error
    }
  },

  // 根据 cache_id 获取文件（分页，游标方式）
  getByCache: (cacheId: number, options?: {
    lastId?: number
    limit?: number
    fileType?: 'image' | 'video'
    isViewed?: boolean
  }) => {
    try {
      ensureInitialized()
      
      const { lastId = 0, limit = 100, fileType, isViewed } = options || {}
      
      let sql = `SELECT * FROM scan_files WHERE cache_id = ? AND id > ?`
      const params: any[] = [cacheId, lastId]
      
      if (fileType) {
        sql += ` AND file_type = ?`
        params.push(fileType)
      }
      if (isViewed !== undefined) {
        sql += ` AND is_viewed = ?`
        params.push(isViewed ? 1 : 0)
      }
      
      sql += ` ORDER BY id LIMIT ?`
      params.push(limit)
      
      return db.prepare(sql).all(...params)
    } catch (error) {
      console.error('获取扫描文件失败:', error)
      return []
    }
  },

  // 获取所有文件（用于兼容现有逻辑，但建议使用分页）
  getAllByCache: (cacheId: number, options?: {
    fileType?: 'image' | 'video'
    isViewed?: boolean
  }) => {
    try {
      ensureInitialized()
      
      const { fileType, isViewed } = options || {}
      
      let sql = `SELECT * FROM scan_files WHERE cache_id = ?`
      const params: any[] = [cacheId]
      
      if (fileType) {
        sql += ` AND file_type = ?`
        params.push(fileType)
      }
      if (isViewed !== undefined) {
        sql += ` AND is_viewed = ?`
        params.push(isViewed ? 1 : 0)
      }
      
      sql += ` ORDER BY id`
      
      return db.prepare(sql).all(...params)
    } catch (error) {
      console.error('获取所有扫描文件失败:', error)
      return []
    }
  },



  // 获取某目录下的所有文件（图组模式）
  getByParentPath: (cacheId: number, parentPath: string) => {
    try {
      ensureInitialized()
      
      const stmt = db.prepare(`
        SELECT * FROM scan_files 
        WHERE cache_id = ? AND parent_path = ?
        ORDER BY basename
      `)
      const files = stmt.all(cacheId, parentPath)
      
      // 使用自然排序对文件进行排序（解决 "1 (10).jpeg" 排在 "1 (2).jpeg" 前面的问题）
      const sortedFiles = files.sort((a: any, b: any) => {
        return a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'base' })
      })
      
      return sortedFiles
    } catch (error) {
      console.error('获取目录文件失败:', error)
      return []
    }
  },

  // 获取统计信息
  getStats: (cacheId: number) => {
    try {
      ensureInitialized()
      
      const stmt = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) as images,
          SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) as videos,
          SUM(CASE WHEN is_viewed = 1 THEN 1 ELSE 0 END) as viewed
        FROM scan_files 
        WHERE cache_id = ?
      `)
      return stmt.get(cacheId) as { total: number, images: number, videos: number, viewed: number }
    } catch (error) {
      console.error('获取扫描文件统计失败:', error)
      return { total: 0, images: 0, videos: 0, viewed: 0 }
    }
  },

  // 标记文件已看
  markViewed: (cacheId: number, filename: string) => {
    try {
      ensureInitialized()
      
      const stmt = db.prepare(`
        UPDATE scan_files SET is_viewed = TRUE 
        WHERE cache_id = ? AND filename = ?
      `)
      return stmt.run(cacheId, filename)
    } catch (error) {
      console.error('标记文件已看失败:', error)
      throw error
    }
  },

  // 批量标记已看
  batchMarkViewed: (cacheId: number, filenames: string[]) => {
    try {
      ensureInitialized()
      
      const update = db.prepare(`
        UPDATE scan_files SET is_viewed = TRUE 
        WHERE cache_id = ? AND filename = ?
      `)
      
      const updateMany = db.transaction((names: string[]) => {
        for (const filename of names) {
          update.run(cacheId, filename)
        }
      })
      
      updateMany(filenames)
      return { updated: filenames.length }
    } catch (error) {
      console.error('批量标记已看失败:', error)
      throw error
    }
  },

  // 删除某个缓存的所有文件
  deleteByCache: (cacheId: number) => {
    try {
      ensureInitialized()
      
      const stmt = db.prepare('DELETE FROM scan_files WHERE cache_id = ?')
      return stmt.run(cacheId)
    } catch (error) {
      console.error('删除扫描文件失败:', error)
      throw error
    }
  },

  // 检查是否存在数据
  hasData: (cacheId: number) => {
    try {
      ensureInitialized()
      
      const stmt = db.prepare('SELECT COUNT(*) as count FROM scan_files WHERE cache_id = ? LIMIT 1')
      const result = stmt.get(cacheId) as { count: number }
      return result.count > 0
    } catch (error) {
      console.error('检查扫描文件数据失败:', error)
      return false
    }
  },

  // 从 scan_cache 的 files_data 迁移数据
  migrateFromCache: (cacheId: number) => {
    try {
      ensureInitialized()
      
      // 获取 scan_cache 数据
      const cache = db.prepare('SELECT * FROM scan_cache WHERE id = ?').get(cacheId) as any
      if (!cache || !cache.files_data) {
        return { success: false, message: '缓存数据不存在或为空' }
      }
      
      // 解析 JSON
      const files = JSON.parse(cache.files_data)
      if (!Array.isArray(files) || files.length === 0) {
        return { success: false, message: '文件数据为空' }
      }
      
      // 记录迁移前的状态
      const beforeStats = scanFiles.getStats(cacheId)
      const beforeTotal = beforeStats.total
      const beforeViewed = beforeStats.viewed
      
      console.log(`📊 [迁移数据] 迁移前: 文件数量 ${beforeTotal}, 已看过 ${beforeViewed}`)
      
      // 先删除旧数据
      scanFiles.deleteByCache(cacheId)
      
      // 批量插入
      const result = scanFiles.batchInsert(cacheId, files)
      
      // 从 media_ratings 表同步 is_viewed 状态
      // media_ratings.file_path 和 scan_files.filename 都是唯一的全量路径
      const syncResult = scanFiles.syncViewedFromRatings(cacheId)
      
      // 记录迁移后的状态
      const afterStats = scanFiles.getStats(cacheId)
      const afterTotal = afterStats.total
      const afterViewed = afterStats.viewed
      
      const logMessage = `迁移前: 文件数量 ${beforeTotal}, 已看过 ${beforeViewed} | 迁移后: 文件数量 ${afterTotal}, 同步已看过 ${afterViewed}`
      console.log(`✅ [迁移数据] ${logMessage}`)
      
      // 写入扫描日志（和扫描日志写在同一个文件）
      try {
        const { writeScanLog } = require('./scanLogger')
        writeScanLog({
          webdavUrl: cache.webdav_url,
          webdavUsername: cache.webdav_username,
          path: cache.path,
          scanType: 'migration',
          status: 'completed',
          totalFiles: afterTotal,
          logDetails: `数据迁移完成\n迁移前: 文件数量 ${beforeTotal}, 已看过 ${beforeViewed}\n迁移后: 文件数量 ${afterTotal}, 同步已看过 ${afterViewed}\n从 media_ratings 同步了 ${syncResult.synced} 条已看记录`
        })
      } catch (logError) {
        console.error('写入迁移日志失败:', logError)
      }
      
      return { 
        success: true, 
        message: logMessage,
        count: result.inserted,
        syncedViewed: syncResult.synced,
        beforeStats: { total: beforeTotal, viewed: beforeViewed },
        afterStats: { total: afterTotal, viewed: afterViewed }
      }
    } catch (error: any) {
      console.error('迁移扫描文件失败:', error)
      
      // 写入失败日志
      try {
        const cache = db.prepare('SELECT * FROM scan_cache WHERE id = ?').get(cacheId) as any
        if (cache) {
          const { writeScanLog } = require('./scanLogger')
          writeScanLog({
            webdavUrl: cache.webdav_url,
            webdavUsername: cache.webdav_username,
            path: cache.path,
            scanType: 'migration',
            status: 'failed',
            errorMessage: error.message,
            logDetails: `数据迁移失败: ${error.message}`
          })
        }
      } catch (logError) {
        console.error('写入迁移失败日志失败:', logError)
      }
      
      return { success: false, message: error.message }
    }
  },

  // 从 media_ratings 表同步 is_viewed 状态到 scan_files
  // 利用 media_ratings.file_path 和 scan_files.filename 的唯一性进行匹配
  syncViewedFromRatings: (cacheId: number) => {
    try {
      ensureInitialized()
      
      // 使用 UPDATE ... WHERE EXISTS 批量更新，避免逐条查询
      const stmt = db.prepare(`
        UPDATE scan_files 
        SET is_viewed = 1 
        WHERE cache_id = ? 
          AND is_viewed = 0
          AND EXISTS (
            SELECT 1 FROM media_ratings 
            WHERE media_ratings.file_path = scan_files.filename 
              AND media_ratings.is_viewed = 1
          )
      `)
      
      const result = stmt.run(cacheId)
      console.log(`✅ [syncViewedFromRatings] 同步已看状态: cacheId=${cacheId}, 更新=${result.changes}条`)
      
      return { synced: result.changes }
    } catch (error) {
      console.error('同步已看状态失败:', error)
      return { synced: 0 }
    }
  },

  // 从所有 scan_cache 迁移数据
  migrateAllFromCache: () => {
    try {
      ensureInitialized()
      
      const caches = db.prepare('SELECT id, path FROM scan_cache').all() as any[]
      const results: Array<{ cacheId: number, path: string, success: boolean, message: string, count?: number }> = []
      
      for (const cache of caches) {
        const result = scanFiles.migrateFromCache(cache.id)
        results.push({
          cacheId: cache.id,
          path: cache.path,
          ...result
        })
      }
      
      const totalMigrated = results.filter(r => r.success).reduce((sum, r) => sum + (r.count || 0), 0)
      
      return {
        success: true,
        message: `迁移完成，共处理 ${caches.length} 个缓存，迁移 ${totalMigrated} 个文件`,
        details: results
      }
    } catch (error: any) {
      console.error('迁移所有扫描文件失败:', error)
      return { success: false, message: error.message, details: [] }
    }
  },

  // 跨多个 cacheId 获取统计信息
  getStatsMultiple: (cacheIds: number[]) => {
    try {
      ensureInitialized()
      
      if (cacheIds.length === 0) {
        return { total: 0, images: 0, videos: 0, viewed: 0 }
      }
      
      const placeholders = cacheIds.map(() => '?').join(',')
      const stmt = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) as images,
          SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) as videos,
          SUM(CASE WHEN is_viewed = 1 THEN 1 ELSE 0 END) as viewed
        FROM scan_files 
        WHERE cache_id IN (${placeholders})
      `)
      return stmt.get(...cacheIds) as { total: number, images: number, videos: number, viewed: number }
    } catch (error) {
      console.error('获取多缓存统计失败:', error)
      return { total: 0, images: 0, videos: 0, viewed: 0 }
    }
  },



  // 跨多个 cacheId 获取随机图组
  getRandomGroupMultiple: (cacheIds: number[], options?: {
    fileType?: 'image' | 'video'
    isViewed?: boolean
    excludeParentPath?: string
    maxFileSize?: number  // 最大文件大小（字节），用于过滤大视频
    ratings?: number[]
    evaluations?: string[]
    categories?: string[]
    reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
    reasonKeyword?: string
    ratingEmptyFilter?: boolean
    evaluationEmptyFilter?: boolean
    categoryEmptyFilter?: boolean
  }) => {
    try {
      ensureInitialized()
      
      if (cacheIds.length === 0) return { files: [], parentPath: null }
      
      const {
        fileType,
        isViewed,
        excludeParentPath,
        maxFileSize,
        ratings,
        evaluations,
        categories,
        reasonFilter,
        reasonKeyword,
        ratingEmptyFilter,
        evaluationEmptyFilter,
        categoryEmptyFilter,
      } = options || {}
      const placeholders = cacheIds.map(() => '?').join(',')
      const needsRatingJoin = ratings?.length || evaluations?.length || categories?.length ||
        (reasonFilter && reasonFilter !== 'all') ||
        ratingEmptyFilter !== undefined || evaluationEmptyFilter !== undefined || categoryEmptyFilter !== undefined
      
      const buildWhereClause = (includeParentPath?: string) => {
        let whereClause = needsRatingJoin ? `sf.cache_id IN (${placeholders})` : `cache_id IN (${placeholders})`
        const params: any[] = [...cacheIds]
        const prefix = 'sf.'

        if (includeParentPath) {
          whereClause += ` AND ${prefix}parent_path = ?`
          params.push(includeParentPath)
        }
        if (fileType) {
          whereClause += ` AND ${prefix}file_type = ?`
          params.push(fileType)
        }
        if (isViewed !== undefined) {
          whereClause += ` AND ${prefix}is_viewed = ?`
          params.push(isViewed ? 1 : 0)
        }
        if (excludeParentPath) {
          whereClause += ` AND ${prefix}parent_path != ?`
          params.push(excludeParentPath)
        }
        if (maxFileSize !== undefined && maxFileSize > 0) {
          whereClause += ` AND ${prefix}file_size <= ?`
          params.push(maxFileSize)
        }

        if (needsRatingJoin) {
          if (ratings && ratings.length > 0) {
            if (ratingEmptyFilter === true) {
              const ratingPlaceholders = ratings.map(() => '?').join(',')
              whereClause += ` AND (mr.rating IN (${ratingPlaceholders}) OR mr.rating IS NULL)`
              params.push(...ratings)
            } else if (ratingEmptyFilter === false) {
              const ratingPlaceholders = ratings.map(() => '?').join(',')
              whereClause += ` AND (mr.rating IN (${ratingPlaceholders}) OR (mr.rating IS NOT NULL AND mr.rating NOT IN (${ratingPlaceholders})))`
              params.push(...ratings, ...ratings)
            } else {
              const ratingPlaceholders = ratings.map(() => '?').join(',')
              whereClause += ` AND mr.rating IN (${ratingPlaceholders})`
              params.push(...ratings)
            }
          } else if (ratingEmptyFilter === true) {
            whereClause += ` AND mr.rating IS NULL`
          } else if (ratingEmptyFilter === false) {
            whereClause += ` AND mr.rating IS NOT NULL`
          }

          if (evaluations && evaluations.length > 0) {
            const evalConditions = evaluations.map(() => `(mr.custom_evaluation LIKE ? OR mr.custom_evaluation = ?)`).join(' OR ')
            if (evaluationEmptyFilter === true) {
              whereClause += ` AND ((${evalConditions}) OR mr.custom_evaluation IS NULL OR mr.custom_evaluation = '')`
            } else if (evaluationEmptyFilter === false) {
              whereClause += ` AND ((${evalConditions}) OR (mr.custom_evaluation IS NOT NULL AND mr.custom_evaluation != ''))`
            } else {
              whereClause += ` AND (${evalConditions})`
            }
            evaluations.forEach((evaluation) => {
              params.push(`%"${evaluation}"%`)
              params.push(evaluation)
            })
          } else if (evaluationEmptyFilter === true) {
            whereClause += ` AND (mr.custom_evaluation IS NULL OR mr.custom_evaluation = '')`
          } else if (evaluationEmptyFilter === false) {
            whereClause += ` AND (mr.custom_evaluation IS NOT NULL AND mr.custom_evaluation != '')`
          }

          if (categories && categories.length > 0) {
            const catConditions = categories.map(() => `(mr.category LIKE ? OR mr.category = ?)`).join(' OR ')
            if (categoryEmptyFilter === true) {
              whereClause += ` AND ((${catConditions}) OR mr.category IS NULL OR mr.category = '')`
            } else if (categoryEmptyFilter === false) {
              whereClause += ` AND ((${catConditions}) OR (mr.category IS NOT NULL AND mr.category != ''))`
            } else {
              whereClause += ` AND (${catConditions})`
            }
            categories.forEach((category) => {
              params.push(`%"${category}"%`)
              params.push(category)
            })
          } else if (categoryEmptyFilter === true) {
            whereClause += ` AND (mr.category IS NULL OR mr.category = '')`
          } else if (categoryEmptyFilter === false) {
            whereClause += ` AND (mr.category IS NOT NULL AND mr.category != '')`
          }

          if (reasonFilter === 'empty') {
            whereClause += ` AND (mr.recommendation_reason IS NULL OR mr.recommendation_reason = '')`
          } else if (reasonFilter === 'nonempty') {
            whereClause += ` AND mr.recommendation_reason IS NOT NULL AND mr.recommendation_reason != ''`
          } else if (reasonFilter === 'keyword' && reasonKeyword) {
            whereClause += ` AND mr.recommendation_reason LIKE ?`
            params.push(`%${reasonKeyword}%`)
          }
        }

        return { whereClause, params }
      }

      const { whereClause, params } = buildWhereClause()
      
      // 获取所有符合条件的目录
      const groupsSql = needsRatingJoin
        ? `
            SELECT sf.parent_path, COUNT(*) as file_count
            FROM scan_files sf
            INNER JOIN media_ratings mr ON sf.filename = mr.file_path
            WHERE ${whereClause}
            GROUP BY sf.parent_path
            HAVING file_count > 0
          `
        : `
            SELECT parent_path, COUNT(*) as file_count 
            FROM scan_files 
            WHERE ${whereClause}
            GROUP BY parent_path
            HAVING file_count > 0
          `
      const groups = db.prepare(groupsSql).all(...params) as Array<{ parent_path: string, file_count: number }>
      
      if (groups.length === 0) {
        return { files: [], parentPath: null, totalGroups: 0 }
      }
      
      // 随机选择一个目录
      const randomGroup = groups[Math.floor(Math.random() * groups.length)]
      const selectedParentPath = randomGroup.parent_path
      
      // 获取该目录下的所有文件
      const { whereClause: fileWhereClause, params: filesParams } = buildWhereClause(selectedParentPath)
      let filesSql = needsRatingJoin
        ? `
            SELECT
              sf.*,
              sfc.creator_id AS creator_id,
              c.id AS creator_linked_id,
              c.primary_name AS creator_primary_name,
              c.other_names AS creator_other_names,
              c.appearance_rating AS creator_appearance_rating,
              c.body_rating AS creator_body_rating,
              c.bio AS creator_bio,
              c.avatar_path AS creator_avatar_path
            FROM scan_files sf
            INNER JOIN media_ratings mr ON sf.filename = mr.file_path
            LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
            LEFT JOIN creators c ON c.id = sfc.creator_id
            WHERE ${fileWhereClause}
          `
        : `
            SELECT
              sf.*,
              sfc.creator_id AS creator_id,
              c.id AS creator_linked_id,
              c.primary_name AS creator_primary_name,
              c.other_names AS creator_other_names,
              c.appearance_rating AS creator_appearance_rating,
              c.body_rating AS creator_body_rating,
              c.bio AS creator_bio,
              c.avatar_path AS creator_avatar_path
            FROM scan_files sf
            LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
            LEFT JOIN creators c ON c.id = sfc.creator_id
            WHERE ${fileWhereClause}
          `

      filesSql += ` ORDER BY sf.basename`
       
      const files = db.prepare(filesSql).all(...filesParams)
      
      // 使用自然排序对文件进行排序（解决 "1 (10).jpeg" 排在 "1 (2).jpeg" 前面的问题）
      const sortedFiles = files.sort((a: any, b: any) => {
        return a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'base' })
      })
      
      return {
        files: sortedFiles.map((row: any) => attachCreatorInfoToScanFileRow(row)),
        parentPath: selectedParentPath,
        totalGroups: groups.length
      }
    } catch (error) {
      console.error('跨缓存随机获取图组失败:', error)
      return { files: [], parentPath: null, totalGroups: 0 }
    }
  },

  // 检查多个 cacheId 是否有数据
  hasDataMultiple: (cacheIds: number[]) => {
    try {
      ensureInitialized()
      
      if (cacheIds.length === 0) return false
      
      const placeholders = cacheIds.map(() => '?').join(',')
      const stmt = db.prepare(`SELECT COUNT(*) as count FROM scan_files WHERE cache_id IN (${placeholders}) LIMIT 1`)
      const result = stmt.get(...cacheIds) as { count: number }
      return result.count > 0
    } catch (error) {
      console.error('检查多缓存数据失败:', error)
      return false
    }
  },

  // 🚀 跨多个 cacheId 批量获取随机文件（动态分桶策略，支持亿级数据）
  getRandomBatchMultiple: (cacheIds: number[], count: number, options?: {
    fileType?: 'image' | 'video'
    isViewed?: boolean
    excludeFilenames?: string[]
    minFileSize?: number
    maxFileSize?: number        // 最大文件大小（字节），用于过滤大视频
    currentParentPath?: string  // 当前目录路径
    randomness?: number         // 随机性：0=优先当前目录，1=完全随机
    // 高级过滤条件（仅已看过模式）
    ratings?: number[]          // 评分星星：1-5星
    evaluations?: string[]      // 评价标签
    categories?: string[]       // 分类标签
    reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword' // 评价理由过滤
    reasonKeyword?: string      // 评价理由关键词
    ratingEmptyFilter?: boolean // 星级为空筛选：undefined=不筛选, true=为空, false=不为空
    evaluationEmptyFilter?: boolean // 评价为空筛选：undefined=不筛选, true=为空, false=不为空
    categoryEmptyFilter?: boolean // 分类为空筛选：undefined=不筛选, true=为空, false=不为空
  }) => {
    const totalStartTime = Date.now()
    try {
      ensureInitialized()
      
      // 🔧 查询前执行 checkpoint，确保读取最新数据
      performCheckpoint('RESTART')
      
      // 🔍 调试：检查数据库状态
      const dbStatus = getDatabaseStatus()
      if (dbStatus) {
        console.log('📊 [数据库状态]', dbStatus)
      }
      
      if (cacheIds.length === 0) return []
      
      const { 
        fileType, isViewed, excludeFilenames = [], minFileSize, maxFileSize, 
        currentParentPath, randomness = 1,
        ratings, evaluations, categories, reasonFilter, reasonKeyword,
        ratingEmptyFilter, evaluationEmptyFilter, categoryEmptyFilter
      } = options || {}
      const placeholders = cacheIds.map(() => '?').join(',')
      const excludeSet = new Set(excludeFilenames)
      
      // 判断是否需要JOIN media_ratings表（有高级过滤条件时）
      const needsRatingJoin = ratings?.length || evaluations?.length || categories?.length || 
                              (reasonFilter && reasonFilter !== 'all') ||
                              ratingEmptyFilter !== undefined || evaluationEmptyFilter !== undefined || categoryEmptyFilter !== undefined
      
      // 构建基础 WHERE 条件
      const buildWhereClause = (includeParentPath?: string, excludeParentPath?: string) => {
        let where = needsRatingJoin 
          ? `sf.cache_id IN (${placeholders})`
          : `cache_id IN (${placeholders})`
        const params: any[] = [...cacheIds]
        
        const prefix = needsRatingJoin ? 'sf.' : ''
        
        if (includeParentPath) {
          where += ` AND ${prefix}parent_path = ?`
          params.push(includeParentPath)
        }
        if (excludeParentPath) {
          where += ` AND ${prefix}parent_path != ?`
          params.push(excludeParentPath)
        }
        if (fileType) {
          where += ` AND ${prefix}file_type = ?`
          params.push(fileType)
        }
        if (isViewed !== undefined) {
          where += ` AND ${prefix}is_viewed = ?`
          params.push(isViewed ? 1 : 0)
        }
        if (minFileSize !== undefined && minFileSize > 0) {
          where += ` AND ${prefix}file_size >= ?`
          params.push(minFileSize)
        }
        if (maxFileSize !== undefined && maxFileSize > 0) {
          where += ` AND ${prefix}file_size <= ?`
          params.push(maxFileSize)
        }
        
        // 高级过滤条件（需要JOIN media_ratings表）
        if (needsRatingJoin) {
          // 评分星星过滤
          if (ratings && ratings.length > 0) {
            if (ratingEmptyFilter === true) {
              // 包含为空：rating IN (选中的值) OR rating IS NULL
              const ratingPlaceholders = ratings.map(() => '?').join(',')
              where += ` AND (mr.rating IN (${ratingPlaceholders}) OR mr.rating IS NULL)`
              params.push(...ratings)
            } else if (ratingEmptyFilter === false) {
              // 包含不为空：rating IN (选中的值) OR (rating IS NOT NULL AND rating NOT IN (选中的值))
              const ratingPlaceholders = ratings.map(() => '?').join(',')
              where += ` AND (mr.rating IN (${ratingPlaceholders}) OR (mr.rating IS NOT NULL AND mr.rating NOT IN (${ratingPlaceholders})))`
              params.push(...ratings, ...ratings)
            } else {
              // 不包含为空：rating IN (选中的值)
              const ratingPlaceholders = ratings.map(() => '?').join(',')
              where += ` AND mr.rating IN (${ratingPlaceholders})`
              params.push(...ratings)
            }
          } else if (ratingEmptyFilter === true) {
            // 只勾选了为空：rating IS NULL
            where += ` AND mr.rating IS NULL`
          } else if (ratingEmptyFilter === false) {
            // 只勾选了不为空：rating IS NOT NULL
            where += ` AND mr.rating IS NOT NULL`
          }
          
          // 评价标签过滤（JSON数组包含）
          if (evaluations && evaluations.length > 0) {
            const evalConditions = evaluations.map(() => 
              `(mr.custom_evaluation LIKE ? OR mr.custom_evaluation = ?)`
            ).join(' OR ')
            if (evaluationEmptyFilter === true) {
              // 包含为空：(条件) OR custom_evaluation IS NULL OR custom_evaluation = ''
              where += ` AND ((${evalConditions}) OR mr.custom_evaluation IS NULL OR mr.custom_evaluation = '')`
            } else if (evaluationEmptyFilter === false) {
              // 包含不为空：(条件) OR (custom_evaluation IS NOT NULL AND custom_evaluation != '')
              where += ` AND ((${evalConditions}) OR (mr.custom_evaluation IS NOT NULL AND mr.custom_evaluation != ''))`
            } else {
              // 不包含为空：(条件)
              where += ` AND (${evalConditions})`
            }
            evaluations.forEach(evaluation => {
              params.push(`%"${evaluation}"%`) // JSON数组包含
              params.push(evaluation) // 或者是单个字符串
            })
          } else if (evaluationEmptyFilter === true) {
            // 只勾选了为空：custom_evaluation IS NULL OR custom_evaluation = ''
            where += ` AND (mr.custom_evaluation IS NULL OR mr.custom_evaluation = '')`
          } else if (evaluationEmptyFilter === false) {
            // 只勾选了不为空：custom_evaluation IS NOT NULL AND custom_evaluation != ''
            where += ` AND (mr.custom_evaluation IS NOT NULL AND mr.custom_evaluation != '')`
          }
          
          // 分类标签过滤（JSON数组包含）
          if (categories && categories.length > 0) {
            const catConditions = categories.map(() => 
              `(mr.category LIKE ? OR mr.category = ?)`
            ).join(' OR ')
            if (categoryEmptyFilter === true) {
              // 包含为空：(条件) OR category IS NULL OR category = ''
              where += ` AND ((${catConditions}) OR mr.category IS NULL OR mr.category = '')`
            } else if (categoryEmptyFilter === false) {
              // 包含不为空：(条件) OR (category IS NOT NULL AND category != '')
              where += ` AND ((${catConditions}) OR (mr.category IS NOT NULL AND mr.category != ''))`
            } else {
              // 不包含为空：(条件)
              where += ` AND (${catConditions})`
            }
            categories.forEach(category => {
              params.push(`%"${category}"%`) // JSON数组包含
              params.push(category) // 或者是单个字符串
            })
          } else if (categoryEmptyFilter === true) {
            // 只勾选了为空：category IS NULL OR category = ''
            where += ` AND (mr.category IS NULL OR mr.category = '')`
          } else if (categoryEmptyFilter === false) {
            // 只勾选了不为空：category IS NOT NULL AND category != ''
            where += ` AND (mr.category IS NOT NULL AND mr.category != '')`
          }
          
          // 评价理由过滤
          if (reasonFilter === 'empty') {
            where += ` AND (mr.recommendation_reason IS NULL OR mr.recommendation_reason = '')`
          } else if (reasonFilter === 'nonempty') {
            where += ` AND mr.recommendation_reason IS NOT NULL AND mr.recommendation_reason != ''`
          } else if (reasonFilter === 'keyword' && reasonKeyword) {
            where += ` AND mr.recommendation_reason LIKE ?`
            params.push(`%${reasonKeyword}%`)
          }
        }
        
        return { where, params }
      }
      
      // 构建SELECT语句（根据是否需要JOIN决定）
      const buildSelectSql = (whereClause: string, orderBy: string = 'RANDOM()', limit?: number) => {
        if (needsRatingJoin) {
          let sql = `
            SELECT
              sf.*,
              sfc.creator_id AS creator_id,
              c.id AS creator_linked_id,
              c.primary_name AS creator_primary_name,
              c.other_names AS creator_other_names,
              c.appearance_rating AS creator_appearance_rating,
              c.body_rating AS creator_body_rating,
              c.bio AS creator_bio,
              c.avatar_path AS creator_avatar_path
            FROM scan_files sf
            INNER JOIN media_ratings mr ON sf.filename = mr.file_path
            LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
            LEFT JOIN creators c ON c.id = sfc.creator_id
            WHERE ${whereClause}
            ORDER BY ${orderBy}
          `
          if (limit) sql += ` LIMIT ${limit}`
          return sql
        } else {
          let sql = `
            SELECT
              sf.*,
              sfc.creator_id AS creator_id,
              c.id AS creator_linked_id,
              c.primary_name AS creator_primary_name,
              c.other_names AS creator_other_names,
              c.appearance_rating AS creator_appearance_rating,
              c.body_rating AS creator_body_rating,
              c.bio AS creator_bio,
              c.avatar_path AS creator_avatar_path
            FROM scan_files sf
            LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
            LEFT JOIN creators c ON c.id = sfc.creator_id
            WHERE ${whereClause}
            ORDER BY ${orderBy}
          `
          if (limit) sql += ` LIMIT ${limit}`
          return sql
        }
      }
      
      // 构建COUNT语句
      const buildCountSql = (whereClause: string) => {
        if (needsRatingJoin) {
          return `
            SELECT COUNT(*) as count 
            FROM scan_files sf
            INNER JOIN media_ratings mr ON sf.filename = mr.file_path
            WHERE ${whereClause}
          `
        } else {
          return `SELECT COUNT(*) as count FROM scan_files sf WHERE ${whereClause}`
        }
      }
      
      // 统一的随机文件获取接口（使用动态分桶）
      const getRandomFile = (whereClause: string, params: any[], totalCount: number, bucketCount: number): any => {
        // 小数据集：直接随机
        if (totalCount < 100000) {
          const sql = buildSelectSql(whereClause, 'RANDOM()', 1)
          const file = db.prepare(sql).get(...params) as any
          
          if (file && !excludeSet.has(file.filename)) {
            return attachCreatorInfoToScanFileRow(file)
          }
          return null
        }
        
        // 大数据集：使用动态分桶
        // 快速尝试（5次随机桶，增加多样性）
        for (let i = 0; i < 5; i++) {
          const randomBucket = Math.floor(Math.random() * bucketCount)
          
          // 从桶中随机选择一个文件（使用 ORDER BY RANDOM() 增加多样性）
          const bucketWhere = needsRatingJoin 
            ? `(sf.id % ${bucketCount}) = ? AND ${whereClause}`
            : `(sf.id % ${bucketCount}) = ? AND ${whereClause}`
          const sql = buildSelectSql(bucketWhere, 'RANDOM()', 1)
          const file = db.prepare(sql).get(randomBucket, ...params) as any
          
          if (file && !excludeSet.has(file.filename)) {
            return attachCreatorInfoToScanFileRow(file)
          }
        }
        
        // 保底方案：获取非空桶列表，并从多个桶中尝试
        const bucketSql = needsRatingJoin
          ? `SELECT DISTINCT (sf.id % ${bucketCount}) as bucket 
             FROM scan_files sf
             INNER JOIN media_ratings mr ON sf.filename = mr.file_path
             WHERE ${whereClause}`
          : `SELECT DISTINCT (sf.id % ${bucketCount}) as bucket 
             FROM scan_files sf
             WHERE ${whereClause}`
        const buckets = db.prepare(bucketSql).all(...params) as Array<{ bucket: number }>
        
        if (buckets.length === 0) return null
        
        // 打乱桶列表，从多个桶中尝试（最多尝试10个桶）
        const shuffledBuckets = [...buckets].sort(() => Math.random() - 0.5)
        const tryCount = Math.min(10, shuffledBuckets.length)
        
        for (let i = 0; i < tryCount; i++) {
          const randomBucket = shuffledBuckets[i].bucket
          
          const bucketWhere = needsRatingJoin 
            ? `(sf.id % ${bucketCount}) = ? AND ${whereClause}`
            : `(sf.id % ${bucketCount}) = ? AND ${whereClause}`
          const sql = buildSelectSql(bucketWhere, 'RANDOM()', 1)
          const file = db.prepare(sql).get(randomBucket, ...params) as any
          
          if (file && !excludeSet.has(file.filename)) {
            return attachCreatorInfoToScanFileRow(file)
          }
        }
        
        return null
      }
      
      const results: any[] = []
      
      // 如果有当前目录且随机性 < 1，使用混合策略
      if (currentParentPath && randomness < 1) {
        const samePathCount = Math.round(count * (1 - randomness))
        
        // 1. 从当前目录获取文件
        if (samePathCount > 0) {
          const { where, params } = buildWhereClause(currentParentPath)
          console.log(`🔍 [混合策略] 步骤1: 从当前目录获取 ${samePathCount} 个文件`)
          console.log(`   WHERE条件:`, where)
          console.log(`   参数:`, JSON.stringify(params))
          
          // 统计当前目录文件数
          const countSql = buildCountSql(where)
          const { count: totalCount } = db.prepare(countSql).get(...params) as { count: number }
          console.log(`   当前目录文件总数: ${totalCount}`)
          
          if (totalCount > 0) {
            // 选择桶数
            let bucketCount = 1024
            if (totalCount >= 1000000) bucketCount = 4096
            if (totalCount >= 10000000) bucketCount = 16384
            
            for (let i = 0; i < samePathCount && results.length < count; i++) {
              const file = getRandomFile(where, params, totalCount, bucketCount)
              if (file) {
                results.push(file)
                excludeSet.add(file.filename)
              }
            }
            console.log(`   从当前目录获取了 ${results.length} 个文件`)
          }
        }
        
        // 2. 从其他目录获取文件
        const remainingCount = count - results.length
        if (remainingCount > 0) {
          const { where, params } = buildWhereClause(undefined, currentParentPath)
          console.log(`🔍 [混合策略] 步骤2: 从其他目录获取 ${remainingCount} 个文件`)
          console.log(`   WHERE条件:`, where)
          console.log(`   参数:`, JSON.stringify(params))
          
          const countSql = buildCountSql(where)
          const { count: totalCount } = db.prepare(countSql).get(...params) as { count: number }
          console.log(`   其他目录文件总数: ${totalCount}`)
          
          if (totalCount > 0) {
            let bucketCount = 1024
            if (totalCount >= 1000000) bucketCount = 4096
            if (totalCount >= 10000000) bucketCount = 16384
            
            for (let i = 0; i < remainingCount; i++) {
              const file = getRandomFile(where, params, totalCount, bucketCount)
              if (file) {
                results.push(file)
                excludeSet.add(file.filename)
              }
            }
          }
        }
        
        console.log(`⏱️ [批量随机-混合] 耗时: ${Date.now() - totalStartTime}ms, 获取: ${results.length}/${count}`)
        return results
      }
      
      // 完全随机模式
      const { where, params } = buildWhereClause()
      
      // 统计总数
      const countStartTime = Date.now()
      const countSql = buildCountSql(where)
      console.log(`🔍 [SQL执行] COUNT查询`)
      console.log(`   SQL:`, countSql.trim().replace(/\s+/g, ' '))
      console.log(`   参数:`, JSON.stringify(params))
      const { count: totalCount } = db.prepare(countSql).get(...params) as { count: number }
      console.log(`⏱️ [统计] ${Date.now() - countStartTime}ms, 总数: ${totalCount}, 请求数量: ${count}`)
      
      if (totalCount === 0) return []
      
      // 选择最优桶数
      let bucketCount = 1024
      if (totalCount >= 1000000) bucketCount = 4096
      if (totalCount >= 10000000) bucketCount = 16384
      
      console.log(`📊 [批量随机] 总数: ${totalCount}, 桶数: ${bucketCount}, 需要: ${count}个`)
      
      const fetchStartTime = Date.now()
      
      // ✅ 优化：当总数接近请求数量时，一次性获取所有文件再随机选择
      if (totalCount <= count * 2) {
        console.log(`📊 [批量随机] 小数据集优化：一次性获取所有文件`)
        
        // ✅ 修复：只获取需要的数量，而不是全部
        // 考虑到排除列表，多获取一些以确保有足够的文件
        const fetchCount = Math.min(totalCount, count + excludeSet.size)
        const sql = buildSelectSql(where, 'RANDOM()', fetchCount)
        console.log(`🔍 [SQL执行] 小数据集一次性查询`)
        console.log(`   SQL:`, sql.trim().replace(/\s+/g, ' '))
        console.log(`   参数:`, JSON.stringify(params))
        console.log(`📊 [批量随机] 获取数量: ${fetchCount}（总数: ${totalCount}, 需要: ${count}, 排除: ${excludeSet.size}）`)
        
        const allFiles = (db.prepare(sql).all(...params) as any[]).map((row) => attachCreatorInfoToScanFileRow(row))
        console.log(`📊 [批量随机] SQL返回: ${allFiles.length} 条记录`)
        
        // 过滤掉排除列表中的文件
        const availableFiles = allFiles.filter(f => !excludeSet.has(f.filename))
        
        // 随机选择需要的数量
        const selectedCount = Math.min(count, availableFiles.length)
        for (let i = 0; i < selectedCount; i++) {
          results.push(availableFiles[i])
        }
        
        console.log(`⏱️ [批量随机] 获取耗时: ${Date.now() - fetchStartTime}ms, 获取: ${results.length}/${count}, 可用: ${availableFiles.length}`)
        console.log(`⏱️ [批量随机] 总耗时: ${Date.now() - totalStartTime}ms`)
        
        return results
      }
      
      // 批量获取（大数据集）
      const maxAttempts = count * 3  // 最多尝试3倍次数
      let attempts = 0
      
      while (results.length < count && attempts < maxAttempts) {
        attempts++
        const file = getRandomFile(where, params, totalCount, bucketCount)
        if (file) {
          results.push(file)
          excludeSet.add(file.filename)
        }
      }
      
      console.log(`⏱️ [批量随机] 获取耗时: ${Date.now() - fetchStartTime}ms, 获取: ${results.length}/${count}, 尝试: ${attempts}次`)
      console.log(`⏱️ [批量随机] 总耗时: ${Date.now() - totalStartTime}ms`)
      
      return results
    } catch (error) {
      console.error('批量随机获取文件失败:', error)
      return []
    }
  }
}

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

  // 初始化默认数据（已禁用，改为通过管理界面维护）
  function initDefaultData() {
    // 不再自动初始化默认数据
    // 用户可以通过管理界面自行添加评价和分类
    console.log('跳过默认数据初始化，请通过管理界面维护评价和分类')
  }

  // 延迟初始化数据库
  function ensureInitialized() {
    // 使用 globalThis 缓存初始化状态，避免开发模式下重复初始化
    if (!globalThis.__dbInitialized) {
      try {
        initDatabase()
        initDefaultData()
        globalThis.__dbInitialized = true
        console.log('数据库初始化成功')
      } catch (error) {
        console.error('数据库初始化失败:', error)
        // 如果初始化失败，尝试修复数据库
        try {
          console.log('尝试修复数据库...')
          repairDatabase()
          initDatabase()
          initDefaultData()
          globalThis.__dbInitialized = true
          console.log('数据库修复并初始化成功')
        } catch (repairError) {
          console.error('数据库修复失败:', repairError)
          throw repairError
        }
      }
    }
  }

  // 在模块加载时尝试初始化
  try {
    ensureInitialized()
  } catch (error) {
    console.warn('模块加载时数据库初始化失败，将在首次使用时重试')
  }

  export default db
  export { ensureInitialized }
