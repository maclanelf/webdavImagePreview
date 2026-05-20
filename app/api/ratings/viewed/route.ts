import { NextRequest, NextResponse } from 'next/server'
import { mediaRatings } from '@/lib/mediaRatingRepository'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const viewed = searchParams.get('viewed') // 'true' | 'false' | null (全部)
    const countOnly = searchParams.get('countOnly') // 'true' 时只返回数量

    console.log(`🔍 [API GET] 获取已看过文件列表: viewed=${viewed}, countOnly=${countOnly}`)

    // 优化：支持只返回数量，避免传输大量路径数据
    if (countOnly === 'true') {
      const result = await mediaRatings.getViewedCount(
        viewed === 'true' ? true : viewed === 'false' ? false : undefined,
      )
      
      console.log(`✅ [API GET] 获取已看过文件数量: ${result.count}`)
      
      return NextResponse.json({ 
        count: result.count 
      })
    }

    // 原有逻辑：返回完整路径列表
    const filePaths = await mediaRatings.getViewedFilePaths(
      viewed === 'true' ? true : viewed === 'false' ? false : undefined,
    )
    
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
    const result = await mediaRatings.saveViewedState(filePath, isViewed)

    if (result.scanChanges > 0) {
      console.log(`✅ [API POST] 同步更新 scan_files 已看过状态成功: ${filePath}, 影响 ${result.scanChanges} 行`)
    } else {
      console.log(`⚠️ [API POST] scan_files 中未找到文件: ${filePath}`)
    }
    
    return NextResponse.json({ 
      success: true
    })
  } catch (error: any) {
    console.error('更新已看过状态失败:', error)
    return NextResponse.json(
      { error: `更新已看过状态失败: ${error.message}` },
      { status: 500 }
    )
  }
}
