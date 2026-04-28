import { NextRequest, NextResponse } from 'next/server'

import db, { creators, ensureInitialized, webdavConfigs } from '@/lib/database'

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 50
const STREAM_VIDEO_THRESHOLD = 100 * 1024 * 1024

type CreatorDetailMode = 'bootstrap' | 'tab' | 'group-media'
type CreatorTab = 'viewed' | 'unviewed' | 'groups'
type MediaTypeFilter = 'all' | 'image' | 'video' | 'small-video' | 'large-video'

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

function buildDirectPath(filePath: string) {
  return `/d${filePath.split('/').map((segment) => segment.replace(/／/g, '|')).join('/')}`
}

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

function getGroupNameFromPath(groupPath: string | null | undefined) {
  if (!groupPath) return '根目录'
  const parts = groupPath.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : '根目录'
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parseRatings(value: string | null) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => parseInt(item, 10))
    .filter((item) => item >= 1 && item <= 5)
}

function parseTags(value: string | null) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseMediaType(value: string | null): MediaTypeFilter {
  if (value === 'image' || value === 'video' || value === 'small-video' || value === 'large-video') {
    return value
  }
  return 'all'
}

function buildMediaMatchWhere(creatorId: number, aliases: string[]) {
  if (aliases.length === 0) {
    return {
      where: '(sfc.creator_id = ?)',
      params: [creatorId] as any[],
    }
  }

  const aliasConditions = aliases.map(() => '(sf.parent_path LIKE ? OR sf.filename LIKE ?)').join(' OR ')
  const where = `(sfc.creator_id = ? OR ((sfc.file_path IS NULL OR sfc.creator_id IS NULL) AND (${aliasConditions})))`
  const params: any[] = [creatorId]
  aliases.forEach((alias) => {
    params.push(`%${alias}%`, `%${alias}%`)
  })
  return { where, params }
}

function buildGroupMatchWhere(creatorId: number, aliases: string[]) {
  if (aliases.length === 0) {
    return {
      where: `(
        EXISTS (
          SELECT 1
          FROM scan_file_creators sfc_group
          WHERE sfc_group.parent_path = sf.parent_path
            AND sfc_group.creator_id = ?
        )
      )`,
      params: [creatorId] as any[],
    }
  }

  const groupAliasConditions = aliases.map(() => '(sf.parent_path LIKE ?)').join(' OR ')
  const where = `(
    EXISTS (
      SELECT 1
      FROM scan_file_creators sfc_group
      WHERE sfc_group.parent_path = sf.parent_path
        AND sfc_group.creator_id = ?
    )
    OR (
      NOT EXISTS (
        SELECT 1
        FROM scan_file_creators sfc_group_linked
        WHERE sfc_group_linked.parent_path = sf.parent_path
          AND sfc_group_linked.creator_id IS NOT NULL
      )
      AND (${groupAliasConditions})
    )
  )`

  const params: any[] = [creatorId]
  aliases.forEach((alias) => {
    params.push(`%${alias}%`)
  })
  return { where, params }
}

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

function queryMediaPage(options: {
  creatorId: number
  aliases: string[]
  defaultConfig: any
  page: number
  pageSize: number
  viewed?: boolean
  mediaType?: MediaTypeFilter
  ratings?: number[]
  tags?: string[]
  groupPath?: string
}) {
  const {
    creatorId,
    aliases,
    defaultConfig,
    page,
    pageSize,
    viewed,
    mediaType = 'all',
    ratings = [],
    tags = [],
    groupPath,
  } = options

  const { where: baseWhere, params: baseParams } = buildMediaMatchWhere(creatorId, aliases)
  const whereParts = [baseWhere]
  const params = [...baseParams]

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
    FROM scan_files sf
    LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
    LEFT JOIN media_ratings mr ON mr.file_path = sf.filename
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
      COALESCE(sfc.creator_id, ?) AS creatorId
    FROM scan_files sf
    LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
    LEFT JOIN media_ratings mr ON mr.file_path = sf.filename
    WHERE ${whereSql}
    ORDER BY COALESCE(mr.rating, 0) DESC, sf.parent_path ASC, sf.basename COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `).all(creatorId, ...params, pageSize, offset) as Array<any>

  return {
    items: rows.map((row) => mapMediaRow(row, creatorId, defaultConfig)),
    total,
    page,
    pageSize,
    hasMore: offset + rows.length < total,
  }
}

function queryGroupMediaPage(options: {
  creatorId: number
  aliases: string[]
  defaultConfig: any
  groupPath: string
  page: number
  pageSize: number
}) {
  const { creatorId, aliases, defaultConfig, groupPath, page, pageSize } = options
  const { where: groupWhere, params: groupParams } = buildGroupMatchWhere(creatorId, aliases)
  const scopedWhere = `${groupWhere} AND sf.parent_path = ?`
  const scopedParams = [...groupParams, groupPath]

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM scan_files sf
    WHERE ${scopedWhere}
  `).get(...scopedParams) as { total: number }

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
    LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
    LEFT JOIN media_ratings mr ON mr.file_path = sf.filename
    WHERE ${scopedWhere}
    ORDER BY COALESCE(mr.rating, 0) DESC, sf.basename COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `).all(creatorId, ...scopedParams, pageSize, offset) as Array<any>

  return {
    items: rows.map((row) => mapMediaRow(row, creatorId, defaultConfig)),
    total,
    page,
    pageSize,
    hasMore: offset + rows.length < total,
  }
}

function queryGroupsPage(options: {
  creatorId: number
  aliases: string[]
  defaultConfig: any
  page: number
  pageSize: number
}) {
  const { creatorId, aliases, defaultConfig, page, pageSize } = options
  const { where: groupWhere, params: groupParams } = buildGroupMatchWhere(creatorId, aliases)

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM (
      SELECT sf.parent_path
      FROM scan_files sf
      WHERE ${groupWhere}
      GROUP BY sf.parent_path
      HAVING COUNT(*) > 0
    ) grouped
  `).get(...groupParams) as { total: number }

  const total = totalRow?.total || 0
  const offset = (page - 1) * pageSize

  const rows = db.prepare(`
    SELECT
      sf.parent_path AS groupPath,
      gr.group_name AS groupName,
      (
        SELECT COUNT(*)
        FROM scan_files sfi
        WHERE sfi.parent_path = sf.parent_path
      ) AS fileCount,
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
      ? AS creatorId
    FROM scan_files sf
    LEFT JOIN group_ratings gr ON gr.group_path = sf.parent_path
    WHERE ${groupWhere}
    GROUP BY sf.parent_path, gr.group_name, gr.is_viewed, gr.rating, gr.recommendation_reason, gr.custom_evaluation, gr.category
    HAVING COUNT(*) > 0
    ORDER BY COALESCE(gr.is_viewed, MIN(sf.is_viewed)) DESC, COALESCE(gr.rating, 0) DESC, sf.parent_path ASC
    LIMIT ? OFFSET ?
  `).all(creatorId, ...groupParams, pageSize, offset) as Array<any>

  const items = rows.map((row) => {
    const coverUrls = row.coverFilePath
      ? getPreviewUrls(row.coverFilePath, defaultConfig)
      : { previewUrl: null, streamUrl: null, transcodeUrl: null, directUrl: null }
    const previewSeed = row.coverFilePath
      ? queryMediaByFilePath(row.coverFilePath, creatorId, defaultConfig)
      : (queryMediaPage({
        creatorId,
        aliases,
        defaultConfig,
        groupPath: row.groupPath,
        page: 1,
        pageSize: 1,
      }).items[0] || null)

    return {
      id: row.groupPath,
      groupPath: row.groupPath,
      groupName: row.groupName || getGroupNameFromPath(row.groupPath),
      fileCount: row.fileCount,
      coverFilePath: row.coverFilePath || null,
      coverPreviewUrl: coverUrls.previewUrl,
      previewSeed,
      rating: row.rating ?? null,
      recommendationReason: row.recommendationReason ?? null,
      customEvaluation: parseJsonArray(row.customEvaluation),
      category: parseJsonArray(row.category),
      isViewed: row.isViewed === 1,
      creatorId: row.creatorId ?? creatorId,
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

function querySummaryAndTags(options: {
  creatorId: number
  aliases: string[]
}) {
  const { creatorId, aliases } = options
  const { where: mediaWhere, params: mediaParams } = buildMediaMatchWhere(creatorId, aliases)
  const { where: groupWhere, params: groupParams } = buildGroupMatchWhere(creatorId, aliases)

  const mediaSummary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(mr.is_viewed, sf.is_viewed, 0) = 1 THEN 1 ELSE 0 END) AS viewed,
      SUM(CASE WHEN COALESCE(mr.is_viewed, sf.is_viewed, 0) = 0 THEN 1 ELSE 0 END) AS unviewed
    FROM scan_files sf
    LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
    LEFT JOIN media_ratings mr ON mr.file_path = sf.filename
    WHERE ${mediaWhere}
  `).get(...mediaParams) as { total?: number; viewed?: number; unviewed?: number }

  const groupSummary = db.prepare(`
    SELECT COUNT(*) AS total
    FROM (
      SELECT sf.parent_path
      FROM scan_files sf
      WHERE ${groupWhere}
      GROUP BY sf.parent_path
      HAVING COUNT(*) > 0
    ) grouped
  `).get(...groupParams) as { total?: number }

  const mediaTagRows = db.prepare(`
    SELECT mr.custom_evaluation AS customEvaluation, mr.category AS category
    FROM scan_files sf
    LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
    INNER JOIN media_ratings mr ON mr.file_path = sf.filename
    WHERE ${mediaWhere}
      AND (mr.custom_evaluation IS NOT NULL OR mr.category IS NOT NULL)
  `).all(...mediaParams) as Array<{ customEvaluation?: string | null; category?: string | null }>

  const groupTagRows = db.prepare(`
    SELECT gr.custom_evaluation AS customEvaluation, gr.category AS category
    FROM (
      SELECT sf.parent_path
      FROM scan_files sf
      WHERE ${groupWhere}
      GROUP BY sf.parent_path
      HAVING COUNT(*) > 0
    ) matched_groups
    INNER JOIN group_ratings gr ON gr.group_path = matched_groups.parent_path
    WHERE gr.custom_evaluation IS NOT NULL OR gr.category IS NOT NULL
  `).all(...groupParams) as Array<{ customEvaluation?: string | null; category?: string | null }>

  const tagSet = new Set<string>()
  mediaTagRows.forEach((row) => {
    parseJsonArray(row.customEvaluation).forEach((tag) => tagSet.add(tag))
    parseJsonArray(row.category).forEach((tag) => tagSet.add(tag))
  })
  groupTagRows.forEach((row) => {
    parseJsonArray(row.customEvaluation).forEach((tag) => tagSet.add(tag))
    parseJsonArray(row.category).forEach((tag) => tagSet.add(tag))
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

    const aliases = [creator.primaryName, ...(creator.otherNames || [])]
      .map((alias) => String(alias).trim())
      .filter(Boolean)

    const searchParams = request.nextUrl.searchParams
    const mode = (searchParams.get('mode') || 'bootstrap') as CreatorDetailMode
    const page = parsePositiveInt(searchParams.get('page'), 1)
    const pageSize = Math.min(MAX_PAGE_SIZE, parsePositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE))
    const mediaType = parseMediaType(searchParams.get('mediaType'))
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
        aliases,
        defaultConfig,
        groupPath,
        page,
        pageSize,
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
          pagination: {
            page: pageResult.page,
            pageSize: pageResult.pageSize,
            total: pageResult.total,
            hasMore: pageResult.hasMore,
          },
        },
      })
    }

    if (mode === 'tab') {
      if (tab === 'groups') {
        const pageResult = queryGroupsPage({
          creatorId,
          aliases,
          defaultConfig,
          page,
          pageSize,
        })

        return NextResponse.json({
          success: true,
          data: {
            creator,
            tab,
            items: pageResult.items,
            pagination: {
              page: pageResult.page,
              pageSize: pageResult.pageSize,
              total: pageResult.total,
              hasMore: pageResult.hasMore,
            },
          },
        })
      }

      const pageResult = queryMediaPage({
        creatorId,
        aliases,
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
          pagination: {
            page: pageResult.page,
            pageSize: pageResult.pageSize,
            total: pageResult.total,
            hasMore: pageResult.hasMore,
          },
        },
      })
    }

    const { summary, availableTags } = querySummaryAndTags({ creatorId, aliases })
    const viewedFirstPage = queryMediaPage({
      creatorId,
      aliases,
      defaultConfig,
      page: 1,
      pageSize,
      viewed: true,
      mediaType: 'all',
      ratings: [],
      tags: [],
    })

    return NextResponse.json({
      success: true,
      data: {
        creator,
        summary,
        filters: {
          availableTags,
        },
        initialViewed: {
          items: viewedFirstPage.items,
          pagination: {
            page: viewedFirstPage.page,
            pageSize: viewedFirstPage.pageSize,
            total: viewedFirstPage.total,
            hasMore: viewedFirstPage.hasMore,
          },
        },
      },
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '获取博主媒体失败' }, { status: 500 })
  }
}
