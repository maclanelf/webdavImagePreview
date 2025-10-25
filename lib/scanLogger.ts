import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// 日志目录
const LOGS_DIR = path.join(process.cwd(), 'logs')

// 确保日志目录存在
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
}

// 生成日志文件名（基于WebDAV配置和路径）
function getLogFileName(webdavUrl: string, webdavUsername: string, scanPath: string): string {
  // 使用MD5哈希避免冲突
  const urlHash = crypto.createHash('md5').update(webdavUrl).digest('hex').substring(0, 8)
  const usernameHash = crypto.createHash('md5').update(webdavUsername).digest('hex').substring(0, 8)
  const pathHash = crypto.createHash('md5').update(scanPath).digest('hex').substring(0, 8)
  
  return `scan_${urlHash}_${usernameHash}_${pathHash}.log`
}

// 获取日志文件路径
function getLogFilePath(webdavUrl: string, webdavUsername: string, scanPath: string): string {
  const fileName = getLogFileName(webdavUrl, webdavUsername, scanPath)
  return path.join(LOGS_DIR, fileName)
}

// 写入日志
export function writeScanLog(logData: {
  webdavUrl: string
  webdavUsername: string
  path: string
  scanType: string
  status: string
  totalFiles?: number
  imageCount?: number
  videoCount?: number
  durationMs?: number
  errorMessage?: string
  logDetails?: string
}) {
  try {
    const now = new Date()
    const timestamp = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).replace(/\//g, '-')
    
    const logEntry = {
      timestamp,
      ...logData
    }
    
    const logLine = JSON.stringify(logEntry) + '\n'
    const logFilePath = getLogFilePath(logData.webdavUrl, logData.webdavUsername, logData.path)
    fs.appendFileSync(logFilePath, logLine, 'utf8')
  } catch (error) {
    console.error('写入扫描日志失败:', error)
  }
}

// 读取日志
export function readScanLogs(
  webdavUrl?: string, 
  webdavUsername?: string, 
  scanPath?: string, 
  limit: number = 100
): any[] {
  try {
    const logs: any[] = []
    
    if (!webdavUrl || !webdavUsername || !scanPath) {
      return logs
    }
    
    const logFilePath = getLogFilePath(webdavUrl, webdavUsername, scanPath)
    
    // 检查日志文件是否存在
    if (!fs.existsSync(logFilePath)) {
      return logs
    }
    
    const content = fs.readFileSync(logFilePath, 'utf8')
    const lines = content.split('\n').filter(line => line.trim())
    
    for (const line of lines) {
      try {
        const logEntry = JSON.parse(line)
        logs.push(logEntry)
        
        if (logs.length >= limit) break
      } catch (parseError) {
        console.error('解析日志行失败:', parseError, line)
      }
    }
    
    // 按时间倒序排列（最新的在前）
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  } catch (error) {
    console.error('读取扫描日志失败:', error)
    return []
  }
}

// 清空日志文件
export function clearScanLogs(webdavUrl?: string, webdavUsername?: string, scanPath?: string): boolean {
  try {
    if (!webdavUrl || !webdavUsername || !scanPath) {
      return false
    }
    
    const logFilePath = getLogFilePath(webdavUrl, webdavUsername, scanPath)
    
    if (fs.existsSync(logFilePath)) {
      fs.writeFileSync(logFilePath, '', 'utf8')
      console.log('日志文件已清空')
      return true
    }
    return false
  } catch (error) {
    console.error('清空日志文件失败:', error)
    return false
  }
}
