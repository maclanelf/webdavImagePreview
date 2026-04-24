import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient } from '@/lib/webdav-optimized'
import { normalizeFilePath, type SourceType } from '@/lib/urlBuilder'
import { nodeReadableToWebReadable } from '@/lib/nodeReadableToWebReadable'
import { PassThrough } from 'stream'
import {
  cleanupStream,
  registerStream,
  unregisterStream,
  cleanupOtherStreams,
  getActiveStreamCount,
  updateStreamActivity
} from '@/lib/streamManager'
import { webdavConfigs } from '@/lib/database'

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}

export async function GET(request: NextRequest) {
  // 生成唯一的请求 ID
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  let isAborted = false

  const isExpectedStreamTerminationError = (error: unknown) => {
    if (isAborted || abortController.signal.aborted) {
      return true
    }

    const message = error instanceof Error ? error.message : String(error || '')
    const normalized = message.toLowerCase()
    return (
      normalized.includes('abort')
      || normalized.includes('aborted')
      || normalized.includes('stream closed')
      || normalized.includes('client closed')
      || normalized.includes('premature close')
    )
  }
  
  // ⭐ 关键：为每个请求创建 AbortController
  // 这是唯一能真正取消 webdav 库底层 fetch 请求的方法
  const abortController = new AbortController()

  const createResponsePassThrough = () => {
    const passThrough = new PassThrough()
    let finalized = false

    const closePassThrough = () => {
      if (finalized) {
        return
      }

      finalized = true
      if (!passThrough.destroyed && !passThrough.writableEnded) {
        passThrough.end()
      }
    }

    const failPassThrough = (error?: Error) => {
      if (finalized) {
        return
      }

      finalized = true
      if (!passThrough.destroyed) {
        if (error) {
          passThrough.destroy(error)
        } else {
          passThrough.destroy()
        }
      }
    }

    return { passThrough, closePassThrough, failPassThrough }
  }
  
  // 监听客户端断开连接
  request.signal.addEventListener('abort', () => {
    console.log(`🛑 [即点即播] 客户端断开连接 (${requestId})`)
    isAborted = true
    cleanupStream(requestId, '客户端断开')
  }, { once: true })
  
  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')
    const username = searchParams.get('username')
    const password = searchParams.get('password')
    const filepath = searchParams.get('filepath')
    const sourceType = searchParams.get('sourceType') || 'clouddrive2'
    const forceWebDAV = searchParams.get('forceWebDAV') === 'true' // 是否强制使用 WebDAV

    if (!url || !username || !password || !filepath) {
      return NextResponse.json(
        { error: '请提供完整的配置信息和文件路径' },
        { status: 400 }
      )
    }
    
    // 从数据库获取配置，检查是否启用直链播放
    try {
      const config = webdavConfigs.get(url, username)
      
      // 如果启用了直链播放且配置了直链源，并且没有强制使用 WebDAV
      if (config?.enableDirectLink && config?.directLinkUrl && !forceWebDAV) {
        console.log(`🎯 [即点即播] 使用直链播放: ${filepath}`)
        console.log(`🔗 [即点即播] 直链源: ${config.directLinkUrl}`)
        
        // 构建 /d/ 直链 URL（通过 Nginx 代理访问）
        const directLinkPath = `/d${filepath}`
        
        console.log(`✅ [即点即播] 返回直链 URL: ${directLinkPath}`)
        
        // 返回 302 重定向到 /d/ URL
        // 浏览器会自动跟随重定向，Nginx 会将请求代理到 OpenList
        return NextResponse.redirect(new URL(directLinkPath, request.url), 302)
      }
      
      // 如果未启用直链或未配置直链源或强制使用 WebDAV，继续使用 WebDAV 流式传输
      if (forceWebDAV) {
        console.log(`📡 [即点即播] 强制使用 WebDAV 流式传输: ${filepath}`)
      } else {
        console.log(`📡 [即点即播] 使用 WebDAV 流式传输: ${filepath}`)
      }
    } catch (dbError) {
      // 如果数据库查询失败，继续使用 WebDAV 流式传输（降级策略）
      console.warn(`⚠️ [即点即播] 数据库查询失败，降级到 WebDAV 流式传输:`, dbError)
    }
    
    // 如果请求已被取消，直接返回
    if (isAborted) {
      return new NextResponse(null, { status: 499 }) // Client Closed Request
    }

    console.log(`🎬 [即点即播] 请求视频: ${filepath} (${requestId})`)
    console.log(`📊 [流管理] 当前活动流数量: ${getActiveStreamCount()}`)
    
    // ⭐ 关键修复：清理所有旧流（不仅仅是同一文件的）
    // 这确保切换到不同视频时，上一个视频的流也会被清理
    cleanupOtherStreams(requestId)

    const client = getWebDAVClient({ url, username, password })
    
    // 规范化文件路径（OpenList 需要去掉虚拟路径前缀并替换全角斜杠）
    const normalizedPath = normalizeFilePath(filepath, sourceType as SourceType)
    console.log(`📂 [即点即播] 原始路径: ${filepath}`)
    console.log(`📂 [即点即播] 规范化路径: ${normalizedPath}`)
    console.log(`📂 [即点即播] 源类型: ${sourceType}`)
    
    // 获取文件扩展名以确定MIME类型
    const ext = filepath.toLowerCase().split('.').pop()
    let contentType = 'video/mp4' // 默认为MP4
    
    const videoMimeTypes: Record<string, string> = {
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'flv': 'video/x-flv',
      'wmv': 'video/x-ms-wmv',
      'm4v': 'video/x-m4v',
      '3gp': 'video/3gpp',
      'ogv': 'video/ogg',
      'ts': 'video/mp2t',
      'mts': 'video/mp2t',
      'm2ts': 'video/mp2t',
    }
    
    if (ext && videoMimeTypes[ext]) {
      contentType = videoMimeTypes[ext]
    }

    // 获取文件大小
    let fileSize: number
    try {
      console.log(`📂 [即点即播] 尝试获取文件信息...`)
      console.log(`📂 [即点即播] WebDAV URL: ${url}`)
      console.log(`📂 [即点即播] 使用规范化路径获取文件信息`)
      
      const stat = await client.stat(normalizedPath)
      fileSize = getFileSizeFromStat(stat)
      if (!fileSize) {
        throw new Error('无法获取文件大小')
      }
    } catch (error: any) {
      console.error('❌ [即点即播] 获取文件信息失败:', error)
      console.error('❌ [即点即播] 错误详情:', {
        message: error.message,
        status: error.status,
        originalPath: filepath,
        normalizedPath: normalizedPath,
        sourceType: sourceType,
      })
      
      // 返回更详细的错误信息
      const statusCode = error.status || 500
      const errorMessage = statusCode === 404 
        ? `文件不存在: ${filepath}` 
        : `获取文件信息失败: ${error.message}`
      
      return NextResponse.json(
        { error: errorMessage, filepath, normalizedPath, sourceType, status: statusCode },
        { status: statusCode }
      )
    }

    console.log(`📊 [即点即播] 文件大小: ${formatFileSize(fileSize)}`)

    // 注意：OpenList 的 CDN 直链无法在浏览器中使用，因为：
    // 1. CORS 限制 - CDN 不返回 Access-Control-Allow-Origin 头
    // 2. Referer 检查 - CDN 有防盗链保护
    // 因此 OpenList 和 CloudDrive2 都使用 WebDAV 流式传输

    // 检查是否为 Range 请求
    const rangeHeader = request.headers.get('range')
    
    if (rangeHeader) {
      console.log(`📡 [即点即播] Range请求: ${rangeHeader}`)
      
      // 处理 Range 请求
      try {
        // 解析 Range 头
        const ranges = parseRangeHeader(rangeHeader, fileSize)
        
        if (!ranges || ranges.length === 0) {
          return new NextResponse('Invalid Range', { 
            status: 416,
            headers: {
              'Content-Range': `bytes */${fileSize}`,
            }
          })
        }
        
        // 目前只支持单个范围请求
        const range = ranges[0]
        let { start, end } = range
        let contentLength = end - start + 1
        
        // 关键策略：对于末尾的大范围请求（获取moov元数据），限制返回大小
        // 对于初始请求 bytes=0-，声明返回整个文件，让浏览器自己控制接收
        const MAX_TAIL_SIZE = 20 * 1024 * 1024 // 20MB
        const isNearEndRequest = start > fileSize * 0.8 // 起始位置在文件80%之后
        
        if (isNearEndRequest && contentLength > MAX_TAIL_SIZE) {
          // 限制末尾请求的大小，避免传输过多数据
          const originalEnd = end
          end = start + MAX_TAIL_SIZE - 1
          contentLength = end - start + 1
          console.log(`⚡ [即点即播] 末尾请求优化: ${start}-${originalEnd} → ${start}-${end} (${formatFileSize(contentLength)})`)
        }
        
        console.log(`🎯 [即点即播] Range: ${start}-${end}/${fileSize} (${formatFileSize(contentLength)})`)
        
        // 如果请求已被取消，直接返回
        if (isAborted) {
          return new NextResponse(null, { status: 499 })
        }
        
        // 创建范围流 - 直接让WebDAV客户端处理Range请求
        // ⭐ 关键：传入 signal 以便能够取消底层的 fetch 请求
        const sourceStream = client.createReadStream(normalizedPath, {
          range: { start, end },
          signal: abortController.signal
        })
        
        // 使用 PassThrough 包装流，以便更好地控制生命周期
        const { passThrough, closePassThrough, failPassThrough } = createResponsePassThrough()
        
        // 注册到全局流管理器，包含 AbortController
        registerStream(requestId, sourceStream, filepath, abortController)
        
        // 监听源流事件
        sourceStream.on('data', () => {
          // 每次有数据传输时更新活动时间，防止正在播放的视频被超时清理
          updateStreamActivity(requestId)
        })
        sourceStream.on('end', () => {
          console.log(`📦 [即点即播] Range流传输完成: ${start}-${end} (${requestId})`)
          unregisterStream(requestId)
        })
        sourceStream.on('error', (error: any) => {
          if (isExpectedStreamTerminationError(error)) {
            console.log(`ℹ️ [即点即播] Range流按预期结束 (${requestId}): ${error?.message || '已取消'}`)
            unregisterStream(requestId)
            closePassThrough()
            return
          }
          console.error(`❌ [即点即播] Range流错误 (${requestId}):`, error.message)
          unregisterStream(requestId)
          failPassThrough(error)
        })
        sourceStream.on('close', () => {
          console.log(`🔒 [即点即播] Range流已关闭 (${requestId})`)
          unregisterStream(requestId)
        })
        
        // 管道连接
        sourceStream.pipe(passThrough, { end: false })
        sourceStream.on('end', () => {
          closePassThrough()
        })
        
        // 监听 passThrough 的关闭事件，确保源流也被关闭
        passThrough.on('close', () => {
          console.log(`🔒 [即点即播] PassThrough 关闭，清理源流 (${requestId})`)
          cleanupStream(requestId, 'PassThrough 关闭')
        })
        
        const webStream = nodeReadableToWebReadable(passThrough as any)
        
        return new NextResponse(webStream, {
          status: 206, // Partial Content
          headers: {
            'Content-Type': contentType,
            'Content-Length': contentLength.toString(),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Expose-Headers': '*',
            'Connection': 'keep-alive',
          },
        })
      } catch (error) {
        console.error('处理 Range 请求失败:', error)
        // 如果 Range 请求失败，回退到初始块逻辑
      }
    }

    // 对于没有Range请求的情况，返回完整文件流并支持Range请求
    // 浏览器会根据需要主动使用Range请求或中断连接
    console.log(`🚀 [即点即播] 非Range请求，返回完整文件流 (${formatFileSize(fileSize)})`)
    
    // 如果请求已被取消，直接返回
    if (isAborted) {
      return new NextResponse(null, { status: 499 })
    }
    
    try {
      // ⭐ 关键：传入 signal 以便能够取消底层的 fetch 请求
      const sourceStream = client.createReadStream(normalizedPath, {
        signal: abortController.signal
      })
      
      // 使用 PassThrough 包装流
      const { passThrough, closePassThrough, failPassThrough } = createResponsePassThrough()
      
      // 注册到全局流管理器，包含 AbortController
      registerStream(requestId, sourceStream, filepath, abortController)
      
      // 监听源流事件
      sourceStream.on('data', () => {
        // 每次有数据传输时更新活动时间，防止正在播放的视频被超时清理
        updateStreamActivity(requestId)
      })
      sourceStream.on('end', () => {
        console.log(`📦 [即点即播] 完整流传输完成 (${requestId})`)
        unregisterStream(requestId)
      })
        sourceStream.on('error', (error: any) => {
          if (isExpectedStreamTerminationError(error)) {
            console.log(`ℹ️ [即点即播] 完整流按预期结束 (${requestId}): ${error?.message || '已取消'}`)
            unregisterStream(requestId)
            closePassThrough()
            return
          }
          console.error(`❌ [即点即播] 完整流错误 (${requestId}):`, error.message)
          unregisterStream(requestId)
          failPassThrough(error)
        })
      sourceStream.on('close', () => {
        console.log(`🔒 [即点即播] 完整流已关闭 (${requestId})`)
        unregisterStream(requestId)
      })
      
      // 管道连接
      sourceStream.pipe(passThrough, { end: false })
      sourceStream.on('end', () => {
        closePassThrough()
      })
      
      // 监听 passThrough 的关闭事件
      passThrough.on('close', () => {
        console.log(`🔒 [即点即播] PassThrough 关闭，清理源流 (${requestId})`)
        cleanupStream(requestId, 'PassThrough 关闭')
      })
      
      const webStream = nodeReadableToWebReadable(passThrough as any)
      
      return new NextResponse(webStream, {
        status: 200, // 完整内容
        headers: {
          'Content-Type': contentType,
          'Content-Length': fileSize.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Expose-Headers': '*',
          'Connection': 'keep-alive',
        },
      })
    } catch (error) {
      console.error('创建文件流失败:', error)
      return NextResponse.json(
        { error: `创建流失败: ${error}` },
        { status: 500 }
      )
    }
  } catch (error: any) {
    console.error('即点即播API失败:', error)
    return NextResponse.json(
      { error: `获取视频失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 解析 Range 头的辅助函数
function parseRangeHeader(rangeHeader: string, fileSize: number): Array<{ start: number; end: number }> | null {
  const ranges: Array<{ start: number; end: number }> = []
  
  // 移除 "bytes=" 前缀
  const rangeSpec = rangeHeader.replace(/bytes=/, '')
  
  // 分割多个范围（虽然我们目前只支持单个范围）
  const rangeList = rangeSpec.split(',')
  
  for (const range of rangeList) {
    const parts = range.trim().split('-')
    
    if (parts.length !== 2) continue
    
    const startStr = parts[0].trim()
    const endStr = parts[1].trim()
    
    let start: number
    let end: number
    
    if (startStr === '' && endStr !== '') {
      // 后缀范围: -500 (最后500字节)
      const suffixLength = parseInt(endStr, 10)
      if (isNaN(suffixLength)) continue
      
      start = Math.max(0, fileSize - suffixLength)
      end = fileSize - 1
    } else if (startStr !== '' && endStr === '') {
      // 前缀范围: 500- (从500字节到结尾)
      start = parseInt(startStr, 10)
      if (isNaN(start)) continue
      
      end = fileSize - 1
    } else if (startStr !== '' && endStr !== '') {
      // 完整范围: 500-999
      start = parseInt(startStr, 10)
      end = parseInt(endStr, 10)
      
      if (isNaN(start) || isNaN(end)) continue
    } else {
      // 无效格式
      continue
    }
    
    // 验证范围
    if (start < 0 || end < 0 || start >= fileSize || end >= fileSize || start > end) {
      continue
    }
    
    ranges.push({ start, end })
  }
  
  return ranges.length > 0 ? ranges : null
}

// 从stat对象获取文件大小的辅助函数
function getFileSizeFromStat(stat: any): number {
  if (typeof stat.size === 'number') {
    return stat.size
  }
  
  if (stat.data && typeof stat.data.size === 'number') {
    return stat.data.size
  }
  
  if (stat.props && stat.props.getcontentlength) {
    const size = parseInt(stat.props.getcontentlength, 10)
    if (!isNaN(size)) {
      return size
    }
  }
  
  return 0
}

// 格式化文件大小的辅助函数
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
