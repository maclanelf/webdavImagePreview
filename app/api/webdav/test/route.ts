import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient } from '@/lib/webdav'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, username, password } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    const client = getWebDAVClient({ url, username, password })
    
    // 测试连接
    await client.getDirectoryContents('/')
    
    return NextResponse.json({ success: true, message: '连接成功！' })
  } catch (error: any) {
    console.error('WebDAV连接测试失败:', error)
    return NextResponse.json(
      { error: `连接失败: ${error.message}` },
      { status: 500 }
    )
  }
}

