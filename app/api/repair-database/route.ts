import { NextRequest, NextResponse } from 'next/server'
import { repairDatabase } from '@/lib/repairDatabase'

export async function POST(request: NextRequest) {
  try {
    console.log('开始修复数据库...')
    
    // 执行数据库修复
    repairDatabase()
    
    return NextResponse.json({
      success: true,
      message: '数据库修复完成'
    })
  } catch (error: any) {
    console.error('数据库修复失败:', error)
    return NextResponse.json(
      { 
        success: false,
        error: `数据库修复失败: ${error.message}` 
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    message: '数据库修复API',
    usage: 'POST /api/repair-database 来修复数据库'
  })
}
