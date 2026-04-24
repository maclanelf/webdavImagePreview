import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient } from '@/lib/webdav-optimized'
import { nodeReadableToWebReadable } from '@/lib/nodeReadableToWebReadable'
import { spawn, ChildProcess } from 'child_process'
import { PassThrough } from 'stream'

// 存储活跃的转码进程
const activeTranscodes = new Map<string, {
  process: ChildProcess
  abortController: AbortController
  filepath: string
  startTime: number
}>()

// 清理转码进程
function cleanupTranscode(requestId: string, reason: string) {
  const transcodeInfo = activeTranscodes.get(requestId)
  if (transcodeInfo) {
    console.log(`🧹 [转码] 清理进程 (${requestId}): ${reason}`)
    try {
      transcodeInfo.abortController.abort()
      transcodeInfo.process.kill('SIGKILL')
    } catch (e) {
      // 忽略清理错误
    }
    activeTranscodes.delete(requestId)
  }
}

// 定期清理超时的转码进程（超过30分钟）
setInterval(() => {
  const now = Date.now()
  const timeout = 30 * 60 * 1000 // 30分钟
  
  for (const [requestId, info] of activeTranscodes.entries()) {
    if (now - info.startTime > timeout) {
      cleanupTranscode(requestId, '超时清理')
    }
  }
}, 60 * 1000) // 每分钟检查一次

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
  const requestId = `transcode_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  let isAborted = false
  const abortController = new AbortController()
  
  // 监听客户端断开
  request.signal.addEventListener('abort', () => {
    console.log(`🛑 [转码] 客户端断开 (${requestId})`)
    isAborted = true
    cleanupTranscode(requestId, '客户端断开')
  })

  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')
    const username = searchParams.get('username')
    const password = searchParams.get('password')
    const filepath = searchParams.get('filepath')
    // 可选参数：输出格式、视频质量
    const format = searchParams.get('format') || 'mp4' // mp4 或 webm
    const quality = searchParams.get('quality') || 'medium' // low, medium, high

    if (!url || !username || !password || !filepath) {
      return NextResponse.json(
        { error: '请提供完整的配置信息和文件路径' },
        { status: 400 }
      )
    }

    if (isAborted) {
      return new NextResponse(null, { status: 499 })
    }

    console.log(`🎬 [转码] 开始转码: ${filepath} (${requestId})`)
    console.log(`📊 [转码] 格式: ${format}, 质量: ${quality}`)

    const client = getWebDAVClient({ url, username, password })

    // 获取文件信息
    let fileSize: number
    try {
      const stat = await client.stat(filepath)
      fileSize = getFileSizeFromStat(stat)
      console.log(`📊 [转码] 源文件大小: ${formatFileSize(fileSize)}`)
    } catch (error: any) {
      console.error('❌ [转码] 获取文件信息失败:', error.message)
      return NextResponse.json(
        { error: `文件不存在或无法访问: ${error.message}` },
        { status: 404 }
      )
    }

    if (isAborted) {
      return new NextResponse(null, { status: 499 })
    }

    // 从 WebDAV 获取源文件流
    const sourceStream = client.createReadStream(filepath, {
      signal: abortController.signal
    })

    // 构建 FFmpeg 参数
    const ffmpegArgs = buildFFmpegArgs(format, quality)
    
    console.log(`🔧 [转码] FFmpeg 参数: ffmpeg ${ffmpegArgs.join(' ')}`)

    // 启动 FFmpeg 进程
    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    // 注册到活跃转码列表
    activeTranscodes.set(requestId, {
      process: ffmpeg,
      abortController,
      filepath,
      startTime: Date.now()
    })

    // 创建输出流
    const outputStream = new PassThrough()

    // 将源流管道到 FFmpeg 输入
    sourceStream.pipe(ffmpeg.stdin!)

    // FFmpeg 输出管道到响应流
    ffmpeg.stdout!.pipe(outputStream)

    // 监听 FFmpeg 错误输出（用于调试）
    let ffmpegLogs = ''
    ffmpeg.stderr!.on('data', (data) => {
      const log = data.toString()
      ffmpegLogs += log
      // 只打印关键信息
      if (log.includes('Error') || log.includes('error') || log.includes('frame=')) {
        if (log.includes('frame=')) {
          // 进度信息，每10秒打印一次
          const match = log.match(/frame=\s*(\d+)/)
          if (match && parseInt(match[1]) % 250 === 0) {
            console.log(`📊 [转码] 进度: ${log.trim().substring(0, 100)}`)
          }
        } else {
          console.log(`⚠️ [转码] FFmpeg: ${log.trim().substring(0, 200)}`)
        }
      }
    })

    // 监听源流错误
    sourceStream.on('error', (error: any) => {
      console.error(`❌ [转码] 源流错误 (${requestId}):`, error.message)
      cleanupTranscode(requestId, '源流错误')
      outputStream.destroy(error)
    })

    // 监听 FFmpeg 进程事件
    ffmpeg.on('error', (error) => {
      console.error(`❌ [转码] FFmpeg 进程错误 (${requestId}):`, error.message)
      cleanupTranscode(requestId, 'FFmpeg 错误')
      outputStream.destroy(error)
    })

    ffmpeg.on('close', (code) => {
      console.log(`🏁 [转码] FFmpeg 进程结束 (${requestId}), 退出码: ${code}`)
      if (code !== 0 && code !== null) {
        console.error(`❌ [转码] FFmpeg 非正常退出，日志:\n${ffmpegLogs.slice(-500)}`)
      }
      activeTranscodes.delete(requestId)
    })

    // 监听输出流关闭
    outputStream.on('close', () => {
      console.log(`🔒 [转码] 输出流关闭 (${requestId})`)
      cleanupTranscode(requestId, '输出流关闭')
    })

    // 转换为 Web Stream
    const webStream = nodeReadableToWebReadable(outputStream as any)

    // 确定 Content-Type
    const contentType = format === 'webm' ? 'video/webm' : 'video/mp4'

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
        'X-Transcode-Request-Id': requestId,
      },
    })

  } catch (error: any) {
    console.error('❌ [转码] API 错误:', error)
    cleanupTranscode(requestId, 'API 错误')
    return NextResponse.json(
      { error: `转码失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 构建 FFmpeg 参数
function buildFFmpegArgs(format: string, quality: string): string[] {
  // 基础参数：从 stdin 读取，输出到 stdout
  const baseArgs = [
    '-i', 'pipe:0',           // 从 stdin 读取
    '-movflags', 'frag_keyframe+empty_moov+faststart', // 支持流式播放
    '-f', format === 'webm' ? 'webm' : 'mp4',
    'pipe:1'                  // 输出到 stdout
  ]

  // 视频编码参数
  let videoArgs: string[]
  let audioArgs: string[]

  if (format === 'webm') {
    // WebM 格式使用 VP9 + Opus
    const crf = quality === 'high' ? '23' : quality === 'low' ? '35' : '30'
    videoArgs = [
      '-c:v', 'libvpx-vp9',
      '-crf', crf,
      '-b:v', '0',            // 使用 CRF 模式
      '-deadline', 'realtime', // 实时编码，牺牲质量换速度
      '-cpu-used', '8',       // 最快速度
      '-row-mt', '1',         // 多线程
    ]
    audioArgs = [
      '-c:a', 'libopus',
      '-b:a', quality === 'high' ? '128k' : quality === 'low' ? '64k' : '96k',
    ]
  } else {
    // MP4 格式使用 H.264 + AAC
    const crf = quality === 'high' ? '20' : quality === 'low' ? '28' : '23'
    videoArgs = [
      '-c:v', 'libx264',
      '-preset', 'ultrafast',  // 最快编码速度
      '-tune', 'zerolatency',  // 低延迟
      '-crf', crf,
      '-profile:v', 'baseline', // 最大兼容性
      '-level', '3.0',
      '-pix_fmt', 'yuv420p',   // 兼容性最好的像素格式
    ]
    audioArgs = [
      '-c:a', 'aac',
      '-b:a', quality === 'high' ? '192k' : quality === 'low' ? '96k' : '128k',
      '-ar', '44100',          // 采样率
      '-ac', '2',              // 双声道
    ]
  }

  // 组合参数
  return [
    ...baseArgs.slice(0, 2),   // -i pipe:0
    ...videoArgs,
    ...audioArgs,
    ...baseArgs.slice(2),      // -movflags ... -f ... pipe:1
  ]
}

// 从 stat 对象获取文件大小
function getFileSizeFromStat(stat: any): number {
  if (typeof stat.size === 'number') return stat.size
  if (stat.data && typeof stat.data.size === 'number') return stat.data.size
  if (stat.props && stat.props.getcontentlength) {
    return parseInt(stat.props.getcontentlength, 10) || 0
  }
  return 0
}

// 格式化文件大小
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
