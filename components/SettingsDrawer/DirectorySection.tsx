import { Box, Typography, List, ListItem, ListItemIcon, ListItemText, Chip, Button } from '@mui/material'
import { Folder as FolderIcon, Refresh as RefreshIcon } from '@mui/icons-material'
import type { WebDAVConfig } from '@/types'

interface DirectorySectionProps {
  config: WebDAVConfig
  loading: boolean
  isSwitching?: boolean
  onNavigateToManage: () => void
}

export default function DirectorySection({ config, loading, isSwitching = false, onNavigateToManage }: DirectorySectionProps) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <FolderIcon color="primary" />
        <Typography variant="subtitle1" fontWeight="medium">
          已挂载目录
        </Typography>
        <Chip label={config.mediaPaths.length} size="small" color="primary" />
      </Box>

      <List dense>
        {config.mediaPaths.map((path, index) => (
          <ListItem key={index} sx={{ px: 0 }}>
            <ListItemIcon sx={{ minWidth: 36 }}>
              <FolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={path}
              primaryTypographyProps={{
                variant: 'body2',
                noWrap: true,
              }}
            />
          </ListItem>
        ))}
      </List>

      {/* 重新扫描按钮 - 跳转到管理页面 */}
      <Box sx={{ mt: 2 }}>
        <Button
          variant="outlined"
          size="small"
          fullWidth
          onClick={onNavigateToManage}
          disabled={loading || isSwitching}
          startIcon={<RefreshIcon />}
        >
          前往管理页面扫描
        </Button>
      </Box>
    </Box>
  )
}
