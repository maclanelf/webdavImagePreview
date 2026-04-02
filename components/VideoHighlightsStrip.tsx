'use client'

import { Box, Button, Typography } from '@mui/material'
import type { VideoHighlightItem } from '@/hooks/useVideoHighlights'

interface VideoHighlightsStripProps {
  mode: 'inline' | 'fullscreen'
  highlights: VideoHighlightItem[]
  loading: boolean
  selectedHighlightId: number | null
  currentPlaybackTime: number
  onSeek: (highlight: VideoHighlightItem) => void
  onStartLongPress: (highlight: VideoHighlightItem, clientX: number, clientY: number) => void
  onMoveLongPress: (clientX: number, clientY: number) => void
  onEndLongPress: () => void
  formatHighlightTime: (seconds: number) => string
}

export default function VideoHighlightsStrip({
  mode,
  highlights,
  loading,
  selectedHighlightId,
  currentPlaybackTime,
  onSeek,
  onStartLongPress,
  onMoveLongPress,
  onEndLongPress,
  formatHighlightTime,
}: VideoHighlightsStripProps) {
  const isFullscreenMode = mode === 'fullscreen'
  const sortedHighlights = [...highlights].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.startSeconds - b.startSeconds
  })

  if (isFullscreenMode) {
    return (
      <Box sx={{ width: '100%' }}>
        <Box
          sx={{
            width: '100%',
            overflowX: 'auto',
            overflowY: 'hidden',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
            '&::-webkit-scrollbar': {
              display: 'none',
            },
          }}
        >
          {!sortedHighlights.length && !loading ? (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 'max-content', px: 0.5 }}>
              <Box
                sx={{
                  px: 1.4,
                  py: 1,
                  borderRadius: '14px',
                  background: 'linear-gradient(135deg, rgba(34,34,38,0.98) 0%, rgba(22,22,28,0.98) 100%)',
                  color: 'rgba(255,255,255,0.92)',
                  boxShadow: '0 8px 18px rgba(0,0,0,0.22)',
                }}
              >
                <Typography sx={{ fontSize: 12, fontWeight: 700, lineHeight: 1 }}>
                  还没有精彩时刻
                </Typography>
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 'max-content', px: 0.5 }}>
              {sortedHighlights.map((highlight, index) => {
                const isActive = currentPlaybackTime >= highlight.startSeconds && currentPlaybackTime <= highlight.endSeconds
                const isSelected = selectedHighlightId === highlight.id
                const hasCustomTitle = Boolean(highlight.title?.trim())
                const label = hasCustomTitle ? highlight.title!.trim() : `片段 ${index + 1}`

                return (
                  <Button
                    key={highlight.id}
                    onClick={() => onSeek(highlight)}
                    onMouseDown={(event) => onStartLongPress(highlight, event.clientX, event.clientY)}
                    onMouseMove={(event) => onMoveLongPress(event.clientX, event.clientY)}
                    onMouseUp={onEndLongPress}
                    onMouseLeave={onEndLongPress}
                    onTouchStart={(event) => {
                      const touch = event.touches[0]
                      if (touch) {
                        ;(onStartLongPress as any)(highlight, touch.clientX, touch.clientY)
                      }
                    }}
                    onTouchMove={(event) => {
                      const touch = event.touches[0]
                      if (touch) {
                        onMoveLongPress(touch.clientX, touch.clientY)
                      }
                    }}
                    onTouchEnd={onEndLongPress}
                    onTouchCancel={onEndLongPress}
                    sx={{
                      minWidth: hasCustomTitle ? 138 : 92,
                      maxWidth: hasCustomTitle ? 236 : 116,
                      height: 34,
                      px: hasCustomTitle ? 1.28 : 1.08,
                      borderRadius: '10px',
                      textTransform: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      gap: 0.75,
                      flexShrink: 0,
                      width: 'auto',
                      backgroundColor: isSelected
                        ? 'rgba(37,99,235,0.18)'
                        : isActive
                          ? 'rgba(255,255,255,0.12)'
                          : 'rgba(15,23,42,0.28)',
                      color: '#fff',
                      boxShadow: isSelected
                        ? '0 8px 20px rgba(37,99,235,0.22)'
                        : '0 6px 16px rgba(0,0,0,0.16)',
                      border: isSelected ? '1px solid rgba(96,165,250,0.95)' : '1px solid rgba(255,255,255,0.22)',
                      backdropFilter: 'blur(6px)',
                      WebkitBackdropFilter: 'blur(6px)',
                      '&:hover': {
                        backgroundColor: isSelected
                          ? 'rgba(37,99,235,0.22)'
                          : 'rgba(255,255,255,0.14)',
                        boxShadow: isSelected
                          ? '0 10px 24px rgba(37,99,235,0.26)'
                          : '0 8px 18px rgba(0,0,0,0.2)',
                        borderColor: isSelected ? 'rgba(125,211,252,1)' : 'rgba(255,255,255,0.34)',
                      },
                      '@keyframes highlightAudioBar1': {
                        '0%, 100%': { transform: 'scaleY(0.42)' },
                        '50%': { transform: 'scaleY(1)' },
                      },
                      '@keyframes highlightAudioBar2': {
                        '0%, 100%': { transform: 'scaleY(0.75)' },
                        '50%': { transform: 'scaleY(0.32)' },
                      },
                      '@keyframes highlightAudioBar3': {
                        '0%, 100%': { transform: 'scaleY(0.55)' },
                        '50%': { transform: 'scaleY(0.95)' },
                      },
                    }}
                  >
                    {isSelected && (
                      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 12, flexShrink: 0 }}>
                        <Box sx={{ width: 2, height: 10, borderRadius: 999, backgroundColor: '#7dd3fc', transformOrigin: 'center bottom', animation: 'highlightAudioBar1 0.9s ease-in-out infinite' }} />
                        <Box sx={{ width: 2, height: 10, borderRadius: 999, backgroundColor: '#93c5fd', transformOrigin: 'center bottom', animation: 'highlightAudioBar2 0.78s ease-in-out infinite' }} />
                        <Box sx={{ width: 2, height: 10, borderRadius: 999, backgroundColor: '#c4b5fd', transformOrigin: 'center bottom', animation: 'highlightAudioBar3 1.02s ease-in-out infinite' }} />
                      </Box>
                    )}
                    <Typography sx={{ fontSize: 10, lineHeight: 1, fontWeight: 800, color: isSelected ? '#93c5fd' : 'rgba(255,255,255,0.88)', flexShrink: 0 }}>
                      {formatHighlightTime(highlight.startSeconds)}
                    </Typography>
                     <Typography sx={{ fontSize: 11.5, lineHeight: 1, fontWeight: isSelected ? 900 : 700, color: '#fff', maxWidth: hasCustomTitle ? 136 : 64, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', minWidth: 0, flexShrink: 1 }}>
                       {label}
                     </Typography>
                  </Button>
                )
              })}
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2, width: '100%' }}>
      <Box
        sx={{
          position: 'relative',
          px: 0,
          py: 0,
          backgroundColor: 'transparent',
          border: 'none',
          boxShadow: 'none',
          overflowX: 'auto',
          overflowY: 'visible',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': {
            display: 'none',
          },
        }}
      >
        {!sortedHighlights.length && !loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, minHeight: 56, px: 0.8 }}>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                还没有精彩时刻
              </Typography>
              <Typography sx={{ mt: 0.2, fontSize: 11, color: '#64748b' }}>
                用 A 标开始、B 标结束，系统会自动保存这一段。
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 1, width: 'max-content', minWidth: '100%', pr: 0.2 }}>
            {sortedHighlights.map((highlight, index) => {
              const isActive = currentPlaybackTime >= highlight.startSeconds && currentPlaybackTime <= highlight.endSeconds
              const label = highlight.title?.trim() || `片段 ${index + 1}`

              return (
                <Button
                  key={highlight.id}
                  onClick={() => onSeek(highlight)}
                  onMouseDown={(event) => onStartLongPress(highlight, event.clientX, event.clientY)}
                  onMouseMove={(event) => onMoveLongPress(event.clientX, event.clientY)}
                  onMouseUp={onEndLongPress}
                  onMouseLeave={onEndLongPress}
                  onTouchStart={(event) => {
                    const touch = event.touches[0]
                    if (touch) {
                      ;(onStartLongPress as any)(highlight, touch.clientX, touch.clientY)
                    }
                  }}
                  onTouchMove={(event) => {
                    const touch = event.touches[0]
                    if (touch) {
                      onMoveLongPress(touch.clientX, touch.clientY)
                    }
                  }}
                  onTouchEnd={onEndLongPress}
                  onTouchCancel={onEndLongPress}
                  sx={{
                    minWidth: 0,
                    px: 1.05,
                    py: 0.8,
                    borderRadius: 2.5,
                    textTransform: 'none',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 0.35,
                    border: 'none',
                    backgroundColor: isActive ? 'rgba(56,189,248,0.06)' : 'transparent',
                    boxShadow: isActive ? 'inset 0 0 0 1px rgba(56,189,248,0.42)' : 'inset 0 0 0 1px rgba(148,163,184,0.10)',
                    transition: 'all 180ms ease',
                    '&:hover': {
                      boxShadow: isActive ? 'inset 0 0 0 1px rgba(56,189,248,0.58)' : 'inset 0 0 0 1px rgba(148,163,184,0.18)',
                      backgroundColor: isActive ? 'rgba(56,189,248,0.10)' : 'rgba(255,255,255,0.04)',
                    },
                    '&:active': {
                      transform: 'none',
                    },
                    '&.Mui-focusVisible': {
                      transform: 'none',
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, width: '100%' }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 800, lineHeight: 1, color: isActive ? '#38bdf8' : '#64748b' }}>
                      {formatHighlightTime(highlight.startSeconds)}
                    </Typography>
                    <Box sx={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: isActive ? '#38bdf8' : 'rgba(100,116,139,0.35)', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: 10.5, lineHeight: 1, color: '#94a3b8' }}>
                      {Math.max(1, Math.round(highlight.durationSeconds))}s
                    </Typography>
                  </Box>

                  <Typography sx={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2, color: '#0f172a', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {label}
                  </Typography>

                  <Typography sx={{ fontSize: 10.5, lineHeight: 1, color: '#64748b' }}>
                    {formatHighlightTime(highlight.endSeconds)} 截止
                  </Typography>
                </Button>
              )
            })}
          </Box>
        )}
      </Box>
    </Box>
  )
}
