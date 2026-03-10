import { Box, Typography, Stack, Paper } from '@mui/material'
import {
  BarChart as BarChartIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
  PhotoLibrary as PhotoLibraryIcon,
} from '@mui/icons-material'

interface StatsSectionProps {
  stats: { total: number; images: number; videos: number; viewed: number }
}

export default function StatsSection({ stats }: StatsSectionProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <BarChartIcon color="primary" />
        <Typography variant="subtitle1" fontWeight="medium">
          文件统计
        </Typography>
      </Box>

      <Stack spacing={2}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ImageIcon color="primary" sx={{ fontSize: 32 }} />
            <Box>
              <Typography variant="h6">{stats.images}</Typography>
              <Typography variant="body2" color="text.secondary">
                图片
              </Typography>
            </Box>
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <VideoIcon color="secondary" sx={{ fontSize: 32 }} />
            <Box>
              <Typography variant="h6">{stats.videos}</Typography>
              <Typography variant="body2" color="text.secondary">
                视频
              </Typography>
            </Box>
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <PhotoLibraryIcon sx={{ fontSize: 32 }} />
            <Box>
              <Typography variant="h6">{stats.total}</Typography>
              <Typography variant="body2" color="text.secondary">
                总计
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Stack>
    </Box>
  )
}
