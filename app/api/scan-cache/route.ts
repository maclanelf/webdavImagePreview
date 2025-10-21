import { NextRequest, NextResponse } from 'next/server'
import { scanCache } from '@/lib/database'

interface ScanCacheItem {
  path: string
  total_files: number
  image_count: number
  video_count: number
  last_scan: string
}

// 获取扫描缓存数据
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const webdavUrl = searchParams.get('webdavUrl')
    const webdavUsername = searchParams.get('webdavUsername')
    const webdavPassword = searchParams.get('webdavPassword')

    if (!webdavUrl || !webdavUsername || !webdavPassword) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    // 获取匹配的WebDAV配置的缓存数据
    const cacheData = scanCache.getByWebDAVConfig(webdavUrl, webdavUsername)
    
    // 转换为前端需要的格式
    const pathStats = new Map()
    ;(cacheData as ScanCacheItem[]).forEach((item: ScanCacheItem) => {
      pathStats.set(item.path, {
        path: item.path,
        total: item.total_files,
        images: item.image_count,
        videos: item.video_count,
        lastScan: item.last_scan
      })
    })

    return NextResponse.json({
      pathStats: Object.fromEntries(pathStats)
    })
  } catch (error: any) {
    console.error('获取扫描缓存失败:', error)
    return NextResponse.json(
      { error: `获取扫描缓存失败: ${error.message}` },
      { status: 500 }
    )
  }
}
