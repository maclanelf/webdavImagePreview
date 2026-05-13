'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'

import { Alert, Box, IconButton, Menu, MenuItem, Snackbar, Stack, Typography } from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  OpenInNew as OpenInNewIcon,
  Shuffle as ShuffleIcon,
} from '@mui/icons-material'

import CreatorTag from '@/components/CreatorTag'
import DraggableFab from '@/components/DraggableFab'
import InstantVideoPlayer, { type InstantVideoPlayerRef } from '@/components/InstantVideoPlayer'
import MobileVideoPlayer from '@/components/MobileVideoPlayer'
import CommonPreviewSurface from '@/components/split-main/CommonPreviewSurface'
import FullscreenRatingDock from '@/components/split-main/shared/FullscreenRatingDock'
import { useVideoHighlightsModule } from '@/components/VideoHighlightsModule'
import type { MediaExperienceCreatorOverlayProps, MediaExperienceItem, MediaFile, MediaType } from '@/types'

/**
 * 博主详情预览容器组件的属性接口
 */
interface CreatorDetailPreviewContainerProps {
  /** 媒体体验项列表 */
  items: MediaExperienceItem[]
  /** 是否激活显示预览层 */
  active?: boolean
  /** 当前预览的索引 */
  currentIndex: number
  /** 缓存版本号，变化时强制重新渲染 */
  cacheVersion?: number
  /** 是否自动播放视频 */
  playIntent?: boolean
  /** 预热令牌，变化时在用户手势链路内尝试保留带声音播放能力 */
  warmUpToken?: number
  /** 当前媒体的评分 */
  currentRating?: number
  /** 当前预览上下文中的总文件数，图组预览时用于展示完整总数 */
  displayTotalCount?: number
  /** 切换索引的回调 */
  onChangeIndex: (nextIndex: number) => void
  /** 关闭预览的回调 */
  onClose: () => void
  /** 快捷评分回调 */
  onQuickRate?: (rating: number, evaluation: string) => void
  /** 打开评分对话框的回调 */
  onOpenRatingDialog?: () => void
  /** 是否显示外部播放器按钮 */
  showExternalPlayerButton?: boolean
  /** 点击外部播放器按钮的回调 */
  onExternalPlayerClick?: (event: ReactMouseEvent<HTMLElement>) => void
  /** 外部播放器菜单是否打开 */
  externalPlayerMenuOpen?: boolean
  /** 外部播放器菜单的锚点元素 */
  externalPlayerMenuAnchor?: HTMLElement | null
  /** 关闭外部播放器菜单的回调 */
  onExternalPlayerMenuClose?: () => void
  /** 选择外部播放器的回调 */
  onSelectExternalPlayer?: (player: 'potplayer' | 'vlc') => void
  /** 是否显示小视频直链播放按钮 */
  showSmallVideoDirectButton?: boolean
  /** 小视频直链播放的回调 */
  onSmallVideoDirectPlay?: () => void
  /** 博主覆盖层属性 */
  creatorOverlayProps?: MediaExperienceCreatorOverlayProps | null
  /** 视频时间更新回调 */
  onVideoTimeUpdate?: (currentTime: number, duration: number) => void
  /** 视频播放结束回调 */
  onVideoEnded?: () => void
  /** 中心覆盖层内容 */
  centerOverlay?: ReactNode
  /** 评分拖拽组件的存储键 */
  ratingDraggableStorageKey?: string
  /** 大视频播放器引用，用于在用户手势链路内直接调用 warmUp */
  instantVideoPlayerRef?: MutableRefObject<InstantVideoPlayerRef | null> | null
}

export interface CreatorDetailPreviewContainerRef {
  warmUp: (targetMediaType?: MediaType | null) => void
}

/** 通知消息的严重程度类型 */
type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning'

/**
 * 博主详情预览容器组件
 * 
 * 功能：
 * - 全屏预览博主的媒体内容（图片、小视频、流媒体视频）
 * - 支持上下滑动切换媒体
 * - 集成快捷评分和详细评分功能
 * - 支持视频精彩时刻标记和播放
 * - 支持外部播放器调用
 * - 显示博主标签和相关信息
 */
const CreatorDetailPreviewContainer = forwardRef<CreatorDetailPreviewContainerRef, CreatorDetailPreviewContainerProps>(function CreatorDetailPreviewContainer({
  items,
  active = false,
  currentIndex,
  cacheVersion = 0,
  playIntent = true,
  warmUpToken = 0,
  currentRating,
  displayTotalCount,
  onChangeIndex,
  onClose,
  onQuickRate,
  onOpenRatingDialog,
  showExternalPlayerButton = false,
  onExternalPlayerClick,
  externalPlayerMenuOpen = false,
  externalPlayerMenuAnchor = null,
  onExternalPlayerMenuClose,
  onSelectExternalPlayer,
  showSmallVideoDirectButton = false,
  onSmallVideoDirectPlay,
  creatorOverlayProps,
  onVideoTimeUpdate,
  onVideoEnded,
  centerOverlay,
  ratingDraggableStorageKey = 'creator_detail_preview_rating',
  instantVideoPlayerRef = null,
}: CreatorDetailPreviewContainerProps, ref) {
  /** 根容器引用 */
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** 视频播放器容器引用 */
  const videoPlayerContainerRef = useRef<HTMLDivElement | null>(null)
  /** 即时视频播放器引用 */
  const instantVideoRef = useRef<InstantVideoPlayerRef | null>(null)
  /** 移动端小视频播放器引用 */
  const mobileVideoRef = useRef<any>(null)
  /** 触摸开始时的 Y 坐标 */
  const touchStartYRef = useRef<number | null>(null)
  /** 触摸开始时的 X 坐标 */
  const touchStartXRef = useRef<number | null>(null)
  /** 是否正在滑动 */
  const swipingRef = useRef(false)
  /** 图片控制栏是否可见 */
  const [imageControlsVisible, setImageControlsVisible] = useState(true)
  /** 流媒体视频控制栏是否可见 */
  const [streamControlsVisible, setStreamControlsVisible] = useState(true)
  /** 是否为移动设备 */
  const [isMobile, setIsMobile] = useState(false)
  /** 通知消息状态 */
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: SnackbarSeverity }>({
    open: false,
    message: '',
    severity: 'info',
  })

  const handleInstantVideoRef = useCallback((instance: InstantVideoPlayerRef | null) => {
    instantVideoRef.current = instance

    if (instantVideoPlayerRef) {
      instantVideoPlayerRef.current = instance
    }
  }, [instantVideoPlayerRef])

  /** 当前预览的媒体项 */
  const currentItem = items[currentIndex] || null
  /** 当前媒体类型 */
  const mediaType = (currentItem?.mediaType || 'image') as MediaType
  /** 是否为图片 */
  const isImage = mediaType === 'image'
  /** 是否为小视频 */
  const isSmallVideo = mediaType === 'small-video'
  /** 是否为流媒体视频 */
  const isStreamVideo = mediaType === 'stream-video'
  /** 控制栏是否显示 */
  const showControls = isImage ? imageControlsVisible : isStreamVideo ? streamControlsVisible : true
  /** 是否有多个媒体可切换 */
  const hasMultipleItems = items.length > 1
  /** 是否还能切换到下一个媒体 */
  const canGoNext = currentIndex < items.length - 1

  useImperativeHandle(ref, () => ({
    warmUp: (targetMediaType?: MediaType | null) => {
      if (targetMediaType === 'small-video') {
        mobileVideoRef.current?.warmUp?.()
        return
      }

      if (targetMediaType === 'stream-video') {
        instantVideoRef.current?.warmUp?.()
        return
      }

      mobileVideoRef.current?.warmUp?.()
      instantVideoRef.current?.warmUp?.()
    },
  }), [])

  useLayoutEffect(() => {
    if (!warmUpToken) return

    if (isSmallVideo) {
      mobileVideoRef.current?.warmUp?.()
      return
    }

    if (isStreamVideo) {
      instantVideoRef.current?.warmUp?.()
    }
  }, [isSmallVideo, isStreamVideo, warmUpToken])

  /**
   * 检测是否为移动设备
   */
  useEffect(() => {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
    setIsMobile(userAgent.includes('android') || /iphone|ipad|ipod/.test(userAgent))
  }, [])

  /**
   * 切换媒体时重置控制栏可见性
   */
  useEffect(() => {
    setImageControlsVisible(true)
    setStreamControlsVisible(true)
  }, [currentItem?.id])

  /**
   * 将当前媒体项转换为 MediaFile 格式
   * 用于传递给视频精彩时刻模块
   */
  const previewFile = useMemo<MediaFile | null>(() => {
    if (!currentItem?.filePath) return null
    return {
      filename: currentItem.filePath,
      basename: currentItem.title,
      size: 0,
      type: 'file',
      lastmod: '',
    }
  }, [currentItem])

  /**
   * 显示通知消息
   * 
   * @param message - 消息内容
   * @param severity - 消息严重程度
   */
  const notify = (message: string, severity: SnackbarSeverity) => {
    setSnackbar({ open: true, message, severity })
  }

  /**
   * 视频精彩时刻模块
   * 提供视频打点、精彩片段标记和连续播放功能
   */
  const videoHighlightsModule = useVideoHighlightsModule({
    currentFile: currentItem?.filePath ? { filename: currentItem.filePath, basename: currentItem.title } : null,
    mediaType,
    viewMode: 'large-video',
    fullscreen: true,
    streamVideoTagVisible: showControls,
    getCurrentTime: () => {
      const currentTime = instantVideoRef.current?.getCurrentTime?.()
      return typeof currentTime === 'number' && Number.isFinite(currentTime) ? currentTime : 0
    },
    onSeek: (seconds: number) => {
      instantVideoRef.current?.setCurrentTime?.(seconds)
    },
    onPlay: async () => {
      await instantVideoRef.current?.play?.()
    },
    onNotify: notify,
    fullscreenDialogContainer: instantVideoRef.current?.getContainerElement?.() || null,
    inlineDialogContainer: rootRef.current,
    fullscreenMarkerTopOffset: 74,
    fullscreenMarkerZIndex: 2203,
  })

  useEffect(() => {
    if (!isStreamVideo) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return

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

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isStreamVideo, videoHighlightsModule])

  /**
   * 处理上一个媒体
   */
  const handlePrev = () => {
    if (currentIndex <= 0) return
    onChangeIndex(currentIndex - 1)
  }

  /**
   * 处理下一个媒体
   */
  const handleNext = () => {
    if (currentIndex >= items.length - 1) return
    onChangeIndex(currentIndex + 1)
  }

  /**
   * 处理触摸开始事件
   * 记录触摸起始位置
   */
  const handleTouchStart = (event: ReactTouchEvent) => {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    touchStartYRef.current = touch.clientY
    touchStartXRef.current = touch.clientX
    swipingRef.current = false
  }

  /**
   * 处理触摸移动事件
   * 判断是否为垂直滑动，如果是则阻止默认行为
   */
  const handleTouchMove = (event: ReactTouchEvent) => {
    if (touchStartYRef.current === null || touchStartXRef.current === null) return
    const touch = event.touches[0]
    const deltaY = touch.clientY - touchStartYRef.current
    const deltaX = touch.clientX - touchStartXRef.current

    // 垂直滑动距离大于水平滑动且超过阈值时，标记为滑动状态
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      swipingRef.current = true
      event.preventDefault()
    }
  }

  /**
   * 处理触摸结束事件
   * 根据滑动方向切换媒体
   */
  const handleTouchEnd = (event: ReactTouchEvent) => {
    if (touchStartYRef.current === null || !swipingRef.current) {
      touchStartYRef.current = null
      touchStartXRef.current = null
      swipingRef.current = false
      return
    }

    const touch = event.changedTouches[0]
    const deltaY = touch.clientY - touchStartYRef.current
    // 滑动距离超过 50px 时触发切换
    if (Math.abs(deltaY) > 50) {
      if (deltaY < 0) {
        // 向上滑动 - 下一个
        handleNext()
      } else {
        // 向下滑动 - 上一个
        handlePrev()
      }
    }

    touchStartYRef.current = null
    touchStartXRef.current = null
    swipingRef.current = false
  }

  const creatorOverlay = currentItem?.filePath && creatorOverlayProps?.onCreatorTagClick ? (
    <CreatorTag
      filePath={currentItem.filePath}
      onTagClick={creatorOverlayProps.onCreatorTagClick}
      onCreatorIdentified={creatorOverlayProps.onCreatorIdentified}
      position={creatorOverlayProps.creatorTagPosition}
      visible={creatorOverlayProps.creatorTagVisible ?? showControls}
      refreshKey={creatorOverlayProps.creatorRefreshKey}
    />
  ) : null

  return (
    <Box
      ref={rootRef}
      sx={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        minHeight: '100dvh',
        overflow: 'hidden',
        backgroundColor: '#000',
        overscrollBehavior: 'none',
        WebkitOverflowScrolling: 'auto',
        touchAction: 'none',
        display: active ? 'block' : 'none',
        zIndex: 2400,
      }}
      onClick={() => {
        if (isImage) {
          setImageControlsVisible((value) => !value)
        }
      }}
    >
      <CommonPreviewSurface
        currentFile={previewFile}
        mediaUrl={currentItem?.src || null}
        mediaType={mediaType}
        fullscreen
        isMobile={isMobile}
        videoPlayerContainerRef={videoPlayerContainerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        forceRender
        mediaContent={
          <>
            {isImage && currentItem?.src && (
              <>
                <Box component="img" src={currentItem.src} alt={currentItem.title} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                {creatorOverlay}
              </>
            )}

            {active && isSmallVideo && currentItem?.src ? (
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                }}
              >
                <MobileVideoPlayer
                  ref={mobileVideoRef}
                  src={currentItem.src}
                  autoPlay={playIntent}
                  isParentFullscreen
                  isVisible
                  showDirectPlayButton={showSmallVideoDirectButton}
                  onDirectPlay={onSmallVideoDirectPlay}
                  onTimeUpdate={(currentTime, duration) => onVideoTimeUpdate?.(currentTime, duration)}
                  onEnded={onVideoEnded}
                />
                {creatorOverlay}
              </Box>
            ) : null}

            {active && isStreamVideo && currentItem?.src ? (
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  height: '100%',
                }}
              >
                <InstantVideoPlayer
                  ref={handleInstantVideoRef}
                  src={currentItem.src}
                  transcodeUrl={currentItem?.transcodeUrl || undefined}
                  autoPlay
                  playIntent={playIntent}
                  isParentFullscreen
                  onTimeUpdate={(currentTime, duration) => {
                    onVideoTimeUpdate?.(currentTime, duration)
                    videoHighlightsModule.syncSelectedHighlightByTime(currentTime)
                    videoHighlightsModule.handleContinuousPlaybackProgress(currentTime)
                  }}
                  onEnded={onVideoEnded}
                  highlights={videoHighlightsModule.progressHighlights}
                  selectedHighlightId={videoHighlightsModule.selectedHighlightId}
                  onRestartCurrentVideo={() => {
                    videoHighlightsModule.clearSelectedHighlight()
                    videoHighlightsModule.stopContinuousHighlightPlayback()
                  }}
                  onControlsVisibilityChange={setStreamControlsVisible}
                  alwaysOverlay={creatorOverlay}
                  fullscreenOverlay={
                    <>
                      {videoHighlightsModule.fullscreenMarkerControls}
                      {videoHighlightsModule.fullscreenStrip ? (
                        <Box
                          sx={{
                            position: 'absolute',
                            left: 20,
                            right: 20,
                            bottom: 88,
                            zIndex: 2001,
                            opacity: streamControlsVisible ? 1 : 0,
                            visibility: streamControlsVisible ? 'visible' : 'hidden',
                            transition: 'opacity 0.15s ease-out, visibility 0.15s ease-out',
                            pointerEvents: streamControlsVisible ? 'auto' : 'none',
                          }}
                        >
                          {videoHighlightsModule.fullscreenStrip}
                        </Box>
                      ) : null}
                    </>
                  }
                  style={{ width: '100%', height: '100%' }}
                />
              </Box>
            ) : null}
          </>
        }
        fullscreenOverlay={
          <>
            {showControls && (
              <>
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 2201,
                    px: 2,
                    pt: 2,
                    pb: 3,
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.86) 0%, rgba(0,0,0,0) 100%)',
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
                      <IconButton
                        onClick={(event) => {
                          event.stopPropagation()
                          onClose()
                        }}
                        sx={{ color: '#fff', bgcolor: 'rgba(0,0,0,0.42)' }}
                      >
                        <ArrowBackIcon />
                      </IconButton>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body1" sx={{ color: '#fff', fontWeight: 700 }} noWrap>
                          {currentItem?.title || '预览'}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.66)' }}>
                          {currentIndex + 1} / {displayTotalCount || items.length}
                        </Typography>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                      {showExternalPlayerButton && onExternalPlayerClick ? (
                        <IconButton
                          onClick={(event) => {
                            event.stopPropagation()
                            onExternalPlayerClick(event)
                          }}
                          sx={{
                            color: '#fff',
                            bgcolor: 'rgba(0,0,0,0.42)',
                            border: '1px solid rgba(255,255,255,0.18)',
                          }}
                        >
                          <OpenInNewIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      ) : null}
                    </Stack>
                  </Stack>
                </Box>

                {onQuickRate && (
                  <FullscreenRatingDock
                    storageKey={ratingDraggableStorageKey}
                    currentRating={currentRating ? { rating: currentRating } : null}
                    onQuickRate={onQuickRate}
                    onOpenDetail={() => onOpenRatingDialog?.()}
                    loading={false}
                    isSwitching={false}
                    detailDisabled={!onOpenRatingDialog}
                    zIndex={2202}
                    variant="enhanced"
                    defaultPosition={{ right: 10, bottom: 151 }}
                  />
                )}

                {hasMultipleItems ? (
                  <DraggableFab
                    storageKey="creator_detail_preview_next"
                    color="primary"
                    aria-label="换一个"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleNext()
                    }}
                    disabled={!canGoNext}
                    defaultSx={{
                      right: 10,
                      bottom: 80,
                      zIndex: 2202,
                    }}
                  >
                    <ShuffleIcon />
                  </DraggableFab>
                ) : null}
              </>
            )}
            {centerOverlay}
          </>
        }
      />

      <Menu anchorEl={externalPlayerMenuAnchor} open={externalPlayerMenuOpen} onClose={onExternalPlayerMenuClose}>
        <MenuItem onClick={() => onSelectExternalPlayer?.('potplayer')}>PotPlayer</MenuItem>
        <MenuItem onClick={() => onSelectExternalPlayer?.('vlc')}>VLC</MenuItem>
      </Menu>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={1800}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ zIndex: 3000 }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      {videoHighlightsModule.editorDialog}
    </Box>
  )
})

CreatorDetailPreviewContainer.displayName = 'CreatorDetailPreviewContainer'

export default CreatorDetailPreviewContainer
