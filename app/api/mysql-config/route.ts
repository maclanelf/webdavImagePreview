import { NextRequest, NextResponse } from 'next/server'

import { cleanupDatabase } from '@/lib/database'
import { initializeApp } from '@/lib/init'
import { getMysqlConfigForDisplay, saveMysqlConfigToFile } from '@/lib/mysqlConfigFile'

export async function GET() {
  try {
    const { config, source, filePath } = getMysqlConfigForDisplay()

    return NextResponse.json({
      config,
      source,
      filePath,
    })
  } catch (error: any) {
    console.error('获取 MySQL 配置失败:', error)
    return NextResponse.json(
      { error: `获取 MySQL 配置失败: ${error.message}` },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { config, filePath } = saveMysqlConfigToFile(body)

    cleanupDatabase()
    await initializeApp()

    return NextResponse.json({
      message: 'MySQL 配置文件保存成功',
      config,
      filePath,
    })
  } catch (error: any) {
    console.error('保存 MySQL 配置失败:', error)
    return NextResponse.json(
      { error: `保存 MySQL 配置失败: ${error.message}` },
      { status: 500 },
    )
  }
}
