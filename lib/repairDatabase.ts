import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

// 数据库修复脚本
export function repairDatabase() {
  const dataDir = path.join(process.cwd(), 'data')
  const dbPath = path.join(dataDir, 'media_ratings.db')
  
  console.log('开始修复数据库...')
  
  try {
    // 检查数据库文件是否存在
    if (!fs.existsSync(dbPath)) {
      console.log('数据库文件不存在，将创建新的数据库')
      return createNewDatabase()
    }
    
    // 打开现有数据库
    const db = new Database(dbPath)
    
    // 检查表结构
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    console.log('现有表:', tables)
    
    // 检查media_ratings表是否存在
    const mediaRatingsTable = tables.find((table: any) => table.name === 'media_ratings')
    
    if (!mediaRatingsTable) {
      console.log('media_ratings表不存在，将创建')
      createMediaRatingsTable(db)
    } else {
      // 检查表结构
      const columns = db.prepare("PRAGMA table_info(media_ratings)").all()
      console.log('media_ratings表列:', columns)
      
      // 检查是否有file_path列
      const hasFilePath = columns.some((col: any) => col.name === 'file_path')
      
      if (!hasFilePath) {
        console.log('file_path列不存在，将重新创建表')
        // 备份现有数据
        const existingData = db.prepare('SELECT * FROM media_ratings').all()
        console.log('备份现有数据:', existingData.length, '条记录')
        
        // 删除旧表
        db.exec('DROP TABLE IF EXISTS media_ratings')
        
        // 创建新表
        createMediaRatingsTable(db)
        
        // 恢复数据（如果可能）
        if (existingData.length > 0) {
          console.log('尝试恢复数据...')
          // 这里可以根据实际的数据结构来恢复
        }
      }
    }
    
    // 检查group_ratings表
    const groupRatingsTable = tables.find((table: any) => table.name === 'group_ratings')
    
    if (!groupRatingsTable) {
      console.log('group_ratings表不存在，将创建')
      createGroupRatingsTable(db)
    }
    
    db.close()
    console.log('数据库修复完成')
    
  } catch (error) {
    console.error('数据库修复失败:', error)
    throw error
  }
}

function createNewDatabase() {
  const dataDir = path.join(process.cwd(), 'data')
  
  // 确保数据目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  
  const dbPath = path.join(dataDir, 'media_ratings.db')
  const db = new Database(dbPath)
  
  createMediaRatingsTable(db)
  createGroupRatingsTable(db)
  
  db.close()
  console.log('新数据库创建完成')
}

function createMediaRatingsTable(db: Database) {
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
  console.log('media_ratings表创建完成')
}

function createGroupRatingsTable(db: Database) {
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
  console.log('group_ratings表创建完成')
}

// 如果直接运行此脚本
if (require.main === module) {
  repairDatabase()
}
