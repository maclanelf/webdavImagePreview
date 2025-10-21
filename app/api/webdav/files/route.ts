import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, getMediaFiles } from '@/lib/webdav'
import { scanCache } from '@/lib/database'

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
      timeout = 60000,
      forceRescan = false // 新增：是否强制重新扫描
    } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    // 尝试从缓存加载所有路径的文件
    const allFiles = []
    const uncachedPaths = []
    
    for (const path of mediaPaths) {
      if (!forceRescan) {
        const cached = scanCache.get(url, username, path) as any
        if (cached) {
          console.log(`从缓存加载路径: ${path}`)
          const filesData = JSON.parse(cached.files_data)
          allFiles.push(...filesData)
          continue
        }
      }
      uncachedPaths.push(path)
    }

    // 如果有未缓存的路径，进行扫描
    if (uncachedPaths.length > 0) {
      const client = getWebDAVClient({ url, username, password })
      
      for (const path of uncachedPaths) {
        console.log(`开始扫描路径: ${path}`)
        const files = await getMediaFiles(client, path, {
          maxDepth,
          maxFiles: Math.floor(maxFiles / mediaPaths.length), // 平均分配每个路径的文件数量限制
          timeout: Math.floor(timeout / mediaPaths.length), // 平均分配每个路径的超时时间
          onProgress: (currentPath, fileCount) => {
            console.log(`扫描路径 ${path}: ${currentPath} (已找到 ${fileCount} 个文件)`)
          }
        })
        
        // 保存到缓存
        const filesData = files.map(file => ({
          filename: file.filename,
          basename: file.basename,
          size: file.size,
          type: file.type,
          lastmod: file.lastmod,
        }))

        // 统计信息
        const imageCount = files.filter(f => 
          /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename)
        ).length
        
        const videoCount = files.filter(f => 
          /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename)
        ).length

        scanCache.save({
          webdavUrl: url,
          webdavUsername: username,
          path,
          filesData: JSON.stringify(filesData),
          totalFiles: files.length,
          imageCount,
          videoCount,
          scanSettings: JSON.stringify({ maxDepth, maxFiles, timeout })
        })
        
        allFiles.push(...filesData)
        console.log(`路径 ${path} 扫描完成，找到 ${files.length} 个文件`)
      }
    }
    
    console.log(`所有路径扫描完成，总共找到 ${allFiles.length} 个文件`)
    return NextResponse.json({ files: allFiles })
  } catch (error: any) {
    console.error('获取文件列表失败:', error)
    return NextResponse.json(
      { error: `获取文件失败: ${error.message}` },
      { status: 500 }
    )
  }
}

