import { NextRequest, NextResponse } from 'next/server'
import { scanCache } from '@/lib/scanCacheRepository'
import { scanFiles } from '@/lib/scanFilesRepository'

const MAX_EXCLUDE_FILENAMES = 200

// POST: 随机获取文件（支持批量）- 使用 POST 避免 URL 过长导致 431 错误
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  try {
    const body = await request.json()
    const webdavUrl = body.webdavUrl
    const webdavUsername = body.webdavUsername
    const paths = body.paths // 逗号分隔的路径列表或数组
    const count = parseInt(body.count || '1')
    const fileType = body.fileType as 'image' | 'video' | null
    const isViewed = body.isViewed
    const excludeFilenames = body.excludeFilenames // 逗号分隔的排除文件名或数组
    const minFileSize = body.minFileSize // 最小文件大小（字节）
    const maxFileSize = body.maxFileSize // 最大文件大小（字节）
    const currentParentPath = body.currentParentPath // 当前目录路径（用于随机性控制）
    const randomness = parseFloat(body.randomness || '1') // 随机性：0=优先当前目录，1=完全随机
    
    // 高级过滤条件（仅已看过模式）
    const ratings = body.ratings // 评分星星数组：[1,2,3,4,5]
    const evaluations = body.evaluations // 评价标签数组
    const categories = body.categories // 分类标签数组
    const reasonFilter = body.reasonFilter // 评价理由过滤：'all' | 'empty' | 'nonempty' | 'keyword'
    const reasonKeyword = body.reasonKeyword // 评价理由关键词
    const ratingEmptyFilter = body.ratingEmptyFilter // 星级为空筛选：undefined=不筛选, true=为空, false=不为空
    const evaluationEmptyFilter = body.evaluationEmptyFilter // 评价为空筛选：undefined=不筛选, true=为空, false=不为空
    const categoryEmptyFilter = body.categoryEmptyFilter // 分类为空筛选：undefined=不筛选, true=为空, false=不为空

    console.log(`⏱️ [random] 开始处理请求`)

    if (!webdavUrl || !webdavUsername || !paths) {
      return NextResponse.json(
        { error: '请提供 webdavUrl, webdavUsername 和 paths' },
        { status: 400 }
      )
    }

    // 支持数组或逗号分隔的字符串
    const pathList = Array.isArray(paths) ? paths : paths.split(',').filter((p: string) => p.trim())
    const rawExcludeList: string[] = excludeFilenames
      ? (Array.isArray(excludeFilenames)
          ? excludeFilenames.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          : excludeFilenames.split(',').filter((f: string) => f.trim()))
      : []
    const excludeList = Array.from(new Set<string>(rawExcludeList)).slice(-MAX_EXCLUDE_FILENAMES)
    console.log(`⏱️ [random] 解析参数完成: ${Date.now() - startTime}ms, paths=${pathList.length}, excludeList=${excludeList.length}`)

    // 批量获取所有相关 cache 的 ID（一次查询代替循环）
    const cacheStartTime = Date.now()

    const caches = await scanCache.getMultiple(webdavUrl, webdavUsername, pathList) as any[]
    const cacheIds = caches.map(c => c.id)
    console.log(`⏱️ [random] 批量获取cacheIds完成: ${Date.now() - cacheStartTime}ms, cacheIds=${cacheIds.length}`)

    if (cacheIds.length === 0) {
      return NextResponse.json({ files: [], message: '未找到缓存数据' })
    }

    // 检查是否有迁移数据，避免把“未迁移”误判成“无匹配文件”
    const hasDataStartTime = Date.now()
    if (!await scanFiles.hasDataMultiple(cacheIds)) {
      return NextResponse.json({
        files: [],
        hasData: false,
        message: '数据尚未迁移，请先执行迁移'
      })
    }
    console.log(`⏱️ [random] hasDataMultiple完成: ${Date.now() - hasDataStartTime}ms`)

    // 使用批量随机获取方法（支持随机性控制和高级过滤）
    const randomStartTime = Date.now()
    const files = await scanFiles.getRandomBatchMultiple(cacheIds, count, {
      fileType: fileType || undefined,
      isViewed: isViewed !== null && isViewed !== undefined ? isViewed === true || isViewed === 'true' : undefined,
      excludeFilenames: excludeList,
      minFileSize: minFileSize ? parseInt(String(minFileSize)) : undefined,
      maxFileSize: maxFileSize ? parseInt(String(maxFileSize)) : undefined,
      currentParentPath: currentParentPath || undefined,
      randomness: randomness,
      // 高级过滤条件
      ratings: ratings && Array.isArray(ratings) ? ratings : undefined,
      evaluations: evaluations && Array.isArray(evaluations) ? evaluations : undefined,
      categories: categories && Array.isArray(categories) ? categories : undefined,
      reasonFilter: reasonFilter || undefined,
      reasonKeyword: reasonKeyword || undefined,
      ratingEmptyFilter: ratingEmptyFilter,
      evaluationEmptyFilter: evaluationEmptyFilter,
      categoryEmptyFilter: categoryEmptyFilter
    })
    console.log(`⏱️ [random] getRandomBatchMultiple完成: ${Date.now() - randomStartTime}ms`)
    console.log(`⏱️ [random] 总耗时: ${Date.now() - startTime}ms`)

    // 检查是否满足预加载数量要求
    const isInsufficient = files.length < count
    const message = isInsufficient 
      ? `仅找到 ${files.length} 个符合条件的文件，未达到预加载目标 ${count} 个`
      : undefined

    return NextResponse.json({ 
      files,
      count: files.length,
      requestedCount: count,
      isInsufficient,
      message,
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
