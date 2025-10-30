import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, recursiveScanDirectory } from '@/lib/webdav'
import { scanCache } from '@/lib/database'
import { writeScanLog } from '@/lib/scanLogger'
import { scanTaskManager } from '@/lib/scanTaskManager'

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
      batchSize = 10,
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
        const filesData = cached.files_data ? JSON.parse(cached.files_data) : []
        return NextResponse.json({
          path,
          total: cached.total_files,
          images: cached.image_count,
          videos: cached.video_count,
          scanInfo: {
            batchSize,
            actualFilesFound: cached.total_files,
            fromCache: true,
            lastScan: cached.last_scan
          },
          files: filesData
        })
      }
    }

    const client = getWebDAVClient({ url, username, password })
    const scanProgressId = progressId || `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // 检查是否有相同的扫描任务正在进行
    if (scanTaskManager.isTaskRunning(url, username, [path])) {
      const runningTask = scanTaskManager.getRunningTask(url, username, [path])
      return NextResponse.json({
        success: true,
        message: '扫描任务正在进行中',
        taskId: runningTask?.taskId,
        taskRunning: true
      })
    }

    // 启动扫描任务
    const taskId = scanTaskManager.startTask(url, username, [path])

    // 记录扫描开始日志
    writeScanLog({
      webdavUrl: url,
      webdavUsername: username,
      path,
      scanType: 'recursive',
      status: 'started'
    })

    const startTime = Date.now()
    
    // 收集扫描进度信息
    const progressLogs: string[] = []
    let batchCount = 0

    try {
      // 执行递归扫描
      const result = await recursiveScanDirectory(client, path, {
        batchSize,
        onProgress: (progress) => {
          batchCount++
          const logMessage = `批次 ${batchCount} 完成: 处理了 ${progress.scannedDirectories} 个目录，找到 ${progress.foundFiles} 个文件，总计 ${progress.foundFiles} 个文件 (${progress.percentage}%)`
          progressLogs.push(logMessage)
          
          // 更新进度映射
          scanProgressMap.set(scanProgressId, {
            currentPath: progress.currentPath,
            fileCount: progress.foundFiles,
            percentage: progress.percentage,
            scannedDirectories: progress.scannedDirectories,
            totalDirectories: progress.totalDirectories,
            timestamp: Date.now()
          })
        }
      })

      const duration = Date.now() - startTime

      // 保存到缓存
      const filesData = result.files.map(file => ({
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
        totalFiles: result.totalFiles,
        imageCount: result.imageCount,
        videoCount: result.videoCount,
        scanSettings: JSON.stringify({ batchSize })
      })

      // 记录扫描完成日志
      writeScanLog({
        webdavUrl: url,
        webdavUsername: username,
        path,
        scanType: 'recursive',
        status: 'completed',
        totalFiles: result.totalFiles,
        imageCount: result.imageCount,
        videoCount: result.videoCount,
        durationMs: duration,
        logDetails: [
          ...progressLogs,
          `递归扫描完成，共找到 ${result.totalFiles} 个媒体文件 (图片: ${result.imageCount}, 视频: ${result.videoCount})，耗时 ${duration}ms`
        ].join('\n')
      })

      // 清理进度映射
      scanProgressMap.delete(scanProgressId)

      // 标记任务完成
      scanTaskManager.completeTask(taskId)

      return NextResponse.json({
        path,
        total: result.totalFiles,
        images: result.imageCount,
        videos: result.videoCount,
        scanInfo: {
          batchSize,
          actualFilesFound: result.totalFiles,
          fromCache: false,
          duration: duration
        },
        files: filesData,
        taskId
      })

    } catch (error: any) {
      const duration = Date.now() - startTime
      
      // 记录扫描失败日志
      writeScanLog({
        webdavUrl: url,
        webdavUsername: username,
        path,
        scanType: 'recursive',
        status: 'failed',
        durationMs: duration,
        errorMessage: error.message,
        logDetails: progressLogs.length > 0 ? [
          ...progressLogs,
          `扫描失败: ${error.message}`
        ].join('\n') : `扫描失败: ${error.message}`
      })

      // 清理进度映射
      scanProgressMap.delete(scanProgressId)
      
      // 标记任务失败
      scanTaskManager.failTask(taskId, error.message)
      
      console.error('递归扫描失败:', error)
      return NextResponse.json(
        { error: `递归扫描失败: ${error.message}` },
        { status: 500 }
      )
    }
  } catch (error: any) {
    console.error('扫描API错误:', error)
    return NextResponse.json(
      { error: `扫描API错误: ${error.message}` },
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