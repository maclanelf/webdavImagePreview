import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, getMediaFiles } from '@/lib/webdav'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      url, 
      username, 
      password, 
      path = '/',
      maxDepth = 10,
      maxFiles = 200000,
      timeout = 60000
    } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    const client = getWebDAVClient({ url, username, password })
    
    // 扫描指定目录的媒体文件，使用优化的参数
    const files = await getMediaFiles(client, path, {
      maxDepth,
      maxFiles,
      timeout,
      onProgress: (currentPath, fileCount) => {
        console.log(`扫描进度: ${currentPath} (已找到 ${fileCount} 个文件)`)
      }
    })
    
    // 统计信息
    const imageCount = files.filter(f => 
      /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename)
    ).length
    
    const videoCount = files.filter(f => 
      /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename)
    ).length
    
    return NextResponse.json({
      path,
      total: files.length,
      images: imageCount,
      videos: videoCount,
      scanInfo: {
        maxDepth,
        maxFiles,
        timeout,
        actualFilesFound: files.length
      }
    })
  } catch (error: any) {
    console.error('扫描目录失败:', error)
    return NextResponse.json(
      { error: `扫描目录失败: ${error.message}` },
      { status: 500 }
    )
  }
}

