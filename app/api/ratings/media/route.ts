import { NextRequest, NextResponse } from 'next/server'
import { mediaRatings, customEvaluations, categories, ensureInitialized } from '@/lib/database'

// 辅助函数：解析JSON字段
function parseRatingData(rating: any) {
  if (!rating) return null
  
  return {
    ...rating,
    recommendationReason: rating.recommendation_reason,
    customEvaluation: rating.custom_evaluation 
      ? tryParseJSON(rating.custom_evaluation)
      : undefined,
    category: rating.category
      ? tryParseJSON(rating.category)
      : undefined,
    isViewed: rating.is_viewed === 1 // 将数据库的布尔值转换为JavaScript布尔值
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
      const fileName = filePath.split('/').pop() || filePath
      console.log(`🔍 [API GET] 获取媒体评分: ${fileName}`)
      const rating = mediaRatings.get(filePath)
      console.log(`✅ [API GET] 评分获取完成: ${fileName}`)
      return NextResponse.json({ rating: parseRatingData(rating) })
    } else {
      // 获取所有媒体评分
      console.log(`🔍 [API GET] 获取所有媒体评分`)
      const ratings = mediaRatings.getAll()
      const parsedRatings = ratings.map(parseRatingData)
      console.log(`✅ [API GET] 所有评分获取完成，共 ${parsedRatings.length} 条`)
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

    console.log(`💾 [API POST] 保存媒体评分: ${fileName} (${rating}星)`)

    if (!filePath || !fileName || !fileType) {
      console.log(`❌ [API POST] 缺少必要参数: ${fileName}`)
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

    // 更新自定义评价标签的使用计数
    if (customEvaluation) {
      const evaluations = Array.isArray(customEvaluation) ? customEvaluation : [customEvaluation]
      evaluations.forEach(evaluation => {
        if (typeof evaluation === 'string' && evaluation.trim()) {
          customEvaluations.add(evaluation.trim())
        }
      })
    }

    // 更新分类的使用计数
    if (category) {
      const categoriesList = Array.isArray(category) ? category : [category]
      categoriesList.forEach(cat => {
        if (typeof cat === 'string' && cat.trim()) {
          categories.add(cat.trim())
        }
      })
    }

    console.log(`✅ [API POST] 评分保存成功: ${fileName} (ID: ${result.lastInsertRowid})`)

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
