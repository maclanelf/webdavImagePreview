import db from './databaseCore'
import { ensureInitialized } from './databaseInitialization'

type QueueTaskStatus = 'pending' | 'processing' | 'failed'

export interface RatingTaskQueuePayload {
  filePath: string
  fileName: string
  fileType: string
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}

export interface PersistedRatingQueueTask extends RatingTaskQueuePayload {
  taskId: string
  retryCount: number
  createdAt: string
  status: QueueTaskStatus
  errorMessage?: string
}

export interface RatingQueueStatusSnapshot {
  pending: number
  isProcessing: boolean
  failed: number
  tasks: Array<{
    taskId: string
    fileName: string
    retryCount: number
    createdAt: string
  }>
}

export interface FailedRatingQueueTaskInfo {
  taskId: string
  fileName: string
  filePath: string
  failedAt: string
  reason: string
  retryCount: number
}

export interface EnqueueRatingTaskResult {
  taskId: string
  reusedExistingTask: boolean
}

function toStoredJsonValue(value?: string | string[]) {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? JSON.stringify(value) : value
}

function buildTaskId() {
  return `rating_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

function parseStoredStringOrArrayValue(value: unknown): string | string[] | undefined {
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
      const normalized = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      return normalized.length > 0 ? normalized : undefined
    }

    if (typeof parsed === 'string' && parsed.trim()) {
      return parsed
    }
  } catch {
    return trimmed
  }

  return trimmed
}

function mapQueueRow(row: any): PersistedRatingQueueTask {
  return {
    taskId: row.task_id,
    filePath: row.file_path,
    fileName: row.file_name,
    fileType: row.file_type,
    rating: row.rating ?? undefined,
    recommendationReason: row.recommendation_reason ?? undefined,
    customEvaluation: parseStoredStringOrArrayValue(row.custom_evaluation),
    category: parseStoredStringOrArrayValue(row.category),
    isViewed: row.is_viewed === null || row.is_viewed === undefined ? undefined : row.is_viewed === 1,
    retryCount: row.retry_count ?? 0,
    createdAt: row.created_at,
    status: row.status,
    errorMessage: row.error_message ?? undefined,
  }
}

function trimFailedTasks() {
  db.prepare(`
    DELETE FROM rating_task_queue
    WHERE status = 'failed'
      AND id NOT IN (
        SELECT id
        FROM rating_task_queue
        WHERE status = 'failed'
        ORDER BY failed_at DESC, updated_at DESC, id DESC
        LIMIT 100
      )
  `).run()
}

export function enqueueRatingTask(payload: RatingTaskQueuePayload): EnqueueRatingTaskResult {
  ensureInitialized()

  const existing = db.prepare(`
    SELECT task_id
    FROM rating_task_queue
    WHERE file_path = ?
      AND status IN ('pending', 'failed')
    ORDER BY
      CASE status WHEN 'pending' THEN 0 ELSE 1 END,
      updated_at DESC,
      created_at DESC
    LIMIT 1
  `).get(payload.filePath) as { task_id: string } | undefined

  const taskId = existing?.task_id || buildTaskId()
  const customEvaluation = toStoredJsonValue(payload.customEvaluation)
  const category = toStoredJsonValue(payload.category)
  const isViewed = payload.isViewed === undefined ? null : (payload.isViewed ? 1 : 0)

  if (existing) {
    db.prepare(`
      UPDATE rating_task_queue
      SET file_name = ?,
          file_type = ?,
          rating = ?,
          recommendation_reason = ?,
          custom_evaluation = ?,
          category = ?,
          is_viewed = ?,
          status = 'pending',
          retry_count = 0,
          error_message = NULL,
          failed_at = NULL,
          created_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
      WHERE task_id = ?
    `).run(
      payload.fileName,
      payload.fileType,
      payload.rating ?? null,
      payload.recommendationReason ?? null,
      customEvaluation,
      category,
      isViewed,
      taskId,
    )

    return {
      taskId,
      reusedExistingTask: true,
    }
  }

  db.prepare(`
    INSERT INTO rating_task_queue (
      task_id,
      file_path,
      file_name,
      file_type,
      rating,
      recommendation_reason,
      custom_evaluation,
      category,
      is_viewed,
      status,
      retry_count,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `).run(
    taskId,
    payload.filePath,
    payload.fileName,
    payload.fileType,
    payload.rating ?? null,
    payload.recommendationReason ?? null,
    customEvaluation,
    category,
    isViewed,
  )

  return {
    taskId,
    reusedExistingTask: false,
  }
}

export function resetStaleProcessingRatingTasks() {
  ensureInitialized()
  const result = db.prepare(`
    UPDATE rating_task_queue
    SET status = 'pending',
        updated_at = datetime('now', 'localtime')
    WHERE status = 'processing'
  `).run()
  return result.changes
}

export function claimNextPendingRatingTask(): PersistedRatingQueueTask | null {
  ensureInitialized()

  const claimTask = db.transaction(() => {
    const row = db.prepare(`
      SELECT *
      FROM rating_task_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC, task_id ASC
      LIMIT 1
    `).get() as any

    if (!row) {
      return null
    }

    const result = db.prepare(`
      UPDATE rating_task_queue
      SET status = 'processing',
          last_attempt_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
      WHERE task_id = ?
        AND status = 'pending'
    `).run(row.task_id)

    if (result.changes === 0) {
      return null
    }

    return mapQueueRow({
      ...row,
      status: 'processing',
    })
  })

  return claimTask()
}

export function completeRatingTask(taskId: string) {
  ensureInitialized()
  return db.prepare('DELETE FROM rating_task_queue WHERE task_id = ?').run(taskId)
}

export function failRatingTask(taskId: string, retryCount: number, errorMessage: string, maxRetries: number) {
  ensureInitialized()

  if (retryCount >= maxRetries) {
    db.prepare(`
      UPDATE rating_task_queue
      SET status = 'failed',
          retry_count = ?,
          error_message = ?,
          failed_at = datetime('now', 'localtime'),
          updated_at = datetime('now', 'localtime')
      WHERE task_id = ?
    `).run(retryCount, errorMessage, taskId)

    trimFailedTasks()
    return 'failed' as const
  }

  db.prepare(`
    UPDATE rating_task_queue
    SET status = 'pending',
        retry_count = ?,
        error_message = ?,
        updated_at = datetime('now', 'localtime')
    WHERE task_id = ?
  `).run(retryCount, errorMessage, taskId)

  return 'pending' as const
}

export function hasPendingRatingTasks() {
  ensureInitialized()
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM rating_task_queue
    WHERE status = 'pending'
  `).get() as { count: number }
  return result.count > 0
}

export function hasRecoverableRatingTasks() {
  ensureInitialized()
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM rating_task_queue
    WHERE status IN ('pending', 'processing')
  `).get() as { count: number }
  return result.count > 0
}

export function getRatingQueueStatusSnapshot(): RatingQueueStatusSnapshot {
  ensureInitialized()

  const pendingResult = db.prepare(`
    SELECT COUNT(*) as count
    FROM rating_task_queue
    WHERE status IN ('pending', 'processing')
  `).get() as { count: number }

  const processingResult = db.prepare(`
    SELECT COUNT(*) as count
    FROM rating_task_queue
    WHERE status = 'processing'
  `).get() as { count: number }

  const failedResult = db.prepare(`
    SELECT COUNT(*) as count
    FROM rating_task_queue
    WHERE status = 'failed'
  `).get() as { count: number }

  const tasks = db.prepare(`
    SELECT task_id, file_name, retry_count, created_at, status
    FROM rating_task_queue
    WHERE status IN ('pending', 'processing')
    ORDER BY
      CASE status WHEN 'processing' THEN 0 ELSE 1 END,
      created_at ASC,
      task_id ASC
  `).all() as Array<{
    task_id: string
    file_name: string
    retry_count: number
    created_at: string
  }>

  return {
    pending: pendingResult.count,
    isProcessing: processingResult.count > 0,
    failed: failedResult.count,
    tasks: tasks.map((task) => ({
      taskId: task.task_id,
      fileName: task.file_name,
      retryCount: task.retry_count,
      createdAt: task.created_at,
    })),
  }
}

export function getFailedRatingTasks(): FailedRatingQueueTaskInfo[] {
  ensureInitialized()

  const rows = db.prepare(`
    SELECT task_id, file_name, file_path, failed_at, error_message, retry_count
    FROM rating_task_queue
    WHERE status = 'failed'
    ORDER BY failed_at DESC, updated_at DESC
  `).all() as Array<{
    task_id: string
    file_name: string
    file_path: string
    failed_at: string | null
    error_message: string | null
    retry_count: number
  }>

  return rows.map((row) => ({
    taskId: row.task_id,
    fileName: row.file_name,
    filePath: row.file_path,
    failedAt: row.failed_at || '',
    reason: row.error_message || '未知错误',
    retryCount: row.retry_count,
  }))
}

export function clearFailedRatingTasks() {
  ensureInitialized()
  const result = db.prepare(`
    DELETE FROM rating_task_queue
    WHERE status = 'failed'
  `).run()
  return result.changes
}

export function retryFailedRatingTasks() {
  ensureInitialized()
  const result = db.prepare(`
    UPDATE rating_task_queue
    SET status = 'pending',
        retry_count = 0,
        error_message = NULL,
        failed_at = NULL,
        created_at = datetime('now', 'localtime'),
        updated_at = datetime('now', 'localtime')
    WHERE status = 'failed'
  `).run()
  return result.changes
}
