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
  /** 关联的博主 ID */
  creatorId?: number | null
  /** 已关联的博主信息 */
  creator?: CreatorSummary | null
  /** 是否已经通过关联表完成博主解析 */
  creatorResolved?: boolean
}

/**
 * 博主摘要信息
 * 包含博主的基本信息
 */
export interface CreatorSummary {
  /** 博主 ID */
  id: number
  /** 主要名称 */
  primaryName: string
  /** 其他别名列表 */
  otherNames?: string[]
  /** 颜值评分（0-5） */
  appearanceRating?: number | null
  /** 身材评分（0-5） */
  bodyRating?: number | null
  /** 简介 */
  bio?: string | null
  /** 头像路径 */
  avatarPath?: string | null
  /** 使用次数（关联的媒体文件数量） */
  usageCount?: number
}

/**
 * 博主统计信息
 * 包含博主相关的媒体和评分统计
 */
export interface CreatorStats {
  /** 媒体文件总数 */
  mediaFiles: number
  /** 已评分的媒体数量 */
  mediaRated: number
  /** 媒体平均评分 */
  mediaAvgRating: number
  /** 图组文件总数 */
  groupFiles: number
  /** 已评分的图组数量 */
  groupRated: number
  /** 图组平均评分 */
  groupAvgRating: number
  /** 总文件数（媒体 + 图组） */
  totalFiles: number
}

/**
 * 博主完整资料
 * 包含博主基本信息和统计数据
 */
export interface CreatorProfile extends CreatorSummary {
  /** 统计信息 */
  stats?: CreatorStats
}

/**
 * 博主媒体卡片
 * 用于博主详情页面展示单个媒体文件
 */
export interface CreatorMediaCard {
  /** 唯一标识 */
  id: string
  /** 文件完整路径 */
  filePath: string
  /** 文件名（含扩展名） */
  fileName: string
  /** 文件基础名（不含扩展名） */
  basename: string
  /** 文件类型 */
  fileType: 'image' | 'video'
  /** 媒体类型（用于播放器选择） */
  mediaType?: 'image' | 'small-video' | 'stream-video'
  /** 预览图 URL */
  previewUrl?: string | null
  /** 流媒体 URL */
  streamUrl?: string | null
  /** 转码 URL */
  transcodeUrl?: string | null
  /** 直链 URL */
  directUrl?: string | null
  /** 所属图组路径 */
  groupPath?: string | null
  /** 所属图组名称 */
  groupName?: string | null
  /** 最后修改时间 */
  lastmod?: string | null
  /** 文件大小（字节） */
  fileSize?: number | null
  /** 评分（1-5） */
  rating?: number | null
  /** 推荐理由 */
  recommendationReason?: string | null
  /** 自定义评价标签 */
  customEvaluation?: string[]
  /** 分类标签 */
  category?: string[]
  /** 是否已看过 */
  isViewed: boolean
  /** 关联的博主 ID */
  creatorId?: number | null
  /** 已关联的博主信息 */
  creator?: CreatorSummary | null
  /** 是否已经通过关联表完成博主解析 */
  creatorResolved?: boolean
}

/**
 * 博主预览缓存条目
 * 用于预加载和缓存媒体文件的 Blob 数据
 */
export interface CreatorPreviewCacheEntry {
  /** 文件路径 */
  filePath: string
  /** Blob 对象 URL */
  objectUrl: string
  /** Blob 数据 */
  blob: Blob
  /** 媒体类型 */
  mediaType: 'image' | 'small-video'
  /** 缓存时间戳 */
  timestamp: number
}

/**
 * 博主媒体筛选条件
 */
export interface CreatorMediaFilters {
  /** 是否已看过 */
  viewed?: boolean
  /** 评分筛选（1-5） */
  ratings?: number[]
  /** 标签筛选 */
  tags?: string[]
  /** 文件类型筛选 */
  fileType?: 'all' | 'image' | 'video'
}

/**
 * 博主图组卡片
 * 用于博主详情页面展示图组
 */
export interface CreatorGroupCard {
  /** 唯一标识 */
  id: string
  /** 图组路径 */
  groupPath: string
  /** 图组名称 */
  groupName: string
  /** 文件数量 */
  fileCount: number
  /** 图组内已看过的文件数量 */
  viewedFileCount?: number
  /** 图组内未看过的文件数量 */
  unviewedFileCount?: number
  /** 封面文件路径 */
  coverFilePath?: string | null
  /** 封面预览 URL */
  coverPreviewUrl?: string | null
  /** 用于首开预览的种子媒体 */
  previewSeed?: CreatorMediaCard | null
  /** 评分（1-5） */
  rating?: number | null
  /** 推荐理由 */
  recommendationReason?: string | null
  /** 自定义评价标签 */
  customEvaluation?: string[]
  /** 分类标签 */
  category?: string[]
  /** 是否已看过 */
  isViewed: boolean
  /** 关联的博主 ID */
  creatorId?: number | null
}

/**
 * 媒体体验项
 * 用于预览容器的统一媒体项格式
 */
export interface MediaExperienceItem {
  /** 唯一标识 */
  id: string
  /** 标题 */
  title: string
  /** 媒体类型 */
  mediaType: 'image' | 'small-video' | 'stream-video'
  /** 媒体源 URL */
  src: string
  /** 预览图 URL */
  previewSrc?: string | null
  /** 转码 URL */
  transcodeUrl?: string | null
  /** 直链 URL */
  directUrl?: string | null
  /** 文件路径 */
  filePath?: string
  /** 副标题 */
  subtitle?: string | null
  /** 评分 */
  rating?: number | null
  /** 标签列表 */
  tags?: string[]
}

/**
 * 媒体体验博主覆盖层属性
 * 用于在预览界面显示博主相关信息
 */
export interface MediaExperienceCreatorOverlayProps {
  /** 文件路径 */
  filePath: string
  /** 已关联的博主信息 */
  creator?: CreatorSummary | null
  /** 是否已经通过关联表完成博主解析 */
  creatorResolved?: boolean
  /** 博主标签是否可见 */
  creatorTagVisible?: boolean
  /** 博主标签位置 */
  creatorTagPosition?: { top?: string; bottom?: string; left?: string; right?: string }
  /** 博主详情标签是否可见 */
  creatorDetailTagVisible?: boolean
  /** 博主详情标签位置 */
  creatorDetailTagPosition?: { top?: string; bottom?: string; left?: string; right?: string }
  /** 博主刷新键 */
  creatorRefreshKey?: number
  /** 博主识别完成回调 */
  onCreatorIdentified?: (creator: any | null) => void
  /** 博主标签点击回调 */
  onCreatorTagClick?: () => void
  /** 博主详情标签点击回调 */
  onCreatorDetailTagClick?: (creator: any | null) => void
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

export interface VideoHighlight {
  id: number
  filePath: string
  fileName: string
  startSeconds: number
  endSeconds: number
  durationSeconds: number
  title?: string
  note?: string
  tags?: string[]
  sortOrder?: number
  createdAt: string
  updatedAt: string
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
