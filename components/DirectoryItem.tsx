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
  Paper
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
  AccessTime as AccessTimeIcon
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
  onRescan: (path: string, force?: boolean) => void
  onRemove: (path: string) => void
}

export default function DirectoryItem({
  path,
  stats,
  isScanning,
  scanProgress,
  onRescan,
  onRemove
}: DirectoryItemProps) {
  const [expanded, setExpanded] = useState(false)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)

  const handleToggleExpanded = () => {
    setExpanded(!expanded)
  }

  const handleOpenDetail = () => {
    setDetailDialogOpen(true)
  }

  const handleCloseDetail = () => {
    setDetailDialogOpen(false)
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

            {/* 操作按钮 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title="查看详细信息">
                <IconButton size="small" onClick={handleOpenDetail}>
                  <InfoIcon />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="重新扫描">
                <IconButton 
                  size="small" 
                  onClick={() => onRescan(path, true)}
                  disabled={isScanning}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>

              <IconButton size="small" onClick={handleToggleExpanded}>
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
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={() => onRescan(path, true)}
                  disabled={isScanning}
                >
                  重新扫描
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={() => onRemove(path)}
                >
                  移除目录
                </Button>
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
              onRescan(path, true)
              handleCloseDetail()
            }}
            disabled={isScanning}
          >
            重新扫描
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
