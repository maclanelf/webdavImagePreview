'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
} from '@mui/icons-material'
import { useRouter } from 'next/navigation'
import RatingDialog from '@/components/RatingDialog'
import RatingStatus from '@/components/RatingStatus'
import QuickRating from '@/components/QuickRating'
// 适用于全屏的评分组件可拖拽
import DraggableBox from '@/components/DraggableBox'
// 适用于全屏模式换一个按钮,非全屏模式换一个按钮可拖拽
import DraggableFab from '@/components/DraggableFab'
import preloadManager from '@/lib/preloadManager'

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
  scanSettings?: {
    batchSize?: number
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
type ViewMode = 'random' | 'gallery' // random: 随机模式, gallery: 图组模式
type ViewedFilter = 'all' | 'viewed' | 'unviewed' // 已看过筛选

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
  const [config, setConfig] = useState<WebDAVConfig | null>(null)
  const [currentFile, setCurrentFile] = useState<MediaFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [stats, setStats] = useState({ total: 0, images: 0, videos: 0 })
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const [viewedFilter, setViewedFilter] = useState<ViewedFilter>('unviewed') // 默认只显示未看过的
  const [allFiles, setAllFiles] = useState<MediaFile[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('random')
  
  // 用于追踪配置变化，只在关闭抽屉时检查是否需要重新加载
  const configSnapshotRef = useRef<{ mediaFilter: MediaFilter, viewedFilter: ViewedFilter, viewMode: ViewMode } | null>(null)
  const [currentGroup, setCurrentGroup] = useState<MediaFile[]>([])
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0)
  const [scanProgress, setScanProgress] = useState<{ currentPath: string, fileCount: number } | null>(null)
  
  // 预加载相关状态
  const [preloadEnabled, setPreloadEnabled] = useState(true)
  const [preloadProgress, setPreloadProgress] = useState<{ current: number, total: number, message: string } | null>(null)  // 设置预加载数量
  const [preloadStatus, setPreloadStatus] = useState<{ cacheSize: number, maxCacheSize: number } | null>(null)
  
  // 缓存预加载进度状态（图组模式和随机模式都使用）
  const [cachePreloadProgress, setCachePreloadProgress] = useState<{ current: number, total: number } | null>(null)

  // 图组模式初始预加载状态（必须完成才能预览）
  const [galleryPreloadReady, setGalleryPreloadReady] = useState(false) // 图组模式预加载是否完成
  
  // 智能预加载随机性（0-1，0表示优先当前目录，1表示完全随机）
  const [preloadRandomness, setPreloadRandomness] = useState(0)
  
  // 扫描状态相关状态
  const [scanStatus, setScanStatus] = useState<{ 
    scannedPaths: string[], 
    pendingPaths: string[], 
    totalScanned: number, 
    totalPending: number 
  } | null>(null)
  
  // 已看过文件状态
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set())
  
  // 评分相关状态
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false)
  const [currentRating, setCurrentRating] = useState<MediaRating | GroupRating | null>(null)
  const [ratingType, setRatingType] = useState<'media' | 'group'>('media')
  
  // 自动标记已看过相关状态
  const [viewStartTime, setViewStartTime] = useState<number | null>(null)
  const [autoMarkTimer, setAutoMarkTimer] = useState<NodeJS.Timeout | null>(null)
  const hasAutoRatedRef = useRef(false) // 使用 ref 避免闭包陷阱,追踪当前文件是否已自动评分
  const initialPreloadTriggeredRef = useRef(false) // 追踪初始预加载是否已触发
  
  // 切换状态，防止连续快速点击
  const [isSwitching, setIsSwitching] = useState(false)
  
  // 提示消息相关状态
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error' | 'info'>('success')
  
  // 视频元素引用
  const videoRef = useRef<HTMLVideoElement>(null)
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null)
  
  // 视频播放状态保存（用于全屏切换时保持播放状态）
  const videoStateRef = useRef<{ currentTime: number; paused: boolean } | null>(null)
  

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
              scanSettings: dbConfig.scanSettings || {
                batchSize: 10,
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
                    batchSize: 10,
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
    if (savedViewMode && (savedViewMode === 'random' || savedViewMode === 'gallery')) {
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

    // 加载已看过文件列表
    loadViewedFiles()
  }, [])

  // 当文件列表和已看过文件都加载完成后，触发初始预加载
  // 注意：配置变化时的预加载由 toggleDrawer 处理
  useEffect(() => {
    if (allFiles.length > 0 && viewedFiles.size >= 0 && preloadEnabled && config && !initialPreloadTriggeredRef.current) {
      initialPreloadTriggeredRef.current = true
      const preloadCount = config.scanSettings?.preloadCount || 10
      
      if (viewMode === 'gallery') {
        // 图组模式：重置预加载状态
        setGalleryPreloadReady(false)
        setCachePreloadProgress({ current: 0, total: preloadCount })
        
        // 使用图组模式专用预加载，带进度回调
        preloadManager.preloadForGalleryMode(
          config, 
          allFiles, 
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
          const cacheStatus = preloadManager.getCacheStatus()
          setPreloadStatus(cacheStatus)
          setGalleryPreloadReady(true)
          // 保持显示进度，基于当前缓存状态
          setCachePreloadProgress({ 
            current: cacheStatus.cacheSize, 
            total: preloadCount 
          })
          console.log(`图组模式初始预加载完成: ${result.message}`)
        }).catch(error => {
          console.warn('图组模式初始预加载失败:', error)
          setGalleryPreloadReady(true) // 即使失败也允许预览
          const cacheStatus = preloadManager.getCacheStatus()
          // 即使失败也显示当前缓存状态
          setCachePreloadProgress({ 
            current: cacheStatus.cacheSize, 
            total: preloadCount 
          })
        })
      } else {
        // 随机模式：初始化进度显示
        setGalleryPreloadReady(true) // 随机模式不需要等待预加载完成
        setCachePreloadProgress({ current: 0, total: preloadCount })
        
        preloadManager.refillCache(
          config, 
          allFiles, 
          preloadCount, 
          viewedFilter,
          (current, total) => {
            // 实时更新进度显示
            setCachePreloadProgress({ current, total })
          },
          preloadRandomness
        ).then(() => {
          const cacheStatus = preloadManager.getCacheStatus()
          setPreloadStatus(cacheStatus)
          // 更新进度显示
          setCachePreloadProgress({ 
            current: cacheStatus.cacheSize, 
            total: preloadCount 
          })
          console.log(`随机模式初始预加载完成，筛选条件: ${viewedFilter}`)
        }).catch(error => {
          console.warn('随机模式初始预加载失败:', error)
          const cacheStatus = preloadManager.getCacheStatus()
          // 即使失败也显示当前缓存状态
          setCachePreloadProgress({ 
            current: cacheStatus.cacheSize, 
            total: preloadCount 
          })
        })
      }
    }
  }, [allFiles.length, viewedFiles.size, preloadEnabled, config, viewMode, viewedFilter])

  // 监听缓存状态变化，自动更新进度显示（图组模式和随机模式都支持）
  useEffect(() => {
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
  }, [preloadStatus?.cacheSize, preloadEnabled, config])

  

  // 加载已看过文件列表
  const loadViewedFiles = async () => {
    try {
      const response = await fetch('/api/ratings/viewed?viewed=true')
      if (response.ok) {
        const data = await response.json()
        setViewedFiles(new Set(data.filePaths))
        console.log(`加载已看过文件: ${data.count} 个`)
      }
    } catch (error) {
      console.error('加载已看过文件失败:', error)
    }
  }

  const loadStatsFromCache = async (cfg: WebDAVConfig) => {
    setLoading(true)
    setError(null)
    
    try {
      // 首先尝试从缓存获取统计信息
      const response = await fetch(`/api/scan-cache?webdavUrl=${encodeURIComponent(cfg.url)}&webdavUsername=${encodeURIComponent(cfg.username)}&webdavPassword=${encodeURIComponent(cfg.password)}`)
      
      if (response.ok) {
        const data = await response.json()
        const pathStats = data.pathStats || {}
        
        // 检查是否有缓存数据
        const hasCacheData = Object.keys(pathStats).length > 0
        
        if (hasCacheData) {
          // 计算总统计
          let totalFiles = 0
          let totalImages = 0
          let totalVideos = 0
          
          for (const path of cfg.mediaPaths) {
            const stats = pathStats[path]
            if (stats) {
              totalFiles += stats.total || 0
              totalImages += stats.images || 0
              totalVideos += stats.videos || 0
            }
          }
          
          setStats({
            total: totalFiles,
            images: totalImages,
            videos: totalVideos
          })
          
          // 如果有缓存数据，使用增量加载
          await loadStatsIncremental(cfg)
          return
        }
      }
      
      // 如果没有缓存数据，进行首次扫描
      await loadStats(cfg, false)
      
    } catch (error: any) {
      console.error('从缓存加载失败:', error)
      // 如果缓存加载失败，回退到正常扫描
      await loadStats(cfg, false)
    } finally {
      // 确保loading状态被正确设置
      setLoading(false)
    }
  }

  // 增量加载统计信息
  const loadStatsIncremental = async (cfg: WebDAVConfig) => {
    try {
      // 使用增量模式加载文件列表
      const response = await fetch('/api/webdav/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cfg,
          incremental: true, // 启用增量模式
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '获取文件列表失败')
      }

      const data = await response.json()
      const files = data.files || []
      setAllFiles(files)
      
      const imageCount = files.filter((f: MediaFile) => 
        /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename)
      ).length
      
      const videoCount = files.filter((f: MediaFile) => 
        /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename)
      ).length

      setStats({
        total: files.length,
        images: imageCount,
        videos: videoCount,
      })
      
      // 显示缓存状态
      if (data.fromCache) {
        console.log('从缓存加载文件列表')
      }
      
      // 如果有待扫描的路径，启动后台扫描
      if (data.pendingPaths && data.pendingPaths.length > 0) {
        console.log('启动后台扫描:', data.pendingPaths)
        startBackgroundScan(cfg, data.pendingPaths)
      }
      
      // 预加载将在第二个useEffect中根据viewMode统一处理
    } catch (e: any) {
      console.error('增量加载失败:', e)
      // 如果增量加载失败，回退到正常加载
      await loadStats(cfg, false)
    }
  }

  // 启动后台扫描
  const startBackgroundScan = async (cfg: WebDAVConfig, pendingPaths: string[]) => {
    try {
      const response = await fetch('/api/webdav/background-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cfg,
          mediaPaths: pendingPaths,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        console.log('后台扫描状态:', data.message)
        
        // 如果任务已经在运行，显示相应提示
        if (data.taskRunning) {
          setSnackbarMessage(`🔄 扫描任务正在进行中：${pendingPaths.length} 个目录`)
          setSnackbarSeverity('info')
          setSnackbarOpen(true)
        } else if (data.scanStarted) {
          setSnackbarMessage(`🚀 后台扫描已启动：${pendingPaths.length} 个目录`)
          setSnackbarSeverity('info')
          setSnackbarOpen(true)
        }
        
        // 定期检查扫描状态
        checkScanStatus(cfg)
      }
    } catch (error) {
      console.error('启动后台扫描失败:', error)
    }
  }

  // 检查扫描状态
  const checkScanStatus = async (cfg: WebDAVConfig) => {
    try {
      const response = await fetch(`/api/webdav/background-scan?url=${encodeURIComponent(cfg.url)}&username=${encodeURIComponent(cfg.username)}&password=${encodeURIComponent(cfg.password)}&mediaPaths=${cfg.mediaPaths.join(',')}`)
      
      if (response.ok) {
        const data = await response.json()
        
        // 更新扫描状态
        setScanStatus({
          scannedPaths: data.scannedPaths || [],
          pendingPaths: data.pendingPaths || [],
          totalScanned: data.totalScanned || 0,
          totalPending: data.totalPending || 0
        })
        
        // 如果还有待扫描的路径，继续检查
        if (data.totalPending > 0) {
          setTimeout(() => checkScanStatus(cfg), 5000) // 5秒后再次检查
        } else {
          // 所有扫描完成，刷新数据
          console.log('所有扫描完成，刷新数据')
          await loadStatsIncremental(cfg)
          
          setSnackbarMessage('✅ 所有目录扫描完成')
          setSnackbarSeverity('success')
          setSnackbarOpen(true)
          
          // 清除扫描状态
          setScanStatus(null)
        }
      }
    } catch (error) {
      console.error('检查扫描状态失败:', error)
    }
  }

  const loadStats = async (cfg: WebDAVConfig, forceRescan = false) => {
    setLoading(true)
    
    // 如果是强制重新扫描，清除已观看记录
    if (forceRescan) {
      preloadManager.clearViewedFiles()
      console.log('已清除观看记录')
    }
    
    // 只有在强制重新扫描时才显示扫描进度
    if (forceRescan) {
      setScanProgress({ currentPath: '开始扫描...', fileCount: 0 })
    }
    
    try {
      const response = await fetch('/api/webdav/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cfg,
          forceRescan,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '获取文件列表失败')
      }

      const data = await response.json()
      const files = data.files || []
      setAllFiles(files)
      
      const imageCount = files.filter((f: MediaFile) => 
        /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename)
      ).length
      
      const videoCount = files.filter((f: MediaFile) => 
        /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename)
      ).length

      setStats({
        total: files.length,
        images: imageCount,
        videos: videoCount,
      })
      
      // 只有在强制重新扫描时才清理扫描进度
      if (forceRescan) {
        setScanProgress(null)
      }
      
      // 显示缓存状态
      if (data.fromCache) {
        console.log('从缓存加载文件列表')
      } else {
        console.log('重新扫描完成')
      }

      // 预加载将在第二个useEffect中根据viewMode统一处理
    } catch (e: any) {
      console.error('加载统计信息失败:', e)
      setError(`加载统计信息失败: ${e.message}`)
      // 只有在强制重新扫描时才清理扫描进度
      if (forceRescan) {
        setScanProgress(null)
      }
    } finally {
      setLoading(false)
    }
  }

  // 开始预加载
  const startPreload = async (cfg: WebDAVConfig, files: MediaFile[]) => {
    if (!preloadEnabled) return

    // 从配置中获取预加载数量，默认为10
    const preloadCount = cfg.scanSettings?.preloadCount || 10
    setPreloadProgress({ current: 0, total: preloadCount, message: '开始预加载...' })
    
    // 设置预加载管理器缓存大小
    preloadManager.setMaxCacheSize(preloadCount)
    
    try {
      const result = await preloadManager.preloadFiles(cfg, files, preloadCount, viewedFilter)
      
      setPreloadProgress(null)
      setPreloadStatus(preloadManager.getCacheStatus())
      
      console.log('预加载完成:', result.message)
      
      // 显示预加载成功提示
      setSnackbarMessage(`🚀 预加载完成：${result.successCount} 个文件已缓存`)
      setSnackbarSeverity('success')
      setSnackbarOpen(true)
      
    } catch (error: any) {
      console.error('预加载失败:', error)
      setPreloadProgress(null)
      
      setSnackbarMessage('❌ 预加载失败，将使用正常加载模式')
      setSnackbarSeverity('error')
      setSnackbarOpen(true)
    }
  }

  // 智能预加载
  const smartPreload = async (currentFile: MediaFile) => {
    if (!preloadEnabled || !config) return

    try {
      // 从配置中获取预加载数量，默认为10
      const preloadCount = config.scanSettings?.preloadCount || 10
      await preloadManager.smartPreload(config, allFiles, currentFile, preloadCount, viewedFilter, preloadRandomness)
      setPreloadStatus(preloadManager.getCacheStatus())
    } catch (error) {
      console.error('智能预加载失败:', error)
    }
  }

  // 为图组模式重新加载缓存
  const reloadCacheForGalleryMode = async () => {
    if (!preloadEnabled || !config) return

    const preloadCount = config.scanSettings?.preloadCount || 10
    
    try {
      console.log('[DEBUG] 图组模式：清除现有缓存并重新加载')
      
      // 重置预加载状态
      setGalleryPreloadReady(false)
      setCachePreloadProgress({ current: 0, total: preloadCount })
      
      // 使用预加载管理器的图组模式优化方法，带进度回调
      const result = await preloadManager.preloadForGalleryMode(
        config, 
        allFiles, 
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
      )
      
      const cacheStatus = preloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      setGalleryPreloadReady(true)
      // 保持显示进度，基于当前缓存状态
      setCachePreloadProgress({ 
        current: cacheStatus.cacheSize, 
        total: preloadCount 
      })
      console.log(`[DEBUG] 图组模式：缓存重新加载完成 - ${result.message}`)
    } catch (error) {
      console.error('图组模式缓存重新加载失败:', error)
      setGalleryPreloadReady(true) // 即使失败也允许预览
      const cacheStatus = preloadManager.getCacheStatus()
      // 即使失败也显示当前缓存状态
      setCachePreloadProgress({ 
        current: cacheStatus.cacheSize, 
        total: preloadCount 
      })
    }
  }

  // 标记当前文件为已观看并从缓存中移除，然后补齐缓存（后台异步进行）
  const markFileAsViewedAndRefill = async (file: MediaFile) => {
    if (!preloadEnabled || !config) return

    try {
      // 在已看过模式下，使用本地管理，不向数据库同步
      if (viewedFilter === 'viewed') {
        
        console.log(`已标记为本地观看: ${file.basename}，开始补齐缓存`)
        
        // 更新缓存状态（立即更新UI）
        setPreloadStatus(preloadManager.getCacheStatus())
        
        // 检查是否所有已看过的文件都已看过
        const totalViewedFiles = allFiles.filter(f => viewedFiles.has(f.filename)).length
        const localViewedCount = preloadManager.getLocalViewedCount()
        
        if (localViewedCount >= totalViewedFiles) {
          console.log('所有已看过的文件都已看过，提示用户重新观看')
          setSnackbarMessage('🎉 所有已看过的文件都已看完！点击"重新观看"按钮重新开始')
          setSnackbarSeverity('success')
          setSnackbarOpen(true)
          return
        }
        
        // 后台异步补齐缓存
        const preloadCount = config.scanSettings?.preloadCount || 10
        
        // 更新进度显示（显示当前缓存状态）
        const cacheStatusBefore = preloadManager.getCacheStatus()
        setPreloadStatus(cacheStatusBefore)
        setCachePreloadProgress({ 
          current: cacheStatusBefore.cacheSize, 
          total: preloadCount 
        })
        
        await preloadManager.refillCache(
          config, 
          allFiles, 
          preloadCount, 
          viewedFilter,
          (current, total) => {
            // 实时更新进度显示
            setCachePreloadProgress({ current, total })
          },
          preloadRandomness
        )
        
        // 补齐完成后再次更新状态
        const cacheStatusAfter = preloadManager.getCacheStatus()
        setPreloadStatus(cacheStatusAfter)
        // 更新进度显示
        setCachePreloadProgress({ 
          current: cacheStatusAfter.cacheSize, 
          total: preloadCount 
        })
        console.log(`缓存补齐完成: ${file.basename}`)
        
      } else {
        // 其他模式使用原有逻辑, 此处与调用markFileAsViewedAndRefill的saveAndSwitch有略微的冲突,因为saveAndSwitch方法中有自动评分,自动评分会把记录标记为已看过
        await preloadManager.markAsViewed(file.filename)
        
        // 更新本地状态
        setViewedFiles(prev => new Set([...prev, file.filename]))
        
        console.log(`已标记为观看: ${file.basename}，开始后台补齐缓存`)
        
        // 更新缓存状态（立即更新UI）
        const cacheStatusBefore = preloadManager.getCacheStatus()
        setPreloadStatus(cacheStatusBefore)
        
        // 更新进度显示（图组模式和随机模式都支持）
        const preloadCount = config.scanSettings?.preloadCount || 10
        setCachePreloadProgress({ 
          current: cacheStatusBefore.cacheSize, 
          total: preloadCount 
        })
        
        // 后台异步补齐缓存,这里不需要考虑图组模式,只有随机模式,图组模式使用另一套剩余文件预加载模式
        // 随机模式：使用随机预加载，带进度回调
        await preloadManager.refillCache(
          config, 
          allFiles, 
          preloadCount, 
          viewedFilter,
          (current, total) => {
            // 实时更新进度显示
            setCachePreloadProgress({ current, total })
          },
          preloadRandomness
        )
        
        // 补齐完成后再次更新状态
        const cacheStatusAfter = preloadManager.getCacheStatus()
        setPreloadStatus(cacheStatusAfter)
        
        // 更新进度显示（图组模式和随机模式都支持）
        setCachePreloadProgress({ 
          current: cacheStatusAfter.cacheSize, 
          total: preloadCount 
        })
        console.log(`缓存补齐完成: ${file.basename}`)
        
        // 检查缓存是否为空，如果为空则重新预加载
        const cachedFilepaths = preloadManager.getCachedFilepaths()
        if (cachedFilepaths.length === 0) {
          console.log('缓存为空，重新启动预加载')
          await startPreload(config, allFiles)
        }
      }
    } catch (error) {
      console.error('标记已观看失败:', error)
    }
  }

  const getFilteredFiles = () => {
    let filtered = allFiles

    // 按媒体类型筛选
    if (mediaFilter === 'images') {
      filtered = filtered.filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename))
    } else if (mediaFilter === 'videos') {
      filtered = filtered.filter(f => /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename))
    }

    // 按已看过状态筛选
    if (viewedFilter === 'viewed') {
      filtered = filtered.filter(f => viewedFiles.has(f.filename))
    } else if (viewedFilter === 'unviewed') {
      filtered = filtered.filter(f => !viewedFiles.has(f.filename))
    }
    // viewedFilter === 'all' 时不进行筛选

    return filtered
  }

  // 按文件夹分组
  const groupFilesByFolder = (files: MediaFile[]): MediaGroup[] => {
    const groups = new Map<string, MediaFile[]>()
    
    files.forEach(file => {
      // 获取文件所在文件夹路径
      const folderPath = file.filename.substring(0, file.filename.lastIndexOf('/'))
      
      if (!groups.has(folderPath)) {
        groups.set(folderPath, [])
      }
      groups.get(folderPath)!.push(file)
    })
    
    // 转换为数组并按文件数量排序（优先显示文件多的组）
    return Array.from(groups.entries())
      .map(([folderPath, files]) => ({ folderPath, files }))
      .sort((a, b) => b.files.length - a.files.length)
  }

  // 随机选择一个图组
  const loadRandomGroup = () => {
    console.log(`[DEBUG] loadRandomGroup 开始，当前筛选条件: ${viewedFilter}`)
    
    // 优先检查：如果有当前图组的缓存但页面未显示（首次点击），使用当前组
    if (preloadEnabled && preloadManager.hasCurrentGroupCache() && currentGroup.length === 0) {
      const currentGroupFromCache = preloadManager.getCurrentGroup()
      console.log('[DEBUG] 首次点击，使用预加载的当前图组')
      setCurrentGroup(currentGroupFromCache)
      setCurrentGroupIndex(0)
      
      // 加载该组的第一个文件
      loadFileFromGroup(currentGroupFromCache, 0)
      
      // 注意：下一组的预加载已经在useEffect中的preloadForGalleryMode完成，无需重复触发
      return
    }
    
    // 如果预加载管理器中有下一组缓存，切换到下一组
    if (preloadEnabled && preloadManager.hasNextGroupCache()) {
      const nextGroup = preloadManager.getNextGroup()
      console.log('[DEBUG] 使用预加载的下一组图组')
      preloadManager.switchToNextGroup()
      
      // 更新缓存状态（切换后立即更新）
      const cacheStatus = preloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      if (config) {
        const preloadCount = config.scanSettings?.preloadCount || 10
        setCachePreloadProgress({ current: cacheStatus.cacheSize, total: preloadCount })
      }
      
      // 注意：switchToNextGroup()已经将下一组变为当前组，从preloadManager获取更新后的当前组
      const currentGroupFromManager = preloadManager.getCurrentGroup()
      setCurrentGroup(currentGroupFromManager)
      setCurrentGroupIndex(0)
      
      // 加载该组的第一个文件（此时文件已在当前缓存中）
      loadFileFromGroup(currentGroupFromManager, 0)
      
      // 继续预加载下一组（为下次切换做准备）
      if (config) {
        setTimeout(() => {
          const preloadCount = config.scanSettings?.preloadCount || 10
          preloadManager.preloadNextGroup(config, allFiles, preloadCount, viewedFilter).catch(error => {
            console.error('预加载下一组失败:', error)
          })
        }, 500)
      }
      return
    }
    
    // 如果没有下一组缓存，重新选择图组
    /* const filteredFiles = getFilteredFiles()
    
    if (filteredFiles.length === 0) {
      setError('没有找到媒体文件')
      return
    }
    
    const groups = groupFilesByFolder(filteredFiles)
    
    if (groups.length === 0) {
      setError('没有找到文件组')
      return
    }
    
    console.log(`[DEBUG] 找到 ${groups.length} 个图组`)
    
    // 随机选择一个图组（优先选择文件多的）
    const randomGroup = groups[Math.floor(Math.random() * Math.min(groups.length, 20))]
    setCurrentGroup(randomGroup.files)
    setCurrentGroupIndex(0)
    
    console.log(`[DEBUG] 选择图组: ${randomGroup.folderPath}, 包含 ${randomGroup.files.length} 个文件`)
    
    // 加载该组的第一个文件
    loadFileFromGroup(randomGroup.files, 0)
    
    // 异步预加载当前图组的前几个文件（延迟执行，避免阻塞UI）
    if (preloadEnabled && config) {
      setTimeout(() => {
        const preloadCount = config.scanSettings?.preloadCount || 10
        preloadManager.preloadCurrentGroup(config, randomGroup.files, viewedFilter).catch(error => {
          console.error('预加载当前图组失败:', error)
        })
        
        // 异步预加载下一组
        preloadManager.preloadNextGroup(config, allFiles, preloadCount, viewedFilter).catch(error => {
          console.error('预加载下一组失败:', error)
        })
      }, 500)
    } */
  }

  // 加载图组中的指定文件
  const loadFileFromGroup = async (group: MediaFile[], index: number) => {
    if (index < 0 || index >= group.length) return
    
    // 切换文件时立即重置自动评分标志
    hasAutoRatedRef.current = false
    
    // 清除保存的视频状态，确保新视频可以自动播放
    videoStateRef.current = null
    
    setLoading(true)
    setError(null)
    
    try {
      const file = group[index]
      setCurrentFile(file)
      setCurrentGroupIndex(index)
      // 尝试从预加载缓存获取
      let preloadedBlob = preloadManager.getPreloadedFile(file.filename)
      console.log('preloadedBlob',preloadedBlob)
      
      let blob: Blob
      if (preloadedBlob) {
        // 使用预加载的文件
        blob = preloadedBlob
        console.log(`[DEBUG] 图组模式使用预加载文件: ${file.basename}`)
      } else {
        // 检查是否正在预加载中
        if (preloadManager.isPreloading(file.filename)) {
          console.log(`[DEBUG] 图组模式文件正在预加载中，等待完成: ${file.basename}`)
          // 等待预加载完成
          preloadedBlob = await preloadManager.waitForPreload(file.filename)
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
              // 直接添加到缓存（避免重复请求）
              preloadManager.addToCacheDirectly(file.filename, blob)
              // 更新缓存状态
              const updatedCacheStatus = preloadManager.getCacheStatus()
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
            // 直接添加到缓存（避免重复请求）
            preloadManager.addToCacheDirectly(file.filename, blob)
            // 更新缓存状态
            const updatedCacheStatus = preloadManager.getCacheStatus()
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
      
      // 加载当前文件的评分（优先执行，确保不被预加载阻塞）
      await loadMediaRating(file.filename)
      
      // 启动自动标记已看过的定时器（传递文件参数避免状态更新延迟）
      startAutoMarkTimer(file)
      
      // 检查是否浏览过半，如果是则预加载当前图组剩余的所有文件
      // 使用setTimeout延迟执行，确保评分加载完成后再开始预加载，避免占用网络资源
      if (preloadEnabled && config && preloadManager.isBrowseHalfway(index)) {
        // 延迟执行预加载，给评分API等关键请求留出时间
        setTimeout(() => {
          console.log('[DEBUG] 浏览超过预设数量一半，开始预加载当前图组剩余文件')
          const preloadCount = config.scanSettings?.preloadCount || 10
          preloadManager.preloadRemainingCurrentGroup(config, (current) => {
            // 实时更新进度显示（total固定为preloadCount）
            setCachePreloadProgress({ current, total: preloadCount })
          }).then(() => {
            // 更新缓存状态
            const cacheStatus = preloadManager.getCacheStatus()
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
      if (currentFile && viewMode === 'random') {
        // 无论什么模式，都添加到本地已看过记录（用于当前会话管理）
        preloadManager.addLocalViewedFile(currentFile.filename)
        
        // 所有模式都从缓存中移除已看过的文件
        preloadManager.removeFromCache(currentFile.filename)
      }
      
      // 立即切换，不等待补齐缓存
      switchCallback()
      setIsSwitching(false)
      
      // 后台异步补齐缓存
      if (currentFile && viewMode === 'random') {
        // 不等待补齐完成，让它在后台进行
        markFileAsViewedAndRefill(currentFile).catch(error => {
          console.error('后台补齐缓存失败:', error)
        })
      }
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
    saveAndSwitch(() => {
      if (currentGroupIndex > 0) {
        loadFileFromGroup(currentGroup, currentGroupIndex - 1)
      }
    })
  }

  const loadRandomMedia = async () => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
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

    // 随机模式
    saveAndSwitch(() => {
      loadRandomFile()
    })
  }

  const loadRandomFile = async () => {
    console.log(`[DEBUG] loadRandomFile 开始，当前筛选条件: ${viewedFilter}`)
    console.log(`[DEBUG] 已看过文件数量: ${viewedFiles.size}`)
    console.log(`[DEBUG] 缓存文件数量: ${preloadManager.getCachedFilepaths().length}`)
    
    // 先尝试从预加载缓存中获取符合筛选条件的文件
    const cachedPaths = preloadManager.getCachedFilepaths()
    const filteredCachedFiles = cachedPaths.filter(filePath => {
      const file = allFiles.find(f => f.filename === filePath)
      if (!file) return false
      
      // 检查媒体类型筛选
      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(file.basename)
      const isVideo = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(file.basename)
      
      if (mediaFilter === 'images' && !isImage) return false
      if (mediaFilter === 'videos' && !isVideo) return false
      
      // 检查已看过状态筛选
      if (viewedFilter === 'viewed' && !viewedFiles.has(file.filename)) return false
      if (viewedFilter === 'unviewed' && viewedFiles.has(file.filename)) return false
      
      // 排除本地已看过的文件（所有模式都适用）
      if (preloadManager.isLocalViewed(file.filename)) return false
      
      return true
    })
    
    console.log(`[DEBUG] 符合条件的缓存文件数量: ${filteredCachedFiles.length}`)
    console.log(`[DEBUG] 本地已看过文件数量: ${preloadManager.getLocalViewedCount()}`)
    
    let fileToLoad: MediaFile | null = null
    
    if (filteredCachedFiles.length > 0) {
      // 从符合条件的缓存文件中随机选择一个
      const randomCachedPath = filteredCachedFiles[Math.floor(Math.random() * filteredCachedFiles.length)]
      fileToLoad = allFiles.find(f => f.filename === randomCachedPath) || null
      console.log(`[DEBUG] 从预加载缓存中选择文件: ${fileToLoad?.basename}`)
    } else {
      console.log(`[DEBUG] 缓存中没有符合条件的文件，从所有文件中选择`)
      // 如果缓存中没有符合条件的文件，从所有符合条件的文件中随机选择一个
      const filteredFiles = getFilteredFiles()
      
      if (filteredFiles.length === 0) {
        const filterMsg = viewedFilter === 'viewed' ? '已看过' : 
                         viewedFilter === 'unviewed' ? '未看过' : '全部'
        const mediaMsg = mediaFilter === 'images' ? '图片' : 
                        mediaFilter === 'videos' ? '视频' : '媒体'
        setError(`没有找到符合条件的${mediaMsg}文件（${filterMsg}）`)
        return
      }
      
      const randomIndex = Math.floor(Math.random() * filteredFiles.length)
      fileToLoad = filteredFiles[randomIndex]
      console.log(`[DEBUG] 从筛选文件中选择文件: ${fileToLoad.basename}`)
      
      // 如果选中的文件不在缓存中，异步预加载它（不等待）
      if (!cachedPaths.includes(fileToLoad.filename)) {
        console.log(`[DEBUG] 文件 ${fileToLoad.basename} 不在缓存中，开始异步预加载...`)
        preloadManager.preloadFiles(config, [fileToLoad], 1, viewedFilter).catch(error => {
          console.warn('异步预加载失败:', error)
        })
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
    
    setLoading(true)
    setError(null)

    try {
      setCurrentFile(fileToLoad)

      // 尝试从预加载缓存获取（如果文件在缓存中）
      const preloadedBlob = preloadManager.getPreloadedFile(fileToLoad.filename)
      
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
      
      // 加载当前文件的评分
      await loadCurrentRating(fileToLoad)
      
      // 启动自动标记已看过的定时器（传递文件参数避免状态更新延迟）
      startAutoMarkTimer(fileToLoad)

      // 智能预加载下一个可能查看的文件
      setTimeout(() => smartPreload(fileToLoad), 1000)
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
        preloadManager.clearLocalViewedFiles()
      }
      
      // 如果当前显示的文件不符合新筛选条件，清空显示
      if (currentFile) {
        const isViewed = viewedFiles.has(currentFile.filename)
        
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
    preloadManager.clearLocalViewedFiles()
    
    // 清空当前显示
    setCurrentFile(null)
    setMediaUrl(null)
    
    // 重新预加载已看过的文件
    if (preloadEnabled) {
      const preloadCount = config.scanSettings?.preloadCount || 10
      
      if (viewMode === 'gallery') {
        // 图组模式：使用图组模式专用预加载，带进度回调
        await preloadManager.preloadForGalleryMode(
          config, 
          allFiles, 
          preloadCount, 
          'viewed',
          (current, total) => {
            // 实时更新进度显示
            setCachePreloadProgress({ current, total })
          }
        )
      } else {
        // 随机模式：使用随机预加载，带进度回调
        await preloadManager.refillCache(
          config, 
          allFiles, 
          preloadCount, 
          'viewed',
          (current, total) => {
            // 实时更新进度显示
            setCachePreloadProgress({ current, total })
          },
          preloadRandomness
        )
      }
      
      const cacheStatus = preloadManager.getCacheStatus()
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
    const filteredFiles = getFilteredFiles()
    
    if (mediaFilter === 'images') {
      return { total: filteredFiles.length, label: '图片' }
    } else if (mediaFilter === 'videos') {
      return { total: filteredFiles.length, label: '视频' }
    }
    return { total: filteredFiles.length, label: '全部' }
  }

  const toggleDrawer = (open: boolean) => () => {
    if (open) {
      // 打开抽屉时，保存当前配置快照
      configSnapshotRef.current = { mediaFilter, viewedFilter, viewMode }
    } else {
      // 关闭抽屉时，检查配置是否变化
      const hasConfigChanged = configSnapshotRef.current && (
        configSnapshotRef.current.mediaFilter !== mediaFilter ||
        configSnapshotRef.current.viewedFilter !== viewedFilter ||
        configSnapshotRef.current.viewMode !== viewMode
      )
      
      if (hasConfigChanged) {
        console.log('配置已变化，准备重新加载')
        // 清空当前显示，页面回到初始化状态
        setCurrentFile(null)
        setMediaUrl(null)
        setCurrentGroup([])
        setCurrentGroupIndex(0)
        
        // 触发预加载重新加载
        if (preloadEnabled && config && allFiles.length > 0) {
          const preloadCount = config.scanSettings?.preloadCount || 10
          
          if (viewMode === 'gallery') {
            // 图组模式：重置预加载状态
            setGalleryPreloadReady(false)
            setCachePreloadProgress({ current: 0, total: preloadCount })
            
            // 使用图组模式专用预加载，带进度回调
            preloadManager.preloadForGalleryMode(
              config, 
              allFiles, 
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
              const cacheStatus = preloadManager.getCacheStatus()
              setPreloadStatus(cacheStatus)
              setGalleryPreloadReady(true)
              // 保持显示进度，基于当前缓存状态
              setCachePreloadProgress({ 
                current: cacheStatus.cacheSize, 
                total: preloadCount 
              })
              console.log(`配置变化后图组模式预加载完成: ${result.message}`)
            }).catch(error => {
              console.warn('配置变化后图组模式预加载失败:', error)
              setGalleryPreloadReady(true) // 即使失败也允许预览
              const cacheStatus = preloadManager.getCacheStatus()
              // 即使失败也显示当前缓存状态
              setCachePreloadProgress({ 
                current: cacheStatus.cacheSize, 
                total: preloadCount 
              })
            })
          } else {
            // 随机模式：配置变化时先清空缓存，然后重新预加载
            setGalleryPreloadReady(true) // 随机模式不需要等待预加载完成
            setCachePreloadProgress({ current: 0, total: preloadCount })
            preloadManager.clearCache()
            preloadManager.refillCache(
              config, 
              allFiles, 
              preloadCount, 
              viewedFilter,
              (current, total) => {
                // 实时更新进度显示
                setCachePreloadProgress({ current, total })
              },
              preloadRandomness
            ).then(() => {
              const cacheStatus = preloadManager.getCacheStatus()
              setPreloadStatus(cacheStatus)
              // 更新进度显示
              setCachePreloadProgress({ 
                current: cacheStatus.cacheSize, 
                total: preloadCount 
              })
              console.log(`配置变化后随机模式预加载完成，筛选条件: ${viewedFilter}`)
            }).catch(error => {
              console.warn('配置变化后随机模式预加载失败:', error)
              const cacheStatus = preloadManager.getCacheStatus()
              // 即使失败也显示当前缓存状态
              setCachePreloadProgress({ 
                current: cacheStatus.cacheSize, 
                total: preloadCount 
              })
            })
          }
        }
      }
    }
    
    setDrawerOpen(open)
  }


  const toggleFullscreen = () => {
    const isVideoFile = currentFile && isVideo(currentFile.filename)
    
    if (isVideoFile) {
      // 保存当前视频播放状态（注意：fullscreen 是切换前的状态）
      // 如果当前是全屏，保存全屏视频的状态；如果当前不是全屏，保存非全屏视频的状态
      const activeVideo = fullscreen ? fullscreenVideoRef.current : videoRef.current
      if (activeVideo) {
        videoStateRef.current = {
          currentTime: activeVideo.currentTime,
          paused: activeVideo.paused
        }
        console.log('保存视频状态:', {
          currentTime: activeVideo.currentTime,
          paused: activeVideo.paused,
          fromFullscreen: fullscreen
        })
      }
    }
    
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
        const data = await response.json()
        setCurrentRating(data.rating || null)
      } else {
        setCurrentRating(null)
      }
    } catch (error) {
      console.error('加载媒体评分失败:', error)
      setCurrentRating(null)
    }
  }, [])

  const loadCurrentRating = useCallback(async (file?: MediaFile) => {
    const targetFile = file || currentFile
    if (!targetFile && currentGroup.length === 0) return

    try {
      if (ratingType === 'media' && targetFile) {
        const response = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(targetFile.filename)}`)
        if (response.ok) {
          const data = await response.json()
          setCurrentRating(data.rating || null)
        }
      } else if (ratingType === 'group' && currentGroup.length > 0) {
        const groupPath = getGroupPath(currentGroup[0].filename)
        const response = await fetch(`/api/ratings/group?groupPath=${encodeURIComponent(groupPath)}`)
        if (response.ok) {
          const data = await response.json()
          setCurrentRating(data.rating || null)
        }
      }
    } catch (error) {
      console.error('加载评分失败:', error)
    }
  }, [currentFile, ratingType, currentGroup])

  const saveRating = useCallback(async (data: MediaRating | GroupRating, file?: MediaFile) => {
    try {
      const targetFile = file || currentFile
      
      // 如果有传入文件，优先使用媒体评分
      if (targetFile) {
        const response = await fetch('/api/ratings/media', {
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
          const errorData = await response.json()
          throw new Error(errorData.error || '保存媒体评分失败')
        }
        
        // 保存成功后重新从服务器获取最新评分数据
        await loadMediaRating(targetFile.filename)
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
          const errorData = await response.json()
          throw new Error(errorData.error || '保存图组评分失败')
        }
        
        // 保存成功后重新从服务器获取最新评分数据
        await loadCurrentRating()
      }
    } catch (error: any) {
      throw new Error(error.message)
    }
  }, [currentFile, ratingType, currentGroup, loadMediaRating, loadCurrentRating])


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
      const ratingData = {
        rating,
        customEvaluation: [evaluation],  // 快捷键使用单个评价，转为数组格式
        isViewed: true
      }

      await saveRating(ratingData)
      
      // 更新本地已看过状态
      setViewedFiles(prev => new Set([...prev, currentFile.filename]))
      
      // 评分已保存，状态会在 saveRating 中自动更新
      
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
  }, [currentFile, saveRating])
  
  // 关闭提示
  const handleCloseSnackbar = () => {
    setSnackbarOpen(false)
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
      // 检查文件是否已经有评分，如果有评分就不执行自动评分
      const response = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(targetFile.filename)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.rating && data.rating.rating) {
          // 文件已经有评分，不执行自动评分
          console.log(`文件 ${targetFile.basename} 已有评分 ${data.rating.rating} 星，跳过自动评分`)
          return
        }
      }
      
      // 自动标记为已看过，默认2星，评价"一般"
      const autoRatingData = {
        rating: 2,
        customEvaluation: [QUICK_RATING_CONFIG[1].evaluation],
        isViewed: true
      }

      await saveRating(autoRatingData, targetFile)
      
      // 更新本地已看过状态
      setViewedFiles(prev => new Set([...prev, targetFile.filename]))
      
      // 确保评分状态已更新
      console.log(`自动评分完成: ${targetFile.basename}`)
      console.log('当前评分状态:', currentRating)
    } catch (error) {
      console.error('自动标记已看过失败:', error)
    }
  }, [currentFile, saveRating])

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
    const timeoutDuration = isImageFile ? 500 : 180000 // 图片0.5秒，视频3分钟

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
    if (!video.duration) return
    
    const progress = video.currentTime / video.duration
    // 播放超过80%时自动标记（performAutoRating内部会防止重复评分）
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

  // 全屏切换时恢复视频播放状态
  useEffect(() => {
    if (!currentFile || !isVideo(currentFile.filename)) return
    
    const savedState = videoStateRef.current
    if (!savedState) return
    
    // 等待 React 渲染完成，确保视频元素已经挂载
    const timeoutId = setTimeout(() => {
      const targetVideo = fullscreen ? fullscreenVideoRef.current : videoRef.current
      
      if (!targetVideo) {
        console.warn('视频元素未找到，无法恢复状态')
        return
      }
      
      console.log('准备恢复视频状态:', {
        currentTime: savedState.currentTime,
        paused: savedState.paused,
        toFullscreen: fullscreen,
        videoReadyState: targetVideo.readyState
      })
      
      // 先暂停视频，避免自动播放干扰
      targetVideo.pause()
      
      // 恢复播放状态的函数
      const restorePlayback = () => {
        console.log('视频时间设置完成，准备恢复播放状态')
        // 恢复播放状态
        if (!savedState.paused) {
          targetVideo.play().catch(error => {
            console.warn('恢复视频播放失败:', error)
          })
        }
        // 恢复完成后清除保存的状态
        videoStateRef.current = null
      }
      
      // 设置视频时间
      const restoreTime = () => {
        const timeDiff = Math.abs(targetVideo.currentTime - savedState.currentTime)
        // 如果时间差很小（小于0.1秒），认为已经设置成功
        if (timeDiff < 0.1) {
          console.log('视频时间已接近目标时间，直接恢复播放状态')
          restorePlayback()
          return
        }
        
        targetVideo.currentTime = savedState.currentTime
        console.log('已设置视频时间:', savedState.currentTime)
        
        // 监听时间设置完成事件
        const handleSeeked = () => {
          restorePlayback()
        }
        targetVideo.addEventListener('seeked', handleSeeked, { once: true })
      }
      
      let handleLoadedMetadata: (() => void) | null = null
      
      // 如果视频已经加载了元数据，可以直接设置时间
      if (targetVideo.readyState >= 1) {
        restoreTime()
      } else {
        // 等待视频加载元数据
        handleLoadedMetadata = () => {
          restoreTime()
        }
        targetVideo.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true })
      }
    }, 0)
    
    return () => {
      clearTimeout(timeoutId)
    }
  }, [fullscreen, currentFile])

  // 确保视频加载完成后自动播放（修复从图片切换到视频不自动播放的问题）
  useEffect(() => {
    if (!currentFile || !isVideo(currentFile.filename)) return
    
    const targetVideo = fullscreen ? fullscreenVideoRef.current : videoRef.current
    
    if (targetVideo) {
      const handleCanPlay = () => {
        // 只有在没有保存状态时才自动播放（避免与恢复状态冲突）
        if (!videoStateRef.current) {
          targetVideo.play().catch(error => {
            // 浏览器可能阻止自动播放，这是正常的
            console.log('视频自动播放被阻止:', error)
          })
        }
      }
      
      if (targetVideo.readyState >= 3) {
        // 视频已经可以播放
        handleCanPlay()
      } else {
        targetVideo.addEventListener('canplay', handleCanPlay, { once: true })
        return () => {
          targetVideo.removeEventListener('canplay', handleCanPlay)
        }
      }
    }
  }, [currentFile, fullscreen, mediaUrl])

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

  // 全屏模式
  if (fullscreen && currentFile && mediaUrl) {
    return (
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#000',
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* 全屏媒体展示 */}
        {isImage(currentFile.filename) && (
          <Box
            component="img"
            src={mediaUrl}
            alt={currentFile.basename}
            sx={{
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
            }}
          />
        )}
        {isVideo(currentFile.filename) && (
          <Box
            component="video"
            ref={fullscreenVideoRef}
            src={mediaUrl}
            controls
            autoPlay={!videoStateRef.current}
            onTimeUpdate={handleVideoTimeUpdate}
            onEnded={handleVideoEnded}
            sx={{
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
            }}
          />
        )}

        {/* 左上角：索引信息 */}
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
              : (() => {
                  const filteredFiles = getFilteredFiles()
                  const currentIndex = currentFile 
                    ? filteredFiles.findIndex(f => f.filename === currentFile.filename)
                    : -1
                  return currentIndex >= 0 
                    ? `${currentIndex + 1} / ${filteredFiles.length}`
                    : '1 / 1'
                })()}
          </Typography>
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
            '@media (max-width: 768px)': {
              px: 0.5,
              py: 1,
            },
          }}
          sx={({ position }: { position: { x: number; y: number } | null; isDragging: boolean }) => ({
            // 如果没有保存位置，使用默认位置和响应式样式
            ...(!position && {
              left: 8,
              top: viewMode === 'gallery' && currentGroup.length > 0 ? '65%' : '75%',
              transform: 'translateY(-50%)',
              '@media (max-width: 768px)': {
                left: 4,
                ...(viewMode === 'gallery' && currentGroup.length > 0 && {
                  top: '60%',
                }),
              },
            }),
          })}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            {QUICK_RATING_CONFIG.map((config) => {
              const isLit = currentRating?.rating && currentRating.rating >= config.rating
              
              return (
                <Tooltip
                  key={config.rating}
                  title={`快捷键 ${config.rating}: ${config.rating}星 - ${config.evaluation} - 已看过`}
                  placement="right"
                >
                  <IconButton
                    size="small"
                    onClick={() => handleQuickRate(config.rating, config.evaluation)}
                    disabled={loading || isSwitching}
                    sx={{
                      color: isLit 
                        ? 'warning.main' 
                        : 'rgba(255, 255, 255, 0.7)',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        color: 'warning.main',
                      },
                      transition: 'all 0.2s ease-in-out',
                      p: 0.5,
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
        </DraggableBox>

        {/* 退出全屏按钮 */}
        <Tooltip title="退出全屏" placement="left">
          <Fab
            color="secondary"
            onClick={toggleFullscreen}
            sx={{
              position: 'fixed',
              top: 24,
              right: 24,
              zIndex: 2001,
            }}
          >
            <FullscreenExitIcon />
          </Fab>
        </Tooltip>

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
                }}
              >
                <ArrowForwardIcon />
              </Fab>
            </Tooltip>


            {/* 换组按钮 */}
            <Tooltip title="换下一组" placement="left">
              <Fab
                color="secondary"
                onClick={loadRandomGroup}
                disabled={loading || isSwitching}
                sx={{
                  position: 'fixed',
                  bottom: 180,
                  right: 24,
                }}
              >
                <SkipNextIcon />
              </Fab>
            </Tooltip>
          </>
        )}

        {/* 换一个按钮（随机模式或图组模式下的默认按钮）- 可拖动 */}
        <Tooltip title={loading ? '加载中...' : (viewMode === 'gallery' ? '下一张' : '换一个')} placement="left">
          <DraggableFab
            storageKey="fullscreen_shuffle"
            color="primary"
            aria-label="换一个"
            onClick={loadRandomMedia}
            disabled={loading || isSwitching}
          >
            {loading ? (
              <CircularProgress size={24} color="inherit" />
            ) : (
              viewMode === 'gallery' ? <ArrowForwardIcon /> : <ShuffleIcon />
            )}
          </DraggableFab>
        </Tooltip>

        {/* 评分提示 - 全屏模式 */}
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
      </Box>
    )
  }

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
                  {cachePreloadProgress.current}/{cachePreloadProgress.total}
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
              borderRadius: 2, 
              overflow: 'hidden',
              backgroundColor: 'transparent',
            }}
          >
            <Box 
              sx={{ 
                position: 'relative', 
                backgroundColor: '#000',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              {isImage(currentFile.filename) && (
                <CardMedia
                  component="img"
                  image={mediaUrl}
                  alt={currentFile.basename}
                  sx={{
                    width: '100%',
                    maxHeight: 'calc(100vh - 150px)',
                    objectFit: 'contain',
                  }}
                />
              )}
              {isVideo(currentFile.filename) && (
                <Box
                  component="video"
                  ref={videoRef}
                  src={mediaUrl}
                  controls
                  autoPlay={!videoStateRef.current}
                  onTimeUpdate={handleVideoTimeUpdate}
                  onEnded={handleVideoEnded}
                  sx={{
                    width: '100%',
                    maxHeight: 'calc(100vh - 150px)',
                  }}
                />
              )}
              
            </Box>
            
            {/* 文件信息 - 紧凑显示 */}
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
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {formatFileSize(currentFile.size)}
                </Typography>
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
            </CardContent>
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
              onClick={loadRandomGroup}
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
                  正在加载 ({cachePreloadProgress.current}/{cachePreloadProgress.total})
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
            {allFiles.length > 0 && (
              <Typography variant="body2" color="success.main" sx={{ mt: 2 }}>
                已找到 {allFiles.length} 个文件
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
                  
                  // 切换到图组模式时，清空当前组
                  if (newMode === 'gallery') {
                    setCurrentGroup([])
                    setCurrentGroupIndex(0)
                  } else if (newMode === 'random') {
                    // 切换到随机模式时，允许预览（不需要等待预加载）
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
              
              {preloadProgress && (
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {preloadProgress.message}
                  </Typography>
                  <Typography variant="body2" fontWeight="medium">
                    {preloadProgress.current} / {preloadProgress.total}
                  </Typography>
                </Paper>
              )}
              
              <Button
                variant="outlined"
                size="small"
                fullWidth
                onClick={() => {
                  preloadManager.clearCache()
                  setPreloadStatus(preloadManager.getCacheStatus())
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
                未看过 ({allFiles.filter(f => !viewedFiles.has(f.filename)).length})
              </ToggleButton>
              <ToggleButton value="viewed">
                <StarIcon sx={{ mr: 1, color: 'gold' }} />
                已看过 ({viewedFiles.size})
              </ToggleButton>
              <ToggleButton value="all">
                <PhotoLibraryIcon sx={{ mr: 1 }} />
                全部 ({allFiles.length})
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
                  已本地观看: {preloadManager.getLocalViewedCount()} / {allFiles.filter(f => viewedFiles.has(f.filename)).length}
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ mb: 3 }} />

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

            {/* 扫描状态显示 */}
            {scanStatus && scanStatus.totalPending > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5, mb: 2, backgroundColor: 'info.light', color: 'info.contrastText' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <CircularProgress size={16} color="inherit" />
                  <Typography variant="body2" fontWeight="medium">
                    后台扫描进行中
                  </Typography>
                </Box>
                <Typography variant="caption" display="block">
                  已完成: {scanStatus.totalScanned} 个目录
                </Typography>
                <Typography variant="caption" display="block">
                  待扫描: {scanStatus.totalPending} 个目录
                </Typography>
                {scanStatus.pendingPaths.length > 0 && (
                  <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                    待扫描: {scanStatus.pendingPaths.slice(0, 2).join(', ')}
                    {scanStatus.pendingPaths.length > 2 && ` 等${scanStatus.pendingPaths.length}个`}
                  </Typography>
                )}
              </Paper>
            )}

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

            {/* 重新扫描按钮 */}
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                size="small"
                fullWidth
                onClick={() => loadStats(config, true)}
                disabled={loading || isSwitching}
                startIcon={<RefreshIcon />}
              >
                强制重新扫描
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
        onSave={saveRating}
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
    </Box>
  )
}
