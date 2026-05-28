import { NextRequest, NextResponse } from 'next/server'
import { cleanupDatabase } from '@/lib/database'
import { serverRandomPoolManager } from '@/lib/serverRandomPoolManager'
import {
  cleanupAllStreams,
  getActiveStreamCount,
  getActiveStreamsInfo
} from '@/lib/streamManager'

/**
 * 统一清理 API
 * 
 * POST /api/cleanup - 清理所有服务端资源
 * GET /api/cleanup - 获取当前资源状态
 * 
 * 清理内容：
 * 1. 视频流资源（streamManager）
 * 2. 博主别名缓存（database）
 * 3. WebDAV 客户端缓存
 * 4. 数据库连接（可选，仅在服务器退出时）
 */

// POST /api/cleanup - 清理服务端资源
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const randomPoolSessionId = typeof body?.randomPoolSessionId === 'string' ? body.randomPoolSessionId.trim() : ''

    console.log('🧹 [统一清理] 收到清理请求，开始清理服务端资源...')
    
    // 1. 获取清理前的状态
    const beforeStreamCount = getActiveStreamCount()
    const streamsInfo = getActiveStreamsInfo()
    
    console.log(`📊 [统一清理] 清理前状态:`)
    console.log(`  - 活动流: ${beforeStreamCount} 个`)
    
    if (streamsInfo.length > 0) {
      console.log('📋 [统一清理] 活动流详情:')
      streamsInfo.forEach(info => {
        console.log(`  - ${info.requestId}: ${info.filepath} (${info.duration}秒)`)
      })
    }
    
    // 2. 清理视频流
    const cleanedStreamCount = cleanupAllStreams('浏览器关闭清理')
    console.log(`✅ [统一清理] 已清理 ${cleanedStreamCount} 个视频流`)

    const randomPoolBeforeCount = randomPoolSessionId
      ? serverRandomPoolManager.getStatus(randomPoolSessionId).cacheSize
      : 0

    if (randomPoolSessionId) {
      serverRandomPoolManager.clearSession(randomPoolSessionId, 'cleanup-api')
      console.log(`✅ [统一清理] 已清理当前会话服务端随机缓存池 ${randomPoolBeforeCount} 项`)
    } else {
      console.log('ℹ️ [统一清理] 未提供 randomPoolSessionId，跳过服务端随机缓存池定向清理')
    }
    
    // 3. 清理数据库缓存和其他资源
    // 注意：不关闭数据库连接，因为服务器还在运行
    cleanupDatabase(false) // false = 只清理缓存，不关闭数据库
    
    return NextResponse.json({
      success: true,
      message: '服务端资源清理完成',
      cleaned: {
        streams: cleanedStreamCount,
        randomPoolItems: randomPoolBeforeCount,
        beforeStreamCount,
        afterStreamCount: getActiveStreamCount()
      }
    })
  } catch (error) {
    console.error('❌ [统一清理] 清理失败:', error)
    return NextResponse.json({
      success: false,
      message: '清理失败',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}

// GET /api/cleanup - 获取当前资源状态
export async function GET() {
  try {
    const streamCount = getActiveStreamCount()
    const streams = getActiveStreamsInfo()
    
    return NextResponse.json({
      success: true,
      resources: {
        activeStreams: streamCount,
        randomPool: {
          ...serverRandomPoolManager.getStatus(),
          sessionCount: serverRandomPoolManager.getSessionCount(),
        },
        streams: streams.map(s => ({
          requestId: s.requestId,
          filepath: s.filepath,
          duration: s.duration,
          idleTime: s.idleTime
        }))
      }
    })
  } catch (error) {
    console.error('❌ [统一清理] 获取状态失败:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
