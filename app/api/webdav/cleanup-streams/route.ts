import { NextRequest, NextResponse } from 'next/server'
import {
  cleanupAllStreams,
  getActiveStreamCount,
  getActiveStreamsInfo
} from '@/lib/streamManager'

// 这个 API 用于清理所有活动的视频流
// 当用户刷新页面或离开页面时调用

export async function POST(request: NextRequest) {
  try {
    const beforeCount = getActiveStreamCount()
    const streamsInfo = getActiveStreamsInfo()
    
    console.log('🧹 [清理API] 收到清理请求')
    console.log(`📊 [清理API] 当前活动流: ${beforeCount} 个`)
    
    if (streamsInfo.length > 0) {
      console.log('📋 [清理API] 活动流详情:')
      streamsInfo.forEach(info => {
        console.log(`  - ${info.requestId}: ${info.filepath} (${info.duration}秒)`)
      })
    }
    
    const cleanedCount = cleanupAllStreams('API 清理请求')
    
    return NextResponse.json({
      success: true,
      message: `已清理 ${cleanedCount} 个活动流`,
      beforeCount,
      cleanedCount
    })
  } catch (error: any) {
    console.error('清理流失败:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}

// GET 方法用于查看当前活动流状态
export async function GET(request: NextRequest) {
  try {
    const count = getActiveStreamCount()
    const streams = getActiveStreamsInfo()
    
    return NextResponse.json({
      activeCount: count,
      streams
    })
  } catch (error: any) {
    console.error('获取流状态失败:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
