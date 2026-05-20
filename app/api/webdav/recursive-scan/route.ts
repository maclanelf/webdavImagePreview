import { NextRequest, NextResponse } from 'next/server'
import { scanQueueManager } from '@/lib/scanQueueManager'

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

    // 使用队列管理器添加任务
    const result = await scanQueueManager.addTask({
      webdavUrl: url,
      webdavUsername: username,
      webdavPassword: password,
      path,
      concurrency,
      forceRescan
    })

    // 获取队列状态
    const queueStatus = scanQueueManager.getQueueStatus()

    // 如果任务已在运行
    if (result.isRunning) {
      return NextResponse.json({
        success: true,
        message: '扫描任务正在进行中',
        taskId: result.taskId,
        taskRunning: true,
        position: 0,
        rateLimited: queueStatus.rateLimited,
        rateLimitedUntil: queueStatus.rateLimitedUntil?.toISOString()
      })
    }

    // 如果任务在队列中等待
    if (result.position > 1) {
      return NextResponse.json({
        success: true,
        message: `任务已加入队列，当前位置: ${result.position}`,
        taskId: result.taskId,
        taskQueued: true,
        position: result.position,
        delayUntil: result.delayUntil?.toISOString(),
        rateLimited: queueStatus.rateLimited,
        rateLimitedUntil: queueStatus.rateLimitedUntil?.toISOString()
      })
    }

    // 任务刚加入队列并开始执行
    return NextResponse.json({
      success: true,
      message: '扫描任务已启动',
      taskId: result.taskId,
      scanStarted: true,
      position: result.position,
      delayUntil: result.delayUntil?.toISOString(),
      rateLimited: queueStatus.rateLimited,
      rateLimitedUntil: queueStatus.rateLimitedUntil?.toISOString()
    })

  } catch (error: any) {
    console.error('递归扫描API错误:', error)
    return NextResponse.json(
      { error: `递归扫描API错误: ${error.message}` },
      { status: 500 }
    )
  }
}

// 获取队列状态
export async function GET(request: NextRequest) {
  try {
    const status = scanQueueManager.getQueueStatus()
    
    // 从数据库获取当前任务的详细进度
    let currentTaskProgress = null
    if (status.currentTask) {
      const { recursiveScanTasks } = await import('@/lib/database')
      const dbTask = await recursiveScanTasks.get(status.currentTask.taskId) as any
      if (dbTask) {
        currentTaskProgress = {
          scannedDirectories: dbTask.scanned_directories || 0,
          totalDirectories: dbTask.total_directories || 0,
          foundFiles: dbTask.found_files || 0,
          currentPath: dbTask.current_path || status.currentTask.path
        }
      }
    }
    
    return NextResponse.json({
      success: true,
      isProcessing: status.isProcessing,
      currentTask: status.currentTask ? {
        taskId: status.currentTask.taskId,
        path: status.currentTask.path,
        status: status.currentTask.status,
        progress: currentTaskProgress
      } : null,
      queueLength: status.queueLength,
      pendingTasks: status.pendingTasks.map(t => ({
        taskId: t.taskId,
        path: t.path,
        status: t.status,
        delayUntil: t.delayUntil?.toISOString()
      })),
      // 风控状态
      rateLimited: status.rateLimited,
      rateLimitedUntil: status.rateLimitedUntil?.toISOString(),
      // 下一个任务的等待时间
      nextTaskDelay: status.nextTaskDelay
    })
  } catch (error: any) {
    console.error('获取队列状态失败:', error)
    return NextResponse.json(
      { error: `获取队列状态失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 重置风控状态
export async function DELETE(request: NextRequest) {
  try {
    scanQueueManager.resetRateLimit()
    return NextResponse.json({
      success: true,
      message: '风控状态已重置'
    })
  } catch (error: any) {
    console.error('重置风控状态失败:', error)
    return NextResponse.json(
      { error: `重置风控状态失败: ${error.message}` },
      { status: 500 }
    )
  }
}
