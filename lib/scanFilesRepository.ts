import {
  ensureMySqlInitialized,
  executeMySqlStatement,
  queryMySqlOne,
  queryMySqlRows,
} from './database'
import { UNKNOWN_CREATOR_ID } from './constants'

let scanFilesRandomKeySchemaReady = false
let scanFilesRandomKeySchemaPromise: Promise<void> | null = null

export function resetScanFilesRandomKeySchemaState() {
  scanFilesRandomKeySchemaReady = false
  scanFilesRandomKeySchemaPromise = null
}

function getParentPath(filename: string): string {
  const lastSlash = filename.lastIndexOf('/')
  return lastSlash > 0 ? filename.substring(0, lastSlash) : '/'
}

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.tiff', '.tif', '.svg', '.ico',
  '.heic', '.heif', '.avif', '.jxl',
  '.raw', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.rw2', '.pef', '.srw',
  '.psd', '.ai', '.eps', '.pcx', '.tga', '.exr', '.hdr',
])

function getFileType(basename: string): 'image' | 'video' {
  const ext = basename.substring(basename.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : 'video'
}

function normalizeAvatarPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || trimmed === '0' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return null
  }

  return trimmed
}

function parseCreatorOtherNames(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      return filtered.length > 0 ? filtered : undefined
    }

    if (typeof parsed === 'string' && parsed.trim()) {
      return [parsed.trim()]
    }
  } catch {
    return [trimmed]
  }

  return undefined
}

function buildCreatorSummaryFromJoinedRow(row: any) {
  const linkedCreatorId = row.creator_linked_id == null ? null : Number(row.creator_linked_id)
  if (!Number.isFinite(linkedCreatorId)) {
    return null
  }

  return {
    id: linkedCreatorId,
    primaryName: row.creator_primary_name,
    otherNames: parseCreatorOtherNames(row.creator_other_names),
    appearanceRating: row.creator_appearance_rating ?? null,
    bodyRating: row.creator_body_rating ?? null,
    bio: row.creator_bio ?? null,
    avatarPath: normalizeAvatarPath(row.creator_avatar_path),
  }
}

function attachCreatorInfoToScanFileRow(row: any) {
  const creatorId = row.creator_id == null ? null : Number(row.creator_id)
  const creator = buildCreatorSummaryFromJoinedRow(row)

  return {
    ...row,
    creator,
    creatorResolved: creatorId === UNKNOWN_CREATOR_ID || creator !== null,
  }
}

async function ensureScanFileCreators(batch: Array<{ filePath: string; parentPath: string }>) {
  if (batch.length === 0) {
    return { inserted: 0, parentPathUpdated: 0 }
  }

  const insertPlaceholders = batch.map(() => '(?, ?)').join(',')
  const insertValues: any[] = []
  batch.forEach((row) => {
    insertValues.push(row.filePath, row.parentPath)
  })

  const insertResult = await executeMySqlStatement(
    `INSERT IGNORE INTO scan_file_creators (file_path, parent_path) VALUES ${insertPlaceholders}`,
    insertValues,
  )

  const updateSelectSql = batch.map(() => 'SELECT ? AS file_path, ? AS parent_path').join(' UNION ALL ')
  const updateValues: any[] = []
  batch.forEach((row) => {
    updateValues.push(row.filePath, row.parentPath)
  })

  const updateResult = await executeMySqlStatement(
    `
      UPDATE scan_file_creators sfc
      INNER JOIN (
        ${updateSelectSql}
      ) incoming ON incoming.file_path = sfc.file_path
      SET sfc.parent_path = incoming.parent_path
      WHERE sfc.parent_path <> incoming.parent_path
    `,
    updateValues,
  )

  return {
    inserted: insertResult.affectedRows ?? 0,
    parentPathUpdated: updateResult.affectedRows ?? 0,
  }
}

function buildAdvancedFiltersClause(
  options: {
    ratings?: number[]
    evaluations?: string[]
    categories?: string[]
    reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
    reasonKeyword?: string
    ratingEmptyFilter?: boolean
    evaluationEmptyFilter?: boolean
    categoryEmptyFilter?: boolean
  },
  where: string[],
  params: any[],
) {
  const {
    ratings,
    evaluations,
    categories,
    reasonFilter,
    reasonKeyword,
    ratingEmptyFilter,
    evaluationEmptyFilter,
    categoryEmptyFilter,
  } = options

  if (ratings && ratings.length > 0) {
    const ratingPlaceholders = ratings.map(() => '?').join(',')
    if (ratingEmptyFilter === true) {
      where.push(`(mr.rating IN (${ratingPlaceholders}) OR mr.rating IS NULL)`)
      params.push(...ratings)
    } else if (ratingEmptyFilter === false) {
      where.push(`mr.rating IN (${ratingPlaceholders})`)
      params.push(...ratings)
    } else {
      where.push(`mr.rating IN (${ratingPlaceholders})`)
      params.push(...ratings)
    }
  } else if (ratingEmptyFilter === true) {
    where.push('mr.rating IS NULL')
  } else if (ratingEmptyFilter === false) {
    where.push('mr.rating IS NOT NULL')
  }

  if (evaluations && evaluations.length > 0) {
    const evalConditions = evaluations.map(() => '(mr.custom_evaluation LIKE ? OR mr.custom_evaluation = ?)').join(' OR ')
    if (evaluationEmptyFilter === true) {
      where.push(`((${evalConditions}) OR mr.custom_evaluation IS NULL OR mr.custom_evaluation = '')`)
    } else if (evaluationEmptyFilter === false) {
      where.push(`(${evalConditions})`)
    } else {
      where.push(`(${evalConditions})`)
    }
    evaluations.forEach((evaluation) => {
      params.push(`%"${evaluation}"%`)
      params.push(evaluation)
    })
  } else if (evaluationEmptyFilter === true) {
    where.push('(mr.custom_evaluation IS NULL OR mr.custom_evaluation = \'\')')
  } else if (evaluationEmptyFilter === false) {
    where.push('(mr.custom_evaluation IS NOT NULL AND mr.custom_evaluation <> \'\')')
  }

  if (categories && categories.length > 0) {
    const catConditions = categories.map(() => '(mr.category LIKE ? OR mr.category = ?)').join(' OR ')
    if (categoryEmptyFilter === true) {
      where.push(`((${catConditions}) OR mr.category IS NULL OR mr.category = '')`)
    } else if (categoryEmptyFilter === false) {
      where.push(`(${catConditions})`)
    } else {
      where.push(`(${catConditions})`)
    }
    categories.forEach((category) => {
      params.push(`%"${category}"%`)
      params.push(category)
    })
  } else if (categoryEmptyFilter === true) {
    where.push('(mr.category IS NULL OR mr.category = \'\')')
  } else if (categoryEmptyFilter === false) {
    where.push('(mr.category IS NOT NULL AND mr.category <> \'\')')
  }

  if (reasonFilter === 'empty') {
    where.push('(mr.recommendation_reason IS NULL OR mr.recommendation_reason = \'\')')
  } else if (reasonFilter === 'nonempty') {
    where.push('(mr.recommendation_reason IS NOT NULL AND mr.recommendation_reason <> \'\')')
  } else if (reasonFilter === 'keyword' && reasonKeyword) {
    where.push('mr.recommendation_reason LIKE ?')
    params.push(`%${reasonKeyword}%`)
  }
}

function sortFilesByBasename(rows: any[]) {
  return [...rows].sort((a, b) => String(a.basename).localeCompare(String(b.basename), undefined, { numeric: true, sensitivity: 'base' }))
}

const MAX_RANDOM_KEY = 0xffffffff

function createRandomSeekKey() {
  return Math.floor(Math.random() * (MAX_RANDOM_KEY + 1))
}

async function ensureScanFilesRandomKeySchema() {
  if (scanFilesRandomKeySchemaReady) {
    return
  }

  if (scanFilesRandomKeySchemaPromise) {
    await scanFilesRandomKeySchemaPromise
    return
  }

  scanFilesRandomKeySchemaPromise = (async () => {
    const randomKeyColumn = await queryMySqlOne<{ Field: string }>("SHOW COLUMNS FROM scan_files LIKE 'random_key'")
    const parentRandomKeyColumn = await queryMySqlOne<{ Field: string }>("SHOW COLUMNS FROM scan_files LIKE 'parent_random_key'")

    if (!randomKeyColumn) {
      await executeMySqlStatement(
        `
          ALTER TABLE scan_files
          ADD COLUMN random_key INT UNSIGNED GENERATED ALWAYS AS (CRC32(filename)) STORED AFTER parent_path
        `,
      )
    }

    if (!parentRandomKeyColumn) {
      await executeMySqlStatement(
        `
          ALTER TABLE scan_files
          ADD COLUMN parent_random_key INT UNSIGNED GENERATED ALWAYS AS (CRC32(parent_path)) STORED AFTER random_key
        `,
      )
    }

    const ensureIndex = async (indexName: string, sql: string) => {
      const existingIndex = await queryMySqlOne<{ Key_name: string }>(`SHOW INDEX FROM scan_files WHERE Key_name = ?`, [indexName])
      if (!existingIndex) {
        await executeMySqlStatement(sql)
      }
    }

    await ensureIndex('idx_scan_files_cache_random', 'ALTER TABLE scan_files ADD INDEX idx_scan_files_cache_random (cache_id, random_key)')
    await ensureIndex('idx_scan_files_cache_viewed_random', 'ALTER TABLE scan_files ADD INDEX idx_scan_files_cache_viewed_random (cache_id, is_viewed, random_key)')
    await ensureIndex('idx_scan_files_cache_type_random', 'ALTER TABLE scan_files ADD INDEX idx_scan_files_cache_type_random (cache_id, file_type, random_key)')
    await ensureIndex('idx_scan_files_cache_parent_random', 'ALTER TABLE scan_files ADD INDEX idx_scan_files_cache_parent_random (cache_id, parent_path, random_key)')
    await ensureIndex('idx_scan_files_cache_group_random', 'ALTER TABLE scan_files ADD INDEX idx_scan_files_cache_group_random (cache_id, parent_random_key, parent_path)')

    scanFilesRandomKeySchemaReady = true
  })()

  try {
    await scanFilesRandomKeySchemaPromise
  } finally {
    scanFilesRandomKeySchemaPromise = null
  }
}

export const scanFiles = {
  batchInsert: async (cacheId: number, files: Array<{
    filename: string
    basename: string
    size?: number
    type?: string
    lastmod?: string
  }>) => {
    await ensureMySqlInitialized()

    const batchSize = 500
    let inserted = 0

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      if (batch.length === 0) continue

      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(',')
      const values: any[] = []
      for (const file of batch) {
        values.push(
          cacheId,
          file.filename,
          file.basename,
          getParentPath(file.filename),
          file.size || 0,
          getFileType(file.basename),
          file.lastmod || null,
        )
      }

      await executeMySqlStatement(
        `
          INSERT INTO scan_files
          (cache_id, filename, basename, parent_path, file_size, file_type, lastmod)
          VALUES ${placeholders}
          ON DUPLICATE KEY UPDATE
            basename = VALUES(basename),
            parent_path = VALUES(parent_path),
            file_size = VALUES(file_size),
            file_type = VALUES(file_type),
            lastmod = VALUES(lastmod)
        `,
        values,
      )

      await ensureScanFileCreators(batch.map((file) => ({
        filePath: file.filename,
        parentPath: getParentPath(file.filename),
      })))

      inserted += batch.length
    }

    return { inserted }
  },

  getStats: async (cacheId: number) => {
    await ensureMySqlInitialized()
    const result = await queryMySqlOne<{ total: number; images: number; videos: number; viewed: number }>(
      `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) as images,
          SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) as videos,
          SUM(CASE WHEN is_viewed = 1 THEN 1 ELSE 0 END) as viewed
        FROM scan_files
        WHERE cache_id = ?
      `,
      [cacheId],
    )
    return {
      total: result?.total || 0,
      images: result?.images || 0,
      videos: result?.videos || 0,
      viewed: result?.viewed || 0,
    }
  },

  getStatsMultiple: async (cacheIds: number[]) => {
    await ensureMySqlInitialized()
    if (cacheIds.length === 0) {
      return { total: 0, images: 0, videos: 0, viewed: 0 }
    }

    const placeholders = cacheIds.map(() => '?').join(',')
    const result = await queryMySqlOne<{ total: number; images: number; videos: number; viewed: number }>(
      `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) as images,
          SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) as videos,
          SUM(CASE WHEN is_viewed = 1 THEN 1 ELSE 0 END) as viewed
        FROM scan_files
        WHERE cache_id IN (${placeholders})
      `,
      cacheIds,
    )

    return {
      total: result?.total || 0,
      images: result?.images || 0,
      videos: result?.videos || 0,
      viewed: result?.viewed || 0,
    }
  },

  deleteByCache: async (cacheId: number) => {
    await ensureMySqlInitialized()
    return executeMySqlStatement('DELETE FROM scan_files WHERE cache_id = ?', [cacheId])
  },

  hasData: async (cacheId: number) => {
    await ensureMySqlInitialized()
    const result = await queryMySqlOne<{ count: number }>('SELECT COUNT(*) as count FROM scan_files WHERE cache_id = ? LIMIT 1', [cacheId])
    return (result?.count || 0) > 0
  },

  hasDataMultiple: async (cacheIds: number[]) => {
    await ensureMySqlInitialized()
    if (cacheIds.length === 0) return false

    const placeholders = cacheIds.map(() => '?').join(',')
    const result = await queryMySqlOne<{ count: number }>(`SELECT COUNT(*) as count FROM scan_files WHERE cache_id IN (${placeholders}) LIMIT 1`, cacheIds)
    return (result?.count || 0) > 0
  },

  syncViewedFromRatings: async (cacheId: number) => {
    await ensureMySqlInitialized()
    const result = await executeMySqlStatement(
      `
        UPDATE scan_files sf
        INNER JOIN media_ratings mr ON mr.file_path = sf.filename
        SET sf.is_viewed = 1
        WHERE sf.cache_id = ?
          AND sf.is_viewed = 0
          AND mr.is_viewed = 1
      `,
      [cacheId],
    )

    return { synced: result.affectedRows ?? 0 }
  },

  migrateFromCache: async (cacheId: number) => {
    await ensureMySqlInitialized()
    const cache = await queryMySqlOne<any>('SELECT * FROM scan_cache WHERE id = ?', [cacheId])
    if (!cache || !cache.files_data) {
      return { success: false, message: '缓存数据不存在或为空' }
    }

    const files = JSON.parse(cache.files_data)
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, message: '文件数据为空' }
    }

    const beforeStats = await scanFiles.getStats(cacheId)
    await scanFiles.deleteByCache(cacheId)
    const result = await scanFiles.batchInsert(cacheId, files)
    const syncResult = await scanFiles.syncViewedFromRatings(cacheId)
    const afterStats = await scanFiles.getStats(cacheId)

    return {
      success: true,
      message: `迁移前: 文件数量 ${beforeStats.total}, 已看过 ${beforeStats.viewed} | 迁移后: 文件数量 ${afterStats.total}, 同步已看过 ${afterStats.viewed}`,
      count: result.inserted,
      syncedViewed: syncResult.synced,
      beforeStats: { total: beforeStats.total, viewed: beforeStats.viewed },
      afterStats: { total: afterStats.total, viewed: afterStats.viewed },
    }
  },

  migrateAllFromCache: async () => {
    await ensureMySqlInitialized()
    const caches = await queryMySqlRows<any[]>('SELECT id, path FROM scan_cache')
    const details = []
    for (const cache of caches) {
      details.push({
        cacheId: cache.id,
        path: cache.path,
        ...(await scanFiles.migrateFromCache(cache.id)),
      })
    }

    const totalMigrated = details.filter((item) => item.success).reduce((sum, item) => sum + (item.count || 0), 0)
    return {
      success: true,
      message: `迁移完成，共处理 ${caches.length} 个缓存，迁移 ${totalMigrated} 个文件`,
      details,
    }
  },

  getRandomGroupMultiple: async (cacheIds: number[], options?: {
    fileType?: 'image' | 'video'
    isViewed?: boolean
    excludeParentPath?: string
    maxFileSize?: number
    ratings?: number[]
    evaluations?: string[]
    categories?: string[]
    reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
    reasonKeyword?: string
    ratingEmptyFilter?: boolean
    evaluationEmptyFilter?: boolean
    categoryEmptyFilter?: boolean
  }) => {
    await ensureMySqlInitialized()
    await ensureScanFilesRandomKeySchema()
    if (cacheIds.length === 0) return { files: [], parentPath: null, totalGroups: 0 }

    const {
      fileType,
      isViewed,
      excludeParentPath,
      maxFileSize,
      ratings,
      evaluations,
      categories,
      reasonFilter,
      reasonKeyword,
      ratingEmptyFilter,
      evaluationEmptyFilter,
      categoryEmptyFilter,
    } = options || {}

    const needsRatingJoin = Boolean(
      ratings?.length || evaluations?.length || categories?.length
      || (reasonFilter && reasonFilter !== 'all')
      || ratingEmptyFilter !== undefined || evaluationEmptyFilter !== undefined || categoryEmptyFilter !== undefined,
    )

    const placeholders = cacheIds.map(() => '?').join(',')
    const where: string[] = [`sf.cache_id IN (${placeholders})`]
    const params: any[] = [...cacheIds]

    if (fileType) {
      where.push('sf.file_type = ?')
      params.push(fileType)
    }
    if (isViewed !== undefined) {
      where.push('sf.is_viewed = ?')
      params.push(isViewed ? 1 : 0)
    }
    if (excludeParentPath) {
      where.push('sf.parent_path <> ?')
      params.push(excludeParentPath)
    }
    if (maxFileSize !== undefined && maxFileSize > 0) {
      where.push('sf.file_size <= ?')
      params.push(maxFileSize)
    }
    if (needsRatingJoin) {
      buildAdvancedFiltersClause({
        ratings,
        evaluations,
        categories,
        reasonFilter,
        reasonKeyword,
        ratingEmptyFilter,
        evaluationEmptyFilter,
        categoryEmptyFilter,
      }, where, params)
    }

    const fromSql = needsRatingJoin
      ? 'FROM scan_files sf LEFT JOIN media_ratings mr ON sf.filename = mr.file_path'
      : 'FROM scan_files sf'
    const whereSql = where.join(' AND ')

    const totalGroupsRow = await queryMySqlOne<{ total: number }>(
      `
        SELECT COUNT(*) AS total
        FROM (
          SELECT sf.parent_path
          ${fromSql}
          WHERE ${whereSql}
          GROUP BY sf.parent_path
        ) grouped_paths
      `,
      params,
    )

    const totalGroups = totalGroupsRow?.total || 0
    if (totalGroups === 0) {
      return { files: [], parentPath: null, totalGroups: 0 }
    }

    const buildRandomGroupQuery = (seekKey: number, comparator: '>=' | '<') => ({
      sql: `
        SELECT
          sf.parent_path,
          MIN(sf.parent_random_key) AS parent_random_key
        ${fromSql}
        WHERE ${whereSql}
          AND sf.parent_random_key ${comparator} ?
        GROUP BY sf.parent_path
        ORDER BY parent_random_key ASC, sf.parent_path ASC
        LIMIT 1
      `,
      params: [...params, seekKey],
    })

    const groupSeekKey = createRandomSeekKey()
    const primaryGroupQuery = buildRandomGroupQuery(groupSeekKey, '>=')
    let randomGroup = await queryMySqlOne<{ parent_path: string }>(primaryGroupQuery.sql, primaryGroupQuery.params)

    if (!randomGroup?.parent_path) {
      const fallbackGroupQuery = buildRandomGroupQuery(groupSeekKey, '<')
      randomGroup = await queryMySqlOne<{ parent_path: string }>(fallbackGroupQuery.sql, fallbackGroupQuery.params)
    }

    if (!randomGroup?.parent_path) {
      return { files: [], parentPath: null, totalGroups: 0 }
    }

    const fileWhere = [...where, 'sf.parent_path = ?']
    const fileParams = [...params, randomGroup.parent_path]

    const fileRows = await queryMySqlRows<any[]>(
      `
        SELECT
          sf.*,
          sfc.creator_id AS creator_id,
          c.id AS creator_linked_id,
          c.primary_name AS creator_primary_name,
          c.other_names AS creator_other_names,
          c.appearance_rating AS creator_appearance_rating,
          c.body_rating AS creator_body_rating,
          c.bio AS creator_bio,
          c.avatar_path AS creator_avatar_path
        FROM scan_files sf
        LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
        LEFT JOIN creators c ON c.id = sfc.creator_id
        WHERE ${fileWhere.join(' AND ')}
        ORDER BY sf.basename ASC
      `,
      fileParams,
    )

    return {
      files: sortFilesByBasename(fileRows).map((row) => attachCreatorInfoToScanFileRow(row)),
      parentPath: randomGroup.parent_path,
      totalGroups,
    }
  },

  getRandomBatchMultiple: async (cacheIds: number[], count: number, options?: {
    fileType?: 'image' | 'video'
    isViewed?: boolean
    excludeFilenames?: string[]
    minFileSize?: number
    maxFileSize?: number
    currentParentPath?: string
    randomness?: number
    ratings?: number[]
    evaluations?: string[]
    categories?: string[]
    reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
    reasonKeyword?: string
    ratingEmptyFilter?: boolean
    evaluationEmptyFilter?: boolean
    categoryEmptyFilter?: boolean
  }) => {
    await ensureMySqlInitialized()
    await ensureScanFilesRandomKeySchema()
    if (cacheIds.length === 0) return []

    const {
      fileType,
      isViewed,
      excludeFilenames = [],
      minFileSize,
      maxFileSize,
      currentParentPath,
      randomness = 1,
      ratings,
      evaluations,
      categories,
      reasonFilter,
      reasonKeyword,
      ratingEmptyFilter,
      evaluationEmptyFilter,
      categoryEmptyFilter,
    } = options || {}

    const needsRatingJoin = Boolean(
      ratings?.length || evaluations?.length || categories?.length
      || (reasonFilter && reasonFilter !== 'all')
      || ratingEmptyFilter !== undefined || evaluationEmptyFilter !== undefined || categoryEmptyFilter !== undefined,
    )

    const excludeSet = new Set(excludeFilenames)

    const loadFilesByIds = async (ids: number[]) => {
      if (ids.length === 0) return []

      const placeholders = ids.map(() => '?').join(',')
      const rows = await queryMySqlRows<any[]>(
        `
          SELECT
            sf.*,
            sfc.creator_id AS creator_id,
            c.id AS creator_linked_id,
            c.primary_name AS creator_primary_name,
            c.other_names AS creator_other_names,
            c.appearance_rating AS creator_appearance_rating,
            c.body_rating AS creator_body_rating,
            c.bio AS creator_bio,
            c.avatar_path AS creator_avatar_path
          FROM scan_files sf
          LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
          LEFT JOIN creators c ON c.id = sfc.creator_id
          WHERE sf.id IN (${placeholders})
        `,
        ids,
      )

      const fileMap = new Map<number, any>()
      rows.forEach((row) => {
        fileMap.set(Number(row.id), attachCreatorInfoToScanFileRow(row))
      })

      return ids
        .map((id) => fileMap.get(id))
        .filter(Boolean)
    }

    const queryRandomFiles = async (requestedCount: number, includeParentPath?: string, excludeParentPath?: string) => {
      if (requestedCount <= 0) return []

      const fromSql = needsRatingJoin
        ? 'FROM scan_files sf LEFT JOIN media_ratings mr ON sf.filename = mr.file_path'
        : 'FROM scan_files sf'

      const buildCandidateQuery = (seekKey: number, comparator: '>=' | '<', limit: number) => {
        const placeholders = cacheIds.map(() => '?').join(',')
        const where: string[] = [`sf.cache_id IN (${placeholders})`]
        const params: any[] = [...cacheIds]

        if (includeParentPath) {
          where.push('sf.parent_path = ?')
          params.push(includeParentPath)
        }
        if (excludeParentPath) {
          where.push('sf.parent_path <> ?')
          params.push(excludeParentPath)
        }
        if (fileType) {
          where.push('sf.file_type = ?')
          params.push(fileType)
        }
        if (isViewed !== undefined) {
          where.push('sf.is_viewed = ?')
          params.push(isViewed ? 1 : 0)
        }
        if (minFileSize !== undefined && minFileSize > 0) {
          where.push('sf.file_size >= ?')
          params.push(minFileSize)
        }
        if (maxFileSize !== undefined && maxFileSize > 0) {
          where.push('sf.file_size <= ?')
          params.push(maxFileSize)
        }
        if (excludeSet.size > 0) {
          const excludePlaceholders = Array.from(excludeSet).map(() => '?').join(',')
          where.push(`sf.filename NOT IN (${excludePlaceholders})`)
          params.push(...Array.from(excludeSet))
        }
        if (needsRatingJoin) {
          buildAdvancedFiltersClause({
            ratings,
            evaluations,
            categories,
            reasonFilter,
            reasonKeyword,
            ratingEmptyFilter,
            evaluationEmptyFilter,
            categoryEmptyFilter,
          }, where, params)
        }

        where.push(`sf.random_key ${comparator} ?`)
        params.push(seekKey)

        return {
          sql: `
            SELECT sf.id, sf.filename
            ${fromSql}
            WHERE ${where.join(' AND ')}
            ORDER BY sf.random_key ASC, sf.id ASC
            LIMIT ${limit}
          `,
          params,
        }
      }

      const seekKey = createRandomSeekKey()
      const selectedIds: number[] = []
      const selectedIdSet = new Set<number>()

      const appendCandidateRows = (rows: Array<{ id: number; filename: string }>) => {
        rows.forEach((row) => {
          const numericId = Number(row.id)
          if (selectedIdSet.has(numericId)) {
            return
          }

          selectedIdSet.add(numericId)
          selectedIds.push(numericId)
          excludeSet.add(row.filename)
        })
      }

      const firstQuery = buildCandidateQuery(seekKey, '>=', requestedCount)
      appendCandidateRows(await queryMySqlRows<Array<{ id: number; filename: string }>>(firstQuery.sql, firstQuery.params))

      if (selectedIds.length < requestedCount) {
        const secondQuery = buildCandidateQuery(seekKey, '<', requestedCount - selectedIds.length)
        appendCandidateRows(await queryMySqlRows<Array<{ id: number; filename: string }>>(secondQuery.sql, secondQuery.params))
      }

      return loadFilesByIds(selectedIds.slice(0, requestedCount))
    }

    const results: any[] = []
    if (currentParentPath && randomness < 1) {
      const samePathCount = Math.round(count * (1 - randomness))
      if (samePathCount > 0) {
        results.push(...await queryRandomFiles(samePathCount, currentParentPath))
      }

      const remainingCount = count - results.length
      if (remainingCount > 0) {
        results.push(...await queryRandomFiles(remainingCount, undefined, currentParentPath))
      }

      return results.slice(0, count)
    }

    results.push(...await queryRandomFiles(count))
    return results.slice(0, count)
  },
}
