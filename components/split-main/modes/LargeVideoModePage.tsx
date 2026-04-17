'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type TouchEvent as ReactTouchEvent,
} from 'react'

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  OpenInNew as OpenInNewIcon,
  Shuffle as ShuffleIcon,
  VideoLibrary as VideoIcon,
} from '@mui/icons-material'

import { useLargeVideoMode } from '@/app/split-main/large-video/useLargeVideoMode'
import CreatorTag from '@/components/CreatorTag'
import DraggableFab from '@/components/DraggableFab'
import InstantVideoPlayer from '@/components/InstantVideoPlayer'
import QuickRating from '@/components/QuickRating'
import RatingDialog from '@/components/RatingDialog'
import { useVideoHighlightsModule } from '@/components/VideoHighlightsModule'
import CommonPreviewSurface from '@/components/split-main/CommonPreviewSurface'
import FullscreenRatingDock from '@/components/split-main/shared/FullscreenRatingDock'
import MediaInfoFooter from '@/components/split-main/shared/MediaInfoFooter'
import {
  resolveStreamVideoPlaybackState,
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

type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning'

interface LargeVideoModePageProps {
  config: WebDAVConfig | null
  directoryCount: number
  filteredStatsLabel: string
  filteredStatsTotal: number
  currentFile: MediaFile | null
  mediaUrl: string | null
  transcodeUrl: string | null
  originalStreamUrl: string | null
  mediaType: MediaType
  isUsingTranscode: boolean
  loading: boolean
  viewedFilter: ViewedFilter
  advancedFilters: AdvancedFilters
  preloadRandomness: number
  currentRating: MediaRating | GroupRating | null
  creatorRefreshKey: number
  fullscreen: boolean
  toggleFullscreen: () => void | Promise<void>
  isMobile: boolean
  videoPlayerContainerRef: MutableRefObject<HTMLDivElement | null>
  playIntentRef: MutableRefObject<boolean>
  loadCurrentRatingRef: MutableRefObject<(file?: MediaFile, forceType?: 'media' | 'group') => Promise<void>>
  startAutoMarkTimerRef: MutableRefObject<(file?: MediaFile, skipAutoRating?: boolean) => void>
  handleMediaTypeChangeInFullscreenRef: MutableRefObject<(nextFile: MediaFile) => boolean>
  enterVideoFullscreenRef: MutableRefObject<() => Promise<void> | void>
  handleQuickRate: (rating: number, evaluation: string) => Promise<void>
  openRatingDialog: (type: 'media' | 'group') => void
  onOpenCreatorDialog: () => void
  ratingDialogOpen: boolean
  closeRatingDialog: () => void
  saveRatingManual: (data: MediaRating | GroupRating, file?: MediaFile) => Promise<void>
  handleRatingSaveSuccess: () => void
  setCurrentFile: (file: MediaFile | null) => void
  setCurrentCreator: (creator: any) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setMediaUrl: (url: string | null) => void
  setTranscodeUrl: (url: string | null) => void
  setOriginalStreamUrl: (url: string | null) => void
  setIsUsingTranscode: (value: boolean) => void
  setMediaType: (type: MediaType) => void
  setRatingType: (type: 'media' | 'group') => void
  setCurrentRating: (rating: any) => void
  setPreloadStatus: (status: any) => void
  performAutoRating: () => void | Promise<void>
  stopAutoMarkTimer: () => void
  setSnackbarMessage: (message: string) => void
  setSnackbarSeverity: (severity: SnackbarSeverity) => void
  setSnackbarOpen: (open: boolean) => void
  highlightContinuousPlayEnabled: boolean
}

/**
 * 大视频模式页面模块。
 *
 * 这个组件专门承载大视频模式自己的：
 * - 流式视频预览状态
 * - 大视频切换函数
 * - 流式 / 直链 / 转码切源交互
 * - 精彩时刻打点与连续播放接线
 * - 大视频模式专属全屏与手势交互
 * - 大视频模式自己的空状态、加载态与底部信息区
 *
 * 主页面 [`SplitMainWorkspace`](components/split-main/SplitMainWorkspace.tsx) 只负责通用壳层：
 * 顶部、抽屉、导航、通用配置与共享能力注入。
 */
export default function LargeVideoModePage({
  config,
  directoryCount,
  filteredStatsLabel,
  filteredStatsTotal,
  currentFile,
  mediaUrl,
  transcodeUrl,
  originalStreamUrl,
  mediaType,
  isUsingTranscode,
  loading,
  viewedFilter,
  advancedFilters,
  preloadRandomness,
  currentRating,
  creatorRefreshKey,
  fullscreen,
  toggleFullscreen,
  isMobile,
  videoPlayerContainerRef,
  playIntentRef,
  loadCurrentRatingRef,
  startAutoMarkTimerRef,
  handleMediaTypeChangeInFullscreenRef,
  enterVideoFullscreenRef,
  handleQuickRate,
  openRatingDialog,
  onOpenCreatorDialog,
  ratingDialogOpen,
  closeRatingDialog,
  saveRatingManual,
  handleRatingSaveSuccess,
  setCurrentFile,
  setCurrentCreator,
  setLoading,
  setError,
  setMediaUrl,
  setTranscodeUrl,
  setOriginalStreamUrl,
  setIsUsingTranscode,
  setMediaType,
  setRatingType,
  setCurrentRating,
  setPreloadStatus,
  performAutoRating,
  stopAutoMarkTimer,
  setSnackbarMessage,
  setSnackbarSeverity,
  setSnackbarOpen,
  highlightContinuousPlayEnabled,
}: LargeVideoModePageProps) {
  /**
   * 大视频模式自己的播放器运行时状态。
   * 这里的 ref 只服务于流式大视频播放器，不与随机模式 / 图组模式共享。
   */
  const instantVideoRef = useRef<any>(null)
  const hasAutoRatedRef = useRef(false)
  const videoStateRef = useRef<{ currentTime: number; paused: boolean } | null>(null)

  /**
   * 大视频模式专属 UI 状态：
   * - [`streamVideoTagVisible`](components/split-main/modes/LargeVideoModePage.tsx:188) 控制流式播放器覆盖信息何时显隐
   * - 外部播放器菜单与切源面板只属于大视频模式自己的流式播放交互
   * - [`isSwitching`](components/split-main/modes/LargeVideoModePage.tsx:180) 避免快速切换大视频时缓存与已看记录错乱
   */
  const [streamVideoTagVisible, setStreamVideoTagVisible] = useState(true)
  const [showPlayModeSelector, setShowPlayModeSelector] = useState(false)
  const fullscreenActionOverlayZIndex = 2202
  const [isNativeVideoFullscreen, setIsNativeVideoFullscreen] = useState(false)
  const { isSwitching, runSwitch: saveAndSwitch } = useModeSwitchGuard({
    currentFile,
    setPreloadStatus,
    beforeSwitch: stopAutoMarkTimer,
  })

  /**
   * 大视频模式专属全屏手势状态。
   * 当前仅支持：
   * - 上滑切到下一个大视频
   * - 下滑时提示暂不支持回看
   */
  const touchStartYRef = useRef<number | null>(null)
  const touchStartXRef = useRef<number | null>(null)
  const isSwipingRef = useRef(false)
  const swipeThreshold = 50

  useEffect(() => {
    if (mediaType === 'stream-video') {
      setStreamVideoTagVisible(false)
    }
  }, [currentFile?.filename, mediaType])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const playerContainer = instantVideoRef.current?.getContainerElement?.() || null
      setIsNativeVideoFullscreen(Boolean(playerContainer && document.fullscreenElement === playerContainer))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])

  const notify = useCallback((message: string, severity: SnackbarSeverity) => {
    setSnackbarMessage(message)
    setSnackbarSeverity(severity)
    setSnackbarOpen(true)
  }, [setSnackbarMessage, setSnackbarOpen, setSnackbarSeverity])

  const getInstantVideoCurrentTime = useCallback(() => {
    const currentTime = instantVideoRef.current?.getCurrentTime?.()
    return typeof currentTime === 'number' && Number.isFinite(currentTime) ? currentTime : 0
  }, [])

  /**
   * 大视频模式专属精彩时刻接线。
   * 这里集中承接：
   * - 流式大视频的当前时间读取
   * - A/B 打点
   * - 高亮条渲染
   * - 连续播放控制
   *
   * 这些能力已经全部内聚到大视频模式页面内部，主工作区不再直接参与。
   */
  const videoHighlightsModule = useVideoHighlightsModule({
    currentFile: currentFile ? { filename: currentFile.filename, basename: currentFile.basename } : null,
    mediaType,
    viewMode: 'large-video',
    fullscreen,
    streamVideoTagVisible,
    getCurrentTime: getInstantVideoCurrentTime,
    onSeek: (seconds: number) => {
      instantVideoRef.current?.setCurrentTime?.(seconds)
    },
    onPlay: async () => {
      await instantVideoRef.current?.play?.()
    },
    onNotify: notify,
    onContinuousPlaybackEnd: () => {
      notify('精彩时刻连续播放完成', 'info')
    },
    fullscreenDialogContainer: instantVideoRef.current?.getContainerElement?.() || null,
    inlineDialogContainer: videoPlayerContainerRef.current,
  })

  const setHighlightContinuousPlayEnabled = videoHighlightsModule.setHighlightContinuousPlayEnabled

  useEffect(() => {
    setHighlightContinuousPlayEnabled(highlightContinuousPlayEnabled)
  }, [highlightContinuousPlayEnabled, setHighlightContinuousPlayEnabled])

  /**
   * 大视频模式核心数据加载入口。
   * 真正的“大视频筛选 / 抽取 / 装载 / 播放地址准备”全部交给
   * [`useLargeVideoMode()`](app/split-main/large-video/useLargeVideoMode.ts:1) 处理，
   * 页面组件只负责模式专属展示与交互。
   */
  const { loadLargeVideoFile } = useLargeVideoMode({
    config,
    currentFile,
    mediaUrl,
    viewedFilter,
    preloadRandomness,
    advancedFilters,
    instantVideoRef,
    hasAutoRatedRef,
    videoStateRef,
    handleMediaTypeChangeInFullscreenRef,
    enterVideoFullscreenRef,
    loadCurrentRatingRef,
    startAutoMarkTimerRef,
    setCurrentFile,
    setCurrentCreator,
    setLoading,
    setError,
    setMediaUrl,
    setTranscodeUrl,
    setOriginalStreamUrl,
    setIsUsingTranscode,
    setMediaType,
    setRatingType,
    setCurrentRating,
  })

  /**
   * 大视频模式“开始预览 / 换一个”统一入口。
   * 只负责触发下一个大视频加载，并关闭大视频专属切源面板。
   */
  const loadLargeVideoMedia = useCallback(() => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }

    // 仿照小视频播放器的 warmUp 思路：
    // 在用户点击“开始预览 / 换一个”这一交互上下文里，先对同一个 video 元素做音频解锁，
    // 后续切换到真实流地址时继续复用同一个元素，尽量保持非静音播放能力。
    instantVideoRef.current?.warmUp?.()
    setShowPlayModeSelector(false)
    playIntentRef.current = true

    saveAndSwitch(() => {
      void loadLargeVideoFile()
    })
  }, [config, loadLargeVideoFile, playIntentRef, saveAndSwitch, setError])

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
      if (mediaType === 'stream-video') {
        instantVideoRef.current?.pause?.()
        setShowPlayModeSelector(true)
      }
    },
  })

  /**
   * 大视频模式专属切源逻辑。
   * 这里只处理流式大视频的 WebDAV / 直链 / 转码 三种播放方式切换。
   */
  const handlePlayModeSelect = useCallback((mode: PlaybackMode) => {
    setShowPlayModeSelector(false)

    if (!currentFile || !config || mediaType !== 'stream-video') {
      return
    }

    const {
      nextMediaUrl,
      nextOriginalStreamUrl,
      nextTranscodeUrl,
      nextIsUsingTranscode,
    } = resolveStreamVideoPlaybackState(config, currentFile, mode)

    if (!nextMediaUrl) {
      return
    }

    setMediaUrl(nextMediaUrl)
    setOriginalStreamUrl(nextOriginalStreamUrl)
    setTranscodeUrl(nextTranscodeUrl)
    setIsUsingTranscode(nextIsUsingTranscode)

    setTimeout(() => {
      const playResult = instantVideoRef.current?.play?.()
      if (playResult && typeof playResult.catch === 'function') {
        playResult.catch(() => {})
      }
    }, 100)
  }, [config, currentFile, mediaType, setIsUsingTranscode, setMediaUrl, setOriginalStreamUrl, setTranscodeUrl])

  /**
   * 大视频模式专属时间同步逻辑。
   * 除了自动标记已看，还负责把流式播放器时间同步给精彩时刻模块。
   */
  const handleInstantVideoTimeUpdate = useCallback((currentTime: number, duration: number) => {
    if (!duration || !isFinite(duration)) return

    videoHighlightsModule.syncSelectedHighlightByTime(currentTime)

    const progress = currentTime / duration
    if (progress >= 0.8) {
      void performAutoRating()
    }

    videoHighlightsModule.handleContinuousPlaybackProgress(currentTime)
  }, [performAutoRating, videoHighlightsModule])

  const handleVideoEnded = useCallback(() => {
    void performAutoRating()
  }, [performAutoRating])

  /**
   * 大视频模式专属键盘逻辑。
   * - A：记录精彩时刻起点
   * - B：记录精彩时刻终点
   */
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (!currentFile || mediaType !== 'stream-video') {
        return
      }

      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }

      const key = event.key.toLowerCase()

      if (key === 'a') {
        event.preventDefault()
        videoHighlightsModule.handleMarkHighlightStart()
      }

      if (key === 'b') {
        event.preventDefault()
        videoHighlightsModule.handleMarkHighlightEnd()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress)
    }
  }, [currentFile, mediaType, videoHighlightsModule])

  /**
   * 大视频模式手势开始处理。
   */
  const handleTouchStart = useCallback((event: ReactTouchEvent) => {
    if (!isMobile || !fullscreen) return
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

  /**
   * 大视频模式手势移动处理。
   */
  const handleTouchMove = useCallback((event: ReactTouchEvent) => {
    if (!isMobile || !fullscreen) return
    if (touchStartYRef.current === null || touchStartXRef.current === null) return
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
   * 大视频模式手势结束处理。
   * - 上滑：加载下一个大视频
   * - 下滑：提示当前模式暂不支持回看
   */
  const handleTouchEnd = useCallback((event: ReactTouchEvent) => {
    if (!isMobile || !fullscreen) return
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
    const shouldSwitch = Math.abs(deltaY) > swipeThreshold

    if (shouldSwitch) {
      if (deltaY < 0) {
        loadLargeVideoMedia()
      } else {
        setSnackbarMessage('大视频模式暂不支持回看')
        setSnackbarSeverity('info')
        setSnackbarOpen(true)
      }
    }

    touchStartYRef.current = null
    touchStartXRef.current = null
    isSwipingRef.current = false
  }, [fullscreen, isMobile, loadLargeVideoMedia, setSnackbarMessage, setSnackbarOpen, setSnackbarSeverity])

  return (
    <>
      {/**
       * 大视频模式专属预览区。
       * 这里固定只承接 [`stream-video`](components/split-main/CommonPreviewSurface.tsx:41) 形态，
       * 并把流式播放器、精彩时刻覆盖层与切源面板全部内聚在模式页面内部。
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
        forceRender
        mediaContent={
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              height: fullscreen ? '100%' : 'min(56.25vw, calc(100vh - 150px))',
              minHeight: fullscreen ? undefined : 300,
              display: mediaType === 'stream-video' && mediaUrl ? 'block' : 'none',
            }}
          >
              {/* 大视频模式专属流式播放器，承接高亮条、打点与“下一个视频”行为。 */}
              <InstantVideoPlayer
                ref={instantVideoRef}
                src={mediaUrl || ''}
                autoPlay
                playIntent={playIntentRef.current}
                isParentFullscreen={fullscreen}
                transcodeUrl={transcodeUrl || undefined}
                onTranscodeFallback={() => {
                  setIsUsingTranscode(true)
                }}
                onTimeUpdate={handleInstantVideoTimeUpdate}
                onEnded={handleVideoEnded}
                onNext={loadLargeVideoMedia}
                highlights={videoHighlightsModule.progressHighlights}
                selectedHighlightId={videoHighlightsModule.selectedHighlightId}
                onRestartCurrentVideo={() => {
                  videoHighlightsModule.clearSelectedHighlight()
                  videoHighlightsModule.stopContinuousHighlightPlayback()
                }}
                onControlsVisibilityChange={(visible) => {
                  setStreamVideoTagVisible(visible)
                }}
                alwaysOverlay={
                  currentFile ? (
                    <>
                      <CreatorTag
                        filePath={currentFile.filename}
                        onCreatorIdentified={setCurrentCreator}
                        onTagClick={onOpenCreatorDialog}
                        visible={streamVideoTagVisible}
                        refreshKey={creatorRefreshKey}
                      />
                      {!fullscreen && !isNativeVideoFullscreen && videoHighlightsModule.inlineMarkerControls}
                    </>
                  ) : undefined
                }
                fullscreenOverlay={
                  <>
                    {videoHighlightsModule.fullscreenMarkerControls}
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 20,
                        right: 20,
                        bottom: 88,
                        zIndex: 2001,
                        opacity: streamVideoTagVisible ? 1 : 0,
                        transform: 'translateY(0)',
                        visibility: streamVideoTagVisible ? 'visible' : 'hidden',
                        transition: 'opacity 0.15s ease-out, visibility 0.15s ease-out',
                        pointerEvents: streamVideoTagVisible ? 'auto' : 'none',
                        willChange: 'opacity',
                      }}
                    >
                      {videoHighlightsModule.fullscreenStrip}
                    </Box>

                    <FullscreenRatingDock
                      storageKey="fullscreen_rating_stream"
                      currentRating={currentRating}
                      onQuickRate={handleQuickRate}
                      onOpenDetail={() => openRatingDialog('media')}
                      loading={loading}
                      isSwitching={isSwitching}
                      detailDisabled={loading || isSwitching || !currentFile}
                      zIndex={fullscreenActionOverlayZIndex}
                      variant="enhanced"
                    />

                    <DraggableFab
                      storageKey="fullscreen_shuffle_stream"
                      onClick={loadLargeVideoMedia}
                      disabled={loading || isSwitching}
                      defaultSx={{
                        right: 10,
                        bottom: 80,
                        zIndex: fullscreenActionOverlayZIndex,
                      }}
                    >
                      {loading || isSwitching ? <CircularProgress size={24} color="inherit" /> : <ShuffleIcon />}
                    </DraggableFab>
                  </>
                }
              />

              {/* 大视频模式专属切源面板：仅在流式大视频场景展示。 */}
              {showPlayModeSelector && (
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

                    <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
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
                    </Stack>

                    <Typography variant="caption" sx={{ color: '#888', display: 'block', mb: 2, textAlign: 'center' }}>
                      💡 转码播放仅支持 WebDAV 源
                    </Typography>

                    <Button fullWidth onClick={() => setShowPlayModeSelector(false)} sx={{ color: '#888' }}>
                      取消
                    </Button>
                  </Box>
                </Box>
              )}
          </Box>
        }
        /*
          大视频模式页面级全屏 UI：
          这里只保留顶部身份标识与退出全屏按钮。
          右下角评分组件与“换一个”按钮已移动到播放器自己的 [`fullscreenOverlay`](components/InstantVideoPlayer.tsx:1639)
          中，确保进入原生全屏时仍然可见。
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
                  zIndex: fullscreenActionOverlayZIndex,
                }}
              >
                <Typography variant="body1" fontWeight="medium">
                  大视频模式
                </Typography>
                {isUsingTranscode && (
                  <Typography variant="caption" sx={{ color: '#fbbf24', display: 'block', mt: 0.5 }}>
                    🔄 转码播放中
                  </Typography>
                )}
              </Box>

              <IconButton
                onClick={toggleFullscreen}
                sx={{
                  position: 'fixed',
                  top: 24,
                  right: 24,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  color: 'white',
                  zIndex: fullscreenActionOverlayZIndex,
                }}
              >
                <FullscreenExitIcon />
              </IconButton>
            </>
          ) : undefined
        }
        /*
          大视频模式专属底部信息区：
          展示大视频文件信息、评分、精彩时刻条与外部播放入口。
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
              metadataAccessory={<Chip label="流式播放" size="small" color="info" sx={{ height: '18px', fontSize: '0.65rem' }} />}
              extraContent={
                <Box sx={{ mt: 1.25 }}>
                  <Box sx={{ px: 0, py: 0, backgroundColor: 'transparent' }}>
                    {videoHighlightsModule.inlineStrip}
                  </Box>
                </Box>
              }
              externalPlayerMenu={{
                anchorEl: externalPlayerAnchor,
                open: externalPlayerMenuOpen,
                onClose: closeExternalPlayerMenu,
                onOpen: handleExternalPlayerClick,
                onPlaySystem: () => playWithExternalPlayer('system'),
                onPlayPotPlayer: () => playWithExternalPlayer('potplayer'),
                onPlayVlc: () => playWithExternalPlayer('vlc'),
                emphasized: true,
              }}
            />
          ) : undefined
        }
      />

      {/* 大视频模式专属空状态：尚未抽取到大视频时展示入口说明。 */}
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
          <VideoIcon sx={{ fontSize: 80, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            准备好了！
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            从 {directoryCount} 个目录中
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            随机加载大视频文件（&gt; 100MB）
          </Typography>
          <Typography variant="body2" color="primary" sx={{ mb: 3 }}>
            当前筛选：{filteredStatsLabel} - {filteredStatsTotal} 个文件
          </Typography>
          <Button variant="contained" size="large" startIcon={<OpenInNewIcon />} onClick={loadLargeVideoMedia}>
            开始预览
          </Button>
        </Paper>
      )}

      {/* 大视频模式专属加载态：正在筛选并准备下一个大视频。 */}
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
            正在准备大视频模式预览...
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            从 {directoryCount} 个目录中
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            随机加载大视频文件（&gt; 100MB）
          </Typography>
          <Typography variant="body2" color="primary">
            当前筛选：{filteredStatsLabel} - {filteredStatsTotal} 个文件
          </Typography>
        </Box>
      )}

      {/* 大视频模式评分弹窗：挂载到大视频预览容器，避免被播放器层级遮挡。 */}
      <RatingDialog
        open={ratingDialogOpen}
        onClose={closeRatingDialog}
        onSave={saveRatingManual}
        onSaveSuccess={handleRatingSaveSuccess}
        title="评分媒体文件"
        subtitle={currentFile?.basename}
        initialData={currentRating || undefined}
        type="media"
        container={videoPlayerContainerRef.current}
      />

      {/* 大视频模式专属右上角全屏入口。 */}
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

      {/* 大视频模式专属浮动“换一个”按钮。 */}
      {!fullscreen && currentFile && (
        <Tooltip title={loading ? '加载中...' : '换一个'} placement="left">
          <DraggableFab
            storageKey="normal_shuffle"
            color="primary"
            aria-label="换一个"
            onClick={loadLargeVideoMedia}
            disabled={loading || isSwitching}
            defaultSx={{
              zIndex: 1000,
            }}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : <ShuffleIcon />}
          </DraggableFab>
        </Tooltip>
      )}

      {/* 大视频模式专属精彩时刻编辑弹窗。 */}
      {videoHighlightsModule.editorDialog}
    </>
  )
}
