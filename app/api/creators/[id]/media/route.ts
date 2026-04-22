import { NextRequest, NextResponse } from 'next/server'

import db, { creators, ensureInitialized, webdavConfigs } from '@/lib/database'

/**
 * 解析 JSON 数组字符串
 * 处理数据库中存储的 JSON 格式数组
 * 
 * @param value - JSON 字符串或 null/undefined
 * @returns 字符串数组
 */
function parseJsonArray(value: string | null | undefined) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string')
    }
    if (typeof parsed === 'string') {
      return [parsed]
    }
  } catch {
    if (typeof value === 'string' && value.trim()) {
      return [value]
    }
  }
  return []
}

/**
 * 构建直链路径
 * 将文件路径转换为直链访问路径
 * 
 * @param filePath - 原始文件路径
 * @returns 直链路径
 */
function buildDirectPath(filePath: string) {
  return `/d${filePath.split('/').map((segment) => segment.replace(/／/g, '|')).join('/')}`
}

/**
 * 获取媒体文件的各种预览 URL
 * 
 * @param filePath - 文件路径
 * @param defaultConfig - WebDAV 默认配置
 * @returns 包含各种 URL 的对象
 */
function getPreviewUrls(filePath: string, defaultConfig: any) {
  if (!defaultConfig) {
    return { previewUrl: null, streamUrl: null, transcodeUrl: null, directUrl: null }
  }

  const sourceType = defaultConfig.sourceType || 'clouddrive2'
  const commonParams = {
    url: defaultConfig.url,
    username: defaultConfig.username,
    password: defaultConfig.password,
    filepath: filePath,
    sourceType,
  }

  // 预览图 URL（通过代理）
  const previewUrl = `/api/webdav/stream-proxy?${new URLSearchParams(commonParams).toString().replace(/\+/g, '%20')}`
  // 流媒体 URL（WebDAV）
  const streamUrl = `/api/webdav/instant-stream?${new URLSearchParams({ ...commonParams, forceWebDAV: 'true' }).toString().replace(/\+/g, '%20')}`
  // 转码 URL
  const transcodeUrl = `/api/webdav/transcode-stream?${new URLSearchParams({ ...commonParams, format: 'mp4', quality: 'high' }).toString().replace(/\+/g, '%20')}`
  // 直链 URL
  const directUrl = defaultConfig.enableDirectLink ? buildDirectPath(filePath) : null

  return { previewUrl, streamUrl, transcodeUrl, directUrl }
}

/**
 * 从路径中提取图组名称
 * 
 * @param groupPath - 图组路径
 * @returns 图组名称
 */
function getGroupNameFromPath(groupPath: string | null | undefined) {
  if (!groupPath) return '根目录'
  const parts = groupPath.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : '根目录'
}

/**
 * GET /api/creators/[id]/media
 * 
 * 获取指定博主的媒体和图组列表
 * 
 * 功能：
 * - 根据博主 ID 查询关联的媒体文件
 * - 支持按文件类型、评分、标签、查看状态筛选
 * - 返回媒体列表、图组列表和可用标签
 * - 自动生成预览 URL、流媒体 URL 等
 * 
 * 查询参数：
 * - fileType: 文件类型（image/video）
 * - ratings: 评分筛选（逗号分隔，1-5）
 * - tags: 标签筛选（逗号分隔）
 * - viewed: 查看状态（true/false）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureInitialized()
    const { id: idStr } = await params
    const creatorId = parseInt(idStr, 10)

    if (!Number.isInteger(creatorId)) {
      return NextResponse.json({ success: false, error: '无效的博主 ID' }, { status: 400 })
    }

    // 查询博主信息
    const creator = creators.get(creatorId)
    if (!creator) {
      return NextResponse.json({ success: false, error: '博主不存在' }, { status: 404 })
    }

    // 获取博主的所有别名（用于模糊匹配）
    const aliases = [creator.primaryName, ...(creator.otherNames || [])].filter(Boolean)
    
    // 解析查询参数
    const searchParams = request.nextUrl.searchParams
    const fileTypeParam = searchParams.get('fileType')
    const ratings = (searchParams.get('ratings') || '')
      .split(',')
      .map((value) => parseInt(value, 10))
      .filter((value) => value >= 1 && value <= 5)
    const tags = (searchParams.get('tags') || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
    const viewedParam = searchParams.get('viewed')
    const viewedFilter = viewedParam === 'true' ? 1 : viewedParam === 'false' ? 0 : null
    const fileType = fileTypeParam === 'image' || fileTypeParam === 'video' ? fileTypeParam : null
    const defaultConfig = webdavConfigs.getDefault()

    // 构建媒体查询条件
    const aliasConditions = aliases.map(() => '(sf.parent_path LIKE ? OR sf.filename LIKE ?)').join(' OR ')
    const mediaWhere = [`(mr.creator_id = ? OR (${aliasConditions}))`]
    const mediaParams: any[] = [creatorId]
    aliases.forEach((alias) => {
      mediaParams.push(`%${alias}%`, `%${alias}%`)
    })

    // 添加查看状态筛选
    if (viewedFilter !== null) {
      mediaWhere.push('COALESCE(mr.is_viewed, sf.is_viewed, 0) = ?')
      mediaParams.push(viewedFilter)
    }

    // 添加文件类型筛选
    if (fileType) {
      mediaWhere.push('sf.file_type = ?')
      mediaParams.push(fileType)
    }

    // 添加评分筛选
    if (ratings.length > 0) {
      mediaWhere.push(`mr.rating IN (${ratings.map(() => '?').join(',')})`)
      mediaParams.push(...ratings)
    }

    // 添加标签筛选
    if (tags.length > 0) {
      const tagConditions = tags.map(() => '(mr.custom_evaluation LIKE ? OR mr.category LIKE ?)').join(' OR ')
      mediaWhere.push(`(${tagConditions})`)
      tags.forEach((tag) => {
        mediaParams.push(`%"${tag}"%`, `%"${tag}"%`)
      })
    }

    // 查询媒体文件
    const mediaRows = db.prepare(`
      SELECT
        sf.filename AS filePath,
        sf.basename AS fileName,
        sf.file_type AS fileType,
        sf.parent_path AS groupPath,
        sf.lastmod,
        sf.file_size AS fileSize,
        mr.rating,
        mr.recommendation_reason AS recommendationReason,
        mr.custom_evaluation AS customEvaluation,
        mr.category,
        COALESCE(mr.is_viewed, sf.is_viewed, 0) AS isViewed,
        COALESCE(mr.creator_id, ?) AS creatorId
      FROM scan_files sf
      LEFT JOIN media_ratings mr ON mr.file_path = sf.filename
      WHERE ${mediaWhere.join(' AND ')}
      ORDER BY COALESCE(mr.is_viewed, sf.is_viewed, 0) DESC, COALESCE(mr.rating, 0) DESC, sf.parent_path ASC, sf.basename COLLATE NOCASE ASC
    `).all(creatorId, ...mediaParams) as Array<any>

    // 转换媒体数据格式并生成 URL
    const media = mediaRows.map((row) => {
      const filePath = row.filePath as string
      const { previewUrl, streamUrl, transcodeUrl, directUrl } = getPreviewUrls(filePath, defaultConfig)
      return {
        id: filePath,
        filePath,
        fileName: row.fileName,
        basename: row.fileName,
        fileType: row.fileType,
        // 根据文件大小判断媒体类型
        mediaType: row.fileType === 'image' ? 'image' : (row.fileSize && row.fileSize > 100 * 1024 * 1024 ? 'stream-video' : 'small-video'),
        previewUrl,
        streamUrl,
        transcodeUrl,
        directUrl,
        groupPath: row.groupPath || null,
        groupName: row.groupPath ? getGroupNameFromPath(row.groupPath) : null,
        lastmod: row.lastmod || null,
        fileSize: row.fileSize ?? null,
        rating: row.rating ?? null,
        recommendationReason: row.recommendationReason ?? null,
        customEvaluation: parseJsonArray(row.customEvaluation),
        category: parseJsonArray(row.category),
        isViewed: row.isViewed === 1,
        creatorId: row.creatorId ?? creatorId,
      }
    })

    // 构建图组查询条件
    // 图组目录必须由目录路径本身命中博主别名来确定，
    // 不能因为某一个文件名命中，就把整个目录提升为图组。
    // 否则会出现“目录里只有一个命中文件，却占用了整个图组目录”的问题。
    const groupAliasConditions = aliases.map(() => '(sf.parent_path LIKE ?)').join(' OR ')
    const groupWhere = [`(gr.creator_id = ? OR (${groupAliasConditions}))`]
    const groupParams: any[] = [creatorId]
    aliases.forEach((alias) => {
      groupParams.push(`%${alias}%`)
    })

    // 查询图组
    const groups = db.prepare(`
      SELECT
        sf.parent_path AS groupPath,
        gr.group_name AS groupName,
        COUNT(*) AS fileCount,
        (
          SELECT sfi.filename
          FROM scan_files sfi
          WHERE sfi.parent_path = sf.parent_path
            AND sfi.file_type = 'image'
          ORDER BY RANDOM()
          LIMIT 1
        ) AS coverFilePath,
        COALESCE(gr.is_viewed, MIN(sf.is_viewed)) AS isViewed,
        gr.rating,
        gr.recommendation_reason AS recommendationReason,
        gr.custom_evaluation AS customEvaluation,
        gr.category,
        COALESCE(gr.creator_id, ?) AS creatorId
      FROM scan_files sf
      LEFT JOIN group_ratings gr ON gr.group_path = sf.parent_path
      WHERE ${groupWhere.join(' AND ')}
      GROUP BY sf.parent_path, gr.group_name, gr.is_viewed, gr.rating, gr.recommendation_reason, gr.custom_evaluation, gr.category, gr.creator_id
      HAVING COUNT(*) > 0
      ORDER BY COALESCE(gr.is_viewed, MIN(sf.is_viewed)) DESC, COALESCE(gr.rating, 0) DESC, sf.parent_path ASC
    `).all(creatorId, ...groupParams).map((row: any) => {
      const coverUrls = row.coverFilePath
        ? getPreviewUrls(row.coverFilePath, defaultConfig)
        : { previewUrl: null, streamUrl: null, transcodeUrl: null, directUrl: null }

      return {
        id: row.groupPath,
        groupPath: row.groupPath,
        groupName: row.groupName || getGroupNameFromPath(row.groupPath),
        fileCount: row.fileCount,
        coverFilePath: row.coverFilePath || null,
        coverPreviewUrl: coverUrls.previewUrl,
        rating: row.rating ?? null,
        recommendationReason: row.recommendationReason ?? null,
        customEvaluation: parseJsonArray(row.customEvaluation),
        category: parseJsonArray(row.category),
        isViewed: row.isViewed === 1,
        creatorId: row.creatorId ?? creatorId,
      }
    })

    // 收集所有可用标签
    const tagsSet = new Set<string>()
    media.forEach((item) => {
      item.customEvaluation.forEach((tag: string) => tagsSet.add(tag))
      item.category.forEach((tag: string) => tagsSet.add(tag))
    })
    groups.forEach((item) => {
      item.customEvaluation.forEach((tag: string) => tagsSet.add(tag))
      item.category.forEach((tag: string) => tagsSet.add(tag))
    })

    return NextResponse.json({
      success: true,
      data: {
        creator,
        media,
        groups,
        filters: {
          availableTags: Array.from(tagsSet).sort((a, b) => a.localeCompare(b, 'zh-CN')),
        },
      },
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '获取博主媒体失败' }, { status: 500 })
  }
}
