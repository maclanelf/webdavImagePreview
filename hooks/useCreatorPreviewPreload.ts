'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CreatorMediaCard, CreatorPreviewCacheEntry } from '@/types'

/**
 * 预加载半径 - 当前索引前后各预加载多少个媒体文件
 */
const PRELOAD_RADIUS = 10

/**
 * 判断媒体项是否可以使用窗口预加载
 * 只有图片和小视频支持预加载到内存
 * 
 * @param item - 博主媒体卡片
 * @returns 是否可以预加载
 */
function canUseWindowPreload(item: CreatorMediaCard) {
  return item.mediaType === 'image' || item.mediaType === 'small-video'
}

/**
 * 获取 URL 对应的 Blob 数据
 * 
 * @param url - 媒体文件 URL
 * @returns Blob 对象
 * @throws 请求失败时抛出错误
 */
async function fetchBlob(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`预加载失败: ${response.status}`)
  }
  return response.blob()
}

/**
 * 博主预览预加载 Hook
 * 
 * 功能：
 * - 预加载当前索引周围的媒体文件（图片和小视频）
 * - 使用 Blob URL 缓存，提升预览体验
 * - 自动清理窗口外的缓存，节省内存
 * - 防止重复加载和请求竞态
 * 
 * @param list - 博主媒体列表
 * @param currentIndex - 当前预览的索引
 * @param enabled - 是否启用预加载
 * @returns 预加载相关的方法和状态
 */
export function useCreatorPreviewPreload(list: CreatorMediaCard[], currentIndex: number, enabled: boolean) {
  /** 缓存映射表：文件路径 -> 缓存条目 */
  const cacheRef = useRef<Map<string, CreatorPreviewCacheEntry>>(new Map())
  /** 正在加载的文件路径集合，防止重复加载 */
  const loadingRef = useRef<Set<string>>(new Set())
  /** 运行 ID，用于取消过期的预加载任务 */
  const runIdRef = useRef(0)
  /** 缓存版本号，变化时触发组件重新渲染 */
  const [cacheVersion, setCacheVersion] = useState(0)

  /**
   * 计算需要预加载的索引范围
   * 当前索引前后各 PRELOAD_RADIUS 个
   */
  const desiredIndexes = useMemo(() => {
    const indexes: number[] = []
    if (!enabled || list.length === 0) return indexes

    const start = Math.max(0, currentIndex - PRELOAD_RADIUS)
    const end = Math.min(list.length - 1, currentIndex + PRELOAD_RADIUS)
    for (let index = start; index <= end; index += 1) {
      indexes.push(index)
    }
    return indexes
  }, [currentIndex, enabled, list.length])

  /**
   * 需要预加载的文件路径集合
   */
  const desiredFilePaths = useMemo(() => {
    return new Set(desiredIndexes.map((index) => list[index]?.filePath).filter(Boolean) as string[])
  }, [desiredIndexes, list])

  /**
   * 清理窗口外的缓存
   * 释放不在预加载范围内的 Blob URL，节省内存
   */
  const evictOutOfWindow = useCallback(() => {
    cacheRef.current.forEach((entry, filePath) => {
      if (!desiredFilePaths.has(filePath)) {
        URL.revokeObjectURL(entry.objectUrl)
        cacheRef.current.delete(filePath)
      }
    })
  }, [desiredFilePaths])

  /**
   * 预加载当前索引周围的媒体文件
   * 
   * 流程：
   * 1. 清理窗口外的缓存
   * 2. 遍历需要预加载的索引
   * 3. 跳过已缓存或正在加载的文件
   * 4. 下载 Blob 并创建 Object URL
   * 5. 更新缓存版本触发重新渲染
   */
  const preloadAround = useCallback(async () => {
    if (!enabled) return

    // 生成新的运行 ID，用于取消过期任务
    const runId = ++runIdRef.current
    evictOutOfWindow()

    for (const index of desiredIndexes) {
      // 检查任务是否已过期
      if (runId !== runIdRef.current) return

      const item = list[index]
      // 跳过不支持预加载的媒体类型
      if (!item || !canUseWindowPreload(item) || !item.previewUrl) continue
      // 跳过已缓存或正在加载的文件
      if (cacheRef.current.has(item.filePath) || loadingRef.current.has(item.filePath)) continue

      loadingRef.current.add(item.filePath)
      try {
        const blob = await fetchBlob(item.previewUrl)
        // 再次检查任务是否过期或文件是否仍在窗口内
        if (runId !== runIdRef.current || !desiredFilePaths.has(item.filePath)) {
          continue
        }

        const objectUrl = URL.createObjectURL(blob)
        cacheRef.current.set(item.filePath, {
          filePath: item.filePath,
          objectUrl,
          blob,
          mediaType: item.mediaType as 'image' | 'small-video',
          timestamp: Date.now(),
        })
        // 更新缓存版本，触发使用该 Hook 的组件重新渲染
        setCacheVersion((value) => value + 1)
      } catch (error) {
        console.error('[CreatorPreviewPreload] 预加载失败:', item.filePath, error)
      } finally {
        loadingRef.current.delete(item.filePath)
      }
    }
  }, [desiredFilePaths, desiredIndexes, enabled, evictOutOfWindow, list])

  /**
   * 当预加载参数变化时，执行预加载
   */
  useEffect(() => {
    void preloadAround()
  }, [preloadAround])

  /**
   * 组件卸载时清理所有缓存
   * 释放所有 Blob URL，防止内存泄漏
   */
  useEffect(() => {
    return () => {
      cacheRef.current.forEach((entry) => {
        URL.revokeObjectURL(entry.objectUrl)
      })
      cacheRef.current.clear()
      loadingRef.current.clear()
    }
  }, [])

  /**
   * 获取缓存的 Object URL
   * 
   * @param filePath - 文件路径
   * @returns Object URL 或 null
   */
  const getCachedObjectUrl = useCallback((filePath: string) => {
    return cacheRef.current.get(filePath)?.objectUrl || null
  }, [])

  return {
    cacheVersion,
    windowRange: {
      start: desiredIndexes[0] ?? 0,
      end: desiredIndexes[desiredIndexes.length - 1] ?? 0,
    },
    getCachedObjectUrl,
    preloadAround,
  }
}
