import Database from 'better-sqlite3'
import path from 'path'

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

// 创建数据库连接
let db: Database.Database
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
} catch (error) {
  console.error('数据库连接失败:', error)
  console.error('数据库路径:', dbPath)
  console.error('数据目录:', dataDir)
  console.error('数据目录权限:', fs.existsSync(dataDir) ? '存在' : '不存在')
  throw error
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 创建自定义评价标签表
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL UNIQUE,
        usage_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 创建分类表
    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        usage_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        last_scan DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

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
    const stmt = db.prepare('SELECT * FROM media_ratings WHERE file_path = ?')
    return stmt.get(filePath)
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
    const existing = mediaRatings.get(data.filePath)
    
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
        UPDATE media_ratings 
        SET rating = ?, recommendation_reason = ?, custom_evaluation = ?, 
            category = ?, is_viewed = ?, updated_at = CURRENT_TIMESTAMP
        WHERE file_path = ?
      `)
      return stmt.run(
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
      return stmt.run(
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
    const stmt = db.prepare('SELECT * FROM group_ratings WHERE group_path = ?')
    return stmt.get(groupPath)
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
            category = ?, is_viewed = ?, updated_at = CURRENT_TIMESTAMP
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
    const updates = []
    const values = []
    
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
    
    updates.push('updated_at = CURRENT_TIMESTAMP')
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
      SET last_run = CURRENT_TIMESTAMP, next_run = ?
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
  let isInitialized = false
  
  function ensureInitialized() {
    if (!isInitialized) {
      try {
        initDatabase()
        initDefaultData()
        isInitialized = true
        console.log('数据库初始化成功')
      } catch (error) {
        console.error('数据库初始化失败:', error)
        throw error
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
