import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient } from '@/lib/webdav-optimized'
import { nodeReadableToWebReadable } from '@/lib/nodeReadableToWebReadable'
import { buildFileUrl, normalizeFilePath, type SourceType } from '@/lib/urlBuilder'

export async function POST(request: NextRequest) {
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

    const client = getWebDAVClient({ url, username, password })
    const stream = client.createReadStream(normalizedPath)
    
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

    // 将 Node.js stream 转换为 Web ReadableStream
    const webStream = nodeReadableToWebReadable(stream as any)

    // 构建完整的文件 URL（用于日志）
    const fullFileUrl = buildFileUrl(url, filepath, sourceType as SourceType)
    console.log('完整文件 URL:', fullFileUrl)

    return new NextResponse(webStream, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      },
    })
  } catch (error: any) {
    console.error('获取文件流失败:', error)
    return NextResponse.json(
      { error: `获取文件失败: ${error.message}` },
      { status: 500 }
    )
  }
}
