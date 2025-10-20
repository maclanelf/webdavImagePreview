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
}

const quickRatingConfig = [
  { rating: 1, evaluation: '丑死了', color: 'error' as const },
  { rating: 2, evaluation: '一般', color: 'warning' as const },
  { rating: 3, evaluation: '还行', color: 'info' as const },
  { rating: 4, evaluation: '非常爽', color: 'primary' as const },
  { rating: 5, evaluation: '爽死了', color: 'success' as const },
]

export default function QuickRating({ currentRating, onQuickRate, disabled }: QuickRatingProps) {
  const handleQuickRate = (rating: number, evaluation: string) => {
    onQuickRate(rating, evaluation)
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        {quickRatingConfig.map((config) => (
          <Tooltip 
            key={config.rating} 
            title={`快捷键 ${config.rating}: ${config.rating}星 - ${config.evaluation} - 已看过`}
            placement="top"
          >
            <IconButton
              size="small"
              onClick={() => handleQuickRate(config.rating, config.evaluation)}
              disabled={disabled}
              sx={{
                color: currentRating === config.rating ? `${config.color}.main` : 'text.secondary',
                '&:hover': {
                  backgroundColor: `${config.color}.light`,
                  color: `${config.color}.main`,
                },
                transition: 'all 0.2s ease-in-out',
              }}
            >
              {currentRating && currentRating >= config.rating ? (
                <Star fontSize="small" />
              ) : (
                <StarBorder fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        ))}
      </Stack>
      
      {currentRating && (
        <Chip
          label={`${currentRating}星 - ${quickRatingConfig[currentRating - 1]?.evaluation || '已评分'}`}
          size="small"
          color={quickRatingConfig[currentRating - 1]?.color || 'default'}
          variant="outlined"
        />
      )}
    </Box>
  )
}
