import { NextRequest, NextResponse } from 'next/server'
import { creators } from '@/lib/creatorRepository'

// POST /api/creators/[id]/alias - 添加别名（可选批量关联）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    const body = await request.json()
    const { aliasName, batchUpdate = false } = body
    
    console.log(`📝 [API] 添加别名请求: creatorId=${id}, aliasName="${aliasName}", batchUpdate=${batchUpdate}`)
    
    if (!aliasName) {
      return NextResponse.json(
        { success: false, error: '别名不能为空' },
        { status: 400 }
      )
    }
    
    // 如果需要批量更新，先预览影响范围
    if (batchUpdate) {
      const preview = await creators.previewBatchLink(aliasName)
      console.log(`📊 [API] 预览结果: 总计 ${preview.totalCount} 条记录`)
      
      // 执行添加别名并批量关联
      const result = await creators.addOtherNameAndLinkFiles(id, aliasName, true)
      console.log(`✅ [API] 执行结果: ${result.message}`)
      
      return NextResponse.json({ 
        success: true, 
        message: result.message,
        data: {
          ...result,
          preview
        }
      })
    } else {
      // 只添加别名
      const result = await creators.addOtherName(id, aliasName)
      
      return NextResponse.json({ 
        success: result.success, 
        message: result.message || '别名添加成功'
      })
    }
  } catch (error: any) {
    console.error('❌ [API] 添加别名失败:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

// DELETE /api/creators/[id]/alias - 删除别名
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: idStr } = await params
    const id = parseInt(idStr)
    const { searchParams } = new URL(request.url)
    const aliasName = searchParams.get('name')
    
    if (!aliasName) {
      return NextResponse.json(
        { success: false, error: '别名不能为空' },
        { status: 400 }
      )
    }
    
    const result = await creators.removeOtherName(id, aliasName)
    
    return NextResponse.json({ 
      success: true, 
      message: '别名删除成功',
      data: result
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
