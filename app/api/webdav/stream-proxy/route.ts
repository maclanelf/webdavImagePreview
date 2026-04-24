import { NextRequest, NextResponse } from 'next/server'

import { buildFileUrl, normalizeFilePath, type SourceType } from '@/lib/urlBuilder'

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  flv: 'video/x-flv',
  wmv: 'video/x-ms-wmv',
  m4v: 'video/x-m4v',
  '3gp': 'video/3gpp',
  ogv: 'video/ogg',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
}

export async function GET(request: NextRequest) {
  const abortController = new AbortController()
  const handleAbort = () => {
    console.log('🛑 [代理流] 客户端断开连接')
    abortController.abort()
  }

  request.signal.addEventListener('abort', handleAbort, { once: true })

  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')
    const username = searchParams.get('username')
    const password = searchParams.get('password')
    const filepath = searchParams.get('filepath')
    const sourceType = (searchParams.get('sourceType') || 'clouddrive2') as SourceType

    if (!url || !username || !password || !filepath) {
      return NextResponse.json({ error: '请提供完整的配置信息和文件路径' }, { status: 400 })
    }

    const normalizedPath = normalizeFilePath(filepath, sourceType)
    const fullFileUrl = buildFileUrl(url, filepath, sourceType)

    console.log('📂 [代理流] 规范化路径:', normalizedPath)
    console.log('🔗 [代理流] 完整文件 URL:', fullFileUrl)

    const extension = filepath.toLowerCase().split('.').pop() || ''
    const contentType = MIME_TYPES[extension] || 'application/octet-stream'

    const upstreamHeaders = new Headers({
      'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      'Accept': '*/*',
    })

    const rangeHeader = request.headers.get('range')
    if (rangeHeader) {
      upstreamHeaders.set('range', rangeHeader)
    }

    const upstreamResponse = await fetch(fullFileUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      signal: abortController.signal,
      cache: 'no-store',
    })

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const errorText = await upstreamResponse.text().catch(() => '')
      console.error('获取代理流失败: 上游响应异常', {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        normalizedPath,
        errorText,
      })

      return NextResponse.json(
        { error: `获取文件失败: 上游返回 ${upstreamResponse.status} ${upstreamResponse.statusText}` },
        { status: upstreamResponse.status || 502 }
      )
    }

    const responseHeaders = new Headers({
      'Content-Type': upstreamResponse.headers.get('content-type') || contentType,
      'Cache-Control': 'public, max-age=31536000',
    })

    for (const headerName of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'content-disposition']) {
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
    if (request.signal.aborted || abortController.signal.aborted || error?.name === 'AbortError' || error?.name === 'ResponseAborted') {
      console.warn('ℹ️ [代理流] 请求已中止，忽略预期内异常:', error)
      return new NextResponse(null, { status: 499 })
    }

    console.error('获取代理流失败:', error)
    return NextResponse.json({ error: `获取文件失败: ${error.message}` }, { status: 500 })
  } finally {
    request.signal.removeEventListener('abort', handleAbort)
  }
}
