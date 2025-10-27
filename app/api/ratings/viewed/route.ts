import { NextRequest, NextResponse } from 'next/server'
import { mediaRatings, ensureInitialized } from '@/lib/database'
import db from '@/lib/database'

export async function GET(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const { searchParams } = new URL(request.url)
    const viewed = searchParams.get('viewed') // 'true' | 'false' | null (全部)

    console.log(`🔍 [API GET] 获取已看过文件列表: viewed=${viewed}`)

    let query = 'SELECT file_path FROM media_ratings'
    let params: any[] = []

    if (viewed === 'true') {
      query += ' WHERE is_viewed = 1'
    } else if (viewed === 'false') {
      query += ' WHERE is_viewed = 0 OR is_viewed IS NULL'
    }

    const stmt = db.prepare(query)
    const results = stmt.all(...params)
    
    const filePaths = results.map((row: any) => row.file_path)
    
    console.log(`✅ [API GET] 获取已看过文件列表完成，共 ${filePaths.length} 个文件`)
    
    return NextResponse.json({ 
      filePaths,
      count: filePaths.length 
    })
  } catch (error: any) {
    console.error('获取已看过文件列表失败:', error)
    return NextResponse.json(
      { error: `获取已看过文件列表失败: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const body = await request.json()
    const { filePath, isViewed } = body

    console.log(`💾 [API POST] 更新文件已看过状态: ${filePath} -> ${isViewed}`)

    if (!filePath || typeof isViewed !== 'boolean') {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      )
    }

    // 检查文件是否已有评分记录
    const existing = mediaRatings.get(filePath)
    
    if (existing) {
      // 更新现有记录
      const stmt = db.prepare(`
        UPDATE media_ratings 
        SET is_viewed = ?, updated_at = datetime('now', 'localtime')
        WHERE file_path = ?
      `)
      const result = stmt.run(isViewed ? 1 : 0, filePath)
      
      console.log(`✅ [API POST] 更新已看过状态成功: ${filePath}`)
      
      return NextResponse.json({ 
        success: true, 
        changes: result.changes 
      })
    } else {
      // 创建新记录（只记录已看过状态，不包含评分）
      const fileName = filePath.split('/').pop() || filePath
      const fileType = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(fileName) ? 'image' : 'video'
      
      const stmt = db.prepare(`
        INSERT INTO media_ratings 
        (file_path, file_name, file_type, is_viewed)
        VALUES (?, ?, ?, ?)
      `)
      const result = stmt.run(filePath, fileName, fileType, isViewed ? 1 : 0)
      
      console.log(`✅ [API POST] 创建已看过状态记录成功: ${filePath}`)
      
      return NextResponse.json({ 
        success: true, 
        id: result.lastInsertRowid,
        changes: result.changes 
      })
    }
  } catch (error: any) {
    console.error('更新已看过状态失败:', error)
    return NextResponse.json(
      { error: `更新已看过状态失败: ${error.message}` },
      { status: 500 }
    )
  }
}
