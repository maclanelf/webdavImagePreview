import { NextRequest, NextResponse } from 'next/server'

import db, { creators, ensureInitialized, webdavConfigs } from '@/lib/database'
import { QUICK_RATING_CONFIG } from '@/types'

/** 默认分页大小 */
const DEFAULT_PAGE_SIZE = 10
/** 单次请求允许的最大分页大小 */
const MAX_PAGE_SIZE = 50
/** 大视频阈值：超过该大小的视频归类为大视频 */
const STREAM_VIDEO_THRESHOLD = 100 * 1024 * 1024

/** 详情接口模式 */
type CreatorDetailMode = 'bootstrap' | 'tab' | 'group-media'
/** 标签页类型 */
type CreatorTab = 'viewed' | 'unviewed' | 'groups'
/** 媒体类型过滤器 */
type MediaTypeFilter = 'all' | 'image' | 'video' | 'small-video' | 'large-video'
/** 图组已看状态过滤器 */
type GroupViewedFilter = 'all' | 'viewed' | 'unviewed'

type PaginationPayload = {
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

type QueryPageResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

/**
 * 将数据库中的 JSON / 文本字段稳健地转换为字符串数组。
 *
 * 兼容两类历史数据：
 * - `['a', 'b']` 这类 JSON 数组
 * - `a` 这种单字符串老数据
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

/** 将文件路径转换为直链路径。 */
function buildDirectPath(filePath: string) {
  return `/d${filePath.split('/').map((segment) => segment.replace(/／/g, '|')).join('/')}`
}

/**
 * 为媒体条目生成预览 / 流播放 / 转码 / 直链地址。
 *
 * 这里不发起网络请求，只是把前端后续会用到的 URL 预先拼好。
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

  const previewUrl = `/api/webdav/stream-proxy?${new URLSearchParams(commonParams).toString().replace(/\+/g, '%20')}`
  const streamUrl = `/api/webdav/instant-stream?${new URLSearchParams({ ...commonParams, forceWebDAV: 'true' }).toString().replace(/\+/g, '%20')}`
  const transcodeUrl = `/api/webdav/transcode-stream?${new URLSearchParams({ ...commonParams, format: 'mp4', quality: 'high' }).toString().replace(/\+/g, '%20')}`
  const directUrl = defaultConfig.enableDirectLink ? buildDirectPath(filePath) : null

  return { previewUrl, streamUrl, transcodeUrl, directUrl }
}

/** 从目录路径中提取图组名。 */
function getGroupNameFromPath(groupPath: string | null | undefined) {
  if (!groupPath) return '根目录'
  const parts = groupPath.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : '根目录'
}

/** 解析正整数参数。 */
function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** 解析评分过滤参数，例如 `1,3,5`。 */
function parseRatings(value: string | null) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => parseInt(item, 10))
    .filter((item) => item >= 1 && item <= 5)
}

/** 解析标签过滤参数，例如 `性感,黑丝`。 */
function parseTags(value: string | null) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 解析媒体类型过滤参数。 */
function parseMediaType(value: string | null): MediaTypeFilter {
  if (value === 'image' || value === 'video' || value === 'small-video' || value === 'large-video') {
    return value
  }
  return 'all'
}

/** 解析图组已看状态过滤参数。 */
function parseGroupViewedFilter(value: string | null): GroupViewedFilter {
  if (value === 'viewed' || value === 'unviewed') {
    return value
  }
  return 'all'
}

/**
 * 构造“当前博主关联图组目录”的子查询。
 *
 * 统一复用这一段，可以避免在多个 SQL 里重复写相同逻辑。
 * 同时也让这条接口完全基于 [`scan_file_creators.creator_id`](lib/database.ts:642)
 * 做精确匹配，不再回退到旧的路径模糊匹配方案。
 */
function buildCreatorGroupPathsSubquery() {
  return `
    SELECT parent_path
    FROM scan_file_creators
    WHERE creator_id = ?
      AND parent_path IS NOT NULL
    GROUP BY parent_path
  `
}

/** 统一构造分页响应。 */
function buildPaginationPayload(result: { page: number; pageSize: number; total: number; hasMore: boolean }): PaginationPayload {
  return {
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    hasMore: result.hasMore,
  }
}

/** 快速评分内置中文标签，这些标签不应出现在“可用标签”筛选中。 */
const QUICK_RATING_EVALUATIONS = new Set<string>(
  QUICK_RATING_CONFIG.map((item) => item.evaluation)
)

/**
 * 仅保留真正用于内容筛选的标签，排除快速评分自带的中文语义标签。
 */
function collectFilterTags(tagSet: Set<string>, values: string[]) {
  values.forEach((tag) => {
    if (!QUICK_RATING_EVALUATIONS.has(tag)) {
      tagSet.add(tag)
    }
  })
}

/**
 * 为媒体分页查询追加媒体类型过滤条件。
 *
 * 说明：
 * - `video` 表示所有视频；
 * - `small-video` / `large-video` 通过文件大小做二次区分。
 */
function appendMediaTypeCondition(whereParts: string[], params: any[], mediaType: MediaTypeFilter) {
  if (mediaType === 'all') return

  if (mediaType === 'image') {
    whereParts.push('sf.file_type = ?')
    params.push('image')
    return
  }

  if (mediaType === 'video') {
    whereParts.push('sf.file_type = ?')
    params.push('video')
    return
  }

  if (mediaType === 'small-video') {
    whereParts.push('sf.file_type = ?')
    whereParts.push('COALESCE(sf.file_size, 0) <= ?')
    params.push('video', STREAM_VIDEO_THRESHOLD)
    return
  }

  if (mediaType === 'large-video') {
    whereParts.push('sf.file_type = ?')
    whereParts.push('COALESCE(sf.file_size, 0) > ?')
    params.push('video', STREAM_VIDEO_THRESHOLD)
  }
}

/**
 * 将 SQL 行映射为前端使用的媒体卡片结构。
 */
function mapMediaRow(row: any, creatorId: number, defaultConfig: any) {
  const filePath = row.filePath as string
  const { previewUrl, streamUrl, transcodeUrl, directUrl } = getPreviewUrls(filePath, defaultConfig)

  return {
    id: filePath,
    filePath,
    fileName: row.fileName,
    basename: row.fileName,
    fileType: row.fileType,
    mediaType: row.fileType === 'image'
      ? 'image'
      : (row.fileSize && row.fileSize > STREAM_VIDEO_THRESHOLD ? 'stream-video' : 'small-video'),
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
}

/**
 * 根据文件路径查询单个媒体。
 *
 * 目前仅用于图组分页里构造 `previewSeed`：
 * 当封面图存在时，把它补全成前端可直接预览的媒体对象。
 */
function queryMediaByFilePath(filePath: string, creatorId: number, defaultConfig: any) {
  const row = db.prepare(`
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
      COALESCE(sfc.creator_id, ?) AS creatorId
    FROM scan_files sf
    LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
    LEFT JOIN media_ratings mr ON mr.file_path = sf.filename
    WHERE sf.filename = ?
    LIMIT 1
  `).get(creatorId, filePath) as any

  return row ? mapMediaRow(row, creatorId, defaultConfig) : null
}

/**
 * 查询博主媒体分页。
 *
 * 查询策略：
 * - 从 [`scan_file_creators`](lib/database.ts:637) 出发，用 `creator_id` 精确锁定博主；
 * - 再关联 [`scan_files`](lib/database.ts:610) 和 [`media_ratings`](lib/database.ts:358)；
 * - 避免从 `scan_files` 全表出发造成无效扫描。
 */
function queryMediaPage(options: {
  creatorId: number
  defaultConfig: any
  page: number
  pageSize: number
  viewed?: boolean
  mediaType?: MediaTypeFilter
  ratings?: number[]
  tags?: string[]
  groupPath?: string
}): QueryPageResult<any> {
  const {
    creatorId,
    defaultConfig,
    page,
    pageSize,
    viewed,
    mediaType = 'all',
    ratings = [],
    tags = [],
    groupPath,
  } = options

  const whereParts = ['sfc.creator_id = ?']
  const params = [creatorId] as any[]

  if (typeof viewed === 'boolean') {
    whereParts.push('COALESCE(mr.is_viewed, sf.is_viewed, 0) = ?')
    params.push(viewed ? 1 : 0)
  }

  appendMediaTypeCondition(whereParts, params, mediaType)

  if (ratings.length > 0) {
    whereParts.push(`mr.rating IN (${ratings.map(() => '?').join(',')})`)
    params.push(...ratings)
  }

  if (tags.length > 0) {
    tags.forEach((tag) => {
      whereParts.push('(mr.custom_evaluation LIKE ? OR mr.category LIKE ?)')
      params.push(`%"${tag}"%`, `%"${tag}"%`)
    })
  }

  if (groupPath) {
    whereParts.push('sf.parent_path = ?')
    params.push(groupPath)
  }

  const whereSql = whereParts.join(' AND ')

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM scan_file_creators sfc
    INNER JOIN scan_files sf ON sf.filename = sfc.file_path
    LEFT JOIN media_ratings mr ON mr.file_path = sfc.file_path
    WHERE ${whereSql}
  `).get(...params) as { total: number }

  const total = countRow?.total || 0
  const offset = (page - 1) * pageSize

  const rows = db.prepare(`
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
      sfc.creator_id AS creatorId
    FROM scan_file_creators sfc
    INNER JOIN scan_files sf ON sf.filename = sfc.file_path
    LEFT JOIN media_ratings mr ON mr.file_path = sfc.file_path
    WHERE ${whereSql}
    ORDER BY COALESCE(mr.rating, 0) DESC, sf.parent_path ASC, sf.basename COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as Array<any>

  return {
    items: rows.map((row) => mapMediaRow(row, creatorId, defaultConfig)),
    total,
    page,
    pageSize,
    hasMore: offset + rows.length < total,
  }
}

/**
 * 查询某个图组内的媒体分页。
 */
function queryGroupMediaPage(options: {
  creatorId: number
  defaultConfig: any
  groupPath: string
  page: number
  pageSize: number
  viewed?: boolean
}): QueryPageResult<any> {
  const { creatorId, defaultConfig, groupPath, page, pageSize, viewed } = options
  const creatorGroupPathsSubquery = buildCreatorGroupPathsSubquery()
  const whereParts = ['sf.parent_path = ?']
  const params = [groupPath] as any[]

  if (typeof viewed === 'boolean') {
    whereParts.push('COALESCE(mr.is_viewed, sf.is_viewed, 0) = ?')
    params.push(viewed ? 1 : 0)
  }

  const whereSql = whereParts.join(' AND ')

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM scan_files sf
    INNER JOIN (
      ${creatorGroupPathsSubquery}
    ) creator_groups ON creator_groups.parent_path = sf.parent_path
    LEFT JOIN media_ratings mr ON mr.file_path = sf.filename
    WHERE ${whereSql}
  `).get(creatorId, ...params) as { total: number }

  const total = countRow?.total || 0
  const offset = (page - 1) * pageSize

  const rows = db.prepare(`
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
      COALESCE(sfc.creator_id, ?) AS creatorId
    FROM scan_files sf
    INNER JOIN (
      ${creatorGroupPathsSubquery}
    ) creator_groups ON creator_groups.parent_path = sf.parent_path
    LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
    LEFT JOIN media_ratings mr ON mr.file_path = sf.filename
    WHERE ${whereSql}
    ORDER BY COALESCE(mr.rating, 0) DESC, sf.basename COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `).all(creatorId, creatorId, ...params, pageSize, offset) as Array<any>

  return {
    items: rows.map((row) => mapMediaRow(row, creatorId, defaultConfig)),
    total,
    page,
    pageSize,
    hasMore: offset + rows.length < total,
  }
}

/**
 * 查询图组分页。
 *
 * 返回内容除了图组基础信息，还会补出：
 * - `coverPreviewUrl`: 图组封面预览
 * - `previewSeed`: 图组预览时的初始媒体
 */
function queryGroupsPage(options: {
  creatorId: number
  defaultConfig: any
  page: number
  pageSize: number
  viewedFilter?: GroupViewedFilter
  ratings?: number[]
  tags?: string[]
}): QueryPageResult<any> {
  const {
    creatorId,
    defaultConfig,
    page,
    pageSize,
    viewedFilter = 'all',
    ratings = [],
    tags = [],
  } = options
  const creatorGroupPathsSubquery = buildCreatorGroupPathsSubquery()

  const groupBaseSql = `
    SELECT
      cg.parent_path AS groupPath,
      gr.group_name AS groupName,
      (
        SELECT COUNT(*)
        FROM scan_files sfi
        WHERE sfi.parent_path = cg.parent_path
      ) AS fileCount,
      (
        SELECT COUNT(*)
        FROM scan_files sfi
        LEFT JOIN media_ratings mri ON mri.file_path = sfi.filename
        WHERE sfi.parent_path = cg.parent_path
          AND COALESCE(mri.is_viewed, sfi.is_viewed, 0) = 1
      ) AS viewedFileCount,
      (
        SELECT COUNT(*)
        FROM scan_files sfi
        LEFT JOIN media_ratings mri ON mri.file_path = sfi.filename
        WHERE sfi.parent_path = cg.parent_path
          AND COALESCE(mri.is_viewed, sfi.is_viewed, 0) = 0
      ) AS unviewedFileCount,
      (
        SELECT sfi.filename
        FROM scan_files sfi
        WHERE sfi.parent_path = cg.parent_path
          AND sfi.file_type = 'image'
        ORDER BY RANDOM()
        LIMIT 1
      ) AS coverFilePath,
      COALESCE(gr.is_viewed, (
        SELECT MIN(COALESCE(mri.is_viewed, sfi.is_viewed, 0))
        FROM scan_files sfi
        LEFT JOIN media_ratings mri ON mri.file_path = sfi.filename
        WHERE sfi.parent_path = cg.parent_path
      )) AS isViewed,
      gr.rating,
      gr.recommendation_reason AS recommendationReason,
      gr.custom_evaluation AS customEvaluation,
      gr.category
    FROM (
      ${creatorGroupPathsSubquery}
    ) cg
    LEFT JOIN group_ratings gr ON gr.group_path = cg.parent_path
  `

  const whereParts: string[] = []
  const params: any[] = []

  if (viewedFilter === 'viewed') {
    whereParts.push('group_rows.viewedFileCount > 0')
  }

  if (viewedFilter === 'unviewed') {
    whereParts.push('group_rows.unviewedFileCount > 0')
  }

  if (ratings.length > 0) {
    whereParts.push(`group_rows.rating IN (${ratings.map(() => '?').join(',')})`)
    params.push(...ratings)
  }

  if (tags.length > 0) {
    tags.forEach((tag) => {
      whereParts.push('(group_rows.customEvaluation LIKE ? OR group_rows.category LIKE ?)')
      params.push(`%"${tag}"%`, `%"${tag}"%`)
    })
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM (
      ${groupBaseSql}
    ) group_rows
    ${whereSql}
  `).get(creatorId, ...params) as { total: number }

  const total = totalRow?.total || 0
  const offset = (page - 1) * pageSize

  const rows = db.prepare(`
    SELECT *
    FROM (
      ${groupBaseSql}
    ) group_rows
    ${whereSql}
    ORDER BY COALESCE(group_rows.isViewed, 0) DESC, COALESCE(group_rows.rating, 0) DESC, group_rows.groupPath ASC
    LIMIT ? OFFSET ?
  `).all(creatorId, ...params, pageSize, offset) as Array<any>

  const items = rows.map((row) => {
    const coverUrls = row.coverFilePath
      ? getPreviewUrls(row.coverFilePath, defaultConfig)
      : { previewUrl: null, streamUrl: null, transcodeUrl: null, directUrl: null }

    const previewSeed = viewedFilter === 'all' && row.coverFilePath
      ? queryMediaByFilePath(row.coverFilePath, creatorId, defaultConfig)
      : (queryMediaPage({
        creatorId,
        defaultConfig,
        groupPath: row.groupPath,
        viewed: viewedFilter === 'all' ? undefined : viewedFilter === 'viewed',
        page: 1,
        pageSize: 1,
      }).items[0] || null)

    return {
      id: row.groupPath,
      groupPath: row.groupPath,
      groupName: row.groupName || getGroupNameFromPath(row.groupPath),
      fileCount: row.fileCount,
      viewedFileCount: row.viewedFileCount ?? 0,
      unviewedFileCount: row.unviewedFileCount ?? 0,
      coverFilePath: row.coverFilePath || null,
      coverPreviewUrl: coverUrls.previewUrl,
      previewSeed,
      rating: row.rating ?? null,
      recommendationReason: row.recommendationReason ?? null,
      customEvaluation: parseJsonArray(row.customEvaluation),
      category: parseJsonArray(row.category),
      isViewed: row.isViewed === 1,
      creatorId,
    }
  })

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: offset + items.length < total,
  }
}

/**
 * 查询首屏轻量信息：
 * - 媒体总数 / 已看 / 未看
 * - 图组总数
 * - 已使用标签集合
 */
function querySummaryAndTags(options: {
  creatorId: number
}) {
  const { creatorId } = options
  const creatorGroupPathsSubquery = buildCreatorGroupPathsSubquery()

  const mediaSummary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(mr.is_viewed, sf.is_viewed, 0) = 1 THEN 1 ELSE 0 END) AS viewed,
      SUM(CASE WHEN COALESCE(mr.is_viewed, sf.is_viewed, 0) = 0 THEN 1 ELSE 0 END) AS unviewed
    FROM scan_file_creators sfc
    INNER JOIN scan_files sf ON sf.filename = sfc.file_path
    LEFT JOIN media_ratings mr ON mr.file_path = sfc.file_path
    WHERE sfc.creator_id = ?
  `).get(creatorId) as { total?: number; viewed?: number; unviewed?: number }

  const groupSummary = db.prepare(`
    SELECT COUNT(*) AS total
    FROM (
      ${creatorGroupPathsSubquery}
    ) grouped
  `).get(creatorId) as { total?: number }

  const mediaTagRows = db.prepare(`
    SELECT mr.custom_evaluation AS customEvaluation, mr.category AS category
    FROM scan_file_creators sfc
    INNER JOIN media_ratings mr ON mr.file_path = sfc.file_path
    WHERE sfc.creator_id = ?
      AND (mr.custom_evaluation IS NOT NULL OR mr.category IS NOT NULL)
  `).all(creatorId) as Array<{ customEvaluation?: string | null; category?: string | null }>

  const groupTagRows = db.prepare(`
    SELECT gr.custom_evaluation AS customEvaluation, gr.category AS category
    FROM (
      ${creatorGroupPathsSubquery}
    ) creator_groups
    INNER JOIN group_ratings gr ON gr.group_path = creator_groups.parent_path
    WHERE gr.custom_evaluation IS NOT NULL OR gr.category IS NOT NULL
  `).all(creatorId) as Array<{ customEvaluation?: string | null; category?: string | null }>

  const tagSet = new Set<string>()
  mediaTagRows.forEach((row) => {
    collectFilterTags(tagSet, parseJsonArray(row.customEvaluation))
    collectFilterTags(tagSet, parseJsonArray(row.category))
  })
  groupTagRows.forEach((row) => {
    collectFilterTags(tagSet, parseJsonArray(row.customEvaluation))
    collectFilterTags(tagSet, parseJsonArray(row.category))
  })

  return {
    summary: {
      mediaTotal: mediaSummary?.total || 0,
      viewedTotal: mediaSummary?.viewed || 0,
      unviewedTotal: mediaSummary?.unviewed || 0,
      groupTotal: groupSummary?.total || 0,
    },
    availableTags: Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'zh-CN')),
  }
}

/**
 * 博主详情媒体接口。
 *
 * 支持三种模式：
 * - `bootstrap`: 首屏轻量信息（博主、统计、标签）
 * - `tab`: 标签页分页（viewed / unviewed / groups）
 * - `group-media`: 图组内媒体分页
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

    const creator = creators.get(creatorId)
    if (!creator) {
      return NextResponse.json({ success: false, error: '博主不存在' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const mode = (searchParams.get('mode') || 'bootstrap') as CreatorDetailMode
    const page = parsePositiveInt(searchParams.get('page'), 1)
    const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE))
    const mediaType = parseMediaType(searchParams.get('mediaType'))
    const groupViewedFilter = parseGroupViewedFilter(searchParams.get('viewed'))
    const ratings = parseRatings(searchParams.get('ratings'))
    const tags = parseTags(searchParams.get('tags'))
    const tab = (searchParams.get('tab') || 'viewed') as CreatorTab
    const groupPath = searchParams.get('groupPath') || undefined

    const defaultConfig = webdavConfigs.getDefault()

    if (mode === 'group-media') {
      if (!groupPath) {
        return NextResponse.json({ success: false, error: '缺少 groupPath 参数' }, { status: 400 })
      }

      const pageResult = queryGroupMediaPage({
        creatorId,
        defaultConfig,
        groupPath,
        page,
        pageSize,
        viewed: groupViewedFilter === 'all' ? undefined : groupViewedFilter === 'viewed',
      })

      if (pageResult.total === 0) {
        return NextResponse.json({ success: false, error: '图组不存在或不属于当前博主' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        data: {
          creator,
          groupPath,
          items: pageResult.items,
          pagination: buildPaginationPayload(pageResult),
        },
      })
    }

    if (mode === 'tab') {
      if (tab === 'groups') {
        const pageResult = queryGroupsPage({
          creatorId,
          defaultConfig,
          page,
          pageSize,
          viewedFilter: groupViewedFilter,
          ratings,
          tags,
        })

        return NextResponse.json({
          success: true,
          data: {
            creator,
            tab,
            items: pageResult.items,
            pagination: buildPaginationPayload(pageResult),
          },
        })
      }

      const pageResult = queryMediaPage({
        creatorId,
        defaultConfig,
        page,
        pageSize,
        viewed: tab === 'viewed',
        mediaType,
        ratings,
        tags,
      })

      return NextResponse.json({
        success: true,
        data: {
          creator,
          tab,
          items: pageResult.items,
          pagination: buildPaginationPayload(pageResult),
        },
      })
    }

    const { summary, availableTags } = querySummaryAndTags({ creatorId })

    return NextResponse.json({
      success: true,
      data: {
        creator,
        summary,
        filters: {
          availableTags,
        },
      },
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '获取博主媒体失败' }, { status: 500 })
  }
}
