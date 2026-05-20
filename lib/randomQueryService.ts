import { scanCache } from './scanCacheRepository'
import { scanFiles } from './scanFilesRepository'

export type RandomQueryFileType = 'image' | 'video'

/**
 * 随机查询的标准化输入。
 *
 * 保持与 [`POST()`](app/api/scan-files/random/route.ts:6) 请求体兼容，
 * 便于在 Route、Worker 或其他服务层之间复用同一套查询逻辑。
 */
export interface RandomQueryPayload {
  webdavUrl?: string
  webdavUsername?: string
  paths?: string[] | string
  count?: number | string
  fileType?: RandomQueryFileType | '' | null
  isViewed?: boolean | 'true' | 'false' | null
  excludeFilenames?: string[] | string
  minFileSize?: number | string | null
  maxFileSize?: number | string | null
  currentParentPath?: string | null
  randomness?: number | string
  ratings?: number[] | null
  evaluations?: string[] | null
  categories?: string[] | null
  reasonFilter?: 'all' | 'empty' | 'nonempty' | 'keyword' | null
  reasonKeyword?: string | null
  ratingEmptyFilter?: boolean
  evaluationEmptyFilter?: boolean
  categoryEmptyFilter?: boolean
}

export interface RandomQueryResponse {
  files: any[]
  count?: number
  requestedCount?: number
  isInsufficient?: boolean
  message?: string
  hasData?: boolean
}

export class RandomQueryValidationError extends Error {
  readonly status: number

  constructor(message: string, status: number = 400) {
    super(message)
    this.name = 'RandomQueryValidationError'
    this.status = status
  }
}

function parseList(value?: string[] | string | null): string[] {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseOptionalInteger(value?: number | string | null): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined
  }

  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseCount(value?: number | string): number {
  const parsed = parseOptionalInteger(value)
  if (!parsed || parsed < 1) {
    return 1
  }

  return parsed
}

function parseRandomness(value?: number | string): number {
  if (value === undefined || value === null || value === '') {
    return 1
  }

  const parsed = Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) {
    return 1
  }

  return Math.min(1, Math.max(0, parsed))
}

function parseViewedFlag(value?: boolean | 'true' | 'false' | null): boolean | undefined {
  if (value === null || value === undefined) {
    return undefined
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  return undefined
}

function normalizeFileType(value?: RandomQueryFileType | '' | null): RandomQueryFileType | undefined {
  return value === 'image' || value === 'video' ? value : undefined
}

/**
 * 执行一次随机文件查询。
 */
export async function resolveRandomFilesQuery(payload: RandomQueryPayload): Promise<RandomQueryResponse> {
  const startTime = Date.now()
  const webdavUrl = payload.webdavUrl
  const webdavUsername = payload.webdavUsername
  const pathList = parseList(payload.paths)
  const excludeList = parseList(payload.excludeFilenames)
  const count = parseCount(payload.count)
  const fileType = normalizeFileType(payload.fileType)
  const isViewed = parseViewedFlag(payload.isViewed)
  const minFileSize = parseOptionalInteger(payload.minFileSize)
  const maxFileSize = parseOptionalInteger(payload.maxFileSize)
  const randomness = parseRandomness(payload.randomness)

  if (!webdavUrl || !webdavUsername || pathList.length === 0) {
    throw new RandomQueryValidationError('请提供 webdavUrl, webdavUsername 和 paths')
  }

  console.log('⏱️ [random service] 开始处理请求')
  console.log(`⏱️ [random service] 解析参数完成: ${Date.now() - startTime}ms, paths=${pathList.length}, excludeList=${excludeList.length}`)

  const cacheStartTime = Date.now()
  const cacheCount = await scanCache.count()
  console.log(`⏱️ [random service] scan_cache 表数据量: ${cacheCount}`)

  const caches = await scanCache.getMultiple(webdavUrl, webdavUsername, pathList) as Array<{ id: number }>
  const cacheIds = caches.map((cache) => cache.id)
  console.log(`⏱️ [random service] 批量获取 cacheIds 完成: ${Date.now() - cacheStartTime}ms, cacheIds=${cacheIds.length}`)

  if (cacheIds.length === 0) {
    return { files: [], message: '未找到缓存数据' }
  }

  const hasDataStartTime = Date.now()
  if (!await scanFiles.hasDataMultiple(cacheIds)) {
    return {
      files: [],
      hasData: false,
      message: '数据尚未迁移，请先执行迁移',
    }
  }
  console.log(`⏱️ [random service] hasDataMultiple 完成: ${Date.now() - hasDataStartTime}ms`)

  const randomStartTime = Date.now()
  const files = await scanFiles.getRandomBatchMultiple(cacheIds, count, {
    fileType,
    isViewed,
    excludeFilenames: excludeList,
    minFileSize,
    maxFileSize,
    currentParentPath: payload.currentParentPath || undefined,
    randomness,
    ratings: payload.ratings && Array.isArray(payload.ratings) ? payload.ratings : undefined,
    evaluations: payload.evaluations && Array.isArray(payload.evaluations) ? payload.evaluations : undefined,
    categories: payload.categories && Array.isArray(payload.categories) ? payload.categories : undefined,
    reasonFilter: payload.reasonFilter || undefined,
    reasonKeyword: payload.reasonKeyword || undefined,
    ratingEmptyFilter: payload.ratingEmptyFilter,
    evaluationEmptyFilter: payload.evaluationEmptyFilter,
    categoryEmptyFilter: payload.categoryEmptyFilter,
  })
  console.log(`⏱️ [random service] getRandomBatchMultiple 完成: ${Date.now() - randomStartTime}ms`)
  console.log(`⏱️ [random service] 总耗时: ${Date.now() - startTime}ms`)

  const isInsufficient = files.length < count
  const message = isInsufficient
    ? `仅找到 ${files.length} 个符合条件的文件，未达到预加载目标 ${count} 个`
    : undefined

  return {
    files,
    count: files.length,
    requestedCount: count,
    isInsufficient,
    message,
    hasData: true,
  }
}
