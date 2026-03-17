import { NextRequest, NextResponse } from 'next/server'
import { creators } from '@/lib/database'

// POST /api/creators/preview-batch-link - 预览批量关联影响范围
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { namePattern } = body
    
    if (!namePattern) {
      return NextResponse.json(
        { success: false, error: '名称模式不能为空' },
        { status: 400 }
      )
    }
    
    const preview = creators.previewBatchLink(namePattern)
    
    return NextResponse.json({ 
      success: true, 
      data: preview
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
