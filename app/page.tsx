﻿'use client'

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  Alert,
  Box,
  Button,
  Container,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Apps as AppsIcon,
  BarChart as BarChartIcon,
  BugReport as BugReportIcon,
  CloudOff as CloudOffIcon,
  Download as DownloadIcon,
  FilterList as FilterListIcon,
  ManageAccounts as ManageAccountsIcon,
  OpenInNew as OpenInNewIcon,
  Settings as SettingsIcon,
  Storage as StorageIcon,
} from '@mui/icons-material'
import { useRouter } from 'next/navigation'

import { useSplitMainBootstrap } from '@/app/split-main/useSplitMainBootstrap'
import { useSplitMainPreload } from '@/app/split-main/useSplitMainPreload'
import { useSharedRatingActions } from '@/app/split-main/useSharedRatingActions'
import CreatorDialog from '@/components/CreatorDialog'
import CreatorDetailDrawer from '../components/CreatorDetailDrawer'
import MovieSearchGate from '@/components/MovieSearchGate'
import SettingsDrawer from '@/components/SettingsDrawer'
import GalleryModePage from '@/components/split-main/modes/GalleryModePage'
import LargeVideoModePage from '@/components/split-main/modes/LargeVideoModePage'
import RandomModePage from '@/components/split-main/modes/RandomModePage'
import { clearRandomPoolSession } from '@/lib/clientRandomPool'
import { buildGroupQueueKey, buildMediaQueueKey, localRatingQueue } from '@/lib/localRatingQueue'
import databasePreloadManager from '@/lib/databasePreloadManager'
import { setErudaEnabled } from '@/lib/erudaInit'
import { peekRandomPoolSessionId, renewRandomPoolSessionId } from '@/lib/randomPoolSession'
import { QUICK_RATING_CONFIG } from '@/types'
import type {
  AdvancedFilters,
  CreatorMediaCard,
  CreatorSummary,
  GroupRating,
  MediaFile,
  MediaFilter,
  MediaRating,
  MediaType,
  ViewMode,
  ViewedFilter,
  WebDAVConfig,
} from '@/types'

type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning'

const PAGE_LINKS = [
  { label: '观看数据看板', path: '/dashboard', icon: <BarChartIcon fontSize="small" /> },
  { label: '评价与分类管理', path: '/manage', icon: <ManageAccountsIcon fontSize="small" /> },
  { label: 'WebDAV 设置', path: '/config', icon: <SettingsIcon fontSize="small" /> },
  { label: '博主管理测试', path: '/creator-test', icon: <BugReportIcon fontSize="small" /> },
  { label: '流播放测试', path: '/stream-test', icon: <BugReportIcon fontSize="small" /> },
  { label: '随机抽取测试', path: '/random-test', icon: <BugReportIcon fontSize="small" /> },
  { label: '数据库查询', path: '/admin/query-db', icon: <StorageIcon fontSize="small" /> },
] as const

const isImageFile = (filename: string) => /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(filename)
const isVideoFile = (filename: string) => /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(filename)

const getGroupPathFromFilePath = (filePath: string): string => {
  const lastSlashIndex = filePath.lastIndexOf('/')
  return lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '/'
}

export default function HomePage() {
  const router = useRouter()

  const [gateReady, setGateReady] = useState(false)
  const [isUnlocked, setIsUnlocked] = useState(false)

  const [config, setConfig] = useState<WebDAVConfig | null>(null)
  const [currentFile, setCurrentFile] = useState<MediaFile | null>(null)
  const [currentGroup, setCurrentGroup] = useState<MediaFile[]>([])
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [transcodeUrl, setTranscodeUrl] = useState<string | null>(null)
  const [originalStreamUrl, setOriginalStreamUrl] = useState<string | null>(null)
  const [isUsingTranscode, setIsUsingTranscode] = useState(false)
  const [stats, setStats] = useState({ total: 0, images: 0, videos: 0, viewed: 0 })

  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const [viewedFilter, setViewedFilter] = useState<ViewedFilter>('unviewed')
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({
    ratings: [],
    evaluations: [],
    categories: [],
    reasonFilter: 'all',
    reasonKeyword: '',
    ratingEmptyFilter: undefined,
    evaluationEmptyFilter: undefined,
    categoryEmptyFilter: undefined,
  })
  const [availableEvaluations, setAvailableEvaluations] = useState<string[]>([])
  const [availableCategories, setAvailableCategories] = useState<string[]>([])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('random')
  const [preloadStatus, setPreloadStatus] = useState<{ cacheSize: number; maxCacheSize: number } | null>(null)
  const [optimisticUpdateEnabled, setOptimisticUpdateEnabled] = useState(true)
  const [erudaEnabled, setErudaEnabledState] = useState(false)
  const [cachePreloadProgress, setCachePreloadProgress] = useState<{ current: number; total: number } | null>(null)
  const [preloadInsufficient, setPreloadInsufficient] = useState(false)
  const [actualFoundCount, setActualFoundCount] = useState(0)
  const [galleryPreloadReady, setGalleryPreloadReady] = useState(false)
  const [preloadRandomness, setPreloadRandomness] = useState(1)
  const [highlightContinuousPlayEnabled, setHighlightContinuousPlayEnabled] = useState(true)

  const [ratingDialogOpen, setRatingDialogOpen] = useState(false)
  const [currentRating, setCurrentRating] = useState<MediaRating | GroupRating | null>(null)
  const [ratingType, setRatingType] = useState<'media' | 'group'>('media')
  const [creatorDialogOpen, setCreatorDialogOpen] = useState(false)
  const [currentCreator, setCurrentCreator] = useState<any>(null)
  const [creatorRefreshKey, setCreatorRefreshKey] = useState(0)
  
  // ========== 博主详情相关状态 ==========
  /** 博主详情抽屉是否打开 */
  const [creatorDetailOpen, setCreatorDetailOpen] = useState(false)
  /** 博主详情打开时，是否暂停主页大视频预览 */
  const [creatorDetailSuspended, setCreatorDetailSuspended] = useState(false)
  
  // ========== 博主预览相关状态 ==========
  /** 博主预览是否打开 */
  const [creatorPreviewOpen, setCreatorPreviewOpen] = useState(false)
  /** 博主预览的媒体列表 */
  const [creatorPreviewList, setCreatorPreviewList] = useState<CreatorMediaCard[]>([])
  /** 博主预览的当前索引 */
  const [creatorPreviewIndex, setCreatorPreviewIndex] = useState(0)

  const [autoMarkTimer, setAutoMarkTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState<SnackbarSeverity>('success')
  const [ratingQueueActiveCount, setRatingQueueActiveCount] = useState(0)

  const [pageMenuAnchor, setPageMenuAnchor] = useState<HTMLElement | null>(null)
  const pageMenuOpen = Boolean(pageMenuAnchor)

  const configSnapshotRef = useRef<{
    mediaFilter: MediaFilter
    viewedFilter: ViewedFilter
    viewMode: ViewMode
    advancedFilters: AdvancedFilters
  } | null>(null)
  const randomModeCreatorMetadataPatchRef = useRef<(filePath: string, creator: CreatorSummary | null, creatorResolved: boolean) => void>(() => {})
  const randomModeRatingMetadataPatchRef = useRef<(filePath: string, rating: MediaFile['mediaRatingData']) => void>(() => {})
  const galleryModeCreatorMetadataPatchRef = useRef<(filePath: string, creator: CreatorSummary | null, creatorResolved: boolean) => void>(() => {})
  const initialPreloadTriggeredRef = useRef(false)
  const viewModeRef = useRef<ViewMode>(viewMode)
  const hasAutoRatedRef = useRef(false)
  const playIntentRef = useRef(true)
  const videoStateRef = useRef<{ currentTime: number; paused: boolean } | null>(null)
  const ratingQueueSnapshotRef = useRef<Map<string, { status: 'queued' | 'syncing' | 'synced' | 'failed'; updatedAt: number }>>(new Map())

  const videoRef = useRef<HTMLVideoElement>(null)
  const mobileVideoRef = useRef<any>(null)
  const videoPlayerContainerRef = useRef<HTMLDivElement>(null)

  const [shouldAutoPlay, setShouldAutoPlay] = useState(true)

  const loadCurrentRatingRef = useRef<(file?: MediaFile, forceType?: 'media' | 'group') => Promise<void>>(async () => {})
  const startAutoMarkTimerRef = useRef<(file?: MediaFile, skipAutoRating?: boolean) => void>(() => {})
  const handleMediaTypeChangeInFullscreenRef = useRef<(nextFile: MediaFile) => boolean>(() => false)
  const enterVideoFullscreenRef = useRef<() => Promise<void> | void>(() => {})
  const isVideoRef = useRef<(filename: string) => boolean>(() => false)

  const [mediaType, setMediaType] = useState<MediaType>('image')

  /** 当前预览的博主媒体项 */
  const creatorPreviewCurrent = creatorPreviewList[creatorPreviewIndex] || null

  const filteredStats = useMemo(() => {
    if (mediaFilter === 'images') {
      return { total: stats.images, label: '图片' }
    }
    if (mediaFilter === 'videos') {
      return { total: stats.videos, label: '视频' }
    }
    return { total: stats.total, label: '全部' }
  }, [mediaFilter, stats])

  const setPlayIntent = useCallback((intent: boolean) => {
    playIntentRef.current = intent
    setShouldAutoPlay(intent)
  }, [])

  const patchCreatorMetadataAcrossState = useCallback((
    filePath: string,
    creator: CreatorSummary | null,
    creatorResolved: boolean,
  ) => {
    setCurrentFile((prev) => prev && prev.filename === filePath ? {
      ...prev,
      creator,
      creatorResolved,
    } : prev)

    randomModeCreatorMetadataPatchRef.current(filePath, creator, creatorResolved)
    galleryModeCreatorMetadataPatchRef.current(filePath, creator, creatorResolved)
    databasePreloadManager.patchFileCreatorMetadata(filePath, creator, creatorResolved)
  }, [])

  const patchMediaRatingAcrossState = useCallback((filePath: string, rating: MediaRating | null) => {
    setCurrentFile((prev) => prev && prev.filename === filePath ? {
      ...prev,
      mediaRatingData: rating,
    } : prev)

    setCurrentGroup((prev) => prev.map((file) => (
      file.filename === filePath
        ? {
            ...file,
            mediaRatingData: rating,
          }
        : file
    )))

    randomModeRatingMetadataPatchRef.current(filePath, rating)
    databasePreloadManager.patchFileRatingMetadata(filePath, rating)
  }, [])

  const patchGroupRatingAcrossState = useCallback((groupPath: string, rating: GroupRating | null) => {
    setCurrentFile((prev) => prev && getGroupPathFromFilePath(prev.filename) === groupPath ? {
      ...prev,
      groupRatingData: rating,
    } : prev)

    setCurrentGroup((prev) => prev.map((file) => (
      getGroupPathFromFilePath(file.filename) === groupPath
        ? {
            ...file,
            groupRatingData: rating,
          }
        : file
    )))

    databasePreloadManager.patchGroupRatingMetadata(groupPath, rating)
  }, [])

  const notify = useCallback((message: string, severity: SnackbarSeverity = 'info') => {
    setSnackbarMessage(message)
    setSnackbarSeverity(severity)
    setSnackbarOpen(true)
  }, [])

  const {
    stopAutoMarkTimer,
    loadMediaRating,
    loadCurrentRating,
    saveRatingManual,
    handleQuickRate,
    performAutoRating,
    startAutoMarkTimer,
  } = useSharedRatingActions({
    currentFile,
    currentGroup,
    currentRating,
    ratingType,
    viewedFilter,
    optimisticUpdateEnabled,
    autoMarkTimer,
    setAutoMarkTimer,
    setCurrentRating,
    setRatingType,
    setStats,
    hasAutoRatedRef,
    patchMediaRatingSnapshot: patchMediaRatingAcrossState,
    patchGroupRatingSnapshot: patchGroupRatingAcrossState,
    notify,
  })

  const resetCurrentPreviewState = useCallback(() => {
    stopAutoMarkTimer()
    if (mediaUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(mediaUrl)
    }

    setCurrentFile(null)
    setMediaUrl(null)
    setTranscodeUrl(null)
    setOriginalStreamUrl(null)
    setCurrentRating(null)
    setCurrentCreator(null)
    setRatingDialogOpen(false)
    setMediaType('image')
    setFullscreen(false)
    videoStateRef.current = null
    hasAutoRatedRef.current = false
    setPlayIntent(true)
  }, [mediaUrl, setPlayIntent, stopAutoMarkTimer])

  const {
    runGalleryPreload,
    runRandomPreload,
    rerunModePreload,
  } = useSplitMainPreload({
    config,
    viewedFilter,
    advancedFilters,
    mediaFilter,
    preloadRandomness,
    statsTotal: stats.total,
    viewModeRef,
    setGalleryPreloadReady,
    setCachePreloadProgress,
    setPreloadInsufficient,
    setActualFoundCount,
    setPreloadStatus,
    notify,
  })

  const handleMediaTypeChangeInFullscreen = useCallback((_nextFile: MediaFile): boolean => {
    return false
  }, [])

  const tryPlayVideoAfterFullscreen = useCallback(() => {
    if (!playIntentRef.current) {
      return
    }

    const video = videoRef.current
    if (video && video.paused) {
      video.play().catch(() => {
        video.muted = true
        video.play().then(() => {
          setTimeout(() => {
            video.muted = false
          }, 300)
        }).catch(() => {})
      })
    }
  }, [])

  const enterVideoFullscreen = useCallback(async () => {
    const container = videoPlayerContainerRef.current
    if (!container || typeof container.requestFullscreen !== 'function') {
      return
    }

    try {
      await container.requestFullscreen()
      tryPlayVideoAfterFullscreen()
    } catch (enterFullscreenError) {
      console.error('进入原生全屏失败:', enterFullscreenError)
    }
  }, [tryPlayVideoAfterFullscreen])

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => !prev)
  }, [])

  const handleRatingSaveSuccess = useCallback(() => {
    notify('✅ 评分保存成功', 'success')
  }, [notify])

  const toggleDrawer = useCallback((open: boolean) => () => {
    if (open) {
      configSnapshotRef.current = {
        mediaFilter,
        viewedFilter,
        viewMode,
        advancedFilters: { ...advancedFilters },
      }
      setDrawerOpen(true)
      return
    }

    const hasFilterConfigChanged = Boolean(
      configSnapshotRef.current && (
        configSnapshotRef.current.mediaFilter !== mediaFilter ||
        configSnapshotRef.current.viewedFilter !== viewedFilter
      ),
    )

    const hasAdvancedFiltersChanged = Boolean(
      viewedFilter === 'viewed' &&
      configSnapshotRef.current &&
      JSON.stringify(configSnapshotRef.current.advancedFilters) !== JSON.stringify(advancedFilters),
    )

    if (hasFilterConfigChanged || hasAdvancedFiltersChanged) {
      resetCurrentPreviewState()
      setCurrentGroup([])
      setCurrentGroupIndex(0)
      initialPreloadTriggeredRef.current = true
      rerunModePreload()
    }

    setDrawerOpen(false)
  }, [advancedFilters, mediaFilter, resetCurrentPreviewState, rerunModePreload, viewMode, viewedFilter])

  const handleViewModeChange = useCallback((newMode: ViewMode) => {
    if (newMode === viewMode) {
      return
    }

    setViewMode(newMode)
    viewModeRef.current = newMode
    localStorage.setItem('view_mode', newMode)

    resetCurrentPreviewState()
    setCurrentGroup([])
    setCurrentGroupIndex(0)

    databasePreloadManager.cancelAllPreloads()
    databasePreloadManager.clearCache()
    databasePreloadManager.clearNextGroupCache()
    setPreloadStatus(databasePreloadManager.getCacheStatus())

    if (newMode === 'gallery') {
      setGalleryPreloadReady(false)
    } else {
      setGalleryPreloadReady(true)
    }

    setCachePreloadProgress(null)
    setPreloadInsufficient(false)
    setActualFoundCount(0)
    initialPreloadTriggeredRef.current = false

    rerunModePreload()
  }, [rerunModePreload, resetCurrentPreviewState, viewMode])

  const handleOptimisticUpdateEnabledChange = useCallback((enabled: boolean) => {
    setOptimisticUpdateEnabled(enabled)
    localStorage.setItem('optimistic_update_enabled', enabled.toString())
  }, [])

  const handleErudaEnabledChange = useCallback((enabled: boolean) => {
    setErudaEnabledState(enabled)
    setErudaEnabled(enabled)
    notify(enabled ? 'Eruda 已启用' : 'Eruda 已禁用', 'info')
  }, [notify])

  const handlePreloadRandomnessChange = useCallback((value: number) => {
    setPreloadRandomness(value)
    localStorage.setItem('preload_randomness', value.toString())
  }, [])

  const handleClearCache = useCallback(() => {
    databasePreloadManager.cancelAllPreloads()

    const previousRandomPoolSessionId = peekRandomPoolSessionId()
    if (previousRandomPoolSessionId) {
      void clearRandomPoolSession(previousRandomPoolSessionId).catch(() => {})
      renewRandomPoolSessionId()
    }

    databasePreloadManager.clearCache()
    databasePreloadManager.clearNextGroupCache()
    databasePreloadManager.clearGalleryRuntimeState()
    if (viewMode === 'random') {
      const preloadCount = config?.scanSettings?.preloadCount || 10
      setPreloadStatus({ cacheSize: 0, maxCacheSize: preloadCount })
      setCachePreloadProgress({ current: 0, total: preloadCount })
    } else {
      setPreloadStatus(databasePreloadManager.getCacheStatus())
    }
    notify('缓存已清理', 'info')
  }, [config, notify, viewMode])

  const handleResetButtonPositions = useCallback(() => {
    ;['fullscreen_rating', 'fullscreen_shuffle', 'normal_shuffle'].forEach((key) => {
      localStorage.removeItem(`draggable_${key}_position`)
    })

    notify('按钮位置已复位，刷新页面生效', 'success')
    setTimeout(() => {
      window.location.reload()
    }, 1000)
  }, [notify])

  const handleViewedFilterChangeWrapper = useCallback((newFilter: ViewedFilter) => {
    setViewedFilter(newFilter)
    localStorage.setItem('viewed_filter', newFilter)

    if (newFilter === 'viewed') {
      databasePreloadManager.clearLocalViewedFiles()
    }

    if (currentFile) {
      const isViewed = currentRating?.isViewed || false
      if ((newFilter === 'viewed' && !isViewed) || (newFilter === 'unviewed' && isViewed)) {
        resetCurrentPreviewState()
      }
    }
  }, [currentFile, currentRating?.isViewed, resetCurrentPreviewState])

  const handleRestartViewedMode = useCallback(() => {
    databasePreloadManager.cancelAllPreloads()

    const previousRandomPoolSessionId = peekRandomPoolSessionId()
    if (previousRandomPoolSessionId) {
      void clearRandomPoolSession(previousRandomPoolSessionId).catch(() => {})
      renewRandomPoolSessionId()
    }

    if (viewMode === 'random') {
      databasePreloadManager.clearCache()
      databasePreloadManager.clearNextGroupCache()
      databasePreloadManager.clearGalleryRuntimeState()

      const preloadCount = config?.scanSettings?.preloadCount || 10
      setPreloadStatus({ cacheSize: 0, maxCacheSize: preloadCount })
      setCachePreloadProgress({ current: 0, total: preloadCount })
    }

    databasePreloadManager.clearLocalViewedFiles()
    notify('已清除本地观看记录，可以重新观看', 'success')
  }, [config, notify, viewMode])

  const handleMediaFilterChangeWrapper = useCallback((newFilter: MediaFilter) => {
    setMediaFilter(newFilter)
    localStorage.setItem('media_filter', newFilter)

    if (!currentFile) {
      return
    }

    const currentIsImage = isImageFile(currentFile.basename)
    const currentIsVideo = isVideoFile(currentFile.basename)

    if ((newFilter === 'images' && !currentIsImage) || (newFilter === 'videos' && !currentIsVideo)) {
      resetCurrentPreviewState()
    }
  }, [currentFile, resetCurrentPreviewState])

  const openRatingDialog = useCallback((type: 'media' | 'group') => {
    if (type === 'group') {
      setCurrentRating(
        ratingType === 'group'
          ? currentRating ?? currentGroup[currentGroupIndex]?.groupRatingData ?? currentGroup[0]?.groupRatingData ?? null
          : currentGroup[currentGroupIndex]?.groupRatingData ?? currentGroup[0]?.groupRatingData ?? null,
      )
    } else {
      setCurrentRating(
        ratingType === 'media'
          ? currentRating ?? currentFile?.mediaRatingData ?? null
          : currentFile?.mediaRatingData ?? null,
      )
    }

    setRatingType(type)
    setRatingDialogOpen(true)
  }, [currentFile, currentGroup, currentGroupIndex, currentRating, ratingType])

  const closeRatingDialog = useCallback(() => {
    setRatingDialogOpen(false)
  }, [])

  const handleCloseSnackbar = useCallback(() => {
    setSnackbarOpen(false)
  }, [])

  const handleHighlightContinuousPlayEnabledChange = useCallback((enabled: boolean) => {
    setHighlightContinuousPlayEnabled(enabled)
    localStorage.setItem('highlight_continuous_play_enabled', enabled.toString())
    notify(enabled ? '已启用连续播放精彩时刻' : '已关闭连续播放精彩时刻', 'info')
  }, [notify])

  const handlePageMenuOpen = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    setPageMenuAnchor(event.currentTarget)
  }, [])

  const handlePageMenuClose = useCallback(() => {
    setPageMenuAnchor(null)
  }, [])

  const openPageInNewTab = useCallback((path: string) => {
    window.open(path, '_blank', 'noopener,noreferrer')
    handlePageMenuClose()
  }, [handlePageMenuClose])

  /**
   * 打开博主详情抽屉
   * 
   * 功能：
   * 1. 如果没有博主信息，则打开博主对话框
   * 2. 退出全屏模式
   * 3. 从 API 获取博主的媒体、图组和标签数据
   * 4. 打开博主详情抽屉
   * 
   * @param creator - 博主信息（可选，默认使用 currentCreator）
   */
  const openCreatorDetail = useCallback(async (creator?: any | null) => {
    const targetCreator = creator || currentCreator
    if (!targetCreator?.id) {
      setCreatorDialogOpen(true)
      return
    }

    const shouldSuspendLargeVideo = viewMode === 'large-video' && mediaType === 'stream-video'

    setFullscreen(false)
    setCreatorDetailSuspended(shouldSuspendLargeVideo)
    setCurrentCreator(targetCreator)
    setCreatorDetailOpen(true)
  }, [currentCreator, mediaType, viewMode])

  /**
   * 打开博主预览
   * 
   * @param media - 要预览的媒体项
   * @param list - 媒体列表
   */
  const openCreatorPreview = useCallback((media: CreatorMediaCard, list: CreatorMediaCard[]) => {
    const index = list.findIndex((item) => item.id === media.id)
    setCreatorPreviewList(list)
    setCreatorPreviewIndex(index >= 0 ? index : 0)
    setCreatorPreviewOpen(true)
  }, [])

  /**
   * 关闭博主预览
   * 重置预览相关状态
   */
  const closeCreatorPreview = useCallback(() => {
    setCreatorPreviewOpen(false)
    setCreatorPreviewList([])
    setCreatorPreviewIndex(0)
  }, [])

  /**
   * 更新博主预览列表
   * 用于分页加载更多媒体时更新列表
   * 
   * @param list - 新的媒体列表
   */
  const updateCreatorPreviewList = useCallback((list: CreatorMediaCard[]) => {
    setCreatorPreviewList(list)
  }, [])

  /**
   * 博主预览导航
   * 
   * @param direction - 导航方向（'prev' 上一个，'next' 下一个）
   */
  const goCreatorPreview = useCallback((direction: 'prev' | 'next') => {
    setCreatorPreviewIndex((prev) => {
      if (creatorPreviewList.length === 0) return prev
      if (direction === 'prev') {
        return prev > 0 ? prev - 1 : prev
      }
      return prev < creatorPreviewList.length - 1 ? prev + 1 : prev
    })
  }, [creatorPreviewList.length])

  loadCurrentRatingRef.current = loadCurrentRating
  startAutoMarkTimerRef.current = startAutoMarkTimer
  handleMediaTypeChangeInFullscreenRef.current = handleMediaTypeChangeInFullscreen
  enterVideoFullscreenRef.current = enterVideoFullscreen
  isVideoRef.current = isVideoFile

  useSplitMainBootstrap({
    respectStoredViewMode: true,
    viewModeRef,
    setConfig,
    setStats,
    setLoading,
    setError,
    setMediaFilter,
    setViewedFilter,
    setViewMode,
    setPreloadRandomness,
    setOptimisticUpdateEnabled,
    setHighlightContinuousPlayEnabled,
    setAvailableEvaluations,
    setAvailableCategories,
    setErudaEnabledState,
    setIsMobile,
  })

  useEffect(() => {
    viewModeRef.current = viewMode
  }, [viewMode])

  useEffect(() => {
    setIsUnlocked(window.sessionStorage.getItem('movie_search_gate_unlocked') === 'true')
    setGateReady(true)
  }, [])

  const handleUnlock = useCallback(() => {
    window.sessionStorage.setItem('movie_search_gate_unlocked', 'true')
    setIsUnlocked(true)
    router.replace('/')
  }, [router])

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!currentFile || mediaType !== 'small-video') {
        return
      }

      const isCurrentlyFullscreen = !!document.fullscreenElement
      setFullscreen(isCurrentlyFullscreen)
      if (isCurrentlyFullscreen) {
        tryPlayVideoAfterFullscreen()
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [currentFile, mediaType, tryPlayVideoAfterFullscreen])

  useEffect(() => {
    if (!stats.total || !config || initialPreloadTriggeredRef.current) {
      return
    }

    const initialMode = viewModeRef.current
    initialPreloadTriggeredRef.current = true

    if (initialMode === 'gallery') {
      void runGalleryPreload()
      return
    }

    if (initialMode === 'random') {
      void runRandomPreload()
      return
    }

    setGalleryPreloadReady(true)
    setCachePreloadProgress(null)
  }, [config, runGalleryPreload, runRandomPreload, stats.total])

  useEffect(() => {
    if (viewMode === 'large-video') {
      return
    }

    if (config && preloadStatus) {
      const preloadCount = config.scanSettings?.preloadCount || 10
      const progressTotal = preloadCount

      setCachePreloadProgress((prev) => {
        if (prev && prev.current === preloadStatus.cacheSize) {
          return prev
        }
        return { current: preloadStatus.cacheSize, total: progressTotal }
      })
    }
  }, [config, preloadStatus, viewMode])

  useEffect(() => {
    if (viewMode === 'large-video') {
      return
    }

    const handleKeyPress = (event: KeyboardEvent) => {
      if (!currentFile) {
        return
      }

      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }

      const key = event.key.toLowerCase()
      if (key >= '1' && key <= '5') {
        event.preventDefault()
        const ratingConfig = QUICK_RATING_CONFIG[parseInt(key, 10) - 1]
        if (ratingConfig) {
          void handleQuickRate(ratingConfig.rating, ratingConfig.evaluation)
        }
      }

      if (key === 'r') {
        event.preventDefault()
        openRatingDialog('media')
      }

      if (key === 'g' && viewMode === 'gallery' && currentGroup.length > 0) {
        event.preventDefault()
        openRatingDialog('group')
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [currentFile, currentGroup.length, handleQuickRate, openRatingDialog, viewMode])

  useEffect(() => {
    return () => {
      if (autoMarkTimer) {
        clearTimeout(autoMarkTimer)
      }
    }
  }, [autoMarkTimer])

  useEffect(() => {
    if (!creatorDetailOpen) {
      setCreatorDetailSuspended(false)
    }
  }, [creatorDetailOpen])

  useEffect(() => {
    const syncRatingQueueStatus = () => {
      setRatingQueueActiveCount(localRatingQueue.getStatus().total)

      const nextSnapshot = new Map<string, { status: 'queued' | 'syncing' | 'synced' | 'failed'; updatedAt: number }>()
      const queueRecords = localRatingQueue.getAllRecords()

      queueRecords.forEach((record) => {
        const key = record.type === 'media'
          ? buildMediaQueueKey(record.filePath)
          : buildGroupQueueKey(record.groupPath)

        nextSnapshot.set(key, {
          status: record.status,
          updatedAt: record.updatedAt,
        })

        const previousRecord = ratingQueueSnapshotRef.current.get(key)
        if (previousRecord && previousRecord.status !== 'failed' && record.status === 'failed') {
          notify(
            `${record.type === 'media' ? '媒体评分' : '图组评分'}同步失败${record.errorMessage ? `：${record.errorMessage}` : ''}`,
            'error',
          )
        }
      })

      ratingQueueSnapshotRef.current = nextSnapshot
    }

    syncRatingQueueStatus()
    return localRatingQueue.subscribe(syncRatingQueueStatus)
  }, [notify])

  if (!gateReady) {
    return null
  }

  if (!isUnlocked) {
    return <MovieSearchGate onUnlock={handleUnlock} />
  }

  if (!config) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Paper elevation={3} sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
          <CloudOffIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h4" gutterBottom>
            欢迎使用 WebDAV 媒体预览器
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            请先配置您的 WebDAV 服务器连接信息
          </Typography>
          <Button variant="contained" size="large" startIcon={<SettingsIcon />} onClick={() => router.push('/config')}>
            配置 WebDAV
          </Button>
        </Paper>
      </Container>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 1200,
          backgroundColor: 'white',
          borderBottom: '1px solid #e0e0e0',
          px: 2,
          py: 1,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" fontWeight="bold">
            See it
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {cachePreloadProgress && viewMode !== 'large-video' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 0.5 }}>
                <DownloadIcon
                  sx={{
                    fontSize: 18,
                    transform: 'rotate(180deg)',
                    animation: ratingQueueActiveCount > 0 ? 'download 1.5s ease-in-out infinite' : 'none',
                    '@keyframes download': {
                      '0%': { transform: 'translateY(0px)', opacity: 1 },
                      '50%': { transform: 'translateY(4px)', opacity: 0.7 },
                      '100%': { transform: 'translateY(0px)', opacity: 1 },
                    },
                    '@keyframes uploadDownloadMirror': {
                      '0%': { transform: 'translateY(0px) rotate(180deg)', opacity: 1 },
                      '50%': { transform: 'translateY(-4px) rotate(180deg)', opacity: 0.7 },
                      '100%': { transform: 'translateY(0px) rotate(180deg)', opacity: 1 },
                    },
                    animationName: ratingQueueActiveCount > 0 ? 'uploadDownloadMirror' : 'none',
                  }}
                  color="primary"
                />
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: '20px', fontWeight: 'bold' }}>
                  {ratingQueueActiveCount}
                </Typography>
                <DownloadIcon
                  sx={{
                    fontSize: 18,
                    animation: 'download 1.5s ease-in-out infinite',
                    '@keyframes download': {
                      '0%': { transform: 'translateY(0px)', opacity: 1 },
                      '50%': { transform: 'translateY(4px)', opacity: 0.7 },
                      '100%': { transform: 'translateY(0px)', opacity: 1 },
                    },
                  }}
                  color="primary"
                />
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: '32px', fontWeight: 'bold' }}>
                  {preloadInsufficient
                    ? `${actualFoundCount}/${cachePreloadProgress.current}/${cachePreloadProgress.total}`
                    : `${cachePreloadProgress.current}/${cachePreloadProgress.total}`}
                </Typography>
              </Box>
            )}

            <Tooltip title="页面入口">
              <IconButton onClick={handlePageMenuOpen} color="primary" aria-label="页面入口">
                <AppsIcon />
              </IconButton>
            </Tooltip>

            <Tooltip title="筛选与统计">
              <IconButton onClick={toggleDrawer(true)} color="primary">
                <FilterListIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      <Menu
        anchorEl={pageMenuAnchor}
        open={pageMenuOpen}
        onClose={handlePageMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {PAGE_LINKS.map((item) => (
          <MenuItem key={item.path} onClick={() => openPageInNewTab(item.path)}>
            <ListItemIcon sx={{ minWidth: 34 }}>{item.icon}</ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
            <OpenInNewIcon fontSize="small" color="action" />
          </MenuItem>
        ))}
      </Menu>

      <Container maxWidth="xl" sx={{ py: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {viewMode === 'random' ? (
          <RandomModePage
            config={config}
            directoryCount={config.mediaPaths.length}
            filteredStatsLabel={filteredStats.label}
            filteredStatsTotal={filteredStats.total}
            currentFile={currentFile}
            setCurrentFile={setCurrentFile}
            setCurrentCreator={setCurrentCreator}
            creatorRefreshKey={creatorRefreshKey}
            mediaUrl={mediaUrl}
            setMediaUrl={setMediaUrl}
            transcodeUrl={transcodeUrl}
            setTranscodeUrl={setTranscodeUrl}
            originalStreamUrl={originalStreamUrl}
            setOriginalStreamUrl={setOriginalStreamUrl}
            mediaType={mediaType}
            setMediaType={setMediaType}
            isUsingTranscode={isUsingTranscode}
            setIsUsingTranscode={setIsUsingTranscode}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            mediaFilter={mediaFilter}
            viewedFilter={viewedFilter}
            advancedFilters={advancedFilters}
            preloadRandomness={preloadRandomness}
            setPreloadStatus={setPreloadStatus}
            setCachePreloadProgress={setCachePreloadProgress}
            cachePreloadProgress={cachePreloadProgress}
            setPreloadInsufficient={setPreloadInsufficient}
            preloadInsufficient={preloadInsufficient}
            setActualFoundCount={setActualFoundCount}
            actualFoundCount={actualFoundCount}
            ratingQueueActiveCount={ratingQueueActiveCount}
            currentRating={currentRating}
            setCurrentRating={setCurrentRating}
            setRatingType={setRatingType}
            handleQuickRate={handleQuickRate}
            openRatingDialog={openRatingDialog}
            onOpenCreatorDialog={() => setCreatorDialogOpen(true)}
            onOpenCreatorDetail={openCreatorDetail}
            ratingDialogOpen={ratingDialogOpen}
            closeRatingDialog={closeRatingDialog}
            saveRatingManual={saveRatingManual}
            handleRatingSaveSuccess={handleRatingSaveSuccess}
            fullscreen={fullscreen}
            toggleFullscreen={toggleFullscreen}
            isMobile={isMobile}
            videoRef={videoRef}
            mobileVideoRef={mobileVideoRef}
            videoPlayerContainerRef={videoPlayerContainerRef}
            shouldAutoPlay={shouldAutoPlay}
            playIntentRef={playIntentRef}
            videoStateRef={videoStateRef}
            loadCurrentRatingRef={loadCurrentRatingRef}
            startAutoMarkTimerRef={startAutoMarkTimerRef}
            handleMediaTypeChangeInFullscreenRef={handleMediaTypeChangeInFullscreenRef}
            enterVideoFullscreenRef={enterVideoFullscreenRef}
            isVideoRef={isVideoRef}
            performAutoRating={performAutoRating}
            stopAutoMarkTimer={stopAutoMarkTimer}
            setSnackbarMessage={setSnackbarMessage}
            setSnackbarSeverity={setSnackbarSeverity}
            setSnackbarOpen={setSnackbarOpen}
            creatorMetadataPatchRef={randomModeCreatorMetadataPatchRef}
            ratingMetadataPatchRef={randomModeRatingMetadataPatchRef}
          />
        ) : viewMode === 'gallery' ? (
          <GalleryModePage
            config={config}
            directoryCount={config.mediaPaths.length}
            filteredStatsLabel={filteredStats.label}
            filteredStatsTotal={filteredStats.total}
            currentFile={currentFile}
            setCurrentFile={setCurrentFile}
            setCurrentCreator={setCurrentCreator}
            creatorRefreshKey={creatorRefreshKey}
            mediaUrl={mediaUrl}
            setMediaUrl={setMediaUrl}
            transcodeUrl={transcodeUrl}
            setTranscodeUrl={setTranscodeUrl}
            originalStreamUrl={originalStreamUrl}
            setOriginalStreamUrl={setOriginalStreamUrl}
            mediaType={mediaType}
            setMediaType={setMediaType}
            isUsingTranscode={isUsingTranscode}
            setIsUsingTranscode={setIsUsingTranscode}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            viewedFilter={viewedFilter}
            advancedFilters={advancedFilters}
            setPreloadStatus={setPreloadStatus}
            setCachePreloadProgress={setCachePreloadProgress}
            cachePreloadProgress={cachePreloadProgress}
            preloadInsufficient={preloadInsufficient}
            actualFoundCount={actualFoundCount}
            ratingQueueActiveCount={ratingQueueActiveCount}
            galleryPreloadReady={galleryPreloadReady}
            currentRating={currentRating}
            setCurrentRating={setCurrentRating}
            ratingType={ratingType}
            setRatingType={setRatingType}
            handleQuickRate={handleQuickRate}
            openRatingDialog={openRatingDialog}
            onOpenCreatorDialog={() => setCreatorDialogOpen(true)}
            onOpenCreatorDetail={openCreatorDetail}
            ratingDialogOpen={ratingDialogOpen}
            closeRatingDialog={closeRatingDialog}
            saveRatingManual={saveRatingManual}
            handleRatingSaveSuccess={handleRatingSaveSuccess}
            fullscreen={fullscreen}
            toggleFullscreen={toggleFullscreen}
            isMobile={isMobile}
            videoRef={videoRef}
            mobileVideoRef={mobileVideoRef}
            videoPlayerContainerRef={videoPlayerContainerRef}
            shouldAutoPlay={shouldAutoPlay}
            playIntentRef={playIntentRef}
            videoStateRef={videoStateRef}
            loadCurrentRatingRef={loadCurrentRatingRef}
            startAutoMarkTimerRef={startAutoMarkTimerRef}
            handleMediaTypeChangeInFullscreenRef={handleMediaTypeChangeInFullscreenRef}
            enterVideoFullscreenRef={enterVideoFullscreenRef}
            isVideoRef={isVideoRef}
            performAutoRating={performAutoRating}
            setPlayIntent={setPlayIntent}
            stopAutoMarkTimer={stopAutoMarkTimer}
            onGalleryStateChange={(group, index) => {
              setCurrentGroup(group)
              setCurrentGroupIndex(index)
            }}
            creatorMetadataPatchRef={galleryModeCreatorMetadataPatchRef}
          />
        ) : viewMode === 'large-video' ? (
          <LargeVideoModePage
            config={config}
            directoryCount={config.mediaPaths.length}
            filteredStatsLabel={filteredStats.label}
            filteredStatsTotal={filteredStats.total}
            currentFile={currentFile}
            mediaUrl={mediaUrl}
            transcodeUrl={transcodeUrl}
            originalStreamUrl={originalStreamUrl}
            mediaType={mediaType}
            isUsingTranscode={isUsingTranscode}
            loading={loading}
            viewedFilter={viewedFilter}
            advancedFilters={advancedFilters}
            preloadRandomness={preloadRandomness}
            ratingQueueActiveCount={ratingQueueActiveCount}
            currentRating={currentRating}
            creatorRefreshKey={creatorRefreshKey}
            fullscreen={fullscreen}
            toggleFullscreen={toggleFullscreen}
            isMobile={isMobile}
            videoPlayerContainerRef={videoPlayerContainerRef}
            playIntentRef={playIntentRef}
            loadCurrentRatingRef={loadCurrentRatingRef}
            startAutoMarkTimerRef={startAutoMarkTimerRef}
            handleMediaTypeChangeInFullscreenRef={handleMediaTypeChangeInFullscreenRef}
            enterVideoFullscreenRef={enterVideoFullscreenRef}
            handleQuickRate={handleQuickRate}
            openRatingDialog={openRatingDialog}
            onOpenCreatorDialog={() => setCreatorDialogOpen(true)}
            onOpenCreatorDetail={openCreatorDetail}
            ratingDialogOpen={ratingDialogOpen}
            closeRatingDialog={closeRatingDialog}
            saveRatingManual={saveRatingManual}
            handleRatingSaveSuccess={handleRatingSaveSuccess}
            setCurrentFile={setCurrentFile}
            setCurrentCreator={setCurrentCreator}
            setLoading={setLoading}
            setError={setError}
            setMediaUrl={setMediaUrl}
            setTranscodeUrl={setTranscodeUrl}
            setOriginalStreamUrl={setOriginalStreamUrl}
            setIsUsingTranscode={setIsUsingTranscode}
            setMediaType={setMediaType}
            setRatingType={setRatingType}
            setCurrentRating={setCurrentRating}
            setPreloadStatus={setPreloadStatus}
            performAutoRating={performAutoRating}
            stopAutoMarkTimer={stopAutoMarkTimer}
            setSnackbarMessage={setSnackbarMessage}
            setSnackbarSeverity={setSnackbarSeverity}
            setSnackbarOpen={setSnackbarOpen}
            highlightContinuousPlayEnabled={highlightContinuousPlayEnabled}
            suspended={creatorDetailSuspended}
          />
        ) : null}
      </Container>

      <SettingsDrawer
        open={drawerOpen}
        onClose={toggleDrawer(false)}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        currentGroup={currentGroup}
        currentGroupIndex={currentGroupIndex}
        currentFile={currentFile}
        onOpenRatingDialog={openRatingDialog}
        optimisticUpdateEnabled={optimisticUpdateEnabled}
        onOptimisticUpdateEnabledChange={handleOptimisticUpdateEnabledChange}
        erudaEnabled={erudaEnabled}
        onErudaEnabledChange={handleErudaEnabledChange}
        preloadRandomness={preloadRandomness}
        onPreloadRandomnessChange={handlePreloadRandomnessChange}
        preloadStatus={preloadStatus}
        onClearCache={handleClearCache}
        onResetButtonPositions={handleResetButtonPositions}
        highlightContinuousPlayEnabled={highlightContinuousPlayEnabled}
        onHighlightContinuousPlayEnabledChange={handleHighlightContinuousPlayEnabledChange}
        viewedFilter={viewedFilter}
        onViewedFilterChange={handleViewedFilterChangeWrapper}
        stats={stats}
        localViewedCount={databasePreloadManager.getLocalViewedCount()}
        onRestartViewedMode={handleRestartViewedMode}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={setAdvancedFilters}
        availableEvaluations={availableEvaluations}
        availableCategories={availableCategories}
        mediaFilter={mediaFilter}
        onMediaFilterChange={handleMediaFilterChangeWrapper}
        config={config}
        loading={loading}
        onNavigateToManage={() => router.push('/manage')}
      />

      <CreatorDialog
        open={creatorDialogOpen}
        onClose={() => setCreatorDialogOpen(false)}
        filePath={currentFile?.filename || ''}
        existingCreator={currentCreator}
        onMarkUnknown={() => {
          setCurrentCreator(null)
          if (currentFile?.filename) {
            patchCreatorMetadataAcrossState(currentFile.filename, null, true)
          }
          setCreatorRefreshKey((prev) => prev + 1)
        }}
        onSuccess={() => {
          if (currentFile) {
            setCurrentCreator(null)
            patchCreatorMetadataAcrossState(currentFile.filename, null, false)
            setCreatorRefreshKey((prev) => prev + 1)
            void loadMediaRating(currentFile.filename)
          }
        }}
      />

      <CreatorDetailDrawer
        open={creatorDetailOpen}
        creator={currentCreator}
        onCreatorUpdated={(creator) => {
          setCurrentCreator(creator)
          setCreatorRefreshKey((prev) => prev + 1)
        }}
        onError={(message) => notify(message, 'error')}
        onClose={() => {
          setCreatorDetailOpen(false)
          setCreatorDetailSuspended(false)
          closeCreatorPreview()
        }}
        onPreviewMedia={openCreatorPreview}
        previewOpen={creatorPreviewOpen}
        previewList={creatorPreviewList}
        previewMedia={creatorPreviewCurrent}
        previewIndex={creatorPreviewIndex}
        previewTotal={creatorPreviewList.length}
        onClosePreview={closeCreatorPreview}
        onPreviewPrev={() => goCreatorPreview('prev')}
        onPreviewNext={() => goCreatorPreview('next')}
        onPreviewListChange={updateCreatorPreviewList}
      />

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={2000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ zIndex: 9999 }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbarSeverity} variant="filled" sx={{ width: '100%', fontSize: '1.1rem', fontWeight: 'bold' }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  )
}
