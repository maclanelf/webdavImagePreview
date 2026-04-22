/**
 * 全局视频流管理器
 * 用于追踪和清理所有活动的视频流，防止内存泄漏和连接堆积
 */

export interface ActiveStreamInfo {
  stream: any
  abortController: AbortController | null  // 用于取消底层 fetch 请求
  filepath: string
  startTime: number
  lastActivityTime: number  // 最后活动时间，用于判断流是否还在使用
  requestId: string
}

// 使用 Map 存储所有活动流，以请求ID为键
const activeStreams = new Map<string, ActiveStreamInfo>()

// 流超时时间（60分钟）
const STREAM_TIMEOUT = 60 * 60 * 1000

/**
 * 清理指定的流
 */
export function cleanupStream(requestId: string, reason: string): boolean {
  const streamInfo = activeStreams.get(requestId)
  if (streamInfo) {
    console.log(`🧹 [流管理] 清理流 ${requestId}: ${reason}`)
    try {
      // ⭐ 关键：通过 AbortController 取消底层的 fetch 请求
      // 这是唯一能真正停止 webdav 库数据传输的方法
      if (streamInfo.abortController) {
        streamInfo.abortController.abort()
        console.log(`🛑 [流管理] 已发送 abort 信号取消 fetch 请求`)
      }
      
      const stream = streamInfo.stream
      if (stream) {
        // 主动清理属于预期内的资源回收流程，不应再人为构造 Error，
        // 否则客户端断开/切换视频会被升级成未捕获异常。
        if (typeof stream.unpipe === 'function') {
          stream.unpipe()
        }
        if (!streamInfo.abortController && typeof stream.destroy === 'function' && !stream.destroyed) {
          stream.destroy()
        }
      }
    } catch (error) {
      console.error(`❌ [流管理] 清理流失败:`, error)
    }
    activeStreams.delete(requestId)
    console.log(`✅ [流管理] 流已清理，当前活动流数量: ${activeStreams.size}`)
    return true
  }
  return false
}

/**
 * 注册一个新的活动流
 */
export function registerStream(
  requestId: string, 
  stream: any, 
  filepath: string,
  abortController: AbortController | null = null
): void {
  const now = Date.now()
  activeStreams.set(requestId, {
    stream,
    abortController,
    filepath,
    startTime: now,
    lastActivityTime: now,
    requestId
  })
  console.log(`📝 [流管理] 注册流 ${requestId}，当前活动流数量: ${activeStreams.size}`)
}

/**
 * 更新流的最后活动时间（在数据传输时调用）
 */
export function updateStreamActivity(requestId: string): void {
  const streamInfo = activeStreams.get(requestId)
  if (streamInfo) {
    streamInfo.lastActivityTime = Date.now()
  }
}

/**
 * 移除流（不销毁，只是从管理器中移除）
 */
export function unregisterStream(requestId: string): void {
  if (activeStreams.has(requestId)) {
    activeStreams.delete(requestId)
    console.log(`📤 [流管理] 移除流 ${requestId}，当前活动流数量: ${activeStreams.size}`)
  }
}

/**
 * 清理同一文件路径的所有旧流（除了当前请求）
 */
export function cleanupOldStreamsForFile(filepath: string, currentRequestId: string): number {
  let cleanedCount = 0
  for (const [requestId, info] of activeStreams.entries()) {
    if (info.filepath === filepath && requestId !== currentRequestId) {
      cleanupStream(requestId, `新请求替代旧请求`)
      cleanedCount++
    }
  }
  if (cleanedCount > 0) {
    console.log(`🗑️ [流管理] 清理了 ${cleanedCount} 个同文件的旧流`)
  }
  return cleanedCount
}

/**
 * 清理所有旧流（除了当前请求）- 用于切换视频时清理上一个视频的流
 */
export function cleanupOtherStreams(currentRequestId: string): number {
  let cleanedCount = 0
  for (const [requestId, info] of activeStreams.entries()) {
    if (requestId !== currentRequestId) {
      cleanupStream(requestId, `切换到新视频`)
      cleanedCount++
    }
  }
  if (cleanedCount > 0) {
    console.log(`🗑️ [流管理] 切换视频，清理了 ${cleanedCount} 个旧流`)
  }
  return cleanedCount
}

/**
 * 清理所有活动流
 */
export function cleanupAllStreams(reason: string = '手动清理'): number {
  const count = activeStreams.size
  console.log(`🧹 [流管理] 开始清理所有活动流，共 ${count} 个`)
  
  for (const [requestId] of activeStreams.entries()) {
    cleanupStream(requestId, reason)
  }
  
  return count
}

/**
 * 清理超时的流
 * 只清理最后活动时间超过 STREAM_TIMEOUT 的流，正在使用的流不会被清理
 */
export function cleanupTimeoutStreams(): number {
  const now = Date.now()
  let cleanedCount = 0
  
  for (const [requestId, info] of activeStreams.entries()) {
    const idleTime = now - info.lastActivityTime
    if (idleTime > STREAM_TIMEOUT) {
      cleanupStream(requestId, `空闲超时 (空闲${Math.round(idleTime / 1000)}秒，总时长${Math.round((now - info.startTime) / 1000)}秒)`)
      cleanedCount++
    }
  }
  
  return cleanedCount
}

/**
 * 获取当前活动流数量
 */
export function getActiveStreamCount(): number {
  return activeStreams.size
}

/**
 * 获取所有活动流的信息（用于调试）
 */
export function getActiveStreamsInfo(): Array<{
  requestId: string
  filepath: string
  duration: number
  idleTime: number
}> {
  const now = Date.now()
  return Array.from(activeStreams.entries()).map(([requestId, info]) => ({
    requestId,
    filepath: info.filepath,
    duration: Math.round((now - info.startTime) / 1000),
    idleTime: Math.round((now - info.lastActivityTime) / 1000)
  }))
}

// 启动定期清理超时流的定时器
let cleanupIntervalId: NodeJS.Timeout | null = null

export function startCleanupInterval(): void {
  if (cleanupIntervalId) {
    return // 已经启动
  }
  
  cleanupIntervalId = setInterval(() => {
    const cleaned = cleanupTimeoutStreams()
    if (cleaned > 0) {
      console.log(`⏰ [流管理] 定期清理：清理了 ${cleaned} 个超时流`)
    }
  }, 30000) // 每 30 秒检查一次
  
  console.log('⏰ [流管理] 定期清理任务已启动')
}

export function stopCleanupInterval(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId)
    cleanupIntervalId = null
    console.log('⏰ [流管理] 定期清理任务已停止')
  }
}

// 清理所有流资源
export function cleanupStreamManager(): void {
  console.log('🧹 [流管理] 清理所有资源...')
  
  // 停止定时器
  stopCleanupInterval()
  
  // 清理所有活跃流
  const activeCount = activeStreams.size
  if (activeCount > 0) {
    console.log(`🧹 [流管理] 清理 ${activeCount} 个活跃流...`)
    activeStreams.clear()
  }
  
  console.log('✅ [流管理] 资源清理完成')
}

// 自动启动定期清理
startCleanupInterval()
