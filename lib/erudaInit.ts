/**
 * Eruda 调试工具初始化
 * 用于移动端调试，包含自定义的"复制全部日志"功能
 */

// Eruda 实例引用
let erudaInstance: any = null

// Eruda 在任何环境下都强制关闭。
export function getErudaEnabled(): boolean {
  return false
}

// 设置 Eruda 开关状态
export function setErudaEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return

  localStorage.setItem('eruda_enabled', 'false')
  destroyEruda()
}

// 销毁 Eruda
function destroyEruda() {
  if (erudaInstance && typeof erudaInstance.destroy === 'function') {
    erudaInstance.destroy()
    erudaInstance = null
  }
}

export function initEruda() {
  // 只在客户端执行
  if (typeof window === 'undefined') {
    return
  }
  
  // 如果已经初始化，不重复初始化
  if (erudaInstance) {
    return
  }
  
  // 动态导入 eruda，避免 SSG 时报错
  import('eruda').then((eruda) => {
    erudaInstance = eruda.default.init({
      useShadowDom: false,
      autoScale: true,
      defaults: {
        displaySize: 50,
        transparency: 0.9,
        theme: 'auto'
      }
    })
    
    setTimeout(() => {
      addCustomStyles()
      addCopyAllButton()
    }, 1000)
  }).catch((error) => {
    console.error('Eruda 初始化失败:', error)
  })
}

// 添加自定义样式
function addCustomStyles() {
  const style = document.createElement('style')
  style.textContent = `
    /* 优化工具栏按钮 */
    .eruda-console .eruda-header .eruda-btn {
      min-width: 48px !important;
      min-height: 48px !important;
      padding: 10px !important;
      margin: 0 6px !important;
    }
    
    /* 高亮日志条目 */
    .eruda-console .eruda-log-item {
      cursor: pointer !important;
      transition: background-color 0.2s !important;
    }
    
    .eruda-console .eruda-log-item:hover,
    .eruda-console .eruda-log-item:active {
      background-color: rgba(0, 123, 255, 0.1) !important;
    }
    
    .eruda-console .eruda-log-item.eruda-selected {
      background-color: rgba(0, 123, 255, 0.2) !important;
      border-left: 3px solid #007bff !important;
    }
    
    /* 自定义复制全部按钮 */
    .eruda-copy-all-btn {
      min-width: 36px !important;
      min-height: 36px !important;
      width: 36px !important;
      height: 36px !important;
      padding: 6px !important;
      margin: 0 4px !important;
      background: transparent !important;
      border: none !important;
      color: inherit !important;
      cursor: pointer !important;
      font-size: 16px !important;
      line-height: 1 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      touch-action: manipulation !important;
      flex-shrink: 0 !important;
      order: 999 !important;
      vertical-align: middle !important;
    }
    
    .eruda-copy-all-btn:active {
      opacity: 0.6 !important;
      transform: scale(0.95) !important;
    }
  `
  document.head.appendChild(style)
}

// 添加"复制全部"按钮到 Console 面板内部工具栏
function addCopyAllButton() {
  function addCopyAllButtonToToolbar() {
    let toolbarElement = null
    
    // 策略1: 查找 Console 面板，然后找其内部的工具栏
    const consolePanels = [
      document.querySelector('.eruda-console'),
      document.querySelector('[data-type="console"]'),
      ...Array.from(document.querySelectorAll('[class*="console"]'))
    ].filter(Boolean)
    
    for (const panel of consolePanels) {
      if (!panel) continue
      
      const btnContainers = panel.querySelectorAll('[class*="control"], [class*="tool"], [class*="header"]')
      
      for (const container of Array.from(btnContainers)) {
        const buttons = container.querySelectorAll('[class*="btn"], [class*="icon"]')
        if (buttons.length >= 2 && buttons.length <= 10) {
          toolbarElement = container
          break
        }
      }
      
      if (toolbarElement) break
    }
    
    // 策略2: 查找包含 "Filter" 或 "Clear" 文本的按钮，然后找其父容器
    if (!toolbarElement) {
      const allButtons = document.querySelectorAll('[class*="btn"], [class*="icon"]')
      
      for (const btn of Array.from(allButtons)) {
        const text = btn.textContent || btn.getAttribute('title') || ''
        if (text.includes('Filter') || text.includes('Clear') || text.includes('Level')) {
          const parent = btn.parentElement
          if (parent && parent.children.length >= 2) {
            toolbarElement = parent
            break
          }
        }
      }
    }
    
    // 策略3: 查找 eruda-control 类
    if (!toolbarElement) {
      const controls = document.querySelectorAll('[class*="control"]')
      for (const control of Array.from(controls)) {
        const buttons = control.querySelectorAll('[class*="btn"], [class*="icon"]')
        if (buttons.length >= 2) {
          toolbarElement = control
          break
        }
      }
    }
    
    if (!toolbarElement) {
      return false
    }
    
    // 检查是否已添加
    if (toolbarElement.querySelector('.eruda-copy-all-btn')) {
      return true
    }
    
    // 创建按钮
    const copyAllBtn = document.createElement('div')
    copyAllBtn.className = 'eruda-copy-all-btn eruda-btn'
    copyAllBtn.innerHTML = '📋'
    copyAllBtn.title = '复制全部日志'
    
    copyAllBtn.addEventListener('click', handleCopyAllClick)
    
    // 添加到工具栏
    toolbarElement.appendChild(copyAllBtn)
    
    return true
  }
  
  // 延迟执行，重试最多 20 次
  let attempts = 0
  const maxAttempts = 20
  
  const tryAdd = () => {
    attempts++
    
    if (addCopyAllButtonToToolbar()) {
      return
    }
    
    if (attempts < maxAttempts) {
      setTimeout(tryAdd, 800)
    }
  }
  
  // 首次尝试延迟 2 秒
  setTimeout(tryAdd, 2000)
}

// 处理复制全部按钮点击
function handleCopyAllClick(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  
  const copyAllBtn = e.currentTarget as HTMLElement
  
  // 获取日志
  let allLogsText = ''
  
  // 方案1: 尝试从 eruda API 获取日志
  try {
    const erudaInstance = (window as any).eruda
    if (erudaInstance && typeof erudaInstance.get === 'function') {
      const consolePanel = erudaInstance.get('console')
      
      if (consolePanel && consolePanel._logs) {
        const logs = consolePanel._logs
        const logTexts: string[] = []
        
        logs.forEach((log: any) => {
          if (log && log.type && log.val) {
            const vals = Array.isArray(log.val) ? log.val : [log.val]
            const logText = vals.map((v: any) => {
              if (typeof v === 'string') return v
              if (typeof v === 'object') return JSON.stringify(v, null, 2)
              return String(v)
            }).join(' ')
            logTexts.push(`[${log.type}] ${logText}`)
          }
        })
        
        allLogsText = logTexts.join('\n\n')
      }
    }
  } catch (err) {
    console.error('从 eruda API 获取日志失败:', err)
  }
  
  // 方案2: 如果方案1失败，从 DOM 直接读取日志文本
  if (!allLogsText) {
    const logItems = document.querySelectorAll('[class*="log-item"]')
    const logTexts: string[] = []
    logItems.forEach((item) => {
      const text = item.textContent?.trim()
      if (text) logTexts.push(text)
    })
    allLogsText = logTexts.join('\n\n')
  }
  
  if (!allLogsText) {
    alert('没有日志可复制')
    return
  }
  
  // 复制到剪贴板
  copyText(allLogsText, copyAllBtn)
}

// 复制文本到剪贴板
async function copyText(text: string, btn: HTMLElement) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      // 降级方案：使用传统的 execCommand 方法
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    
    btn.innerHTML = '✅'
    setTimeout(() => {
      btn.innerHTML = '📋'
    }, 1500)
  } catch (err) {
    console.error('复制失败:', err)
    alert('复制失败，请重试')
  }
}
