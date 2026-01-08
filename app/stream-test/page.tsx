'use client'

import { useState, useRef, useEffect } from 'react'
import {
  Container,
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  Alert,
  Paper,
  IconButton,
  Chip,
  Stack,
  Divider,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Switch,
  FormControlLabel,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import {
  PlayArrow as PlayArrowIcon,
  Pause as PauseIcon,
  ArrowBack as ArrowBackIcon,
  ContentCopy as CopyIcon,
  Refresh as RefreshIcon,
  BugReport as BugIcon,
  Transform as TransformIcon,
} from '@mui/icons-material'
import { useRouter } from 'next/navigation'

// 从日志中提取的测试URL（原始流）
const DEFAULT_TEST_URL = '/api/webdav/instant-stream?url=http%3A%2F%2F192.168.133.131%3A19798%2Fdav&username=1341511873%40qq.com&password=ELF101711149&filepath=%2F115open%2F115%2F700%2B%E7%BD%91%E7%BA%A2%E5%A4%A7%E5%90%88%E9%9B%86%EF%BD%9E%EF%BD%9E%E5%BE%AE%E5%AF%86%E5%9C%88%EF%BC%8F%E8%A7%85%E5%9C%88%EF%BC%8F%E9%93%81%E7%B2%89%E7%A9%BA%E9%97%B4%E7%AD%89%E6%9C%BA%E6%9E%84%2F401-500%2F490%2F001%2F001%2F001%20%E9%87%91%E7%86%99%E5%AA%9B%20-%20%E4%BC%9A%E5%91%98%E4%B8%93%E5%B1%9E%20%E5%A4%A7%E9%95%BF%E8%85%BF%E7%B4%A7%E8%BA%AB%E8%A3%A4%20%5B15V%20757.6%20MB%5D%2F1%20%2815%29.avi'

// 转码流URL（将 instant-stream 替换为 transcode-stream）
const DEFAULT_TRANSCODE_URL = '/api/webdav/transcode-stream?url=http%3A%2F%2F192.168.133.131%3A19798%2Fdav&username=1341511873%40qq.com&password=ELF101711149&filepath=%2F115open%2F115%2F700%2B%E7%BD%91%E7%BA%A2%E5%A4%A7%E5%90%88%E9%9B%86%EF%BD%9E%EF%BD%9E%E5%BE%AE%E5%AF%86%E5%9C%88%EF%BC%8F%E8%A7%85%E5%9C%88%EF%BC%8F%E9%93%81%E7%B2%89%E7%A9%BA%E9%97%B4%E7%AD%89%E6%9C%BA%E6%9E%84%2F401-500%2F490%2F001%2F001%2F001%20%E9%87%91%E7%86%99%E5%AA%9B%20-%20%E4%BC%9A%E5%91%98%E4%B8%93%E5%B1%9E%20%E5%A4%A7%E9%95%BF%E8%85%BF%E7%B4%A7%E8%BA%AB%E8%A3%A4%20%5B15V%20757.6%20MB%5D%2F1%20%2815%29.avi&format=mp4&quality=medium'

interface VideoState {
  networkState: number
  readyState: number
  error: MediaError | null
  currentTime: number
  duration: number
  buffered: string
  paused: boolean
  muted: boolean
  volume: number
}

const NETWORK_STATE_MAP: Record<number, string> = {
  0: 'NETWORK_EMPTY - 未初始化',
  1: 'NETWORK_IDLE - 空闲',
  2: 'NETWORK_LOADING - 加载中',
  3: 'NETWORK_NO_SOURCE - 无有效源',
}

const READY_STATE_MAP: Record<number, string> = {
  0: 'HAVE_NOTHING - 无信息',
  1: 'HAVE_METADATA - 有元数据',
  2: 'HAVE_CURRENT_DATA - 有当前帧',
  3: 'HAVE_FUTURE_DATA - 有未来帧',
  4: 'HAVE_ENOUGH_DATA - 数据充足',
}

const ERROR_CODE_MAP: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED - 用户中止',
  2: 'MEDIA_ERR_NETWORK - 网络错误',
  3: 'MEDIA_ERR_DECODE - 解码错误',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - 格式不支持',
}

export default function StreamTestPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [testUrl, setTestUrl] = useState(DEFAULT_TEST_URL)
  const [useTranscode, setUseTranscode] = useState(false)
  const [transcodeFormat, setTranscodeFormat] = useState<'mp4' | 'webm'>('mp4')
  const [transcodeQuality, setTranscodeQuality] = useState<'low' | 'medium' | 'high'>('medium')
  const [isPlaying, setIsPlaying] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [videoState, setVideoState] = useState<VideoState | null>(null)
  const [apiResponse, setApiResponse] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [ffmpegStatus, setFfmpegStatus] = useState<any>(null)

  // 检查 FFmpeg 状态
  useEffect(() => {
    fetch('/api/system/ffmpeg-check')
      .then(res => res.json())
      .then(data => {
        setFfmpegStatus(data)
        if (data.installed) {
          setLogs(prev => [`[系统] ✅ FFmpeg ${data.version} 已安装`, ...prev])
        } else {
          setLogs(prev => [`[系统] ❌ FFmpeg 未安装: ${data.message}`, ...prev])
        }
      })
      .catch(err => {
        setLogs(prev => [`[系统] ⚠️ 无法检测 FFmpeg 状态`, ...prev])
      })
  }, [])

  // 获取实际播放URL（根据是否启用转码）
  const getPlayUrl = () => {
    if (!useTranscode) return testUrl
    
    // 将 instant-stream 替换为 transcode-stream，并添加转码参数
    let transcodeUrl = testUrl.replace('/api/webdav/instant-stream', '/api/webdav/transcode-stream')
    
    // 移除可能存在的旧参数
    const url = new URL(transcodeUrl, window.location.origin)
    url.searchParams.set('format', transcodeFormat)
    url.searchParams.set('quality', transcodeQuality)
    
    return url.pathname + url.search
  }

  // 添加日志
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 99)])
  }

  // 更新视频状态
  const updateVideoState = () => {
    const video = videoRef.current
    if (!video) return

    const bufferedRanges: string[] = []
    for (let i = 0; i < video.buffered.length; i++) {
      bufferedRanges.push(`${video.buffered.start(i).toFixed(2)}-${video.buffered.end(i).toFixed(2)}`)
    }

    setVideoState({
      networkState: video.networkState,
      readyState: video.readyState,
      error: video.error,
      currentTime: video.currentTime,
      duration: video.duration,
      buffered: bufferedRanges.join(', ') || '无',
      paused: video.paused,
      muted: video.muted,
      volume: video.volume,
    })
  }

  // 测试API响应（HEAD请求）
  const testApiHead = async () => {
    setLoading(true)
    addLog('🔍 发送 HEAD 请求测试 API...')
    
    try {
      const response = await fetch(testUrl, { method: 'HEAD' })
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })
      
      setApiResponse({
        status: response.status,
        statusText: response.statusText,
        headers,
      })
      
      addLog(`✅ HEAD 响应: ${response.status} ${response.statusText}`)
      addLog(`📊 Content-Type: ${headers['content-type'] || '未知'}`)
      addLog(`📊 Content-Length: ${headers['content-length'] || '未知'}`)
      addLog(`📊 Accept-Ranges: ${headers['accept-ranges'] || '未知'}`)
    } catch (error: any) {
      addLog(`❌ HEAD 请求失败: ${error.message}`)
      setApiResponse({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  // 测试API响应（Range请求）
  const testApiRange = async () => {
    setLoading(true)
    addLog('🔍 发送 Range 请求测试 API (bytes=0-1023)...')
    
    try {
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: { 'Range': 'bytes=0-1023' }
      })
      
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key] = value
      })
      
      const blob = await response.blob()
      
      setApiResponse({
        status: response.status,
        statusText: response.statusText,
        headers,
        blobSize: blob.size,
        blobType: blob.type,
      })
      
      addLog(`✅ Range 响应: ${response.status} ${response.statusText}`)
      addLog(`📊 Content-Range: ${headers['content-range'] || '未知'}`)
      addLog(`📊 实际接收: ${blob.size} bytes`)
      addLog(`📊 Blob Type: ${blob.type || '未知'}`)
      
      // 检查前几个字节（文件签名）
      const arrayBuffer = await blob.slice(0, 16).arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      const hexSignature = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')
      addLog(`📊 文件签名 (前16字节): ${hexSignature}`)
      
      // 常见视频格式签名
      const signatures: Record<string, string> = {
        '52 49 46 46': 'AVI/RIFF',
        '00 00 00': 'MP4/MOV (ftyp)',
        '1a 45 df a3': 'MKV/WebM',
        '46 4c 56': 'FLV',
      }
      
      for (const [sig, format] of Object.entries(signatures)) {
        if (hexSignature.startsWith(sig)) {
          addLog(`🎬 检测到格式: ${format}`)
          break
        }
      }
      
    } catch (error: any) {
      addLog(`❌ Range 请求失败: ${error.message}`)
      setApiResponse({ error: error.message })
    } finally {
      setLoading(false)
    }
  }

  // 开始播放测试
  const startPlayTest = () => {
    const video = videoRef.current
    if (!video) return
    
    const playUrl = getPlayUrl()
    
    addLog('🎬 开始播放测试...')
    addLog(`📹 模式: ${useTranscode ? `转码流 (${transcodeFormat}/${transcodeQuality})` : '原始流'}`)
    addLog(`📹 视频源: ${playUrl.substring(0, 100)}...`)
    
    video.src = playUrl
    video.load()
    
    video.play().then(() => {
      addLog('✅ 播放成功启动')
      setIsPlaying(true)
    }).catch(error => {
      addLog(`❌ 播放失败: ${error.name} - ${error.message}`)
      setIsPlaying(false)
    })
  }

  // 停止播放
  const stopPlay = () => {
    const video = videoRef.current
    if (!video) return
    
    video.pause()
    video.src = ''
    video.load()
    setIsPlaying(false)
    addLog('⏹️ 停止播放')
  }

  // 设置视频事件监听
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const events = [
      'loadstart', 'progress', 'suspend', 'abort', 'error',
      'emptied', 'stalled', 'loadedmetadata', 'loadeddata',
      'canplay', 'canplaythrough', 'playing', 'waiting',
      'seeking', 'seeked', 'ended', 'durationchange',
      'timeupdate', 'play', 'pause', 'ratechange', 'volumechange'
    ]

    const handlers: Record<string, EventListener> = {}

    events.forEach(eventName => {
      handlers[eventName] = (e) => {
        if (eventName === 'timeupdate') {
          // timeupdate 太频繁，只更新状态不记录日志
          updateVideoState()
          return
        }
        
        if (eventName === 'error') {
          const error = video.error
          if (error) {
            addLog(`❌ 视频错误: ${ERROR_CODE_MAP[error.code] || `未知错误(${error.code})`}`)
            addLog(`❌ 错误消息: ${error.message || '无'}`)
          }
        } else {
          addLog(`📺 事件: ${eventName}`)
        }
        
        updateVideoState()
      }
      video.addEventListener(eventName, handlers[eventName])
    })

    return () => {
      events.forEach(eventName => {
        video.removeEventListener(eventName, handlers[eventName])
      })
    }
  }, [])

  // 解析URL参数
  const parseUrlParams = () => {
    try {
      const url = new URL(testUrl, window.location.origin)
      return {
        webdavUrl: url.searchParams.get('url'),
        username: url.searchParams.get('username'),
        password: url.searchParams.get('password') ? '***' : null,
        filepath: url.searchParams.get('filepath'),
      }
    } catch {
      return null
    }
  }

  const urlParams = parseUrlParams()

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#1a1a2e' }}>
      {/* 顶部导航 */}
      <Box sx={{ 
        position: 'sticky', 
        top: 0, 
        zIndex: 100, 
        backgroundColor: '#16213e',
        borderBottom: '1px solid #0f3460',
        px: 2, 
        py: 1 
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => router.push('/')} sx={{ color: '#e94560' }}>
            <ArrowBackIcon />
          </IconButton>
          <BugIcon sx={{ color: '#e94560' }} />
          <Typography variant="h6" sx={{ color: '#fff', fontWeight: 'bold' }}>
            视频流测试工具
          </Typography>
        </Box>
      </Box>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        <Stack spacing={3}>
          {/* URL 输入区 */}
          <Card sx={{ backgroundColor: '#16213e', borderRadius: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ color: '#e94560', mb: 2, fontWeight: 'bold' }}>
                🔗 测试 URL
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={3}
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                placeholder="输入要测试的视频流 URL"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    color: '#fff',
                    backgroundColor: '#0f3460',
                    '& fieldset': { borderColor: '#0f3460' },
                    '&:hover fieldset': { borderColor: '#e94560' },
                  },
                }}
              />
              
              {urlParams && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" sx={{ color: '#888' }}>解析结果:</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 1 }}>
                    <Chip label={`WebDAV: ${urlParams.webdavUrl}`} size="small" sx={{ backgroundColor: '#0f3460', color: '#fff' }} />
                    <Chip label={`用户: ${urlParams.username}`} size="small" sx={{ backgroundColor: '#0f3460', color: '#fff' }} />
                    <Chip label={`文件: ${urlParams.filepath?.split('/').pop()}`} size="small" sx={{ backgroundColor: '#e94560', color: '#fff' }} />
                  </Stack>
                </Box>
              )}
              
              {/* 转码选项 */}
              <Box sx={{ mt: 3, p: 2, backgroundColor: '#0f3460', borderRadius: 1 }}>
                <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap">
                  <FormControlLabel
                    control={
                      <Switch
                        checked={useTranscode}
                        onChange={(e) => setUseTranscode(e.target.checked)}
                        sx={{
                          '& .MuiSwitch-switchBase.Mui-checked': { color: '#e94560' },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#e94560' },
                        }}
                      />
                    }
                    label={
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <TransformIcon sx={{ color: useTranscode ? '#e94560' : '#888', fontSize: 20 }} />
                        <Typography sx={{ color: useTranscode ? '#e94560' : '#888' }}>
                          启用服务端转码
                        </Typography>
                      </Stack>
                    }
                  />
                  
                  {useTranscode && (
                    <>
                      <Divider orientation="vertical" flexItem sx={{ borderColor: '#1a4a7a' }} />
                      
                      <Box>
                        <Typography variant="caption" sx={{ color: '#888', display: 'block', mb: 0.5 }}>
                          输出格式
                        </Typography>
                        <ToggleButtonGroup
                          value={transcodeFormat}
                          exclusive
                          onChange={(_, v) => v && setTranscodeFormat(v)}
                          size="small"
                        >
                          <ToggleButton value="mp4" sx={{ color: '#fff', '&.Mui-selected': { backgroundColor: '#e94560', color: '#fff' } }}>
                            MP4
                          </ToggleButton>
                          <ToggleButton value="webm" sx={{ color: '#fff', '&.Mui-selected': { backgroundColor: '#e94560', color: '#fff' } }}>
                            WebM
                          </ToggleButton>
                        </ToggleButtonGroup>
                      </Box>
                      
                      <Box>
                        <Typography variant="caption" sx={{ color: '#888', display: 'block', mb: 0.5 }}>
                          质量
                        </Typography>
                        <ToggleButtonGroup
                          value={transcodeQuality}
                          exclusive
                          onChange={(_, v) => v && setTranscodeQuality(v)}
                          size="small"
                        >
                          <ToggleButton value="low" sx={{ color: '#fff', '&.Mui-selected': { backgroundColor: '#4ade80', color: '#000' } }}>
                            低
                          </ToggleButton>
                          <ToggleButton value="medium" sx={{ color: '#fff', '&.Mui-selected': { backgroundColor: '#fbbf24', color: '#000' } }}>
                            中
                          </ToggleButton>
                          <ToggleButton value="high" sx={{ color: '#fff', '&.Mui-selected': { backgroundColor: '#e94560', color: '#fff' } }}>
                            高
                          </ToggleButton>
                        </ToggleButtonGroup>
                      </Box>
                    </>
                  )}
                </Stack>
                
                {useTranscode && (
                  <Typography variant="caption" sx={{ color: '#4ade80', display: 'block', mt: 1 }}>
                    ✓ 转码模式：AVI/MKV 等格式将实时转换为浏览器可播放的 {transcodeFormat.toUpperCase()}
                  </Typography>
                )}
                
                {/* FFmpeg 状态 */}
                {ffmpegStatus && (
                  <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid #1a4a7a' }}>
                    {ffmpegStatus.installed ? (
                      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                        <Chip 
                          label={`FFmpeg ${ffmpegStatus.version}`} 
                          size="small" 
                          sx={{ backgroundColor: '#4ade80', color: '#000' }} 
                        />
                        {ffmpegStatus.mp4Support && (
                          <Chip label="MP4 ✓" size="small" sx={{ backgroundColor: '#0f3460', color: '#4ade80' }} />
                        )}
                        {ffmpegStatus.webmSupport && (
                          <Chip label="WebM ✓" size="small" sx={{ backgroundColor: '#0f3460', color: '#4ade80' }} />
                        )}
                      </Stack>
                    ) : (
                      <Typography variant="caption" sx={{ color: '#ff6b6b' }}>
                        ❌ FFmpeg 未安装，转码功能不可用
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
              
              <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                <Button variant="contained" onClick={testApiHead} disabled={loading}
                  sx={{ backgroundColor: '#0f3460', '&:hover': { backgroundColor: '#1a4a7a' } }}>
                  HEAD 测试
                </Button>
                <Button variant="contained" onClick={testApiRange} disabled={loading}
                  sx={{ backgroundColor: '#0f3460', '&:hover': { backgroundColor: '#1a4a7a' } }}>
                  Range 测试
                </Button>
                <Button variant="contained" onClick={startPlayTest} disabled={isPlaying}
                  startIcon={<PlayArrowIcon />}
                  sx={{ backgroundColor: '#e94560', '&:hover': { backgroundColor: '#ff6b6b' } }}>
                  播放测试
                </Button>
                <Button variant="outlined" onClick={stopPlay} disabled={!isPlaying}
                  startIcon={<PauseIcon />}
                  sx={{ borderColor: '#e94560', color: '#e94560' }}>
                  停止
                </Button>
                <Button variant="outlined" onClick={() => setLogs([])}
                  sx={{ borderColor: '#888', color: '#888' }}>
                  清空日志
                </Button>
              </Stack>
              
              {loading && <LinearProgress sx={{ mt: 2 }} />}
            </CardContent>
          </Card>

          {/* 主内容区 */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
            {/* 左侧：视频播放器 + 状态 */}
            <Stack spacing={3}>
              {/* 视频播放器 */}
              <Card sx={{ backgroundColor: '#16213e', borderRadius: 2 }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ color: '#e94560', mb: 2, fontWeight: 'bold' }}>
                    🎬 视频播放器
                  </Typography>
                  <Box sx={{ 
                    backgroundColor: '#000', 
                    borderRadius: 1, 
                    overflow: 'hidden',
                    aspectRatio: '16/9',
                  }}>
                    <video
                      ref={videoRef}
                      controls
                      style={{ width: '100%', height: '100%' }}
                      playsInline
                    />
                  </Box>
                </CardContent>
              </Card>

              {/* 视频状态 */}
              {videoState && (
                <Card sx={{ backgroundColor: '#16213e', borderRadius: 2 }}>
                  <CardContent>
                    <Typography variant="subtitle1" sx={{ color: '#e94560', mb: 2, fontWeight: 'bold' }}>
                      📊 视频状态
                    </Typography>
                    <Table size="small">
                      <TableBody>
                        <TableRow>
                          <TableCell sx={{ color: '#888', borderColor: '#0f3460' }}>网络状态</TableCell>
                          <TableCell sx={{ color: videoState.networkState === 3 ? '#ff6b6b' : '#fff', borderColor: '#0f3460' }}>
                            {NETWORK_STATE_MAP[videoState.networkState]}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell sx={{ color: '#888', borderColor: '#0f3460' }}>就绪状态</TableCell>
                          <TableCell sx={{ color: videoState.readyState === 0 ? '#ff6b6b' : '#fff', borderColor: '#0f3460' }}>
                            {READY_STATE_MAP[videoState.readyState]}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell sx={{ color: '#888', borderColor: '#0f3460' }}>播放时间</TableCell>
                          <TableCell sx={{ color: '#fff', borderColor: '#0f3460' }}>
                            {videoState.currentTime.toFixed(2)}s / {isNaN(videoState.duration) ? '未知' : videoState.duration.toFixed(2) + 's'}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell sx={{ color: '#888', borderColor: '#0f3460' }}>缓冲范围</TableCell>
                          <TableCell sx={{ color: '#fff', borderColor: '#0f3460' }}>{videoState.buffered}</TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell sx={{ color: '#888', borderColor: '#0f3460' }}>播放/暂停</TableCell>
                          <TableCell sx={{ color: '#fff', borderColor: '#0f3460' }}>
                            {videoState.paused ? '暂停' : '播放中'}
                          </TableCell>
                        </TableRow>
                        {videoState.error && (
                          <TableRow>
                            <TableCell sx={{ color: '#ff6b6b', borderColor: '#0f3460' }}>错误</TableCell>
                            <TableCell sx={{ color: '#ff6b6b', borderColor: '#0f3460' }}>
                              {ERROR_CODE_MAP[videoState.error.code] || `未知(${videoState.error.code})`}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* API 响应 */}
              {apiResponse && (
                <Card sx={{ backgroundColor: '#16213e', borderRadius: 2 }}>
                  <CardContent>
                    <Typography variant="subtitle1" sx={{ color: '#e94560', mb: 2, fontWeight: 'bold' }}>
                      📡 API 响应
                    </Typography>
                    <Box sx={{ 
                      backgroundColor: '#0f3460', 
                      p: 2, 
                      borderRadius: 1,
                      maxHeight: 200,
                      overflow: 'auto',
                    }}>
                      <pre style={{ color: '#fff', margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(apiResponse, null, 2)}
                      </pre>
                    </Box>
                  </CardContent>
                </Card>
              )}
            </Stack>

            {/* 右侧：日志 */}
            <Card sx={{ backgroundColor: '#16213e', borderRadius: 2 }}>
              <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Typography variant="subtitle1" sx={{ color: '#e94560', mb: 2, fontWeight: 'bold' }}>
                  📋 事件日志 ({logs.length})
                </Typography>
                <Box sx={{ 
                  flex: 1,
                  backgroundColor: '#0a0a1a', 
                  p: 2, 
                  borderRadius: 1,
                  overflow: 'auto',
                  maxHeight: 600,
                  fontFamily: 'monospace',
                  fontSize: '12px',
                }}>
                  {logs.length === 0 ? (
                    <Typography sx={{ color: '#666' }}>等待操作...</Typography>
                  ) : (
                    logs.map((log, index) => (
                      <Box key={index} sx={{ 
                        color: log.includes('❌') ? '#ff6b6b' : 
                               log.includes('✅') ? '#4ade80' : 
                               log.includes('⚠️') ? '#fbbf24' : '#fff',
                        py: 0.5,
                        borderBottom: '1px solid #1a1a2e',
                      }}>
                        {log}
                      </Box>
                    ))
                  )}
                </Box>
              </CardContent>
            </Card>
          </Box>

          {/* 问题说明 */}
          <Alert severity="info" sx={{ backgroundColor: '#2d2d44', color: '#fff' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
              💡 使用说明
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>原始流模式：</strong>直接从 WebDAV 获取视频流，仅支持浏览器原生格式（MP4、WebM）
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>转码流模式：</strong>服务端使用 FFmpeg 实时转码，支持 AVI、MKV、FLV 等所有格式
            </Typography>
            <Typography variant="body2" sx={{ color: '#fbbf24' }}>
              ⚠️ 转码模式需要服务器安装 FFmpeg，首次播放可能有几秒延迟
            </Typography>
          </Alert>

          <Alert severity="warning" sx={{ backgroundColor: '#2d2d44', color: '#fff' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
              ⚠️ 关于 AVI 格式播放问题
            </Typography>
            <Typography variant="body2">
              日志中的错误 <code>MEDIA_ERR_SRC_NOT_SUPPORTED (4)</code> 和 <code>FFmpegDemuxer: open context failed</code> 
              表明浏览器原生 video 标签不支持 AVI 格式。
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              <strong>解决方案：</strong>启用上方的「服务端转码」开关，将 AVI 实时转换为 MP4 播放
            </Typography>
          </Alert>
        </Stack>
      </Container>
    </Box>
  )
}
