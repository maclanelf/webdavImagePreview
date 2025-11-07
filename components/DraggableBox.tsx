import React from 'react'
import { Box, BoxProps, SxProps, Theme } from '@mui/material'
import { useDraggable } from '@/hooks/useDraggable'

interface DraggableBoxProps extends Omit<BoxProps, 'onMouseDown' | 'onTouchStart' | 'sx'> {
  storageKey: string
  defaultPosition?: { x: number; y: number }
  defaultSx?: BoxProps['sx']
  onPositionChange?: (position: { x: number; y: number }) => void
  sx?: BoxProps['sx'] | ((state: { position: { x: number; y: number } | null; isDragging: boolean }) => SxProps<Theme>)
}

export default function DraggableBox({
  storageKey,
  defaultPosition,
  defaultSx,
  onPositionChange,
  children,
  sx,
  ...otherProps
}: DraggableBoxProps) {
  const { position, isDragging, dragHandlers } = useDraggable({
    storageKey,
    defaultPosition,
    onPositionChange
  })

  // 合并样式：默认样式 + 位置样式 + 用户自定义样式
  const baseSx = {
    position: 'fixed' as const,
    cursor: isDragging ? 'grabbing' : 'grab',
    userSelect: 'none' as const,
    transition: isDragging ? 'none' : 'opacity 0.3s ease-in-out',
    ...defaultSx,
    ...(position ? {
      left: `${position.x}px`,
      top: `${position.y}px`,
    } : {}),
  }
  
  const customSx = typeof sx === 'function' 
    ? (sx as (state: { position: { x: number; y: number } | null; isDragging: boolean }) => SxProps<Theme>)({ position, isDragging })
    : (sx || {})
  const mergedSx = { ...baseSx, ...customSx } as SxProps<Theme>

  return (
    <Box
      {...otherProps}
      sx={mergedSx}
      onMouseDown={dragHandlers.onMouseDown}
      onTouchStart={dragHandlers.onTouchStart}
    >
      {children}
    </Box>
  )
}

