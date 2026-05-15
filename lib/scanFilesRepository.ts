import db from './databaseCore'
import { ensureInitialized } from './databaseInitialization'
import { UNKNOWN_CREATOR_ID } from './constants'

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
  if (IMAGE_EXTENSIONS.has(ext)) {
    return 'image'
  }
  return 'video'
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
  const linkedCreatorId = row.creator_linked_id
  if (typeof linkedCreatorId !== 'number') {
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
  const creatorId = typeof row.creator_id === 'number' ? row.creator_id : null
  const creator = buildCreatorSummaryFromJoinedRow(row)

  return {
    ...row,
    creator,
    creatorResolved: creatorId === UNKNOWN_CREATOR_ID || creator !== null,
  }
}

function ensureScanFileCreators(batch: Array<{ filePath: string; parentPath: string }>) {
  if (batch.length === 0) {
    return { inserted: 0, parentPathUpdated: 0 }
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO scan_file_creators (file_path, parent_path, creator_id)
    VALUES (?, ?, NULL)
  `)

  const updateParentPathStmt = db.prepare(`
    UPDATE scan_file_creators
    SET parent_path = ?,
        updated_at = datetime('now', 'localtime')
    WHERE file_path = ?
      AND parent_path != ?
  `)

  const insertMany = db.transaction((rows: Array<{ filePath: string; parentPath: string }>) => {
    let inserted = 0
    let parentPathUpdated = 0

    for (const row of rows) {
      const insertResult = insertStmt.run(row.filePath, row.parentPath)
      inserted += insertResult.changes

      const updateResult = updateParentPathStmt.run(row.parentPath, row.filePath, row.parentPath)
      parentPathUpdated += updateResult.changes
    }

    return { inserted, parentPathUpdated }
  })

  return insertMany(batch)
}

export const scanFiles = {
  batchInsert: (cacheId: number, files: Array<{
    filename: string
    basename: string
    size?: number
    type?: string
    lastmod?: string
  }>) => {
    ensureInitialized()

    const insert = db.prepare(`
      INSERT OR REPLACE INTO scan_files
      (cache_id, filename, basename, parent_path, file_size, file_type, lastmod)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((batch: typeof files) => {
      for (const file of batch) {
        insert.run(
          cacheId,
          file.filename,
          file.basename,
          getParentPath(file.filename),
          file.size || 0,
          getFileType(file.basename),
          file.lastmod || null,
        )
      }
    })

    const batchSize = 1000
    let inserted = 0
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      insertMany(batch)
      ensureScanFileCreators(batch.map((file) => ({
        filePath: file.filename,
        parentPath: getParentPath(file.filename),
      })))
      inserted += batch.length
    }

    return { inserted }
  },

  getStats: (cacheId: number) => {
    ensureInitialized()
    const stmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) as images,
        SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) as videos,
        SUM(CASE WHEN is_viewed = 1 THEN 1 ELSE 0 END) as viewed
      FROM scan_files
      WHERE cache_id = ?
    `)
    return stmt.get(cacheId) as { total: number, images: number, videos: number, viewed: number }
  },

  getStatsMultiple: (cacheIds: number[]) => {
    ensureInitialized()
    if (cacheIds.length === 0) {
      return { total: 0, images: 0, videos: 0, viewed: 0 }
    }

    const placeholders = cacheIds.map(() => '?').join(',')
    const stmt = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) as images,
        SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) as videos,
        SUM(CASE WHEN is_viewed = 1 THEN 1 ELSE 0 END) as viewed
      FROM scan_files
      WHERE cache_id IN (${placeholders})
    `)
    return stmt.get(...cacheIds) as { total: number, images: number, videos: number, viewed: number }
  },

  deleteByCache: (cacheId: number) => {
    ensureInitialized()
    const stmt = db.prepare('DELETE FROM scan_files WHERE cache_id = ?')
    return stmt.run(cacheId)
  },

  hasData: (cacheId: number) => {
    ensureInitialized()
    const stmt = db.prepare('SELECT COUNT(*) as count FROM scan_files WHERE cache_id = ? LIMIT 1')
    const result = stmt.get(cacheId) as { count: number }
    return result.count > 0
  },

  hasDataMultiple: (cacheIds: number[]) => {
    ensureInitialized()
    if (cacheIds.length === 0) return false

    const placeholders = cacheIds.map(() => '?').join(',')
    const stmt = db.prepare(`SELECT COUNT(*) as count FROM scan_files WHERE cache_id IN (${placeholders}) LIMIT 1`)
    const result = stmt.get(...cacheIds) as { count: number }
    return result.count > 0
  },

  syncViewedFromRatings: (cacheId: number) => {
    ensureInitialized()
    const stmt = db.prepare(`
      UPDATE scan_files
      SET is_viewed = 1
      WHERE cache_id = ?
        AND is_viewed = 0
        AND EXISTS (
          SELECT 1 FROM media_ratings
          WHERE media_ratings.file_path = scan_files.filename
            AND media_ratings.is_viewed = 1
        )
    `)

    const result = stmt.run(cacheId)
    return { synced: result.changes }
  },

  migrateFromCache: (cacheId: number) => {
    ensureInitialized()
    const cache = db.prepare('SELECT * FROM scan_cache WHERE id = ?').get(cacheId) as any
    if (!cache || !cache.files_data) {
      return { success: false, message: '缓存数据不存在或为空' }
    }

    const files = JSON.parse(cache.files_data)
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, message: '文件数据为空' }
    }

    const beforeStats = scanFiles.getStats(cacheId)
    scanFiles.deleteByCache(cacheId)
    const result = scanFiles.batchInsert(cacheId, files)
    const syncResult = scanFiles.syncViewedFromRatings(cacheId)
    const afterStats = scanFiles.getStats(cacheId)

    return {
      success: true,
      message: `迁移前: 文件数量 ${beforeStats.total}, 已看过 ${beforeStats.viewed} | 迁移后: 文件数量 ${afterStats.total}, 同步已看过 ${afterStats.viewed}`,
      count: result.inserted,
      syncedViewed: syncResult.synced,
      beforeStats: { total: beforeStats.total, viewed: beforeStats.viewed },
      afterStats: { total: afterStats.total, viewed: afterStats.viewed },
    }
  },

  migrateAllFromCache: () => {
    ensureInitialized()
    const caches = db.prepare('SELECT id, path FROM scan_cache').all() as any[]
    const details = caches.map((cache) => ({
      cacheId: cache.id,
      path: cache.path,
      ...scanFiles.migrateFromCache(cache.id),
    }))

    const totalMigrated = details.filter((item) => item.success).reduce((sum, item) => sum + (item.count || 0), 0)
    return {
      success: true,
      message: `迁移完成，共处理 ${caches.length} 个缓存，迁移 ${totalMigrated} 个文件`,
      details,
    }
  },

  getRandomGroupMultiple: (cacheIds: number[], options?: {
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
    ensureInitialized()
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

    const placeholders = cacheIds.map(() => '?').join(',')
    const needsRatingJoin = ratings?.length || evaluations?.length || categories?.length
      || (reasonFilter && reasonFilter !== 'all')
      || ratingEmptyFilter !== undefined || evaluationEmptyFilter !== undefined || categoryEmptyFilter !== undefined

    const buildWhereClause = (includeParentPath?: string) => {
      let whereClause = needsRatingJoin ? `sf.cache_id IN (${placeholders})` : `cache_id IN (${placeholders})`
      const params: any[] = [...cacheIds]
      const prefix = 'sf.'

      if (includeParentPath) {
        whereClause += ` AND ${prefix}parent_path = ?`
        params.push(includeParentPath)
      }
      if (fileType) {
        whereClause += ` AND ${prefix}file_type = ?`
        params.push(fileType)
      }
      if (isViewed !== undefined) {
        whereClause += ` AND ${prefix}is_viewed = ?`
        params.push(isViewed ? 1 : 0)
      }
      if (excludeParentPath) {
        whereClause += ` AND ${prefix}parent_path != ?`
        params.push(excludeParentPath)
      }
      if (maxFileSize !== undefined && maxFileSize > 0) {
        whereClause += ` AND ${prefix}file_size <= ?`
        params.push(maxFileSize)
      }

      if (needsRatingJoin) {
        if (ratings && ratings.length > 0) {
          const ratingPlaceholders = ratings.map(() => '?').join(',')
          if (ratingEmptyFilter === true) {
            whereClause += ` AND (mr.rating IN (${ratingPlaceholders}) OR mr.rating IS NULL)`
            params.push(...ratings)
          } else if (ratingEmptyFilter === false) {
            whereClause += ` AND (mr.rating IN (${ratingPlaceholders}) OR (mr.rating IS NOT NULL AND mr.rating NOT IN (${ratingPlaceholders})))`
            params.push(...ratings, ...ratings)
          } else {
            whereClause += ` AND mr.rating IN (${ratingPlaceholders})`
            params.push(...ratings)
          }
        } else if (ratingEmptyFilter === true) {
          whereClause += ` AND mr.rating IS NULL`
        } else if (ratingEmptyFilter === false) {
          whereClause += ` AND mr.rating IS NOT NULL`
        }

        if (evaluations && evaluations.length > 0) {
          const evalConditions = evaluations.map(() => `(mr.custom_evaluation LIKE ? OR mr.custom_evaluation = ?)`).join(' OR ')
          if (evaluationEmptyFilter === true) {
            whereClause += ` AND ((${evalConditions}) OR mr.custom_evaluation IS NULL OR mr.custom_evaluation = '')`
          } else if (evaluationEmptyFilter === false) {
            whereClause += ` AND ((${evalConditions}) OR (mr.custom_evaluation IS NOT NULL AND mr.custom_evaluation != ''))`
          } else {
            whereClause += ` AND (${evalConditions})`
          }
          evaluations.forEach((evaluation) => {
            params.push(`%"${evaluation}"%`)
            params.push(evaluation)
          })
        } else if (evaluationEmptyFilter === true) {
          whereClause += ` AND (mr.custom_evaluation IS NULL OR mr.custom_evaluation = '')`
        } else if (evaluationEmptyFilter === false) {
          whereClause += ` AND (mr.custom_evaluation IS NOT NULL AND mr.custom_evaluation != '')`
        }

        if (categories && categories.length > 0) {
          const catConditions = categories.map(() => `(mr.category LIKE ? OR mr.category = ?)`).join(' OR ')
          if (categoryEmptyFilter === true) {
            whereClause += ` AND ((${catConditions}) OR mr.category IS NULL OR mr.category = '')`
          } else if (categoryEmptyFilter === false) {
            whereClause += ` AND ((${catConditions}) OR (mr.category IS NOT NULL AND mr.category != ''))`
          } else {
            whereClause += ` AND (${catConditions})`
          }
          categories.forEach((category) => {
            params.push(`%"${category}"%`)
            params.push(category)
          })
        } else if (categoryEmptyFilter === true) {
          whereClause += ` AND (mr.category IS NULL OR mr.category = '')`
        } else if (categoryEmptyFilter === false) {
          whereClause += ` AND (mr.category IS NOT NULL AND mr.category != '')`
        }

        if (reasonFilter === 'empty') {
          whereClause += ` AND (mr.recommendation_reason IS NULL OR mr.recommendation_reason = '')`
        } else if (reasonFilter === 'nonempty') {
          whereClause += ` AND mr.recommendation_reason IS NOT NULL AND mr.recommendation_reason != ''`
        } else if (reasonFilter === 'keyword' && reasonKeyword) {
          whereClause += ` AND mr.recommendation_reason LIKE ?`
          params.push(`%${reasonKeyword}%`)
        }
      }

      return { whereClause, params }
    }

    const { whereClause, params } = buildWhereClause()

    const groupsSql = needsRatingJoin
      ? `
          SELECT sf.parent_path, COUNT(*) as file_count
          FROM scan_files sf
          INNER JOIN media_ratings mr ON sf.filename = mr.file_path
          WHERE ${whereClause}
          GROUP BY sf.parent_path
          HAVING file_count > 0
        `
      : `
          SELECT parent_path, COUNT(*) as file_count
          FROM scan_files
          WHERE ${whereClause}
          GROUP BY parent_path
          HAVING file_count > 0
        `

    const groups = db.prepare(groupsSql).all(...params) as Array<{ parent_path: string; file_count: number }>
    if (groups.length === 0) {
      return { files: [], parentPath: null, totalGroups: 0 }
    }

    const randomGroup = groups[Math.floor(Math.random() * groups.length)]
    const selectedParentPath = randomGroup.parent_path

    const { whereClause: fileWhereClause, params: filesParams } = buildWhereClause(selectedParentPath)
    let filesSql = needsRatingJoin
      ? `
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
          INNER JOIN media_ratings mr ON sf.filename = mr.file_path
          LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
          LEFT JOIN creators c ON c.id = sfc.creator_id
          WHERE ${fileWhereClause}
        `
      : `
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
          WHERE ${fileWhereClause}
        `

    filesSql += ' ORDER BY sf.basename'
    const files = db.prepare(filesSql).all(...filesParams)
    const sortedFiles = files.sort((a: any, b: any) => a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'base' }))

    return {
      files: sortedFiles.map((row: any) => attachCreatorInfoToScanFileRow(row)),
      parentPath: selectedParentPath,
      totalGroups: groups.length,
    }
  },

  getRandomBatchMultiple: (cacheIds: number[], count: number, options?: {
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
    ensureInitialized()
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

    const placeholders = cacheIds.map(() => '?').join(',')
    const excludeSet = new Set(excludeFilenames)
    const needsRatingJoin = ratings?.length || evaluations?.length || categories?.length
      || (reasonFilter && reasonFilter !== 'all')
      || ratingEmptyFilter !== undefined || evaluationEmptyFilter !== undefined || categoryEmptyFilter !== undefined

    const buildWhereClause = (includeParentPath?: string, excludeParentPath?: string) => {
      let where = needsRatingJoin ? `sf.cache_id IN (${placeholders})` : `cache_id IN (${placeholders})`
      const params: any[] = [...cacheIds]
      const prefix = needsRatingJoin ? 'sf.' : ''

      if (includeParentPath) {
        where += ` AND ${prefix}parent_path = ?`
        params.push(includeParentPath)
      }
      if (excludeParentPath) {
        where += ` AND ${prefix}parent_path != ?`
        params.push(excludeParentPath)
      }
      if (fileType) {
        where += ` AND ${prefix}file_type = ?`
        params.push(fileType)
      }
      if (isViewed !== undefined) {
        where += ` AND ${prefix}is_viewed = ?`
        params.push(isViewed ? 1 : 0)
      }
      if (minFileSize !== undefined && minFileSize > 0) {
        where += ` AND ${prefix}file_size >= ?`
        params.push(minFileSize)
      }
      if (maxFileSize !== undefined && maxFileSize > 0) {
        where += ` AND ${prefix}file_size <= ?`
        params.push(maxFileSize)
      }

      if (needsRatingJoin) {
        if (ratings && ratings.length > 0) {
          const ratingPlaceholders = ratings.map(() => '?').join(',')
          if (ratingEmptyFilter === true) {
            where += ` AND (mr.rating IN (${ratingPlaceholders}) OR mr.rating IS NULL)`
            params.push(...ratings)
          } else if (ratingEmptyFilter === false) {
            where += ` AND (mr.rating IN (${ratingPlaceholders}) OR (mr.rating IS NOT NULL AND mr.rating NOT IN (${ratingPlaceholders})))`
            params.push(...ratings, ...ratings)
          } else {
            where += ` AND mr.rating IN (${ratingPlaceholders})`
            params.push(...ratings)
          }
        } else if (ratingEmptyFilter === true) {
          where += ` AND mr.rating IS NULL`
        } else if (ratingEmptyFilter === false) {
          where += ` AND mr.rating IS NOT NULL`
        }

        if (evaluations && evaluations.length > 0) {
          const evalConditions = evaluations.map(() => `(mr.custom_evaluation LIKE ? OR mr.custom_evaluation = ?)`).join(' OR ')
          if (evaluationEmptyFilter === true) {
            where += ` AND ((${evalConditions}) OR mr.custom_evaluation IS NULL OR mr.custom_evaluation = '')`
          } else if (evaluationEmptyFilter === false) {
            where += ` AND ((${evalConditions}) OR (mr.custom_evaluation IS NOT NULL AND mr.custom_evaluation != ''))`
          } else {
            where += ` AND (${evalConditions})`
          }
          evaluations.forEach((evaluation) => {
            params.push(`%"${evaluation}"%`)
            params.push(evaluation)
          })
        } else if (evaluationEmptyFilter === true) {
          where += ` AND (mr.custom_evaluation IS NULL OR mr.custom_evaluation = '')`
        } else if (evaluationEmptyFilter === false) {
          where += ` AND (mr.custom_evaluation IS NOT NULL AND mr.custom_evaluation != '')`
        }

        if (categories && categories.length > 0) {
          const catConditions = categories.map(() => `(mr.category LIKE ? OR mr.category = ?)`).join(' OR ')
          if (categoryEmptyFilter === true) {
            where += ` AND ((${catConditions}) OR mr.category IS NULL OR mr.category = '')`
          } else if (categoryEmptyFilter === false) {
            where += ` AND ((${catConditions}) OR (mr.category IS NOT NULL AND mr.category != ''))`
          } else {
            where += ` AND (${catConditions})`
          }
          categories.forEach((category) => {
            params.push(`%"${category}"%`)
            params.push(category)
          })
        } else if (categoryEmptyFilter === true) {
          where += ` AND (mr.category IS NULL OR mr.category = '')`
        } else if (categoryEmptyFilter === false) {
          where += ` AND (mr.category IS NOT NULL AND mr.category != '')`
        }

        if (reasonFilter === 'empty') {
          where += ` AND (mr.recommendation_reason IS NULL OR mr.recommendation_reason = '')`
        } else if (reasonFilter === 'nonempty') {
          where += ` AND mr.recommendation_reason IS NOT NULL AND mr.recommendation_reason != ''`
        } else if (reasonFilter === 'keyword' && reasonKeyword) {
          where += ` AND mr.recommendation_reason LIKE ?`
          params.push(`%${reasonKeyword}%`)
        }
      }

      return { where, params }
    }

    const buildSelectSql = (whereClause: string, orderBy: string = 'RANDOM()', limit?: number) => {
      let sql = needsRatingJoin
        ? `
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
            INNER JOIN media_ratings mr ON sf.filename = mr.file_path
            LEFT JOIN scan_file_creators sfc ON sfc.file_path = sf.filename
            LEFT JOIN creators c ON c.id = sfc.creator_id
            WHERE ${whereClause}
            ORDER BY ${orderBy}
          `
        : `
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
            WHERE ${whereClause}
            ORDER BY ${orderBy}
          `
      if (limit) sql += ` LIMIT ${limit}`
      return sql
    }

    const buildCountSql = (whereClause: string) => needsRatingJoin
      ? `
          SELECT COUNT(*) as count
          FROM scan_files sf
          INNER JOIN media_ratings mr ON sf.filename = mr.file_path
          WHERE ${whereClause}
        `
      : `SELECT COUNT(*) as count FROM scan_files sf WHERE ${whereClause}`

    const getRandomFile = (whereClause: string, params: any[], totalCount: number, bucketCount: number): any => {
      if (totalCount < 100000) {
        const sql = buildSelectSql(whereClause, 'RANDOM()', 1)
        const file = db.prepare(sql).get(...params) as any
        if (file && !excludeSet.has(file.filename)) {
          return attachCreatorInfoToScanFileRow(file)
        }
        return null
      }

      for (let i = 0; i < 5; i++) {
        const randomBucket = Math.floor(Math.random() * bucketCount)
        const bucketWhere = `(sf.id % ${bucketCount}) = ? AND ${whereClause}`
        const sql = buildSelectSql(bucketWhere, 'RANDOM()', 1)
        const file = db.prepare(sql).get(randomBucket, ...params) as any
        if (file && !excludeSet.has(file.filename)) {
          return attachCreatorInfoToScanFileRow(file)
        }
      }

      const bucketSql = needsRatingJoin
        ? `SELECT DISTINCT (sf.id % ${bucketCount}) as bucket FROM scan_files sf INNER JOIN media_ratings mr ON sf.filename = mr.file_path WHERE ${whereClause}`
        : `SELECT DISTINCT (sf.id % ${bucketCount}) as bucket FROM scan_files sf WHERE ${whereClause}`
      const buckets = db.prepare(bucketSql).all(...params) as Array<{ bucket: number }>
      if (buckets.length === 0) return null

      const shuffledBuckets = [...buckets].sort(() => Math.random() - 0.5)
      const tryCount = Math.min(10, shuffledBuckets.length)
      for (let i = 0; i < tryCount; i++) {
        const randomBucket = shuffledBuckets[i].bucket
        const bucketWhere = `(sf.id % ${bucketCount}) = ? AND ${whereClause}`
        const sql = buildSelectSql(bucketWhere, 'RANDOM()', 1)
        const file = db.prepare(sql).get(randomBucket, ...params) as any
        if (file && !excludeSet.has(file.filename)) {
          return attachCreatorInfoToScanFileRow(file)
        }
      }

      return null
    }

    const results: any[] = []
    if (currentParentPath && randomness < 1) {
      const samePathCount = Math.round(count * (1 - randomness))
      if (samePathCount > 0) {
        const { where, params } = buildWhereClause(currentParentPath)
        const countSql = buildCountSql(where)
        const { count: totalCount } = db.prepare(countSql).get(...params) as { count: number }
        if (totalCount > 0) {
          let bucketCount = 1024
          if (totalCount >= 1000000) bucketCount = 4096
          if (totalCount >= 10000000) bucketCount = 16384
          for (let i = 0; i < samePathCount && results.length < count; i++) {
            const file = getRandomFile(where, params, totalCount, bucketCount)
            if (file) {
              results.push(file)
              excludeSet.add(file.filename)
            }
          }
        }
      }

      const remainingCount = count - results.length
      if (remainingCount > 0) {
        const { where, params } = buildWhereClause(undefined, currentParentPath)
        const countSql = buildCountSql(where)
        const { count: totalCount } = db.prepare(countSql).get(...params) as { count: number }
        if (totalCount > 0) {
          let bucketCount = 1024
          if (totalCount >= 1000000) bucketCount = 4096
          if (totalCount >= 10000000) bucketCount = 16384
          for (let i = 0; i < remainingCount; i++) {
            const file = getRandomFile(where, params, totalCount, bucketCount)
            if (file) {
              results.push(file)
              excludeSet.add(file.filename)
            }
          }
        }
      }

      return results
    }

    const { where, params } = buildWhereClause()
    const countSql = buildCountSql(where)
    const { count: totalCount } = db.prepare(countSql).get(...params) as { count: number }
    if (totalCount === 0) return []

    let bucketCount = 1024
    if (totalCount >= 1000000) bucketCount = 4096
    if (totalCount >= 10000000) bucketCount = 16384

    if (totalCount <= count * 2) {
      const fetchCount = Math.min(totalCount, count + excludeSet.size)
      const sql = buildSelectSql(where, 'RANDOM()', fetchCount)
      const allFiles = (db.prepare(sql).all(...params) as any[]).map((row) => attachCreatorInfoToScanFileRow(row))
      return allFiles.filter((file) => !excludeSet.has(file.filename)).slice(0, count)
    }

    const maxAttempts = count * 3
    let attempts = 0
    while (results.length < count && attempts < maxAttempts) {
      attempts++
      const file = getRandomFile(where, params, totalCount, bucketCount)
      if (file) {
        results.push(file)
        excludeSet.add(file.filename)
      }
    }

    return results
  },
}
