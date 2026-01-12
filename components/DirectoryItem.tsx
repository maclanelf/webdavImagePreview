import React, { useState } from 'react'
import {
  Card,
  CardContent,
  Box,
  Typography,
  IconButton,
  LinearProgress,
  Chip,
  Collapse,
  Stack,
  Divider,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Paper,
  Alert,
  CircularProgress
} from '@mui/material'
import {
  Folder as FolderIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Info as InfoIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  AccessTime as AccessTimeIcon,
  Storage as StorageIcon
} from '@mui/icons-material'

// 添加CSS动画
const spinKeyframes = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`

// 注入CSS
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = spinKeyframes
  document.head.appendChild(style)
}

interface PathStats {
  path: string
  total: number
  images: number
  videos: number
  lastScan?: string
}

interface ScanProgress {
  currentPath: string
  fileCount: number
  startTime?: number
  scannedDirectories?: number
  totalDirectories?: number
  percentage?: number
}

interface DirectoryItemProps {
  path: string
  stats?: PathStats
  isScanning: boolean
  scanProgress?: ScanProgress
  webdavConfig: {
    url: string
    username: string
  }
  onRecursiveScan?: (path: string, force?: boolean) => void
  onRemove: (path: string) => void
  onForceRemoveCache?: (path: string) => void
}

interface MigrationStatus {
  hasMigratedData: boolean
  migratedStats?: {
    total: number
    images: number
    videos: number
    viewed: number
  }
}

export default function DirectoryItem({
  path,
  stats,
  isScanning,
  scanProgress,
  webdavConfig,
  onRecursiveScan,
  onRemove,
  onForceRemoveCache
}: DirectoryItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [logDialogOpen, setLogDialogOpen] = useState(false)
  const [logs, setLogs] = useState<any[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null)
  const [migrating, setMigrating] = useState(false)
  const [migrationMessage, setMigrationMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const handleToggleExpanded = () => {
    setExpanded(!expanded)
    // 展开时检查迁移状态
    if (!expanded && !migrationStatus) {
      checkMigrationStatus()
    }
  }

  const checkMigrationStatus = async () => {
    try {
      const response = await fetch(`/api/scan-files/migrate?webdavUrl=${encodeURIComponent(webdavConfig.url)}&webdavUsername=${encodeURIComponent(webdavConfig.username)}`)
      if (response.ok) {
        const data = await response.json()
        const cacheInfo = data.caches?.find((c: any) => c.path === path)
        if (cacheInfo) {
          setMigrationStatus({
            hasMigratedData: cacheInfo.hasMigratedData,
            migratedStats: cacheInfo.migratedStats
          })
        }
      }
    } catch (error) {
      console.error('检查迁移状态失败:', error)
    }
  }

  const handleMigrate = async () => {
    setMigrating(true)
    setMigrationMessage(null)
    
    try {
      // 先获取 cacheId
      const statusResponse = await fetch(`/api/scan-files/migrate?webdavUrl=${encodeURIComponent(webdavConfig.url)}&webdavUsername=${encodeURIComponent(webdavConfig.username)}`)
      if (!statusResponse.ok) {
        throw new Error('获取缓存信息失败')
      }
      
      const statusData = await statusResponse.json()
      const cacheInfo = statusData.caches?.find((c: any) => c.path === path)
      
      if (!cacheInfo) {
        throw new Error('未找到该目录的缓存数据')
      }
      
      // 执行迁移
      const response = await fetch('/api/scan-files/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheId: cacheInfo.cacheId })
      })
      
      const result = await response.json()
      
      if (result.success) {
        setMigrationMessage({ type: 'success', text: result.message })
        // 刷新迁移状态
        await checkMigrationStatus()
      } else {
        setMigrationMessage({ type: 'error', text: result.message || '迁移失败' })
      }
    } catch (error: any) {
      setMigrationMessage({ type: 'error', text: error.message })
    } finally {
      setMigrating(false)
    }
  }

  const handleOpenDetail = () => {
    setDetailDialogOpen(true)
  }

  const handleCloseDetail = () => {
    setDetailDialogOpen(false)
  }

  const handleOpenLogs = async () => {
    setLogDialogOpen(true)
    setLoadingLogs(true)
    
    try {
      const response = await fetch(`/api/scan-logs?webdavUrl=${encodeURIComponent(webdavConfig.url)}&webdavUsername=${encodeURIComponent(webdavConfig.username)}&path=${encodeURIComponent(path)}`)
      if (response.ok) {
        const data = await response.json()
        setLogs(data.logs || [])
      }
    } catch (error) {
      console.error('获取日志失败:', error)
    } finally {
      setLoadingLogs(false)
    }
  }

  const handleCloseLogs = () => {
    setLogDialogOpen(false)
    setLogs([])
  }

  const handleClearLogs = async () => {
    try {
      const response = await fetch(`/api/scan-logs?webdavUrl=${encodeURIComponent(webdavConfig.url)}&webdavUsername=${encodeURIComponent(webdavConfig.username)}&path=${encodeURIComponent(path)}`, { method: 'DELETE' })
      if (response.ok) {
        setLogs([])
        alert('日志已清空')
      } else {
        alert('清空日志失败')
      }
    } catch (error) {
      console.error('清空日志失败:', error)
      alert('清空日志失败')
    }
  }

  const getScanStatus = () => {
    if (isScanning) {
      return {
        icon: <RefreshIcon sx={{ animation: 'spin 1s linear infinite' }} />,
        text: '扫描中',
        color: 'primary' as const
      }
    } else if (stats) {
      return {
        icon: <CheckCircleIcon />,
        text: '已完成',
        color: 'success' as const
      }
    } else {
      return {
        icon: <AccessTimeIcon />,
        text: '未扫描',
        color: 'warning' as const
      }
    }
  }

  const scanStatus = getScanStatus()

  return (
    <>
      <Card variant="outlined" sx={{ mb: 1 }}>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          {/* 主内容区域 */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
              <FolderIcon color="primary" />
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1" fontWeight="medium">
                  {path}
                </Typography>
                
                {/* 扫描状态和进度 */}
                <Box sx={{ mt: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {scanStatus.icon}
                      <Typography variant="caption" color={`${scanStatus.color}.main`}>
                        {scanStatus.text}
                      </Typography>
                    </Box>
                    
                    {isScanning && scanProgress && (
                      <Typography variant="caption" color="text.secondary">
                        {scanProgress.fileCount} 个文件
                      </Typography>
                    )}
                  </Box>

                  {/* 扫描进度条 */}
                  {isScanning && (
                    <Box sx={{ width: '100%', mb: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          扫描进度
                        </Typography>
                        <Typography variant="caption" color="primary.main" fontWeight="bold">
                          {scanProgress?.percentage || 0}%
                        </Typography>
                      </Box>
                      <LinearProgress 
                        variant="determinate" 
                        value={scanProgress?.percentage || 0}
                        sx={{ 
                          height: 6, 
                          borderRadius: 3,
                          backgroundColor: 'grey.200',
                          '& .MuiLinearProgress-bar': {
                            borderRadius: 3,
                            transition: 'transform 0.3s ease-in-out'
                          }
                        }} 
                      />
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          目录: {scanProgress?.scannedDirectories || 0}/{scanProgress?.totalDirectories || '?'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          文件: {scanProgress?.fileCount || 0}
                        </Typography>
                      </Box>
                      {scanProgress && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                          当前路径: {scanProgress.currentPath}
                        </Typography>
                      )}
                    </Box>
                  )}

                  {/* 统计信息 */}
                  {stats && !isScanning && (
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        icon={<ImageIcon />}
                        label={`${stats.images} 图片`}
                        color="primary"
                        variant="outlined"
                      />
                      <Chip
                        size="small"
                        icon={<VideoIcon />}
                        label={`${stats.videos} 视频`}
                        color="secondary"
                        variant="outlined"
                      />
                      <Chip
                        size="small"
                        label={`总计 ${stats.total}`}
                        variant="outlined"
                      />
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>

            {/* 操作按钮 - 移动端优化 */}
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: { xs: 0.5, sm: 1 },
              flexShrink: 0
            }}>
              {/* 桌面端显示详情和刷新按钮 */}
              <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 1 }}>
                <Tooltip title="查看详细信息">
                  <IconButton size="small" onClick={handleOpenDetail}>
                    <InfoIcon />
                  </IconButton>
                </Tooltip>
                
                <Tooltip title="强制递归扫描">
                  <IconButton 
                    size="small" 
                    onClick={() => onRecursiveScan?.(path, true)}
                    disabled={isScanning}
                  >
                    <RefreshIcon />
                  </IconButton>
                </Tooltip>
              </Box>

              {/* 展开按钮 - 移动端加大点击区域 */}
              <IconButton 
                onClick={handleToggleExpanded}
                sx={{ 
                  p: { xs: 1.5, sm: 1 },
                  minWidth: { xs: 44, sm: 'auto' },
                  minHeight: { xs: 44, sm: 'auto' }
                }}
              >
                {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Box>
          </Box>

          {/* 展开内容 */}
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Divider sx={{ my: 2 }} />
            
            <Stack spacing={2}>
              {/* 扫描历史 */}
              {stats && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    扫描历史
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    最后扫描: {stats.lastScan ? new Date(stats.lastScan).toLocaleString('zh-CN') : '未知'}
                  </Typography>
                </Box>
              )}

              {/* 操作按钮 */}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {/* 移动端显示详情按钮 */}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<InfoIcon />}
                  onClick={handleOpenDetail}
                  sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
                >
                  详情
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  startIcon={<RefreshIcon />}
                  onClick={() => onRecursiveScan?.(path, true)}
                  disabled={isScanning}
                >
                  强制递归扫描
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="info"
                  onClick={handleOpenLogs}
                >
                  查看日志
                </Button>
                {stats && onForceRemoveCache && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    onClick={() => onForceRemoveCache(path)}
                  >
                    清除缓存
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => onRemove(path)}
                >
                  移除目录
                </Button>
              </Box>

              {/* 数据迁移区域 */}
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  数据迁移（JSON → 行式存储）
                </Typography>
                
                {migrationMessage && (
                  <Alert severity={migrationMessage.type} sx={{ mb: 1 }} onClose={() => setMigrationMessage(null)}>
                    {migrationMessage.text}
                  </Alert>
                )}
                
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {migrationStatus ? (
                    <>
                      <Chip
                        icon={migrationStatus.hasMigratedData ? <CheckCircleIcon /> : <StorageIcon />}
                        label={migrationStatus.hasMigratedData ? '已迁移' : '未迁移'}
                        color={migrationStatus.hasMigratedData ? 'success' : 'warning'}
                        size="small"
                      />
                      {migrationStatus.hasMigratedData && migrationStatus.migratedStats && (
                        <Typography variant="caption" color="text.secondary">
                          行式存储: {migrationStatus.migratedStats.total} 文件, 
                          已看 {migrationStatus.migratedStats.viewed}
                        </Typography>
                      )}
                    </>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      加载中...
                    </Typography>
                  )}
                  
                  <Button
                    size="small"
                    variant="contained"
                    color="primary"
                    startIcon={migrating ? <CircularProgress size={16} color="inherit" /> : <StorageIcon />}
                    onClick={handleMigrate}
                    disabled={migrating || !stats}
                  >
                    {migrating ? '迁移中...' : (migrationStatus?.hasMigratedData ? '重新迁移' : '迁移数据')}
                  </Button>
                </Box>
                
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  将 JSON 缓存数据迁移到行式存储，提升大数据量下的查询性能
                </Typography>
              </Box>
            </Stack>
          </Collapse>
        </CardContent>
      </Card>

      {/* 详细信息对话框 */}
      <Dialog 
        open={detailDialogOpen} 
        onClose={handleCloseDetail}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FolderIcon color="primary" />
            目录详细信息
          </Box>
        </DialogTitle>
        
        <DialogContent dividers>
          <Stack spacing={3}>
            {/* 基本信息 */}
            <Box>
              <Typography variant="h6" gutterBottom>
                基本信息
              </Typography>
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <FolderIcon />
                  </ListItemIcon>
                  <ListItemText 
                    primary="目录路径" 
                    secondary={path}
                  />
                </ListItem>
                <ListItem>
                  <ListItemIcon>
                    {scanStatus.icon}
                  </ListItemIcon>
                  <ListItemText 
                    primary="扫描状态" 
                    secondary={scanStatus.text}
                  />
                </ListItem>
                {stats?.lastScan && (
                  <ListItem>
                    <ListItemIcon>
                      <AccessTimeIcon />
                    </ListItemIcon>
                    <ListItemText 
                      primary="最后扫描时间" 
                      secondary={new Date(stats.lastScan).toLocaleString('zh-CN')}
                    />
                  </ListItem>
                )}
              </List>
            </Box>

            {/* 文件统计 */}
            {stats && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  文件统计
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    <ImageIcon color="primary" sx={{ fontSize: 40, mb: 1 }} />
                    <Typography variant="h4">{stats.images}</Typography>
                    <Typography variant="body2" color="text.secondary">图片文件</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    <VideoIcon color="secondary" sx={{ fontSize: 40, mb: 1 }} />
                    <Typography variant="h4">{stats.videos}</Typography>
                    <Typography variant="body2" color="text.secondary">视频文件</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                    <FolderIcon color="action" sx={{ fontSize: 40, mb: 1 }} />
                    <Typography variant="h4">{stats.total}</Typography>
                    <Typography variant="body2" color="text.secondary">总文件数</Typography>
                  </Paper>
                </Box>
              </Box>
            )}

            {/* 当前扫描进度 */}
            {isScanning && scanProgress && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  扫描进度
                </Typography>
                <Box sx={{ width: '100%' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      扫描进度
                    </Typography>
                    <Typography variant="h6" color="primary.main" fontWeight="bold">
                      {scanProgress.percentage || 0}%
                    </Typography>
                  </Box>
                  <LinearProgress 
                    variant="determinate" 
                    value={scanProgress.percentage || 0}
                    sx={{ 
                      height: 12, 
                      borderRadius: 6,
                      mb: 2,
                      backgroundColor: 'grey.200',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 6,
                        transition: 'transform 0.3s ease-in-out'
                      }
                    }} 
                  />
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="h4" color="primary.main">
                        {scanProgress.scannedDirectories || 0}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        已扫描目录 / {scanProgress.totalDirectories || '?'}
                      </Typography>
                    </Paper>
                    <Paper variant="outlined" sx={{ p: 2, textAlign: 'center' }}>
                      <Typography variant="h4" color="secondary.main">
                        {scanProgress.fileCount || 0}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        已找到文件
                      </Typography>
                    </Paper>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                    当前路径: {scanProgress.currentPath}
                  </Typography>
                  {scanProgress.startTime && (
                    <Typography variant="body2" color="text.secondary">
                      扫描开始时间: {new Date(scanProgress.startTime).toLocaleString('zh-CN')}
                    </Typography>
                  )}
                </Box>
              </Box>
            )}
          </Stack>
        </DialogContent>
        
        <DialogActions>
          <Button onClick={handleCloseDetail}>
            关闭
          </Button>
          <Button
            variant="contained" 
            startIcon={<RefreshIcon />}
            onClick={() => {
              onRecursiveScan?.(path, true)
              handleCloseDetail()
            }}
            disabled={isScanning}
          >
            强制递归扫描
          </Button>
        </DialogActions>
      </Dialog>

      {/* 扫描日志对话框 */}
      <Dialog open={logDialogOpen} onClose={handleCloseLogs} maxWidth="md" fullWidth>
        <DialogTitle>
          扫描日志 - {path}
        </DialogTitle>
        <DialogContent>
          {/* 操作按钮 */}
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              共 {logs.length} 条日志记录
            </Typography>
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={handleClearLogs}
            >
              清空日志
            </Button>
          </Box>
          
          {loadingLogs ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
              <CircularProgress />
            </Box>
          ) : logs.length === 0 ? (
            <Alert severity="info">
              暂无扫描日志
            </Alert>
          ) : (
            <List>
              {logs.map((log, index) => (
                <ListItem key={`${log.timestamp}-${index}`} divider={index < logs.length - 1} sx={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Box sx={{ width: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Chip 
                        label={log.status === 'completed' ? '完成' : log.status === 'failed' ? '失败' : log.status === 'started' ? '开始' : '进度'}
                        color={log.status === 'completed' ? 'success' : log.status === 'failed' ? 'error' : log.status === 'started' ? 'primary' : 'info'}
                        size="small"
                      />
                      <Typography variant="body2" color="text.secondary">
                        {new Date(log.timestamp).toLocaleString('zh-CN')}
                      </Typography>
                    </Box>
                    
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                      扫描类型: {log.scanType === 'recursive' ? '手动扫描' : log.scanType === 'scheduled' ? '定时扫描' : log.scanType} | 
                      {log.totalFiles !== undefined && `文件总数: ${log.totalFiles} | `}
                      {log.imageCount !== undefined && `图片: ${log.imageCount} | `}
                      {log.videoCount !== undefined && `视频: ${log.videoCount}`}
                    </Typography>
                    
                    {log.durationMs && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                        耗时: {log.durationMs}ms
                      </Typography>
                    )}
                    
                    {log.errorMessage && (
                      <Typography variant="body2" color="error" sx={{ mb: 0.5 }}>
                        错误: {log.errorMessage}
                      </Typography>
                    )}
                    
                    {log.logDetails && (
                      <Box sx={{ mt: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                          扫描详情:
                        </Typography>
                        <Box sx={{ 
                          bgcolor: 'grey.50', 
                          p: 1, 
                          borderRadius: 1, 
                          border: '1px solid', 
                          borderColor: 'grey.200',
                          maxHeight: '200px',
                          overflow: 'auto'
                        }}>
                          <pre style={{ 
                            fontSize: '12px', 
                            margin: 0, 
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'monospace',
                            lineHeight: '1.4'
                          }}>
                            {log.logDetails}
                          </pre>
                        </Box>
                      </Box>
                    )}
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseLogs}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
