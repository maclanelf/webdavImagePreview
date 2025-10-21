import { NextRequest, NextResponse } from 'next/server'
import { scheduledScans } from '@/lib/database'
import { getWebDAVClient, getMediaFiles } from '@/lib/webdav'
import { scanCache } from '@/lib/database'

// 手动执行定时扫描任务
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { taskId } = body

    if (!taskId) {
      return NextResponse.json(
        { error: '请提供任务ID' },
        { status: 400 }
      )
    }

    // 获取任务信息
    const tasks = scheduledScans.getAll()
    const task = tasks.find(t => t.id === taskId)
    
    if (!task) {
      return NextResponse.json(
        { error: '任务不存在' },
        { status: 404 }
      )
    }

    const client = getWebDAVClient({
      url: task.webdav_url,
      username: task.webdav_username,
      password: task.webdav_password
    })

    const mediaPaths = JSON.parse(task.media_paths)
    const scanSettings = JSON.parse(task.scan_settings)
    
    let totalFiles = 0
    let totalImages = 0
    let totalVideos = 0

    // 扫描所有路径
    for (const path of mediaPaths) {
      console.log(`执行定时扫描: ${path}`)
      
      const files = await getMediaFiles(client, path, {
        maxDepth: scanSettings.maxDepth,
        maxFiles: Math.floor(scanSettings.maxFiles / mediaPaths.length),
        timeout: Math.floor(scanSettings.timeout / mediaPaths.length),
        onProgress: (currentPath, fileCount) => {
          console.log(`定时扫描 ${path}: ${currentPath} (已找到 ${fileCount} 个文件)`)
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
        webdavUrl: task.webdav_url,
        webdavUsername: task.webdav_username,
        path,
        filesData: JSON.stringify(filesData),
        totalFiles: files.length,
        imageCount,
        videoCount,
        scanSettings: JSON.stringify(scanSettings)
      })

      totalFiles += files.length
      totalImages += imageCount
      totalVideos += videoCount
    }

    // 更新任务最后运行时间
    scheduledScans.updateLastRun(taskId)

    return NextResponse.json({
      message: '定时扫描执行成功',
      result: {
        totalFiles,
        totalImages,
        totalVideos,
        scannedPaths: mediaPaths.length
      }
    })
  } catch (error: any) {
    console.error('执行定时扫描失败:', error)
    return NextResponse.json(
      { error: `执行定时扫描失败: ${error.message}` },
      { status: 500 }
    )
  }
}
