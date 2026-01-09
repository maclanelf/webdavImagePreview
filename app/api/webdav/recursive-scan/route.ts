import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, recursiveScanDirectory } from '@/lib/webdav-optimized'
import { scanCache, scanFiles } from '@/lib/database'
import { writeScanLog } from '@/lib/scanLogger'
import { scanTaskManager } from '@/lib/scanTaskManager'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      url, 
      username, 
      password, 
      path = '/',
      concurrency = 10,
      forceRescan = false
    } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    const client = getWebDAVClient({ url, username, password })

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
        concurrency,
        onProgress: (progress) => {
          batchCount++
          const logMessage = `批次 ${batchCount} 完成: 处理了 ${progress.scannedDirectories} 个目录，找到 ${progress.foundFiles} 个文件，总计 ${progress.foundFiles} 个文件 (${progress.percentage}%)`
          progressLogs.push(logMessage)
        }
      })

      const duration = Date.now() - startTime

      // 检查扫描结果是否有效
      if (!result || !result.files) {
        throw new Error('扫描失败')
      }

      // 0 个文件是正常结果，不应该报错
      if (result.files.length === 0) {
        console.log(`扫描完成，路径 ${path} 下没有找到媒体文件`)
      }

      // 如果强制重新扫描，在扫描成功后再清除并替换缓存
      if (forceRescan) {
        scanCache.delete(url, username, path)
      }

      // 保存到缓存（扫描成功且确认有文件内容）
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
        scanSettings: JSON.stringify({ concurrency })
      })

      // 获取刚保存的 cache_id，写入 scan_files 表
      const savedCache = scanCache.get(url, username, path) as any
      let scanFilesLogDetails = ''
      if (savedCache && savedCache.id) {
        // 记录写入前的状态
        const beforeStats = scanFiles.getStats(savedCache.id)
        const beforeTotal = beforeStats.total
        const beforeViewed = beforeStats.viewed
        
        console.log(`📊 [数据写入] 写入前: 文件数量 ${beforeTotal}, 已看过 ${beforeViewed}`)
        
        // 先删除旧数据
        scanFiles.deleteByCache(savedCache.id)
        // 批量插入新数据
        scanFiles.batchInsert(savedCache.id, filesData)
        // 从 media_ratings 同步已看状态
        const syncResult = scanFiles.syncViewedFromRatings(savedCache.id)
        
        // 记录写入后的状态
        const afterStats = scanFiles.getStats(savedCache.id)
        const afterTotal = afterStats.total
        const afterViewed = afterStats.viewed
        
        const logMessage = `写入前: 文件数量 ${beforeTotal}, 已看过 ${beforeViewed} | 写入后: 文件数量 ${afterTotal}, 同步已看过 ${afterViewed}`
        console.log(`✅ [数据写入] ${logMessage}`)
        
        scanFilesLogDetails = `数据写入完成\n写入前: 文件数量 ${beforeTotal}, 已看过 ${beforeViewed}\n写入后: 文件数量 ${afterTotal}, 同步已看过 ${afterViewed}\n从 media_ratings 同步了 ${syncResult.synced} 条已看记录`
      }

      // 记录扫描完成日志，包含完整的进度信息
      const logDetailLines = [
        ...progressLogs,
        `递归扫描完成，共找到 ${result.totalFiles} 个媒体文件 (图片: ${result.imageCount}, 视频: ${result.videoCount})，耗时 ${duration}ms`
      ]
      if (scanFilesLogDetails) {
        logDetailLines.push(scanFilesLogDetails)
      }
      if (forceRescan) {
        logDetailLines.push('[强制扫描] 已清除旧缓存并重新写入数据')
      }
      
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
        logDetails: logDetailLines.join('\n')
      })

      // 标记任务完成
      scanTaskManager.completeTask(taskId)

      return NextResponse.json({
        success: true,
        message: '递归扫描完成',
        result: {
          totalFiles: result.totalFiles,
          imageCount: result.imageCount,
          videoCount: result.videoCount,
          duration: duration
        },
        taskId
      })

    } catch (error: any) {
      const duration = Date.now() - startTime
      
      // 记录扫描失败日志，包含已收集的进度信息
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

      // 标记任务失败
      scanTaskManager.failTask(taskId, error.message)
      
      console.error('递归扫描失败:', error)
      return NextResponse.json(
        { error: `递归扫描失败: ${error.message}` },
        { status: 500 }
      )
    }

  } catch (error: any) {
    console.error('递归扫描API错误:', error)
    return NextResponse.json(
      { error: `递归扫描API错误: ${error.message}` },
      { status: 500 }
    )
  }
}