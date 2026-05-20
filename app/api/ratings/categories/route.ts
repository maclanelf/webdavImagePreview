import { NextRequest, NextResponse } from 'next/server'
import { categories } from '@/lib/ratingMetadataRepository'

export async function GET() {
  try {
    const categoriesList = await categories.getAll()
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
    const body = await request.json()
    const { name } = body

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json(
        { error: '分类名称不能为空' },
        { status: 400 }
      )
    }

    const result = await categories.add(name.trim())
    return NextResponse.json({ 
      success: true, 
      id: result.insertId,
      changes: result.affectedRows 
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
    const { searchParams } = new URL(request.url)
    const name = searchParams.get('name')

    if (!name) {
      return NextResponse.json(
        { error: '缺少分类名称参数' },
        { status: 400 }
      )
    }

    const result = await categories.delete(name)
    return NextResponse.json({ 
      success: true, 
      changes: result.affectedRows 
    })
  } catch (error: any) {
    console.error('删除分类失败:', error)
    return NextResponse.json(
      { error: `删除分类失败: ${error.message}` },
      { status: 500 }
    )
  }
}
