import { useEffect, useRef, useState } from 'react'

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

export interface WebSocketMessage {
  type: string
  clientId?: string
  taskId?: string
  task?: ScanTask
  tasks?: ScanTask[]
  progress?: ScanTask['progress']
  result?: {
    totalFiles: number
    imageCount: number
    videoCount: number
  }
  error?: string
  message?: string
}

export interface UseWebSocketScanningOptions {
  enabled?: boolean
  onTaskCreated?: (taskId: string, task: ScanTask) => void
  onTaskStarted?: (taskId: string, task: ScanTask) => void
  onProgress?: (taskId: string, progress: ScanTask['progress']) => void
  onTaskCompleted?: (taskId: string, task: ScanTask, result: any) => void
  onTaskFailed?: (taskId: string, task: ScanTask, error: string) => void
  onConnected?: (clientId: string) => void
  onDisconnected?: () => void
}

export function useWebSocketScanning(options: UseWebSocketScanningOptions = {}) {
  const { enabled = true, ...callbacks } = options
  const [isConnected, setIsConnected] = useState(false)
  const [clientId, setClientId] = useState<string | null>(null)
  const [activeTasks, setActiveTasks] = useState<Map<string, ScanTask>>(new Map())
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 5

  const connect = async () => {
    try {
      // 使用固定端口7234
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = window.location.hostname
      const wsUrl = `${protocol}//${host}:7234`
      
      console.log('尝试连接WebSocket:', wsUrl)
      wsRef.current = new WebSocket(wsUrl)

      wsRef.current.onopen = () => {
        console.log('WebSocket连接已建立')
        setIsConnected(true)
        reconnectAttempts.current = 0
        options.onConnected?.(clientId || '')
      }

      wsRef.current.onclose = () => {
        console.log('WebSocket连接已关闭')
        setIsConnected(false)
        options.onDisconnected?.()
        
        // 自动重连
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
          console.log(`WebSocket重连尝试 ${reconnectAttempts.current}/${maxReconnectAttempts}，${delay}ms后重连`)
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, delay)
        }
      }

      wsRef.current.onerror = (error) => {
        console.error('WebSocket连接错误:', error)
      }

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          handleMessage(message)
        } catch (error) {
          console.error('WebSocket消息解析错误:', error)
        }
      }

    } catch (error) {
      console.error('WebSocket连接失败:', error)
    }
  }

  const handleMessage = (message: WebSocketMessage) => {
    switch (message.type) {
      case 'connected':
        setClientId(message.clientId || null)
        break

      case 'scan_task_created':
        if (message.taskId && message.task) {
          setActiveTasks(prev => new Map(prev).set(message.taskId!, message.task!))
          options.onTaskCreated?.(message.taskId, message.task)
        }
        break

      case 'scan_task_started':
        if (message.taskId && message.task) {
          setActiveTasks(prev => new Map(prev).set(message.taskId!, message.task!))
          options.onTaskStarted?.(message.taskId, message.task)
        }
        break

      case 'scan_progress':
        if (message.taskId && message.progress) {
          setActiveTasks(prev => {
            const newMap = new Map(prev)
            const task = newMap.get(message.taskId!)
            if (task) {
              newMap.set(message.taskId!, { ...task, progress: message.progress! })
            }
            return newMap
          })
          options.onProgress?.(message.taskId, message.progress)
        }
        break

      case 'scan_task_completed':
        if (message.taskId && message.task) {
          setActiveTasks(prev => {
            const newMap = new Map(prev)
            newMap.delete(message.taskId!) // 移除已完成的任务
            return newMap
          })
          options.onTaskCompleted?.(message.taskId, message.task, message.result)
        }
        break

      case 'scan_task_failed':
        if (message.taskId && message.task) {
          setActiveTasks(prev => {
            const newMap = new Map(prev)
            newMap.delete(message.taskId!) // 移除失败的任务
            return newMap
          })
          options.onTaskFailed?.(message.taskId, message.task, message.error || '未知错误')
        }
        break

      case 'active_tasks':
        if (message.tasks) {
          const taskMap = new Map<string, ScanTask>()
          message.tasks.forEach(task => {
            taskMap.set(task.id, task)
          })
          setActiveTasks(taskMap)
        }
        break

      case 'scan_status':
        if (message.taskId && message.task) {
          setActiveTasks(prev => new Map(prev).set(message.taskId!, message.task!))
        }
        break
    }
  }

  const sendMessage = (message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }

  const subscribeToTask = (taskId: string) => {
    sendMessage({
      type: 'subscribe_scan',
      taskId
    })
  }

  const getActiveTasks = () => {
    sendMessage({
      type: 'get_active_tasks'
    })
  }

  const createScanTask = async (params: {
    webdavUrl: string
    webdavUsername: string
    webdavPassword: string
    path: string
    maxDepth?: number
    maxFiles?: number
    timeout?: number
    forceRescan?: boolean
  }): Promise<string> => {
    const response = await fetch('/api/scan-tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      throw new Error(`创建扫描任务失败: ${response.statusText}`)
    }

    const result = await response.json()
    return result.taskId
  }

  const getTaskStatus = async (taskId: string): Promise<ScanTask | null> => {
    try {
      const response = await fetch(`/api/scan-tasks?taskId=${taskId}`)
      if (!response.ok) {
        return null
      }
      const result = await response.json()
      return result.task
    } catch (error) {
      console.error('获取任务状态失败:', error)
      return null
    }
  }

  useEffect(() => {
    if (enabled) {
      connect()
    }

    return () => {
      console.log('清理WebSocket连接')
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setIsConnected(false)
      setClientId(null)
      setActiveTasks(new Map())
    }
  }, [enabled])

  // 页面卸载时清理连接
  useEffect(() => {
    const handleBeforeUnload = () => {
      console.log('页面即将卸载，清理WebSocket连接')
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  return {
    isConnected,
    clientId,
    activeTasks: Array.from(activeTasks.values()),
    createScanTask,
    getTaskStatus,
    subscribeToTask,
    getActiveTasks,
    sendMessage
  }
}
