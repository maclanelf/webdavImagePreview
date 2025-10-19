import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, getMediaFiles } from '@/lib/webdav'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, username, password, mediaPaths = ['/'] } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    const client = getWebDAVClient({ url, username, password })
    
    // 从所有路径获取文件
    const allFiles = []
    for (const path of mediaPaths) {
      const files = await getMediaFiles(client, path)
      allFiles.push(...files)
    }
    
    if (allFiles.length === 0) {
      return NextResponse.json(
        { error: '未找到任何媒体文件' },
        { status: 404 }
      )
    }
    
    // 随机选择一个文件
    const randomFile = allFiles[Math.floor(Math.random() * allFiles.length)]
    
    return NextResponse.json({
      file: {
        filename: randomFile.filename,
        basename: randomFile.basename,
        size: randomFile.size,
        type: randomFile.type,
        lastmod: randomFile.lastmod,
      }
    })
  } catch (error: any) {
    console.error('获取随机文件失败:', error)
    return NextResponse.json(
      { error: `获取随机文件失败: ${error.message}` },
      { status: 500 }
    )
  }
}

