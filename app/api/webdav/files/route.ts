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
    
    // 返回文件列表
    const fileList = allFiles.map(file => ({
      filename: file.filename,
      basename: file.basename,
      size: file.size,
      type: file.type,
      lastmod: file.lastmod,
    }))
    
    return NextResponse.json({ files: fileList })
  } catch (error: any) {
    console.error('获取文件列表失败:', error)
    return NextResponse.json(
      { error: `获取文件失败: ${error.message}` },
      { status: 500 }
    )
  }
}

