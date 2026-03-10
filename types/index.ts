// 共享类型定义

export interface WebDAVConfig {
  url: string
  username: string
  password: string
  mediaPaths: string[]
  sourceType?: 'clouddrive2' | 'openlist'
  directLinkUrl?: string
  enableDirectLink?: boolean
  scanSettings?: {
    concurrency?: number
    preloadCount?: number
  }
}

export interface MediaFile {
  filename: string
  basename: string
  size: number
  type: string
  lastmod: string
  filepath?: string
}

export type MediaFilter = 'all' | 'images' | 'videos'
export type ViewMode = 'random' | 'gallery' | 'large-video'
export type ViewedFilter = 'all' | 'viewed' | 'unviewed'
export type MediaType = 'image' | 'small-video' | 'stream-video'

export interface AdvancedFilters {
  ratings: number[]
  evaluations: string[]
  categories: string[]
  reasonFilter: 'all' | 'empty' | 'nonempty' | 'keyword'
  reasonKeyword?: string
  ratingEmptyFilter?: boolean
  evaluationEmptyFilter?: boolean
  categoryEmptyFilter?: boolean
}

export interface MediaRating {
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}

export interface GroupRating {
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}
export interface GroupRating {
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}

// 快速评分配置
export const QUICK_RATING_CONFIG = [
  { rating: 1, evaluation: '丑死了' },
  { rating: 2, evaluation: '一般' },
  { rating: 3, evaluation: '还行' },
  { rating: 4, evaluation: '非常爽' },
  { rating: 5, evaluation: '爽死了' },
] as const

// 快速评分配置项类型
export type QuickRatingConfig = typeof QUICK_RATING_CONFIG[number]