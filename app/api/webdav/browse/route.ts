import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient } from '@/lib/webdav'
import { FileStat } from 'webdav'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, username, password, path = '/' } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    const client = getWebDAVClient({ url, username, password })
    
    // 获取目录内容
    const contents = await client.getDirectoryContents(path) as FileStat[]
    
    // 只返回目录，过滤掉文件
    const directories = contents
      .filter(item => item.type === 'directory')
      .map(dir => ({
        filename: dir.filename,
        basename: dir.basename,
        lastmod: dir.lastmod,
        size: dir.size,
      }))
      .sort((a, b) => a.basename.localeCompare(b.basename, 'zh-CN'))
    
    return NextResponse.json({ directories })
  } catch (error: any) {
    console.error('浏览目录失败:', error)
    return NextResponse.json(
      { error: `浏览目录失败: ${error.message}` },
      { status: 500 }
    )
  }
}

