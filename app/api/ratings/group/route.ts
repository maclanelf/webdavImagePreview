import { NextRequest, NextResponse } from 'next/server'
import { groupRatings, ensureInitialized } from '@/lib/database'

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
    const groupPath = searchParams.get('groupPath')

    if (groupPath) {
      // 获取单个图组评分
      const rating = groupRatings.get(groupPath)
      return NextResponse.json({ rating: parseRatingData(rating) })
    } else {
      // 获取所有图组评分
      const ratings = groupRatings.getAll()
      const parsedRatings = ratings.map(parseRatingData)
      return NextResponse.json({ ratings: parsedRatings })
    }
  } catch (error: any) {
    console.error('获取图组评分失败:', error)
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
      groupPath,
      groupName,
      fileCount,
      rating,
      recommendationReason,
      customEvaluation,
      category,
      isViewed
    } = body

    if (!groupPath || !groupName || fileCount === undefined) {
      return NextResponse.json(
        { error: '缺少必要参数' },
        { status: 400 }
      )
    }

    const result = groupRatings.save({
      groupPath,
      groupName,
      fileCount,
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
    console.error('保存图组评分失败:', error)
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
    const groupPath = searchParams.get('groupPath')

    if (!groupPath) {
      return NextResponse.json(
        { error: '缺少图组路径参数' },
        { status: 400 }
      )
    }

    const result = groupRatings.delete(groupPath)
    return NextResponse.json({ 
      success: true, 
      changes: result.changes 
    })
  } catch (error: any) {
    console.error('删除图组评分失败:', error)
    return NextResponse.json(
      { error: `删除评分失败: ${error.message}` },
      { status: 500 }
    )
  }
}
