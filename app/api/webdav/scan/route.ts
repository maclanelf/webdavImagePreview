import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, getMediaFiles } from '@/lib/webdav'
import { scanCache } from '@/lib/database'

// 存储扫描进度（实际应用中应该使用Redis等）
const scanProgressMap = new Map<string, any>()

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      url, 
      username, 
      password, 
      path = '/',
      maxDepth = 10,
      maxFiles = 200000,
      timeout = 60000,
      forceRescan = false,
      progressId // 新增：进度ID
    } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    // 检查缓存（如果不强制重新扫描）
    if (!forceRescan) {
      const cached = scanCache.get(url, username, path) as any
      if (cached) {
        console.log(`从缓存加载扫描结果: ${path}`)
        const filesData = JSON.parse(cached.files_data)
        return NextResponse.json({
          path,
          total: cached.total_files,
          images: cached.image_count,
          videos: cached.video_count,
          scanInfo: {
            maxDepth,
            maxFiles,
            timeout,
            actualFilesFound: cached.total_files,
            fromCache: true,
            lastScan: cached.last_scan
          },
          files: filesData // 返回文件列表供前端使用
        })
      }
    }

    const client = getWebDAVClient({ url, username, password })
    
    // 扫描指定目录的媒体文件，使用优化的参数
    const files = await getMediaFiles(client, path, {
      maxDepth,
      maxFiles,
      timeout,
      onProgress: (currentPath, fileCount, totalFiles, scannedDirs, totalDirs) => {
        const percentage = totalDirs ? Math.round(((scannedDirs || 0) / totalDirs) * 100) : 0
        console.log(`扫描进度: ${currentPath} (已扫描 ${scannedDirs || 0}/${totalDirs || 0} 个目录, ${fileCount} 个文件, ${percentage}%)`)
        
        // 更新进度映射
        if (progressId) {
          scanProgressMap.set(progressId, {
            currentPath,
            fileCount,
            scannedDirectories: scannedDirs || 0,
            totalDirectories: totalDirs || 0,
            percentage,
            timestamp: Date.now()
          })
        }
      }
    })
    
    // 统计信息
    const imageCount = files.filter(f => 
      /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename)
    ).length
    
    const videoCount = files.filter(f => 
      /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename)
    ).length

    // 保存到缓存
    const filesData = files.map(file => ({
      filename: file.filename,
      basename: file.basename,
      size: file.size,
      type: file.type,
      lastmod: file.lastmod,
    }))

    scanCache.save({
      webdavUrl: url,
      webdavUsername: username,
      path,
      filesData: JSON.stringify(filesData),
      totalFiles: files.length,
      imageCount,
      videoCount,
      scanSettings: JSON.stringify({ maxDepth, maxFiles, timeout })
    })
    
    // 清理进度映射
    if (progressId) {
      scanProgressMap.delete(progressId)
    }
    
    return NextResponse.json({
      path,
      total: files.length,
      images: imageCount,
      videos: videoCount,
      scanInfo: {
        maxDepth,
        maxFiles,
        timeout,
        actualFilesFound: files.length,
        fromCache: false,
        scanTime: Date.now()
      },
      files: filesData // 返回文件列表供前端使用
    })
  } catch (error: any) {
    console.error('扫描目录失败:', error)
    return NextResponse.json(
      { error: `扫描目录失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 获取扫描进度
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const progressId = searchParams.get('progressId')
    
    if (!progressId) {
      return NextResponse.json(
        { error: '请提供进度ID' },
        { status: 400 }
      )
    }
    
    const progress = scanProgressMap.get(progressId)
    
    if (!progress) {
      return NextResponse.json(
        { error: '进度信息不存在或已过期' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(progress)
  } catch (error: any) {
    console.error('获取扫描进度失败:', error)
    return NextResponse.json(
      { error: `获取扫描进度失败: ${error.message}` },
      { status: 500 }
    )
  }
}