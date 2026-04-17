'use client'

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
import SettingsDrawer from '@/components/SettingsDrawer'
import GalleryModePage from '@/components/split-main/modes/GalleryModePage'
import LargeVideoModePage from '@/components/split-main/modes/LargeVideoModePage'
import RandomModePage from '@/components/split-main/modes/RandomModePage'
import databasePreloadManager from '@/lib/databasePreloadManager'
import { setErudaEnabled } from '@/lib/erudaInit'
import { QUICK_RATING_CONFIG } from '@/types'
import type {
  AdvancedFilters,
  GroupRating,
  MediaFile,
  MediaFilter,
  MediaRating,
  MediaType,
  ViewMode,
  ViewedFilter,
  WebDAVConfig,
} from '@/types'

interface SplitMainWorkspaceProps {
  initialViewMode?: ViewMode
  respectStoredViewMode?: boolean
}

/**
 * 主工作区壳层自己的提示类型。
 *
 * 这里只服务于主壳层统一管理的 Snackbar，
 * 各模式页面通过注入的 setter 或回调复用这套全局提示能力。
 */
type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning'

const PAGE_LINKS = [
  { label: '原始主页面', path: '/', icon: <AppsIcon fontSize="small" /> },
  { label: '拆分总入口', path: '/split-main', icon: <AppsIcon fontSize="small" /> },
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

/**
 * 拆分主页面工作区壳层。
 *
 * 当前这个组件只保留“跨模式共享”的职责：
 * - WebDAV 配置加载与基础统计
 * - 顶部导航、抽屉、全局 Snackbar、CreatorDialog
 * - 共享评分与自动标记能力
 * - 模式切换与预加载调度
 * - 将共享能力注入到随机 / 图组 / 大视频三个独立模式页面
 *
 * 已经拆分出去的内容包括：
 * - 随机模式页面与随机模式专属 Hook
 * - 图组模式页面与图组模式专属 Hook
 * - 大视频模式页面与大视频模式专属 Hook
 * - 共享播放地址解析工具
 *
 * 因此这里理论上不再承载“某个模式专有的页面 UI 与交互流程”，
 * 剩余保留在这里的逻辑都属于壳层共享能力或多模式协调逻辑。
 */
export default function SplitMainWorkspace({
  initialViewMode = 'random',
  respectStoredViewMode = true,
}: SplitMainWorkspaceProps) {
  const router = useRouter()

  /**
   * 基础配置与当前媒体状态。
   *
   * 这部分数据被三个模式页面共享，因此继续保留在主壳层统一维护：
   * - 当前配置
   * - 当前媒体文件
   * - 当前媒体播放地址
   * - 当前是否在走转码
   * - 当前基础统计信息
   */
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

  /**
   * 共享筛选与模式状态。
   *
   * 这些状态决定当前是随机 / 图组 / 大视频中的哪一种浏览方式，
   * 同时也驱动预加载调度与抽屉展示。
   */
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

  /**
   * 壳层 UI 状态。
   *
   * 包括抽屉、全屏、预加载状态、连续播放配置等跨模式共享的可视状态。
   */
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode)
  const [preloadEnabled, setPreloadEnabled] = useState(true)
  const [preloadStatus, setPreloadStatus] = useState<{ cacheSize: number; maxCacheSize: number } | null>(null)
  const [optimisticUpdateEnabled, setOptimisticUpdateEnabled] = useState(true)
  const [erudaEnabled, setErudaEnabledState] = useState(false)
  const [cachePreloadProgress, setCachePreloadProgress] = useState<{ current: number; total: number } | null>(null)
  const [preloadInsufficient, setPreloadInsufficient] = useState(false)
  const [actualFoundCount, setActualFoundCount] = useState(0)
  const [galleryPreloadReady, setGalleryPreloadReady] = useState(false)
  const [preloadRandomness, setPreloadRandomness] = useState(1)
  const [highlightContinuousPlayEnabled, setHighlightContinuousPlayEnabled] = useState(false)

  /**
   * 共享评分与博主弹窗状态。
   *
   * 评分能力仍由壳层统一提供，因为：
   * - 媒体评分 / 图组评分接口是一套共享能力
   * - 自动标记“已看过”也是跨模式复用逻辑
   * - CreatorDialog 同样不属于单一模式页面
   */
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false)
  const [currentRating, setCurrentRating] = useState<MediaRating | GroupRating | null>(null)
  const [ratingType, setRatingType] = useState<'media' | 'group'>('media')
  const [creatorDialogOpen, setCreatorDialogOpen] = useState(false)
  const [currentCreator, setCurrentCreator] = useState<any>(null)
  const [creatorRefreshKey, setCreatorRefreshKey] = useState(0)

  /**
   * 壳层级运行时状态。
   * - 自动标记定时器
   * - 移动端识别
   * - 全局 Snackbar 提示
   * - 页面入口菜单
   */
  const [autoMarkTimer, setAutoMarkTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState<SnackbarSeverity>('success')

  const [pageMenuAnchor, setPageMenuAnchor] = useState<HTMLElement | null>(null)
  const pageMenuOpen = Boolean(pageMenuAnchor)

  /**
   * 壳层 ref 集合。
   *
   * 这里保存的是跨模式共享的引用：
   * - 抽屉快照
   * - 当前视图模式 ref
   * - 自动评分防重标记
   * - 播放意图与视频续播状态
   */
  const configSnapshotRef = useRef<{
    mediaFilter: MediaFilter
    viewedFilter: ViewedFilter
    viewMode: ViewMode
    advancedFilters: AdvancedFilters
  } | null>(null)
  const initialPreloadTriggeredRef = useRef(false)
  const viewModeRef = useRef<ViewMode>(viewMode)
  const hasAutoRatedRef = useRef(false)
  const playIntentRef = useRef(true)
  const videoStateRef = useRef<{ currentTime: number; paused: boolean } | null>(null)

  /**
   * 共享播放器 DOM 引用。
   *
   * 随机模式与图组模式复用小视频播放器引用，
   * 大视频模式则复用容器级全屏挂载能力。
   */
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

  /**
   * 共享统计视图。
   *
   * 仅用于顶部、空状态与抽屉里统一展示“当前筛选下的统计结果”，
   * 不绑定任何单一模式页面。
   */
  const filteredStats = useMemo(() => {
    if (mediaFilter === 'images') {
      return { total: stats.images, label: '图片' }
    }
    if (mediaFilter === 'videos') {
      return { total: stats.videos, label: '视频' }
    }
    return { total: stats.total, label: '全部' }
  }, [mediaFilter, stats])

  /**
   * 跨模式共享的“是否继续自动播放”意图设置。
   * 页面层和模式 Hook 通过这个入口读写，而不是直接操作多个状态字段。
   */
  const setPlayIntent = useCallback((intent: boolean) => {
    playIntentRef.current = intent
    setShouldAutoPlay(intent)
  }, [])

  /**
   * 统一通知入口。
   * 所有模式页面都复用壳层的 Snackbar，而不自己维护一套新的全局提示系统。
   */
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
    notify,
  })

  /**
   * 清空当前预览状态。
   *
   * 注意：这里只清理“当前媒体与播放上下文”，
   * 不直接处理模式特有页面逻辑；模式自己的 UI 已经拆分到各自页面中。
   */
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

  /**
   * 模式预加载调度已经进一步从壳层中拆分出去。
   *
   * 目前 [`SplitMainWorkspace`](components/split-main/SplitMainWorkspace.tsx)
   * 内剩余的模式相关部分，主要只包括：
   * - 当前模式选择与页面分发
   * - 某些跨模式共享但会感知模式的协调逻辑（如预加载入口、键盘快捷键）
   *
   * 真正的模式专属页面与模式专属媒体切换流程，已经不再写在这里。
   */
  const {
    runGalleryPreload,
    runRandomPreload,
    rerunModePreload,
  } = useSplitMainPreload({
    config,
    preloadEnabled,
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

  /**
   * 当前壳层默认不根据媒体类型执行特殊“切换中自动进全屏”行为。
   * 真正需要改变这条策略的模式，会通过注入的 ref 自己消费这个判定结果。
   */
  const handleMediaTypeChangeInFullscreen = useCallback((_nextFile: MediaFile): boolean => {
    return false
  }, [])

  /**
   * 进入原生全屏后，若仍保留播放意图，则尝试恢复视频播放。
   * 用于处理部分浏览器在切换全屏时打断视频播放的问题。
   */
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

  /**
   * 统一进入视频容器的原生全屏。
   * 三个模式页面都复用这个入口，而不是各自直接操作 DOM 容器。
   */
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

  /**
   * 页面级全屏状态切换。
   * 这只是 React 状态层面的开关，是否进入原生全屏由模式页面自行决定何时调用
   * [`enterVideoFullscreen()`](components/split-main/SplitMainWorkspace.tsx:502)。
   */
  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => !prev)
  }, [])

  /** 评分保存成功后的统一提示。 */
  const handleRatingSaveSuccess = useCallback(() => {
    notify('✅ 评分保存成功', 'success')
  }, [notify])

  /**
   * 抽屉开关逻辑。
   *
   * 打开时记录快照；关闭时只处理“筛选条件”变化。
   * 浏览模式切换本身已经在 [`handleViewModeChange()`](components/split-main/SplitMainWorkspace.tsx:484)
   * 中立即清理并重跑预加载，因此这里不能再把 `viewMode` 变化算进“需要重跑”里，
   * 否则会在抽屉关闭时重复触发一次预加载。
   */
 
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
/**
   * 切换浏览模式。
   *
   * 这里只做共享壳层层面的事情：
   * - 持久化模式
   * - 清理当前预览
   * - 清空缓存与图组索引
   * - 重置预加载状态
   *
   * 真正模式页面的内部状态由各自页面自行管理。
   */
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
      setGalleryPreloadReady(!preloadEnabled)
    } else {
      setGalleryPreloadReady(true)
    }

    setCachePreloadProgress(null)
    setPreloadInsufficient(false)
    setActualFoundCount(0)
    initialPreloadTriggeredRef.current = false

    /**
     * 模式切换后直接重跑当前模式预加载。
     *
     * 这里不能再只依赖“首次预加载 effect”，因为那个 effect 现在主要负责刷新页面后的首次进入；
     * 真正的模式切换应当在这里立即取消旧任务并启动新模式的预加载，
     * 否则从图组切到随机时，顶部进度数字只会看到后续文件请求，却没有真正绑定到新的预加载进度流。
     */
    rerunModePreload()
  }, [preloadEnabled, rerunModePreload, resetCurrentPreviewState, viewMode])

  /** 预加载总开关。 */
  const handlePreloadEnabledChange = useCallback((enabled: boolean) => {
    setPreloadEnabled(enabled)

    if (!enabled) {
      databasePreloadManager.cancelAllPreloads()
      databasePreloadManager.clearCache()
      databasePreloadManager.clearNextGroupCache()
      setPreloadStatus(databasePreloadManager.getCacheStatus())
      setCachePreloadProgress(null)
      setGalleryPreloadReady(true)
      return
    }

    initialPreloadTriggeredRef.current = false
  }, [])

  /** 乐观更新总开关。 */
  const handleOptimisticUpdateEnabledChange = useCallback((enabled: boolean) => {
    setOptimisticUpdateEnabled(enabled)
    localStorage.setItem('optimistic_update_enabled', enabled.toString())
  }, [])

  /** Eruda 调试开关。 */
  const handleErudaEnabledChange = useCallback((enabled: boolean) => {
    setErudaEnabledState(enabled)
    setErudaEnabled(enabled)
    notify(enabled ? 'Eruda 已启用，请刷新页面生效' : 'Eruda 已禁用，请刷新页面生效', 'info')
  }, [notify])

  /** 预加载随机性参数调整。 */
  const handlePreloadRandomnessChange = useCallback((value: number) => {
    setPreloadRandomness(value)
    localStorage.setItem('preload_randomness', value.toString())
  }, [])

  /** 清理预加载缓存。 */
  const handleClearCache = useCallback(() => {
    databasePreloadManager.clearCache()
    setPreloadStatus(databasePreloadManager.getCacheStatus())
    notify('缓存已清理', 'info')
  }, [notify])

  /** 重置拖拽按钮位置。 */
  const handleResetButtonPositions = useCallback(() => {
    ;['fullscreen_rating', 'fullscreen_shuffle', 'normal_shuffle'].forEach((key) => {
      localStorage.removeItem(`draggable_${key}_position`)
    })

    notify('按钮位置已复位，刷新页面生效', 'success')
    setTimeout(() => {
      window.location.reload()
    }, 1000)
  }, [notify])

  /** 已看过筛选切换包装器。 */
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

  /** 重新开始“已看过”模式浏览。 */
  const handleRestartViewedMode = useCallback(() => {
    databasePreloadManager.clearLocalViewedFiles()
    notify('已清除本地观看记录，可以重新观看', 'success')
  }, [notify])

  /** 媒体类型筛选切换包装器。 */
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

  /** 打开评分弹窗。 */
  const openRatingDialog = useCallback((type: 'media' | 'group') => {
    setRatingType(type)
    setRatingDialogOpen(true)
  }, [])

  /** 关闭评分弹窗。 */
  const closeRatingDialog = useCallback(() => {
    setRatingDialogOpen(false)
  }, [])

  /** 关闭全局 Snackbar。 */
  const handleCloseSnackbar = useCallback(() => {
    setSnackbarOpen(false)
  }, [])

  /** 精彩时刻连续播放开关。 */
  const handleHighlightContinuousPlayEnabledChange = useCallback((enabled: boolean) => {
    setHighlightContinuousPlayEnabled(enabled)
    localStorage.setItem('highlight_continuous_play_enabled', enabled.toString())
    notify(enabled ? '已启用连续播放精彩时刻' : '已关闭连续播放精彩时刻', 'info')
  }, [notify])

  /** 页面入口菜单打开。 */
  const handlePageMenuOpen = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    setPageMenuAnchor(event.currentTarget)
  }, [])

  /** 页面入口菜单关闭。 */
  const handlePageMenuClose = useCallback(() => {
    setPageMenuAnchor(null)
  }, [])

  /** 在新标签页打开站内页面。 */
  const openPageInNewTab = useCallback((path: string) => {
    window.open(path, '_blank', 'noopener,noreferrer')
    handlePageMenuClose()
  }, [handlePageMenuClose])

  /**
   * 共享 ref 出口。
   *
   * 三个模式页面 / Hook 会通过这些 ref 调用壳层共享能力，
   * 以避免层层 props 回调导致调用链过深。
   */
  loadCurrentRatingRef.current = loadCurrentRating
  startAutoMarkTimerRef.current = startAutoMarkTimer
  handleMediaTypeChangeInFullscreenRef.current = handleMediaTypeChangeInFullscreen
  enterVideoFullscreenRef.current = enterVideoFullscreen
  isVideoRef.current = isVideoFile

  useSplitMainBootstrap({
    respectStoredViewMode,
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

  /** 保持 [`viewModeRef`](components/split-main/SplitMainWorkspace.tsx:204) 与实际状态同步。 */
  useEffect(() => {
    viewModeRef.current = viewMode
  }, [viewMode])

  /**
   * 原生全屏变化监听。
   * 这里只处理共享小视频全屏状态同步；
   * 大视频模式的原生全屏播放器状态由它自己的页面内部维护。
   */
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

  /**
   * 首次预加载入口。
   * 根据当前模式决定是否拉起图组预加载、随机预加载，或直接跳过（大视频模式）。
   *
   * 这里刻意依赖 [`viewModeRef`](components/split-main/SplitMainWorkspace.tsx:241)
   * 而不是直接依赖 `viewMode` 状态做首次分流，原因是：
   * - 刷新页面时，真实模式可能来自 localStorage
   * - `viewMode` 状态更新和 `stats/config` 初始化存在时序差
   * - 如果首次 effect 在 `viewMode` 还没切到 gallery 前就执行，
   *   会错误走到随机模式分支，并把 [`initialPreloadTriggeredRef`](components/split-main/SplitMainWorkspace.tsx:240)
   *   提前置为 `true`
   * - 这样后续即使界面已经切到图组模式，也不会再触发真正的图组预加载
   *
   * 因此首次预加载必须以 ref 中已经同步好的“最终模式”作为判定依据。
   */
  useEffect(() => {
    if (!stats.total || !preloadEnabled || !config || initialPreloadTriggeredRef.current) {
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
  }, [config, preloadEnabled, runGalleryPreload, runRandomPreload, stats.total])

  /**
   * 预加载状态同步到顶部进度显示。
   * 大视频模式不参与小文件预加载，因此直接跳过。
   */
  useEffect(() => {
    if (viewMode === 'large-video') {
      return
    }

    if (preloadEnabled && config && preloadStatus) {
      const preloadCount = config.scanSettings?.preloadCount || 10
      setCachePreloadProgress((prev) => {
        if (prev && prev.current === preloadStatus.cacheSize) {
          return prev
        }
        return { current: preloadStatus.cacheSize, total: preloadCount }
      })
    }
  }, [config, preloadEnabled, preloadStatus, viewMode])

  /**
   * 共享键盘快捷键。
   *
   * 这部分继续保留在壳层，是因为它属于跨模式共享输入体系：
   * - 1~5：快速评分
   * - R：打开媒体评分
   * - G：仅图组模式下打开图组评分
   */
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

  /** 页面卸载时清理自动标记定时器。 */
  useEffect(() => {
    return () => {
      if (autoMarkTimer) {
        clearTimeout(autoMarkTimer)
      }
    }
  }, [autoMarkTimer])

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
          zIndex: 100,
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
            {preloadEnabled && cachePreloadProgress && viewMode !== 'large-video' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 0.5 }}>
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
        {/* 壳层统一错误提示。 */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/*
          模式页面分发层。
          这是当前壳层保留的最后一层“模式相关逻辑”：
          只负责根据 [`viewMode`](components/split-main/SplitMainWorkspace.tsx:171)
          选择挂载哪个已拆分页面，并注入共享能力。
        */}
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
            preloadEnabled={preloadEnabled}
            preloadRandomness={preloadRandomness}
            setPreloadStatus={setPreloadStatus}
            setCachePreloadProgress={setCachePreloadProgress}
            cachePreloadProgress={cachePreloadProgress}
            setPreloadInsufficient={setPreloadInsufficient}
            preloadInsufficient={preloadInsufficient}
            setActualFoundCount={setActualFoundCount}
            actualFoundCount={actualFoundCount}
            currentRating={currentRating}
            setCurrentRating={setCurrentRating}
            setRatingType={setRatingType}
            handleQuickRate={handleQuickRate}
            openRatingDialog={openRatingDialog}
            onOpenCreatorDialog={() => setCreatorDialogOpen(true)}
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
            preloadEnabled={preloadEnabled}
            setPreloadStatus={setPreloadStatus}
            setCachePreloadProgress={setCachePreloadProgress}
            cachePreloadProgress={cachePreloadProgress}
            preloadInsufficient={preloadInsufficient}
            actualFoundCount={actualFoundCount}
            galleryPreloadReady={galleryPreloadReady}
            currentRating={currentRating}
            setCurrentRating={setCurrentRating}
            ratingType={ratingType}
            setRatingType={setRatingType}
            handleQuickRate={handleQuickRate}
            openRatingDialog={openRatingDialog}
            onOpenCreatorDialog={() => setCreatorDialogOpen(true)}
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
          />
        ) : (
          null
        )}
      </Container>

      {/* 右侧抽屉：展示跨模式共享的筛选、统计与配置入口。 */}
      <SettingsDrawer
        open={drawerOpen}
        onClose={toggleDrawer(false)}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        currentGroup={currentGroup}
        currentGroupIndex={currentGroupIndex}
        currentFile={currentFile}
        onOpenRatingDialog={openRatingDialog}
        preloadEnabled={preloadEnabled}
        onPreloadEnabledChange={handlePreloadEnabledChange}
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

      {/* 全局博主信息弹窗。 */}
      <CreatorDialog
        open={creatorDialogOpen}
        onClose={() => setCreatorDialogOpen(false)}
        filePath={currentFile?.filename || ''}
        existingCreator={currentCreator}
        onMarkUnknown={() => {
          setCurrentCreator(null)
          setCreatorRefreshKey((prev) => prev + 1)
        }}
        onSuccess={() => {
          if (currentFile) {
            setCreatorRefreshKey((prev) => prev + 1)
            void loadMediaRating(currentFile.filename)
          }
        }}
      />

      {/* 壳层全局通知。 */}
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
