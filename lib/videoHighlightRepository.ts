import { ensureMySqlInitialized, executeMySqlStatement, queryMySqlOne, queryMySqlRows } from './database'

function normalizeResult(result: any) {
  return {
    ...result,
    insertId: result?.insertId ?? 0,
    changes: result?.affectedRows ?? 0,
  }
}

export const videoHighlights = {
  getByFilePath: async (filePath: string) => {
    try {
      await ensureMySqlInitialized()
      return queryMySqlRows(
        `
          SELECT *
          FROM video_highlights
          WHERE file_path = ?
          ORDER BY start_seconds ASC, id ASC
        `,
        [filePath],
      )
    } catch (error) {
      console.error('获取精彩片段失败:', error)
      return []
    }
  },

  create: async (data: {
    filePath: string
    fileName: string
    startSeconds: number
    endSeconds: number
    title?: string
    note?: string
    tags?: string[]
    sortOrder?: number
  }) => {
    await ensureMySqlInitialized()

    const overlap = await queryMySqlOne<{ id: number }>(
      `
        SELECT id
        FROM video_highlights
        WHERE file_path = ?
          AND NOT (end_seconds <= ? OR start_seconds >= ?)
        LIMIT 1
      `,
      [data.filePath, data.startSeconds, data.endSeconds],
    )

    if (overlap) {
      throw new Error('时间重叠')
    }

    const durationSeconds = Number((data.endSeconds - data.startSeconds).toFixed(3))
    const result = await executeMySqlStatement(
      `
        INSERT INTO video_highlights
        (file_path, file_name, start_seconds, end_seconds, duration_seconds, title, note, tags, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        data.filePath,
        data.fileName,
        data.startSeconds,
        data.endSeconds,
        durationSeconds,
        data.title?.trim() || null,
        data.note?.trim() || null,
        data.tags && data.tags.length > 0 ? JSON.stringify(data.tags) : null,
        data.sortOrder ?? 0,
      ],
    )

    return normalizeResult(result)
  },

  update: async (id: number, data: {
    startSeconds: number
    endSeconds: number
    title?: string
    note?: string
    tags?: string[]
    sortOrder?: number
  }) => {
    await ensureMySqlInitialized()

    const existing = await queryMySqlOne<{ id: number; file_path: string }>(
      `
        SELECT id, file_path
        FROM video_highlights
        WHERE id = ?
        LIMIT 1
      `,
      [id],
    )

    if (!existing) {
      throw new Error('精彩时刻不存在')
    }

    const overlap = await queryMySqlOne<{ id: number }>(
      `
        SELECT id
        FROM video_highlights
        WHERE file_path = ?
          AND id != ?
          AND NOT (end_seconds <= ? OR start_seconds >= ?)
        LIMIT 1
      `,
      [existing.file_path, id, data.startSeconds, data.endSeconds],
    )

    if (overlap) {
      throw new Error('时间重叠')
    }

    const durationSeconds = Number((data.endSeconds - data.startSeconds).toFixed(3))
    const result = await executeMySqlStatement(
      `
        UPDATE video_highlights
        SET start_seconds = ?, end_seconds = ?, duration_seconds = ?, title = ?, note = ?, tags = ?, sort_order = ?
        WHERE id = ?
      `,
      [
        data.startSeconds,
        data.endSeconds,
        durationSeconds,
        data.title?.trim() || null,
        data.note?.trim() || null,
        data.tags && data.tags.length > 0 ? JSON.stringify(data.tags) : null,
        data.sortOrder ?? 0,
        id,
      ],
    )

    if ((result.affectedRows ?? 0) === 0) {
      throw new Error('精彩时刻不存在')
    }

    return normalizeResult(result)
  },

  delete: async (id: number) => {
    await ensureMySqlInitialized()
    const result = await executeMySqlStatement('DELETE FROM video_highlights WHERE id = ?', [id])

    if ((result.affectedRows ?? 0) === 0) {
      throw new Error('精彩时刻不存在')
    }

    return normalizeResult(result)
  },
}
