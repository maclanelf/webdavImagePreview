import { NextRequest, NextResponse } from 'next/server'
import { scanFiles, scanCache } from '@/lib/database'

// GET: 随机获取一个图组（目录）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const webdavUrl = searchParams.get('webdavUrl')
    const webdavUsername = searchParams.get('webdavUsername')
    const paths = searchParams.get('paths') // 逗号分隔的路径列表
    const fileType = searchParams.get('fileType') as 'image' | 'video' | null
    const isViewed = searchParams.get('isViewed')
    const excludeParentPath = searchParams.get('excludeParentPath') // 排除的目录路径

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
      return NextResponse.json({ files: [], message: '未找到缓存数据' })
    }

    // 检查是否有迁移数据
    if (!scanFiles.hasDataMultiple(cacheIds)) {
      return NextResponse.json({ 
        files: [], 
        parentPath: null,
        hasData: false,
        message: '数据尚未迁移，请先执行迁移' 
      })
    }

    // 使用新的跨缓存随机图组方法
    const result = scanFiles.getRandomGroupMultiple(cacheIds, {
      fileType: fileType || undefined,
      isViewed: isViewed !== null ? isViewed === 'true' : undefined,
      excludeParentPath: excludeParentPath || undefined
    })

    return NextResponse.json({
      files: result.files,
      parentPath: result.parentPath,
      totalGroups: result.totalGroups,
      fileCount: result.files.length,
      hasData: true
    })

  } catch (error: any) {
    console.error('随机获取图组失败:', error)
    return NextResponse.json(
      { error: `获取失败: ${error.message}` },
      { status: 500 }
    )
  }
}
