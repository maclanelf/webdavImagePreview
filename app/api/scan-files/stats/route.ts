import { NextRequest, NextResponse } from 'next/server'
import { scanFiles, scanCache } from '@/lib/database'

// GET: 获取文件统计信息
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const webdavUrl = searchParams.get('webdavUrl')
    const webdavUsername = searchParams.get('webdavUsername')
    const paths = searchParams.get('paths') // 逗号分隔的路径列表

    if (!webdavUrl || !webdavUsername || !paths) {
      return NextResponse.json(
        { error: '请提供 webdavUrl, webdavUsername 和 paths' },
        { status: 400 }
      )
    }

    const pathList = paths.split(',').filter(p => p.trim())

    // 获取所有相关 cache 的 ID
    const cacheIds: number[] = []
    for (const path of pathList) {
      const cache = scanCache.get(webdavUrl, webdavUsername, path) as any
      if (cache) {
        cacheIds.push(cache.id)
      }
    }

    if (cacheIds.length === 0) {
      return NextResponse.json({ 
        total: 0, 
        images: 0, 
        videos: 0, 
        viewed: 0,
        hasData: false,
        message: '未找到缓存数据' 
      })
    }

    // 检查是否有迁移数据
    if (!scanFiles.hasDataMultiple(cacheIds)) {
      return NextResponse.json({ 
        total: 0, 
        images: 0, 
        videos: 0, 
        viewed: 0,
        hasData: false,
        message: '数据尚未迁移，请先执行迁移' 
      })
    }

    // 获取统计信息
    const stats = scanFiles.getStatsMultiple(cacheIds)

    return NextResponse.json({ 
      ...stats,
      hasData: true
    })

  } catch (error: any) {
    console.error('获取文件统计失败:', error)
    return NextResponse.json(
      { error: `获取失败: ${error.message}` },
      { status: 500 }
    )
  }
}
