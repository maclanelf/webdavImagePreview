'use client'

import { type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'

import {
  Box,
  Button,
  CardContent,
  Chip,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { OpenInNew as OpenInNewIcon } from '@mui/icons-material'

import QuickRating from '@/components/QuickRating'
import RatingStatus from '@/components/RatingStatus'
import type { GroupRating, MediaRating } from '@/types'

interface ExternalPlayerMenuProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  onOpen: (event: ReactMouseEvent<HTMLElement>) => void
  onPlaySystem?: () => void
  onPlayPotPlayer: () => void
  onPlayVlc: () => void
  emphasized?: boolean
}

interface MediaInfoFooterProps {
  basename: string
  filename: string
  size: number
  lastmod: string
  currentRating: MediaRating | GroupRating | null
  onQuickRate: (rating: number, evaluation: string) => Promise<void> | void
  quickRateDisabled: boolean
  onEditRating: () => void
  titleAccessory?: ReactNode
  metadataAccessory?: ReactNode
  extraContent?: ReactNode
  formatFileSize?: (bytes: number) => string
  externalPlayerMenu?: ExternalPlayerMenuProps
}

const defaultFormatFileSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`

/**
 * 模式页共享底部信息区。
 *
 * 随机 / 图组 / 大视频三个模式的底部区域本质上都包含：
 * - 文件名与路径
 * - 大小与时间等元信息
 * - 快捷评分
 * - 当前评分状态
 * - 外部播放器入口
 *
 * 差异项通过 accessory / extraContent / externalPlayerMenu 等插槽注入，
 * 避免每个模式页各自维护一大段近似 JSX。
 */
export default function MediaInfoFooter({
  basename,
  filename,
  size,
  lastmod,
  currentRating,
  onQuickRate,
  quickRateDisabled,
  onEditRating,
  titleAccessory,
  metadataAccessory,
  extraContent,
  formatFileSize = defaultFormatFileSize,
  externalPlayerMenu,
}: MediaInfoFooterProps) {
  return (
    <CardContent sx={{ py: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Typography
          variant="body1"
          fontWeight="medium"
          sx={{
            flex: 1,
            wordBreak: 'break-all',
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
            whiteSpace: 'normal',
            minWidth: 0,
          }}
        >
          {basename}
        </Typography>
        {titleAccessory}
      </Box>

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          mt: 0.5,
          wordBreak: 'break-all',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          whiteSpace: 'normal',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {filename}
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 0.5, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {formatFileSize(size)}
        </Typography>
        {metadataAccessory}
        <Typography variant="caption" color="text.secondary">
          {new Date(lastmod).toLocaleString('zh-CN')}
        </Typography>
      </Box>

      <Box sx={{ mt: 1, mb: 1 }}>
        <QuickRating currentRating={currentRating?.rating} onQuickRate={onQuickRate} disabled={quickRateDisabled} />
      </Box>

      <Box sx={{ mt: 1 }}>
        <RatingStatus
          rating={currentRating?.rating}
          customEvaluation={currentRating?.customEvaluation}
          category={currentRating?.category}
          isViewed={currentRating?.isViewed}
          onEdit={onEditRating}
          compact
        />
      </Box>

      {extraContent}

      {externalPlayerMenu && (
        <Box sx={{ mt: 1.5 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<OpenInNewIcon />}
            onClick={externalPlayerMenu.onOpen}
            sx={externalPlayerMenu.emphasized
              ? {
                  color: '#4ade80',
                  borderColor: '#4ade80',
                  width: '100%',
                  '&:hover': {
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(74, 222, 128, 0.1)',
                  },
                }
              : { width: '100%' }}
          >
            外部播放
          </Button>

          <Menu
            anchorEl={externalPlayerMenu.anchorEl}
            open={externalPlayerMenu.open}
            onClose={externalPlayerMenu.onClose}
            anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
            transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            {externalPlayerMenu.onPlaySystem && (
              <MenuItem onClick={externalPlayerMenu.onPlaySystem}>
                <ListItemIcon>
                  <OpenInNewIcon fontSize="small" sx={{ color: '#22c55e' }} />
                </ListItemIcon>
                <ListItemText>系统默认</ListItemText>
              </MenuItem>
            )}
            <MenuItem onClick={externalPlayerMenu.onPlayPotPlayer}>
              <ListItemIcon>
                <OpenInNewIcon fontSize="small" sx={{ color: '#f59e0b' }} />
              </ListItemIcon>
              <ListItemText>PotPlayer</ListItemText>
            </MenuItem>
            <MenuItem onClick={externalPlayerMenu.onPlayVlc}>
              <ListItemIcon>
                <OpenInNewIcon fontSize="small" sx={{ color: '#f97316' }} />
              </ListItemIcon>
              <ListItemText>VLC</ListItemText>
            </MenuItem>
          </Menu>
        </Box>
      )}
    </CardContent>
  )
}
