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
import { useCreatorPreviewPreload } from '../hooks/useCreatorPreviewPreload'
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

/** 博主详情标签页类型 */
type CreatorDetailTab = 'viewed' | 'unviewed' | 'groups'
/** 媒体类型过滤器 */
type CreatorDetailMediaTypeFilter = 'all' | 'image' | 'video' | 'small-video' | 'large-video'
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
  media: CreatorMediaCard[]
  /** 博主的图组列表 */
  groups: CreatorGroupCard[]
  /** 可用的标签列表（用于筛选） */
  availableTags: string[]
  /** 是否正在加载 */
  loading: boolean
  /** 关闭抽屉的回调 */
  onClose: () => void
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
}: CreatorDetailDrawerProps) {
  /** 本地博主信息状态 */
  const [localCreator, setLocalCreator] = useState<CreatorSummary | null>(creator)
  /** 本地媒体列表状态 */
  const [localMedia, setLocalMedia] = useState<CreatorMediaCard[]>(media)
  /** 当前选中的标签页 */
  const [tab, setTab] = useState<CreatorDetailTab>('viewed')
  /** 选中的评分筛选条件 */
  const [selectedRatings, setSelectedRatings] = useState<number[]>([])
  /** 选中的标签筛选条件 */
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  /** 媒体类型筛选条件 */
  const [mediaTypeFilter, setMediaTypeFilter] = useState<CreatorDetailMediaTypeFilter>('all')
  /** 头像预览对话框是否打开 */
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false)
  /** 加载失败的图片记录 */
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})
  /** 已看过标签页的可见数量 */
  const [visibleViewedCount, setVisibleViewedCount] = useState(PAGE_SIZE)
  /** 未看过标签页的可见数量 */
  const [visibleUnviewedCount, setVisibleUnviewedCount] = useState(PAGE_SIZE)
  /** 图组标签页的可见数量 */
  const [visibleGroupCount, setVisibleGroupCount] = useState(PAGE_SIZE)
  /** 是否正在加载更多 */
  const [loadingMore, setLoadingMore] = useState(false)
  /** 预览播放模式 */
  const [previewPlayMode, setPreviewPlayMode] = useState<CreatorPreviewPlayMode>('webdav')
  /** 当前预览模式对应的文件路径，用于避免首帧使用旧播放模式 */
  const [previewPlayModeFilePath, setPreviewPlayModeFilePath] = useState<string | null>(null)
  /** 预览播放器预热令牌 */
  const [previewWarmUpToken, setPreviewWarmUpToken] = useState(0)
  /** 已看过标签页筛选区是否展开 */
  const [viewedFiltersExpanded, setViewedFiltersExpanded] = useState(false)
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

  /** 博主编辑时使用的文件路径（用于关联博主） */
  const creatorEditFilePath = previewMedia?.filePath
    || localMedia[0]?.filePath
    || (groups[0]?.groupPath ? `${groups[0].groupPath}/` : '')

  /**
   * 预览源列表
   * 如果有预览列表则使用预览列表，否则使用本地媒体列表
   */
  const previewSourceList = useMemo(() => {
    if (previewList.length === 0) return localMedia
    return previewList.map((item) => localMedia.find((mediaItem) => mediaItem.id === item.id) || item)
  }, [localMedia, previewList])

  /** 使用预加载 Hook 提升预览体验 */
  const { cacheVersion, getCachedObjectUrl } = useCreatorPreviewPreload(previewSourceList, previewIndex, previewOpen)

  /**
   * 同步外部传入的博主和媒体数据到本地状态
   */
  useEffect(() => {
    setLocalCreator(creator)
    setLocalMedia(media)
  }, [creator, media])

  useEffect(() => {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
    setIsMobile(userAgent.includes('android') || /iphone|ipad|ipod/.test(userAgent))
  }, [])

  /**
   * 抽屉打开时重置所有筛选条件和分页状态
   */
  useEffect(() => {
    if (!open) return
    setTab('viewed')
    setSelectedRatings([])
    setSelectedTags([])
    setMediaTypeFilter('all')
    setViewedFiltersExpanded(false)
    setVisibleViewedCount(PAGE_SIZE)
    setVisibleUnviewedCount(PAGE_SIZE)
    setVisibleGroupCount(PAGE_SIZE)
    setLoadingMore(false)
  }, [open, creator?.id])

  /**
   * 筛选条件或标签页变化时，滚动到顶部
   */
  useEffect(() => {
    if (listContainerRef.current) {
      listContainerRef.current.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [tab, selectedRatings, selectedTags, mediaTypeFilter, creator?.id])

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
      setLocalCreator(data.data || null)
    } catch (error) {
      console.error('[CreatorDetailDrawer] 刷新博主信息失败:', error)
    }
  }, [creator?.id, localCreator?.id])

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
    if (mediaTypeFilter === 'image' && item.fileType !== 'image') return false
    if (mediaTypeFilter === 'video' && item.fileType !== 'video') return false
    if (mediaTypeFilter === 'small-video' && item.mediaType !== 'small-video') return false
    if (mediaTypeFilter === 'large-video' && item.mediaType !== 'stream-video') return false
    if (selectedRatings.length > 0 && (!item.rating || !selectedRatings.includes(item.rating))) return false
    if (selectedTags.length > 0) {
      const tags = [...(item.customEvaluation || []), ...(item.category || [])]
      if (!selectedTags.every((tag) => tags.includes(tag))) return false
    }
    return true
  }), [mediaTypeFilter, selectedRatings, selectedTags, viewedMedia])

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

  const cardList = tab === 'viewed' ? filteredViewedMedia : filteredUnviewedMedia
  const visibleGroups = useMemo(() => groups.slice(0, visibleGroupCount), [groups, visibleGroupCount])
  const visibleCardList = useMemo(() => {
    if (tab === 'viewed') return filteredViewedMedia.slice(0, visibleViewedCount)
    if (tab === 'unviewed') return filteredUnviewedMedia.slice(0, visibleUnviewedCount)
    return []
  }, [filteredUnviewedMedia, filteredViewedMedia, tab, visibleUnviewedCount, visibleViewedCount])

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
    const groupItems = localMedia.filter((item) => item.groupPath === group.groupPath)
    if (groupItems.length === 0) return

    const initialItem = group.coverFilePath
      ? groupItems.find((item) => item.filePath === group.coverFilePath) || groupItems[0]
      : groupItems[0]

    const initialIndex = groupItems.findIndex((item) => item.id === initialItem.id)
    const orderedGroupItems = initialIndex > 0
      ? [...groupItems.slice(initialIndex), ...groupItems.slice(0, initialIndex)]
      : groupItems

    openPreviewWithWarmUp(orderedGroupItems[0], orderedGroupItems)
  }, [localMedia, openPreviewWithWarmUp])

  const handlePrimeGroupPreview = useCallback((group: CreatorGroupCard) => {
    const groupItems = localMedia.filter((item) => item.groupPath === group.groupPath)
    if (groupItems.length === 0) return

    const initialItem = group.coverFilePath
      ? groupItems.find((item) => item.filePath === group.coverFilePath) || groupItems[0]
      : groupItems[0]

    requestPreviewWarmUp(initialItem)
  }, [localMedia, requestPreviewWarmUp])

  const loadMorePreviewItems = useCallback(() => {
    if (tab === 'groups') return

    if (tab === 'viewed') {
      const nextCount = Math.min(visibleViewedCount + PAGE_SIZE, filteredViewedMedia.length)
      if (nextCount === visibleViewedCount) return
      setVisibleViewedCount(nextCount)
      onPreviewListChange(filteredViewedMedia.slice(0, nextCount))
      return
    }

    const nextCount = Math.min(visibleUnviewedCount + PAGE_SIZE, filteredUnviewedMedia.length)
    if (nextCount === visibleUnviewedCount) return
    setVisibleUnviewedCount(nextCount)
    onPreviewListChange(filteredUnviewedMedia.slice(0, nextCount))
  }, [filteredUnviewedMedia, filteredViewedMedia, onPreviewListChange, tab, visibleUnviewedCount, visibleViewedCount])

  useEffect(() => {
    if (!previewOpen || tab === 'groups') return
    if (previewSourceList.length === 0) return
    const preloadTriggerIndex = Math.max(0, previewSourceList.length - Math.ceil(PAGE_SIZE / 2))
    if (previewIndex < preloadTriggerIndex) return
    if (previewSourceList.length >= cardList.length) return

    loadMorePreviewItems()
  }, [cardList.length, loadMorePreviewItems, previewIndex, previewOpen, previewSourceList.length, tab])

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
            : (getCachedObjectUrl(item.filePath) || item.streamUrl || item.previewUrl || directUrl || '')
      }

      if (item.mediaType === 'stream-video') {
        resolvedSrc = effectivePreviewPlayMode === 'direct'
          ? (directUrl || item.streamUrl || item.previewUrl || '')
          : effectivePreviewPlayMode === 'transcode' && transcodeUrl
            ? transcodeUrl
            : (item.streamUrl || directUrl || item.previewUrl || '')
      }

      if (item.mediaType === 'image') {
        resolvedSrc = getCachedObjectUrl(item.filePath) || item.previewUrl || ''
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
  }, [effectivePreviewPlayMode, getCachedObjectUrl, previewSourceList])

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
  const handleLoadMore = useCallback(() => {
    if (loadingMore) return
    const sourceList = tab === 'viewed' ? filteredViewedMedia : tab === 'unviewed' ? filteredUnviewedMedia : groups
    const currentVisible = tab === 'viewed' ? visibleViewedCount : tab === 'unviewed' ? visibleUnviewedCount : visibleGroupCount
    if (currentVisible >= sourceList.length) return

    setLoadingMore(true)
    // 保存当前标签页，防止延迟期间切换标签导致状态不一致
    const currentTab = tab
    const timer = setTimeout(() => {
      // 使用函数式更新，避免闭包问题
      if (currentTab === 'viewed') {
        setVisibleViewedCount((value) => Math.min(value + PAGE_SIZE, filteredViewedMedia.length))
      } else if (currentTab === 'unviewed') {
        setVisibleUnviewedCount((value) => Math.min(value + PAGE_SIZE, filteredUnviewedMedia.length))
      } else {
        setVisibleGroupCount((value) => Math.min(value + PAGE_SIZE, groups.length))
      }
      setLoadingMore(false)
    }, 350)

    // 返回清理函数（虽然这里不会被调用，但保持一致性）
    return () => clearTimeout(timer)
  }, [filteredUnviewedMedia.length, filteredViewedMedia.length, groups.length, loadingMore, tab, visibleGroupCount, visibleUnviewedCount, visibleViewedCount])

  /**
   * 处理列表滚动事件
   * 当滚动到底部附近时触发加载更多
   */
  const handleListScroll = useCallback(() => {
    const container = listContainerRef.current
    if (!container || loadingMore) return
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight
    // 距离底部 120px 时触发加载更多
    if (remaining <= 120) {
      handleLoadMore()
    }
  }, [handleLoadMore, loadingMore])

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
        <Box sx={{ position: 'sticky', top: 0, zIndex: 2, px: 2, pt: 2, pb: 1.75, backdropFilter: 'blur(16px)', backgroundColor: 'rgba(15,23,42,0.92)' }}>
          <Box
            sx={{
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 3.5,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'linear-gradient(180deg, rgba(33,36,53,0.98) 0%, rgba(19,23,35,0.98) 100%)',
              boxShadow: '0 14px 32px rgba(0,0,0,0.24)',
            }}
          >
            <Box
              sx={{
                height: 88,
                background: 'linear-gradient(135deg, rgba(255,61,108,0.32) 0%, rgba(131,56,236,0.2) 38%, rgba(34,211,238,0.16) 100%)',
              }}
            />
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
                bgcolor: 'rgba(0,0,0,0.22)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <ArrowBackIcon />
            </IconButton>

            <Box sx={{ px: 2, pb: 2.1, mt: -2.25 }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-end">
                <Avatar
                  src={localCreator?.avatarPath || undefined}
                  onClick={() => localCreator?.avatarPath && setAvatarPreviewOpen(true)}
                  sx={{
                    width: 82,
                    height: 82,
                    flexShrink: 0,
                    bgcolor: 'rgba(255,255,255,0.08)',
                    border: '3px solid rgba(15,23,42,0.95)',
                    boxShadow: '0 10px 24px rgba(0,0,0,0.24)',
                    cursor: localCreator?.avatarPath ? 'pointer' : 'default',
                  }}
                >
                  {localCreator?.primaryName?.slice(0, 1) || '博'}
                </Avatar>

                <Box sx={{ minWidth: 0, flex: 1, pb: 0.35 }}>
                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 800,
                      lineHeight: 1.12,
                      letterSpacing: '-0.01em',
                      wordBreak: 'break-word',
                    }}
                  >
                    {localCreator?.primaryName || '博主详情'}
                  </Typography>

                  <Stack
                    direction="row"
                    spacing={1.2}
                    useFlexGap
                    sx={{
                      mt: 1,
                      flexWrap: 'wrap',
                      color: 'rgba(255,255,255,0.78)',
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      作品 {localMedia.length}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.22)' }}>|</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      已看 {viewedMedia.length}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.22)' }}>|</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      图组 {groups.length}
                    </Typography>
                  </Stack>
                </Box>
              </Stack>

              <Stack spacing={1.15} sx={{ mt: 1.6 }}>
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
              </Stack>
            </Box>
          </Box>

          <Stack direction="row" spacing={1.25} sx={{ mt: 1.75 }}>
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
          <Tab value="viewed" label={`已看过 ${viewedMedia.length}`} />
          <Tab value="unviewed" label={`未看过 ${unviewedMedia.length}`} />
          <Tab value="groups" label={`图组 ${groups.length}`} />
        </Tabs>

        {(tab === 'viewed' || tab === 'unviewed') && (
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

              {(tab === 'unviewed' || viewedFiltersExpanded) && (
                <Collapse in={tab === 'unviewed' || viewedFiltersExpanded} timeout="auto" unmountOnExit>
                  <Stack spacing={1.5}>
                    <ToggleButtonGroup
                      exclusive
                      value={mediaTypeFilter}
                      onChange={(_, value) => value && setMediaTypeFilter(value)}
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

                        {availableTags.length > 0 && (
                          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            {availableTags.map((tag) => {
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
          {loading ? (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240 }} spacing={2}>
              <CircularProgress sx={{ color: '#ec4899' }} />
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.68)' }}>正在加载博主内容...</Typography>
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
                      {group.fileCount} 个文件 · {group.isViewed ? '已看过' : '未看过'}
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

          {loadingMore && (
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
        cacheVersion={cacheVersion}
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
