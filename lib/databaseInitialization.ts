import { UNKNOWN_CREATOR_ID } from './constants'
import db from './databaseCore'
import { repairDatabase } from './repairDatabase'

declare global {
  var __dbInitialized: boolean | undefined
}

export function initDatabase() {
  try {
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
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `)

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
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
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

    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL UNIQUE,
        usage_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        usage_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `)

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
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `)

    db.exec(`CREATE INDEX IF NOT EXISTS idx_creators_primary_name ON creators(primary_name)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_creators_usage ON creators(usage_count DESC)`)

    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_video_highlights_file_path ON video_highlights(file_path)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_video_highlights_file_range ON video_highlights(file_path, start_seconds, end_seconds)`)
      console.log('✅ 创建通用索引成功')
    } catch (error: any) {
      console.warn('⚠️ 创建通用索引失败:', error.message)
    }

    try {
      const existingUnknown = db.prepare('SELECT id FROM creators WHERE id = ?').get(UNKNOWN_CREATOR_ID)
      if (!existingUnknown) {
        db.prepare(`
          INSERT INTO creators (id, primary_name, bio, usage_count)
          VALUES (?, ?, ?, ?)
        `).run(UNKNOWN_CREATOR_ID, '不认识', '用于标记无法识别的博主', 0)
        console.log(`✅ 创建特殊"不认识"博主记录成功 (ID: ${UNKNOWN_CREATOR_ID})`)
      }
    } catch (error: any) {
      console.warn('⚠️ 创建"不认识"博主记录失败:', error.message)
    }

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
        last_scan DATETIME DEFAULT (datetime('now', 'localtime')),
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(webdav_url, webdav_username, path)
      )
    `)

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
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `)

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
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
        started_at DATETIME,
        completed_at DATETIME
      )
    `)

    try { db.exec(`ALTER TABLE recursive_scan_tasks ADD COLUMN retry_count INTEGER DEFAULT 0`) } catch {}
    try { db.exec(`ALTER TABLE recursive_scan_tasks ADD COLUMN next_retry_at DATETIME`) } catch {}
    try { db.exec(`ALTER TABLE recursive_scan_tasks ADD COLUMN rate_limited_until DATETIME`) } catch {}
    try { db.exec(`ALTER TABLE recursive_scan_tasks ADD COLUMN delay_until DATETIME`) } catch {}

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

    try {
      db.exec(`ALTER TABLE webdav_configs ADD COLUMN source_type TEXT DEFAULT 'clouddrive2'`)
      console.log('✅ 添加 source_type 字段成功')
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('⚠️ 添加 source_type 字段失败:', error.message)
      }
    }

    try {
      db.exec(`ALTER TABLE webdav_configs ADD COLUMN direct_link_url TEXT`)
      console.log('✅ 添加 direct_link_url 字段成功')
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('⚠️ 添加 direct_link_url 字段失败:', error.message)
      }
    }

    try {
      db.exec(`ALTER TABLE webdav_configs ADD COLUMN enable_direct_link BOOLEAN DEFAULT FALSE`)
      console.log('✅ 添加 enable_direct_link 字段成功')
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn('⚠️ 添加 enable_direct_link 字段失败:', error.message)
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS rating_task_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL UNIQUE,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        recommendation_reason TEXT,
        custom_evaluation TEXT,
        category TEXT,
        is_viewed BOOLEAN,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        error_message TEXT,
        last_attempt_at DATETIME,
        failed_at DATETIME,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `)

    db.exec(`CREATE INDEX IF NOT EXISTS idx_rating_task_queue_status_created ON rating_task_queue(status, created_at)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_rating_task_queue_file_status ON rating_task_queue(file_path, status)`)

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

    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_cache ON scan_files(cache_id)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_type ON scan_files(file_type)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_viewed ON scan_files(is_viewed)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_parent ON scan_files(parent_path)`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_files_unique ON scan_files(cache_id, filename)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_query ON scan_files(cache_id, file_type, is_viewed)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_files_filename ON scan_files(filename)`)

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

    console.log('创建 media_ratings 索引（支持高级过滤）...')
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_media_ratings_rating ON media_ratings(rating)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_media_ratings_file_rating ON media_ratings(file_path, rating)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_media_ratings_reason ON media_ratings(recommendation_reason)`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_media_ratings_viewed ON media_ratings(is_viewed)`)
      console.log('✅ media_ratings 索引创建成功')
    } catch (error: any) {
      console.warn('⚠️ media_ratings 索引创建失败:', error.message)
    }

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

    db.exec(`CREATE INDEX IF NOT EXISTS idx_scan_cache_config ON scan_cache(webdav_url, webdav_username)`)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_cache_unique ON scan_cache(webdav_url, webdav_username, path)`)

    console.log('数据库表创建完成')
  } catch (error) {
    console.error('数据库表创建失败:', error)
    throw error
  }
}

function initDefaultData() {
  console.log('跳过默认数据初始化，请通过管理界面维护评价和分类')
}

export function ensureInitialized() {
  if (!globalThis.__dbInitialized) {
    try {
      initDatabase()
      initDefaultData()
      globalThis.__dbInitialized = true
      console.log('数据库初始化成功')
    } catch (error) {
      console.error('数据库初始化失败:', error)
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
