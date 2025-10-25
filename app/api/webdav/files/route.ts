import { NextRequest, NextResponse } from 'next/server'
import { getWebDAVClient, recursiveScanDirectory } from '@/lib/webdav'
import { scanCache } from '@/lib/database'
import { writeScanLog } from '@/lib/scanLogger'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      url, 
      username, 
      password, 
      mediaPaths = ['/'],
      batchSize = 10,
      forceRescan = false,
      incremental = false // 新增：是否支持增量返回
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
    const cachedPaths = []
    
    for (const path of mediaPaths) {
      if (!forceRescan) {
        const cached = scanCache.get(url, username, path) as any
        if (cached) {
          console.log(`从缓存加载路径: ${path}`)
          const filesData = cached.files_data ? JSON.parse(cached.files_data) : []
          allFiles.push(...filesData)
          cachedPaths.push(path)
          continue
        }
      }
      uncachedPaths.push(path)
    }

    // 如果支持增量返回且有缓存数据，先返回缓存的结果
    if (incremental && cachedPaths.length > 0) {
      const imageCount = allFiles.filter(f => 
        /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(f.basename)
      ).length
      
      const videoCount = allFiles.filter(f => 
        /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(f.basename)
      ).length

      return NextResponse.json({
        files: allFiles,
        fromCache: true,
        incremental: true,
        cachedPaths,
        pendingPaths: uncachedPaths,
        stats: {
          total: allFiles.length,
          images: imageCount,
          videos: videoCount
        }
      })
    }

    // 如果有未缓存的路径，进行递归扫描
    if (uncachedPaths.length > 0) {
      const client = getWebDAVClient({ url, username, password })
      
      for (const path of uncachedPaths) {
        console.log(`开始递归扫描路径: ${path}`)
        
        // 记录扫描开始日志
        writeScanLog({
          webdavUrl: url,
          webdavUsername: username,
          path,
          scanType: 'recursive',
          status: 'started'
        })

        const startTime = Date.now()
        
        // 收集扫描进度信息
        const progressLogs: string[] = []
        let batchCount = 0
        
        try {
          // 执行递归扫描
          const result = await recursiveScanDirectory(client, path, {
            batchSize,
            onProgress: (progress) => {
              batchCount++
              const logMessage = `批次 ${batchCount} 完成: 处理了 ${progress.scannedDirectories} 个目录，找到 ${progress.foundFiles} 个文件，总计 ${progress.foundFiles} 个文件 (${progress.percentage}%)`
              progressLogs.push(logMessage)
              console.log(`扫描路径 ${path}: ${progress.currentPath} (已找到 ${progress.foundFiles} 个文件)`)
            }
          })

          const duration = Date.now() - startTime

          // 保存到缓存
          const filesData = result.files.map(file => ({
            filename: file.filename,
            basename: file.basename,
            size: file.size,
            type: file.type,
            lastmod: file.lastmod,
          }))

          scanCache.save({
            webdavUrl: url,
            webdavUsername: username,
            path,
            filesData: JSON.stringify(filesData),
            totalFiles: result.totalFiles,
            imageCount: result.imageCount,
            videoCount: result.videoCount,
            scanSettings: JSON.stringify({ batchSize })
          })

          // 记录扫描完成日志
          writeScanLog({
            webdavUrl: url,
            webdavUsername: username,
            path,
            scanType: 'recursive',
            status: 'completed',
            totalFiles: result.totalFiles,
            imageCount: result.imageCount,
            videoCount: result.videoCount,
            durationMs: duration,
            logDetails: [
              ...progressLogs,
              `递归扫描完成，共找到 ${result.totalFiles} 个媒体文件 (图片: ${result.imageCount}, 视频: ${result.videoCount})，耗时 ${duration}ms`
            ].join('\n')
          })
          
          allFiles.push(...filesData)
          console.log(`路径 ${path} 递归扫描完成，找到 ${result.totalFiles} 个文件`)
          
        } catch (error: any) {
          const duration = Date.now() - startTime
          
          // 记录扫描失败日志
          writeScanLog({
            webdavUrl: url,
            webdavUsername: username,
            path,
            scanType: 'recursive',
            status: 'failed',
            durationMs: duration,
            errorMessage: error.message,
            logDetails: progressLogs.length > 0 ? [
              ...progressLogs,
              `扫描失败: ${error.message}`
            ].join('\n') : `扫描失败: ${error.message}`
          })
          
          console.error(`路径 ${path} 递归扫描失败:`, error)
          throw error
        }
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

