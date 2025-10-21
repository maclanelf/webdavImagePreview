import { NextRequest, NextResponse } from 'next/server'
import { scheduledScans } from '@/lib/database'

// 获取所有定时扫描任务
export async function GET() {
  try {
    const tasks = scheduledScans.getAll()
    return NextResponse.json({ tasks })
  } catch (error: any) {
    console.error('获取定时扫描任务失败:', error)
    return NextResponse.json(
      { error: `获取定时扫描任务失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 创建定时扫描任务
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      webdavUrl,
      webdavUsername,
      webdavPassword,
      mediaPaths,
      scanSettings,
      cronExpression,
      isActive
    } = body

    if (!webdavUrl || !webdavUsername || !webdavPassword || !mediaPaths || !cronExpression) {
      return NextResponse.json(
        { error: '请提供完整的定时扫描配置信息' },
        { status: 400 }
      )
    }

    const result = scheduledScans.create({
      webdavUrl,
      webdavUsername,
      webdavPassword,
      mediaPaths,
      scanSettings: scanSettings || {
        maxDepth: 10,
        maxFiles: 200000,
        timeout: 60000
      },
      cronExpression,
      isActive: isActive !== false // 默认为true
    })

    return NextResponse.json({
      id: result.lastInsertRowid,
      message: '定时扫描任务创建成功'
    })
  } catch (error: any) {
    console.error('创建定时扫描任务失败:', error)
    return NextResponse.json(
      { error: `创建定时扫描任务失败: ${error.message}` },
      { status: 500 }
    )
  }
}
