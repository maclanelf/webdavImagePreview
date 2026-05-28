import { scanCache } from '@/lib/scanCacheRepository'
import { scanFiles } from '@/lib/scanFilesRepository'

type RandomPoolFileType = 'image' | 'video'

const RANDOM_POOL_SESSION_TTL_MS = 30 * 60 * 1000

export interface RandomPoolRequestOptions {
  webdavUrl: string
  webdavUsername: string
  paths: string[]
  preloadCount: number
  excludeFileIds?: number[]
  fileType?: RandomPoolFileType
  isViewed?: boolean
  minFileSize?: number
  maxFileSize?: number
  currentParentPath?: string
  randomness?: number
  ratings?: number[]
  evaluations?: string[]
  categories?: string[]
  reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword'
  reasonKeyword?: string
  ratingEmptyFilter?: boolean
  evaluationEmptyFilter?: boolean
  categoryEmptyFilter?: boolean
}

type RandomPoolStatus = {
  cacheSize: number
  maxCacheSize: number
}

type RandomPoolState = {
  key: string
  items: any[]
  consumedFileIds: Set<number>
  baseCount: number
  targetCount: number
  lastAccessAt: number
}

type RandomPoolFetchResult = {
  files: any[]
  hasData: boolean
  message?: string
  hasMatchingCandidates: boolean
}

type RandomPoolRefillResult = {
  hasData: boolean
  message?: string
  hasMatchingCandidates: boolean
}

function normalizeStringArray(values?: string[]) {
  if (!values || values.length === 0) {
    return []
  }

  return [...values].filter(Boolean).sort((a, b) => a.localeCompare(b))
}

function normalizeNumberArray(values?: number[]) {
  if (!values || values.length === 0) {
    return []
  }

  return [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
}

function normalizeExcludeFileIds(values?: number[]) {
  if (!values || values.length === 0) {
    return []
  }

  return Array.from(new Set(
    values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0),
  )).sort((a, b) => a - b)
}

class ServerRandomPoolManager {
  private pools = new Map<string, RandomPoolState>()
  private invalidatedSessions = new Map<string, number>()

  private pruneExpiredSessions(reason: string) {
    const now = Date.now()
    const expiredSessions: string[] = []
    const expiredInvalidatedSessions: string[] = []

    this.pools.forEach((state, sessionKey) => {
      if (now - state.lastAccessAt > RANDOM_POOL_SESSION_TTL_MS) {
        expiredSessions.push(sessionKey)
      }
    })

    this.invalidatedSessions.forEach((invalidatedAt, sessionKey) => {
      if (now - invalidatedAt > RANDOM_POOL_SESSION_TTL_MS) {
        expiredInvalidatedSessions.push(sessionKey)
      }
    })

    expiredSessions.forEach((sessionKey) => {
      const state = this.pools.get(sessionKey)
      if (!state) {
        return
      }

      console.log(
        `[随机缓存池] 回收过期会话缓存池，原因: ${reason}，session=${sessionKey}，空闲=${now - state.lastAccessAt}ms，剩余条目=${state.items.length}`,
      )
      this.pools.delete(sessionKey)
    })

    expiredInvalidatedSessions.forEach((sessionKey) => {
      this.invalidatedSessions.delete(sessionKey)
    })
  }

  private applyExcludedFileIdsToState(state: RandomPoolState, excludeFileIds?: number[]) {
    const normalizedExcludeFileIds = normalizeExcludeFileIds(excludeFileIds)
    if (normalizedExcludeFileIds.length === 0) {
      return
    }

    const excludeSet = new Set(normalizedExcludeFileIds)
    normalizedExcludeFileIds.forEach((fileId) => {
      state.consumedFileIds.add(fileId)
    })

    state.items = state.items.filter((item) => {
      const fileId = Number(item.id)
      return !Number.isFinite(fileId) || fileId <= 0 || !excludeSet.has(fileId)
    })
  }

  private normalizeSessionKey(sessionKey: string) {
    const normalizedSessionKey = sessionKey.trim()
    if (!normalizedSessionKey) {
      throw new Error('缺少 randomPoolSessionId')
    }
    return normalizedSessionKey
  }

  getRandomPoolConfig(preloadCount: number) {
    const baseCount = Math.max(1, preloadCount || 1)
    return {
      baseCount,
      targetCount: baseCount * 5,
    }
  }

  private buildPoolKey(options: RandomPoolRequestOptions) {
    return JSON.stringify({
      webdavUrl: options.webdavUrl,
      webdavUsername: options.webdavUsername,
      paths: [...options.paths].sort((a, b) => a.localeCompare(b)),
      preloadCount: Math.max(1, options.preloadCount || 1),
      fileType: options.fileType || 'all',
      isViewed: options.isViewed ?? null,
      minFileSize: options.minFileSize ?? null,
      maxFileSize: options.maxFileSize ?? null,
      randomness: options.randomness ?? 1,
      ratings: normalizeNumberArray(options.ratings),
      evaluations: normalizeStringArray(options.evaluations),
      categories: normalizeStringArray(options.categories),
      reasonFilter: options.reasonFilter || 'all',
      reasonKeyword: options.reasonKeyword?.trim() || '',
      ratingEmptyFilter: options.ratingEmptyFilter ?? null,
      evaluationEmptyFilter: options.evaluationEmptyFilter ?? null,
      categoryEmptyFilter: options.categoryEmptyFilter ?? null,
    })
  }

  private createEmptyStatus(maxCacheSize: number = 0): RandomPoolStatus {
    return {
      cacheSize: 0,
      maxCacheSize,
    }
  }

  private getPoolStatus(state: RandomPoolState | null): RandomPoolStatus {
    if (!state) {
      return this.createEmptyStatus(0)
    }

    return {
      cacheSize: state.items.length,
      maxCacheSize: state.targetCount,
    }
  }

  private buildExpiredConsumeResult(
    requestedCount: number,
    preloadCount: number,
    message: string,
    poolStatus?: RandomPoolStatus,
  ) {
    return {
      files: [],
      requestedCount,
      isInsufficient: true,
      hasData: false,
      message,
      poolStatus: poolStatus || this.createEmptyStatus(this.getRandomPoolConfig(preloadCount).targetCount),
      allViewed: false,
      sessionExpired: true,
    }
  }

  getStatus(sessionKey?: string) {
    this.pruneExpiredSessions('status-check')

    if (sessionKey) {
      return this.getPoolStatus(this.pools.get(this.normalizeSessionKey(sessionKey)) || null)
    }

    let cacheSize = 0
    let maxCacheSize = 0

    this.pools.forEach((state) => {
      cacheSize += state.items.length
      maxCacheSize += state.targetCount
    })

    return {
      cacheSize,
      maxCacheSize,
    }
  }

  getSessionCount() {
    this.pruneExpiredSessions('session-count-check')
    return this.pools.size
  }

  clearSession(sessionKey: string, reason: string = 'unknown', invalidate: boolean = true) {
    const normalizedSessionKey = this.normalizeSessionKey(sessionKey)
    const state = this.pools.get(normalizedSessionKey)

    if (state) {
      console.log(`[随机缓存池] 清空会话缓存池，原因: ${reason}，session=${normalizedSessionKey}，剩余条目=${state.items.length}`)
      this.pools.delete(normalizedSessionKey)
    }

    if (invalidate) {
      this.invalidatedSessions.set(normalizedSessionKey, Date.now())
    } else {
      this.invalidatedSessions.delete(normalizedSessionKey)
    }
  }

  clearAll(reason: string = 'unknown') {
    if (this.pools.size > 0) {
      console.log(`[随机缓存池] 清空全部服务端缓存池，原因: ${reason}，会话数=${this.pools.size}`)
    }

    this.pools.forEach((_state, sessionKey) => {
      this.invalidatedSessions.set(sessionKey, Date.now())
    })
    this.pools.clear()
  }

  private async fetchPoolCandidates(
    options: RandomPoolRequestOptions,
    count: number,
    excludeFileIds: number[],
    currentParentPath?: string,
  ): Promise<RandomPoolFetchResult> {
    const normalizedExcludeFileIds = normalizeExcludeFileIds([
      ...(options.excludeFileIds || []),
      ...excludeFileIds,
    ])

    const caches = await scanCache.getMultiple(options.webdavUrl, options.webdavUsername, options.paths) as any[]
    const cacheIds = caches.map((cache) => cache.id)

    if (cacheIds.length === 0) {
      return {
        files: [],
        hasData: false,
        message: '未找到缓存数据',
        hasMatchingCandidates: false,
      }
    }

    if (!await scanFiles.hasDataMultiple(cacheIds)) {
      return {
        files: [],
        hasData: false,
        message: '数据尚未迁移，请先执行迁移',
        hasMatchingCandidates: false,
      }
    }

    const files = await scanFiles.getRandomBatchMultiple(cacheIds, count, {
      fileType: options.fileType || undefined,
      isViewed: options.isViewed,
      excludeFileIds: normalizedExcludeFileIds,
      minFileSize: options.minFileSize,
      maxFileSize: options.maxFileSize,
      currentParentPath: currentParentPath || undefined,
      randomness: options.randomness ?? 1,
      ratings: options.ratings,
      evaluations: options.evaluations,
      categories: options.categories,
      reasonFilter: options.reasonFilter,
      reasonKeyword: options.reasonKeyword,
      ratingEmptyFilter: options.ratingEmptyFilter,
      evaluationEmptyFilter: options.evaluationEmptyFilter,
      categoryEmptyFilter: options.categoryEmptyFilter,
    })

    return {
      files,
      hasData: true,
      message: files.length === 0 ? '未找到符合条件的文件' : undefined,
      hasMatchingCandidates: files.length > 0
        ? true
        : options.isViewed === true && normalizedExcludeFileIds.length > 0
          ? await scanFiles.hasRandomCandidatesMultiple(cacheIds, {
              fileType: options.fileType || undefined,
              isViewed: options.isViewed,
              minFileSize: options.minFileSize,
              maxFileSize: options.maxFileSize,
              ratings: options.ratings,
              evaluations: options.evaluations,
              categories: options.categories,
              reasonFilter: options.reasonFilter,
              reasonKeyword: options.reasonKeyword,
              ratingEmptyFilter: options.ratingEmptyFilter,
              evaluationEmptyFilter: options.evaluationEmptyFilter,
              categoryEmptyFilter: options.categoryEmptyFilter,
            })
          : false,
    }
  }

  private appendUniqueFiles(state: RandomPoolState, files: any[]) {
    const existing = new Set(
      state.items
        .map((item) => Number(item.id))
        .filter((value) => Number.isFinite(value) && value > 0),
    )

    files.forEach((file) => {
      const fileId = Number(file.id)
      if (!Number.isFinite(fileId) || fileId <= 0) {
        return
      }

      if (existing.has(fileId) || state.consumedFileIds.has(fileId)) {
        return
      }

      existing.add(fileId)
      state.items.push(file)
    })
  }

  async initialize(options: RandomPoolRequestOptions, sessionKey: string) {
    this.pruneExpiredSessions('initialize')

    const normalizedSessionKey = this.normalizeSessionKey(sessionKey)
    const poolConfig = this.getRandomPoolConfig(options.preloadCount)
    const key = this.buildPoolKey(options)
    const normalizedExcludeFileIds = normalizeExcludeFileIds(options.excludeFileIds)

    this.clearSession(normalizedSessionKey, 'initialize', false)

    const state: RandomPoolState = {
      key,
      items: [],
      consumedFileIds: new Set<number>(normalizedExcludeFileIds),
      baseCount: poolConfig.baseCount,
      targetCount: poolConfig.targetCount,
      lastAccessAt: Date.now(),
    }

    const result = await this.fetchPoolCandidates(options, state.targetCount, normalizedExcludeFileIds, undefined)
    if (!result.hasData) {
      return {
        files: [],
        actualCount: 0,
        requestedCount: state.targetCount,
        isInsufficient: true,
        hasData: false,
        message: result.message,
        poolStatus: this.getPoolStatus(state),
      }
    }

    this.appendUniqueFiles(state, result.files)
    state.lastAccessAt = Date.now()
    this.pools.set(normalizedSessionKey, state)

    return {
      files: [...state.items],
      actualCount: state.items.length,
      requestedCount: state.targetCount,
      isInsufficient: state.items.length < state.targetCount,
      hasData: true,
      message: result.message,
      poolStatus: this.getPoolStatus(state),
    }
  }

  private async refillIfNeeded(options: RandomPoolRequestOptions, state: RandomPoolState): Promise<RandomPoolRefillResult> {
    if (state.items.length > state.baseCount) {
      return {
        hasData: true,
        message: undefined,
        hasMatchingCandidates: state.items.length > 0,
      }
    }

    const excludeFileIds = normalizeExcludeFileIds([
      ...(options.excludeFileIds || []),
      ...state.items
        .map((item) => Number(item.id))
        .filter((value) => Number.isFinite(value) && value > 0),
      ...Array.from(state.consumedFileIds),
    ])

    const refillResult = await this.fetchPoolCandidates(
      options,
      state.targetCount,
      excludeFileIds,
      options.currentParentPath,
    )

    if (!refillResult.hasData) {
      return refillResult
    }

    this.appendUniqueFiles(state, refillResult.files)
    state.lastAccessAt = Date.now()

    return refillResult
  }

  async consume(options: RandomPoolRequestOptions, count: number = 1, sessionKey: string) {
    this.pruneExpiredSessions('consume')

    const requestedCount = Math.max(1, count || 1)
    const key = this.buildPoolKey(options)
    const normalizedSessionKey = this.normalizeSessionKey(sessionKey)
    const normalizedExcludeFileIds = normalizeExcludeFileIds(options.excludeFileIds)

    let state = this.pools.get(normalizedSessionKey) || null

    if (!state && this.invalidatedSessions.has(normalizedSessionKey)) {
      return this.buildExpiredConsumeResult(
        requestedCount,
        options.preloadCount,
        '随机缓存池会话已失效，请重新初始化',
      )
    }

    if (state && state.key !== key) {
      return this.buildExpiredConsumeResult(
        requestedCount,
        options.preloadCount,
        '随机缓存池会话配置已变更，请重新初始化',
        this.getPoolStatus(state),
      )
    }

    if (!state) {
      const initResult = await this.initialize(options, normalizedSessionKey)
      if (!initResult.hasData) {
        return {
          files: [],
          requestedCount,
          isInsufficient: true,
          hasData: false,
          message: initResult.message,
          poolStatus: initResult.poolStatus,
          allViewed: false,
        }
      }

      state = this.pools.get(normalizedSessionKey) || null
    }

    if (!state) {
      return {
        files: [],
        requestedCount,
        isInsufficient: true,
        hasData: false,
        message: '服务端缓存池初始化失败',
        poolStatus: this.createEmptyStatus(this.getRandomPoolConfig(options.preloadCount).targetCount),
        allViewed: false,
      }
    }

    this.applyExcludedFileIdsToState(state, normalizedExcludeFileIds)
    state.lastAccessAt = Date.now()

    let refillMessage: string | undefined
    let hasData = true
    let hasMatchingCandidates = false

    const refillResult = await this.refillIfNeeded(options, state)
    hasData = refillResult.hasData
    refillMessage = refillResult.message
    hasMatchingCandidates = Boolean(refillResult.hasMatchingCandidates)

    if (!refillResult.hasData && state.items.length === 0) {
      return {
        files: [],
        requestedCount,
        isInsufficient: true,
        hasData: false,
        message: refillResult.message,
        poolStatus: this.getPoolStatus(state),
        allViewed: false,
      }
    }

    const selectedFiles: any[] = []

    for (let index = 0; index < requestedCount; index++) {
      if (state.items.length === 0) {
        break
      }

      const randomIndex = Math.floor(Math.random() * state.items.length)
      const [selected] = state.items.splice(randomIndex, 1)

      if (!selected) {
        break
      }

      const selectedId = Number(selected.id)
      if (Number.isFinite(selectedId) && selectedId > 0) {
        state.consumedFileIds.add(selectedId)
      }
      selectedFiles.push(selected)
    }

    state.lastAccessAt = Date.now()

    const allViewed = options.isViewed === true
      && selectedFiles.length === 0
      && state.items.length === 0
      && hasMatchingCandidates
    const isInsufficient = selectedFiles.length < requestedCount

    return {
      files: selectedFiles,
      requestedCount,
      isInsufficient,
      hasData,
      message: selectedFiles.length === 0 ? (refillMessage || '未找到符合条件的文件') : refillMessage,
      poolStatus: this.getPoolStatus(state),
      allViewed,
    }
  }
}

export const serverRandomPoolManager = new ServerRandomPoolManager()

export default serverRandomPoolManager
