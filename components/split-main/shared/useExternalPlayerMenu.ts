import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react'

import {
  openExternalPlayerUrl,
  resolveExternalPlayerUrl,
  type ExternalPlayerType,
} from '@/components/split-main/shared/videoPlayback'
import type { MediaFile, WebDAVConfig } from '@/types'

interface UseExternalPlayerMenuOptions {
  config: WebDAVConfig | null
  currentFile: MediaFile | null
  originalStreamUrl: string | null
  mediaUrl: string | null
  isMobile: boolean
  onBeforeOpen?: () => void
  onDesktopMenuOpen?: () => void
}

/**
 * 外部播放器菜单状态与唤起行为。
 *
 * 随机 / 图组 / 大视频三个模式都需要：
 * - 管理菜单锚点
 * - 统一解析外部播放器播放地址
 * - 移动端直接走系统播放器
 * - 桌面端打开播放器菜单
 *
 * 模式自己的差异行为通过回调注入，例如暂停当前播放器、展开切源面板等。
 */
export function useExternalPlayerMenu({
  config,
  currentFile,
  originalStreamUrl,
  mediaUrl,
  isMobile,
  onBeforeOpen,
  onDesktopMenuOpen,
}: UseExternalPlayerMenuOptions) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const menuOpen = Boolean(anchorEl)

  const closeMenu = useCallback(() => {
    setAnchorEl(null)
  }, [])

  const playWithExternalPlayer = useCallback((player?: ExternalPlayerType) => {
    const urlToUse = resolveExternalPlayerUrl({
      config,
      currentFile,
      originalStreamUrl,
      mediaUrl,
    })

    if (!urlToUse) {
      return
    }

    openExternalPlayerUrl(urlToUse, player)
    setAnchorEl(null)
  }, [config, currentFile, mediaUrl, originalStreamUrl])

  const handleExternalPlayerClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    onBeforeOpen?.()

    if (isMobile) {
      playWithExternalPlayer('system')
      return
    }

    onDesktopMenuOpen?.()
    setAnchorEl(event.currentTarget)
  }, [isMobile, onBeforeOpen, onDesktopMenuOpen, playWithExternalPlayer])

  return {
    anchorEl,
    menuOpen,
    closeMenu,
    playWithExternalPlayer,
    handleExternalPlayerClick,
  }
}
