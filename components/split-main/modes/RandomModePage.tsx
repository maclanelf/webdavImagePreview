'use client'

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type SyntheticEvent } from 'react'

import {
  Box,
  Button,
  CardMedia,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  FullscreenExit as FullscreenExitIcon,
  Fullscreen as FullscreenIcon,
  OpenInNew as OpenInNewIcon,
  Shuffle as ShuffleIcon,
} from '@mui/icons-material'

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
import { useRandomMode } from '@/app/split-main/random/useRandomMode'
import type {
  AdvancedFilters,
  CreatorSummary,
  GroupRating,
  MediaFile,
  MediaFilter,
  MediaRating,
  MediaType,
  ViewedFilter,
  WebDAVConfig,
} from '@/types'

type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning'

interface RandomModePageProps {
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
  mediaFilter: MediaFilter
  viewedFilter: ViewedFilter
  advancedFilters: AdvancedFilters
  preloadEnabled: boolean
  preloadRandomness: number
  setPreloadStatus: (status: any) => void
  setCachePreloadProgress: (progress: { current: number; total: number } | null) => void
  cachePreloadProgress: { current: number; total: number } | null
  setPreloadInsufficient: (value: boolean) => void
  preloadInsufficient: boolean
  setActualFoundCount: (count: number) => void
  actualFoundCount: number
  ratingQueueActiveCount?: number
  currentRating: MediaRating | GroupRating | null
  setCurrentRating: (rating: any) => void
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
  stopAutoMarkTimer: () => void
  setSnackbarMessage: (message: string) => void
  setSnackbarSeverity: (severity: SnackbarSeverity) => void
  setSnackbarOpen: (open: boolean) => void
  creatorMetadataPatchRef?: MutableRefObject<(filePath: string, creator: CreatorSummary | null, creatorResolved: boolean) => void>
  ratingMetadataPatchRef?: MutableRefObject<(filePath: string, rating: MediaFile['mediaRatingData']) => void>
}

/**
 * 随机模式页面模块。
 *
 * 这个组件专门承载随机模式自己的：
 * - 状态组织
 * - 切换函数
 * - 随机历史回看
 * - 预览器渲染
 * - 随机模式专属全屏交互
 *
 * 主页面 [`SplitMainWorkspace`](components/split-main/SplitMainWorkspace.tsx) 只负责通用壳层：
 * 顶部、抽屉、导航、通用配置与共享能力注入。
 */
export default function RandomModePage({
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
  mediaFilter,
  viewedFilter,
  advancedFilters,
  preloadEnabled,
  preloadRandomness,
  setPreloadStatus,
  setCachePreloadProgress,
  cachePreloadProgress,
  setPreloadInsufficient,
  preloadInsufficient,
  setActualFoundCount,
  actualFoundCount,
  ratingQueueActiveCount = 0,
  currentRating,
  setCurrentRating,
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
  stopAutoMarkTimer,
  setSnackbarMessage,
  setSnackbarSeverity,
  setSnackbarOpen,
  creatorMetadataPatchRef,
  ratingMetadataPatchRef,
}: RandomModePageProps) {
  /**
   * 随机模式固定使用 random 视图类型，这里用 ref 提供给 [`useRandomMode()`](app/split-main/random/useRandomMode.ts:63)
   * 以兼容其内部对模式变化的判定逻辑。
   */
  const viewModeRef = useRef<'random'>('random')

  /**
   * 随机模式自己的自动评分防重标记。
   * 必须由随机模式自己持有，否则无法真正做到“随机模式状态独立”。
   */
  const hasAutoRatedRef = useRef(false)

  /**
   * 中等体积小视频是否允许展示“直链播放”快捷按钮。
   * 这是随机模式内部的播放器展示状态，属于随机模式自己的 UI 状态。
   */
  const [smallVideoDirectPlayEnabled, setSmallVideoDirectPlayEnabled] = useState(false)
  const smallVideoDirectPlayAvailableRef = useRef(false)
  const [showPlayModeSelector, setShowPlayModeSelector] = useState(false)

  /**
   * 随机模式自己的切换防抖状态，避免短时间内连续点击导致历史记录与缓存状态错乱。
   */
  const saveAndSwitchRef = useRef<(switchCallback: () => void) => Promise<void> | void>(() => {})

  const { isSwitching, runSwitch: saveAndSwitch } = useModeSwitchGuard({
    currentFile,
    setPreloadStatus,
    beforeSwitch: stopAutoMarkTimer,
  })

  /**
   * 随机模式自己的全屏手势状态。
   * 随机模式支持：
   * - 上滑切换到下一个随机文件或历史前进
   * - 下滑回看历史
   */
  const touchStartYRef = useRef<number | null>(null)
  const touchStartXRef = useRef<number | null>(null)
  const isSwipingRef = useRef(false)
  const swipeThreshold = 50

  /**
   * 随机模式核心状态与行为入口。
   * 这里把真正的“随机抽取 / 历史回看 / 历史前进 / 重新开始”全部交给专属 Hook，
   * 使随机模式页面更像“模式容器 + 模式预览器”。
   */
  const {
    randomHistory,
    randomHistoryIndex,
    showRestartDialog,
    handleVideoTimeUpdate,
    handleVideoEnded,
    loadRandomFile,
    loadPreviousRandomFile,
    loadNextRandomFile,
    handleRestartViewing,
    handleCancelRestart,
    updateRandomHistoryCreatorMetadata,
    updateRandomHistoryRatingMetadata,
  } = useRandomMode({
    config,
    currentFile,
    mediaUrl,
    mediaFilter,
    viewedFilter,
    advancedFilters,
    preloadEnabled,
    preloadRandomness,
    viewModeRef,
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
    setPreloadInsufficient,
    setActualFoundCount,
    setSnackbarMessage,
    setSnackbarSeverity,
    setSnackbarOpen,
    performAutoRating,
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

  saveAndSwitchRef.current = saveAndSwitch

  useEffect(() => {
    if (!creatorMetadataPatchRef) {
      return
    }

    creatorMetadataPatchRef.current = updateRandomHistoryCreatorMetadata

    return () => {
      creatorMetadataPatchRef.current = () => {}
    }
  }, [creatorMetadataPatchRef, updateRandomHistoryCreatorMetadata])

  useEffect(() => {
    if (!ratingMetadataPatchRef) {
      return
    }

    ratingMetadataPatchRef.current = updateRandomHistoryRatingMetadata

    return () => {
      ratingMetadataPatchRef.current = () => {}
    }
  }, [ratingMetadataPatchRef, updateRandomHistoryRatingMetadata])

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
   * 随机模式自己的切源逻辑。
   * 随机模式当前仅处理小视频切源；
   * 图组模式和大视频模式相关的流式切源逻辑不再在这里承接。
   */
  const handlePlayModeSelect = useCallback((mode: PlaybackMode) => {
    setShowPlayModeSelector(false)

    if (!currentFile || !config) {
      return
    }

    if (mediaType !== 'small-video') {
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

    playIntentRef.current = true
    setMediaUrl(nextMediaUrl)
    setOriginalStreamUrl(nextOriginalStreamUrl)
    setTranscodeUrl(nextTranscodeUrl)
    setIsUsingTranscode(nextIsUsingTranscode)

    setTimeout(() => {
      const nextVideo = isMobile
        ? mobileVideoRef.current?.getVideoElement?.()
        : videoRef.current

      nextVideo?.play?.().catch(() => {})
    }, 100)
  }, [
    config,
    currentFile,
    isMobile,
    mediaType,
    mobileVideoRef,
    playIntentRef,
    smallVideoDirectPlayEnabled,
    setShowPlayModeSelector,
    setIsUsingTranscode,
    setMediaUrl,
    setOriginalStreamUrl,
    setTranscodeUrl,
    videoRef,
  ])

  /**
   * 随机模式“开始预览 / 换一个”入口。
   * 它是随机模式内部真正触发 [`loadRandomFile()`](app/split-main/random/useRandomMode.ts:286) 的地方，
   * 与主页面壳层里的同名入口不同，这里只处理随机模式本身。
   */
  const loadRandomMedia = useCallback(() => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }

    playIntentRef.current = true

    if (mobileVideoRef.current?.warmUp) {
      mobileVideoRef.current.warmUp()
    }

    saveAndSwitch(() => {
      void loadRandomFile(false)
    })
  }, [config, loadRandomFile, mobileVideoRef, playIntentRef, saveAndSwitch, setError])

  /**
   * 随机模式手势开始处理。
   */
  const handleTouchStart = useCallback((event: React.TouchEvent) => {
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
   * 随机模式手势移动处理。
   */
  const handleTouchMove = useCallback((event: React.TouchEvent) => {
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
   * 随机模式手势结束处理。
   * - 上滑：前进或继续随机加载
   * - 下滑：回看历史
   */
  const handleTouchEnd = useCallback((event: React.TouchEvent) => {
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
      const direction = deltaY < 0 ? 'up' : 'down'
      if (mobileVideoRef.current?.warmUp) {
        mobileVideoRef.current.warmUp()
      }

      if (direction === 'up') {
        if (randomHistoryIndex === -1) {
          loadRandomMedia()
        } else {
          loadNextRandomFile()
        }
      } else {
        const maxHistoryCount = 3
        const newIndex = randomHistoryIndex - 1
        const targetIndex = randomHistory.length + newIndex
        const stepsBack = (randomHistory.length - 1) - targetIndex

        if (targetIndex < 0 || stepsBack > maxHistoryCount) {
          setSnackbarMessage('最多只能回看3个文件')
          setSnackbarSeverity('info')
          setSnackbarOpen(true)
        } else {
          loadPreviousRandomFile()
        }
      }
    }

    touchStartYRef.current = null
    touchStartXRef.current = null
    isSwipingRef.current = false
  }, [
    fullscreen,
    isMobile,
    loadNextRandomFile,
    loadPreviousRandomFile,
    loadRandomMedia,
    mobileVideoRef,
    randomHistory.length,
    randomHistoryIndex,
    setSnackbarMessage,
    setSnackbarOpen,
    setSnackbarSeverity,
  ])

  /**
   * 随机模式预览主体。
   *
   * 这里统一挂在 [`CommonPreviewSurface`](components/split-main/CommonPreviewSurface.tsx) 上，
   * 让随机模式内部只关心“渲染什么媒体内容”，而不重复实现页面级预览容器。
   *
   * 覆盖的随机模式预览类型包括：
   * - 图片预览
   * - 小视频预览（移动端 / 桌面端）
   */
  return (
    <>
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
            {/* 图片预览：随机模式最基础的预览形态。 */}
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
                    creator={currentFile.creator ?? null}
                    creatorResolved={currentFile.creatorResolved}
                    onCreatorIdentified={setCurrentCreator}
                    onTagClick={onOpenCreatorDialog}
                    refreshKey={creatorRefreshKey}
                  />
                )}
                {currentFile && (
                  <CreatorDetailTag
                    filePath={currentFile.filename}
                    creator={currentFile.creator ?? null}
                    creatorResolved={currentFile.creatorResolved}
                    onTagClick={(creator: any | null) => onOpenCreatorDetail?.(creator)}
                    refreshKey={creatorRefreshKey}
                  />
                )}
              </>
            )}

            {/*
              移动端小视频预览：
              保持与主页面一致，继续走 [`MobileVideoPlayer`](components/MobileVideoPlayer.tsx)，
              以复用移动端自动播放与手势暖机逻辑。
            */}
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
                    const video = mobileVideoRef.current?.getVideoElement()
                    if (video) {
                      handleVideoTimeUpdate({ currentTarget: video } as SyntheticEvent<HTMLVideoElement>)
                    }
                  }}
                  onEnded={handleVideoEnded}
                  onPlay={() => {}}
                />
              </Box>
            )}

            {isMobile && currentFile && mediaType === 'small-video' && (
              <CreatorTag
                filePath={currentFile.filename}
                creator={currentFile.creator ?? null}
                creatorResolved={currentFile.creatorResolved}
                onCreatorIdentified={setCurrentCreator}
                onTagClick={onOpenCreatorDialog}
                position={{ top: '15%', left: '15%' }}
                refreshKey={creatorRefreshKey}
              />
            )}
            {isMobile && currentFile && mediaType === 'small-video' && (
              <CreatorDetailTag
                filePath={currentFile.filename}
                creator={currentFile.creator ?? null}
                creatorResolved={currentFile.creatorResolved}
                onTagClick={(creator: any | null) => onOpenCreatorDetail?.(creator)}
                position={{ top: '22%', right: '10%' }}
                refreshKey={creatorRefreshKey}
              />
            )}

            {/*
              桌面端小视频预览：
              使用原生 [`video`](components/split-main/modes/RandomModePage.tsx:569) 元素，
              以保持和原主页面一致的小视频控制体验。
            */}
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
                    creator={currentFile.creator ?? null}
                    creatorResolved={currentFile.creatorResolved}
                    onCreatorIdentified={setCurrentCreator}
                    onTagClick={onOpenCreatorDialog}
                    refreshKey={creatorRefreshKey}
                  />
                )}
                {currentFile && (
                  <CreatorDetailTag
                    filePath={currentFile.filename}
                    creator={currentFile.creator ?? null}
                    creatorResolved={currentFile.creatorResolved}
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
          随机模式通用全屏覆盖层：
          当前仅服务图片 / 小视频场景。
        */
        fullscreenOverlay={
          <>
            {currentFile && fullscreen && (
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
                  }}
                >
                  <Typography variant="body1" fontWeight="medium">
                    随机浏览
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
                  ratingSyncCount={ratingQueueActiveCount}
                  variant="basic"
                />

                {randomHistoryIndex >= -1 && (
                  <DraggableFab
                    storageKey="fullscreen_shuffle"
                    onClick={loadRandomMedia}
                    disabled={isSwitching}
                    defaultSx={{ right: 10, bottom: 80, zIndex: 2001 }}
                  >
                    <ShuffleIcon />
                  </DraggableFab>
                )}
              </>
            )}

            {currentFile && fullscreen && (
              <IconButton
                onClick={toggleFullscreen}
                sx={{
                  position: 'fixed',
                  top: 24,
                  right: 24,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  color: 'white',
                  zIndex: 2001,
                }}
              >
                <FullscreenExitIcon />
              </IconButton>
            )}
          </>
        }
        /*
          随机模式底部信息区：
          在非全屏场景展示文件信息、评分状态、高亮条以及外部播放入口。
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
              externalPlayerMenu={isVideoRef.current(currentFile.filename)
                ? {
                    anchorEl: externalPlayerAnchor,
                    open: externalPlayerMenuOpen,
                    onClose: closeExternalPlayerMenu,
                    onOpen: handleExternalPlayerClick,
                    onPlaySystem: () => playWithExternalPlayer('system'),
                    onPlayPotPlayer: () => playWithExternalPlayer('potplayer'),
                    onPlayVlc: () => playWithExternalPlayer('vlc'),
                  }
                : undefined}
            />
          ) : undefined
        }
      />

      {/*
        随机模式空状态：
        当还没有抽取到媒体文件时，给出“开始预览”入口，并复用顶部预加载状态信息。
      */}
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
            准备好了！
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            从 {directoryCount} 个目录中
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            随机加载{filteredStatsLabel === '全部' ? '媒体文件' : filteredStatsLabel}
          </Typography>
          <Typography variant="body2" color="primary" sx={{ mb: 3 }}>
            当前筛选：{filteredStatsLabel} - {filteredStatsTotal} 个文件
          </Typography>
          {cachePreloadProgress && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              预加载进度：{preloadInsufficient ? `${actualFoundCount}/${cachePreloadProgress.current}/${cachePreloadProgress.total}` : `${cachePreloadProgress.current}/${cachePreloadProgress.total}`}
            </Typography>
          )}
          <Button variant="contained" size="large" startIcon={<ShuffleIcon />} onClick={loadRandomMedia}>
            开始预览
          </Button>
        </Paper>
      )}

      {/* 随机模式初始加载态。 */}
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
            正在准备随机模式预览...
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            从 {directoryCount} 个目录中
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            随机加载{filteredStatsLabel === '全部' ? '媒体文件' : filteredStatsLabel}
          </Typography>
          <Typography variant="body2" color="primary" sx={{ mb: 2 }}>
            当前筛选：{filteredStatsLabel} - {filteredStatsTotal} 个文件
          </Typography>
          {cachePreloadProgress && (
            <Typography variant="body2" color="text.secondary">
              预加载进度：{preloadInsufficient ? `${actualFoundCount}/${cachePreloadProgress.current}/${cachePreloadProgress.total}` : `${cachePreloadProgress.current}/${cachePreloadProgress.total}`}
            </Typography>
          )}
        </Box>
      )}

      {/* 随机模式评分弹窗：普通图片 / 小视频统一挂在页面预览容器上。 */}
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

      {!fullscreen && !(randomHistoryIndex < -1) && currentFile && (
        <Tooltip title={loading ? '加载中...' : '换一个'} placement="left">
          <DraggableFab
            storageKey="normal_shuffle"
            color="primary"
            aria-label="换一个"
            onClick={loadRandomMedia}
            disabled={loading || isSwitching}
            defaultSx={{
              zIndex: 1000,
            }}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : <ShuffleIcon />}
          </DraggableFab>
        </Tooltip>
      )}

      {!fullscreen && currentFile && (
        <>
          <Tooltip
            title={
              randomHistory.length === 0
                ? '没有历史记录'
                : randomHistoryIndex <= -randomHistory.length
                  ? '已经是最早的记录'
                  : '回看上一个'
            }
            placement="top"
          >
            <span>
              <IconButton
                aria-label="回看上一个"
                onClick={loadPreviousRandomFile}
                disabled={loading || isSwitching || randomHistory.length === 0 || randomHistoryIndex <= -randomHistory.length}
                sx={{
                  position: 'fixed',
                  bottom: 24,
                  right: 104,
                  zIndex: 1000,
                  width: 56,
                  height: 56,
                  backgroundColor: theme => theme.palette.secondary.main,
                  color: theme => theme.palette.secondary.contrastText,
                  boxShadow: 4,
                  '&:hover': {
                    backgroundColor: theme => theme.palette.secondary.dark,
                  },
                  '&.Mui-disabled': {
                    backgroundColor: 'rgba(0, 0, 0, 0.12)',
                    color: 'rgba(0, 0, 0, 0.26)',
                  },
                }}
              >
                <ArrowBackIcon />
              </IconButton>
            </span>
          </Tooltip>

          {randomHistoryIndex < -1 && (
            <Tooltip title="前进到下一个" placement="top">
              <span>
                <IconButton
                  aria-label="前进到下一个"
                  onClick={loadNextRandomFile}
                  disabled={loading || isSwitching}
                  sx={{
                    position: 'fixed',
                    bottom: 24,
                    right: 184,
                    zIndex: 1000,
                    width: 56,
                    height: 56,
                    backgroundColor: theme => theme.palette.secondary.main,
                    color: theme => theme.palette.secondary.contrastText,
                    boxShadow: 4,
                    '&:hover': {
                      backgroundColor: theme => theme.palette.secondary.dark,
                    },
                    '&.Mui-disabled': {
                      backgroundColor: 'rgba(0, 0, 0, 0.12)',
                      color: 'rgba(0, 0, 0, 0.26)',
                    },
                  }}
                >
                  <ArrowForwardIcon />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </>
      )}

      {/* 随机模式“已看完所有文件”重开对话框。 */}
      <Dialog open={showRestartDialog} onClose={handleCancelRestart} maxWidth="sm" fullWidth>
        <DialogTitle>🎉 已看完所有符合条件的文件</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            您已经浏览完所有符合当前筛选条件的文件。
          </Typography>
          <Typography variant="body2" color="text.secondary">
            是否重新开始？文件顺序将重新随机排列。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelRestart} color="inherit">
            取消
          </Button>
          <Button onClick={handleRestartViewing} variant="contained" color="primary">
            重新开始
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

