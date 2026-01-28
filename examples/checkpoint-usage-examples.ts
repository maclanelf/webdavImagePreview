/**
 * Checkpoint 使用示例
 * 
 * 这个文件展示了如何在不同场景下使用 checkpoint 通用函数
 */

import { performCheckpoint, getDatabaseStatus, stopCheckpointTimer } from '@/lib/database'

// ============================================
// 示例 1: 在 API 路由中使用
// ============================================

// app/api/some-query/route.ts
export async function GET_Example1() {
  // 查询前执行 checkpoint，确保读取最新数据
  performCheckpoint('RESTART')
  
  // 执行你的查询
  // const results = db.prepare('SELECT ...').all()
  
  return { success: true }
}

// ============================================
// 示例 2: 在数据写入后使用
// ============================================

export async function POST_Example2() {
  // 写入数据
  // db.prepare('INSERT INTO ...').run(...)
  
  // 写入后立即 checkpoint（可选，通常不需要）
  // 因为有自动 checkpoint 机制
  performCheckpoint('PASSIVE')
  
  return { success: true }
}

// ============================================
// 示例 3: 在批量操作前使用
// ============================================

export async function batchOperationExample() {
  // 批量操作前，确保数据是最新的
  performCheckpoint('FULL')
  
  // 执行批量操作
  // const transaction = db.transaction(() => {
  //   for (const item of items) {
  //     db.prepare('INSERT ...').run(item)
  //   }
  // })
  // transaction()
  
  return { success: true }
}

// ============================================
// 示例 4: 获取数据库状态用于监控
// ============================================

export async function monitorDatabaseExample() {
  const status = getDatabaseStatus()
  
  if (status) {
    console.log('数据库状态:', {
      模式: status.journalMode,
      页数: status.pageCount,
      页大小: status.pageSize,
      总大小: status.dbSize
    })
    
    // 如果 WAL 文件太大，执行 checkpoint
    // 注意：这只是示例，实际中由定时任务处理
    // if (needsCheckpoint) {
    //   performCheckpoint('FULL')
    // }
  }
  
  return status
}

// ============================================
// 示例 5: 在应用关闭时清理
// ============================================

export function setupGracefulShutdown() {
  // 监听关闭信号
  process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，准备关闭...')
    
    // 停止定时 checkpoint 任务
    stopCheckpointTimer()
    
    // 执行最后一次 checkpoint
    performCheckpoint('TRUNCATE')
    
    console.log('清理完成，退出进程')
    process.exit(0)
  })
  
  process.on('SIGINT', () => {
    console.log('收到 SIGINT 信号，准备关闭...')
    stopCheckpointTimer()
    performCheckpoint('TRUNCATE')
    process.exit(0)
  })
}

// ============================================
// 示例 6: 在定时任务中使用
// ============================================

export function setupCustomCheckpointTask() {
  // 自定义定时任务：每小时执行一次 FULL checkpoint
  setInterval(() => {
    console.log('执行每小时 checkpoint 任务')
    performCheckpoint('FULL')
    
    // 获取并记录状态
    const status = getDatabaseStatus()
    console.log('Checkpoint 后状态:', status)
  }, 60 * 60 * 1000) // 1 小时
}

// ============================================
// 示例 7: 在数据迁移中使用
// ============================================

export async function dataMigrationExample() {
  console.log('开始数据迁移...')
  
  // 迁移前 checkpoint，确保数据一致
  performCheckpoint('FULL')
  
  // 执行迁移
  // ... 迁移逻辑 ...
  
  // 迁移后 checkpoint，确保数据写入
  performCheckpoint('FULL')
  
  console.log('数据迁移完成')
}

// ============================================
// 示例 8: 在健康检查中使用
// ============================================

export async function healthCheckExample() {
  try {
    // 获取数据库状态
    const status = getDatabaseStatus()
    
    if (!status) {
      return {
        healthy: false,
        message: '无法获取数据库状态'
      }
    }
    
    // 检查 WAL 模式是否正常
    if (status.journalMode !== 'wal') {
      return {
        healthy: false,
        message: `数据库模式异常: ${status.journalMode}`
      }
    }
    
    return {
      healthy: true,
      message: '数据库运行正常',
      details: status
    }
  } catch (error) {
    return {
      healthy: false,
      message: `健康检查失败: ${error}`
    }
  }
}

// ============================================
// 示例 9: 条件性 checkpoint
// ============================================

export async function conditionalCheckpointExample() {
  const status = getDatabaseStatus()
  
  if (status) {
    // 假设我们想在数据库超过 100MB 时执行 checkpoint
    const sizeInMB = parseFloat(status.dbSize)
    
    if (sizeInMB > 100) {
      console.log(`数据库大小 ${sizeInMB}MB，执行 checkpoint`)
      performCheckpoint('FULL')
    }
  }
}

// ============================================
// 示例 10: 在测试中使用
// ============================================

export async function testSetupExample() {
  // 测试前清理数据库
  performCheckpoint('TRUNCATE')
  
  // 执行测试
  // ... 测试逻辑 ...
  
  // 测试后清理
  performCheckpoint('TRUNCATE')
}
