'use client'

import { useRef, useState, useEffect, TouchEvent, forwardRef, useImperativeHandle } from 'react'
import { Box, IconButton } from '@mui/material'
import { Fullscreen as FullscreenIcon, Link as LinkIcon } from '@mui/icons-material'

interface MobileVideoPlayerProps {
  src: string
  autoPlay?: boolean
  isParentFullscreen?: boolean // 父组件的 CSS 全屏状态
  onTimeUpdate?: (currentTime: number, duration: number) => void
  onEnded?: () => void
  onPlay?: () => void
  isVisible?: boolean // 控制组件可见性（用于图片时隐藏）
  showDirectPlayButton?: boolean // 是否显示右下角的直链快捷入口
  onDirectPlay?: () => void // 点击直链入口后的回调，由父组件负责切换播放源
  directPlayLoading?: boolean // 预留给切源中的 loading 态，避免重复点击
}

export interface MobileVideoPlayerRef {
  getVideoElement: () => HTMLVideoElement | null
  warmUp: () => void // 首次用户交互时调用，取消静音
}

const MobileVideoPlayer = forwardRef<MobileVideoPlayerRef, MobileVideoPlayerProps>(({ 
  src,
  autoPlay = true,
  isParentFullscreen = false,
  onTimeUpdate,
  onEnded,
  onPlay,
  isVisible = true,
  showDirectPlayButton = false,
  onDirectPlay,
  directPlayLoading = false,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  
  const [isPlaying, setIsPlaying] = useState(autoPlay)
  const [showControls, setShowControls] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isLandscape, setIsLandscape] = useState(false)
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false)
  const [videoDisplayRect, setVideoDisplayRect] = useState<{ bottom: number } | null>(null)
  const [isSwitchingSource, setIsSwitchingSource] = useState(false)
  const [readySrc, setReadySrc] = useState(src)
  
  // 控制条自动隐藏定时器
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null)
  
  // 保存 autoPlay 的最新值（避免 useEffect 依赖导致的问题）
  const autoPlayRef = useRef(autoPlay)
  
  // 追踪是否已取消静音
  const hasUnmutedRef = useRef(false)
  const latestRequestedSrcRef = useRef(src)
  const sourceApplyFrameRef = useRef<number | null>(null)
  
  // 同步 autoPlay 到 ref
  useEffect(() => {
    autoPlayRef.current = autoPlay
  }, [autoPlay])

  // 暴露 video 元素给父组件
  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    warmUp: () => {
      hasUnmutedRef.current = true
      const video = videoRef.current
      if (video) {
        video.muted = false
      }
    }
  }))

  // 监听原生全屏状态变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      )
      setIsNativeFullscreen(isCurrentlyFullscreen)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [])

  // 检测视频是否为横向，并立即计算显示区域
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const checkOrientationAndCalculate = () => {
      if (video.videoWidth > video.videoHeight) {
        setIsLandscape(true)
      } else {
        setIsLandscape(false)
      }
      
      // 立即计算视频实际显示区域
      calculateVideoDisplayRect()
    }

    // 监听多个事件，确保尽早计算
    video.addEventListener('loadedmetadata', checkOrientationAndCalculate)
    video.addEventListener('loadeddata', checkOrientationAndCalculate)
    video.addEventListener('canplay', checkOrientationAndCalculate)
    
    // 如果视频已经加载，立即执行
    if (video.readyState >= 1) {
      checkOrientationAndCalculate()
    }
    
    return () => {
      video.removeEventListener('loadedmetadata', checkOrientationAndCalculate)
      video.removeEventListener('loadeddata', checkOrientationAndCalculate)
      video.removeEventListener('canplay', checkOrientationAndCalculate)
    }
  }, [src])

  // 计算视频实际显示区域（考虑 object-fit: contain）
  const calculateVideoDisplayRect = () => {
    const video = videoRef.current
    const container = containerRef.current
    if (!video || !container || !video.videoWidth || !video.videoHeight) return

    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight
    const videoAspect = video.videoWidth / video.videoHeight
    const containerAspect = containerWidth / containerHeight

    let videoDisplayHeight: number
    let videoDisplayWidth: number

    if (videoAspect > containerAspect) {
      // 视频更宽，以宽度为准（横向视频在竖向容器中）
      videoDisplayWidth = containerWidth
      videoDisplayHeight = containerWidth / videoAspect
    } else {
      // 视频更高，以高度为准（纵向视频）
      videoDisplayHeight = containerHeight
      videoDisplayWidth = containerHeight * videoAspect
    }

    // 计算视频底部距离容器底部的距离（黑边高度）
    const topMargin = (containerHeight - videoDisplayHeight) / 2
    const bottomMargin = topMargin
    
    // 按钮高度约为 22px (padding 8px + 内容 14px)
    const buttonHeight = 22
    const gapFromVideo = 10 // 按钮距离视频底边的距离
    
    // 按钮应该在视频内容底边下方10px
    // 视频底边距离容器底部 = bottomMargin
    // 按钮底部应该在: bottomMargin - gapFromVideo - buttonHeight
    // 这样按钮顶部就在视频底边下方10px
    let buttonBottom: number
    const minRequiredSpace = gapFromVideo + buttonHeight + 5 // 需要的最小空间（10px间距 + 22px按钮 + 5px底部余量）
    
    if (bottomMargin < minRequiredSpace) {
      // 黑边太小，无法容纳按钮，放在黑边中间或最小安全位置
      buttonBottom = Math.max(5, bottomMargin / 2)
      console.log('[视频显示区域] ⚠️ 黑边太小，按钮放在安全位置')
    } else {
      // 黑边足够，放在视频底边下方10px
      buttonBottom = bottomMargin - gapFromVideo - buttonHeight
    }
    
    setVideoDisplayRect({ bottom: buttonBottom })
  }

  // 监听窗口大小变化，重新计算视频显示区域
  useEffect(() => {
    const handleResize = () => {
      calculateVideoDisplayRect()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 组件挂载后也尝试计算一次
  useEffect(() => {
    // 延迟一点确保DOM已渲染
    const timer = setTimeout(() => {
      calculateVideoDisplayRect()
    }, 100)
    
    return () => clearTimeout(timer)
  }, [src, isParentFullscreen])

  // 视频播放时更新进度
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleTimeUpdate = () => {
      const current = video.currentTime
      const total = video.duration
      setCurrentTime(current)
      setDuration(total)
      
      if (total > 0) {
        setProgress((current / total) * 100)
      }
      
      onTimeUpdate?.(current, total)
    }

    const handleEnded = () => {
      setIsPlaying(false)
      onEnded?.()
    }

    const handlePlay = () => {
      setIsPlaying(true)
      onPlay?.()
    }

    const handlePause = () => {
      setIsPlaying(false)
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [onTimeUpdate, onEnded, onPlay])

  // 追踪是否已初始化（只在首次设置静音）
  const isInitializedRef = useRef(false)
  const sourceReadyRef = useRef(false)
  const shouldHideVideoElement = Boolean(src && isVisible && src !== readySrc) || isSwitchingSource

  // 初始化：首次加载时静音播放
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    latestRequestedSrcRef.current = src
    sourceReadyRef.current = false
    setIsSwitchingSource(Boolean(src && isVisible))

    if (sourceApplyFrameRef.current !== null) {
      cancelAnimationFrame(sourceApplyFrameRef.current)
      sourceApplyFrameRef.current = null
    }

    if (!src || !isVisible) {
      video.pause()
      video.removeAttribute('src')
      video.load()
      setReadySrc('')
      setIsSwitchingSource(false)
      return
    }

    setReadySrc(prev => (prev === src ? prev : ''))

    // 优先检查 warmUp 标记
    if (hasUnmutedRef.current) {
      video.muted = false
      isInitializedRef.current = true
    } else if (!isInitializedRef.current) {
      // 首次初始化且未 warmUp，设置为静音
      video.muted = true
      isInitializedRef.current = true
    } else {
      // 已初始化但未 warmUp，保持静音
      video.muted = true
    }
    
    const tryPlay = () => {
      if (!autoPlayRef.current) return
      
      video.play().catch(error => {
        console.log('[MobileVideoPlayer] 自动播放失败:', error)
        if (latestRequestedSrcRef.current === src) {
          sourceReadyRef.current = true
          setReadySrc(src)
          setIsSwitchingSource(false)
        }
      })
    }

    const applySource = () => {
      if (latestRequestedSrcRef.current !== src) return

      const shouldBeMuted = !hasUnmutedRef.current

      video.pause()
      video.removeAttribute('src')
      video.load()
      video.muted = shouldBeMuted
      video.src = src
      video.load()

      if (autoPlayRef.current) {
        tryPlay()
      } else {
        sourceReadyRef.current = true
        setReadySrc(src)
        setIsSwitchingSource(false)
      }
    }

    sourceApplyFrameRef.current = requestAnimationFrame(() => {
      sourceApplyFrameRef.current = null
      applySource()
    })
    
    return () => {
      if (sourceApplyFrameRef.current !== null) {
        cancelAnimationFrame(sourceApplyFrameRef.current)
        sourceApplyFrameRef.current = null
      }
    }
  }, [src, isVisible])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleSourceReady = () => {
      if (latestRequestedSrcRef.current !== src) return
      sourceReadyRef.current = true
      setReadySrc(latestRequestedSrcRef.current)
      setIsSwitchingSource(false)
    }

    const handleWaiting = () => {
      if (!sourceReadyRef.current && src && isVisible) {
        setIsSwitchingSource(true)
      }
    }

    const handleLoadStart = () => {
      if (latestRequestedSrcRef.current !== src) return
      sourceReadyRef.current = false
      if (src && isVisible) {
        setIsSwitchingSource(true)
      }
    }

    const handleError = () => {
      if (latestRequestedSrcRef.current !== src) return
      setReadySrc(latestRequestedSrcRef.current)
      setIsSwitchingSource(false)
    }

    video.addEventListener('loadstart', handleLoadStart)
    video.addEventListener('playing', handleSourceReady)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('error', handleError)

    return () => {
      video.removeEventListener('loadstart', handleLoadStart)
      video.removeEventListener('playing', handleSourceReady)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('error', handleError)
    }
  }, [src, isVisible])

  // 格式化时间显示
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '00:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // 点击视频区域暂停/播放
  const handleVideoClick = (e: React.MouseEvent) => {
    // 如果点击的是进度条区域或全屏按钮，不处理
    const target = e.target as HTMLElement
    if (target.closest('.progress-bar-container') || target.closest('.fullscreen-button') || target.closest('.direct-play-button')) {
      return
    }

    const video = videoRef.current
    if (!video) return

    // 用户交互时取消静音并标记
    if (video.muted) {
      video.muted = false
      hasUnmutedRef.current = true
    }

    if (video.paused) {
      video.play()
      // 清除自动隐藏定时器
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
      }
      // 0.5秒后隐藏进度条
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false)
      }, 500)
    } else {
      video.pause()
      setShowControls(true)
      // 清除自动隐藏定时器
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
      }
    }
  }

  // 点击中央播放按钮
  const handleCenterPlayClick = (e: React.MouseEvent) => {
    e.stopPropagation() // 防止触发视频点击事件
    const video = videoRef.current
    if (!video) return

    // 用户交互时取消静音并标记
    if (video.muted) {
      video.muted = false
      hasUnmutedRef.current = true
    }

    video.play()
    // 清除自动隐藏定时器
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current)
    }
    // 0.5秒后隐藏进度条
    hideControlsTimerRef.current = setTimeout(() => {
      setShowControls(false)
    }, 500)
  }

  // 触摸开始 - 检测是否在进度条区域
  const handleTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0]
    const progressBar = progressBarRef.current
    if (!progressBar) return

    const progressRect = progressBar.getBoundingClientRect()
    const touchY = touch.clientY
    
    // 扩大触摸区域：进度条上方50px，下方30px
    // 这样用户更容易触发进度条拖动
    if (touchY >= progressRect.top - 50 && touchY <= progressRect.bottom + 30) {
      e.preventDefault() // 防止触发点击事件
      setIsDragging(true)
      setShowControls(true)
      updateProgress(touch.clientX, progressRect)
      
      // 清除自动隐藏定时器
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
      }
    }
  }

  // 触摸移动 - 拖动进度条
  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging) return
    
    e.preventDefault() // 防止页面滚动
    const touch = e.touches[0]
    const progressBar = progressBarRef.current
    if (!progressBar) return

    const rect = progressBar.getBoundingClientRect()
    updateProgress(touch.clientX, rect)
  }

  // 触摸结束 - 完成拖动
  const handleTouchEnd = () => {
    if (!isDragging) return
    
    setIsDragging(false)
    
    // 0.5秒后隐藏进度条
    hideControlsTimerRef.current = setTimeout(() => {
      if (!videoRef.current?.paused) {
        setShowControls(false)
      }
    }, 500)
  }

  // 更新进度
  const updateProgress = (clientX: number, rect: DOMRect) => {
    const video = videoRef.current
    if (!video || !video.duration) return

    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    const percentage = x / rect.width
    const newTime = percentage * video.duration
    
    video.currentTime = newTime
    setProgress(percentage * 100)
    setCurrentTime(newTime)
  }

  // 全屏播放 - 让整个容器进入全屏，而不是只有 video
  const handleFullscreen = () => {
    const container = containerRef.current
    if (!container) return

    if (container.requestFullscreen) {
      container.requestFullscreen()
    } else if ((container as any).webkitRequestFullscreen) {
      (container as any).webkitRequestFullscreen()
    } else if ((container as any).mozRequestFullScreen) {
      (container as any).mozRequestFullScreen()
    } else if ((container as any).msRequestFullscreen) {
      (container as any).msRequestFullscreen()
    }
  }

  // 清理定时器
  useEffect(() => {
    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current)
      }
    }
  }, [])

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: '#000',
        overflow: 'hidden',
        touchAction: 'pan-y',
        display: isVisible ? 'block' : 'none', // 控制可见性
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* 视频元素 */}
      <video
        ref={videoRef}
        playsInline
        webkit-playsinline="true"
        preload="metadata"
        onClick={handleVideoClick}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: shouldHideVideoElement ? 'none' : 'block',
        }}
      />

      {shouldHideVideoElement && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 4,
            backgroundColor: '#000',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* 中央播放按钮 - 暂停时显示（圆角三角形） */}
      {!isPlaying && !shouldHideVideoElement && (
        <Box
          onClick={handleCenterPlayClick}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 5,
            cursor: 'pointer',
            animation: 'fadeIn 0.3s ease-in-out',
            '@keyframes fadeIn': {
              '0%': {
                opacity: 0,
                transform: 'translate(-50%, -50%) scale(0.8)',
              },
              '100%': {
                opacity: 1,
                transform: 'translate(-50%, -50%) scale(1)',
              },
            },
          }}
        >
          {/* 使用 SVG 绘制圆角三角形 */}
          <svg
            width="60"
            height="70"
            viewBox="0 0 60 70"
            style={{
              filter: 'drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.95)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)'
            }}
          >
            <path
              d="M 10 5 L 55 35 L 10 65 Q 5 65 5 60 L 5 10 Q 5 5 10 5 Z"
              fill="rgba(255, 255, 255, 0.85)"
              strokeWidth="0"
            />
          </svg>
        </Box>
      )}

      {/* 进度条容器 - 始终在底部固定位置 */}
      <Box
        className="progress-bar-container"
        ref={progressBarRef}
        sx={{
          position: 'absolute',
          bottom: 60, // 距离底部60px
          left: 16, // 左侧留出16px边距
          right: 16, // 右侧留出16px边距
          height: isDragging ? 4 : 2, // 拖动时变粗（4px），正常时很细（2px）
          backgroundColor: 'transparent',
          cursor: 'pointer',
          transition: showControls || isDragging ? 'height 0.2s' : 'opacity 0.3s, height 0.2s',
          opacity: showControls || isDragging ? 1 : 0,
          zIndex: 10,
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        {/* 背景轨道 */}
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
            borderRadius: '2px',
          }}
        />
        
        {/* 已播放进度 */}
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${progress}%`,
            backgroundColor: '#fff',
            borderRadius: '2px',
            transition: isDragging ? 'none' : 'width 0.1s',
            boxShadow: isDragging ? '0 0 8px rgba(255, 255, 255, 0.6)' : 'none',
          }}
        />
        
        {/* 拖动时显示的圆形指示器 */}
        {isDragging && (
          <Box
            sx={{
              position: 'absolute',
              left: `${progress}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 14,
              height: 14,
              borderRadius: '50%',
              backgroundColor: '#fff',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.4)',
              zIndex: 1,
            }}
          />
        )}
      </Box>

      {/* 时间显示 - 拖动时在进度条上方显示 */}
      {isDragging && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 80, // 进度条上方20px
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            color: '#fff',
            padding: '6px 16px',
            borderRadius: '6px',
            fontSize: '18px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
            zIndex: 11,
            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.4)',
            letterSpacing: '0.5px',
          }}
        >
          {formatTime(currentTime)} / {formatTime(duration)}
        </Box>
      )}

      {showDirectPlayButton && (
        // 直链按钮跟随控制层显示，避免常驻遮挡画面，同时复用已有的触控显隐节奏。
        <Box
          className="direct-play-button"
          sx={{
            position: 'absolute',
            right: 16,
            bottom: 22,
            zIndex: 12,
            opacity: showControls || isDragging || directPlayLoading ? 1 : 0,
            pointerEvents: showControls || isDragging || directPlayLoading ? 'auto' : 'none',
            transition: 'opacity 0.2s ease',
          }}
        >
          <IconButton
            onClick={(e) => {
              e.stopPropagation()
              onDirectPlay?.()
            }}
            disabled={directPlayLoading}
            sx={{
              backgroundColor: 'rgba(0, 0, 0, 0.55)',
              color: '#fff',
              width: 32,
              height: 32,
              border: '1px solid rgba(255, 255, 255, 0.28)',
              backdropFilter: 'blur(8px)',
              '&:hover': {
                backgroundColor: 'rgba(33, 150, 243, 0.35)',
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
            }}
            title="直链播放"
          >
            <LinkIcon sx={{ fontSize: 16, opacity: directPlayLoading ? 0.45 : 1 }} />
          </IconButton>
        </Box>
      )}

      {/* 横向视频全屏按钮 - 在 CSS 全屏时显示，点击进入原生全屏 */}
      {isLandscape && isParentFullscreen && !isNativeFullscreen && videoDisplayRect && (
        <Box
          className="fullscreen-button"
          sx={{
            position: 'absolute',
            bottom: `${videoDisplayRect.bottom}px`, // 已经包含了10px偏移
            left: '50%',
            transform: 'translateX(-50%)', // 水平居中
            zIndex: 9,
            opacity: 0.95, // 始终显示，不受播放状态影响
            transition: 'opacity 0.3s ease', // 只有透明度过渡，没有位置过渡
          }}
        >
          <IconButton
            onClick={handleFullscreen}
            sx={{
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              color: '#fff',
              borderRadius: '16px', // 圆角
              padding: '4px 10px', // 更小的内边距
              fontSize: '11px', // 更小的字体
              fontWeight: 400,
              display: 'flex',
              alignItems: 'center',
              gap: 0.4,
              backdropFilter: 'blur(8px)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
              border: '1px solid rgba(255, 255, 255, 0.3)', // 明显的边框
              minHeight: 'unset', // 移除最小高度限制
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.5)',
              },
              '&:active': {
                transform: 'scale(0.96)',
              },
            }}
          >
            <FullscreenIcon sx={{ fontSize: 14 }} />
            <Box component="span">全屏观看</Box>
          </IconButton>
        </Box>
      )}
    </Box>
  )
})

MobileVideoPlayer.displayName = 'MobileVideoPlayer'

export default MobileVideoPlayer
