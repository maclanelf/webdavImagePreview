import db from './databaseCore'
import { ensureInitialized } from './databaseInitialization'

export const videoHighlights = {
  getByFilePath: (filePath: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare(`
        SELECT *
        FROM video_highlights
        WHERE file_path = ?
        ORDER BY start_seconds ASC, id ASC
      `)
      return stmt.all(filePath)
    } catch (error) {
      console.error('获取精彩片段失败:', error)
      return []
    }
  },

  create: (data: {
    filePath: string
    fileName: string
    startSeconds: number
    endSeconds: number
    title?: string
    note?: string
    tags?: string[]
    sortOrder?: number
  }) => {
    ensureInitialized()

    const overlap = db.prepare(`
      SELECT id
      FROM video_highlights
      WHERE file_path = ?
        AND NOT (end_seconds <= ? OR start_seconds >= ?)
      LIMIT 1
    `).get(data.filePath, data.startSeconds, data.endSeconds) as { id: number } | undefined

    if (overlap) {
      throw new Error('时间重叠')
    }

    const durationSeconds = Number((data.endSeconds - data.startSeconds).toFixed(3))
    const stmt = db.prepare(`
      INSERT INTO video_highlights
      (file_path, file_name, start_seconds, end_seconds, duration_seconds, title, note, tags, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    return stmt.run(
      data.filePath,
      data.fileName,
      data.startSeconds,
      data.endSeconds,
      durationSeconds,
      data.title?.trim() || null,
      data.note?.trim() || null,
      data.tags && data.tags.length > 0 ? JSON.stringify(data.tags) : null,
      data.sortOrder ?? 0,
    )
  },

  update: (id: number, data: {
    startSeconds: number
    endSeconds: number
    title?: string
    note?: string
    tags?: string[]
    sortOrder?: number
  }) => {
    ensureInitialized()

    const existing = db.prepare(`
      SELECT id, file_path
      FROM video_highlights
      WHERE id = ?
      LIMIT 1
    `).get(id) as { id: number; file_path: string } | undefined

    if (!existing) {
      throw new Error('精彩时刻不存在')
    }

    const overlap = db.prepare(`
      SELECT id
      FROM video_highlights
      WHERE file_path = ?
        AND id != ?
        AND NOT (end_seconds <= ? OR start_seconds >= ?)
      LIMIT 1
    `).get(existing.file_path, id, data.startSeconds, data.endSeconds) as { id: number } | undefined

    if (overlap) {
      throw new Error('时间重叠')
    }

    const durationSeconds = Number((data.endSeconds - data.startSeconds).toFixed(3))
    const stmt = db.prepare(`
      UPDATE video_highlights
      SET start_seconds = ?, end_seconds = ?, duration_seconds = ?, title = ?, note = ?, tags = ?, sort_order = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `)

    const result = stmt.run(
      data.startSeconds,
      data.endSeconds,
      durationSeconds,
      data.title?.trim() || null,
      data.note?.trim() || null,
      data.tags && data.tags.length > 0 ? JSON.stringify(data.tags) : null,
      data.sortOrder ?? 0,
      id,
    )

    if (result.changes === 0) {
      throw new Error('精彩时刻不存在')
    }

    return result
  },

  delete: (id: number) => {
    ensureInitialized()
    const stmt = db.prepare('DELETE FROM video_highlights WHERE id = ?')
    const result = stmt.run(id)

    if (result.changes === 0) {
      throw new Error('精彩时刻不存在')
    }

    return result
  },
}
