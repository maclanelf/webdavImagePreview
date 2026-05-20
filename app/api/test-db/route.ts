import { NextResponse } from 'next/server'

import { ensureMySqlInitialized, testMySqlConnection } from '@/lib/database'

export async function GET() {
  try {
    await ensureMySqlInitialized()
    await testMySqlConnection()

    return NextResponse.json({ 
      success: true, 
      message: 'MySQL 连接正常',
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
