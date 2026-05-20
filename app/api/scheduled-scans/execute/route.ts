import { NextRequest, NextResponse } from 'next/server'

import { scheduledScans } from '@/lib/database'
import { scanQueueManager } from '@/lib/scanQueueManager'

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

    const tasks = await scheduledScans.getAll()
    const task = (tasks as any[]).find((item) => item.id === taskId)
    
    if (!task) {
      return NextResponse.json(
        { error: '任务不存在' },
        { status: 404 }
      )
    }

    const mediaPaths = task.media_paths ? JSON.parse(task.media_paths) : []
    const scanSettings = task.scan_settings ? JSON.parse(task.scan_settings) : {}
    
    const addedTasks: { path: string; taskId: string; position: number; isRunning: boolean }[] = []
    
    for (const path of mediaPaths) {
      const result = await scanQueueManager.addTask({
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

    await scheduledScans.updateLastRun(taskId)

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
