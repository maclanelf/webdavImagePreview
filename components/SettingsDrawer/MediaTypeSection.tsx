import { Box, Typography, ToggleButtonGroup, ToggleButton } from '@mui/material'
import {
  FilterList as FilterListIcon,
  PhotoLibrary as PhotoLibraryIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
} from '@mui/icons-material'
import type { MediaFilter } from '@/types'

interface MediaTypeSectionProps {
  mediaFilter: MediaFilter
  onMediaFilterChange: (filter: MediaFilter) => void
  stats: { total: number; images: number; videos: number; viewed: number }
}

export default function MediaTypeSection({ mediaFilter, onMediaFilterChange, stats }: MediaTypeSectionProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <FilterListIcon color="primary" />
        <Typography variant="subtitle1" fontWeight="medium">
          媒体类型
        </Typography>
      </Box>

      <ToggleButtonGroup
        value={mediaFilter}
        exclusive
        onChange={(e, newValue) => {
          if (newValue) {
            onMediaFilterChange(newValue)
          }
        }}
        orientation="vertical"
        fullWidth
      >
        <ToggleButton value="all">
          <PhotoLibraryIcon sx={{ mr: 1 }} />
          全部 ({stats.total})
        </ToggleButton>
        <ToggleButton value="images">
          <ImageIcon sx={{ mr: 1 }} />
          仅图片 ({stats.images})
        </ToggleButton>
        <ToggleButton value="videos">
          <VideoIcon sx={{ mr: 1 }} />
          仅视频 ({stats.videos})
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  )
}
