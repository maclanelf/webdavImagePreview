import { useCallback, useRef, useState } from 'react'

import databasePreloadManager from '@/lib/databasePreloadManager'
import type { MediaFile } from '@/types'

interface UseModeSwitchGuardOptions {
  currentFile: MediaFile | null
  setPreloadStatus: (status: any) => void
  beforeSwitch?: () => void
}

/**
 * 模式切换防抖与缓存清理守卫。
 *
 * 三个模式页面在真正切换媒体前，本质上都要做同一组动作：
 * - 防止短时间重复触发切换
 * - 可选执行模式自己的切换前清理
 * - 把当前文件加入本地已看记录
 * - 从预加载缓存中移除当前文件
 * - 同步缓存状态回壳层
 *
 * 这里把这套模板抽成共享 Hook，模式页面只负责传入“切换前额外动作”。
 */
export function useModeSwitchGuard({
  currentFile,
  setPreloadStatus,
  beforeSwitch,
}: UseModeSwitchGuardOptions) {
  const [isSwitching, setIsSwitching] = useState(false)
  const isSwitchingRef = useRef(false)

  const runSwitch = useCallback((switchCallback: () => void) => {
    if (isSwitchingRef.current) {
      return
    }

    isSwitchingRef.current = true
    setIsSwitching(true)

    try {
      beforeSwitch?.()

      if (currentFile) {
        databasePreloadManager.addLocalViewedFile(currentFile.filename)
        databasePreloadManager.removeFromCache(currentFile.filename)
        setPreloadStatus(databasePreloadManager.getCacheStatus())
      }

      switchCallback()
    } finally {
      isSwitchingRef.current = false
      setIsSwitching(false)

      setTimeout(() => {
        isSwitchingRef.current = false
        setIsSwitching(false)
      }, 500)
    }
  }, [beforeSwitch, currentFile, setPreloadStatus])

  return {
    isSwitching,
    isSwitchingRef,
    runSwitch,
  }
}
