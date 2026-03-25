'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography
} from '@mui/material'

interface Creator {
  id: number
  primaryName: string
  otherNames?: string[]
}

interface CreatorMergeDialogProps {
  open: boolean
  sourceCreator: Creator | null
  onClose: () => void
  onSuccess?: () => void
  container?: Element | null
}

export default function CreatorMergeDialog({
  open,
  sourceCreator,
  onClose,
  onSuccess,
  container
}: CreatorMergeDialogProps) {
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<Creator[]>([])
  const [selectedTarget, setSelectedTarget] = useState<Creator | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [searchInputValue, setSearchInputValue] = useState('')
  const justSelectedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      setSearchResults([])
      setSelectedTarget(null)
      setSubmitting(false)
      setError('')
      setSearchInputValue('')
    }
  }, [open])

  useEffect(() => {
    if (!open || !searchInputValue.trim()) {
      setSearchResults([])
      return
    }

    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }

    const timer = window.setTimeout(async () => {
      setSearchLoading(true)
      try {
        const response = await fetch(`/api/creators/search?q=${encodeURIComponent(searchInputValue.trim())}`)
        const data = await response.json()
        if (!data.success) {
          throw new Error(data.error || '搜索博主失败')
        }

        const results = Array.isArray(data.data) ? data.data : []
        setSearchResults(results.filter((creator: Creator) => creator.id !== sourceCreator?.id))
      } catch (err: any) {
        setError(err.message || '搜索博主失败')
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)

    return () => window.clearTimeout(timer)
  }, [open, searchInputValue, sourceCreator?.id])

  const mergedAliasPreview = useMemo(() => {
    if (!sourceCreator || !selectedTarget) {
      return []
    }

    return Array.from(
      new Set(
        [
          selectedTarget.primaryName,
          ...(selectedTarget.otherNames || []),
          sourceCreator.primaryName,
          ...(sourceCreator.otherNames || [])
        ].filter(Boolean)
      )
    )
  }, [selectedTarget, sourceCreator])

  const handleMerge = async () => {
    if (!sourceCreator) {
      setError('当前待合并博主不存在')
      return
    }

    if (!selectedTarget) {
      setError('请选择真正要保留的主博主')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/creators/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetId: selectedTarget.id,
          sourceIds: [sourceCreator.id]
        })
      })

      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || '博主合并失败')
      }

      onClose()
      onSuccess?.()
    } catch (err: any) {
      setError(err.message || '博主合并失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSelectSearchResult = (creator: Creator) => {
    justSelectedRef.current = true
    setSelectedTarget(creator)
    setSearchInputValue(creator.primaryName)
    setSearchResults([])
    setError('')
  }

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      keepMounted
      container={container || undefined}
      slotProps={{
        backdrop: {
          sx: { zIndex: 2199 }
        }
      }}
      PaperProps={{
        sx: { zIndex: 2200 }
      }}
      sx={{
        zIndex: 2200,
        '& .MuiDialog-container': {
          zIndex: 2200
        }
      }}
    >
      <DialogTitle>合并到主博主</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <Alert severity="warning">
            适合“当前博主其实是别名博主”的场景。处理顺序是：先把当前博主的关联数据迁到主博主，再把当前名称加入主博主别名，最后删除当前博主记录。
          </Alert>

          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              当前待合并博主
            </Typography>
            <Typography variant="h6">{sourceCreator?.primaryName || '-'}</Typography>
          </Box>

          <Box sx={{ position: 'relative' }}>
            <TextField
              label="主博主"
              fullWidth
              value={searchInputValue}
              onChange={(e) => {
                setSearchInputValue(e.target.value)
                setSelectedTarget(null)
              }}
              placeholder="搜索真正要保留的主博主，例如 A"
              InputProps={{
                endAdornment: searchLoading ? <CircularProgress size={18} /> : null
              }}
              autoComplete="off"
            />

            {searchInputValue.trim() && searchResults.length > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 9999,
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  boxShadow: 3,
                  maxHeight: 300,
                  overflowY: 'auto',
                  mb: 0.5
                }}
              >
                {searchResults.map((creator) => (
                  <Box
                    key={creator.id}
                    onClick={() => handleSelectSearchResult(creator)}
                    sx={{
                      px: 2,
                      py: 1.5,
                      cursor: 'pointer',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 'none' },
                      '&:hover': { bgcolor: 'action.hover' }
                    }}
                  >
                    <Typography variant="body1" fontWeight={500}>
                      {creator.primaryName}
                    </Typography>
                    {creator.otherNames?.length ? (
                      <Typography variant="caption" color="text.secondary" display="block">
                        别名: {creator.otherNames.join(', ')}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          {selectedTarget ? (
            <Stack spacing={1.5}>
              <Typography variant="body2">
                合并后，{sourceCreator?.primaryName} 当前关联的所有媒体和图组都会迁移到 {selectedTarget.primaryName}，
                路径中包含 {sourceCreator?.primaryName} 的内容之后也会优先识别为 {selectedTarget.primaryName}。
              </Typography>

              <Box>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  合并后保留在主博主上的别名
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {mergedAliasPreview.map((name) => (
                    <Chip key={name} label={name} size="small" variant="outlined" />
                  ))}
                </Box>
              </Box>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          取消
        </Button>
        <Button
          onClick={handleMerge}
          variant="contained"
          color="warning"
          disabled={submitting || !selectedTarget}
        >
          {submitting ? '合并中...' : '确认合并'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
