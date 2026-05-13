'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import {
  Avatar,
  Box,
  Button,
  Chip,
  Collapse,
  CircularProgress,
  Dialog,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  BrokenImage as BrokenImageIcon,
  Collections as CollectionsIcon,
  Image as ImageIcon,
  Movie as MovieIcon,
  OndemandVideo as OndemandVideoIcon,
  Star as StarIcon,
} from '@mui/icons-material'

import CreatorDialog from '@/components/CreatorDialog'
import CreatorDetailPreviewContainer, { type CreatorDetailPreviewContainerRef } from './CreatorDetailPreviewContainer'
import { type InstantVideoPlayerRef } from '@/components/InstantVideoPlayer'
import RatingDialog from '@/components/RatingDialog'
import { openExternalPlayerUrl } from '@/components/split-main/shared/videoPlayback'
import type {
  CreatorGroupCard,
  CreatorMediaCard,
  CreatorSummary,
  MediaExperienceItem,
  MediaRating,
} from '@/types'
import { QUICK_RATING_CONFIG } from '@/types'

/** 每页显示的媒体数量 */
const PAGE_SIZE = 10
const HEADER_EXPANDED_HEIGHT = 308
const HEADER_CONDENSED_HEIGHT = 126

type CreatorSummaryCounts = {
  mediaTotal: number
  viewedTotal: number
  unviewedTotal: number
  groupTotal: number
}

function mergeUniqueById(list: CreatorMediaCard[]) {
  const map = new Map<string, CreatorMediaCard>()
  list.forEach((item) => {
    map.set(item.id, item)
  })
  return Array.from(map.values())
}

function isSameMediaIdList(a: CreatorMediaCard[], b: CreatorMediaCard[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id) return false
  }
  return true
}

function buildGroupPreviewItems(items: CreatorMediaCard[], previewSeed?: CreatorMediaCard | null) {
  if (!previewSeed) return items
  return mergeUniqueById([previewSeed, ...items])
}

function resolveGroupPreviewEntryItem(group: CreatorGroupCard, items: CreatorMediaCard[]) {
  if (group.previewSeed) return group.previewSeed
  if (group.coverFilePath) {
    return items.find((item) => item.filePath === group.coverFilePath) || items[0] || null
  }
  return items[0] || null
}

function resolveGroupDisplayCount(group: CreatorGroupCard, viewedFilter: CreatorDetailViewedStatusFilter) {
  if (viewedFilter === 'viewed') {
    return group.viewedFileCount ?? group.fileCount
  }
  if (viewedFilter === 'unviewed') {
    return group.unviewedFileCount ?? group.fileCount
  }
  return group.fileCount
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

async function parseApiJsonResponse(response: Response) {
  const rawText = await response.text()
  try {
    return rawText ? JSON.parse(rawText) : {}
  } catch {
    throw new Error(`接口返回了非 JSON 响应（HTTP ${response.status}）`)
  }
}

/** 博主详情标签页类型 */
type CreatorDetailTab = 'viewed' | 'unviewed' | 'groups'
/** 媒体类型过滤器 */
type CreatorDetailMediaTypeFilter = 'all' | 'image' | 'video' | 'small-video' | 'large-video'
/** 已看状态过滤器 */
type CreatorDetailViewedStatusFilter = 'all' | 'viewed' | 'unviewed'
/** 预览播放模式 */
type CreatorPreviewPlayMode = 'webdav' | 'direct' | 'transcode'

function getDefaultPreviewPlayMode(media: CreatorMediaCard | null | undefined): CreatorPreviewPlayMode {
  return media?.mediaType === 'stream-video' ? 'direct' : 'webdav'
}

/**
 * 博主详情抽屉组件的属性接口
 */
interface CreatorDetailDrawerProps {
  /** 抽屉是否打开 */
  open: boolean
  /** 博主信息 */
  creator: CreatorSummary | null
  /** 博主的媒体列表 */
  media?: CreatorMediaCard[]
  /** 博主的图组列表 */
  groups?: CreatorGroupCard[]
  /** 可用的标签列表（用于筛选） */
  availableTags?: string[]
  /** 是否正在加载 */
  loading?: boolean
  /** 关闭抽屉的回调 */
  onClose: () => void
  /** 博主信息更新后的回调 */
  onCreatorUpdated?: (creator: CreatorSummary | null) => void
  /** 预览媒体的回调 */
  onPreviewMedia: (media: CreatorMediaCard, list: CreatorMediaCard[]) => void
  /** 预览是否打开 */
  previewOpen: boolean
  /** 预览列表 */
  previewList: CreatorMediaCard[]
  /** 当前预览的媒体 */
  previewMedia: CreatorMediaCard | null
  /** 当前预览索引 */
  previewIndex: number
  /** 预览总数 */
  previewTotal: number
  /** 关闭预览的回调 */
  onClosePreview: () => void
  /** 预览上一个的回调 */
  onPreviewPrev: () => void
  /** 预览下一个的回调 */
  onPreviewNext: () => void
  /** 预览列表变化的回调 */
  onPreviewListChange: (list: CreatorMediaCard[]) => void
  /** 错误提示回调 */
  onError?: (message: string) => void
}

/**
 * 渲染星级评分组件
 * 
 * @param score - 评分（0-5）
 * @returns 星级评分 UI
 */
function renderStars(score?: number | null) {
  const value = Math.max(0, Math.min(5, Math.round(score || 0)))
  return (
    <Stack direction="row" spacing={0.25} alignItems="center">
      {Array.from({ length: 5 }).map((_, index) => (
        <StarIcon
          key={index}
          sx={{
            fontSize: 16,
            color: index < value ? '#f59e0b' : 'rgba(255,255,255,0.22)',
          }}
        />
      ))}
      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.72)', ml: 0.5 }}>
        {value > 0 ? `${value}.0` : '未评分'}
      </Typography>
    </Stack>
  )
}

/**
 * 构建直链路径
 * 将文件路径转换为直链访问路径，处理特殊字符
 * 
 * @param filePath - 原始文件路径
 * @returns 直链路径
 */
function buildDirectPath(filePath: string) {
  return `/d${filePath.split('/').map((segment) => segment.replace(/／/g, '|')).join('/')}`
}

/**
 * 博主详情抽屉组件
 * 
 * 功能：
 * - 展示博主的基本信息（头像、名称、别名、评分、简介）
 * - 分标签页显示已看过/未看过的媒体和图组
 * - 支持按评分、标签、媒体类型筛选
 * - 支持预览媒体并进行评分
 * - 集成博主信息编辑功能
 * - 支持分页加载和无限滚动
 */
export default function CreatorDetailDrawer({
  open,
  creator,
  media,
  groups,
  availableTags,
  loading,
  onClose,
  onCreatorUpdated,
  onPreviewMedia,
  previewOpen,
  previewList,
  previewMedia,
  previewIndex,
  previewTotal,
  onClosePreview,
  onPreviewPrev,
  onPreviewNext,
  onPreviewListChange,
  onError,
}: CreatorDetailDrawerProps) {
  const normalizedLoading = Boolean(loading)
  /** 本地博主信息状态 */
  const [localCreator, setLocalCreator] = useState<CreatorSummary | null>(creator)
  const creatorId = creator?.id || localCreator?.id || null
  /** 本地媒体列表状态 */
  const [localMedia, setLocalMedia] = useState<CreatorMediaCard[]>(media || [])
  /** 本地图组列表状态 */
  const [localGroups, setLocalGroups] = useState<CreatorGroupCard[]>(groups || [])
  /** 本地可用标签 */
  const [localAvailableTags, setLocalAvailableTags] = useState<string[]>(availableTags || [])
  /** 统计信息（用于展示全部计数） */
  const [summaryCounts, setSummaryCounts] = useState<CreatorSummaryCounts>({ mediaTotal: 0, viewedTotal: 0, unviewedTotal: 0, groupTotal: 0 })
  /** 各标签页当前页 */
  const [tabPages, setTabPages] = useState({ viewed: 0, unviewed: 0, groups: 0 })
  /** 各标签页是否还有下一页 */
  const [tabHasMore, setTabHasMore] = useState({ viewed: false, unviewed: false, groups: false })
  /** 各标签页是否已初始化 */
  const [tabInitialized, setTabInitialized] = useState({ viewed: false, unviewed: false, groups: false })
  /** 首屏引导加载状态 */
  const [bootstrapLoading, setBootstrapLoading] = useState(false)
  /** 首屏信息是否已成功完成，成功后才允许标签页懒加载 */
  const [bootstrapReadyForTabs, setBootstrapReadyForTabs] = useState(false)
  /** 首屏加载错误 */
  const [loadError, setLoadError] = useState<string | null>(null)
  /** 首屏重试键 */
  const [bootstrapRetryKey, setBootstrapRetryKey] = useState(0)
  /** 正在加载更多的标签页 */
  const [loadingMoreTab, setLoadingMoreTab] = useState<CreatorDetailTab | null>(null)
  /** 图组媒体缓存 */
  const [groupMediaMap, setGroupMediaMap] = useState<Record<string, { items: CreatorMediaCard[]; page: number; hasMore: boolean; loading: boolean }>>({})
  /** 当前图组预览对应的图组路径，用于稳定显示总数与补页上下文 */
  const [activePreviewGroupPath, setActivePreviewGroupPath] = useState<string | null>(null)
  /** 当前图组预览对应的总文件数，避免首帧与补页阶段左上角数字抖动 */
  const [activePreviewGroupTotalCount, setActivePreviewGroupTotalCount] = useState<number | null>(null)
  /** 当前选中的标签页 */
  const [tab, setTab] = useState<CreatorDetailTab>('viewed')
  /** 已看 Tab 草稿评分筛选条件 */
  const [selectedRatings, setSelectedRatings] = useState<number[]>([])
  /** 已看 Tab 草稿标签筛选条件 */
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  /** 已看 Tab 草稿媒体类型筛选条件 */
  const [viewedDraftMediaTypeFilter, setViewedDraftMediaTypeFilter] = useState<CreatorDetailMediaTypeFilter>('all')
  /** 已看 Tab 已应用评分筛选条件 */
  const [appliedViewedRatings, setAppliedViewedRatings] = useState<number[]>([])
  /** 已看 Tab 已应用标签筛选条件 */
  const [appliedViewedTags, setAppliedViewedTags] = useState<string[]>([])
  /** 已看 Tab 已应用媒体类型筛选条件 */
  const [appliedViewedMediaTypeFilter, setAppliedViewedMediaTypeFilter] = useState<CreatorDetailMediaTypeFilter>('all')
  /** 未看 Tab 媒体类型筛选条件 */
  const [mediaTypeFilter, setMediaTypeFilter] = useState<CreatorDetailMediaTypeFilter>('all')
  /** 图组 Tab 草稿已看状态筛选条件 */
  const [groupDraftViewedFilter, setGroupDraftViewedFilter] = useState<CreatorDetailViewedStatusFilter>('all')
  /** 图组 Tab 草稿评分筛选条件 */
  const [groupSelectedRatings, setGroupSelectedRatings] = useState<number[]>([])
  /** 图组 Tab 草稿标签筛选条件 */
  const [groupSelectedTags, setGroupSelectedTags] = useState<string[]>([])
  /** 图组 Tab 已应用已看状态筛选条件 */
  const [appliedGroupViewedFilter, setAppliedGroupViewedFilter] = useState<CreatorDetailViewedStatusFilter>('all')
  /** 图组 Tab 已应用评分筛选条件 */
  const [appliedGroupRatings, setAppliedGroupRatings] = useState<number[]>([])
  /** 图组 Tab 已应用标签筛选条件 */
  const [appliedGroupTags, setAppliedGroupTags] = useState<string[]>([])
  /** 头像预览对话框是否打开 */
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false)
  /** 加载失败的图片记录 */
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})
  /** 是否正在加载更多 */
  const [loadingTab, setLoadingTab] = useState<Record<CreatorDetailTab, boolean>>({ viewed: false, unviewed: false, groups: false })
  /** 预览播放模式 */
  const [previewPlayMode, setPreviewPlayMode] = useState<CreatorPreviewPlayMode>('webdav')
  /** 当前预览模式对应的文件路径，用于避免首帧使用旧播放模式 */
  const [previewPlayModeFilePath, setPreviewPlayModeFilePath] = useState<string | null>(null)
  /** 预览播放器预热令牌 */
  const [previewWarmUpToken, setPreviewWarmUpToken] = useState(0)
  /** 已看过标签页筛选区是否展开 */
  const [viewedFiltersExpanded, setViewedFiltersExpanded] = useState(false)
  /** 图组标签页筛选区是否展开 */
  const [groupFiltersExpanded, setGroupFiltersExpanded] = useState(false)
  /** 是否显示播放模式选择器 */
  const [showPlayModeSelector, setShowPlayModeSelector] = useState(false)
  /** 外部播放器菜单锚点 */
  const [externalPlayerAnchor, setExternalPlayerAnchor] = useState<null | HTMLElement>(null)
  /** 预览媒体的当前评分 */
  const [previewCurrentRating, setPreviewCurrentRating] = useState<MediaRating | null>(null)
  /** 预览评分对话框是否打开 */
  const [previewRatingDialogOpen, setPreviewRatingDialogOpen] = useState(false)
  /** 预览博主对话框是否打开 */
  const [previewCreatorDialogOpen, setPreviewCreatorDialogOpen] = useState(false)
  /** 预览时识别到的博主 */
  const [previewIdentifiedCreator, setPreviewIdentifiedCreator] = useState<any | null>(null)
  /** 预览博主刷新键 */
  const [previewCreatorRefreshKey, setPreviewCreatorRefreshKey] = useState(0)
  /** 博主信息编辑对话框是否打开 */
  const [creatorInfoDialogOpen, setCreatorInfoDialogOpen] = useState(false)
  /** sticky 头部是否已压缩 */
  const [headerCondensed, setHeaderCondensed] = useState(false)
  /** 是否为移动端 */
  const [isMobile, setIsMobile] = useState(false)
  /** 列表容器引用 */
  const listContainerRef = useRef<HTMLDivElement | null>(null)
  /** 预览容器引用 */
  const previewContainerRef = useRef<CreatorDetailPreviewContainerRef | null>(null)
  /** 博主详情预览中的大视频播放器引用 */
  const previewInstantVideoRef = useRef<InstantVideoPlayerRef | null>(null)
  /** 预览是否已自动评分的标记 */
  const previewAutoRatedRef = useRef(false)
  const headerCondensedRef = useRef(false)
  const previousLocalMediaRef = useRef<CreatorMediaCard[]>([])
  const onErrorRef = useRef(onError)
  const activeRequestIdRef = useRef(0)
  const tabRequestIdRef = useRef<Record<CreatorDetailTab, number>>({ viewed: 0, unviewed: 0, groups: 0 })
  const groupMediaRequestIdRef = useRef<Record<string, number>>({})
  const groupMediaLoadingRef = useRef<Record<string, boolean>>({})
  const lastListScrollTopRef = useRef(0)
  const scrollAnimationFrameRef = useRef<number | null>(null)
  const pendingListScrollTopRef = useRef(0)
  const headerToggleTimeoutRef = useRef<number | null>(null)
  const viewedFilterKeyRef = useRef('')
  const unviewedFilterKeyRef = useRef('')
  const groupFilterKeyRef = useRef('')
  const groupPreviewHalfLoadTriggeredPageRef = useRef<Record<string, number>>({})

  const fetchBootstrapData = useCallback(async (creatorId: number, requestId: number) => {
    const response = await fetch(`/api/creators/${creatorId}/media?mode=bootstrap`)
    const data = await parseApiJsonResponse(response)
    if (!response.ok || !data.success) {
      throw new Error(data.error || '加载博主详情失败')
    }

    if (activeRequestIdRef.current !== requestId) {
      return false
    }

    const payload = data.data || {}
    const creatorData = payload.creator || null
    const summary = payload.summary || {}

    setLocalCreator(creatorData)
    setSummaryCounts({
      mediaTotal: summary.mediaTotal || 0,
      viewedTotal: summary.viewedTotal || 0,
      unviewedTotal: summary.unviewedTotal || 0,
      groupTotal: summary.groupTotal || 0,
    })
    setLocalAvailableTags(payload.filters?.availableTags || [])

    setLocalMedia([])
    setLocalGroups([])
    setGroupMediaMap({})

    setTabPages({ viewed: 0, unviewed: 0, groups: 0 })
    setTabHasMore({
      viewed: (summary.viewedTotal || 0) > 0,
      unviewed: (summary.unviewedTotal || 0) > 0,
      groups: (summary.groupTotal || 0) > 0,
    })
    setTabInitialized({ viewed: false, unviewed: false, groups: false })
    setBootstrapReadyForTabs(true)

    return true
  }, [])

  const fetchTabPage = useCallback(async (
    creatorId: number,
    targetTab: CreatorDetailTab,
    page: number,
    options: {
      reset?: boolean
      mediaType?: CreatorDetailMediaTypeFilter
      viewedState?: CreatorDetailViewedStatusFilter
      ratings?: number[]
      tags?: string[]
      requestId: number
      sessionId: number
    },
  ) => {
    if (targetTab === 'groups') {
      const search = new URLSearchParams({ mode: 'tab', tab: 'groups', page: String(page), pageSize: String(PAGE_SIZE) })
      if (options?.viewedState && options.viewedState !== 'all') {
        search.set('viewed', options.viewedState)
      }
      if (options?.ratings?.length) {
        search.set('ratings', options.ratings.join(','))
      }
      if (options?.tags?.length) {
        search.set('tags', options.tags.join(','))
      }
      const response = await fetch(`/api/creators/${creatorId}/media?${search.toString()}`)
      const data = await parseApiJsonResponse(response)
      if (!response.ok || !data.success) {
        throw new Error(data.error || '加载图组失败')
      }

      if (activeRequestIdRef.current !== options.sessionId || tabRequestIdRef.current[targetTab] !== options.requestId) {
        return false
      }

      const items = data.data?.items || []
      const pagination = data.data?.pagination || {}
      setLocalGroups((prev) => {
        if (options?.reset) {
          const map = new Map<string, CreatorGroupCard>()
          items.forEach((item: CreatorGroupCard) => map.set(item.id, item))
          return Array.from(map.values())
        }
        const map = new Map<string, CreatorGroupCard>()
        prev.forEach((item) => map.set(item.id, item))
        items.forEach((item: CreatorGroupCard) => map.set(item.id, item))
        return Array.from(map.values())
      })
      setTabPages((prev) => ({ ...prev, groups: pagination.page || page }))
      setTabHasMore((prev) => ({ ...prev, groups: Boolean(pagination.hasMore) }))
      setTabInitialized((prev) => ({ ...prev, groups: true }))
      return true
    }

    const search = new URLSearchParams({ mode: 'tab', tab: targetTab, page: String(page), pageSize: String(PAGE_SIZE) })
    const mediaType = options?.mediaType || 'all'
    if (mediaType !== 'all') {
      search.set('mediaType', mediaType)
    }
    if (targetTab === 'viewed') {
      if (options?.ratings?.length) {
        search.set('ratings', options.ratings.join(','))
      }
      if (options?.tags?.length) {
        search.set('tags', options.tags.join(','))
      }
    }

    const response = await fetch(`/api/creators/${creatorId}/media?${search.toString()}`)
    const data = await parseApiJsonResponse(response)
    if (!response.ok || !data.success) {
      throw new Error(data.error || '加载媒体失败')
    }

    if (activeRequestIdRef.current !== options.sessionId || tabRequestIdRef.current[targetTab] !== options.requestId) {
      return false
    }

    const items = (data.data?.items || []) as CreatorMediaCard[]
    const pagination = data.data?.pagination || {}
    setLocalMedia((prev) => {
      const kept = options?.reset
        ? prev.filter((item) => item.isViewed !== (targetTab === 'viewed'))
        : prev
      return mergeUniqueById([...kept, ...items])
    })

    setTabPages((prev) => ({ ...prev, [targetTab]: pagination.page || page }))
    setTabHasMore((prev) => ({ ...prev, [targetTab]: Boolean(pagination.hasMore) }))
    setTabInitialized((prev) => ({ ...prev, [targetTab]: true }))

    return true
  }, [])

  const fetchGroupMediaPage = useCallback(async (
    creatorId: number,
    groupPath: string,
    page: number,
    reset: boolean,
    viewedState: CreatorDetailViewedStatusFilter,
    requestId: number,
    sessionId: number,
  ) => {
    const search = new URLSearchParams({ mode: 'group-media', groupPath, page: String(page), pageSize: String(PAGE_SIZE) })
    if (viewedState !== 'all') {
      search.set('viewed', viewedState)
    }
    const response = await fetch(`/api/creators/${creatorId}/media?${search.toString()}`)
    const data = await parseApiJsonResponse(response)
    if (!response.ok || !data.success) {
      groupMediaLoadingRef.current[groupPath] = false
      throw new Error(data.error || '加载图组媒体失败')
    }

    if (activeRequestIdRef.current !== sessionId || groupMediaRequestIdRef.current[groupPath] !== requestId) {
      return null
    }

    const items = (data.data?.items || []) as CreatorMediaCard[]
    const pagination = data.data?.pagination || {}
    groupMediaLoadingRef.current[groupPath] = false
    setGroupMediaMap((prev) => {
      const current = prev[groupPath] || { items: [], page: 0, hasMore: true, loading: false }
      return {
        ...prev,
        [groupPath]: {
          items: reset ? items : mergeUniqueById([...current.items, ...items]),
          page: pagination.page || page,
          hasMore: Boolean(pagination.hasMore),
          loading: false,
        },
      }
    })
    setLocalMedia((prev) => mergeUniqueById([...prev, ...items]))
    return {
      items,
      page: pagination.page || page,
      total: pagination.total || items.length,
      hasMore: Boolean(pagination.hasMore),
    }
  }, [])

  /** 博主编辑时使用的文件路径（用于关联博主） */
  const creatorEditFilePath = previewMedia?.filePath
    || localMedia[0]?.filePath
    || (localGroups[0]?.groupPath ? `${localGroups[0].groupPath}/` : '')

  /**
   * 预览源列表
   * 如果有预览列表则使用预览列表，否则使用本地媒体列表
   */
  const previewSourceList = useMemo(() => {
    if (previewList.length === 0) return localMedia
    return previewList.map((item) => localMedia.find((mediaItem) => mediaItem.id === item.id) || item)
  }, [localMedia, previewList])

  /**
   * 同步外部传入的博主和媒体数据到本地状态
   */
  useEffect(() => {
    setLocalCreator(creator)
  }, [creator])

  useEffect(() => {
    const previousMedia = previousLocalMediaRef.current
    if (previousMedia.length === 0) {
      previousLocalMediaRef.current = localMedia
      return
    }

    const previousViewedMap = new Map(previousMedia.map((item) => [item.filePath, item.isViewed]))
    let viewedDelta = 0

    localMedia.forEach((item) => {
      const previousViewed = previousViewedMap.get(item.filePath)
      if (typeof previousViewed !== 'boolean' || previousViewed === item.isViewed) return
      viewedDelta += item.isViewed ? 1 : -1
    })

    if (viewedDelta !== 0) {
      setSummaryCounts((counts) => ({
        ...counts,
        viewedTotal: Math.max(0, counts.viewedTotal + viewedDelta),
        unviewedTotal: Math.max(0, counts.unviewedTotal - viewedDelta),
      }))
    }

    previousLocalMediaRef.current = localMedia
  }, [localMedia])

  useEffect(() => {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
    setIsMobile(userAgent.includes('android') || /iphone|ipad|ipod/.test(userAgent))
  }, [])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    headerCondensedRef.current = headerCondensed
  }, [headerCondensed])

  useEffect(() => () => {
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current)
      scrollAnimationFrameRef.current = null
    }
    if (headerToggleTimeoutRef.current !== null) {
      window.clearTimeout(headerToggleTimeoutRef.current)
      headerToggleTimeoutRef.current = null
    }
  }, [])

  /**
   * 抽屉打开时重置所有筛选条件和分页状态
   */
  useEffect(() => {
    if (!open) return
    setTab('viewed')
    setHeaderCondensed(false)
    headerCondensedRef.current = false
    setLoadError(null)
    setSelectedRatings([])
    setSelectedTags([])
    setViewedDraftMediaTypeFilter('all')
    setAppliedViewedRatings([])
    setAppliedViewedTags([])
    setAppliedViewedMediaTypeFilter('all')
    setMediaTypeFilter('all')
    setGroupDraftViewedFilter('all')
    setGroupSelectedRatings([])
    setGroupSelectedTags([])
    setAppliedGroupViewedFilter('all')
    setAppliedGroupRatings([])
    setAppliedGroupTags([])
    setViewedFiltersExpanded(false)
    setGroupFiltersExpanded(false)
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current)
      scrollAnimationFrameRef.current = null
    }
    if (headerToggleTimeoutRef.current !== null) {
      window.clearTimeout(headerToggleTimeoutRef.current)
      headerToggleTimeoutRef.current = null
    }
    lastListScrollTopRef.current = 0
    pendingListScrollTopRef.current = 0
    viewedFilterKeyRef.current = JSON.stringify({ mediaType: 'all', ratings: [], tags: [] })
    unviewedFilterKeyRef.current = JSON.stringify({ mediaType: 'all' })
    groupFilterKeyRef.current = JSON.stringify({ viewed: 'all', ratings: [], tags: [] })
  }, [open, creator?.id])

  /**
   * 打开详情时仅拉基础信息、汇总统计和可用标签
   */
  useEffect(() => {
    if (!open || !creator?.id) return

    const requestId = ++activeRequestIdRef.current
    tabRequestIdRef.current = { viewed: 0, unviewed: 0, groups: 0 }
    groupMediaRequestIdRef.current = {}
    groupPreviewHalfLoadTriggeredPageRef.current = {}
    setBootstrapLoading(true)
    setBootstrapReadyForTabs(false)
    setLoadError(null)
    setLoadingTab({ viewed: false, unviewed: false, groups: false })
    setLoadingMoreTab(null)

    setSummaryCounts({ mediaTotal: 0, viewedTotal: 0, unviewedTotal: 0, groupTotal: 0 })
    setLocalCreator(creator)
    setLocalMedia([])
    setLocalGroups([])
    setLocalAvailableTags([])
    setGroupMediaMap({})
    setTabPages({ viewed: 0, unviewed: 0, groups: 0 })
    setTabHasMore({ viewed: false, unviewed: false, groups: false })
    setTabInitialized({ viewed: false, unviewed: false, groups: false })

    ;(async () => {
      try {
        await fetchBootstrapData(creator.id, requestId)
      } catch (error) {
        const message = getErrorMessage(error, '加载博主详情失败')
        console.error('[CreatorDetailDrawer] 首屏加载失败:', error)
        if (activeRequestIdRef.current === requestId) {
          setLoadError(message)
        }
        onErrorRef.current?.(message)
      } finally {
        if (activeRequestIdRef.current === requestId) {
          setBootstrapLoading(false)
        }
      }
    })()
  }, [bootstrapRetryKey, creator?.id, fetchBootstrapData, open])

  /**
   * 标签页懒加载：未初始化时按页拉取
   */
  useEffect(() => {
    if (!open || !creatorId) return
    if (!bootstrapReadyForTabs) return
    if (bootstrapLoading) return
    if (loadError) return
    if (tabInitialized[tab]) return
    if (loadingTab[tab]) return

    const targetTab = tab
    const sessionId = activeRequestIdRef.current
    const requestId = tabRequestIdRef.current[targetTab] + 1
    tabRequestIdRef.current[targetTab] = requestId

    setLoadingTab((prev) => ({ ...prev, [targetTab]: true }))
    setLoadingMoreTab(targetTab)
    ;(async () => {
      try {
        if (targetTab === 'groups') {
          await fetchTabPage(creatorId, 'groups', 1, {
            reset: true,
            viewedState: appliedGroupViewedFilter,
            ratings: appliedGroupRatings,
            tags: appliedGroupTags,
            requestId,
            sessionId,
          })
          return
        }

        await fetchTabPage(creatorId, targetTab, 1, {
          reset: true,
          mediaType: targetTab === 'viewed' ? appliedViewedMediaTypeFilter : mediaTypeFilter,
          ratings: targetTab === 'viewed' ? appliedViewedRatings : [],
          tags: targetTab === 'viewed' ? appliedViewedTags : [],
          requestId,
          sessionId,
        })
      } catch (error) {
        console.error(`[CreatorDetailDrawer] 加载 ${targetTab} 标签页失败:`, error)
        onError?.(getErrorMessage(error, `加载${targetTab === 'groups' ? '图组' : '媒体'}失败`))
      } finally {
        if (activeRequestIdRef.current === sessionId && tabRequestIdRef.current[targetTab] === requestId) {
          setLoadingTab((prev) => ({ ...prev, [targetTab]: false }))
          setLoadingMoreTab((prev) => (prev === targetTab ? null : prev))
        }
      }
    })()
  }, [appliedGroupRatings, appliedGroupTags, appliedGroupViewedFilter, appliedViewedMediaTypeFilter, appliedViewedRatings, appliedViewedTags, bootstrapLoading, bootstrapReadyForTabs, creatorId, fetchTabPage, loadError, loadingTab, mediaTypeFilter, onError, open, tab, tabInitialized])

  /**
   * 筛选条件或标签页变化时，滚动到顶部
   */
  useEffect(() => {
    if (listContainerRef.current) {
      listContainerRef.current.scrollTo({ top: 0, behavior: 'auto' })
    }
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current)
      scrollAnimationFrameRef.current = null
    }
    if (headerToggleTimeoutRef.current !== null) {
      window.clearTimeout(headerToggleTimeoutRef.current)
      headerToggleTimeoutRef.current = null
    }
    lastListScrollTopRef.current = 0
    pendingListScrollTopRef.current = 0
    setHeaderCondensed(false)
    headerCondensedRef.current = false
  }, [appliedGroupRatings, appliedGroupTags, appliedGroupViewedFilter, appliedViewedMediaTypeFilter, appliedViewedRatings, appliedViewedTags, mediaTypeFilter, tab, creator?.id])

  /**
   * 预览媒体变化时重置预览相关状态
   */
  useEffect(() => {
    const nextMode = getDefaultPreviewPlayMode(previewMedia)
    setPreviewPlayMode(nextMode)
    setPreviewPlayModeFilePath(previewMedia?.filePath || null)
    setShowPlayModeSelector(false)
    setExternalPlayerAnchor(null)
    setPreviewRatingDialogOpen(false)
    setPreviewCreatorDialogOpen(false)
    setPreviewIdentifiedCreator(null)
    previewAutoRatedRef.current = false
  }, [previewMedia?.filePath])

  const effectivePreviewPlayMode = useMemo<CreatorPreviewPlayMode>(() => {
    if (!previewMedia?.filePath) {
      return previewPlayMode
    }

    if (previewPlayModeFilePath !== previewMedia.filePath) {
      return getDefaultPreviewPlayMode(previewMedia)
    }

    return previewPlayMode
  }, [previewMedia, previewPlayMode, previewPlayModeFilePath])

  /**
   * 加载预览媒体的评分信息
   * 
   * @param filePath - 媒体文件路径
   */
  const loadPreviewRating = useCallback(async (filePath?: string | null) => {
    if (!filePath) {
      setPreviewCurrentRating(null)
      return
    }

    try {
      const response = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(filePath)}`)
      if (!response.ok) {
        setPreviewCurrentRating(null)
        return
      }
      const data = await response.json()
      setPreviewCurrentRating(data.rating || null)
    } catch (error) {
      console.error('[CreatorDetailDrawer] 加载预览评分失败:', error)
      setPreviewCurrentRating(null)
    }
  }, [])

  /**
   * 从服务器加载最新的博主信息
   * 用于编辑博主信息后刷新显示
   */
  const loadLatestCreator = useCallback(async () => {
    const creatorId = localCreator?.id || creator?.id
    if (!creatorId) return

    try {
      const response = await fetch(`/api/creators/${creatorId}`)
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || '刷新博主信息失败')
      }
      const nextCreator = data.data || null
      setLocalCreator(nextCreator)
      onCreatorUpdated?.(nextCreator)
    } catch (error) {
      console.error('[CreatorDetailDrawer] 刷新博主信息失败:', error)
    }
  }, [creator?.id, localCreator?.id, onCreatorUpdated])

  /**
   * 预览打开时加载当前媒体的评分
   */
  useEffect(() => {
    if (!previewOpen || !previewMedia?.filePath) {
      setPreviewCurrentRating(null)
      return
    }
    void loadPreviewRating(previewMedia.filePath)
  }, [loadPreviewRating, previewMedia?.filePath, previewOpen])

  /**
   * 更新本地媒体卡片的部分属性
   * 
   * @param filePath - 文件路径
   * @param patch - 要更新的属性
   */
  const updateLocalMediaCard = useCallback((filePath: string, patch: Partial<CreatorMediaCard>) => {
    setLocalMedia((prev) => prev.map((item) => (item.filePath === filePath ? { ...item, ...patch } : item)))
  }, [])

  /**
   * 执行预览自动评分
   * 
   * 流程：
   * 1. 检查是否已有评分，有则直接使用
   * 2. 没有评分则自动给 2 星评分
   * 3. 更新本地状态和服务器数据
   */
  const performPreviewAutoRating = useCallback(async () => {
    if (!previewMedia || previewAutoRatedRef.current) return

    previewAutoRatedRef.current = true

    try {
      // 先检查是否已有评分
      const existingResponse = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(previewMedia.filePath)}`)
      if (existingResponse.ok) {
        const existingData = await existingResponse.json()
        if (existingData.rating?.rating) {
          setPreviewCurrentRating(existingData.rating)
          return
        }
      }

      // 没有评分则自动给 2 星
      const response = await fetch('/api/ratings/optimistic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: previewMedia.filePath,
          fileName: previewMedia.basename,
          fileType: previewMedia.fileType,
          rating: 2,
          customEvaluation: [QUICK_RATING_CONFIG[1].evaluation],
          isViewed: true,
        }),
      })

      if (!response.ok) {
        throw new Error('自动评分失败')
      }

      setPreviewCurrentRating((prev) => ({
        ...prev,
        rating: 2,
        customEvaluation: [QUICK_RATING_CONFIG[1].evaluation],
        isViewed: true,
      }))
      updateLocalMediaCard(previewMedia.filePath, {
        rating: 2,
        customEvaluation: [QUICK_RATING_CONFIG[1].evaluation],
        isViewed: true,
      })
    } catch (error) {
      console.error('[CreatorDetailDrawer] 自动评分失败:', error)
    }
  }, [previewMedia, updateLocalMediaCard])

  /**
   * 图片预览时自动触发评分
   * 图片打开 100ms 后自动评分
   */
  useEffect(() => {
    if (!previewOpen || !previewMedia) return
    previewAutoRatedRef.current = false

    if (previewMedia.fileType === 'image') {
      const timer = window.setTimeout(() => {
        void performPreviewAutoRating()
      }, 100)

      return () => {
        window.clearTimeout(timer)
      }
    }
  }, [performPreviewAutoRating, previewMedia, previewOpen])

  /**
   * 视频播放时间更新回调
   * 播放到 80% 时自动评分
   * 
   * @param currentTime - 当前播放时间
   * @param duration - 视频总时长
   */
  const handlePreviewVideoTimeUpdate = useCallback((currentTime: number, duration: number) => {
    if (!duration || !isFinite(duration)) return
    if (currentTime / duration >= 0.8) {
      void performPreviewAutoRating()
    }
  }, [performPreviewAutoRating])

  /**
   * 视频播放结束回调
   * 播放结束时自动评分
   */
  const handlePreviewVideoEnded = useCallback(() => {
    void performPreviewAutoRating()
  }, [performPreviewAutoRating])

  /**
   * 处理预览快捷评分
   * 
   * @param rating - 评分值（1-5）
   * @param evaluation - 评价标签
   */
  const handlePreviewQuickRate = useCallback(async (rating: number, evaluation: string) => {
    if (!previewMedia) return

    const payload = {
      filePath: previewMedia.filePath,
      fileName: previewMedia.basename,
      fileType: previewMedia.fileType,
      rating,
      customEvaluation: [evaluation],
      category: previewCurrentRating?.category,
      recommendationReason: previewCurrentRating?.recommendationReason,
      isViewed: true,
    }

    const response = await fetch('/api/ratings/optimistic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error('快捷评分失败')
    }

    setPreviewCurrentRating((prev) => ({
      ...prev,
      rating,
      customEvaluation: [evaluation],
      category: prev?.category,
      recommendationReason: prev?.recommendationReason,
      isViewed: true,
    }))
    updateLocalMediaCard(previewMedia.filePath, {
      rating,
      customEvaluation: [evaluation],
      category: Array.isArray(previewCurrentRating?.category)
        ? previewCurrentRating.category
        : previewCurrentRating?.category
          ? [previewCurrentRating.category]
          : [],
      recommendationReason: previewCurrentRating?.recommendationReason || null,
      isViewed: true,
    })
    previewAutoRatedRef.current = true
  }, [previewCurrentRating, previewMedia, updateLocalMediaCard])

  /**
   * 处理预览详细评分保存
   * 
   * @param data - 评分数据
   */
  const handlePreviewRatingSave = useCallback(async (data: MediaRating) => {
    if (!previewMedia) return

    const response = await fetch('/api/ratings/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: previewMedia.filePath,
        fileName: previewMedia.basename,
        fileType: previewMedia.fileType,
        ...data,
      }),
    })

    const result = await response.json()
    if (!response.ok || result.error) {
      throw new Error(result.error || '保存评分失败')
    }

    previewAutoRatedRef.current = true
    await loadPreviewRating(previewMedia.filePath)
    updateLocalMediaCard(previewMedia.filePath, {
      rating: data.rating ?? null,
      recommendationReason: data.recommendationReason || null,
      customEvaluation: Array.isArray(data.customEvaluation)
        ? data.customEvaluation
        : data.customEvaluation
          ? [data.customEvaluation]
          : [],
      category: Array.isArray(data.category)
        ? data.category
        : data.category
          ? [data.category]
          : [],
      isViewed: data.isViewed ?? true,
    })
  }, [loadPreviewRating, previewMedia, updateLocalMediaCard])

  /**
   * 预览时的键盘快捷键监听
   * 
   * 快捷键：
   * - 1-5: 快捷评分
   * - R: 打开详细评分对话框
   * - 上箭头: 下一个媒体
   * - 下箭头: 上一个媒体
   */
  useEffect(() => {
    if (!previewOpen || !previewMedia) return

    const handleKeyPress = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      // 输入框中不响应快捷键
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return

      const key = event.key.toLowerCase()
      // 数字键 1-5 快捷评分
      if (key >= '1' && key <= '5') {
        event.preventDefault()
        const config = QUICK_RATING_CONFIG[parseInt(key, 10) - 1]
        if (config) {
          void handlePreviewQuickRate(config.rating, config.evaluation)
        }
      }

      // R 键打开详细评分
      if (key === 'r') {
        event.preventDefault()
        setPreviewRatingDialogOpen(true)
      }

      // 上箭头下一个
      if (key === 'arrowup') {
        event.preventDefault()
        onPreviewNext()
      }

      // 下箭头上一个
      if (key === 'arrowdown') {
        event.preventDefault()
        onPreviewPrev()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [handlePreviewQuickRate, onPreviewNext, onPreviewPrev, previewMedia, previewOpen])

  /** 已看过的媒体列表 */
  const viewedMedia = useMemo(() => localMedia.filter((item) => item.isViewed), [localMedia])
  /** 未看过的媒体列表 */
  const unviewedMedia = useMemo(() => localMedia.filter((item) => !item.isViewed), [localMedia])

  /**
   * 已看过媒体的筛选结果
   * 根据媒体类型、评分、标签进行筛选
   */
  const filteredViewedMedia = useMemo(() => viewedMedia.filter((item) => {
    if (appliedViewedMediaTypeFilter === 'image' && item.fileType !== 'image') return false
    if (appliedViewedMediaTypeFilter === 'video' && item.fileType !== 'video') return false
    if (appliedViewedMediaTypeFilter === 'small-video' && item.mediaType !== 'small-video') return false
    if (appliedViewedMediaTypeFilter === 'large-video' && item.mediaType !== 'stream-video') return false
    if (appliedViewedRatings.length > 0 && (!item.rating || !appliedViewedRatings.includes(item.rating))) return false
    if (appliedViewedTags.length > 0) {
      const tags = [...(item.customEvaluation || []), ...(item.category || [])]
      if (!appliedViewedTags.every((tag) => tags.includes(tag))) return false
    }
    return true
  }), [appliedViewedMediaTypeFilter, appliedViewedRatings, appliedViewedTags, viewedMedia])

  /**
   * 未看过媒体的筛选结果
   * 注意：未看过的媒体通常没有评分和标签，所以只按媒体类型筛选
   */
  const filteredUnviewedMedia = useMemo(() => unviewedMedia.filter((item) => {
    if (mediaTypeFilter === 'image' && item.fileType !== 'image') return false
    if (mediaTypeFilter === 'video' && item.fileType !== 'video') return false
    if (mediaTypeFilter === 'small-video' && item.mediaType !== 'small-video') return false
    if (mediaTypeFilter === 'large-video' && item.mediaType !== 'stream-video') return false
    return true
  }), [mediaTypeFilter, unviewedMedia])

  const currentMediaList = useMemo(() => {
    if (tab === 'viewed') return filteredViewedMedia
    if (tab === 'unviewed') return filteredUnviewedMedia
    return []
  }, [filteredUnviewedMedia, filteredViewedMedia, tab])

  const visibleGroups = useMemo(() => localGroups, [localGroups])
  const visibleCardList = useMemo(() => currentMediaList, [currentMediaList])

  const viewedFilterKey = useMemo(
    () => JSON.stringify({ mediaType: appliedViewedMediaTypeFilter, ratings: appliedViewedRatings, tags: appliedViewedTags }),
    [appliedViewedMediaTypeFilter, appliedViewedRatings, appliedViewedTags],
  )

  const unviewedFilterKey = useMemo(
    () => JSON.stringify({ mediaType: mediaTypeFilter }),
    [mediaTypeFilter],
  )

  const groupFilterKey = useMemo(
    () => JSON.stringify({ viewed: appliedGroupViewedFilter, ratings: appliedGroupRatings, tags: appliedGroupTags }),
    [appliedGroupRatings, appliedGroupTags, appliedGroupViewedFilter],
  )

  const activePreviewList = useMemo(() => {
    if (tab === 'groups') return []
    return currentMediaList
  }, [currentMediaList, tab])

  const previewDisplayTotalCount = useMemo(() => {
    if (tab !== 'groups' || !activePreviewGroupPath) {
      return undefined
    }

    if (activePreviewGroupTotalCount !== null) {
      return activePreviewGroupTotalCount
    }

    const activeGroup = localGroups.find((group) => group.groupPath === activePreviewGroupPath)
    return activeGroup ? resolveGroupDisplayCount(activeGroup, appliedGroupViewedFilter) : undefined
  }, [activePreviewGroupPath, activePreviewGroupTotalCount, appliedGroupViewedFilter, localGroups, tab])

  const hasPendingViewedFilterChanges = useMemo(() => {
    return viewedDraftMediaTypeFilter !== appliedViewedMediaTypeFilter
      || JSON.stringify(selectedRatings) !== JSON.stringify(appliedViewedRatings)
      || JSON.stringify(selectedTags) !== JSON.stringify(appliedViewedTags)
  }, [appliedViewedMediaTypeFilter, appliedViewedRatings, appliedViewedTags, selectedRatings, selectedTags, viewedDraftMediaTypeFilter])

  const hasPendingGroupFilterChanges = useMemo(() => {
    return groupDraftViewedFilter !== appliedGroupViewedFilter
      || JSON.stringify(groupSelectedRatings) !== JSON.stringify(appliedGroupRatings)
      || JSON.stringify(groupSelectedTags) !== JSON.stringify(appliedGroupTags)
  }, [appliedGroupRatings, appliedGroupTags, appliedGroupViewedFilter, groupDraftViewedFilter, groupSelectedRatings, groupSelectedTags])

  const displayedMediaTypeFilter = tab === 'viewed' ? viewedDraftMediaTypeFilter : mediaTypeFilter

  const syncPreviewList = useCallback((list: CreatorMediaCard[]) => {
    if (!previewOpen || tab === 'groups' || list.length === 0) return
    if (previewList.length === 0) {
      onPreviewListChange(list)
      return
    }

    const previewIdSet = new Set(previewList.map((item) => item.id))
    const appendedItems = list.filter((item) => !previewIdSet.has(item.id))
    if (appendedItems.length === 0) return

    onPreviewListChange([...previewList, ...appendedItems])
  }, [onPreviewListChange, previewList, previewOpen, tab])

  useEffect(() => {
    syncPreviewList(activePreviewList)
  }, [activePreviewList, syncPreviewList])

  useEffect(() => {
    if (!previewOpen || tab !== 'groups') {
      setActivePreviewGroupPath(null)
      setActivePreviewGroupTotalCount(null)
      groupPreviewHalfLoadTriggeredPageRef.current = {}
    }
  }, [previewOpen, tab])

  useEffect(() => {
    groupMediaRequestIdRef.current = {}
    groupMediaLoadingRef.current = {}
    groupPreviewHalfLoadTriggeredPageRef.current = {}
    setGroupMediaMap({})
  }, [groupFilterKey])

  useEffect(() => {
    if (!open || !creatorId || bootstrapLoading) return
    if (loadError) return
    if (tab !== 'viewed') return
    if (!tabInitialized.viewed) return
    if (viewedFilterKeyRef.current === viewedFilterKey) return

    const sessionId = activeRequestIdRef.current
    const requestId = tabRequestIdRef.current.viewed + 1
    tabRequestIdRef.current.viewed = requestId

    viewedFilterKeyRef.current = viewedFilterKey
    setLoadingTab((prev) => ({ ...prev, viewed: true }))
    setLoadingMoreTab('viewed')
    setTabInitialized((prev) => ({ ...prev, viewed: false }))
    setTabPages((prev) => ({ ...prev, viewed: 0 }))
    setTabHasMore((prev) => ({ ...prev, viewed: summaryCounts.viewedTotal > 0 }))

    ;(async () => {
      try {
        await fetchTabPage(creatorId, 'viewed', 1, {
          reset: true,
          mediaType: appliedViewedMediaTypeFilter,
          ratings: appliedViewedRatings,
          tags: appliedViewedTags,
          requestId,
          sessionId,
        })
      } catch (error) {
        console.error('[CreatorDetailDrawer] 重置已看分页失败:', error)
        onError?.(getErrorMessage(error, '重置已看分页失败'))
      } finally {
        if (activeRequestIdRef.current === sessionId && tabRequestIdRef.current.viewed === requestId) {
          setLoadingTab((prev) => ({ ...prev, viewed: false }))
          setLoadingMoreTab((prev) => (prev === 'viewed' ? null : prev))
        }
      }
    })()
  }, [appliedViewedMediaTypeFilter, appliedViewedRatings, appliedViewedTags, bootstrapLoading, creatorId, fetchTabPage, loadError, onError, open, summaryCounts.viewedTotal, tab, tabInitialized.viewed, viewedFilterKey])

  useEffect(() => {
    if (!open || !creatorId || bootstrapLoading) return
    if (loadError) return
    if (tab !== 'unviewed') return
    if (!tabInitialized.unviewed) return
    if (unviewedFilterKeyRef.current === unviewedFilterKey) return

    const sessionId = activeRequestIdRef.current
    const requestId = tabRequestIdRef.current.unviewed + 1
    tabRequestIdRef.current.unviewed = requestId

    unviewedFilterKeyRef.current = unviewedFilterKey
    setLoadingTab((prev) => ({ ...prev, unviewed: true }))
    setLoadingMoreTab('unviewed')
    setTabInitialized((prev) => ({ ...prev, unviewed: false }))
    setTabPages((prev) => ({ ...prev, unviewed: 0 }))
    setTabHasMore((prev) => ({ ...prev, unviewed: summaryCounts.unviewedTotal > 0 }))

    ;(async () => {
      try {
        await fetchTabPage(creatorId, 'unviewed', 1, {
          reset: true,
          mediaType: mediaTypeFilter,
          ratings: [],
          tags: [],
          requestId,
          sessionId,
        })
      } catch (error) {
        console.error('[CreatorDetailDrawer] 重置未看分页失败:', error)
        onError?.(getErrorMessage(error, '重置未看分页失败'))
      } finally {
        if (activeRequestIdRef.current === sessionId && tabRequestIdRef.current.unviewed === requestId) {
          setLoadingTab((prev) => ({ ...prev, unviewed: false }))
          setLoadingMoreTab((prev) => (prev === 'unviewed' ? null : prev))
        }
      }
    })()
  }, [bootstrapLoading, creatorId, fetchTabPage, loadError, mediaTypeFilter, onError, open, summaryCounts.unviewedTotal, tab, tabInitialized.unviewed, unviewedFilterKey])

  useEffect(() => {
    if (!open || !creatorId || bootstrapLoading) return
    if (loadError) return
    if (tab !== 'groups') return
    if (!tabInitialized.groups) return
    if (groupFilterKeyRef.current === groupFilterKey) return

    const sessionId = activeRequestIdRef.current
    const requestId = tabRequestIdRef.current.groups + 1
    tabRequestIdRef.current.groups = requestId

    groupFilterKeyRef.current = groupFilterKey
    setLoadingTab((prev) => ({ ...prev, groups: true }))
    setLoadingMoreTab('groups')
    setTabInitialized((prev) => ({ ...prev, groups: false }))
    setTabPages((prev) => ({ ...prev, groups: 0 }))
    setTabHasMore((prev) => ({ ...prev, groups: summaryCounts.groupTotal > 0 }))

    ;(async () => {
      try {
        await fetchTabPage(creatorId, 'groups', 1, {
          reset: true,
          viewedState: appliedGroupViewedFilter,
          ratings: appliedGroupRatings,
          tags: appliedGroupTags,
          requestId,
          sessionId,
        })
      } catch (error) {
        console.error('[CreatorDetailDrawer] 重置图组分页失败:', error)
        onError?.(getErrorMessage(error, '重置图组分页失败'))
      } finally {
        if (activeRequestIdRef.current === sessionId && tabRequestIdRef.current.groups === requestId) {
          setLoadingTab((prev) => ({ ...prev, groups: false }))
          setLoadingMoreTab((prev) => (prev === 'groups' ? null : prev))
        }
      }
    })()
  }, [appliedGroupRatings, appliedGroupTags, appliedGroupViewedFilter, bootstrapLoading, creatorId, fetchTabPage, groupFilterKey, loadError, onError, open, summaryCounts.groupTotal, tab, tabInitialized.groups])

  const requestPreviewWarmUp = useCallback((item?: { fileType?: string; mediaType?: string | null }) => {
    if (!item) return
    const targetMediaType = item.mediaType === 'stream-video' || item.mediaType === 'small-video'
      ? item.mediaType
      : item.fileType === 'video'
        ? 'small-video'
        : null

    if (!targetMediaType) return

    if (targetMediaType === 'stream-video') {
      // 仿照主页面大视频模式，必须在当前点击/触摸手势链路内直接调用
      // [`InstantVideoPlayerRef.warmUp()`](components/InstantVideoPlayer.tsx:57)，
      // 避免延后到 effect 中再设置音频激活标记，导致首帧播放后立刻被浏览器暂停。
      previewInstantVideoRef.current?.warmUp?.()
      return
    }

    previewContainerRef.current?.warmUp(targetMediaType)
    setPreviewWarmUpToken((value) => value + 1)
  }, [])

  const openPreviewWithWarmUp = useCallback((item: CreatorMediaCard, list: CreatorMediaCard[]) => {
    // 仿照主页面大视频模式：先把目标预览同步挂载出来，确保
    // [`InstantVideoPlayer`](components/InstantVideoPlayer.tsx) 实例已经建立，
    // 再在同一次用户手势中立即调用 [`InstantVideoPlayerRef.warmUp()`](components/InstantVideoPlayer.tsx:57)。
    // 否则首次点开大视频时，warmUp 会因为播放器尚未挂载而落空，随后自动播放会被浏览器立刻打断。
    flushSync(() => {
      onPreviewMedia(item, list)
    })

    requestPreviewWarmUp(item)

    if (item.mediaType === 'stream-video') {
      // 继续沿用大视频模式“维持同一个播放器实例”的思路：
      // 在预览已经同步挂载、src 已切到目标大视频之后，直接在当前用户手势链路内
      // 主动调用 [`InstantVideoPlayerRef.play()`](components/InstantVideoPlayer.tsx:49)。
      // 这样浏览器会把首次播放视为用户触发，而不是等到 metadata/canplay 阶段再走
      // 自动播放兜底，从而避开“先静音回退、随后又自动解除静音导致立刻暂停”的路径。
      const playResult = previewInstantVideoRef.current?.play?.()
      if (playResult && typeof playResult.catch === 'function') {
        playResult.catch(() => {})
      }
    }
  }, [onPreviewMedia, requestPreviewWarmUp])

  const handleOpenGroupPreview = useCallback((group: CreatorGroupCard) => {
    if (!creatorId) return

    flushSync(() => {
      setActivePreviewGroupPath(group.groupPath)
      setActivePreviewGroupTotalCount(resolveGroupDisplayCount(group, appliedGroupViewedFilter))
    })

    const groupState = groupMediaMap[group.groupPath]
    const cachedItems = groupState?.items || []
    const initialItem = resolveGroupPreviewEntryItem(group, cachedItems)

    if (initialItem) {
      const initialPreviewList = cachedItems.length > 0
        ? buildGroupPreviewItems(cachedItems, initialItem)
        : [initialItem]
      openPreviewWithWarmUp(initialItem, initialPreviewList)
    }

    if (groupState?.loading || groupMediaLoadingRef.current[group.groupPath]) return

    const sessionId = activeRequestIdRef.current
    const requestId = (groupMediaRequestIdRef.current[group.groupPath] || 0) + 1
    groupMediaRequestIdRef.current[group.groupPath] = requestId
    groupMediaLoadingRef.current[group.groupPath] = true

    setGroupMediaMap((prev) => ({
      ...prev,
      [group.groupPath]: {
        ...(prev[group.groupPath] || { items: [], page: 0, hasMore: true, loading: false }),
        loading: true,
      },
    }))

    ;(async () => {
      try {
        const result = await fetchGroupMediaPage(creatorId, group.groupPath, 1, true, appliedGroupViewedFilter, requestId, sessionId)
        if (!result) return

        setActivePreviewGroupTotalCount(result.total)

        const nextInitialItem = resolveGroupPreviewEntryItem(group, result.items)
        const firstPagePreviewItems = buildGroupPreviewItems(result.items, nextInitialItem)
        if (firstPagePreviewItems.length === 0) return

        if (initialItem) {
          // 图组点开后先保持与卡片预览一致的首图，再在后台补齐首批 10 条数据。
          // 首批返回后只替换列表，不重新切换当前媒体，避免全屏首图发生跳变。
          if (!isSameMediaIdList(previewList, firstPagePreviewItems)) {
            onPreviewListChange(firstPagePreviewItems)
          }
          return
        }

        openPreviewWithWarmUp(nextInitialItem || firstPagePreviewItems[0], firstPagePreviewItems)
      } catch (error) {
        groupMediaLoadingRef.current[group.groupPath] = false
        console.error('[CreatorDetailDrawer] 打开图组预览失败:', error)
        onError?.(getErrorMessage(error, '打开图组预览失败'))
        if (activeRequestIdRef.current === sessionId && groupMediaRequestIdRef.current[group.groupPath] === requestId) {
          setGroupMediaMap((prev) => ({
            ...prev,
            [group.groupPath]: {
              ...(prev[group.groupPath] || { items: [], page: 0, hasMore: true, loading: false }),
              loading: false,
            },
          }))
        }
      }
    })()
  }, [appliedGroupViewedFilter, creatorId, fetchGroupMediaPage, groupMediaMap, onError, onPreviewListChange, openPreviewWithWarmUp])

  const handlePrimeGroupPreview = useCallback((group: CreatorGroupCard) => {
    const groupItems = groupMediaMap[group.groupPath]?.items || []
    const initialItem = group.previewSeed
      || (group.coverFilePath
        ? groupItems.find((item) => item.filePath === group.coverFilePath) || groupItems[0]
        : groupItems[0])

    requestPreviewWarmUp(initialItem)
  }, [groupMediaMap, requestPreviewWarmUp])

  const loadMorePreviewItems = useCallback(async () => {
    if (!creatorId) return

    if (tab === 'groups') {
      const currentGroup = activePreviewGroupPath || previewMedia?.groupPath
      if (!currentGroup) return
      const groupState = groupMediaMap[currentGroup]
      if (!groupState?.hasMore || groupState.loading) return

      const sessionId = activeRequestIdRef.current
      const requestId = (groupMediaRequestIdRef.current[currentGroup] || 0) + 1
      groupMediaRequestIdRef.current[currentGroup] = requestId
      groupMediaLoadingRef.current[currentGroup] = true

      setGroupMediaMap((prev) => ({
        ...prev,
        [currentGroup]: {
          ...(prev[currentGroup] || { items: [], page: 0, hasMore: true, loading: false }),
          loading: true,
        },
      }))

      try {
        const result = await fetchGroupMediaPage(creatorId, currentGroup, (groupState.page || 0) + 1, false, appliedGroupViewedFilter, requestId, sessionId)
        if (!result) return
        setActivePreviewGroupTotalCount(result.total)
        // 关键：补页后不要重排/旋转列表，否则外部仅用 index 驱动的预览会发生“跳片”。
        // 这里以当前的 previewList 顺序为准做稳定追加，保证 previewIndex 仍然指向同一条媒体。
        const baseList = previewList.length > 0 ? previewList : (groupState.items || [])
        const nextList = mergeUniqueById([...baseList, ...result.items])
        onPreviewListChange(nextList)
      } catch (error) {
        groupMediaLoadingRef.current[currentGroup] = false
        console.error('[CreatorDetailDrawer] 图组预览补页失败:', error)
        onError?.(getErrorMessage(error, '图组预览补页失败'))
        if (activeRequestIdRef.current === sessionId && groupMediaRequestIdRef.current[currentGroup] === requestId) {
          setGroupMediaMap((prev) => ({
            ...prev,
            [currentGroup]: {
              ...(prev[currentGroup] || { items: [], page: 0, hasMore: true, loading: false }),
              loading: false,
            },
          }))
        }
      }
      return
    }

    if (loadingTab[tab] || loadingMoreTab === tab || !tabHasMore[tab]) return

    const targetTab = tab
    const sessionId = activeRequestIdRef.current
    const requestId = tabRequestIdRef.current[targetTab] + 1
    tabRequestIdRef.current[targetTab] = requestId

    setLoadingTab((prev) => ({ ...prev, [targetTab]: true }))
    setLoadingMoreTab(targetTab)

    try {
      await fetchTabPage(creatorId, targetTab, (tabPages[targetTab] || 0) + 1, {
        mediaType: targetTab === 'viewed' ? appliedViewedMediaTypeFilter : mediaTypeFilter,
        ratings: targetTab === 'viewed' ? appliedViewedRatings : [],
        tags: targetTab === 'viewed' ? appliedViewedTags : [],
        requestId,
        sessionId,
      })
    } catch (error) {
      console.error('[CreatorDetailDrawer] 预览补页失败:', error)
      onError?.(getErrorMessage(error, '预览补页失败'))
    } finally {
      if (activeRequestIdRef.current === sessionId && tabRequestIdRef.current[targetTab] === requestId) {
        setLoadingTab((prev) => ({ ...prev, [targetTab]: false }))
        setLoadingMoreTab((prev) => (prev === targetTab ? null : prev))
      }
    }
  }, [activePreviewGroupPath, appliedGroupViewedFilter, appliedViewedMediaTypeFilter, appliedViewedRatings, appliedViewedTags, creatorId, fetchGroupMediaPage, fetchTabPage, groupMediaMap, loadingMoreTab, loadingTab, mediaTypeFilter, onPreviewListChange, previewList, previewMedia, tab, tabHasMore, tabPages])

  const currentTabLoading = loadingTab[tab] || loadingMoreTab === tab
  const activePreviewGroupState = activePreviewGroupPath ? groupMediaMap[activePreviewGroupPath] : undefined

  useEffect(() => {
    if (!previewOpen) return
    if (previewSourceList.length === 0) return

    if (tab === 'groups') {
      const currentGroup = activePreviewGroupPath || previewMedia?.groupPath
      if (!currentGroup) return
      const groupState = groupMediaMap[currentGroup]
      if (!groupState?.hasMore || groupState.loading) return

      const loadedPage = Math.max(1, groupState.page || 1)
      const preloadTriggerIndex = Math.max(0, loadedPage * PAGE_SIZE - Math.ceil(PAGE_SIZE / 2) - 1)
      if (previewIndex < preloadTriggerIndex) return

      if ((groupPreviewHalfLoadTriggeredPageRef.current[currentGroup] || 0) >= loadedPage) {
        return
      }

      groupPreviewHalfLoadTriggeredPageRef.current[currentGroup] = loadedPage

      void loadMorePreviewItems()
      return
    }

    const preloadTriggerIndex = Math.max(0, previewSourceList.length - Math.ceil(PAGE_SIZE / 2))
    if (previewIndex < preloadTriggerIndex) return

    if (!tabHasMore[tab]) return
    void loadMorePreviewItems()
  }, [activePreviewGroupPath, groupMediaMap, loadMorePreviewItems, previewIndex, previewMedia?.groupPath, previewOpen, previewSourceList.length, tab, tabHasMore])

  const previewItems = useMemo<MediaExperienceItem[]>(() => {
    return previewSourceList.map((item) => {
      const directUrl = item.directUrl || buildDirectPath(item.filePath)
      const transcodeUrl = item.transcodeUrl || null

      let resolvedSrc = item.streamUrl || item.previewUrl || directUrl || ''

      if (item.mediaType === 'small-video') {
        resolvedSrc = effectivePreviewPlayMode === 'direct'
          ? (directUrl || item.streamUrl || item.previewUrl || '')
          : effectivePreviewPlayMode === 'transcode' && transcodeUrl
            ? transcodeUrl
            : (item.streamUrl || item.previewUrl || directUrl || '')
      }

      if (item.mediaType === 'stream-video') {
        resolvedSrc = effectivePreviewPlayMode === 'direct'
          ? (directUrl || item.streamUrl || item.previewUrl || '')
          : effectivePreviewPlayMode === 'transcode' && transcodeUrl
            ? transcodeUrl
            : (item.streamUrl || directUrl || item.previewUrl || '')
      }

      if (item.mediaType === 'image') {
        resolvedSrc = item.previewUrl || ''
      }

      return {
        id: item.id,
        title: item.basename,
        subtitle: null,
        mediaType: item.mediaType || (item.fileType === 'image' ? 'image' : 'stream-video'),
        src: resolvedSrc,
        previewSrc: item.previewUrl || null,
        transcodeUrl,
        directUrl,
        filePath: item.filePath,
        rating: item.rating,
        tags: [...(item.customEvaluation || []), ...(item.category || [])],
      }
    })
  }, [effectivePreviewPlayMode, previewSourceList])

  const resolvePreviewExternalUrl = useCallback((mode: CreatorPreviewPlayMode) => {
    if (!previewMedia) {
      return ''
    }

    const rawUrl = mode === 'direct'
      ? (previewMedia.directUrl || previewMedia.streamUrl || previewMedia.previewUrl || '')
      : mode === 'transcode'
        ? (previewMedia.transcodeUrl || previewMedia.streamUrl || previewMedia.directUrl || '')
        : (previewMedia.streamUrl || previewMedia.previewUrl || previewMedia.directUrl || '')

    return rawUrl ? new URL(rawUrl, window.location.origin).href : ''
  }, [previewMedia])

  const handlePreviewExternalModeSelect = useCallback((mode: CreatorPreviewPlayMode) => {
    setPreviewPlayMode(mode)
    setPreviewPlayModeFilePath(previewMedia?.filePath || null)
    setShowPlayModeSelector(false)

    if (!isMobile) {
      return
    }

    setExternalPlayerAnchor(null)
    const url = resolvePreviewExternalUrl(mode)
    if (url) {
      openExternalPlayerUrl(url, 'system')
    }
  }, [isMobile, resolvePreviewExternalUrl])

  const previewCenterOverlay = showPlayModeSelector && previewMedia?.fileType === 'video' ? (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(10px)',
        zIndex: 2204,
      }}
      onClick={() => setShowPlayModeSelector(false)}
    >
      <Box
        sx={{
          backgroundColor: '#16213e',
          borderRadius: 3,
          padding: 3,
          minWidth: { xs: 300, sm: 500 },
          maxWidth: 600,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <Typography variant="h6" sx={{ color: '#e94560', fontWeight: 'bold', mb: 3, textAlign: 'center' }}>
          选择播放方式
        </Typography>
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <Button
            variant="outlined"
            fullWidth
            size="large"
            onClick={() => handlePreviewExternalModeSelect('webdav')}
            sx={{ borderColor: '#4ade80', color: '#4ade80', py: 2, fontSize: '1rem', fontWeight: 'bold' }}
          >
            WebDAV<br />播放
          </Button>
          <Button
            variant="outlined"
            fullWidth
            size="large"
            onClick={() => handlePreviewExternalModeSelect('direct')}
            sx={{ borderColor: '#2196f3', color: '#2196f3', py: 2, fontSize: '1rem', fontWeight: 'bold' }}
          >
            直链<br />播放
          </Button>
          <Button
            variant="outlined"
            fullWidth
            size="large"
            onClick={() => handlePreviewExternalModeSelect('transcode')}
            sx={{ borderColor: '#e94560', color: '#e94560', py: 2, fontSize: '1rem', fontWeight: 'bold' }}
          >
            转码<br />播放
          </Button>
        </Stack>
        <Button fullWidth onClick={() => setShowPlayModeSelector(false)} sx={{ color: '#888' }}>
          取消
        </Button>
      </Box>
    </Box>
  ) : null

  /**
   * 加载更多内容
   * 使用延迟模拟加载效果，防止快速滚动时频繁触发
   */
  const handleLoadMore = useCallback(async () => {
    if (!creatorId || currentTabLoading) return
    if (!tabHasMore[tab]) return

    const targetTab = tab
    const sessionId = activeRequestIdRef.current
    const requestId = tabRequestIdRef.current[targetTab] + 1
    tabRequestIdRef.current[targetTab] = requestId

    setLoadingTab((prev) => ({ ...prev, [targetTab]: true }))
    setLoadingMoreTab(targetTab)

    try {
      if (targetTab === 'groups') {
        await fetchTabPage(creatorId, 'groups', (tabPages.groups || 0) + 1, {
          viewedState: appliedGroupViewedFilter,
          ratings: appliedGroupRatings,
          tags: appliedGroupTags,
          requestId,
          sessionId,
        })
      } else {
        await fetchTabPage(creatorId, targetTab, (tabPages[targetTab] || 0) + 1, {
          mediaType: targetTab === 'viewed' ? appliedViewedMediaTypeFilter : mediaTypeFilter,
          ratings: targetTab === 'viewed' ? appliedViewedRatings : [],
          tags: targetTab === 'viewed' ? appliedViewedTags : [],
          requestId,
          sessionId,
        })
      }
    } catch (error) {
      console.error('[CreatorDetailDrawer] 列表触底补页失败:', error)
      onError?.(getErrorMessage(error, '加载更多失败'))
    } finally {
      if (activeRequestIdRef.current === sessionId && tabRequestIdRef.current[targetTab] === requestId) {
        setLoadingTab((prev) => ({ ...prev, [targetTab]: false }))
        setLoadingMoreTab((prev) => (prev === targetTab ? null : prev))
      }
    }
  }, [appliedGroupRatings, appliedGroupTags, appliedGroupViewedFilter, appliedViewedMediaTypeFilter, appliedViewedRatings, appliedViewedTags, creatorId, currentTabLoading, fetchTabPage, mediaTypeFilter, tab, tabHasMore, tabPages])

  /**
   * 处理列表滚动事件
   * 当滚动到底部附近时触发加载更多
   */
  const handleListScroll = useCallback(() => {
    const container = listContainerRef.current
    if (!container || currentTabLoading) return

    const currentTop = container.scrollTop
    pendingListScrollTopRef.current = currentTop

    if (scrollAnimationFrameRef.current === null) {
      scrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
        scrollAnimationFrameRef.current = null
        const nextTop = pendingListScrollTopRef.current
        const previousTop = lastListScrollTopRef.current
        const delta = nextTop - previousTop

        lastListScrollTopRef.current = nextTop

        if (headerToggleTimeoutRef.current !== null) {
          window.clearTimeout(headerToggleTimeoutRef.current)
          headerToggleTimeoutRef.current = null
        }

        headerToggleTimeoutRef.current = window.setTimeout(() => {
          headerToggleTimeoutRef.current = null
          const isCondensed = headerCondensedRef.current
          const settledTop = pendingListScrollTopRef.current

          if (settledTop <= 12) {
            if (isCondensed) {
              headerCondensedRef.current = false
              setHeaderCondensed(false)
            }
            return
          }

          if (!isCondensed && settledTop >= 88 && delta > 0) {
            headerCondensedRef.current = true
            setHeaderCondensed(true)
            return
          }

          if (isCondensed && settledTop <= 40 && delta < 0) {
            headerCondensedRef.current = false
            setHeaderCondensed(false)
          }
        }, 90)
      })
    }

    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight
    // 距离底部 120px 时触发加载更多
    if (remaining <= 120) {
      void handleLoadMore()
    }
  }, [currentTabLoading, handleLoadMore])

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: '100%',
          maxWidth: 480,
          background: 'linear-gradient(180deg, #0f172a 0%, #111827 100%)',
          color: '#fff',
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            px: 2,
            pt: 1.25,
            pb: 1,
            backgroundColor: 'rgba(15,23,42,0.98)',
          }}
        >
          <Box
            sx={{
              position: 'relative',
              height: headerCondensed ? HEADER_CONDENSED_HEIGHT : HEADER_EXPANDED_HEIGHT,
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: headerCondensed ? 'none' : 'block',
                overflow: 'hidden',
                borderRadius: 3,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'linear-gradient(180deg, rgba(33,36,53,0.98) 0%, rgba(19,23,35,0.98) 100%)',
                boxShadow: '0 14px 32px rgba(0,0,0,0.24)',
              }}
            >
              <Box sx={{ height: 76, background: 'linear-gradient(135deg, rgba(255,61,108,0.32) 0%, rgba(131,56,236,0.2) 38%, rgba(34,211,238,0.16) 100%)' }} />
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background: 'radial-gradient(circle at top right, rgba(255,255,255,0.14), transparent 32%)',
                  pointerEvents: 'none',
                }}
              />

              <IconButton
                onClick={onClose}
                sx={{
                  color: '#fff',
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  zIndex: 1,
                  bgcolor: 'rgba(0,0,0,0.28)',
                }}
              >
                <ArrowBackIcon />
              </IconButton>

              <Box sx={{ px: 2, pb: 1.6, mt: -2.05 }}>
                <Stack direction="row" spacing={1.5} alignItems="flex-end">
                  <Avatar
                    src={localCreator?.avatarPath || undefined}
                    onClick={() => localCreator?.avatarPath && setAvatarPreviewOpen(true)}
                    sx={{
                      width: 78,
                      height: 78,
                      flexShrink: 0,
                      bgcolor: 'rgba(255,255,255,0.08)',
                      border: '3px solid rgba(15,23,42,0.95)',
                      boxShadow: '0 10px 24px rgba(0,0,0,0.24)',
                      cursor: localCreator?.avatarPath ? 'pointer' : 'default',
                    }}
                  >
                    {localCreator?.primaryName?.slice(0, 1) || '博'}
                  </Avatar>

                  <Box sx={{ minWidth: 0, flex: 1, pb: 0.2 }}>
                    <Typography
                      variant="h5"
                      sx={{
                        fontWeight: 800,
                        lineHeight: 1.12,
                        letterSpacing: '-0.01em',
                        wordBreak: 'break-word',
                        fontSize: '1.5rem',
                      }}
                    >
                      {localCreator?.primaryName || '博主详情'}
                    </Typography>

                    <Stack direction="row" spacing={1.2} useFlexGap sx={{ mt: 1, flexWrap: 'wrap', color: 'rgba(255,255,255,0.78)' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        作品 {summaryCounts.mediaTotal}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.22)' }}>|</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        已看 {summaryCounts.viewedTotal}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.22)' }}>|</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        图组 {summaryCounts.groupTotal}
                      </Typography>
                    </Stack>
                  </Box>
                </Stack>

                <Box sx={{ mt: 1.6 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      color: 'rgba(255,255,255,0.76)',
                      lineHeight: 1.5,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      minHeight: '3em',
                    }}
                  >
                    {localCreator?.bio?.trim() || '暂无简介'}
                  </Typography>

                  {localCreator?.otherNames?.length ? (
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.9,
                        minWidth: 0,
                        mt: 1.15,
                      }}
                    >
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.44)', flexShrink: 0 }}>
                        别名
                      </Typography>
                      <Box
                        sx={{
                          minWidth: 0,
                          flex: 1,
                          overflowX: 'auto',
                          overflowY: 'hidden',
                          WebkitOverflowScrolling: 'touch',
                          '&::-webkit-scrollbar': { display: 'none' },
                          scrollbarWidth: 'none',
                        }}
                      >
                        <Stack direction="row" spacing={0.7} sx={{ width: 'max-content', pr: 0.5 }}>
                          {localCreator.otherNames.map((alias) => (
                            <Chip
                              key={alias}
                              label={alias}
                              size="small"
                              sx={{
                                height: 24,
                                bgcolor: 'rgba(255,255,255,0.08)',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.08)',
                                '& .MuiChip-label': { px: 1.1 },
                              }}
                            />
                          ))}
                        </Stack>
                      </Box>
                    </Box>
                  ) : null}
                </Box>

                <Stack direction="row" spacing={1.25} sx={{ mt: 1.5 }}>
                  <Box
                    onClick={() => setCreatorInfoDialogOpen(true)}
                    sx={{
                      flex: 1,
                      px: 1.4,
                      py: 1.15,
                      borderRadius: 3,
                      bgcolor: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      userSelect: 'none',
                      boxShadow: '0 8px 22px rgba(0,0,0,0.16)',
                      '&:active': {
                        backgroundColor: 'rgba(255,255,255,0.06)',
                      },
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.56)', display: 'block', mb: 0.35, letterSpacing: '0.04em' }}>颜值评分</Typography>
                    {renderStars(localCreator?.appearanceRating)}
                  </Box>
                  <Box
                    onClick={() => setCreatorInfoDialogOpen(true)}
                    sx={{
                      flex: 1,
                      px: 1.4,
                      py: 1.15,
                      borderRadius: 3,
                      bgcolor: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      userSelect: 'none',
                      boxShadow: '0 8px 22px rgba(0,0,0,0.16)',
                      '&:active': {
                        backgroundColor: 'rgba(255,255,255,0.06)',
                      },
                    }}
                  >
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.56)', display: 'block', mb: 0.35, letterSpacing: '0.04em' }}>身材评分</Typography>
                    {renderStars(localCreator?.bodyRating)}
                  </Box>
                </Stack>
              </Box>
            </Box>

            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: headerCondensed ? 'block' : 'none',
                overflow: 'hidden',
                borderRadius: 3,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'linear-gradient(180deg, rgba(33,36,53,0.98) 0%, rgba(19,23,35,0.98) 100%)',
                boxShadow: '0 14px 32px rgba(0,0,0,0.24)',
              }}
            >
              <IconButton
                onClick={onClose}
                sx={{
                  color: '#fff',
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  zIndex: 1,
                  bgcolor: 'rgba(0,0,0,0.28)',
                }}
              >
                <ArrowBackIcon />
              </IconButton>

              <Box
                sx={{
                  height: '100%',
                  px: 2,
                  py: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
                  <Avatar
                    src={localCreator?.avatarPath || undefined}
                    onClick={() => localCreator?.avatarPath && setAvatarPreviewOpen(true)}
                    sx={{
                      width: 56,
                      height: 56,
                      flexShrink: 0,
                      bgcolor: 'rgba(255,255,255,0.08)',
                      border: '2px solid rgba(15,23,42,0.95)',
                      cursor: localCreator?.avatarPath ? 'pointer' : 'default',
                    }}
                  >
                    {localCreator?.primaryName?.slice(0, 1) || '博'}
                  </Avatar>

                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography
                      variant="subtitle1"
                      sx={{
                        fontWeight: 800,
                        lineHeight: 1.15,
                        letterSpacing: '-0.01em',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {localCreator?.primaryName || '博主详情'}
                    </Typography>

                    <Stack direction="row" spacing={0.9} useFlexGap sx={{ mt: 0.6, flexWrap: 'wrap', color: 'rgba(255,255,255,0.76)' }}>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        作品 {summaryCounts.mediaTotal}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.22)' }}>|</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        已看 {summaryCounts.viewedTotal}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.22)' }}>|</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        图组 {summaryCounts.groupTotal}
                      </Typography>
                    </Stack>

                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 0.85, flexWrap: 'wrap' }}>
                      <Chip
                        label={`颜值 ${localCreator?.appearanceRating ?? '-'}`}
                        size="small"
                        sx={{
                          height: 22,
                          bgcolor: 'rgba(255,255,255,0.08)',
                          color: '#fff',
                          border: '1px solid rgba(255,255,255,0.08)',
                          '& .MuiChip-label': { px: 0.9 },
                        }}
                      />
                      <Chip
                        label={`身材 ${localCreator?.bodyRating ?? '-'}`}
                        size="small"
                        sx={{
                          height: 22,
                          bgcolor: 'rgba(255,255,255,0.08)',
                          color: '#fff',
                          border: '1px solid rgba(255,255,255,0.08)',
                          '& .MuiChip-label': { px: 0.9 },
                        }}
                      />
                    </Stack>
                  </Box>
                </Stack>
              </Box>
            </Box>
          </Box>
        </Box>

        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          variant="fullWidth"
          sx={{
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            '& .MuiTab-root': { color: 'rgba(255,255,255,0.62)', fontWeight: 700 },
            '& .Mui-selected': { color: '#fff !important' },
            '& .MuiTabs-indicator': { backgroundColor: '#ec4899', height: 3, borderRadius: 3 },
          }}
        >
          <Tab value="viewed" label={`已看过 ${summaryCounts.viewedTotal}`} />
          <Tab value="unviewed" label={`未看过 ${summaryCounts.unviewedTotal}`} />
          <Tab value="groups" label={`图组 ${summaryCounts.groupTotal}`} />
        </Tabs>

        {(tab === 'viewed' || tab === 'unviewed' || tab === 'groups') && (
          <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
            <Stack spacing={1.5}>
              {tab === 'viewed' && (
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.62)', fontWeight: 700, letterSpacing: '0.04em' }}>
                    已看过筛选
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={viewedFiltersExpanded ? '收起筛选' : '展开筛选'}
                    onClick={() => setViewedFiltersExpanded((prev) => !prev)}
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1.5,
                      color: '#fff',
                      bgcolor: viewedFiltersExpanded ? 'rgba(236,72,153,0.18)' : 'rgba(255,255,255,0.08)',
                      border: '1px solid',
                      borderColor: viewedFiltersExpanded ? 'rgba(236,72,153,0.38)' : 'rgba(255,255,255,0.12)',
                    }}
                  >
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.4 }}>
                      <Box sx={{ width: 14, height: 2, borderRadius: 999, bgcolor: 'currentColor' }} />
                      <Box sx={{ width: 10, height: 2, borderRadius: 999, bgcolor: 'currentColor' }} />
                      <Box sx={{ width: 6, height: 2, borderRadius: 999, bgcolor: 'currentColor' }} />
                    </Box>
                  </IconButton>
                </Stack>
              )}

              {tab === 'groups' && (
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.62)', fontWeight: 700, letterSpacing: '0.04em' }}>
                    图组筛选
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={groupFiltersExpanded ? '收起筛选' : '展开筛选'}
                    onClick={() => setGroupFiltersExpanded((prev) => !prev)}
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1.5,
                      color: '#fff',
                      bgcolor: groupFiltersExpanded ? 'rgba(236,72,153,0.18)' : 'rgba(255,255,255,0.08)',
                      border: '1px solid',
                      borderColor: groupFiltersExpanded ? 'rgba(236,72,153,0.38)' : 'rgba(255,255,255,0.12)',
                    }}
                  >
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.4 }}>
                      <Box sx={{ width: 14, height: 2, borderRadius: 999, bgcolor: 'currentColor' }} />
                      <Box sx={{ width: 10, height: 2, borderRadius: 999, bgcolor: 'currentColor' }} />
                      <Box sx={{ width: 6, height: 2, borderRadius: 999, bgcolor: 'currentColor' }} />
                    </Box>
                  </IconButton>
                </Stack>
              )}

              {(tab === 'unviewed' || (tab === 'viewed' && viewedFiltersExpanded) || (tab === 'groups' && groupFiltersExpanded)) && (
                <Collapse in={tab === 'unviewed' || (tab === 'viewed' && viewedFiltersExpanded) || (tab === 'groups' && groupFiltersExpanded)} timeout="auto" unmountOnExit>
                  <Stack spacing={1.5}>
                    {tab !== 'groups' && (
                      <ToggleButtonGroup
                        exclusive
                        value={displayedMediaTypeFilter}
                        onChange={(_, value) => {
                          if (!value) return
                          if (tab === 'viewed') {
                            setViewedDraftMediaTypeFilter(value)
                            return
                          }
                          setMediaTypeFilter(value)
                        }}
                        size="small"
                        sx={{
                          flexWrap: 'wrap',
                          gap: 1,
                          '& .MuiToggleButton-root': {
                            borderRadius: '999px !important',
                            border: '1px solid rgba(255,255,255,0.16) !important',
                            color: 'rgba(255,255,255,0.7)',
                            px: 1.5,
                          },
                          '& .Mui-selected': {
                            backgroundColor: 'rgba(236,72,153,0.2) !important',
                            color: '#fff !important',
                            borderColor: 'rgba(236,72,153,0.5) !important',
                          },
                        }}
                      >
                        <ToggleButton value="all">全部</ToggleButton>
                        <ToggleButton value="image">图片</ToggleButton>
                        <ToggleButton value="video">视频</ToggleButton>
                        <ToggleButton value="small-video">小视频</ToggleButton>
                        <ToggleButton value="large-video">大视频</ToggleButton>
                      </ToggleButtonGroup>
                    )}

                    {tab === 'viewed' && (
                      <>
                        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                          {[1, 2, 3, 4, 5].map((rating) => {
                            const active = selectedRatings.includes(rating)
                            return (
                              <Chip
                                key={rating}
                                label={`${rating}星`}
                                onClick={() => setSelectedRatings((prev) => active ? prev.filter((item) => item !== rating) : [...prev, rating].sort())}
                                sx={{
                                  height: 34,
                                  fontWeight: 700,
                                  color: active ? '#fff' : 'rgba(255,255,255,0.82)',
                                  background: active ? 'linear-gradient(135deg, rgba(245,158,11,0.95), rgba(251,191,36,0.82))' : 'rgba(255,255,255,0.06)',
                                  border: '1px solid',
                                  borderColor: active ? 'rgba(251,191,36,0.95)' : 'rgba(255,255,255,0.12)',
                                }}
                              />
                            )
                          })}
                        </Stack>

                        {localAvailableTags.length > 0 && (
                          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            {localAvailableTags.map((tag) => {
                              const active = selectedTags.includes(tag)
                              return (
                                <Chip
                                  key={tag}
                                  label={tag}
                                  onClick={() => setSelectedTags((prev) => active ? prev.filter((item) => item !== tag) : [...prev, tag])}
                                  sx={{
                                    height: 32,
                                    fontWeight: 600,
                                    color: active ? '#fff' : 'rgba(255,255,255,0.78)',
                                    bgcolor: active ? 'rgba(59,130,246,0.24)' : 'rgba(255,255,255,0.04)',
                                    border: '1px solid',
                                    borderColor: active ? 'rgba(96,165,250,0.82)' : 'rgba(255,255,255,0.12)',
                                  }}
                                />
                              )
                            })}
                          </Stack>
                        )}

                        <Stack direction="row" spacing={1}>
                          <Button
                            variant="contained"
                            disabled={!hasPendingViewedFilterChanges}
                            onClick={() => {
                              setAppliedViewedRatings(selectedRatings)
                              setAppliedViewedTags(selectedTags)
                              setAppliedViewedMediaTypeFilter(viewedDraftMediaTypeFilter)
                            }}
                            sx={{ flex: 1, borderRadius: 999, fontWeight: 700, backgroundColor: '#ec4899' }}
                          >
                            应用筛选
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={() => {
                              setSelectedRatings([])
                              setSelectedTags([])
                              setViewedDraftMediaTypeFilter('all')
                              setAppliedViewedRatings([])
                              setAppliedViewedTags([])
                              setAppliedViewedMediaTypeFilter('all')
                            }}
                            sx={{ borderRadius: 999, fontWeight: 700, color: '#fff', borderColor: 'rgba(255,255,255,0.24)' }}
                          >
                            重置
                          </Button>
                        </Stack>
                      </>
                    )}

                    {tab === 'groups' && (
                      <>
                        <ToggleButtonGroup
                          exclusive
                          value={groupDraftViewedFilter}
                          onChange={(_, value) => {
                            if (!value) return
                            setGroupDraftViewedFilter(value)
                          }}
                          size="small"
                          sx={{
                            flexWrap: 'wrap',
                            gap: 1,
                            '& .MuiToggleButton-root': {
                              borderRadius: '999px !important',
                              border: '1px solid rgba(255,255,255,0.16) !important',
                              color: 'rgba(255,255,255,0.7)',
                              px: 1.5,
                            },
                            '& .Mui-selected': {
                              backgroundColor: 'rgba(236,72,153,0.2) !important',
                              color: '#fff !important',
                              borderColor: 'rgba(236,72,153,0.5) !important',
                            },
                          }}
                        >
                          <ToggleButton value="all">全部</ToggleButton>
                          <ToggleButton value="viewed">已看过</ToggleButton>
                          <ToggleButton value="unviewed">未看过</ToggleButton>
                        </ToggleButtonGroup>

                        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                          {[1, 2, 3, 4, 5].map((rating) => {
                            const active = groupSelectedRatings.includes(rating)
                            return (
                              <Chip
                                key={`group-rating-${rating}`}
                                label={`${rating}星`}
                                onClick={() => setGroupSelectedRatings((prev) => active ? prev.filter((item) => item !== rating) : [...prev, rating].sort())}
                                sx={{
                                  height: 34,
                                  fontWeight: 700,
                                  color: active ? '#fff' : 'rgba(255,255,255,0.82)',
                                  background: active ? 'linear-gradient(135deg, rgba(245,158,11,0.95), rgba(251,191,36,0.82))' : 'rgba(255,255,255,0.06)',
                                  border: '1px solid',
                                  borderColor: active ? 'rgba(251,191,36,0.95)' : 'rgba(255,255,255,0.12)',
                                }}
                              />
                            )
                          })}
                        </Stack>

                        {localAvailableTags.length > 0 && (
                          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            {localAvailableTags.map((tag) => {
                              const active = groupSelectedTags.includes(tag)
                              return (
                                <Chip
                                  key={`group-tag-${tag}`}
                                  label={tag}
                                  onClick={() => setGroupSelectedTags((prev) => active ? prev.filter((item) => item !== tag) : [...prev, tag])}
                                  sx={{
                                    height: 32,
                                    fontWeight: 600,
                                    color: active ? '#fff' : 'rgba(255,255,255,0.78)',
                                    bgcolor: active ? 'rgba(59,130,246,0.24)' : 'rgba(255,255,255,0.04)',
                                    border: '1px solid',
                                    borderColor: active ? 'rgba(96,165,250,0.82)' : 'rgba(255,255,255,0.12)',
                                  }}
                                />
                              )
                            })}
                          </Stack>
                        )}

                        <Stack direction="row" spacing={1}>
                          <Button
                            variant="contained"
                            disabled={!hasPendingGroupFilterChanges}
                            onClick={() => {
                              setAppliedGroupViewedFilter(groupDraftViewedFilter)
                              setAppliedGroupRatings(groupSelectedRatings)
                              setAppliedGroupTags(groupSelectedTags)
                            }}
                            sx={{ flex: 1, borderRadius: 999, fontWeight: 700, backgroundColor: '#ec4899' }}
                          >
                            应用筛选
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={() => {
                              setGroupDraftViewedFilter('all')
                              setGroupSelectedRatings([])
                              setGroupSelectedTags([])
                              setAppliedGroupViewedFilter('all')
                              setAppliedGroupRatings([])
                              setAppliedGroupTags([])
                            }}
                            sx={{ borderRadius: 999, fontWeight: 700, color: '#fff', borderColor: 'rgba(255,255,255,0.24)' }}
                          >
                            重置
                          </Button>
                        </Stack>
                      </>
                    )}
                  </Stack>
                </Collapse>
              )}
            </Stack>
          </Box>
        )}

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

        <Box ref={listContainerRef} onScroll={handleListScroll} sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
          {normalizedLoading || bootstrapLoading ? (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240 }} spacing={2}>
              <CircularProgress sx={{ color: '#ec4899' }} />
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.68)' }}>正在加载博主内容...</Typography>
            </Stack>
          ) : loadError ? (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240, textAlign: 'center', px: 2 }} spacing={2}>
              <Typography variant="body1" sx={{ color: '#fda4af', fontWeight: 700 }}>
                加载博主内容失败
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.68)' }}>
                {loadError}
              </Typography>
              <Button
                variant="contained"
                onClick={() => {
                  setLoadError(null)
                  setBootstrapRetryKey((value) => value + 1)
                }}
                sx={{ borderRadius: 999, fontWeight: 700, backgroundColor: '#ec4899' }}
              >
                重试
              </Button>
            </Stack>
          ) : tab === 'groups' ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
              {visibleGroups.map((group) => (
                <Box
                  key={group.id}
                  onMouseDown={() => handlePrimeGroupPreview(group)}
                  onTouchStart={() => handlePrimeGroupPreview(group)}
                  onClick={() => handleOpenGroupPreview(group)}
                  sx={{
                    overflow: 'hidden',
                    borderRadius: 2,
                    bgcolor: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    WebkitTouchCallout: 'none',
                    userSelect: 'none',
                    '&:active': {
                      backgroundColor: 'rgba(255,255,255,0.05)',
                    },
                  }}
                >
                  <Box sx={{ position: 'relative', aspectRatio: '3 / 4', bgcolor: '#111827' }}>
                    {group.coverPreviewUrl && !failedImages[group.groupPath] ? (
                      <Box
                        component="img"
                        src={group.coverPreviewUrl}
                        alt={group.groupName}
                        onError={() => setFailedImages((prev) => ({ ...prev, [group.groupPath]: true }))}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1, background: 'linear-gradient(180deg, rgba(30,41,59,1) 0%, rgba(15,23,42,1) 100%)' }}>
                        <CollectionsIcon sx={{ fontSize: 32, color: 'rgba(255,255,255,0.56)' }} />
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.56)' }}>暂无封面</Typography>
                      </Box>
                    )}
                    <Chip label={group.rating ? `${group.rating}星` : '未评分'} size="small" sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'rgba(0,0,0,0.55)', color: '#fff' }} />
                  </Box>
                  <Box sx={{ p: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
                      {group.groupName}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.62)' }}>
                      {appliedGroupViewedFilter === 'viewed'
                        ? `${resolveGroupDisplayCount(group, 'viewed')}已看过/${group.fileCount}总数`
                        : appliedGroupViewedFilter === 'unviewed'
                          ? `${resolveGroupDisplayCount(group, 'unviewed')}未看过/${group.fileCount}总数`
                          : `${group.fileCount} 个文件 · ${group.isViewed ? '已看过' : '未看过'}`}
                    </Typography>
                  </Box>
                </Box>
              ))}
              {visibleGroups.length === 0 && (
                <Box sx={{ gridColumn: '1 / -1', py: 8 }}>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.62)', textAlign: 'center' }}>
                    暂无图组内容
                  </Typography>
                </Box>
              )}
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
              {visibleCardList.map((item) => {
                const tags = [...(item.customEvaluation || []), ...(item.category || [])]
                return (
                  <Box
                    key={item.id}
                    onMouseDown={() => requestPreviewWarmUp(item)}
                    onTouchStart={() => requestPreviewWarmUp(item)}
                    onClick={() => {
                      openPreviewWithWarmUp(item, visibleCardList)
                    }}
                    sx={{
                      position: 'relative',
                      borderRadius: 2,
                      overflow: 'hidden',
                      bgcolor: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      WebkitTouchCallout: 'none',
                      userSelect: 'none',
                      '&:active': {
                        backgroundColor: 'rgba(255,255,255,0.05)',
                      },
                    }}
                  >
                    <Box sx={{ position: 'relative', aspectRatio: '3 / 4', bgcolor: '#111827' }}>
                      {item.fileType === 'image' ? (
                        failedImages[item.filePath] ? (
                          <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, background: 'linear-gradient(180deg, rgba(30,41,59,1) 0%, rgba(15,23,42,1) 100%)' }}>
                            <BrokenImageIcon sx={{ fontSize: 34, color: 'rgba(255,255,255,0.5)' }} />
                            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.56)' }}>
                              暂无预览图
                            </Typography>
                          </Box>
                        ) : (
                          <Box
                            component="img"
                            src={item.previewUrl || ''}
                            alt={item.basename}
                            onError={() => setFailedImages((prev) => ({ ...prev, [item.filePath]: true }))}
                            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )
                      ) : (
                        <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, rgba(15,23,42,0.55), rgba(0,0,0,0.8))' }}>
                          <OndemandVideoIcon sx={{ fontSize: 42, color: '#fff' }} />
                        </Box>
                      )}

                      <Stack direction="row" spacing={0.5} sx={{ position: 'absolute', top: 8, left: 8 }}>
                        <Chip
                          size="small"
                          icon={item.fileType === 'image'
                            ? <ImageIcon sx={{ color: '#fff !important' }} />
                            : item.mediaType === 'stream-video'
                              ? <OndemandVideoIcon sx={{ color: '#fff !important' }} />
                              : <MovieIcon sx={{ color: '#fff !important' }} />}
                          label={item.fileType === 'image'
                            ? '图片'
                            : item.mediaType === 'stream-video'
                              ? '大视频'
                              : '小视频'}
                          sx={{ bgcolor: 'rgba(0,0,0,0.55)', color: '#fff' }}
                        />
                        {item.rating ? <Chip size="small" label={`${item.rating}星`} sx={{ bgcolor: 'rgba(245,158,11,0.86)', color: '#fff' }} /> : null}
                      </Stack>
                    </Box>

                    <Box sx={{ p: 1 }}>
                      <Typography variant="caption" sx={{ color: '#fff', fontWeight: 700 }} noWrap>
                        {item.basename}
                      </Typography>
                      {tags.length > 0 && (
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                          {tags.slice(0, 2).map((tag) => (
                            <Chip key={`${item.id}-${tag}`} label={tag} size="small" sx={{ height: 20, bgcolor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)' }} />
                          ))}
                        </Stack>
                      )}
                    </Box>
                  </Box>
                )
              })}
              {visibleCardList.length === 0 && (
                <Box sx={{ gridColumn: '1 / -1', py: 8 }}>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.62)', textAlign: 'center' }}>
                    当前筛选下暂无内容
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {currentTabLoading && !(normalizedLoading || bootstrapLoading) && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
              <CircularProgress size={18} sx={{ color: '#ec4899' }} />
            </Box>
          )}
        </Box>
      </Box>

      <Dialog open={avatarPreviewOpen} onClose={() => setAvatarPreviewOpen(false)} maxWidth="sm" PaperProps={{ sx: { backgroundColor: '#000', boxShadow: 'none' } }}>
        {localCreator?.avatarPath ? (
          <Box component="img" src={localCreator.avatarPath} alt={localCreator.primaryName || ''} sx={{ width: '100%', maxHeight: '80vh', objectFit: 'contain' }} />
        ) : null}
      </Dialog>

      <CreatorDetailPreviewContainer
        ref={previewContainerRef}
        instantVideoPlayerRef={previewInstantVideoRef}
        active={previewOpen}
        items={previewItems}
        currentIndex={previewIndex}
        displayTotalCount={previewDisplayTotalCount}
        playIntent
        warmUpToken={previewWarmUpToken}
        onChangeIndex={(nextIndex) => {
          requestPreviewWarmUp(previewItems[nextIndex])
          if (nextIndex < previewIndex) {
            onPreviewPrev()
            return
          }
          if (nextIndex > previewIndex) {
            onPreviewNext()
          }
        }}
        onClose={onClosePreview}
        showExternalPlayerButton={previewMedia?.fileType === 'video'}
        onExternalPlayerClick={(event) => {
          if (previewMedia?.fileType !== 'video') return
          setShowPlayModeSelector(true)
          setExternalPlayerAnchor(isMobile ? null : event.currentTarget)
        }}
        externalPlayerMenuOpen={Boolean(externalPlayerAnchor)}
        externalPlayerMenuAnchor={externalPlayerAnchor}
        onExternalPlayerMenuClose={() => setExternalPlayerAnchor(null)}
        onSelectExternalPlayer={(player) => {
          const url = resolvePreviewExternalUrl(effectivePreviewPlayMode)
          if (!url) {
            setExternalPlayerAnchor(null)
            return
          }
          if (player === 'potplayer') {
            window.open(`potplayer://${url}`, '_blank', 'noopener,noreferrer')
          } else {
            window.open(`vlc://${url}`, '_blank', 'noopener,noreferrer')
          }
          setExternalPlayerAnchor(null)
        }}
        currentRating={previewCurrentRating?.rating}
        onQuickRate={(rating, evaluation) => {
          void handlePreviewQuickRate(rating, evaluation)
        }}
        onOpenRatingDialog={() => setPreviewRatingDialogOpen(true)}
        ratingDraggableStorageKey="creator_detail_preview_rating"
        showSmallVideoDirectButton={Boolean(
          previewMedia?.mediaType === 'small-video'
          && previewMedia?.directUrl
          && previewMedia?.fileSize
          && previewMedia.fileSize > 10 * 1024 * 1024
          && previewMedia.fileSize <= 100 * 1024 * 1024
        )}
        onSmallVideoDirectPlay={() => setPreviewPlayMode('direct')}
        creatorOverlayProps={previewMedia?.filePath ? {
          filePath: previewMedia.filePath,
          creatorRefreshKey: previewCreatorRefreshKey,
          onCreatorIdentified: setPreviewIdentifiedCreator,
          onCreatorTagClick: () => setPreviewCreatorDialogOpen(true),
        } : null}
        onVideoTimeUpdate={handlePreviewVideoTimeUpdate}
        onVideoEnded={handlePreviewVideoEnded}
        centerOverlay={previewCenterOverlay}
      />

      <RatingDialog
        open={previewRatingDialogOpen}
        onClose={() => setPreviewRatingDialogOpen(false)}
        onSave={handlePreviewRatingSave}
        title="评分媒体文件"
        subtitle={previewMedia?.basename}
        initialData={previewCurrentRating || undefined}
        type="media"
      />

      <CreatorDialog
        open={previewCreatorDialogOpen}
        onClose={() => setPreviewCreatorDialogOpen(false)}
        filePath={previewMedia?.filePath || ''}
        existingCreator={previewIdentifiedCreator || creator || null}
        onMarkUnknown={() => {
          setPreviewIdentifiedCreator(null)
          setPreviewCreatorRefreshKey((value) => value + 1)
        }}
        onSuccess={() => {
          setPreviewCreatorRefreshKey((value) => value + 1)
        }}
      />

      <CreatorDialog
        open={creatorInfoDialogOpen}
        onClose={() => setCreatorInfoDialogOpen(false)}
        filePath={creatorEditFilePath}
        existingCreator={localCreator ? {
          ...localCreator,
          appearanceRating: localCreator.appearanceRating ?? undefined,
          bodyRating: localCreator.bodyRating ?? undefined,
          bio: localCreator.bio ?? undefined,
        } : null}
        initialMode="edit"
        skipLinkOnSave
        onSuccess={() => {
          void loadLatestCreator()
          setCreatorInfoDialogOpen(false)
        }}
      />
    </Drawer>
  )
}
