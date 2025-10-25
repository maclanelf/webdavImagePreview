// 扫描任务管理器
class ScanTaskManager {
  private activeTasks = new Map<string, {
    taskId: string
    webdavUrl: string
    webdavUsername: string
    paths: string[]
    startTime: number
    status: 'running' | 'completed' | 'failed'
  }>()

  // 生成任务ID
  private generateTaskId(webdavUrl: string, webdavUsername: string, paths: string[]): string {
    const pathHash = paths.sort().join(',')
    return `${webdavUrl}_${webdavUsername}_${Buffer.from(pathHash).toString('base64')}`
  }

  // 检查是否有相同的扫描任务正在进行
  isTaskRunning(webdavUrl: string, webdavUsername: string, paths: string[]): boolean {
    const taskId = this.generateTaskId(webdavUrl, webdavUsername, paths)
    const task = this.activeTasks.get(taskId)
    return task ? task.status === 'running' : false
  }

  // 获取正在运行的任务
  getRunningTask(webdavUrl: string, webdavUsername: string, paths: string[]) {
    const taskId = this.generateTaskId(webdavUrl, webdavUsername, paths)
    return this.activeTasks.get(taskId)
  }

  // 启动扫描任务
  startTask(webdavUrl: string, webdavUsername: string, paths: string[]): string {
    const taskId = this.generateTaskId(webdavUrl, webdavUsername, paths)
    
    // 如果任务已存在且正在运行，返回现有任务ID
    if (this.activeTasks.has(taskId)) {
      const existingTask = this.activeTasks.get(taskId)!
      if (existingTask.status === 'running') {
        console.log(`扫描任务已存在: ${taskId}`)
        return taskId
      }
    }

    // 创建新任务
    this.activeTasks.set(taskId, {
      taskId,
      webdavUrl,
      webdavUsername,
      paths,
      startTime: Date.now(),
      status: 'running'
    })

    console.log(`启动扫描任务: ${taskId}`)
    return taskId
  }

  // 完成任务
  completeTask(taskId: string) {
    const task = this.activeTasks.get(taskId)
    if (task) {
      task.status = 'completed'
      console.log(`扫描任务完成: ${taskId}`)
      
      // 5分钟后清理完成的任务
      setTimeout(() => {
        this.activeTasks.delete(taskId)
        console.log(`清理完成的任务: ${taskId}`)
      }, 5 * 60 * 1000)
    }
  }

  // 任务失败
  failTask(taskId: string, error?: string) {
    const task = this.activeTasks.get(taskId)
    if (task) {
      task.status = 'failed'
      console.log(`扫描任务失败: ${taskId}`, error)
      
      // 1分钟后清理失败的任务
      setTimeout(() => {
        this.activeTasks.delete(taskId)
        console.log(`清理失败的任务: ${taskId}`)
      }, 1 * 60 * 1000)
    }
  }

  // 获取所有活跃任务
  getActiveTasks() {
    return Array.from(this.activeTasks.values())
  }

  // 清理过期任务（超过30分钟的任务）
  cleanupExpiredTasks() {
    const now = Date.now()
    const expiredTime = 30 * 60 * 1000 // 30分钟

    for (const [taskId, task] of this.activeTasks.entries()) {
      if (now - task.startTime > expiredTime) {
        this.activeTasks.delete(taskId)
        console.log(`清理过期任务: ${taskId}`)
      }
    }
  }

  // 检查路径是否正在被扫描
  isPathBeingScanned(webdavUrl: string, webdavUsername: string, path: string): boolean {
    for (const task of this.activeTasks.values()) {
      if (task.webdavUrl === webdavUrl && 
          task.webdavUsername === webdavUsername && 
          task.paths.includes(path) && 
          task.status === 'running') {
        return true
      }
    }
    return false
  }

  // 获取需要扫描的路径（排除正在扫描的）
  getPathsToScan(webdavUrl: string, webdavUsername: string, allPaths: string[]): string[] {
    return allPaths.filter(path => !this.isPathBeingScanned(webdavUrl, webdavUsername, path))
  }
}

// 创建全局扫描任务管理器实例
export const scanTaskManager = new ScanTaskManager()

// 定期清理过期任务
setInterval(() => {
  scanTaskManager.cleanupExpiredTasks()
}, 10 * 60 * 1000) // 每10分钟清理一次

export default scanTaskManager
