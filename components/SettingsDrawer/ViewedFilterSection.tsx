import { Box, Typography, ToggleButtonGroup, ToggleButton, Button } from '@mui/material'
import {
  Star as StarIcon,
  PhotoLibrary as PhotoLibraryIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import type { ViewedFilter } from '@/types'

interface ViewedFilterSectionProps {
  viewedFilter: ViewedFilter
  onViewedFilterChange: (filter: ViewedFilter) => void
  stats: { total: number; images: number; videos: number; viewed: number }
  localViewedCount: number
  onRestartViewedMode: () => void
}

export default function ViewedFilterSection({
  viewedFilter,
  onViewedFilterChange,
  stats,
  localViewedCount,
  onRestartViewedMode,
}: ViewedFilterSectionProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <StarIcon color="primary" />
        <Typography variant="subtitle1" fontWeight="medium">
          已看过状态
        </Typography>
      </Box>

      <ToggleButtonGroup
        value={viewedFilter}
        exclusive
        onChange={(e, newValue) => {
          if (newValue) {
            onViewedFilterChange(newValue)
          }
        }}
        orientation="vertical"
        fullWidth
      >
        <ToggleButton value="unviewed">
          <StarIcon sx={{ mr: 1 }} />
          未看过 ({stats.total - stats.viewed})
        </ToggleButton>
        <ToggleButton value="viewed">
          <StarIcon sx={{ mr: 1, color: 'gold' }} />
          已看过 ({stats.viewed})
        </ToggleButton>
        <ToggleButton value="all">
          <PhotoLibraryIcon sx={{ mr: 1 }} />
          全部 ({stats.total})
        </ToggleButton>
      </ToggleButtonGroup>

      {/* 已看过模式下的重新观看按钮 */}
      {viewedFilter === 'viewed' && (
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            size="small"
            fullWidth
            onClick={onRestartViewedMode}
            startIcon={<RefreshIcon />}
            sx={{
              backgroundColor: 'warning.light',
              color: 'warning.contrastText',
              '&:hover': {
                backgroundColor: 'warning.main',
              },
            }}
          >
            重新观看已看过的文件
          </Button>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, textAlign: 'center' }}>
            已本地观看: {localViewedCount} / {stats.viewed}
          </Typography>
        </Box>
      )}
    </Box>
  )
}
