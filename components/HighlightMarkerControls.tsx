'use client'

import { Box, Button, Typography } from '@mui/material'

interface HighlightMarkerControlsProps {
  mode: 'inline' | 'fullscreen'
  highlightStartSeconds: number | null
  highlightActiveMarker: 'a' | 'b' | null
  highlightControlsExpanded: boolean
  highlightCountdownActive: boolean
  highlightCommitState: 'idle' | 'saving' | 'success'
  highlightPendingEndSeconds: number | null
  highlightCollapseAnimating: boolean
  onMarkStart: () => void
  onMarkEnd: () => void
  formatHighlightTime: (seconds: number) => string
}

export default function HighlightMarkerControls({
  mode,
  highlightStartSeconds,
  highlightActiveMarker,
  highlightControlsExpanded,
  highlightCountdownActive,
  highlightCommitState,
  highlightPendingEndSeconds,
  highlightCollapseAnimating,
  onMarkStart,
  onMarkEnd,
  formatHighlightTime,
}: HighlightMarkerControlsProps) {
  const markerButtonSize = 34
  const shellHeight = 40
  const collapsedShellSize = shellHeight
  const shellPaddingX = 6
  const markerGap = 8
  const timeCapsuleWidth = 74
  const rightPanelWidth = highlightStartSeconds !== null ? 146 : 58
  const expandedWidth = shellPaddingX * 2 + markerButtonSize + markerGap + rightPanelWidth
  const capsuleExpanded = highlightControlsExpanded
  const showCollapseShell = capsuleExpanded || highlightCollapseAnimating
  const showStatusCircle = !capsuleExpanded && (highlightCommitState === 'saving' || highlightCommitState === 'success')
  const isASelected = highlightStartSeconds !== null
  const isBSelected = highlightCountdownActive || highlightActiveMarker === 'b'
  const clipInsetX = (expandedWidth - collapsedShellSize) / 2
  const shellTransition = 'width 1280ms cubic-bezier(0.16, 1, 0.3, 1)'
  const shellClipPath = highlightCollapseAnimating
    ? `inset(0 ${clipInsetX}px 0 ${clipInsetX}px round ${shellHeight / 2}px)`
    : 'inset(0 0 0 0 round 999px)'

  return (
    <Box
      sx={{
        position: 'absolute',
        top: mode === 'fullscreen' ? 18 : 14,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2002,
        pointerEvents: 'auto',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          width: capsuleExpanded ? expandedWidth : collapsedShellSize,
          height: shellHeight,
          overflow: 'visible',
          color: '#fff',
          transition: shellTransition,
        }}
      >
        {showCollapseShell && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: '50%',
              width: expandedWidth,
              height: shellHeight,
              transform: 'translateX(-50%)',
              overflow: 'hidden',
              borderRadius: 999,
              pointerEvents: 'none',
              zIndex: 0,
              background: 'linear-gradient(135deg, rgba(15,23,42,0.72) 0%, rgba(30,41,59,0.46) 100%)',
              boxShadow: highlightCollapseAnimating ? 'none' : '0 18px 40px rgba(15,23,42,0.24)',
              backdropFilter: highlightCollapseAnimating ? 'none' : 'blur(18px)',
              WebkitBackdropFilter: highlightCollapseAnimating ? 'none' : 'blur(18px)',
              clipPath: shellClipPath,
              WebkitClipPath: shellClipPath,
              transition: 'clip-path 560ms cubic-bezier(0.16, 1, 0.3, 1), -webkit-clip-path 560ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 320ms ease',
            }}
          >
            <svg width="100%" height="100%" viewBox={`0 0 ${expandedWidth} ${shellHeight}`} preserveAspectRatio="none">
              <rect x="0.5" y="0.5" width={expandedWidth - 1} height={shellHeight - 1} rx={shellHeight / 2} ry={shellHeight / 2} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
              {capsuleExpanded && highlightCountdownActive && (
                <rect
                  x="0.5"
                  y="0.5"
                  width={expandedWidth - 1}
                  height={shellHeight - 1}
                  rx="20"
                  ry="20"
                  fill="none"
                  stroke="rgba(251,191,36,0.94)"
                  strokeWidth="1"
                  pathLength="100"
                  strokeDasharray="100"
                  strokeDashoffset="100"
                  strokeLinecap="round"
                  style={{ animation: 'highlightBorderProgress 3s linear forwards' }}
                />
              )}
            </svg>
          </Box>
        )}

        {capsuleExpanded && highlightCountdownActive && (
          <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${expandedWidth} ${shellHeight}`} preserveAspectRatio="none">
              <rect x="0.5" y="0.5" width={expandedWidth - 1} height={shellHeight - 1} rx="20" ry="20" fill="none" stroke="rgba(251,191,36,0.18)" strokeWidth="1" />
            </svg>
          </Box>
        )}

        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: showStatusCircle ? 'flex' : 'block',
            alignItems: showStatusCircle ? 'center' : undefined,
            justifyContent: showStatusCircle ? 'center' : undefined,
            '@keyframes highlightPulse': {
              '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(56,189,248,0.28)' },
              '50%': { transform: 'scale(1.05)', boxShadow: '0 0 0 8px rgba(56,189,248,0.06)' },
              '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(56,189,248,0)' },
            },
            '@keyframes highlightBorderProgress': {
              from: { strokeDashoffset: 100 },
              to: { strokeDashoffset: 0 },
            },
            '@keyframes highlightStatusPop': {
              '0%': { opacity: 0, transform: 'scale(0.9)' },
              '100%': { opacity: 1, transform: 'scale(1)' },
            },
            '@keyframes highlightCheckDraw': {
              '0%': { strokeDashoffset: 24 },
              '100%': { strokeDashoffset: 0 },
            },
          }}
        >
          {showStatusCircle && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                width: markerButtonSize,
                height: markerButtonSize,
                margin: 'auto',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(15,23,42,0.72) 0%, rgba(30,41,59,0.46) 100%)',
                border: '1px solid rgba(255,255,255,0.18)',
                backdropFilter: 'blur(18px)',
                WebkitBackdropFilter: 'blur(18px)',
                boxShadow: '0 18px 40px rgba(15,23,42,0.24)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: highlightCommitState === 'success' ? 18 : 15,
                fontWeight: 800,
                lineHeight: 1,
                animation: 'highlightStatusPop 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {highlightCommitState === 'success' ? (
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M3.75 9.4L7.2 12.85L14.35 5.7" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pathLength="24" strokeDasharray="24" strokeDashoffset="24" style={{ animation: 'highlightCheckDraw 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards' }} />
                </svg>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: '3px' }}>
                  {[0, 1, 2].map((dot) => (
                    <Box key={dot} sx={{ width: 3.5, height: 3.5, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.92)', flexShrink: 0 }} />
                  ))}
                </Box>
              )}
            </Box>
          )}

          <Button
            size="small"
            variant="outlined"
            onClick={onMarkStart}
            disabled={highlightCommitState === 'saving' || highlightCommitState === 'success'}
            sx={{
              position: 'absolute',
              left: capsuleExpanded ? shellPaddingX : (collapsedShellSize - markerButtonSize) / 2,
              top: (shellHeight - markerButtonSize) / 2,
              minWidth: 0,
              width: markerButtonSize,
              height: markerButtonSize,
              p: 0,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              borderColor: isASelected ? 'rgba(125,211,252,0.95)' : 'rgba(255,255,255,0.18)',
              background: !capsuleExpanded && !showStatusCircle
                ? 'linear-gradient(135deg, rgba(15,23,42,0.62) 0%, rgba(30,41,59,0.38) 100%)'
                : isASelected
                  ? 'rgba(14,165,233,0.92)'
                  : 'rgba(255,255,255,0.04)',
              backdropFilter: !capsuleExpanded && !showStatusCircle ? 'blur(18px)' : 'none',
              WebkitBackdropFilter: !capsuleExpanded && !showStatusCircle ? 'blur(18px)' : 'none',
              fontWeight: 800,
              fontSize: 15,
              lineHeight: 1,
              opacity: capsuleExpanded ? 1 : showStatusCircle ? 0 : 0.07,
              boxShadow: isASelected ? '0 10px 24px rgba(14,165,233,0.34)' : 'none',
              animation: isASelected ? 'highlightPulse 1.45s ease-in-out infinite' : 'none',
              transition: 'opacity 220ms ease, background-color 220ms ease, border-color 220ms ease, box-shadow 220ms ease',
              '&:hover': {
                opacity: capsuleExpanded ? 1 : 0.2,
                borderColor: isASelected ? 'rgba(125,211,252,1)' : 'rgba(255,255,255,0.42)',
                backgroundColor: isASelected ? 'rgba(14,165,233,1)' : 'rgba(255,255,255,0.12)',
              },
              '&.Mui-disabled': {
                opacity: capsuleExpanded ? 0.4 : 0.07,
                color: 'rgba(255,255,255,0.42)',
                borderColor: 'rgba(255,255,255,0.10)',
                backgroundColor: 'rgba(255,255,255,0.04)',
              },
            }}
          >
            <Box component="span" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', textAlign: 'center', fontSize: 15, fontWeight: 800, lineHeight: `${markerButtonSize}px` }}>
              A
            </Box>
          </Button>

          <Box
            sx={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              minWidth: timeCapsuleWidth,
              maxWidth: timeCapsuleWidth,
              px: 0.9,
              py: 0.45,
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.10)',
              textAlign: 'center',
              zIndex: 1,
              pointerEvents: 'none',
              opacity: capsuleExpanded ? 1 : 0,
              transition: 'opacity 340ms ease',
            }}
          >
            <Typography sx={{ fontSize: 10, lineHeight: 1, opacity: 0.62, letterSpacing: 0.7 }}>
              {highlightCountdownActive ? 'CANCEL' : 'START'}
            </Typography>
            <Typography sx={{ fontSize: 11, lineHeight: 1.35, fontWeight: 700 }}>
              {highlightCountdownActive && highlightPendingEndSeconds !== null
                ? formatHighlightTime(highlightPendingEndSeconds)
                : highlightStartSeconds !== null
                  ? formatHighlightTime(highlightStartSeconds)
                  : '--:--.---'}
            </Typography>
          </Box>

          <Box
            sx={{
              position: 'absolute',
              left: shellPaddingX + markerButtonSize + markerGap,
              right: shellPaddingX,
              top: 0,
              height: shellHeight,
              opacity: capsuleExpanded ? 1 : 0,
              transform: capsuleExpanded ? 'translateX(0)' : 'translateX(-10px)',
              transition: 'opacity 340ms ease, transform 1280ms cubic-bezier(0.16, 1, 0.3, 1)',
              pointerEvents: capsuleExpanded ? 'auto' : 'none',
            }}
          >
            <Button
              size="small"
              variant="outlined"
              onClick={onMarkEnd}
              disabled={highlightStartSeconds === null}
              sx={{
                position: 'absolute',
                right: 0,
                top: (shellHeight - markerButtonSize) / 2,
                zIndex: 2,
                minWidth: 0,
                width: markerButtonSize,
                height: markerButtonSize,
                p: 0,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 15,
                lineHeight: 1,
                color: '#f8fafc',
                borderColor: isBSelected ? 'rgba(253,186,116,0.95)' : 'rgba(255,255,255,0.22)',
                background: isBSelected
                  ? 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)'
                  : 'rgba(255,255,255,0.06)',
                boxShadow: isBSelected ? '0 10px 24px rgba(249,115,22,0.35)' : 'none',
                '&:hover': {
                  background: highlightStartSeconds === null
                    ? 'rgba(255,255,255,0.06)'
                    : isBSelected
                      ? 'linear-gradient(135deg, #fbbf24 0%, #f97316 100%)'
                      : 'rgba(255,255,255,0.14)',
                  borderColor: isBSelected ? 'rgba(253,186,116,1)' : 'rgba(255,255,255,0.44)',
                },
                '&.Mui-disabled': {
                  color: 'rgba(255,255,255,0.34)',
                  borderColor: 'rgba(255,255,255,0.10)',
                  background: 'rgba(255,255,255,0.04)',
                  boxShadow: 'none',
                },
              }}
            >
              <Box component="span" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', textAlign: 'center', fontSize: 15, fontWeight: 800, lineHeight: `${markerButtonSize}px` }}>
                B
              </Box>
            </Button>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
