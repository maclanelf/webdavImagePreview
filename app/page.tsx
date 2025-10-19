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
  CardActions,
  CircularProgress,
  Alert,
  Paper,
  Chip,
  Stack,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material'
import {
  Shuffle as ShuffleIcon,
  Settings as SettingsIcon,
  CloudOff as CloudOffIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
  Folder as FolderIcon,
  ExpandMore as ExpandMoreIcon,
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

export default function HomePage() {
  const router = useRouter()
  const [config, setConfig] = useState<WebDAVConfig | null>(null)
  const [currentFile, setCurrentFile] = useState<MediaFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [stats, setStats] = useState({ total: 0, images: 0, videos: 0 })

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

  const loadRandomMedia = async () => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // 获取随机文件
      const response = await fetch('/api/webdav/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '获取随机文件失败')
      }

      const data = await response.json()
      setCurrentFile(data.file)

      // 获取文件流
      const streamResponse = await fetch('/api/webdav/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          filepath: data.file.filename,
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

      {/* 已挂载目录信息 */}
      <Accordion sx={{ mb: 3 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
            <FolderIcon color="primary" />
            <Typography variant="h6">
              已挂载 {config.mediaPaths.length} 个目录
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={1}>
            {config.mediaPaths.map((path, index) => (
              <Chip
                key={index}
                icon={<FolderIcon />}
                label={path}
                variant="outlined"
                sx={{ justifyContent: 'flex-start' }}
              />
            ))}
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* 统计信息 */}
      <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
        <Paper elevation={1} sx={{ flex: 1, p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
          <ImageIcon color="primary" sx={{ fontSize: 40 }} />
          <Box>
            <Typography variant="h5" fontWeight="bold">{stats.images}</Typography>
            <Typography variant="body2" color="text.secondary">图片</Typography>
          </Box>
        </Paper>
        <Paper elevation={1} sx={{ flex: 1, p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
          <VideoIcon color="secondary" sx={{ fontSize: 40 }} />
          <Box>
            <Typography variant="h5" fontWeight="bold">{stats.videos}</Typography>
            <Typography variant="body2" color="text.secondary">视频</Typography>
          </Box>
        </Paper>
        <Paper elevation={1} sx={{ flex: 1, p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box>
            <Typography variant="h5" fontWeight="bold">{stats.total}</Typography>
            <Typography variant="body2" color="text.secondary">总计</Typography>
          </Box>
        </Paper>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {currentFile && mediaUrl && (
        <Card elevation={3} sx={{ borderRadius: 3, overflow: 'hidden' }}>
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
          <CardActions>
            <Button
              fullWidth
              variant="contained"
              size="large"
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <ShuffleIcon />}
              onClick={loadRandomMedia}
              disabled={loading}
            >
              {loading ? '加载中...' : '换一个'}
            </Button>
          </CardActions>
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
            随机加载一个图片或视频
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
            正在从 {config.mediaPaths.length} 个目录中随机选择...
          </Typography>
        </Box>
      )}
    </Container>
  )
}
