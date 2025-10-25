import { NextRequest, NextResponse } from 'next/server'
import { scheduledScans } from '@/lib/database'
import { getWebDAVClient, recursiveScanDirectory } from '@/lib/webdav'
import { scanCache } from '@/lib/database'
import { writeScanLog } from '@/lib/scanLogger'

interface ScheduledTask {
  id: number
  webdav_url: string
  webdav_username: string
  webdav_password: string
  media_paths: string
  scan_settings: string
  cron_expression: string
  is_active: number
  last_run?: string
  next_run?: string
}

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
    const task = (tasks as ScheduledTask[]).find(t => t.id === taskId)
    
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
      
      // 记录扫描开始日志
      writeScanLog({
        webdavUrl: task.webdav_url,
        webdavUsername: task.webdav_username,
        path,
        scanType: 'scheduled',
        status: 'started'
      })

      const startTime = Date.now()
      
      // 收集扫描进度信息
      const progressLogs: string[] = []
      let batchCount = 0
      
      try {
        const result = await recursiveScanDirectory(client, path, {
          batchSize: scanSettings.batchSize || 10,
          onProgress: (progress) => {
            batchCount++
            const logMessage = `批次 ${batchCount} 完成: 处理了 ${progress.scannedDirectories} 个目录，找到 ${progress.foundFiles} 个文件，总计 ${progress.foundFiles} 个文件 (${progress.percentage}%)`
            progressLogs.push(logMessage)
            console.log(`定时扫描 ${path}: ${progress.currentPath} (已找到 ${progress.foundFiles} 个文件)`)
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
          webdavUrl: task.webdav_url,
          webdavUsername: task.webdav_username,
          path,
          filesData: JSON.stringify(filesData),
          totalFiles: result.totalFiles,
          imageCount: result.imageCount,
          videoCount: result.videoCount,
          scanSettings: JSON.stringify({ batchSize: scanSettings.batchSize || 10 })
        })

        // 记录扫描完成日志
        writeScanLog({
          webdavUrl: task.webdav_url,
          webdavUsername: task.webdav_username,
          path,
          scanType: 'scheduled',
          status: 'completed',
          totalFiles: result.totalFiles,
          imageCount: result.imageCount,
          videoCount: result.videoCount,
          durationMs: duration,
          logDetails: [
            ...progressLogs,
            `定时扫描完成，共找到 ${result.totalFiles} 个媒体文件 (图片: ${result.imageCount}, 视频: ${result.videoCount})，耗时 ${duration}ms`
          ].join('\n')
        })

        totalFiles += result.totalFiles
        totalImages += result.imageCount
        totalVideos += result.videoCount

      } catch (error: any) {
        const duration = Date.now() - startTime
        
        // 记录扫描失败日志
        writeScanLog({
          webdavUrl: task.webdav_url,
          webdavUsername: task.webdav_username,
          path,
          scanType: 'scheduled',
          status: 'failed',
          durationMs: duration,
          errorMessage: error.message,
          logDetails: progressLogs.length > 0 ? [
            ...progressLogs,
            `定时扫描失败: ${error.message}`
          ].join('\n') : `定时扫描失败: ${error.message}`
        })
        
        console.error(`定时扫描 ${path} 失败:`, error)
        throw error
      }
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
