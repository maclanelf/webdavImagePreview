/**
 * 视频格式工具库
 * 用于判断视频格式是否需要转码
 */

// 浏览器原生支持的视频格式（大多数现代浏览器）
const NATIVE_SUPPORTED_FORMATS = new Set([
  'mp4',   // H.264/AAC - 最广泛支持
  'webm',  // VP8/VP9/Opus - Chrome/Firefox/Edge
  'ogg',   // Theora/Vorbis - Firefox/Chrome
  'ogv',   // 同 ogg
  'm4v',   // 类似 mp4
  '3gp',   // 移动端格式
  '3g2',   // 移动端格式
])

// 可能支持的格式（取决于编码和浏览器）
const MAYBE_SUPPORTED_FORMATS = new Set([
  'mov',   // QuickTime - 如果是 H.264 编码，Safari/Chrome 可能支持
  'ts',    // MPEG-TS - 部分浏览器支持
  'mts',   // AVCHD
  'm2ts',  // Blu-ray
])

// 需要转码的格式（浏览器不支持）
const TRANSCODE_REQUIRED_FORMATS = new Set([
  'avi',   // AVI 容器
  'mkv',   // Matroska
  'flv',   // Flash Video
  'wmv',   // Windows Media
  'asf',   // Advanced Systems Format
  'rmvb',  // RealMedia
  'rm',    // RealMedia
  'divx',  // DivX
  'xvid',  // Xvid
  'vob',   // DVD Video
  'mpg',   // MPEG-1/2
  'mpeg',  // MPEG-1/2
  'm2v',   // MPEG-2 Video
  'f4v',   // Flash MP4
  'swf',   // Flash (不是视频，但可能被误传)
  'mxf',   // Material Exchange Format
  'dv',    // Digital Video
  'gxf',   // General Exchange Format
])

/**
 * 获取文件扩展名
 */
export function getFileExtension(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''
  return ext
}

/**
 * 判断视频格式是否原生支持
 */
export function isNativeSupported(filename: string): boolean {
  const ext = getFileExtension(filename)
  return NATIVE_SUPPORTED_FORMATS.has(ext)
}

/**
 * 判断视频格式是否可能支持（需要尝试播放）
 */
export function isMaybeSupported(filename: string): boolean {
  const ext = getFileExtension(filename)
  return MAYBE_SUPPORTED_FORMATS.has(ext)
}

/**
 * 判断视频格式是否需要转码
 */
export function isTranscodeRequired(filename: string): boolean {
  const ext = getFileExtension(filename)
  return TRANSCODE_REQUIRED_FORMATS.has(ext)
}

/**
 * 获取视频播放策略
 * @returns 'native' | 'try-native' | 'transcode'
 */
export function getPlaybackStrategy(filename: string): 'native' | 'try-native' | 'transcode' {
  if (isNativeSupported(filename)) {
    return 'native'
  }
  if (isMaybeSupported(filename)) {
    return 'try-native'
  }
  return 'transcode'
}

/**
 * 构建视频流 URL
 * @param config WebDAV 配置
 * @param filepath 文件路径
 * @param useTranscode 是否使用转码
 * @param transcodeOptions 转码选项
 */
export function buildVideoStreamUrl(
  config: { url: string; username: string; password: string },
  filepath: string,
  useTranscode: boolean = false,
  transcodeOptions?: { format?: 'mp4' | 'webm'; quality?: 'low' | 'medium' | 'high' }
): string {
  const endpoint = useTranscode ? '/api/webdav/transcode-stream' : '/api/webdav/instant-stream'
  
  const params = new URLSearchParams({
    url: config.url,
    username: config.username,
    password: config.password,
    filepath: filepath,
  })
  
  if (useTranscode && transcodeOptions) {
    if (transcodeOptions.format) {
      params.set('format', transcodeOptions.format)
    }
    if (transcodeOptions.quality) {
      params.set('quality', transcodeOptions.quality)
    }
  }
  
  // 将 + 替换为 %20，确保 WebDAV 服务器能正确解析路径中的空格
  return `${endpoint}?${params.toString().replace(/\+/g, '%20')}`
}

/**
 * 视频格式信息
 */
export interface VideoFormatInfo {
  extension: string
  strategy: 'native' | 'try-native' | 'transcode'
  description: string
}

/**
 * 获取视频格式详细信息
 */
export function getVideoFormatInfo(filename: string): VideoFormatInfo {
  const ext = getFileExtension(filename)
  const strategy = getPlaybackStrategy(filename)
  
  const descriptions: Record<string, string> = {
    'mp4': 'MP4 (H.264) - 浏览器原生支持',
    'webm': 'WebM (VP9) - 浏览器原生支持',
    'mov': 'QuickTime - 可能支持，取决于编码',
    'avi': 'AVI - 需要转码',
    'mkv': 'Matroska - 需要转码',
    'flv': 'Flash Video - 需要转码',
    'wmv': 'Windows Media - 需要转码',
    'rmvb': 'RealMedia - 需要转码',
    'ts': 'MPEG-TS - 可能支持',
  }
  
  return {
    extension: ext,
    strategy,
    description: descriptions[ext] || `${ext.toUpperCase()} - ${strategy === 'transcode' ? '需要转码' : '可能支持'}`,
  }
}
