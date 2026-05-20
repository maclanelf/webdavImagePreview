import { NextRequest, NextResponse } from 'next/server'
import { groupRatings } from '@/lib/groupRatingRepository'
import { queryMySqlOne } from '@/lib/database'
import { categories, customEvaluations } from '@/lib/ratingMetadataRepository'

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

function normalizeGroupPath(groupPath: string) {
  const trimmed = groupPath.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }

  return trimmed.replace(/\/+$/, '') || '/'
}

function getGroupNameFromPath(groupPath: string) {
  if (groupPath === '/') {
    return '根目录'
  }

  const parts = groupPath.split('/').filter(Boolean)
  return parts[parts.length - 1] || '根目录'
}

async function resolveGroupMetadata(groupPath: string) {
  const existing = await groupRatings.get(groupPath) as any
  if (existing) {
    return {
      groupName: existing.group_name || getGroupNameFromPath(groupPath),
      fileCount: existing.file_count ?? 0,
    }
  }

  const countRow = await queryMySqlOne<{ fileCount?: number }>(`
    SELECT COUNT(*) AS fileCount
    FROM scan_files
    WHERE parent_path = ?
  `, [groupPath])

  return {
    groupName: getGroupNameFromPath(groupPath),
    fileCount: countRow?.fileCount ?? 0,
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const groupPath = searchParams.get('groupPath')

    if (groupPath) {
      const normalizedGroupPath = normalizeGroupPath(groupPath)
      // 获取单个图组评分
      const groupName = getGroupNameFromPath(normalizedGroupPath)
      console.log(`🔍 [API GET] 获取图组评分: ${groupName}`)
      const rating = await groupRatings.get(normalizedGroupPath)
      console.log(`✅ [API GET] 图组评分获取完成: ${groupName}`)
      return NextResponse.json({ rating: parseRatingData(rating) })
    } else {
      // 获取所有图组评分
      console.log(`🔍 [API GET] 获取所有图组评分`)
      const ratings = await groupRatings.getAll()
      const parsedRatings = ratings.map(parseRatingData)
      console.log(`✅ [API GET] 所有图组评分获取完成，共 ${parsedRatings.length} 条`)
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
    const body = await request.json()
    const {
      groupPath,
      groupName,
      fileCount,
      rating,
      recommendationReason,
      customEvaluation,
      category,
      isViewed,
      creatorId
    } = body

    if (!groupPath) {
      console.log('❌ [API POST] 缺少图组路径')
      return NextResponse.json(
        { error: '缺少图组路径参数' },
        { status: 400 }
      )
    }

    const normalizedGroupPath = normalizeGroupPath(groupPath)
    const resolvedMetadata = (!groupName || fileCount === undefined)
      ? await resolveGroupMetadata(normalizedGroupPath)
      : null
    const resolvedGroupName = groupName || resolvedMetadata?.groupName || getGroupNameFromPath(normalizedGroupPath)
    const resolvedFileCount = fileCount ?? resolvedMetadata?.fileCount ?? 0

    console.log(`💾 [API POST] 保存图组评分: ${resolvedGroupName} (${rating}星, ${resolvedFileCount}个文件)`)

    const result = await groupRatings.save({
      groupPath: normalizedGroupPath,
      groupName: resolvedGroupName,
      fileCount: resolvedFileCount,
      rating,
      recommendationReason,
      customEvaluation,
      category,
      isViewed,
      creatorId
    })

    // 更新自定义评价标签的使用计数
    if (customEvaluation) {
      const evaluations = Array.isArray(customEvaluation) ? customEvaluation : [customEvaluation]
      for (const evaluation of evaluations) {
        if (typeof evaluation === 'string' && evaluation.trim()) {
          await customEvaluations.add(evaluation.trim())
        }
      }
    }

    // 更新分类的使用计数
    if (category) {
      const categoriesList = Array.isArray(category) ? category : [category]
      for (const cat of categoriesList) {
        if (typeof cat === 'string' && cat.trim()) {
          await categories.add(cat.trim())
        }
      }
    }

    console.log(`✅ [API POST] 图组评分保存成功: ${groupName} (ID: ${result.insertId})`)

    return NextResponse.json({ 
      success: true, 
      id: result.insertId,
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
    const { searchParams } = new URL(request.url)
    const groupPath = searchParams.get('groupPath')

    if (!groupPath) {
      return NextResponse.json(
        { error: '缺少图组路径参数' },
        { status: 400 }
      )
    }

    const result = await groupRatings.delete(normalizeGroupPath(groupPath))
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
