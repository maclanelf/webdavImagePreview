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
    onProgress?: (currentPath: string, fileCount: number, totalFiles?: number, scannedDirs?: number, totalDirs?: number) => void
  } = {}
): Promise<FileStat[]> {
  const { maxDepth = 10, maxFiles = 200000, timeout = 60000, onProgress } = options
  const startTime = Date.now()
  
  const mediaFiles: FileStat[] = []
  let scannedDirectories = 0
  let totalDirectories = 0
  
  // 首先估算总目录数（用于进度计算）
  async function estimateTotalDirectories(currentPath: string, currentDepth: number = 0): Promise<number> {
    if (currentDepth >= maxDepth) return 0
    
    try {
      const contents = await client.getDirectoryContents(currentPath) as FileStat[]
      const directories = contents.filter(item => item.type === 'directory')
      
      let total = directories.length
      for (const dir of directories) {
        total += await estimateTotalDirectories(dir.filename, currentDepth + 1)
      }
      return total
    } catch (error) {
      return 0
    }
  }
  
  // 估算总目录数
  totalDirectories = await estimateTotalDirectories(path)
  
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
        const percentage = totalDirectories > 0 ? Math.round((scannedDirectories / totalDirectories) * 100) : 0
        onProgress(currentPath, mediaFiles.length, undefined, scannedDirectories, totalDirectories)
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
        scannedDirectories++
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

// 递归扫描接口定义
export interface RecursiveScanOptions {
  batchSize?: number // 每批处理的目录数量
  onProgress?: (progress: RecursiveScanProgress) => void
  onBatchComplete?: (files: FileStat[], batchInfo: BatchInfo) => void
}

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

// 分步递归扫描函数
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
}> {
  const { 
    batchSize = 10,
    onProgress,
    onBatchComplete 
  } = options

  const scanTaskId = taskId || `recursive_scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const startTime = Date.now()
  
  const allFiles: FileStat[] = []
  const pendingDirectories: string[] = [rootPath]
  const completedDirectories: string[] = []
  let scannedDirectories = 0
  let totalDirectories = 0
  let batchNumber = 0

  // 首先估算总目录数
  async function estimateTotalDirectories(paths: string[]): Promise<number> {
    let total = 0
    for (const path of paths) {
      try {
        const contents = await client.getDirectoryContents(path) as FileStat[]
        const directories = contents.filter(item => item.type === 'directory')
        total += directories.length
        // 递归估算子目录
        if (directories.length > 0) {
          total += await estimateTotalDirectories(directories.map(d => d.filename))
        }
      } catch (error) {
        console.warn(`估算目录失败: ${path}`, error)
      }
    }
    return total
  }

  // 估算总目录数
  totalDirectories = await estimateTotalDirectories([rootPath])

  // 处理单个目录
  async function processDirectory(path: string): Promise<FileStat[]> {
    try {
      const contents = await client.getDirectoryContents(path) as FileStat[]
      const files: FileStat[] = []
      const subDirectories: string[] = []

      for (const item of contents) {
        if (item.type === 'file') {
          const filename = item.filename.toLowerCase()
          if (isMediaFile(filename)) {
            files.push(item)
          }
        } else if (item.type === 'directory') {
          subDirectories.push(item.filename)
        }
      }

      // 将子目录添加到待处理队列
      pendingDirectories.push(...subDirectories)
      
      return files
    } catch (error: any) {
      console.warn(`处理目录失败: ${path}`, error.message)
      return []
    }
  }

  // 批量处理目录
  while (pendingDirectories.length > 0) {
    // 取出一批目录进行处理
    const batchDirectories = pendingDirectories.splice(0, batchSize)
    batchNumber++
    
    const batchFiles: FileStat[] = []
    
    // 并行处理当前批次的目录
    const batchPromises = batchDirectories.map(async (dirPath) => {
      const files = await processDirectory(dirPath)
      scannedDirectories++
      completedDirectories.push(dirPath)
      return files
    })

    const batchResults = await Promise.all(batchPromises)
    
    // 合并结果
    for (const files of batchResults) {
      batchFiles.push(...files)
    }

    allFiles.push(...batchFiles)

    // 计算进度
    const percentage = totalDirectories > 0 ? Math.round((scannedDirectories / totalDirectories) * 100) : 0

    // 报告进度
    if (onProgress) {
      onProgress({
        taskId: scanTaskId,
        currentPath: batchDirectories[batchDirectories.length - 1] || rootPath,
        scannedDirectories,
        totalDirectories,
        foundFiles: allFiles.length,
        percentage,
        pendingDirectories: [...pendingDirectories],
        completedDirectories: [...completedDirectories]
      })
    }

    // 批次完成回调
    if (onBatchComplete) {
      onBatchComplete(batchFiles, {
        batchNumber,
        directoriesInBatch: batchDirectories.length,
        filesFoundInBatch: batchFiles.length,
        totalBatches: Math.ceil(totalDirectories / batchSize)
      })
    }

    console.log(`批次 ${batchNumber} 完成: 处理了 ${batchDirectories.length} 个目录，找到 ${batchFiles.length} 个文件，总计 ${allFiles.length} 个文件 (${percentage}%)`)
  }

  // 统计信息
  const imageCount = allFiles.filter(f => isImageFile(f.filename.toLowerCase())).length
  const videoCount = allFiles.filter(f => isVideoFile(f.filename.toLowerCase())).length

  console.log(`递归扫描完成，共找到 ${allFiles.length} 个媒体文件 (图片: ${imageCount}, 视频: ${videoCount})，耗时 ${Date.now() - startTime}ms`)

  return {
    taskId: scanTaskId,
    totalFiles: allFiles.length,
    imageCount,
    videoCount,
    files: allFiles
  }
}

// 恢复扫描任务（从数据库恢复状态）
export async function resumeRecursiveScan(
  client: WebDAVClient,
  taskData: any,
  options: RecursiveScanOptions = {}
): Promise<{
  taskId: string
  totalFiles: number
  imageCount: number
  videoCount: number
  files: FileStat[]
}> {
  const { 
    batchSize = 10,
    onProgress,
    onBatchComplete 
  } = options

  const taskId = taskData.task_id
  const startTime = Date.now()
  
  const allFiles: FileStat[] = []
  const pendingDirectories: string[] = taskData.pending_directories ? JSON.parse(taskData.pending_directories) : []
  const completedDirectories: string[] = taskData.completed_directories ? JSON.parse(taskData.completed_directories) : []
  let scannedDirectories = taskData.scanned_directories || 0
  const totalDirectories = taskData.total_directories || 0
  let batchNumber = Math.floor(scannedDirectories / batchSize)

  // 处理单个目录（与上面相同的函数）
  async function processDirectory(path: string): Promise<FileStat[]> {
    try {
      const contents = await client.getDirectoryContents(path) as FileStat[]
      const files: FileStat[] = []
      const subDirectories: string[] = []

      for (const item of contents) {
        if (item.type === 'file') {
          const filename = item.filename.toLowerCase()
          if (isMediaFile(filename)) {
            files.push(item)
          }
        } else if (item.type === 'directory') {
          subDirectories.push(item.filename)
        }
      }

      pendingDirectories.push(...subDirectories)
      return files
    } catch (error: any) {
      console.warn(`处理目录失败: ${path}`, error.message)
      return []
    }
  }

  // 继续批量处理目录
  while (pendingDirectories.length > 0) {
    // 取出一批目录进行处理
    const batchDirectories = pendingDirectories.splice(0, batchSize)
    batchNumber++
    
    const batchFiles: FileStat[] = []
    
    // 并行处理当前批次的目录
    const batchPromises = batchDirectories.map(async (dirPath) => {
      const files = await processDirectory(dirPath)
      scannedDirectories++
      completedDirectories.push(dirPath)
      return files
    })

    const batchResults = await Promise.all(batchPromises)
    
    // 合并结果
    for (const files of batchResults) {
      batchFiles.push(...files)
    }

    allFiles.push(...batchFiles)

    // 计算进度
    const percentage = totalDirectories > 0 ? Math.round((scannedDirectories / totalDirectories) * 100) : 0

    // 报告进度
    if (onProgress) {
      onProgress({
        taskId,
        currentPath: batchDirectories[batchDirectories.length - 1] || taskData.root_path,
        scannedDirectories,
        totalDirectories,
        foundFiles: allFiles.length,
        percentage,
        pendingDirectories: [...pendingDirectories],
        completedDirectories: [...completedDirectories]
      })
    }

    // 批次完成回调
    if (onBatchComplete) {
      onBatchComplete(batchFiles, {
        batchNumber,
        directoriesInBatch: batchDirectories.length,
        filesFoundInBatch: batchFiles.length,
        totalBatches: Math.ceil(totalDirectories / batchSize)
      })
    }

    console.log(`恢复扫描批次 ${batchNumber} 完成: 处理了 ${batchDirectories.length} 个目录，找到 ${batchFiles.length} 个文件，总计 ${allFiles.length} 个文件 (${percentage}%)`)
  }

  // 统计信息
  const imageCount = allFiles.filter(f => isImageFile(f.filename.toLowerCase())).length
  const videoCount = allFiles.filter(f => isVideoFile(f.filename.toLowerCase())).length

  console.log(`恢复扫描完成，共找到 ${allFiles.length} 个媒体文件 (图片: ${imageCount}, 视频: ${videoCount})，耗时 ${Date.now() - startTime}ms`)

  return {
    taskId,
    totalFiles: allFiles.length,
    imageCount,
    videoCount,
    files: allFiles
  }
}

