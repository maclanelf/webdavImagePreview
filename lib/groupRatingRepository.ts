import { ensureMySqlInitialized, executeMySqlStatement, queryMySqlOne, queryMySqlRows } from './database'

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

async function setCreatorForGroupFiles(groupPath: string, creatorId: number | null) {
  const files = await queryMySqlRows<Array<{ filename: string; parent_path: string }>>(
    `
      SELECT filename, parent_path
      FROM scan_files
      WHERE parent_path = ?
    `,
    [groupPath],
  )

  for (const row of files) {
    await upsertScanFileCreator(row.filename, row.parent_path, creatorId)
  }
}

export const groupRatings = {
  get: async (groupPath: string) => {
    await ensureMySqlInitialized()
    return queryMySqlOne('SELECT * FROM group_ratings WHERE group_path = ?', [groupPath])
  },

  getAll: async () => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM group_ratings ORDER BY updated_at DESC')
  },

  save: async (data: GroupRatingRecordPayload) => {
    await ensureMySqlInitialized()

    const existing = await groupRatings.get(data.groupPath) as any
    const customEvaluationStr = toStoredJsonValue(data.customEvaluation)
    const categoryStr = toStoredJsonValue(data.category)

    let result: any
    if (existing) {
      result = await executeMySqlStatement(
        `
          UPDATE group_ratings
          SET rating = ?, recommendation_reason = ?, custom_evaluation = ?,
              category = ?, is_viewed = ?
          WHERE group_path = ?
        `,
        [
          data.rating || null,
          data.recommendationReason || null,
          customEvaluationStr,
          categoryStr,
          data.isViewed ? 1 : 0,
          data.groupPath,
        ],
      )
    } else {
      result = await executeMySqlStatement(
        `
          INSERT INTO group_ratings
          (group_path, group_name, file_count, rating, recommendation_reason, custom_evaluation, category, is_viewed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          data.groupPath,
          data.groupName,
          data.fileCount,
          data.rating || null,
          data.recommendationReason || null,
          customEvaluationStr,
          categoryStr,
          data.isViewed ? 1 : 0,
        ],
      )
    }

    if (data.creatorId !== undefined) {
      await setCreatorForGroupFiles(data.groupPath, data.creatorId ?? null)
    }

    return normalizeResult(result)
  },

  delete: async (groupPath: string) => {
    await ensureMySqlInitialized()
    const result = await executeMySqlStatement('DELETE FROM group_ratings WHERE group_path = ?', [groupPath])
    return normalizeResult(result)
  },
}
