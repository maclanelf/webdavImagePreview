import { NextRequest, NextResponse } from 'next/server'
import { scanFiles, scanCache } from '@/lib/database'

// GET: 随机获取文件（支持批量）
export async function GET(request: NextRequest) {
  const startTime = Date.now()
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

    console.log(`⏱️ [random] 开始处理请求`)

    if (!webdavUrl || !webdavUsername || !paths) {
      return NextResponse.json(
        { error: '请提供 webdavUrl, webdavUsername 和 paths' },
        { status: 400 }
      )
    }

    const pathList = paths.split(',').filter(p => p.trim())
    const excludeList = excludeFilenames?.split(',').filter(f => f.trim()) || []
    console.log(`⏱️ [random] 解析参数完成: ${Date.now() - startTime}ms, paths=${pathList.length}, excludeList=${excludeList.length}`)

    // 批量获取所有相关 cache 的 ID（一次查询代替循环）
    const cacheStartTime = Date.now()
    
    // 先检查 scan_cache 表的数据量
    const cacheCount = (scanCache as any).count?.() || 'unknown'
    console.log(`⏱️ [random] scan_cache 表数据量: ${cacheCount}`)
    
    const caches = scanCache.getMultiple(webdavUrl, webdavUsername, pathList) as any[]
    const cacheIds = caches.map(c => c.id)
    console.log(`⏱️ [random] 批量获取cacheIds完成: ${Date.now() - cacheStartTime}ms, cacheIds=${cacheIds.length}`)

    if (cacheIds.length === 0) {
      return NextResponse.json({ files: [], message: '未找到缓存数据' })
    }

    // 检查是否有迁移数据
    const hasDataStartTime = Date.now()
    if (!scanFiles.hasDataMultiple(cacheIds)) {
      return NextResponse.json({ 
        files: [], 
        hasData: false,
        message: '数据尚未迁移，请先执行迁移' 
      })
    }
    console.log(`⏱️ [random] hasDataMultiple完成: ${Date.now() - hasDataStartTime}ms`)

    // 使用批量随机获取方法（支持随机性控制）
    const randomStartTime = Date.now()
    const files = scanFiles.getRandomBatchMultiple(cacheIds, count, {
      fileType: fileType || undefined,
      isViewed: isViewed !== null ? isViewed === 'true' : undefined,
      excludeFilenames: excludeList,
      minFileSize: minFileSize ? parseInt(minFileSize) : undefined,
      currentParentPath: currentParentPath || undefined,
      randomness: randomness
    })
    console.log(`⏱️ [random] getRandomBatchMultiple完成: ${Date.now() - randomStartTime}ms`)
    console.log(`⏱️ [random] 总耗时: ${Date.now() - startTime}ms`)

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
