import { NextRequest, NextResponse } from 'next/server'
import { mediaRatings, ensureInitialized } from '@/lib/database'

// 辅助函数：解析JSON字段
function parseRatingData(rating: any) {
  if (!rating) return null
  
  return {
    ...rating,
    custom_evaluation: rating.custom_evaluation 
      ? tryParseJSON(rating.custom_evaluation)
      : undefined,
    category: rating.category
      ? tryParseJSON(rating.category)
      : undefined
  }
}

function tryParseJSON(value: string) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : value
  } catch {
    return value
  }
}

export async function GET(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const { searchParams } = new URL(request.url)
    const filePath = searchParams.get('filePath')

    if (filePath) {
      // 获取单个媒体评分
      const rating = mediaRatings.get(filePath)
      return NextResponse.json({ rating: parseRatingData(rating) })
    } else {
      // 获取所有媒体评分
      const ratings = mediaRatings.getAll()
      const parsedRatings = ratings.map(parseRatingData)
      return NextResponse.json({ ratings: parsedRatings })
    }
  } catch (error: any) {
    console.error('获取媒体评分失败:', error)
    return NextResponse.json(
      { error: `获取评分失败: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const body = await request.json()
    const {
      filePath,
      fileName,
      fileType,
      rating,
      recommendationReason,
      customEvaluation,
      category,
      isViewed
    } = body

    if (!filePath || !fileName || !fileType) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      )
    }

    const result = mediaRatings.save({
      filePath,
      fileName,
      fileType,
      rating,
      recommendationReason,
      customEvaluation,
      category,
      isViewed
    })

    return NextResponse.json({ 
      success: true, 
      id: result.lastInsertRowid,
      changes: result.changes 
    })
  } catch (error: any) {
    console.error('保存媒体评分失败:', error)
    return NextResponse.json(
      { error: `保存评分失败: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const { searchParams } = new URL(request.url)
    const filePath = searchParams.get('filePath')

    if (!filePath) {
      return NextResponse.json(
        { error: '缺少文件路径参数' },
        { status: 400 }
      )
    }

    const result = mediaRatings.delete(filePath)
    return NextResponse.json({ 
      success: true, 
      changes: result.changes 
    })
  } catch (error: any) {
    console.error('删除媒体评分失败:', error)
    return NextResponse.json(
      { error: `删除评分失败: ${error.message}` },
      { status: 500 }
    )
  }
}
