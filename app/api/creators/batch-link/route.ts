import { NextRequest, NextResponse } from 'next/server'
import { creators } from '@/lib/creatorRepository'

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
      message: `批量关联完成，关联 ${result.filesUpdated} 个文件，涉及 ${result.groupsAffected} 个图组`,
      data: result
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
