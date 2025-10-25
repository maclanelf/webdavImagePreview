import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, recursiveScanDirectory } from '@/lib/webdav'
import { scanCache } from '@/lib/database'
import { writeScanLog } from '@/lib/scanLogger'
import { scanTaskManager } from '@/lib/scanTaskManager'

// 后台扫描API - 不等待扫描完成，立即返回
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      url, 
      username, 
      password, 
      mediaPaths = ['/'],
      batchSize = 10
    } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    // 检查哪些路径需要扫描
    const uncachedPaths = []
    for (const path of mediaPaths) {
      const cached = scanCache.get(url, username, path) as any
      if (!cached) {
        uncachedPaths.push(path)
      }
    }

    // 检查是否有相同的扫描任务正在进行
    const pathsToScan = scanTaskManager.getPathsToScan(url, username, uncachedPaths)
    
    // 如果没有需要扫描的路径，直接返回
    if (pathsToScan.length === 0) {
      // 检查是否有正在运行的任务
      const runningTask = scanTaskManager.getRunningTask(url, username, uncachedPaths)
      if (runningTask) {
        return NextResponse.json({
          success: true,
          message: '扫描任务正在进行中',
          scannedPaths: mediaPaths.filter(p => !uncachedPaths.includes(p)),
          pendingPaths: uncachedPaths,
          taskId: runningTask.taskId,
          taskRunning: true
        })
      }
      
      return NextResponse.json({
        success: true,
        message: '所有路径都已扫描完成',
        scannedPaths: mediaPaths,
        pendingPaths: []
      })
    }

    // 启动扫描任务
    const taskId = scanTaskManager.startTask(url, username, pathsToScan)

    // 启动后台扫描（不等待完成）
    const client = getWebDAVClient({ url, username, password })
    
    // 使用Promise.allSettled来并行扫描所有路径，但不等待完成
    const scanPromises = pathsToScan.map(async (path) => {
      try {
        console.log(`开始后台扫描路径: ${path}`)
        
        // 记录扫描开始日志
        writeScanLog({
          webdavUrl: url,
          webdavUsername: username,
          path,
          scanType: 'recursive',
          status: 'started'
        })

        // 执行扫描
        const result = await recursiveScanDirectory(client, path, batchSize)
        
        // 记录扫描完成日志
        writeScanLog({
          webdavUrl: url,
          webdavUsername: username,
          path,
          scanType: 'recursive',
          status: 'completed',
          fileCount: result.files.length,
          imageCount: result.images,
          videoCount: result.videos
        })

        return { path, success: true, result }
      } catch (error) {
        console.error(`扫描路径 ${path} 失败:`, error)
        
        // 记录扫描失败日志
        writeScanLog({
          webdavUrl: url,
          webdavUsername: username,
          path,
          scanType: 'recursive',
          status: 'failed',
          error: error.message
        })

        return { path, success: false, error: error.message }
      }
    })

    // 在后台处理扫描结果
    Promise.allSettled(scanPromises).then((results) => {
      const successCount = results.filter(r => r.status === 'fulfilled').length
      const failedCount = results.filter(r => r.status === 'rejected').length
      
      if (failedCount === 0) {
        scanTaskManager.completeTask(taskId)
      } else {
        scanTaskManager.failTask(taskId, `${failedCount} 个路径扫描失败`)
      }
      
      console.log(`扫描任务 ${taskId} 完成: 成功 ${successCount}, 失败 ${failedCount}`)
    })

    // 不等待扫描完成，立即返回
    return NextResponse.json({
      success: true,
      message: `已启动 ${pathsToScan.length} 个路径的后台扫描`,
      scannedPaths: mediaPaths.filter(p => !pathsToScan.includes(p)),
      pendingPaths: pathsToScan,
      taskId,
      scanStarted: true
    })

  } catch (error: any) {
    console.error('启动后台扫描失败:', error)
    return NextResponse.json(
      { error: `启动后台扫描失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 检查扫描状态
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')
    const username = searchParams.get('username')
    const password = searchParams.get('password')
    const mediaPaths = searchParams.get('mediaPaths')?.split(',') || ['/']

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    // 检查各路径的扫描状态
    const pathStatus = []
    for (const path of mediaPaths) {
      const cached = scanCache.get(url, username, path) as any
      pathStatus.push({
        path,
        scanned: !!cached,
        fileCount: cached?.total_files || 0,
        imageCount: cached?.image_count || 0,
        videoCount: cached?.video_count || 0,
        lastScan: cached?.last_scan || null
      })
    }

    const scannedPaths = pathStatus.filter(p => p.scanned)
    const pendingPaths = pathStatus.filter(p => !p.scanned)

    return NextResponse.json({
      success: true,
      pathStatus,
      scannedPaths: scannedPaths.map(p => p.path),
      pendingPaths: pendingPaths.map(p => p.path),
      totalScanned: scannedPaths.length,
      totalPending: pendingPaths.length
    })

  } catch (error: any) {
    console.error('检查扫描状态失败:', error)
    return NextResponse.json(
      { error: `检查扫描状态失败: ${error.message}` },
      { status: 500 }
    )
  }
}
