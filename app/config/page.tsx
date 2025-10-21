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
  scanSettings?: {
    maxDepth: number
    maxFiles: number
    timeout: number
  }
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

export default function ConfigPage() {
  const router = useRouter()
  const [config, setConfig] = useState<WebDAVConfig>({
    url: '',
    username: '',
    password: '',
    mediaPaths: ['/'],
    scanSettings: {
      maxDepth: 10,
      maxFiles: 200000,
      timeout: 60000
    }
  })
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  const [saveResult, setSaveResult] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  
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
    percentage?: number
  }>>(new Map())
  
  // 定时扫描相关状态
  const [scheduledScans, setScheduledScans] = useState<any[]>([])
  const [scheduledScanDialogOpen, setScheduledScanDialogOpen] = useState(false)
  const [editingScan, setEditingScan] = useState<any>(null)
  const [loadingScans, setLoadingScans] = useState(false)
  const [schedulerStatus, setSchedulerStatus] = useState<any>(null)

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

  useEffect(() => {
    // 加载已保存的配置
    const savedConfig = localStorage.getItem('webdav_config')
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig)
        // 兼容旧版本配置
        if (parsed.mediaPath && !parsed.mediaPaths) {
          parsed.mediaPaths = [parsed.mediaPath]
        }
        setConfig(parsed)
        setSelectedPaths(new Set(parsed.mediaPaths || []))
        
        // 加载扫描缓存数据
        loadScanCache(parsed)
      } catch (e) {
        console.error('加载配置失败:', e)
      }
    }
    
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

  const saveConfig = () => {
    if (!config.url || !config.username || !config.password) {
      setSaveResult({
        type: 'error',
        message: '请填写完整的连接信息',
      })
      return
    }

    if (selectedPaths.size === 0) {
      setSaveResult({
        type: 'error',
        message: '请至少选择一个媒体目录',
      })
      return
    }

    setSaving(true)
    setSaveResult(null)

    try {
      const configToSave = {
        ...config,
        mediaPaths: Array.from(selectedPaths),
      }
      localStorage.setItem('webdav_config', JSON.stringify(configToSave))
      setSaveResult({
        type: 'success',
        message: '配置已保存！',
      })
      
      setTimeout(() => {
        router.push('/')
      }, 1500)
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
      // 删除统计信息
      const newStats = new Map(pathStats)
      newStats.delete(path)
      setPathStats(newStats)
    } else {
      newSelected.add(path)
      // 自动扫描该目录
      scanDirectory(path)
    }
    setSelectedPaths(newSelected)
  }

  const scanDirectory = async (path: string, forceRescan = false) => {
    const startTime = Date.now()
    const progressId = `${path}_${Date.now()}` // 生成唯一的进度ID
    setScanning(prev => new Set(prev).add(path))
    setScanProgress(prev => new Map(prev).set(path, { 
      currentPath: path, 
      fileCount: 0, 
      startTime,
      scannedDirectories: 0,
      totalDirectories: 0,
      percentage: 0
    }))
    
    // 启动进度轮询
    const progressInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/webdav/scan?progressId=${progressId}`)
        if (response.ok) {
          const progress = await response.json()
          setScanProgress(prev => new Map(prev).set(path, {
            currentPath: progress.currentPath,
            fileCount: progress.fileCount,
            startTime,
            scannedDirectories: progress.scannedDirectories,
            totalDirectories: progress.totalDirectories,
            percentage: progress.percentage
          }))
        }
      } catch (error) {
        // 忽略进度获取错误
      }
    }, 500) // 每500ms更新一次进度
    
    try {
      const response = await fetch('/api/webdav/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.url,
          username: config.username,
          password: config.password,
          path,
          maxDepth: config.scanSettings?.maxDepth || 10,
          maxFiles: config.scanSettings?.maxFiles || 200000,
          timeout: config.scanSettings?.timeout || 60000,
          forceRescan,
          progressId
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setPathStats(prev => new Map(prev).set(path, {
          ...data,
          lastScan: new Date().toISOString()
        }))
        
        // 显示缓存状态
        if (data.scanInfo?.fromCache) {
          console.log(`从缓存加载: ${path} (最后扫描: ${data.scanInfo.lastScan})`)
        } else {
          console.log(`重新扫描完成: ${path}`)
        }
      } else {
        const error = await response.json()
        console.error('扫描目录失败:', error.error)
        setTestResult({
          type: 'error',
          message: `扫描目录 ${path} 失败: ${error.error}`
        })
      }
    } catch (error: any) {
      console.error('扫描目录失败:', error)
      setTestResult({
        type: 'error',
        message: `扫描目录 ${path} 失败: ${error.message}`
      })
    } finally {
      clearInterval(progressInterval)
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
  }

  const removeSelectedPath = (path: string) => {
    const newSelected = new Set(selectedPaths)
    newSelected.delete(path)
    setSelectedPaths(newSelected)
    
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
        setSaveResult({
          type: 'success',
          message: `扫描执行成功！扫描了 ${result.result?.scannedPaths || 0} 个路径，找到 ${result.result?.totalFiles || 0} 个文件`
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
        <Button
          variant="outlined"
          startIcon={<ManageAccountsIcon />}
          onClick={() => router.push('/manage')}
        >
          评价与分类管理
        </Button>
      </Box>

      <Paper elevation={3} sx={{ p: 4, borderRadius: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <SettingsIcon color="primary" sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="h6">连接设置</Typography>
            <Typography variant="body2" color="text.secondary">
              配置您的 WebDAV 服务器连接信息
            </Typography>
          </Box>
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
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* 扫描设置 */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            扫描设置
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            配置深度扫描的参数，适用于包含大量子目录的情况
          </Typography>
          
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
            <TextField
              label="最大扫描深度"
              type="number"
              value={config.scanSettings?.maxDepth || 10}
              onChange={(e) => setConfig({
                ...config,
                scanSettings: {
                  maxDepth: parseInt(e.target.value) || 10,
                  maxFiles: config.scanSettings?.maxFiles || 200000,
                  timeout: config.scanSettings?.timeout || 60000
                }
              })}
              helperText="递归扫描的最大目录层级深度"
              inputProps={{ min: 1, max: 20 }}
              sx={{ flex: 1 }}
            />
            
            <TextField
              label="最大文件数量"
              type="number"
              value={config.scanSettings?.maxFiles || 200000}
              onChange={(e) => setConfig({
                ...config,
                scanSettings: {
                  maxDepth: config.scanSettings?.maxDepth || 10,
                  maxFiles: parseInt(e.target.value) || 200000,
                  timeout: config.scanSettings?.timeout || 60000
                }
              })}
              helperText="扫描的最大文件数量限制"
              inputProps={{ min: 100, max: 500000 }}
              sx={{ flex: 1 }}
            />
            
            <TextField
              label="超时时间(秒)"
              type="number"
              value={Math.floor((config.scanSettings?.timeout || 60000) / 1000)}
              onChange={(e) => setConfig({
                ...config,
                scanSettings: {
                  maxDepth: config.scanSettings?.maxDepth || 10,
                  maxFiles: config.scanSettings?.maxFiles || 200000,
                  timeout: (parseInt(e.target.value) || 60) * 1000
                }
              })}
              helperText="扫描超时时间"
              inputProps={{ min: 10, max: 300 }}
              sx={{ flex: 1 }}
            />
          </Box>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* 定时扫描设置 */}
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
                          路径: {JSON.parse(scan.media_paths).join(', ')}
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

        <Divider sx={{ my: 3 }} />

        {/* 已选择的目录 */}
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

          {/* 批量操作 */}
          {selectedPaths.size > 0 && (
            <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  Array.from(selectedPaths).forEach(path => {
                    if (!pathStats.has(path)) {
                      scanDirectory(path)
                    }
                  })
                }}
                disabled={Array.from(selectedPaths).some(path => scanning.has(path))}
              >
                批量扫描
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                onClick={() => {
                  Array.from(selectedPaths).forEach(path => {
                    scanDirectory(path, true) // 强制重新扫描
                  })
                }}
                disabled={Array.from(selectedPaths).some(path => scanning.has(path))}
              >
                强制重新扫描
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
                    onRescan={(path, force) => scanDirectory(path, force)}
                    onRemove={removeSelectedPath}
                  />
                )
              })}
            </Stack>
          )}
        </Box>

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
            onClick={saveConfig}
            disabled={testing || saving || selectedPaths.size === 0}
            startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
          >
            {saving ? '保存中...' : '保存配置'}
          </Button>
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
            <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  const newSelected = new Set(selectedPaths)
                  directories.forEach(dir => {
                    newSelected.add(dir.filename)
                    if (!pathStats.has(dir.filename)) {
                      scanDirectory(dir.filename)
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
                    const newStats = new Map(pathStats)
                    newStats.delete(dir.filename)
                    setPathStats(newStats)
                  })
                  setSelectedPaths(newSelected)
                }}
              >
                取消全选
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
    </Container>
  )
}
