import { ensureMySqlInitialized } from './database'

// 数据库修复脚本（MySQL 版本）
export async function repairDatabase() {
  console.log('开始修复数据库...')

  try {
    await ensureMySqlInitialized(true)
    console.log('数据库修复完成')
  } catch (error) {
    console.error('数据库修复失败:', error)
    throw error
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  repairDatabase().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
