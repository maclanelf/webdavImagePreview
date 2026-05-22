'use client'

import { useCallback, useEffect, type MutableRefObject, useRef } from 'react'

import databasePreloadManager from '@/lib/databasePreloadManager'
import {
  localRatingQueue,
} from '@/lib/localRatingQueue'
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
  patchMediaRatingSnapshot: (filePath: string, rating: MediaRating | null) => void
  patchGroupRatingSnapshot: (groupPath: string, rating: GroupRating | null) => void
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

function normalizeMediaRating(data: MediaRating): MediaRating {
  return {
    rating: data.rating,
    recommendationReason: data.recommendationReason,
    customEvaluation: data.customEvaluation,
    category: data.category,
    isViewed: data.isViewed,
  }
}

function normalizeGroupRating(data: GroupRating): GroupRating {
  return {
    rating: data.rating,
    recommendationReason: data.recommendationReason,
    customEvaluation: data.customEvaluation,
    category: data.category,
    isViewed: data.isViewed,
  }
}

/**
 * 拆分主壳层中的共享评分与自动已看逻辑。
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
  patchMediaRatingSnapshot,
  patchGroupRatingSnapshot,
  notify,
}: UseSharedRatingActionsOptions) {
  const localMediaRatingOverridesRef = useRef<Map<string, MediaRating | null>>(new Map())
  const localGroupRatingOverridesRef = useRef<Map<string, GroupRating | null>>(new Map())
  const mediaRatingRollbackRef = useRef<Map<string, MediaRating | null>>(new Map())
  const groupRatingRollbackRef = useRef<Map<string, GroupRating | null>>(new Map())
  const autoRatingSuppressedFileRef = useRef<string | null>(null)

  useEffect(() => {
    const syncLocalOverrides = () => {
      const activeMediaKeys = new Set<string>()
      const activeGroupKeys = new Set<string>()

      localRatingQueue.getAllRecords().forEach((record) => {
        if (record.type === 'media') {
          activeMediaKeys.add(record.filePath)
        } else {
          activeGroupKeys.add(record.groupPath)
        }
      })

      localMediaRatingOverridesRef.current.forEach((_value, filename) => {
        if (!activeMediaKeys.has(filename)) {
          patchMediaRatingSnapshot(filename, localMediaRatingOverridesRef.current.get(filename) ?? null)
          localMediaRatingOverridesRef.current.delete(filename)
          mediaRatingRollbackRef.current.delete(filename)
        }
      })

      localGroupRatingOverridesRef.current.forEach((_value, groupPath) => {
        if (!activeGroupKeys.has(groupPath)) {
          patchGroupRatingSnapshot(groupPath, localGroupRatingOverridesRef.current.get(groupPath) ?? null)
          localGroupRatingOverridesRef.current.delete(groupPath)
          groupRatingRollbackRef.current.delete(groupPath)
        }
      })
    }

    const rollbackIfFailed = () => {
      localRatingQueue.getAllRecords().forEach((record) => {
        if (record.status !== 'failed') {
          return
        }

        if (record.type === 'media') {
          if (!mediaRatingRollbackRef.current.has(record.filePath)) {
            return
          }

          const rollbackRating = mediaRatingRollbackRef.current.get(record.filePath) ?? null
          patchMediaRatingSnapshot(record.filePath, rollbackRating)
          localMediaRatingOverridesRef.current.delete(record.filePath)
          mediaRatingRollbackRef.current.delete(record.filePath)
          return
        }

        if (!groupRatingRollbackRef.current.has(record.groupPath)) {
          return
        }

        const rollbackRating = groupRatingRollbackRef.current.get(record.groupPath) ?? null
        patchGroupRatingSnapshot(record.groupPath, rollbackRating)
        localGroupRatingOverridesRef.current.delete(record.groupPath)
        groupRatingRollbackRef.current.delete(record.groupPath)
      })
    }

    syncLocalOverrides()
    rollbackIfFailed()
    return localRatingQueue.subscribe(() => {
      syncLocalOverrides()
      rollbackIfFailed()
    })
  }, [patchGroupRatingSnapshot, patchMediaRatingSnapshot])

  const stopAutoMarkTimer = useCallback(() => {
    if (autoMarkTimer) {
      clearTimeout(autoMarkTimer)
      setAutoMarkTimer(null)
    }
  }, [autoMarkTimer, setAutoMarkTimer])

  const resolveMediaRatingSnapshot = useCallback((file?: MediaFile | null) => {
    const targetFile = file || currentFile
    if (!targetFile) {
      return { hasData: false, rating: null as MediaRating | null }
    }

    const queueRecord = localRatingQueue.getMediaRecord(targetFile.filename)
    if (queueRecord) {
      if (queueRecord.status === 'failed') {
        if (targetFile.mediaRatingData !== undefined) {
          return {
            hasData: true,
            rating: targetFile.mediaRatingData ?? null,
          }
        }

        return { hasData: false, rating: null as MediaRating | null }
      }

      return {
        hasData: true,
        rating: queueRecord.rating,
      }
    }

    if (localMediaRatingOverridesRef.current.has(targetFile.filename)) {
      return {
        hasData: true,
        rating: localMediaRatingOverridesRef.current.get(targetFile.filename) ?? null,
      }
    }

    if (targetFile.mediaRatingData !== undefined) {
      return {
        hasData: true,
        rating: targetFile.mediaRatingData ?? null,
      }
    }

    return { hasData: false, rating: null as MediaRating | null }
  }, [currentFile])

  const resolveGroupRatingSnapshot = useCallback((groupFiles?: MediaFile[]) => {
    const sourceFiles = groupFiles && groupFiles.length > 0 ? groupFiles : currentGroup
    const seedFile = sourceFiles[0]
    if (!seedFile) {
      return { hasData: false, rating: null as GroupRating | null }
    }

    const groupPath = getGroupPath(seedFile.filename)
    const queueRecord = localRatingQueue.getGroupRecord(groupPath)
    if (queueRecord) {
      if (queueRecord.status === 'failed') {
        if (seedFile.groupRatingData !== undefined) {
          return {
            hasData: true,
            rating: seedFile.groupRatingData ?? null,
          }
        }

        return { hasData: false, rating: null as GroupRating | null }
      }

      return {
        hasData: true,
        rating: queueRecord.rating,
      }
    }

    if (localGroupRatingOverridesRef.current.has(groupPath)) {
      return {
        hasData: true,
        rating: localGroupRatingOverridesRef.current.get(groupPath) ?? null,
      }
    }

    if (seedFile.groupRatingData !== undefined) {
      return {
        hasData: true,
        rating: seedFile.groupRatingData ?? null,
      }
    }

    return { hasData: false, rating: null as GroupRating | null }
  }, [currentGroup])

  const loadMediaRating = useCallback(async (filePath: string) => {
    try {
      setRatingType('media')

      if (currentFile?.filename === filePath) {
        const snapshot = resolveMediaRatingSnapshot(currentFile)
        if (snapshot.hasData) {
          setCurrentRating(snapshot.rating)
          return
        }
      }

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
  }, [currentFile, resolveMediaRatingSnapshot, setCurrentRating, setRatingType])

  const loadCurrentRating = useCallback(async (file?: MediaFile, forceType?: 'media' | 'group') => {
    const targetFile = file || currentFile
    const effectiveRatingType = forceType || ratingType

    if (!targetFile && currentGroup.length === 0) {
      return
    }

    try {
      if (effectiveRatingType === 'media' && targetFile) {
        const snapshot = resolveMediaRatingSnapshot(targetFile)
        if (snapshot.hasData) {
          setCurrentRating(snapshot.rating)
          return
        }

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
        const snapshot = resolveGroupRatingSnapshot(currentGroup)
        if (snapshot.hasData) {
          setCurrentRating(snapshot.rating)
          return
        }

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
  }, [currentFile, currentGroup, ratingType, resolveGroupRatingSnapshot, resolveMediaRatingSnapshot, setCurrentRating])

  const enqueueMediaRating = useCallback(async (targetFile: MediaFile, data: MediaRating) => {
    const normalizedRating = normalizeMediaRating(data)
    const previousRating = resolveMediaRatingSnapshot(targetFile).rating

    mediaRatingRollbackRef.current.set(targetFile.filename, previousRating)
    localMediaRatingOverridesRef.current.set(targetFile.filename, normalizedRating)
    patchMediaRatingSnapshot(targetFile.filename, normalizedRating)
    setCurrentRating(normalizedRating)

    await localRatingQueue.enqueueMedia({
      filePath: targetFile.filename,
      fileName: targetFile.basename,
      fileType: isImageFile(targetFile.filename) ? 'image' : 'video',
      ...normalizedRating,
    })

  }, [notify, patchMediaRatingSnapshot, resolveMediaRatingSnapshot, setCurrentRating])

  const enqueueGroupRating = useCallback(async (data: GroupRating) => {
    if (currentGroup.length === 0) {
      throw new Error('当前没有可评分的图组')
    }

    const groupPath = getGroupPath(currentGroup[0].filename)
    const normalizedRating = normalizeGroupRating(data)
    const previousRating = resolveGroupRatingSnapshot(currentGroup).rating

    groupRatingRollbackRef.current.set(groupPath, previousRating)
    localGroupRatingOverridesRef.current.set(groupPath, normalizedRating)
    patchGroupRatingSnapshot(groupPath, normalizedRating)
    setCurrentRating(normalizedRating)

    await localRatingQueue.enqueueGroup({
      groupPath,
      groupName: getGroupName(groupPath),
      fileCount: currentGroup.length,
      ...normalizedRating,
    })

  }, [currentGroup, notify, patchGroupRatingSnapshot, resolveGroupRatingSnapshot, setCurrentRating])

  const saveRating = useCallback(async (data: MediaRating | GroupRating, file?: MediaFile, optimistic = false) => {
    const effectiveRatingType: 'media' | 'group' = file ? 'media' : ratingType
    const targetFile = effectiveRatingType === 'media' ? (file || currentFile) : null

    try {
      if (optimistic && optimisticUpdateEnabled) {
        if (effectiveRatingType === 'group') {
          await enqueueGroupRating(data as GroupRating)
          return
        }

        if (targetFile) {
          await enqueueMediaRating(targetFile, data as MediaRating)
          return
        }
      }

      if (effectiveRatingType === 'group' && currentGroup.length > 0) {
        const groupPath = getGroupPath(currentGroup[0].filename)
        const groupName = getGroupName(groupPath)
        localRatingQueue.cancelGroupRecord(groupPath)
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

        const normalizedGroupRating = normalizeGroupRating(data as GroupRating)
        patchGroupRatingSnapshot(groupPath, normalizedGroupRating)
        setCurrentRating(normalizedGroupRating)
        return
      }

      if (targetFile) {
        localRatingQueue.cancelMediaRecord(targetFile.filename)
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

        const normalizedMediaRating = normalizeMediaRating(data as MediaRating)
        patchMediaRatingSnapshot(targetFile.filename, normalizedMediaRating)
        setCurrentRating(normalizedMediaRating)
        return
      }

      throw new Error(effectiveRatingType === 'group' ? '当前没有可评分的图组' : '当前没有可评分的媒体文件')
    } catch (saveRatingError: any) {
      throw new Error(saveRatingError.message)
    }
  }, [currentFile, currentGroup, enqueueGroupRating, enqueueMediaRating, optimisticUpdateEnabled, patchGroupRatingSnapshot, patchMediaRatingSnapshot, ratingType, setCurrentRating])

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

    if (autoRatingSuppressedFileRef.current === targetFile.filename) {
      return
    }

    hasAutoRatedRef.current = true

    try {
      if (viewedFilter !== 'unviewed') {
        const snapshot = resolveMediaRatingSnapshot(targetFile)
        if (snapshot.hasData) {
          if (snapshot.rating?.rating) {
            return
          }
        } else {
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
  }, [currentFile, hasAutoRatedRef, resolveMediaRatingSnapshot, saveRating, setStats, viewedFilter])

  const startAutoMarkTimer = useCallback((file?: MediaFile, skipAutoRating = false) => {
    const targetFile = file || currentFile
    if (!targetFile) {
      return
    }

    stopAutoMarkTimer()
    hasAutoRatedRef.current = false

    if (skipAutoRating) {
      autoRatingSuppressedFileRef.current = targetFile.filename
      return
    }

    autoRatingSuppressedFileRef.current = null

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
