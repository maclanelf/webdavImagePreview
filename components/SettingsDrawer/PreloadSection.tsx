import { Box, Typography, Button, Stack, Paper, Slider } from '@mui/material'
import { Speed as SpeedIcon, Download as DownloadIcon, Refresh as RefreshIcon } from '@mui/icons-material'

interface PreloadSectionProps {
  preloadEnabled: boolean
  onPreloadEnabledChange: (enabled: boolean) => void
  optimisticUpdateEnabled: boolean
  onOptimisticUpdateEnabledChange: (enabled: boolean) => void
  erudaEnabled: boolean
  onErudaEnabledChange: (enabled: boolean) => void
  preloadRandomness: number
  onPreloadRandomnessChange: (value: number) => void
  preloadStatus: { cacheSize: number; maxCacheSize: number } | null
  onClearCache: () => void
  onResetButtonPositions: () => void
}

export default function PreloadSection({
  preloadEnabled,
  onPreloadEnabledChange,
  optimisticUpdateEnabled,
  onOptimisticUpdateEnabledChange,
  erudaEnabled,
  onErudaEnabledChange,
  preloadRandomness,
  onPreloadRandomnessChange,
  preloadStatus,
  onClearCache,
  onResetButtonPositions,
}: PreloadSectionProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <SpeedIcon color="primary" />
        <Typography variant="subtitle1" fontWeight="medium">
          预加载设置
        </Typography>
      </Box>

      <Stack spacing={2}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="body2">启用预加载</Typography>
          <Button
            size="small"
            variant={preloadEnabled ? 'contained' : 'outlined'}
            onClick={() => onPreloadEnabledChange(!preloadEnabled)}
          >
            {preloadEnabled ? '已启用' : '已禁用'}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="body2">乐观更新</Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              评分立即显示，后台保存
            </Typography>
          </Box>
          <Button
            size="small"
            variant={optimisticUpdateEnabled ? 'contained' : 'outlined'}
            color="primary"
            onClick={() => onOptimisticUpdateEnabledChange(!optimisticUpdateEnabled)}
          >
            {optimisticUpdateEnabled ? '已启用' : '已禁用'}
          </Button>
        </Box>

        {/* Eruda 调试工具开关 */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="body2">移动端调试</Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              Eruda 调试工具（需刷新生效）
            </Typography>
          </Box>
          <Button
            size="small"
            variant={erudaEnabled ? 'contained' : 'outlined'}
            color="primary"
            onClick={() => onErudaEnabledChange(!erudaEnabled)}
          >
            {erudaEnabled ? '已启用' : '已禁用'}
          </Button>
        </Box>

        {/* 智能预加载随机性设置 */}
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="body2">预加载随机性</Typography>
            <Typography variant="caption" color="text.secondary">
              {preloadRandomness === 0
                ? '优先当前目录'
                : preloadRandomness === 1
                ? '完全随机'
                : `${Math.round(preloadRandomness * 100)}%随机`}
            </Typography>
          </Box>
          <Slider
            value={preloadRandomness}
            onChange={(_, newValue) => {
              const value = Array.isArray(newValue) ? newValue[0] : newValue
              onPreloadRandomnessChange(value)
            }}
            min={0}
            max={1}
            step={0.01}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => `${Math.round(value * 100)}%`}
            sx={{ mt: 1 }}
          />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            值越小出现同一个人的概率越大，值越大出现同一个人概率越小
          </Typography>
        </Box>

        {preloadStatus && (
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" display="block">
              缓存状态
            </Typography>
            <Typography variant="body2" fontWeight="medium">
              {preloadStatus.cacheSize} / {preloadStatus.maxCacheSize} 个文件
            </Typography>
          </Paper>
        )}

        <Button
          variant="outlined"
          size="small"
          fullWidth
          onClick={onClearCache}
          startIcon={<DownloadIcon />}
        >
          清理缓存
        </Button>

        <Button
          variant="outlined"
          size="small"
          fullWidth
          onClick={onResetButtonPositions}
          startIcon={<RefreshIcon />}
          color="warning"
        >
          复位按钮位置
        </Button>
      </Stack>
    </Box>
  )
}
