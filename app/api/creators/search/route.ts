import { NextRequest, NextResponse } from 'next/server'
import { creators } from '@/lib/creatorRepository'

// GET /api/creators/search?q=keyword - 搜索博主
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q') || ''
    
    if (!query.trim()) {
      return NextResponse.json({ success: true, data: [] })
    }
    
    const results = creators.search(query.trim())
    return NextResponse.json({ success: true, data: results })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
