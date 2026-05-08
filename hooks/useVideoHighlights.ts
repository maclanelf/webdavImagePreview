'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface VideoHighlightItem {
  id: number
  filePath: string
  fileName: string
  startSeconds: number
  endSeconds: number
  durationSeconds: number
  title?: string
  note?: string
  tags: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

interface UseVideoHighlightsOptions {
  currentFile: {
    filename: string
    basename: string
  } | null
  mediaType: string
  viewMode: string
  getCurrentTime: () => number
  onNotify: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void
}

export function useVideoHighlights({
  currentFile,
  mediaType,
  viewMode,
  getCurrentTime,
  onNotify,
}: UseVideoHighlightsOptions) {
  // A 点：用户第一次打点时记录的开始时间，是整段精彩时刻草稿的起点锚点。
  const [highlightStartSeconds, setHighlightStartSeconds] = useState<number | null>(null)
  // 当前激活的是哪个标记按钮：
  // - 'a' 表示已经记录起点，等待用户确认终点
  // - 'b' 表示已经记录终点并进入倒计时确认阶段
  const [highlightActiveMarker, setHighlightActiveMarker] = useState<'a' | 'b' | null>(null)
  // 控制 A/B 打点控件是否展开。该状态与“是否已有草稿”不完全等价，
  // 因为在收起动画期间，UI 仍需保持可见。
  const [highlightControlsExpanded, setHighlightControlsExpanded] = useState(false)
  // 当用户点击 B 点后，会进入一个短暂确认窗口；该状态用于驱动倒计时 UI。
  const [highlightCountdownActive, setHighlightCountdownActive] = useState(false)
  // 片段提交状态：idle=空闲，saving=写入中，success=写入成功并展示成功态。
  const [highlightCommitState, setHighlightCommitState] = useState<'idle' | 'saving' | 'success'>('idle')
  // 倒计时确认阶段暂存的结束时间；只有真正提交时才会成为最终片段边界。
  const [highlightPendingEndSeconds, setHighlightPendingEndSeconds] = useState<number | null>(null)
  // 保存时配合收起动画使用，避免控件在过渡阶段突然闪烁消失。
  const [highlightCollapseAnimating, setHighlightCollapseAnimating] = useState(false)
  // 当前视频对应的精彩时刻列表。
  const [videoHighlights, setVideoHighlights] = useState<VideoHighlightItem[]>([])
  const [highlightsLoading, setHighlightsLoading] = useState(false)
  const orderedHighlights = useMemo(() => {
    return [...videoHighlights].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.startSeconds - b.startSeconds
    })
  }, [videoHighlights])
  // 记录当前列表对应的是哪个文件，避免旧文件片段误显示到新文件上。
  const [highlightsLoadedFilePath, setHighlightsLoadedFilePath] = useState<string | null>(null)
  // 当前被选中的精彩时刻，用于列表高亮和进度条标记强调显示。
  const [selectedHighlightId, setSelectedHighlightId] = useState<number | null>(null)
  const [highlightEditorOpen, setHighlightEditorOpen] = useState(false)
  const [editingHighlight, setEditingHighlight] = useState<VideoHighlightItem | null>(null)
  const [highlightEditorTitle, setHighlightEditorTitle] = useState('')
  const [highlightEditorNote, setHighlightEditorNote] = useState('')
  const [highlightEditorTags, setHighlightEditorTags] = useState('')
  const [highlightEditorSaving, setHighlightEditorSaving] = useState(false)
  // 用户是否开启“连续播放精彩时刻”的偏好开关。
  const [highlightContinuousPlayEnabled, setHighlightContinuousPlayEnabled] = useState(true)
  // 当前是否正在执行连续播放流程。
  const [highlightContinuousPlaying, setHighlightContinuousPlaying] = useState(false)
  // 连播时当前播放到的片段索引；使用索引便于直接推进到下一段。
  const [highlightContinuousIndex, setHighlightContinuousIndex] = useState<number | null>(null)
  // 记录长按条状片段时的初始触点，用于区分“长按编辑”和“滑动浏览”。
  const touchInteractionRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null)
  // 长按成功后，需要吞掉紧随其后的那一次 click，避免“打开编辑弹窗”和“跳转播放”同时发生。
  const suppressHighlightClickRef = useRef(false)

  // 点击 B 点后延迟真正提交，给用户一个撤销窗口。
  const highlightFinalizeTimerRef = useRef<NodeJS.Timeout | null>(null)
  // 保存成功后短暂停留 success 状态，再自动重置草稿。
  const highlightSuccessTimerRef = useRef<NodeJS.Timeout | null>(null)
  // 控件收起动画定时器，确保动画结束后再清理过渡状态。
  const highlightCollapseTimerRef = useRef<NodeJS.Timeout | null>(null)
  // 长按检测定时器，到时后打开片段编辑弹窗。
  const highlightLongPressTimerRef = useRef<NodeJS.Timeout | null>(null)
  // 连播自动推进锁，防止 timeupdate 高频触发导致同一片段重复跳转。
  const highlightAutoAdvanceLockRef = useRef<number | null>(null)
  // 记录当前草稿所属文件，避免倒计时确认期间切换视频后把片段错误写入新上下文。
  const highlightDraftFilePathRef = useRef<string | null>(null)
  // 高光列表加载请求序号；只允许最后一次请求回写状态，避免切换视频时旧响应串屏。
  const highlightsRequestIdRef = useRef(0)

  /**
   * 清理当前正在编辑/提交中的精彩时刻草稿。
   * 不仅重置 React state，也会一并取消相关定时器，
   * 以避免切换文件、保存失败或组件卸载后仍有旧回调回写 UI。
   */
  const resetHighlightDraft = useCallback(() => {
    if (highlightFinalizeTimerRef.current) {
      clearTimeout(highlightFinalizeTimerRef.current)
      highlightFinalizeTimerRef.current = null
    }
    if (highlightSuccessTimerRef.current) {
      clearTimeout(highlightSuccessTimerRef.current)
      highlightSuccessTimerRef.current = null
    }
    if (highlightCollapseTimerRef.current) {
      clearTimeout(highlightCollapseTimerRef.current)
      highlightCollapseTimerRef.current = null
    }
    setHighlightStartSeconds(null)
    highlightDraftFilePathRef.current = null
    setHighlightActiveMarker(null)
    setHighlightControlsExpanded(false)
    setHighlightCountdownActive(false)
    setHighlightCommitState('idle')
    setHighlightPendingEndSeconds(null)
    setHighlightCollapseAnimating(false)
  }, [])

  /**
   * 停止当前这一轮精彩时刻连续播放。
   * 这里只结束实际播放流程，不会修改用户是否启用连播的偏好开关。
   */
  const stopContinuousHighlightPlayback = useCallback(() => {
    setHighlightContinuousPlaying(false)
    setHighlightContinuousIndex(null)
    highlightAutoAdvanceLockRef.current = null
  }, [])

  /**
   * 从指定精彩时刻启动连续播放。
   * 用户点击任意片段时，都可以把它当作本轮序列的起点，而不是强制从第一段开始。
   */
  const startContinuousHighlightPlayback = useCallback((highlightId: number) => {
    const index = orderedHighlights.findIndex((item) => item.id === highlightId)
    if (index < 0) return

    setSelectedHighlightId(highlightId)
    setHighlightContinuousPlaying(true)
    setHighlightContinuousIndex(index)
    highlightAutoAdvanceLockRef.current = null
  }, [orderedHighlights])

  /**
   * 拉取当前视频对应的精彩时刻列表。
   * 每次都按 filePath 精确加载，确保不会混入上一条视频的数据。
   */
  const loadVideoHighlights = useCallback(async (filePath: string) => {
    const requestId = ++highlightsRequestIdRef.current

    try {
      setHighlightsLoading(true)
      const response = await fetch(`/api/highlights?filePath=${encodeURIComponent(filePath)}`)
      const json = await response.json()

      if (requestId !== highlightsRequestIdRef.current) {
        return
      }

      if (!response.ok) {
        throw new Error(json.error || '获取精彩片段失败')
      }

      const highlights = Array.isArray(json.highlights) ? json.highlights : []
      setVideoHighlights(highlights)
      setHighlightsLoadedFilePath(filePath)
    } catch (error: any) {
      if (requestId !== highlightsRequestIdRef.current) {
        return
      }

      console.error('加载精彩片段失败:', error)
      setVideoHighlights([])
      setHighlightsLoadedFilePath(null)
      onNotify(error?.message || '加载精彩片段失败', 'error')
    } finally {
      if (requestId === highlightsRequestIdRef.current) {
        setHighlightsLoading(false)
      }
    }
  }, [onNotify])

  /**
   * 保存一个新的精彩时刻区间。
   * 这里只负责接口调用和结果封装；真正的倒计时确认与 UI 状态推进由上层交互函数管理。
   */
  const saveHighlightRange = useCallback(async (startSeconds: number, endSeconds: number) => {
    if (!currentFile) {
      return { success: false as const, id: null as number | null }
    }

    if (endSeconds <= startSeconds) {
      onNotify('结束时间必须大于开始时间', 'warning')
      return { success: false as const, id: null as number | null }
    }

    try {
      const response = await fetch('/api/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: currentFile.filename,
          fileName: currentFile.basename,
          startSeconds,
          endSeconds,
        }),
      })
      const json = await response.json()

      if (!response.ok) {
        throw new Error(json.error || '保存精彩片段失败')
      }

      return {
        success: true as const,
        id: typeof json.id === 'number' ? json.id : Number(json.id) || null,
      }
    } catch (error: any) {
      console.error('保存精彩片段失败:', error)
      onNotify(error.message || '保存精彩片段失败', 'error')
      return { success: false as const, id: null as number | null }
    }
  }, [currentFile, onNotify])

  /**
   * A 点打标逻辑：
   * - 第一次点击：记录当前播放时间为起点
   * - 再次点击 A：取消当前草稿
   * 同时在 saving / success 阶段禁用重复点击，避免 UI 状态与提交结果错位。
   */
  const handleMarkHighlightStart = useCallback(() => {
    if (highlightCommitState === 'saving' || highlightCommitState === 'success') return

    if (highlightStartSeconds !== null && highlightActiveMarker === 'a') {
      resetHighlightDraft()
      return
    }

    const currentTime = getCurrentTime()
    highlightDraftFilePathRef.current = currentFile?.filename ?? null
    setHighlightControlsExpanded(true)
    setHighlightStartSeconds(currentTime)
    setHighlightActiveMarker('a')
  }, [currentFile?.filename, getCurrentTime, highlightActiveMarker, highlightCommitState, highlightStartSeconds, resetHighlightDraft])

  /**
   * B 点打标逻辑：
   * 1. 必须先有 A 点才能形成区间；
   * 2. 第一次点 B 先进入倒计时确认；
   * 3. 倒计时结束后才真正提交到后端；
   * 4. 成功则刷新列表，失败则恢复为可继续编辑的草稿状态。
   */
  const handleMarkHighlightEnd = useCallback(async () => {
    if (highlightStartSeconds === null) {
      onNotify('请先点击 A 标记开始时间', 'warning')
      return
    }

    if (highlightCommitState === 'saving' || highlightCommitState === 'success') return

    if (highlightCountdownActive) {
      if (highlightFinalizeTimerRef.current) {
        clearTimeout(highlightFinalizeTimerRef.current)
        highlightFinalizeTimerRef.current = null
      }
      setHighlightCountdownActive(false)
      setHighlightPendingEndSeconds(null)
      setHighlightActiveMarker('a')
      return
    }

    const currentTime = getCurrentTime()
    setHighlightPendingEndSeconds(currentTime)
    setHighlightCountdownActive(true)
    setHighlightActiveMarker('b')

    if (highlightFinalizeTimerRef.current) {
      clearTimeout(highlightFinalizeTimerRef.current)
    }

    highlightFinalizeTimerRef.current = setTimeout(async () => {
      highlightFinalizeTimerRef.current = null

      const draftFilePath = highlightDraftFilePathRef.current
      const activeFilePath = currentFile?.filename ?? null
      if (!draftFilePath || !activeFilePath || draftFilePath !== activeFilePath) {
        resetHighlightDraft()
        return
      }

      setHighlightCountdownActive(false)
      setHighlightCollapseAnimating(true)
      setHighlightControlsExpanded(false)
      setHighlightCommitState('saving')

      if (highlightCollapseTimerRef.current) {
        clearTimeout(highlightCollapseTimerRef.current)
      }
      highlightCollapseTimerRef.current = setTimeout(() => {
        highlightCollapseTimerRef.current = null
        setHighlightCollapseAnimating(false)
      }, 560)

      const result = await saveHighlightRange(highlightStartSeconds, currentTime)

      if (result.success) {
        if (currentFile?.filename) {
          await loadVideoHighlights(currentFile.filename)
        }
        setHighlightCommitState('success')
        highlightSuccessTimerRef.current = setTimeout(() => {
          highlightSuccessTimerRef.current = null
          resetHighlightDraft()
        }, 1200)
        return
      }

      setHighlightCommitState('idle')
      setHighlightControlsExpanded(true)
      setHighlightActiveMarker('a')
      setHighlightPendingEndSeconds(null)
    }, 3000)
  }, [currentFile?.filename, getCurrentTime, highlightCommitState, highlightCountdownActive, highlightStartSeconds, loadVideoHighlights, onNotify, resetHighlightDraft, saveHighlightRange])

  // 跳转到某个精彩时刻后，同步维护选中态，并在需要时尝试继续播放。
  const handleHighlightSeek = useCallback(async (highlight: { id: number; startSeconds: number }, play?: () => Promise<void>) => {
    setSelectedHighlightId(highlight.id)
    if (play) {
      try {
        await play()
      } catch (error) {
        console.warn('跳转精彩时刻后自动播放失败:', error)
      }
    }
  }, [])

  const handleContinuousPlaybackProgress = useCallback(async (
    currentTime: number,
    seekTo: (seconds: number) => void,
    play?: () => Promise<void>,
    onSequenceEnd?: () => void,
  ) => {
    if (!highlightContinuousPlayEnabled || !highlightContinuousPlaying) return
    if (highlightContinuousIndex === null) return

    const currentHighlight = orderedHighlights[highlightContinuousIndex]
    if (!currentHighlight) {
      stopContinuousHighlightPlayback()
      return
    }

    if (currentTime + 0.05 < currentHighlight.endSeconds) {
      if (highlightAutoAdvanceLockRef.current === currentHighlight.id) {
        highlightAutoAdvanceLockRef.current = null
      }
      return
    }

    if (highlightAutoAdvanceLockRef.current === currentHighlight.id) {
      return
    }
    highlightAutoAdvanceLockRef.current = currentHighlight.id

    const nextIndex = highlightContinuousIndex + 1
    const nextHighlight = orderedHighlights[nextIndex]

    if (!nextHighlight) {
      stopContinuousHighlightPlayback()
      onSequenceEnd?.()
      return
    }

    setSelectedHighlightId(nextHighlight.id)
    setHighlightContinuousIndex(nextIndex)
    seekTo(nextHighlight.startSeconds)

    if (play) {
      try {
        await play()
      } catch (error) {
        console.warn('连续播放精彩时刻时自动播放下一段失败:', error)
      }
    }

    // 延迟一小段时间释放自动推进锁，避免播放器 timeupdate 在边界附近重复触发下一段切换。
    window.setTimeout(() => {
      if (highlightAutoAdvanceLockRef.current === currentHighlight.id) {
        highlightAutoAdvanceLockRef.current = null
      }
    }, 250)
  }, [highlightContinuousIndex, highlightContinuousPlayEnabled, highlightContinuousPlaying, orderedHighlights, stopContinuousHighlightPlayback])

  const syncSelectedHighlightByTime = useCallback((currentTime: number) => {
    const matchedHighlight = videoHighlights.find((highlight) => {
      return currentTime >= highlight.startSeconds && currentTime <= highlight.endSeconds
    })

    setSelectedHighlightId((prev) => {
      const nextId = matchedHighlight?.id ?? null
      return prev === nextId ? prev : nextId
    })
  }, [videoHighlights])

  /**
   * 打开编辑弹窗，并把片段标题/备注/标签拆到独立输入状态中。
   * 这样编辑过程不会直接污染列表里的原始数据，只有保存成功后才整体刷新。
   */
  const openHighlightEditor = useCallback((highlight: VideoHighlightItem) => {
    setEditingHighlight(highlight)
    setHighlightEditorTitle(highlight.title || '')
    setHighlightEditorNote(highlight.note || '')
    setHighlightEditorTags((highlight.tags || []).join(', '))
    setHighlightEditorOpen(true)
  }, [])

  // 关闭编辑弹窗；保存过程中禁止关闭，避免用户误判请求是否已完成。
  const closeHighlightEditor = useCallback(() => {
    if (highlightEditorSaving) return
    setHighlightEditorOpen(false)
    setEditingHighlight(null)
    setHighlightEditorTitle('')
    setHighlightEditorNote('')
    setHighlightEditorTags('')
  }, [highlightEditorSaving])

  // 长按计时器统一清理函数，避免在多个事件回调里重复写 clearTimeout。
  const clearHighlightLongPress = useCallback(() => {
    if (highlightLongPressTimerRef.current) {
      clearTimeout(highlightLongPressTimerRef.current)
      highlightLongPressTimerRef.current = null
    }
  }, [])

  // 直接启动长按编辑入口，便于其它交互场景复用；当前条状列表主要走 pointer 版流程。
  const startHighlightLongPress = useCallback((highlight: VideoHighlightItem) => {
    clearHighlightLongPress()
    highlightLongPressTimerRef.current = setTimeout(() => {
      highlightLongPressTimerRef.current = null
      suppressHighlightClickRef.current = true
      openHighlightEditor(highlight)
    }, 520)
  }, [clearHighlightLongPress, openHighlightEditor])

  const handleHighlightItemClick = useCallback((highlight: { id: number; startSeconds: number }, onSeek: (highlight: { id: number; startSeconds: number }) => void) => {
    if (suppressHighlightClickRef.current) {
      suppressHighlightClickRef.current = false
      return
    }

    onSeek(highlight)
  }, [])

  /**
   * 保存编辑弹窗中的元信息。
   * 当前实现只更新标题/备注/标签等附加信息，继续沿用原片段的起止时间与排序值。
   */
  const saveHighlightEditor = useCallback(async () => {
    if (!editingHighlight) return

    try {
      setHighlightEditorSaving(true)
      const tags = highlightEditorTags.split(',').map((item) => item.trim()).filter(Boolean)

      const response = await fetch('/api/highlights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingHighlight.id,
          startSeconds: editingHighlight.startSeconds,
          endSeconds: editingHighlight.endSeconds,
          title: highlightEditorTitle.trim() || undefined,
          note: highlightEditorNote.trim() || undefined,
          tags,
          sortOrder: editingHighlight.sortOrder,
        }),
      })

      const json = await response.json()
      if (!response.ok) {
        throw new Error(json.error || '更新精彩时刻失败')
      }

      if (currentFile?.filename) {
        await loadVideoHighlights(currentFile.filename)
      }

      onNotify('精彩时刻已更新', 'success')
      setHighlightEditorOpen(false)
      setEditingHighlight(null)
    } catch (error: any) {
      console.error('更新精彩时刻失败:', error)
      onNotify(error.message || '更新精彩时刻失败', 'error')
    } finally {
      setHighlightEditorSaving(false)
    }
  }, [currentFile?.filename, editingHighlight, highlightEditorNote, highlightEditorTags, highlightEditorTitle, loadVideoHighlights, onNotify])

  /**
   * 删除当前正在编辑的精彩时刻。
   * 如果删掉的是当前高亮中的片段，还需要顺便清理选中态，避免 UI 指向不存在的 id。
   */
  const deleteHighlight = useCallback(async () => {
    if (!editingHighlight) return

    try {
      setHighlightEditorSaving(true)
      const response = await fetch(`/api/highlights?id=${editingHighlight.id}`, {
        method: 'DELETE',
      })

      const json = await response.json()
      if (!response.ok) {
        throw new Error(json.error || '删除精彩时刻失败')
      }

      if (currentFile?.filename) {
        await loadVideoHighlights(currentFile.filename)
      }

      // 删除后片段数组会重排；这里按“旧序列位置”推导出删除后的新索引，
      // 让连续播放尽量无缝继续，而不是简单粗暴地整轮中断。
      if (highlightContinuousPlaying && highlightContinuousIndex !== null) {
        const deletedIndex = orderedHighlights.findIndex((item) => item.id === editingHighlight.id)

        if (deletedIndex >= 0) {
          const nextLength = orderedHighlights.length - 1

          if (nextLength <= 0) {
            stopContinuousHighlightPlayback()
          } else if (deletedIndex < highlightContinuousIndex) {
            setHighlightContinuousIndex(highlightContinuousIndex - 1)
          } else if (deletedIndex === highlightContinuousIndex) {
            const fallbackIndex = Math.min(highlightContinuousIndex, nextLength - 1)
            setHighlightContinuousIndex(fallbackIndex)
            setSelectedHighlightId(orderedHighlights[fallbackIndex + (deletedIndex < nextLength ? 1 : 0)]?.id ?? null)
          }
        }
      }

      if (selectedHighlightId === editingHighlight.id && (!highlightContinuousPlaying || highlightContinuousIndex === null)) {
        setSelectedHighlightId(null)
      }

      onNotify('精彩时刻已删除', 'success')
      closeHighlightEditor()
    } catch (error: any) {
      console.error('删除精彩时刻失败:', error)
      onNotify(error.message || '删除精彩时刻失败', 'error')
    } finally {
      setHighlightEditorSaving(false)
    }
  }, [closeHighlightEditor, currentFile?.filename, editingHighlight, highlightContinuousIndex, highlightContinuousPlaying, loadVideoHighlights, onNotify, orderedHighlights, selectedHighlightId, stopContinuousHighlightPlayback])

  // 指针按下时启动“长按编辑”检测，并记录起始坐标，用于后续判断是否发生滑动。
  const handleStripPointerDown = useCallback((highlight: VideoHighlightItem, clientX: number, clientY: number) => {
    touchInteractionRef.current = { startX: clientX, startY: clientY, moved: false }
    clearHighlightLongPress()
    highlightLongPressTimerRef.current = setTimeout(() => {
      const interaction = touchInteractionRef.current
      if (interaction?.moved) {
        return
      }
      highlightLongPressTimerRef.current = null
      suppressHighlightClickRef.current = true
      openHighlightEditor(highlight)
    }, 520)
  }, [clearHighlightLongPress, openHighlightEditor])

  // 当触点移动超过阈值后，说明用户是在拖动/滑动，不应再触发长按编辑。
  const handleStripPointerMove = useCallback((clientX: number, clientY: number) => {
    const interaction = touchInteractionRef.current
    if (!interaction) return

    const deltaX = Math.abs(clientX - interaction.startX)
    const deltaY = Math.abs(clientY - interaction.startY)
    if (deltaX > 8 || deltaY > 8) {
      interaction.moved = true
      clearHighlightLongPress()
    }
  }, [clearHighlightLongPress])

  // 指针抬起时统一结束这一轮长按检测流程。
  const handleStripPointerEnd = useCallback(() => {
    touchInteractionRef.current = null
    clearHighlightLongPress()
  }, [clearHighlightLongPress])

  useEffect(() => {
    resetHighlightDraft()
    stopContinuousHighlightPlayback()
    highlightsRequestIdRef.current += 1
  }, [currentFile?.filename, mediaType, resetHighlightDraft, stopContinuousHighlightPlayback])

  useEffect(() => {
    if (viewMode === 'large-video' && mediaType === 'stream-video' && currentFile?.filename) {
      loadVideoHighlights(currentFile.filename)
      return
    }

    setVideoHighlights([])
    setHighlightsLoadedFilePath(null)
    setHighlightsLoading(false)
  }, [currentFile?.filename, loadVideoHighlights, mediaType, viewMode])

  useEffect(() => {
    setSelectedHighlightId(null)
    stopContinuousHighlightPlayback()
  }, [currentFile?.filename, stopContinuousHighlightPlayback])

  useEffect(() => {
    return () => {
      if (highlightFinalizeTimerRef.current) clearTimeout(highlightFinalizeTimerRef.current)
      if (highlightSuccessTimerRef.current) clearTimeout(highlightSuccessTimerRef.current)
      if (highlightCollapseTimerRef.current) clearTimeout(highlightCollapseTimerRef.current)
      if (highlightLongPressTimerRef.current) clearTimeout(highlightLongPressTimerRef.current)
      touchInteractionRef.current = null
    }
  }, [])

  return {
    highlightStartSeconds,
    highlightActiveMarker,
    highlightControlsExpanded,
    highlightCountdownActive,
    highlightCommitState,
    highlightPendingEndSeconds,
    highlightCollapseAnimating,
    videoHighlights,
    highlightsLoading,
    highlightsLoadedFilePath,
    selectedHighlightId,
    highlightEditorOpen,
    editingHighlight,
    highlightEditorTitle,
    highlightEditorNote,
    highlightEditorTags,
    highlightEditorSaving,
    highlightContinuousPlayEnabled,
    highlightContinuousPlaying,
    highlightContinuousIndex,
    setHighlightEditorTitle,
    setHighlightEditorNote,
    setHighlightEditorTags,
    setHighlightContinuousPlayEnabled,
    resetHighlightDraft,
    loadVideoHighlights,
    handleMarkHighlightStart,
    handleMarkHighlightEnd,
    handleHighlightSeek,
    handleContinuousPlaybackProgress,
    syncSelectedHighlightByTime,
    openHighlightEditor,
    closeHighlightEditor,
    clearHighlightLongPress,
    startHighlightLongPress,
    handleStripPointerDown,
    handleStripPointerMove,
    handleStripPointerEnd,
    handleHighlightItemClick,
    saveHighlightEditor,
    deleteHighlight,
    setSelectedHighlightId,
    startContinuousHighlightPlayback,
    stopContinuousHighlightPlayback,
  }
}
