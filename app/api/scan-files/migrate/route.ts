import { NextRequest, NextResponse } from 'next/server'
import { scanCache } from '@/lib/scanCacheRepository'
import { scanFiles } from '@/lib/scanFilesRepository'

// POST: 迁移数据
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { cacheId, migrateAll } = body

    if (migrateAll) {
      // 迁移所有缓存
      const result = await scanFiles.migrateAllFromCache()
      return NextResponse.json(result)
    }

    if (!cacheId) {
      return NextResponse.json(
        { error: '请提供 cacheId 或设置 migrateAll: true' },
        { status: 400 }
      )
    }

    // 迁移单个缓存
    const result = await scanFiles.migrateFromCache(cacheId)
    return NextResponse.json(result)

  } catch (error: any) {
    console.error('迁移扫描文件失败:', error)
    return NextResponse.json(
      { error: `迁移失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// GET: 获取迁移状态
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const webdavUrl = searchParams.get('webdavUrl')
    const webdavUsername = searchParams.get('webdavUsername')

    // 获取所有缓存及其迁移状态
    const caches = await scanCache.getAll() as any[]

    const filteredCaches = caches.filter(cache => {
      if (webdavUrl && cache.webdav_url !== webdavUrl) return false
      if (webdavUsername && cache.webdav_username !== webdavUsername) return false
      return true
    })

    const status = []
    for (const cache of filteredCaches) {
      const hasData = await scanFiles.hasData(cache.id)
      const stats = hasData ? await scanFiles.getStats(cache.id) : null

      status.push({
        cacheId: cache.id,
        path: cache.path,
        webdavUrl: cache.webdav_url,
        webdavUsername: cache.webdav_username,
        totalFilesInCache: cache.total_files,
        hasMigratedData: hasData,
        migratedStats: stats,
        lastScan: cache.last_scan
      })
    }

    return NextResponse.json({
      caches: status,
      summary: {
        total: status.length,
        migrated: status.filter(s => s.hasMigratedData).length,
        pending: status.filter(s => !s.hasMigratedData).length
      }
    })

  } catch (error: any) {
    console.error('获取迁移状态失败:', error)
    return NextResponse.json(
      { error: `获取状态失败: ${error.message}` },
      { status: 500 }
    )
  }
}
