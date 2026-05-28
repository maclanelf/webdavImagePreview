import { useCallback, useEffect, useRef, useState, type MutableRefObject, type SyntheticEvent } from 'react'

import { scheduleStreamRequest } from '@/lib/clientRequestScheduler'
import { clearRandomPoolSession, initializeRandomPoolSession } from '@/lib/clientRandomPool'
import databasePreloadManager from '@/lib/databasePreloadManager'
import { getRandomPoolSessionId, peekRandomPoolSessionId, renewRandomPoolSessionId } from '@/lib/randomPoolSession'
import type {
  AdvancedFilters,
  CreatorSummary,
  MediaFile,
  MediaFilter,
  MediaType,
  ViewMode,
  ViewedFilter,
  WebDAVConfig,
} from '@/types'

interface RandomHistoryCacheEntry {
  url: string
  blob: Blob
  mediaType: MediaType
  originalStreamUrl: string | null
  directPlayAvailable?: boolean
  creator: CreatorSummary | null
  creatorResolved: boolean
}

function patchMediaFileCreatorMetadata(
  file: MediaFile,
  creator: CreatorSummary | null,
  creatorResolved: boolean,
): MediaFile {
  return {
    ...file,
    creator,
    creatorResolved,
  }
}

interface UseRandomModeOptions {
  config: WebDAVConfig | null
  currentFile: MediaFile | null
  mediaUrl: string | null
  mediaFilter: MediaFilter
  viewedFilter: ViewedFilter
  advancedFilters: AdvancedFilters
  preloadRandomness: number
  viewModeRef: MutableRefObject<ViewMode>
  setCurrentFile: (file: MediaFile | null) => void
  setCurrentCreator: (creator: any) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setMediaUrl: (url: string | null) => void
  setTranscodeUrl: (url: string | null) => void
  setOriginalStreamUrl: (url: string | null) => void
  setIsUsingTranscode: (value: boolean) => void
  setSmallVideoDirectPlayEnabled: (value: boolean) => void
  setMediaType: (type: MediaType) => void
  setRatingType: (type: 'media' | 'group') => void
  setCurrentRating: (rating: any) => void
  setPreloadStatus: (status: any) => void
  setCachePreloadProgress: (progress: { current: number; total: number } | null) => void
  setPreloadInsufficient: (value: boolean) => void
  setActualFoundCount: (count: number) => void
  setSnackbarMessage: (message: string) => void
  setSnackbarSeverity: (severity: 'success' | 'error' | 'info' | 'warning') => void
  setSnackbarOpen: (open: boolean) => void
  performAutoRating: () => void | Promise<void>
  loadCurrentRatingRef: MutableRefObject<(file?: MediaFile, forceType?: 'media' | 'group') => Promise<void>>
  startAutoMarkTimerRef: MutableRefObject<(file?: MediaFile, skipAutoRating?: boolean) => void>
  handleMediaTypeChangeInFullscreenRef: MutableRefObject<(nextFile: MediaFile) => boolean>
  enterVideoFullscreenRef: MutableRefObject<() => Promise<void> | void>
  isVideoRef: MutableRefObject<(filename: string) => boolean>
  saveAndSwitchRef: MutableRefObject<(switchCallback: () => void) => Promise<void> | void>
  hasAutoRatedRef: MutableRefObject<boolean>
  videoStateRef: MutableRefObject<{ currentTime: number; paused: boolean } | null>
  smallVideoDirectPlayAvailableRef: MutableRefObject<boolean>
  playIntentRef: MutableRefObject<boolean>
}

/**
 * 随机模式专属 Hook。
 *
 * 这个 Hook 只处理“随机模式自己才关心的行为”，包括：
 * - 随机文件抽取
 * - 随机历史缓存与前进/回看
 * - 基于缓存与数据库的兜底获取
 * - 随机模式专属智能预加载
 * - 浏览完后的重新开始
 *
 * 它不负责页面壳层，也不负责具体 UI 渲染。
 * 页面层 [`RandomModePage`](components/split-main/modes/RandomModePage.tsx) 只消费这里暴露出的状态和动作，
 * 以保持“模式流程”和“模式视图”分离。
 */
export function useRandomMode({
  config,
  currentFile,
  mediaUrl,
  mediaFilter,
  viewedFilter,
  advancedFilters,
  preloadRandomness,
  viewModeRef,
  setCurrentFile,
  setCurrentCreator,
  setLoading,
  setError,
  setMediaUrl,
  setTranscodeUrl,
  setOriginalStreamUrl,
  setIsUsingTranscode,
  setSmallVideoDirectPlayEnabled,
  setMediaType,
  setRatingType,
  setCurrentRating,
  setPreloadStatus,
  setCachePreloadProgress,
  setPreloadInsufficient,
  setActualFoundCount,
  setSnackbarMessage,
  setSnackbarSeverity,
  setSnackbarOpen,
  performAutoRating,
  loadCurrentRatingRef,
  startAutoMarkTimerRef,
  handleMediaTypeChangeInFullscreenRef,
  enterVideoFullscreenRef,
  isVideoRef,
  saveAndSwitchRef,
  hasAutoRatedRef,
  videoStateRef,
  smallVideoDirectPlayAvailableRef,
  playIntentRef,
}: UseRandomModeOptions) {
  // 这里仅保留随机模式专属状态与流程：
  // - 随机历史
  // - 随机抽取
  // - 历史回看/前进
  // - 随机模式的重新开始与智能预加载
  const [randomHistory, setRandomHistory] = useState<MediaFile[]>([])
  const [randomHistoryIndex, setRandomHistoryIndex] = useState<number>(-1)
  const [showRestartDialog, setShowRestartDialog] = useState(false)
  const randomHistoryCache = useRef<Map<string, RandomHistoryCacheEntry>>(new Map())
  const smartPreloadTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const smartPreloadInProgressRef = useRef(false)
  const smartPreloadRerunRequestedRef = useRef(false)
  const smartPreloadLatestFileRef = useRef<MediaFile | null>(null)
  const resumableLatestFileRef = useRef<string | null>(null)

  const buildCombinedPoolStatus = useCallback((
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

  const updatePoolStatus = useCallback((
    poolStatus?: { cacheSize: number; maxCacheSize: number } | null,
    fallbackMaxCacheSize: number = 0,
  ) => {
    if (!poolStatus && fallbackMaxCacheSize <= 0) {
      return
    }

    const nextStatus = buildCombinedPoolStatus(poolStatus, fallbackMaxCacheSize)

    setPreloadStatus(nextStatus)
    setCachePreloadProgress({
      current: nextStatus.cacheSize,
      total: nextStatus.maxCacheSize,
    })
  }, [buildCombinedPoolStatus, setCachePreloadProgress, setPreloadStatus])

  const mapRandomApiFileToMediaFile = useCallback((dbFile: any): MediaFile => ({
    id: Number.isFinite(Number(dbFile.id)) ? Number(dbFile.id) : undefined,
    filename: dbFile.filename,
    basename: dbFile.basename,
    size: dbFile.file_size || dbFile.size || 0,
    type: 'file',
    lastmod: dbFile.lastmod || '',
    mediaRatingData: dbFile.mediaRatingData ?? null,
    groupRatingData: dbFile.groupRatingData ?? null,
    creator: dbFile.creator || null,
    creatorResolved: Boolean(dbFile.creatorResolved),
  }), [])

  const requestRandomFiles = useCallback(async ({
    count,
    usePool,
    currentParentPath,
  }: {
    count: number
    usePool: boolean
    currentParentPath?: string
  }) => {
    if (!config) {
      return null
    }

    const fileTypeParam = mediaFilter === 'images' ? 'image' : mediaFilter === 'videos' ? 'video' : ''
    const isViewedParam = viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined
    const preloadCount = config.scanSettings?.preloadCount || 10
    const localViewedFileIds = viewedFilter === 'viewed'
      ? Array.from(databasePreloadManager.getLocalViewedFileIds())
      : []

    const requestOnce = async (
      randomPoolSessionId: string | null,
      allowSessionRenew: boolean,
    ): Promise<any> => {
      const response = await fetch('/api/scan-files/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdavUrl: config.url,
          webdavUsername: config.username,
          paths: config.mediaPaths,
          count,
          preloadCount,
          useRandomPool: usePool,
          randomPoolSessionId,
          randomness: preloadRandomness,
          currentParentPath: currentParentPath && preloadRandomness < 1 ? currentParentPath : undefined,
          maxFileSize: 100 * 1024 * 1024,
          fileType: fileTypeParam || undefined,
          isViewed: isViewedParam,
          excludeFileIds: localViewedFileIds.length > 0 ? localViewedFileIds : undefined,
          ...(viewedFilter === 'viewed' && {
            ratings: advancedFilters.ratings.length > 0 ? advancedFilters.ratings : undefined,
            evaluations: advancedFilters.evaluations.length > 0 ? advancedFilters.evaluations : undefined,
            categories: advancedFilters.categories.length > 0 ? advancedFilters.categories : undefined,
            reasonFilter: advancedFilters.reasonFilter !== 'all' ? advancedFilters.reasonFilter : undefined,
            reasonKeyword: advancedFilters.reasonKeyword || undefined,
            ratingEmptyFilter: advancedFilters.ratingEmptyFilter,
            evaluationEmptyFilter: advancedFilters.evaluationEmptyFilter,
            categoryEmptyFilter: advancedFilters.categoryEmptyFilter,
          }),
        }),
      })

      if (!response.ok) {
        throw new Error('获取随机文件失败')
      }

      const data = await response.json()
      if (usePool && randomPoolSessionId && randomPoolSessionId !== getRandomPoolSessionId()) {
        return { staleSession: true }
      }

      if (usePool && allowSessionRenew && data?.sessionExpired === true) {
        const activeSessionId = getRandomPoolSessionId()
        if (randomPoolSessionId && activeSessionId === randomPoolSessionId) {
          const nextRandomPoolSessionId = renewRandomPoolSessionId()
          if (nextRandomPoolSessionId && nextRandomPoolSessionId !== randomPoolSessionId) {
            console.log('[随机模式] 检测到随机缓存池会话失效，已自动续期并重试')
            return requestOnce(nextRandomPoolSessionId, false)
          }
        }
      }

      updatePoolStatus(data.poolStatus, preloadCount)
      return data
    }

    const randomPoolSessionId = usePool ? getRandomPoolSessionId() : null
    return requestOnce(randomPoolSessionId, true)
  }, [advancedFilters, config, mediaFilter, preloadRandomness, updatePoolStatus, viewedFilter])

  const clearRandomHistoryCache = useCallback(() => {
    randomHistoryCache.current.forEach((cached) => {
      URL.revokeObjectURL(cached.url)
    })
    randomHistoryCache.current.clear()
  }, [])

  const resetRandomRuntimeState = useCallback(() => {
    if (smartPreloadTimeoutRef.current) {
      clearTimeout(smartPreloadTimeoutRef.current)
      smartPreloadTimeoutRef.current = null
    }

    smartPreloadInProgressRef.current = false
    smartPreloadRerunRequestedRef.current = false
    smartPreloadLatestFileRef.current = null
    resumableLatestFileRef.current = null

    clearRandomHistoryCache()
    setRandomHistory([])
    setRandomHistoryIndex(-1)
    setShowRestartDialog(false)
    smallVideoDirectPlayAvailableRef.current = false
    setSmallVideoDirectPlayEnabled(false)
  }, [clearRandomHistoryCache, setSmallVideoDirectPlayEnabled, smallVideoDirectPlayAvailableRef])

  useEffect(() => () => {
    resetRandomRuntimeState()
  }, [resetRandomRuntimeState])

  useEffect(() => {
    resetRandomRuntimeState()
  }, [
    config?.url,
    config?.username,
    config?.mediaPaths?.join('|'),
    mediaFilter,
    viewedFilter,
    JSON.stringify(advancedFilters),
    resetRandomRuntimeState,
  ])

  /**
   * 随机模式专属播放回调：小视频播放进度更新。
   *
   * 这里只保留随机模式自己需要的行为：
   * 当播放达到阈值时触发自动评分。
   */
  const handleVideoTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    if (!video || !video.duration || !isFinite(video.duration)) return

    const progress = video.currentTime / video.duration
    if (progress >= 0.8) {
      void performAutoRating()
    }
  }, [performAutoRating])

  /**
   * 随机模式专属播放回调：媒体播放结束。
   *
   * 播放结束时直接补触一次自动评分，保持与原主页面行为一致。
   */
  const handleVideoEnded = useCallback(() => {
    void performAutoRating()
  }, [performAutoRating])

  /**
   * 随机模式智能预加载。
   *
   * 目标：在用户浏览当前随机文件后，动态补足缓存池，避免后续“换一个”时等待过久。
   * 这里会综合考虑：
   * - 当前缓存数量
   * - 正在下载数量
   * - 等待许可的任务数量
   * - 当前筛选条件与随机性参数
   *
   * 只有随机模式会用到这套“看当前文件后智能补仓”的逻辑，
   * 图组模式和大视频模式分别走自己的策略。
   */
  const smartPreload = useCallback(async (_activeFile: MediaFile) => {
    if (!config) return

    if (smartPreloadTimeoutRef.current) {
      clearTimeout(smartPreloadTimeoutRef.current)
      console.log('[智能预加载] 清除旧定时器，重新设置')
    }

    smartPreloadLatestFileRef.current = _activeFile

    smartPreloadTimeoutRef.current = setTimeout(async () => {
      if (smartPreloadInProgressRef.current) {
        smartPreloadRerunRequestedRef.current = true
        console.log('[智能预加载] 已有预加载在进行，本次请求已合并，等待当前任务完成后按最新文件重算')
        return
      }

      smartPreloadInProgressRef.current = true

      try {
        const targetFile = smartPreloadLatestFileRef.current ?? _activeFile
        const preloadCount = config.scanSettings?.preloadCount || 10
        const cacheStatus = databasePreloadManager.getCacheStatus()
        const currentCacheSize = cacheStatus.cacheSize
        const queueSize = cacheStatus.queueSize
        const pendingQueueSize = cacheStatus.pendingQueueSize || 0
        const needCount = Math.max(0, preloadCount - currentCacheSize - queueSize - pendingQueueSize)

        console.log(`[智能预加载] 动态计算：预加载总数=${preloadCount}, 当前缓存=${currentCacheSize}, 正在下载=${queueSize}, 等待许可=${pendingQueueSize}, 需要预加载=${needCount}`)

        if (needCount <= 0) {
          console.log('[智能预加载] 无需预加载，缓存充足')
          return
        }

        const currentParentPath = targetFile?.filename
          ? targetFile.filename.substring(0, targetFile.filename.lastIndexOf('/'))
          : undefined

        const data = await requestRandomFiles({
          count: needCount,
          usePool: true,
          currentParentPath,
        })

        if (data?.staleSession) {
          return
        }

        const filesToPreload = Array.isArray(data?.files)
          ? data.files.map(mapRandomApiFileToMediaFile)
          : []

        if (filesToPreload.length === 0) {
          console.log('[智能预加载] 服务端缓存池没有返回可预加载文件')
          return
        }

        await databasePreloadManager.preloadProvidedFiles(config, filesToPreload, preloadCount)
        updatePoolStatus(data?.poolStatus, preloadCount)
      } catch (error) {
        console.error('智能预加载失败:', error)
      } finally {
        smartPreloadInProgressRef.current = false

        if (smartPreloadRerunRequestedRef.current) {
          smartPreloadRerunRequestedRef.current = false
          const latestFile = smartPreloadLatestFileRef.current

          if (latestFile) {
            console.log('[智能预加载] 检测到期间有新的浏览请求，基于最新文件立即重算一次补仓')
            void smartPreload(latestFile)
          }
        }
      }
    }, 200)
  }, [config, mapRandomApiFileToMediaFile, requestRandomFiles, updatePoolStatus])

  /**
   * 从随机历史缓存中直接恢复文件。
   *
   * 这个函数只用于“回看 / 前进”历史，不会重新发起随机抽取。
   * 它依赖之前已经写入 [`randomHistoryCache`](app/split-main/random/useRandomMode.ts:113)
   * 的 Blob、媒体类型与播放地址信息，实现真正的“秒切回看”。
   */
  const loadFileDirectly = useCallback(async (fileToLoad: MediaFile, suppressAutoRating: boolean = true) => {
    hasAutoRatedRef.current = false
    videoStateRef.current = null

    // 历史回看仍然走“完整装载流程”，但数据来源优先使用随机历史内存缓存，
    // 避免回看时重复向后端请求同一文件。
    setLoading(true)
    setError(null)

    try {
      const cachedData = randomHistoryCache.current.get(fileToLoad.filename)

      if (!cachedData) {
        console.error(`[历史回看错误] 缓存中没有找到文件: ${fileToLoad.basename}`)
        setError('历史缓存丢失，无法回看此文件')
        setLoading(false)
        return
      }

      const normalizedFileToLoad = patchMediaFileCreatorMetadata(
        fileToLoad,
        cachedData.creator,
        cachedData.creatorResolved,
      )
      const shouldEnterVideoFullscreen = handleMediaTypeChangeInFullscreenRef.current(normalizedFileToLoad)

      setCurrentFile(normalizedFileToLoad)
      setCurrentCreator(normalizedFileToLoad.creator ?? null)

      console.log(`[历史回看] 从内存缓存加载: ${fileToLoad.basename}`)
      const url = URL.createObjectURL(cachedData.blob)

      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
        console.log(`[URL清理] 历史导航时释放旧URL`)
      }

      setMediaUrl(url)
      setMediaType(cachedData.mediaType)
      setOriginalStreamUrl(cachedData.originalStreamUrl)
      setTranscodeUrl(null)
      setIsUsingTranscode(false)

      const directPlayAvailable = Boolean(cachedData.directPlayAvailable)
      smallVideoDirectPlayAvailableRef.current = directPlayAvailable
      setSmallVideoDirectPlayEnabled(directPlayAvailable)

      if (shouldEnterVideoFullscreen && cachedData.mediaType !== 'image') {
        setTimeout(() => {
          void enterVideoFullscreenRef.current()
        }, 100)
      }

      setRatingType('media')
      await loadCurrentRatingRef.current(normalizedFileToLoad, 'media')
      startAutoMarkTimerRef.current(normalizedFileToLoad, suppressAutoRating)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [
    enterVideoFullscreenRef,
    handleMediaTypeChangeInFullscreenRef,
    hasAutoRatedRef,
    loadCurrentRatingRef,
    mediaUrl,
    setCurrentCreator,
    setCurrentFile,
    setError,
    setIsUsingTranscode,
    setLoading,
    setMediaType,
    setMediaUrl,
    setOriginalStreamUrl,
    setRatingType,
    setSmallVideoDirectPlayEnabled,
    setTranscodeUrl,
    smallVideoDirectPlayAvailableRef,
    startAutoMarkTimerRef,
    videoStateRef,
  ])

  /**
   * 随机加载下一个文件。
   *
   * 整体策略分为两层：
   * 1. 优先从预加载缓存里挑选当前仍可用、且未被本地标记为已看过的文件
   * 2. 如果缓存不可用，再退回数据库随机接口获取一个新文件
   *
   * 加载成功后，会同步完成：
   * - 当前媒体设置
   * - 随机历史写入
   * - Blob URL 管理
   * - 小视频/图片类型识别
   * - 评分与自动标记接线
   * - 下一轮智能预加载触发
   */
  const loadRandomFile = useCallback(async (isNavigatingHistory: boolean = false) => {
    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }

    console.log(`[DEBUG] loadRandomFile 开始，筛选条件: viewedFilter=${viewedFilter}, mediaFilter=${mediaFilter}, usePool=true`)
    console.log(`[DEBUG] 历史导航模式: ${isNavigatingHistory}`)

    if (!isNavigatingHistory && currentFile) {
      databasePreloadManager.addLocalViewedFile(currentFile)
    }

    let fileToLoad: MediaFile | null = null
    let preloadedBlob: Blob | null = null

    const cachedFilepath = databasePreloadManager.getRandomCachedFile()
    if (cachedFilepath) {
      const cachedFile = databasePreloadManager.takePreloadedFile(cachedFilepath)
      if (cachedFile) {
        fileToLoad = {
          id: cachedFile.id,
          filename: cachedFile.filepath,
          basename: cachedFile.filepath.substring(cachedFile.filepath.lastIndexOf('/') + 1),
          size: cachedFile.size,
          type: 'file',
          lastmod: cachedFile.lastmod,
          mediaRatingData: cachedFile.mediaRatingData ?? null,
          groupRatingData: cachedFile.groupRatingData ?? null,
          creator: cachedFile.creator || null,
          creatorResolved: Boolean(cachedFile.creatorResolved),
        }
        preloadedBlob = cachedFile.blob
        console.log(`[DEBUG] 从客户端预加载缓存中选择文件: ${fileToLoad.basename}`)

        const preloadCount = config.scanSettings?.preloadCount || 10
        updatePoolStatus(null, preloadCount)
      }
    }

    if (!fileToLoad) {
      console.log('[DEBUG] 通过服务端随机缓存池/随机接口获取文件')

      try {
        const currentParentPath = currentFile?.filename
          ? currentFile.filename.substring(0, currentFile.filename.lastIndexOf('/'))
          : undefined

        const data = await requestRandomFiles({
          count: 1,
          usePool: true,
          currentParentPath,
        })

        if (data?.staleSession) {
          return
        }

        if (data?.files && data.files.length > 0) {
          fileToLoad = mapRandomApiFileToMediaFile(data.files[0])
          console.log(`[DEBUG] 从服务端随机池获取文件: ${fileToLoad.basename}`)
        } else if (data?.allViewed && viewedFilter === 'viewed') {
          console.log('[DEBUG] 已消费完所有符合条件的文件，显示重新开始对话框')
          setShowRestartDialog(true)
          setLoading(false)
          return
        }
      } catch (e) {
        console.error('获取随机文件失败:', e)
      }

      if (!fileToLoad) {
        const filterMsg = viewedFilter === 'viewed' ? '已看过' : viewedFilter === 'unviewed' ? '未看过' : '全部'
        const mediaMsg = mediaFilter === 'images' ? '图片' : mediaFilter === 'videos' ? '视频' : '媒体'
        setError(`没有找到符合条件的${mediaMsg}文件（${filterMsg}）`)
        return
      }
    }

    if (!fileToLoad) {
      setError('随机选择文件失败')
      return
    }

    // 每次真正切到一个新的随机文件，都要清空“临时回看后可恢复自动评分”的标记，
    // 因为一旦进入新的随机文件，旧的最新文件就不再属于“只是临时回看后返回”的场景。
    resumableLatestFileRef.current = null

    // 每次真正切到一个新的随机文件，都要清理自动评分与视频续播状态，
    // 避免把上一个文件的播放上下文误带到当前文件。
    hasAutoRatedRef.current = false
    videoStateRef.current = null

    const shouldEnterVideoFullscreen = handleMediaTypeChangeInFullscreenRef.current(fileToLoad)

    setLoading(true)
    setError(null)

    try {
      setCurrentFile(fileToLoad)
      setCurrentCreator(fileToLoad.creator ?? null)

      let blob = preloadedBlob
      if (blob) {
        console.log(`使用预加载文件: ${fileToLoad.basename}`)
      } else {
        console.log('正在使用正常加载...')
        const streamResponse = await scheduleStreamRequest(() => fetch('/api/webdav/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...config,
            filepath: fileToLoad.filepath || fileToLoad.filename,
          }),
        }))

        if (!streamResponse.ok) throw new Error('获取文件流失败')
        blob = await streamResponse.blob()
      }

      const url = URL.createObjectURL(blob)
      const isSmallVideoTarget = isVideoRef.current(fileToLoad.filename)
      const isMediumSizedVideo = isSmallVideoTarget && fileToLoad.size > 10 * 1024 * 1024 && fileToLoad.size <= 100 * 1024 * 1024

      setTranscodeUrl(null)
      setIsUsingTranscode(false)
      smallVideoDirectPlayAvailableRef.current = false
      setSmallVideoDirectPlayEnabled(false)

      if (!isNavigatingHistory) {
        // 只有“新随机文件”才会写入随机历史；
        // 如果当前是历史导航，则只恢复历史，不重复污染历史队列。
        const currentMediaType: MediaType = isSmallVideoTarget ? 'small-video' : 'image'
        const currentOriginalStreamUrl = isSmallVideoTarget
          ? (config && config.enableDirectLink && config.directLinkUrl
              ? new URL(`/d${fileToLoad.filename.split('/').map(segment => segment.replace(/／/g, '|')).join('/')}`, window.location.origin).href
              : new URL(`/api/webdav/instant-stream?${new URLSearchParams({
                  url: config.url,
                  username: config.username,
                  password: config.password,
                  filepath: fileToLoad.filename,
                  sourceType: config.sourceType || 'clouddrive2',
                }).toString().replace(/\+/g, '%20')}`, window.location.origin).href)
          : null

        randomHistoryCache.current.set(fileToLoad.filename, {
          url,
          blob,
          mediaType: currentMediaType,
          originalStreamUrl: currentOriginalStreamUrl,
          directPlayAvailable: isMediumSizedVideo && Boolean(config?.enableDirectLink && config?.directLinkUrl),
          creator: fileToLoad.creator ?? null,
          creatorResolved: Boolean(fileToLoad.creatorResolved),
        })
        console.log(`[历史缓存] 保存当前文件: ${fileToLoad.basename}`)

        if (mediaUrl) {
          URL.revokeObjectURL(mediaUrl)
          console.log(`[URL清理] 释放旧URL`)
        }

        setRandomHistory(prev => {
          const newHistory = [...prev, fileToLoad!]
          return newHistory.length > 4 ? newHistory.slice(-4) : newHistory
        })
        setRandomHistoryIndex(-1)

        const cacheKeys = Array.from(randomHistoryCache.current.keys())
        if (cacheKeys.length > 4) {
          // 随机模式历史回看只保留最近 4 个，避免 Blob 持续累积导致内存增长。
          const keysToRemove = cacheKeys.slice(0, cacheKeys.length - 4)
          keysToRemove.forEach(key => {
            const cached = randomHistoryCache.current.get(key)
            if (cached) {
              URL.revokeObjectURL(cached.url)
              randomHistoryCache.current.delete(key)
              console.log(`[历史缓存] 清理旧缓存: ${key}`)
            }
          })
        }
      }

      setMediaUrl(url)

      if (isSmallVideoTarget) {
        setMediaType('small-video')

        if (config && config.enableDirectLink && config.directLinkUrl) {
          const processedPath = fileToLoad.filename
            .split('/')
            .map(segment => segment.replace(/／/g, '|'))
            .join('/')
          const directLinkUrl = `/d${processedPath}`
          const fullDirectLinkUrl = new URL(directLinkUrl, window.location.origin).href
          setOriginalStreamUrl(fullDirectLinkUrl)

          if (isMediumSizedVideo) {
            smallVideoDirectPlayAvailableRef.current = true
            setSmallVideoDirectPlayEnabled(true)
          }
        } else {
          const streamParams = new URLSearchParams({
            url: config.url,
            username: config.username,
            password: config.password,
            filepath: fileToLoad.filename,
            sourceType: config.sourceType || 'clouddrive2',
          })
          const streamUrl = `/api/webdav/instant-stream?${streamParams.toString().replace(/\+/g, '%20')}`
          const fullStreamUrl = new URL(streamUrl, window.location.origin).href
          setOriginalStreamUrl(fullStreamUrl)
        }
      } else {
        setMediaType('image')
        setOriginalStreamUrl(null)
      }

      if (shouldEnterVideoFullscreen && isSmallVideoTarget) {
        setTimeout(() => {
          void enterVideoFullscreenRef.current()
        }, 100)
      }

      setRatingType('media')

      if (viewedFilter !== 'unviewed') {
        await loadCurrentRatingRef.current(fileToLoad, 'media')
      } else {
        setCurrentRating(null)
      }

      startAutoMarkTimerRef.current(fileToLoad)
      void smartPreload(fileToLoad)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [
    advancedFilters,
    config,
    hasAutoRatedRef,
    handleMediaTypeChangeInFullscreenRef,
    isVideoRef,
    loadCurrentRatingRef,
    mediaFilter,
    mediaUrl,
    setCurrentCreator,
    setCurrentFile,
    setCurrentRating,
    setError,
    setIsUsingTranscode,
    setLoading,
    setMediaType,
    setMediaUrl,
    setOriginalStreamUrl,
    setRatingType,
    setSmallVideoDirectPlayEnabled,
    setTranscodeUrl,
    smallVideoDirectPlayAvailableRef,
    smartPreload,
    startAutoMarkTimerRef,
    videoStateRef,
    viewedFilter,
    currentFile,
    enterVideoFullscreenRef,
    mapRandomApiFileToMediaFile,
    requestRandomFiles,
    updatePoolStatus,
  ])

  /**
   * 回看上一个随机文件。
   *
   * 这里通过负索引来表示“距离最新位置往前回退了多少步”，
   * 然后结合 [`randomHistory`](app/split-main/random/useRandomMode.ts:110)
   * 反推目标文件位置。
   */
  const loadPreviousRandomFile = useCallback(() => {
    if (randomHistory.length === 0) {
      console.log('[回看] 没有历史记录')
      return
    }

    if (randomHistoryIndex === -1 && currentFile) {
      // 仅记录“离开最新文件去回看历史”的场景。
      // 这样 4(未自动评分) → 回看 3 → 再回到 4 时，可以恢复 4 的自动评分；
      // 但 3 → 2 → 再回到 3 这种普通历史文件前进，不会被当成可恢复对象。
      resumableLatestFileRef.current = hasAutoRatedRef.current ? null : currentFile.filename
    }

    const newIndex = randomHistoryIndex - 1
    const targetIndex = randomHistory.length + newIndex

    if (targetIndex < 0) {
      console.log('[回看] 已经是最早的记录')
      return
    }

    const fileToLoad = randomHistory[targetIndex]
    console.log(`[回看] 加载历史文件: ${fileToLoad.basename}, 索引: ${newIndex}`)

    playIntentRef.current = true
    setRandomHistoryIndex(newIndex)
    // 回看旧历史时仍然禁止自动补 2 星，避免纯浏览历史时误触发自动评分。
    void loadFileDirectly(fileToLoad, true)
  }, [currentFile, hasAutoRatedRef, loadFileDirectly, playIntentRef, randomHistory, randomHistoryIndex])

  /**
   * 从历史位置前进。
   *
   * 这里分三种场景：
   * - 当前就在最新位置：继续抽取新的随机文件
   * - 前进后刚好回到最新位置：恢复最后一个历史文件
   * - 仍在历史区间内：恢复对应的历史缓存文件
   */
  const loadNextRandomFile = useCallback(() => {
    if (randomHistoryIndex === -1) {
      console.log('[前进] 已在最新位置，加载新文件')
      void saveAndSwitchRef.current(() => {
        void loadRandomFile(false)
      })
      return
    }

    const newIndex = randomHistoryIndex + 1

    if (newIndex === -1) {
      const fileToLoad = randomHistory[randomHistory.length - 1]
      console.log(`[前进] 回到最新位置，加载文件: ${fileToLoad.basename}`)
      const shouldResumeAutoRating = resumableLatestFileRef.current === fileToLoad.filename

      playIntentRef.current = true
      setRandomHistoryIndex(-1)
      resumableLatestFileRef.current = null
      // 只有“从最新文件临时回看出去，且该最新文件离开前尚未自动评分”时，
      // 才在回到最新位置后恢复自动评分。
      void loadFileDirectly(fileToLoad, !shouldResumeAutoRating)
      return
    }

    const targetIndex = randomHistory.length + newIndex
    const fileToLoad = randomHistory[targetIndex]
    console.log(`[前进] 加载历史文件: ${fileToLoad.basename}, 索引: ${newIndex}`)

    playIntentRef.current = true
    setRandomHistoryIndex(newIndex)
    // 仍处于旧历史区间时，继续保持自动评分抑制。
    void loadFileDirectly(fileToLoad, true)
  }, [loadFileDirectly, loadRandomFile, playIntentRef, randomHistory, randomHistoryIndex, saveAndSwitchRef])

  /**
   * 随机模式“重新开始”处理。
   *
   * 当用户已经浏览完所有符合条件的文件后：
   * - 清空本地已看记录
   * - 清空预加载缓存
   * - 按当前筛选重新填充缓存
   * - 等待缓存准备完成后立刻重新抽取一个随机文件
   */
  const handleRestartViewing = useCallback(async () => {
    setShowRestartDialog(false)

    if (!config) return

    databasePreloadManager.clearLocalViewedFiles()
    console.log('[重新开始] 已清空本地已看过文件列表')

    databasePreloadManager.clearCache()
    console.log('[重新开始] 已清空客户端随机缓存')

    const preloadCount = config.scanSettings?.preloadCount || 10
    const filters = viewedFilter === 'viewed' ? advancedFilters : undefined

    setLoading(true)
    setCachePreloadProgress({ current: 0, total: preloadCount })

    try {
      const previousRandomPoolSessionId = peekRandomPoolSessionId()
      if (previousRandomPoolSessionId) {
        await clearRandomPoolSession(previousRandomPoolSessionId)
      }

      const randomPoolSessionId = renewRandomPoolSessionId()
      if (!randomPoolSessionId) {
        throw new Error('缺少 randomPoolSessionId')
      }

      const result = await initializeRandomPoolSession({
        webdavUrl: config.url,
        webdavUsername: config.username,
        paths: config.mediaPaths,
        preloadCount,
        randomness: preloadRandomness,
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

      if (!result.hasData) {
        const message = result.message || '数据尚未迁移，请先执行迁移'
        updatePoolStatus(result.poolStatus, preloadCount)
        setError(message)
        setSnackbarMessage(message)
        setSnackbarSeverity('warning')
        setSnackbarOpen(true)
        return
      }

      if ((result.actualCount || 0) <= 0) {
        const message = result.message || '未找到符合条件的文件'
        updatePoolStatus(result.poolStatus, preloadCount)
        setPreloadInsufficient(true)
        setActualFoundCount(0)
        setError(message)
        setSnackbarMessage(message)
        setSnackbarSeverity('info')
        setSnackbarOpen(true)
        return
      }

      setPreloadInsufficient(false)
      setActualFoundCount(0)

      console.log('[重新开始] API 返回，实际找到:', result.actualCount, '个文件')
      let latestPoolStatus = result.poolStatus

      const prewarmData = await requestRandomFiles({
        count: preloadCount,
        usePool: true,
      })

      if (prewarmData?.staleSession) {
        return
      }

      const filesToPreload = Array.isArray(prewarmData?.files)
        ? prewarmData.files.map(mapRandomApiFileToMediaFile)
        : []

      await databasePreloadManager.preloadProvidedFiles(config, filesToPreload, preloadCount)
      latestPoolStatus = prewarmData?.poolStatus || latestPoolStatus

      updatePoolStatus(latestPoolStatus, preloadCount)

      const clientCacheStatus = databasePreloadManager.getCacheStatus()
      const clientInsufficient = clientCacheStatus.cacheSize < preloadCount
      setPreloadInsufficient(clientInsufficient)
      setActualFoundCount(clientCacheStatus.cacheSize)

      if (databasePreloadManager.getCachedFilepaths().length > 0 || (latestPoolStatus?.cacheSize || 0) > 0) {
        await loadRandomFile()
        setSnackbarMessage('🔄 已重新开始，文件顺序已重新随机')
        setSnackbarSeverity('success')
        setSnackbarOpen(true)
      } else {
        console.error('[重新开始] 等待超时，缓存仍为空')
        setError('重新开始失败：文件加载超时')
        setSnackbarMessage('重新开始失败：文件加载超时')
        setSnackbarSeverity('error')
        setSnackbarOpen(true)
      }
    } catch (error) {
      console.error('[重新开始] 失败:', error)
      setSnackbarMessage('重新开始失败')
      setSnackbarSeverity('error')
      setSnackbarOpen(true)
    } finally {
      setLoading(false)
    }
  }, [
    advancedFilters,
    config,
    loadRandomFile,
    mediaFilter,
    preloadRandomness,
    mapRandomApiFileToMediaFile,
    requestRandomFiles,
    updatePoolStatus,
    setActualFoundCount,
    setCachePreloadProgress,
    setError,
    setLoading,
    setPreloadInsufficient,
    setSnackbarMessage,
    setSnackbarOpen,
    setSnackbarSeverity,
    viewedFilter,
  ])

  const handleCancelRestart = useCallback(() => {
    setShowRestartDialog(false)
  }, [])

  const updateRandomHistoryCreatorMetadata = useCallback((
    filepath: string,
    creator: CreatorSummary | null,
    creatorResolved: boolean,
  ) => {
    setRandomHistory((prev) => prev.map((file) => (
      file.filename === filepath
        ? patchMediaFileCreatorMetadata(file, creator, creatorResolved)
        : file
    )))

    const cached = randomHistoryCache.current.get(filepath)
    if (cached) {
      randomHistoryCache.current.set(filepath, {
        ...cached,
        creator,
        creatorResolved,
      })
    }
  }, [])

  const updateRandomHistoryRatingMetadata = useCallback((filepath: string, rating: MediaFile['mediaRatingData']) => {
    setRandomHistory((prev) => prev.map((file) => (
      file.filename === filepath
        ? {
            ...file,
            mediaRatingData: rating,
          }
        : file
    )))

    const cached = randomHistoryCache.current.get(filepath)
    if (cached) {
      randomHistoryCache.current.set(filepath, {
        ...cached,
      })
    }
  }, [])

  /**
   * 统一暴露给随机模式页面的状态与动作集合。
   * 页面层不关心内部缓存细节，只消费这里的输出。
   */
  return {
    randomHistory,
    randomHistoryIndex,
    showRestartDialog,
    setShowRestartDialog,
    handleVideoTimeUpdate,
    handleVideoEnded,
    loadRandomFile,
    loadPreviousRandomFile,
    loadNextRandomFile,
    handleRestartViewing,
    handleCancelRestart,
    updateRandomHistoryCreatorMetadata,
    updateRandomHistoryRatingMetadata,
  }
}
