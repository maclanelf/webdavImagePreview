import { NextResponse } from 'next/server'
import scheduler from '@/lib/scheduler'

export async function POST() {
  try {
    console.log('初始化调度器...')
    
    // 只启动调度器，不启动WebSocket
    scheduler.start()
    
    console.log('调度器初始化完成')
    return NextResponse.json({
      success: true,
      message: '调度器初始化完成'
    })
  } catch (error: any) {
    console.error('调度器初始化失败:', error)
    return NextResponse.json(
      { error: `调度器初始化失败: ${error.message}` },
      { status: 500 }
    )
  }
}
