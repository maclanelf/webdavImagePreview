'use client'

import { useCallback, type MutableRefObject } from 'react'

import databasePreloadManager from '@/lib/databasePreloadManager'
import { QUICK_RATING_CONFIG } from '@/types'
import type {
  GroupRating,
  MediaFile,
  MediaRating,
  ViewedFilter,
} from '@/types'

type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning'

interface UseSharedRatingActionsOptions {
  currentFile: MediaFile | null
  currentGroup: MediaFile[]
  currentRating: MediaRating | GroupRating | null
  ratingType: 'media' | 'group'
  viewedFilter: ViewedFilter
  optimisticUpdateEnabled: boolean
  autoMarkTimer: ReturnType<typeof setTimeout> | null
  setAutoMarkTimer: (timer: ReturnType<typeof setTimeout> | null) => void
  setCurrentRating: (rating: MediaRating | GroupRating | null) => void
  setRatingType: (type: 'media' | 'group') => void
  setStats: React.Dispatch<React.SetStateAction<{ total: number; images: number; videos: number; viewed: number }>>
  hasAutoRatedRef: MutableRefObject<boolean>
  notify: (message: string, severity?: SnackbarSeverity) => void
}

const isImageFile = (filename: string) => /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(filename)

const getGroupPath = (filePath: string): string => {
  const lastSlashIndex = filePath.lastIndexOf('/')
  return lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '/'
}

const getGroupName = (groupPath: string): string => {
  const pathParts = groupPath.split('/').filter((part) => part.length > 0)
  return pathParts.length > 0 ? pathParts[pathParts.length - 1] : '根目录'
}

/**
 * 拆分主壳层中的共享评分与自动已看逻辑。
 *
 * 这里集中承接三种模式都共用的评分领域能力：
 * - 媒体评分读取
 * - 图组评分读取
 * - 媒体 / 图组评分保存
 * - 快速评分
 * - 自动标记已看过
 * - 自动标记定时器
 *
 * 这样 [`SplitMainWorkspace`](components/split-main/SplitMainWorkspace.tsx)
 * 可以把这部分共享领域逻辑从壳层装配代码中抽离出去。
 */
export function useSharedRatingActions({
  currentFile,
  currentGroup,
  currentRating,
  ratingType,
  viewedFilter,
  optimisticUpdateEnabled,
  autoMarkTimer,
  setAutoMarkTimer,
  setCurrentRating,
  setRatingType,
  setStats,
  hasAutoRatedRef,
  notify,
}: UseSharedRatingActionsOptions) {
  const stopAutoMarkTimer = useCallback(() => {
    if (autoMarkTimer) {
      clearTimeout(autoMarkTimer)
      setAutoMarkTimer(null)
    }
  }, [autoMarkTimer, setAutoMarkTimer])

  const loadMediaRating = useCallback(async (filePath: string) => {
    try {
      setRatingType('media')
      const response = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(filePath)}`)
      if (!response.ok) {
        setCurrentRating(null)
        return
      }

      const text = await response.text()
      setCurrentRating(text ? JSON.parse(text).rating || null : null)
    } catch (loadRatingError) {
      console.error('加载媒体评分失败:', loadRatingError)
      setCurrentRating(null)
    }
  }, [setCurrentRating, setRatingType])

  const loadCurrentRating = useCallback(async (file?: MediaFile, forceType?: 'media' | 'group') => {
    const targetFile = file || currentFile
    const effectiveRatingType = forceType || ratingType

    if (!targetFile && currentGroup.length === 0) {
      return
    }

    try {
      if (effectiveRatingType === 'media' && targetFile) {
        const response = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(targetFile.filename)}`)
        if (!response.ok) {
          setCurrentRating(null)
          return
        }

        const text = await response.text()
        setCurrentRating(text ? JSON.parse(text).rating || null : null)
        return
      }

      if (effectiveRatingType === 'group' && currentGroup.length > 0) {
        const groupPath = getGroupPath(currentGroup[0].filename)
        const response = await fetch(`/api/ratings/group?groupPath=${encodeURIComponent(groupPath)}`)
        if (!response.ok) {
          setCurrentRating(null)
          return
        }

        const text = await response.text()
        setCurrentRating(text ? JSON.parse(text).rating || null : null)
      }
    } catch (loadCurrentRatingError) {
      console.error('加载评分失败:', loadCurrentRatingError)
      setCurrentRating(null)
    }
  }, [currentFile, currentGroup, ratingType, setCurrentRating])

  const saveRating = useCallback(async (data: MediaRating | GroupRating, file?: MediaFile, optimistic = false) => {
    const effectiveRatingType: 'media' | 'group' = file ? 'media' : ratingType
    const targetFile = effectiveRatingType === 'media' ? (file || currentFile) : null

    try {
      if (optimistic && optimisticUpdateEnabled) {
        setCurrentRating(data)
      }

      if (effectiveRatingType === 'group' && currentGroup.length > 0) {
        const groupPath = getGroupPath(currentGroup[0].filename)
        const groupName = getGroupName(groupPath)
        const response = await fetch('/api/ratings/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupPath,
            groupName,
            fileCount: currentGroup.length,
            ...data,
          }),
        })

        if (!response.ok) {
          const text = await response.text()
          let errorMessage = '保存图组评分失败'
          if (text) {
            try {
              errorMessage = JSON.parse(text).error || errorMessage
            } catch {
              errorMessage = text
            }
          }
          throw new Error(errorMessage)
        }

        await loadCurrentRating(undefined, 'group')
        return
      }

      if (targetFile) {
        const apiUrl = optimistic && optimisticUpdateEnabled ? '/api/ratings/optimistic' : '/api/ratings/media'
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: targetFile.filename,
            fileName: targetFile.basename,
            fileType: isImageFile(targetFile.filename) ? 'image' : 'video',
            ...data,
          }),
        })

        if (!response.ok) {
          const text = await response.text()
          let errorMessage = '保存媒体评分失败'
          if (text) {
            try {
              errorMessage = JSON.parse(text).error || errorMessage
            } catch {
              errorMessage = text
            }
          }
          throw new Error(errorMessage)
        }

        if (!optimistic || !optimisticUpdateEnabled) {
          await loadMediaRating(targetFile.filename)
        }
        return
      }

      throw new Error(effectiveRatingType === 'group' ? '当前没有可评分的图组' : '当前没有可评分的媒体文件')
    } catch (saveRatingError: any) {
      throw new Error(saveRatingError.message)
    }
  }, [currentFile, currentGroup, loadCurrentRating, loadMediaRating, optimisticUpdateEnabled, ratingType, setCurrentRating])

  const saveRatingManual = useCallback(async (data: MediaRating | GroupRating, file?: MediaFile) => {
    await saveRating(data, file, true)
    hasAutoRatedRef.current = true
  }, [hasAutoRatedRef, saveRating])

  const handleQuickRate = useCallback(async (rating: number, evaluation: string) => {
    if (!currentFile) {
      return
    }

    try {
      await saveRating(
        {
          rating,
          customEvaluation: [evaluation],
          isViewed: true,
          category: currentRating?.category,
          recommendationReason: currentRating?.recommendationReason,
        },
        currentFile,
        true,
      )

      hasAutoRatedRef.current = true
      notify(`${rating}星 - ${evaluation}`, 'success')
    } catch (quickRateError) {
      console.error('快速评分失败:', quickRateError)
      notify('❌ 评分失败，请重试', 'error')
    }
  }, [currentFile, currentRating, hasAutoRatedRef, notify, saveRating])

  const performAutoRating = useCallback(async (file?: MediaFile) => {
    const targetFile = file || currentFile
    if (!targetFile || hasAutoRatedRef.current) {
      return
    }

    hasAutoRatedRef.current = true

    try {
      if (viewedFilter !== 'unviewed') {
        const response = await fetch(`/api/ratings/media?filePath=${encodeURIComponent(targetFile.filename)}`)
        if (response.ok) {
          const text = await response.text()
          if (text) {
            const data = JSON.parse(text)
            if (data.rating?.rating) {
              return
            }
          }
        }
      }

      const wasAlreadyViewed = databasePreloadManager.isViewed(targetFile.filename)

      await saveRating(
        {
          rating: 2,
          customEvaluation: [QUICK_RATING_CONFIG[1].evaluation],
          isViewed: true,
        },
        targetFile,
        true,
      )

      if (!wasAlreadyViewed) {
        setStats((prev) => ({
          ...prev,
          viewed: prev.viewed + 1,
        }))
      }
    } catch (autoRateError) {
      console.error('自动标记已看过失败:', autoRateError)
    }
  }, [currentFile, hasAutoRatedRef, saveRating, setStats, viewedFilter])

  const startAutoMarkTimer = useCallback((file?: MediaFile, skipAutoRating = false) => {
    const targetFile = file || currentFile
    if (!targetFile) {
      return
    }

    stopAutoMarkTimer()
    hasAutoRatedRef.current = false

    if (skipAutoRating) {
      return
    }

    const timeoutDuration = isImageFile(targetFile.filename) ? 100 : 180000
    const timer = setTimeout(() => {
      void performAutoRating(targetFile)
    }, timeoutDuration)

    setAutoMarkTimer(timer)
  }, [currentFile, hasAutoRatedRef, performAutoRating, setAutoMarkTimer, stopAutoMarkTimer])

  return {
    stopAutoMarkTimer,
    loadMediaRating,
    loadCurrentRating,
    saveRatingManual,
    handleQuickRate,
    performAutoRating,
    startAutoMarkTimer,
  }
}
