import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, getMediaFiles } from '@/lib/webdav'

// 预加载缓存 - 存储在内存中
const preloadCache = new Map<string, {
  blob: Blob
  url: string
  timestamp: number
  filepath: string
}>()

// 预加载队列
const preloadQueue = new Set<string>()

// 最大缓存数量
const MAX_CACHE_SIZE = 20
const MAX_VIDEO_SIZE = 100 * 1024 * 1024 // 100MB

// 清理过期缓存（超过5分钟）
const CACHE_EXPIRE_TIME = 5 * 60 * 1000

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, username, password, mediaPaths = ['/'], count = 20 } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    const client = getWebDAVClient({ url, username, password })
    
    // 从所有路径获取文件
    const allFiles = []
    for (const path of mediaPaths) {
      const files = await getMediaFiles(client, path)
      allFiles.push(...files)
    }
    
    if (allFiles.length === 0) {
      return NextResponse.json(
        { error: '未找到任何媒体文件' },
        { status: 404 }
      )
    }

    // 筛选符合条件的文件（图片 + 小于100MB的视频）
    const eligibleFiles = allFiles.filter(file => {
      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(file.basename)
      const isVideo = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(file.basename)
      
      if (isImage) return true
      if (isVideo && file.size <= MAX_VIDEO_SIZE) return true
      return false
    })

    if (eligibleFiles.length === 0) {
      return NextResponse.json(
        { error: '未找到符合条件的媒体文件' },
        { status: 404 }
      )
    }

    // 随机选择文件进行预加载
    const shuffledFiles = [...eligibleFiles].sort(() => Math.random() - 0.5)
    const filesToPreload = shuffledFiles.slice(0, Math.min(count, eligibleFiles.length))

    // 清理过期缓存
    cleanupExpiredCache()

    // 开始预加载
    const preloadPromises = filesToPreload.map(file => preloadFile(client, file))
    const results = await Promise.allSettled(preloadPromises)

    const successCount = results.filter(result => result.status === 'fulfilled').length
    const failedCount = results.filter(result => result.status === 'rejected').length

    return NextResponse.json({
      success: true,
      message: `预加载完成：成功 ${successCount} 个，失败 ${failedCount} 个`,
      preloadedCount: successCount,
      failedCount,
      cacheSize: preloadCache.size
    })

  } catch (error: any) {
    console.error('预加载失败:', error)
    return NextResponse.json(
      { error: `预加载失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 获取预加载的文件
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const filepath = searchParams.get('filepath')

    if (!filepath) {
      return NextResponse.json(
        { error: '请提供文件路径' },
        { status: 400 }
      )
    }

    const cached = preloadCache.get(filepath)
    if (cached) {
      // 更新访问时间
      cached.timestamp = Date.now()
      return new NextResponse(cached.blob, {
        headers: {
          'Content-Type': cached.blob.type,
          'Cache-Control': 'public, max-age=300',
        }
      })
    }

    return NextResponse.json(
      { error: '文件未预加载' },
      { status: 404 }
    )

  } catch (error: any) {
    console.error('获取预加载文件失败:', error)
    return NextResponse.json(
      { error: `获取预加载文件失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 预加载单个文件
async function preloadFile(client: any, file: any): Promise<void> {
  const filepath = file.filename
  
  // 如果已经在缓存中，跳过
  if (preloadCache.has(filepath)) {
    return
  }

  // 如果正在预加载队列中，跳过
  if (preloadQueue.has(filepath)) {
    return
  }

  try {
    preloadQueue.add(filepath)

    // 获取文件流
    const stream = await client.createReadStream(filepath)
    const chunks: Buffer[] = []
    
    for await (const chunk of stream) {
      chunks.push(chunk)
    }
    
    const buffer = Buffer.concat(chunks)
    const blob = new Blob([buffer])
    
    // 创建对象URL
    const url = URL.createObjectURL(blob)
    
    // 存储到缓存
    preloadCache.set(filepath, {
      blob,
      url,
      timestamp: Date.now(),
      filepath
    })

    // 如果缓存超过最大数量，删除最旧的
    if (preloadCache.size > MAX_CACHE_SIZE) {
      const oldestKey = Array.from(preloadCache.keys())[0]
      const oldest = preloadCache.get(oldestKey)
      if (oldest) {
        URL.revokeObjectURL(oldest.url)
        preloadCache.delete(oldestKey)
      }
    }

    console.log(`预加载完成: ${file.basename}`)

  } catch (error) {
    console.error(`预加载失败 ${file.basename}:`, error)
    throw error
  } finally {
    preloadQueue.delete(filepath)
  }
}

// 清理过期缓存
function cleanupExpiredCache() {
  const now = Date.now()
  for (const [key, cached] of preloadCache.entries()) {
    if (now - cached.timestamp > CACHE_EXPIRE_TIME) {
      URL.revokeObjectURL(cached.url)
      preloadCache.delete(key)
    }
  }
}

// 获取缓存状态
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    if (action === 'status') {
      return NextResponse.json({
        cacheSize: preloadCache.size,
        maxCacheSize: MAX_CACHE_SIZE,
        queueSize: preloadQueue.size,
        cachedFiles: Array.from(preloadCache.keys())
      })
    }

    if (action === 'clear') {
      // 清理所有缓存
      for (const cached of preloadCache.values()) {
        URL.revokeObjectURL(cached.url)
      }
      preloadCache.clear()
      preloadQueue.clear()
      
      return NextResponse.json({
        success: true,
        message: '缓存已清理'
      })
    }

    return NextResponse.json(
      { error: '未知操作' },
      { status: 400 }
    )

  } catch (error: any) {
    console.error('缓存操作失败:', error)
    return NextResponse.json(
      { error: `缓存操作失败: ${error.message}` },
      { status: 500 }
    )
  }
}
