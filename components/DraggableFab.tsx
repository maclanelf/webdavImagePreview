import React from 'react'
import { Fab, FabProps, SxProps, Theme } from '@mui/material'
import { useDraggable } from '@/hooks/useDraggable'

interface DraggableFabProps extends Omit<FabProps, 'onMouseDown' | 'onTouchStart'> {
  storageKey: string
  defaultPosition?: { x: number; y: number }
  defaultSx?: FabProps['sx']
  onPositionChange?: (position: { x: number; y: number }) => void
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}

export default function DraggableFab({
  storageKey,
  defaultPosition,
  defaultSx,
  onPositionChange,
  onClick,
  children,
  sx,
  ...otherProps
}: DraggableFabProps) {
  const { position, isDragging, dragHandlers } = useDraggable({
    storageKey,
    defaultPosition,
    onPositionChange
  })

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // 如果正在拖动，不触发点击事件
    if (isDragging) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    onClick?.(e)
  }

  // 合并样式：默认样式 + 位置样式 + 用户自定义样式
  const baseSx = {
    position: 'fixed' as const,
    cursor: isDragging ? 'grabbing' : 'grab',
    userSelect: 'none' as const,
    ...defaultSx,
    ...(position ? {
      left: `${position.x}px`,
      top: `${position.y}px`,
    } : {
      bottom: 24,
      right: 24,
    }),
  }
  
  const mergedSx = { ...baseSx, ...sx } as SxProps<Theme>

  return (
    <Fab
      {...otherProps}
      sx={mergedSx}
      onClick={handleClick}
      onMouseDown={(e) => {
        dragHandlers.onMouseDown(e)
      }}
      onTouchStart={(e) => {
        dragHandlers.onTouchStart(e)
      }}
    >
      {children}
    </Fab>
  )
}

