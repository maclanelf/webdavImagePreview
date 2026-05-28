import { useEffect } from 'react'

import databasePreloadManager from '@/lib/databasePreloadManager'
import { getRandomPoolSessionId } from '@/lib/randomPoolSession'

/**
 * 浏览器关闭时清理服务端资源的 Hook
 * 
 * 使用场景：单用户应用，浏览器关闭时清理服务端资源
 * 
 * 使用方法：
 * ```tsx
 * import { useCleanupOnUnload } from '@/lib/useCleanupOnUnload'
 * 
 * export default function RootLayout({ children }) {
 *   useCleanupOnUnload()
 *   return <html>{children}</html>
 * }
 * ```
 */
export function useCleanupOnUnload() {
  useEffect(() => {
    // 使用 beforeunload 事件在页面卸载前发送清理请求
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      databasePreloadManager.cancelAllPreloads()
      databasePreloadManager.clearCache()
      databasePreloadManager.clearNextGroupCache()
      databasePreloadManager.clearGalleryRuntimeState()
      databasePreloadManager.clearLocalViewedFiles()

      const randomPoolSessionId = getRandomPoolSessionId()
      const payload = JSON.stringify(
        randomPoolSessionId
          ? { randomPoolSessionId }
          : {},
      )

      // 使用 sendBeacon 发送异步请求（即使页面关闭也能发送）
      // sendBeacon 是专门为页面卸载时发送数据设计的 API
      const sent = navigator.sendBeacon('/api/cleanup', payload)
      
      if (sent) {
        console.log('🧹 [Cleanup] 已发送清理请求到服务端')
      } else {
        console.warn('⚠️ [Cleanup] 清理请求发送失败')
      }
      
      // 注意：不要 preventDefault()，否则会弹出确认对话框
    }
    
    // 监听页面卸载事件
    window.addEventListener('beforeunload', handleBeforeUnload)
    
    // 清理监听器
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])
}

/**
 * 手动触发清理（可选）
 * 
 * 使用场景：用户点击"退出"按钮时
 */
export async function manualCleanup() {
  try {
    console.log('🧹 [Cleanup] 手动触发清理...')

    const randomPoolSessionId = getRandomPoolSessionId()

    databasePreloadManager.cancelAllPreloads()
    databasePreloadManager.clearCache()
    databasePreloadManager.clearNextGroupCache()
    databasePreloadManager.clearGalleryRuntimeState()
    databasePreloadManager.clearLocalViewedFiles()
    
    const response = await fetch('/api/cleanup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        randomPoolSessionId
          ? { randomPoolSessionId }
          : {},
      )
    })
    
    const result = await response.json()
    
    if (result.success) {
      console.log('✅ [Cleanup] 清理成功:', result.message)
    } else {
      console.error('❌ [Cleanup] 清理失败:', result.message)
    }
    
    return result
  } catch (error) {
    console.error('❌ [Cleanup] 清理请求失败:', error)
    return { success: false, error }
  }
}
