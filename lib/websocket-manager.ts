import { WebSocketServer, WebSocket } from 'ws'
import { getMediaFiles, getWebDAVClient } from '@/lib/webdav'
import { scanCache, initDatabase } from '@/lib/database'

// 修复WebSocket兼容性问题
if (typeof global !== 'undefined') {
  // 在Node.js环境中设置必要的全局变量
  (global as any).Buffer = (global as any).Buffer || require('buffer').Buffer
  
  // 修复bufferUtil问题
  try {
    const bufferUtil = require('bufferutil')
    if (bufferUtil && bufferUtil.unmask) {
      (global as any).bufferUtil = bufferUtil
    }
  } catch (error) {
    console.warn('bufferutil模块不可用，使用内置实现')
  }
}

// 扫描任务状态
export interface ScanTask {
  id: string
  webdavUrl: string
  webdavUsername: string
  webdavPassword: string
  path: string
  maxDepth: number
  maxFiles: number
  timeout: number
  forceRescan: boolean
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: {
    currentPath: string
    fileCount: number
    scannedDirectories: number
    totalDirectories: number
    percentage: number
  }
  startTime?: number
  endTime?: number
  error?: string
}

// WebSocket连接管理
class WebSocketManager {
  private wss!: WebSocketServer
  private connections: Map<string, WebSocket> = new Map()
  private scanTasks: Map<string, ScanTask> = new Map()

  constructor(port: number = 7234) {
    // 确保数据库表已创建
    try {
      initDatabase()
      console.log('数据库表初始化完成')
    } catch (error) {
      console.error('数据库表初始化失败:', error)
    }
    
    // 尝试启动WebSocket服务器，如果端口被占用则尝试其他端口
    this.startWebSocketServer(port)
  }

  private startWebSocketServer(port: number, retryCount: number = 0) {
    // 检查是否已经有服务器在运行
    if (this.wss && this.wss.address() !== null) {
      console.log('WebSocket服务器已在运行，跳过重复启动')
      return
    }

    const maxRetries = 5
    const portIncrement = 1

    try {
      this.wss = new WebSocketServer({ 
        port,
        perMessageDeflate: false, // 禁用压缩以避免兼容性问题
        maxPayload: 1024 * 1024, // 1MB
        skipUTF8Validation: true, // 跳过UTF-8验证
        clientTracking: true // 启用客户端跟踪
      })
      
      this.wss.on('listening', () => {
        console.log(`WebSocket服务器已启动，端口: ${port}`)
      })
      
      this.setupWebSocketServer()
      
    } catch (error: any) {
      if (error.code === 'EADDRINUSE' && retryCount < maxRetries) {
        const newPort = port + portIncrement
        console.warn(`端口 ${port} 被占用，尝试使用端口 ${newPort}`)
        this.startWebSocketServer(newPort, retryCount + 1)
      } else {
        console.error(`WebSocket服务器启动失败:`, error)
        throw error
      }
    }
  }

  private setupWebSocketServer() {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = this.generateClientId()
      this.connections.set(clientId, ws)
      
      console.log(`WebSocket客户端连接: ${clientId}`)

      // 发送连接确认
      this.sendToClient(clientId, {
        type: 'connected',
        clientId,
        message: 'WebSocket连接成功'
      })

      // 发送当前正在进行的扫描任务状态
      this.sendActiveScanTasks(clientId)

      ws.on('close', (code, reason) => {
        console.log(`WebSocket客户端断开: ${clientId}, 代码: ${code}, 原因: ${reason}`)
        this.connections.delete(clientId)
        // 清理该客户端的订阅任务
        this.cleanupClientTasks(clientId)
      })

      ws.on('error', (error) => {
        console.error(`WebSocket客户端错误 ${clientId}:`, error)
        // 检查是否是bufferUtil错误
        if (error.message && error.message.includes('bufferUtil.unmask')) {
          console.warn('检测到bufferUtil错误，尝试重新连接')
        }
        this.connections.delete(clientId)
      })

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          this.handleMessage(clientId, message)
        } catch (error) {
          console.error('WebSocket消息解析错误:', error)
        }
      })
    })
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private sendToClient(clientId: string, message: any) {
    const ws = this.connections.get(clientId)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  private broadcast(message: any) {
    this.connections.forEach((ws, clientId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
      }
    })
  }

  private handleMessage(clientId: string, message: any) {
    switch (message.type) {
      case 'subscribe_scan':
        // 客户端订阅扫描任务
        if (message.taskId) {
          this.sendScanTaskStatus(clientId, message.taskId)
        }
        break
      case 'get_active_tasks':
        // 获取所有活跃的扫描任务
        this.sendActiveScanTasks(clientId)
        break
    }
  }

  private sendActiveScanTasks(clientId: string) {
    const activeTasks = Array.from(this.scanTasks.values()).filter(
      task => task.status === 'running' || task.status === 'pending'
    )
    
    this.sendToClient(clientId, {
      type: 'active_tasks',
      tasks: activeTasks
    })
  }

  private sendScanTaskStatus(clientId: string, taskId: string) {
    const task = this.scanTasks.get(taskId)
    if (task) {
      this.sendToClient(clientId, {
        type: 'scan_status',
        taskId,
        task
      })
    }
  }

  // 创建扫描任务
  async createScanTask(params: {
    webdavUrl: string
    webdavUsername: string
    webdavPassword: string
    path: string
    maxDepth?: number
    maxFiles?: number
    timeout?: number
    forceRescan?: boolean
  }): Promise<string> {
    const taskId = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const task: ScanTask = {
      id: taskId,
      webdavUrl: params.webdavUrl,
      webdavUsername: params.webdavUsername,
      webdavPassword: params.webdavPassword,
      path: params.path,
      maxDepth: params.maxDepth || 10,
      maxFiles: params.maxFiles || 200000,
      timeout: params.timeout || 60000,
      forceRescan: params.forceRescan || false,
      status: 'pending',
      progress: {
        currentPath: params.path,
        fileCount: 0,
        scannedDirectories: 0,
        totalDirectories: 0,
        percentage: 0
      }
    }

    this.scanTasks.set(taskId, task)

    // 广播新任务创建
    this.broadcast({
      type: 'scan_task_created',
      taskId,
      task
    })

    // 异步执行扫描任务
    this.executeScanTask(taskId).catch(error => {
      console.error(`扫描任务执行失败 ${taskId}:`, error)
    })

    return taskId
  }

  // 执行扫描任务
  private async executeScanTask(taskId: string) {
    const task = this.scanTasks.get(taskId)
    if (!task) return

    try {
      task.status = 'running'
      task.startTime = Date.now()

      console.log(`开始执行扫描任务 ${taskId}, forceRescan: ${task.forceRescan}, path: ${task.path}`)

      // 广播任务开始
      this.broadcast({
        type: 'scan_task_started',
        taskId,
        task
      })

      // 检查缓存（如果不强制重新扫描）
      if (!task.forceRescan) {
        const cached = scanCache.get(task.webdavUrl, task.webdavUsername, task.path) as any
        if (cached) {
          console.log(`从缓存加载扫描结果: ${task.path}`)
          
          // 更新任务状态为完成
          task.status = 'completed'
          task.endTime = Date.now()
          task.progress = {
            currentPath: task.path,
            fileCount: cached.total_files,
            scannedDirectories: 1,
            totalDirectories: 1,
            percentage: 100
          }

          // 广播任务完成
          this.broadcast({
            type: 'scan_task_completed',
            taskId,
            task,
            result: {
              totalFiles: cached.total_files,
              imageCount: cached.image_count,
              videoCount: cached.video_count
            }
          })

          return
        } else {
          console.log(`缓存中未找到扫描结果: ${task.path}`)
        }
      } else {
        console.log(`强制重新扫描，跳过缓存检查: ${task.path}`)
      }

      // 创建WebDAV客户端
      const client = getWebDAVClient({
        url: task.webdavUrl,
        username: task.webdavUsername,
        password: task.webdavPassword
      })

      // 执行扫描
      const mediaFiles = await getMediaFiles(
        client,
        task.path,
        {
          maxDepth: task.maxDepth,
          maxFiles: task.maxFiles,
          timeout: task.timeout,
          onProgress: (currentPath, fileCount, totalFiles, scannedDirs, totalDirs) => {
            // 更新进度
            task.progress = {
              currentPath,
              fileCount,
              scannedDirectories: scannedDirs || 0,
              totalDirectories: totalDirs || 0,
              percentage: totalDirs ? Math.round(((scannedDirs || 0) / totalDirs) * 100) : 0
            }

            // 广播进度更新
            this.broadcast({
              type: 'scan_progress',
              taskId,
              progress: task.progress
            })
          }
        }
      )

      // 扫描完成，保存到缓存
      const imageCount = mediaFiles.filter(file => 
        /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(file.filename)
      ).length
      
      const videoCount = mediaFiles.filter(file => 
        /\.(mp4|avi|mov|wmv|flv|webm|mkv)$/i.test(file.filename)
      ).length

      // 调试信息
      const saveData = {
        webdavUrl: task.webdavUrl,
        webdavUsername: task.webdavUsername,
        path: task.path,
        filesData: JSON.stringify(mediaFiles),
        totalFiles: mediaFiles.length,
        imageCount,
        videoCount,
        scanSettings: JSON.stringify({
          maxDepth: task.maxDepth,
          maxFiles: task.maxFiles,
          timeout: task.timeout
        })
      }
      
      console.log('保存扫描缓存数据:', {
        webdavUrl: saveData.webdavUrl,
        webdavUsername: saveData.webdavUsername,
        path: saveData.path,
        filesDataLength: saveData.filesData.length,
        totalFiles: saveData.totalFiles,
        imageCount: saveData.imageCount,
        videoCount: saveData.videoCount,
        scanSettingsLength: saveData.scanSettings.length
      })
      
      try {
        scanCache.save(saveData)
        console.log('扫描缓存保存成功')
      } catch (error) {
        console.error('扫描缓存保存失败:', error)
        console.error('保存数据:', saveData)
        throw error
      }

      // 更新任务状态
      task.status = 'completed'
      task.endTime = Date.now()
      task.progress.percentage = 100

      // 广播任务完成
      this.broadcast({
        type: 'scan_task_completed',
        taskId,
        task,
        result: {
          totalFiles: mediaFiles.length,
          imageCount,
          videoCount
        }
      })

    } catch (error: any) {
      // 任务失败
      task.status = 'failed'
      task.endTime = Date.now()
      task.error = error.message

      // 广播任务失败
      this.broadcast({
        type: 'scan_task_failed',
        taskId,
        task,
        error: error.message
      })
    }
  }

  // 获取任务状态
  getTaskStatus(taskId: string): ScanTask | undefined {
    return this.scanTasks.get(taskId)
  }

  // 获取所有任务
  getAllTasks(): ScanTask[] {
    return Array.from(this.scanTasks.values())
  }

  // 清理已完成的任务（保留最近100个）
  cleanupTasks() {
    const tasks = Array.from(this.scanTasks.values())
    const completedTasks = tasks.filter(task => 
      task.status === 'completed' || task.status === 'failed'
    ).sort((a, b) => (b.endTime || 0) - (a.endTime || 0))

    // 保留最近100个已完成的任务
    if (completedTasks.length > 100) {
      const toDelete = completedTasks.slice(100)
      toDelete.forEach(task => {
        this.scanTasks.delete(task.id)
      })
    }
  }

  // 获取实际使用的端口
  getPort(): number {
    const address = this.wss.address()
    if (typeof address === 'object' && address !== null && 'port' in address) {
      return address.port
    }
    return 7234
  }

  // 检查服务器是否正在运行
  isRunning(): boolean {
    try {
      return this.wss && this.wss.address() !== null
    } catch (error) {
      return false
    }
  }

  // 清理客户端任务
  private cleanupClientTasks(clientId: string) {
    // 这里可以添加清理特定客户端任务的逻辑
    // 目前扫描任务是全局的，不需要按客户端清理
    console.log(`清理客户端 ${clientId} 的任务`)
  }

  // 停止服务器
  close() {
    console.log('关闭WebSocket服务器')
    this.connections.clear()
    this.scanTasks.clear()
    this.wss.close()
  }
}

// 全局WebSocket管理器实例
let wsManager: WebSocketManager | null = null

export function getWebSocketManager(): WebSocketManager {
  if (!wsManager) {
    console.log('创建新的WebSocket管理器实例')
    wsManager = new WebSocketManager()
  } else if (!wsManager.isRunning()) {
    console.log('WebSocket服务器未运行，重新启动')
    wsManager.close() // 先关闭旧实例
    wsManager = new WebSocketManager()
  } else {
    console.log('复用现有的WebSocket管理器实例')
  }
  return wsManager
}

export function closeWebSocketManager() {
  if (wsManager) {
    wsManager.close()
    wsManager = null
  }
}
