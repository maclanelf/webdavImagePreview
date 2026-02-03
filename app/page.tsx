'use client'

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
  TextField,
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
import databasePreloadManager from '@/lib/databasePreloadManager'
import { getPlaybackStrategy, buildVideoStreamUrl } from '@/lib/videoFormat'

// 快速评分配置
const QUICK_RATING_CONFIG = [
  { rating: 1, evaluation: '丑死了' },
  { rating: 2, evaluation: '一般' },
  { rating: 3, evaluation: '还行' },
  { rating: 4, evaluation: '非常爽' },
  { rating: 5, evaluation: '爽死了' },
] as const

interface WebDAVConfig {
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

interface MediaFile {
  filename: string
  basename: string
  size: number
  type: string
  lastmod: string
  filepath?: string // 添加可选的filepath字段
}

type MediaFilter = 'all' | 'images' | 'videos'
type ViewMode = 'random' | 'gallery' | 'large-video' // random: 随机模式, gallery: 图组模式, large-video: 大视频模式
type ViewedFilter = 'all' | 'viewed' | 'unviewed' // 已看过筛选
type MediaType = 'image' | 'small-video' | 'stream-video' // 媒体类型：图片、小视频、流式大视频

// 高级过滤条件（仅已看过模式）
interface AdvancedFilters {
  ratings: number[] // 评分星星：1-5星
  evaluations: string[] // 评价标签
  categories: string[] // 分类标签
  reasonFilter: 'all' | 'empty' | 'nonempty' | 'keyword' // 评价理由过滤
  reasonKeyword?: string // 评价理由关键词
  ratingEmptyFilter?: boolean // 星级为空筛选：undefined=不筛选, true=为空, false=不为空
  evaluationEmptyFilter?: boolean // 评价为空筛选：undefined=不筛选, true=为空, false=不为空
  categoryEmptyFilter?: boolean // 分类为空筛选：undefined=不筛选, true=为空, false=不为空
}

interface MediaGroup {
  folderPath: string
  files: MediaFile[]
}

interface MediaRating {
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}

interface GroupRating {
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
}

export default function HomePage() {
  const router = useRouter()
  // WebDAV 配置
  const [config, setConfig] = useState<WebDAVConfig | null>(null)
  // 当前显示的文件
  const [currentFile, setCurrentFile] = useState<MediaFile | null>(null)
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
  
  // 同步 viewMode 到 ref（避免闭包问题）
  useEffect(() => {
    viewModeRef.current = viewMode
  }, [viewMode])
  
  // 切换状态，防止连续快速点击
  const [isSwitching, setIsSwitching] = useState(false)
  
  // 提示消息打开状态
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  // 提示消息内容
  const [snackbarMessage, setSnackbarMessage] = useState('')
  // 提示消息严重程度
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error' | 'info' | 'warning'>('success')
  
  // 视频元素引用（普通模式，用于小视频）
  const videoRef = useRef<HTMLVideoElement>(null)
  // InstantVideoPlayer 引用（用于流式播放大视频）
  const instantVideoRef = useRef<any>(null)
  // 视频播放器容器引用（用于原生全屏 API）
  const videoPlayerContainerRef = useRef<HTMLDivElement>(null)
  // 全屏容器引用（用于在全屏模式下渲染对话框）
  const fullscreenContainerRef = useRef<HTMLDivElement>(null)
  
  // 视频播放状态保存（用于全屏切换时保持播放状态，仅图片全屏需要）
  const videoStateRef = useRef<{ currentTime: number; paused: boolean } | null>(null)
  
  // 播放意图标记（用于移动端自动播放）
  const playIntentRef = useRef(false)
  
  // 媒体类型（用于条件渲染不同的播放器）
  const [mediaType, setMediaType] = useState<MediaType>('image')
  
  // 全屏过渡遮罩（用于图片全屏切换到视频全屏时的平滑过渡）
  const [fullscreenTransitionOverlay, setFullscreenTransitionOverlay] = useState(false)
  
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

  // 页面卸载时清理所有活动的视频流
  useEffect(() => {
    const cleanupStreams = () => {
      console.log('🧹 [页面] 页面卸载，清理视频流')
      
      // 先清理本地的视频元素
      if (instantVideoRef.current) {
        const videoElement = instantVideoRef.current.getVideoElement?.()
        if (videoElement) {
          videoElement.pause()
          videoElement.src = ''
          videoElement.load()
        }
      }
      
      // 然后通知服务端清理所有活动流
      // 使用 sendBeacon 确保在页面卸载时也能发送请求
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/webdav/cleanup-streams', '')
      } else {
        // 降级方案：使用 fetch
        fetch('/api/webdav/cleanup-streams', { 
          method: 'POST',
          keepalive: true 
        }).catch(() => {})
      }
    }
    
    // 监听页面卸载事件
    window.addEventListener('beforeunload', cleanupStreams)
    // 监听页面隐藏事件（移动端切换应用时触发）
    window.addEventListener('pagehide', cleanupStreams)
    
    return () => {
      window.removeEventListener('beforeunload', cleanupStreams)
      window.removeEventListener('pagehide', cleanupStreams)
    }
  }, [])

  // 初始化 vConsole 调试工具（动态导入，避免 SSG 时报错）
  useEffect(() => {
    let vConsole: any = null
    import('vconsole').then((VConsole) => {
      vConsole = new VConsole.default()
    })
    return () => {
      if (vConsole) {
        vConsole.destroy()
      }
    }
  }, [])

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

  // 加载可用的评价标签和分类
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

  

  // 从数据库加载统计信息（不触发扫描，扫描请通过管理页面操作）
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

  // 智能预加载（大视频模式下禁用）
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


  // 随机选择一个图组
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

  // 加载图组中的指定文件
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
      
      // 清理旧的URL
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
      }
      
      setMediaUrl(url)
      
      // 设置媒体类型
      const isVideoFile = isVideo(file.filename)
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

  // 保存当前评分并切换图片
  const saveAndSwitch = async (switchCallback: () => void) => {
    console.log(`[DEBUG] saveAndSwitch 被调用, currentFile: ${currentFile?.basename}, viewMode: ${viewMode}`)
    if (isSwitching) {
      return
    }

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
      setIsSwitching(false)
    } catch (error) {
      console.error('保存评分失败:', error)
      // 即使保存失败也继续切换，避免卡住
      switchCallback()
      setIsSwitching(false)
    }
    
    // 500ms 后重置状态作为兜底策略，防止某些情况下状态未正确重置
    setTimeout(() => {
      setIsSwitching(false)
    }, 500)
  }

  // 图组模式：下一张
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

  // 图组模式：上一张
  const previousInGroup = () => {
    // 标记播放意图（图组切换也需要）
    playIntentRef.current = true
    saveAndSwitch(() => {
      if (currentGroupIndex > 0) {
        loadFileFromGroup(currentGroup, currentGroupIndex - 1)
      }
    })
  }

  // 检测是否为移动端
  const isMobile = useMemo(() => {
    if (typeof window === 'undefined') return false
    const userAgent = navigator.userAgent.toLowerCase()
    return userAgent.includes('android') || /iphone|ipad|ipod/.test(userAgent)
  }, [])

  // 外部播放器菜单状态
  const [externalPlayerAnchor, setExternalPlayerAnchor] = useState<null | HTMLElement>(null)
  const externalPlayerMenuOpen = Boolean(externalPlayerAnchor)
  // 播放方式选择状态（在视频框中央显示）
  const [showPlayModeSelector, setShowPlayModeSelector] = useState(false)

  // 使用外部播放器播放当前视频（PotPlayer/VLC）
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

  // 处理外部播放器按钮点击（PotPlayer/VLC）
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

  // 处理播放方式选择（在视频框中央的选择器）
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
      
      // 更新 URL 并重新播放
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
  }, [currentFile, config, originalStreamUrl, mediaUrl])

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
    saveAndSwitch(() => {
      loadRandomFile()
    })
  }

  const loadRandomFile = async () => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }
    
    console.log(`[DEBUG] loadRandomFile 开始，筛选条件: viewedFilter=${viewedFilter}, mediaFilter=${mediaFilter}`)
    console.log(`[DEBUG] 缓存文件数量: ${databasePreloadManager.getCachedFilepaths().length}`)
    console.log(`[DEBUG] 本地已看过文件数量: ${databasePreloadManager.getLocalViewedCount()}`)
    
    // 从预加载缓存中获取文件（缓存中的文件已经过数据库层面的 viewedFilter 和 mediaFilter 筛选）
    // 只需要排除本地已看过的文件（当前会话中看过但数据库可能还没同步的）
    const cachedFiles = databasePreloadManager.getCachedFiles()
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
      
      // 清理旧的URL
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
      }
      
      setMediaUrl(url)
      
      // 设置媒体类型
      const isVideoFile = isVideo(fileToLoad.filename)
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

  // 清理当前正在播放的流式视频，释放网络连接
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
  
  // 大视频模式：加载随机大视频文件（使用即点即播）
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

  const handleFilterChange = (event: React.MouseEvent<HTMLElement>, newFilter: MediaFilter | null) => {
    if (newFilter !== null) {
      setMediaFilter(newFilter)
      localStorage.setItem('media_filter', newFilter)
      
      // 如果当前显示的文件不符合新筛选条件，清空显示
      if (currentFile) {
        const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(currentFile.basename)
        const isVideo = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(currentFile.basename)
        
        if ((newFilter === 'images' && !isImage) || (newFilter === 'videos' && !isVideo)) {
          setCurrentFile(null)
          setMediaUrl(null)
        }
      }
    }
  }

  const handleViewedFilterChange = (event: React.MouseEvent<HTMLElement>, newFilter: ViewedFilter | null) => {
    if (newFilter !== null) {
      setViewedFilter(newFilter)
      localStorage.setItem('viewed_filter', newFilter)
      
      // 如果切换到已看过模式，清除本地已看过记录
      if (newFilter === 'viewed') {
        databasePreloadManager.clearLocalViewedFiles()
      }
      
      // 如果当前显示的文件不符合新筛选条件，清空显示
      if (currentFile) {
        // 优化：使用 currentRating?.isViewed 替代 viewedFiles.has()
        const isViewed = currentRating?.isViewed || false
        
        if ((newFilter === 'viewed' && !isViewed) || (newFilter === 'unviewed' && isViewed)) {
          setCurrentFile(null)
          setMediaUrl(null)
        }
      }
      
      // 预加载将在关闭抽屉时根据配置变化统一处理
    }
  }

  // 重新观看已看过的文件
  const restartViewedMode = async () => {
    if (!config) return
    
    // 清除本地已看过记录
    databasePreloadManager.clearLocalViewedFiles()
    
    // 清空当前显示
    setCurrentFile(null)
    setMediaUrl(null)
    
    // 重新预加载已看过的文件
    if (preloadEnabled) {
      const preloadCount = config.scanSettings?.preloadCount || 10
      
      if (viewMode === 'gallery') {
        // 图组模式：使用图组模式专用预加载，带进度回调
        await databasePreloadManager.preloadForGalleryMode(
          config, 
          [], // 数据库模式不需要文件列表
          preloadCount, 
          'viewed',
          (current, total) => {
            // 实时更新进度显示
            setCachePreloadProgress({ current, total })
          }
        )
      } else {
        // 随机模式：使用随机预加载，带进度回调
        await databasePreloadManager.refillCache(
          config, 
          [], // 数据库模式不需要文件列表
          preloadCount, 
          'viewed',
          (current, total) => {
            // 实时更新进度显示
            setCachePreloadProgress({ current, total })
          },
          preloadRandomness,
          false, // isInitialLoad
          undefined, // currentParentPath
          mediaFilter // 媒体类型筛选
        )
      }
      
      const cacheStatus = databasePreloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      // 更新进度显示
      setCachePreloadProgress({ 
        current: cacheStatus.cacheSize, 
        total: preloadCount 
      })
    }
    
    setSnackbarMessage('🔄 已重新开始观看已看过的文件')
    setSnackbarSeverity('info')
    setSnackbarOpen(true)
  }

  const isImage = (filename: string) => {
    return /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(filename)
  }

  const isVideo = (filename: string) => {
    return /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(filename)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  const getFilteredStats = () => {
    // 使用数据库统计信息
    if (mediaFilter === 'images') {
      return { total: stats.images, label: '图片' }
    } else if (mediaFilter === 'videos') {
      return { total: stats.videos, label: '视频' }
    }
    return { total: stats.total, label: '全部' }
  }

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
  
  // 进入全屏后尝试播放视频
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

  const toggleFullscreen = async () => {
    // 统一使用网页容器全屏方式（通过 CSS 实现，不使用原生全屏 API）
    setFullscreen(!fullscreen)
  }

  // 评分相关函数
  const openRatingDialog = (type: 'media' | 'group') => {
    setRatingType(type)
    setRatingDialogOpen(true)
  }

  const closeRatingDialog = () => {
    setRatingDialogOpen(false)
    // 不清空 currentRating，保持显示数据库中的实际评分状态
  }

  // 加载指定媒体文件的评分（用于图组模式）
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
    } catch (error) {
      console.error('加载媒体评分失败:', error)
      setCurrentRating(null)
    }
  }, [])

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

  // 手动评分包装函数（用于评分对话框，保存后阻止自动评分覆盖）
  const saveRatingManual = useCallback(async (data: MediaRating | GroupRating, file?: MediaFile) => {
    // 弹窗评分也使用乐观更新（如果开启）
    await saveRating(data, file, true)
    // 手动评分后标记，防止自动评分覆盖
    hasAutoRatedRef.current = true
  }, [saveRating])


  // 获取图组路径
  const getGroupPath = (filePath: string): string => {
    const lastSlashIndex = filePath.lastIndexOf('/')
    return lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '/'
  }

  // 获取图组名称
  const getGroupName = (groupPath: string): string => {
    const pathParts = groupPath.split('/').filter(part => part.length > 0)
    return pathParts.length > 0 ? pathParts[pathParts.length - 1] : '根目录'
  }

  // 快速评分函数
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
  
  // 关闭提示
  const handleCloseSnackbar = () => {
    setSnackbarOpen(false)
  }

  // 处理重新开始观看
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

  // 取消重新开始
  const handleCancelRestart = () => {
    setShowRestartDialog(false)
  }

  // 执行自动评分
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

  // 自动标记已看过
  const startAutoMarkTimer = (file?: MediaFile) => {
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

    // 根据文件类型设置不同的时间
    const isImageFile = isImage(targetFile.filename)
    const timeoutDuration = isImageFile ? 100 : 180000 // 图片100ms，视频3分钟

    const timer = setTimeout(async () => {
      await performAutoRating(targetFile)
    }, timeoutDuration)

    setAutoMarkTimer(timer)
  }

  // 停止自动标记定时器
  const stopAutoMarkTimer = () => {
    if (autoMarkTimer) {
      clearTimeout(autoMarkTimer)
      setAutoMarkTimer(null)
    }
    setViewStartTime(null)
  }

  // 视频播放进度监听（播放超过80%时自动标记）
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

  // InstantVideoPlayer 的时间更新监听（参数格式不同）
  const handleInstantVideoTimeUpdate = useCallback((currentTime: number, duration: number) => {
    // 检查 duration 是否有效
    if (!duration || !isFinite(duration)) return
    
    const progress = currentTime / duration
    // 播放超过80%时自动标记
    if (progress >= 0.8) {
      performAutoRating()
    }
  }, [performAutoRating])

  // 视频播放结束监听
  const handleVideoEnded = useCallback(() => {
    performAutoRating()
  }, [performAutoRating])

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
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [currentFile, handleQuickRate, viewMode, currentGroup])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (autoMarkTimer) {
        clearTimeout(autoMarkTimer)
      }
    }
  }, [autoMarkTimer])

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

  const filteredStats = getFilteredStats()

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
            <Tooltip title="筛选与统计">
              <IconButton onClick={toggleDrawer(true)} color="primary">
                <FilterListIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="评价与分类管理">
              <IconButton onClick={() => router.push('/manage')}>
                <ManageAccountsIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="设置">
              <IconButton onClick={() => router.push('/config')}>
                <SettingsIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {/* 主内容区 - 专注于媒体展示 */}
      <Container maxWidth="xl" sx={{ py: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {currentFile && mediaUrl && (
          <Card 
            elevation={0} 
            sx={{ 
              borderRadius: fullscreen ? 0 : 2, 
              overflow: 'hidden',
              backgroundColor: fullscreen ? '#000' : 'transparent',
              // 全屏模式样式（通过 CSS 实现，不使用原生全屏 API）
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
            <Box 
              ref={videoPlayerContainerRef}
              sx={{ 
                position: 'relative', 
                backgroundColor: '#000',
                borderRadius: fullscreen ? 0 : 2,
                overflow: 'hidden',
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
                <CardMedia
                  component="img"
                  image={mediaUrl}
                  alt={currentFile.basename}
                  sx={{
                    width: fullscreen ? 'auto' : '100%',
                    maxWidth: '100%',
                    maxHeight: fullscreen ? '100%' : 'calc(100vh - 150px)',
                    objectFit: 'contain',
                  }}
                />
              )}
              {mediaType === 'small-video' && (
                <Box
                  // 不使用 key，保持视频元素不重新创建
                  component="video"
                  ref={videoRef}
                  src={mediaUrl}
                  controls
                  autoPlay={playIntentRef.current && !videoStateRef.current} // 有播放意图时才自动播放
                  muted={true} // 始终初始静音，确保移动端兼容
                  playsInline // 重要：iOS需要这个属性
                  preload="metadata" // 预加载元数据
                  webkit-playsinline="true" // iOS Safari 需要
                  onTimeUpdate={handleVideoTimeUpdate}
                  onEnded={handleVideoEnded}
                  onLoadedMetadata={(e) => {
                    const video = e.currentTarget as HTMLVideoElement
                    console.log('[视频] onLoadedMetadata 触发, playIntent:', playIntentRef.current)
                    // 如果有播放意图，尝试播放
                    if (playIntentRef.current && !videoStateRef.current) {
                      video.play().catch(error => {
                        console.log('[视频] onLoadedMetadata 播放失败，尝试静音播放:', error)
                        // 如果播放失败，尝试静音播放
                        video.muted = true
                        video.play().then(() => {
                          console.log('[视频] 静音播放成功')
                          // 播放成功后延迟取消静音
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
                    console.log('[视频] onLoadedData 触发, playIntent:', playIntentRef.current)
                    // 如果有播放意图且视频还没播放，再次尝试
                    if (playIntentRef.current && !videoStateRef.current && video.paused) {
                      video.play().catch(error => {
                        console.log('[视频] onLoadedData 播放失败，尝试静音播放:', error)
                        video.muted = true
                        video.play().catch(err => {
                          console.error('[视频] onLoadedData 静音播放也失败:', err)
                        })
                      })
                    }
                  }}
                  onCanPlay={(e) => {
                    const video = e.currentTarget as HTMLVideoElement
                    console.log('[视频] onCanPlay 触发, playIntent:', playIntentRef.current, 'paused:', video.paused)
                    // 如果有播放意图且视频还没播放，再次尝试
                    if (playIntentRef.current && !videoStateRef.current && video.paused) {
                      video.play().catch(error => {
                        console.log('[视频] onCanPlay 播放失败，尝试静音播放:', error)
                        video.muted = true
                        video.play().catch(err => {
                          console.error('[视频] onCanPlay 静音播放也失败:', err)
                        })
                      })
                    }
                  }}
                  onPlay={() => {
                    console.log('[视频] 播放开始')
                    // 延迟重置播放意图，确保所有播放尝试都完成
                    setTimeout(() => {
                      if (playIntentRef.current) {
                        playIntentRef.current = false
                        console.log('[视频] 重置播放意图')
                      }
                    }, 1000)
                    
                    // 如果是静音状态，延迟取消静音
                    const video = videoRef.current
                    if (video?.muted) {
                      setTimeout(() => {
                        video.muted = false
                        console.log('[视频] 已取消静音')
                      }, 300)
                    }
                  }}
                  sx={{
                    width: fullscreen ? 'auto' : '100%',
                    maxWidth: '100%',
                    maxHeight: fullscreen ? '100%' : 'calc(100vh - 150px)',
                  }}
                />
              )}
              {mediaType === 'stream-video' && (
                <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
                  <InstantVideoPlayer
                    key={mediaUrl} // 使用 mediaUrl 作为 key，确保 URL 变化时重新创建实例
                    ref={instantVideoRef}
                    src={mediaUrl}
                    autoPlay={true}
                    playIntent={playIntentRef.current} // 传递播放意图，用于安卓浏览器自动播放
                    transcodeUrl={transcodeUrl || undefined} // 转码流 URL，用于自动降级
                    onTranscodeFallback={() => {
                      console.log('[大视频模式] 已降级到转码流播放')
                      setIsUsingTranscode(true)
                    }}
                    onTimeUpdate={handleInstantVideoTimeUpdate}
                    onEnded={handleVideoEnded}
                    onNext={loadRandomMedia} // 换一个按钮
                    // 不再使用 onError 回调，InstantVideoPlayer 内部已有错误 UI
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

              {/* 全屏时的 UI 覆盖层（图片和视频通用） */}
              {currentFile && fullscreen && (
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
                        left: 8,
                        top: viewMode === 'gallery' && currentGroup.length > 0 ? '65%' : '75%',
                        transform: 'translateY(-50%)',
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

                  {/* 图组模式控制按钮 */}
                  {viewMode === 'gallery' && currentGroup.length > 0 && (
                    <>
                      {/* 上一张 */}
                      {currentGroupIndex > 0 && (
                        <Tooltip title="上一张" placement="left">
                          <Fab
                            color="default"
                            onClick={previousInGroup}
                            disabled={loading || isSwitching}
                            sx={{
                              position: 'fixed',
                              bottom: 120,
                              left: 24,
                              backgroundColor: 'rgba(255, 255, 255, 0.9)',
                              zIndex: 2001,
                            }}
                          >
                            <ArrowBackIcon />
                          </Fab>
                        </Tooltip>
                      )}

                      {/* 下一张 */}
                      <Tooltip title="下一张" placement="right">
                        <Fab
                          color="default"
                          onClick={nextInGroup}
                          disabled={loading || isSwitching}
                          sx={{
                            position: 'fixed',
                            bottom: 100,
                            right: 24,
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            zIndex: 2001,
                          }}
                        >
                          <ArrowForwardIcon />
                        </Fab>
                      </Tooltip>

                      {/* 换组按钮 */}
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
                    </>
                  )}

                  {/* 右下角：换一个按钮（可拖动） */}
                  <DraggableFab
                    storageKey="fullscreen_shuffle"
                    onClick={loadRandomMedia}
                    disabled={isSwitching}
                  >
                    <ShuffleIcon />
                  </DraggableFab>

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
              
            </Box>
            
            {/* 文件信息 - 紧凑显示（全屏模式下隐藏） */}
            {!fullscreen && (
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
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={toggleDrawer(false)}
        sx={{
          '& .MuiDrawer-paper': {
            width: 320,
            boxSizing: 'border-box',
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" fontWeight="bold">
              筛选与统计
            </Typography>
            <IconButton onClick={toggleDrawer(false)} size="small">
              <CloseIcon />
            </IconButton>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* 浏览模式 */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <CollectionsIcon color="primary" />
              <Typography variant="subtitle1" fontWeight="medium">
                浏览模式
              </Typography>
            </Box>
            
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(e, newMode) => {
                if (newMode) {
                  setViewMode(newMode)
                  localStorage.setItem('view_mode', newMode)
                  
                  // 所有模式切换都先取消前一模式的预加载任务
                  if (preloadEnabled) {
                    console.log(`[模式切换] ${viewMode} → ${newMode}：取消预加载并清空缓存`)
                    databasePreloadManager.cancelAllPreloads()
                    databasePreloadManager.clearCache()
                    databasePreloadManager.clearNextGroupCache()
                    const cacheStatus = databasePreloadManager.getCacheStatus()
                    setPreloadStatus(cacheStatus)
                  }
                  
                  // 切换到图组模式时，清空当前组
                  if (newMode === 'gallery') {
                    setCurrentGroup([])
                    setCurrentGroupIndex(0)
                    setGalleryPreloadReady(false)
                    setCachePreloadProgress(null)
                  } else if (newMode === 'random') {
                    // 切换到随机模式时，允许预览（不需要等待预加载）
                    setGalleryPreloadReady(true)
                    setCachePreloadProgress(null)
                  } else if (newMode === 'large-video') {
                    // 切换到大视频模式时，不需要预加载
                    setGalleryPreloadReady(true)
                    setCachePreloadProgress(null)
                  }
                  // 预加载将在关闭抽屉时根据配置变化统一处理
                }
              }}
              orientation="vertical"
              fullWidth
            >
              <ToggleButton value="random">
                <ShuffleIcon sx={{ mr: 1 }} />
                随机模式
              </ToggleButton>
              <ToggleButton value="gallery">
                <CollectionsIcon sx={{ mr: 1 }} />
                图组模式
              </ToggleButton>
              <ToggleButton value="large-video">
                <VideoIcon sx={{ mr: 1 }} />
                大视频模式
              </ToggleButton>
            </ToggleButtonGroup>
            
            {viewMode === 'gallery' && currentGroup.length > 0 && (
              <Paper variant="outlined" sx={{ mt: 2, p: 1.5 }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  当前图组
                </Typography>
                <Typography variant="body2" fontWeight="medium">
                  {currentGroupIndex + 1} / {currentGroup.length} 张
                </Typography>
                <Typography 
                  variant="caption" 
                  color="text.secondary" 
                  sx={{ 
                    display: 'block',
                    wordBreak: 'break-all',
                    wordWrap: 'break-word',
                    overflowWrap: 'break-word',
                    whiteSpace: 'normal',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}
                >
                  {currentFile?.filename.substring(0, currentFile.filename.lastIndexOf('/'))}
                </Typography>
              </Paper>
            )}
            
            {viewMode === 'large-video' && (
              <Paper variant="outlined" sx={{ mt: 2, p: 1.5, backgroundColor: 'info.light' }}>
                <Typography variant="caption" color="info.contrastText" display="block" fontWeight="bold">
                  💡 大视频模式
                </Typography>
                <Typography variant="caption" color="info.contrastText" display="block" sx={{ mt: 0.5 }}>
                  • 即点即播，无需预加载
                </Typography>
                <Typography variant="caption" color="info.contrastText" display="block">
                  • 支持大文件流式播放
                </Typography>
                <Typography variant="caption" color="info.contrastText" display="block">
                  • 受已看过/未看过筛选影响
                </Typography>
                <Typography variant="caption" color="info.contrastText" display="block">
                  • 随机性参数控制同目录优先级
                </Typography>
              </Paper>
            )}
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* 评分功能 */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <RateReviewIcon color="primary" />
              <Typography variant="subtitle1" fontWeight="medium">
                评分管理
              </Typography>
            </Box>
            
            <Stack spacing={1}>
              <Button
                variant="outlined"
                startIcon={<StarIcon />}
                onClick={() => openRatingDialog('media')}
                disabled={!currentFile}
                fullWidth
                size="small"
              >
                详细评分
              </Button>
              
              {viewMode === 'gallery' && (
                <Button
                  variant="outlined"
                  startIcon={<CollectionsIcon />}
                  onClick={() => openRatingDialog('group')}
                  disabled={currentGroup.length === 0}
                  fullWidth
                  size="small"
                >
                  评分当前图组
                </Button>
              )}
            </Stack>
            
            {/* 快捷键说明 */}
            <Box sx={{ mt: 2, p: 1.5, backgroundColor: 'grey.50', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom fontWeight="bold">
                快捷键：
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {QUICK_RATING_CONFIG.slice(0, 3).map(config => 
                  `${config.rating}键: ${config.rating}星-${config.evaluation}`
                ).join(' | ')}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                {QUICK_RATING_CONFIG.slice(3).map(config => 
                  `${config.rating}键: ${config.rating}星-${config.evaluation}`
                ).join(' | ')}
              </Typography>
              <Typography variant="caption" color="primary.main" display="block" sx={{ mt: 1, fontWeight: 'medium' }}>
                R键: 打开详细评分对话框
              </Typography>
              <Typography variant="caption" color="secondary.main" display="block" sx={{ fontWeight: 'medium' }}>
                G键: 图组评分 (仅图组模式)
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                自动标记：图片0.5秒，视频播放80%或结束时
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                （视频超时兜底：3分钟）
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* 预加载设置 */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <SpeedIcon color="primary" />
              <Typography variant="subtitle1" fontWeight="medium">
                预加载设置
              </Typography>
            </Box>
            
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="body2">启用预加载</Typography>
                <Button
                  size="small"
                  variant={preloadEnabled ? "contained" : "outlined"}
                  onClick={() => setPreloadEnabled(!preloadEnabled)}
                >
                  {preloadEnabled ? '已启用' : '已禁用'}
                </Button>
              </Box>
              
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2">乐观更新</Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    评分立即显示，后台保存
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant={optimisticUpdateEnabled ? "contained" : "outlined"}
                  color="primary"
                  onClick={() => {
                    const newValue = !optimisticUpdateEnabled
                    setOptimisticUpdateEnabled(newValue)
                    localStorage.setItem('optimistic_update_enabled', newValue.toString())
                  }}
                >
                  {optimisticUpdateEnabled ? '已启用' : '已禁用'}
                </Button>
              </Box>
              
              {/* 智能预加载随机性设置 */}
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="body2">预加载随机性</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {preloadRandomness === 0 ? '优先当前目录' : preloadRandomness === 1 ? '完全随机' : `${Math.round(preloadRandomness * 100)}%随机`}
                  </Typography>
                </Box>
                <Slider
                  value={preloadRandomness}
                  onChange={(_, newValue) => {
                    const value = Array.isArray(newValue) ? newValue[0] : newValue
                    setPreloadRandomness(value)
                    localStorage.setItem('preload_randomness', value.toString())
                  }}
                  min={0}
                  max={1}
                  step={0.01}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${Math.round(value * 100)}%`}
                  sx={{ mt: 1 }}
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  值越小出现同一个人的概率越大，值越大出现同一个人概率越小
                </Typography>
              </Box>
              
              {preloadStatus && (
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    缓存状态
                  </Typography>
                  <Typography variant="body2" fontWeight="medium">
                    {preloadStatus.cacheSize} / {preloadStatus.maxCacheSize} 个文件
                  </Typography>
                </Paper>
              )}
              
              <Button
                variant="outlined"
                size="small"
                fullWidth
                onClick={() => {
                  databasePreloadManager.clearCache()
                  setPreloadStatus(databasePreloadManager.getCacheStatus())
                  setSnackbarMessage('缓存已清理')
                  setSnackbarSeverity('info')
                  setSnackbarOpen(true)
                }}
                startIcon={<DownloadIcon />}
              >
                清理缓存
              </Button>
            </Stack>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* 已看过筛选 */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <StarIcon color="primary" />
              <Typography variant="subtitle1" fontWeight="medium">
                已看过状态
              </Typography>
            </Box>
            
            <ToggleButtonGroup
              value={viewedFilter}
              exclusive
              onChange={handleViewedFilterChange}
              orientation="vertical"
              fullWidth
            >
              <ToggleButton value="unviewed">
                <StarIcon sx={{ mr: 1 }} />
                未看过 ({stats.total - stats.viewed})
              </ToggleButton>
              <ToggleButton value="viewed">
                <StarIcon sx={{ mr: 1, color: 'gold' }} />
                已看过 ({stats.viewed})
              </ToggleButton>
              <ToggleButton value="all">
                <PhotoLibraryIcon sx={{ mr: 1 }} />
                全部 ({stats.total})
              </ToggleButton>
            </ToggleButtonGroup>
            
            {/* 已看过模式下的重新观看按钮 */}
            {viewedFilter === 'viewed' && (
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="outlined"
                  size="small"
                  fullWidth
                  onClick={restartViewedMode}
                  startIcon={<RefreshIcon />}
                  sx={{ 
                    backgroundColor: 'warning.light',
                    color: 'warning.contrastText',
                    '&:hover': {
                      backgroundColor: 'warning.main',
                    }
                  }}
                >
                  重新观看已看过的文件
                </Button>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, textAlign: 'center' }}>
                  已本地观看: {databasePreloadManager.getLocalViewedCount()} / {stats.viewed}
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* 高级过滤条件（仅已看过模式且非图组模式） */}
          {viewedFilter === 'viewed' && viewMode !== 'gallery' && (
            <>
              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <FilterListIcon color="primary" />
                  <Typography variant="subtitle1" fontWeight="medium">
                    高级过滤
                  </Typography>
                </Box>

                {/* 评分星星过滤 */}
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    评分星星
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <Chip
                        key={rating}
                        label={`${rating}星`}
                        icon={<StarIcon />}
                        onClick={() => {
                          setAdvancedFilters(prev => ({
                            ...prev,
                            ratings: prev.ratings.includes(rating)
                              ? prev.ratings.filter(r => r !== rating)
                              : [...prev.ratings, rating]
                          }))
                        }}
                        color={advancedFilters.ratings.includes(rating) ? 'primary' : 'default'}
                        variant={advancedFilters.ratings.includes(rating) ? 'filled' : 'outlined'}
                        size="small"
                      />
                    ))}
                    <Chip
                      label="为空"
                      onClick={() => {
                        setAdvancedFilters(prev => ({
                          ...prev,
                          ratingEmptyFilter: prev.ratingEmptyFilter === true ? undefined : true
                        }))
                      }}
                      color={advancedFilters.ratingEmptyFilter === true ? 'primary' : 'default'}
                      variant={advancedFilters.ratingEmptyFilter === true ? 'filled' : 'outlined'}
                      size="small"
                    />
                    <Chip
                      label="不为空"
                      onClick={() => {
                        setAdvancedFilters(prev => ({
                          ...prev,
                          ratingEmptyFilter: prev.ratingEmptyFilter === false ? undefined : false
                        }))
                      }}
                      color={advancedFilters.ratingEmptyFilter === false ? 'primary' : 'default'}
                      variant={advancedFilters.ratingEmptyFilter === false ? 'filled' : 'outlined'}
                      size="small"
                    />
                  </Box>
                  {(advancedFilters.ratings.length > 0 || advancedFilters.ratingEmptyFilter !== undefined) && (
                    <Button
                      size="small"
                      onClick={() => setAdvancedFilters(prev => ({ ...prev, ratings: [], ratingEmptyFilter: undefined }))}
                      sx={{ mt: 0.5 }}
                    >
                      清除
                    </Button>
                  )}
                </Box>

                {/* 评价标签过滤 */}
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    评价标签
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {availableEvaluations.map((evaluation) => (
                      <Chip
                        key={evaluation}
                        label={evaluation}
                        onClick={() => {
                          setAdvancedFilters(prev => ({
                            ...prev,
                            evaluations: prev.evaluations.includes(evaluation)
                              ? prev.evaluations.filter(e => e !== evaluation)
                              : [...prev.evaluations, evaluation]
                          }))
                        }}
                        color={advancedFilters.evaluations.includes(evaluation) ? 'secondary' : 'default'}
                        variant={advancedFilters.evaluations.includes(evaluation) ? 'filled' : 'outlined'}
                        size="small"
                      />
                    ))}
                    <Chip
                      label="为空"
                      onClick={() => {
                        setAdvancedFilters(prev => ({
                          ...prev,
                          evaluationEmptyFilter: prev.evaluationEmptyFilter === true ? undefined : true
                        }))
                      }}
                      color={advancedFilters.evaluationEmptyFilter === true ? 'secondary' : 'default'}
                      variant={advancedFilters.evaluationEmptyFilter === true ? 'filled' : 'outlined'}
                      size="small"
                    />
                    <Chip
                      label="不为空"
                      onClick={() => {
                        setAdvancedFilters(prev => ({
                          ...prev,
                          evaluationEmptyFilter: prev.evaluationEmptyFilter === false ? undefined : false
                        }))
                      }}
                      color={advancedFilters.evaluationEmptyFilter === false ? 'secondary' : 'default'}
                      variant={advancedFilters.evaluationEmptyFilter === false ? 'filled' : 'outlined'}
                      size="small"
                    />
                  </Box>
                  {availableEvaluations.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      暂无评价标签
                    </Typography>
                  )}
                  {(advancedFilters.evaluations.length > 0 || advancedFilters.evaluationEmptyFilter !== undefined) && (
                    <Button
                      size="small"
                      onClick={() => setAdvancedFilters(prev => ({ ...prev, evaluations: [], evaluationEmptyFilter: undefined }))}
                      sx={{ mt: 0.5 }}
                    >
                      清除
                    </Button>
                  )}
                </Box>

                {/* 分类标签过滤 */}
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    分类标签
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {availableCategories.map((category) => (
                      <Chip
                        key={category}
                        label={category}
                        onClick={() => {
                          setAdvancedFilters(prev => ({
                            ...prev,
                            categories: prev.categories.includes(category)
                              ? prev.categories.filter(c => c !== category)
                              : [...prev.categories, category]
                          }))
                        }}
                        color={advancedFilters.categories.includes(category) ? 'success' : 'default'}
                        variant={advancedFilters.categories.includes(category) ? 'filled' : 'outlined'}
                        size="small"
                      />
                    ))}
                    <Chip
                      label="为空"
                      onClick={() => {
                        setAdvancedFilters(prev => ({
                          ...prev,
                          categoryEmptyFilter: prev.categoryEmptyFilter === true ? undefined : true
                        }))
                      }}
                      color={advancedFilters.categoryEmptyFilter === true ? 'success' : 'default'}
                      variant={advancedFilters.categoryEmptyFilter === true ? 'filled' : 'outlined'}
                      size="small"
                    />
                    <Chip
                      label="不为空"
                      onClick={() => {
                        setAdvancedFilters(prev => ({
                          ...prev,
                          categoryEmptyFilter: prev.categoryEmptyFilter === false ? undefined : false
                        }))
                      }}
                      color={advancedFilters.categoryEmptyFilter === false ? 'success' : 'default'}
                      variant={advancedFilters.categoryEmptyFilter === false ? 'filled' : 'outlined'}
                      size="small"
                    />
                  </Box>
                  {availableCategories.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      暂无分类标签
                    </Typography>
                  )}
                  {(advancedFilters.categories.length > 0 || advancedFilters.categoryEmptyFilter !== undefined) && (
                    <Button
                      size="small"
                      onClick={() => setAdvancedFilters(prev => ({ ...prev, categories: [], categoryEmptyFilter: undefined }))}
                      sx={{ mt: 0.5 }}
                    >
                      清除
                    </Button>
                  )}
                </Box>

                {/* 评价理由过滤 */}
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    评价理由
                  </Typography>
                  <ToggleButtonGroup
                    value={advancedFilters.reasonFilter}
                    exclusive
                    onChange={(e, newValue) => {
                      if (newValue) {
                        setAdvancedFilters(prev => ({ ...prev, reasonFilter: newValue }))
                      }
                    }}
                    size="small"
                    fullWidth
                    sx={{ mb: 1 }}
                  >
                    <ToggleButton value="all">全部</ToggleButton>
                    <ToggleButton value="empty">为空</ToggleButton>
                    <ToggleButton value="nonempty">不为空</ToggleButton>
                    <ToggleButton value="keyword">关键词</ToggleButton>
                  </ToggleButtonGroup>
                  {advancedFilters.reasonFilter === 'keyword' && (
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="输入关键词"
                      value={advancedFilters.reasonKeyword || ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        setAdvancedFilters(prev => ({ ...prev, reasonKeyword: e.target.value }))
                      }}
                    />
                  )}
                </Box>

                {/* 清除所有过滤 */}
                {(advancedFilters.ratings.length > 0 || 
                  advancedFilters.evaluations.length > 0 || 
                  advancedFilters.categories.length > 0 || 
                  advancedFilters.ratingEmptyFilter !== undefined ||
                  advancedFilters.evaluationEmptyFilter !== undefined ||
                  advancedFilters.categoryEmptyFilter !== undefined ||
                  advancedFilters.reasonFilter !== 'all') && (
                  <Button
                    variant="outlined"
                    size="small"
                    fullWidth
                    onClick={() => {
                      setAdvancedFilters({
                        ratings: [],
                        evaluations: [],
                        categories: [],
                        reasonFilter: 'all',
                        reasonKeyword: '',
                        ratingEmptyFilter: undefined,
                        evaluationEmptyFilter: undefined,
                        categoryEmptyFilter: undefined
                      })
                    }}
                    startIcon={<CloseIcon />}
                  >
                    清除所有过滤
                  </Button>
                )}
              </Box>

              <Divider sx={{ mb: 3 }} />
            </>
          )}

          {/* 媒体类型筛选 */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <FilterListIcon color="primary" />
              <Typography variant="subtitle1" fontWeight="medium">
                媒体类型
              </Typography>
            </Box>
            
            <ToggleButtonGroup
              value={mediaFilter}
              exclusive
              onChange={handleFilterChange}
              orientation="vertical"
              fullWidth
            >
              <ToggleButton value="all">
                <PhotoLibraryIcon sx={{ mr: 1 }} />
                全部 ({stats.total})
              </ToggleButton>
              <ToggleButton value="images">
                <ImageIcon sx={{ mr: 1 }} />
                仅图片 ({stats.images})
              </ToggleButton>
              <ToggleButton value="videos">
                <VideoIcon sx={{ mr: 1 }} />
                仅视频 ({stats.videos})
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* 统计信息 */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <BarChartIcon color="primary" />
              <Typography variant="subtitle1" fontWeight="medium">
                文件统计
              </Typography>
            </Box>

            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <ImageIcon color="primary" sx={{ fontSize: 32 }} />
                  <Box>
                    <Typography variant="h6">{stats.images}</Typography>
                    <Typography variant="body2" color="text.secondary">图片</Typography>
                  </Box>
                </Box>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <VideoIcon color="secondary" sx={{ fontSize: 32 }} />
                  <Box>
                    <Typography variant="h6">{stats.videos}</Typography>
                    <Typography variant="body2" color="text.secondary">视频</Typography>
                  </Box>
                </Box>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <PhotoLibraryIcon sx={{ fontSize: 32 }} />
                  <Box>
                    <Typography variant="h6">{stats.total}</Typography>
                    <Typography variant="body2" color="text.secondary">总计</Typography>
                  </Box>
                </Box>
              </Paper>
            </Stack>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* 已挂载目录 */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <FolderIcon color="primary" />
              <Typography variant="subtitle1" fontWeight="medium">
                已挂载目录
              </Typography>
              <Chip label={config.mediaPaths.length} size="small" color="primary" />
            </Box>

            <List dense>
              {config.mediaPaths.map((path, index) => (
                <ListItem key={index} sx={{ px: 0 }}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <FolderIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText 
                    primary={path}
                    primaryTypographyProps={{
                      variant: 'body2',
                      noWrap: true,
                    }}
                  />
                </ListItem>
              ))}
            </List>

            {/* 重新扫描按钮 - 跳转到管理页面 */}
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                size="small"
                fullWidth
                onClick={() => router.push('/manage')}
                disabled={loading || isSwitching}
                startIcon={<RefreshIcon />}
              >
                前往管理页面扫描
              </Button>
            </Box>
          </Box>
        </Box>
      </Drawer>

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

      {/* 评分对话框 */}
      <RatingDialog
        open={ratingDialogOpen}
        onClose={closeRatingDialog}
        onSave={saveRatingManual}
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
