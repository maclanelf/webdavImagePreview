'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import type { VideoHighlightItem } from '@/hooks/useVideoHighlights'

interface HighlightEditorDialogProps {
  open: boolean
  onClose: () => void
  editingHighlight: VideoHighlightItem | null
  title: string
  note: string
  tags: string
  saving: boolean
  setTitle: (value: string) => void
  setNote: (value: string) => void
  setTags: (value: string) => void
  onSave: () => void
  onDelete: () => void
  formatHighlightTime: (seconds: number) => string
  container?: Element | null
}

export default function HighlightEditorDialog({
  open,
  onClose,
  editingHighlight,
  title,
  note,
  tags,
  saving,
  setTitle,
  setNote,
  setTags,
  onSave,
  onDelete,
  formatHighlightTime,
  container,
}: HighlightEditorDialogProps) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  useEffect(() => {
    if (!open || !editingHighlight) {
      setDeleteConfirmOpen(false)
    }
  }, [editingHighlight, open])

  const handleRequestDelete = () => {
    if (!saving && editingHighlight) {
      setDeleteConfirmOpen(true)
    }
  }

  const handleCloseDeleteConfirm = () => {
    if (!saving) {
      setDeleteConfirmOpen(false)
    }
  }

  const handleConfirmDelete = () => {
    setDeleteConfirmOpen(false)
    onDelete()
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        container={container}
        sx={{ zIndex: 2600 }}
      >
        <DialogTitle>编辑精彩时刻</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Box>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>标题</Typography>
              <Box
                component="input"
                value={title}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                placeholder="例如：开场高能 / 反转 / 决胜段"
                sx={{
                  width: '100%',
                  border: '1px solid rgba(148,163,184,0.28)',
                  borderRadius: 2,
                  px: 1.5,
                  py: 1.1,
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </Box>

            <Box>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>备注</Typography>
              <Box
                component="textarea"
                value={note}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value)}
                placeholder="记录这个片段为什么精彩，后续会更容易回看。"
                sx={{
                  width: '100%',
                  minHeight: 96,
                  border: '1px solid rgba(148,163,184,0.28)',
                  borderRadius: 2,
                  px: 1.5,
                  py: 1.1,
                  fontSize: 14,
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
            </Box>

            <Box>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>标签</Typography>
              <Box
                component="input"
                value={tags}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setTags(e.target.value)}
                placeholder="例如：反转, 高潮, 名场面"
                sx={{
                  width: '100%',
                  border: '1px solid rgba(148,163,184,0.28)',
                  borderRadius: 2,
                  px: 1.5,
                  py: 1.1,
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </Box>

            {editingHighlight && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  flexWrap: 'wrap',
                  p: 1.25,
                  borderRadius: 2,
                  backgroundColor: 'rgba(15,23,42,0.03)',
                }}
              >
                <Chip size="small" label={`开始 ${formatHighlightTime(editingHighlight.startSeconds)}`} />
                <Chip size="small" label={`结束 ${formatHighlightTime(editingHighlight.endSeconds)}`} />
                <Chip size="small" label={`时长 ${Math.max(1, Math.round(editingHighlight.durationSeconds))}s`} />
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRequestDelete} color="error" disabled={saving || !editingHighlight} sx={{ mr: 'auto' }}>
            {saving ? '处理中…' : '删除'}
          </Button>
          <Button onClick={onClose} color="inherit" disabled={saving}>
            取消
          </Button>
          <Button onClick={onSave} variant="contained" disabled={saving || !editingHighlight}>
            {saving ? '保存中…' : '保存修改'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteConfirmOpen}
        onClose={handleCloseDeleteConfirm}
        maxWidth="xs"
        fullWidth
        container={container}
        sx={{ zIndex: 2700 }}
      >
        <DialogTitle>确认删除</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: 'text.primary', lineHeight: 1.7 }}>
            确定要删除这个精彩时刻吗？删除后将无法恢复。
          </Typography>
          {editingHighlight && (
            <Typography sx={{ mt: 1.25, fontSize: 12, color: 'text.secondary' }}>
              {formatHighlightTime(editingHighlight.startSeconds)} - {formatHighlightTime(editingHighlight.endSeconds)}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDeleteConfirm} color="inherit" disabled={saving}>
            取消
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" disabled={saving || !editingHighlight}>
            确认删除
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
