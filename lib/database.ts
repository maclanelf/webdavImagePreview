import Database from 'better-sqlite3'
import path from 'path'
import { getCurrentLocalISOString } from './timeUtils'
import { repairDatabase } from './repairDatabase'

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
}

// 创建数据库连接（使用缓存）
let db: Database.Database
if (globalThis.__db) {
  db = globalThis.__db
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
      
      // 设置同步模式为NORMAL以提高性能
      db.pragma('synchronous = NORMAL')
      
      // 设置缓存大小
      db.pragma('cache_size = -64000') // 64MB
      
      console.log('数据库配置完成')
    } catch (pragmaError) {
      console.warn('设置数据库pragma失败，使用默认配置:', pragmaError)
      // 即使 pragma 失败，也继续使用数据库
    }
    
    console.log('数据库连接成功:', dbPath)
    
    // 缓存到 globalThis
    globalThis.__db = db
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
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(url, username)
      )
    `)

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
    // 优化随机查询的复合索引（cache_id + is_viewed + id 覆盖 ROWID 范围查询）
    // 3列索引让 WHERE cache_id IN (...) AND is_viewed = ? AND id >= ? ORDER BY id 
    // 可以直接在索引中完成定位和排序，无需回表后再排序
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_random ON scan_files(cache_id, is_viewed, id)`)

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
            category = ?, is_viewed = ?, updated_at = datetime(\'now\', \'localtime\')
        WHERE file_path = ?
      `)
      result = stmt.run(
        data.rating || null,
        data.recommendationReason || null,
        customEvaluationStr,
        categoryStr,
        data.isViewed ? 1 : 0,
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
    
    if (existing) {
      // 更新
      const stmt = db.prepare(`
        UPDATE group_ratings 
        SET rating = ?, recommendation_reason = ?, custom_evaluation = ?, 
            category = ?, is_viewed = ?, updated_at = datetime(\'now\', \'localtime\')
        WHERE group_path = ?
      `)
      return stmt.run(
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
      return stmt.run(
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
      // 解析 JSON 字段
      return rows.map((row: any) => ({
        ...row,
        mediaPaths: JSON.parse(row.media_paths || '[]'),
        scanSettings: JSON.parse(row.scan_settings || '{}'),
        isDefault: row.is_default === 1
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
        isDefault: true
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
        isDefault: row.is_default === 1
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
      
      if (existing) {
        // 更新
        const stmt = db.prepare(`
          UPDATE webdav_configs 
          SET password = ?, media_paths = ?, scan_settings = ?, 
              is_default = ?, updated_at = datetime('now', 'localtime')
          WHERE url = ? AND username = ?
        `)
        return stmt.run(
          data.password,
          mediaPathsStr,
          scanSettingsStr,
          data.isDefault ? 1 : 0,
          data.url,
          data.username
        )
      } else {
        // 插入
        // 如果没有其他配置，第一个配置自动设为默认
        const allConfigs = webdavConfigs.getAll()
        const shouldBeDefault = data.isDefault !== false && allConfigs.length === 0
        
        const stmt = db.prepare(`
          INSERT INTO webdav_configs 
          (url, username, password, media_paths, scan_settings, is_default)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        return stmt.run(
          data.url,
          data.username,
          data.password,
          mediaPathsStr,
          scanSettingsStr,
          shouldBeDefault ? 1 : (data.isDefault ? 1 : 0)
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

  // 随机获取一个文件（亿级数据高效随机 - 使用 ROWID 范围）
  getRandom: (cacheId: number, options?: {
    fileType?: 'image' | 'video'
    isViewed?: boolean
  }) => {
    try {
      ensureInitialized()
      
      const { fileType, isViewed } = options || {}
      
      // 构建 WHERE 条件
      let whereClause = `cache_id = ?`
      const params: any[] = [cacheId]
      
      if (fileType) {
        whereClause += ` AND file_type = ?`
        params.push(fileType)
      }
      if (isViewed !== undefined) {
        whereClause += ` AND is_viewed = ?`
        params.push(isViewed ? 1 : 0)
      }
      
      // 获取 ID 范围和数量
      const stats = db.prepare(`SELECT COUNT(*) as count, MIN(id) as minId, MAX(id) as maxId FROM scan_files WHERE ${whereClause}`).get(...params) as any
      if (!stats || stats.count === 0) return null
      
      // 在 ID 范围内随机，最多尝试 5 次
      for (let attempt = 0; attempt < 5; attempt++) {
        const randomId = stats.minId + Math.floor(Math.random() * (stats.maxId - stats.minId + 1))
        
        // 获取 >= randomId 的第一条符合条件的记录
        let file = db.prepare(`SELECT * FROM scan_files WHERE ${whereClause} AND id >= ? ORDER BY id LIMIT 1`).get(...params, randomId) as any
        if (file) return file
        
        // 如果没找到，尝试 < randomId 的记录
        file = db.prepare(`SELECT * FROM scan_files WHERE ${whereClause} AND id < ? ORDER BY id DESC LIMIT 1`).get(...params, randomId) as any
        if (file) return file
      }
      
      return null
    } catch (error) {
      console.error('随机获取扫描文件失败:', error)
      return null
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
      return stmt.all(cacheId, parentPath)
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

  // 跨多个 cacheId 随机获取文件（使用 ROWID 范围）
  getRandomMultiple: (cacheIds: number[], options?: {
    fileType?: 'image' | 'video'
    isViewed?: boolean
    excludeFilenames?: string[]
  }) => {
    try {
      ensureInitialized()
      
      if (cacheIds.length === 0) return null
      
      const { fileType, isViewed, excludeFilenames = [] } = options || {}
      const placeholders = cacheIds.map(() => '?').join(',')
      const excludeSet = new Set(excludeFilenames)
      
      // 构建 WHERE 条件（不包含 excludeFilenames，在内存中过滤）
      let whereClause = `cache_id IN (${placeholders})`
      const params: any[] = [...cacheIds]
      
      if (fileType) {
        whereClause += ` AND file_type = ?`
        params.push(fileType)
      }
      if (isViewed !== undefined) {
        whereClause += ` AND is_viewed = ?`
        params.push(isViewed ? 1 : 0)
      }
      
      // 获取 ID 范围和数量
      const stats = db.prepare(`SELECT COUNT(*) as count, MIN(id) as minId, MAX(id) as maxId FROM scan_files WHERE ${whereClause}`).get(...params) as any
      if (!stats || stats.count === 0) return null
      
      // 在 ID 范围内随机，最多尝试 5 次
      for (let attempt = 0; attempt < 5; attempt++) {
        const randomId = stats.minId + Math.floor(Math.random() * (stats.maxId - stats.minId + 1))
        
        // 获取 >= randomId 的第一条符合条件的记录
        let file = db.prepare(`SELECT * FROM scan_files WHERE ${whereClause} AND id >= ? ORDER BY id LIMIT 1`).get(...params, randomId) as any
        if (file && !excludeSet.has(file.filename)) return file
        
        // 如果没找到或被排除，尝试 < randomId 的记录
        file = db.prepare(`SELECT * FROM scan_files WHERE ${whereClause} AND id < ? ORDER BY id DESC LIMIT 1`).get(...params, randomId) as any
        if (file && !excludeSet.has(file.filename)) return file
      }
      
      return null
    } catch (error) {
      console.error('跨缓存随机获取文件失败:', error)
      return null
    }
  },

  // 跨多个 cacheId 获取随机图组
  getRandomGroupMultiple: (cacheIds: number[], options?: {
    fileType?: 'image' | 'video'
    isViewed?: boolean
    excludeParentPath?: string
    maxFileSize?: number  // 最大文件大小（字节），用于过滤大视频
  }) => {
    try {
      ensureInitialized()
      
      if (cacheIds.length === 0) return { files: [], parentPath: null }
      
      const { fileType, isViewed, excludeParentPath, maxFileSize } = options || {}
      const placeholders = cacheIds.map(() => '?').join(',')
      
      // 构建查询条件
      let whereClause = `cache_id IN (${placeholders})`
      const params: any[] = [...cacheIds]
      
      if (fileType) {
        whereClause += ` AND file_type = ?`
        params.push(fileType)
      }
      if (isViewed !== undefined) {
        whereClause += ` AND is_viewed = ?`
        params.push(isViewed ? 1 : 0)
      }
      if (excludeParentPath) {
        whereClause += ` AND parent_path != ?`
        params.push(excludeParentPath)
      }
      if (maxFileSize !== undefined && maxFileSize > 0) {
        whereClause += ` AND file_size <= ?`
        params.push(maxFileSize)
      }
      
      // 获取所有符合条件的目录
      const groupsSql = `
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
      let filesSql = `SELECT * FROM scan_files WHERE cache_id IN (${placeholders}) AND parent_path = ?`
      const filesParams: any[] = [...cacheIds, selectedParentPath]
      
      if (fileType) {
        filesSql += ` AND file_type = ?`
        filesParams.push(fileType)
      }
      if (isViewed !== undefined) {
        filesSql += ` AND is_viewed = ?`
        filesParams.push(isViewed ? 1 : 0)
      }
      if (maxFileSize !== undefined && maxFileSize > 0) {
        filesSql += ` AND file_size <= ?`
        filesParams.push(maxFileSize)
      }
      
      filesSql += ` ORDER BY basename`
      
      const files = db.prepare(filesSql).all(...filesParams)
      
      return {
        files,
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

  // 跨多个 cacheId 批量获取随机文件（支持随机性控制）
  // 优化：ROWID 范围随机获取而非OFFSET ORDER BY RANDOM()，大幅提升大数据量下的性能
  getRandomBatchMultiple: (cacheIds: number[], count: number, options?: {
    fileType?: 'image' | 'video'
    isViewed?: boolean
    excludeFilenames?: string[]
    minFileSize?: number
    maxFileSize?: number        // 最大文件大小（字节），用于过滤大视频
    currentParentPath?: string  // 当前目录路径
    randomness?: number         // 随机性：0=优先当前目录，1=完全随机
  }) => {
    const totalStartTime = Date.now()
    try {
      ensureInitialized()
      
      if (cacheIds.length === 0) return []
      
      const { fileType, isViewed, excludeFilenames = [], minFileSize, maxFileSize, currentParentPath, randomness = 1 } = options || {}
      const placeholders = cacheIds.map(() => '?').join(',')
      
      // 构建基础 WHERE 条件（不包含 excludeFilenames，因为会在内存中过滤）
      const buildWhereClause = (includeParentPath?: string, excludeParentPath?: string) => {
        let where = `cache_id IN (${placeholders})`
        const params: any[] = [...cacheIds]
        
        if (includeParentPath) {
          where += ` AND parent_path = ?`
          params.push(includeParentPath)
        }
        if (excludeParentPath) {
          where += ` AND parent_path != ?`
          params.push(excludeParentPath)
        }
        if (fileType) {
          where += ` AND file_type = ?`
          params.push(fileType)
        }
        if (isViewed !== undefined) {
          where += ` AND is_viewed = ?`
          params.push(isViewed ? 1 : 0)
        }
        if (minFileSize !== undefined && minFileSize > 0) {
          where += ` AND file_size >= ?`
          params.push(minFileSize)
        }
        if (maxFileSize !== undefined && maxFileSize > 0) {
          where += ` AND file_size <= ?`
          params.push(maxFileSize)
        }
        return { where, params }
      }
      
      // 缓存 COUNT 和 ROWID 范围结果，避免重复查询
      const statsCache = new Map<string, { count: number, minId: number, maxId: number }>()
      
      // 使用 ROWID 范围随机获取单个文件（比 OFFSET 快得多）
      const getRandomFile = (whereClause: string, params: any[], excludeSet: Set<string>): any => {
        const cacheKey = whereClause + JSON.stringify(params)
        let stats = statsCache.get(cacheKey)
        
        if (!stats) {
          // 获取符合条件的记录的 ID 范围和数量
          const result = db.prepare(`SELECT COUNT(*) as count, MIN(id) as minId, MAX(id) as maxId FROM scan_files WHERE ${whereClause}`).get(...params) as any
          stats = { count: result.count || 0, minId: result.minId || 0, maxId: result.maxId || 0 }
          statsCache.set(cacheKey, stats)
        }
        
        if (stats.count === 0) return null
        
        // 根据排除列表大小动态调整尝试次数
        // 如果排除的文件很多，需要更多尝试次数
        const maxAttempts = Math.min(100, stats.count)
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          // 在 ID 范围内随机选择一个 ID
          const randomId = stats.minId + Math.floor(Math.random() * (stats.maxId - stats.minId + 1))
          
          // 获取 >= randomId 的第一条符合条件的记录
          const file = db.prepare(`SELECT * FROM scan_files WHERE ${whereClause} AND id >= ? ORDER BY id LIMIT 1`).get(...params, randomId) as any
          
          if (file && !excludeSet.has(file.filename)) {
            return file
          }
          
          // 如果没找到，尝试 < randomId 的记录
          if (!file) {
            const fallbackFile = db.prepare(`SELECT * FROM scan_files WHERE ${whereClause} AND id < ? ORDER BY id DESC LIMIT 1`).get(...params, randomId) as any
            if (fallbackFile && !excludeSet.has(fallbackFile.filename)) {
              return fallbackFile
            }
          }
        }
        
        console.log(`[getRandomFile] 尝试了 ${maxAttempts} 次仍未找到可用文件，排除数量: ${excludeSet.size}`)
        return null
      }
      
      // 将 excludeFilenames 转为 Set 以提高查找效率
      const excludeSet = new Set(excludeFilenames)
      const results: any[] = []
      
      // 如果有当前目录且随机性 < 1，使用混合策略
      if (currentParentPath && randomness < 1) {
        const samePathCount = Math.round(count * (1 - randomness))
        
        // 1. 从当前目录获取文件
        if (samePathCount > 0) {
          const { where, params } = buildWhereClause(currentParentPath)
          for (let i = 0; i < samePathCount && results.length < count; i++) {
            const file = getRandomFile(where, params, excludeSet)
            if (file) {
              results.push(file)
              excludeSet.add(file.filename)
            }
          }
        }
        
        // 2. 从其他目录获取文件
        const remainingCount = count - results.length
        if (remainingCount > 0) {
          const { where, params } = buildWhereClause(undefined, currentParentPath)
          for (let i = 0; i < remainingCount; i++) {
            const file = getRandomFile(where, params, excludeSet)
            if (file) {
              results.push(file)
              excludeSet.add(file.filename)
            }
          }
        }
        
        console.log(`⏱️ [getRandomBatchMultiple] 混合模式完成: ${Date.now() - totalStartTime}ms`)
        return results
      }
      
      // 完全随机模式
      const { where, params } = buildWhereClause()
      const countStartTime = Date.now()
      
      // 先获取一次统计信息（COUNT + ID范围）
      const statsResult = db.prepare(`SELECT COUNT(*) as count, MIN(id) as minId, MAX(id) as maxId FROM scan_files WHERE ${where}`).get(...params) as any
      console.log(`⏱️ [getRandomBatchMultiple] 统计查询: ${Date.now() - countStartTime}ms, 总数=${statsResult.count}, ID范围=${statsResult.minId}-${statsResult.maxId}`)
      
      if (statsResult.count === 0) return []
      statsCache.set(where + JSON.stringify(params), { count: statsResult.count, minId: statsResult.minId, maxId: statsResult.maxId })
      
      const fetchStartTime = Date.now()
      for (let i = 0; i < count; i++) {
        const file = getRandomFile(where, params, excludeSet)
        if (file) {
          results.push(file)
          excludeSet.add(file.filename)
        }
      }
      console.log(`⏱️ [getRandomBatchMultiple] 获取${count}个文件: ${Date.now() - fetchStartTime}ms`)
      console.log(`⏱️ [getRandomBatchMultiple] 总耗时: ${Date.now() - totalStartTime}ms`)
      
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
