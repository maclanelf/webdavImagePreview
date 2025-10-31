'use client'

import React from 'react'
import {
  Box,
  IconButton,
  Tooltip,
  Chip,
  Stack
} from '@mui/material'
import {
  Star,
  StarBorder,
  StarHalf
} from '@mui/icons-material'

interface QuickRatingProps {
  currentRating?: number
  onQuickRate: (rating: number, evaluation: string) => void
  disabled?: boolean
  fullscreen?: boolean // 全屏模式，显示更大的星星
  hideText?: boolean // 隐藏文字标签，只显示星星
}

const quickRatingConfig = [
  { rating: 1, evaluation: '丑死了', color: 'error' as const },
  { rating: 2, evaluation: '一般', color: 'warning' as const },
  { rating: 3, evaluation: '还行', color: 'info' as const },
  { rating: 4, evaluation: '非常爽', color: 'primary' as const },
  { rating: 5, evaluation: '爽死了', color: 'success' as const },
]

export default function QuickRating({ currentRating, onQuickRate, disabled, fullscreen = false, hideText = false }: QuickRatingProps) {
  const handleQuickRate = (rating: number, evaluation: string) => {
    onQuickRate(rating, evaluation)
  }

  const iconSize = fullscreen ? 'medium' : 'small'
  const buttonSize = fullscreen ? 'medium' : 'small'

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Stack direction="row" spacing={fullscreen ? 1 : 0.5} alignItems="center">
        {quickRatingConfig.map((config) => {
          // 判断这颗星是否应该点亮
          const isLit = currentRating && currentRating >= config.rating
          
          return (
            <Tooltip 
              key={config.rating} 
              title={`快捷键 ${config.rating}: ${config.rating}星 - ${config.evaluation} - 已看过`}
              placement="top"
            >
              <IconButton
                size={buttonSize as any}
                onClick={() => handleQuickRate(config.rating, config.evaluation)}
                disabled={disabled}
                sx={{
                  // 点亮的星星统一使用橙色，未点亮的根据模式调整颜色
                  color: isLit 
                    ? 'warning.main' 
                    : fullscreen 
                      ? 'rgba(255, 255, 255, 0.7)' // 全屏模式：白色半透明
                      : 'text.secondary', // 非全屏模式：灰色
                  '&:hover': {
                    backgroundColor: `${config.color}.light`,
                    color: `${config.color}.main`,
                  },
                  transition: 'all 0.2s ease-in-out',
                  ...(fullscreen && {
                    fontSize: '1.5rem',
                  })
                }}
              >
                {isLit ? (
                  <Star fontSize={iconSize} />
                ) : (
                  <StarBorder fontSize={iconSize} />
                )}
              </IconButton>
            </Tooltip>
          )
        })}
      </Stack>
      
      {currentRating && !hideText && (
        <Chip
          label={`${currentRating}星 - ${quickRatingConfig[currentRating - 1]?.evaluation || '已评分'}`}
          size={fullscreen ? 'medium' : 'small'}
          color={quickRatingConfig[currentRating - 1]?.color || 'default'}
          variant="outlined"
          sx={{
            ...(fullscreen && {
              color: 'white',
              borderColor: 'rgba(255, 255, 255, 0.5)',
            })
          }}
        />
      )}
    </Box>
  )
}
