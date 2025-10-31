import { NextRequest, NextResponse } from 'next/server'
import { webdavConfigs } from '@/lib/database'

// 获取默认 WebDAV 配置
export async function GET() {
  try {
    const config = webdavConfigs.getDefault()
    if (!config) {
      return NextResponse.json(
        { error: '未找到默认配置' },
        { status: 404 }
      )
    }
    
    // 返回格式化的配置，不包含 id 等数据库字段
    return NextResponse.json({
      url: config.url,
      username: config.username,
      password: config.password,
      mediaPaths: config.mediaPaths,
      scanSettings: config.scanSettings
    })
  } catch (error: any) {
    console.error('获取默认配置失败:', error)
    return NextResponse.json(
      { error: `获取默认配置失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 设置默认配置
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, username } = body

    if (!url || !username) {
      return NextResponse.json(
        { error: '请提供 URL 和用户名' },
        { status: 400 }
      )
    }

    webdavConfigs.setDefault(url, username)
    return NextResponse.json({ message: '默认配置设置成功' })
  } catch (error: any) {
    console.error('设置默认配置失败:', error)
    return NextResponse.json(
      { error: `设置默认配置失败: ${error.message}` },
      { status: 500 }
    )
  }
}

