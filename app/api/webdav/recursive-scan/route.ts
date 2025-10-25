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
      path = '/',
      batchSize = 10,
      forceRescan = false
    } = body

    if (!url || !username || !password) {
      return NextResponse.json(
        { error: '请提供完整的WebDAV配置信息' },
        { status: 400 }
      )
    }

    const client = getWebDAVClient({ url, username, password })

    // 如果强制重新扫描，清除现有缓存
    if (forceRescan) {
      scanCache.delete(url, username, path)
    }

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

      // 记录扫描完成日志，包含完整的进度信息
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

      return NextResponse.json({
        success: true,
        message: '递归扫描完成',
        result: {
          totalFiles: result.totalFiles,
          imageCount: result.imageCount,
          videoCount: result.videoCount,
          duration: duration
        }
      })

    } catch (error: any) {
      const duration = Date.now() - startTime
      
      // 记录扫描失败日志，包含已收集的进度信息
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

      console.error('递归扫描失败:', error)
      return NextResponse.json(
        { error: `递归扫描失败: ${error.message}` },
        { status: 500 }
      )
    }

  } catch (error: any) {
    console.error('递归扫描API错误:', error)
    return NextResponse.json(
      { error: `递归扫描API错误: ${error.message}` },
      { status: 500 }
    )
  }
}