'use client'

import { useCleanupOnUnload } from '@/lib/useCleanupOnUnload'

/**
 * 客户端清理组件
 * 
 * 在浏览器关闭时自动清理服务端资源
 * 适用于单用户应用场景
 */
export default function ClientCleanup() {
  useCleanupOnUnload()
  return null
}
