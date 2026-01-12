import { NextRequest, NextResponse } from 'next/server'
import { scheduledScans } from '@/lib/database'
import { scanQueueManager } from '@/lib/scanQueueManager'

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

// 手动执行定时扫描任务（只负责将任务加入队列）
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

    const mediaPaths = task.media_paths ? JSON.parse(task.media_paths) : []
    const scanSettings = task.scan_settings ? JSON.parse(task.scan_settings) : {}
    
    // 将所有路径加入扫描队列
    const addedTasks: { path: string; taskId: string; position: number; isRunning: boolean }[] = []
    
    for (const path of mediaPaths) {
      const result = scanQueueManager.addTask({
        webdavUrl: task.webdav_url,
        webdavUsername: task.webdav_username,
        webdavPassword: task.webdav_password,
        path,
        concurrency: scanSettings.concurrency || scanSettings.batchSize || 10,
        forceRescan: false
      })
      
      addedTasks.push({
        path,
        taskId: result.taskId,
        position: result.position,
        isRunning: result.isRunning
      })
      
      console.log(`[定时扫描] 路径 ${path} 已加入队列，位置: ${result.position}`)
    }

    // 更新任务最后运行时间
    scheduledScans.updateLastRun(taskId)

    // 获取队列状态
    const queueStatus = scanQueueManager.getQueueStatus()

    return NextResponse.json({
      message: '扫描任务已加入队列',
      tasks: addedTasks,
      queueStatus: {
        queueLength: queueStatus.queueLength,
        isProcessing: queueStatus.isProcessing,
        rateLimited: queueStatus.rateLimited
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
