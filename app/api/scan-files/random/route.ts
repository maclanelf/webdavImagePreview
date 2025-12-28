import { NextRequest, NextResponse } from 'next/server'
import { scanFiles, scanCache } from '@/lib/database'

// GET: 随机获取文件（支持批量）
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const webdavUrl = searchParams.get('webdavUrl')
    const webdavUsername = searchParams.get('webdavUsername')
    const paths = searchParams.get('paths') // 逗号分隔的路径列表
    const count = parseInt(searchParams.get('count') || '1')
    const fileType = searchParams.get('fileType') as 'image' | 'video' | null
    const isViewed = searchParams.get('isViewed')
    const excludeFilenames = searchParams.get('excludeFilenames') // 逗号分隔的排除文件名
    const minFileSize = searchParams.get('minFileSize') // 最小文件大小（字节）
    const currentParentPath = searchParams.get('currentParentPath') // 当前目录路径（用于随机性控制）
    const randomness = parseFloat(searchParams.get('randomness') || '1') // 随机性：0=优先当前目录，1=完全随机

    if (!webdavUrl || !webdavUsername || !paths) {
      return NextResponse.json(
        { error: '请提供 webdavUrl, webdavUsername 和 paths' },
        { status: 400 }
      )
    }

    const pathList = paths.split(',').filter(p => p.trim())
    const excludeList = excludeFilenames?.split(',').filter(f => f.trim()) || []

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
        hasData: false,
        message: '数据尚未迁移，请先执行迁移' 
      })
    }

    // 使用批量随机获取方法（支持随机性控制）
    const files = scanFiles.getRandomBatchMultiple(cacheIds, count, {
      fileType: fileType || undefined,
      isViewed: isViewed !== null ? isViewed === 'true' : undefined,
      excludeFilenames: excludeList,
      minFileSize: minFileSize ? parseInt(minFileSize) : undefined,
      currentParentPath: currentParentPath || undefined,
      randomness: randomness
    })

    return NextResponse.json({ 
      files,
      count: files.length,
      hasData: true
    })

  } catch (error: any) {
    console.error('随机获取文件失败:', error)
    return NextResponse.json(
      { error: `获取失败: ${error.message}` },
      { status: 500 }
    )
  }
}
