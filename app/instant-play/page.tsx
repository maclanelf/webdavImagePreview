'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Container,
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Paper,
  Fab,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  Stack,
  Snackbar,
} from '@mui/material'
import {
  PlayArrow as PlayArrowIcon,
  Pause as PauseIcon,
  VideoLibrary as VideoIcon,
  Settings as SettingsIcon,
  CloudOff as CloudOffIcon,
  ArrowBack as ArrowBackIcon,
  Refresh as RefreshIcon,
  Folder as FolderIcon,
} from '@mui/icons-material'
import { useRouter } from 'next/navigation'
import InstantVideoPlayer, { InstantVideoPlayerRef } from '@/components/InstantVideoPlayer'

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

export default function InstantPlayPage() {
  const router = useRouter()
  const [config, setConfig] = useState<WebDAVConfig | null>(null)
  const [videoFiles, setVideoFiles] = useState<MediaFile[]>([])
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null)
  const videoRef = useRef<InstantVideoPlayerRef>(null)
  // 播放意图标记 - 用于安卓浏览器自动播放
  const [playIntent, setPlayIntent] = useState(false)

  // 加载配置
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // 从数据库加载配置
        const response = await fetch('/api/webdav-config/default')
        if (response.ok) {
          const dbConfig = await response.json()
          if (dbConfig.url && dbConfig.username) {
            const config = {
              url: dbConfig.url,
              username: dbConfig.username,
              password: dbConfig.password,
              mediaPaths: dbConfig.mediaPaths || ['/'],
            }
            setConfig(config)
            loadVideoFiles(config)
            return
          }
        }
      } catch (error) {
        console.error('从数据库加载配置失败:', error)
      }
      
      // 如果数据库中没有配置，尝试从 localStorage 加载
      const savedConfig = localStorage.getItem('webdav_config')
      if (savedConfig) {
        try {
          const parsed = JSON.parse(savedConfig)
          if (parsed.mediaPaths && !Array.isArray(parsed.mediaPaths)) {
            parsed.mediaPaths = [parsed.mediaPath || '/']
          }
          setConfig(parsed)
          loadVideoFiles(parsed)
        } catch (e) {
          console.error('加载配置失败:', e)
        }
      }
    }
    
    loadConfig()
  }, [])

  // 加载视频文件列表
  const loadVideoFiles = async (cfg: WebDAVConfig) => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/webdav/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '获取文件列表失败')
      }

      const data = await response.json()
      const files = data.files || []
      
      // 只保留视频文件
      const videos = files.filter((f: MediaFile) => 
        /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename)
      )
      
      setVideoFiles(videos)
      
      if (videos.length === 0) {
        setError('未找到视频文件')
      }
    } catch (e: any) {
      console.error('加载视频文件失败:', e)
      setError(`加载视频文件失败: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 选择并播放视频
  const playVideo = (file: MediaFile) => {
    if (!config) return
    
    // 设置播放意图（在用户交互的同步调用栈中）
    setPlayIntent(true)
    setSelectedFile(file)
    setError(null)
    
    // 构建流式播放URL
    // 注意：URLSearchParams 会将空格编码为 +，但 WebDAV 服务器需要 %20
    const params = new URLSearchParams({
      url: config.url,
      username: config.username,
      password: config.password,
      filepath: file.filename,
    })
    
    // 将 + 替换为 %20，确保 WebDAV 服务器能正确解析路径中的空格
    const streamUrl = `/api/webdav/instant-stream?${params.toString().replace(/\+/g, '%20')}`
    
    console.log(`🎬 [即点即播] 开始播放视频: ${file.basename}`)
    console.log(`🔗 [即点即播] 流媒体URL: ${streamUrl}`)
    
    setSelectedVideoUrl(streamUrl)
    
    // 使用requestAnimationFrame实现最快的播放启动
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        if (videoRef.current) {
          console.log(`▶️ [即点即播] 尝试自动播放`)
          try {
            await videoRef.current.play()
          } catch (error) {
            console.log('自动播放被阻止:', error)
            setSnackbarMessage('请点击播放按钮开始播放')
            setSnackbarOpen(true)
          }
        }
      })
    })
  }

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // 获取文件夹名称
  const getFolderName = (filepath: string) => {
    const parts = filepath.split('/')
    return parts[parts.length - 2] || '根目录'
  }

  // 当 config 为空时，展示配置页面的提示
  if (!config) {
    return (
      <Container maxWidth="md" sx={{ py: 8 }}>
        <Paper elevation={3} sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
          <CloudOffIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h4" gutterBottom>
            即点即播
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
    <Box sx={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* 顶部导航栏 */}
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton onClick={() => router.push('/')} color="primary">
              <ArrowBackIcon />
            </IconButton>
            <Typography variant="h6" fontWeight="bold">
              即点即播
            </Typography>
            <Chip label={`${videoFiles.length} 个视频`} size="small" color="primary" />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton 
              onClick={() => config && loadVideoFiles(config)} 
              disabled={loading}
              color="primary"
            >
              <RefreshIcon />
            </IconButton>
            <IconButton onClick={() => router.push('/config')}>
              <SettingsIcon />
            </IconButton>
          </Box>
        </Box>
      </Box>

      <Container maxWidth="xl" sx={{ py: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* 视频播放器 */}
        {selectedFile && selectedVideoUrl && (
          <Card elevation={2} sx={{ mb: 3, borderRadius: 2 }}>
            <Box 
              sx={{ 
                backgroundColor: '#000',
                width: '100%',
                height: '80vh',
              }}
            >
              <InstantVideoPlayer
                ref={videoRef}
                src={selectedVideoUrl}
                autoPlay={true}
                playIntent={playIntent}
                onError={(error) => {
                  setError(`视频播放失败: ${error}`)
                }}
                onLoadStart={() => {
                  console.log('视频开始加载')
                }}
                onCanPlay={() => {
                  console.log('视频可以播放')
                  // 重置播放意图
                  setPlayIntent(false)
                }}
              />
            </Box>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {selectedFile.basename}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {selectedFile.filename}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                  大小: {formatFileSize(selectedFile.size)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  修改时间: {new Date(selectedFile.lastmod).toLocaleString('zh-CN')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  文件夹: {getFolderName(selectedFile.filename)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        )}

        {/* 视频文件列表 */}
        <Card elevation={2} sx={{ borderRadius: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <VideoIcon color="primary" />
              <Typography variant="h6" fontWeight="bold">
                视频文件列表
              </Typography>
            </Box>

            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            )}

            {!loading && videoFiles.length === 0 && !error && (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <VideoIcon sx={{ fontSize: 60, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary">
                  未找到视频文件
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  请检查配置的目录中是否包含视频文件
                </Typography>
              </Box>
            )}

            {!loading && videoFiles.length > 0 && (
              <List>
                {videoFiles.map((file, index) => (
                  <ListItem
                    key={file.filename}
                    onClick={() => playVideo(file)}
                    sx={{
                      borderRadius: 1,
                      mb: 1,
                      cursor: 'pointer',
                      backgroundColor: selectedFile?.filename === file.filename ? 'primary.light' : 'transparent',
                      '&:hover': {
                        backgroundColor: selectedFile?.filename === file.filename ? 'primary.main' : 'action.hover',
                      },
                    }}
                  >
                    <ListItemIcon>
                      <PlayArrowIcon color="primary" />
                    </ListItemIcon>
                    <ListItemText
                      primary={file.basename}
                      secondary={
                        <span>
                          <Typography variant="caption" display="block" component="span">
                            {file.filename}
                          </Typography>
                          <span style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                            <Typography variant="caption" color="text.secondary" component="span">
                              {formatFileSize(file.size)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" component="span">
                              {getFolderName(file.filename)}
                            </Typography>
                          </span>
                        </span>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        {/* 说明信息 */}
        <Paper sx={{ p: 3, mt: 3, backgroundColor: 'info.light' }}>
          <Typography variant="h6" gutterBottom color="info.contrastText">
            💡 即点即播功能说明
          </Typography>
          <Typography variant="body2" color="info.contrastText" paragraph>
            • <strong>即点即播</strong>：点击视频文件立即开始播放，无需等待完整下载
          </Typography>
          <Typography variant="body2" color="info.contrastText" paragraph>
            • <strong>流式播放</strong>：支持大文件播放，内存占用低
          </Typography>
          <Typography variant="body2" color="info.contrastText" paragraph>
            • <strong>快速跳转</strong>：拖拽进度条可以快速跳转到任意位置
          </Typography>
          <Typography variant="body2" color="info.contrastText">
            • <strong>兼容性</strong>：支持 MP4、WebM、MOV 等主流视频格式
          </Typography>
        </Paper>
      </Container>

      {/* 提示消息 */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbarOpen(false)} 
          severity="info"
          variant="filled"
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  )
}
