import {
  ensureMySqlInitialized,
  executeMySqlStatement,
  queryMySqlOne,
  queryMySqlRows,
} from './database'

export interface MediaRatingRecordPayload {
  filePath: string
  fileName: string
  fileType: string
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
  creatorId?: number | null
}

function toStoredJsonValue(value?: string | string[]) {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? JSON.stringify(value) : value
}

function getParentPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  return lastSlash > 0 ? filePath.substring(0, lastSlash) : '/'
}

function normalizeResult(result: any) {
  return {
    ...result,
    insertId: result?.insertId ?? 0,
    changes: result?.affectedRows ?? 0,
  }
}

async function upsertScanFileCreator(filePath: string, parentPath: string, creatorId: number | null) {
  await executeMySqlStatement(
    `
      INSERT INTO scan_file_creators (file_path, parent_path, creator_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        parent_path = VALUES(parent_path),
        creator_id = VALUES(creator_id)
    `,
    [filePath, parentPath, creatorId],
  )
}

export const mediaRatings = {
  get: async (filePath: string) => {
    await ensureMySqlInitialized()
    return queryMySqlOne('SELECT * FROM media_ratings WHERE file_path = ?', [filePath])
  },

  getAll: async () => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM media_ratings ORDER BY updated_at DESC')
  },

  save: async (data: MediaRatingRecordPayload) => {
    await ensureMySqlInitialized()

    const existing = await mediaRatings.get(data.filePath) as any
    const customEvaluationStr = toStoredJsonValue(data.customEvaluation)
    const categoryStr = toStoredJsonValue(data.category)

    let result: any
    if (existing) {
      result = await executeMySqlStatement(
        `
          UPDATE media_ratings
          SET rating = ?, recommendation_reason = ?, custom_evaluation = ?,
              category = ?, is_viewed = ?
          WHERE file_path = ?
        `,
        [
          data.rating !== undefined ? data.rating : existing.rating,
          data.recommendationReason !== undefined ? data.recommendationReason : existing.recommendation_reason,
          customEvaluationStr !== null ? customEvaluationStr : existing.custom_evaluation,
          categoryStr !== null ? categoryStr : existing.category,
          data.isViewed !== undefined ? (data.isViewed ? 1 : 0) : existing.is_viewed,
          data.filePath,
        ],
      )
    } else {
      result = await executeMySqlStatement(
        `
          INSERT INTO media_ratings
          (file_path, file_name, file_type, rating, recommendation_reason, custom_evaluation, category, is_viewed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          data.filePath,
          data.fileName,
          data.fileType,
          data.rating || null,
          data.recommendationReason || null,
          customEvaluationStr,
          categoryStr,
          data.isViewed ? 1 : 0,
        ],
      )
    }

    if (data.creatorId !== undefined) {
      await upsertScanFileCreator(data.filePath, getParentPath(data.filePath), data.creatorId ?? null)
    }

    if (data.isViewed !== undefined) {
      try {
        await executeMySqlStatement(
          `
            UPDATE scan_files
            SET is_viewed = ?
            WHERE filename = ?
          `,
          [data.isViewed ? 1 : 0, data.filePath],
        )
      } catch (scanError) {
        console.error('⚠️ [mediaRatingRepository] 同步更新 scan_files 失败:', scanError)
      }
    }

    return normalizeResult(result)
  },

  delete: async (filePath: string) => {
    await ensureMySqlInitialized()
    const result = await executeMySqlStatement('DELETE FROM media_ratings WHERE file_path = ?', [filePath])
    return normalizeResult(result)
  },

  getViewedCount: async (viewed?: boolean) => {
    await ensureMySqlInitialized()
    let countQuery = 'SELECT COUNT(*) as count FROM media_ratings'

    if (viewed === true) {
      countQuery += ' WHERE is_viewed = 1'
    } else if (viewed === false) {
      countQuery += ' WHERE is_viewed = 0 OR is_viewed IS NULL'
    }

    return (await queryMySqlOne(countQuery)) as { count: number }
  },

  getViewedFilePaths: async (viewed?: boolean) => {
    await ensureMySqlInitialized()
    let query = 'SELECT file_path FROM media_ratings'

    if (viewed === true) {
      query += ' WHERE is_viewed = 1'
    } else if (viewed === false) {
      query += ' WHERE is_viewed = 0 OR is_viewed IS NULL'
    }

    const results = await queryMySqlRows<Array<{ file_path: string }>>(query)
    return results.map((row) => row.file_path)
  },

  saveViewedState: async (filePath: string, isViewed: boolean) => {
    await ensureMySqlInitialized()

    const existing = await mediaRatings.get(filePath) as any

    if (existing) {
      await executeMySqlStatement(
        `
          UPDATE media_ratings
          SET is_viewed = ?
          WHERE file_path = ?
        `,
        [isViewed ? 1 : 0, filePath],
      )
    } else {
      const fileName = filePath.split('/').pop() || filePath
      const fileType = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(fileName) ? 'image' : 'video'

      await executeMySqlStatement(
        `
          INSERT INTO media_ratings
          (file_path, file_name, file_type, is_viewed)
          VALUES (?, ?, ?, ?)
        `,
        [filePath, fileName, fileType, isViewed ? 1 : 0],
      )
    }

    try {
      const scanResult = await executeMySqlStatement(
        `
          UPDATE scan_files
          SET is_viewed = ?
          WHERE filename = ?
        `,
        [isViewed ? 1 : 0, filePath],
      )

      return { scanChanges: scanResult.affectedRows ?? 0 }
    } catch (scanError) {
      console.error('⚠️ [mediaRatingRepository] saveViewedState 同步 scan_files 失败:', scanError)
      return { scanChanges: 0 }
    }
  },
}
