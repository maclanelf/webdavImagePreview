import { NextRequest, NextResponse } from 'next/server'
import { serverRatingQueue } from '@/lib/serverRatingQueue'

/**
 * 乐观更新的评分 API（简化版）
 * 
 * POST: 添加评分任务到服务器队列，立即返回
 * GET: 获取队列状态
 *   - ?action=status: 获取队列状态
 *   - ?action=failed: 获取失败任务列表
 *   - ?action=retry: 重试所有失败任务
 *   - ?action=clear: 清除失败任务记录
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      filePath,
      fileName,
      fileType,
      rating,
      recommendationReason,
      customEvaluation,
      category,
      isViewed
    } = body

    if (!filePath || !fileName || !fileType) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      )
    }

    // 添加到服务器端队列，立即返回
    const taskId = serverRatingQueue.addTask({
      filePath,
      fileName,
      fileType,
      rating,
      recommendationReason,
      customEvaluation,
      category,
      isViewed
    })

    return NextResponse.json({ 
      success: true,
      taskId
    })
  } catch (error: any) {
    console.error('❌ [乐观评分 API] 失败:', error)
    return NextResponse.json(
      { error: `添加任务失败: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'status'

    switch (action) {
      case 'status':
        // 获取队列状态
        const status = serverRatingQueue.getStatus()
        return NextResponse.json(status)

      case 'failed':
        // 获取失败任务列表
        const failedTasks = serverRatingQueue.getFailedTasks()
        return NextResponse.json({ 
          failed: failedTasks,
          count: failedTasks.length
        })

      case 'retry':
        // 重试所有失败任务
        const retryCount = serverRatingQueue.retryFailedTasks()
        return NextResponse.json({
          success: true,
          message: `已重新添加 ${retryCount} 个失败任务到队列`
        })

      case 'clear':
        // 清除失败任务记录
        const clearCount = serverRatingQueue.clearFailedTasks()
        return NextResponse.json({
          success: true,
          message: `已清除 ${clearCount} 个失败任务记录`
        })

      default:
        return NextResponse.json(
          { error: '未知操作' },
          { status: 400 }
        )
    }
  } catch (error: any) {
    console.error('❌ [乐观评分 API] 获取状态失败:', error)
    return NextResponse.json(
      { error: `操作失败: ${error.message}` },
      { status: 500 }
    )
  }
}
