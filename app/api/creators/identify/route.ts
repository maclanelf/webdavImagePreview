import { NextRequest, NextResponse } from 'next/server'
import { creators, scanFileCreators } from '@/lib/creatorRepository'
import { UNKNOWN_CREATOR_ID } from '@/lib/constants'

/**
 * POST /api/creators/identify
 * 根据文件路径识别博主
 * 优先从 scan_file_creators 表读取当前文件的博主关联，缺失时回退路径匹配
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
    
    const fileCreator = await scanFileCreators.get(filePath) as any
    if (fileCreator) {
      if (fileCreator.creator_id === UNKNOWN_CREATOR_ID) {
        return NextResponse.json({ success: true, identified: false, creator: null })
      }

      if (fileCreator.creator_id) {
        const creator = await creators.get(fileCreator.creator_id)
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
    }

    const fallbackCreator = await creators.findCreatorByPath(filePath)
    if (fallbackCreator) {
      return NextResponse.json({
        success: true,
        identified: true,
        creator: {
          id: fallbackCreator.id,
          primaryName: fallbackCreator.primaryName,
          appearanceRating: fallbackCreator.appearanceRating,
          bodyRating: fallbackCreator.bodyRating,
          otherNames: fallbackCreator.otherNames,
          bio: fallbackCreator.bio
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
