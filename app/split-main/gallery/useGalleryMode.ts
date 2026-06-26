import { useCallback, useState, type MutableRefObject } from 'react'

import { fetchWithTimeout } from '@/lib/clientFetch'
import { resolveMergedMediaFile } from '@/lib/creatorMergeSession'
import databasePreloadManager from '@/lib/databasePreloadManager'
import { scheduleStreamRequest } from '@/lib/clientRequestScheduler'
import type { AdvancedFilters, CreatorSummary, MediaFile, MediaType, ViewedFilter, WebDAVConfig } from '@/types'

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

interface UseGalleryModeOptions {
  config: WebDAVConfig | null
  currentFile: MediaFile | null
  mediaUrl: string | null
  viewedFilter: ViewedFilter
  advancedFilters: AdvancedFilters
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
 * 图组模式专属 Hook。
 *
 * 这个 Hook 只处理图组模式自己的数据流与切换流程：
 * - 当前图组与当前索引状态
 * - 从图组中加载指定文件
 * - 在图组内前进 / 后退
 * - 切换到下一组图组
 *
 * 页面层 [`GalleryModePage`](components/split-main/modes/GalleryModePage.tsx) 只负责图组模式 UI，
 * 而具体“组”的取数和媒体装载都集中在这里。
 */
export function useGalleryMode({
  config,
  currentFile,
  mediaUrl,
  viewedFilter,
  advancedFilters,
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
}: UseGalleryModeOptions) {
  const [currentGroup, setCurrentGroup] = useState<MediaFile[]>([])
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0)

  /**
   * 从当前图组中加载指定索引的文件。
   *
   * 它是图组模式最核心的装载入口，负责：
   * - 从预加载缓存 / 等待中的预加载 / 普通流请求中拿到 Blob
   * - 设置当前媒体类型（图片或小视频）
   * - 处理图组模式下的小视频直链按钮
   * - 加载媒体评分与自动标记
   * - 在浏览超过阈值时继续预加载当前图组剩余文件
   */
  const loadFileFromGroup = useCallback(async (group: MediaFile[], index: number) => {
    if (index < 0 || index >= group.length) return

    if (!config) {
      setError('请先配置WebDAV连接')
      return
    }

    // 图组里的文件可能来自前端缓存组、服务端预热组或上一轮已拿到的旧对象；
    // 在真正切到当前文件之前统一做一次归一化，确保展示的是合并后的目标博主。
    const file = resolveMergedMediaFile(group[index])

    hasAutoRatedRef.current = false
    videoStateRef.current = null

    const shouldEnterVideoFullscreen = handleMediaTypeChangeInFullscreenRef.current(file)

    setLoading(true)
    setError(null)

    try {
      setCurrentFile(file)
      setCurrentCreator(file.creator ?? null)
      setCurrentGroupIndex(index)

      // 图组模式优先使用预加载数据，保证组内切换足够平滑；
      // 如果文件正在预加载，则等待预加载完成；
      // 再不行才回退到普通流式请求。
      let preloadedBlob = databasePreloadManager.getPreloadedFile(file.filename)

      let blob: Blob
      if (preloadedBlob) {
        blob = preloadedBlob
        console.log(`[DEBUG] 图组模式使用预加载文件: ${file.basename}`)
      } else if (databasePreloadManager.isPreloading(file.filename)) {
        console.log(`[DEBUG] 图组模式文件正在预加载中，等待完成: ${file.basename}`)
        preloadedBlob = await databasePreloadManager.waitForPreload(file.filename)

        if (preloadedBlob) {
          blob = preloadedBlob
          console.log(`[DEBUG] 图组模式预加载完成，使用缓存文件: ${file.basename}`)
        } else {
          console.log(`[DEBUG] 图组模式预加载等待超时，正常加载: ${file.basename}`)
          const streamResponse = await scheduleStreamRequest(() => fetchWithTimeout('/api/webdav/stream', {
            timeoutMs: 15_000,
            timeoutMessage: '获取文件流超时（15s）',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...config,
              filepath: file.filename,
            }),
          }))

          if (!streamResponse.ok) throw new Error('获取文件流失败')
          blob = await streamResponse.blob()

          databasePreloadManager.addToCacheDirectly(file.filename, blob, file.size, file.lastmod, file.creator, Boolean(file.creatorResolved))
          setPreloadStatus(databasePreloadManager.getCacheStatus())
        }
      } else {
        console.log(`[DEBUG] 图组模式文件不在预加载缓存中，正常加载: ${file.basename}`)
        const streamResponse = await scheduleStreamRequest(() => fetchWithTimeout('/api/webdav/stream', {
          timeoutMs: 15_000,
          timeoutMessage: '获取文件流超时（15s）',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...config,
            filepath: file.filename,
          }),
        }))

        if (!streamResponse.ok) throw new Error('获取文件流失败')
        blob = await streamResponse.blob()

        databasePreloadManager.addToCacheDirectly(file.filename, blob, file.size, file.lastmod, file.creator, Boolean(file.creatorResolved))
        setPreloadStatus(databasePreloadManager.getCacheStatus())
      }

      const url = URL.createObjectURL(blob)
      const isSmallVideoTarget = isVideoRef.current(file.filename)
      const isMediumSizedVideo =
        isSmallVideoTarget && file.size > 10 * 1024 * 1024 && file.size <= 100 * 1024 * 1024

      setTranscodeUrl(null)
      setIsUsingTranscode(false)
      smallVideoDirectPlayAvailableRef.current = false
      setSmallVideoDirectPlayEnabled(false)

      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
      }

      setMediaUrl(url)

      if (isSmallVideoTarget) {
        setMediaType('small-video')

        if (config.enableDirectLink && config.directLinkUrl) {
          const processedPath = file.filename
            .split('/')
            .map((segment) => segment.replace(/／/g, '|'))
            .join('/')
          const directLinkUrl = `/d${processedPath}`
          setOriginalStreamUrl(new URL(directLinkUrl, window.location.origin).href)

          if (isMediumSizedVideo) {
            smallVideoDirectPlayAvailableRef.current = true
            setSmallVideoDirectPlayEnabled(true)
          }
        } else {
          const streamParams = new URLSearchParams({
            url: config.url,
            username: config.username,
            password: config.password,
            filepath: file.filename,
            sourceType: config.sourceType || 'clouddrive2',
          })
          const streamUrl = `/api/webdav/instant-stream?${streamParams.toString().replace(/\+/g, '%20')}`
          setOriginalStreamUrl(new URL(streamUrl, window.location.origin).href)
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
        await loadCurrentRatingRef.current(file, 'media')
      } else {
        setCurrentRating(null)
      }

      startAutoMarkTimerRef.current(file)

      if (databasePreloadManager.isBrowseHalfway(index)) {
        // 当用户浏览到图组的一半左右时，预先把当前图组剩余文件拉入缓存，
        // 提升后半段图内切换体验。
        setTimeout(() => {
          console.log('[DEBUG] 浏览超过预设数量一半，开始预加载当前图组剩余文件')
          const preloadCount = config.scanSettings?.preloadCount || 10
          databasePreloadManager
            .preloadRemainingCurrentGroup(config, (current) => {
              setCachePreloadProgress({ current, total: preloadCount })
            })
            .then(() => {
              setPreloadStatus(databasePreloadManager.getCacheStatus())
            })
            .catch((error) => {
              console.error('预加载当前图组剩余文件失败:', error)
            })
        }, 100)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [
    config,
    enterVideoFullscreenRef,
    handleMediaTypeChangeInFullscreenRef,
    hasAutoRatedRef,
    isVideoRef,
    loadCurrentRatingRef,
    mediaUrl,
    setCachePreloadProgress,
    setCurrentCreator,
    setCurrentFile,
    setCurrentRating,
    setError,
    setIsUsingTranscode,
    setLoading,
    setMediaType,
    setMediaUrl,
    setOriginalStreamUrl,
    setPreloadStatus,
    setRatingType,
    setSmallVideoDirectPlayEnabled,
    setTranscodeUrl,
    smallVideoDirectPlayAvailableRef,
    startAutoMarkTimerRef,
    videoStateRef,
    viewedFilter,
  ])

  /**
   * 载入新的随机图组。
   *
   * 图组模式的组切换优先级：
   * 1. 首次进入时优先使用“当前图组缓存”
   * 2. 如果已经有“下一组缓存”，则切换过去并异步预热后续下一组
   *
   * 这里不直接处理 UI，只负责把对应图组切到当前状态，再触发首张装载。
   */
  const loadRandomGroup = useCallback(() => {
    console.log(`[DEBUG] loadRandomGroup 开始，当前筛选条件: ${viewedFilter}`)
    const galleryFilters = viewedFilter === 'viewed' ? advancedFilters : undefined

    if (databasePreloadManager.hasCurrentGroupCache() && currentGroup.length === 0) {
      // 当前组缓存里的文件对象不要求被原地改写；
      // 只要真正取出来进入页面状态时统一过一层会话映射即可。
      const currentGroupFromCache = databasePreloadManager.getCurrentGroup().map(resolveMergedMediaFile)
      console.log('[DEBUG] 首次点击，使用预加载的当前图组')
      setCurrentGroup(currentGroupFromCache)
      setCurrentGroupIndex(0)
      void loadFileFromGroup(currentGroupFromCache, 0)
      return
    }

    if (databasePreloadManager.hasNextGroupCache()) {
      console.log('[DEBUG] 使用预加载的下一组图组')
      databasePreloadManager.switchToNextGroup()

      const cacheStatus = databasePreloadManager.getCacheStatus()
      setPreloadStatus(cacheStatus)
      if (config) {
        const preloadCount = config.scanSettings?.preloadCount || 10
        setCachePreloadProgress({ current: cacheStatus.cacheSize, total: preloadCount })
      }

      // 下一组缓存同样可能还保留旧 creator，切组时统一归一化即可。
      const currentGroupFromManager = databasePreloadManager.getCurrentGroup().map(resolveMergedMediaFile)
      setCurrentGroup(currentGroupFromManager)
      setCurrentGroupIndex(0)
      void loadFileFromGroup(currentGroupFromManager, 0)

      if (config) {
        setTimeout(() => {
          const preloadCount = config.scanSettings?.preloadCount || 10
          databasePreloadManager.preloadNextGroup(config, [], preloadCount, viewedFilter, galleryFilters).catch((error) => {
            console.error('预加载下一组失败:', error)
          })
        }, 500)
      }

      return
    }

    void (async () => {
      try {
        const preloadCount = config?.scanSettings?.preloadCount || 10

        databasePreloadManager.clearNextGroupCache()
        databasePreloadManager.clearGalleryRuntimeState()

        setCachePreloadProgress({ current: 0, total: preloadCount })

        const result = await databasePreloadManager.preloadForGalleryMode(
          config,
          [],
          preloadCount,
          viewedFilter,
          (current, total) => {
            setCachePreloadProgress({ current, total })
          },
          galleryFilters,
        )

        // 首次/兜底加载图组后，也先做一次会话级 creator 归一化。
        const loadedGroup = databasePreloadManager.getCurrentGroup().map(resolveMergedMediaFile)
        if (loadedGroup.length === 0) {
          setError(result.message || '未找到符合条件的图组')
          return
        }

        setPreloadStatus(databasePreloadManager.getCacheStatus())
        setCurrentGroup(loadedGroup)
        setCurrentGroupIndex(0)
        await loadFileFromGroup(loadedGroup, 0)

        if (config) {
          setTimeout(() => {
            databasePreloadManager.preloadNextGroup(config, [], preloadCount, viewedFilter, galleryFilters).catch((error) => {
              console.error('预加载下一组失败:', error)
            })
          }, 500)
        }
      } catch (fallbackLoadError: any) {
        console.error('图组模式兜底加载失败:', fallbackLoadError)
        setError(fallbackLoadError?.message || '图组加载失败')
      }
    })()
  }, [
    advancedFilters,
    config,
    currentGroup.length,
    loadFileFromGroup,
    setCachePreloadProgress,
    setPreloadStatus,
    viewedFilter,
  ])

  /**
   * 图组内前进：
   * - 如果当前还没到末尾，则前进到图组下一项
   * - 如果已经到末尾，则自动切到下一组
   */
  const nextInGroup = useCallback(() => {
    playIntentRef.current = true
    void saveAndSwitchRef.current(() => {
      if (currentGroupIndex < currentGroup.length - 1) {
        void loadFileFromGroup(currentGroup, currentGroupIndex + 1)
      } else {
        loadRandomGroup()
      }
    })
  }, [currentGroup, currentGroupIndex, loadFileFromGroup, loadRandomGroup, playIntentRef, saveAndSwitchRef])

  /**
   * 图组内后退：
   * 仅在当前索引大于 0 时回退到上一项，不会自动跳回上一组。
   */
  const previousInGroup = useCallback(() => {
    playIntentRef.current = true
    void saveAndSwitchRef.current(() => {
      if (currentGroupIndex > 0) {
        void loadFileFromGroup(currentGroup, currentGroupIndex - 1)
      }
    })
  }, [currentGroup, currentGroupIndex, loadFileFromGroup, playIntentRef, saveAndSwitchRef])

  const updateCurrentGroupCreatorMetadata = useCallback((
    filepath: string,
    creator: CreatorSummary | null,
    creatorResolved: boolean,
  ) => {
    setCurrentGroup((prev) => prev.map((file) => (
      file.filename === filepath
        ? patchMediaFileCreatorMetadata(file, creator, creatorResolved)
        : file
    )))
  }, [])

  const refreshCurrentGroupCreatorSnapshots = useCallback(() => {
    setCurrentGroup((prev) => prev.map(resolveMergedMediaFile))
  }, [])

  /**
   * 暴露图组模式页面所需的最小状态面：
   * - 当前图组
   * - 当前索引
   * - 切组与图内前后切换动作
   */
  return {
    currentGroup,
    currentGroupIndex,
    setCurrentGroup,
    setCurrentGroupIndex,
    loadRandomGroup,
    nextInGroup,
    previousInGroup,
    updateCurrentGroupCreatorMetadata,
    refreshCurrentGroupCreatorSnapshots,
  }
}

