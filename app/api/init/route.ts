import { NextRequest, NextResponse } from 'next/server'
import { initializeApp } from '@/lib/init'

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
    // 这里可以返回调度器状态等信息
    return NextResponse.json({
      message: '应用已初始化',
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
