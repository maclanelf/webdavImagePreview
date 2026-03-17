import { NextResponse } from 'next/server'
import { mediaRatings, groupRatings, creators } from '@/lib/database'

// GET /api/test-creator-data - 测试数据和关联
export async function GET() {
  try {
    // 获取所有评分记录
    const allMediaRatings = mediaRatings.getAll()
    const allGroupRatings = groupRatings.getAll()
    const allCreators = creators.getAll()
    
    // 统计有 creator_id 的记录
    const mediaWithCreator = allMediaRatings.filter((r: any) => r.creator_id !== null)
    const groupWithCreator = allGroupRatings.filter((r: any) => r.creator_id !== null)
    
    // 获取一些示例路径
    const samplePaths = allMediaRatings.slice(0, 10).map((r: any) => r.file_path)
    
    return NextResponse.json({
      success: true,
      data: {
        totalMediaRatings: allMediaRatings.length,
        totalGroupRatings: allGroupRatings.length,
        totalCreators: allCreators.length,
        mediaWithCreator: mediaWithCreator.length,
        groupWithCreator: groupWithCreator.length,
        samplePaths,
        creators: allCreators.map((c: any) => ({
          id: c.id,
          primaryName: c.primaryName,
          otherNames: c.otherNames,
          usageCount: c.usageCount
        }))
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

// POST /api/test-creator-data - 创建测试数据
export async function POST() {
  try {
    // 创建一些测试评分记录
    const testPaths = [
      '/media/张三作品/2024/photo1.jpg',
      '/media/张三作品/2024/photo2.jpg',
      '/media/张三新作/2024/video1.mp4',
      '/media/张三新作/2024/video2.mp4',
      '/media/李四作品/2024/photo1.jpg',
    ]
    
    let created = 0
    for (const path of testPaths) {
      try {
        mediaRatings.save({
          filePath: path,
          fileName: path.split('/').pop() || 'unknown',
          fileType: path.endsWith('.mp4') ? 'video' : 'image',
          rating: 5,
          recommendationReason: '测试数据',
          isViewed: true
        })
        created++
      } catch (e) {
        // 可能已存在，忽略
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `创建了 ${created} 条测试数据`,
      testPaths
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
