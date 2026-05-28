import { useCallback, type MutableRefObject } from 'react'

import databasePreloadManager from '@/lib/databasePreloadManager'
import { getPlaybackStrategy } from '@/lib/videoFormat'
import type { AdvancedFilters, MediaFile, MediaType, ViewedFilter, WebDAVConfig } from '@/types'

interface UseLargeVideoModeOptions {
  config: WebDAVConfig | null
  currentFile: MediaFile | null
  mediaUrl: string | null
  viewedFilter: ViewedFilter
  preloadRandomness: number
  advancedFilters: AdvancedFilters
  instantVideoRef: MutableRefObject<any>
  hasAutoRatedRef: MutableRefObject<boolean>
  videoStateRef: MutableRefObject<{ currentTime: number; paused: boolean } | null>
  handleMediaTypeChangeInFullscreenRef: MutableRefObject<(nextFile: MediaFile) => boolean>
  enterVideoFullscreenRef: MutableRefObject<() => Promise<void> | void>
  loadCurrentRatingRef: MutableRefObject<(file?: MediaFile, forceType?: 'media' | 'group') => Promise<void>>
  startAutoMarkTimerRef: MutableRefObject<(file?: MediaFile, skipAutoRating?: boolean) => void>
  setCurrentFile: (file: MediaFile | null) => void
  setCurrentCreator: (creator: any) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setMediaUrl: (url: string | null) => void
  setTranscodeUrl: (url: string | null) => void
  setOriginalStreamUrl: (url: string | null) => void
  setIsUsingTranscode: (value: boolean) => void
  setMediaType: (type: MediaType) => void
  setRatingType: (type: 'media' | 'group') => void
  setCurrentRating: (rating: any) => void
}

/**
 * 大视频模式专属 Hook。
 *
 * 它只关心“大视频模式自己的取数与播放地址准备流程”，包括：
 * - 从数据库按“大于 100MB 的视频”进行随机抽取
 * - 根据格式与配置决定走直链、即时流还是转码流
 * - 清理旧的大视频播放连接
 * - 完成评分与自动标记接线
 *
 * 页面层 [`LargeVideoModePage`](components/split-main/modes/LargeVideoModePage.tsx) 只负责 UI、手势、精彩时刻模块与操作面板。
 */
export function useLargeVideoMode({
  config,
  currentFile,
  mediaUrl,
  viewedFilter,
  preloadRandomness,
  advancedFilters,
  instantVideoRef,
  hasAutoRatedRef,
  videoStateRef,
  handleMediaTypeChangeInFullscreenRef,
  enterVideoFullscreenRef,
  loadCurrentRatingRef,
  startAutoMarkTimerRef,
  setCurrentFile,
  setCurrentCreator,
  setLoading,
  setError,
  setMediaUrl,
  setTranscodeUrl,
  setOriginalStreamUrl,
  setIsUsingTranscode,
  setMediaType,
  setRatingType,
  setCurrentRating,
}: UseLargeVideoModeOptions) {
  /**
   * 清理当前流式大视频连接。
   *
   * 大视频模式和小视频模式不同，通常直接挂流地址到播放器，
   * 因此切换前必须尽量显式断开旧连接，避免浏览器继续占用网络与解码资源。
   */
  const cleanupCurrentStreamVideo = useCallback(() => {
    if (!instantVideoRef.current) return

    const videoElement = instantVideoRef.current.getVideoElement?.()
    if (!videoElement) return

    console.log('🧹 [清理] 停止当前流式视频播放')
    videoElement.pause()
    videoElement.src = ''
    videoElement.load()
    console.log('✅ [清理] 已释放流式视频连接')
  }, [instantVideoRef])

  /**
   * 大视频模式核心加载入口。
   *
   * 主要步骤：
   * 1. 清理旧播放器连接与缓存
   * 2. 以“大于 100MB 的视频文件”为条件调用随机接口
   * 3. 基于当前配置决定走直链还是 WebDAV 即时流
   * 4. 根据格式策略决定是否优先转码
   * 5. 完成评分加载、自动标记和全屏联动
   */
  const loadLargeVideoFile = useCallback(async () => {
    console.log(`[大视频模式] 开始加载，筛选条件: ${viewedFilter}，随机性: ${preloadRandomness}`)
    console.log(`[大视频模式] 当前缓存文件数量: ${databasePreloadManager.getCachedFilepaths().length}`)

    if (currentFile) {
      databasePreloadManager.addLocalViewedFile(currentFile)
    }

    cleanupCurrentStreamVideo()

    // 大视频模式不依赖小文件预加载缓存；
    // 进入时如果发现缓存里还有旧内容，直接清空，避免和随机/图组模式产生干扰。
    if (databasePreloadManager.getCachedFilepaths().length > 0) {
      console.log('[大视频模式] 检测到缓存文件，强制清空')
      databasePreloadManager.clearCache()
    }

    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }

    const minVideoSize = 100 * 1024 * 1024

    try {
      const isViewedParam = viewedFilter === 'viewed' ? true : viewedFilter === 'unviewed' ? false : undefined
      const currentParentPath = currentFile
        ? currentFile.filename.substring(0, currentFile.filename.lastIndexOf('/'))
        : ''
      const localViewedFileIds = Array.from(databasePreloadManager.getLocalViewedFileIds())

      const response = await fetch('/api/scan-files/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdavUrl: config.url,
          webdavUsername: config.username,
          paths: config.mediaPaths,
          count: 1,
          fileType: 'video',
          minFileSize: minVideoSize,
          randomness: preloadRandomness,
          isViewed: isViewedParam,
          currentParentPath: currentParentPath && preloadRandomness < 1 ? currentParentPath : undefined,
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
        throw new Error('获取大视频文件失败')
      }

      const data = await response.json()
      if (!data.files || data.files.length === 0) {
        const filterMsg = viewedFilter === 'viewed' ? '已看过' : viewedFilter === 'unviewed' ? '未看过' : '全部'
        setError(`没有找到符合条件的大视频文件（${filterMsg}，>100MB）`)
        return
      }

      const dbFile = data.files[0]
      const fileToLoad: MediaFile = {
        id: Number.isFinite(Number(dbFile.id)) ? Number(dbFile.id) : undefined,
        filename: dbFile.filename,
        basename: dbFile.basename,
        size: dbFile.file_size || 0,
        type: 'file',
        lastmod: dbFile.lastmod || '',
        mediaRatingData: dbFile.mediaRatingData ?? null,
        groupRatingData: dbFile.groupRatingData ?? null,
        creator: dbFile.creator || null,
        creatorResolved: Boolean(dbFile.creatorResolved),
      }

      console.log(`[大视频模式] 从数据库获取: ${fileToLoad.basename}`)

      hasAutoRatedRef.current = false
      videoStateRef.current = null

      const shouldEnterVideoFullscreen = handleMediaTypeChangeInFullscreenRef.current(fileToLoad)

      setLoading(true)
      setError(null)
      setCurrentFile(fileToLoad)
      setCurrentCreator(fileToLoad.creator ?? null)

      // 如果已经配置直链能力，则大视频优先直接走直链，
      // 这样可以最大限度利用浏览器原生流式能力，减少中转开销。
      if (config.enableDirectLink && config.directLinkUrl) {
        const processedPath = fileToLoad.filename
          .split('/')
          .map((segment) => segment.replace(/／/g, '|'))
          .join('/')
        const directLinkUrl = `/d${processedPath}`

        setTranscodeUrl(null)
        setIsUsingTranscode(false)
        setMediaUrl(directLinkUrl)
        setOriginalStreamUrl(new URL(directLinkUrl, window.location.origin).href)
        setMediaType('stream-video')
        setLoading(false)

        if (shouldEnterVideoFullscreen) {
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
        return
      }

      // 没有直链时，退回 WebDAV 即时流；
      // 再根据格式策略决定是否优先转码，或者把转码流作为兜底地址备用。
      const playbackStrategy = getPlaybackStrategy(fileToLoad.filename)
      const streamParams = new URLSearchParams({
        url: config.url,
        username: config.username,
        password: config.password,
        filepath: fileToLoad.filename,
        sourceType: config.sourceType || 'clouddrive2',
      })
      const streamUrl = `/api/webdav/instant-stream?${streamParams.toString().replace(/\+/g, '%20')}`

      const transcodeParams = new URLSearchParams({
        url: config.url,
        username: config.username,
        password: config.password,
        filepath: fileToLoad.filename,
        sourceType: config.sourceType || 'clouddrive2',
        format: 'mp4',
        quality: 'high',
      })
      const transcodeStreamUrl = `/api/webdav/transcode-stream?${transcodeParams.toString().replace(/\+/g, '%20')}`

      let finalUrl: string
      let finalTranscodeUrl: string | null = null

      if (playbackStrategy === 'transcode') {
        finalUrl = transcodeStreamUrl
        setIsUsingTranscode(true)
      } else {
        finalUrl = streamUrl
        finalTranscodeUrl = transcodeStreamUrl
        setIsUsingTranscode(false)
      }

      if (mediaUrl && mediaUrl.startsWith('blob:')) {
        URL.revokeObjectURL(mediaUrl)
      }

      setMediaUrl(finalUrl)
      setTranscodeUrl(finalTranscodeUrl)
      setOriginalStreamUrl(new URL(streamUrl, window.location.origin).href)
      setMediaType('stream-video')

      if (shouldEnterVideoFullscreen) {
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
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [
    advancedFilters,
    cleanupCurrentStreamVideo,
    config,
    currentFile,
    enterVideoFullscreenRef,
    handleMediaTypeChangeInFullscreenRef,
    hasAutoRatedRef,
    loadCurrentRatingRef,
    mediaUrl,
    preloadRandomness,
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
    setTranscodeUrl,
    startAutoMarkTimerRef,
    videoStateRef,
    viewedFilter,
  ])

  /**
   * 只向页面层暴露大视频模式真正需要的入口，
   * 避免页面组件直接接触内部取数与流地址组装细节。
   */
  return {
    loadLargeVideoFile,
  }
}

