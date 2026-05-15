import db from './databaseCore'
import { ensureInitialized } from './databaseInitialization'

export interface GroupRatingRecordPayload {
  groupPath: string
  groupName: string
  fileCount: number
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

function setCreatorForGroupFiles(groupPath: string, creatorId: number | null) {
  const files = db.prepare(`
    SELECT filename, parent_path
    FROM scan_files
    WHERE parent_path = ?
  `).all(groupPath) as Array<{ filename: string; parent_path: string }>

  const transaction = db.transaction((rows: Array<{ filename: string; parent_path: string }>) => {
    rows.forEach((row) => {
      upsertScanFileCreator(row.filename, row.parent_path, creatorId)
    })
  })

  transaction(files)
}

export const groupRatings = {
  get: (groupPath: string) => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM group_ratings WHERE group_path = ?')
    return stmt.get(groupPath)
  },

  getAll: () => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM group_ratings ORDER BY updated_at DESC')
    return stmt.all()
  },

  save: (data: GroupRatingRecordPayload) => {
    ensureInitialized()

    const existing = groupRatings.get(data.groupPath) as any
    const customEvaluationStr = toStoredJsonValue(data.customEvaluation)
    const categoryStr = toStoredJsonValue(data.category)

    let result: any
    if (existing) {
      const stmt = db.prepare(`
        UPDATE group_ratings
        SET rating = ?, recommendation_reason = ?, custom_evaluation = ?,
            category = ?, is_viewed = ?, updated_at = datetime('now', 'localtime')
        WHERE group_path = ?
      `)
      result = stmt.run(
        data.rating || null,
        data.recommendationReason || null,
        customEvaluationStr,
        categoryStr,
        data.isViewed ? 1 : 0,
        data.groupPath,
      )
    } else {
      const stmt = db.prepare(`
        INSERT INTO group_ratings
        (group_path, group_name, file_count, rating, recommendation_reason, custom_evaluation, category, is_viewed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      result = stmt.run(
        data.groupPath,
        data.groupName,
        data.fileCount,
        data.rating || null,
        data.recommendationReason || null,
        customEvaluationStr,
        categoryStr,
        data.isViewed ? 1 : 0,
      )
    }

    if (data.creatorId !== undefined) {
      setCreatorForGroupFiles(data.groupPath, data.creatorId ?? null)
    }

    return result
  },

  delete: (groupPath: string) => {
    ensureInitialized()
    const stmt = db.prepare('DELETE FROM group_ratings WHERE group_path = ?')
    return stmt.run(groupPath)
  },
}
