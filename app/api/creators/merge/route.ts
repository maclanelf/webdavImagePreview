import { NextRequest, NextResponse } from 'next/server'
import { creators } from '@/lib/creatorRepository'

// POST /api/creators/merge - 合并博主
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const targetId = Number(body?.targetId)
    const sourceIds: number[] = Array.isArray(body?.sourceIds)
      ? Array.from(
          new Set(
            body.sourceIds
              .map((id: unknown) => Number(id))
              .filter(Number.isInteger)
          )
        )
      : []

    if (!Number.isInteger(targetId)) {
      return NextResponse.json(
        { success: false, error: '主博主 ID 无效' },
        { status: 400 }
      )
    }

    if (sourceIds.length === 0) {
      return NextResponse.json(
        { success: false, error: '请至少选择一个待合并博主' },
        { status: 400 }
      )
    }

    if (sourceIds.includes(targetId)) {
      return NextResponse.json(
        { success: false, error: '待合并博主中不能包含主博主自己' },
        { status: 400 }
      )
    }

    const result = await creators.merge(targetId, sourceIds)
    const creator = await creators.get(targetId)

    return NextResponse.json({
      success: true,
      message: '博主合并成功',
      data: {
        ...result,
        creator
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || '博主合并失败' },
      { status: 500 }
    )
  }
}
