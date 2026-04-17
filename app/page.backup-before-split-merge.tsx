﻿'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Container,
  Box,
  Typography,
  Button,
  Card,
  CardMedia,
  CardContent,
  CircularProgress,
  Alert,
  Paper,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
  Fab,
  Drawer,
  IconButton,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Stack,
  Snackbar,
  Slider,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import {
  Shuffle as ShuffleIcon,
  Settings as SettingsIcon,
  CloudOff as CloudOffIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
  PhotoLibrary as PhotoLibraryIcon,
  Close as CloseIcon,
  FilterList as FilterListIcon,
  Folder as FolderIcon,
  BarChart as BarChartIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  Collections as CollectionsIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  SkipNext as SkipNextIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  RateReview as RateReviewIcon,
  ManageAccounts as ManageAccountsIcon,
  Refresh as RefreshIcon,
  Download as DownloadIcon,
  Speed as SpeedIcon,
  OpenInNew as OpenInNewIcon,
  BugReport as BugReportIcon,
  Storage as StorageIcon,
  Apps as AppsIcon,
} from '@mui/icons-material'
import { useRouter } from 'next/navigation'
import RatingDialog from '@/components/RatingDialog'
import RatingStatus from '@/components/RatingStatus'
import QuickRating from '@/components/QuickRating'
// 适用于全屏的评分组件可拖拽
import DraggableBox from '@/components/DraggableBox'
// 适用于全屏模式换一个按钮,非全屏模式换一个按钮可拖拽
import DraggableFab from '@/components/DraggableFab'
import InstantVideoPlayer from '@/components/InstantVideoPlayer'
import MobileVideoPlayer from '@/components/MobileVideoPlayer'
import CreatorTag from '@/components/CreatorTag'
import CreatorDialog from '@/components/CreatorDialog'
import { useVideoHighlightsModule } from '@/components/VideoHighlightsModule'
import databasePreloadManager from '@/lib/databasePreloadManager'
import { getPlaybackStrategy, buildVideoStreamUrl } from '@/lib/videoFormat'
import { initEruda, getErudaEnabled, setErudaEnabled } from '@/lib/erudaInit'
import SettingsDrawer from '@/components/SettingsDrawer'
import { QUICK_RATING_CONFIG } from '@/types'
import type { WebDAVConfig, MediaFilter, ViewMode, ViewedFilter, AdvancedFilters, MediaFile, MediaType, MediaRating, GroupRating, QuickRatingConfig } from '@/types'

// 主界面右上角的页面入口配置，统一集中在这里，便于后续复用和维护。
const PAGE_LINKS = [
  { label: '观看数据看板', path: '/dashboard', icon: <BarChartIcon fontSize="small" /> },
  { label: '评价与分类管理', path: '/manage', icon: <ManageAccountsIcon fontSize="small" /> },
  { label: 'WebDAV 设置', path: '/config', icon: <SettingsIcon fontSize="small" /> },
  { label: '博主管理测试', path: '/creator-test', icon: <BugReportIcon fontSize="small" /> },
  { label: '流播放测试', path: '/stream-test', icon: <BugReportIcon fontSize="small" /> },
  { label: '随机抽取测试', path: '/random-test', icon: <BugReportIcon fontSize="small" /> },
  { label: '主页面拆分实验', path: '/split-main', icon: <AppsIcon fontSize="small" /> },
  { label: '数据库查询', path: '/admin/query-db', icon: <StorageIcon fontSize="small" /> },
] as const

export default function HomePage() {
  const router = useRouter()
  // WebDAV 配置
  const [config, setConfig] = useState<WebDAVConfig | null>(null)
  // 当前显示的文件
  const [currentFile, setCurrentFile] = useState<MediaFile | null>(null)
  // 随机模式历史记录（用于回看功能，最多保存4个(包含一个当前文件,实际效果是回看前3个文件)）
  const [randomHistory, setRandomHistory] = useState<MediaFile[]>([])
  // 随机模式当前位置（-1表示最新，-2表示倒数第二个，以此类推）
  const [randomHistoryIndex, setRandomHistoryIndex] = useState<number>(-1)
  // 随机模式历史文件的 blob URL 缓存（用于快速回看，key: filename, value: {url, blob, mediaType, originalStreamUrl, directPlayAvailable}）
  const randomHistoryCache = useRef<Map<string, {
    url: string
    blob: Blob
    mediaType: MediaType
    originalStreamUrl: string | null
    directPlayAvailable?: boolean
  }>>(new Map())
  // 加载状态
  const [loading, setLoading] = useState(false)
  // 错误信息
  const [error, setError] = useState<string | null>(null)
  // 媒体文件 URL
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  // 转码流 URL（用于不支持的格式自动降级）
  const [transcodeUrl, setTranscodeUrl] = useState<string | null>(null)
  // 原始流 URL（用于外部播放器）
  const [originalStreamUrl, setOriginalStreamUrl] = useState<string | null>(null)
  // 是否正在使用转码流
  const [isUsingTranscode, setIsUsingTranscode] = useState(false)
  // 文件统计信息（从数据库获取）
  const [stats, setStats] = useState({ total: 0, images: 0, videos: 0, viewed: 0 })
  // 媒体类型筛选
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  // 已看过筛选，默认只显示未看过的
  const [viewedFilter, setViewedFilter] = useState<ViewedFilter>('unviewed')
  // 高级过滤条件（仅已看过模式）
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>({
    ratings: [],
    evaluations: [],
    categories: [],
    reasonFilter: 'all',
    reasonKeyword: '',
    ratingEmptyFilter: undefined,
    evaluationEmptyFilter: undefined,
    categoryEmptyFilter: undefined
  })
  // 可用的评价标签和分类（从数据库加载）
  const [availableEvaluations, setAvailableEvaluations] = useState<string[]>([])
  const [availableCategories, setAvailableCategories] = useState<string[]>([])
  // 抽屉打开状态
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 全屏状态
  const [fullscreen, setFullscreen] = useState(false)
  // 查看模式：随机或图组
  const [viewMode, setViewMode] = useState<ViewMode>('random')
  
  // 用于追踪配置变化，只在关闭抽屉时检查是否需要重新加载
  const configSnapshotRef = useRef<{ 
    mediaFilter: MediaFilter
    viewedFilter: ViewedFilter
    viewMode: ViewMode
    advancedFilters: AdvancedFilters
  } | null>(null)
  // 当前图组的文件列表
  const [currentGroup, setCurrentGroup] = useState<MediaFile[]>([])
  // 当前图组中的索引
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0)
  // 扫描进度
  const [scanProgress, setScanProgress] = useState<{ currentPath: string, fileCount: number } | null>(null)
  
  // 预加载功能开关
  const [preloadEnabled, setPreloadEnabled] = useState(true)
  // 预加载状态（缓存大小信息）
  const [preloadStatus, setPreloadStatus] = useState<{ cacheSize: number, maxCacheSize: number } | null>(null)
  
  // 乐观更新功能开关（默认开启）
  const [optimisticUpdateEnabled, setOptimisticUpdateEnabled] = useState(true)
  
  // Eruda 调试工具开关
  const [erudaEnabled, setErudaEnabledState] = useState(false)
  
  // 缓存预加载进度状态（图组模式和随机模式都使用）
  const [cachePreloadProgress, setCachePreloadProgress] = useState<{ current: number, total: number } | null>(null)
  // 预加载数量不足状态（用于显示三段式进度）
  const [preloadInsufficient, setPreloadInsufficient] = useState<boolean>(false)
  // 实际找到的文件数量（用于三段式进度显示）
  const [actualFoundCount, setActualFoundCount] = useState<number>(0)
  // 已看完所有文件对话框
  const [showRestartDialog, setShowRestartDialog] = useState<boolean>(false)

  // 图组模式初始预加载状态（必须完成才能预览）
  const [galleryPreloadReady, setGalleryPreloadReady] = useState(false)
  
  // 智能预加载随机性（0-1，0表示优先当前目录，1表示完全随机）
  const [preloadRandomness, setPreloadRandomness] = useState(1)
  

  
  // 评分对话框打开状态
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false)
  // 当前评分数据
  const [currentRating, setCurrentRating] = useState<MediaRating | GroupRating | null>(null)
  // 评分类型：单个媒体或图组
  const [ratingType, setRatingType] = useState<'media' | 'group'>('media')

  // 博主对话框打开状态
  const [creatorDialogOpen, setCreatorDialogOpen] = useState(false)
  // 当前识别的博主
  const [currentCreator, setCurrentCreator] = useState<any>(null)
  // 用于强制 CreatorTag 重新识别博主
  const [creatorRefreshKey, setCreatorRefreshKey] = useState(0)
  
  // 查看开始时间（用于自动标记已看过）
  const [viewStartTime, setViewStartTime] = useState<number | null>(null)
  // 自动标记计时器
  const [autoMarkTimer, setAutoMarkTimer] = useState<NodeJS.Timeout | null>(null)
  // 追踪当前文件是否已自动评分（使用 ref 避免闭包陷阱）
  const hasAutoRatedRef = useRef(false)
  // 追踪初始预加载是否已触发
  const initialPreloadTriggeredRef = useRef(false)
  // 追踪当前模式（使用 ref 避免闭包陷阱）
  const viewModeRef = useRef<ViewMode>(viewMode)
  // 智能预加载防抖动定时器
  const smartPreloadTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // 智能预加载进行中标志
  const smartPreloadInProgressRef = useRef(false)
  
  // 检测是否为移动端（使用 state 避免 hydration 错误）
  const [isMobile, setIsMobile] = useState(false)
  
  // 手势滑动相关状态（仅移动端全屏模式）
  // ⭐ 使用 useRef 避免 React 闭包陷阱：useState 的值在事件回调中是快照，
  // 导致 handleTouchEnd 读取到的 isSwiping/touchStartY 可能是旧值（false/null），
  // 从而误判为"未滑动"而跳过切换逻辑
  const touchStartYRef = useRef<number | null>(null)
  const touchStartXRef = useRef<number | null>(null)
  const isSwipingRef = useRef(false)
  const swipeThreshold = 50 // 滑动阈值（像素），降低以提升灵敏度
  
  // 切换状态，防止连续快速点击
  const [isSwitching, setIsSwitching] = useState(false)
  const isSwitchingRef = useRef(false) // 同步 isSwitching，避免闭包陷阱
  
  // 提示消息打开状态
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  // 提示消息内容
  const [snackbarMessage, setSnackbarMessage] = useState('')
  // 提示消息严重程度
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error' | 'info' | 'warning'>('success')
  
  // 大视频模式下 CreatorTag 随 controls 显示/隐藏
  const [streamVideoTagVisible, setStreamVideoTagVisible] = useState(true)
  
  // 视频元素引用（普通模式，用于小视频）
  const videoRef = useRef<HTMLVideoElement>(null)
  // MobileVideoPlayer 引用（用于移动端小视频）
  const mobileVideoRef = useRef<any>(null)
  // InstantVideoPlayer 引用（用于流式播放大视频）
  const instantVideoRef = useRef<any>(null)
  // 视频播放器容器引用（用于原生全屏 API）
  const videoPlayerContainerRef = useRef<HTMLDivElement>(null)
  
  // 视频播放状态保存（用于全屏切换时保持播放状态，仅图片全屏需要）
  const videoStateRef = useRef<{ currentTime: number; paused: boolean } | null>(null)
  
  // 播放意图标记（用于移动端自动播放）
  const playIntentRef = useRef(true) // 默认为 true，视频应该自动播放
  // 自动播放状态（用于触发组件重新渲染）
  const [shouldAutoPlay, setShouldAutoPlay] = useState(true) // 默认为 true，视频应该自动播放
  
  // 外部播放器菜单状态
  const [externalPlayerAnchor, setExternalPlayerAnchor] = useState<null | HTMLElement>(null)
  const externalPlayerMenuOpen = Boolean(externalPlayerAnchor)
  // 页面入口菜单状态，用于控制右上角的下拉导航菜单。
  const [pageMenuAnchor, setPageMenuAnchor] = useState<null | HTMLElement>(null)
  const pageMenuOpen = Boolean(pageMenuAnchor)
  // 播放方式选择状态（在视频框中央显示）
  const [showPlayModeSelector, setShowPlayModeSelector] = useState(false)
  // 小视频直链按钮是否显示：仅在命中“中等体积 + 已启用直链”条件时开启。
  const [smallVideoDirectPlayEnabled, setSmallVideoDirectPlayEnabled] = useState(false)
  // 使用 ref 保存当前文件是否支持直链快捷切换，避免在异步切换播放源时读到旧 state。
  const smallVideoDirectPlayAvailableRef = useRef(false)

  // 媒体类型（用于条件渲染不同的播放器）
  const [mediaType, setMediaType] = useState<MediaType>('image')
  
  // 全屏过渡遮罩（用于图片全屏切换到视频全屏时的平滑过渡）
  const [fullscreenTransitionOverlay, setFullscreenTransitionOverlay] = useState(false)
  
  // 计算当前筛选条件下的统计信息（用于 UI 显示）
  const filteredStats = useMemo(() => {
    if (mediaFilter === 'images') {
      return { total: stats.images, label: '图片' }
    } else if (mediaFilter === 'videos') {
      return { total: stats.videos, label: '视频' }
    }
    return { total: stats.total, label: '全部' }
  }, [mediaFilter, stats])
  
  // 当切换文件时，重置大视频模式下 CreatorTag 的显示状态
  useEffect(() => {
    if (mediaType === 'stream-video') {
      setStreamVideoTagVisible(false)
    }
  }, [currentFile, mediaType])

  // 监听原生全屏状态变化（仅用于视频）
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement
      // 只在视频播放时同步全屏状态
      if (currentFile && isVideo(currentFile.filename)) {
        setFullscreen(isCurrentlyFullscreen)
        console.log('[原生全屏] 状态变化:', isCurrentlyFullscreen)
        
        // 如果进入了全屏且过渡遮罩还在显示，清除遮罩
        if (isCurrentlyFullscreen && fullscreenTransitionOverlay) {
          console.log('[过渡遮罩] 检测到已进入全屏，清除遮罩')
          setFullscreenTransitionOverlay(false)
        }
        
        // 在进入全屏后尝试播放视频
        if (isCurrentlyFullscreen && playIntentRef.current) {
          const video = videoRef.current
          if (video && video.paused) {
            console.log('[原生全屏] 进入全屏后尝试播放视频')
            video.play().catch(error => {
              console.log('[原生全屏] 播放失败，尝试静音播放:', error)
              video.muted = true
              video.play().then(() => {
                setTimeout(() => {
                  video.muted = false
                }, 300)
              }).catch(err => {
                console.error('[原生全屏] 静音播放也失败:', err)
              })
            })
          }
        }
      }
    }
    
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange) // Safari
    document.addEventListener('mozfullscreenchange', handleFullscreenChange) // Firefox
    document.addEventListener('MSFullscreenChange', handleFullscreenChange) // IE11
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [currentFile, fullscreenTransitionOverlay])

  // 初始化 eruda 调试工具
  useEffect(() => {
    // 从 localStorage 读取设置
    const enabled = getErudaEnabled()
    setErudaEnabledState(enabled)
    
    // 如果启用，则初始化
    if (enabled) {
      initEruda()
    }
  }, [])

  // 在客户端检测移动设备
  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase()
    const mobile = userAgent.includes('android') || /iphone|ipad|ipod/.test(userAgent)
    setIsMobile(mobile)
  }, [])

  // 检查 MobileVideoPlayer ref 是否已挂载
  useEffect(() => {
    if (isMobile) {
      console.log('[初始化] 检查 mobileVideoRef:', {
        current: mobileVideoRef.current,
        hasWarmUp: !!mobileVideoRef.current?.warmUp
      })
    }
  }, [isMobile])

  useEffect(() => {
    // 离开小视频或切换到其他文件时，立即清空直链入口状态，避免按钮残留到图片/大视频场景。
    if (mediaType !== 'small-video') {
      setSmallVideoDirectPlayEnabled(false)
      smallVideoDirectPlayAvailableRef.current = false
    }
  }, [mediaType, currentFile?.filename])

  // 初始化应用,加载默认配置
  useEffect(() => {
    // 初始化应用服务
    const initApp = async () => {
      try {
        await fetch('/api/init', { method: 'POST' })
        console.log('应用初始化完成')
      } catch (error) {
        console.error('应用初始化失败:', error)
      }
    }
    
    initApp()
    
    // 优先从数据库加载配置，如果没有则从 localStorage 加载（向后兼容）
    const loadConfig = async () => {
      try {
        // 先从数据库加载默认配置
        const response = await fetch('/api/webdav-config/default')
        if (response.ok) {
          const dbConfig = await response.json()
          if (dbConfig.url && dbConfig.username) {
            const config = {
              url: dbConfig.url,
              username: dbConfig.username,
              password: dbConfig.password,
              mediaPaths: dbConfig.mediaPaths || ['/'],
              sourceType: dbConfig.sourceType || 'clouddrive2',
              directLinkUrl: dbConfig.directLinkUrl || '',
              enableDirectLink: dbConfig.enableDirectLink || false,
              scanSettings: dbConfig.scanSettings || {
                concurrency: 10,
                preloadCount: 10
              }
            }
            setConfig(config)
            // 优先从缓存加载，避免不必要的扫描
            loadStatsFromCache(config)
            return
          }
        }
      } catch (error) {
        console.error('从数据库加载配置失败:', error)
      }
      
      // 如果数据库中没有配置，尝试从 localStorage 加载（向后兼容）
      const savedConfig = localStorage.getItem('webdav_config')
      if (savedConfig) {
        try {
          const parsed = JSON.parse(savedConfig)
          // 兼容旧版本配置
          if (parsed.mediaPath && !parsed.mediaPaths) {
            parsed.mediaPaths = [parsed.mediaPath]
          }
          if (!parsed.mediaPaths || parsed.mediaPaths.length === 0) {
            parsed.mediaPaths = ['/']
          }
          setConfig(parsed)
          // 优先从缓存加载，避免不必要的扫描
          loadStatsFromCache(parsed)
          
          // 如果 localStorage 中有配置，尝试将其保存到数据库（迁移）
          if (parsed.url && parsed.username) {
            try {
              await fetch('/api/webdav-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: parsed.url,
                  username: parsed.username,
                  password: parsed.password,
                  mediaPaths: parsed.mediaPaths || ['/'],
                  scanSettings: parsed.scanSettings || {
                    concurrency: 10,
                    preloadCount: 10
                  },
                  isDefault: true // 迁移时设为默认配置
                })
              })
            } catch (migrationError) {
              console.error('迁移配置到数据库失败:', migrationError)
            }
          }
        } catch (e) {
          console.error('加载配置失败:', e)
        }
      }
    }
    
    loadConfig()

    // 加载保存的筛选偏好
    const savedFilter = localStorage.getItem('media_filter')
    if (savedFilter && (savedFilter === 'all' || savedFilter === 'images' || savedFilter === 'videos')) {
      setMediaFilter(savedFilter as MediaFilter)
    }

    // 加载保存的已看过筛选偏好
    const savedViewedFilter = localStorage.getItem('viewed_filter')
    if (savedViewedFilter && (savedViewedFilter === 'all' || savedViewedFilter === 'viewed' || savedViewedFilter === 'unviewed')) {
      setViewedFilter(savedViewedFilter as ViewedFilter)
    }

    // 加载保存的浏览模式偏好
    const savedViewMode = localStorage.getItem('view_mode')
    if (savedViewMode && (savedViewMode === 'random' || savedViewMode === 'gallery' || savedViewMode === 'large-video')) {
      setViewMode(savedViewMode as ViewMode)
      // 预加载将在第二个useEffect中根据viewMode统一处理
    }

    // 加载保存的预加载随机性偏好
    const savedRandomness = localStorage.getItem('preload_randomness')
    if (savedRandomness !== null) {
      const randomness = parseFloat(savedRandomness)
      if (!isNaN(randomness) && randomness >= 0 && randomness <= 1) {
        setPreloadRandomness(randomness)
      }
    }

    // 加载保存的乐观更新设置
    const savedOptimistic = localStorage.getItem('optimistic_update_enabled')
    if (savedOptimistic !== null) {
      setOptimisticUpdateEnabled(savedOptimistic === 'true')
    }

    // 加载可用的评价标签和分类
    loadAvailableFilters()
  }, [])

  // 当统计数据加载完成后，触发初始预加载
  // 注意：配置变化时的预加载由 toggleDrawer 处理
  useEffect(() => {
    // 优化：移除 viewedFiles.size 条件，已看过过滤在 SQL 层面完成
    if (stats.total > 0 && preloadEnabled && config && !initialPreloadTriggeredRef.current) {
      initialPreloadTriggeredRef.current = true
      const preloadCount = config.scanSettings?.preloadCount || 10
      
      if (viewMode === 'gallery') {
        // 图组模式：重置预加载状态
        setGalleryPreloadReady(false)
        setCachePreloadProgress({ current: 0, total: preloadCount })
        setPreloadInsufficient(false) // 重置数量不足状态
        setActualFoundCount(0) // 重置实际找到的文件数量
        
        // 使用图组模式专用预加载，带进度回调
        databasePreloadManager.preloadForGalleryMode(
          config, 
          [], // 数据库模式不需要文件列表
          preloadCount, 
          viewedFilter,
          (current, total) => {
            setCachePreloadProgress({ current, total })
            // 当所有文件加载完成时，标记为就绪，但保持显示进度
            if (current >= total) {
              setGalleryPreloadReady(true)
              // 不设置为 null，保持显示完成状态
            }
          }
        ).then((result) => {
          const cacheStatus = databasePreloadManager.getCacheStatus()
          setPreloadStatus(cacheStatus)
          setGalleryPreloadReady(true)
          // 保持显示进度，基于当前缓存状态
          setCachePreloadProgress({ 
            current: cacheStatus.cacheSize, 
            total: preloadCount 
          })
          console.log(`图组模式初始预加载完成: ${result.message}`)
          
          // 检查是否数量不足，显示提示
          if (result.message && result.message.includes('未达到预加载目标')) {
            setSnackbarMessage(result.message)
            setSnackbarSeverity('warning')
            setSnackbarOpen(true)
          }
          
          // 当前组加载完成后，异步预加载下一组（为切换做准备）
          databasePreloadManager.preloadNextGroup(config, [], preloadCount, viewedFilter).catch(error => {
            console.error('预加载下一组失败:', error)
          })
        }).catch(error => {
          console.warn('图组模式初始预加载失败:', error)
          setGalleryPreloadReady(true) // 即使失败也允许预览
          const cacheStatus = databasePreloadManager.getCacheStatus()
          // 即使失败也显示当前缓存状态
          setCachePreloadProgress({ 
            current: cacheStatus.cacheSize, 
            total: preloadCount 
          })
        })
      } else if (viewMode === 'large-video') {
        // 大视频模式：不需要预加载
        console.log('大视频模式：跳过初始预加载')
        setGalleryPreloadReady(true)
        setCachePreloadProgress(null)
        const cacheStatus = databasePreloadManager.getCacheStatus()
        setPreloadStatus(cacheStatus)
      } else {
        // 随机模式：初始化进度显示
        setGalleryPreloadReady(true) // 随机模式不需要等待预加载完成
        setCachePreloadProgress({ current: 0, total: preloadCount })
        setPreloadInsufficient(false) // 重置数量不足状态
        setActualFoundCount(0) // 重置实际找到的文件数量
        
        // 准备高级过滤参数（仅已看过模式，随机模式下才有高级过滤）
        const filters = viewedFilter === 'viewed' ? advancedFilters : undefined
        
        databasePreloadManager.refillCache(
          config, 
          [], // 数据库模式不需要文件列表
          preloadCount, 
          viewedFilter,
          (current, total) => {
            // 实时更新进度显示（大视频模式下不更新，使用 ref 避免闭包问题）
            if (viewModeRef.current !== 'large-video') {
              setCachePreloadProgress({ current, total })
            }
          },
          preloadRandomness,
          true, // isInitialLoad: 初始加载，不限制并发
          undefined, // currentParentPath
          mediaFilter, // 媒体类型筛选
          filters // 高级过滤参数
        ).then(async (result) => {
          // ✅ 设置数量不足状态和实际找到的文件数量
          setPreloadInsufficient(result.isInsufficient)
          setActualFoundCount(result.actualCount)
          
          // ✅ 检查是否已看完所有文件
          if (result.allViewed) {
            console.log('[预加载] 已看完所有符合条件的文件')
            setShowRestartDialog(true)
            return
          }
          
          // 预加载完成后，如果已切换到大视频模式则忽略结果（使用 ref）
          if (viewModeRef.current === 'large-video') {
            console.log(`[预加载] 模式已切换到大视频模式，忽略预加载结果`)
            return
          }
          
          const cacheStatus = databasePreloadManager.getCacheStatus()
          setPreloadStatus(cacheStatus)
          // 更新进度显示
          setCachePreloadProgress({ 
            current: cacheStatus.cacheSize, 
            total: preloadCount 
          })
          
          // ✅ 使用 API 返回的实际数量判断
          if (result.isInsufficient) {
            const message = `仅找到 ${result.actualCount} 个符合条件的文件，未达到预加载目标 ${preloadCount} 个`
            setSnackbarMessage(message)
            setSnackbarSeverity('warning')
            setSnackbarOpen(true)
          }
          
          console.log(`随机模式初始预加载完成，筛选条件: ${viewedFilter}, ${mediaFilter}`)
        }).catch(error => {
          console.warn('随机模式初始预加载失败:', error)
          const cacheStatus = databasePreloadManager.getCacheStatus()
          // 大视频模式下不更新进度（使用 ref）
          if (viewModeRef.current !== 'large-video') {
            setCachePreloadProgress({ 
              current: cacheStatus.cacheSize, 
              total: preloadCount 
            })
          }
        })
      }
    }
  }, [stats.total, preloadEnabled, config, viewMode, viewedFilter, mediaFilter, advancedFilters])

  // 监听缓存状态变化，自动更新进度显示（仅图组模式和随机模式，大视频模式不显示）
  useEffect(() => {
    // 大视频模式不显示预加载进度
    if (viewMode === 'large-video') {
      return
    }
    
    if (preloadEnabled && config && preloadStatus) {
      const preloadCount = config.scanSettings?.preloadCount || 10
      // 如果进度显示已初始化且缓存大小发生变化，自动更新进度显示
      setCachePreloadProgress(prev => {
        if (prev && prev.current !== preloadStatus.cacheSize) {
          return { 
            current: preloadStatus.cacheSize, 
            total: preloadCount 
          }
        } else if (!prev) {
          // 如果还没有初始化，初始化进度显示
          return { 
            current: preloadStatus.cacheSize, 
            total: preloadCount 
          }
        }
        return prev
      })
    }
  }, [preloadStatus?.cacheSize, preloadEnabled, config, viewMode])

  
  //#region 图组模式相关函数
  
  /**
   * 图组模式入口：优先消费当前组/下一组缓存，避免首次进入或换组时重复请求。
   * 如果缓存不可用，则保留后续兜底逻辑继续处理。
   */
  const loadRandomGroup = () => {
    console.log(`[DEBUG] loadRandomGroup 开始，当前筛选条件: ${viewedFilter}`)
    
    // 优先检查：如果有当前图组的缓存但页面未显示（首次点击），使用当前组
    if (preloadEnabled && databasePreloadManager.hasCurrentGroupCache() && currentGroup.length === 0) {
      const currentGroupFromCache = databasePreloadManager.getCurrentGroup()
      console.log('[DEBUG] 首次点击，使用预加载的当前图组')
      setCurrentGroup(currentGroupFromCache)
      setCurrentGroupIndex(0)
      
      // 加载该组的第一个文件
      loadFileFromGroup(currentGroupFromCache, 0)
      
      // 注意：下一组的预加载已经在useEffect中的preloadForGalleryMode完成，无需重复触发
      return
    }
    
    // 如果预加载管理器中有下一组缓存，切换到下一组
    if (preloadEnabled && databasePreloadManager.hasNextGroupCache()) {
      const nextGroup = databasePreloadManager.getNextGroup()
      console.log('[DEBUG] 使用预加载的下一组图组')
      databasePreloadManager.switchToNextGroup()
      
      // 更新缓存状态（切换后立即更新）
      const cacheStatus = databasePreloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      if (config) {
        const preloadCount = config.scanSettings?.preloadCount || 10
        setCachePreloadProgress({ current: cacheStatus.cacheSize, total: preloadCount })
      }
      
      // 注意：switchToNextGroup()已经将下一组变为当前组，从databasePreloadManager获取更新后的当前组
      const currentGroupFromManager = databasePreloadManager.getCurrentGroup()
      setCurrentGroup(currentGroupFromManager)
      setCurrentGroupIndex(0)
      
      // 加载该组的第一个文件（此时文件已在当前缓存中）
      loadFileFromGroup(currentGroupFromManager, 0)
      
      // 继续预加载下一组（为下次切换做准备）
      if (config) {
        setTimeout(() => {
          const preloadCount = config.scanSettings?.preloadCount || 10
          databasePreloadManager.preloadNextGroup(config, [], preloadCount, viewedFilter).catch(error => {
            console.error('预加载下一组失败:', error)
          })
        }, 500)
      }
      return
    }
    
  }

  /**
   * 加载图组中的指定文件。
   * 会按“预加载缓存 -> 等待正在预加载 -> 直接拉流”的顺序取文件，
   * 同时同步更新当前文件、播放态、评分态与图组索引。
   */
  const loadFileFromGroup = async (group: MediaFile[], index: number) => {
    if (index < 0 || index >= group.length) return
    
    const file = group[index]
    
    // 切换文件时立即重置自动评分标志
    hasAutoRatedRef.current = false
    
    // 清除保存的视频状态，确保新视频可以自动播放
    videoStateRef.current = null
    
    // 检测媒体类型变化并处理全屏切换，返回是否需要自动进入视频全屏
    const shouldEnterVideoFullscreen = handleMediaTypeChangeInFullscreen(file)
    
    setLoading(true)
    setError(null)
    
    try {
      setCurrentFile(file)
      setCurrentCreator(null)
      setCurrentGroupIndex(index)
      // 尝试从预加载缓存获取
      let preloadedBlob = databasePreloadManager.getPreloadedFile(file.filename)
      console.log('preloadedBlob',preloadedBlob)
      
      let blob: Blob
      if (preloadedBlob) {
        // 使用预加载的文件
        blob = preloadedBlob
        console.log(`[DEBUG] 图组模式使用预加载文件: ${file.basename}`)
      } else {
        // 检查是否正在预加载中
        if (databasePreloadManager.isPreloading(file.filename)) {
          console.log(`[DEBUG] 图组模式文件正在预加载中，等待完成: ${file.basename}`)
          // 等待预加载完成
          preloadedBlob = await databasePreloadManager.waitForPreload(file.filename)
          if (preloadedBlob) {
            blob = preloadedBlob
            console.log(`[DEBUG] 图组模式预加载完成，使用缓存文件: ${file.basename}`)
          } else {
            // 等待超时，正常加载
            console.log(`[DEBUG] 图组模式预加载等待超时，正常加载: ${file.basename}`)
            const streamResponse = await fetch('/api/webdav/stream', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...config,
                filepath: file.filename,
              }),
            })

            if (!streamResponse.ok) throw new Error('获取文件流失败')
            blob = await streamResponse.blob()
            
            // 将新加载的文件添加到缓存中
            if (preloadEnabled && config) {
              // 直接添加到缓存（避免重复请求），包含元数据
              databasePreloadManager.addToCacheDirectly(file.filename, blob, file.size, file.lastmod)
              // 更新缓存状态
              const updatedCacheStatus = databasePreloadManager.getCacheStatus()
              setPreloadStatus(updatedCacheStatus)
            }
          }
        } else {
          debugger
          // 正常加载文件
          console.log(`[DEBUG] 图组模式文件不在预加载缓存中，正常加载: ${file.basename}`)
          const streamResponse = await fetch('/api/webdav/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...config,
              filepath: file.filename,
            }),
          })

          if (!streamResponse.ok) throw new Error('获取文件流失败')
          blob = await streamResponse.blob()
          
          // 将新加载的文件添加到缓存中
          if (preloadEnabled && config) {
            // 直接添加到缓存（避免重复请求），包含元数据
            databasePreloadManager.addToCacheDirectly(file.filename, blob, file.size, file.lastmod)
            // 更新缓存状态
            const updatedCacheStatus = databasePreloadManager.getCacheStatus()
            setPreloadStatus(updatedCacheStatus)
          }
        }
      }

      const url = URL.createObjectURL(blob)
      const isSmallVideoTarget = isVideo(file.filename)
      const isMediumSizedVideo = isSmallVideoTarget && file.size > 10 * 1024 * 1024 && file.size <= 100 * 1024 * 1024
      setTranscodeUrl(null)
      setIsUsingTranscode(false)
      smallVideoDirectPlayAvailableRef.current = false
      setSmallVideoDirectPlayEnabled(false)
      
      // 清理旧的URL
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
      }
      
      // 设置媒体 URL（视频和图片都需要）
      setMediaUrl(url)
      
      // 设置媒体类型
      const isVideoFile = isSmallVideoTarget
      if (isVideoFile) {
        setMediaType('small-video')
        
        // 为小视频也设置 originalStreamUrl，用于外部播放器
        if (config && config.enableDirectLink && config.directLinkUrl) {
          // 使用直链模式
          let processedPath = file.filename
          processedPath = processedPath
            .split('/')
            .map(segment => segment.replace(/／/g, '|'))
            .join('/')
          const directLinkUrl = `/d${processedPath}`
          const fullDirectLinkUrl = new URL(directLinkUrl, window.location.origin).href
          setOriginalStreamUrl(fullDirectLinkUrl)
          if (isMediumSizedVideo) {
            smallVideoDirectPlayAvailableRef.current = true
            setSmallVideoDirectPlayEnabled(true)
          }
        } else if (config) {
          // 使用 WebDAV 流式 URL
          const streamParams = new URLSearchParams({
            url: config.url,
            username: config.username,
            password: config.password,
            filepath: file.filename,
            sourceType: config.sourceType || 'clouddrive2',
          })
          const streamUrl = `/api/webdav/instant-stream?${streamParams.toString().replace(/\+/g, '%20')}`
          const fullStreamUrl = new URL(streamUrl, window.location.origin).href
          setOriginalStreamUrl(fullStreamUrl)
        } else {
          setOriginalStreamUrl(null)
        }
      } else {
        setMediaType('image')
        setOriginalStreamUrl(null) // 图片不需要外部播放
      }
      
      // 如果需要自动进入视频全屏，延迟执行以确保视频元素已渲染
      if (shouldEnterVideoFullscreen && isVideoFile) {
        setTimeout(() => {
          enterVideoFullscreen()
        }, 100)
      }
      
      // 加载当前文件的评分（优先执行，确保不被预加载阻塞）
      // 未看过模式下跳过，因为未看过的文件肯定没有评分
      if (viewedFilter !== 'unviewed') {
        await loadMediaRating(file.filename)
      } else {
        // 未看过模式下清空评分状态
        setCurrentRating(null)
      }
      
      // 启动自动标记已看过的定时器（传递文件参数避免状态更新延迟）
      startAutoMarkTimer(file)
      
      // 检查是否浏览过半，如果是则预加载当前图组剩余的所有文件
      // 使用setTimeout延迟执行，确保评分加载完成后再开始预加载，避免占用网络资源
      if (preloadEnabled && config && databasePreloadManager.isBrowseHalfway(index)) {
        // 延迟执行预加载，给评分API等关键请求留出时间
        setTimeout(() => {
          console.log('[DEBUG] 浏览超过预设数量一半，开始预加载当前图组剩余文件')
          const preloadCount = config.scanSettings?.preloadCount || 10
          databasePreloadManager.preloadRemainingCurrentGroup(config, (current) => {
            // 实时更新进度显示（total固定为preloadCount）
            setCachePreloadProgress({ current, total: preloadCount })
          }).then(() => {
            // 更新缓存状态
            const cacheStatus = databasePreloadManager.getCacheStatus()
            setPreloadStatus(cacheStatus)
          }).catch(error => {
            console.error('预加载当前图组剩余文件失败:', error)
          })
        }, 100) // 延迟100ms，确保评分加载请求优先完成
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 统一的切换包装器。
   * 在真正切换前负责停止自动评分计时、标记当前文件已浏览、维护缓存状态，
   * 并通过防抖标志避免短时间内重复触发切换。
   */
  const saveAndSwitch = async (switchCallback: () => void) => {
    console.log(`[DEBUG] saveAndSwitch 被调用, currentFile: ${currentFile?.basename}, viewMode: ${viewMode}, isSwitching=${isSwitchingRef.current}`)
    if (isSwitchingRef.current) {
      console.log('[DEBUG] saveAndSwitch: isSwitching=true，跳过')
      return
    }

    isSwitchingRef.current = true
    setIsSwitching(true)

    try {
      // 停止自动标记定时器，避免在切换时触发自动评分
      stopAutoMarkTimer()
      
      // 如果当前有评分数据且当前文件存在，先保存
      /* if (currentRating && currentFile) {
        await saveRating(currentRating, currentFile)
      } */
      
      // 先标记当前文件为已观看（在切换之前）
      // 保存当前文件的引用，避免在 switchCallback 后丢失
      const fileToMark = currentFile
      
      if (fileToMark && (viewMode === 'random' || viewMode === 'large-video')) {
        // 无论什么模式，都添加到本地已看过记录（用于当前会话管理）
        databasePreloadManager.addLocalViewedFile(fileToMark.filename)
        
        // 所有模式都从缓存中移除已看过的文件
        databasePreloadManager.removeFromCache(fileToMark.filename)
        
        // 立即更新缓存状态显示，避免前台显示不准确
        setPreloadStatus(databasePreloadManager.getCacheStatus())
      }
      
      // 立即切换，不等待补齐缓存
      switchCallback()
      isSwitchingRef.current = false
      setIsSwitching(false)
    } catch (error) {
      console.error('保存评分失败:', error)
      // 即使保存失败也继续切换，避免卡住
      switchCallback()
      isSwitchingRef.current = false
      setIsSwitching(false)
    }
    
    // 500ms 后重置状态作为兜底策略，防止某些情况下状态未正确重置
    setTimeout(() => {
      isSwitchingRef.current = false
      setIsSwitching(false)
    }, 500)
  }

  /**
   * 图组模式前进一步。
   * 若当前组尚未结束则切到下一张，否则直接切换到下一组。
   */
  const nextInGroup = () => {
    // 标记播放意图（图组切换也需要）
    playIntentRef.current = true
    saveAndSwitch(() => {
      if (currentGroupIndex < currentGroup.length - 1) {
        loadFileFromGroup(currentGroup, currentGroupIndex + 1)
      } else {
        // 最后一张，加载新图组
        loadRandomGroup()
      }
    })
  }

  /**
   * 图组模式后退一步。
   * 仅在当前索引大于 0 时生效，不负责跨组回退。
   */
  const previousInGroup = () => {
    // 标记播放意图（图组切换也需要）
    playIntentRef.current = true
    saveAndSwitch(() => {
      if (currentGroupIndex > 0) {
        loadFileFromGroup(currentGroup, currentGroupIndex - 1)
      }
    })
  }

  //#endregion 图组模式相关函数

  //#region 随机模式相关函数
  
  /**
   * 随机模式核心加载函数。
   * 优先从预加载缓存挑选符合条件的文件，缓存不足时再回退到数据库随机查询，
   * 并在成功后同步维护历史记录、播放源、评分状态与后续智能预加载。
   */
  const loadRandomFile = async (isNavigatingHistory: boolean = false) => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }
    
    console.log(`[DEBUG] loadRandomFile 开始，筛选条件: viewedFilter=${viewedFilter}, mediaFilter=${mediaFilter}`)
    console.log(`[DEBUG] 缓存文件数量: ${databasePreloadManager.getCachedFilepaths().length}`)
    console.log(`[DEBUG] 本地已看过文件数量: ${databasePreloadManager.getLocalViewedCount()}`)
    console.log(`[DEBUG] 历史导航模式: ${isNavigatingHistory}`)
    
    // 从预加载缓存中获取文件（缓存中的文件已经过数据库层面的 viewedFilter 和 mediaFilter 筛选）
    // 只需要排除本地已看过的文件（当前会话中看过但数据库可能还没同步的）
    const cachedFiles = databasePreloadManager.getCachedFiles()
    //这里可能不需要,因为预加载已经将需要排除的文件给到接口去进行排查处理了,暂时标记为//TODO
    const availableCachedFiles = cachedFiles.filter(file => {
      // 排除本地已看过的文件（所有模式都适用）
      if (databasePreloadManager.isLocalViewed(file.filename)) return false
      return true
    })
    
    console.log(`[DEBUG] 可用缓存文件数量: ${availableCachedFiles.length}`)
    
    let fileToLoad: MediaFile | null = null
    
    if (availableCachedFiles.length > 0) {
      // 从可用的缓存文件中随机选择一个（已包含完整元数据）
      const randomFile = availableCachedFiles[Math.floor(Math.random() * availableCachedFiles.length)]
      fileToLoad = {
        filename: randomFile.filename,
        basename: randomFile.basename,
        size: randomFile.size,
        type: 'file',
        lastmod: randomFile.lastmod
      }
      console.log(`[DEBUG] 从预加载缓存中选择文件: ${fileToLoad?.basename}`)
    } else {
      // ✅ 检查是否因为已看完所有文件导致无文件可用
      if (viewedFilter === 'viewed' && databasePreloadManager.getLocalViewedCount() > 0) {
        console.log(`[DEBUG] 缓存中没有可用文件，已看过 ${databasePreloadManager.getLocalViewedCount()} 个文件`)
        console.log(`[DEBUG] 可能已看完所有符合条件的文件，显示重新开始对话框`)
        setShowRestartDialog(true)
        setLoading(false)
        return
      }
      
      console.log(`[DEBUG] 缓存中没有可用文件，从数据库随机获取`)
      // 如果缓存中没有可用文件，从数据库随机获取一个文件
      try {
        const fileTypeParam = mediaFilter === 'images' ? 'image' : mediaFilter === 'videos' ? 'video' : ''
        const isViewedParam = viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined
        
        // 使用 POST 请求避免 URL 过长导致 431 错误
        const response = await fetch('/api/scan-files/random', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webdavUrl: config.url,
            webdavUsername: config.username,
            paths: config.mediaPaths,
            count: 1,
            fileType: fileTypeParam || undefined,
            isViewed: isViewedParam,
            // 高级过滤条件（仅已看过模式）
            ...(viewedFilter === 'viewed' && {
              ratings: advancedFilters.ratings.length > 0 ? advancedFilters.ratings : undefined,
              evaluations: advancedFilters.evaluations.length > 0 ? advancedFilters.evaluations : undefined,
              categories: advancedFilters.categories.length > 0 ? advancedFilters.categories : undefined,
              reasonFilter: advancedFilters.reasonFilter !== 'all' ? advancedFilters.reasonFilter : undefined,
              reasonKeyword: advancedFilters.reasonKeyword || undefined,
              ratingEmptyFilter: advancedFilters.ratingEmptyFilter,
              evaluationEmptyFilter: advancedFilters.evaluationEmptyFilter,
              categoryEmptyFilter: advancedFilters.categoryEmptyFilter
            })
          })
        })
        if (response.ok) {
          const data = await response.json()
          if (data.files && data.files.length > 0) {
            const dbFile = data.files[0]
            fileToLoad = {
              filename: dbFile.filename,
              basename: dbFile.basename,
              size: dbFile.file_size || 0,
              type: 'file',
              lastmod: dbFile.lastmod || ''
            }
            console.log(`[DEBUG] 从数据库随机获取文件: ${fileToLoad.basename}`)
          }
        }
      } catch (e) {
        console.error('从数据库获取随机文件失败:', e)
      }
      
      if (!fileToLoad) {
        // ✅ 再次检查是否因为已看完所有文件
        if (viewedFilter === 'viewed' && databasePreloadManager.getLocalViewedCount() > 0) {
          console.log(`[DEBUG] 数据库也无法获取文件，已看过 ${databasePreloadManager.getLocalViewedCount()} 个文件`)
          console.log(`[DEBUG] 确认已看完所有符合条件的文件，显示重新开始对话框`)
          setShowRestartDialog(true)
          setLoading(false)
          return
        }
        
        const filterMsg = viewedFilter === 'viewed' ? '已看过' : 
                         viewedFilter === 'unviewed' ? '未看过' : '全部'
        const mediaMsg = mediaFilter === 'images' ? '图片' : 
                        mediaFilter === 'videos' ? '视频' : '媒体'
        setError(`没有找到符合条件的${mediaMsg}文件（${filterMsg}）`)
        return
      }
    }
    
    if (!fileToLoad) {
      setError('随机选择文件失败')
      return
    }

    // 切换文件时立即重置自动评分标志
    hasAutoRatedRef.current = false
    
    // 清除保存的视频状态，确保新视频可以自动播放
    videoStateRef.current = null
    
    // 检测媒体类型变化并处理全屏切换，返回是否需要自动进入视频全屏
    const shouldEnterVideoFullscreen = handleMediaTypeChangeInFullscreen(fileToLoad)
    
    setLoading(true)
    setError(null)

    try {
      setCurrentFile(fileToLoad)
      setCurrentCreator(null)

      // 尝试从预加载缓存获取（如果文件在缓存中）
      const preloadedBlob = databasePreloadManager.getPreloadedFile(fileToLoad.filename)
      
      let blob: Blob
      if (preloadedBlob) {
        // 使用预加载的文件
        blob = preloadedBlob
        console.log(`使用预加载文件: ${fileToLoad.basename}`)
      } else {
        // 正常加载文件
        console.log('正在使用正常加载...')
        const streamResponse = await fetch('/api/webdav/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...config,
            filepath: fileToLoad.filepath || fileToLoad.filename,
          }),
        })

        if (!streamResponse.ok) throw new Error('获取文件流失败')
        blob = await streamResponse.blob()
      }

      const url = URL.createObjectURL(blob)
      const isSmallVideoTarget = isVideo(fileToLoad.filename)
      const isMediumSizedVideo = isSmallVideoTarget && fileToLoad.size > 10 * 1024 * 1024 && fileToLoad.size <= 100 * 1024 * 1024
      setTranscodeUrl(null)
      setIsUsingTranscode(false)
      smallVideoDirectPlayAvailableRef.current = false
      setSmallVideoDirectPlayEnabled(false)
      
      // ✅ 整合步骤：保存当前文件到历史缓存并更新历史记录（仅在非历史导航模式下）
      if (!isNavigatingHistory) {
        // 1. 保存当前文件的 blob 到历史缓存
        const currentMediaType = isSmallVideoTarget ? 'small-video' : 'image'
        const currentOriginalStreamUrl = isSmallVideoTarget 
          ? (config && config.enableDirectLink && config.directLinkUrl
              ? new URL(`/d${fileToLoad.filename.split('/').map(segment => segment.replace(/／/g, '|')).join('/')}`, window.location.origin).href
              : (config 
                  ? new URL(`/api/webdav/instant-stream?${new URLSearchParams({
                      url: config.url,
                      username: config.username,
                      password: config.password,
                      filepath: fileToLoad.filename,
                      sourceType: config.sourceType || 'clouddrive2',
                    }).toString().replace(/\+/g, '%20')}`, window.location.origin).href
                  : null))
          : null
        
        randomHistoryCache.current.set(fileToLoad.filename, {
          url: url,
          blob: blob,
          mediaType: currentMediaType,
          originalStreamUrl: currentOriginalStreamUrl,
          directPlayAvailable: isMediumSizedVideo && Boolean(config?.enableDirectLink && config?.directLinkUrl)
        })
        console.log(`[历史缓存] 保存当前文件: ${fileToLoad.basename}`)
        
        // 2. 清理旧的 URL
        if (mediaUrl) {
          URL.revokeObjectURL(mediaUrl)
          console.log(`[URL清理] 释放旧URL`)
        }
        
        // 3. 更新历史记录数组
        setRandomHistory(prev => {
          const newHistory = [...prev, fileToLoad]
          if (newHistory.length > 4) {
            return newHistory.slice(-4)
          }
          return newHistory
        })
        setRandomHistoryIndex(-1) // 重置到最新位置
        
        // 4. 清理超过4个的旧缓存
        const cacheKeys = Array.from(randomHistoryCache.current.keys())
        if (cacheKeys.length > 4) {
          const keysToRemove = cacheKeys.slice(0, cacheKeys.length - 4)
          keysToRemove.forEach(key => {
            const cached = randomHistoryCache.current.get(key)
            if (cached) {
              URL.revokeObjectURL(cached.url)
              randomHistoryCache.current.delete(key)
              console.log(`[历史缓存] 清理旧缓存: ${key}`)
            }
          })
        }
      }
      
      // 设置媒体 URL（视频和图片都需要）
      setMediaUrl(url)
      
      // 设置媒体类型
      const isVideoFile = isSmallVideoTarget
      if (isVideoFile) {
        setMediaType('small-video')
        
        // 为小视频也设置 originalStreamUrl，用于外部播放器
        if (config && config.enableDirectLink && config.directLinkUrl) {
          // 使用直链模式
          let processedPath = fileToLoad.filename
          processedPath = processedPath
            .split('/')
            .map(segment => segment.replace(/／/g, '|'))
            .join('/')
          const directLinkUrl = `/d${processedPath}`
          const fullDirectLinkUrl = new URL(directLinkUrl, window.location.origin).href
          setOriginalStreamUrl(fullDirectLinkUrl)
          if (isMediumSizedVideo) {
            smallVideoDirectPlayAvailableRef.current = true
            setSmallVideoDirectPlayEnabled(true)
          }
        } else if (config) {
          // 使用 WebDAV 流式 URL
          const streamParams = new URLSearchParams({
            url: config.url,
            username: config.username,
            password: config.password,
            filepath: fileToLoad.filename,
            sourceType: config.sourceType || 'clouddrive2',
          })
          const streamUrl = `/api/webdav/instant-stream?${streamParams.toString().replace(/\+/g, '%20')}`
          const fullStreamUrl = new URL(streamUrl, window.location.origin).href
          setOriginalStreamUrl(fullStreamUrl)
        } else {
          setOriginalStreamUrl(null)
        }
      } else {
        setMediaType('image')
        setOriginalStreamUrl(null) // 图片不需要外部播放
      }
      
      // 如果需要自动进入视频全屏，延迟执行以确保视频元素已渲染
      if (shouldEnterVideoFullscreen && isVideoFile) {
        setTimeout(() => {
          enterVideoFullscreen()
        }, 100)
      }
      
      // 确保评分类型为媒体（随机模式始终是单个媒体文件）
      setRatingType('media')
      
      // 加载当前文件的评分（未看过模式下跳过，因为未看过的文件肯定没有评分）
      if (viewedFilter !== 'unviewed') {
        // 强制使用 media 类型加载评分，避免依赖状态更新
        await loadCurrentRating(fileToLoad, 'media')
      } else {
        // 未看过模式下清空评分状态
        setCurrentRating(null)
      }
      
      // 启动自动标记已看过的定时器（传递文件参数避免状态更新延迟）
      startAutoMarkTimer(fileToLoad)

      // 智能预加载下一个可能查看的文件（立即执行，不延迟）
      smartPreload(fileToLoad)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  
  /**
   * 在随机模式中回看上一条历史记录。
   * 只从内存历史缓存读取，不触发新的随机选取。
   */
  const loadPreviousRandomFile = () => {
    if (randomHistory.length === 0) {
      console.log('[回看] 没有历史记录')
      return
    }
    
    // 计算新的索引位置
    const newIndex = randomHistoryIndex - 1
    const targetIndex = randomHistory.length + newIndex
    
    if (targetIndex < 0) {
      console.log('[回看] 已经是最早的记录')
      return
    }
    
    const fileToLoad = randomHistory[targetIndex]
    console.log(`[回看] 加载历史文件: ${fileToLoad.basename}, 索引: ${newIndex}`)
    
    // 标记播放意图
    playIntentRef.current = true
    
    // 更新索引
    setRandomHistoryIndex(newIndex)
    
    // 加载文件（不触发保存和切换逻辑）
    loadFileDirectly(fileToLoad, true)
  }
  
  /**
   * 在随机模式中向前移动。
   * 若仍处于历史回看区间，则继续从历史缓存前进；
   * 若已经回到最新位置，则加载新的随机文件。
   */
  const loadNextRandomFile = () => {
    if (randomHistoryIndex === -1) {
      // 已经在最新位置，加载新的随机文件
      console.log('[前进] 已在最新位置，加载新文件')
      saveAndSwitch(() => {
        loadRandomFile(false)
      })
      return
    }
    
    // 计算新的索引位置
    const newIndex = randomHistoryIndex + 1
    
    // 检查是否到达最新位置
    if (newIndex === -1) {
      // 到达最新位置，从历史记录加载最新文件
      const fileToLoad = randomHistory[randomHistory.length - 1]
      console.log(`[前进] 回到最新位置，加载文件: ${fileToLoad.basename}`)
      
      // 标记播放意图
      playIntentRef.current = true
      
      // 更新索引
      setRandomHistoryIndex(-1)
      
      // 从缓存加载文件
      loadFileDirectly(fileToLoad, true)
      return
    }
    
    // 还在历史记录中，继续前进
    const targetIndex = randomHistory.length + newIndex
    const fileToLoad = randomHistory[targetIndex]
    console.log(`[前进] 加载历史文件: ${fileToLoad.basename}, 索引: ${newIndex}`)
    
    // 标记播放意图
    playIntentRef.current = true
    
    // 更新索引
    setRandomHistoryIndex(newIndex)
    
    // 加载文件（不触发保存和切换逻辑）
    loadFileDirectly(fileToLoad, true)
  }
  
  /**
   * 主页面“换一个 / 开始预览”的统一入口。
   * 根据当前浏览模式分发到图组、随机或大视频模式对应的加载逻辑，
   * 并在入口层统一处理播放意图与移动端 warmUp。
   */
  const loadRandomMedia = async () => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }

    console.log(`[loadRandomMedia] 当前模式: ${viewMode}`)
    
    // 关闭播放方式选择器（如果正在显示）
    setShowPlayModeSelector(false)
    
    // 标记用户有播放意图（用于移动端视频自动播放）
    playIntentRef.current = true
    
    // ✅ 在用户交互上下文中立即调用 warmUp（首次取消静音）
    console.log('[loadRandomMedia] ========== 开始 ==========')
    console.log('[loadRandomMedia] isMobile =', isMobile)
    console.log('[loadRandomMedia] mobileVideoRef.current =', mobileVideoRef.current)
    console.log('[loadRandomMedia] mobileVideoRef.current?.warmUp =', mobileVideoRef.current?.warmUp)
    
    // ✅ 立即调用 warmUp（不需要等待，因为组件已经渲染）
    if (mobileVideoRef.current?.warmUp) {
      mobileVideoRef.current.warmUp()
      console.log('[loadRandomMedia] ✓ 调用 warmUp 取消静音')
    } else {
      console.log('[loadRandomMedia] ✗ 未调用 warmUp，原因：', {
        isMobile,
        hasMobileVideoRef: !!mobileVideoRef.current,
        hasWarmUp: !!mobileVideoRef.current?.warmUp
      })
    }

    // 图组模式
    if (viewMode === 'gallery') {
      if (currentGroup.length === 0) {
        loadRandomGroup()
      } else {
        nextInGroup()
      }
      return
    }

    // 大视频模式
    if (viewMode === 'large-video') {
      console.log('[loadRandomMedia] 进入大视频模式分支')
      saveAndSwitch(() => {
        loadLargeVideoFile()
      })
      return
    }

    // 随机模式
    console.log('[loadRandomMedia] 进入随机模式分支')
    
    // 加载新的随机文件（不处理历史导航逻辑）
    saveAndSwitch(() => {
      loadRandomFile(false)
    })
  }

  /**
   * 直接加载指定文件。
   * 主要服务于随机模式历史回看，只消费内存中的 blob 缓存，
   * 不参与“保存当前文件后再切换”的通用流程。
   */
  const loadFileDirectly = async (fileToLoad: MediaFile, isNavigatingHistory: boolean = false) => {
    // 切换文件时立即重置自动评分标志
    hasAutoRatedRef.current = false
    
    // 清除保存的视频状态，确保新视频可以自动播放
    videoStateRef.current = null
    
    // 检测媒体类型变化并处理全屏切换
    const shouldEnterVideoFullscreen = handleMediaTypeChangeInFullscreen(fileToLoad)
    
    setLoading(true)
    setError(null)

    try {
      setCurrentFile(fileToLoad)
      setCurrentCreator(null)

      // 从历史缓存中获取（loadFileDirectly 只用于历史导航）
      const cachedData = randomHistoryCache.current.get(fileToLoad.filename)
      
      if (!cachedData) {
        // 缓存中没有数据，说明出现了逻辑错误
        console.error(`[历史回看错误] 缓存中没有找到文件: ${fileToLoad.basename}`)
        setError('历史缓存丢失，无法回看此文件')
        setLoading(false)
        return
      }
      
      // 从内存缓存的 blob 重新创建 URL
      console.log(`[历史回看] 从内存缓存加载: ${fileToLoad.basename}`)
      
      const url = URL.createObjectURL(cachedData.blob)
      
      // ✅ 清理旧的 URL（历史导航时也需要清理，避免内存泄漏）
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
        console.log(`[URL清理] 历史导航时释放旧URL`)
      }
      
      // ✅ 直接更新 mediaUrl 状态，让 React 重新渲染
      // MobileVideoPlayer 的 useEffect 会检查 hasUnmutedRef 并设置正确的静音状态
      setMediaUrl(url)
      
      setMediaType(cachedData.mediaType)
      setOriginalStreamUrl(cachedData.originalStreamUrl)
      setTranscodeUrl(null)
      setIsUsingTranscode(false)
      const directPlayAvailable = Boolean(cachedData.directPlayAvailable)
      smallVideoDirectPlayAvailableRef.current = directPlayAvailable
      setSmallVideoDirectPlayEnabled(directPlayAvailable)
      
      if (shouldEnterVideoFullscreen && cachedData.mediaType !== 'image') {
        setTimeout(() => {
          enterVideoFullscreen()
        }, 100)
      }
      
      setRatingType('media')
      
      // 加载评分（历史文件肯定已经被观看过，直接加载评分）
      await loadCurrentRating(fileToLoad, 'media')
      
      // 清除之前的自动标记定时器，但不启动新的（历史文件已有评分）
      startAutoMarkTimer(fileToLoad, true)
      
      setLoading(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 随机模式的智能预加载调度器。
   * 结合当前缓存量、正在下载数量与预加载随机性动态决定补充数量，
   * 并通过定时器与进行中标记减少频繁切换时的重复请求。
   */
  const smartPreload = async (currentFile: MediaFile) => {
    // 大视频模式下不进行智能预加载
    if (viewMode === 'large-video') {
      console.log('[大视频模式] 跳过智能预加载')
      return
    }
    
    if (!preloadEnabled || !config) return
    
    // ✅ 清除之前的定时器（防抖动）
    // 注意：不检查 smartPreloadInProgressRef，因为我们需要确保每次切换都最终触发预加载
    if (smartPreloadTimeoutRef.current) {
      clearTimeout(smartPreloadTimeoutRef.current)
      console.log('[智能预加载] 清除旧定时器，重新设置')
    }
    
    // ✅ 延迟执行，避免快速切换时重复触发
    // 如果用户在200ms内再次切换，定时器会被清除并重新设置
    // 这样可以确保：快速切换时只触发最后一次，但不会完全跳过
    smartPreloadTimeoutRef.current = setTimeout(async () => {
      // 如果已经有预加载在进行，等待它完成
      if (smartPreloadInProgressRef.current) {
        console.log('[智能预加载] 已有预加载在进行，等待完成后再执行')
        // 等待当前预加载完成（最多等待5秒）
        let waitCount = 0
        while (smartPreloadInProgressRef.current && waitCount < 50) {
          await new Promise(resolve => setTimeout(resolve, 100))
          waitCount++
        }
        if (smartPreloadInProgressRef.current) {
          console.warn('[智能预加载] 等待超时，强制执行')
        }
      }
      
      smartPreloadInProgressRef.current = true
      
      try {
        // 从配置中获取预加载数量，默认为10
        const preloadCount = config.scanSettings?.preloadCount || 10
        
        // ✅ 动态计算需要预加载的数量
        // 公式：需要预加载数量 = 预加载总数 - 当前缓存数 - 正在下载数 - 等待许可数
        const cacheStatus = databasePreloadManager.getCacheStatus()
        
        const currentCacheSize = cacheStatus.cacheSize  // 当前缓存中的文件数（已加载完成）
        const queueSize = cacheStatus.queueSize  // 正在下载的文件数（已获得许可）
        const pendingQueueSize = cacheStatus.pendingQueueSize || 0  // 等待许可的文件数
        
        // 计算需要预加载的数量
        // 注意：需要同时考虑正在下载和等待许可的文件
        const needCount = Math.max(0, preloadCount - currentCacheSize - queueSize - pendingQueueSize)
        
        console.log(`[智能预加载] 动态计算：预加载总数=${preloadCount}, 当前缓存=${currentCacheSize}, 正在下载=${queueSize}, 等待许可=${pendingQueueSize}, 需要预加载=${needCount}`)
        console.log(`[智能预加载] 缓存详情：`, cacheStatus.cachedFiles.map(f => f.substring(f.lastIndexOf('/') + 1)))
        
        // 如果不需要预加载，直接返回
        if (needCount <= 0) {
          console.log('[智能预加载] 无需预加载，缓存充足')
          setPreloadStatus(cacheStatus)
          return
        }
        
        // 准备高级过滤参数（仅已看过模式且非图组模式）
        const filters = (viewedFilter === 'viewed' && viewMode !== 'gallery') ? advancedFilters : undefined
        
        // ✅ 使用动态计算的数量进行预加载
        await databasePreloadManager.smartPreload(
          config, [], currentFile, preloadCount, viewedFilter, 
          preloadRandomness, mediaFilter, filters, needCount  // 传入动态计算的数量
        )
        // 预加载完成后更新缓存状态显示
        setPreloadStatus(databasePreloadManager.getCacheStatus())
      } catch (error) {
        console.error('智能预加载失败:', error)
        // 即使失败也更新显示，确保状态准确
        setPreloadStatus(databasePreloadManager.getCacheStatus())
      } finally {
        smartPreloadInProgressRef.current = false
      }
    }, 200) // 延迟200ms，避免快速切换时重复触发
  }

  //#endregion 随机模式相关函数

  //#region 手势相关函数
  
  /**
   * 手势开始处理。
   * 仅在移动端全屏场景记录初始触点，并过滤多指触控，
   * 为后续纵向滑动识别提供基础坐标。
   */
  const handleTouchStart = (e: React.TouchEvent) => {
    // 只在移动端、全屏下启用（所有模式）
    if (!isMobile || !fullscreen) return
    
    // 如果是多点触控（双指缩放），不处理滑动
    if (e.touches.length > 1) {
      touchStartYRef.current = null
      touchStartXRef.current = null
      isSwipingRef.current = false
      console.log('[手势] touchStart: 多点触控，忽略')
      return
    }
    
    const touch = e.touches[0]
    touchStartYRef.current = touch.clientY
    touchStartXRef.current = touch.clientX
    isSwipingRef.current = false
    console.log(`[手势] touchStart: y=${touch.clientY.toFixed(0)}, x=${touch.clientX.toFixed(0)}, mode=${viewMode}`)
  }
  
  /**
   * 手势移动处理。
   * 在移动端全屏时识别是否为纵向滑动，一旦确认则阻止页面默认滚动。
   */
  const handleTouchMove = (e: React.TouchEvent) => {
    // 只在移动端、全屏下启用（所有模式）
    if (!isMobile || !fullscreen) return
    if (touchStartYRef.current === null || touchStartXRef.current === null) return
    
    // 如果是多点触控（双指缩放），取消滑动状态
    if (e.touches.length > 1) {
      touchStartYRef.current = null
      touchStartXRef.current = null
      isSwipingRef.current = false
      return
    }
    
    const touch = e.touches[0]
    const deltaY = touch.clientY - touchStartYRef.current
    const deltaX = touch.clientX - touchStartXRef.current
    
    // 判断是否为垂直滑动（垂直距离大于水平距离）
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      if (!isSwipingRef.current) {
        console.log(`[手势] touchMove: 确认垂直滑动，deltaY=${deltaY.toFixed(0)}, deltaX=${deltaX.toFixed(0)}`)
      }
      isSwipingRef.current = true
      // 阻止默认滚动行为
      e.preventDefault()
    }
  }
  
  /**
   * 手势结束处理。
   * 根据滑动方向和当前浏览模式决定是换下一个、回看历史还是给出提示，
   * 最后统一重置触摸相关的 ref 状态。
   */
  const handleTouchEnd = (e: React.TouchEvent) => {
    // 只在移动端、全屏下启用（所有模式）
    if (!isMobile || !fullscreen) return
    
    // 如果还有其他触点（多点触控未完全结束），不处理
    if (e.touches.length > 0) {
      touchStartYRef.current = null
      touchStartXRef.current = null
      isSwipingRef.current = false
      console.log('[手势] touchEnd: 还有触点，忽略')
      return
    }
    
    const startY = touchStartYRef.current
    const isSwiping = isSwipingRef.current
    
    console.log(`[手势] touchEnd: startY=${startY?.toFixed(0) ?? 'null'}, isSwiping=${isSwiping}, isSwitching=${isSwitching}, mode=${viewMode}`)
    
    if (startY === null || !isSwiping) {
      touchStartYRef.current = null
      touchStartXRef.current = null
      isSwipingRef.current = false
      console.log(`[手势] touchEnd: 跳过 - startY=${startY}, isSwiping=${isSwiping}`)
      return
    }
    
    const touch = e.changedTouches[0]
    const deltaY = touch.clientY - startY
    
    // 判断是否达到切换阈值
    const shouldSwitch = Math.abs(deltaY) > swipeThreshold
    
    console.log(`[手势] touchEnd: deltaY=${deltaY.toFixed(0)}, threshold=${swipeThreshold}, shouldSwitch=${shouldSwitch}`)
    
    if (shouldSwitch) {
      const direction = deltaY < 0 ? 'up' : 'down'
      console.log(`[手势] 触发切换: direction=${direction}, mode=${viewMode}, isSwitching=${isSwitching}`)
      
      // ✅ 在用户交互上下文中调用 warmUp（首次取消静音）
      if (mobileVideoRef.current?.warmUp) {
        mobileVideoRef.current.warmUp()
        console.log('[手势] 在touchend中调用warmUp')
      }
      
      // 直接执行切换逻辑（移除过渡效果）
      setPlayIntent(true)
      
      // 根据不同模式执行不同操作
      if (viewMode === 'random') {
        if (direction === 'up') {
          if (randomHistoryIndex === -1) {
            console.log('[手势] 随机模式向上 → loadRandomMedia()')
            loadRandomMedia()
          } else {
            console.log('[手势] 随机模式向上（历史中）→ loadNextRandomFile()')
            loadNextRandomFile()
          }
        } else {
          const maxHistoryCount = 3
          const newIndex = randomHistoryIndex - 1
          const targetIndex = randomHistory.length + newIndex
          
          // 计算回看的步数：从当前位置往前数了多少个文件
          const stepsBack = (randomHistory.length - 1) - targetIndex
          
          if (targetIndex < 0 || stepsBack > maxHistoryCount) {
            console.log('[手势] 随机模式向下 → 已到历史上限')
            setSnackbarMessage('最多只能回看3个文件')
            setSnackbarSeverity('info')
            setSnackbarOpen(true)
          } else {
            console.log('[手势] 随机模式向下 → loadPreviousRandomFile()')
            loadPreviousRandomFile()
          }
        }
      } else if (viewMode === 'gallery') {
          if (direction === 'up') {
            console.log('[手势] 图组模式向上 → nextInGroup()')
            nextInGroup()
          } else {
            console.log('[手势] 图组模式向下 → previousInGroup()')
            previousInGroup()
          }
        } else if (viewMode === 'large-video') {
          if (direction === 'up') {
            console.log('[手势] 大视频模式向上 → loadRandomMedia()')
            loadRandomMedia()
          } else {
            console.log('[手势] 大视频模式向下 → 不支持回看')
            setSnackbarMessage('大视频模式暂不支持回看')
            setSnackbarSeverity('info')
            setSnackbarOpen(true)
          }
        }
    }
    
    // 重置触摸状态
    touchStartYRef.current = null
    touchStartXRef.current = null
    isSwipingRef.current = false
  }

  //#endregion 手势相关函数

  //#region 大视频模式相关函数
  
  /**
   * 释放当前流式视频占用的浏览器与网络资源。
   * 在切换大视频前主动 pause + 清空 src + load，
   * 以便尽快中断旧请求并减少 WebDAV 连接泄漏风险。
   */
  const cleanupCurrentStreamVideo = () => {
    if (instantVideoRef.current) {
      const videoElement = instantVideoRef.current.getVideoElement?.()
      if (videoElement) {
        console.log('🧹 [清理] 停止当前流式视频播放')
        
        // 1. 立即暂停
        videoElement.pause()
        
        // 2. 清空 src 以中断网络请求
        // 这会触发浏览器取消当前的网络请求，服务端会收到 abort 信号
        videoElement.src = ''
        
        // 3. 调用 load() 强制浏览器释放资源
        videoElement.load()
        
        console.log('✅ [清理] 已释放流式视频连接')
      }
    }
  }
  
  /**
   * 大视频模式的加载入口。
   * 只从数据库中随机挑选大于 100MB 的视频，按直链/原始流/转码策略构建播放地址，
   * 并跳过普通随机模式使用的预加载机制。
   */
  const loadLargeVideoFile = async () => {
    console.log(`[大视频模式] 开始加载，筛选条件: ${viewedFilter}，随机性: ${preloadRandomness}`)
    console.log(`[大视频模式] 当前缓存文件数量: ${databasePreloadManager.getCachedFilepaths().length}`)
    
    // ⭐ 关键修复：在加载新视频前，先清理当前正在播放的视频
    // 这会触发浏览器取消网络请求，服务端会收到 abort 信号并释放 WebDAV 流
    cleanupCurrentStreamVideo()
    
    // 强制清空缓存，确保不使用任何预加载的文件
    if (databasePreloadManager.getCachedFilepaths().length > 0) {
      console.log('[大视频模式] 检测到缓存文件，强制清空')
      databasePreloadManager.clearCache()
    }
    
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }
    
    // 从数据库获取大视频文件（大于100MB）
    const minVideoSize = 100 * 1024 * 1024 // 100MB
    
    try {
      const isViewedParam = viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined
      const currentParentPath = currentFile ? currentFile.filename.substring(0, currentFile.filename.lastIndexOf('/')) : ''
      
      // 排除本地已看过的文件
      const localViewedFiles = Array.from(databasePreloadManager.getLocalViewedFilenames())
      
      // 使用 POST 请求避免 URL 过长导致 431 错误
      const response = await fetch('/api/scan-files/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdavUrl: config.url,
          webdavUsername: config.username,
          paths: config.mediaPaths,
          count: 1,
          fileType: 'video',
          minFileSize: minVideoSize,
          randomness: preloadRandomness,
          isViewed: isViewedParam,
          currentParentPath: (currentParentPath && preloadRandomness < 1) ? currentParentPath : undefined,
          excludeFilenames: localViewedFiles.length > 0 ? localViewedFiles : undefined,
          // 高级过滤条件（仅已看过模式）
          ...(viewedFilter === 'viewed' && {
            ratings: advancedFilters.ratings.length > 0 ? advancedFilters.ratings : undefined,
            evaluations: advancedFilters.evaluations.length > 0 ? advancedFilters.evaluations : undefined,
            categories: advancedFilters.categories.length > 0 ? advancedFilters.categories : undefined,
            reasonFilter: advancedFilters.reasonFilter !== 'all' ? advancedFilters.reasonFilter : undefined,
            reasonKeyword: advancedFilters.reasonKeyword || undefined,
            ratingEmptyFilter: advancedFilters.ratingEmptyFilter,
            evaluationEmptyFilter: advancedFilters.evaluationEmptyFilter,
            categoryEmptyFilter: advancedFilters.categoryEmptyFilter
          })
        })
      })
      
      if (!response.ok) {
        throw new Error('获取大视频文件失败')
      }
      
      const data = await response.json()
      
      if (!data.files || data.files.length === 0) {
        const filterMsg = viewedFilter === 'viewed' ? '已看过' : 
                         viewedFilter === 'unviewed' ? '未看过' : '全部'
          setError(`没有找到符合条件的大视频文件（${filterMsg}，>100MB）`)
        return
      }
      
      const dbFile = data.files[0]
      const fileToLoad: MediaFile = {
        filename: dbFile.filename,
        basename: dbFile.basename,
        size: dbFile.file_size || 0,
        type: 'file',
        lastmod: dbFile.lastmod || ''
      }
      
      console.log(`[大视频模式] 从数据库获取: ${fileToLoad.basename}`)
    
      // 切换文件时立即重置自动评分标志
      hasAutoRatedRef.current = false
      
      // 清除保存的视频状态，确保新视频可以自动播放
      videoStateRef.current = null
      
      // 检测媒体类型变化并处理全屏切换，返回是否需要自动进入视频全屏
      const shouldEnterVideoFullscreen = handleMediaTypeChangeInFullscreen(fileToLoad)
      
      setLoading(true)
      setError(null)
      
      setCurrentFile(fileToLoad)
      setCurrentCreator(null)
      
      // 检查是否启用直链播放
      if (config.enableDirectLink && config.directLinkUrl) {
        // 使用 /d/ 直链播放（通过 Nginx 代理）
        // 直链播放目前只支持 OpenList，需要将路径中的全角斜杠 ／ 替换为竖线 |
        let processedPath = fileToLoad.filename
        
        // OpenList 特殊处理：将文件名中的全角斜杠替换为竖线
        // 因为 OpenList 不允许文件名中包含斜杠
        processedPath = processedPath
          .split('/')
          .map(segment => segment.replace(/／/g, '|'))
          .join('/')
        
        const directLinkUrl = `/d${processedPath}`
        
        console.log(`🎯 [直链播放] 使用直链: ${fileToLoad.basename}`)
        console.log(`🔗 [直链播放] 直链源: ${config.directLinkUrl}`)
        console.log(`🔗 [直链播放] 原始路径: ${fileToLoad.filename}`)
        console.log(`🔗 [直链播放] 处理后路径: ${processedPath}`)
        console.log(`🔗 [直链播放] 直链 URL: ${directLinkUrl}`)
        
        // 设置直链 URL
        setMediaUrl(directLinkUrl)
        // 设置外部播放器 URL（通过服务器代理）
        const fullDirectLinkUrl = new URL(directLinkUrl, window.location.origin).href
        setOriginalStreamUrl(fullDirectLinkUrl)
        setMediaType('stream-video')
        setLoading(false)
        
        // 如果需要自动进入全屏，延迟执行
        if (shouldEnterVideoFullscreen) {
          setTimeout(() => {
            enterVideoFullscreen()
          }, 100)
        }
        
        // 确保评分类型为媒体（大视频模式始终是单个媒体文件）
        setRatingType('media')
        
        // 加载当前文件的评分（未看过模式下跳过，因为未看过的文件肯定没有评分）
        if (viewedFilter !== 'unviewed') {
          // 强制使用 media 类型加载评分，避免依赖状态更新
          await loadCurrentRating(fileToLoad, 'media')
        } else {
          // 未看过模式下清空评分状态
          setCurrentRating(null)
        }
        
        // 启动自动标记已看过的定时器
        startAutoMarkTimer(fileToLoad)
        
        return
      }
      
      // 如果未启用直链，继续使用 WebDAV 流式传输
      console.log(`📡 [流式播放] 使用 WebDAV 流式传输: ${fileToLoad.basename}`)
      
      // 构建即点即播URL（使用 instant-stream API）
      // 根据视频格式决定播放策略
      const playbackStrategy = getPlaybackStrategy(fileToLoad.filename)
      console.log(`[大视频模式] 播放策略: ${playbackStrategy}`)
      
      // 构建原始流 URL
      const streamParams = new URLSearchParams({
        url: config.url,
        username: config.username,
        password: config.password,
        filepath: fileToLoad.filename,
        sourceType: config.sourceType || 'clouddrive2',
      })
      // 将 + 替换为 %20，确保 WebDAV 服务器能正确解析路径中的空格
      const streamUrl = `/api/webdav/instant-stream?${streamParams.toString().replace(/\+/g, '%20')}`
      
      // 构建转码流 URL（用于降级）
      const transcodeParams = new URLSearchParams({
        url: config.url,
        username: config.username,
        password: config.password,
        filepath: fileToLoad.filename,
        sourceType: config.sourceType || 'clouddrive2',
        format: 'mp4',
        quality: 'high',
      })
      const transcodeStreamUrl = `/api/webdav/transcode-stream?${transcodeParams.toString().replace(/\+/g, '%20')}`
      
      console.log(`[大视频模式] 使用流式播放: ${fileToLoad.basename}, 大小: ${formatFileSize(fileToLoad.size)}`)
      console.log(`[大视频模式] 流媒体URL: ${streamUrl}`)
      
      // 根据播放策略决定使用哪个 URL
      let finalUrl: string
      let finalTranscodeUrl: string | null = null
      
      if (playbackStrategy === 'transcode') {
        // 需要转码的格式，直接使用转码流
        console.log(`[大视频模式] 格式需要转码，直接使用转码流`)
        finalUrl = transcodeStreamUrl
        setIsUsingTranscode(true)
      } else {
        // 原生支持或可能支持的格式，先尝试原始流
        finalUrl = streamUrl
        finalTranscodeUrl = transcodeStreamUrl // 保存转码 URL 用于降级
        setIsUsingTranscode(false)
      }
      
      // 清理旧的URL（如果是 Blob URL）
      if (mediaUrl && mediaUrl.startsWith('blob:')) {
        URL.revokeObjectURL(mediaUrl)
      }
      
      setMediaUrl(finalUrl)
      setTranscodeUrl(finalTranscodeUrl)
      setOriginalStreamUrl(streamUrl) // 保存原始流URL，用于外部播放器
      setMediaType('stream-video') // 标记为流式视频，用于渲染 InstantVideoPlayer
      
      // 如果需要自动进入视频全屏，延迟执行以确保视频元素已渲染
      if (shouldEnterVideoFullscreen) {
        setTimeout(() => {
          enterVideoFullscreen()
        }, 100)
      }
      
      // 确保评分类型为媒体（大视频模式始终是单个媒体文件）
      setRatingType('media')
      
      // 加载当前文件的评分（未看过模式下跳过，因为未看过的文件肯定没有评分）
      if (viewedFilter !== 'unviewed') {
        // 强制使用 media 类型加载评分，避免依赖状态更新
        await loadCurrentRating(fileToLoad, 'media')
      } else {
        // 未看过模式下清空评分状态
        setCurrentRating(null)
      }
      
      // 启动自动标记已看过的定时器
      startAutoMarkTimer(fileToLoad)
      
      // 大视频模式不需要智能预加载
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  //#endregion 大视频模式相关函数=

  //#region 通用函数

  /**
   * 根据文件名后缀判断是否为图片文件。
   */
  const isImage = (filename: string) => {
    return /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(filename)
  }

  /**
   * 根据文件名后缀判断是否为视频文件。
   */
  const isVideo = (filename: string) => {
    return /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(filename)
  }

  /**
   * 将字节数格式化为更易读的容量字符串。
   */
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  /**
   * 读取大视频播放器当前播放进度，供精彩时刻模块与外部控制逻辑复用。
   */
  const getInstantVideoCurrentTime = useCallback(() => {
    const currentTime = instantVideoRef.current?.getCurrentTime?.()
    return typeof currentTime === 'number' && Number.isFinite(currentTime) ? currentTime : 0
  }, [])

  /**
   * 检测媒体类型变化并处理全屏状态切换
   * 由于现在图片和视频都使用网页容器全屏（CSS 方式），不再需要特殊处理
   * @returns 始终返回 false
   */
  const handleMediaTypeChangeInFullscreen = (nextFile: MediaFile): boolean => {
    // 图片和视频都使用网页容器全屏，无需特殊处理
    return false
  }

  /**
   * 视频加载后自动进入原生全屏
   */
  const enterVideoFullscreen = async () => {
    const container = videoPlayerContainerRef.current
    if (!container) {
      console.warn('[自动全屏] 视频容器未找到，延迟重试')
      // 延迟重试，等待容器渲染
      setTimeout(async () => {
        const retryContainer = videoPlayerContainerRef.current
        if (retryContainer) {
          try {
            await retryContainer.requestFullscreen()
            console.log('[自动全屏] 延迟重试成功，视频已进入原生全屏')
            // 成功进入全屏后，移除过渡遮罩
            setTimeout(() => {
              setFullscreenTransitionOverlay(false)
            }, 200) // 稍微延迟以确保全屏动画完成
            
            // 进入全屏后尝试播放
            tryPlayVideoAfterFullscreen()
          } catch (error) {
            console.error('[自动全屏] 延迟重试失败:', error)
            // 失败也要移除遮罩
            setFullscreenTransitionOverlay(false)
          }
        } else {
          // 容器仍未找到，移除遮罩
          setFullscreenTransitionOverlay(false)
        }
      }, 300)
      return
    }
    
    try {
      await container.requestFullscreen()
      console.log('[自动全屏] 视频已自动进入原生全屏')
      // 成功进入全屏后，移除过渡遮罩
      setTimeout(() => {
        setFullscreenTransitionOverlay(false)
      }, 200) // 稍微延迟以确保全屏动画完成
      
      // 进入全屏后尝试播放
      tryPlayVideoAfterFullscreen()
    } catch (error) {
      console.error('[自动全屏] 进入原生全屏失败:', error)
      // 失败也要移除遮罩
      setFullscreenTransitionOverlay(false)
    }
  }
  
  /**
   * 在成功进入全屏后尝试恢复视频播放。
   * 若直接播放失败，会降级为静音播放后再恢复声音。
   */
  const tryPlayVideoAfterFullscreen = () => {
    if (!playIntentRef.current) return
    
    const video = videoRef.current
    if (video && video.paused) {
      console.log('[全屏后播放] 进入全屏后尝试播放视频')
      video.play().catch(error => {
        console.log('[全屏后播放] 播放失败，尝试静音播放:', error)
        video.muted = true
        video.play().then(() => {
          console.log('[全屏后播放] 静音播放成功')
          setTimeout(() => {
            video.muted = false
          }, 300)
        }).catch(err => {
          console.error('[全屏后播放] 静音播放也失败:', err)
        })
      })
    }
  }

  /**
   * 切换页面内的 CSS 全屏状态。
   * 这里不直接依赖浏览器原生全屏 API，而是统一交给页面布局控制。
   */
  const toggleFullscreen = async () => {
    // 统一使用网页容器全屏方式（通过 CSS 实现，不使用原生全屏 API）
    setFullscreen(!fullscreen)
  }

  // 设置播放意图的辅助函数
  const setPlayIntent = (intent: boolean) => {
    playIntentRef.current = intent
    setShouldAutoPlay(intent)
    console.log(`[播放意图] 设置为 ${intent}`)
  }

  // 打开页面入口菜单，并把当前按钮记录为菜单锚点。
  const handlePageMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setPageMenuAnchor(event.currentTarget)
  }

  // 关闭页面入口菜单。
  const handlePageMenuClose = () => {
    setPageMenuAnchor(null)
  }

  // 通过新标签页打开独立页面，并在打开后关闭当前菜单。
  const openPageInNewTab = (path: string) => {
    window.open(path, '_blank', 'noopener,noreferrer')
    handlePageMenuClose()
  }

  /**
   * 为小视频构建三类播放地址。
   * 统一产出 WebDAV 原始流、转码流与直链地址，避免多个分支重复拼装 URL。
   */
  const buildSmallVideoPlaybackUrls = useCallback((file: MediaFile) => {
    // 小视频统一复用这组 URL 构建逻辑，避免 WebDAV / 直链 / 转码三套拼接逻辑在多个分支重复维护。
    if (!config) {
      return {
        webdavUrl: '',
        transcodeUrl: '',
        directUrl: '',
        playbackStrategy: 'direct' as const,
      }
    }

    const playbackStrategy = getPlaybackStrategy(file.filename)
    const commonParams = {
      url: config.url,
      username: config.username,
      password: config.password,
      filepath: file.filename,
      sourceType: config.sourceType || 'clouddrive2',
    }

    const webdavParams = new URLSearchParams({
      ...commonParams,
      forceWebDAV: 'true',
    })
    const webdavUrl = `/api/webdav/instant-stream?${webdavParams.toString().replace(/\+/g, '%20')}`

    const transcodeParams = new URLSearchParams({
      ...commonParams,
      format: 'mp4',
      quality: 'high',
    })
    const transcodeUrl = `/api/webdav/transcode-stream?${transcodeParams.toString().replace(/\+/g, '%20')}`

    const processedPath = file.filename
      .split('/')
      .map(segment => segment.replace(/／/g, '|'))
      .join('/')
    const directUrl = `/d${processedPath}`

    return {
      webdavUrl,
      transcodeUrl,
      directUrl,
      playbackStrategy,
    }
  }, [config])

  /**
   * 根据小视频的目标播放模式，推导切源后整组播放器状态。
   * 返回值会同时驱动媒体地址、原始流地址、转码地址以及“当前是否处于转码态”。
   */
  const resolveSmallVideoPlaybackState = useCallback((file: MediaFile, mode: 'webdav' | 'direct' | 'transcode') => {
    // 根据用户选择与格式策略，输出小视频切换播放源后需要同步更新的一整组状态。
    const { webdavUrl, transcodeUrl, directUrl, playbackStrategy } = buildSmallVideoPlaybackUrls(file)

    if (mode === 'direct') {
      return {
        nextMediaUrl: directUrl,
        nextOriginalStreamUrl: new URL(directUrl, window.location.origin).href,
        nextTranscodeUrl: null,
        nextIsUsingTranscode: false,
      }
    }

    if (mode === 'transcode') {
      return {
        nextMediaUrl: transcodeUrl,
        nextOriginalStreamUrl: new URL(webdavUrl, window.location.origin).href,
        nextTranscodeUrl: transcodeUrl,
        nextIsUsingTranscode: true,
      }
    }

    if (playbackStrategy === 'transcode') {
      return {
        nextMediaUrl: transcodeUrl,
        nextOriginalStreamUrl: new URL(webdavUrl, window.location.origin).href,
        nextTranscodeUrl: transcodeUrl,
        nextIsUsingTranscode: true,
      }
    }

    return {
      nextMediaUrl: webdavUrl,
      nextOriginalStreamUrl: new URL(webdavUrl, window.location.origin).href,
      nextTranscodeUrl: transcodeUrl,
      nextIsUsingTranscode: false,
    }
  }, [buildSmallVideoPlaybackUrls])

  /**
   * 加载评分系统中可选的评价标签与分类列表，供筛选抽屉与评分 UI 使用。
   */
  const loadAvailableFilters = async () => {
    try {
      const [evalRes, catRes] = await Promise.all([
        fetch('/api/ratings/evaluations'),
        fetch('/api/ratings/categories')
      ])

      if (evalRes.ok) {
        const evalData = await evalRes.json()
        const labels = evalData.evaluations?.map((e: any) => e.label) || []
        setAvailableEvaluations(labels)
      }

      if (catRes.ok) {
        const catData = await catRes.json()
        const names = catData.categories?.map((c: any) => c.name) || []
        setAvailableCategories(names)
      }
    } catch (error) {
      console.error('加载评价标签和分类失败:', error)
    }
  }

  /**
   * 从数据库读取当前配置下的统计信息。
   * 这里只读取缓存结果，不主动触发目录扫描。
   */
  const loadStatsFromCache = async (cfg: WebDAVConfig) => {
    setLoading(true)
    setError(null)
    
    try {
      const statsResponse = await fetch(`/api/scan-files/stats?webdavUrl=${encodeURIComponent(cfg.url)}&webdavUsername=${encodeURIComponent(cfg.username)}&paths=${encodeURIComponent(cfg.mediaPaths.join(','))}`)
      
      if (statsResponse.ok) {
        const statsData = await statsResponse.json()
        
        setStats({
          total: statsData.total || 0,
          images: statsData.images || 0,
          videos: statsData.videos || 0,
          viewed: statsData.viewed || 0
        })
        
        if (statsData.hasData) {
          console.log('从数据库加载统计信息:', statsData)
        } else {
          console.log('数据库中暂无数据，请通过管理页面触发扫描')
        }
      }
    } catch (error: any) {
      console.error('加载统计信息失败:', error)
      setError('加载统计信息失败，请检查配置或通过管理页面重新扫描')
    } finally {
      setLoading(false)
    }
  }

  /**
   * 使用系统或指定外部播放器打开当前视频。
   * 会优先使用直链，其次回退到页面当前持有的原始流地址。
   */
  const playWithExternalPlayer = useCallback((player?: 'potplayer' | 'vlc' | 'system') => {
    // 外部播放器使用直链（如果有配置）
    let urlToUse = ''
    
    if (config?.enableDirectLink && currentFile) {
      // 使用直链
      // 处理路径：将全角斜杠替换为竖线（OpenList 特殊处理）
      let processedPath = currentFile.filename
        .split('/')
        .map(segment => segment.replace(/／/g, '|'))
        .join('/')
      
      const directLinkUrl = `/d${processedPath}`
      urlToUse = new URL(directLinkUrl, window.location.origin).href
      console.log('🎬 外部播放器使用直链:', urlToUse)
    } else {
      // 降级到原始流URL
      urlToUse = originalStreamUrl || mediaUrl || ''
      console.log('🎬 外部播放器使用原始流:', urlToUse)
    }
    
    if (!urlToUse) {
      console.log('⚠️ 没有可用的视频 URL')
      return
    }
    
    console.log('🎬 调用外部播放器:', player || 'system', urlToUse)
    
    // 检测平台
    const userAgent = navigator.userAgent.toLowerCase()
    const isAndroid = userAgent.includes('android')
    const isIOS = /iphone|ipad|ipod/.test(userAgent)
    
    // 使用隐藏的 iframe 打开协议，避免影响当前页面
    const openProtocol = (url: string) => {
      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.src = url
      document.body.appendChild(iframe)
      
      // 2秒后移除 iframe
      setTimeout(() => {
        document.body.removeChild(iframe)
      }, 2000)
    }
    
    if (isAndroid) {
      // Android: 使用 intent 协议，让系统选择播放器
      const intentUrl = `intent:${urlToUse}#Intent;type=video/*;end`
      openProtocol(intentUrl)
    } else if (isIOS) {
      // iOS: 尝试 VLC 的 vlc-x-callback 协议
      const vlcUrl = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(urlToUse)}`
      openProtocol(vlcUrl)
      
      // 500ms 后如果没有跳转，直接打开
      setTimeout(() => {
        window.open(urlToUse, '_blank')
      }, 500)
    } else {
      // PC 端: 根据选择的播放器打开
      if (player === 'potplayer') {
        // PotPlayer 协议格式: potplayer://URL
        openProtocol(`potplayer://${urlToUse}`)
      } else if (player === 'vlc') {
        // VLC 协议格式: vlc://URL
        openProtocol(`vlc://${urlToUse}`)
      } else {
        // 默认在新标签页打开
        window.open(urlToUse, '_blank')
      }
    }
    
    // 关闭菜单
    setExternalPlayerAnchor(null)
  }, [originalStreamUrl, mediaUrl, config, currentFile])

  /**
   * 处理“外部播放”按钮点击。
   * 对视频会先暂停当前播放并展示播放方式选择器，然后再根据端类型决定直接调用系统还是展开菜单。
   */
  const handleExternalPlayerClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    // 1. 如果是视频，暂停播放并显示播放方式选择器
    if (mediaType === 'stream-video' || mediaType === 'small-video') {
      // 暂停视频播放（不是取消请求）
      if (instantVideoRef.current?.pause) {
        instantVideoRef.current.pause()
      }
      // 显示播放方式选择器（在视频中央）
      setShowPlayModeSelector(true)
    }
    
    // 2. 同时展开外部播放器菜单（所有视频类型）
    if (isMobile) {
      // 移动端直接调用系统选择器
      playWithExternalPlayer('system')
    } else {
      // PC 端显示下拉菜单
      setExternalPlayerAnchor(event.currentTarget)
    }
  }, [isMobile, playWithExternalPlayer, mediaType])

  /**
   * 处理用户在中央播放方式面板中的选择。
   * 支持在 WebDAV、直链与转码之间切换，并负责同步更新播放器状态和恢复播放。
   */
  const handlePlayModeSelect = useCallback((mode: 'webdav' | 'direct' | 'transcode') => {
    console.log('🎬 [播放方式] 用户选择:', mode)
    console.log('🎬 [播放方式] 当前文件:', currentFile?.filename)
    console.log('🎬 [播放方式] originalStreamUrl:', originalStreamUrl)
    console.log('🎬 [播放方式] 当前 mediaUrl:', mediaUrl)
    
    // 关闭选择器
    setShowPlayModeSelector(false)
    
    // 根据选择切换播放方式
    if (!currentFile || !config) {
      console.error('❌ 缺少必要信息: currentFile 或 config')
      return
    }
    
    let newUrl = ''
    
    switch (mode) {
      case 'webdav':
        // 使用 WebDAV 原始流
        console.log('🎬 切换到 WebDAV 播放')
        // 构建 WebDAV instant-stream URL
        const webdavParams = new URLSearchParams({
          url: config.url,
          username: config.username,
          password: config.password,
          filepath: currentFile.filename,
          sourceType: config.sourceType || 'clouddrive2',
          forceWebDAV: 'true', // 强制使用 WebDAV，不要重定向到直链
        })
        newUrl = `/api/webdav/instant-stream?${webdavParams.toString().replace(/\+/g, '%20')}`
        console.log('🔗 [WebDAV] 新 URL:', newUrl)
        break
        
      case 'direct':
        // 使用直链
        if (config.enableDirectLink) {
          console.log('🎬 切换到直链播放')
          // 处理路径：将全角斜杠替换为竖线（OpenList 特殊处理）
          let processedPath = currentFile.filename
            .split('/')
            .map(segment => segment.replace(/／/g, '|'))
            .join('/')
          
          newUrl = `/d${processedPath}`
          console.log('🔗 [直链播放] 原始路径:', currentFile.filename)
          console.log('🔗 [直链播放] 处理后路径:', processedPath)
          console.log('🔗 [直链播放] 直链 URL:', newUrl)
        } else {
          console.error('❌ 直链播放未启用')
        }
        break
        
      case 'transcode':
        // 使用转码流（仅 WebDAV）
        console.log('🎬 切换到转码播放')
        // 构建 WebDAV transcode-stream URL
        const transcodeParams = new URLSearchParams({
          url: config.url,
          username: config.username,
          password: config.password,
          filepath: currentFile.filename,
          sourceType: config.sourceType || 'clouddrive2',
          format: 'mp4',
          quality: 'high',
        })
        newUrl = `/api/webdav/transcode-stream?${transcodeParams.toString().replace(/\+/g, '%20')}`
        console.log('🔗 [转码] 新 URL:', newUrl)
        break
    }
    
    if (newUrl) {
      console.log('✅ [播放方式] 设置新 URL:', newUrl)
      
      if (mediaType === 'small-video') {
        // 小视频不走 InstantVideoPlayer，需要单独计算切源后的 URL 与转码状态。
        const shouldKeepDirectButton = smallVideoDirectPlayAvailableRef.current
        const {
          nextMediaUrl,
          nextOriginalStreamUrl,
          nextTranscodeUrl,
          nextIsUsingTranscode,
        } = resolveSmallVideoPlaybackState(currentFile, mode)

        if (!nextMediaUrl) {
          console.error('❌ [小视频播放方式] 无法解析目标 URL')
          return
        }

        // 切换播放源时重新声明播放意图，确保后续媒体事件与自动播放逻辑仍会接管新 src。
        setPlayIntent(true)
        setSmallVideoDirectPlayEnabled(shouldKeepDirectButton)
        setMediaUrl(nextMediaUrl)
        setOriginalStreamUrl(nextOriginalStreamUrl)
        setTranscodeUrl(nextTranscodeUrl)
        setIsUsingTranscode(nextIsUsingTranscode)

        // 等待 React 提交新的 src 后，再根据端类型主动恢复播放，避免切源后停留在暂停态。
        setTimeout(() => {
          const nextVideo = isMobile
            ? mobileVideoRef.current?.getVideoElement?.()
            : videoRef.current

          if (!nextVideo?.play) {
            console.error('❌ [小视频播放方式] video 元素或 play 方法不存在')
            return
          }

          nextVideo.play().catch((err: any) => {
            console.error('❌ [小视频播放方式] 切换后自动播放失败:', err)
          })
        }, 100)
        return
      }

      setMediaUrl(newUrl)
      
      // 根据模式更新相关状态
      if (mode === 'direct') {
        // 直链模式：保存完整 URL 用于外部播放器
        const fullDirectLinkUrl = new URL(newUrl, window.location.origin).href
        setOriginalStreamUrl(fullDirectLinkUrl)
        setTranscodeUrl(null) // 直链不支持转码
        setIsUsingTranscode(false)
      } else if (mode === 'transcode') {
        // 转码模式
        setTranscodeUrl(newUrl)
        setIsUsingTranscode(true)
        // 保存相对路径用于外部播放器
        setOriginalStreamUrl(newUrl)
      } else {
        // WebDAV 原始流模式
        setTranscodeUrl(null)
        setIsUsingTranscode(false)
        // 保存相对路径用于外部播放器
        setOriginalStreamUrl(newUrl)
      }
      
      // 延迟一下确保 URL 更新后再播放
      setTimeout(() => {
        console.log('🎬 [播放方式] 尝试播放...')
        if (instantVideoRef.current?.play) {
          instantVideoRef.current.play().catch((err: any) => {
            console.error('❌ 播放失败:', err)
          })
        } else {
          console.error('❌ instantVideoRef.current 或 play 方法不存在')
        }
      }, 100)
    } else {
      console.error('❌ [播放方式] 无法生成新 URL')
    }
  }, [currentFile, config, originalStreamUrl, mediaUrl, mediaType, isMobile, resolveSmallVideoPlaybackState])




  //#endregion 通用函数

  //#region 抽屉相关函数
  
  /**
   * 统一控制筛选抽屉开关。
   * 打开时记录当前筛选快照，关闭时比较差异；若配置已变化，则清空当前展示并触发对应模式的重新预加载。
   */
  const toggleDrawer = (open: boolean) => () => {
    if (open) {
      // 打开抽屉时，保存当前配置快照
      configSnapshotRef.current = { 
        mediaFilter, 
        viewedFilter, 
        viewMode,
        advancedFilters: { ...advancedFilters } // 深拷贝高级过滤条件
      }
    } else {
      // 关闭抽屉时，检查配置是否变化
      const hasBasicConfigChanged = configSnapshotRef.current && (
        configSnapshotRef.current.mediaFilter !== mediaFilter ||
        configSnapshotRef.current.viewedFilter !== viewedFilter ||
        configSnapshotRef.current.viewMode !== viewMode
      )
      
      // 检查高级过滤条件是否变化（仅已看过模式）
      const hasAdvancedFiltersChanged = viewedFilter === 'viewed' && configSnapshotRef.current && (
        JSON.stringify(configSnapshotRef.current.advancedFilters) !== JSON.stringify(advancedFilters)
      )
      
      const hasConfigChanged = hasBasicConfigChanged || hasAdvancedFiltersChanged
      
      if (hasConfigChanged) {
        console.log('配置已变化，准备重新加载', { 
          mediaFilter, 
          viewedFilter, 
          viewMode,
          advancedFilters,
          previousViewMode: configSnapshotRef.current?.viewMode,
          hasBasicConfigChanged,
          hasAdvancedFiltersChanged
        })
        
        // 清空当前显示，页面回到初始化状态
        setCurrentFile(null)
        setMediaUrl(null)
        setCurrentGroup([])
        setCurrentGroupIndex(0)
        
        // 触发预加载重新加载
        if (preloadEnabled && config && stats.total > 0) {
          const preloadCount = config.scanSettings?.preloadCount || 10
          
          // 所有模式切换都先取消前一模式的预加载任务
          console.log(`[配置变化] 取消前一模式的预加载任务`)
          databasePreloadManager.cancelAllPreloads()
          databasePreloadManager.clearCache()
          databasePreloadManager.clearNextGroupCache()
          
          // 准备高级过滤参数（仅已看过模式且非图组模式）
          const filters = (viewedFilter === 'viewed' && viewMode !== 'gallery') ? advancedFilters : undefined
          
          // 大视频模式：完全跳过预加载逻辑
          if (viewMode === 'large-video') {
            console.log('[大视频模式] 配置变化：不启动预加载')
            setGalleryPreloadReady(true)
            setCachePreloadProgress(null)
            const cacheStatus = databasePreloadManager.getCacheStatus()
            setPreloadStatus(cacheStatus)
            // 不需要 return，继续执行到 setDrawerOpen(open)
          } else if (viewMode === 'gallery') {
            // 图组模式：重置预加载状态
            setGalleryPreloadReady(false)
            setCachePreloadProgress({ current: 0, total: preloadCount })
            setPreloadInsufficient(false) // 重置数量不足状态
            setActualFoundCount(0) // 重置实际找到的文件数量
            
            // 使用图组模式专用预加载，带进度回调
            databasePreloadManager.preloadForGalleryMode(
              config, 
              [], // 数据库模式不需要文件列表
              preloadCount, 
              viewedFilter,
              (current, total) => {
                setCachePreloadProgress({ current, total })
                // 当所有文件加载完成时，标记为就绪，但保持显示进度
                if (current >= total) {
                  setGalleryPreloadReady(true)
                  // 不设置为 null，保持显示完成状态
                }
              },
              filters // 传递高级过滤参数
            ).then((result) => {
              const cacheStatus = databasePreloadManager.getCacheStatus()
              setPreloadStatus(cacheStatus)
              setGalleryPreloadReady(true)
              // 保持显示进度，基于当前缓存状态
              setCachePreloadProgress({ 
                current: cacheStatus.cacheSize, 
                total: preloadCount 
              })
              console.log(`配置变化后图组模式预加载完成: ${result.message}`)
              
              // 检查是否数量不足，显示提示
              if (result.message && result.message.includes('未达到预加载目标')) {
                setSnackbarMessage(result.message)
                setSnackbarSeverity('warning')
                setSnackbarOpen(true)
              }
            }).catch(error => {
              console.warn('配置变化后图组模式预加载失败:', error)
              setGalleryPreloadReady(true) // 即使失败也允许预览
              const cacheStatus = databasePreloadManager.getCacheStatus()
              // 即使失败也显示当前缓存状态
              setCachePreloadProgress({ 
                current: cacheStatus.cacheSize, 
                total: preloadCount 
              })
            })
          } else {
            // 随机模式：配置变化时重新预加载
            setGalleryPreloadReady(true) // 随机模式不需要等待预加载完成
            setCachePreloadProgress({ current: 0, total: preloadCount })
            setPreloadInsufficient(false) // 重置数量不足状态
            setActualFoundCount(0) // 重置实际找到的文件数量
            databasePreloadManager.refillCache(
              config, 
              [], // 数据库模式不需要文件列表
              preloadCount, 
              viewedFilter,
              (current, total) => {
                // 实时更新进度显示（大视频模式下不更新，使用 ref 避免闭包问题）
                if (viewModeRef.current !== 'large-video') {
                  setCachePreloadProgress({ current, total })
                }
              },
              preloadRandomness,
              true, // isInitialLoad: 配置变化后重新加载，不限制并发
              undefined, // currentParentPath
              mediaFilter, // 媒体类型筛选
              filters // 传递高级过滤参数
            ).then(async (result) => {
              // ✅ 设置数量不足状态和实际找到的文件数量
              setPreloadInsufficient(result.isInsufficient)
              setActualFoundCount(result.actualCount)
              
              // ✅ 检查是否已看完所有文件
              if (result.allViewed) {
                console.log('[预加载] 已看完所有符合条件的文件（配置变化）')
                setShowRestartDialog(true)
                return
              }
              
              // 预加载完成后，如果已切换到大视频模式则忽略结果（使用 ref）
              if (viewModeRef.current === 'large-video') {
                console.log(`[预加载] 模式已切换到大视频模式，忽略配置变化后的预加载结果`)
                return
              }
              
              const cacheStatus = databasePreloadManager.getCacheStatus()
              setPreloadStatus(cacheStatus)
              // 更新进度显示
              setCachePreloadProgress({ 
                current: cacheStatus.cacheSize, 
                total: preloadCount 
              })
              
              // ✅ 使用 API 返回的实际数量判断
              if (result.isInsufficient) {
                const message = `仅找到 ${result.actualCount} 个符合条件的文件，未达到预加载目标 ${preloadCount} 个`
                setSnackbarMessage(message)
                setSnackbarSeverity('warning')
                setSnackbarOpen(true)
              }
              
              console.log(`配置变化后随机模式预加载完成，筛选条件: ${viewedFilter}`)
            }).catch(error => {
              console.warn('配置变化后随机模式预加载失败:', error)
              const cacheStatus = databasePreloadManager.getCacheStatus()
              // 大视频模式下不更新进度（使用 ref）
              if (viewModeRef.current !== 'large-video') {
                setCachePreloadProgress({ 
                  current: cacheStatus.cacheSize, 
                  total: preloadCount 
                })
              }
            })
          }
        }
      }
    }
    
    setDrawerOpen(open)
  }

  /**
   * 处理浏览模式切换。
   * 负责持久化模式、清理旧模式缓存，并重置与目标模式相关的页面状态。
   */
  const handleViewModeChange = (newMode: ViewMode) => {
    setViewMode(newMode)
    localStorage.setItem('view_mode', newMode)
    
    if (preloadEnabled) {
      console.log(`[模式切换] ${viewMode} → ${newMode}：取消预加载并清空缓存`)
      databasePreloadManager.cancelAllPreloads()
      databasePreloadManager.clearCache()
      databasePreloadManager.clearNextGroupCache()
      const cacheStatus = databasePreloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
    }
    
    if (newMode === 'gallery') {
      setCurrentGroup([])
      setCurrentGroupIndex(0)
      setGalleryPreloadReady(false)
      setCachePreloadProgress(null)
    } else if (newMode === 'random') {
      setGalleryPreloadReady(true)
      setCachePreloadProgress(null)
    } else if (newMode === 'large-video') {
      setGalleryPreloadReady(true)
      setCachePreloadProgress(null)
    }
  }

  /**
   * 切换预加载功能总开关。
   */
  const handlePreloadEnabledChange = (enabled: boolean) => {
    setPreloadEnabled(enabled)
  }

  /**
   * 切换评分乐观更新开关，并同步到本地存储。
   */
  const handleOptimisticUpdateEnabledChange = (enabled: boolean) => {
    setOptimisticUpdateEnabled(enabled)
    localStorage.setItem('optimistic_update_enabled', enabled.toString())
  }

  /**
   * 切换 Eruda 调试工具状态，并通过 Snackbar 提示刷新后生效。
   */
  const handleErudaEnabledChange = (enabled: boolean) => {
    setErudaEnabledState(enabled)
    setErudaEnabled(enabled)
    setSnackbarMessage(enabled ? 'Eruda 已启用，请刷新页面生效' : 'Eruda 已禁用，请刷新页面生效')
    setSnackbarSeverity('info')
    setSnackbarOpen(true)
  }

  /**
   * 更新预加载随机性参数，并持久化到本地存储。
   */
  const handlePreloadRandomnessChange = (value: number) => {
    setPreloadRandomness(value)
    localStorage.setItem('preload_randomness', value.toString())
  }

  /**
   * 清空预加载缓存，并立即刷新抽屉中的缓存状态展示。
   */
  const handleClearCache = () => {
    databasePreloadManager.clearCache()
    setPreloadStatus(databasePreloadManager.getCacheStatus())
    setSnackbarMessage('缓存已清理')
    setSnackbarSeverity('info')
    setSnackbarOpen(true)
  }

  /**
   * 重置所有可拖拽控件保存的位置。
   * 清理本地存储后通过刷新页面让布局恢复默认值。
   */
  const handleResetButtonPositions = () => {
    const storageKeys = [
      'fullscreen_rating',
      'fullscreen_shuffle',
      'fullscreen_rating_stream',
      'fullscreen_shuffle_stream',
      'normal_shuffle'
    ]
    
    storageKeys.forEach(key => {
      localStorage.removeItem(`draggable_${key}_position`)
    })
    
    setSnackbarMessage('按钮位置已复位，刷新页面生效')
    setSnackbarSeverity('success')
    setSnackbarOpen(true)
    
    setTimeout(() => {
      window.location.reload()
    }, 1000)
  }

  /**
   * 处理“已看过 / 未看过 / 全部”筛选切换。
   * 除了持久化筛选状态外，还会在必要时清空本地观看记录或移除当前不再匹配的媒体。
   */
  const handleViewedFilterChangeWrapper = (newFilter: ViewedFilter) => {
    setViewedFilter(newFilter)
    localStorage.setItem('viewed_filter', newFilter)
    
    if (newFilter === 'viewed') {
      databasePreloadManager.clearLocalViewedFiles()
    }
    
    if (currentFile) {
      const isViewed = currentRating?.isViewed || false
      if ((newFilter === 'viewed' && !isViewed) || (newFilter === 'unviewed' && isViewed)) {
        setCurrentFile(null)
        setMediaUrl(null)
      }
    }
  }

  /**
   * 在已看过筛选场景下清空本地观看记录，允许重新浏览同一批文件。
   */
  const handleRestartViewedMode = () => {
    databasePreloadManager.clearLocalViewedFiles()
    setSnackbarMessage('已清除本地观看记录，可以重新观看')
    setSnackbarSeverity('success')
    setSnackbarOpen(true)
  }

  /**
   * 处理媒体类型筛选切换。
   * 当当前文件不再满足新筛选条件时，主动清空页面展示，避免显示脏状态。
   */
  const handleMediaFilterChangeWrapper = (newFilter: MediaFilter) => {
    setMediaFilter(newFilter)
    localStorage.setItem('media_filter', newFilter)
    
    if (currentFile) {
      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(currentFile.basename)
      const isVideo = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(currentFile.basename)
      
      if ((newFilter === 'images' && !isImage) || (newFilter === 'videos' && !isVideo)) {
        setCurrentFile(null)
        setMediaUrl(null)
      }
    }
  }

  //#endregion 抽屉相关函数

  //#region 评分相关函数
  
  /**
   * 打开评分对话框，并指定本次评分目标是单媒体还是图组。
   */
  const openRatingDialog = (type: 'media' | 'group') => {
    setRatingType(type)
    setRatingDialogOpen(true)
  }

  /**
   * 关闭评分对话框，保留当前评分数据用于页面展示。
   */
  const closeRatingDialog = () => {
    setRatingDialogOpen(false)
    // 不清空 currentRating，保持显示数据库中的实际评分状态
  }

  /**
   * 按文件路径加载单个媒体文件的评分信息。
   * 这是最轻量的媒体评分读取函数，主要用于切换文件后的状态同步。
   */
  const loadMediaRating = useCallback(async (filePath: string) => {
    try {
      // 确保评分类型为媒体
      setRatingType('media')
      
      const response = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(filePath)}`)
      if (response.ok) {
        // 安全解析 JSON，处理空响应
        const text = await response.text()
        if (text) {
          const data = JSON.parse(text)
          setCurrentRating(data.rating || null)
        } else {
          setCurrentRating(null)
        }
      } else {
        setCurrentRating(null)
      }

      // 同步更新当前博主信息由 CreatorTag 的 onCreatorIdentified 回调负责
    } catch (error) {
      console.error('加载媒体评分失败:', error)
      setCurrentRating(null)
    }
  }, [])

  /**
   * 通用评分加载器。
   * 可根据显式参数或当前页面状态，决定加载单媒体评分还是图组评分。
   */
  const loadCurrentRating = useCallback(async (file?: MediaFile, forceType?: 'media' | 'group') => {
    const targetFile = file || currentFile
    const effectiveRatingType = forceType || ratingType
    
    console.log(`[评分加载] 开始加载评分, 文件: ${targetFile?.basename}, 类型: ${effectiveRatingType}`)
    
    if (!targetFile && currentGroup.length === 0) return

    try {
      if (effectiveRatingType === 'media' && targetFile) {
        const response = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(targetFile.filename)}`)
        console.log(`[评分加载] API 响应状态: ${response.status}`)
        
        if (response.ok) {
          // 安全解析 JSON，处理空响应
          const text = await response.text()
          if (text) {
            const data = JSON.parse(text)
            console.log(`[评分加载] 成功加载评分:`, data.rating)
            setCurrentRating(data.rating || null)
          } else {
            console.log(`[评分加载] 响应为空，清空评分`)
            setCurrentRating(null)
          }
        } else {
          // 如果响应不成功（如 404 表示没有评分），清空评分状态
          console.log(`[评分加载] 响应失败 (${response.status})，清空评分`)
          setCurrentRating(null)
        }
      } else if (effectiveRatingType === 'group' && currentGroup.length > 0) {
        const groupPath = getGroupPath(currentGroup[0].filename)
        const response = await fetch(`/api/ratings/group?groupPath=${encodeURIComponent(groupPath)}`)
        console.log(`[评分加载] 图组 API 响应状态: ${response.status}`)
        
        if (response.ok) {
          // 安全解析 JSON，处理空响应
          const text = await response.text()
          if (text) {
            const data = JSON.parse(text)
            console.log(`[评分加载] 成功加载图组评分:`, data.rating)
            setCurrentRating(data.rating || null)
          } else {
            console.log(`[评分加载] 图组响应为空，清空评分`)
            setCurrentRating(null)
          }
        } else {
          // 如果响应不成功（如 404 表示没有评分），清空评分状态
          console.log(`[评分加载] 图组响应失败 (${response.status})，清空评分`)
          setCurrentRating(null)
        }
      }
    } catch (error) {
      console.error('[评分加载] 加载评分失败:', error)
      // 发生错误时也清空评分状态，避免显示旧数据
      setCurrentRating(null)
    }
  }, [currentFile, ratingType, currentGroup])

  /**
   * 保存评分数据。
   * 同时兼容媒体评分、图组评分与乐观更新模式，并在非乐观场景下回读服务端最新结果。
   */
  const saveRating = useCallback(async (data: MediaRating | GroupRating, file?: MediaFile, optimistic: boolean = false) => {
    try {
      const targetFile = file || currentFile
      
      // ✅ 乐观更新：如果启用且请求乐观更新，立即更新本地状态
      if (optimistic && optimisticUpdateEnabled && targetFile) {
        setCurrentRating(data)
      }
      
      // 如果有传入文件，优先使用媒体评分
      if (targetFile) {
        // 选择 API 端点：启用乐观更新且请求乐观更新时使用乐观 API
        const apiUrl = (optimistic && optimisticUpdateEnabled) ? '/api/ratings/optimistic' : '/api/ratings/media'
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: targetFile.filename,
            fileName: targetFile.basename,
            fileType: isImage(targetFile.filename) ? 'image' : 'video',
            ...data
          })
        })
        
        if (!response.ok) {
          // 安全解析错误响应
          const text = await response.text()
          let errorMessage = '保存媒体评分失败'
          if (text) {
            try {
              const errorData = JSON.parse(text)
              errorMessage = errorData.error || errorMessage
            } catch {
              errorMessage = text || errorMessage
            }
          }
          throw new Error(errorMessage)
        }
        
        // 非乐观模式：保存成功后重新从服务器获取最新评分数据
        if (!optimistic || !optimisticUpdateEnabled) {
          await loadMediaRating(targetFile.filename)
        }
      } else if (ratingType === 'group' && currentGroup.length > 0) {
        const groupPath = getGroupPath(currentGroup[0].filename)
        const groupName = getGroupName(groupPath)
        
        const response = await fetch('/api/ratings/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupPath,
            groupName,
            fileCount: currentGroup.length,
            ...data
          })
        })
        
        if (!response.ok) {
          // 安全解析错误响应
          const text = await response.text()
          let errorMessage = '保存图组评分失败'
          if (text) {
            try {
              const errorData = JSON.parse(text)
              errorMessage = errorData.error || errorMessage
            } catch {
              errorMessage = text || errorMessage
            }
          }
          throw new Error(errorMessage)
        }
        
        // 保存成功后重新从服务器获取最新评分数据
        await loadCurrentRating()
      }
    } catch (error: any) {
      throw new Error(error.message)
    }
  }, [currentFile, ratingType, currentGroup, loadMediaRating, loadCurrentRating, optimisticUpdateEnabled])

  /**
   * 评分对话框专用保存入口。
   * 始终走手动评分语义：启用乐观更新，并在保存后阻止自动评分再次覆盖结果。
   */
  const saveRatingManual = useCallback(async (data: MediaRating | GroupRating, file?: MediaFile) => {
    // 弹窗评分也使用乐观更新（如果开启）
    await saveRating(data, file, true)
    // 手动评分后标记，防止自动评分覆盖
    hasAutoRatedRef.current = true
  }, [saveRating])

  /**
   * 评分保存成功后的统一提示回调。
   */
  const handleRatingSaveSuccess = useCallback(() => {
    setSnackbarMessage('✅ 评分保存成功')
    setSnackbarSeverity('success')
    setSnackbarOpen(true)
  }, [])

  /**
   * 从文件完整路径中提取所属图组目录路径。
   */
  const getGroupPath = (filePath: string): string => {
    const lastSlashIndex = filePath.lastIndexOf('/')
    return lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '/'
  }

  /**
   * 从图组目录路径中提取最后一级目录名，作为图组展示名称。
   */
  const getGroupName = (groupPath: string): string => {
    const pathParts = groupPath.split('/').filter(part => part.length > 0)
    return pathParts.length > 0 ? pathParts[pathParts.length - 1] : '根目录'
  }

  /**
   * 处理快捷评分按钮/快捷键。
   * 仅更新评分、评价与已看过状态，同时保留已有分类与推荐理由，减少覆盖用户已填内容。
   */
  const handleQuickRate = useCallback(async (rating: number, evaluation: string) => {
    if (!currentFile) return

    try {
      // 保留已有的分类和推荐理由，只更新评分、评价和已看过状态
      const ratingData = {
        rating,
        customEvaluation: [evaluation],  // 快捷键使用单个评价，转为数组格式
        isViewed: true,
        // 保留已有的分类和推荐理由
        category: currentRating?.category,
        recommendationReason: currentRating?.recommendationReason
      }

      // ✅ 使用乐观更新（立即显示结果，后台保存）
      await saveRating(ratingData, currentFile, true)
      
      // 手动评分后标记，防止自动评分覆盖
      hasAutoRatedRef.current = true
      
      // 显示评分成功提示
      setSnackbarMessage(`${rating}星 - ${evaluation}`)
      setSnackbarSeverity('success')
      setSnackbarOpen(true)
    } catch (error) {
      console.error('快速评分失败:', error)
      setSnackbarMessage('❌ 评分失败，请重试')
      setSnackbarSeverity('error')
      setSnackbarOpen(true)
    }
  }, [currentFile, currentRating, saveRating])
  
  /**
   * 关闭顶部 Snackbar 提示。
   */
  const handleCloseSnackbar = () => {
    setSnackbarOpen(false)
  }

  // 将 Snackbar 三段式状态封装成统一通知函数，便于精彩时刻模块直接复用页面通知能力。
  const notify = useCallback((message: string, severity: 'success' | 'error' | 'info' | 'warning') => {
    setSnackbarMessage(message)
    setSnackbarSeverity(severity)
    setSnackbarOpen(true)
  }, [])

  // 精彩时刻模块组合器：向模块注入当前文件、播放器控制与通知能力，
  // 再统一取回 UI 片段、进度条标记和连续播放控制方法。
  const videoHighlightsModule = useVideoHighlightsModule({
    currentFile: currentFile ? { filename: currentFile.filename, basename: currentFile.basename } : null,
    mediaType,
    viewMode,
    fullscreen,
    streamVideoTagVisible,
    getCurrentTime: getInstantVideoCurrentTime,
    onSeek: (seconds: number) => {
      instantVideoRef.current?.setCurrentTime?.(seconds)
    },
    onPlay: async () => {
      await instantVideoRef.current?.play?.()
    },
    onNotify: notify,
    onContinuousPlaybackEnd: () => {
      notify('精彩时刻连续播放完成', 'info')
    },
    fullscreenDialogContainer: instantVideoRef.current?.getContainerElement?.() || null,
    inlineDialogContainer: videoPlayerContainerRef.current,
  })

  // 恢复用户上次保存的“连续播放精彩时刻”偏好，只在首次挂载时读取一次即可。
  useEffect(() => {
    const savedContinuousPlay = localStorage.getItem('highlight_continuous_play_enabled')
    if (savedContinuousPlay !== null) {
      videoHighlightsModule.setHighlightContinuousPlayEnabled(savedContinuousPlay === 'true')
    }
  }, [])

  /**
   * 处理“连续播放精彩时刻”开关变化：
   * 1. 更新模块内部状态；
   * 2. 同步到 localStorage 持久化；
   * 3. 关闭时立即终止当前连播，避免残留推进状态继续生效。
   */
  const handleHighlightContinuousPlayEnabledChange = useCallback((enabled: boolean) => {
    videoHighlightsModule.setHighlightContinuousPlayEnabled(enabled)
    localStorage.setItem('highlight_continuous_play_enabled', enabled.toString())
    if (!enabled) {
      videoHighlightsModule.stopContinuousHighlightPlayback()
    }
    notify(enabled ? '已启用连续播放精彩时刻' : '已关闭连续播放精彩时刻', 'info')
  }, [notify, videoHighlightsModule])

  /**
   * 当用户确认“重新开始观看”时执行的重置流程。
   * 会清空本地已看记录与缓存，重新预加载，并在缓存重新可用后自动加载下一条媒体。
   */
  const handleRestartViewing = async () => {
    setShowRestartDialog(false)
    
    if (!config) return
    
    // 清空本地已看过的文件列表
    databasePreloadManager.clearLocalViewedFiles()
    console.log('[重新开始] 已清空本地已看过文件列表')
    
    // 清空缓存
    databasePreloadManager.clearCache()
    console.log('[重新开始] 已清空缓存')
    
    // 重新加载
    const preloadCount = config.scanSettings?.preloadCount || 10
    const filters = viewedFilter === 'viewed' ? advancedFilters : undefined
    
    setLoading(true)
    setCachePreloadProgress({ current: 0, total: preloadCount })
    
    try {
      // ✅ 等待预加载完成（API返回，文件在后台下载）
      const result = await databasePreloadManager.refillCache(
        config,
        [],
        preloadCount,
        viewedFilter,
        (current, total) => {
          setCachePreloadProgress({ current, total })
        },
        preloadRandomness,
        true,
        undefined,
        mediaFilter,
        filters
      )
      
      // ✅ 更新数量信息（保持三段式显示）
      setPreloadInsufficient(result.isInsufficient)
      setActualFoundCount(result.actualCount)
      
      console.log('[重新开始] API 返回，实际找到:', result.actualCount, '个文件')
      
      // ✅ 等待至少一个文件下载到缓存（最多等待50秒）
      let waitCount = 0
      const maxWait = 500 // 500 * 100ms = 50秒
      while (databasePreloadManager.getCachedFilepaths().length === 0 && waitCount < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100))
        waitCount++
      }
      
      console.log('[重新开始] 等待完成，缓存文件数:', databasePreloadManager.getCachedFilepaths().length)
      
      // ✅ 确保缓存中有文件后再加载
      if (databasePreloadManager.getCachedFilepaths().length > 0) {
        await loadRandomFile()
        setSnackbarMessage('🔄 已重新开始，文件顺序已重新随机')
        setSnackbarSeverity('success')
        setSnackbarOpen(true)
      } else {
        console.error('[重新开始] 等待超时，缓存仍为空')
        setError('重新开始失败：文件加载超时')
        setSnackbarMessage('重新开始失败：文件加载超时')
        setSnackbarSeverity('error')
        setSnackbarOpen(true)
      }
    } catch (error) {
      console.error('[重新开始] 失败:', error)
      setSnackbarMessage('重新开始失败')
      setSnackbarSeverity('error')
      setSnackbarOpen(true)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 关闭“重新开始观看”确认对话框，不执行任何重置。
   */
  const handleCancelRestart = () => {
    setShowRestartDialog(false)
  }

  /**
   * 自动评分执行器。
   * 在满足自动标记条件时给文件补上默认评分，并通过 ref 防止同一文件被重复自动评分。
   */
  const performAutoRating = useCallback(async (file?: MediaFile) => {
    // 使用传入的文件或当前文件
    const targetFile = file || currentFile
    if (!targetFile) return
    
    // 同步检查是否已经评分过，避免异步状态更新的竞态条件
    if (hasAutoRatedRef.current) return // 已经评分过，不再评分
    
    // 立即标记为已评分，防止重复调用
    hasAutoRatedRef.current = true
    
    try {
      // 未看过模式下跳过检查现有评分（未看过的文件肯定没有评分，节省一次网络请求）
      if (viewedFilter !== 'unviewed') {
        // 检查文件是否已经有评分，如果有评分就不执行自动评分
        const response = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(targetFile.filename)}`)
        if (response.ok) {
          // 安全解析 JSON，处理空响应
          const text = await response.text()
          if (text) {
            const data = JSON.parse(text)
            if (data.rating && data.rating.rating) {
              // 文件已经有评分，不执行自动评分
              console.log(`文件 ${targetFile.basename} 已有评分 ${data.rating.rating} 星，跳过自动评分`)
              return
            }
          }
        }
      }
      
      // 先检查是否已经标记过，避免重复计数
      const wasAlreadyViewed = databasePreloadManager.isViewed(targetFile.filename)
      
      // 自动标记为已看过，默认2星，评价"一般"
      const autoRatingData = {
        rating: 2,
        customEvaluation: [QUICK_RATING_CONFIG[1].evaluation],
        isViewed: true
      }

      // ✅ 使用乐观更新（立即显示结果，后台保存）
      await saveRating(autoRatingData, targetFile, true)
      
      // 只有首次标记时才更新统计数据中的已看过计数
      if (!wasAlreadyViewed) {
        setStats(prev => {
          console.log(`[DEBUG] 自动评分更新 stats.viewed: ${prev.viewed} -> ${prev.viewed + 1}`)
          return {
            ...prev,
            viewed: prev.viewed + 1
          }
        })
      }
      
      // 确保评分状态已更新
      console.log(`⚡ 自动评分完成（乐观更新）: ${targetFile.basename}`)
    } catch (error) {
      console.error('自动标记已看过失败:', error)
    }
  }, [currentFile, saveRating, viewedFilter])

  /**
   * 启动自动标记已看过计时器。
   * 图片采用极短停留阈值，视频采用较长观看时长阈值；也可用于历史回看场景下仅重置状态而跳过自动评分。
   */
  const startAutoMarkTimer = (file?: MediaFile, skipAutoRating: boolean = false) => {
    // 使用传入的文件或当前文件
    const targetFile = file || currentFile
    if (!targetFile) return

    // 清除之前的定时器
    if (autoMarkTimer) {
      clearTimeout(autoMarkTimer)
    }
    
    // 重置自动评分标志
    hasAutoRatedRef.current = false

    setViewStartTime(Date.now())

    // 如果跳过自动评分（如历史导航），不设置定时器
    if (skipAutoRating) {
      console.log(`[自动评分] 跳过自动评分（历史文件）: ${targetFile.basename}`)
      return
    }

    // 根据文件类型设置不同的时间
    const isImageFile = isImage(targetFile.filename)
    const timeoutDuration = isImageFile ? 100 : 180000 // 图片100ms，视频3分钟

    const timer = setTimeout(async () => {
      await performAutoRating(targetFile)
    }, timeoutDuration)

    setAutoMarkTimer(timer)
  }

  /**
   * 停止自动标记计时器，并清空计时相关状态。
   */
  const stopAutoMarkTimer = () => {
    if (autoMarkTimer) {
      clearTimeout(autoMarkTimer)
      setAutoMarkTimer(null)
    }
    setViewStartTime(null)
  }

  /**
   * 小视频播放进度回调。
   * 当播放进度达到 80% 时触发自动评分逻辑。
   */
  const handleVideoTimeUpdate = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    // 检查 video 和 duration 是否有效（duration 可能是 undefined、NaN 或 Infinity）
    if (!video || !video.duration || !isFinite(video.duration)) return
    
    const progress = video.currentTime / video.duration
    // 播放超过80%时自动标记（performAutoRating内部会防止重复评分）
    if (progress >= 0.8) {
      performAutoRating()
    }
  }, [performAutoRating])

  /**
   * 流式大视频的时间更新回调。
   * 除了 80% 自动评分判断外，还负责与精彩时刻模块同步当前时间和连续播放推进。
   */
  const handleInstantVideoTimeUpdate = useCallback((currentTime: number, duration: number) => {
    // 检查 duration 是否有效
    if (!duration || !isFinite(duration)) return

    videoHighlightsModule.syncSelectedHighlightByTime(currentTime)
    
    const progress = currentTime / duration
    // 播放超过80%时自动标记
    if (progress >= 0.8) {
      performAutoRating()
    }

    videoHighlightsModule.handleContinuousPlaybackProgress(currentTime)
  }, [performAutoRating, videoHighlightsModule])

  /**
   * 媒体播放完成后的统一回调，直接补触一次自动评分。
   */
  const handleVideoEnded = useCallback(() => {
    performAutoRating()
  }, [performAutoRating])

  // 注意：快捷键监听和清理定时器的 useEffect 放在这里是因为它们依赖评分相关的函数
  // 快捷键监听
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // 只在有当前文件且不在输入框中时响应快捷键
      if (!currentFile || (event.target as HTMLElement).tagName === 'INPUT' || (event.target as HTMLElement).tagName === 'TEXTAREA') {
        return
      }

      const key = event.key.toLowerCase()
      
      // 数字键 1-5：快速评分
      if (key >= '1' && key <= '5') {
        event.preventDefault() // 阻止默认行为
        const rating = parseInt(key)
        const config = QUICK_RATING_CONFIG[rating - 1]
        if (config) {
          handleQuickRate(config.rating, config.evaluation)
        }
      }
      
      // R 键：打开详细评分对话框
      if (key === 'r') {
        event.preventDefault()
        openRatingDialog('media')
      }
      
      // G 键：图组模式下打开图组评分对话框
      if (key === 'g' && viewMode === 'gallery' && currentGroup.length > 0) {
        event.preventDefault()
        openRatingDialog('group')
      }

      // 大视频模式下，A/B 用于精彩片段打点
      if (viewMode === 'large-video' && mediaType === 'stream-video') {
        if (key === 'a') {
          event.preventDefault()
          videoHighlightsModule.handleMarkHighlightStart()
        }

        if (key === 'b') {
          event.preventDefault()
          videoHighlightsModule.handleMarkHighlightEnd()
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [currentFile, handleQuickRate, viewMode, currentGroup, mediaType, videoHighlightsModule])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (autoMarkTimer) {
        clearTimeout(autoMarkTimer)
      }
    }
  }, [autoMarkTimer])

  //#endregion 评分相关函数
  
  // 注意：全屏过渡遮罩安全超时清理和确保小视频加载完成后自动播放 放在这里是因为都与视频播放相关
  // 全屏过渡遮罩安全超时清理（防止意外情况下遮罩一直显示）
  useEffect(() => {
    if (fullscreenTransitionOverlay) {
      const timeout = setTimeout(() => {
        console.warn('[过渡遮罩] 超时自动清理')
        setFullscreenTransitionOverlay(false)
      }, 3000) // 3秒后自动清理
      
      return () => clearTimeout(timeout)
    }
  }, [fullscreenTransitionOverlay])

  // 确保小视频加载完成后自动播放
  // 注意：流式视频（InstantVideoPlayer）有自己的 autoPlay 属性，不需要此逻辑
  useEffect(() => {
    // 只处理小视频
    if (!currentFile || !isVideo(currentFile.filename) || mediaType !== 'small-video') return
    
    const targetVideo = videoRef.current
    
    if (targetVideo && playIntentRef.current && !videoStateRef.current) {
      // 确保视频是静音的
      targetVideo.muted = true
      
      // 使用 load() 方法重新加载视频
      targetVideo.load()
      
      console.log('[视频播放] 调用 load() 后立即尝试播放')
      
      // 立即尝试播放
      const attemptPlayImmediately = () => {
        targetVideo.play().then(() => {
          console.log('[视频播放] 播放成功')
          // 播放成功后延迟取消静音
          setTimeout(() => {
            if (targetVideo.muted) {
              targetVideo.muted = false
              console.log('[视频播放] 已取消静音')
            }
          }, 500)
        }).catch(error => {
          console.log('[视频播放] 立即播放失败，等待事件:', error)
        })
      }
      
      // 立即尝试
      attemptPlayImmediately()
      
      // 同时设置多个事件监听作为备用
      const handleAutoPlay = () => {
        if (targetVideo.paused && playIntentRef.current) {
          console.log('[视频播放] 事件触发，再次尝试播放')
          targetVideo.muted = true
          targetVideo.play().catch(err => {
            console.error('[视频播放] 事件播放失败:', err)
          })
        }
      }
      
      // 添加多个事件监听
      targetVideo.addEventListener('loadeddata', handleAutoPlay, { once: true })
      targetVideo.addEventListener('canplay', handleAutoPlay, { once: true })
      
      return () => {
        targetVideo.removeEventListener('loadeddata', handleAutoPlay)
        targetVideo.removeEventListener('canplay', handleAutoPlay)
      }
    }
  }, [currentFile, mediaUrl, mediaType])

  // UI部分
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
          <Button
            variant="contained"
            size="large"
            startIcon={<SettingsIcon />}
            onClick={() => router.push('/config')}
          >
            配置 WebDAV
          </Button>
        </Paper>
      </Container>
    )
  }
  // UI部分
  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* 顶部工具栏 - 简洁版 */}
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
            {/* 预加载进度显示 - 紧挨着筛选与统计图标（图组模式和随机模式都支持） */}
            {preloadEnabled && cachePreloadProgress && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 0.5 }}>
                <DownloadIcon 
                  sx={{ 
                    fontSize: 18,
                    animation: 'download 1.5s ease-in-out infinite',
                    '@keyframes download': {
                      '0%': {
                        transform: 'translateY(0px)',
                        opacity: 1,
                      },
                      '50%': {
                        transform: 'translateY(4px)',
                        opacity: 0.7,
                      },
                      '100%': {
                        transform: 'translateY(0px)',
                        opacity: 1,
                      },
                    },
                  }} 
                  color="primary"
                />
                <Typography 
                  variant="body2" 
                  color="text.secondary"
                  sx={{ minWidth: '32px', fontWeight: 'bold' }}
                >
                  {preloadInsufficient 
                    ? `${actualFoundCount}/${cachePreloadProgress.current}/${cachePreloadProgress.total}`
                    : `${cachePreloadProgress.current}/${cachePreloadProgress.total}`
                  }
                </Typography>
              </Box>
            )}
            <Tooltip title="页面入口">
              <IconButton
                onClick={handlePageMenuOpen}
                color="primary"
                aria-label="页面入口"
              >
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
            <ListItemIcon sx={{ minWidth: 34 }}>
              {item.icon}
            </ListItemIcon>
            <ListItemText>{item.label}</ListItemText>
            <OpenInNewIcon fontSize="small" color="action" />
          </MenuItem>
        ))}
      </Menu>

      {/* 主内容区 - 专注于媒体展示 */}
      <Container maxWidth="xl" sx={{ py: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* 渲染条件：有文件时 或 移动端且无文件时（确保 MobileVideoPlayer 初始化） */}
        {((currentFile && mediaUrl) || (!currentFile && !mediaUrl && isMobile)) && (
          <Box
            sx={{
              position: 'relative',
              ...(fullscreen && {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 2000,
              }),
            }}
          >
            {/* 下层：新内容（当前内容） */}
            <Card 
              elevation={0}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              sx={{ 
                borderRadius: fullscreen ? 0 : 2, 
                overflow: 'hidden',
                backgroundColor: fullscreen ? '#000' : 'transparent',
              // 全屏模式样式（通过 CSS 实现，不使用原生全屏 API）
                ...(fullscreen && {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 1,
                }),
              }}
            >
            <Box 
              ref={videoPlayerContainerRef}
              sx={{ 
                position: 'relative', 
                backgroundColor: (mediaType === 'image' || mediaType === 'small-video' || mediaType === 'stream-video') && currentFile ? '#000' : 'transparent',
                borderRadius: fullscreen ? 0 : 2,
                overflow: 'hidden',
                // 当没有实际内容显示时，不占据空间（但仍然渲染 MobileVideoPlayer 以保持 ref）
                minHeight: (mediaType === 'image' || mediaType === 'small-video' || mediaType === 'stream-video') && currentFile ? 'auto' : 0,
                height: (mediaType === 'image' || mediaType === 'small-video' || mediaType === 'stream-video') && currentFile ? 'auto' : 0,
                // 全屏模式样式
                ...(fullscreen && {
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }),
              }}
            >
              {mediaType === 'image' && (
                <>
                  <CardMedia
                    component="img"
                    image={mediaUrl || ''}
                    alt={currentFile?.basename || ''}
                    sx={{
                      width: fullscreen ? 'auto' : '100%',
                      maxWidth: '100%',
                      maxHeight: fullscreen ? '100%' : 'calc(100vh - 150px)',
                      objectFit: 'contain',
                    }}
                  />
                  {/* 博主标签 - 仅在图片模式下显示 */}
                  {currentFile && (
                    <CreatorTag
                      filePath={currentFile.filename}
                      onCreatorIdentified={setCurrentCreator}
                      onTagClick={() => {
                        setCreatorDialogOpen(true)
                      }}
                      refreshKey={creatorRefreshKey}
                    />
                  )}
                </>
              )}
              
              {/* 移动端小视频：MobileVideoPlayer 组件 */}
              {/* 始终渲染以确保 ref 可用，但 CreatorTag 只在小视频时渲染 */}
              {isMobile && (
                <Box sx={{ 
                  position: 'relative', 
                  width: '100%', 
                  height: '100%',
                  display: mediaType === 'small-video' ? 'block' : 'none'
                }}>
                  <MobileVideoPlayer
                    ref={mobileVideoRef}
                    src={mediaUrl || 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAACrQYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1MiByMjg1NCBlOWE1OTAzIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAA='}
                    autoPlay={shouldAutoPlay && !videoStateRef.current}
                    isParentFullscreen={fullscreen}
                    isVisible={mediaType === 'small-video'}
                    showDirectPlayButton={smallVideoDirectPlayEnabled}
                    onDirectPlay={() => handlePlayModeSelect('direct')}
                    onTimeUpdate={(currentTime, duration) => {
                      const video = mobileVideoRef.current?.getVideoElement()
                      if (video) {
                        handleVideoTimeUpdate({
                          currentTarget: video
                        } as React.SyntheticEvent<HTMLVideoElement>)
                      }
                    }}
                    onEnded={handleVideoEnded}
                    onPlay={() => {
                    }}
                  />
                </Box>
              )}
              
              {/* 移动端小视频的博主标签 - 独立渲染以避免重复调用 API */}
              {isMobile && currentFile && mediaType === 'small-video' && (
                <CreatorTag
                  filePath={currentFile.filename}
                  onCreatorIdentified={setCurrentCreator}
                  onTagClick={() => {
                    setCreatorDialogOpen(true)
                  }}
                  position={{ top: '15%', left: '15%' }}
                  refreshKey={creatorRefreshKey}
                />
              )}
              
              {/* 桌面端小视频：原生 video 元素 */}
              {mediaType === 'small-video' && !isMobile && mediaUrl && (
                  <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
                    {smallVideoDirectPlayEnabled && (
                      <IconButton
                        onClick={() => handlePlayModeSelect('direct')}
                        sx={{
                          position: 'absolute',
                          right: 12,
                          bottom: 18,
                          zIndex: 2,
                          width: 32,
                          height: 32,
                          backgroundColor: 'rgba(0, 0, 0, 0.55)',
                          color: '#fff',
                          border: '1px solid rgba(255, 255, 255, 0.28)',
                          backdropFilter: 'blur(8px)',
                          '&:hover': {
                            backgroundColor: 'rgba(33, 150, 243, 0.35)',
                          },
                        }}
                        title="直链播放"
                      >
                        <OpenInNewIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    )}
                    <Box
                      component="video"
                      ref={videoRef}
                      src={mediaUrl}
                      controls
                      autoPlay={playIntentRef.current && !videoStateRef.current}
                      muted={true}
                      playsInline
                      preload="metadata"
                      webkit-playsinline="true"
                      onTimeUpdate={handleVideoTimeUpdate}
                      onEnded={handleVideoEnded}
                      onPlay={() => {
                        setTimeout(() => {
                          if (playIntentRef.current) {
                            playIntentRef.current = false
                          }
                        }, 1000)
                        
                        const video = videoRef.current
                        if (video?.muted) {
                          setTimeout(() => {
                            video.muted = false
                          }, 300)
                        }
                      }}
                      onLoadedMetadata={(e) => {
                        const video = e.currentTarget as HTMLVideoElement
                        if (playIntentRef.current && !videoStateRef.current) {
                          video.play().catch(error => {
                            video.muted = true
                            video.play().then(() => {
                              setTimeout(() => {
                                video.muted = false
                              }, 300)
                            }).catch(err => {
                              console.error('[视频] 静音播放也失败:', err)
                            })
                          })
                        }
                      }}
                      onLoadedData={(e) => {
                        const video = e.currentTarget as HTMLVideoElement
                        if (playIntentRef.current && !videoStateRef.current && video.paused) {
                          video.play().catch(error => {
                            video.muted = true
                            video.play().catch(err => {
                              console.error('[视频] onLoadedData 静音播放也失败:', err)
                            })
                          })
                        }
                      }}
                      onCanPlay={(e) => {
                        const video = e.currentTarget as HTMLVideoElement
                        if (playIntentRef.current && !videoStateRef.current && video.paused) {
                          video.play().catch(error => {
                            video.muted = true
                            video.play().catch(err => {
                              console.error('[视频] onCanPlay 静音播放也失败:', err)
                            })
                          })
                        }
                      }}
                      sx={{
                        width: fullscreen ? 'auto' : '100%',
                        maxWidth: '100%',
                        maxHeight: fullscreen ? '100%' : 'calc(100vh - 150px)',
                        // 使用 CSS 淡化中间的播放按钮
                        '&::-webkit-media-controls-play-button': {
                          opacity: 0.4,
                          transition: 'opacity 0.2s',
                        },
                        '&:hover::-webkit-media-controls-play-button': {
                          opacity: 1,
                        },
                        // Firefox
                        '&::-moz-media-controls-play-button': {
                          opacity: 0.4,
                          transition: 'opacity 0.2s',
                        },
                        '&:hover::-moz-media-controls-play-button': {
                          opacity: 1,
                        },
                      }}
                    />
                    {/* 博主标签 - 仅在有文件时显示 */}
                    {currentFile && (
                      <CreatorTag
                        filePath={currentFile.filename}
                        onCreatorIdentified={setCurrentCreator}
                        onTagClick={() => {
                          setCreatorDialogOpen(true)
                        }}
                        refreshKey={creatorRefreshKey}
                      />
                    )}
                  </Box>
              )}
              {mediaType === 'stream-video' && mediaUrl && (
                <Box sx={{ 
                  position: 'relative', 
                  width: '100%', 
                  height: fullscreen ? '100%' : 'min(56.25vw, calc(100vh - 150px))', // 16:9 比例，非全屏时限制最大高度
                  minHeight: fullscreen ? undefined : 300,
                }}>
                  <InstantVideoPlayer
                    key={mediaUrl} // 使用 mediaUrl 作为 key，确保 URL 变化时重新创建实例
                    ref={instantVideoRef}
                    src={mediaUrl}
                    autoPlay={true}
                    playIntent={playIntentRef.current} // 传递播放意图，用于安卓浏览器自动播放
                    isParentFullscreen={fullscreen} // 传递父组件的全屏状态
                    transcodeUrl={transcodeUrl || undefined} // 转码流 URL，用于自动降级
                    onTranscodeFallback={() => {
                      setIsUsingTranscode(true)
                    }}
                    onTimeUpdate={handleInstantVideoTimeUpdate}
                    onEnded={handleVideoEnded}
                    onNext={loadRandomMedia} // 换一个按钮
                    highlights={videoHighlightsModule.progressHighlights.map((highlight) => ({
                      id: highlight.id,
                      startSeconds: highlight.startSeconds,
                      endSeconds: highlight.endSeconds,
                    }))}
                    selectedHighlightId={videoHighlightsModule.selectedHighlightId}
                    onRestartCurrentVideo={() => {
                      videoHighlightsModule.clearSelectedHighlight()
                      videoHighlightsModule.stopContinuousHighlightPlayback()
                    }}
                    onControlsVisibilityChange={(visible) => {
                      setStreamVideoTagVisible(visible)
                    }}
                    alwaysOverlay={
                      currentFile ? (
                        <>
                          <CreatorTag
                            filePath={currentFile.filename}
                            onCreatorIdentified={setCurrentCreator}
                            onTagClick={() => setCreatorDialogOpen(true)}
                            visible={streamVideoTagVisible}
                            refreshKey={creatorRefreshKey}
                          />
                          {!fullscreen && videoHighlightsModule.inlineMarkerControls}
                        </>
                      ) : undefined
                    }
                    // 全屏覆盖层 - 在原生全屏模式下显示评分组件
                    fullscreenOverlay={
                      <>
                        {videoHighlightsModule.fullscreenMarkerControls}
                        <Box
                          sx={{
                            position: 'absolute',
                            left: 20,
                            right: 20,
                            bottom: 88,
                            zIndex: 2001,
                            opacity: streamVideoTagVisible ? 1 : 0,
                            transform: 'translateY(0)',
                            visibility: streamVideoTagVisible ? 'visible' : 'hidden',
                            transition: 'opacity 0.15s ease-out, visibility 0.15s ease-out',
                            pointerEvents: streamVideoTagVisible ? 'auto' : 'none',
                            willChange: 'opacity',
                          }}
                        >
                          {videoHighlightsModule.fullscreenStrip}
                        </Box>

                        {/* 左侧边：星星等级设置 - 纵向显示，可拖动 */}
                        <DraggableBox
                          storageKey="fullscreen_rating_stream"
                          defaultSx={{
                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
                            backdropFilter: 'blur(8px)',
                            px: 1,
                            py: 1.5,
                            borderRadius: 1.5,
                            zIndex: 2001,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 0.5,
                            opacity: 0.5,
                            '&:hover': {
                              opacity: 1,
                            },
                          }}
                          sx={({ position }: { position: { x: number; y: number } | null; isDragging: boolean }) => ({
                            ...(!position && {
                              right: 10,
                              bottom: 151, // 换一个按钮80px + 按钮高度56px + 间距15px
                            }),
                          })}
                        >
                          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                            {QUICK_RATING_CONFIG.map((config) => {
                              const isLit = currentRating?.rating && currentRating.rating >= config.rating
                              
                              return (
                                <Tooltip
                                  key={config.rating}
                                  title={`${config.rating}星 - ${config.evaluation}`}
                                  placement="right"
                                >
                                  <IconButton
                                    size="small"
                                    onClick={() => handleQuickRate(config.rating, config.evaluation)}
                                    disabled={loading || isSwitching}
                                    sx={{
                                      color: isLit ? 'warning.main' : 'rgba(255, 255, 255, 0.7)',
                                      transition: 'all 0.2s',
                                      padding: '4px',
                                      '&:hover': {
                                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                                        color: 'warning.main',
                                        transform: 'scale(1.1)',
                                      },
                                    }}
                                  >
                                    {isLit ? (
                                      <StarIcon fontSize="small" />
                                    ) : (
                                      <StarBorderIcon fontSize="small" />
                                    )}
                                  </IconButton>
                                </Tooltip>
                              )
                            })}
                          </Box>
                          
                          {/* 详情评分按钮 */}
                          <Tooltip title="详细评分 (R)" placement="right">
                            <IconButton
                              size="small"
                              onClick={() => openRatingDialog('media')}
                              disabled={loading || isSwitching || !currentFile}
                              sx={{
                                color: 'rgba(255, 255, 255, 0.7)',
                                mt: 0.5,
                                '&:hover': {
                                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                                  color: 'primary.main',
                                },
                                transition: 'all 0.2s ease-in-out',
                                p: 0.5,
                              }}
                            >
                              <RateReviewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </DraggableBox>

                        {/* 右下角：换一个按钮（可拖动） */}
                        {/* 注意：在全屏模式下，需要包装一层来转换定位方式 */}
                        <Box
                          sx={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            width: '100%',
                            height: '100%',
                            pointerEvents: 'none', // 不拦截事件
                            '& > *': {
                              pointerEvents: 'auto', // 子元素可以接收事件
                            },
                          }}
                        >
                          <DraggableFab
                            storageKey="fullscreen_shuffle_stream"
                            onClick={loadRandomMedia}
                            disabled={isSwitching}
                            defaultSx={{
                              // 在包装器内使用 absolute 定位
                              position: 'absolute',
                              right: 10,
                              bottom: 80, // 进度条60px + 间距20px
                              zIndex: 2001,
                            }}
                          >
                            <ShuffleIcon />
                          </DraggableFab>
                        </Box>

                        {/* 评分对话框 - 原生全屏模式 */}
                        <RatingDialog
                          open={ratingDialogOpen}
                          onClose={closeRatingDialog}
                          onSave={saveRatingManual}
                          onSaveSuccess={handleRatingSaveSuccess}
                          title={ratingType === 'media' ? '评分媒体文件' : '评分图组'}
                          subtitle={
                            ratingType === 'media' 
                              ? currentFile?.basename 
                              : currentGroup.length > 0 
                                ? `${getGroupName(getGroupPath(currentGroup[0].filename))} (${currentGroup.length} 个文件)`
                                : undefined
                          }
                          initialData={currentRating || undefined}
                          type={ratingType}
                          container={instantVideoRef.current?.getContainerElement()}
                        />
                      </>
                    }
                  />
                  
                  {/* 播放方式选择器 - 在视频框中央显示 */}
                  {showPlayModeSelector && (
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
                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                        backdropFilter: 'blur(10px)',
                        zIndex: 1000,
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
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Typography variant="h6" sx={{ color: '#e94560', fontWeight: 'bold', mb: 3, textAlign: 'center' }}>
                          选择播放方式
                        </Typography>
                        
                        {/* 横向排列的按钮 */}
                        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                          {/* WebDAV 播放 */}
                          {originalStreamUrl && (
                            <Button
                              variant="outlined"
                              fullWidth
                              size="large"
                              onClick={() => handlePlayModeSelect('webdav')}
                              sx={{
                                borderColor: '#4ade80',
                                color: '#4ade80',
                                py: 2,
                                fontSize: '1rem',
                                fontWeight: 'bold',
                                '&:hover': {
                                  borderColor: '#22c55e',
                                  backgroundColor: 'rgba(74, 222, 128, 0.1)',
                                },
                              }}
                            >
                              WebDAV<br/>播放
                            </Button>
                          )}
                          
                          {/* 直链播放 */}
                          {config?.enableDirectLink && currentFile && (
                            <Button
                              variant="outlined"
                              fullWidth
                              size="large"
                              onClick={() => handlePlayModeSelect('direct')}
                              sx={{
                                borderColor: '#2196f3',
                                color: '#2196f3',
                                py: 2,
                                fontSize: '1rem',
                                fontWeight: 'bold',
                                '&:hover': {
                                  borderColor: '#1976d2',
                                  backgroundColor: 'rgba(33, 150, 243, 0.1)',
                                },
                              }}
                            >
                              直链<br/>播放
                            </Button>
                          )}
                          
                          {/* 转码播放 - 只能针对 WebDAV */}
                          {originalStreamUrl && (
                            <Button
                              variant="outlined"
                              fullWidth
                              size="large"
                              onClick={() => handlePlayModeSelect('transcode')}
                              sx={{
                                borderColor: '#e94560',
                                color: '#e94560',
                                py: 2,
                                fontSize: '1rem',
                                fontWeight: 'bold',
                                '&:hover': {
                                  borderColor: '#ff6b6b',
                                  backgroundColor: 'rgba(233, 69, 96, 0.1)',
                                },
                              }}
                            >
                              转码<br/>播放
                            </Button>
                          )}
                        </Stack>
                        
                        <Typography variant="caption" sx={{ color: '#888', display: 'block', mb: 2, textAlign: 'center' }}>
                          💡 转码播放仅支持 WebDAV 源
                        </Typography>
                        
                        <Button
                          fullWidth
                          onClick={() => setShowPlayModeSelector(false)}
                          sx={{ color: '#888' }}
                        >
                          取消
                        </Button>
                      </Box>
                    </Box>
                  )}
                </Box>
              )}

              {/* 全屏时的 UI 覆盖层（图片和小视频使用 CSS 全屏） */}
              {currentFile && fullscreen && mediaType !== 'stream-video' && (
                <>
                  {/* 左上角：文件信息 */}
                  <Box
                    sx={{
                      position: 'fixed',
                      top: 24,
                      left: 24,
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      color: 'white',
                      px: 2.5,
                      py: 1.5,
                      borderRadius: 2,
                      zIndex: 2001,
                      backdropFilter: 'blur(10px)',
                    }}
                  >
                    <Typography variant="body1" fontWeight="medium">
                      {viewMode === 'gallery' && currentGroup.length > 0
                        ? `${currentGroupIndex + 1} / ${currentGroup.length}`
                        : '随机浏览'}
                    </Typography>
                    {/* 转码状态指示 */}
                    {isUsingTranscode && (
                      <Typography variant="caption" sx={{ color: '#fbbf24', display: 'block', mt: 0.5 }}>
                        🔄 转码播放中
                      </Typography>
                    )}
                  </Box>

                  {/* 左侧边：星星等级设置 - 纵向显示，可拖动 */}
                  <DraggableBox
                    storageKey="fullscreen_rating"
                    defaultSx={{
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      backdropFilter: 'blur(8px)',
                      px: 1,
                      py: 1.5,
                      borderRadius: 1.5,
                      zIndex: 2001,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 0.5,
                      opacity: 0.5,
                      '&:hover': {
                        opacity: 1,
                      },
                    }}
                    sx={({ position }: { position: { x: number; y: number } | null; isDragging: boolean }) => ({
                      ...(!position && {
                        right: 10,
                        bottom: 151, // 换一个按钮80px + 按钮高度56px + 间距15px
                      }),
                    })}
                  >
                    {/* 预加载数量显示 */}
                    {preloadEnabled && cachePreloadProgress && viewMode !== 'large-video' && (
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'rgba(255, 255, 255, 0.8)',
                          fontSize: '10px',
                          mb: 0.5,
                        }}
                      >
                        {cachePreloadProgress.current}
                      </Typography>
                    )}
                    
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                      {QUICK_RATING_CONFIG.map((config) => {
                        const isLit = currentRating?.rating && currentRating.rating >= config.rating
                        
                        return (
                          <Tooltip
                            key={config.rating}
                            title={`${config.rating}星 - ${config.evaluation}`}
                            placement="right"
                          >
                            <IconButton
                              size="small"
                              onClick={() => handleQuickRate(config.rating, config.evaluation)}
                              disabled={loading || isSwitching}
                              sx={{
                                color: isLit ? 'warning.main' : 'rgba(255, 255, 255, 0.7)',
                                transition: 'all 0.2s',
                                padding: '4px',
                                '&:hover': {
                                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                                  color: 'warning.main',
                                  transform: 'scale(1.1)',
                                },
                              }}
                            >
                              {isLit ? (
                                <StarIcon fontSize="small" />
                              ) : (
                                <StarBorderIcon fontSize="small" />
                              )}
                            </IconButton>
                          </Tooltip>
                        )
                      })}
                    </Box>
                    
                    {/* 详情评分按钮 */}
                    <Tooltip title="详细评分 (R)" placement="right">
                      <IconButton
                        size="small"
                        onClick={() => openRatingDialog('media')}
                        disabled={loading || isSwitching || !currentFile}
                        sx={{
                          color: 'rgba(255, 255, 255, 0.7)',
                          mt: 0.5,
                          '&:hover': {
                            backgroundColor: 'rgba(255, 255, 255, 0.2)',
                            color: 'primary.main',
                          },
                          transition: 'all 0.2s ease-in-out',
                          p: 0.5,
                        }}
                      >
                        <RateReviewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </DraggableBox>

                  {/* 图组模式：换组按钮 */}
                  {viewMode === 'gallery' && currentGroup.length > 0 && (
                    <Tooltip title="换下一组" placement="left">
                      <Fab
                        color="secondary"
                        onClick={() => {
                          playIntentRef.current = true
                          loadRandomGroup()
                        }}
                        disabled={loading || isSwitching}
                        sx={{
                          position: 'fixed',
                          bottom: 180,
                          right: 24,
                          zIndex: 2001,
                        }}
                      >
                        <SkipNextIcon />
                      </Fab>
                    </Tooltip>
                  )}

                  {/* 右下角：换一个按钮（可拖动） - 随机模式回看状态下隐藏 */}
                  {!(viewMode === 'random' && randomHistoryIndex < -1) && (
                    <DraggableFab
                      storageKey="fullscreen_shuffle"
                      onClick={loadRandomMedia}
                      disabled={isSwitching}
                      defaultSx={{
                        right: 10,
                        bottom: 80, // 进度条60px + 间距20px
                        zIndex: 2001,
                      }}
                    >
                      <ShuffleIcon />
                    </DraggableFab>
                  )}

                  {/* 右上角：退出全屏按钮 */}
                  <IconButton
                    onClick={toggleFullscreen}
                    sx={{
                      position: 'fixed',
                      top: 24,
                      right: 24,
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      color: 'white',
                      zIndex: 2001,
                      '&:hover': {
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                      },
                    }}
                  >
                    <FullscreenExitIcon />
                  </IconButton>

                  {/* 评分对话框 - 全屏模式 */}
                  <RatingDialog
                    open={ratingDialogOpen}
                    onClose={closeRatingDialog}
                    onSave={saveRatingManual}
                    onSaveSuccess={handleRatingSaveSuccess}
                    title={ratingType === 'media' ? '评分媒体文件' : '评分图组'}
                    subtitle={
                      ratingType === 'media' 
                        ? currentFile?.basename 
                        : currentGroup.length > 0 
                          ? `${getGroupName(getGroupPath(currentGroup[0].filename))} (${currentGroup.length} 个文件)`
                          : undefined
                    }
                    initialData={currentRating || undefined}
                    type={ratingType}
                    container={videoPlayerContainerRef.current}
                  />
                </>
              )}
              
              {/* 流式视频 CSS 全屏时的退出全屏按钮 */}
              {currentFile && fullscreen && mediaType === 'stream-video' && (
                <IconButton
                  onClick={toggleFullscreen}
                  sx={{
                    position: 'fixed',
                    top: 24,
                    right: 24,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    color: 'white',
                    zIndex: 2001,
                    '&:hover': {
                      backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    },
                  }}
                >
                  <FullscreenExitIcon />
                </IconButton>
              )}
              
            </Box>
            
            {/* 文件信息 - 紧凑显示（全屏模式下隐藏） */}
            {!fullscreen && currentFile && (
            <CardContent sx={{ py: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                <Typography 
                  variant="body1" 
                  fontWeight="medium" 
                  sx={{ 
                    flex: 1,
                    wordBreak: 'break-all',
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                    whiteSpace: 'normal',
                    minWidth: 0  // 允许收缩
                  }}
                >
                  {currentFile.basename}
                </Typography>
                {viewMode === 'gallery' && currentGroup.length > 0 && (
                  <Chip 
                    label={`${currentGroupIndex + 1}/${currentGroup.length}`} 
                    size="small" 
                    color="primary"
                    sx={{ flexShrink: 0 }}  // 防止Chip被压缩
                  />
                )}
              </Box>
              <Typography 
                variant="body2" 
                color="text.secondary" 
                sx={{ 
                  mt: 0.5,
                  wordBreak: 'break-all',
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  whiteSpace: 'normal',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                {currentFile.filename}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 0.5, alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                  {formatFileSize(currentFile.size)}
                </Typography>
                {mediaType === 'stream-video' && (
                  <Chip 
                    label="流式播放" 
                    size="small" 
                    color="info"
                    sx={{ height: '18px', fontSize: '0.65rem' }}
                  />
                )}
                <Typography variant="caption" color="text.secondary">
                  {new Date(currentFile.lastmod).toLocaleString('zh-CN')}
                </Typography>
              </Box>
              
              {/* 快速评分 */}
              <Box sx={{ mt: 1, mb: 1 }}>
                <QuickRating
                  currentRating={currentRating?.rating}
                  onQuickRate={handleQuickRate}
                  disabled={loading || isSwitching}
                />
              </Box>
              
              {/* 评分状态显示 */}
              <Box sx={{ mt: 1 }}>
                <RatingStatus
                  rating={currentRating?.rating}
                  customEvaluation={currentRating?.customEvaluation}
                  category={currentRating?.category}
                  isViewed={currentRating?.isViewed}
                  onEdit={() => openRatingDialog('media')}
                  compact
                />
              </Box>

              {mediaType === 'stream-video' && (
                <Box sx={{ mt: 1.25 }}>
                  <Box
                    sx={{
                      px: 0,
                      py: 0,
                      backgroundColor: 'transparent',
                    }}
                  >
                    {videoHighlightsModule.inlineStrip}
                  </Box>
                </Box>
              )}
               
              {/* 视频操作按钮 - 仅视频文件显示 */}
              {isVideo(currentFile.filename) && (
                <Box sx={{ mt: 1.5 }}>
                  {/* 外部播放器按钮 */}
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<OpenInNewIcon />}
                    onClick={handleExternalPlayerClick}
                    sx={{ 
                      color: '#4ade80', 
                      borderColor: '#4ade80',
                      width: '100%',
                      '&:hover': {
                        borderColor: '#22c55e',
                        backgroundColor: 'rgba(74, 222, 128, 0.1)',
                      }
                    }}
                  >
                    外部播放
                  </Button>
                  
                  {/* PC 端下拉菜单 - 外部播放器选择（所有视频类型都显示） */}
                  <Menu
                    anchorEl={externalPlayerAnchor}
                    open={externalPlayerMenuOpen}
                    onClose={() => setExternalPlayerAnchor(null)}
                    anchorOrigin={{
                      vertical: 'top',
                      horizontal: 'left',
                    }}
                    transformOrigin={{
                      vertical: 'bottom',
                      horizontal: 'left',
                    }}
                  >
                    <MenuItem onClick={() => playWithExternalPlayer('potplayer')}>
                      <ListItemIcon>
                        <OpenInNewIcon fontSize="small" sx={{ color: '#f59e0b' }} />
                      </ListItemIcon>
                      <ListItemText>PotPlayer</ListItemText>
                    </MenuItem>
                    <MenuItem onClick={() => playWithExternalPlayer('vlc')}>
                      <ListItemIcon>
                        <OpenInNewIcon fontSize="small" sx={{ color: '#f97316' }} />
                      </ListItemIcon>
                      <ListItemText>VLC</ListItemText>
                    </MenuItem>
                  </Menu>
                </Box>
              )}
            </CardContent>
            )}
          </Card>
          </Box>
        )}

        {/* 图组模式导航按钮（正常模式） */}
        {!fullscreen && viewMode === 'gallery' && currentGroup.length > 0 && currentFile && (
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 2 }}>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={previousInGroup}
              disabled={currentGroupIndex === 0 || loading || isSwitching}
            >
              上一张
            </Button>
            <Button
              variant="outlined"
              startIcon={<SkipNextIcon />}
              onClick={() => {
                playIntentRef.current = true
                loadRandomGroup()
              }}
              disabled={loading || isSwitching}
            >
              换下一组
            </Button>
            <Button
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              onClick={nextInGroup}
              disabled={loading || isSwitching}
            >
              下一张
            </Button>
          </Box>
        )}

        {!currentFile && !loading && (
          <Paper
            elevation={0}
            sx={{
              p: 8,
              textAlign: 'center',
              backgroundColor: 'white',
              borderRadius: 2,
              minHeight: 'calc(100vh - 200px)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <ShuffleIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h5" gutterBottom>
              {viewMode === 'gallery' && preloadEnabled && !galleryPreloadReady ? '正在加载中...' : '准备好了！'}
            </Typography>
            {viewMode === 'gallery' && preloadEnabled && cachePreloadProgress && (
              <Box sx={{ mb: 3 }}>
                <CircularProgress sx={{ mb: 2 }} />
                <Typography variant="body1" color="text.secondary">
                  正在加载 ({preloadInsufficient 
                    ? `${actualFoundCount}/${cachePreloadProgress.current}/${cachePreloadProgress.total}`
                    : `${cachePreloadProgress.current}/${cachePreloadProgress.total}`
                  })
                </Typography>
              </Box>
            )}
            {(!cachePreloadProgress || (viewMode !== 'gallery') || !preloadEnabled || galleryPreloadReady) && (
              <>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
                  从 {config.mediaPaths.length} 个目录中
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                  随机加载{filteredStats.label === '全部' ? '媒体文件' : filteredStats.label}
                </Typography>
                <Typography variant="body2" color="primary" sx={{ mb: 3 }}>
                  当前筛选：{filteredStats.label} - {filteredStats.total} 个文件
                </Typography>
              </>
            )}
            <Button
              variant="contained"
              size="large"
              startIcon={viewMode === 'gallery' && !galleryPreloadReady && preloadEnabled ? <CircularProgress size={20} color="inherit" /> : <ShuffleIcon />}
              onClick={loadRandomMedia}
              disabled={viewMode === 'gallery' && !galleryPreloadReady && preloadEnabled}
            >
              {viewMode === 'gallery' && !galleryPreloadReady && preloadEnabled ? '加载中...' : '开始预览'}
            </Button>
          </Paper>
        )}

        {loading && !currentFile && (
          <Box 
            sx={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 'calc(100vh - 200px)',
            }}
          >
            <CircularProgress size={60} sx={{ mb: 2 }} />
            <Typography variant="h6" color="primary" sx={{ mb: 2 }}>
              正在扫描媒体文件...
            </Typography>
            {scanProgress && (
              <Box sx={{ textAlign: 'center', mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  当前扫描路径:
                </Typography>
                <Typography variant="body1" color="primary" sx={{ mb: 1, fontFamily: 'monospace' }}>
                  {scanProgress.currentPath}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  已找到 {scanProgress.fileCount} 个文件
                </Typography>
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              递归扫描可能需要一些时间，请耐心等待
            </Typography>
            {stats.total > 0 && (
              <Typography variant="body2" color="success.main" sx={{ mt: 2 }}>
                已找到 {stats.total} 个文件
              </Typography>
            )}
          </Box>
        )}
      </Container>

      {/* 右侧抽屉 - 筛选与统计 */}
      {config && (
        <SettingsDrawer
          open={drawerOpen}
          onClose={toggleDrawer(false)}
          // 浏览模式相关
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          currentGroup={currentGroup}
          currentGroupIndex={currentGroupIndex}
          currentFile={currentFile}
          // 评分相关
          onOpenRatingDialog={openRatingDialog}
          // 预加载相关
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
          highlightContinuousPlayEnabled={videoHighlightsModule.highlightContinuousPlayEnabled}
          onHighlightContinuousPlayEnabledChange={handleHighlightContinuousPlayEnabledChange}
          // 已看过筛选相关
          viewedFilter={viewedFilter}
          onViewedFilterChange={handleViewedFilterChangeWrapper}
          stats={stats}
          localViewedCount={databasePreloadManager.getLocalViewedCount()}
          onRestartViewedMode={handleRestartViewedMode}
          // 高级过滤相关
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={setAdvancedFilters}
          availableEvaluations={availableEvaluations}
          availableCategories={availableCategories}
          // 媒体类型筛选相关
          mediaFilter={mediaFilter}
          onMediaFilterChange={handleMediaFilterChangeWrapper}
          // 配置相关
          config={config}
          loading={loading}
          isSwitching={isSwitching}
          onNavigateToManage={() => router.push('/manage')}
        />
      )}

      {/* 全屏按钮 - 固定在右上角 */}
      {!fullscreen && currentFile && mediaUrl && (
        <Tooltip title="全屏查看" placement="left">
          <Fab
            size="small"
            color="default"
            onClick={toggleFullscreen}
            sx={{
              position: 'fixed',
              top: 80,
              right: 24,
              zIndex: 1000,
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 1)',
              },
            }}
          >
            <FullscreenIcon />
          </Fab>
        </Tooltip>
      )}

      {/* 悬浮按钮 - 固定在右下角 */}
      {/* 随机模式回看状态下隐藏换一个按钮 */}
      {!(viewMode === 'random' && randomHistoryIndex < -1) && (
        <Tooltip title="全屏查看" placement="left">
          <Fab
            size="small"
            color="default"
            onClick={toggleFullscreen}
            sx={{
              position: 'fixed',
              top: 80,
              right: 24,
              zIndex: 1000,
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 1)',
              },
            }}
          >
            <FullscreenIcon />
          </Fab>
        </Tooltip>
      )}

      {/* 悬浮按钮 - 固定在右下角 */}
      {/* 随机模式回看状态下隐藏换一个按钮 */}
      {!(viewMode === 'random' && randomHistoryIndex < -1) && (
        <Tooltip 
          title={
            loading 
              ? '加载中...' 
              : viewMode === 'gallery' && !galleryPreloadReady && preloadEnabled
                ? '正在加载预加载文件，请稍候...' 
                : '换一个'
          } 
          placement="left"
        >
          <DraggableFab
            storageKey="normal_shuffle"
            color="primary"
            aria-label="换一个"
            onClick={loadRandomMedia}
            disabled={loading || isSwitching || (viewMode === 'gallery' && !galleryPreloadReady && preloadEnabled)}
            defaultSx={{
              zIndex: 1000,
            }}
          >
            {loading || (viewMode === 'gallery' && !galleryPreloadReady && preloadEnabled && cachePreloadProgress) ? (
              <CircularProgress size={24} color="inherit" />
            ) : (
              <ShuffleIcon />
            )}
          </DraggableFab>
        </Tooltip>
      )}

      {/* 随机模式：回看和前进按钮 */}
      {viewMode === 'random' && !fullscreen && (
        <>
          {/* 回看按钮 - 在换一个按钮左侧 */}
          <Tooltip 
            title={
              randomHistory.length === 0 
                ? '没有历史记录' 
                : randomHistoryIndex <= -(randomHistory.length)
                  ? '已经是最早的记录'
                  : '回看上一个'
            } 
            placement="top"
          >
            <Fab
              size="medium"
              color="secondary"
              aria-label="回看上一个"
              onClick={loadPreviousRandomFile}
              disabled={loading || isSwitching || randomHistory.length === 0 || randomHistoryIndex <= -(randomHistory.length)}
              sx={{
                position: 'fixed',
                bottom: 24,
                right: 104, // 换一个按钮左侧
                zIndex: 1000,
              }}
            >
              <ArrowBackIcon />
            </Fab>
          </Tooltip>

          {/* 前进按钮 - 在回看按钮左侧 */}
          {randomHistoryIndex < -1 && (
            <Tooltip 
              title="前进到下一个" 
              placement="top"
            >
              <Fab
                size="medium"
                color="secondary"
                aria-label="前进到下一个"
                onClick={loadNextRandomFile}
                disabled={loading || isSwitching}
                sx={{
                  position: 'fixed',
                  bottom: 24,
                  right: 184, // 回看按钮左侧
                  zIndex: 1000,
                }}
              >
                <ArrowForwardIcon />
              </Fab>
            </Tooltip>
          )}
        </>
      )}

      {/* 评分对话框 */}
      <RatingDialog
        open={ratingDialogOpen}
        onClose={closeRatingDialog}
        onSave={saveRatingManual}
        onSaveSuccess={handleRatingSaveSuccess}
        title={ratingType === 'media' ? '评分媒体文件' : '评分图组'}
        subtitle={
          ratingType === 'media' 
            ? currentFile?.basename 
            : currentGroup.length > 0 
              ? `${getGroupName(getGroupPath(currentGroup[0].filename))} (${currentGroup.length} 个文件)`
              : undefined
        }
        initialData={currentRating || undefined}
        type={ratingType}
      />

      {/* 博主对话框 */}
      <CreatorDialog
        open={creatorDialogOpen}
        onClose={() => setCreatorDialogOpen(false)}
        filePath={currentFile?.filename || ''}
        existingCreator={currentCreator}
        onMarkUnknown={() => {
          setCurrentCreator(null)
          setCreatorRefreshKey(k => k + 1)
        }}
        onSuccess={() => {
          if (currentFile) {
            // 强制 CreatorTag 重新调用 identify，回调会更新 currentCreator
            setCreatorRefreshKey(k => k + 1)
            loadMediaRating(currentFile.filename)
          }
        }}
      />

      {/* 评分提示 */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={2000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ zIndex: 9999 }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbarSeverity}
          variant="filled"
          sx={{ width: '100%', fontSize: '1.1rem', fontWeight: 'bold' }}
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>

      {/* 已看完所有文件对话框 */}
      <Dialog
        open={showRestartDialog}
        onClose={handleCancelRestart}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          🎉 已看完所有符合条件的文件
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            您已经浏览完所有符合当前筛选条件的文件。
          </Typography>
          <Typography variant="body2" color="text.secondary">
            是否重新开始？文件顺序将重新随机排列。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelRestart} color="inherit">
            取消
          </Button>
          <Button onClick={handleRestartViewing} variant="contained" color="primary">
            重新开始
          </Button>
        </DialogActions>
      </Dialog>

      {videoHighlightsModule.editorDialog}

      {/* 全屏过渡遮罩 - 用于图片全屏切换到视频全屏时的平滑过渡 */}
      {fullscreenTransitionOverlay && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#000',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'fadeIn 0.2s ease-in-out',
            '@keyframes fadeIn': {
              '0%': {
                opacity: 0,
              },
              '100%': {
                opacity: 1,
              },
            },
          }}
        >
          <CircularProgress size={60} sx={{ color: 'white' }} />
        </Box>
      )}
    </Box>
  )
}
