'use client'

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react'
import { Box, CircularProgress, Typography, IconButton } from '@mui/material'
import { 
  PlayArrow as PlayArrowIcon, 
  Pause as PauseIcon, 
  VolumeUp as VolumeUpIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  ScreenRotation as ScreenRotationIcon,
} from '@mui/icons-material'

interface InstantVideoPlayerProps {
  src: string
  onLoadStart?: () => void
  onCanPlay?: () => void
  onError?: (error: string) => void
  onTimeUpdate?: (currentTime: number, duration: number) => void
  onEnded?: () => void
  style?: React.CSSProperties
  className?: string
  autoPlay?: boolean
}

export interface InstantVideoPlayerRef {
  play: () => Promise<void>
  pause: () => void
  getCurrentTime: () => number
  getDuration: () => number
  setCurrentTime: (time: number) => void
  getVideoElement: () => HTMLVideoElement | null
  isPaused: () => boolean
}

/**
 * InstantVideoPlayer 组件 - 即点即播视频播放器
 * 
 * 这是一个使用 React.forwardRef 创建的视频播放器组件，支持通过 ref 暴露播放控制方法。
 * 
 * @param {InstantVideoPlayerProps} props - 组件属性
 * @param {string} props.src - 视频源地址
 * @param {Function} props.onLoadStart - 视频开始加载时的回调
 * @param {Function} props.onCanPlay - 视频可以播放时的回调
 * @param {Function} props.onError - 视频加载错误时的回调
 * @param {Function} props.onTimeUpdate - 视频播放时间更新的回调
 * @param {Function} props.onEnded - 视频播放结束时的回调
 * @param {React.CSSProperties} props.style - 自定义样式
 * @param {string} props.className - 自定义类名
 * @param {boolean} props.autoPlay - 是否自动播放，默认为 false
 * @param {React.Ref<InstantVideoPlayerRef>} ref - 转发的 ref，用于父组件调用播放器方法
 * 
 * @returns {JSX.Element} 视频播放器组件
 * 
 * 功能特点：
 * - 支持即点即播，快速响应用户操作
 * - 提供完整的播放控制接口（play, pause, seek 等）
 * - 支持全屏播放和屏幕方向锁定
 * - 自动处理播放状态和缓冲
 * - 提供自定义控制栏
 */
const InstantVideoPlayer = forwardRef<InstantVideoPlayerRef, InstantVideoPlayerProps>(({
  src,
  onLoadStart,
  onCanPlay,
  onError,
  onTimeUpdate,
  onEnded,
  style,
  className,
  autoPlay = false
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null) // 视频元素引用
  const [loading, setLoading] = useState(true) // 加载状态
  const [error, setError] = useState<string | null>(null) // 错误信息
  const [isPlaying, setIsPlaying] = useState(false) // 播放状态
  const [showControls, setShowControls] = useState(true) // 控制栏显示状态
  const [currentTime, setCurrentTime] = useState(0) // 当前播放时间
  const [duration, setDuration] = useState(0) // 视频总时长
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null) // 视频宽高比
  const [isFullscreen, setIsFullscreen] = useState(false) // 全屏状态
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape') // 屏幕方向
  const [supportsOrientationLock, setSupportsOrientationLock] = useState(false) // 是否支持屏幕方向锁定
  const containerRef = useRef<HTMLDivElement>(null) // 容器元素引用

  // 播放状态管理
  // 播放Promise管理，用于追踪正在进行的播放请求，避免多次调用play()导致的竞态条件
  const [playPromise, setPlayPromise] = useState<Promise<void> | null>(null)
  // 标记是否已经尝试过自动播放，防止重复尝试
  const [hasAttemptedAutoPlay, setHasAttemptedAutoPlay] = useState(false)

  // 当src变化时重置状态并清理旧的video元素
  useEffect(() => {
    console.log('🔄 [即点即播] src变化，重置播放器状态:', src)
    
    // 重置所有播放状态
    setHasAttemptedAutoPlay(false)
    setLoading(true)
    setError(null)
    setCurrentTime(0)
    setDuration(0)
    setVideoAspectRatio(null)
    setIsPlaying(false)
    
    // 清理正在进行的播放Promise
    if (playPromise) {
      playPromise.catch(() => {
        // 忽略错误
      })
      setPlayPromise(null)
    }
    
    // 如果video元素存在，先暂停并重置
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
      console.log('⏹️ [即点即播] 已重置video元素')
    }
  }, [src])

  // 清理函数
  useEffect(() => {
    return () => {
      console.log('🧹 [即点即播] 组件卸载，清理资源')
      
      // 清理播放Promise
      if (playPromise) {
        playPromise.catch(() => {
          // 忽略清理时的错误
        })
      }
      
      // 停止video元素的所有活动
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.src = '' // 清空src，停止所有网络请求
        videoRef.current.load() // 重新加载以应用空src
        console.log('🛑 [即点即播] 已停止video元素的所有请求')
      }
    }
  }, [])

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    play: async () => {
      if (videoRef.current) {
        try {
          // 如果有正在进行的播放请求，先等待它完成
          if (playPromise) {
            try {
              await playPromise
            } catch (e) {
              // 忽略之前播放请求的错误
            }
          }
          
          const promise = videoRef.current.play()
          setPlayPromise(promise)
          
          await promise
          setIsPlaying(true)
          setPlayPromise(null)
        } catch (error) {
          console.error('播放失败:', error)
          setPlayPromise(null)
          throw error
        }
      }
    },
    pause: () => {
      if (videoRef.current) {
        // 如果有正在进行的播放请求，先等待它完成再暂停
        if (playPromise) {
          playPromise.then(() => {
            if (videoRef.current) {
              videoRef.current.pause()
              setIsPlaying(false)
            }
          }).catch(() => {
            // 播放失败，直接设置为暂停状态
            setIsPlaying(false)
          })
          setPlayPromise(null)
        } else {
          videoRef.current.pause()
          setIsPlaying(false)
        }
      }
    },
    getCurrentTime: () => {
      return videoRef.current?.currentTime || 0
    },
    getDuration: () => {
      return videoRef.current?.duration || 0
    },
    setCurrentTime: (time: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = time
      }
    },
    getVideoElement: () => videoRef.current,
    isPaused: () => videoRef.current?.paused || true
  }))

  // 视频事件处理
  const handleLoadStart = () => {
    console.log('🎬 [即点即播] 视频开始加载')
    console.log('📊 [即点即播] 视频源:', src)
    setLoading(true)
    setError(null)
    onLoadStart?.()
  }

  /**
   * 处理视频元数据加载完成事件
   * 
   * 当视频的元数据（如时长、尺寸等）加载完成时触发此函数。
   * 这是视频加载过程中的关键节点，此时可以获取视频的基本信息并尝试开始播放。
   * 
   * 主要功能：
   * 1. 获取并记录视频的时长、尺寸等元数据
   * 2. 计算并存储视频的宽高比，用于判断横竖屏
   * 3. 在自动播放模式下，立即尝试播放视频（即点即播的核心逻辑）
   * 4. 处理播放失败的情况，允许在 canPlay 事件中重试
   * 
   * @fires onLoadStart - 通过父组件传入的回调函数通知元数据加载完成
   */
  const handleLoadedMetadata = () => {
    console.log('📊 [即点即播] 视频元数据加载完成')
    if (videoRef.current) {
      const width = videoRef.current.videoWidth
      const height = videoRef.current.videoHeight
      console.log('⏱️ [即点即播] 视频时长:', videoRef.current.duration, '秒')
      console.log('📺 [即点即播] 视频尺寸:', width, 'x', height)
      
      // 保存视频时长到状态
      setDuration(videoRef.current.duration)
      
      // 计算并存储视频宽高比，用于自适应布局和横竖屏判断
      if (width && height) {
        const aspectRatio = width / height
        setVideoAspectRatio(aspectRatio)
        console.log('📐 [即点即播] 视频宽高比:', aspectRatio.toFixed(2), aspectRatio > 1 ? '(横屏)' : '(竖屏)')
      }
    }
    setLoading(false)
    
    // 元数据加载完成后，立即尝试播放（最快路径）
    // 这是实现"即点即播"的核心：在最早可能的时机启动播放
    if (autoPlay && videoRef.current && !hasAttemptedAutoPlay) {
      setHasAttemptedAutoPlay(true) // 标记已尝试自动播放，防止重复尝试
      const tryPlay = async () => {
        try {
          // 调用 play() 并保存 Promise，用于追踪播放状态
          const promise = videoRef.current!.play()
          setPlayPromise(promise)
          await promise
          setPlayPromise(null)
          console.log('✅ [即点即播] 元数据加载后立即播放')
        } catch (error) {
          // 播放失败可能是因为浏览器策略限制或缓冲不足
          console.log('⚠️ [即点即播] 元数据加载后播放失败，等待canPlay事件:', error)
          setPlayPromise(null)
          setHasAttemptedAutoPlay(false) // 重置标记，让canPlay事件可以再次尝试播放
        }
      }
      tryPlay()
    }
  }

  /**
   * 处理视频可以播放事件
   * 
   * 当浏览器已经加载了足够的数据，可以开始播放视频时触发。
   * 这是实现"即点即播"的第二道防线：如果在loadedmetadata阶段没有成功自动播放，
   * 则在这个阶段再次尝试播放。
   * 
   * 触发时机：
   * - 在 loadedmetadata 事件之后
   * - 当浏览器已经缓冲了足够的数据可以开始播放（但不保证能播放到结束）
   * 
   * 主要功能：
   * 1. 关闭加载状态指示器
   * 2. 触发父组件的 onCanPlay 回调
   * 3. 如果 autoPlay 为 true 且之前没有成功播放，则尝试自动播放
   * 4. 处理播放 Promise 的竞态条件，避免多次调用 play() 导致的错误
   */
  const handleCanPlay = () => {
    console.log('▶️ [即点即播] 视频可以播放，立即启动')
    setLoading(false)
    onCanPlay?.()
    
    // 如果loadedmetadata没有成功播放，在这里再试一次
    if (videoRef.current && autoPlay && !hasAttemptedAutoPlay) {
      setHasAttemptedAutoPlay(true)
      const attemptPlay = async () => {
        try {
          if (playPromise) {
            try {
              await playPromise
            } catch (e) {
              // 忽略之前播放请求的错误
            }
          }
          
          const promise = videoRef.current!.play()
          setPlayPromise(promise)
          await promise
          setPlayPromise(null)
          console.log('✅ [即点即播] canPlay事件播放成功')
        } catch (error) {
          console.log('⚠️ [即点即播] canPlay自动播放被阻止:', error)
          setPlayPromise(null)
        }
      }
      
      attemptPlay()
    }
  }

  /**
   * 处理视频可以流畅播放事件
   * 
   * 当浏览器预估视频可以从当前播放位置一直播放到结束而无需停下来缓冲时触发。
   * 这意味着已经加载了足够的数据，可以保证流畅的播放体验。
   * 
   * 触发时机：
   * - 在 canplay 事件之后
   * - 当浏览器已经缓冲了足够多的数据，预计可以无卡顿地播放完整个视频
   * - 通常发生在视频加载的后期阶段
   */
  const handleCanPlayThrough = () => {
    console.log('🚀 [即点即播] 视频可以流畅播放')
    // 即使在canplaythrough事件中也不等待，保持即点即播的特性
  }

  const handlePlay = () => {
    console.log('🎵 [即点即播] 视频开始播放')
    if (videoRef.current) {
      console.log('📊 [即点即播] 当前播放时间:', videoRef.current.currentTime)
      console.log('📊 [即点即播] 缓冲范围:', getBufferedRanges())
    }
    setIsPlaying(true)
    setLoading(false) // 开始播放时取消加载状态
  }

  // 获取缓冲范围的辅助函数
  const getBufferedRanges = () => {
    if (!videoRef.current) return []
    const buffered = videoRef.current.buffered
    const ranges = []
    for (let i = 0; i < buffered.length; i++) {
      ranges.push({
        start: buffered.start(i),
        end: buffered.end(i)
      })
    }
    return ranges
  }

  const handlePause = () => {
    console.log('⏸️ [即点即播] 视频暂停')
    setIsPlaying(false)
  }

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const errorMessage = '视频加载失败，请检查网络连接'
    console.error('❌ [即点即播] 视频错误:', e)
    setError(errorMessage)
    setLoading(false)
    onError?.(errorMessage)
  }

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
      // 只在 duration 有效时调用回调
      if (onTimeUpdate && videoRef.current.duration && isFinite(videoRef.current.duration)) {
        onTimeUpdate(videoRef.current.currentTime, videoRef.current.duration)
      }
    }
  }

  const handleEnded = () => {
    console.log('🏁 [即点即播] 视频播放结束')
    setIsPlaying(false)
    onEnded?.()
  }

  /**
   * 处理视频缓冲进度事件
   * 
   * 当浏览器下载媒体数据时周期性触发，用于监控视频的缓冲状态。
   * 通过检查 buffered 属性，我们可以知道哪些时间范围的视频数据已经被缓冲。
   * 
   * 触发时机：
   * - 浏览器正在下载视频数据时周期性触发
   * - 通常每隔几百毫秒触发一次
   * 
   * 主要功能：
   * 1. 获取视频的缓冲时间范围（TimeRanges 对象）
   * 2. 计算已缓冲数据占总时长的百分比
   * 3. 输出详细的缓冲进度日志，便于调试和监控播放性能
   * 
   * 注意事项：
   * - buffered 是一个 TimeRanges 对象，可能包含多个不连续的时间段
   * - 这里只关注最后一个缓冲范围的结束时间，作为整体缓冲进度的指标
   */
  const handleProgress = () => {
    // 监控缓冲进度
    if (videoRef.current) {
      // 获取已缓冲的时间范围
      const buffered = videoRef.current.buffered
      
      // 检查是否有已缓冲的数据
      if (buffered.length > 0) {
        // 获取最后一个缓冲范围的结束时间点
        const bufferedEnd = buffered.end(buffered.length - 1)
        // 获取视频总时长
        const duration = videoRef.current.duration
        
        // 确保视频时长有效（已加载元数据）
        if (duration > 0) {
          // 计算缓冲百分比：已缓冲时长 / 总时长 * 100
          const bufferedPercent = (bufferedEnd / duration * 100).toFixed(1)
          // 输出缓冲进度日志：百分比和具体时间
          console.log(`📊 [即点即播] 缓冲进度: ${bufferedPercent}% (${bufferedEnd.toFixed(1)}s / ${duration.toFixed(1)}s)`)
        }
      }
    }
  }

  const handleWaiting = () => {
    console.log('⏳ [即点即播] 等待缓冲数据...')
    setLoading(true)
  }

  const handleStalled = () => {
    console.log('⚠️ [即点即播] 网络停滞，正在重试...')
  }

  // 手动播放/暂停控制
  const togglePlayPause = async () => {
    if (!videoRef.current) return
    
    try {
      if (videoRef.current.paused) {
        // 如果有正在进行的播放请求，先等待它完成
        if (playPromise) {
          try {
            await playPromise
          } catch (e) {
            // 忽略之前播放请求的错误
          }
        }
        
        const promise = videoRef.current.play()
        setPlayPromise(promise)
        await promise
        setPlayPromise(null)
      } else {
        // 如果有正在进行的播放请求，先等待它完成再暂停
        if (playPromise) {
          playPromise.then(() => {
            if (videoRef.current) {
              videoRef.current.pause()
            }
          }).catch(() => {
            // 播放失败，忽略错误
          })
          setPlayPromise(null)
        } else {
          videoRef.current.pause()
        }
      }
    } catch (error) {
      console.error('播放控制失败:', error)
      setPlayPromise(null)
    }
  }

  // 全屏切换
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        // 进入全屏
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen()
        }
      } else {
        // 退出全屏
        if (document.exitFullscreen) {
          await document.exitFullscreen()
        }
      }
    } catch (error) {
      console.error('全屏切换失败:', error)
    }
  }

  // 横竖屏切换
  const toggleOrientation = async () => {
    if (!supportsOrientationLock) {
      console.warn('⚠️ [即点即播] 当前设备不支持屏幕方向锁定，该功能仅适用于移动设备')
      return
    }

    try {
      if (!document.fullscreenElement) {
        // 如果不在全屏模式，先进入全屏
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen()
          // 等待一下让全屏生效
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      // 切换屏幕方向
      const newOrientation = orientation === 'landscape' ? 'portrait' : 'landscape'
      
      try {
        if (newOrientation === 'landscape') {
          await (screen.orientation as any).lock('landscape-primary')
          setOrientation('landscape')
          console.log('🔄 [即点即播] 切换到横屏模式')
        } else {
          await (screen.orientation as any).lock('portrait-primary')
          setOrientation('portrait')
          console.log('🔄 [即点即播] 切换到竖屏模式')
        }
      } catch (lockError: any) {
        // 如果锁定失败，尝试不带 -primary 后缀的版本
        console.log('尝试使用备选方向锁定...')
        if (newOrientation === 'landscape') {
          await (screen.orientation as any).lock('landscape')
          setOrientation('landscape')
        } else {
          await (screen.orientation as any).lock('portrait')
          setOrientation('portrait')
        }
      }
    } catch (error: any) {
      console.error('屏幕方向切换失败:', error)
      // 如果是不支持的错误，禁用该功能
      if (error.message && error.message.includes('not available')) {
        setSupportsOrientationLock(false)
        console.warn('⚠️ [即点即播] 检测到设备不支持屏幕方向锁定，已禁用此功能')
      }
    }
  }

  // 监听全屏状态变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement
      setIsFullscreen(isNowFullscreen)
      
      // 退出全屏时解锁屏幕方向
      if (!isNowFullscreen && screen.orientation && 'unlock' in screen.orientation) {
        try {
          ;(screen.orientation as any).unlock()
          console.log('🔓 [即点即播] 解锁屏幕方向')
        } catch (error) {
          console.log('屏幕方向解锁失败:', error)
        }
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // 检测设备是否支持屏幕方向锁定
  useEffect(() => {
    const checkOrientationSupport = () => {
      // 检查是否支持 Screen Orientation API
      if (screen.orientation && 'lock' in screen.orientation) {
        // 移动设备通常支持，桌面浏览器不支持
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        setSupportsOrientationLock(isMobile)
        console.log(`📱 [即点即播] 设备类型: ${isMobile ? '移动设备' : '桌面设备'}, 支持方向锁定: ${isMobile}`)
      } else {
        setSupportsOrientationLock(false)
        console.log('⚠️ [即点即播] 当前浏览器不支持 Screen Orientation API')
      }
    }

    checkOrientationSupport()
  }, [])

  // 监听屏幕方向变化
  useEffect(() => {
    if (!screen.orientation) return

    const handleOrientationChange = () => {
      const type = screen.orientation.type
      if (type.includes('landscape')) {
        setOrientation('landscape')
      } else if (type.includes('portrait')) {
        setOrientation('portrait')
      }
      console.log('📱 [即点即播] 屏幕方向:', type)
    }

    screen.orientation.addEventListener('change', handleOrientationChange)
    // 初始化当前方向
    handleOrientationChange()

    return () => {
      screen.orientation.removeEventListener('change', handleOrientationChange)
    }
  }, [])

  if (error) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="200px"
        style={style}
        className={className}
        sx={{ backgroundColor: '#000', color: '#fff', p: 2 }}
      >
        <Typography color="error" variant="h6" gutterBottom>
          ❌ 播放失败
        </Typography>
        <Typography color="error" variant="body2">
          {error}
        </Typography>
      </Box>
    )
  }

  return (
    <Box 
      ref={containerRef}
      className={className}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* 视频元素 */}
      <video
        ref={videoRef}
        src={src}
        controls={false} // 使用自定义控件
        preload="metadata" // 只加载元数据，避免过度预加载大文件
        playsInline // 移动设备内联播放
        muted={false} // 不静音
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
        onLoadStart={handleLoadStart}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={handleCanPlay}
        onCanPlayThrough={handleCanPlayThrough}
        onPlay={handlePlay}
        onPause={handlePause}
        onError={handleError}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onProgress={handleProgress}
        onWaiting={handleWaiting}
        onStalled={handleStalled}
        onClick={togglePlayPause}
      />
      
      {/* 加载指示器 */}
      {loading && (
        <Box
          position="absolute"
          top="50%"
          left="50%"
          sx={{
            transform: 'translate(-50%, -50%)',
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <CircularProgress sx={{ color: '#fff' }} />
          <Typography variant="body2" sx={{ color: '#fff' }}>
            正在加载...
          </Typography>
        </Box>
      )}
      
      {/* 播放/暂停按钮覆盖层 */}
      {!loading && showControls && (
        <Box
          position="absolute"
          top="50%"
          left="50%"
          sx={{
            transform: 'translate(-50%, -50%)',
            zIndex: 2,
            opacity: 0.8,
            transition: 'opacity 0.3s ease',
          }}
        >
          <IconButton
            onClick={togglePlayPause}
            sx={{
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: '#fff',
              fontSize: '3rem',
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
              },
            }}
          >
            {isPlaying ? <PauseIcon fontSize="inherit" /> : <PlayArrowIcon fontSize="inherit" />}
          </IconButton>
        </Box>
      )}
      
      {/* 底部控制栏 */}
      {!loading && showControls && (
        <Box
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          sx={{
            background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.7))',
            p: 1,
            zIndex: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton
              size="small"
              onClick={togglePlayPause}
              sx={{ color: '#fff' }}
            >
              {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
            </IconButton>
            
            {/* 进度条 */}
            <Box sx={{ flex: 1, mx: 1 }}>
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                onChange={(e) => {
                  const newTime = parseFloat(e.target.value)
                  setCurrentTime(newTime)
                  if (videoRef.current) {
                    videoRef.current.currentTime = newTime
                  }
                }}
                style={{
                  width: '100%',
                  height: '4px',
                  background: 'rgba(255, 255, 255, 0.3)',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
            </Box>
            
            {/* 时间显示 */}
            <Typography variant="caption" sx={{ color: '#fff', minWidth: '80px' }}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </Typography>
            
            <IconButton
              size="small"
              sx={{ color: '#fff' }}
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !videoRef.current.muted
                }
              }}
            >
              <VolumeUpIcon />
            </IconButton>
            
            {/* 横竖屏切换按钮 - 只在支持的设备上显示 */}
            {supportsOrientationLock && (
              <IconButton
                size="small"
                sx={{ 
                  color: '#fff',
                  transform: orientation === 'portrait' ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.3s ease',
                }}
                onClick={toggleOrientation}
                title={orientation === 'landscape' ? '切换到竖屏' : '切换到横屏'}
              >
                <ScreenRotationIcon />
              </IconButton>
            )}
            
            {/* 全屏按钮 */}
            <IconButton
              size="small"
              sx={{ color: '#fff' }}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </Box>
        </Box>
      )}
    </Box>
  )
})

// 格式化时间的辅助函数
function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) {
    return '0:00'
  }
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }
}

InstantVideoPlayer.displayName = 'InstantVideoPlayer'

export default InstantVideoPlayer
