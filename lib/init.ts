import scheduler from './scheduler'
import { getWebSocketManager, closeWebSocketManager } from './websocket-manager'

// 初始化应用
export async function initializeApp() {
  console.log('初始化WebDAV媒体预览器...')
  
  // 启动内置调度器
  scheduler.start()
  
  // 启动WebSocket服务器
  getWebSocketManager()
  
  console.log('应用初始化完成：调度器和WebSocket服务器已启动')
}

// 清理应用
export async function cleanupApp() {
  console.log('清理应用资源...')
  
  // 停止调度器
  scheduler.stop()
  
  // 关闭WebSocket服务器
  closeWebSocketManager()
  
  console.log('应用清理完成：调度器和WebSocket服务器已停止')
}
