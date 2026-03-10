import { Box, Typography, Button, Stack } from '@mui/material'
import {
  Star as StarIcon,
  Collections as CollectionsIcon,
  RateReview as RateReviewIcon,
} from '@mui/icons-material'
import type { ViewMode, MediaFile } from '@/types'

const QUICK_RATING_CONFIG = [
  { rating: 1, evaluation: '丑死了' },
  { rating: 2, evaluation: '一般' },
  { rating: 3, evaluation: '还行' },
  { rating: 4, evaluation: '非常爽' },
  { rating: 5, evaluation: '爽死了' },
] as const

interface RatingSectionProps {
  viewMode: ViewMode
  currentFile: MediaFile | null
  currentGroup: MediaFile[]
  onOpenRatingDialog: (type: 'media' | 'group') => void
}

export default function RatingSection({
  viewMode,
  currentFile,
  currentGroup,
  onOpenRatingDialog,
}: RatingSectionProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <RateReviewIcon color="primary" />
        <Typography variant="subtitle1" fontWeight="medium">
          评分管理
        </Typography>
      </Box>

      <Stack spacing={1}>
        <Button
          variant="outlined"
          startIcon={<StarIcon />}
          onClick={() => onOpenRatingDialog('media')}
          disabled={!currentFile}
          fullWidth
          size="small"
        >
          详细评分
        </Button>

        {viewMode === 'gallery' && (
          <Button
            variant="outlined"
            startIcon={<CollectionsIcon />}
            onClick={() => onOpenRatingDialog('group')}
            disabled={currentGroup.length === 0}
            fullWidth
            size="small"
          >
            评分当前图组
          </Button>
        )}
      </Stack>

      {/* 快捷键说明 */}
      <Box sx={{ mt: 2, p: 1.5, backgroundColor: 'grey.50', borderRadius: 1 }}>
        <Typography variant="caption" color="text.secondary" display="block" gutterBottom fontWeight="bold">
          快捷键：
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {QUICK_RATING_CONFIG.slice(0, 3)
            .map((config) => `${config.rating}键: ${config.rating}星-${config.evaluation}`)
            .join(' | ')}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {QUICK_RATING_CONFIG.slice(3)
            .map((config) => `${config.rating}键: ${config.rating}星-${config.evaluation}`)
            .join(' | ')}
        </Typography>
        <Typography variant="caption" color="primary.main" display="block" sx={{ mt: 1, fontWeight: 'medium' }}>
          R键: 打开详细评分对话框
        </Typography>
        <Typography variant="caption" color="secondary.main" display="block" sx={{ fontWeight: 'medium' }}>
          G键: 图组评分 (仅图组模式)
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          自动标记：图片0.5秒，视频播放80%或结束时
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          （视频超时兜底：3分钟）
        </Typography>
      </Box>
    </Box>
  )
}
