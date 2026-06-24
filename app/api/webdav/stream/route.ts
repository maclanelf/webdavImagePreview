import { NextRequest, NextResponse } from 'next/server'
import { buildFileUrl, normalizeFilePath, type SourceType } from '@/lib/urlBuilder'

const UPSTREAM_FETCH_TIMEOUT_MS = 15000

function isExpectedAbortError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.toLowerCase()

  return name === 'AbortError'
    || name === 'ResponseAborted'
    || normalized.includes('abort')
    || normalized.includes('aborted')
    || normalized.includes('responseaborted')
    || normalized.includes('failed to pipe response')
    || normalized.includes('premature close')
    || normalized.includes('client closed')
}

function buildUpstreamHeaders(request: NextRequest, username: string, password: string): Headers {
  const headers = new Headers({
    'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    'Accept': '*/*',
  })

  const passthroughHeaders = [
    'range',
    'if-none-match',
    'if-modified-since',
    'accept-language',
    'user-agent',
  ]

  for (const headerName of passthroughHeaders) {
    const headerValue = request.headers.get(headerName)
    if (headerValue) {
      headers.set(headerName, headerValue)
    }
  }

  return headers
}

async function readResponseTextSafely(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

export async function POST(request: NextRequest) {
  const abortController = new AbortController()
  let upstreamTimedOut = false
  const handleAbort = () => {
    console.log('🛑 [文件流] 客户端断开连接')
    abortController.abort()
  }

  request.signal.addEventListener('abort', handleAbort, { once: true })
  const timeoutId = setTimeout(() => {
    upstreamTimedOut = true
    console.warn(`⏰ [文件流] 上游请求超过 ${Math.round(UPSTREAM_FETCH_TIMEOUT_MS / 1000)}s，主动中止`)
    abortController.abort()
  }, UPSTREAM_FETCH_TIMEOUT_MS)

  try {
    const body = await request.json()
    const { url, username, password, filepath, sourceType = 'clouddrive2' } = body
    console.log('请求参数:', { url, username, filepath, sourceType })

    if (!url || !username || !password || !filepath) {
      return NextResponse.json(
        { error: '请提供完整的配置信息和文件路径' },
        { status: 400 }
      )
    }

    // 规范化文件路径（OpenList 需要替换全角斜杠为竖线）
    const normalizedPath = normalizeFilePath(filepath, sourceType as SourceType)
    console.log('规范化路径:', normalizedPath)

    if (request.signal.aborted) {
      return new NextResponse(null, { status: 499 })
    }

    // 获取文件扩展名以确定MIME类型
    const ext = filepath.toLowerCase().split('.').pop()
    let contentType = 'application/octet-stream'
    
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'bmp': 'image/bmp',
      'tiff': 'image/tiff',
      'tif': 'image/tiff',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
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
    
    if (ext && mimeTypes[ext]) {
      contentType = mimeTypes[ext]
    }

    // 构建完整的文件 URL（用于日志）
    const fullFileUrl = buildFileUrl(url, filepath, sourceType as SourceType)
    console.log('完整文件 URL:', fullFileUrl)

    const upstreamResponse = await fetch(fullFileUrl, {
      method: 'GET',
      headers: buildUpstreamHeaders(request, username, password),
      signal: abortController.signal,
      cache: 'no-store',
    })

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const errorText = await readResponseTextSafely(upstreamResponse)
      console.error('获取文件流失败: 上游响应异常', {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        normalizedPath,
        fullFileUrl,
        errorText,
      })

      return NextResponse.json(
        {
          error: `获取文件失败: 上游返回 ${upstreamResponse.status} ${upstreamResponse.statusText}`,
          status: upstreamResponse.status,
          normalizedPath,
        },
        { status: upstreamResponse.status || 502 }
      )
    }

    const responseHeaders = new Headers()
    responseHeaders.set('Content-Type', upstreamResponse.headers.get('content-type') || contentType)
    responseHeaders.set('Cache-Control', 'public, max-age=31536000')

    const passthroughHeaders = [
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
      'content-disposition',
    ]

    for (const headerName of passthroughHeaders) {
      const headerValue = upstreamResponse.headers.get(headerName)
      if (headerValue) {
        responseHeaders.set(headerName, headerValue)
      }
    }

    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    })
  } catch (error: any) {
    if (upstreamTimedOut) {
      console.error('获取文件流失败: 上游请求超时', error)
      return NextResponse.json(
        { error: `获取文件失败: 上游请求超时（${Math.round(UPSTREAM_FETCH_TIMEOUT_MS / 1000)}s）` },
        { status: 504 }
      )
    }

    if (request.signal.aborted || abortController.signal.aborted || isExpectedAbortError(error)) {
      console.warn('ℹ️ [文件流] 请求已中止，忽略预期内异常:', error)
      return new NextResponse(null, { status: 499 })
    }

    console.error('获取文件流失败:', error)
    return NextResponse.json(
      { error: `获取文件失败: ${error.message}` },
      { status: 500 }
    )
  } finally {
    clearTimeout(timeoutId)
    request.signal.removeEventListener('abort', handleAbort)
  }
}
