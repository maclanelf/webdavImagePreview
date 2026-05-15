import { NextRequest, NextResponse } from 'next/server'
import { scanCache } from '@/lib/scanCacheRepository'

/**
 * 文件列表接口 - 仅从缓存/数据库读取
 * 扫描功能已迁移到 ScanQueueManager，请通过管理页面触发扫描
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      url, 
      username, 
      password, 
      mediaPaths = ['/'],
    } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    // 从缓存加载所有路径的文件
    const allFiles: any[] = []
    const cachedPaths: string[] = []
    const uncachedPaths: string[] = []
    
    for (const path of mediaPaths) {
      const cached = scanCache.get(url, username, path) as any
      if (cached) {
        console.log(`从缓存加载路径: ${path}`)
        const filesData = cached.files_data ? JSON.parse(cached.files_data) : []
        allFiles.push(...filesData)
        cachedPaths.push(path)
      } else {
        uncachedPaths.push(path)
      }
    }

    // 计算统计信息
    const imageCount = allFiles.filter(f => 
      /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename)
    ).length
    
    const videoCount = allFiles.filter(f => 
      /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename)
    ).length

    // 如果有未缓存的路径，提示用户去管理页面扫描
    if (uncachedPaths.length > 0) {
      console.log(`以下路径未缓存，请通过管理页面触发扫描: ${uncachedPaths.join(', ')}`)
    }

    return NextResponse.json({
      files: allFiles,
      fromCache: true,
      cachedPaths,
      uncachedPaths,
      stats: {
        total: allFiles.length,
        images: imageCount,
        videos: videoCount
      }
    })
  } catch (error: any) {
    console.error('获取文件列表失败:', error)
    return NextResponse.json(
      { error: `获取文件失败: ${error.message}` },
      { status: 500 }
    )
  }
}

