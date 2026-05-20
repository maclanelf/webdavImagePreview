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

    const customEvaluationStr = toStoredJsonValue(data.customEvaluation)
    const categoryStr = toStoredJsonValue(data.category)
    const isViewedValue = data.isViewed === undefined ? null : (data.isViewed ? 1 : 0)
    const result = await executeMySqlStatement(
      `
        INSERT INTO media_ratings
        (file_path, file_name, file_type, rating, recommendation_reason, custom_evaluation, category, is_viewed)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0))
        ON DUPLICATE KEY UPDATE
          file_name = VALUES(file_name),
          file_type = VALUES(file_type),
          rating = COALESCE(VALUES(rating), rating),
          recommendation_reason = COALESCE(VALUES(recommendation_reason), recommendation_reason),
          custom_evaluation = COALESCE(VALUES(custom_evaluation), custom_evaluation),
          category = COALESCE(VALUES(category), category),
          is_viewed = COALESCE(?, is_viewed)
      `,
      [
        data.filePath,
        data.fileName,
        data.fileType,
        data.rating ?? null,
        data.recommendationReason ?? null,
        customEvaluationStr,
        categoryStr,
        isViewedValue,
        isViewedValue,
      ],
    )

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

    const fileName = filePath.split('/').pop() || filePath
    const fileType = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(fileName) ? 'image' : 'video'

    await executeMySqlStatement(
      `
        INSERT INTO media_ratings
        (file_path, file_name, file_type, is_viewed)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          file_name = VALUES(file_name),
          file_type = VALUES(file_type),
          is_viewed = VALUES(is_viewed)
      `,
      [filePath, fileName, fileType, isViewed ? 1 : 0],
    )

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
