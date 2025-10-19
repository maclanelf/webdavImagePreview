'use client'

import { useState, useEffect } from 'react'
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
} from '@mui/material'
import {
  Shuffle as ShuffleIcon,
  Settings as SettingsIcon,
  CloudOff as CloudOffIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
  PhotoLibrary as PhotoLibraryIcon,
} from '@mui/icons-material'
import { useRouter } from 'next/navigation'

interface WebDAVConfig {
  url: string
  username: string
  password: string
  mediaPaths: string[]
}

interface MediaFile {
  filename: string
  basename: string
  size: number
  type: string
  lastmod: string
}

type MediaFilter = 'all' | 'images' | 'videos'

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

  useEffect(() => {
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
        loadStats(parsed)
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

  const loadStats = async (cfg: WebDAVConfig) => {
    try {
      const response = await fetch('/api/webdav/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })

      if (!response.ok) throw new Error('获取文件列表失败')

      const data = await response.json()
      const files = data.files || []
      setAllFiles(files)
      
      const imageCount = files.filter((f: MediaFile) => 
        /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(f.basename)
      ).length
      
      const videoCount = files.filter((f: MediaFile) => 
        /\.(mp4|webm|mov|avi|mkv)$/i.test(f.basename)
      ).length

      setStats({
        total: files.length,
        images: imageCount,
        videos: videoCount,
      })
    } catch (e: any) {
      console.error('加载统计信息失败:', e)
    }
  }

  const getFilteredFiles = () => {
    if (mediaFilter === 'images') {
      return allFiles.filter(f => /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(f.basename))
    } else if (mediaFilter === 'videos') {
      return allFiles.filter(f => /\.(mp4|webm|mov|avi|mkv)$/i.test(f.basename))
    }
    return allFiles
  }

  const loadRandomMedia = async () => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }

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

    setLoading(true)
    setError(null)

    try {
      // 从筛选后的文件中随机选择
      const randomFile = filteredFiles[Math.floor(Math.random() * filteredFiles.length)]
      setCurrentFile(randomFile)

      // 获取文件流
      const streamResponse = await fetch('/api/webdav/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          filepath: randomFile.filename,
        }),
      })

      if (!streamResponse.ok) throw new Error('获取文件流失败')

      const blob = await streamResponse.blob()
      const url = URL.createObjectURL(blob)
      
      // 清理旧的URL
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
      }
      
      setMediaUrl(url)
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
        const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(currentFile.basename)
        const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(currentFile.basename)
        
        if ((newFilter === 'images' && !isImage) || (newFilter === 'videos' && !isVideo)) {
          setCurrentFile(null)
          setMediaUrl(null)
        }
      }
    }
  }

  const isImage = (filename: string) => {
    return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename)
  }

  const isVideo = (filename: string) => {
    return /\.(mp4|webm|mov|avi|mkv)$/i.test(filename)
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
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          WebDAV 媒体预览器
        </Typography>
        <Button
          variant="outlined"
          startIcon={<SettingsIcon />}
          onClick={() => router.push('/config')}
        >
          设置
        </Button>
      </Box>

      {/* 筛选器 */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'center' }}>
        <Paper elevation={2} sx={{ p: 1, display: 'inline-flex', borderRadius: 2 }}>
          <ToggleButtonGroup
            value={mediaFilter}
            exclusive
            onChange={handleFilterChange}
            aria-label="媒体类型筛选"
            size="large"
          >
            <ToggleButton value="all" aria-label="全部">
              <PhotoLibraryIcon sx={{ mr: 1 }} />
              全部 ({stats.total})
            </ToggleButton>
            <ToggleButton value="images" aria-label="仅图片">
              <ImageIcon sx={{ mr: 1 }} />
              仅图片 ({stats.images})
            </ToggleButton>
            <ToggleButton value="videos" aria-label="仅视频">
              <VideoIcon sx={{ mr: 1 }} />
              仅视频 ({stats.videos})
            </ToggleButton>
          </ToggleButtonGroup>
        </Paper>
      </Box>

      {/* 当前筛选统计 */}
      <Box sx={{ mb: 4, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          当前筛选：
          <Typography component="span" variant="h6" color="primary" sx={{ ml: 1, fontWeight: 'bold' }}>
            {filteredStats.label}
          </Typography>
          <Typography component="span" variant="h6" color="text.secondary" sx={{ ml: 1 }}>
            共 {filteredStats.total} 个文件
          </Typography>
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {currentFile && mediaUrl && (
        <Card elevation={3} sx={{ borderRadius: 3, overflow: 'hidden', mb: 10 }}>
          <Box sx={{ position: 'relative', backgroundColor: '#000' }}>
            {isImage(currentFile.filename) && (
              <CardMedia
                component="img"
                image={mediaUrl}
                alt={currentFile.basename}
                sx={{
                  width: '100%',
                  maxHeight: '70vh',
                  objectFit: 'contain',
                }}
              />
            )}
            {isVideo(currentFile.filename) && (
              <CardMedia
                component="video"
                src={mediaUrl}
                controls
                autoPlay
                sx={{
                  width: '100%',
                  maxHeight: '70vh',
                }}
              />
            )}
          </Box>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {currentFile.basename}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              路径: {currentFile.filename}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              大小: {formatFileSize(currentFile.size)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              修改时间: {new Date(currentFile.lastmod).toLocaleString('zh-CN')}
            </Typography>
          </CardContent>
        </Card>
      )}

      {!currentFile && !loading && (
        <Paper
          elevation={2}
          sx={{
            p: 8,
            textAlign: 'center',
            backgroundColor: 'background.default',
            borderRadius: 3,
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
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
          <CircularProgress size={60} sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary">
            正在从 {config.mediaPaths.length} 个目录中随机选择{filteredStats.label}...
          </Typography>
        </Box>
      )}

      {/* 悬浮按钮 - 固定在右下角 */}
      <Tooltip title={loading ? '加载中...' : '换一个'} placement="left">
        <Fab
          color="primary"
          aria-label="换一个"
          onClick={loadRandomMedia}
          disabled={loading}
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
    </Container>
  )
}
