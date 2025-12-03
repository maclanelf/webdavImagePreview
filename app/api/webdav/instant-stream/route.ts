import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient } from '@/lib/webdav'
import { Readable, Transform } from 'stream'

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
  // 用于追踪当前请求的流，以便在客户端断开时清理
  let activeStream: any = null
  let isAborted = false
  
  // 监听客户端断开连接
  request.signal.addEventListener('abort', () => {
    console.log('🛑 [即点即播] 客户端断开连接，清理流资源')
    isAborted = true
    if (activeStream) {
      try {
        // 销毁 Node.js 流
        if (typeof activeStream.destroy === 'function') {
          activeStream.destroy()
        } else if (typeof activeStream.close === 'function') {
          activeStream.close()
        }
        console.log('✅ [即点即播] 流资源已清理')
      } catch (error) {
        console.error('❌ [即点即播] 清理流资源失败:', error)
      }
      activeStream = null
    }
  })
  
  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')
    const username = searchParams.get('username')
    const password = searchParams.get('password')
    const filepath = searchParams.get('filepath')

    if (!url || !username || !password || !filepath) {
      return NextResponse.json(
        { error: '请提供完整的配置信息和文件路径' },
        { status: 400 }
      )
    }
    
    // 如果请求已被取消，直接返回
    if (isAborted) {
      return new NextResponse(null, { status: 499 }) // Client Closed Request
    }

    console.log(`🎬 [即点即播] 请求视频: ${filepath}`)

    const client = getWebDAVClient({ url, username, password })
    
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
      const stat = await client.stat(filepath)
      fileSize = getFileSizeFromStat(stat)
      if (!fileSize) {
        throw new Error('无法获取文件大小')
      }
    } catch (error) {
      console.error('获取文件信息失败:', error)
      return NextResponse.json(
        { error: '获取文件信息失败' },
        { status: 500 }
      )
    }

    console.log(`📊 [即点即播] 文件大小: ${formatFileSize(fileSize)}`)

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
        // 这样避免了下载整个文件再截取的问题
        const stream = client.createReadStream(filepath, {
          range: { start, end }
        })
        
        // 保存流引用，以便在客户端断开时清理
        activeStream = stream
        
        // 监听流的各种结束事件，确保资源被正确释放
        stream.on('end', () => {
          console.log(`📦 [即点即播] Range流传输完成: ${start}-${end}`)
          activeStream = null
        })
        stream.on('error', (error: any) => {
          console.error(`❌ [即点即播] Range流错误:`, error.message)
          activeStream = null
        })
        stream.on('close', () => {
          console.log(`🔒 [即点即播] Range流已关闭`)
          activeStream = null
        })
        
        const webStream = Readable.toWeb(stream as any) as ReadableStream
        
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
      const stream = client.createReadStream(filepath)
      
      // 保存流引用，以便在客户端断开时清理
      activeStream = stream
      
      // 监听流的各种结束事件，确保资源被正确释放
      stream.on('end', () => {
        console.log(`📦 [即点即播] 完整流传输完成`)
        activeStream = null
      })
      stream.on('error', (error: any) => {
        console.error(`❌ [即点即播] 完整流错误:`, error.message)
        activeStream = null
      })
      stream.on('close', () => {
        console.log(`🔒 [即点即播] 完整流已关闭`)
        activeStream = null
      })
      
      const webStream = Readable.toWeb(stream as any) as ReadableStream
      
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
