import { NextRequest, NextResponse } from 'next/server'
import { creators } from '@/lib/database'

// POST /api/creators/batch-link - 批量关联文件到博主
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { creatorId, namePattern } = body
    
    if (!creatorId || !namePattern) {
      return NextResponse.json(
        { success: false, error: '博主ID和名称模式不能为空' },
        { status: 400 }
      )
    }
    
    const result = creators.batchLinkFilesByName(creatorId, namePattern)
    
    return NextResponse.json({ 
      success: true, 
      message: `批量关联完成，共更新 ${result.totalUpdated} 条记录`,
      data: result
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
