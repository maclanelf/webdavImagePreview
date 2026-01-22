'use client'

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react'
import { Box, CircularProgress, Typography, IconButton, Menu, MenuItem } from '@mui/material'
import { 
  PlayArrow as PlayArrowIcon, 
  Pause as PauseIcon, 
  VolumeUp as VolumeUpIcon,
  VolumeOff as VolumeOffIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  ScreenRotation as ScreenRotationIcon,
  Speed as SpeedIcon,
  Replay as ReplayIcon,
} from '@mui/icons-material'

interface InstantVideoPlayerProps {
  src: string
  onLoadStart?: () => void
  onCanPlay?: () => void
  onError?: (error: string) => void
  onTimeUpdate?: (currentTime: number, duration: number) => void
  onEnded?: () => void
  onNext?: () => void // 换一个按钮回调
  style?: React.CSSProperties
  className?: string
  autoPlay?: boolean
  playIntent?: boolean // 标记用户是否有播放意图（用于安卓浏览器自动播放）
  // 转码降级相关
  transcodeUrl?: string // 转码流 URL（当原始流播放失败时使用）
  onTranscodeFallback?: () => void // 降级到转码时的回调
}

export interface InstantVideoPlayerRef {
  play: () => Promise<void>
  pause: () => void
  getCurrentTime: () => number
  getDuration: () => number
  setCurrentTime: (time: number) => void
  getVideoElement: () => HTMLVideoElement | null
  isPaused: () => boolean
  getContainerElement: () => HTMLDivElement | null  // 获取容器元素，用于在全屏模式下渲染对话框
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
  onNext,
  style,
  className,
  autoPlay = false,
  playIntent = false,
  transcodeUrl,
  onTranscodeFallback,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null) // 视频元素引用
  const [loading, setLoading] = useState(true) // 加载状态
  const [error, setError] = useState<string | null>(null) // 错误信息
  const [isPlaying, setIsPlaying] = useState(false) // 播放状态
  const [showControls, setShowControls] = useState(false) // 控制栏显示状态
  const [currentTime, setCurrentTime] = useState(0) // 当前播放时间
  const [duration, setDuration] = useState(0) // 视频总时长
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null) // 视频宽高比
  const [isFullscreen, setIsFullscreen] = useState(false) // 全屏状态
  const containerRef = useRef<HTMLDivElement>(null) // 容器元素引用
  const [isMuted, setIsMuted] = useState(false) // 静音状态
  const [playbackRate, setPlaybackRate] = useState(1) // 播放速度
  const [speedMenuAnchor, setSpeedMenuAnchor] = useState<null | HTMLElement>(null) // 倍速菜单锚点
  
  // 转码降级状态
  const [isUsingTranscode, setIsUsingTranscode] = useState(false) // 是否正在使用转码流
  const [hasTriedTranscode, setHasTriedTranscode] = useState(false) // 是否已尝试过转码
  
  // 播放意图引用 - 用于安卓浏览器自动播放
  const playIntentRef = useRef(playIntent)
  // 是否需要静音播放（安卓浏览器自动播放策略）- 初始为 false，只有播放失败时才设置为 true
  const [isMutedForAutoplay, setIsMutedForAutoplay] = useState(false)
  
  // 下载速度和缓冲进度相关状态
  const [downloadSpeed, setDownloadSpeed] = useState<number>(0) // 下载速度 (MB/s)
  const [bufferedPercent, setBufferedPercent] = useState<number>(0) // 缓冲百分比
  const lastBufferedEndRef = useRef<number>(0) // 上次缓冲结束位置 (秒)
  const lastUpdateTimeRef = useRef<number>(Date.now()) // 上次更新时间 (毫秒)

  // 播放状态管理
  // 播放Promise管理，用于追踪正在进行的播放请求，避免多次调用play()导致的竞态条件
  const [playPromise, setPlayPromise] = useState<Promise<void> | null>(null)
  // 标记是否已经尝试过自动播放，防止重复尝试
  const [hasAttemptedAutoPlay, setHasAttemptedAutoPlay] = useState(false)

  // 同步 playIntent prop 到 ref
  useEffect(() => {
    playIntentRef.current = playIntent
    if (playIntent) {
      console.log('📱 [即点即播] 检测到播放意图')
    }
  }, [playIntent])

  // 保存上一个 src 的引用，用于检测 src 变化
  const prevSrcRef = useRef<string | null>(null)
  
  // 当src变化时重置状态并清理旧的video元素
  useEffect(() => {
    const prevSrc = prevSrcRef.current
    prevSrcRef.current = src
    
    // 如果是同一个 src，不需要清理
    if (prevSrc === src) {
      return
    }
    
    console.log('🔄 [即点即播] src变化，重置播放器状态')
    console.log(`  旧 src: ${prevSrc?.substring(0, 50)}...`)
    console.log(`  新 src: ${src?.substring(0, 50)}...`)
    
    // ⭐ 关键修复：在设置新 src 之前，先彻底清理旧的视频连接
    if (videoRef.current && prevSrc) {
      const video = videoRef.current
      
      // 1. 立即暂停
      video.pause()
      
      // 2. 清空 src 以中断网络请求
      // 这会触发浏览器取消当前的网络请求
      video.src = ''
      
      // 3. 调用 load() 强制浏览器释放资源
      video.load()
      
      console.log('🗑️ [即点即播] 已清理旧视频连接')
    }
    
    // 重置所有播放状态
    setHasAttemptedAutoPlay(false)
    setLoading(true)
    setError(null)
    setCurrentTime(0)
    setDuration(0)
    setVideoAspectRatio(null)
    setIsPlaying(false)
    setDownloadSpeed(0)
    setBufferedPercent(0)
    setIsMutedForAutoplay(false) // 重置静音状态
    setIsUsingTranscode(false) // 重置转码状态
    setHasTriedTranscode(false) // 重置转码尝试标记
    lastBufferedEndRef.current = 0
    lastUpdateTimeRef.current = Date.now()
    
    // 清理正在进行的播放Promise
    if (playPromise) {
      playPromise.catch(() => {
        // 忽略错误
      })
      setPlayPromise(null)
    }
  }, [src, playPromise])

  // 模仿主页面的自动播放逻辑：先静音播放，成功后取消静音
  // ⭐ 修复：移除 load() 调用，避免双重请求
  useEffect(() => {
    if (!src || !videoRef.current || !(autoPlay || playIntentRef.current)) return
    
    const video = videoRef.current
    
    console.log('🎬 [即点即播] 尝试自动播放，playIntent:', playIntentRef.current)
    
    // 确保视频是静音的
    video.muted = true
    setIsMutedForAutoplay(true)
    
    // ⭐ 移除 video.load() 调用，因为 React 更新 src 属性时浏览器会自动加载
    // 这样可以避免双重网络请求
    
    console.log('🎬 [即点即播] 等待视频加载完成后尝试播放')
    
    // 设置事件监听，等待视频准备好后再播放
    const handleAutoPlay = () => {
      if (video.paused && (autoPlay || playIntentRef.current)) {
        console.log('🎬 [即点即播] 视频准备就绪，尝试播放')
        video.muted = true
        setIsMutedForAutoplay(true)
        video.play().then(() => {
          console.log('✅ [即点即播] 播放成功')
          // 播放成功后延迟取消静音
          setTimeout(() => {
            if (video.muted && !video.paused) {
              video.muted = false
              setIsMutedForAutoplay(false)
              console.log('🔊 [即点即播] 已取消静音')
            }
          }, 500)
        }).catch(err => {
          console.error('❌ [即点即播] 播放失败:', err)
        })
      }
    }
    
    // 添加事件监听（优先使用 loadeddata，它比 canplay 更早触发）
    video.addEventListener('loadeddata', handleAutoPlay, { once: true })
    
    return () => {
      video.removeEventListener('loadeddata', handleAutoPlay)
    }
  }, [src, autoPlay])

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
    isPaused: () => videoRef.current?.paused || true,
    getContainerElement: () => containerRef.current,
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
    // 这是实现“即点即播”的核心：在最早可能的时机启动播放
    if ((autoPlay || playIntentRef.current) && videoRef.current && !hasAttemptedAutoPlay) {
      setHasAttemptedAutoPlay(true) // 标记已尝试自动播放，防止重复尝试
      const video = videoRef.current
      
      const tryPlay = async () => {
        try {
          // 调用 play() 并保存 Promise，用于追踪播放状态
          const promise = video.play()
          setPlayPromise(promise)
          await promise
          setPlayPromise(null)
          console.log('✅ [即点即播] 元数据加载后立即播放')
        } catch (error) {
          // 播放失败，尝试静音播放（安卓浏览器策略）
          console.log('⚠️ [即点即播] 元数据加载后播放失败，尝试静音播放:', error)
          setPlayPromise(null)
          
          // 尝试静音播放
          try {
            video.muted = true
            setIsMutedForAutoplay(true)
            const mutedPromise = video.play()
            setPlayPromise(mutedPromise)
            await mutedPromise
            setPlayPromise(null)
            console.log('✅ [即点即播] 静音播放成功')
            // 注意：安卓浏览器不能自动取消静音，否则会暂停播放
            // 静音状态会在用户点击播放器时通过 togglePlayPause 取消
          } catch (mutedError) {
            console.error('❌ [即点即播] 静音播放也失败:', mutedError)
            setPlayPromise(null)
            setHasAttemptedAutoPlay(false) // 重置标记，让canPlay事件可以再次尝试播放
          }
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
    if (videoRef.current && (autoPlay || playIntentRef.current) && !hasAttemptedAutoPlay) {
      setHasAttemptedAutoPlay(true)
      const video = videoRef.current
      
      const attemptPlay = async () => {
        try {
          if (playPromise) {
            try {
              await playPromise
            } catch (e) {
              // 忽略之前播放请求的错误
            }
          }
          
          const promise = video.play()
          setPlayPromise(promise)
          await promise
          setPlayPromise(null)
          console.log('✅ [即点即播] canPlay事件播放成功')
        } catch (error) {
          console.log('⚠️ [即点即播] canPlay自动播放被阻止，尝试静音播放:', error)
          setPlayPromise(null)
          
          // 尝试静音播放
          try {
            video.muted = true
            setIsMutedForAutoplay(true)
            const mutedPromise = video.play()
            setPlayPromise(mutedPromise)
            await mutedPromise
            setPlayPromise(null)
            console.log('✅ [即点即播] canPlay静音播放成功')
            // 注意：安卓浏览器不能自动取消静音，否则会暂停播放
          } catch (mutedError) {
            console.error('❌ [即点即播] canPlay静音播放也失败:', mutedError)
            setPlayPromise(null)
          }
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
      
      // 重置播放意图
      playIntentRef.current = false
      
      // 注意：安卓浏览器不能自动取消静音，否则会暂停播放
      // 静音状态会在用户点击播放器时通过 togglePlayPause 取消
      if (videoRef.current.muted && isMutedForAutoplay) {
        console.log('� [即点即播] 视频以静音模式播放，用户点击后取消静音')
      }
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
    const video = e.currentTarget
    
    // 如果 video.src 为空或与当前 props.src 不匹配，忽略错误
    // 这通常发生在切换视频时，旧视频被清理触发的错误
    if (!video.src || video.src === '' || (src && !video.src.includes(encodeURIComponent(src.split('?')[0].split('/').pop() || '')))) {
      console.log('🔇 [即点即播] 视频源已变更，忽略错误事件')
      return
    }
    
    const mediaError = video.error
    
    let errorMessage = '视频加载失败'
    let errorDetails = ''
    
    if (mediaError) {
      // 如果是中止错误（MEDIA_ERR_ABORTED），通常是切换视频导致的，不显示错误
      if (mediaError.code === MediaError.MEDIA_ERR_ABORTED) {
        console.log('🔇 [即点即播] 视频加载被中止，忽略错误')
        return
      }
      
      // 获取详细的错误码和信息
      switch (mediaError.code) {
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage = '网络错误，无法加载视频'
          errorDetails = 'MEDIA_ERR_NETWORK (2)'
          break
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage = '视频解码失败'
          errorDetails = 'MEDIA_ERR_DECODE (3)'
          break
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = '视频格式不支持或源不可用'
          errorDetails = 'MEDIA_ERR_SRC_NOT_SUPPORTED (4)'
          break
        default:
          errorDetails = `未知错误码: ${mediaError.code}`
      }
      
      console.error('❌ [即点即播] 视频错误详情:', {
        errorCode: mediaError.code,
        errorMessage: mediaError.message || '无详细信息',
        errorDetails,
        videoSrc: video.src,
        networkState: video.networkState,
        readyState: video.readyState,
        currentSrc: video.currentSrc,
        isUsingTranscode,
        hasTriedTranscode,
      })
      
      // 网络状态说明
      const networkStateMap: Record<number, string> = {
        0: 'NETWORK_EMPTY - 未初始化',
        1: 'NETWORK_IDLE - 空闲',
        2: 'NETWORK_LOADING - 正在加载',
        3: 'NETWORK_NO_SOURCE - 无有效源',
      }
      console.error('❌ [即点即播] 网络状态:', networkStateMap[video.networkState] || video.networkState)
      
      // 就绪状态说明
      const readyStateMap: Record<number, string> = {
        0: 'HAVE_NOTHING - 无信息',
        1: 'HAVE_METADATA - 有元数据',
        2: 'HAVE_CURRENT_DATA - 有当前帧数据',
        3: 'HAVE_FUTURE_DATA - 有未来帧数据',
        4: 'HAVE_ENOUGH_DATA - 有足够数据',
      }
      console.error('❌ [即点即播] 就绪状态:', readyStateMap[video.readyState] || video.readyState)
    } else {
      console.error('❌ [即点即播] 视频错误 (无 MediaError):', e)
    }
    
    // 不再自动降级到转码流，直接显示错误，让用户选择
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
   * 当浏览器下载媒体数据时周期性触发，用于监控视频的缓冲状态和下载速度。
   * 通过检查 buffered 属性，我们可以知道哪些时间范围的视频数据已经被缓冲。
   * 
   * 触发时机：
   * - 浏览器正在下载视频数据时周期性触发
   * - 通常每隔几百毫秒触发一次
   * 
   * 主要功能：
   * 1. 获取视频的缓冲时间范围（TimeRanges 对象）
   * 2. 计算已缓冲数据占总时长的百分比
   * 3. 计算实时下载速度 (基于时间和数据量的变化)
   * 4. 输出详细的缓冲进度日志，便于调试和监控播放性能
   * 
   * 注意事项：
   * - buffered 是一个 TimeRanges 对象，可能包含多个不连续的时间段
   * - 这里只关注最后一个缓冲范围的结束时间，作为整体缓冲进度的指标
   * - 速度计算基于缓冲时长的增量和时间差，近似估算下载速率
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
          const percent = (bufferedEnd / duration * 100)
          setBufferedPercent(percent)
          
          // 计算下载速度
          const now = Date.now()
          const timeDiff = (now - lastUpdateTimeRef.current) / 1000 // 转换为秒
          const bufferedDiff = bufferedEnd - lastBufferedEndRef.current // 缓冲时长差(秒)
          
          // 只有当时间差大于0.5秒且有新数据缓冲时才更新速度
          if (timeDiff > 0.5 && bufferedDiff > 0) {
            // 估算比特率：假设视频平均码率
            // 对于流式传输，我们用缓冲时长的变化来估算速度
            // 这里假设视频平均码率为 5 Mbps (可根据实际情况调整)
            const estimatedBitrate = 5 // Mbps
            const speed = (bufferedDiff * estimatedBitrate) / (timeDiff * 8) // MB/s
            
            setDownloadSpeed(speed)
            lastBufferedEndRef.current = bufferedEnd
            lastUpdateTimeRef.current = now
          }
          
          // 输出缓冲进度日志：百分比和具体时间
          console.log(`📊 [即点即播] 缓冲进度: ${percent.toFixed(1)}% (${bufferedEnd.toFixed(1)}s / ${duration.toFixed(1)}s), 速度: ${downloadSpeed.toFixed(2)} MB/s`)
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
  const togglePlayPause = async (e?: React.MouseEvent) => {
    // 阻止事件冒泡，避免触发视频容器的点击事件
    if (e) {
      e.stopPropagation()
    }
    
    if (!videoRef.current) return
    
    // 用户交互时取消静音（安卓浏览器需要用户交互才能取消静音）
    if (videoRef.current.muted && isMutedForAutoplay) {
      videoRef.current.muted = false
      setIsMutedForAutoplay(false)
      console.log('🔊 [即点即播] 用户交互，已取消静音')
    }
    
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

  // 切换控制栏显示状态
  const toggleControls = () => {
    setShowControls(prev => !prev)
    
    // 用户交互时取消静音（安卓浏览器需要用户交互才能取消静音）
    if (videoRef.current?.muted && isMutedForAutoplay) {
      videoRef.current.muted = false
      setIsMutedForAutoplay(false)
      console.log('🔊 [即点即播] 用户点击视频区域，已取消静音')
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
    try {
      // 尝试使用 Screen Orientation API
      if ('orientation' in screen && 'lock' in (screen.orientation as any)) {
        const currentOrientation = screen.orientation.type
        if (currentOrientation.includes('portrait')) {
          // 当前竖屏，切换到横屏
          await (screen.orientation as any).lock('landscape')
        } else {
          // 当前横屏，切换到竖屏
          await (screen.orientation as any).lock('portrait')
        }
      } else {
        // 如果不支持方向锁定，尝试进入全屏（移动端的替代方案）
        if (!document.fullscreenElement) {
          await toggleFullscreen()
        } else {
          await document.exitFullscreen()
        }
      }
    } catch (error) {
      console.error('屏幕方向切换失败:', error)
      // 如果锁定失败，尝试进入/退出全屏
      try {
        if (!document.fullscreenElement) {
          await toggleFullscreen()
        } else {
          await document.exitFullscreen()
        }
      } catch (e) {
        console.error('全屏切换也失败:', e)
      }
    }
  }

  // 切换静音
  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted
      setIsMuted(videoRef.current.muted)
    }
  }

  // 打开倍速菜单
  const handleSpeedMenuOpen = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    setSpeedMenuAnchor(e.currentTarget)
  }

  // 关闭倍速菜单
  const handleSpeedMenuClose = () => {
    setSpeedMenuAnchor(null)
  }

  // 设置播放速度
  const handleSpeedChange = (speed: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed
      setPlaybackRate(speed)
    }
    handleSpeedMenuClose()
  }

  // 监听全屏状态变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement
      setIsFullscreen(isNowFullscreen)
      // 进入全屏时隐藏自定义控件，与原生控件同步
      if (isNowFullscreen) {
        setShowControls(false)
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  // 重试播放函数（直接播放）
  const retryPlayback = () => {
    console.log('🔄 [即点即播] 用户点击重试（直接播放）')
    setError(null)
    setLoading(true)
    setHasAttemptedAutoPlay(false)
    setBufferedPercent(0)
    setDownloadSpeed(0)
    setIsUsingTranscode(false)
    lastBufferedEndRef.current = 0
    lastUpdateTimeRef.current = Date.now()
    
    if (videoRef.current) {
      // 重新加载原始视频
      videoRef.current.src = src
      videoRef.current.load()
      
      // 尝试播放
      if (autoPlay || playIntentRef.current) {
        videoRef.current.muted = true
        setIsMutedForAutoplay(true)
        videoRef.current.play().catch(err => {
          console.log('⚠️ [即点即播] 重试播放失败:', err)
        })
      }
    }
  }

  // 使用转码播放函数
  const playWithTranscode = () => {
    if (!transcodeUrl) {
      console.log('⚠️ [即点即播] 没有可用的转码 URL')
      return
    }
    
    console.log('🔄 [即点即播] 用户选择转码播放')
    setError(null)
    setLoading(true)
    setHasAttemptedAutoPlay(false)
    setBufferedPercent(0)
    setDownloadSpeed(0)
    setIsUsingTranscode(true)
    setHasTriedTranscode(true)
    lastBufferedEndRef.current = 0
    lastUpdateTimeRef.current = Date.now()
    
    // 通知父组件
    onTranscodeFallback?.()
    
    if (videoRef.current) {
      // 切换到转码流
      videoRef.current.src = transcodeUrl
      videoRef.current.load()
      
      // 尝试播放
      if (autoPlay || playIntentRef.current) {
        videoRef.current.muted = true
        setIsMutedForAutoplay(true)
        videoRef.current.play().catch(err => {
          console.log('⚠️ [即点即播] 转码播放失败:', err)
        })
      }
    }
  }

  return (
    <Box 
      ref={containerRef}
      className={className}
      onClick={error ? undefined : toggleControls}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        overflow: 'hidden',
        cursor: error ? 'default' : 'pointer',
        // 禁用点击高亮效果
        WebkitTapHighlightColor: 'transparent',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        ...style,
      }}
    >
      {/* 错误覆盖层 - 只有在非加载状态下才显示错误 */}
      {error && !loading && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            borderRadius: 3,
            padding: '20px 24px',
            minWidth: 200,
          }}
        >
          {/* 错误信息 */}
          <Typography
            sx={{
              color: 'rgba(255, 100, 100, 0.9)',
              fontSize: '0.85rem',
              textAlign: 'center',
              mb: 2,
            }}
          >
            {error}
          </Typography>
          
          {/* 按钮组 */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            {/* 直接播放按钮 */}
            <IconButton
              onClick={retryPlayback}
              sx={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: '#fff',
                width: 64,
                height: 64,
                flexDirection: 'column',
                borderRadius: 2,
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
            >
              <ReplayIcon sx={{ fontSize: '1.8rem' }} />
              <Typography sx={{ fontSize: '0.65rem', mt: 0.5 }}>重试</Typography>
            </IconButton>
            
            {/* 转码播放按钮 - 仅当有转码 URL 时显示 */}
            {transcodeUrl && (
              <IconButton
                onClick={playWithTranscode}
                sx={{
                  backgroundColor: 'rgba(233, 69, 96, 0.3)',
                  color: '#e94560',
                  width: 64,
                  height: 64,
                  flexDirection: 'column',
                  borderRadius: 2,
                  '&:hover': {
                    backgroundColor: 'rgba(233, 69, 96, 0.5)',
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                  },
                }}
              >
                <PlayArrowIcon sx={{ fontSize: '1.8rem' }} />
                <Typography sx={{ fontSize: '0.65rem', mt: 0.5 }}>转码</Typography>
              </IconButton>
            )}
          </Box>
        </Box>
      )}
      {/* 视频元素 */}
      {/* ⭐ 修复：使用 key 属性强制 React 在 src 变化时重新创建元素，避免双重请求 */}
      <video
        key={src} // 添加 key，确保 src 变化时完全重新创建元素
        ref={videoRef}
        src={src}
        controls={false} // 使用自定义控件
        preload="auto" // 积极加载，实现即点即播
        playsInline // 移动设备内联播放
        muted={isMutedForAutoplay} // 只有在静音降级后才设置静音
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          pointerEvents: 'none', // 防止视频元素拦截点击事件
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
      />
      
      {/* 加载指示器 - 优化样式，卡顿时也显示进度条和控制按钮 */}
      {loading && (
        <>
          {/* 中央加载指示器 */}
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
              gap: 1.5,
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              backdropFilter: 'blur(8px)',
              borderRadius: 3,
              padding: '20px 28px',
              minWidth: 140,
            }}
          >
            {/* 圆形进度条 */}
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              {/* 背景圆环 */}
              <CircularProgress 
                variant="determinate" 
                value={100} 
                size={70}
                thickness={3}
                sx={{ color: 'rgba(255, 255, 255, 0.15)' }} 
              />
              {/* 进度圆环 */}
              <CircularProgress 
                variant={bufferedPercent > 0 ? "determinate" : "indeterminate"}
                value={bufferedPercent} 
                size={70}
                thickness={3}
                sx={{ 
                  color: bufferedPercent > 50 ? '#4caf50' : '#2196f3',
                  position: 'absolute',
                  left: 0,
                }} 
              />
              {/* 中心百分比 */}
              <Box
                sx={{
                  top: 0,
                  left: 0,
                  bottom: 0,
                  right: 0,
                  position: 'absolute',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography
                  variant="body2"
                  component="div"
                  sx={{ 
                    color: '#fff', 
                    fontWeight: 'bold',
                    fontSize: '1rem',
                  }}
                >
                  {bufferedPercent > 0 ? `${Math.round(bufferedPercent)}%` : '...'}
                </Typography>
              </Box>
            </Box>
            
            {/* 下载速度 */}
            {downloadSpeed > 0 ? (
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 0.5,
              }}>
                <Typography 
                  sx={{ 
                    color: downloadSpeed > 2 ? '#4caf50' : downloadSpeed > 0.5 ? '#2196f3' : '#ffa726',
                    fontSize: '0.9rem',
                    fontWeight: 'medium',
                    fontFamily: 'monospace',
                  }}
                >
                  {downloadSpeed >= 1 
                    ? `${downloadSpeed.toFixed(1)} MB/s` 
                    : `${(downloadSpeed * 1024).toFixed(0)} KB/s`}
                </Typography>
              </Box>
            ) : (
              <Typography 
                sx={{ 
                  color: 'rgba(255, 255, 255, 0.7)',
                  fontSize: '0.85rem',
                }}
              >
                正在连接...
              </Typography>
            )}
          </Box>
          
          {/* 卡顿时也显示底部控制栏 */}
          <Box
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            sx={{
              background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))',
              p: 1,
              pb: 2,
              zIndex: 2,
            }}
          >
            {/* 进度条 */}
            <Box 
              sx={{ 
                width: '100%', 
                mb: 1,
                px: 1,
              }} 
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
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
                  height: '8px',
                  background: `linear-gradient(to right, #4caf50 ${(currentTime / (duration || 1)) * 100}%, rgba(255, 255, 255, 0.3) ${(currentTime / (duration || 1)) * 100}%)`,
                  outline: 'none',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  WebkitAppearance: 'none',
                  appearance: 'none',
                }}
              />
            </Box>
            
            {/* 控制按钮 */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <IconButton
                  size="small"
                  disableRipple
                  onClick={(e) => togglePlayPause(e)}
                  sx={{ color: '#fff', p: 0.5 }}
                >
                  {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                </IconButton>
                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.75rem' }}>
                  {formatTime(currentTime)} / {formatTime(duration)}
                </Typography>
              </Box>
              
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <IconButton size="small" disableRipple sx={{ color: '#fff', p: 0.5 }} onClick={toggleMute}>
                  {isMuted ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
                </IconButton>
                <IconButton size="small" disableRipple sx={{ color: '#fff', p: 0.5 }} onClick={handleSpeedMenuOpen}>
                  <SpeedIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" disableRipple sx={{ color: '#fff', p: 0.5 }} onClick={(e) => { e.stopPropagation(); toggleOrientation(); }}>
                  <ScreenRotationIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" disableRipple sx={{ color: '#fff', p: 0.5 }} onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>
                  {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
                </IconButton>
              </Box>
            </Box>
          </Box>
        </>
      )}
      
      {/* 播放/暂停按钮覆盖层 - 始终渲染，通过 opacity 控制显示 */}
      {!loading && (
        <Box
          position="absolute"
          top="50%"
          left="50%"
          sx={{
            transform: 'translate(-50%, -50%)',
            zIndex: 2,
            opacity: showControls ? 0.8 : 0,
            pointerEvents: showControls ? 'auto' : 'none',
            transition: 'opacity 0.15s ease-out',
          }}
        >
          <IconButton
            disableRipple
            onClick={(e) => togglePlayPause(e)}
            sx={{
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: '#fff',
              fontSize: '3rem',
              '&:hover': {
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
              },
              '&:active': { opacity: 0.7 },
            }}
          >
            {isPlaying ? <PauseIcon fontSize="inherit" /> : <PlayArrowIcon fontSize="inherit" />}
          </IconButton>
        </Box>
      )}
      
      {/* 底部控制栏 - 始终渲染，通过 opacity 和 transform 控制显示 */}
      {!loading && (
        <Box
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          sx={{
            background: 'linear-gradient(transparent, rgba(0, 0, 0, 0.8))',
            p: 1,
            pb: 2, // 增加底部内边距，避免被系统导航栏遮挡
            zIndex: 2,
            opacity: showControls ? 1 : 0,
            transform: showControls ? 'translateY(0)' : 'translateY(100%)',
            pointerEvents: showControls ? 'auto' : 'none',
            transition: 'opacity 0.15s ease-out, transform 0.15s ease-out',
          }}
        >
          {/* 进度条单独一行，确保可以拖动 */}
          <Box 
            sx={{ 
              width: '100%', 
              mb: 1,
              px: 1,
            }} 
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
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
                height: '8px', // 增加高度，更容易点击
                background: `linear-gradient(to right, #4caf50 ${(currentTime / (duration || 1)) * 100}%, rgba(255, 255, 255, 0.3) ${(currentTime / (duration || 1)) * 100}%)`,
                outline: 'none',
                cursor: 'pointer',
                borderRadius: '4px',
                WebkitAppearance: 'none',
                appearance: 'none',
              }}
            />
          </Box>
          
          {/* 控制按钮行 */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.5 }}>
            {/* 左侧：播放按钮和时间 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <IconButton
                size="small"
                disableRipple
                onClick={(e) => togglePlayPause(e)}
                sx={{ 
                  color: '#fff', 
                  p: 0.5,
                  '&:active': { opacity: 0.7 },
                }}
              >
                {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
              </IconButton>
              
              {/* 时间显示 */}
              <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.75rem' }}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </Typography>
            </Box>
            
            {/* 右侧：功能按钮 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {/* 音量按钮 */}
              <IconButton
                size="small"
                disableRipple
                sx={{ 
                  color: '#fff', 
                  p: 0.5,
                  '&:active': { opacity: 0.7 },
                }}
                onClick={toggleMute}
              >
                {isMuted ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
              </IconButton>
              
              {/* 倍速按钮 */}
              <IconButton
                size="small"
                disableRipple
                sx={{ 
                  color: '#fff', 
                  p: 0.5,
                  '&:active': { opacity: 0.7 },
                }}
                onClick={handleSpeedMenuOpen}
              >
                <SpeedIcon fontSize="small" />
              </IconButton>
              
              {/* 横竖屏切换按钮 */}
              <IconButton
                size="small"
                disableRipple
                sx={{ 
                  color: '#fff', 
                  p: 0.5,
                  '&:active': { opacity: 0.7 },
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleOrientation()
                }}
              >
                <ScreenRotationIcon fontSize="small" />
              </IconButton>
              
              {/* 全屏按钮 */}
              <IconButton
                size="small"
                disableRipple
                sx={{ 
                  color: '#fff', 
                  p: 0.5,
                  '&:active': { opacity: 0.7 },
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFullscreen()
                }}
              >
                {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
              </IconButton>
            </Box>
          </Box>
        </Box>
      )}
      
      {/* 倍速菜单 */}
      <Menu
        anchorEl={speedMenuAnchor}
        open={Boolean(speedMenuAnchor)}
        onClose={handleSpeedMenuClose}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
      >
        {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
          <MenuItem
            key={speed}
            selected={playbackRate === speed}
            onClick={() => handleSpeedChange(speed)}
            sx={{
              fontSize: '0.875rem',
              minWidth: 100,
              justifyContent: 'center',
            }}
          >
            {speed}x
          </MenuItem>
        ))}
      </Menu>
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
