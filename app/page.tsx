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
import preloadManager from '@/lib/preloadManager'

interface WebDAVConfig {
  url: string
  username: string
  password: string
  mediaPaths: string[]
  scanSettings?: {
    batchSize?: number
  }
}

interface MediaFile {
  filename: string
  basename: string
  size: number
  type: string
  lastmod: string
}

type MediaFilter = 'all' | 'images' | 'videos'
type ViewMode = 'random' | 'gallery' // random: 随机模式, gallery: 图组模式

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
  const [allFiles, setAllFiles] = useState<MediaFile[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('random')
  const [currentGroup, setCurrentGroup] = useState<MediaFile[]>([])
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0)
  const [scanProgress, setScanProgress] = useState<{ currentPath: string, fileCount: number } | null>(null)
  
  // 预加载相关状态
  const [preloadEnabled, setPreloadEnabled] = useState(true)
  const [preloadProgress, setPreloadProgress] = useState<{ current: number, total: number, message: string } | null>(null)
  const [preloadStatus, setPreloadStatus] = useState<{ cacheSize: number, maxCacheSize: number } | null>(null)
  
  // 扫描状态相关状态
  const [scanStatus, setScanStatus] = useState<{ 
    scannedPaths: string[], 
    pendingPaths: string[], 
    totalScanned: number, 
    totalPending: number 
  } | null>(null)
  
  // 评分相关状态
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false)
  const [currentRating, setCurrentRating] = useState<MediaRating | GroupRating | null>(null)
  const [ratingType, setRatingType] = useState<'media' | 'group'>('media')
  
  // 自动标记已看过相关状态
  const [viewStartTime, setViewStartTime] = useState<number | null>(null)
  const [autoMarkTimer, setAutoMarkTimer] = useState<NodeJS.Timeout | null>(null)
  const hasAutoRatedRef = useRef(false) // 使用 ref 避免闭包陷阱,追踪当前文件是否已自动评分
  
  // 切换状态，防止连续快速点击
  const [isSwitching, setIsSwitching] = useState(false)
  
  // 提示消息相关状态
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error' | 'info'>('success')
  
  // 视频元素引用
  const videoRef = useRef<HTMLVideoElement>(null)
  const fullscreenVideoRef = useRef<HTMLVideoElement>(null)

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
    
    // 从localStorage加载配置
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
      } catch (e) {
        console.error('加载配置失败:', e)
      }
    }

    // 加载保存的筛选偏好
    const savedFilter = localStorage.getItem('media_filter')
    if (savedFilter && (savedFilter === 'all' || savedFilter === 'images' || savedFilter === 'videos')) {
      setMediaFilter(savedFilter as MediaFilter)
    }
  }, [])

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
          console.log('从缓存加载统计信息')
          
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
      console.log('没有缓存数据，进行首次扫描')
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

      // 如果启用了预加载，开始预加载
      if (preloadEnabled && files.length > 0) {
        startPreload(cfg, files)
      }
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

      // 如果启用了预加载，开始预加载
      if (preloadEnabled && files.length > 0) {
        startPreload(cfg, files)
      }
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

    setPreloadProgress({ current: 0, total: 20, message: '开始预加载...' })
    
    try {
      const result = await preloadManager.preloadFiles(cfg, files, 20)
      
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
      await preloadManager.smartPreload(config, allFiles, currentFile, 10)
      setPreloadStatus(preloadManager.getCacheStatus())
    } catch (error) {
      console.error('智能预加载失败:', error)
    }
  }

  const getFilteredFiles = () => {
    if (mediaFilter === 'images') {
      return allFiles.filter(f => /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename))
    } else if (mediaFilter === 'videos') {
      return allFiles.filter(f => /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename))
    }
    return allFiles
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
    const filteredFiles = getFilteredFiles()
    
    if (filteredFiles.length === 0) {
      setError('没有找到媒体文件')
      return
    }
    
    const groups = groupFilesByFolder(filteredFiles)
    
    if (groups.length === 0) {
      setError('没有找到文件组')
      return
    }
    
    // 随机选择一个图组（优先选择文件多的）
    const randomGroup = groups[Math.floor(Math.random() * Math.min(groups.length, 20))]
    setCurrentGroup(randomGroup.files)
    setCurrentGroupIndex(0)
    
    // 加载该组的第一个文件
    loadFileFromGroup(randomGroup.files, 0)
  }

  // 加载图组中的指定文件
  const loadFileFromGroup = async (group: MediaFile[], index: number) => {
    if (index < 0 || index >= group.length) return
    
    // 切换文件时立即重置自动评分标志
    hasAutoRatedRef.current = false
    
    setLoading(true)
    setError(null)
    
    try {
      const file = group[index]
      setCurrentFile(file)
      setCurrentGroupIndex(index)

      // 尝试从预加载缓存获取
      const preloadedBlob = preloadManager.getPreloadedFile(file.filename)
      
      let blob: Blob
      if (preloadedBlob) {
        // 使用预加载的文件
        blob = preloadedBlob
        console.log(`使用预加载文件: ${file.basename}`)
      } else {
        // 正常加载文件
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
      }

      const url = URL.createObjectURL(blob)
      
      // 清理旧的URL
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
      }
      
      setMediaUrl(url)
      
      // 加载当前文件的评分
      await loadMediaRating(file.filename)
      
      // 启动自动标记已看过的定时器（传递文件参数避免状态更新延迟）
      startAutoMarkTimer(file)

      // 智能预加载下一个可能查看的文件
      setTimeout(() => smartPreload(file), 1000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 保存当前评分并切换图片
  const saveAndSwitch = async (switchCallback: () => void) => {
    if (!currentFile || isSwitching) {
      return
    }

    setIsSwitching(true)

    try {
      // 停止自动标记定时器，避免在切换时触发自动评分
      stopAutoMarkTimer()
      
      // 如果当前有评分数据，先保存
      if (currentRating) {
        await saveRating(currentRating, currentFile)
      }
      
      // 保存成功后切换
      switchCallback()
    } catch (error) {
      console.error('保存评分失败:', error)
      // 即使保存失败也继续切换，避免卡住
      switchCallback()
    } finally {
      // 延迟重置切换状态，防止连续点击
      setTimeout(() => {
        setIsSwitching(false)
      }, 500)
    }
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
    const filteredFiles = getFilteredFiles()
    
    if (filteredFiles.length === 0) {
      setError(
        mediaFilter === 'images' 
          ? '没有找到图片文件' 
          : mediaFilter === 'videos'
          ? '没有找到视频文件'
          : '未找到任何媒体文件'
      )
      return
    }

    // 切换文件时立即重置自动评分标志
    hasAutoRatedRef.current = false
    
    setLoading(true)
    setError(null)

    try {
      // 从筛选后的文件中随机选择
      const randomFile = filteredFiles[Math.floor(Math.random() * filteredFiles.length)]
      setCurrentFile(randomFile)

      // 尝试从预加载缓存获取
      const preloadedBlob = preloadManager.getPreloadedFile(randomFile.filename)
      
      let blob: Blob
      if (preloadedBlob) {
        // 使用预加载的文件
        blob = preloadedBlob
        console.log(`使用预加载文件: ${randomFile.basename}`)
      } else {
        // 正常加载文件
        const streamResponse = await fetch('/api/webdav/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...config,
            filepath: randomFile.filename,
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
      await loadCurrentRating(randomFile)
      
      // 启动自动标记已看过的定时器（传递文件参数避免状态更新延迟）
      startAutoMarkTimer(randomFile)

      // 智能预加载下一个可能查看的文件
      setTimeout(() => smartPreload(randomFile), 1000)
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
    if (mediaFilter === 'images') {
      return { total: stats.images, label: '图片' }
    } else if (mediaFilter === 'videos') {
      return { total: stats.videos, label: '视频' }
    }
    return { total: stats.total, label: '全部' }
  }

  const toggleDrawer = (open: boolean) => () => {
    setDrawerOpen(open)
  }

  const toggleFullscreen = () => {
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

  const saveRating = async (data: MediaRating | GroupRating, file?: MediaFile) => {
    try {
      const targetFile = file || currentFile
      if (ratingType === 'media' && targetFile) {
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
  }

  const loadCurrentRating = async (file?: MediaFile) => {
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
  }

  // 加载指定媒体文件的评分（用于图组模式）
  const loadMediaRating = async (filePath: string) => {
    try {
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
  }

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
        customEvaluation: ['一般'],
        isViewed: true
      }

      await saveRating(autoRatingData, targetFile)
      
      // 评分已保存，状态会在 saveRating 中自动更新
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
        const quickRatingConfig = [
          { rating: 1, evaluation: '丑死了' },
          { rating: 2, evaluation: '一般' },
          { rating: 3, evaluation: '还行' },
          { rating: 4, evaluation: '非常爽' },
          { rating: 5, evaluation: '爽死了' },
        ]
        
        const config = quickRatingConfig[rating - 1]
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
            autoPlay
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

        {/* 退出全屏按钮 */}
        <Tooltip title="退出全屏" placement="left">
          <Fab
            color="secondary"
            onClick={toggleFullscreen}
            sx={{
              position: 'fixed',
              top: 24,
              right: 24,
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
                    bottom: 100,
                    left: 24,
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
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

            {/* 进度指示 */}
            <Box
              sx={{
                position: 'fixed',
                bottom: 24,
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                color: 'white',
                px: 2,
                py: 1,
                borderRadius: 2,
              }}
            >
              <Typography variant="body2">
                {currentGroupIndex + 1} / {currentGroup.length}
              </Typography>
            </Box>

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

        {/* 换一个按钮（随机模式或图组模式下的默认按钮） */}
        <Tooltip title={loading ? '加载中...' : (viewMode === 'gallery' ? '下一张' : '换一个')} placement="left">
          <Fab
            color="primary"
            aria-label="换一个"
            onClick={loadRandomMedia}
            disabled={loading || isSwitching}
            sx={{
              position: 'fixed',
              bottom: 24,
              right: 24,
            }}
          >
            {loading ? (
              <CircularProgress size={24} color="inherit" />
            ) : (
              viewMode === 'gallery' ? <ArrowForwardIcon /> : <ShuffleIcon />
            )}
          </Fab>
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
            WebDAV 媒体预览器
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
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
                  autoPlay
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
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" fontWeight="medium" noWrap sx={{ flex: 1 }}>
                  {currentFile.basename}
                </Typography>
                {viewMode === 'gallery' && currentGroup.length > 0 && (
                  <Chip 
                    label={`${currentGroupIndex + 1}/${currentGroup.length}`} 
                    size="small" 
                    color="primary"
                  />
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.5 }}>
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
              准备好了！
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
              从 {config.mediaPaths.length} 个目录中
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              随机加载{filteredStats.label === '全部' ? '媒体文件' : filteredStats.label}
            </Typography>
            <Typography variant="body2" color="primary" sx={{ mb: 3 }}>
              当前筛选：{filteredStats.label} - {filteredStats.total} 个文件
            </Typography>
            <Button
              variant="contained"
              size="large"
              startIcon={<ShuffleIcon />}
              onClick={loadRandomMedia}
            >
              开始预览
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
                  // 切换到图组模式时，清空当前组
                  if (newMode === 'gallery') {
                    setCurrentGroup([])
                    setCurrentGroupIndex(0)
                  }
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
                <Typography variant="caption" color="text.secondary" noWrap>
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
                1键: 1星-丑死了 | 2键: 2星-一般 | 3键: 3星-还行
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                4键: 4星-非常爽 | 5键: 5星-爽死了
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
      <Tooltip title={loading ? '加载中...' : '换一个'} placement="left">
        <Fab
          color="primary"
          aria-label="换一个"
          onClick={loadRandomMedia}
          disabled={loading || isSwitching}
          sx={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 1000,
          }}
        >
          {loading ? (
            <CircularProgress size={24} color="inherit" />
          ) : (
            <ShuffleIcon />
          )}
        </Fab>
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
