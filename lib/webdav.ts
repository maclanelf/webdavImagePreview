import { createClient, WebDAVClient, FileStat } from 'webdav'

export interface WebDAVConfig {
  url: string
  username: string
  password: string
  mediaPath?: string
}

let cachedClient: WebDAVClient | null = null
let cachedConfig: WebDAVConfig | null = null

export function getWebDAVClient(config?: WebDAVConfig): WebDAVClient {
  const finalConfig = config || {
    url: process.env.WEBDAV_URL || '',
    username: process.env.WEBDAV_USERNAME || '',
    password: process.env.WEBDAV_PASSWORD || '',
    mediaPath: process.env.WEBDAV_MEDIA_PATH || '/',
  }

  // 如果配置相同，返回缓存的客户端
  if (cachedClient && cachedConfig && 
      cachedConfig.url === finalConfig.url &&
      cachedConfig.username === finalConfig.username &&
      cachedConfig.password === finalConfig.password) {
    return cachedClient
  }

  cachedClient = createClient(finalConfig.url, {
    username: finalConfig.username,
    password: finalConfig.password,
  })
  cachedConfig = finalConfig

  return cachedClient
}

export async function getMediaFiles(
  client: WebDAVClient,
  path: string = '/'
): Promise<FileStat[]> {
  const contents = await client.getDirectoryContents(path) as FileStat[]
  
  const mediaFiles: FileStat[] = []
  
  for (const item of contents) {
    if (item.type === 'file') {
      const filename = item.filename.toLowerCase()
      // 检查是否是图片或视频文件
      if (
        filename.endsWith('.jpg') ||
        filename.endsWith('.jpeg') ||
        filename.endsWith('.png') ||
        filename.endsWith('.gif') ||
        filename.endsWith('.webp') ||
        filename.endsWith('.bmp') ||
        filename.endsWith('.mp4') ||
        filename.endsWith('.webm') ||
        filename.endsWith('.mov') ||
        filename.endsWith('.avi') ||
        filename.endsWith('.mkv')
      ) {
        mediaFiles.push(item)
      }
    } else if (item.type === 'directory') {
      // 递归获取子目录中的媒体文件
      const subFiles = await getMediaFiles(client, item.filename)
      mediaFiles.push(...subFiles)
    }
  }
  
  return mediaFiles
}

export function isImageFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.bmp')
  )
}

export function isVideoFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return (
    lower.endsWith('.mp4') ||
    lower.endsWith('.webm') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.avi') ||
    lower.endsWith('.mkv')
  )
}

