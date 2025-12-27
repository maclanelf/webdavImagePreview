import { NextRequest, NextResponse } from 'next/server'
import { scanFiles, scanCache } from '@/lib/database'

// GET: 获取扫描文件
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const cacheId = searchParams.get('cacheId')
    const webdavUrl = searchParams.get('webdavUrl')
    const webdavUsername = searchParams.get('webdavUsername')
    const path = searchParams.get('path')
    const lastId = searchParams.get('lastId')
    const limit = searchParams.get('limit')
    const fileType = searchParams.get('fileType') as 'image' | 'video' | null
    const isViewed = searchParams.get('isViewed')
    const parentPath = searchParams.get('parentPath')
    const random = searchParams.get('random')

    let targetCacheId: number | null = null

    // 通过 cacheId 或 webdav 配置获取
    if (cacheId) {
      targetCacheId = parseInt(cacheId)
    } else if (webdavUrl && webdavUsername && path) {
      const cache = scanCache.get(webdavUrl, webdavUsername, path) as any
      if (cache) {
        targetCacheId = cache.id
      }
    }

    if (!targetCacheId) {
      return NextResponse.json(
        { error: '请提供有效的 cacheId 或 webdavUrl/webdavUsername/path' },
        { status: 400 }
      )
    }

    // 检查是否有迁移数据
    if (!scanFiles.hasData(targetCacheId)) {
      return NextResponse.json({
        files: [],
        hasData: false,
        message: '该缓存尚未迁移数据，请先执行迁移'
      })
    }

    // 随机获取
    if (random === 'true') {
      const file = scanFiles.getRandom(targetCacheId, {
        fileType: fileType || undefined,
        isViewed: isViewed !== null ? isViewed === 'true' : undefined
      })
      return NextResponse.json({ file })
    }

    // 按目录获取（图组模式）
    if (parentPath) {
      const files = scanFiles.getByParentPath(targetCacheId, parentPath)
      return NextResponse.json({ files, count: files.length })
    }

    // 分页获取
    const files = scanFiles.getByCache(targetCacheId, {
      lastId: lastId ? parseInt(lastId) : 0,
      limit: limit ? parseInt(limit) : 100,
      fileType: fileType || undefined,
      isViewed: isViewed !== null ? isViewed === 'true' : undefined
    })

    // 获取统计信息
    const stats = scanFiles.getStats(targetCacheId)

    return NextResponse.json({
      files,
      stats,
      hasMore: files.length === (limit ? parseInt(limit) : 100),
      lastId: files.length > 0 ? (files[files.length - 1] as any).id : 0
    })

  } catch (error: any) {
    console.error('获取扫描文件失败:', error)
    return NextResponse.json(
      { error: `获取失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// POST: 标记文件已看
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { cacheId, filename, filenames } = body

    if (!cacheId) {
      return NextResponse.json(
        { error: '请提供 cacheId' },
        { status: 400 }
      )
    }

    // 批量标记
    if (filenames && Array.isArray(filenames)) {
      const result = scanFiles.batchMarkViewed(cacheId, filenames)
      return NextResponse.json({ success: true, ...result })
    }

    // 单个标记
    if (filename) {
      scanFiles.markViewed(cacheId, filename)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json(
      { error: '请提供 filename 或 filenames' },
      { status: 400 }
    )

  } catch (error: any) {
    console.error('标记文件已看失败:', error)
    return NextResponse.json(
      { error: `标记失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// DELETE: 删除缓存的文件数据
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const cacheId = searchParams.get('cacheId')

    if (!cacheId) {
      return NextResponse.json(
        { error: '请提供 cacheId' },
        { status: 400 }
      )
    }

    const result = scanFiles.deleteByCache(parseInt(cacheId))
    return NextResponse.json({ 
      success: true, 
      deleted: result.changes 
    })

  } catch (error: any) {
    console.error('删除扫描文件失败:', error)
    return NextResponse.json(
      { error: `删除失败: ${error.message}` },
      { status: 500 }
    )
  }
}
