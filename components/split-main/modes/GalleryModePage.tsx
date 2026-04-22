'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type SyntheticEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react'

import {
  Box,
  Button,
  CardMedia,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  OpenInNew as OpenInNewIcon,
  Shuffle as ShuffleIcon,
  SkipNext as SkipNextIcon,
} from '@mui/icons-material'

import { useGalleryMode } from '@/app/split-main/gallery/useGalleryMode'
import CreatorTag from '@/components/CreatorTag'
import CreatorDetailTag from '../../CreatorDetailTag'
import DraggableFab from '@/components/DraggableFab'
import MobileVideoPlayer from '@/components/MobileVideoPlayer'
import QuickRating from '@/components/QuickRating'
import RatingDialog from '@/components/RatingDialog'
import CommonPreviewSurface from '@/components/split-main/CommonPreviewSurface'
import FullscreenRatingDock from '@/components/split-main/shared/FullscreenRatingDock'
import MediaInfoFooter from '@/components/split-main/shared/MediaInfoFooter'
import {
  resolveSmallVideoPlaybackState,
  type PlaybackMode,
} from '@/components/split-main/shared/videoPlayback'
import { useExternalPlayerMenu } from '@/components/split-main/shared/useExternalPlayerMenu'
import { useModeSwitchGuard } from '@/components/split-main/shared/useModeSwitchGuard'
import type {
  AdvancedFilters,
  GroupRating,
  MediaFile,
  MediaRating,
  MediaType,
  ViewedFilter,
  WebDAVConfig,
} from '@/types'

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const getGroupPath = (filePath: string): string => {
  const lastSlashIndex = filePath.lastIndexOf('/')
  return lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '/'
}

const getGroupName = (groupPath: string): string => {
  const pathParts = groupPath.split('/').filter((part) => part.length > 0)
  return pathParts.length > 0 ? pathParts[pathParts.length - 1] : '根目录'
}

type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning'

interface GalleryModePageProps {
  config: WebDAVConfig | null
  directoryCount: number
  filteredStatsLabel: string
  filteredStatsTotal: number
  currentFile: MediaFile | null
  setCurrentFile: (file: MediaFile | null) => void
  setCurrentCreator: (creator: any) => void
  creatorRefreshKey: number
  mediaUrl: string | null
  setMediaUrl: (url: string | null) => void
  transcodeUrl: string | null
  setTranscodeUrl: (url: string | null) => void
  originalStreamUrl: string | null
  setOriginalStreamUrl: (url: string | null) => void
  mediaType: MediaType
  setMediaType: (type: MediaType) => void
  isUsingTranscode: boolean
  setIsUsingTranscode: (value: boolean) => void
  loading: boolean
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  viewedFilter: ViewedFilter
  advancedFilters: AdvancedFilters
  preloadEnabled: boolean
  setPreloadStatus: (status: any) => void
  setCachePreloadProgress: (progress: { current: number; total: number } | null) => void
  cachePreloadProgress: { current: number; total: number } | null
  preloadInsufficient: boolean
  actualFoundCount: number
  galleryPreloadReady: boolean
  currentRating: MediaRating | GroupRating | null
  setCurrentRating: (rating: any) => void
  ratingType: 'media' | 'group'
  setRatingType: (type: 'media' | 'group') => void
  handleQuickRate: (rating: number, evaluation: string) => Promise<void>
  openRatingDialog: (type: 'media' | 'group') => void
  onOpenCreatorDialog: () => void
  onOpenCreatorDetail?: (creator?: any | null) => void
  ratingDialogOpen: boolean
  closeRatingDialog: () => void
  saveRatingManual: (data: MediaRating | GroupRating, file?: MediaFile) => Promise<void>
  handleRatingSaveSuccess: () => void
  fullscreen: boolean
  toggleFullscreen: () => void
  isMobile: boolean
  videoRef: MutableRefObject<HTMLVideoElement | null>
  mobileVideoRef: MutableRefObject<any>
  videoPlayerContainerRef: MutableRefObject<HTMLDivElement | null>
  shouldAutoPlay: boolean
  playIntentRef: MutableRefObject<boolean>
  videoStateRef: MutableRefObject<{ currentTime: number; paused: boolean } | null>
  loadCurrentRatingRef: MutableRefObject<(file?: MediaFile, forceType?: 'media' | 'group') => Promise<void>>
  startAutoMarkTimerRef: MutableRefObject<(file?: MediaFile, skipAutoRating?: boolean) => void>
  handleMediaTypeChangeInFullscreenRef: MutableRefObject<(nextFile: MediaFile) => boolean>
  enterVideoFullscreenRef: MutableRefObject<() => Promise<void> | void>
  isVideoRef: MutableRefObject<(filename: string) => boolean>
  performAutoRating: () => void | Promise<void>
  setPlayIntent: (intent: boolean) => void
  stopAutoMarkTimer: () => void
  onGalleryStateChange: (group: MediaFile[], index: number) => void
}

/**
 * 图组模式页面模块。
 *
 * 这个组件专门承载图组模式自己的：
 * - 图组状态与图内切换逻辑
 * - 图组模式专属手势与全屏覆盖层
 * - 图组模式自己的外部播放与直链切源 UI
 * - 图组模式自己的空状态、加载态、底部信息区与评分弹窗挂载
 *
 * 主页面 [`SplitMainWorkspace`](components/split-main/SplitMainWorkspace.tsx) 只负责通用壳层：
 * 顶部、抽屉、共享评分能力、通用配置与模式切换。
 */
export default function GalleryModePage({
  config,
  directoryCount,
  filteredStatsLabel,
  filteredStatsTotal,
  currentFile,
  setCurrentFile,
  setCurrentCreator,
  creatorRefreshKey,
  mediaUrl,
  setMediaUrl,
  transcodeUrl,
  setTranscodeUrl,
  originalStreamUrl,
  setOriginalStreamUrl,
  mediaType,
  setMediaType,
  isUsingTranscode,
  setIsUsingTranscode,
  loading,
  setLoading,
  setError,
  viewedFilter,
  advancedFilters,
  preloadEnabled,
  setPreloadStatus,
  setCachePreloadProgress,
  cachePreloadProgress,
  preloadInsufficient,
  actualFoundCount,
  galleryPreloadReady,
  currentRating,
  setCurrentRating,
  ratingType,
  setRatingType,
  handleQuickRate,
  openRatingDialog,
  onOpenCreatorDialog,
  onOpenCreatorDetail,
  ratingDialogOpen,
  closeRatingDialog,
  saveRatingManual,
  handleRatingSaveSuccess,
  fullscreen,
  toggleFullscreen,
  isMobile,
  videoRef,
  mobileVideoRef,
  videoPlayerContainerRef,
  shouldAutoPlay,
  playIntentRef,
  videoStateRef,
  loadCurrentRatingRef,
  startAutoMarkTimerRef,
  handleMediaTypeChangeInFullscreenRef,
  enterVideoFullscreenRef,
  isVideoRef,
  performAutoRating,
  setPlayIntent,
  stopAutoMarkTimer,
  onGalleryStateChange,
}: GalleryModePageProps) {
  /**
   * 图组模式自己的播放器与切换状态。
   * - [`smallVideoDirectPlayEnabled`](components/split-main/modes/GalleryModePage.tsx:217) 控制小视频是否显示直链播放按钮
   * - 外部播放器菜单只服务图组模式自己的底部操作区
   * - [`isSwitching`](components/split-main/modes/GalleryModePage.tsx:221) 防止连续切图导致缓存状态错乱
   */
  const [smallVideoDirectPlayEnabled, setSmallVideoDirectPlayEnabled] = useState(false)
  const smallVideoDirectPlayAvailableRef = useRef(false)
  const [showPlayModeSelector, setShowPlayModeSelector] = useState(false)
  const saveAndSwitchRef = useRef<(switchCallback: () => void) => Promise<void> | void>(() => {})
  const { isSwitching, runSwitch: saveAndSwitch } = useModeSwitchGuard({
    currentFile,
    setPreloadStatus,
    beforeSwitch: stopAutoMarkTimer,
  })

  /**
   * 图组模式专属全屏手势状态。
   * 当前图组模式支持：
   * - 上滑切到图组内下一项
   * - 下滑切到图组内上一项
   */
  const touchStartYRef = useRef<number | null>(null)
  const touchStartXRef = useRef<number | null>(null)
  const isSwipingRef = useRef(false)
  const swipeThreshold = 50
  const hasAutoRatedRef = useRef(false)

  /**
   * 图组模式核心状态与行为入口。
   * 真正的“取当前图组 / 图内前进 / 图内后退 / 切下一组”
   * 都交给专属 Hook [`useGalleryMode()`](app/split-main/gallery/useGalleryMode.ts:38)。
   */
  const {
    currentGroup,
    currentGroupIndex,
    loadRandomGroup,
    nextInGroup,
    previousInGroup,
  } = useGalleryMode({
    config,
    currentFile,
    mediaUrl,
    viewedFilter,
    advancedFilters,
    preloadEnabled,
    setCurrentFile,
    setCurrentCreator,
    setLoading,
    setError,
    setMediaUrl,
    setTranscodeUrl,
    setOriginalStreamUrl,
    setIsUsingTranscode,
    setSmallVideoDirectPlayEnabled,
    setMediaType,
    setRatingType,
    setCurrentRating,
    setPreloadStatus,
    setCachePreloadProgress,
    loadCurrentRatingRef,
    startAutoMarkTimerRef,
    handleMediaTypeChangeInFullscreenRef,
    enterVideoFullscreenRef,
    isVideoRef,
    saveAndSwitchRef,
    hasAutoRatedRef,
    videoStateRef,
    smallVideoDirectPlayAvailableRef,
    playIntentRef,
  })

  /**
   * 将图组模式内部状态同步回主壳层，供 [`SettingsDrawer`](components/SettingsDrawer/index.tsx)
   * 这类通用组件展示“当前图组 / 索引”等只读信息。
   */
  useEffect(() => {
    onGalleryStateChange(currentGroup, currentGroupIndex)
  }, [currentGroup, currentGroupIndex, onGalleryStateChange])

  /**
   * 离开小视频形态时，清理图组模式自己维护的“直链播放按钮”显示状态。
   */
  useEffect(() => {
    if (mediaType !== 'small-video') {
      setSmallVideoDirectPlayEnabled(false)
    }
  }, [currentFile?.filename, mediaType])

  /**
   * 图组模式桌面端小视频自动播放修复逻辑。
   * 当图组内切换到新视频时，尽量沿用用户交互上下文恢复播放，
   * 保持与拆分前图组模式一致的体验。
   */
  useEffect(() => {
    if (!currentFile || !isVideoRef.current(currentFile.filename) || mediaType !== 'small-video') {
      return
    }

    const targetVideo = videoRef.current
    if (!targetVideo || !playIntentRef.current || videoStateRef.current) {
      return
    }

    targetVideo.muted = true
    targetVideo.load()

    const attemptPlay = () => {
      targetVideo.play().then(() => {
        setTimeout(() => {
          if (targetVideo.muted) {
            targetVideo.muted = false
          }
        }, 500)
      }).catch(() => {})
    }

    attemptPlay()

    const handleAutoPlay = () => {
      if (targetVideo.paused && playIntentRef.current) {
        targetVideo.muted = true
        targetVideo.play().catch(() => {})
      }
    }

    targetVideo.addEventListener('loadeddata', handleAutoPlay, { once: true })
    targetVideo.addEventListener('canplay', handleAutoPlay, { once: true })

    return () => {
      targetVideo.removeEventListener('loadeddata', handleAutoPlay)
      targetVideo.removeEventListener('canplay', handleAutoPlay)
    }
  }, [currentFile, isVideoRef, mediaType, mediaUrl, playIntentRef, videoRef, videoStateRef])

  saveAndSwitchRef.current = saveAndSwitch

  /**
   * 图组模式自己的小视频播放进度监听。
   * 播放达到阈值时触发共享自动评分逻辑。
   */
  const handleVideoTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    if (!video || !video.duration || !isFinite(video.duration)) {
      return
    }

    if (video.currentTime / video.duration >= 0.8) {
      void performAutoRating()
    }
  }, [performAutoRating])

  /**
   * 图组模式自己的小视频播放结束补偿逻辑。
   */
  const handleVideoEnded = useCallback(() => {
    void performAutoRating()
  }, [performAutoRating])

  const {
    anchorEl: externalPlayerAnchor,
    menuOpen: externalPlayerMenuOpen,
    closeMenu: closeExternalPlayerMenu,
    playWithExternalPlayer,
    handleExternalPlayerClick,
  } = useExternalPlayerMenu({
    config,
    currentFile,
    originalStreamUrl,
    mediaUrl,
    isMobile,
    onBeforeOpen: () => {
      if (mediaType !== 'small-video') {
        return
      }

      const video = isMobile ? mobileVideoRef.current?.getVideoElement?.() : videoRef.current
      if (video && !video.paused) {
        video.pause()
      }

      setShowPlayModeSelector(true)
    },
  })

  /**
   * 图组模式自己的小视频切源逻辑。
   * 当前只在图组内小视频场景下处理 WebDAV / 直链 / 转码 切换。
   */
  const handlePlayModeSelect = useCallback((mode: PlaybackMode) => {
    setShowPlayModeSelector(false)

    if (!currentFile || !config || mediaType !== 'small-video') {
      return
    }

    const shouldKeepDirectButton = smallVideoDirectPlayEnabled
    const {
      nextMediaUrl,
      nextOriginalStreamUrl,
      nextTranscodeUrl,
      nextIsUsingTranscode,
    } = resolveSmallVideoPlaybackState(config, currentFile, mode)

    if (!nextMediaUrl) {
      return
    }

    setPlayIntent(true)
    setSmallVideoDirectPlayEnabled(shouldKeepDirectButton)
    setMediaUrl(nextMediaUrl)
    setOriginalStreamUrl(nextOriginalStreamUrl)
    setTranscodeUrl(nextTranscodeUrl)
    setIsUsingTranscode(nextIsUsingTranscode)

    setTimeout(() => {
      const nextVideo = isMobile ? mobileVideoRef.current?.getVideoElement?.() : videoRef.current
      nextVideo?.play?.().catch(() => {})
    }, 100)
  }, [
    config,
    currentFile,
    isMobile,
    mediaType,
    mobileVideoRef,
    setShowPlayModeSelector,
    setIsUsingTranscode,
    setMediaUrl,
    setOriginalStreamUrl,
    setPlayIntent,
    setTranscodeUrl,
    smallVideoDirectPlayEnabled,
    videoRef,
  ])

  /**
   * 图组模式“开始预览 / 下一项”统一入口。
   * - 当前还没有图组时：拉起一组新图组
   * - 当前已有图组时：进入图组内下一项
   */
  const loadRandomMedia = useCallback(() => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }

    setPlayIntent(true)
    mobileVideoRef.current?.warmUp?.()

    if (currentGroup.length === 0) {
      loadRandomGroup()
    } else {
      nextInGroup()
    }
  }, [config, currentGroup.length, loadRandomGroup, mobileVideoRef, nextInGroup, setError, setPlayIntent])

  /** 图组模式全屏手势开始。 */
  const handleTouchStart = useCallback((event: ReactTouchEvent) => {
    if (!isMobile || !fullscreen) {
      return
    }

    if (event.touches.length > 1) {
      touchStartYRef.current = null
      touchStartXRef.current = null
      isSwipingRef.current = false
      return
    }

    const touch = event.touches[0]
    touchStartYRef.current = touch.clientY
    touchStartXRef.current = touch.clientX
    isSwipingRef.current = false
  }, [fullscreen, isMobile])

  /** 图组模式全屏手势移动。 */
  const handleTouchMove = useCallback((event: ReactTouchEvent) => {
    if (!isMobile || !fullscreen) {
      return
    }

    if (touchStartYRef.current === null || touchStartXRef.current === null) {
      return
    }

    if (event.touches.length > 1) {
      touchStartYRef.current = null
      touchStartXRef.current = null
      isSwipingRef.current = false
      return
    }

    const touch = event.touches[0]
    const deltaY = touch.clientY - touchStartYRef.current
    const deltaX = touch.clientX - touchStartXRef.current

    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      isSwipingRef.current = true
      event.preventDefault()
    }
  }, [fullscreen, isMobile])

  /**
   * 图组模式全屏手势结束。
   * - 上滑：图组内前进
   * - 下滑：图组内后退
   */
  const handleTouchEnd = useCallback((event: ReactTouchEvent) => {
    if (!isMobile || !fullscreen) {
      return
    }

    if (event.touches.length > 0) {
      touchStartYRef.current = null
      touchStartXRef.current = null
      isSwipingRef.current = false
      return
    }

    const startY = touchStartYRef.current
    const isSwiping = isSwipingRef.current

    if (startY === null || !isSwiping) {
      touchStartYRef.current = null
      touchStartXRef.current = null
      isSwipingRef.current = false
      return
    }

    const touch = event.changedTouches[0]
    const deltaY = touch.clientY - startY

    if (Math.abs(deltaY) > swipeThreshold) {
      mobileVideoRef.current?.warmUp?.()
      setPlayIntent(true)

      if (deltaY < 0) {
        nextInGroup()
      } else {
        previousInGroup()
      }
    }

    touchStartYRef.current = null
    touchStartXRef.current = null
    isSwipingRef.current = false
  }, [fullscreen, isMobile, mobileVideoRef, nextInGroup, previousInGroup, setPlayIntent])

  return (
    <>
      {/**
       * 图组模式通用预览区。
       * 固定挂在 [`CommonPreviewSurface`](components/split-main/CommonPreviewSurface.tsx) 上，
       * 内部根据图组当前媒体类型切换图片 / 小视频展示。
       */}
      <CommonPreviewSurface
        currentFile={currentFile}
        mediaUrl={mediaUrl}
        mediaType={mediaType}
        fullscreen={fullscreen}
        isMobile={isMobile}
        videoPlayerContainerRef={videoPlayerContainerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        mediaContent={
          <>
            {/* 图组模式图片预览。 */}
            {mediaType === 'image' && (
              <>
                <CardMedia
                  component="img"
                  image={mediaUrl || ''}
                  alt={currentFile?.basename || ''}
                  sx={{
                    width: fullscreen ? 'auto' : '100%',
                    maxWidth: '100%',
                    maxHeight: fullscreen ? '100%' : 'calc(100vh - 150px)',
                    objectFit: 'contain',
                  }}
                />
                {currentFile && (
                  <CreatorTag
                    filePath={currentFile.filename}
                    onCreatorIdentified={setCurrentCreator}
                    onTagClick={onOpenCreatorDialog}
                    refreshKey={creatorRefreshKey}
                  />
                )}
                {currentFile && (
                  <CreatorDetailTag
                    filePath={currentFile.filename}
                    onTagClick={(creator: any | null) => onOpenCreatorDetail?.(creator)}
                    refreshKey={creatorRefreshKey}
                  />
                )}
              </>
            )}

            {/* 图组模式移动端小视频预览，复用 [`MobileVideoPlayer`](components/MobileVideoPlayer.tsx)。 */}
            {isMobile && (
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                  display: mediaType === 'small-video' ? 'block' : 'none',
                }}
              >
                <MobileVideoPlayer
                  ref={mobileVideoRef}
                  src={mediaUrl || 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0AAACrQYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE1MiByMjg1NCBlOWE1OTAzIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAA='}
                  autoPlay={shouldAutoPlay && !videoStateRef.current}
                  isParentFullscreen={fullscreen}
                  isVisible={mediaType === 'small-video'}
                  showDirectPlayButton={smallVideoDirectPlayEnabled}
                  onDirectPlay={() => handlePlayModeSelect('direct')}
                  onTimeUpdate={() => {
                    const video = mobileVideoRef.current?.getVideoElement?.()
                    if (video) {
                      handleVideoTimeUpdate({ currentTarget: video } as SyntheticEvent<HTMLVideoElement>)
                    }
                  }}
                  onEnded={handleVideoEnded}
                  onPlay={() => {}}
                />
              </Box>
            )}

            {/* 图组模式移动端小视频博主标签。 */}
            {isMobile && currentFile && mediaType === 'small-video' && (
              <CreatorTag
                filePath={currentFile.filename}
                onCreatorIdentified={setCurrentCreator}
                onTagClick={onOpenCreatorDialog}
                position={{ top: '15%', left: '15%' }}
                refreshKey={creatorRefreshKey}
              />
            )}
            {isMobile && currentFile && mediaType === 'small-video' && (
              <CreatorDetailTag
                filePath={currentFile.filename}
                onTagClick={(creator: any | null) => onOpenCreatorDetail?.(creator)}
                position={{ top: '22%', right: '10%' }}
                refreshKey={creatorRefreshKey}
              />
            )}

            {/* 图组模式桌面端小视频预览。 */}
            {mediaType === 'small-video' && !isMobile && mediaUrl && (
              <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
                {smallVideoDirectPlayEnabled && (
                  <IconButton
                    onClick={() => handlePlayModeSelect('direct')}
                    sx={{
                      position: 'absolute',
                      right: 12,
                      bottom: 18,
                      zIndex: 2,
                      width: 32,
                      height: 32,
                      backgroundColor: 'rgba(0, 0, 0, 0.55)',
                      color: '#fff',
                      border: '1px solid rgba(255, 255, 255, 0.28)',
                      backdropFilter: 'blur(8px)',
                      '&:hover': {
                        backgroundColor: 'rgba(33, 150, 243, 0.35)',
                      },
                    }}
                    title="直链播放"
                  >
                    <OpenInNewIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}

                <Box
                  component="video"
                  ref={videoRef}
                  src={mediaUrl}
                  controls
                  autoPlay={playIntentRef.current && !videoStateRef.current}
                  muted
                  playsInline
                  preload="metadata"
                  webkit-playsinline="true"
                  onTimeUpdate={handleVideoTimeUpdate}
                  onEnded={handleVideoEnded}
                  onPlay={() => {
                    setTimeout(() => {
                      if (playIntentRef.current) {
                        playIntentRef.current = false
                      }
                    }, 1000)

                    const video = videoRef.current
                    if (video?.muted) {
                      setTimeout(() => {
                        video.muted = false
                      }, 300)
                    }
                  }}
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget as HTMLVideoElement
                    if (playIntentRef.current && !videoStateRef.current) {
                      video.play().catch(() => {
                        video.muted = true
                        video.play().catch(() => {})
                      })
                    }
                  }}
                  onLoadedData={(event) => {
                    const video = event.currentTarget as HTMLVideoElement
                    if (playIntentRef.current && !videoStateRef.current && video.paused) {
                      video.play().catch(() => {
                        video.muted = true
                        video.play().catch(() => {})
                      })
                    }
                  }}
                  onCanPlay={(event) => {
                    const video = event.currentTarget as HTMLVideoElement
                    if (playIntentRef.current && !videoStateRef.current && video.paused) {
                      video.play().catch(() => {
                        video.muted = true
                        video.play().catch(() => {})
                      })
                    }
                  }}
                  sx={{
                    width: fullscreen ? 'auto' : '100%',
                    maxWidth: '100%',
                    maxHeight: fullscreen ? '100%' : 'calc(100vh - 150px)',
                  }}
                />

                {currentFile && (
                  <CreatorTag
                    filePath={currentFile.filename}
                    onCreatorIdentified={setCurrentCreator}
                    onTagClick={onOpenCreatorDialog}
                    refreshKey={creatorRefreshKey}
                  />
                )}
                {currentFile && (
                  <CreatorDetailTag
                    filePath={currentFile.filename}
                    onTagClick={(creator: any | null) => onOpenCreatorDetail?.(creator)}
                    position={{ top: '22%', right: '10%' }}
                    refreshKey={creatorRefreshKey}
                  />
                )}
              </Box>
            )}

            {showPlayModeSelector && mediaType === 'small-video' && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0, 0, 0, 0.85)',
                  backdropFilter: 'blur(10px)',
                  zIndex: 1000,
                }}
                onClick={() => setShowPlayModeSelector(false)}
              >
                <Box
                  sx={{
                    backgroundColor: '#16213e',
                    borderRadius: 3,
                    padding: 3,
                    minWidth: { xs: 300, sm: 500 },
                    maxWidth: 600,
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Typography variant="h6" sx={{ color: '#e94560', fontWeight: 'bold', mb: 3, textAlign: 'center' }}>
                    选择播放方式
                  </Typography>

                  <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    {originalStreamUrl && (
                      <Button
                        variant="outlined"
                        fullWidth
                        size="large"
                        onClick={() => handlePlayModeSelect('webdav')}
                        sx={{
                          borderColor: '#4ade80',
                          color: '#4ade80',
                          py: 2,
                          fontSize: '1rem',
                          fontWeight: 'bold',
                          '&:hover': {
                            borderColor: '#22c55e',
                            backgroundColor: 'rgba(74, 222, 128, 0.1)',
                          },
                        }}
                      >
                        WebDAV<br />播放
                      </Button>
                    )}

                    {config?.enableDirectLink && currentFile && (
                      <Button
                        variant="outlined"
                        fullWidth
                        size="large"
                        onClick={() => handlePlayModeSelect('direct')}
                        sx={{
                          borderColor: '#2196f3',
                          color: '#2196f3',
                          py: 2,
                          fontSize: '1rem',
                          fontWeight: 'bold',
                          '&:hover': {
                            borderColor: '#1976d2',
                            backgroundColor: 'rgba(33, 150, 243, 0.1)',
                          },
                        }}
                      >
                        直链<br />播放
                      </Button>
                    )}

                    {originalStreamUrl && (
                      <Button
                        variant="outlined"
                        fullWidth
                        size="large"
                        onClick={() => handlePlayModeSelect('transcode')}
                        sx={{
                          borderColor: '#e94560',
                          color: '#e94560',
                          py: 2,
                          fontSize: '1rem',
                          fontWeight: 'bold',
                          '&:hover': {
                            borderColor: '#ff6b6b',
                            backgroundColor: 'rgba(233, 69, 96, 0.1)',
                          },
                        }}
                      >
                        转码<br />播放
                      </Button>
                    )}
                  </Box>

                  <Typography variant="caption" sx={{ color: '#888', display: 'block', mb: 2, textAlign: 'center' }}>
                    💡 转码播放仅支持 WebDAV 源
                  </Typography>

                  <Button fullWidth onClick={() => setShowPlayModeSelector(false)} sx={{ color: '#888' }}>
                    取消
                  </Button>
                </Box>
              </Box>
            )}
          </>
        }
        /*
          图组模式页面级全屏覆盖层：
          - 左上角显示当前图组位置
          - 右侧提供评分快捷操作
          - 右下角提供“下一项 / 下一组”入口
        */
        fullscreenOverlay={
          currentFile && fullscreen ? (
            <>
              <Box
                sx={{
                  position: 'fixed',
                  top: 24,
                  left: 24,
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  color: 'white',
                  px: 2.5,
                  py: 1.5,
                  borderRadius: 2,
                  zIndex: 2001,
                  backdropFilter: 'blur(10px)',
                }}
              >
                <Typography variant="body1" fontWeight="medium">
                  {currentGroup.length > 0 ? `${currentGroupIndex + 1} / ${currentGroup.length}` : '图组模式'}
                </Typography>
                {isUsingTranscode && (
                  <Typography variant="caption" sx={{ color: '#fbbf24', display: 'block', mt: 0.5 }}>
                    🔄 转码播放中
                  </Typography>
                )}
              </Box>

              <FullscreenRatingDock
                storageKey="fullscreen_rating"
                currentRating={currentRating}
                onQuickRate={handleQuickRate}
                onOpenDetail={() => openRatingDialog('media')}
                loading={loading}
                isSwitching={isSwitching}
                detailDisabled={loading || isSwitching || !currentFile}
                preloadCurrent={preloadEnabled && cachePreloadProgress ? cachePreloadProgress.current : null}
                variant="enhanced"
              />

              <DraggableFab storageKey="fullscreen_shuffle" onClick={loadRandomMedia} disabled={isSwitching} defaultSx={{ right: 10, bottom: 80, zIndex: 2001 }}>
                <ShuffleIcon />
              </DraggableFab>

              <IconButton
                onClick={toggleFullscreen}
                sx={{
                  position: 'fixed',
                  top: 24,
                  right: 24,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  color: 'white',
                  zIndex: 2001,
                  '&:hover': {
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  },
                }}
              >
                <FullscreenExitIcon />
              </IconButton>
            </>
          ) : undefined
        }
        /*
          图组模式底部信息区：
          展示当前媒体信息、图组索引、评分状态与外部播放入口。
        */
        footerContent={
          !fullscreen && currentFile ? (
            <MediaInfoFooter
              basename={currentFile.basename}
              filename={currentFile.filename}
              size={currentFile.size}
              lastmod={currentFile.lastmod}
              currentRating={currentRating}
              onQuickRate={handleQuickRate}
              quickRateDisabled={loading || isSwitching}
              onEditRating={() => openRatingDialog('media')}
              titleAccessory={currentGroup.length > 0
                ? <Chip label={`${currentGroupIndex + 1}/${currentGroup.length}`} size="small" color="primary" sx={{ flexShrink: 0 }} />
                : undefined}
              formatFileSize={formatFileSize}
              externalPlayerMenu={isVideoRef.current(currentFile.filename)
                ? {
                    anchorEl: externalPlayerAnchor,
                    open: externalPlayerMenuOpen,
                    onClose: closeExternalPlayerMenu,
                    onOpen: handleExternalPlayerClick,
                    onPlaySystem: () => playWithExternalPlayer('system'),
                    onPlayPotPlayer: () => playWithExternalPlayer('potplayer'),
                    onPlayVlc: () => playWithExternalPlayer('vlc'),
                    emphasized: true,
                  }
                : undefined}
            />
          ) : undefined
        }
      />

      {/* 图组模式评分弹窗：支持媒体评分与图组评分两种上下文。 */}
      <RatingDialog
        open={ratingDialogOpen}
        onClose={closeRatingDialog}
        onSave={saveRatingManual}
        onSaveSuccess={handleRatingSaveSuccess}
        title={ratingType === 'media' ? '评分媒体文件' : '评分图组'}
        subtitle={
          ratingType === 'media'
            ? currentFile?.basename
            : currentGroup.length > 0
            ? `${getGroupName(getGroupPath(currentGroup[0].filename))} (${currentGroup.length} 个文件)`
            : undefined
        }
        initialData={currentRating || undefined}
        type={ratingType}
        container={videoPlayerContainerRef.current}
      />

      {/* 图组模式右上角容器全屏入口。 */}
      {!fullscreen && currentFile && mediaUrl && (
        <Tooltip title="全屏查看" placement="left">
          <Button
            variant="contained"
            onClick={toggleFullscreen}
            sx={{
              position: 'fixed',
              top: 80,
              right: 24,
              minWidth: 0,
              width: 40,
              height: 40,
              borderRadius: '50%',
              zIndex: 1000,
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              color: 'rgba(0, 0, 0, 0.87)',
              boxShadow: 3,
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 1)',
              },
            }}
          >
            <FullscreenIcon />
          </Button>
        </Tooltip>
      )}

      {/* 图组模式非全屏下的图内导航区。 */}
      {!fullscreen && currentGroup.length > 0 && currentFile && (
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 2 }}>
          <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={previousInGroup} disabled={currentGroupIndex === 0 || loading || isSwitching}>
            上一张
          </Button>
          <Button
            variant="outlined"
            startIcon={<SkipNextIcon />}
            onClick={() => {
              setPlayIntent(true)
              loadRandomGroup()
            }}
            disabled={loading || isSwitching}
          >
            换下一组
          </Button>
          <Button variant="contained" endIcon={<ArrowForwardIcon />} onClick={nextInGroup} disabled={loading || isSwitching}>
            下一张
          </Button>
        </Box>
      )}

      {/* 图组模式空状态：尚未抽取图组时展示入口与预加载提示。 */}
      {!currentFile && !loading && (
        <Paper
          elevation={0}
          sx={{
            p: 8,
            textAlign: 'center',
            backgroundColor: 'white',
            borderRadius: 2,
            minHeight: 'calc(100vh - 200px)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <ShuffleIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            {preloadEnabled && !galleryPreloadReady ? '正在加载中...' : '准备好了！'}
          </Typography>

          {preloadEnabled && cachePreloadProgress && !galleryPreloadReady && (
            <Box sx={{ mb: 3 }}>
              <CircularProgress sx={{ mb: 2 }} />
              <Typography variant="body1" color="text.secondary">
                正在加载 ({preloadInsufficient
                  ? `${actualFoundCount}/${cachePreloadProgress.current}/${cachePreloadProgress.total}`
                  : `${cachePreloadProgress.current}/${cachePreloadProgress.total}`})
              </Typography>
            </Box>
          )}

          {(!cachePreloadProgress || !preloadEnabled || galleryPreloadReady) && (
            <>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
                从 {directoryCount} 个目录中
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                随机加载{filteredStatsLabel === '全部' ? '媒体文件' : filteredStatsLabel}
              </Typography>
              <Typography variant="body2" color="primary" sx={{ mb: 3 }}>
                当前筛选：{filteredStatsLabel} - {filteredStatsTotal} 个文件
              </Typography>
            </>
          )}

          <Button
            variant="contained"
            size="large"
            startIcon={preloadEnabled && !galleryPreloadReady ? <CircularProgress size={20} color="inherit" /> : <ShuffleIcon />}
            onClick={loadRandomMedia}
            disabled={preloadEnabled && !galleryPreloadReady}
          >
            {preloadEnabled && !galleryPreloadReady ? '加载中...' : '开始预览'}
          </Button>
        </Paper>
      )}

      {/* 图组模式加载态：正在准备当前图组内容。 */}
      {loading && !currentFile && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 'calc(100vh - 200px)',
          }}
        >
          <CircularProgress size={60} sx={{ mb: 2 }} />
          <Typography variant="h6" color="primary" sx={{ mb: 2 }}>
            正在准备图组模式预览...
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            请稍候，正在加载当前图组所需媒体
          </Typography>
        </Box>
      )}
    </>
  )
}
