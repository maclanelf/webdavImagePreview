import { NextRequest, NextResponse } from 'next/server'
import { readScanLogs, clearScanLogs } from '@/lib/scanLogger'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const webdavUrl = searchParams.get('webdavUrl')
    const webdavUsername = searchParams.get('webdavUsername')
    const path = searchParams.get('path')
    const limit = parseInt(searchParams.get('limit') || '50')

    if (!webdavUrl || !webdavUsername || !path) {
      return NextResponse.json(
        { error: '请提供完整的参数' },
        { status: 400 }
      )
    }

    const logs = readScanLogs(webdavUrl, webdavUsername, path, limit)

    return NextResponse.json({
      success: true,
      logs,
      queryInfo: {
        limit,
        totalFound: logs.length
      }
    })

  } catch (error: any) {
    console.error('获取扫描日志失败:', error)
    return NextResponse.json(
      { error: `获取扫描日志失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 清空日志文件
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const webdavUrl = searchParams.get('webdavUrl')
    const webdavUsername = searchParams.get('webdavUsername')
    const path = searchParams.get('path')

    if (!webdavUrl || !webdavUsername || !path) {
      return NextResponse.json(
        { error: '请提供完整的参数' },
        { status: 400 }
      )
    }

    const success = clearScanLogs(webdavUrl, webdavUsername, path)
    
    if (success) {
      return NextResponse.json({
        success: true,
        message: '日志文件已清空'
      })
    } else {
      return NextResponse.json(
        { error: '日志文件不存在或清空失败' },
        { status: 404 }
      )
    }
  } catch (error: any) {
    console.error('清空日志文件失败:', error)
    return NextResponse.json(
      { error: `清空日志文件失败: ${error.message}` },
      { status: 500 }
    )
  }
}