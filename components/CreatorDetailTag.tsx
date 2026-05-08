'use client'

import { useEffect } from 'react'

import { Box, Typography, keyframes } from '@mui/material'
import { ChevronRight as ChevronRightIcon, Home as HomeIcon } from '@mui/icons-material'

import { useCreatorIdentification } from '@/hooks/useCreatorIdentification'

/**
 * 脉冲动画效果 - 用于标签的呼吸灯效果
 */
const pulseAnimation = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.12); opacity: 0.82; }
`

/**
 * 博主详情标签组件的属性接口
 */
interface CreatorDetailTagProps {
  /** 媒体文件路径，用于识别博主 */
  filePath: string
  /** 点击标签时的回调函数，传入识别到的博主信息 */
  onTagClick: (creator: any | null) => void
  /** 博主识别完成后的回调函数（可选） */
  onCreatorIdentified?: (creator: any | null) => void
  /** 标签在屏幕上的位置（可选） */
  position?: { top?: string; bottom?: string; left?: string; right?: string }
  /** 标签是否可见（默认为 true） */
  visible?: boolean
  /** 刷新键，变化时重新识别博主 */
  refreshKey?: number
}

/**
 * 博主详情标签组件
 * 
 * 功能：
 * - 根据文件路径自动识别博主
 * - 显示"去主页"标签，点击后打开博主详情
 * - 支持自定义位置和可见性控制
 * - 带有脉冲动画效果的视觉提示
 */
export default function CreatorDetailTag({
  filePath,
  onTagClick,
  onCreatorIdentified,
  position,
  visible = true,
  refreshKey = 0,
}: CreatorDetailTagProps) {
  const { creatorName, identifiedCreator, loading } = useCreatorIdentification(filePath, refreshKey)

  useEffect(() => {
    if (!loading) {
      onCreatorIdentified?.(identifiedCreator)
    }
  }, [identifiedCreator, loading, onCreatorIdentified])

  // 加载中、不可见或未识别到博主时不显示标签
  if (loading || !visible || !creatorName) {
    return null
  }

  return (
    <Box
      onClick={(event) => {
        event.stopPropagation()
        onTagClick(identifiedCreator)
      }}
      sx={{
        position: 'absolute',
        ...(position || { top: '22%', right: '12%' }),
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        cursor: 'pointer',
        zIndex: 21,
        opacity: 0.72,
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        transition: 'opacity 0.2s ease',
        '&:hover': { opacity: 1 },
      }}
    >
      <Box sx={{ position: 'relative', width: 12, height: 12 }}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            border: '1.5px solid rgba(255,255,255,0.9)',
            animation: `${pulseAnimation} 2s ease-in-out infinite`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: 3,
            left: 3,
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: '#fff',
          }}
        />
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.35,
          borderRadius: '999px',
          bgcolor: 'rgba(0,0,0,0.64)',
          color: '#fff',
          backdropFilter: 'blur(6px)',
          maxWidth: 220,
          overflow: 'hidden',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <HomeIcon sx={{ fontSize: 13 }} />
        <Typography variant="body2" sx={{ fontSize: 11, fontWeight: 700 }} noWrap>
          去主页
        </Typography>
        <ChevronRightIcon sx={{ fontSize: 14 }} />
      </Box>
    </Box>
  )
}
