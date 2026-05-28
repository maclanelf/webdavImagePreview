'use client'

import { useCallback, type MutableRefObject } from 'react'

import { clearRandomPoolSession, initializeRandomPoolSession } from '@/lib/clientRandomPool'
import databasePreloadManager from '@/lib/databasePreloadManager'
import { getRandomPoolSessionId, peekRandomPoolSessionId, renewRandomPoolSessionId } from '@/lib/randomPoolSession'
import type {
  AdvancedFilters,
  MediaFilter,
  ViewMode,
  ViewedFilter,
  WebDAVConfig,
} from '@/types'

type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning'

interface UseSplitMainPreloadOptions {
  config: WebDAVConfig | null
  viewedFilter: ViewedFilter
  advancedFilters: AdvancedFilters
  mediaFilter: MediaFilter
  preloadRandomness: number
  statsTotal: number
  viewModeRef: MutableRefObject<ViewMode>
  setGalleryPreloadReady: (ready: boolean) => void
  setCachePreloadProgress: (progress: { current: number; total: number } | null) => void
  setPreloadInsufficient: (value: boolean) => void
  setActualFoundCount: (count: number) => void
  setPreloadStatus: (status: { cacheSize: number; maxCacheSize: number }) => void
  notify: (message: string, severity?: SnackbarSeverity) => void
}

/**
 * 拆分主工作区的“模式预加载调度” Hook。
 *
 * 这里集中承接原本写在 [`SplitMainWorkspace`](components/split-main/SplitMainWorkspace.tsx)
 * 中、但明显带有“模式调度”属性的逻辑：
 * - 图组模式预加载
 * - 随机模式预加载
 * - 根据当前模式重新执行预加载
 *
 * 它不负责页面渲染，也不直接持有业务状态，
 * 只消费壳层传入的共享状态与 setter，产出可复用的预加载动作。
 */
export function useSplitMainPreload({
  config,
  viewedFilter,
  advancedFilters,
  mediaFilter,
  preloadRandomness,
  statsTotal,
  viewModeRef,
  setGalleryPreloadReady,
  setCachePreloadProgress,
  setPreloadInsufficient,
  setActualFoundCount,
  setPreloadStatus,
  notify,
}: UseSplitMainPreloadOptions) {
  const buildCombinedRandomPoolStatus = useCallback((
    poolStatus?: { cacheSize: number; maxCacheSize: number } | null,
    fallbackMaxCacheSize: number = 0,
  ) => {
    const clientCacheStatus = databasePreloadManager.getCacheStatus()
    const maxCacheSize = fallbackMaxCacheSize || poolStatus?.maxCacheSize || clientCacheStatus.maxCacheSize || 0

    return {
      cacheSize: maxCacheSize > 0
        ? Math.min(maxCacheSize, clientCacheStatus.cacheSize)
        : clientCacheStatus.cacheSize,
      maxCacheSize,
    }
  }, [])

  const clearServerRandomPool = useCallback(async () => {
    try {
      await clearRandomPoolSession(peekRandomPoolSessionId())
    } catch (error) {
      console.warn('清理服务端随机缓存池失败:', error)
    }
  }, [])

  const prewarmRandomMediaCache = useCallback(async (preloadCount: number, filters?: AdvancedFilters) => {
    if (!config || preloadCount <= 0) {
      return null
    }

    const randomPoolSessionId = getRandomPoolSessionId()
    const localViewedFileIds = viewedFilter === 'viewed'
      ? Array.from(databasePreloadManager.getLocalViewedFileIds())
      : []

    if (!randomPoolSessionId) {
      return null
    }

    const response = await fetch('/api/scan-files/random', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webdavUrl: config.url,
        webdavUsername: config.username,
        paths: config.mediaPaths,
        count: preloadCount,
        preloadCount,
        useRandomPool: true,
        randomPoolSessionId,
        randomness: preloadRandomness,
        fileType: mediaFilter === 'images' ? 'image' : mediaFilter === 'videos' ? 'video' : undefined,
        isViewed: viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined,
        excludeFileIds: localViewedFileIds.length > 0 ? localViewedFileIds : undefined,
        maxFileSize: 100 * 1024 * 1024,
        ratings: filters?.ratings,
        evaluations: filters?.evaluations,
        categories: filters?.categories,
        reasonFilter: filters?.reasonFilter,
        reasonKeyword: filters?.reasonKeyword,
        ratingEmptyFilter: filters?.ratingEmptyFilter,
        evaluationEmptyFilter: filters?.evaluationEmptyFilter,
        categoryEmptyFilter: filters?.categoryEmptyFilter,
      }),
    })

    if (!response.ok) {
      throw new Error('获取随机预加载文件失败')
    }

    const data = await response.json()
    if (randomPoolSessionId !== getRandomPoolSessionId()) {
      return null
    }

    const filesToPreload = Array.isArray(data.files)
      ? data.files.map((file: any) => ({
          id: Number.isFinite(Number(file.id)) ? Number(file.id) : undefined,
          filename: file.filename,
          basename: file.basename,
          size: file.file_size || 0,
          lastmod: file.lastmod || '',
          creator: file.creator || null,
          creatorResolved: Boolean(file.creatorResolved),
          mediaRatingData: file.mediaRatingData ?? null,
          groupRatingData: file.groupRatingData ?? null,
        }))
      : []

    await databasePreloadManager.preloadProvidedFiles(
      config,
      filesToPreload,
      preloadCount,
      () => {
        if (randomPoolSessionId !== getRandomPoolSessionId()) {
          return
        }

        const nextStatus = buildCombinedRandomPoolStatus(data.poolStatus || null, preloadCount)
        setPreloadStatus(nextStatus)
        setCachePreloadProgress({
          current: nextStatus.cacheSize,
          total: nextStatus.maxCacheSize || preloadCount,
        })
      },
    )

    return data.poolStatus || null
  }, [buildCombinedRandomPoolStatus, config, mediaFilter, preloadRandomness, setCachePreloadProgress, setPreloadStatus, viewedFilter])

  /**
   * 图组模式预加载。
   *
   * 目标：
   * - 预热当前可浏览图组
   * - 同步预加载进度到主壳层
   * - 继续异步预热下一组，保证换组时尽量无感
   *
   * 简化策略：
   * 在每次启动图组预加载前，先直接取消旧模式遗留的预加载任务。
   * 这样切模式时不会再有旧回调继续干扰当前模式的进度显示。
   */
  const runGalleryPreload = useCallback(async () => {
    databasePreloadManager.cancelAllPreloads()
    databasePreloadManager.clearNextGroupCache()
    databasePreloadManager.clearGalleryRuntimeState()

    await clearServerRandomPool()

    if (!config) {
      setGalleryPreloadReady(true)
      return
    }

    const preloadCount = config.scanSettings?.preloadCount || 10
    const galleryFilters = viewedFilter === 'viewed' ? advancedFilters : undefined
    setGalleryPreloadReady(false)
    setCachePreloadProgress({ current: 0, total: preloadCount })
    setPreloadInsufficient(false)
    setActualFoundCount(0)

    try {
      const result = await databasePreloadManager.preloadForGalleryMode(
        config,
        [],
        preloadCount,
        viewedFilter,
        (current, total) => {
          setCachePreloadProgress({ current, total })
          if (current >= total) {
            setGalleryPreloadReady(true)
          }
        },
        galleryFilters,
      )

      const cacheStatus = databasePreloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      setGalleryPreloadReady(true)
      setCachePreloadProgress({ current: cacheStatus.cacheSize, total: preloadCount })

      if (result.message?.includes('未达到预加载目标')) {
        notify(result.message, 'warning')
      }

      void databasePreloadManager.preloadNextGroup(config, [], preloadCount, viewedFilter, galleryFilters).catch((preloadNextError) => {
        console.error('预加载下一组失败:', preloadNextError)
      })
    } catch (galleryPreloadError) {
      console.warn('图组模式预加载失败:', galleryPreloadError)

      const cacheStatus = databasePreloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      setGalleryPreloadReady(true)
      setCachePreloadProgress({ current: cacheStatus.cacheSize, total: preloadCount })
    }
  }, [
    advancedFilters,
    clearServerRandomPool,
    config,
    notify,
    setActualFoundCount,
    setCachePreloadProgress,
    setGalleryPreloadReady,
    setPreloadInsufficient,
    setPreloadStatus,
    viewedFilter,
  ])

  /**
   * 随机模式预加载。
   *
   * 目标：
   * - 尽可能把随机缓存池补满
   * - 在“已看过筛选”下带上高级过滤条件
   * - 把缓存不足、实际命中数量等状态同步给主壳层
   *
   * 简化策略：
   * 在每次启动随机预加载前，先取消旧模式遗留的预加载任务。
   * 这样从图组模式切到随机模式时，顶部数字只会由当前随机预加载驱动。
   */
  const runRandomPreload = useCallback(async () => {
    databasePreloadManager.cancelAllPreloads()
    databasePreloadManager.clearCache()
    databasePreloadManager.clearNextGroupCache()
    databasePreloadManager.clearGalleryRuntimeState()

    if (!config) {
      setGalleryPreloadReady(true)
      return
    }

    const preloadCount = config.scanSettings?.preloadCount || 10
    const filters = viewedFilter === 'viewed' ? advancedFilters : undefined

    setGalleryPreloadReady(true)
    setCachePreloadProgress({ current: 0, total: preloadCount })
    setPreloadInsufficient(false)
    setActualFoundCount(0)

    try {
      await clearServerRandomPool()
      const randomPoolSessionId = renewRandomPoolSessionId()
      const localViewedFileIds = viewedFilter === 'viewed'
        ? Array.from(databasePreloadManager.getLocalViewedFileIds())
        : []

      if (!randomPoolSessionId) {
        throw new Error('缺少 randomPoolSessionId')
      }

      const result = await initializeRandomPoolSession({
        webdavUrl: config.url,
        webdavUsername: config.username,
        paths: config.mediaPaths,
        preloadCount,
        randomness: preloadRandomness,
        excludeFileIds: localViewedFileIds.length > 0 ? localViewedFileIds : undefined,
        fileType: mediaFilter === 'images' ? 'image' : mediaFilter === 'videos' ? 'video' : undefined,
        isViewed: viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined,
        maxFileSize: 100 * 1024 * 1024,
        ratings: filters?.ratings,
        evaluations: filters?.evaluations,
        categories: filters?.categories,
        reasonFilter: filters?.reasonFilter,
        reasonKeyword: filters?.reasonKeyword,
        ratingEmptyFilter: filters?.ratingEmptyFilter,
        evaluationEmptyFilter: filters?.evaluationEmptyFilter,
        categoryEmptyFilter: filters?.categoryEmptyFilter,
      }, randomPoolSessionId)

      if (randomPoolSessionId !== getRandomPoolSessionId()) {
        return
      }

      setPreloadInsufficient(false)
      setActualFoundCount(0)

      if (!result.hasData) {
        notify(result.message || '数据尚未迁移，请先执行迁移', 'warning')
        return
      }

      if (viewModeRef.current !== 'random') {
        return
      }

      const prewarmedPoolStatus = await prewarmRandomMediaCache(preloadCount, filters)
      if (viewModeRef.current !== 'random') {
        return
      }

      const cacheStatus = buildCombinedRandomPoolStatus(
        prewarmedPoolStatus || result.poolStatus || null,
        preloadCount,
      )
      setPreloadStatus(cacheStatus)
      setCachePreloadProgress({ current: cacheStatus.cacheSize, total: cacheStatus.maxCacheSize || preloadCount })

      const clientInsufficient = cacheStatus.cacheSize < preloadCount
      setPreloadInsufficient(clientInsufficient)
      setActualFoundCount(cacheStatus.cacheSize)

      if (clientInsufficient) {
        notify(`仅找到 ${cacheStatus.cacheSize} 个可预加载文件，未达到预加载目标 ${preloadCount} 个`, 'warning')
      }
    } catch (randomPreloadError) {
      console.warn('随机模式预加载失败:', randomPreloadError)

      const cacheStatus = databasePreloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      setCachePreloadProgress({ current: cacheStatus.cacheSize, total: preloadCount })
    }
  }, [
    advancedFilters,
    clearServerRandomPool,
    config,
    mediaFilter,
    buildCombinedRandomPoolStatus,
    notify,
    prewarmRandomMediaCache,
    preloadRandomness,
    setActualFoundCount,
    setCachePreloadProgress,
    setGalleryPreloadReady,
    setPreloadInsufficient,
    setPreloadStatus,
    viewModeRef,
    viewedFilter,
  ])

  /**
   * 根据当前模式重新执行预加载。
   *
   * 这是主壳层在以下场景会用到的统一入口：
   * - 切换模式
   * - 切换筛选条件后关闭抽屉
   * - 手动重新初始化当前模式缓存
   *
   * 它会先清空所有现有缓存，再根据当前模式决定调度到图组或随机的预加载流程。
   */
  const rerunModePreload = useCallback(() => {
    databasePreloadManager.cancelAllPreloads()
    databasePreloadManager.clearCache()
    databasePreloadManager.clearNextGroupCache()
    databasePreloadManager.clearGalleryRuntimeState()
    setPreloadStatus(databasePreloadManager.getCacheStatus())

    void (async () => {
      if (!config || statsTotal <= 0) {
        await clearServerRandomPool()
        setGalleryPreloadReady(true)
        setCachePreloadProgress(null)
        return
      }

      if (viewModeRef.current === 'gallery') {
        await runGalleryPreload()
        return
      }

      if (viewModeRef.current === 'random') {
        await runRandomPreload()
        return
      }

      await clearServerRandomPool()

      // 大视频模式不依赖小文件预加载缓存，因此这里直接视为“已准备完成”。
      setGalleryPreloadReady(true)
      setCachePreloadProgress(null)
    })()
  }, [
    config,
    runGalleryPreload,
    runRandomPreload,
    setCachePreloadProgress,
    setGalleryPreloadReady,
    setPreloadStatus,
    statsTotal,
    viewModeRef,
  ])

  return {
    runGalleryPreload,
    runRandomPreload,
    rerunModePreload,
  }
}
