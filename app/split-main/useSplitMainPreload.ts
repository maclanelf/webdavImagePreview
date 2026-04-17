'use client'

import { useCallback, type MutableRefObject } from 'react'

import databasePreloadManager from '@/lib/databasePreloadManager'
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
  preloadEnabled: boolean
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
  preloadEnabled,
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

    if (!config || !preloadEnabled) {
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
    config,
    notify,
    preloadEnabled,
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

    if (!config || !preloadEnabled) {
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
      const result = await databasePreloadManager.refillCache(
        config,
        [],
        preloadCount,
        viewedFilter,
        (current, total) => {
          setCachePreloadProgress({ current, total })
        },
        preloadRandomness,
        true,
        undefined,
        mediaFilter,
        filters,
      )

      setPreloadInsufficient(result.isInsufficient)
      setActualFoundCount(result.actualCount)

      if (result.allViewed) {
        notify('随机模式下已无可继续浏览的文件，请点击开始预览重新触发随机加载', 'info')
        return
      }

      if (viewModeRef.current !== 'random') {
        return
      }

      const cacheStatus = databasePreloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      setCachePreloadProgress({ current: cacheStatus.cacheSize, total: preloadCount })

      if (result.isInsufficient) {
        notify(`仅找到 ${result.actualCount} 个符合条件的文件，未达到预加载目标 ${preloadCount} 个`, 'warning')
      }
    } catch (randomPreloadError) {
      console.warn('随机模式预加载失败:', randomPreloadError)

      const cacheStatus = databasePreloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      setCachePreloadProgress({ current: cacheStatus.cacheSize, total: preloadCount })
    }
  }, [
    advancedFilters,
    config,
    mediaFilter,
    notify,
    preloadEnabled,
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

    if (!preloadEnabled || !config || statsTotal <= 0) {
      setGalleryPreloadReady(true)
      setCachePreloadProgress(null)
      return
    }

    if (viewModeRef.current === 'gallery') {
      void runGalleryPreload()
      return
    }

    if (viewModeRef.current === 'random') {
      void runRandomPreload()
      return
    }

    // 大视频模式不依赖小文件预加载缓存，因此这里直接视为“已准备完成”。
    setGalleryPreloadReady(true)
    setCachePreloadProgress(null)
  }, [
    config,
    preloadEnabled,
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
