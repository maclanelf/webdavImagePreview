'use client'

import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import {
  RateReview as RateReviewIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
} from '@mui/icons-material'

import DraggableBox from '@/components/DraggableBox'
import { QUICK_RATING_CONFIG } from '@/types'
import type { GroupRating, MediaRating } from '@/types'

interface FullscreenRatingDockProps {
  storageKey: string
  currentRating: MediaRating | GroupRating | null
  onQuickRate: (rating: number, evaluation: string) => Promise<void> | void
  onOpenDetail: () => void
  loading: boolean
  isSwitching: boolean
  detailDisabled: boolean
  preloadCurrent?: number | null
  zIndex?: number
  variant?: 'basic' | 'enhanced'
  defaultPosition?: {
    right: number
    bottom: number
  }
}

/**
 * 全屏评分侧栏共享组件。
 *
 * 随机 / 图组 / 大视频三个模式都存在一套高度相似的评分侧栏：
 * - 上方显示预加载或上下文数字
 * - 中部五颗星快捷评分
 * - 底部详细评分按钮
 *
 * 差异主要体现在样式强度和挂载层级，因此这里保留 `variant` 与 `zIndex`
 * 等配置项，让不同模式在复用骨架的同时保留自己的视觉语义。
 */
export default function FullscreenRatingDock({
  storageKey,
  currentRating,
  onQuickRate,
  onOpenDetail,
  loading,
  isSwitching,
  detailDisabled,
  preloadCurrent,
  zIndex = 2001,
  variant = 'basic',
  defaultPosition = { right: 10, bottom: 151 },
}: FullscreenRatingDockProps) {
  const isEnhanced = variant === 'enhanced'

  return (
    <DraggableBox
      storageKey={storageKey}
      defaultSx={{
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(8px)',
        px: 1,
        py: 1.5,
        borderRadius: 1.5,
        zIndex,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        opacity: 0.5,
        '&:hover': {
          opacity: 1,
        },
      }}
      sx={({ position }: { position: { x: number; y: number } | null }) => ({
        ...(!position && defaultPosition),
      })}
    >
      {typeof preloadCurrent === 'number' && (
        <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '10px', mb: 0.5 }}>
          {preloadCurrent}
        </Typography>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        {QUICK_RATING_CONFIG.map((ratingConfig) => {
          const isLit = Boolean(currentRating?.rating && currentRating.rating >= ratingConfig.rating)

          return (
            <Tooltip key={ratingConfig.rating} title={`${ratingConfig.rating}星 - ${ratingConfig.evaluation}`} placement="right">
              <IconButton
                size="small"
                onClick={() => void onQuickRate(ratingConfig.rating, ratingConfig.evaluation)}
                disabled={loading || isSwitching}
                sx={isEnhanced
                  ? {
                      color: isLit ? 'warning.main' : 'rgba(255, 255, 255, 0.7)',
                      transition: 'all 0.2s',
                      padding: '4px',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        color: 'warning.main',
                        transform: 'scale(1.1)',
                      },
                    }
                  : {
                      color: isLit ? 'warning.main' : 'rgba(255, 255, 255, 0.7)',
                    }}
              >
                {isLit ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )
        })}
      </Box>

      <Tooltip title="详细评分 (R)" placement="right">
        <IconButton
          size="small"
          onClick={onOpenDetail}
          disabled={detailDisabled}
          sx={isEnhanced
            ? {
                color: 'rgba(255, 255, 255, 0.7)',
                mt: 0.5,
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  color: 'primary.main',
                },
                transition: 'all 0.2s ease-in-out',
                p: 0.5,
              }
            : {
                color: 'rgba(255, 255, 255, 0.7)',
                mt: 0.5,
              }}
        >
          <RateReviewIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </DraggableBox>
  )
}
