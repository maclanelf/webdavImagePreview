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
  // 检查 defaultSx 中是否包含位置属性
  const hasPositionInDefaultSx = defaultSx && (
    'bottom' in defaultSx || 'top' in defaultSx || 
    'left' in defaultSx || 'right' in defaultSx
  )
  
  // 确定位置样式
  let positionStyles = {}
  if (position) {
    // 如果有保存的位置，使用保存的位置
    positionStyles = {
      left: `${position.x}px`,
      top: `${position.y}px`,
    }
  } else if (!hasPositionInDefaultSx) {
    // 如果没有保存的位置，且 defaultSx 中也没有位置，使用默认位置
    positionStyles = {
      bottom: 24,
      right: 24,
    }
  }
  // 如果没有保存的位置，但 defaultSx 中有位置，则不添加额外的位置样式（使用 defaultSx 中的）
  
  const baseSx = {
    position: 'fixed' as const,
    cursor: isDragging ? 'grabbing' : 'grab',
    userSelect: 'none' as const,
    ...defaultSx,
    ...positionStyles, // 位置样式放在最后，确保优先级最高
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

