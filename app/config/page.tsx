'use client'

import { useState, useEffect } from 'react'
import {
  Container,
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Alert,
  CircularProgress,
  InputAdornment,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Checkbox,
  Breadcrumbs,
  Link,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Card,
  CardContent,
  IconButton,
  MenuItem,
  Switch,
  FormControlLabel,
  Tabs,
  Tab,
} from '@mui/material'
import {
  Save as SaveIcon,
  ArrowBack as ArrowBackIcon,
  Visibility,
  VisibilityOff,
  CheckCircle as CheckCircleIcon,
  Settings as SettingsIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  NavigateNext as NavigateNextIcon,
  Home as HomeIcon,
  ManageAccounts as ManageAccountsIcon,
  Refresh as RefreshIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material'
import { ListItemButton, ListItemSecondaryAction } from '@mui/material'
import { useRouter } from 'next/navigation'
import ScheduledScanDialog from '@/components/ScheduledScanDialog'
import DirectoryItem from '@/components/DirectoryItem'

interface WebDAVConfig {
  url: string
  username: string
  password: string
  mediaPaths: string[]
  sourceType?: 'clouddrive2' | 'openlist'
  directLinkUrl?: string
  enableDirectLink?: boolean
  scanSettings?: {
    batchSize?: number | string
    concurrency?: number | string
    preloadCount?: number | string
    timeout?: number | string
  }
}

interface MysqlConfig {
  host: string
  port: number | string
  user: string
  password: string
  database: string
  charset: string
  timezone: string
  connectionLimit: number | string
}

interface Directory {
  filename: string
  basename: string
  lastmod: string
  size: number
}

interface PathStats {
  path: string
  total: number
  images: number
  videos: number
  lastScan?: string
}

const FIXED_MYSQL_DATABASE = 'webdav_image_preview'
const PRELOAD_COUNT_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const

function normalizePreloadCount(value: unknown): number {
  const numericValue = Number(value)
  return PRELOAD_COUNT_OPTIONS.includes(numericValue as typeof PRELOAD_COUNT_OPTIONS[number])
    ? numericValue
    : 10
}

function normalizeBatchSize(value: unknown): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= 5
    ? numericValue
    : 10
}

function normalizeConcurrency(value: unknown): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= 5
    ? numericValue
    : 10
}

function normalizeTimeout(value: unknown): number {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue >= 10000
    ? numericValue
    : 60000
}

function normalizeScanSettings(scanSettings?: WebDAVConfig['scanSettings']): NonNullable<WebDAVConfig['scanSettings']> {
  return {
    batchSize: normalizeBatchSize(scanSettings?.batchSize),
    concurrency: normalizeConcurrency(scanSettings?.concurrency),
    preloadCount: normalizePreloadCount(scanSettings?.preloadCount),
    timeout: normalizeTimeout(scanSettings?.timeout),
  }
}

function createDefaultWebdavConfig(): WebDAVConfig {
  return {
    url: '',
    username: '',
    password: '',
    mediaPaths: ['/'],
    sourceType: 'clouddrive2',
    directLinkUrl: '',
    enableDirectLink: false,
    scanSettings: normalizeScanSettings(),
  }
}

function normalizeWebdavConfig(rawConfig: Partial<WebDAVConfig> | null | undefined): WebDAVConfig {
  return {
    url: rawConfig?.url || '',
    username: rawConfig?.username || '',
    password: rawConfig?.password || '',
    mediaPaths: rawConfig?.mediaPaths?.length ? rawConfig.mediaPaths : ['/'],
    sourceType: rawConfig?.sourceType || 'clouddrive2',
    directLinkUrl: rawConfig?.directLinkUrl || '',
    enableDirectLink: rawConfig?.enableDirectLink || false,
    scanSettings: normalizeScanSettings(rawConfig?.scanSettings),
  }
}

export default function ConfigPage() {
  const router = useRouter()
  const [config, setConfig] = useState<WebDAVConfig>(createDefaultWebdavConfig())
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null)
  const [saveResult, setSaveResult] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null)
  const [webdavLoadError, setWebdavLoadError] = useState<string | null>(null)
  
  // 目录浏览相关
  const [browseDialogOpen, setBrowseDialogOpen] = useState(false)
  const [currentPath, setCurrentPath] = useState('/')
  const [directories, setDirectories] = useState<Directory[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [browsing, setBrowsing] = useState(false)
  const [pathStats, setPathStats] = useState<Map<string, PathStats>>(new Map())
  const [scanning, setScanning] = useState<Set<string>>(new Set())
  const [scanProgress, setScanProgress] = useState<Map<string, { 
    currentPath: string, 
    fileCount: number, 
    startTime?: number,
    scannedDirectories?: number,
    totalDirectories?: number,
    percentage?: number,
    delayUntil?: string
  }>>(new Map())
  
  // 风控状态
  const [rateLimited, setRateLimited] = useState(false)
  const [rateLimitedUntil, setRateLimitedUntil] = useState<string | null>(null)
  
  // 递归扫描相关状态
  
  // 定时扫描相关状态
  const [scheduledScans, setScheduledScans] = useState<any[]>([])
  const [scheduledScanDialogOpen, setScheduledScanDialogOpen] = useState(false)
  const [editingScan, setEditingScan] = useState<any>(null)
  const [loadingScans, setLoadingScans] = useState(false)
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null)
  
  // 多配置管理相关状态
  const [allConfigs, setAllConfigs] = useState<any[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [configListDialogOpen, setConfigListDialogOpen] = useState(false)
  const [editingConfigId, setEditingConfigId] = useState<number | null>(null)
  const [isNewConfig, setIsNewConfig] = useState(false)
  const [mysqlConfig, setMysqlConfig] = useState<MysqlConfig>({
    host: '',
    port: 3306,
    user: '',
    password: '',
    database: FIXED_MYSQL_DATABASE,
    charset: 'utf8mb4',
    timezone: '+08:00',
    connectionLimit: 10,
  })
  const [loadingMysqlConfig, setLoadingMysqlConfig] = useState(false)
  const [mysqlConfigFilePath, setMysqlConfigFilePath] = useState('')
  const [mysqlConfigSource, setMysqlConfigSource] = useState<'file' | 'env' | 'none'>('none')
  const [activeTab, setActiveTab] = useState<'mysql' | 'webdav' | 'scheduled' | 'directories'>('mysql')

  // 安全解析JSON的辅助函数
  const safeJsonParse = (jsonString: string | null | undefined, fallback: any = null) => {
    if (!jsonString) return fallback
    try {
      return JSON.parse(jsonString)
    } catch (error) {
      console.error('JSON解析失败:', error, jsonString)
      return fallback
    }
  }

  // 加载所有 WebDAV 配置
  const loadAllConfigs = async () => {
    setLoadingConfigs(true)
    try {
      const response = await fetch('/api/webdav-config')
      if (response.ok) {
        const data = await response.json()
        setAllConfigs(data.configs || [])
        console.log('✅ 加载所有配置成功:', data.configs?.length || 0, '个配置')
      } else {
        console.error('❌ 加载所有配置失败: HTTP', response.status)
      }
    } catch (error) {
      console.error('❌ 加载所有配置失败:', error)
    } finally {
      setLoadingConfigs(false)
    }
  }

  const loadMysqlConfig = async () => {
    setLoadingMysqlConfig(true)
    try {
      const response = await fetch('/api/mysql-config')
      if (response.ok) {
        const data = await response.json()
        const mysql = data.config || {}
        setMysqlConfig({
          host: mysql.host || '',
          port: mysql.port ?? 3306,
          user: mysql.user || '',
          password: mysql.password || '',
          database: FIXED_MYSQL_DATABASE,
          charset: mysql.charset || 'utf8mb4',
          timezone: mysql.timezone || '+08:00',
          connectionLimit: mysql.connectionLimit ?? 10,
        })
        setMysqlConfigFilePath(data.filePath || '')
        setMysqlConfigSource(data.source || 'none')
      } else {
        console.error('❌ 加载 MySQL 配置失败: HTTP', response.status)
      }
    } catch (error) {
      console.error('❌ 加载 MySQL 配置失败:', error)
    } finally {
      setLoadingMysqlConfig(false)
    }
  }

  // 加载扫描缓存数据
  const loadScanCache = async (config: WebDAVConfig) => {
    try {
      const response = await fetch(`/api/scan-cache?webdavUrl=${encodeURIComponent(config.url)}&webdavUsername=${encodeURIComponent(config.username)}&webdavPassword=${encodeURIComponent(config.password)}`)
      
      if (response.ok) {
        const data = await response.json()
        const statsMap = new Map<string, PathStats>()
        Object.entries(data.pathStats).forEach(([path, stats]: [string, any]) => {
          statsMap.set(path, stats as PathStats)
        })
        setPathStats(statsMap)
        console.log('扫描缓存数据加载成功:', statsMap.size, '个目录')
      } else {
        console.error('加载扫描缓存失败')
      }
    } catch (error) {
      console.error('加载扫描缓存失败:', error)
    }
  }

  // 加载当前正在执行的扫描任务（页面刷新后恢复状态）
  const loadRunningScanTasks = async (config: WebDAVConfig) => {
    try {
      const response = await fetch('/api/webdav/recursive-scan')
      if (response.ok) {
        const data = await response.json()
        
        // 恢复风控状态
        if (data.rateLimited) {
          setRateLimited(true)
          setRateLimitedUntil(data.rateLimitedUntil)
          console.log('恢复风控状态:', data.rateLimitedUntil)
        }
        
        // 恢复正在执行的任务状态
        if (data.currentTask) {
          const path = data.currentTask.path
          const progress = data.currentTask.progress
          setScanning(prev => new Set(prev).add(path))
          setScanProgress(prev => new Map(prev).set(path, {
            currentPath: progress?.currentPath || '扫描中...',
            fileCount: progress?.foundFiles || 0,
            scannedDirectories: progress?.scannedDirectories || 0,
            totalDirectories: progress?.totalDirectories || 0,
            percentage: progress?.totalDirectories > 0 
              ? Math.round((progress.scannedDirectories / progress.totalDirectories) * 100) 
              : 0
          }))
          // 开始轮询状态
          pollScanStatus(path, data.currentTask.taskId)
        }
        
        // 恢复队列中等待的任务状态
        if (data.pendingTasks && data.pendingTasks.length > 0) {
          data.pendingTasks.forEach((task: any, index: number) => {
            const path = task.path
            setScanning(prev => new Set(prev).add(path))
            
            // 计算等待信息
            let waitInfo = `队列等待中 (位置: ${index + (data.currentTask ? 2 : 1)})`
            if (task.delayUntil) {
              const delayDate = new Date(task.delayUntil)
              const now = new Date()
              if (delayDate > now) {
                const waitSeconds = Math.ceil((delayDate.getTime() - now.getTime()) / 1000)
                waitInfo = `等待中 (${Math.floor(waitSeconds / 60)}分${waitSeconds % 60}秒后开始)`
              }
            }
            
            setScanProgress(prev => new Map(prev).set(path, {
              currentPath: waitInfo,
              fileCount: 0,
              delayUntil: task.delayUntil
            }))
            // 开始轮询状态
            pollScanStatus(path, task.taskId)
          })
        }
        
        if (data.currentTask || (data.pendingTasks && data.pendingTasks.length > 0)) {
          console.log('恢复扫描任务状态:', {
            current: data.currentTask?.path,
            pending: data.pendingTasks?.map((t: any) => t.path),
            rateLimited: data.rateLimited
          })
        }
      }
    } catch (error) {
      console.error('加载扫描任务状态失败:', error)
    }
  }

  useEffect(() => {
    // 优先从数据库加载配置，如果没有则从 localStorage 加载（向后兼容）
    const loadConfig = async () => {
      try {
        // 先从数据库加载默认配置
        const response = await fetch('/api/webdav-config/default')
        if (response.ok) {
          const dbConfig = await response.json()
          if (dbConfig.url && dbConfig.username) {
            const normalizedDbConfig = normalizeWebdavConfig(dbConfig)
            setConfig(normalizedDbConfig)
            setSelectedPaths(new Set(normalizedDbConfig.mediaPaths || []))
            
            // 加载扫描缓存数据
            loadScanCache(normalizedDbConfig)
            // 加载正在执行的扫描任务状态
            loadRunningScanTasks(normalizedDbConfig)
            setWebdavLoadError(null)
            return
          }
        }
      } catch (error) {
        console.error('从数据库加载配置失败:', error)
        setWebdavLoadError(error instanceof Error ? error.message : '从数据库加载 WebDAV 配置失败')
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
          const normalizedLocalConfig = normalizeWebdavConfig(parsed)
          setConfig(normalizedLocalConfig)
          setSelectedPaths(new Set(normalizedLocalConfig.mediaPaths || []))
          setWebdavLoadError(null)
          
          // 加载扫描缓存数据
          loadScanCache(normalizedLocalConfig)
          // 加载正在执行的扫描任务状态
          loadRunningScanTasks(normalizedLocalConfig)
          
          // 如果 localStorage 中有配置，尝试将其保存到数据库（迁移）
          if (parsed.url && parsed.username) {
            try {
              await fetch('/api/webdav-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: normalizedLocalConfig.url,
                  username: normalizedLocalConfig.username,
                  password: normalizedLocalConfig.password,
                  mediaPaths: normalizedLocalConfig.mediaPaths,
                  scanSettings: normalizeScanSettings(normalizedLocalConfig.scanSettings),
                  isDefault: true // 迁移时设为默认配置
                })
              })
            } catch (migrationError) {
              console.error('迁移配置到数据库失败:', migrationError)
            }
          }
        } catch (e) {
          console.error('加载配置失败:', e)
          setWebdavLoadError(e instanceof Error ? e.message : '加载 WebDAV 配置失败')
        }
      }
    }
    
    loadConfig()
    
    // 加载所有配置
    loadAllConfigs()
    loadMysqlConfig()
    
    // 加载定时扫描任务
    loadScheduledScans()
    loadSchedulerStatus()
  }, [])

  const loadScheduledScans = async () => {
    setLoadingScans(true)
    try {
      const response = await fetch('/api/scheduled-scans')
      if (response.ok) {
        const data = await response.json()
        setScheduledScans(data.tasks || [])
      }
    } catch (error) {
      console.error('加载定时扫描任务失败:', error)
    } finally {
      setLoadingScans(false)
    }
  }

  const loadSchedulerStatus = async () => {
    try {
      const response = await fetch('/api/scheduler/status')
      if (response.ok) {
        const data = await response.json()
        setSchedulerStatus(data)
      }
    } catch (error: any) {
      console.error('加载调度器状态失败:', error)
    }
  }

  const handleChange = (field: keyof WebDAVConfig) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setConfig({ ...config, [field]: event.target.value })
    setTestResult(null)
    setSaveResult(null)
  }

  const handleMysqlChange = (field: keyof MysqlConfig) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setMysqlConfig({ ...mysqlConfig, [field]: event.target.value })
    setSaveResult(null)
  }

  const testConnection = async () => {
    if (!config.url || !config.username || !config.password) {
      setTestResult({
        type: 'error',
        message: '请填写完整的连接信息',
      })
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const response = await fetch('/api/webdav/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      const data = await response.json()

      if (response.ok) {
        setTestResult({
          type: 'success',
          message: data.message || '连接成功！',
        })
      } else {
        setTestResult({
          type: 'error',
          message: data.error || '连接失败',
        })
      }
    } catch (error: any) {
      setTestResult({
        type: 'error',
        message: `连接失败: ${error.message}`,
      })
    } finally {
      setTesting(false)
    }
  }

  const saveMysqlConfig = async () => {
    if (!mysqlConfig.host || !mysqlConfig.user || !mysqlConfig.password || !mysqlConfig.database) {
      setSaveResult({
        type: 'error',
        message: '请填写完整的 MySQL 配置信息',
      })
      setActiveTab('mysql')
      return
    }

    setSaving(true)
    setSaveResult(null)

    try {
      const mysqlConfigToSave = {
        host: mysqlConfig.host.trim(),
        port: Number(mysqlConfig.port) || 3306,
        user: mysqlConfig.user.trim(),
        password: mysqlConfig.password,
        database: FIXED_MYSQL_DATABASE,
        charset: (mysqlConfig.charset || 'utf8mb4').trim() || 'utf8mb4',
        timezone: (mysqlConfig.timezone || '+08:00').trim() || '+08:00',
        connectionLimit: Number(mysqlConfig.connectionLimit) || 10,
      }

      const mysqlResponse = await fetch('/api/mysql-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mysqlConfigToSave)
      })

      if (!mysqlResponse.ok) {
        const errorData = await mysqlResponse.json()
        throw new Error(errorData.error || '保存 MySQL 配置文件失败')
      }

      const mysqlData = await mysqlResponse.json()
      setMysqlConfigFilePath(mysqlData.filePath || '')
      setMysqlConfigSource('file')
      setSaveResult({
        type: 'success',
        message: 'MySQL 配置文件已保存，后续重启会自动读取。',
      })
    } catch (error: any) {
      setSaveResult({
        type: 'error',
        message: `保存 MySQL 配置失败: ${error.message}`,
      })
    } finally {
      setSaving(false)
    }
  }

  const saveConfig = async (successMessage = 'WebDAV 配置已保存！如需扫描媒体文件，请前往管理页面手动触发扫描。') => {
    if (!config.url || !config.username || !config.password) {
      setSaveResult({
        type: 'error',
        message: '请填写完整的连接信息',
      })
      setActiveTab('webdav')
      return
    }

    setSaving(true)
    setSaveResult(null)

    try {
      const configToSave = {
        ...config,
        mediaPaths: Array.from(selectedPaths),
        scanSettings: normalizeScanSettings(config.scanSettings),
        // 如果没有填写直链源，使用 WebDAV URL
        directLinkUrl: config.directLinkUrl || config.url,
        // OpenList 源默认开启直链播放（如果用户没有明确设置）
        enableDirectLink: config.sourceType === 'openlist' 
          ? (config.enableDirectLink !== false) 
          : (config.enableDirectLink || false),
      }

      // 同时保存到数据库和 localStorage（向后兼容）
      try {
        // 保存到数据库
        const dbResponse = await fetch('/api/webdav-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: configToSave.url,
            username: configToSave.username,
            password: configToSave.password,
            mediaPaths: configToSave.mediaPaths,
            sourceType: configToSave.sourceType || 'clouddrive2',
            directLinkUrl: configToSave.directLinkUrl,
            enableDirectLink: configToSave.enableDirectLink,
            scanSettings: normalizeScanSettings(configToSave.scanSettings),
            isDefault: true // 当前配置设为默认
          })
        })
        
        if (!dbResponse.ok) {
          const errorData = await dbResponse.json()
          throw new Error(errorData.error || '保存到数据库失败')
        }
        
        // 数据库保存成功后，也保存到 localStorage（向后兼容）
        localStorage.setItem('webdav_config', JSON.stringify(configToSave))
        
        console.log('✅ 配置保存成功，开始刷新配置列表...')
        
        // 重新加载所有配置列表
        await loadAllConfigs()
        
        console.log('✅ 配置列表刷新完成')
        
        // 保存成功提示（不再自动触发扫描）
        setSaveResult({
          type: 'success',
          message: successMessage,
        })
      } catch (dbError: any) {
        console.error('保存到数据库失败:', dbError)
        setSaveResult({
          type: 'error',
          message: `保存失败: ${dbError.message}`,
        })
      }
    } catch (error: any) {
      setSaveResult({
        type: 'error',
        message: `保存失败: ${error.message}`,
      })
    } finally {
      setSaving(false)
    }
  }

  const openBrowseDialog = async () => {
    if (!config.url || !config.username || !config.password) {
      setTestResult({
        type: 'error',
        message: '请先填写WebDAV连接信息',
      })
      return
    }
    
    setBrowseDialogOpen(true)
    setCurrentPath('/')
    await loadDirectories('/')
  }

  const loadDirectories = async (path: string) => {
    setBrowsing(true)
    try {
      const response = await fetch('/api/webdav/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.url,
          username: config.username,
          password: config.password,
          path,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '加载目录失败')
      }

      const data = await response.json()
      setDirectories(data.directories || [])
      setCurrentPath(path)
    } catch (error: any) {
      setTestResult({
        type: 'error',
        message: error.message,
      })
    } finally {
      setBrowsing(false)
    }
  }

  const navigateToPath = (path: string) => {
    loadDirectories(path)
  }

  const getPathParts = (path: string) => {
    if (path === '/') return [{ name: '根目录', path: '/' }]
    const parts = path.split('/').filter(Boolean)
    const result = [{ name: '根目录', path: '/' }]
    let currentPath = ''
    for (const part of parts) {
      currentPath += '/' + part
      result.push({ name: part, path: currentPath })
    }
    return result
  }

  const togglePathSelection = (path: string) => {
    const newSelected = new Set(selectedPaths)
    if (newSelected.has(path)) {
      newSelected.delete(path)
      // 不删除统计信息，保留缓存数据以便重新添加时直接使用
    } else {
      newSelected.add(path)
      // 如果没有缓存数据，自动递归扫描该目录
      if (!pathStats.has(path)) {
        startRecursiveScan(path)
      }
    }
    setSelectedPaths(newSelected)
  }


  // 递归扫描相关函数
  const startRecursiveScan = async (path: string, forceRescan = false) => {
    // 检查是否已经在扫描中，防止重复启动
    if (scanning.has(path)) {
      setTestResult({
        type: 'info',
        message: `路径 ${path} 正在扫描中，请等待完成`
      })
      return
    }

    // 标记为扫描中
    setScanning(prev => new Set(prev).add(path))

    try {
      const response = await fetch('/api/webdav/recursive-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.url,
          username: config.username,
          password: config.password,
          path,
          concurrency: config.scanSettings?.concurrency || 10,
          forceRescan
        }),
      })

      if (response.ok) {
        const data = await response.json()
        
        // 检查是否是任务已在运行的响应
        if (data.taskRunning) {
          setTestResult({
            type: 'info',
            message: `路径 ${path} 的扫描任务正在进行中，请等待完成`
          })
          // 开始轮询任务状态
          pollScanStatus(path, data.taskId)
          return
        }
        
        // 检查是否是任务在队列中等待
        if (data.taskQueued) {
          setTestResult({
            type: 'info',
            message: `任务已加入队列，当前位置: ${data.position}，请等待前面的任务完成`
          })
          // 开始轮询任务状态
          pollScanStatus(path, data.taskId)
          return
        }
        
        // 任务已启动，开始轮询状态
        if (data.scanStarted) {
          setTestResult({
            type: 'info',
            message: `扫描任务已启动: ${path}`
          })
          pollScanStatus(path, data.taskId)
          return
        }
        
        // 兼容旧的同步响应格式
        if (data.result) {
          setPathStats(prev => new Map(prev).set(path, {
            path,
            total: data.result.totalFiles,
            images: data.result.imageCount,
            videos: data.result.videoCount,
            lastScan: new Date().toISOString()
          }))
          
          setTestResult({
            type: 'success',
            message: `递归扫描完成: ${path} - 找到 ${data.result.totalFiles} 个文件`
          })
          
          // 扫描完成，移除扫描状态
          setScanning(prev => {
            const newSet = new Set(prev)
            newSet.delete(path)
            return newSet
          })
        }
      } else {
        const error = await response.json()
        setTestResult({
          type: 'error',
          message: `递归扫描失败: ${error.error}`
        })
        // 失败时移除扫描状态
        setScanning(prev => {
          const newSet = new Set(prev)
          newSet.delete(path)
          return newSet
        })
      }
    } catch (error: any) {
      setTestResult({
        type: 'error',
        message: `递归扫描失败: ${error.message}`
      })
      // 异常时移除扫描状态
      setScanning(prev => {
        const newSet = new Set(prev)
        newSet.delete(path)
        return newSet
      })
    }
  }

  // 轮询扫描任务状态
  const pollScanStatus = async (path: string, taskId: string) => {
    const checkStatus = async () => {
      try {
        const response = await fetch('/api/webdav/recursive-scan')
        if (response.ok) {
          const data = await response.json()
          
          // 更新风控状态
          setRateLimited(data.rateLimited || false)
          setRateLimitedUntil(data.rateLimitedUntil || null)
          
          // 检查当前任务是否完成
          const currentTask = data.currentTask
          const pendingTask = data.pendingTasks?.find((t: any) => t.taskId === taskId)
          
          // 如果任务在队列中等待
          if (pendingTask) {
            const position = data.pendingTasks.indexOf(pendingTask) + 1
            
            // 计算等待信息
            let waitInfo = `队列等待中 (位置: ${position + (data.currentTask ? 1 : 0)})`
            if (pendingTask.delayUntil) {
              const delayDate = new Date(pendingTask.delayUntil)
              const now = new Date()
              if (delayDate > now) {
                const waitSeconds = Math.ceil((delayDate.getTime() - now.getTime()) / 1000)
                waitInfo = `等待中 (${Math.floor(waitSeconds / 60)}分${waitSeconds % 60}秒后开始)`
              }
            }
            
            // 如果触发风控
            if (data.rateLimited && data.rateLimitedUntil) {
              const rateLimitDate = new Date(data.rateLimitedUntil)
              const now = new Date()
              if (rateLimitDate > now) {
                const waitMinutes = Math.ceil((rateLimitDate.getTime() - now.getTime()) / 60000)
                waitInfo = `⚠️ 风控等待中 (${waitMinutes}分钟后恢复)`
              }
            }
            
            setScanProgress(prev => new Map(prev).set(path, {
              currentPath: waitInfo,
              fileCount: 0,
              delayUntil: pendingTask.delayUntil
            }))
            // 继续轮询
            setTimeout(checkStatus, 3000)
            return
          }
          
          // 如果是当前正在执行的任务
          if (currentTask && currentTask.taskId === taskId) {
            // 更新进度信息
            const progress = currentTask.progress
            if (progress) {
              setScanProgress(prev => new Map(prev).set(path, {
                currentPath: progress.currentPath || '扫描中...',
                fileCount: progress.foundFiles || 0,
                scannedDirectories: progress.scannedDirectories || 0,
                totalDirectories: progress.totalDirectories || 0,
                percentage: progress.totalDirectories > 0 
                  ? Math.round((progress.scannedDirectories / progress.totalDirectories) * 100) 
                  : 0
              }))
            }
            // 任务正在执行，继续轮询
            setTimeout(checkStatus, 2000)
            return
          }
          
          // 任务不在队列中也不是当前任务，说明已完成或失败
          // 刷新缓存数据
          await refreshPathStats(path)
          
          setTestResult({
            type: 'success',
            message: `扫描完成: ${path}`
          })
          
          // 移除扫描状态
          setScanning(prev => {
            const newSet = new Set(prev)
            newSet.delete(path)
            return newSet
          })
          setScanProgress(prev => {
            const newMap = new Map(prev)
            newMap.delete(path)
            return newMap
          })
        }
      } catch (error) {
        console.error('轮询扫描状态失败:', error)
        // 出错时继续轮询
        setTimeout(checkStatus, 5000)
      }
    }
    
    // 开始轮询
    checkStatus()
  }

  // 刷新路径统计信息
  const refreshPathStats = async (path: string) => {
    try {
      const response = await fetch(`/api/scan-files/stats?webdavUrl=${encodeURIComponent(config.url)}&webdavUsername=${encodeURIComponent(config.username)}&paths=${encodeURIComponent(path)}`)
      if (response.ok) {
        const data = await response.json()
        if (data.hasData) {
          setPathStats(prev => new Map(prev).set(path, {
            path,
            total: data.total || 0,
            images: data.images || 0,
            videos: data.videos || 0,
            lastScan: new Date().toISOString()
          }))
        }
      }
    } catch (error) {
      console.error('刷新路径统计失败:', error)
    }
  }





  const removeSelectedPath = (path: string) => {
    const newSelected = new Set(selectedPaths)
    newSelected.delete(path)
    setSelectedPaths(newSelected)
    
    // 不删除统计信息，保留缓存数据以便重新添加时直接使用
  }

  // 强制删除路径缓存数据
  const forceRemovePathCache = (path: string) => {
    const newStats = new Map(pathStats)
    newStats.delete(path)
    setPathStats(newStats)
  }

  // 定时扫描相关函数
  const saveScheduledScan = async (scanData: any) => {
    try {
      const url = editingScan ? `/api/scheduled-scans/${editingScan.id}` : '/api/scheduled-scans'
      const method = editingScan ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scanData)
      })

      if (response.ok) {
        setScheduledScanDialogOpen(false)
        setEditingScan(null)
        loadScheduledScans()
        setSaveResult({
          type: 'success',
          message: editingScan ? '定时扫描任务更新成功' : '定时扫描任务创建成功'
        })
      } else {
        const error = await response.json()
        setSaveResult({
          type: 'error',
          message: error.error || '保存失败'
        })
      }
    } catch (error: any) {
      setSaveResult({
        type: 'error',
        message: `保存失败: ${error.message}`
      })
    }
  }

  const deleteScheduledScan = async (id: number) => {
    if (!confirm('确定要删除这个定时扫描任务吗？')) return
    
    try {
      const response = await fetch(`/api/scheduled-scans/${id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        loadScheduledScans()
        setSaveResult({
          type: 'success',
          message: '定时扫描任务删除成功'
        })
      } else {
        const error = await response.json()
        setSaveResult({
          type: 'error',
          message: error.error || '删除失败'
        })
      }
    } catch (error: any) {
      setSaveResult({
        type: 'error',
        message: `删除失败: ${error.message}`
      })
    }
  }

  const executeScheduledScan = async (id: number) => {
    try {
      const response = await fetch('/api/scheduled-scans/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: id })
      })

      if (response.ok) {
        const result = await response.json()
        const queuedPaths = Array.isArray(result.tasks) ? result.tasks.length : 0
        const queueLength = result.queueStatus?.queueLength ?? 0
        const isProcessing = Boolean(result.queueStatus?.isProcessing)

        setSaveResult({
          type: 'success',
          message: `扫描任务已加入队列：本次加入 ${queuedPaths} 个路径，当前队列长度 ${queueLength}${isProcessing ? '，队列正在处理中。' : '。'}`
        })
      } else {
        const error = await response.json()
        setSaveResult({
          type: 'error',
          message: error.error || '执行失败'
        })
      }
    } catch (error: any) {
      setSaveResult({
        type: 'error',
        message: `执行失败: ${error.message}`
      })
    }
  }

  // 设置默认配置
  const setDefaultConfig = async (url: string, username: string) => {
    try {
      const response = await fetch('/api/webdav-config/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, username })
      })

      if (response.ok) {
        setSaveResult({
          type: 'success',
          message: '默认配置设置成功'
        })
        // 重新加载所有配置
        loadAllConfigs()
        // 重新加载默认配置到表单
        const defaultResponse = await fetch('/api/webdav-config/default')
        if (defaultResponse.ok) {
          const dbConfig = await defaultResponse.json()
          if (dbConfig.url && dbConfig.username) {
            const normalizedDbConfig = normalizeWebdavConfig(dbConfig)
            setConfig(normalizedDbConfig)
            setSelectedPaths(new Set(normalizedDbConfig.mediaPaths || []))
            loadScanCache(normalizedDbConfig)
          }
        }
      } else {
        const error = await response.json()
        setSaveResult({
          type: 'error',
          message: error.error || '设置默认配置失败'
        })
      }
    } catch (error: any) {
      setSaveResult({
        type: 'error',
        message: `设置默认配置失败: ${error.message}`
      })
    }
  }

  // 删除配置
  const deleteConfig = async (url: string, username: string) => {
    if (!confirm(`确定要删除配置 ${url} (${username}) 吗？`)) return

    try {
      const response = await fetch(`/api/webdav-config?url=${encodeURIComponent(url)}&username=${encodeURIComponent(username)}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        setSaveResult({
          type: 'success',
          message: '配置删除成功'
        })
        // 重新加载所有配置
        loadAllConfigs()
        // 如果删除的是当前配置，清空表单
        if (config.url === url && config.username === username) {
          setConfig(createDefaultWebdavConfig())
          setSelectedPaths(new Set())
        }
      } else {
        const error = await response.json()
        setSaveResult({
          type: 'error',
          message: error.error || '删除配置失败'
        })
      }
    } catch (error: any) {
      setSaveResult({
        type: 'error',
        message: `删除配置失败: ${error.message}`
      })
    }
  }

  // 加载指定配置到表单
  const loadConfigToForm = (configData: any) => {
    const normalizedConfigData = normalizeWebdavConfig(configData)
    setConfig(normalizedConfigData)
    setSelectedPaths(new Set(normalizedConfigData.mediaPaths || []))
    setConfigListDialogOpen(false)
    
    // 加载扫描缓存
    loadScanCache(normalizedConfigData)
  }

  // 新建配置
  const createNewConfig = () => {
    setConfig(createDefaultWebdavConfig())
    setSelectedPaths(new Set())
    setIsNewConfig(true)
    setConfigListDialogOpen(false)
  }

  // 复制配置
  const copyConfig = (configData: any) => {
    const normalizedConfigData = normalizeWebdavConfig(configData)
    setConfig(normalizedConfigData)
    setSelectedPaths(new Set(normalizedConfigData.mediaPaths || []))
    setIsNewConfig(true)
    setConfigListDialogOpen(false)
    
    // 加载扫描缓存（如果有的话）
    loadScanCache(normalizedConfigData)
    
    setSaveResult({
      type: 'info',
      message: '配置已复制，请修改后保存为新配置'
    })
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => router.push('/')}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h4" component="h1" fontWeight="bold">
            WebDAV 配置
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<SettingsIcon />}
            onClick={async () => {
              console.log('🔄 打开配置管理对话框，刷新配置列表...')
              await loadAllConfigs()
              console.log('✅ 配置列表刷新完成，打开对话框')
              setConfigListDialogOpen(true)
            }}
          >
            配置管理 ({allConfigs.length})
          </Button>
          <Button
            variant="outlined"
            startIcon={<ManageAccountsIcon />}
            onClick={() => router.push('/manage')}
          >
            评价与分类管理
          </Button>
        </Box>
      </Box>

      <Paper elevation={3} sx={{ p: 4, borderRadius: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, value) => setActiveTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{
            mb: 3,
            minHeight: 48,
            '& .MuiTabs-flexContainer': {
              flexWrap: 'nowrap',
            },
            '& .MuiTab-root': {
              minHeight: 48,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            },
            '& .MuiTabs-scrollButtons.Mui-disabled': {
              opacity: 0.3,
            },
          }}
        >
          <Tab label="MySQL 配置" value="mysql" />
          <Tab label="WebDAV 配置" value="webdav" />
          <Tab label="定时扫描配置" value="scheduled" />
          <Tab label="扫描目录配置" value="directories" />
        </Tabs>

        {activeTab === 'mysql' && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <SettingsIcon color="primary" sx={{ fontSize: 32 }} />
                <Box>
                  <Typography variant="h6">MySQL 配置</Typography>
                  <Typography variant="body2" color="text.secondary">
                    单独保存数据库连接配置，供应用启动与重启后自动读取
                  </Typography>
                </Box>
              </Box>
            </Box>

            <Divider sx={{ mb: 3 }} />

            <Box sx={{ mt: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    当前来源: {mysqlConfigSource === 'file' ? '配置文件' : mysqlConfigSource === 'env' ? '环境变量' : '未配置'}
                  </Typography>
                  {mysqlConfigFilePath && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      配置文件: {mysqlConfigFilePath}
                    </Typography>
                  )}
                </Box>
                {loadingMysqlConfig && <CircularProgress size={20} />}
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
                  <TextField
                    label="MySQL 主机"
                    placeholder="127.0.0.1"
                    fullWidth
                    value={mysqlConfig.host}
                    onChange={handleMysqlChange('host')}
                    helperText="外部 MySQL 服务器主机名或 IP"
                    required
                  />
                  <TextField
                    label="MySQL 端口"
                    type="number"
                    fullWidth
                    value={mysqlConfig.port}
                    onChange={handleMysqlChange('port')}
                    inputProps={{ min: 1, max: 65535 }}
                    helperText="默认 3306"
                    required
                  />
                </Box>

                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
                  <TextField
                    label="MySQL 用户名"
                    fullWidth
                    value={mysqlConfig.user}
                    onChange={handleMysqlChange('user')}
                    required
                  />
                  <TextField
                    label="MySQL 密码"
                    type="password"
                    fullWidth
                    value={mysqlConfig.password}
                    onChange={handleMysqlChange('password')}
                    required
                  />
                </Box>

                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
                  <TextField
                    label="数据库名"
                    fullWidth
                    value={FIXED_MYSQL_DATABASE}
                    InputProps={{ readOnly: true }}
                    disabled
                    required
                    helperText="当前版本固定使用该数据库名，不支持修改"
                  />
                  <TextField
                    label="连接池大小"
                    type="number"
                    fullWidth
                    value={mysqlConfig.connectionLimit}
                    onChange={handleMysqlChange('connectionLimit')}
                    inputProps={{ min: 1, max: 100 }}
                    helperText="默认 10"
                  />
                </Box>

                <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
                  <TextField
                    label="字符集"
                    fullWidth
                    value={mysqlConfig.charset}
                    onChange={handleMysqlChange('charset')}
                  />
                  <TextField
                    label="时区"
                    fullWidth
                    value={mysqlConfig.timezone}
                    onChange={handleMysqlChange('timezone')}
                    helperText="例如 +08:00"
                  />
                </Box>
              </Box>
            </Box>
          </>
        )}

        {activeTab !== 'mysql' && webdavLoadError && (
          <Alert severity="warning" sx={{ mb: 3 }}>
            WebDAV 配置暂未成功从数据库加载：{webdavLoadError}。你仍然可以先切到 MySQL Tab 单独保存数据库配置。
          </Alert>
        )}

        {activeTab === 'webdav' && (
          <>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <SettingsIcon color="primary" sx={{ fontSize: 32 }} />
            <Box>
              <Typography variant="h6">WebDAV 连接设置</Typography>
              <Typography variant="body2" color="text.secondary">
                配置您的 WebDAV 服务器连接信息
              </Typography>
            </Box>
          </Box>
          {allConfigs.length > 0 && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={createNewConfig}
            >
              新建配置
            </Button>
          )}
        </Box>

        <Divider sx={{ mb: 3 }} />

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <TextField
            label="WebDAV 服务器地址"
            placeholder="https://example.com/webdav"
            fullWidth
            value={config.url}
            onChange={handleChange('url')}
            helperText="WebDAV 服务器的完整 URL 地址"
            required
          />

          <TextField
            select
            label="源类型"
            fullWidth
            value={config.sourceType || 'clouddrive2'}
            onChange={(e) => {
              setConfig({ ...config, sourceType: e.target.value as 'clouddrive2' | 'openlist' })
              setTestResult(null)
              setSaveResult(null)
            }}
            helperText="选择 WebDAV 服务的源类型，不同源的 URL 构建方式不同"
            required
          >
            <MenuItem value="clouddrive2">CloudDrive2</MenuItem>
            <MenuItem value="openlist">OpenList</MenuItem>
          </TextField>

          <TextField
            label="用户名"
            placeholder="your-username"
            fullWidth
            value={config.username}
            onChange={handleChange('username')}
            required
          />

          <TextField
            label="密码"
            type={showPassword ? 'text' : 'password'}
            placeholder="your-password"
            fullWidth
            value={config.password}
            onChange={handleChange('password')}
            required
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                  >
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          {/* 直链源 URL */}
          <TextField
            label="直链源 URL"
            placeholder="http://192.168.133.131:5244"
            fullWidth
            value={config.directLinkUrl || ''}
            onChange={(e) => {
              setConfig({ ...config, directLinkUrl: e.target.value })
            }}
            helperText="用于直链播放的服务器地址。OpenList 的直链播放免费，推荐使用 OpenList 作为直链源。如果不填写，默认使用当前 WebDAV URL"
            sx={{ mt: 2 }}
          />

          {/* 启用直链播放开关 */}
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={config.enableDirectLink || false}
                  onChange={(e) => {
                    setConfig({ ...config, enableDirectLink: e.target.checked })
                  }}
                  disabled={!config.directLinkUrl}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight="medium">
                    启用直链播放
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    直链播放暂时只支持 OpenList，使用前需要配置直链源和 Nginx 反向代理
                    {!config.directLinkUrl && ' (请先配置直链源 URL)'}
                    {config.sourceType === 'openlist' && config.directLinkUrl && ' (OpenList 源推荐开启)'}
                  </Typography>
                </Box>
              }
            />
          </Box>

        </Box>
        </>
        )}

        {activeTab === 'scheduled' && (
          <>
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                  定时扫描设置
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => {
                    setEditingScan(null)
                    setScheduledScanDialogOpen(true)
                  }}
                >
                  添加定时扫描
                </Button>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                设置定时扫描任务，通过cron表达式配置执行频率，系统将自动执行扫描并更新缓存
              </Typography>
              
              <Alert severity="success" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  ✅ 内置调度器已启用，无需额外配置。系统会根据任务频率自动调整检查间隔，确保精确执行。
                </Typography>
                {schedulerStatus && (
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    调度器状态: {schedulerStatus.status?.isRunning ? '运行中' : '已停止'} | 
                    检查间隔: {schedulerStatus.status?.checkIntervalMinutes || 5}分钟 | 
                    最后检查: {schedulerStatus.timestamp ? new Date(schedulerStatus.timestamp).toLocaleString('zh-CN') : '未知'}
                  </Typography>
                )}
              </Alert>
              
              {loadingScans ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : scheduledScans.length === 0 ? (
                <Alert severity="info">
                  暂无定时扫描任务，点击"添加定时扫描"创建第一个任务
                </Alert>
              ) : (
                <Stack spacing={1}>
                  {scheduledScans.map((scan) => (
                    <Card key={scan.id} variant="outlined">
                      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body1" fontWeight="medium">
                              {scan.webdav_url}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              路径: {safeJsonParse(scan.media_paths, []).join(', ') || '未设置'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              执行时间: {scan.cron_expression} | 
                              状态: {scan.is_active ? '启用' : '禁用'} |
                              下次运行: {scan.next_run ? new Date(scan.next_run).toLocaleString('zh-CN') : '未设置'}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <IconButton
                              size="small"
                              onClick={() => executeScheduledScan(scan.id)}
                              color="primary"
                              title="手动执行扫描"
                            >
                              <RefreshIcon />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => {
                                setEditingScan(scan)
                                setScheduledScanDialogOpen(true)
                              }}
                            >
                              <SettingsIcon />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => deleteScheduledScan(scan.id)}
                              color="error"
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              )}
            </Box>
          </>
        )}

        {activeTab === 'directories' && (
          <>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                扫描设置
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                递归扫描将扫描所有子目录，无深度和文件数量限制
              </Typography>
              
              <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
                <TextField
                  label="批次大小"
                  type="number"
                  value={config.scanSettings?.batchSize ?? 10}
                  onChange={(e) => {
                    const value = e.target.value
                    setConfig({
                      ...config,
                      scanSettings: {
                        ...config.scanSettings,
                        batchSize: value
                      }
                    })
                  }}
                  onBlur={(e) => {
                    setConfig({
                      ...config,
                      scanSettings: {
                        ...config.scanSettings,
                        batchSize: normalizeBatchSize(e.target.value)
                      }
                    })
                  }}
                  helperText="兼容旧版本的批次大小设置，影响每批处理目录数量"
                  inputProps={{ min: 5, max: 100 }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="并发数"
                  type="number"
                  value={config.scanSettings?.concurrency ?? 10}
                  onChange={(e) => {
                    const value = e.target.value
                    setConfig({
                      ...config,
                      scanSettings: {
                        ...config.scanSettings,
                        concurrency: value
                      }
                    })
                  }}
                  onBlur={(e) => {
                    const value = e.target.value
                    const numValue = parseInt(value)
                    if (value === '' || isNaN(numValue) || numValue < 5) {
                      setConfig({
                        ...config,
                        scanSettings: {
                          ...config.scanSettings,
                          concurrency: 10
                        }
                      })
                    } else {
                      setConfig({
                        ...config,
                        scanSettings: {
                          ...config.scanSettings,
                          concurrency: numValue
                        }
                      })
                    }
                  }}
                  helperText="同时发起的请求数量，影响扫描速度"
                  inputProps={{ min: 5, max: 50 }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="超时时间(秒)"
                  type="number"
                  value={Math.floor(Number(config.scanSettings?.timeout ?? 60000) / 1000)}
                  onChange={(e) => {
                    const secondsValue = e.target.value
                    setConfig({
                      ...config,
                      scanSettings: {
                        ...config.scanSettings,
                        timeout: secondsValue === '' ? '' : String((parseInt(secondsValue, 10) || 60) * 1000)
                      }
                    })
                  }}
                  onBlur={(e) => {
                    const seconds = parseInt(e.target.value, 10)
                    setConfig({
                      ...config,
                      scanSettings: {
                        ...config.scanSettings,
                        timeout: normalizeTimeout((Number.isFinite(seconds) ? seconds : 60) * 1000)
                      }
                    })
                  }}
                  helperText="兼容旧版本的扫描超时设置"
                  inputProps={{ min: 10, max: 300 }}
                  sx={{ flex: 1 }}
                />
              </Box>

              <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' }, mt: 2 }}>
                <TextField
                  label="预加载数量"
                  select
                  value={config.scanSettings?.preloadCount ?? 10}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      scanSettings: {
                        ...config.scanSettings,
                        preloadCount: normalizePreloadCount(e.target.value)
                      }
                    })
                  }}
                  helperText="仅允许选择固定值：10、20、30...100，避免保存异常预加载数量"
                  sx={{ flex: 1 }}
                >
                  {PRELOAD_COUNT_OPTIONS.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            </Box>

            <Divider sx={{ my: 3 }} />

            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">已选择的目录 ({selectedPaths.size})</Typography>
                <Button
                  variant="outlined"
                  startIcon={<FolderOpenIcon />}
                  onClick={openBrowseDialog}
                  disabled={!config.url || !config.username || !config.password}
                >
                  浏览并选择目录
                </Button>
              </Box>

              {rateLimited && rateLimitedUntil && (
                <Alert 
                  severity="warning" 
                  sx={{ mb: 2 }}
                  action={
                    <Button 
                      color="inherit" 
                      size="small"
                      onClick={async () => {
                        try {
                          await fetch('/api/webdav/recursive-scan', { method: 'DELETE' })
                          setRateLimited(false)
                          setRateLimitedUntil(null)
                          setTestResult({ type: 'success', message: '风控状态已重置' })
                        } catch (error) {
                          setTestResult({ type: 'error', message: '重置风控状态失败' })
                        }
                      }}
                    >
                      手动恢复
                    </Button>
                  }
                >
                  ⚠️ 检测到风控限制！扫描任务暂停至 {new Date(rateLimitedUntil).toLocaleString()}
                  （连续多次扫描失败，系统自动退避等待）
                </Alert>
              )}

              {selectedPaths.size > 0 && (
                <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      Array.from(selectedPaths).forEach(path => {
                        if (!pathStats.has(path)) {
                          startRecursiveScan(path, true)
                        }
                      })
                    }}
                    disabled={Array.from(selectedPaths).some(path => scanning.has(path))}
                  >
                    扫描未缓存目录
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    onClick={() => {
                      Array.from(selectedPaths).forEach(path => {
                        startRecursiveScan(path, true)
                      })
                    }}
                    disabled={Array.from(selectedPaths).some(path => scanning.has(path))}
                  >
                    强制扫描全部
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={() => {
                      setSelectedPaths(new Set())
                      setPathStats(new Map())
                    }}
                  >
                    清空所有
                  </Button>
                </Box>
              )}

              {selectedPaths.size === 0 ? (
                <Alert severity="info">
                  尚未选择任何目录，请点击"浏览并选择目录"按钮来选择要挂载的媒体目录
                </Alert>
              ) : (
                <Stack spacing={1}>
                  {Array.from(selectedPaths).map(path => {
                    const stats = pathStats.get(path)
                    const isScanning = scanning.has(path)
                    const progress = scanProgress.get(path)
                    
                    return (
                      <DirectoryItem
                        key={path}
                        path={path}
                        stats={stats}
                        isScanning={isScanning}
                        scanProgress={progress}
                        webdavConfig={{
                          url: config.url,
                          username: config.username
                        }}
                        onRecursiveScan={startRecursiveScan}
                        onRemove={removeSelectedPath}
                        onForceRemoveCache={forceRemovePathCache}
                      />
                    )
                  })}
                </Stack>
              )}
            </Box>
          </>
        )}

        {(activeTab === 'webdav' || activeTab === 'mysql' || activeTab === 'directories') && <Divider sx={{ my: 3 }} />}

        <Divider sx={{ my: 3 }} />

        {testResult && (
          <Alert severity={testResult.type} sx={{ mb: 2 }}>
            {testResult.message}
          </Alert>
        )}

        {saveResult && (
          <Alert severity={saveResult.type} sx={{ mb: 2 }}>
            {saveResult.message}
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 2 }}>
          {activeTab === 'mysql' ? (
            <Button
              variant="contained"
              fullWidth
              onClick={saveMysqlConfig}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
            >
              {saving ? '保存中...' : '保存 MySQL 配置'}
            </Button>
          ) : activeTab === 'webdav' ? (
            <>
              <Button
                variant="outlined"
                fullWidth
                onClick={testConnection}
                disabled={testing || saving}
                startIcon={testing ? <CircularProgress size={20} /> : <CheckCircleIcon />}
              >
                {testing ? '测试中...' : '测试连接'}
              </Button>
              <Button
                variant="contained"
                fullWidth
                onClick={() => saveConfig('WebDAV 连接配置已保存！')}
                disabled={testing || saving}
                startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
              >
                {saving ? '保存中...' : '保存 WebDAV 配置'}
              </Button>
            </>
          ) : activeTab === 'directories' ? (
            <Button
              variant="contained"
              fullWidth
              onClick={() => saveConfig('扫描目录与扫描设置已保存！')}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
            >
              {saving ? '保存中...' : '保存扫描目录配置'}
            </Button>
          ) : activeTab === 'scheduled' ? (
            <Alert severity="info" sx={{ width: '100%' }}>
              定时扫描配置通过当前 Tab 内的“添加定时扫描”或编辑按钮分别独立保存。
            </Alert>
          ) : (
            <>
              <Button
                variant="outlined"
                fullWidth
                onClick={testConnection}
                disabled={testing || saving}
                startIcon={testing ? <CircularProgress size={20} /> : <CheckCircleIcon />}
              >
                {testing ? '测试中...' : '测试连接'}
              </Button>
              <Button
                variant="contained"
                fullWidth
                onClick={() => saveConfig()}
                disabled={testing || saving}
                startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
              >
                {saving ? '保存中...' : '保存 WebDAV 配置'}
              </Button>
            </>
          )}
        </Box>

        <Box sx={{ mt: 3, p: 2, backgroundColor: 'grey.100', borderRadius: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            <strong>提示：</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            • 支持选择多个目录进行挂载
            <br />
            • 点击"浏览并选择目录"可以可视化选择要挂载的目录
            <br />
            • 系统会自动扫描每个目录中的媒体文件数量
            <br />
            • 随机预览时将从所有已选择的目录中随机选择文件
          </Typography>
        </Box>
      </Paper>

      {/* 目录浏览对话框 */}
      <Dialog
        open={browseDialogOpen}
        onClose={() => setBrowseDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FolderOpenIcon color="primary" />
            浏览并选择目录
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {/* 面包屑导航 */}
          <Breadcrumbs
            separator={<NavigateNextIcon fontSize="small" />}
            sx={{ mb: 2 }}
          >
            {getPathParts(currentPath).map((part, index, array) => (
              <Link
                key={part.path}
                component="button"
                variant="body2"
                onClick={() => navigateToPath(part.path)}
                underline="hover"
                color={index === array.length - 1 ? 'text.primary' : 'inherit'}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontWeight: index === array.length - 1 ? 'bold' : 'normal',
                }}
              >
                {index === 0 && <HomeIcon fontSize="small" />}
                {part.name}
              </Link>
            ))}
          </Breadcrumbs>

          {/* 当前路径选择 */}
          <Card
            variant="outlined"
            sx={{
              mb: 2,
              backgroundColor: selectedPaths.has(currentPath) ? 'primary.50' : 'transparent',
              borderColor: selectedPaths.has(currentPath) ? 'primary.main' : 'divider',
            }}
          >
            <ListItemButton
              onClick={() => togglePathSelection(currentPath)}
            >
              <ListItemIcon>
                <Checkbox
                  checked={selectedPaths.has(currentPath)}
                  tabIndex={-1}
                  disableRipple
                />
              </ListItemIcon>
              <ListItemIcon>
                <FolderIcon color="primary" />
              </ListItemIcon>
              <ListItemText
                primary={`选择当前目录: ${currentPath}`}
                secondary={
                  scanning.has(currentPath)
                    ? '正在扫描...'
                    : pathStats.has(currentPath)
                    ? `${pathStats.get(currentPath)?.total} 个媒体文件`
                    : '点击选择此目录'
                }
              />
            </ListItemButton>
          </Card>

          {/* 批量操作按钮 */}
          {directories.length > 0 && (
            <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  const newSelected = new Set(selectedPaths)
                  directories.forEach(dir => {
                    newSelected.add(dir.filename)
                    if (!pathStats.has(dir.filename)) {
                      startRecursiveScan(dir.filename)
                    }
                  })
                  setSelectedPaths(newSelected)
                }}
                disabled={browsing}
              >
                全选当前目录
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  const newSelected = new Set(selectedPaths)
                  directories.forEach(dir => {
                    newSelected.delete(dir.filename)
                    // 不删除统计信息，保留缓存数据以便重新添加时直接使用
                  })
                  setSelectedPaths(newSelected)
                }}
              >
                取消全选
              </Button>
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={() => startRecursiveScan(currentPath)}
                disabled={browsing}
              >
                递归扫描当前目录
              </Button>
            </Box>
          )}

          <Divider sx={{ my: 2 }} />

          {browsing ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : directories.length === 0 ? (
            <Alert severity="info">此目录下没有子目录</Alert>
          ) : (
            <List>
              {directories.map(dir => (
                <ListItem
                  key={dir.filename}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                    border: '1px solid #e0e0e0',
                  }}
                >
                  <ListItemIcon>
                    <Checkbox
                      checked={selectedPaths.has(dir.filename)}
                      onChange={() => togglePathSelection(dir.filename)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemIcon>
                    <FolderIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body1" sx={{ flex: 1 }}>
                          {dir.basename}
                        </Typography>
                        {scanning.has(dir.filename) && (
                          <CircularProgress size={16} />
                        )}
                        {pathStats.has(dir.filename) && !scanning.has(dir.filename) && (
                          <Chip
                            size="small"
                            label={`${pathStats.get(dir.filename)?.total || 0} 文件`}
                            color="primary"
                            variant="outlined"
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(dir.lastmod).toLocaleString('zh-CN')}
                        </Typography>
                        {scanning.has(dir.filename) && scanProgress.has(dir.filename) && (
                          <Typography variant="caption" color="primary" display="block">
                            扫描中: {scanProgress.get(dir.filename)?.currentPath}
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      size="small"
                      onClick={() => navigateToPath(dir.filename)}
                    >
                      <NavigateNextIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBrowseDialogOpen(false)}>
            关闭
          </Button>
          <Button
            variant="contained"
            onClick={() => setBrowseDialogOpen(false)}
            disabled={selectedPaths.size === 0}
          >
            确定 ({selectedPaths.size} 个已选)
          </Button>
        </DialogActions>
      </Dialog>

      {/* 定时扫描对话框 */}
      <ScheduledScanDialog
        open={scheduledScanDialogOpen}
        onClose={() => {
          setScheduledScanDialogOpen(false)
          setEditingScan(null)
        }}
        onSave={saveScheduledScan}
        initialData={editingScan}
        config={config}
      />

      {/* 配置管理对话框 */}
      <Dialog
        open={configListDialogOpen}
        onClose={() => setConfigListDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SettingsIcon color="primary" />
              WebDAV 配置管理
            </Box>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={createNewConfig}
            >
              新建配置
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {loadingConfigs ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : allConfigs.length === 0 ? (
            <Alert severity="info">
              暂无配置，点击"新建配置"创建第一个配置
            </Alert>
          ) : (
            <Stack spacing={2}>
              {allConfigs.map((cfg: any) => (
                <Card 
                  key={`${cfg.url}-${cfg.username}`}
                  variant="outlined"
                  sx={{
                    borderColor: cfg.isDefault ? 'primary.main' : 'divider',
                    borderWidth: cfg.isDefault ? 2 : 1,
                    backgroundColor: cfg.isDefault ? 'primary.50' : 'transparent',
                  }}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Typography variant="h6" component="div">
                            {cfg.url}
                          </Typography>
                          {cfg.isDefault && (
                            <Chip 
                              label="默认" 
                              color="primary" 
                              size="small"
                              icon={<CheckCircleIcon />}
                            />
                          )}
                        </Box>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          用户名: {cfg.username}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          源类型: {cfg.sourceType === 'openlist' ? 'OpenList' : 'CloudDrive2'}
                        </Typography>
                        {cfg.directLinkUrl && (
                          <Typography variant="body2" color="text.secondary" gutterBottom>
                            直链源: {cfg.directLinkUrl}
                            {cfg.enableDirectLink && (
                              <Chip 
                                label="直链已启用" 
                                color="success" 
                                size="small" 
                                sx={{ ml: 1 }}
                              />
                            )}
                          </Typography>
                        )}
                        <Typography variant="caption" color="text.secondary">
                          媒体路径: {cfg.mediaPaths?.join(', ') || '未设置'} ({cfg.mediaPaths?.length || 0} 个)
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 2 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => loadConfigToForm(cfg)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="info"
                          startIcon={<ContentCopyIcon />}
                          onClick={() => copyConfig(cfg)}
                        >
                          复制
                        </Button>
                        {!cfg.isDefault && (
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            onClick={() => setDefaultConfig(cfg.url, cfg.username)}
                          >
                            设为默认
                          </Button>
                        )}
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          onClick={() => deleteConfig(cfg.url, cfg.username)}
                        >
                          删除
                        </Button>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfigListDialogOpen(false)}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  )
}
