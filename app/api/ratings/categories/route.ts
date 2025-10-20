import { NextRequest, NextResponse } from 'next/server'
import { categories, ensureInitialized } from '@/lib/database'

export async function GET() {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const categoriesList = categories.getAll()
    return NextResponse.json({ categories: categoriesList })
  } catch (error: any) {
    console.error('获取分类失败:', error)
    return NextResponse.json(
      { error: `获取分类失败: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const body = await request.json()
    const { name } = body

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json(
        { error: '分类名称不能为空' },
        { status: 400 }
      )
    }

    const result = categories.add(name.trim())
    return NextResponse.json({ 
      success: true, 
      id: result.lastInsertRowid,
      changes: result.changes 
    })
  } catch (error: any) {
    console.error('添加分类失败:', error)
    return NextResponse.json(
      { error: `添加分类失败: ${error.message}` },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const { searchParams } = new URL(request.url)
    const name = searchParams.get('name')

    if (!name) {
      return NextResponse.json(
        { error: '缺少分类名称参数' },
        { status: 400 }
      )
    }

    const result = categories.delete(name)
    return NextResponse.json({ 
      success: true, 
      changes: result.changes 
    })
  } catch (error: any) {
    console.error('删除分类失败:', error)
    return NextResponse.json(
      { error: `删除分类失败: ${error.message}` },
      { status: 500 }
    )
  }
}
