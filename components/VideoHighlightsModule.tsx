'use client'

import HighlightEditorDialog from '@/components/HighlightEditorDialog'
import HighlightMarkerControls from '@/components/HighlightMarkerControls'
import VideoHighlightsStrip from '@/components/VideoHighlightsStrip'
import { useVideoHighlights } from '@/hooks/useVideoHighlights'

interface UseVideoHighlightsModuleProps {
  currentFile: { filename: string; basename: string } | null
  mediaType: string
  viewMode: string
  fullscreen: boolean
  streamVideoTagVisible: boolean
  getCurrentTime: () => number
  onSeek: (seconds: number) => void
  onPlay?: () => Promise<void>
  onNotify: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void
  onContinuousPlaybackEnd?: () => void
  fullscreenDialogContainer?: Element | null
  inlineDialogContainer?: Element | null
}

/**
 * 将秒数格式化为 `mm:ss.SSS` 或 `hh:mm:ss.SSS`。
 * 这里保留毫秒精度，是因为精彩时刻的起止点需要比普通播放时间更细的粒度，
 * 否则在编辑片段边界时，用户会感觉“显示时间正确，但实际跳转点有偏移”。
 */
export function useVideoHighlightsModule({
  currentFile,
  mediaType,
  viewMode,
  fullscreen,
  streamVideoTagVisible,
  getCurrentTime,
  onSeek,
  onPlay,
  onNotify,
  onContinuousPlaybackEnd,
  fullscreenDialogContainer,
  inlineDialogContainer,
}: UseVideoHighlightsModuleProps) {
  const formatHighlightTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00'

    const totalMilliseconds = Math.round(seconds * 1000)
    const totalSeconds = Math.floor(totalMilliseconds / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const secs = totalSeconds % 60
    const milliseconds = totalMilliseconds % 1000

    const base = hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

    return `${base}.${String(milliseconds).padStart(3, '0')}`
  }

  const highlights = useVideoHighlights({
    currentFile,
    mediaType,
    viewMode,
    getCurrentTime,
    onNotify,
  })

  const shouldRenderHighlights = mediaType === 'stream-video'
    && (highlights.highlightsLoadedFilePath === currentFile?.filename || highlights.highlightsLoading)

  /**
   * 统一处理“点击精彩时刻后跳转播放”的流程。
   * 这里集中编排 seek、自动播放以及连续播放状态切换，
   * 避免列表组件和全屏组件各自实现一份近似逻辑。
   */
  const handleSeek = async (highlight: { id: number; startSeconds: number }) => {
    onSeek(highlight.startSeconds)
    await highlights.handleHighlightSeek(highlight, onPlay)
    if (highlights.highlightContinuousPlayEnabled) {
      highlights.startContinuousHighlightPlayback(highlight.id)
    } else {
      highlights.stopContinuousHighlightPlayback()
    }
  }

  // 返回给页面层的是“完整能力包”：
  // - inline / fullscreen 两套 UI 片段
  // - 进度条标记数据
  // - A/B 打点、选中态同步、连续播放等控制函数
  // 这样页面只负责接线，不需要了解精彩时刻内部状态细节。
  return {
    inlineStrip: shouldRenderHighlights ? (
      <VideoHighlightsStrip
        mode="inline"
        highlights={highlights.videoHighlights}
        loading={highlights.highlightsLoading}
        selectedHighlightId={highlights.selectedHighlightId}
        currentPlaybackTime={getCurrentTime()}
        onSeek={(highlight) => highlights.handleHighlightItemClick(highlight, handleSeek as any)}
        onStartLongPress={highlights.handleStripPointerDown as any}
        onMoveLongPress={highlights.handleStripPointerMove}
        onEndLongPress={highlights.handleStripPointerEnd}
        formatHighlightTime={formatHighlightTime}
      />
    ) : null,
    inlineMarkerControls: !fullscreen ? (
      <HighlightMarkerControls
        mode="inline"
        highlightStartSeconds={highlights.highlightStartSeconds}
        highlightActiveMarker={highlights.highlightActiveMarker}
        highlightControlsExpanded={highlights.highlightControlsExpanded}
        highlightCountdownActive={highlights.highlightCountdownActive}
        highlightCommitState={highlights.highlightCommitState}
        highlightPendingEndSeconds={highlights.highlightPendingEndSeconds}
        highlightCollapseAnimating={highlights.highlightCollapseAnimating}
        onMarkStart={highlights.handleMarkHighlightStart}
        onMarkEnd={highlights.handleMarkHighlightEnd}
        formatHighlightTime={formatHighlightTime}
      />
    ) : null,
    fullscreenStrip: shouldRenderHighlights ? (
      <VideoHighlightsStrip
        mode="fullscreen"
        highlights={highlights.videoHighlights}
        loading={highlights.highlightsLoading}
        selectedHighlightId={highlights.selectedHighlightId}
        currentPlaybackTime={getCurrentTime()}
        onSeek={(highlight) => highlights.handleHighlightItemClick(highlight, handleSeek as any)}
        onStartLongPress={highlights.handleStripPointerDown as any}
        onMoveLongPress={highlights.handleStripPointerMove}
        onEndLongPress={highlights.handleStripPointerEnd}
        formatHighlightTime={formatHighlightTime}
      />
    ) : null,
    fullscreenMarkerControls: (
      <HighlightMarkerControls
        mode="fullscreen"
        highlightStartSeconds={highlights.highlightStartSeconds}
        highlightActiveMarker={highlights.highlightActiveMarker}
        highlightControlsExpanded={highlights.highlightControlsExpanded}
        highlightCountdownActive={highlights.highlightCountdownActive}
        highlightCommitState={highlights.highlightCommitState}
        highlightPendingEndSeconds={highlights.highlightPendingEndSeconds}
        highlightCollapseAnimating={highlights.highlightCollapseAnimating}
        onMarkStart={highlights.handleMarkHighlightStart}
        onMarkEnd={highlights.handleMarkHighlightEnd}
        formatHighlightTime={formatHighlightTime}
      />
    ),
    editorDialog: (
      <HighlightEditorDialog
        open={highlights.highlightEditorOpen}
        onClose={highlights.closeHighlightEditor}
        editingHighlight={highlights.editingHighlight}
        title={highlights.highlightEditorTitle}
        note={highlights.highlightEditorNote}
        tags={highlights.highlightEditorTags}
        saving={highlights.highlightEditorSaving}
        setTitle={highlights.setHighlightEditorTitle}
        setNote={highlights.setHighlightEditorNote}
        setTags={highlights.setHighlightEditorTags}
        onSave={highlights.saveHighlightEditor}
        onDelete={highlights.deleteHighlight}
        formatHighlightTime={formatHighlightTime}
        container={fullscreen && mediaType === 'stream-video'
          ? fullscreenDialogContainer
          : inlineDialogContainer ?? null}
      />
    ),
    progressHighlights: highlights.videoHighlights.map((highlight) => ({
      id: highlight.id,
      startSeconds: highlight.startSeconds,
      endSeconds: highlight.endSeconds,
    })),
    selectedHighlightId: highlights.selectedHighlightId,
    highlightContinuousPlayEnabled: highlights.highlightContinuousPlayEnabled,
    highlightContinuousPlaying: highlights.highlightContinuousPlaying,
    setHighlightContinuousPlayEnabled: highlights.setHighlightContinuousPlayEnabled,
    clearSelectedHighlight: () => highlights.setSelectedHighlightId(null),
    handleMarkHighlightStart: highlights.handleMarkHighlightStart,
    handleMarkHighlightEnd: highlights.handleMarkHighlightEnd,
    handleContinuousPlaybackProgress: (currentTime: number) => highlights.handleContinuousPlaybackProgress(currentTime, onSeek, onPlay, onContinuousPlaybackEnd),
    syncSelectedHighlightByTime: highlights.syncSelectedHighlightByTime,
    stopContinuousHighlightPlayback: highlights.stopContinuousHighlightPlayback,
  }
}

export default useVideoHighlightsModule
