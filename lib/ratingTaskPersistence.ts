import {
  addCategoryLabel,
  addCustomEvaluationLabel,
} from './ratingMetadataRepository'
import { mediaRatings } from './mediaRatingRepository'

export interface RatingTaskPersistencePayload {
  filePath: string
  fileName: string
  fileType: string
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}

function normalizeStringOrArrayValue(value?: string | string[]) {
  if (Array.isArray(value)) {
    const normalized = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)

    return normalized.length > 0 ? normalized : undefined
  }

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
      const normalized = parsed
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)

      return normalized.length > 0 ? normalized : undefined
    }

    if (typeof parsed === 'string' && parsed.trim()) {
      return parsed.trim()
    }
  } catch {
    return trimmed
  }

  return trimmed
}

/**
 * 统一承接“评分任务 → 数据库存储”的共享写入逻辑。
 *
 * 设计目标：
 * - Web API 与 Worker 复用同一条评分持久化路径
 * - Worker 复用更轻量的评分存储子模块，避免直接引入 [`lib/database.ts`](lib/database.ts)
 * - 仍然通过共享初始化链路确保不会出现半初始化数据库
 */
export function persistRatingTask(payload: RatingTaskPersistencePayload) {
  const normalizedCustomEvaluation = normalizeStringOrArrayValue(payload.customEvaluation)
  const normalizedCategory = normalizeStringOrArrayValue(payload.category)

  mediaRatings.save({
    filePath: payload.filePath,
    fileName: payload.fileName,
    fileType: payload.fileType,
    rating: payload.rating,
    recommendationReason: payload.recommendationReason,
    customEvaluation: normalizedCustomEvaluation,
    category: normalizedCategory,
    isViewed: payload.isViewed,
  })

  if (normalizedCustomEvaluation) {
    const evaluations = Array.isArray(normalizedCustomEvaluation)
      ? normalizedCustomEvaluation
      : [normalizedCustomEvaluation]

    evaluations.forEach((evaluation) => {
      if (typeof evaluation === 'string' && evaluation.trim()) {
        addCustomEvaluationLabel(evaluation.trim())
      }
    })
  }

  if (normalizedCategory) {
    const categoriesList = Array.isArray(normalizedCategory)
      ? normalizedCategory
      : [normalizedCategory]

    categoriesList.forEach((category) => {
      if (typeof category === 'string' && category.trim()) {
        addCategoryLabel(category.trim())
      }
    })
  }
}
