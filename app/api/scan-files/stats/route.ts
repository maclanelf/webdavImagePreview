import { NextRequest, NextResponse } from 'next/server'
import { scanCache } from '@/lib/scanCacheRepository'
import { scanFiles } from '@/lib/scanFilesRepository'

// GET: 获取文件统计信息
export async function GET(request: NextRequest) {
  const startTime = Date.now()
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

    // 优化：使用批量查询获取所有 cacheIds（一次查询代替 N 次循环查询）
    const caches = await scanCache.getMultiple(webdavUrl, webdavUsername, pathList) as any[]
    const cacheIds = caches.map(c => c.id)
    
    console.log(`⏱️ [stats] 批量获取 cacheIds: ${Date.now() - startTime}ms, 找到 ${cacheIds.length} 个`)

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

    // 优化：直接获取统计信息，跳过 hasDataMultiple 检查
    // getStatsMultiple 返回 total=0 即表示无数据
    const statsStartTime = Date.now()
    const stats = await scanFiles.getStatsMultiple(cacheIds)
    console.log(`⏱️ [stats] getStatsMultiple: ${Date.now() - statsStartTime}ms`)

    const hasData = stats.total > 0
    
    console.log(`⏱️ [stats] 总耗时: ${Date.now() - startTime}ms`)

    return NextResponse.json({ 
      ...stats,
      hasData
    })

  } catch (error: any) {
    console.error('获取文件统计失败:', error)
    return NextResponse.json(
      { error: `获取失败: ${error.message}` },
      { status: 500 }
    )
  }
}
