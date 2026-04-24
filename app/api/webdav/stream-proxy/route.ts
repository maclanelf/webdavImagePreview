import { NextRequest, NextResponse } from 'next/server'

import { getWebDAVClient } from '@/lib/webdav-optimized'
import { nodeReadableToWebReadable } from '@/lib/nodeReadableToWebReadable'
import { normalizeFilePath, type SourceType } from '@/lib/urlBuilder'

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

    const client = getWebDAVClient({ url, username, password })
    const normalizedPath = normalizeFilePath(filepath, sourceType)
    const stream = client.createReadStream(normalizedPath)
    const extension = filepath.toLowerCase().split('.').pop() || ''
    const contentType = MIME_TYPES[extension] || 'application/octet-stream'
    const webStream = nodeReadableToWebReadable(stream as any)

    return new NextResponse(webStream, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      },
    })
  } catch (error: any) {
    console.error('获取代理流失败:', error)
    return NextResponse.json({ error: `获取文件失败: ${error.message}` }, { status: 500 })
  }
}
