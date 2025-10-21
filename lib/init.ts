import scheduler from './scheduler'

// 初始化应用
export async function initializeApp() {
  console.log('初始化WebDAV媒体预览器...')
  
  // 启动内置调度器
  scheduler.start()
  
  console.log('应用初始化完成')
}

// 清理应用
export async function cleanupApp() {
  console.log('清理应用资源...')
  
  // 停止调度器
  scheduler.stop()
  
  console.log('应用清理完成')
}
