import { NextRequest, NextResponse } from 'next/server'

import { serverRandomPoolManager } from '@/lib/serverRandomPoolManager'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body.action || 'init'
    const randomPoolSessionId = typeof body.randomPoolSessionId === 'string' ? body.randomPoolSessionId.trim() : ''

    if (action === 'clear') {
      if (!randomPoolSessionId) {
        return NextResponse.json(
          { error: '请提供 randomPoolSessionId' },
          { status: 400 },
        )
      }

      serverRandomPoolManager.clearSession(randomPoolSessionId, 'api-clear')
      return NextResponse.json({
        success: true,
        message: '服务端随机缓存池已清空',
        poolStatus: serverRandomPoolManager.getStatus(randomPoolSessionId),
      })
    }

    const webdavUrl = body.webdavUrl
    const webdavUsername = body.webdavUsername
    const paths = body.paths

    if (!webdavUrl || !webdavUsername || !paths || !randomPoolSessionId) {
      return NextResponse.json(
        { error: '请提供 webdavUrl, webdavUsername, paths 和 randomPoolSessionId' },
        { status: 400 },
      )
    }

    const pathList = Array.isArray(paths) ? paths : paths.split(',').filter((item: string) => item.trim())
    const preloadCount = parseInt(body.preloadCount || '10')
    const randomness = parseFloat(body.randomness || '1')
    const isViewed = body.isViewed
    const fileType = body.fileType as 'image' | 'video' | null
    const rawExcludeIdList: number[] = body.excludeFileIds
      ? (Array.isArray(body.excludeFileIds)
          ? body.excludeFileIds.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
          : String(body.excludeFileIds)
              .split(',')
              .map((value: string) => Number(value.trim()))
              .filter((value: number) => Number.isFinite(value) && value > 0))
      : []
    const excludeFileIds = Array.from(new Set<number>(rawExcludeIdList))

    const result = await serverRandomPoolManager.initialize({
      webdavUrl,
      webdavUsername,
      paths: pathList,
      preloadCount,
      excludeFileIds,
      fileType: fileType || undefined,
      isViewed: isViewed !== null && isViewed !== undefined ? isViewed === true || isViewed === 'true' : undefined,
      minFileSize: body.minFileSize ? parseInt(String(body.minFileSize)) : undefined,
      maxFileSize: body.maxFileSize ? parseInt(String(body.maxFileSize)) : undefined,
      randomness,
      ratings: body.ratings && Array.isArray(body.ratings) ? body.ratings : undefined,
      evaluations: body.evaluations && Array.isArray(body.evaluations) ? body.evaluations : undefined,
      categories: body.categories && Array.isArray(body.categories) ? body.categories : undefined,
      reasonFilter: body.reasonFilter || undefined,
      reasonKeyword: body.reasonKeyword || undefined,
      ratingEmptyFilter: body.ratingEmptyFilter,
      evaluationEmptyFilter: body.evaluationEmptyFilter,
      categoryEmptyFilter: body.categoryEmptyFilter,
    }, randomPoolSessionId)

    return NextResponse.json({
      success: true,
      hasData: result.hasData,
      actualCount: result.actualCount,
      requestedCount: result.requestedCount,
      isInsufficient: result.isInsufficient,
      message: result.message,
      poolStatus: result.poolStatus,
    })
  } catch (error: any) {
    console.error('初始化服务端随机缓存池失败:', error)
    return NextResponse.json(
      { error: `初始化失败: ${error.message}` },
      { status: 500 },
    )
  }
}
