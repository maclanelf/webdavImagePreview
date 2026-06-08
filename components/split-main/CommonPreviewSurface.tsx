'use client'

import type { ReactNode, TouchEvent } from 'react'

import { Box, Card } from '@mui/material'

import type { MediaFile, MediaType } from '@/types'

interface CommonPreviewSurfaceProps {
  currentFile: MediaFile | null
  mediaUrl: string | null
  mediaType: MediaType
  fullscreen: boolean
  isMobile: boolean
  videoPlayerContainerRef: any
  onTouchStart: (event: TouchEvent) => void
  onTouchMove: (event: TouchEvent) => void
  onTouchEnd: (event: TouchEvent) => void
  onTouchCancel?: (event: TouchEvent) => void
  mediaContent: ReactNode
  fullscreenOverlay?: ReactNode
  footerContent?: ReactNode
  forceRender?: boolean
}

export default function CommonPreviewSurface({
  currentFile,
  mediaUrl,
  mediaType,
  fullscreen,
  isMobile,
  videoPlayerContainerRef,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  mediaContent,
  fullscreenOverlay,
  footerContent,
  forceRender = false,
}: CommonPreviewSurfaceProps) {
  const fullscreenTouchAction = fullscreen
    ? (mediaType === 'image' ? 'pinch-zoom' : 'none')
    : 'auto'

  const shouldReservePreviewSpace =
    !fullscreen &&
    Boolean(currentFile) &&
    (mediaType === 'image' || mediaType === 'small-video' || mediaType === 'stream-video')

  const reservedPreviewMinHeight = shouldReservePreviewSpace
    ? isMobile
      ? 'clamp(180px, 28vh, 260px)'
      : 'clamp(260px, 42vh, 520px)'
    : 0

  if (!forceRender && !((currentFile && mediaUrl) || (!currentFile && !mediaUrl && isMobile))) {
    return null
  }

  return (
    <Box
      sx={{
        position: 'relative',
        overflow: fullscreen ? 'hidden' : 'visible',
        overscrollBehavior: fullscreen ? 'none' : 'auto',
        ...(fullscreen && {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2000,
        }),
      }}
    >
      <Card
        elevation={0}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        sx={{
          borderRadius: fullscreen ? 0 : 2,
          overflow: 'hidden',
          backgroundColor: fullscreen ? '#000' : 'transparent',
          touchAction: fullscreenTouchAction,
          overscrollBehavior: fullscreen ? 'none' : 'auto',
          ...(fullscreen && {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1,
          }),
        }}
      >
        <Box
          ref={videoPlayerContainerRef}
          sx={{
            position: 'relative',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor:
              (mediaType === 'image' || mediaType === 'small-video' || mediaType === 'stream-video') && currentFile
                ? '#000'
                : 'transparent',
            borderRadius: fullscreen ? 0 : 2,
            overflow: 'hidden',
            touchAction: fullscreenTouchAction,
            overscrollBehavior: fullscreen ? 'none' : 'auto',
            minHeight:
              reservedPreviewMinHeight,
            height:
              (mediaType === 'image' || mediaType === 'small-video' || mediaType === 'stream-video') && currentFile
                ? 'auto'
                : 0,
            ...(fullscreen && {
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }),
          }}
        >
          {mediaContent}
          {fullscreenOverlay}
        </Box>

        {footerContent}
      </Card>
    </Box>
  )
}
