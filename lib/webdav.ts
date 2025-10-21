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
  path: string = '/',
  options: {
    maxDepth?: number
    maxFiles?: number
    timeout?: number
    onProgress?: (currentPath: string, fileCount: number) => void
  } = {}
): Promise<FileStat[]> {
  const { maxDepth = 10, maxFiles = 200000, timeout = 60000, onProgress } = options
  const startTime = Date.now()
  
  const mediaFiles: FileStat[] = []
  
  async function scanDirectory(currentPath: string, currentDepth: number = 0): Promise<void> {
    // 检查超时
    if (Date.now() - startTime > timeout) {
      console.warn(`扫描超时，已扫描 ${mediaFiles.length} 个文件`)
      return
    }
    
    // 检查深度限制
    if (currentDepth >= maxDepth) {
      console.warn(`达到最大扫描深度 ${maxDepth}，跳过目录: ${currentPath}`)
      return
    }
    
    // 检查文件数量限制
    if (mediaFiles.length >= maxFiles) {
      console.warn(`达到最大文件数量 ${maxFiles}，停止扫描`)
      return
    }
    
    try {
      // 报告进度
      if (onProgress) {
        onProgress(currentPath, mediaFiles.length)
      }
      
      const contents = await client.getDirectoryContents(currentPath) as FileStat[]
      
      // 先处理文件，再处理目录
      const directories: FileStat[] = []
      
      for (const item of contents) {
        if (item.type === 'file') {
          const filename = item.filename.toLowerCase()
          // 检查是否是媒体文件
          if (isMediaFile(filename)) {
            mediaFiles.push(item)
            
            // 检查文件数量限制
            if (mediaFiles.length >= maxFiles) {
              console.warn(`达到最大文件数量 ${maxFiles}，停止扫描`)
              return
            }
          }
        } else if (item.type === 'directory') {
          directories.push(item)
        }
      }
      
      // 递归处理子目录
      for (const dir of directories) {
        await scanDirectory(dir.filename, currentDepth + 1)
        
        // 再次检查超时和文件数量限制
        if (Date.now() - startTime > timeout || mediaFiles.length >= maxFiles) {
          return
        }
      }
      
    } catch (error: any) {
      console.warn(`扫描目录失败: ${currentPath}`, error.message)
      // 继续扫描其他目录，不中断整个扫描过程
    }
  }
  
  await scanDirectory(path)
  
  console.log(`扫描完成，共找到 ${mediaFiles.length} 个媒体文件，耗时 ${Date.now() - startTime}ms`)
  return mediaFiles
}

// 辅助函数：检查是否是媒体文件
function isMediaFile(filename: string): boolean {
  return (
    // 图片格式
    filename.endsWith('.jpg') ||
    filename.endsWith('.jpeg') ||
    filename.endsWith('.png') ||
    filename.endsWith('.gif') ||
    filename.endsWith('.webp') ||
    filename.endsWith('.bmp') ||
    filename.endsWith('.tiff') ||
    filename.endsWith('.tif') ||
    filename.endsWith('.svg') ||
    filename.endsWith('.ico') ||
    // 视频格式
    filename.endsWith('.mp4') ||
    filename.endsWith('.webm') ||
    filename.endsWith('.mov') ||
    filename.endsWith('.avi') ||
    filename.endsWith('.mkv') ||
    filename.endsWith('.flv') ||
    filename.endsWith('.wmv') ||
    filename.endsWith('.m4v') ||
    filename.endsWith('.3gp') ||
    filename.endsWith('.ogv') ||
    filename.endsWith('.ts') ||
    filename.endsWith('.mts') ||
    filename.endsWith('.m2ts')
  )
}

export function isImageFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return (
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.png') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.bmp') ||
    lower.endsWith('.tiff') ||
    lower.endsWith('.tif') ||
    lower.endsWith('.svg') ||
    lower.endsWith('.ico')
  )
}

export function isVideoFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return (
    lower.endsWith('.mp4') ||
    lower.endsWith('.webm') ||
    lower.endsWith('.mov') ||
    lower.endsWith('.avi') ||
    lower.endsWith('.mkv') ||
    lower.endsWith('.flv') ||
    lower.endsWith('.wmv') ||
    lower.endsWith('.m4v') ||
    lower.endsWith('.3gp') ||
    lower.endsWith('.ogv') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.mts') ||
    lower.endsWith('.m2ts')
  )
}

