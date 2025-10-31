import { NextRequest, NextResponse } from 'next/server'
import { webdavConfigs } from '@/lib/database'

// 获取所有 WebDAV 配置
export async function GET(request: NextRequest) {
  try {
    const configs = webdavConfigs.getAll()
    return NextResponse.json({ configs })
  } catch (error: any) {
    console.error('获取 WebDAV 配置失败:', error)
    return NextResponse.json(
      { error: `获取配置失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 保存或更新 WebDAV 配置
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, username, password, mediaPaths, scanSettings, isDefault } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的 WebDAV 配置信息' },
        { status: 400 }
      )
    }

    if (!mediaPaths || !Array.isArray(mediaPaths) || mediaPaths.length === 0) {
      return NextResponse.json(
        { error: '请至少提供一个媒体路径' },
        { status: 400 }
      )
    }

    const result = webdavConfigs.save({
      url,
      username,
      password,
      mediaPaths,
      scanSettings: scanSettings || { batchSize: 10, preloadCount: 10 },
      isDefault
    })

    return NextResponse.json({
      id: result.lastInsertRowid,
      message: 'WebDAV 配置保存成功'
    })
  } catch (error: any) {
    console.error('保存 WebDAV 配置失败:', error)
    return NextResponse.json(
      { error: `保存配置失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 删除 WebDAV 配置
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const url = searchParams.get('url')
    const username = searchParams.get('username')

    if (!url || !username) {
      return NextResponse.json(
        { error: '请提供 URL 和用户名' },
        { status: 400 }
      )
    }

    webdavConfigs.delete(url, username)
    return NextResponse.json({ message: '配置删除成功' })
  } catch (error: any) {
    console.error('删除 WebDAV 配置失败:', error)
    return NextResponse.json(
      { error: `删除配置失败: ${error.message}` },
      { status: 500 }
    )
  }
}

