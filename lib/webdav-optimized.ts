/**
 * WebDAV 优化扫描模块
 * 
 * 整合了所有 WebDAV 相关功能：
 * 1. getWebDAVClient - 获取 WebDAV 客户端（带缓存）
 * 2. smartScan - 智能扫描（自动选择 PROPFIND 或 webdav-client）
 * 3. 媒体文件类型判断函数
 * 
 * 核心优化：
 * - 使用原生 PROPFIND 请求（Depth: 1）递归扫描
 * - 不预估总目录数，节省 50% 请求
 * - 真正的并发控制
 * - 支持取消操作
 */

import { createClient, WebDAVClient, FileStat } from 'webdav'

// ============== 类型定义 ==============

export interface WebDAVConfig {
  url: string
  username: string
  password: string
  mediaPath?: string
}

export interface ScanProgress {
  taskId: string
  currentPath: string
  scannedDirectories: number
  pendingDirectories: number
  foundFiles: number
  estimatedProgress: number
  method: 'propfind' | 'webdav-client'
  avgResponseTime: number
}

export interface ScanResult {
  taskId: string
  totalFiles: number
  imageCount: number
  videoCount: number
  files: FileStat[]
  method: 'propfind' | 'webdav-client'
  duration: number
  failedDirectories?: number      // 重试失败的目录数量
  rateLimitTriggered?: boolean    // 是否触发风控（提前中断扫描）
}

export interface OptimizedScanOptions {
  maxConcurrency?: number      // 最大并发数，默认 10
  timeout?: number             // 单次请求超时，默认 30000ms
  retryCount?: number          // 失败重试次数，默认 2
  progressInterval?: number    // 进度回调间隔（毫秒），默认 500ms
  requestDelay?: number        // 请求间隔（毫秒），默认 100ms，防止风控
  batchPause?: number          // 每批次后暂停（毫秒），默认 500ms
  batchSize?: number           // 批次大小，默认 50 个目录后暂停
  onProgress?: (progress: ScanProgress) => void
  signal?: AbortSignal
}

// ============== WebDAV 客户端管理 ==============

let cachedClient: WebDAVClient | null = null
let cachedConfig: WebDAVConfig | null = null

// 清理 WebDAV 客户端缓存
export function cleanupWebDAVCache() {
  console.log('🧹 [WebDAV-Optimized] 清理客户端缓存...')
  cachedClient = null
  cachedConfig = null
}

/**
 * 获取 WebDAV 客户端（带缓存）
 */
export function getWebDAVClient(config?: WebDAVConfig): WebDAVClient {
  const finalConfig = config || {
    url: process.env.WEBDAV_URL || '',
    username: process.env.WEBDAV_USERNAME || '',
    password: process.env.WEBDAV_PASSWORD || '',
    mediaPath: process.env.WEBDAV_MEDIA_PATH || '/',
  }

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

/**
 * 获取当前缓存的配置
 */
export function getClientConfig(): WebDAVConfig | null {
  return cachedConfig
}

// ============== 媒体文件类型判断 ==============

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.tiff', '.tif', '.svg', '.ico', '.heic', '.heif',
  '.avif', '.jxl', '.raw', '.cr2', '.cr3', '.nef',
  '.arw', '.dng', '.orf', '.rw2', '.pef', '.srw',
  '.psd', '.ai', '.eps', '.pcx', '.tga', '.exr', '.hdr'
])

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv',
  '.wmv', '.m4v', '.3gp', '.3g2', '.ogv', '.ogg',
  '.ts', '.mts', '.m2ts', '.vob', '.mpg', '.mpeg',
  '.m2v', '.rmvb', '.rm', '.asf', '.divx', '.xvid',
  '.f4v', '.swf', '.mxf', '.dv', '.gxf', '.m4p', '.m3u8'
])

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot >= 0 ? filename.substring(lastDot).toLowerCase() : ''
}

export function isMediaFile(filename: string): boolean {
  const ext = getExtension(filename)
  return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)
}

export function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filename))
}

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(filename))
}


// ============== PROPFIND 核心实现 ==============

/**
 * 执行单次 PROPFIND 请求（Depth: 1）
 */
async function propfindDepth1(
  url: string,
  path: string,
  auth: { username: string; password: string },
  timeout: number = 30000
): Promise<{ files: FileStat[]; directories: string[] }> {
  const normalizedPath = path.endsWith('/') ? path : path + '/'
  const fullUrl = `${url}${encodeURI(normalizedPath)}`
  const authHeader = Buffer.from(`${auth.username}:${auth.password}`).toString('base64')

  // 提取 URL 的路径前缀（如 /dav）
  let urlPrefix = ''
  try {
    const parsedUrl = new URL(url)
    urlPrefix = parsedUrl.pathname.replace(/\/$/, '') // 移除尾部斜杠
  } catch (e) {}

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(fullUrl, {
      method: 'PROPFIND',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Depth': '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:getcontenttype/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.status === 404) {
      return { files: [], directories: [] }
    }
    if (response.status === 401) {
      throw new Error('认证失败')
    }
    if (response.status === 405) {
      throw new Error('服务器不支持 PROPFIND')
    }
    if (response.status !== 207) {
      throw new Error(`PROPFIND 失败: ${response.status}`)
    }

    const xml = await response.text()
    return parseMultistatusResponse(xml, normalizedPath, urlPrefix)

  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error(`PROPFIND 超时: ${path}`)
    }
    throw error
  }
}

/**
 * 解析 207 Multi-Status 响应
 */
function parseMultistatusResponse(
  xml: string,
  basePath: string,
  urlPrefix: string = ''
): { files: FileStat[]; directories: string[] } {
  const files: FileStat[] = []
  const directories: string[] = []

  const responseRegex = /<D:response>([\s\S]*?)<\/D:response>/gi
  let match

  while ((match = responseRegex.exec(xml)) !== null) {
    const responseXml = match[1]

    const hrefMatch = /<D:href>([^<]*)<\/D:href>/i.exec(responseXml)
    if (!hrefMatch) continue

    let href = hrefMatch[1]
    try {
      href = decodeURIComponent(href)
    } catch (e) {}

    // 移除 URL 前缀（如 /dav）
    if (urlPrefix && href.startsWith(urlPrefix)) {
      href = href.substring(urlPrefix.length)
    }
    // 确保路径以 / 开头
    if (!href.startsWith('/')) {
      href = '/' + href
    }

    const normalizedHref = href.endsWith('/') ? href : href + '/'
    const normalizedBase = basePath.endsWith('/') ? basePath : basePath + '/'
    if (normalizedHref === normalizedBase) continue

    const isCollection = /<D:collection\s*\/?>/i.test(responseXml)

    if (isCollection) {
      directories.push(href)
    } else {
      const displaynameMatch = /<D:displayname>([^<]*)<\/D:displayname>/i.exec(responseXml)
      const sizeMatch = /<D:getcontentlength>([^<]*)<\/D:getcontentlength>/i.exec(responseXml)
      const lastmodMatch = /<D:getlastmodified>([^<]*)<\/D:getlastmodified>/i.exec(responseXml)
      const typeMatch = /<D:getcontenttype>([^<]*)<\/D:getcontenttype>/i.exec(responseXml)

      const basename = displaynameMatch?.[1] || href.split('/').filter(Boolean).pop() || ''

      files.push({
        filename: href,
        basename,
        size: parseInt(sizeMatch?.[1] || '0', 10),
        lastmod: lastmodMatch?.[1] || '',
        type: 'file',
        mime: typeMatch?.[1] || '',
        etag: null,
      } as FileStat)
    }
  }

  return { files, directories }
}

/**
 * 测试 PROPFIND 是否可用
 */
async function testPropfindSupport(
  config: WebDAVConfig,
  path: string
): Promise<{ supported: boolean; responseTime: number; error?: string }> {
  const startTime = Date.now()

  try {
    await propfindDepth1(config.url, path, {
      username: config.username,
      password: config.password,
    }, 10000)
    return { supported: true, responseTime: Date.now() - startTime }
  } catch (error: any) {
    return { supported: false, responseTime: Date.now() - startTime, error: error.message }
  }
}


// ============== PROPFIND 递归扫描 ==============

/**
 * 使用 PROPFIND 递归扫描
 * 优化点：
 * - 滑动窗口并发控制，始终保持 maxConcurrency 个请求在飞行
 * - 失败重试机制
 * - 节流进度回调
 */
async function recursiveScanWithPropfind(
  config: WebDAVConfig,
  rootPath: string,
  options: OptimizedScanOptions = {}
): Promise<ScanResult> {
  const { 
    maxConcurrency = 20,      // 并发数 20
    timeout = 30000, 
    retryCount = 2,
    progressInterval = 500,
    requestDelay = 20,        // 请求间隔 20ms
    batchPause = 200,         // 每批次暂停 200ms
    batchSize = 100,          // 每 100 个目录为一批
    onProgress, 
    signal 
  } = options

  const taskId = `propfind_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  const startTime = Date.now()

  const allFiles: FileStat[] = []
  const queue: string[] = [rootPath]
  const scanning = new Map<string, Promise<void>>()
  const scannedPaths = new Set<string>()
  const failedPaths = new Map<string, number>() // 记录失败次数

  let scannedDirectories = 0
  let batchCounter = 0  // 批次计数器
  let lastRequestTime = 0  // 上次请求时间
  let totalResponseTime = 0
  let responseCount = 0
  let lastProgressTime = 0
  let rateLimitTriggered = false  // 风控触发标记

  const auth = { username: config.username, password: config.password }

  // 节流进度回调
  const reportProgress = (currentPath: string) => {
    const now = Date.now()
    if (onProgress && (now - lastProgressTime >= progressInterval || queue.length === 0)) {
      lastProgressTime = now
      const avgResponseTime = responseCount > 0 ? Math.round(totalResponseTime / responseCount) : 0
      const totalKnown = scannedDirectories + queue.length
      const estimatedProgress = totalKnown > 0 ? Math.round((scannedDirectories / totalKnown) * 100) : 0

      onProgress({
        taskId,
        currentPath,
        scannedDirectories,
        pendingDirectories: queue.length,
        foundFiles: allFiles.length,
        estimatedProgress,
        method: 'propfind',
        avgResponseTime,
      })
    }
  }

  const scanDirectory = async (path: string): Promise<void> => {
    // 如果已经触发风控，直接返回不执行
    if (rateLimitTriggered) {
      return
    }
    
    // 规范化路径：移除尾部斜杠（用于 scannedPaths 检查）
    const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
    
    if (scannedPaths.has(normalizedPath)) {
      console.log(`[PROPFIND] 跳过已扫描: ${normalizedPath}`)
      return
    }
    scannedPaths.add(normalizedPath)

    if (signal?.aborted) throw new Error('扫描已取消')

    const reqStartTime = Date.now()

    try {
      const { files, directories } = await propfindDepth1(config.url, path, auth, timeout)

      // 请求成功后再次检查风控状态（可能其他并发任务已触发风控）
      if (rateLimitTriggered) {
        return
      }

      totalResponseTime += Date.now() - reqStartTime
      responseCount++
      scannedDirectories++

      // 直接过滤媒体文件
      let mediaCount = 0
      for (const f of files) {
        if (isMediaFile(f.filename)) {
          allFiles.push(f)
          mediaCount++
        }
      }

      // 添加子目录到队列（规范化路径）
      let addedDirs = 0
      for (const dir of directories) {
        const normalizedDir = dir.endsWith('/') ? dir.slice(0, -1) : dir
        if (!scannedPaths.has(normalizedDir)) {
          queue.push(normalizedDir)
          addedDirs++
        }
      }

      // 调试日志
      console.log(`[PROPFIND] 目录 ${path}: ${files.length} 文件, ${directories.length} 子目录 (添加 ${addedDirs} 到队列) [队列: ${queue.length}, 扫描中: ${scanning.size}]`)

      reportProgress(path)

    } catch (error: any) {
      // 如果已经触发风控，不再处理
      if (rateLimitTriggered) {
        return
      }
      
      // 重试机制
      const failures = (failedPaths.get(normalizedPath) || 0) + 1
      failedPaths.set(normalizedPath, failures)
      
      if (failures <= retryCount) {
        console.warn(`[PROPFIND] 扫描目录失败 (重试 ${failures}/${retryCount}): ${path}`, error.message)
        scannedPaths.delete(normalizedPath) // 允许重试
        queue.push(normalizedPath)
      } else {
        // 重试次数用尽，标记为风控触发，立即停止扫描
        console.error(`🚨 [PROPFIND] 扫描目录失败 (已放弃，触发风控): ${path}`, error.message)
        rateLimitTriggered = true
        // 清空队列，防止继续添加新任务
        queue.length = 0
      }
    }
  }

  // 延迟函数
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  // 滑动窗口并发控制（带限速）
  while (queue.length > 0 || scanning.size > 0) {
    if (signal?.aborted) break
    
    // 检查是否触发风控，立即停止
    if (rateLimitTriggered) {
      console.warn(`[PROPFIND] 检测到风控触发，停止扫描，取消剩余 ${scanning.size} 个并发任务`)
      break
    }

    // 填充并发窗口
    while (scanning.size < maxConcurrency && queue.length > 0 && !rateLimitTriggered) {
      const path = queue.shift()!
      
      // 规范化路径
      const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
      
      if (scannedPaths.has(normalizedPath)) continue

      // 请求间隔限速
      const now = Date.now()
      const elapsed = now - lastRequestTime
      if (requestDelay > 0 && elapsed < requestDelay) {
        await delay(requestDelay - elapsed)
      }
      lastRequestTime = Date.now()

      const promise = scanDirectory(normalizedPath).finally(() => {
        scanning.delete(normalizedPath)
        batchCounter++
      })
      scanning.set(normalizedPath, promise)
    }

    // 如果触发风控，不再等待
    if (rateLimitTriggered) break

    // 等待任意一个完成
    if (scanning.size > 0) {
      await Promise.race(scanning.values())
    }

    // 批次暂停（每 batchSize 个目录后暂停）
    if (batchPause > 0 && batchCounter >= batchSize) {
      console.log(`[PROPFIND] 批次暂停 ${batchPause}ms (已扫描 ${scannedDirectories} 个目录)`)
      await delay(batchPause)
      batchCounter = 0
    }
  }

  // 等待所有剩余任务完成（如果没有触发风控）
  if (scanning.size > 0 && !rateLimitTriggered) {
    await Promise.all(scanning.values())
  }

  const duration = Date.now() - startTime
  const imageCount = allFiles.filter(f => isImageFile(f.filename)).length
  const videoCount = allFiles.filter(f => isVideoFile(f.filename)).length

  // 统计重试失败的目录数量（超过重试次数的目录）
  const failedDirectories = Array.from(failedPaths.entries()).filter(([_, count]) => count > retryCount).length

  if (rateLimitTriggered) {
    console.warn(`[PROPFIND] 扫描被风控中断: ${allFiles.length} 个文件，${scannedDirectories} 个目录，失败 ${failedDirectories} 个，耗时 ${duration}ms`)
  } else {
    console.log(`[PROPFIND] 扫描完成: ${allFiles.length} 个文件，${scannedDirectories} 个目录，失败 ${failedDirectories} 个，耗时 ${duration}ms，平均响应 ${Math.round(totalResponseTime / responseCount)}ms`)
  }

  return { 
    taskId, 
    totalFiles: allFiles.length, 
    imageCount, 
    videoCount, 
    files: allFiles, 
    method: 'propfind', 
    duration,
    failedDirectories,
    rateLimitTriggered  // 是否触发风控
  }
}

// ============== webdav-client 递归扫描（备用） ==============

/**
 * 使用 webdav-client 递归扫描（当 PROPFIND 不可用时）
 * 优化点：
 * - 滑动窗口并发控制（与 PROPFIND 一致）
 * - 失败重试机制
 * - 节流进度回调
 */
async function recursiveScanWithClient(
  client: WebDAVClient,
  rootPath: string,
  options: OptimizedScanOptions = {}
): Promise<ScanResult> {
  const { 
    maxConcurrency = 20,      // 并发数 20
    retryCount = 2,
    progressInterval = 500,
    requestDelay = 20,        // 请求间隔 20ms
    batchPause = 200,         // 每批次暂停 200ms
    batchSize = 100,          // 每 100 个目录为一批
    onProgress, 
    signal 
  } = options

  const taskId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
  const startTime = Date.now()

  const allFiles: FileStat[] = []
  const queue: string[] = [rootPath]
  const scanning = new Map<string, Promise<void>>()
  const scannedPaths = new Set<string>()
  const failedPaths = new Map<string, number>()

  let scannedDirectories = 0
  let lastProgressTime = 0
  let batchCounter = 0  // 批次计数器
  let lastRequestTime = 0  // 上次请求时间
  let rateLimitTriggered = false  // 风控触发标记

  // 节流进度回调
  const reportProgress = (currentPath: string) => {
    const now = Date.now()
    if (onProgress && (now - lastProgressTime >= progressInterval || queue.length === 0)) {
      lastProgressTime = now
      const totalKnown = scannedDirectories + queue.length
      const estimatedProgress = totalKnown > 0 ? Math.round((scannedDirectories / totalKnown) * 100) : 0

      onProgress({
        taskId,
        currentPath,
        scannedDirectories,
        pendingDirectories: queue.length,
        foundFiles: allFiles.length,
        estimatedProgress,
        method: 'webdav-client',
        avgResponseTime: 0,
      })
    }
  }

  const processDirectory = async (path: string): Promise<void> => {
    // 如果已经触发风控，直接返回不执行
    if (rateLimitTriggered) {
      return
    }
    
    // 规范化路径：移除尾部斜杠
    const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
    
    if (scannedPaths.has(normalizedPath)) {
      console.log(`[webdav-client] 跳过已扫描: ${normalizedPath}`)
      return
    }
    scannedPaths.add(normalizedPath)

    if (signal?.aborted) throw new Error('扫描已取消')

    try {
      const contents = await client.getDirectoryContents(path) as FileStat[]
      
      // 请求成功后再次检查风控状态（可能其他并发任务已触发风控）
      if (rateLimitTriggered) {
        return
      }
      
      scannedDirectories++

      let filesInDir = 0
      let dirsInDir = 0

      for (const item of contents) {
        if (item.type === 'file') {
          if (isMediaFile(item.filename)) {
            allFiles.push(item)
            filesInDir++
          }
        } else if (item.type === 'directory') {
          // 规范化子目录路径
          const normalizedItemPath = item.filename.endsWith('/') ? item.filename.slice(0, -1) : item.filename
          if (!scannedPaths.has(normalizedItemPath)) {
            queue.push(normalizedItemPath)
            dirsInDir++
          }
        }
      }

      // 调试日志：显示每个目录的内容和队列状态
      console.log(`[webdav-client] 目录 ${path}: ${contents.length} 项 (${filesInDir} 媒体文件, ${dirsInDir} 子目录待扫描) [队列: ${queue.length}, 扫描中: ${scanning.size}]`)

      reportProgress(path)

    } catch (error: any) {
      // 如果已经触发风控，不再处理
      if (rateLimitTriggered) {
        return
      }
      
      // 重试机制
      const failures = (failedPaths.get(normalizedPath) || 0) + 1
      failedPaths.set(normalizedPath, failures)
      
      if (failures <= retryCount) {
        console.warn(`[webdav-client] 处理目录失败 (重试 ${failures}/${retryCount}): ${path}`, error.message)
        scannedPaths.delete(normalizedPath)
        queue.push(normalizedPath)
      } else {
        // 重试次数用尽，标记为风控触发，立即停止扫描
        console.error(`🚨 [webdav-client] 处理目录失败 (已放弃，触发风控): ${path}`, error.message)
        rateLimitTriggered = true
        // 清空队列，防止继续添加新任务
        queue.length = 0
      }
    }
  }

  // 延迟函数
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  // 滑动窗口并发控制（带限速）
  while (queue.length > 0 || scanning.size > 0) {
    if (signal?.aborted) break
    
    // 检查是否触发风控，立即停止
    if (rateLimitTriggered) {
      console.warn(`[webdav-client] 检测到风控触发，停止扫描，取消剩余 ${scanning.size} 个并发任务`)
      break
    }

    // 填充并发窗口
    while (scanning.size < maxConcurrency && queue.length > 0 && !rateLimitTriggered) {
      const path = queue.shift()!
      
      // 规范化路径
      const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
      
      // 跳过已扫描的路径（防止重复扫描）
      if (scannedPaths.has(normalizedPath)) continue

      // 请求间隔限速
      const now = Date.now()
      const elapsed = now - lastRequestTime
      if (requestDelay > 0 && elapsed < requestDelay) {
        await delay(requestDelay - elapsed)
      }
      lastRequestTime = Date.now()

      const promise = processDirectory(normalizedPath).finally(() => {
        scanning.delete(normalizedPath)
        batchCounter++
      })
      scanning.set(normalizedPath, promise)
    }

    // 如果触发风控，不再等待
    if (rateLimitTriggered) break

    // 等待至少一个任务完成，释放并发槽位
    if (scanning.size > 0) {
      await Promise.race(scanning.values())
    }
    
    // 批次暂停（每 batchSize 个目录后暂停）
    if (batchPause > 0 && batchCounter >= batchSize) {
      console.log(`[webdav-client] 批次暂停 ${batchPause}ms (已扫描 ${scannedDirectories} 个目录)`)
      await delay(batchPause)
      batchCounter = 0
    }
  }

  // 确保所有任务都完成（如果没有触发风控）
  if (scanning.size > 0 && !rateLimitTriggered) {
    await Promise.all(scanning.values())
  }

  const duration = Date.now() - startTime
  const imageCount = allFiles.filter(f => isImageFile(f.filename)).length
  const videoCount = allFiles.filter(f => isVideoFile(f.filename)).length

  // 统计重试失败的目录数量
  const failedDirectories = Array.from(failedPaths.entries()).filter(([_, count]) => count > retryCount).length

  if (rateLimitTriggered) {
    console.warn(`[webdav-client] 扫描被风控中断: ${allFiles.length} 个文件，${scannedDirectories} 个目录，失败 ${failedDirectories} 个，耗时 ${duration}ms`)
  } else {
    console.log(`[webdav-client] 扫描完成: ${allFiles.length} 个文件，${scannedDirectories} 个目录，失败 ${failedDirectories} 个，耗时 ${duration}ms`)
  }

  return { 
    taskId, 
    totalFiles: allFiles.length, 
    imageCount, 
    videoCount, 
    files: allFiles, 
    method: 'webdav-client', 
    duration,
    failedDirectories,
    rateLimitTriggered  // 是否触发风控
  }
}


// ============== 智能扫描（主入口） ==============

/**
 * 智能扫描：自动选择最优扫描方式
 * 
 * @param client - WebDAV 客户端（通过 getWebDAVClient 获取）
 * @param rootPath - 扫描根路径
 * @param options - 扫描选项
 */
export async function smartScan(
  client: WebDAVClient,
  rootPath: string,
  options: OptimizedScanOptions = {}
): Promise<ScanResult> {
  const config = getClientConfig()
  
  if (!config) {
    throw new Error('无法获取 WebDAV 配置，请先调用 getWebDAVClient')
  }

  console.log('[智能扫描] 测试 PROPFIND 支持...')

  const testResult = await testPropfindSupport(config, rootPath)

  if (testResult.supported) {
    console.log(`[智能扫描] PROPFIND 可用，响应时间: ${testResult.responseTime}ms`)
    return recursiveScanWithPropfind(config, rootPath, options)
  } else {
    console.log(`[智能扫描] PROPFIND 不可用 (${testResult.error})，使用 webdav-client`)
    return recursiveScanWithClient(client, rootPath, options)
  }
}

// ============== 导出接口类型 ==============

export interface RecursiveScanProgress {
  taskId: string
  currentPath: string
  scannedDirectories: number
  totalDirectories: number
  foundFiles: number
  percentage: number
  pendingDirectories: string[]
  completedDirectories: string[]
}

export interface BatchInfo {
  batchNumber: number
  directoriesInBatch: number
  filesFoundInBatch: number
  totalBatches: number
}

export interface RecursiveScanOptions {
  concurrency?: number
  onProgress?: (progress: RecursiveScanProgress) => void
  onBatchComplete?: (files: FileStat[], batchInfo: BatchInfo) => void
}

/**
 * 递归扫描目录
 * 内部调用 smartScan 自动选择最优扫描方式
 */
export async function recursiveScanDirectory(
  client: WebDAVClient,
  rootPath: string,
  options: RecursiveScanOptions = {},
  taskId?: string
): Promise<{
  taskId: string
  totalFiles: number
  imageCount: number
  videoCount: number
  files: FileStat[]
  failedDirectories?: number      // 重试失败的目录数量
  rateLimitTriggered?: boolean    // 是否触发风控
}> {
  const { concurrency = 10, onProgress } = options  // 默认并发数 10

  const result = await smartScan(client, rootPath, {
    maxConcurrency: concurrency,
    onProgress: onProgress ? (progress) => {
      onProgress({
        taskId: progress.taskId,
        currentPath: progress.currentPath,
        scannedDirectories: progress.scannedDirectories,
        totalDirectories: progress.scannedDirectories + progress.pendingDirectories,
        foundFiles: progress.foundFiles,
        percentage: progress.estimatedProgress,
        pendingDirectories: [],
        completedDirectories: [],
      })
    } : undefined,
  })

  return {
    taskId: taskId || result.taskId,
    totalFiles: result.totalFiles,
    imageCount: result.imageCount,
    videoCount: result.videoCount,
    files: result.files,
    failedDirectories: result.failedDirectories,
    rateLimitTriggered: result.rateLimitTriggered,
  }
}

/**
 * 获取媒体文件列表
 * 内部调用 smartScan 自动选择最优扫描方式
 */
export async function getMediaFiles(
  client: WebDAVClient,
  path: string = '/',
  options: {
    timeout?: number
    onProgress?: (currentPath: string, fileCount: number) => void
  } = {}
): Promise<FileStat[]> {
  const { timeout = 60000, onProgress } = options

  const result = await smartScan(client, path, {
    timeout,
    onProgress: onProgress ? (progress) => {
      onProgress(progress.currentPath, progress.foundFiles)
    } : undefined,
  })

  return result.files
}
