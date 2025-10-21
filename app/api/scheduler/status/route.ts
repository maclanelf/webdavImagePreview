import { NextResponse } from 'next/server'
import scheduler from '@/lib/scheduler'

// 获取调度器状态
export async function GET() {
  try {
    const status = scheduler.getStatus()
    
    return NextResponse.json({
      message: '调度器状态',
      status,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: `获取调度器状态失败: ${error.message}` },
      { status: 500 }
    )
  }
}
