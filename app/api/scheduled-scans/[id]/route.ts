import { NextRequest, NextResponse } from 'next/server'
import { scheduledScans } from '@/lib/database'

// 更新定时扫描任务
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    if (isNaN(id)) {
      return NextResponse.json(
        { error: '无效的任务ID' },
        { status: 400 }
      )
    }

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

    const updateData: any = {}
    if (webdavUrl !== undefined) updateData.webdavUrl = webdavUrl
    if (webdavUsername !== undefined) updateData.webdavUsername = webdavUsername
    if (webdavPassword !== undefined) updateData.webdavPassword = webdavPassword
    if (mediaPaths !== undefined) updateData.mediaPaths = mediaPaths
    if (scanSettings !== undefined) updateData.scanSettings = scanSettings
    if (cronExpression !== undefined) updateData.cronExpression = cronExpression
    if (isActive !== undefined) updateData.isActive = isActive

    const result = scheduledScans.update(id, updateData)
    
    if (result.changes === 0) {
      return NextResponse.json(
        { error: '任务不存在或没有更新' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      message: '定时扫描任务更新成功'
    })
  } catch (error: any) {
    console.error('更新定时扫描任务失败:', error)
    return NextResponse.json(
      { error: `更新定时扫描任务失败: ${error.message}` },
      { status: 500 }
    )
  }
}

// 删除定时扫描任务
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idParam } = await params
    const id = parseInt(idParam)
    if (isNaN(id)) {
      return NextResponse.json(
        { error: '无效的任务ID' },
        { status: 400 }
      )
    }

    const result = scheduledScans.delete(id)
    
    if (result.changes === 0) {
      return NextResponse.json(
        { error: '任务不存在' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      message: '定时扫描任务删除成功'
    })
  } catch (error: any) {
    console.error('删除定时扫描任务失败:', error)
    return NextResponse.json(
      { error: `删除定时扫描任务失败: ${error.message}` },
      { status: 500 }
    )
  }
}
