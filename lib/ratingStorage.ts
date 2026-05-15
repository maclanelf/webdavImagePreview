import db from './databaseCore'
import { ensureInitialized } from './databaseInitialization'
import {
  addCategoryLabel as addCategoryLabelEntry,
  addCustomEvaluationLabel as addCustomEvaluationLabelEntry,
} from './ratingMetadataRepository'

export interface MediaRatingStoragePayload {
  filePath: string
  fileName: string
  fileType: string
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}

function toStoredJsonValue(value?: string | string[]) {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? JSON.stringify(value) : value
}

export function saveMediaRatingRecord(data: MediaRatingStoragePayload) {
  ensureInitialized()

  const existing = db.prepare('SELECT * FROM media_ratings WHERE file_path = ?').get(data.filePath) as any
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

  if (data.isViewed !== undefined) {
    try {
      db.prepare(`
        UPDATE scan_files
        SET is_viewed = ?
        WHERE filename = ?
      `).run(data.isViewed ? 1 : 0, data.filePath)
    } catch (scanError) {
      console.error('⚠️ [ratingStorage] 同步更新 scan_files 失败:', scanError)
    }
  }

  return result
}

export function addCustomEvaluationLabel(label: string) {
  return addCustomEvaluationLabelEntry(label)
}

export function addCategoryLabel(name: string) {
  return addCategoryLabelEntry(name)
}
