import { NextRequest, NextResponse } from 'next/server'
import { getWebSocketManager } from '@/lib/websocket-manager'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      webdavUrl,
      webdavUsername,
      webdavPassword,
      path,
      maxDepth = 10,
      maxFiles = 200000,
      timeout = 60000,
      forceRescan = false
    } = body

    if (!webdavUrl || !webdavUsername || !webdavPassword || !path) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置和路径信息' },
        { status: 400 }
      )
    }

    const wsManager = getWebSocketManager()
    const taskId = await wsManager.createScanTask({
      webdavUrl,
      webdavUsername,
      webdavPassword,
      path,
      maxDepth,
      maxFiles,
      timeout,
      forceRescan
    })

    return NextResponse.json({
      success: true,
      taskId,
      message: '扫描任务已创建'
    })

  } catch (error: any) {
    console.error('创建扫描任务失败:', error)
    return NextResponse.json(
      { error: `创建扫描任务失败: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const taskId = searchParams.get('taskId')

    const wsManager = getWebSocketManager()

    if (taskId) {
      // 获取特定任务状态
      const task = wsManager.getTaskStatus(taskId)
      if (!task) {
        return NextResponse.json(
          { error: '任务不存在' },
          { status: 404 }
        )
      }
      return NextResponse.json({ task })
    } else {
      // 获取所有任务
      const tasks = wsManager.getAllTasks()
      return NextResponse.json({ tasks })
    }

  } catch (error: any) {
    console.error('获取扫描任务状态失败:', error)
    return NextResponse.json(
      { error: `获取扫描任务状态失败: ${error.message}` },
      { status: 500 }
    )
  }
}
