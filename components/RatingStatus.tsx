'use client'

import React from 'react'
import {
  Box,
  Chip,
  Typography,
  Tooltip,
  IconButton,
  Rating
} from '@mui/material'
import {
  Star,
  StarBorder,
  Visibility,
  VisibilityOff,
  Edit
} from '@mui/icons-material'

interface RatingStatusProps {
  rating?: number
  customEvaluation?: string | string[]
  category?: string | string[]
  isViewed?: boolean
  onEdit?: () => void
  compact?: boolean
}

export default function RatingStatus({
  rating,
  customEvaluation,
  category,
  isViewed,
  onEdit,
  compact = false
}: RatingStatusProps) {
  // 处理评价和分类可能是字符串或数组
  const evaluations = customEvaluation 
    ? (Array.isArray(customEvaluation) ? customEvaluation : [customEvaluation])
    : []
  const categories = category
    ? (Array.isArray(category) ? category : [category])
    : []
  
  // 尝试解析JSON字符串
  const parseIfNeeded = (value: string): string[] => {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : [value]
    } catch {
      return [value]
    }
  }
  
  const finalEvaluations = evaluations.length > 0 
    ? (typeof evaluations[0] === 'string' && evaluations[0].startsWith('[')
        ? parseIfNeeded(evaluations[0])
        : evaluations)
    : []
    
  const finalCategories = categories.length > 0
    ? (typeof categories[0] === 'string' && categories[0].startsWith('[')
        ? parseIfNeeded(categories[0])
        : categories)
    : []
  
  const hasRating = rating !== undefined && rating > 0
  const hasEvaluation = finalEvaluations.length > 0
  const hasCategory = finalCategories.length > 0

  if (compact) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        {/* 推荐指数 */}
        {hasRating && (
          <Tooltip title={`推荐指数: ${rating} 星`}>
            <Chip
              icon={<Star />}
              label={rating}
              size="small"
              color="warning"
              variant="outlined"
            />
          </Tooltip>
        )}

        {/* 自定义评价 - 支持多个 */}
        {hasEvaluation && finalEvaluations.map((evaluation, index) => (
          <Chip
            key={`eval-${index}`}
            label={evaluation}
            size="small"
            color="primary"
            variant="outlined"
          />
        ))}

        {/* 分类 - 支持多个 */}
        {hasCategory && finalCategories.map((cat, index) => (
          <Chip
            key={`cat-${index}`}
            label={cat}
            size="small"
            color="secondary"
            variant="outlined"
          />
        ))}

        {/* 是否看过 */}
        <Tooltip title={isViewed ? '已看过' : '未看过'}>
          <IconButton size="small" color={isViewed ? 'success' : 'default'}>
            {isViewed ? <Visibility /> : <VisibilityOff />}
          </IconButton>
        </Tooltip>

        {/* 编辑按钮 */}
        {onEdit && (
          <Tooltip title="编辑评分">
            <IconButton size="small" onClick={onEdit}>
              <Edit />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* 推荐指数 */}
      {hasRating && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            推荐指数:
          </Typography>
          <Rating
            value={rating}
            readOnly
            size="small"
            icon={<Star fontSize="inherit" />}
            emptyIcon={<StarBorder fontSize="inherit" />}
          />
          <Typography variant="body2">
            ({rating} 星)
          </Typography>
        </Box>
      )}

      {/* 自定义评价 - 支持多个 */}
      {hasEvaluation && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">
            评价:
          </Typography>
          {finalEvaluations.map((evaluation, index) => (
            <Chip
              key={`eval-${index}`}
              label={evaluation}
              size="small"
              color="primary"
              variant="outlined"
            />
          ))}
        </Box>
      )}

      {/* 分类 - 支持多个 */}
      {hasCategory && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" color="text.secondary">
            分类:
          </Typography>
          {finalCategories.map((cat, index) => (
            <Chip
              key={`cat-${index}`}
              label={cat}
              size="small"
              color="secondary"
              variant="outlined"
            />
          ))}
        </Box>
      )}

      {/* 是否看过 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          状态:
        </Typography>
        <Chip
          icon={isViewed ? <Visibility /> : <VisibilityOff />}
          label={isViewed ? '已看过' : '未看过'}
          size="small"
          color={isViewed ? 'success' : 'default'}
          variant="outlined"
        />
      </Box>

      {/* 编辑按钮 */}
      {onEdit && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <Tooltip title="编辑评分">
            <IconButton size="small" onClick={onEdit}>
              <Edit />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  )
}
