import { NextRequest, NextResponse } from 'next/server'
import { creators, mediaRatings } from '@/lib/database'
import { UNKNOWN_CREATOR_ID } from '@/lib/constants'

/**
 * POST /api/creators/identify
 * 根据文件路径识别博主
 * 优先查 media_ratings.creator_id，找不到再用路径名匹配
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const body = rawBody.trim() ? JSON.parse(rawBody) : {}
    const { filePath } = body
    
    if (!filePath) {
      return NextResponse.json({
        success: false,
        error: '缺少文件路径'
      }, { status: 400 })
    }
    
    // 1. 优先从 media_ratings 表查 creator_id
    const rating = mediaRatings.get(filePath) as any
    if (rating) {
      // creator_id = UNKNOWN_CREATOR_ID：用户标记"不认识"，阻止路径匹配
      if (rating.creator_id === UNKNOWN_CREATOR_ID) {
        return NextResponse.json({ success: true, identified: false, creator: null })
      }
      // creator_id 有效：返回博主信息
      if (rating.creator_id) {
        const creator = creators.get(rating.creator_id)
        if (creator) {
          return NextResponse.json({
            success: true,
            identified: true,
            creator: {
              id: creator.id,
              primaryName: creator.primaryName,
              appearanceRating: creator.appearanceRating,
              bodyRating: creator.bodyRating,
              otherNames: creator.otherNames,
              bio: creator.bio
            }
          })
        }
      }
      // creator_id 为 null：没有手动关联，走路径匹配
    }
    
    // 2. 记录不存在时才走路径名匹配（新文件，从未评分过）
    const creator = creators.findCreatorByPath(filePath)
    
    if (creator) {
      return NextResponse.json({
        success: true,
        identified: true,
        creator: {
          id: creator.id,
          primaryName: creator.primaryName,
          appearanceRating: creator.appearanceRating,
          bodyRating: creator.bodyRating,
          otherNames: creator.otherNames,
          bio: creator.bio
        }
      })
    }
    
    return NextResponse.json({
      success: true,
      identified: false,
      creator: null
    })
  } catch (error) {
    console.error('识别博主失败:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '识别失败'
    }, { status: 500 })
  }
}
