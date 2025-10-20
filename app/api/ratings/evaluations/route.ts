import { NextRequest, NextResponse } from 'next/server'
import { customEvaluations, ensureInitialized } from '@/lib/database'

export async function GET() {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const evaluations = customEvaluations.getAll()
    return NextResponse.json({ evaluations })
  } catch (error: any) {
    console.error('获取评价标签失败:', error)
    return NextResponse.json(
      { error: `获取评价标签失败: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const body = await request.json()
    const { label } = body

    if (!label || typeof label !== 'string' || label.trim() === '') {
      return NextResponse.json(
        { error: '评价标签不能为空' },
        { status: 400 }
      )
    }

    const result = customEvaluations.add(label.trim())
    return NextResponse.json({ 
      success: true, 
      id: result.lastInsertRowid,
      changes: result.changes 
    })
  } catch (error: any) {
    console.error('添加评价标签失败:', error)
    return NextResponse.json(
      { error: `添加评价标签失败: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const { searchParams } = new URL(request.url)
    const label = searchParams.get('label')

    if (!label) {
      return NextResponse.json(
        { error: '缺少标签参数' },
        { status: 400 }
      )
    }

    const result = customEvaluations.delete(label)
    return NextResponse.json({ 
      success: true, 
      changes: result.changes 
    })
  } catch (error: any) {
    console.error('删除评价标签失败:', error)
    return NextResponse.json(
      { error: `删除评价标签失败: ${error.message}` },
      { status: 500 }
    )
  }
}
