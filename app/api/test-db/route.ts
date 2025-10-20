import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/database'

export async function GET() {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    
    return NextResponse.json({ 
      success: true, 
      message: '数据库连接正常',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('数据库测试失败:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}
