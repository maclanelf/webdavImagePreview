import { NextRequest, NextResponse } from 'next/server'

import { webdavConfigs } from '@/lib/database'

// 获取所有 WebDAV 配置
export async function GET(_request: NextRequest) {
  try {
    const configs = await webdavConfigs.getAll()
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
    const { url, username, password, mediaPaths, scanSettings, isDefault, sourceType, directLinkUrl, enableDirectLink } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的 WebDAV 配置信息' },
        { status: 400 }
      )
    }

    if (!mediaPaths || !Array.isArray(mediaPaths)) {
      return NextResponse.json(
        { error: '媒体路径格式不正确' },
        { status: 400 }
      )
    }

    const result = await webdavConfigs.save({
      url,
      username,
      password,
      mediaPaths,
      scanSettings: scanSettings || { concurrency: 10, preloadCount: 10 },
      isDefault,
      sourceType: sourceType || 'clouddrive2',
      directLinkUrl,
      enableDirectLink,
    })

    return NextResponse.json({
      id: result.insertId || undefined,
      affectedRows: result.affectedRows,
      message: 'WebDAV 配置保存成功',
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

    await webdavConfigs.delete(url, username)
    return NextResponse.json({ message: '配置删除成功' })
  } catch (error: any) {
    console.error('删除 WebDAV 配置失败:', error)
    return NextResponse.json(
      { error: `删除配置失败: ${error.message}` },
      { status: 500 }
    )
  }
}

