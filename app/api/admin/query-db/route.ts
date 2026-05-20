import { NextRequest, NextResponse } from 'next/server'

import { executeMySqlStatement, ensureMySqlInitialized, getMySqlConnection, queryMySqlRows } from '@/lib/database'

function getSqlType(sql: string) {
  return sql.trim().split(/\s+/)[0]?.toUpperCase() || ''
}

function isReadQuery(sqlType: string) {
  return ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(sqlType)
}

function isWriteQuery(sqlType: string) {
  return ['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE'].includes(sqlType)
}

// POST: 执行 SQL 查询（管理员功能）
export async function POST(request: NextRequest) {
  try {
    await ensureMySqlInitialized()

    const body = await request.json()
    const { sql, params = [] } = body

    if (!sql) {
      return NextResponse.json(
        { error: '请提供 SQL 语句' },
        { status: 400 }
      )
    }

    const startTime = Date.now()
    const sqlType = getSqlType(sql)

    if (isReadQuery(sqlType)) {
      const result = await queryMySqlRows(sql, params)
      return NextResponse.json({
        success: true,
        resultType: 'read',
        duration: Date.now() - startTime,
        rowCount: Array.isArray(result) ? result.length : 0,
        data: result,
      })
    }

    if (isWriteQuery(sqlType)) {
      const result = await executeMySqlStatement(sql, params)
      return NextResponse.json({
        success: true,
        resultType: 'write',
        duration: Date.now() - startTime,
        rowCount: result.affectedRows || 0,
        data: {
          affectedRows: result.affectedRows,
          insertId: result.insertId,
          warningStatus: result.warningStatus,
          changedRows: (result as any).changedRows ?? undefined,
        },
      })
    }

    return NextResponse.json(
      { error: '不支持的 SQL 类型' },
      { status: 400 }
    )
  } catch (error: any) {
    console.error('查询失败:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    )
  }
}

// GET: 获取数据库状态信息
export async function GET(_request: NextRequest) {
  let connection: Awaited<ReturnType<typeof getMySqlConnection>> | null = null

  try {
    await ensureMySqlInitialized()
    connection = await getMySqlConnection()

    const [dbInfoRows] = await connection.query<any[]>('SELECT DATABASE() AS dbName, VERSION() AS version')
    const dbInfo = dbInfoRows[0] || { dbName: null, version: null }
    const databaseName = dbInfo.dbName || process.env.MYSQL_DATABASE || null

    const [tableRows] = await connection.query<any[]>(
      `
        SELECT TABLE_NAME AS tableName
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME ASC
      `,
      [databaseName]
    )

    const tableCounts: Record<string, number> = {}
    for (const table of tableRows) {
      const tableName = String(table.tableName)
      const [countRows] = await connection.query<any[]>(`SELECT COUNT(*) AS count FROM ${connection.escapeId(tableName)}`)
      tableCounts[tableName] = Number(countRows[0]?.count || 0)
    }

    return NextResponse.json({
      success: true,
      database: databaseName,
      version: dbInfo.version,
      tables: tableCounts,
    })
  } catch (error: any) {
    console.error('获取数据库信息失败:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    )
  } finally {
    connection?.release()
  }
}
