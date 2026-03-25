import { NextRequest, NextResponse } from 'next/server'
import { creators } from '@/lib/database'

// GET /api/creators/[id] - 获取单个博主
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    const creator = creators.get(id)
    
    if (!creator) {
      return NextResponse.json(
        { success: false, error: '博主不存在' },
        { status: 404 }
      )
    }
    
    // 获取统计信息
    const stats = creators.getStats(id)
    
    return NextResponse.json({ 
      success: true, 
      data: { ...creator, stats }
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

// PUT /api/creators/[id] - 更新博主
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    const body = await request.json()

    if (body?.action === 'changePrimaryName') {
      if (!body.newPrimaryName) {
        return NextResponse.json(
          { success: false, error: '新主名称不能为空' },
          { status: 400 }
        )
      }

      creators.changePrimaryName(id, body.newPrimaryName)
      const creator = creators.get(id)

      return NextResponse.json({
        success: true,
        message: '主名称切换成功',
        data: creator
      })
    }

    const result = creators.save({
      id,
      ...body
    })
    
    return NextResponse.json({ 
      success: true, 
      message: '博主更新成功',
      data: result
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

// DELETE /api/creators/[id] - 删除博主
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    const result = creators.delete(id)
    
    return NextResponse.json({ 
      success: true, 
      message: '博主删除成功',
      data: result
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
