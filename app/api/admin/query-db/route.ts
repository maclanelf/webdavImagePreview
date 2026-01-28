import { NextRequest, NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import path from 'path'

// 数据库路径
const dbPath = path.join(process.cwd(), 'data', 'media_ratings.db')

// POST: 执行 SQL 查询（管理员功能）
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sql, params = [] } = body
    
    if (!sql) {
      return NextResponse.json(
        { error: '请提供 SQL 语句' },
        { status: 400 }
      )
    }
    
    // 连接数据库
    const db = new Database(dbPath)
    
    try {
      // 🔧 执行 checkpoint，确保读取最新数据
      const checkpointResult = db.pragma('wal_checkpoint(FULL)')
      console.log('Checkpoint 结果:', checkpointResult)
      
      // 执行查询
      const startTime = Date.now()
      let result
      let resultType = 'unknown'
      
      const sqlUpper = sql.trim().toUpperCase()
      
      if (sqlUpper.startsWith('SELECT')) {
        // SELECT 查询
        result = db.prepare(sql).all(...params)
        resultType = 'select'
      } else if (sqlUpper.startsWith('INSERT') || sqlUpper.startsWith('UPDATE') || sqlUpper.startsWith('DELETE')) {
        // 写操作
        result = db.prepare(sql).run(...params)
        resultType = 'write'
      } else if (sqlUpper.startsWith('PRAGMA')) {
        // PRAGMA 命令
        result = db.pragma(sql.replace(/^PRAGMA\s+/i, ''))
        resultType = 'pragma'
      } else {
        return NextResponse.json(
          { error: '不支持的 SQL 类型' },
          { status: 400 }
        )
      }
      
      const duration = Date.now() - startTime
      
      return NextResponse.json({
        success: true,
        resultType,
        duration,
        rowCount: Array.isArray(result) ? result.length : (result as any).changes || 0,
        data: result,
        checkpoint: checkpointResult
      })
      
    } finally {
      db.close()
    }
    
  } catch (error: any) {
    console.error('查询失败:', error)
    return NextResponse.json(
      { 
        success: false,
        error: error.message,
        stack: error.stack
      },
      { status: 500 }
    )
  }
}

// GET: 获取数据库状态信息
export async function GET(request: NextRequest) {
  try {
    const db = new Database(dbPath)
    
    try {
      // 获取数据库信息
      const journalMode = db.pragma('journal_mode', { simple: true })
      const walCheckpoint = db.pragma('wal_checkpoint')
      const pageCount = db.pragma('page_count', { simple: true })
      const pageSize = db.pragma('page_size', { simple: true })
      const dbSize = (pageCount as number) * (pageSize as number)
      
      // 获取表信息
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      
      // 获取各表的记录数
      const tableCounts: Record<string, number> = {}
      for (const table of tables as any[]) {
        const result = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number }
        tableCounts[table.name] = result.count
      }
      
      return NextResponse.json({
        success: true,
        dbPath,
        journalMode,
        walCheckpoint,
        dbSize: `${(dbSize / 1024 / 1024).toFixed(2)} MB`,
        tables: tableCounts
      })
      
    } finally {
      db.close()
    }
    
  } catch (error: any) {
    console.error('获取数据库信息失败:', error)
    return NextResponse.json(
      { 
        success: false,
        error: error.message
      },
      { status: 500 }
    )
  }
}
