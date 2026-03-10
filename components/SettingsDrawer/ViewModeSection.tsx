import { Box, Typography, ToggleButtonGroup, ToggleButton, Paper } from '@mui/material'
import {
  Shuffle as ShuffleIcon,
  Collections as CollectionsIcon,
  VideoLibrary as VideoIcon,
} from '@mui/icons-material'
import type { ViewMode, MediaFile } from '@/types'

interface ViewModeSectionProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  currentGroup: MediaFile[]
  currentGroupIndex: number
  currentFile: MediaFile | null
}

export default function ViewModeSection({
  viewMode,
  onViewModeChange,
  currentGroup,
  currentGroupIndex,
  currentFile,
}: ViewModeSectionProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <CollectionsIcon color="primary" />
        <Typography variant="subtitle1" fontWeight="medium">
          浏览模式
        </Typography>
      </Box>

      <ToggleButtonGroup
        value={viewMode}
        exclusive
        onChange={(e, newMode) => {
          if (newMode) {
            onViewModeChange(newMode)
          }
        }}
        orientation="vertical"
        fullWidth
      >
        <ToggleButton value="random">
          <ShuffleIcon sx={{ mr: 1 }} />
          随机模式
        </ToggleButton>
        <ToggleButton value="gallery">
          <CollectionsIcon sx={{ mr: 1 }} />
          图组模式
        </ToggleButton>
        <ToggleButton value="large-video">
          <VideoIcon sx={{ mr: 1 }} />
          大视频模式
        </ToggleButton>
      </ToggleButtonGroup>

      {viewMode === 'gallery' && currentGroup.length > 0 && (
        <Paper variant="outlined" sx={{ mt: 2, p: 1.5 }}>
          <Typography variant="caption" color="text.secondary" display="block">
            当前图组
          </Typography>
          <Typography variant="body2" fontWeight="medium">
            {currentGroupIndex + 1} / {currentGroup.length} 张
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              wordBreak: 'break-all',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              whiteSpace: 'normal',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {currentFile?.filename.substring(0, currentFile.filename.lastIndexOf('/'))}
          </Typography>
        </Paper>
      )}

      {viewMode === 'large-video' && (
        <Paper variant="outlined" sx={{ mt: 2, p: 1.5, backgroundColor: 'info.light' }}>
          <Typography variant="caption" color="info.contrastText" display="block" fontWeight="bold">
            💡 大视频模式
          </Typography>
          <Typography variant="caption" color="info.contrastText" display="block" sx={{ mt: 0.5 }}>
            • 即点即播，无需预加载
          </Typography>
          <Typography variant="caption" color="info.contrastText" display="block">
            • 支持大文件流式播放
          </Typography>
          <Typography variant="caption" color="info.contrastText" display="block">
            • 受已看过/未看过筛选影响
          </Typography>
          <Typography variant="caption" color="info.contrastText" display="block">
            • 随机性参数控制同目录优先级
          </Typography>
        </Paper>
      )}
    </Box>
  )
}
