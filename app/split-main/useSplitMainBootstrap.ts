'use client'

import { useEffect, type MutableRefObject } from 'react'

import { getErudaEnabled, initEruda } from '@/lib/erudaInit'
import type {
  AdvancedFilters,
  ViewMode,
  WebDAVConfig,
} from '@/types'

interface UseSplitMainBootstrapOptions {
  respectStoredViewMode: boolean
  viewModeRef: MutableRefObject<ViewMode>
  setConfig: (config: WebDAVConfig | null) => void
  setStats: (stats: { total: number; images: number; videos: number; viewed: number }) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setMediaFilter: (filter: 'all' | 'images' | 'videos') => void
  setViewedFilter: (filter: 'all' | 'viewed' | 'unviewed') => void
  setViewMode: (mode: ViewMode) => void
  setPreloadRandomness: (value: number) => void
  setOptimisticUpdateEnabled: (enabled: boolean) => void
  setHighlightContinuousPlayEnabled: (enabled: boolean) => void
  setAvailableEvaluations: (values: string[]) => void
  setAvailableCategories: (values: string[]) => void
  setErudaEnabledState: (enabled: boolean) => void
  setIsMobile: (isMobile: boolean) => void
}

/**
 * 拆分主工作区启动阶段初始化 Hook。
 *
 * 这里集中承接原先写在 [`SplitMainWorkspace`](components/split-main/SplitMainWorkspace.tsx)
 * 中的启动型副作用：
 * - Eruda 初始化
 * - 移动端识别
 * - 默认 WebDAV 配置加载
 * - 统计信息加载
 * - 评价标签与分类加载
 * - 本地偏好恢复
 *
 * 主壳层继续拥有状态，但不再自己持有整段初始化细节。
 */
export function useSplitMainBootstrap({
  respectStoredViewMode,
  viewModeRef,
  setConfig,
  setStats,
  setLoading,
  setError,
  setMediaFilter,
  setViewedFilter,
  setViewMode,
  setPreloadRandomness,
  setOptimisticUpdateEnabled,
  setHighlightContinuousPlayEnabled,
  setAvailableEvaluations,
  setAvailableCategories,
  setErudaEnabledState,
  setIsMobile,
}: UseSplitMainBootstrapOptions) {
  useEffect(() => {
    const enabled = getErudaEnabled()
    setErudaEnabledState(enabled)

    if (enabled) {
      initEruda()
    }
  }, [setErudaEnabledState])

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase()
    setIsMobile(userAgent.includes('android') || /iphone|ipad|ipod/.test(userAgent))
  }, [setIsMobile])

  useEffect(() => {
    const loadAvailableFilters = async () => {
      try {
        const [evalRes, catRes] = await Promise.all([
          fetch('/api/ratings/evaluations'),
          fetch('/api/ratings/categories'),
        ])

        if (evalRes.ok) {
          const evalData = await evalRes.json()
          setAvailableEvaluations(evalData.evaluations?.map((item: any) => item.label) || [])
        }

        if (catRes.ok) {
          const catData = await catRes.json()
          setAvailableCategories(catData.categories?.map((item: any) => item.name) || [])
        }
      } catch (loadFiltersError) {
        console.error('加载评价标签和分类失败:', loadFiltersError)
      }
    }

    const loadStatsFromCache = async (cfg: WebDAVConfig) => {
      setLoading(true)
      setError(null)

      try {
        const statsResponse = await fetch(
          `/api/scan-files/stats?webdavUrl=${encodeURIComponent(cfg.url)}&webdavUsername=${encodeURIComponent(cfg.username)}&paths=${encodeURIComponent(cfg.mediaPaths.join(','))}`,
        )

        if (statsResponse.ok) {
          const statsData = await statsResponse.json()
          setStats({
            total: statsData.total || 0,
            images: statsData.images || 0,
            videos: statsData.videos || 0,
            viewed: statsData.viewed || 0,
          })
        }
      } catch (loadStatsError: any) {
        console.error('加载统计信息失败:', loadStatsError)
        setError('加载统计信息失败，请检查配置或通过管理页面重新扫描')
      } finally {
        setLoading(false)
      }
    }

    const initApp = async () => {
      try {
        await fetch('/api/init', { method: 'POST' })
      } catch (initError) {
        console.error('应用初始化失败:', initError)
      }
    }

    const loadConfig = async () => {
      try {
        const response = await fetch('/api/webdav-config/default')
        if (response.ok) {
          const dbConfig = await response.json()
          if (dbConfig.url && dbConfig.username) {
            const nextConfig: WebDAVConfig = {
              url: dbConfig.url,
              username: dbConfig.username,
              password: dbConfig.password,
              mediaPaths: dbConfig.mediaPaths || ['/'],
              sourceType: dbConfig.sourceType || 'clouddrive2',
              directLinkUrl: dbConfig.directLinkUrl || '',
              enableDirectLink: dbConfig.enableDirectLink || false,
              scanSettings: dbConfig.scanSettings || { concurrency: 10, preloadCount: 10 },
            }

            setConfig(nextConfig)
            void loadStatsFromCache(nextConfig)
            return
          }
        }
      } catch (dbConfigError) {
        console.error('从数据库加载配置失败:', dbConfigError)
      }

      const savedConfig = localStorage.getItem('webdav_config')
      if (!savedConfig) {
        return
      }

      try {
        const parsed = JSON.parse(savedConfig)
        if (parsed.mediaPath && !parsed.mediaPaths) {
          parsed.mediaPaths = [parsed.mediaPath]
        }
        if (!parsed.mediaPaths || parsed.mediaPaths.length === 0) {
          parsed.mediaPaths = ['/']
        }

        setConfig(parsed)
        void loadStatsFromCache(parsed)
      } catch (savedConfigError) {
        console.error('加载配置失败:', savedConfigError)
      }
    }

    void initApp()
    void loadConfig()
    void loadAvailableFilters()

    const savedFilter = localStorage.getItem('media_filter')
    if (savedFilter === 'all' || savedFilter === 'images' || savedFilter === 'videos') {
      setMediaFilter(savedFilter)
    }

    const savedViewedFilter = localStorage.getItem('viewed_filter')
    if (savedViewedFilter === 'all' || savedViewedFilter === 'viewed' || savedViewedFilter === 'unviewed') {
      setViewedFilter(savedViewedFilter)
    }

    const savedViewMode = localStorage.getItem('view_mode')
    if (respectStoredViewMode && (savedViewMode === 'random' || savedViewMode === 'gallery' || savedViewMode === 'large-video')) {
      setViewMode(savedViewMode)
      viewModeRef.current = savedViewMode
    }

    const savedRandomness = localStorage.getItem('preload_randomness')
    if (savedRandomness !== null) {
      const parsedRandomness = parseFloat(savedRandomness)
      if (!Number.isNaN(parsedRandomness) && parsedRandomness >= 0 && parsedRandomness <= 1) {
        setPreloadRandomness(parsedRandomness)
      }
    }

    const savedOptimistic = localStorage.getItem('optimistic_update_enabled')
    if (savedOptimistic !== null) {
      setOptimisticUpdateEnabled(savedOptimistic === 'true')
    }

    const savedContinuousPlay = localStorage.getItem('highlight_continuous_play_enabled')
    if (savedContinuousPlay !== null) {
      setHighlightContinuousPlayEnabled(savedContinuousPlay === 'true')
    }
  }, [
    respectStoredViewMode,
    setAvailableCategories,
    setAvailableEvaluations,
    setConfig,
    setError,
    setHighlightContinuousPlayEnabled,
    setLoading,
    setMediaFilter,
    setOptimisticUpdateEnabled,
    setPreloadRandomness,
    setStats,
    setViewMode,
    setViewedFilter,
    viewModeRef,
  ])
}
