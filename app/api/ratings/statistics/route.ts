import { NextResponse } from 'next/server'
import { statistics } from '@/lib/ratingMetadataRepository'

export async function GET() {
  try {
    const mediaStats = await statistics.getMediaStats()
    const groupStats = await statistics.getGroupStats()
    const topEvaluations = await statistics.getTopEvaluations(10)
    const topCategories = await statistics.getTopCategories(10)

    return NextResponse.json({
      media: mediaStats,
      groups: groupStats,
      topEvaluations,
      topCategories
    })
  } catch (error: any) {
    console.error('获取统计信息失败:', error)
    return NextResponse.json(
      { error: `获取统计信息失败: ${error.message}` },
      { status: 500 }
    )
  }
}
