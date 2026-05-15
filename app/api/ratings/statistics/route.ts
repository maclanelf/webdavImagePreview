import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/databaseInitialization'
import { statistics } from '@/lib/ratingMetadataRepository'

export async function GET() {
  try {
    // 确保数据库已初始化
    ensureInitialized()
    const mediaStats = statistics.getMediaStats()
    const groupStats = statistics.getGroupStats()
    const topEvaluations = statistics.getTopEvaluations(10)
    const topCategories = statistics.getTopCategories(10)

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
