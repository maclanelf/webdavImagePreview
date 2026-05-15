import db from './databaseCore'
import { ensureInitialized } from './databaseInitialization'

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

function upsertScanFileCreator(filePath: string, parentPath: string, creatorId: number | null) {
  const existing = db.prepare('SELECT file_path FROM scan_file_creators WHERE file_path = ?').get(filePath) as { file_path: string } | undefined

  if (existing) {
    db.prepare(`
      UPDATE scan_file_creators
      SET parent_path = ?, creator_id = ?, updated_at = datetime('now', 'localtime')
      WHERE file_path = ?
    `).run(parentPath, creatorId, filePath)
    return
  }

  db.prepare(`
    INSERT INTO scan_file_creators (file_path, parent_path, creator_id)
    VALUES (?, ?, ?)
  `).run(filePath, parentPath, creatorId)
}

export const mediaRatings = {
  get: (filePath: string) => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM media_ratings WHERE file_path = ?')
    return stmt.get(filePath)
  },

  getAll: () => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM media_ratings ORDER BY updated_at DESC')
    return stmt.all()
  },

  save: (data: MediaRatingRecordPayload) => {
    ensureInitialized()

    const existing = mediaRatings.get(data.filePath) as any
    const customEvaluationStr = toStoredJsonValue(data.customEvaluation)
    const categoryStr = toStoredJsonValue(data.category)

    let result: any
    if (existing) {
      const stmt = db.prepare(`
        UPDATE media_ratings
        SET rating = ?, recommendation_reason = ?, custom_evaluation = ?,
            category = ?, is_viewed = ?, updated_at = datetime('now', 'localtime')
        WHERE file_path = ?
      `)
      result = stmt.run(
        data.rating !== undefined ? data.rating : existing.rating,
        data.recommendationReason !== undefined ? data.recommendationReason : existing.recommendation_reason,
        customEvaluationStr !== null ? customEvaluationStr : existing.custom_evaluation,
        categoryStr !== null ? categoryStr : existing.category,
        data.isViewed !== undefined ? (data.isViewed ? 1 : 0) : existing.is_viewed,
        data.filePath,
      )
    } else {
      const stmt = db.prepare(`
        INSERT INTO media_ratings
        (file_path, file_name, file_type, rating, recommendation_reason, custom_evaluation, category, is_viewed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      result = stmt.run(
        data.filePath,
        data.fileName,
        data.fileType,
        data.rating || null,
        data.recommendationReason || null,
        customEvaluationStr,
        categoryStr,
        data.isViewed ? 1 : 0,
      )
    }

    if (data.creatorId !== undefined) {
      upsertScanFileCreator(data.filePath, getParentPath(data.filePath), data.creatorId ?? null)
    }

    if (data.isViewed !== undefined) {
      try {
        db.prepare(`
          UPDATE scan_files
          SET is_viewed = ?
          WHERE filename = ?
        `).run(data.isViewed ? 1 : 0, data.filePath)
      } catch (scanError) {
        console.error('⚠️ [mediaRatingRepository] 同步更新 scan_files 失败:', scanError)
      }
    }

    return result
  },

  delete: (filePath: string) => {
    ensureInitialized()
    const stmt = db.prepare('DELETE FROM media_ratings WHERE file_path = ?')
    return stmt.run(filePath)
  },

  getViewedCount: (viewed?: boolean) => {
    ensureInitialized()
    let countQuery = 'SELECT COUNT(*) as count FROM media_ratings'

    if (viewed === true) {
      countQuery += ' WHERE is_viewed = 1'
    } else if (viewed === false) {
      countQuery += ' WHERE is_viewed = 0 OR is_viewed IS NULL'
    }

    const stmt = db.prepare(countQuery)
    return stmt.get() as { count: number }
  },

  getViewedFilePaths: (viewed?: boolean) => {
    ensureInitialized()
    let query = 'SELECT file_path FROM media_ratings'

    if (viewed === true) {
      query += ' WHERE is_viewed = 1'
    } else if (viewed === false) {
      query += ' WHERE is_viewed = 0 OR is_viewed IS NULL'
    }

    const stmt = db.prepare(query)
    const results = stmt.all() as Array<{ file_path: string }>
    return results.map((row) => row.file_path)
  },

  saveViewedState: (filePath: string, isViewed: boolean) => {
    ensureInitialized()

    const existing = mediaRatings.get(filePath) as any

    if (existing) {
      db.prepare(`
        UPDATE media_ratings
        SET is_viewed = ?, updated_at = datetime('now', 'localtime')
        WHERE file_path = ?
      `).run(isViewed ? 1 : 0, filePath)
    } else {
      const fileName = filePath.split('/').pop() || filePath
      const fileType = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(fileName) ? 'image' : 'video'

      db.prepare(`
        INSERT INTO media_ratings
        (file_path, file_name, file_type, is_viewed)
        VALUES (?, ?, ?, ?)
      `).run(filePath, fileName, fileType, isViewed ? 1 : 0)
    }

    try {
      const scanResult = db.prepare(`
        UPDATE scan_files
        SET is_viewed = ?
        WHERE filename = ?
      `).run(isViewed ? 1 : 0, filePath)

      return { scanChanges: scanResult.changes }
    } catch (scanError) {
      console.error('⚠️ [mediaRatingRepository] saveViewedState 同步 scan_files 失败:', scanError)
      return { scanChanges: 0 }
    }
  },
}
