import { NextRequest, NextResponse } from 'next/server'
import db, { groupRatings, customEvaluations, categories, ensureInitialized, performCheckpoint } from '@/lib/database'
import { UNKNOWN_CREATOR_ID } from '@/lib/constants'

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

function resolveGroupMetadata(groupPath: string) {
  const existing = groupRatings.get(groupPath) as any
  if (existing) {
    return {
      groupName: existing.group_name || getGroupNameFromPath(groupPath),
      fileCount: existing.file_count ?? 0,
    }
  }

  const countRow = db.prepare(`
    SELECT COUNT(*) AS fileCount
    FROM scan_files
    WHERE parent_path = ?
  `).get(groupPath) as { fileCount?: number } | undefined

  return {
    groupName: getGroupNameFromPath(groupPath),
    fileCount: countRow?.fileCount ?? 0,
  }
}

export async function GET(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const { searchParams } = new URL(request.url)
    const groupPath = searchParams.get('groupPath')

    if (groupPath) {
      const normalizedGroupPath = normalizeGroupPath(groupPath)
      // 获取单个图组评分
      const groupName = getGroupNameFromPath(normalizedGroupPath)
      console.log(`🔍 [API GET] 获取图组评分: ${groupName}`)
      const rating = groupRatings.get(normalizedGroupPath)
      console.log(`✅ [API GET] 图组评分获取完成: ${groupName}`)
      return NextResponse.json({ rating: parseRatingData(rating) })
    } else {
      // 获取所有图组评分
      console.log(`🔍 [API GET] 获取所有图组评分`)
      const ratings = groupRatings.getAll()
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
      ? resolveGroupMetadata(normalizedGroupPath)
      : null
    const resolvedGroupName = groupName || resolvedMetadata?.groupName || getGroupNameFromPath(normalizedGroupPath)
    const resolvedFileCount = fileCount ?? resolvedMetadata?.fileCount ?? 0

    console.log(`💾 [API POST] 保存图组评分: ${resolvedGroupName} (${rating}星, ${resolvedFileCount}个文件)`)

    const result = groupRatings.save({
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
    
    // 如果是标记"不认识"（creatorId = UNKNOWN_CREATOR_ID），立即执行 checkpoint 确保数据写入磁盘
    if (creatorId === UNKNOWN_CREATOR_ID) {
      const checkpointStartTime = Date.now()
      performCheckpoint('PASSIVE')
      console.log(`⏱️ [ratings/group POST] checkpoint完成: ${Date.now() - checkpointStartTime}ms`)
    }

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

    console.log(`✅ [API POST] 图组评分保存成功: ${groupName} (ID: ${result.lastInsertRowid})`)

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

    const result = groupRatings.delete(normalizeGroupPath(groupPath))
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
