'use client'

import { scheduleRatingRequest } from '@/lib/clientRequestScheduler'
import type { GroupRating, MediaRating } from '@/types'

type QueueTargetType = 'media' | 'group'
export type RatingSyncStatus = 'queued' | 'syncing' | 'synced' | 'failed'

type QueueSnapshot = {
  status: RatingSyncStatus
  errorMessage?: string | null
  updatedAt: number
  retryCount?: number
  nextRetryAt?: number | null
}

type MediaQueueRecord = QueueSnapshot & {
  type: 'media'
  filePath: string
  payload: {
    filePath: string
    fileName: string
    fileType: string
  } & MediaRating
  rating: MediaRating
}

type GroupQueueRecord = QueueSnapshot & {
  type: 'group'
  groupPath: string
  payload: {
    groupPath: string
    groupName: string
    fileCount: number
  } & GroupRating
  rating: GroupRating
}

export type RatingQueueRecord = MediaQueueRecord | GroupQueueRecord

type QueueListener = () => void

const STORAGE_KEY = 'local_rating_queue_v1'
function buildKey(type: QueueTargetType, targetKey: string) {
  return `${type}:${targetKey}`
}

export function buildMediaQueueKey(filePath: string) {
  return buildKey('media', filePath)
}

export function buildGroupQueueKey(groupPath: string) {
  return buildKey('group', groupPath)
}

class LocalRatingQueue {
  private records = new Map<string, RatingQueueRecord>()
  private queue: string[] = []
  private listeners = new Set<QueueListener>()
  private processing = false
  private hydrated = false
  private inFlightControllers = new Map<string, AbortController>()
  private retryTimers = new Map<string, number>()
  private onlineListenerBound = false
  private readonly baseRetryDelay = 5000
  private readonly maxRetryDelay = 60000

  subscribe(listener: QueueListener) {
    this.ensureHydrated()
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getStatus() {
    this.ensureHydrated()

    let queued = 0
    let syncing = 0
    let failed = 0

    this.records.forEach((record) => {
      if (record.status === 'queued') queued += 1
      if (record.status === 'syncing') syncing += 1
      if (record.status === 'failed') failed += 1
    })

    return {
      queued,
      syncing,
      failed,
      active: queued + syncing,
      total: this.records.size,
    }
  }

  getRecord(key: string) {
    this.ensureHydrated()
    return this.records.get(key) ?? null
  }

  getAllRecords() {
    this.ensureHydrated()
    return Array.from(this.records.values())
  }

  getMediaRecord(filePath: string) {
    return this.getRecord(buildMediaQueueKey(filePath))
  }

  getGroupRecord(groupPath: string) {
    return this.getRecord(buildGroupQueueKey(groupPath))
  }

  cancelMediaRecord(filePath: string) {
    this.cancelRecord(buildMediaQueueKey(filePath))
  }

  cancelGroupRecord(groupPath: string) {
    this.cancelRecord(buildGroupQueueKey(groupPath))
  }

  clearMediaRecord(filePath: string) {
    this.clearRecord(buildMediaQueueKey(filePath))
  }

  clearGroupRecord(groupPath: string) {
    this.clearRecord(buildGroupQueueKey(groupPath))
  }

  private cancelRecord(key: string) {
    this.ensureHydrated()
    this.abortInFlight(key)
    this.clearRecord(key)
  }

  private clearRecord(key: string) {
    this.ensureHydrated()

    const hadRecord = this.records.delete(key)
    this.queue = this.queue.filter((queuedKey) => queuedKey !== key)
    this.inFlightControllers.delete(key)
    this.clearRetryTimer(key)

    if (!hadRecord) {
      return
    }

    this.flush()
    this.notify()
  }

  async enqueueMedia(payload: {
    filePath: string
    fileName: string
    fileType: string
  } & MediaRating) {
    this.ensureHydrated()

    const key = buildMediaQueueKey(payload.filePath)
    const existing = this.records.get(key)
    if (existing?.status === 'syncing') {
      this.abortInFlight(key)
    }

    this.setRecord(key, {
      type: 'media',
      filePath: payload.filePath,
      payload,
      rating: {
        rating: payload.rating,
        recommendationReason: payload.recommendationReason,
        customEvaluation: payload.customEvaluation,
        category: payload.category,
        isViewed: payload.isViewed,
      },
      status: 'queued',
      errorMessage: null,
      updatedAt: Date.now(),
      retryCount: 0,
      nextRetryAt: null,
    })
    this.pushQueueKey(key)
    void this.processQueue()
    return this.records.get(key)!
  }

  async enqueueGroup(payload: {
    groupPath: string
    groupName: string
    fileCount: number
  } & GroupRating) {
    this.ensureHydrated()

    const key = buildGroupQueueKey(payload.groupPath)
    const existing = this.records.get(key)
    if (existing?.status === 'syncing') {
      this.abortInFlight(key)
    }

    this.setRecord(key, {
      type: 'group',
      groupPath: payload.groupPath,
      payload,
      rating: {
        rating: payload.rating,
        recommendationReason: payload.recommendationReason,
        customEvaluation: payload.customEvaluation,
        category: payload.category,
        isViewed: payload.isViewed,
      },
      status: 'queued',
      errorMessage: null,
      updatedAt: Date.now(),
      retryCount: 0,
      nextRetryAt: null,
    })
    this.pushQueueKey(key)
    void this.processQueue()
    return this.records.get(key)!
  }

  private pushQueueKey(key: string) {
    if (!this.queue.includes(key)) {
      this.queue.push(key)
    }
  }

  private async processQueue() {
    if (this.processing) {
      return
    }

    this.processing = true

    try {
      while (this.queue.length > 0) {
        const key = this.queue.shift()
        if (!key) {
          break
        }

        const record = this.records.get(key)
        if (!record) {
          continue
        }

        if (record.type === 'media') {
          await this.syncMediaRecord(key, record)
        } else {
          await this.syncGroupRecord(key, record)
        }
      }
    } finally {
      this.processing = false
    }
  }

  private async syncMediaRecord(key: string, record: MediaQueueRecord) {
    const syncingRecord: MediaQueueRecord = {
      ...record,
      status: 'syncing',
      errorMessage: null,
      updatedAt: Date.now(),
      nextRetryAt: null,
    }
    this.setRecord(key, syncingRecord)

    const controller = new AbortController()
    this.inFlightControllers.set(key, controller)

    try {
      const response = await scheduleRatingRequest(() => fetch('/api/ratings/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record.payload),
        signal: controller.signal,
      }))

      if (!response.ok) {
        const result = await response.json().catch(() => null)
        throw new Error(result?.error || '提交评分失败')
      }

      if (this.records.get(key) !== syncingRecord) {
        return
      }

      this.setRecord(key, {
        ...syncingRecord,
        status: 'synced',
        errorMessage: null,
        updatedAt: Date.now(),
      })

      this.clearRecord(key)
    } catch (error: any) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        return
      }

      if (this.records.get(key) !== syncingRecord) {
        return
      }

      this.setRecord(key, {
        ...syncingRecord,
        status: 'failed',
        errorMessage: error.message || '评分同步失败',
        updatedAt: Date.now(),
        retryCount: (syncingRecord.retryCount ?? 0) + 1,
        nextRetryAt: Date.now() + this.getRetryDelay((syncingRecord.retryCount ?? 0) + 1),
      })
    } finally {
      if (this.inFlightControllers.get(key) === controller) {
        this.inFlightControllers.delete(key)
      }
    }
  }

  private async syncGroupRecord(key: string, record: GroupQueueRecord) {
    const syncingRecord: GroupQueueRecord = {
      ...record,
      status: 'syncing',
      errorMessage: null,
      updatedAt: Date.now(),
      nextRetryAt: null,
    }
    this.setRecord(key, syncingRecord)

    const controller = new AbortController()
    this.inFlightControllers.set(key, controller)

    try {
      const response = await scheduleRatingRequest(() => fetch('/api/ratings/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record.payload),
        signal: controller.signal,
      }))

      if (!response.ok) {
        const result = await response.json().catch(() => null)
        throw new Error(result?.error || '图组评分同步失败')
      }

      if (this.records.get(key) !== syncingRecord) {
        return
      }

      this.setRecord(key, {
        ...syncingRecord,
        status: 'synced',
        errorMessage: null,
        updatedAt: Date.now(),
      })
      this.clearRecord(key)
    } catch (error: any) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        return
      }

      if (this.records.get(key) !== syncingRecord) {
        return
      }

      this.setRecord(key, {
        ...syncingRecord,
        status: 'failed',
        errorMessage: error.message || '图组评分同步失败',
        updatedAt: Date.now(),
        retryCount: (syncingRecord.retryCount ?? 0) + 1,
        nextRetryAt: Date.now() + this.getRetryDelay((syncingRecord.retryCount ?? 0) + 1),
      })
    } finally {
      if (this.inFlightControllers.get(key) === controller) {
        this.inFlightControllers.delete(key)
      }
    }
  }

  private setRecord(key: string, record: RatingQueueRecord) {
    if (record.status === 'failed' && typeof record.nextRetryAt === 'number') {
      this.scheduleRetry(key, record.nextRetryAt)
    } else {
      this.clearRetryTimer(key)
    }

    this.records.set(key, record)
    this.flush()
    this.notify()
  }

  private getRetryDelay(retryCount: number) {
    return Math.min(this.maxRetryDelay, this.baseRetryDelay * Math.max(1, 2 ** Math.max(0, retryCount - 1)))
  }

  private clearRetryTimer(key: string) {
    const timer = this.retryTimers.get(key)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.retryTimers.delete(key)
  }

  private scheduleRetry(key: string, nextRetryAt: number) {
    if (typeof window === 'undefined') {
      return
    }

    this.clearRetryTimer(key)
    const delay = Math.max(0, nextRetryAt - Date.now())
    const timer = window.setTimeout(() => {
      this.retryTimers.delete(key)
      this.retryRecord(key)
    }, delay)
    this.retryTimers.set(key, timer)
  }

  private retryRecord(key: string, force = false) {
    const record = this.records.get(key)
    if (!record || record.status !== 'failed') {
      return
    }

    const nextRetryAt = record.nextRetryAt ?? 0
    if (!force && nextRetryAt > Date.now()) {
      this.scheduleRetry(key, nextRetryAt)
      return
    }

    this.setRecord(key, {
      ...record,
      status: 'queued',
      errorMessage: null,
      updatedAt: Date.now(),
      nextRetryAt: null,
    })
    this.pushQueueKey(key)
    void this.processQueue()
  }

  private bindOnlineListener() {
    if (this.onlineListenerBound || typeof window === 'undefined') {
      return
    }

    window.addEventListener('online', () => {
      this.records.forEach((_record, key) => {
        this.retryRecord(key, true)
      })
    })
    this.onlineListenerBound = true
  }

  private abortInFlight(key: string) {
    const controller = this.inFlightControllers.get(key)
    if (!controller) {
      return
    }

    controller.abort()
    this.inFlightControllers.delete(key)
  }

  private notify() {
    this.listeners.forEach((listener) => listener())
  }

  private ensureHydrated() {
    if (this.hydrated || typeof window === 'undefined') {
      return
    }

    this.hydrated = true
    this.bindOnlineListener()

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return
      }

      const parsed = JSON.parse(raw) as { records?: RatingQueueRecord[] }
      if (!Array.isArray(parsed.records)) {
        return
      }

      parsed.records.forEach((record) => {
        const normalizedRecord = {
          ...record,
          status: record.status === 'syncing' ? 'queued' : record.status,
          errorMessage: record.status === 'syncing' ? null : record.errorMessage,
          updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
          retryCount: typeof record.retryCount === 'number' ? record.retryCount : 0,
          nextRetryAt: typeof record.nextRetryAt === 'number' ? record.nextRetryAt : null,
        } as RatingQueueRecord

        const key = normalizedRecord.type === 'media'
          ? buildMediaQueueKey(normalizedRecord.filePath)
          : buildGroupQueueKey(normalizedRecord.groupPath)
        this.records.set(key, normalizedRecord)
        if (normalizedRecord.status === 'queued' || normalizedRecord.status === 'syncing') {
          this.pushQueueKey(key)
        } else if (normalizedRecord.status === 'failed') {
          this.scheduleRetry(key, normalizedRecord.nextRetryAt ?? Date.now())
        }
      })

      if (this.queue.length > 0) {
        void this.processQueue()
      }
    } catch (error) {
      console.error('[本地评分队列] 恢复失败:', error)
    }
  }

  private flush() {
    if (typeof window === 'undefined') {
      return
    }

    const records = Array.from(this.records.values())
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ records }))
  }
}

declare global {
  var __localRatingQueue: LocalRatingQueue | undefined
}

export const localRatingQueue = globalThis.__localRatingQueue || new LocalRatingQueue()

if (typeof window !== 'undefined') {
  globalThis.__localRatingQueue = localRatingQueue
}
