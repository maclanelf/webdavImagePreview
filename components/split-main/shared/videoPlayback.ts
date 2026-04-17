import { getPlaybackStrategy } from '@/lib/videoFormat'
import type { MediaFile, WebDAVConfig } from '@/types'

/**
 * 外部播放器类型。
 * - `potplayer` / `vlc`：桌面端显式指定播放器协议
 * - `system`：交给系统默认处理方式
 */
export type ExternalPlayerType = 'potplayer' | 'vlc' | 'system'

/**
 * 播放模式枚举。
 * - `webdav`：走 WebDAV 即时流
 * - `direct`：走直链
 * - `transcode`：走转码流
 */
export type PlaybackMode = 'webdav' | 'direct' | 'transcode'

/**
 * 把站内相对地址统一转换为带 origin 的绝对地址。
 *
 * 外部播放器、系统协议唤起等场景不能依赖浏览器当前页面上下文去补全相对路径，
 * 因此凡是要透传给站外消费者的地址，都需要先走这里做绝对化。
 */
function toAbsoluteUrl(pathOrUrl: string) {
  return new URL(pathOrUrl, window.location.origin).href
}

/**
 * 根据文件路径生成站内直链播放路径。
 *
 * 注意：这里不是完整 URL，而是站内相对路径，例如 `/d/...`。
 * 调用方如果需要提供给外部播放器或写入 `originalStreamUrl`，
 * 会再用 [`new URL()`](components/split-main/shared/videoPlayback.ts:66) 拼成绝对地址。
 */
function buildDirectPlaybackPath(file: MediaFile) {
  const processedPath = file.filename
    .split('/')
    .map(segment => segment.replace(/／/g, '|'))
    .join('/')

  return `/d${processedPath}`
}

/**
 * 构建“小视频场景”下可能需要的几种播放地址。
 *
 * 这个函数不直接决定最终播放哪个地址，只负责把：
 * - WebDAV 即时流地址
 * - 转码流地址
 * - 站内直链地址
 * - 当前格式默认建议策略
 * 一次性准备好，供随机模式 / 图组模式后续按场景选择。
 *
 * 之所以把小视频单独抽出来，是因为小视频既可能直接拿 Blob 预览，
 * 也可能切换为即时流 / 直链 / 转码，策略比纯图片复杂得多。
 */
export function buildSmallVideoPlaybackUrls(config: WebDAVConfig | null, file: MediaFile) {
  if (!config) {
    // 没有配置时无法生成 WebDAV / 转码地址，
    // 这里只保留一个可推导出来的直链路径占位。
    return {
      webdavUrl: '',
      transcodeUrl: '',
      directUrl: buildDirectPlaybackPath(file),
      playbackStrategy: 'direct' as const,
    }
  }

  // 根据文件格式推断默认播放建议：
  // 有些格式更适合直接流播，有些更适合优先转码。
  const playbackStrategy = getPlaybackStrategy(file.filename)
  const commonParams = {
    url: config.url,
    username: config.username,
    password: config.password,
    filepath: file.filename,
    sourceType: config.sourceType || 'clouddrive2',
  }

  const webdavParams = new URLSearchParams({
    ...commonParams,
    forceWebDAV: 'true',
  })
  const webdavUrl = `/api/webdav/instant-stream?${webdavParams.toString().replace(/\+/g, '%20')}`

  // 转码流统一转成 mp4，高质量优先，供不兼容格式或用户主动切换时使用。
  const transcodeParams = new URLSearchParams({
    ...commonParams,
    format: 'mp4',
    quality: 'high',
  })
  const transcodeUrl = `/api/webdav/transcode-stream?${transcodeParams.toString().replace(/\+/g, '%20')}`

  return {
    webdavUrl,
    transcodeUrl,
    directUrl: buildDirectPlaybackPath(file),
    playbackStrategy,
  }
}

/**
 * 解析“小视频场景”下最终应切换到的播放状态。
 *
 * 返回值不是单一 URL，而是一组“播放器状态快照”：
 * - `nextMediaUrl`：当前播放器真正应使用的地址
 * - `nextOriginalStreamUrl`：用于外部播放或记录原始来源的地址
 * - `nextTranscodeUrl`：如有需要，保留转码地址供后续兜底
 * - `nextIsUsingTranscode`：标记当前是否处于转码播放
 *
 * 随机模式和图组模式共用这套逻辑，因此这里必须保持纯函数、无 UI 依赖。
 */
export function resolveSmallVideoPlaybackState(
  config: WebDAVConfig | null,
  file: MediaFile,
  mode: PlaybackMode,
) {
  const { webdavUrl, transcodeUrl, directUrl, playbackStrategy } = buildSmallVideoPlaybackUrls(config, file)

  // 用户显式要求直链播放：优先返回直链，并把原始流地址记录为完整绝对 URL。
  if (mode === 'direct') {
    return {
      nextMediaUrl: directUrl,
      nextOriginalStreamUrl: toAbsoluteUrl(directUrl),
      nextTranscodeUrl: null,
      nextIsUsingTranscode: false,
    }
  }

  // 用户显式要求转码：当前播放地址与转码兜底地址统一指向转码流。
  if (mode === 'transcode') {
    return {
      nextMediaUrl: transcodeUrl,
      nextOriginalStreamUrl: toAbsoluteUrl(webdavUrl),
      nextTranscodeUrl: transcodeUrl,
      nextIsUsingTranscode: true,
    }
  }

  // 走“webdav”时，并不总是强行返回 WebDAV 地址；
  // 如果格式策略判断更适合直接转码，则自动提升为转码播放。
  if (playbackStrategy === 'transcode') {
    return {
      nextMediaUrl: transcodeUrl,
      nextOriginalStreamUrl: toAbsoluteUrl(webdavUrl),
      nextTranscodeUrl: transcodeUrl,
      nextIsUsingTranscode: true,
    }
  }

  // 默认小视频直接走 WebDAV 即时流，转码地址作为兜底备用。
  return {
    nextMediaUrl: webdavUrl,
    nextOriginalStreamUrl: toAbsoluteUrl(webdavUrl),
    nextTranscodeUrl: transcodeUrl,
    nextIsUsingTranscode: false,
  }
}

/**
 * 解析“大视频场景”下最终应切换到的播放状态。
 *
 * 与 [`resolveSmallVideoPlaybackState()`](components/split-main/shared/videoPlayback.ts:92)
 * 不同，大视频模式主要处理的是“直接挂流地址给播放器”，因此这里不会再维护小视频那种
 * `webdav + transcode 备用` 的细分组合，而是更偏向直接给出当前应使用的流地址。
 */
export function resolveStreamVideoPlaybackState(
  config: WebDAVConfig | null,
  file: MediaFile,
  mode: PlaybackMode,
) {
  if (!config) {
    return {
      nextMediaUrl: '',
      nextOriginalStreamUrl: null,
      nextTranscodeUrl: null,
      nextIsUsingTranscode: false,
    }
  }

  // 大视频显式切直链时，仅在站点支持直链能力下生效。
  if (mode === 'direct' && config.enableDirectLink) {
    const directUrl = buildDirectPlaybackPath(file)
    return {
      nextMediaUrl: directUrl,
      nextOriginalStreamUrl: toAbsoluteUrl(directUrl),
      nextTranscodeUrl: null,
      nextIsUsingTranscode: false,
    }
  }

  // 显式切换到转码流：直接把当前播放地址、原始流地址、转码地址统一设成转码流。
  if (mode === 'transcode') {
    const transcodeParams = new URLSearchParams({
      url: config.url,
      username: config.username,
      password: config.password,
      filepath: file.filename,
      sourceType: config.sourceType || 'clouddrive2',
      format: 'mp4',
      quality: 'high',
    })

    const transcodeUrl = `/api/webdav/transcode-stream?${transcodeParams.toString().replace(/\+/g, '%20')}`

    return {
      nextMediaUrl: transcodeUrl,
      nextOriginalStreamUrl: toAbsoluteUrl(transcodeUrl),
      nextTranscodeUrl: transcodeUrl,
      nextIsUsingTranscode: true,
    }
  }

  // 默认返回 WebDAV 即时流；
  // 大视频页面本身如果还需要转码兜底，会在更上层自行准备备用地址。
  const webdavParams = new URLSearchParams({
    url: config.url,
    username: config.username,
    password: config.password,
    filepath: file.filename,
    sourceType: config.sourceType || 'clouddrive2',
    forceWebDAV: 'true',
  })
  const webdavUrl = `/api/webdav/instant-stream?${webdavParams.toString().replace(/\+/g, '%20')}`

  return {
    nextMediaUrl: webdavUrl,
    nextOriginalStreamUrl: toAbsoluteUrl(webdavUrl),
    nextTranscodeUrl: null,
    nextIsUsingTranscode: false,
  }
}

/**
 * 解析“外部播放器”应拿到的最终地址。
 *
 * 优先级：
 * 1. 如果配置支持直链，且当前有文件，则优先给直链
 * 2. 否则退回到 `originalStreamUrl`
 * 3. 再退回到当前 `mediaUrl`
 *
 * 这样做的原因是：外部播放器通常更适合拿“稳定的原始来源地址”，
 * 而不是页面内部某个可能随模式切换变化的临时播放地址。
 */
export function resolveExternalPlayerUrl({
  config,
  currentFile,
  originalStreamUrl,
  mediaUrl,
}: {
  config: WebDAVConfig | null
  currentFile: MediaFile | null
  originalStreamUrl: string | null
  mediaUrl: string | null
}) {
  if (config?.enableDirectLink && currentFile) {
    return new URL(buildDirectPlaybackPath(currentFile), window.location.origin).href
  }

  return originalStreamUrl || mediaUrl || ''
}

/**
 * 唤起外部播放器或系统播放器。
 *
 * 这里根据平台做不同处理：
 * - Android：使用 `intent:` 协议
 * - iOS：优先尝试 VLC 的 x-callback 协议，再回退浏览器打开
 * - Windows/macOS 桌面：按 PotPlayer / VLC 协议或普通新标签页处理
 *
 * 为了降低被浏览器拦截的概率，协议唤起统一通过隐藏 `iframe` 触发。
 */
export function openExternalPlayerUrl(urlToUse: string, player?: ExternalPlayerType) {
  if (!urlToUse) {
    return
  }

  const userAgent = navigator.userAgent.toLowerCase()
  const isAndroid = userAgent.includes('android')
  const isIOS = /iphone|ipad|ipod/.test(userAgent)

  /**
   * 通过隐藏 iframe 触发自定义协议。
   *
   * 某些浏览器或系统环境下，iframe 方案可能被拦截；
   * 因此这里只作为兜底方案，与 anchor click 配合使用。
   */
  const openProtocolWithIframe = (url: string) => {
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = url
    document.body.appendChild(iframe)

    setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe)
      }
    }, 2000)
  }

  /**
   * 通过临时 anchor 主动触发协议跳转。
   *
   * 在桌面端浏览器里，这个方案通常比 iframe 更可靠，
   * 也更接近真实用户点击链接触发外部程序的行为。
   */
  const openProtocolWithAnchor = (url: string) => {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.style.display = 'none'
    anchor.rel = 'noopener noreferrer'
    document.body.appendChild(anchor)
    anchor.click()

    setTimeout(() => {
      if (anchor.parentNode) {
        anchor.parentNode.removeChild(anchor)
      }
    }, 0)
  }

  /**
   * 组合触发协议唤起：
   * 1. 先用 anchor click 尝试；
   * 2. 再用 iframe 做一次兜底。
   *
   * 这里主要用于桌面端自定义协议；
   * 移动端继续保留旧版 iframe 唤起方式，避免 Android 上出现“确认打开外部应用后没有继续弹出系统播放器选择器”的问题。
   */
  const openProtocol = (url: string) => {
    openProtocolWithAnchor(url)
    setTimeout(() => {
      openProtocolWithIframe(url)
    }, 80)
  }

  // Android 更适合使用 `intent:` 统一交给系统层分发。
  if (isAndroid) {
    // 保持与未拆分前一致：Android 仍只走 iframe + intent 协议。
    // 之前系统级播放器菜单可以正常弹出，说明这一条链路本身是有效的；
    // 问题出在后续为桌面端新增 anchor click 后，移动端也误走了新策略。
    openProtocolWithIframe(`intent:${urlToUse}#Intent;type=video/*;end`)
    return
  }

  // iOS 对第三方协议兼容性更敏感：先尝试 VLC 协议，再兜底浏览器打开。
  if (isIOS) {
    openProtocolWithIframe(`vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(urlToUse)}`)
    setTimeout(() => {
      window.open(urlToUse, '_blank')
    }, 500)
    return
  }

  // 桌面端显式指定 PotPlayer。
  if (player === 'potplayer') {
    openProtocol(`potplayer://${urlToUse}`)
    return
  }

  // 桌面端显式指定 VLC。
  if (player === 'vlc') {
    openProtocol(`vlc://${urlToUse}`)
    return
  }

  // 没有指定协议时，退回浏览器默认打开方式。
  window.open(urlToUse, '_blank')
}
