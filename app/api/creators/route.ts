import { NextRequest, NextResponse } from 'next/server'
import { creators } from '@/lib/database'

// GET /api/creators - 获取所有博主
export async function GET() {
  try {
    const allCreators = creators.getAll()
    return NextResponse.json({ success: true, data: allCreators })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

// POST /api/creators - 创建或更新博主
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, primaryName, otherNames, appearanceRating, bodyRating, bio, avatarPath } = body
    
    if (!primaryName) {
      return NextResponse.json(
        { success: false, error: '主名称不能为空' },
        { status: 400 }
      )
    }
    
    const result = creators.save({
      id,
      primaryName,
      otherNames: otherNames || [],
      appearanceRating,
      bodyRating,
      bio,
      avatarPath
    })
    
    // 获取保存后的完整博主信息
    const creatorId = id || (result as any).existingId || result.lastInsertRowid
    const creator = creators.get(creatorId as number)
    
    return NextResponse.json({ 
      success: true, 
      message: id ? '博主更新成功' : '博主创建成功',
      creator: creator
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
