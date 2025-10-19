import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient } from '@/lib/webdav'
import { Readable } from 'stream'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, username, password, filepath } = body

    if (!url || !username || !password || !filepath) {
      return NextResponse.json(
        { error: '请提供完整的配置信息和文件路径' },
        { status: 400 }
      )
    }

    const client = getWebDAVClient({ url, username, password })
    const stream = client.createReadStream(filepath)
    
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
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
    }
    
    if (ext && mimeTypes[ext]) {
      contentType = mimeTypes[ext]
    }

    // 将Node.js stream转换为Web ReadableStream
    const webStream = Readable.toWeb(stream as any) as ReadableStream

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

