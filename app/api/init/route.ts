import { NextRequest, NextResponse } from 'next/server'
import { initializeApp } from '@/lib/init'
import scheduler from '@/lib/scheduler'
import { getMysqlConfigFromEnv, getMysqlConfigFromFile } from '@/lib/mysqlConfigFile'

// 初始化应用服务（包括启动调度器）
export async function POST(request: NextRequest) {
  try {
    // 初始化应用
    await initializeApp()
    
    return NextResponse.json({
      message: '应用初始化成功',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('应用初始化失败:', error)
    return NextResponse.json(
      { error: `应用初始化失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 获取初始化状态
export async function GET() {
  try {
    const hasMysqlConfig = Boolean(getMysqlConfigFromFile() || getMysqlConfigFromEnv())

    if (hasMysqlConfig) {
      await initializeApp()
    }

    return NextResponse.json({
      message: '应用已初始化',
      schedulerStarted: scheduler.getStatus().isRunning,
      mysqlConfigured: hasMysqlConfig,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('获取初始化状态失败:', error)
    return NextResponse.json(
      { error: `获取初始化状态失败: ${error.message}` },
      { status: 500 }
    )
  }
}
