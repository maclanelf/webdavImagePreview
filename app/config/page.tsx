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
  IconButton,
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
} from '@mui/icons-material'
import { ListItemButton } from '@mui/material'
import { useRouter } from 'next/navigation'

interface WebDAVConfig {
  url: string
  username: string
  password: string
  mediaPaths: string[]
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
}

export default function ConfigPage() {
  const router = useRouter()
  const [config, setConfig] = useState<WebDAVConfig>({
    url: '',
    username: '',
    password: '',
    mediaPaths: ['/'],
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
      } catch (e) {
        console.error('加载配置失败:', e)
      }
    }
  }, [])

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

  const scanDirectory = async (path: string) => {
    setScanning(prev => new Set(prev).add(path))
    try {
      const response = await fetch('/api/webdav/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: config.url,
          username: config.username,
          password: config.password,
          path,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setPathStats(prev => new Map(prev).set(path, data))
      }
    } catch (error) {
      console.error('扫描目录失败:', error)
    } finally {
      setScanning(prev => {
        const newSet = new Set(prev)
        newSet.delete(path)
        return newSet
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

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={() => router.push('/')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" component="h1" fontWeight="bold">
          WebDAV 配置
        </Typography>
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

          {selectedPaths.size === 0 ? (
            <Alert severity="info">
              尚未选择任何目录，请点击"浏览并选择目录"按钮来选择要挂载的媒体目录
            </Alert>
          ) : (
            <Stack spacing={1}>
              {Array.from(selectedPaths).map(path => {
                const stats = pathStats.get(path)
                const isScanning = scanning.has(path)
                
                return (
                  <Card key={path} variant="outlined">
                    <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
                          <FolderIcon color="primary" />
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body1" fontWeight="medium">
                              {path}
                            </Typography>
                            {isScanning && (
                              <Typography variant="caption" color="text.secondary">
                                正在扫描...
                              </Typography>
                            )}
                            {stats && !isScanning && (
                              <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                                <Chip
                                  size="small"
                                  icon={<ImageIcon />}
                                  label={`${stats.images} 图片`}
                                  variant="outlined"
                                />
                                <Chip
                                  size="small"
                                  icon={<VideoIcon />}
                                  label={`${stats.videos} 视频`}
                                  variant="outlined"
                                />
                                <Chip
                                  size="small"
                                  label={`共 ${stats.total} 个`}
                                  variant="outlined"
                                />
                              </Box>
                            )}
                          </Box>
                        </Box>
                        <IconButton
                          size="small"
                          onClick={() => removeSelectedPath(path)}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Box>
                    </CardContent>
                  </Card>
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
                <ListItemButton
                  key={dir.filename}
                  onClick={() => navigateToPath(dir.filename)}
                  sx={{
                    borderRadius: 1,
                    mb: 0.5,
                  }}
                >
                  <ListItemIcon>
                    <FolderIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={dir.basename}
                    secondary={new Date(dir.lastmod).toLocaleString('zh-CN')}
                  />
                  <NavigateNextIcon color="action" />
                </ListItemButton>
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
    </Container>
  )
}
