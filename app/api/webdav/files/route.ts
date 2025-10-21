import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, getMediaFiles } from '@/lib/webdav'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      url, 
      username, 
      password, 
      mediaPaths = ['/'],
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
    
    // 从所有路径获取文件，使用优化的参数
    const allFiles = []
    for (const path of mediaPaths) {
      console.log(`开始扫描路径: ${path}`)
      const files = await getMediaFiles(client, path, {
        maxDepth,
        maxFiles: Math.floor(maxFiles / mediaPaths.length), // 平均分配每个路径的文件数量限制
        timeout: Math.floor(timeout / mediaPaths.length), // 平均分配每个路径的超时时间
        onProgress: (currentPath, fileCount) => {
          console.log(`扫描路径 ${path}: ${currentPath} (已找到 ${fileCount} 个文件)`)
        }
      })
      allFiles.push(...files)
      console.log(`路径 ${path} 扫描完成，找到 ${files.length} 个文件`)
    }
    
    // 返回文件列表
    const fileList = allFiles.map(file => ({
      filename: file.filename,
      basename: file.basename,
      size: file.size,
      type: file.type,
      lastmod: file.lastmod,
    }))
    
    console.log(`所有路径扫描完成，总共找到 ${fileList.length} 个文件`)
    return NextResponse.json({ files: fileList })
  } catch (error: any) {
    console.error('获取文件列表失败:', error)
    return NextResponse.json(
      { error: `获取文件失败: ${error.message}` },
      { status: 500 }
    )
  }
}

