import { NextRequest, NextResponse } from 'next/server'
import { videoHighlights } from '@/lib/database'

// 数据库存储的 tags 是 JSON 字符串；接口层统一在这里反序列化为前端直接可用的数组。
function parseTags(value: string | null) {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

// 将数据库字段风格（snake_case）转换成前端使用的 camelCase，避免 UI 直接依赖表结构细节。
function parseHighlightRow(row: any) {
  return {
    id: row.id,
    filePath: row.file_path,
    fileName: row.file_name,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    durationSeconds: row.duration_seconds,
    title: row.title || undefined,
    note: row.note || undefined,
    tags: parseTags(row.tags),
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// 所有时间值统一规范到毫秒级三位小数，降低前后端多次换算后的浮点噪音。
function normalizeTime(value: unknown) {
  const time = Number(value)
  return Number.isFinite(time) ? Number(time.toFixed(3)) : NaN
}

// 对精彩时刻区间做基础输入校验；更复杂的“片段不可重叠”规则由数据库访问层负责。
function validateRange(startSeconds: number, endSeconds: number) {
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    return '开始和结束时间必须是数字'
  }

  if (startSeconds < 0 || endSeconds < 0) {
    return '时间不能小于 0'
  }

  if (endSeconds <= startSeconds) {
    return '结束时间必须大于开始时间'
  }

  return null
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const filePath = searchParams.get('filePath')

    if (!filePath) {
      return NextResponse.json({ error: '缺少 filePath 参数' }, { status: 400 })
    }

    const highlights = (await videoHighlights.getByFilePath(filePath)).map(parseHighlightRow)
    return NextResponse.json({ highlights })
  } catch (error: any) {
    console.error('获取精彩片段失败:', error)
    return NextResponse.json({ error: error.message || '获取精彩片段失败' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const filePath = typeof body.filePath === 'string' ? body.filePath.trim() : ''
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
    // 创建接口先统一时间精度，保证前端多次提交后仍使用同一套边界规则。
    const startSeconds = normalizeTime(body.startSeconds)
    const endSeconds = normalizeTime(body.endSeconds)
    const errorMessage = validateRange(startSeconds, endSeconds)

    if (!filePath || !fileName) {
      return NextResponse.json({ error: '缺少 filePath 或 fileName 参数' }, { status: 400 })
    }

    if (errorMessage) {
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    const result = await videoHighlights.create({
      filePath,
      fileName,
      startSeconds,
      endSeconds,
      title: typeof body.title === 'string' ? body.title : undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map((item: unknown) => String(item)) : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    })

    return NextResponse.json({
      success: true,
      id: result.insertId,
      changes: result.changes,
    })
  } catch (error: any) {
    console.error('保存精彩片段失败:', error)
    if (error.message === '时间重叠') {
      // 时间重叠属于可预期的业务冲突，不应返回 500 服务端异常。
      // 这里改为 409，便于前端区分“用户输入冲突”和“后端真的出错”。
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: error.message || '保存精彩片段失败' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    // 更新接口也走同样的时间归一化逻辑，避免编辑多次后出现 1.999999 之类的浮点误差。
    const id = Number(body.id)
    const startSeconds = normalizeTime(body.startSeconds)
    const endSeconds = normalizeTime(body.endSeconds)
    const errorMessage = validateRange(startSeconds, endSeconds)

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: '缺少有效的片段 id' }, { status: 400 })
    }

    if (errorMessage) {
      return NextResponse.json({ error: errorMessage }, { status: 400 })
    }

    const result = await videoHighlights.update(id, {
      startSeconds,
      endSeconds,
      title: typeof body.title === 'string' ? body.title : undefined,
      note: typeof body.note === 'string' ? body.note : undefined,
      tags: Array.isArray(body.tags) ? body.tags.map((item: unknown) => String(item)) : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    })

    return NextResponse.json({ success: true, changes: result.changes })
  } catch (error: any) {
    console.error('更新精彩片段失败:', error)
    if (error.message === '时间重叠') {
      // 更新接口与创建接口保持同样的错误语义：
      // 当编辑后的区间与既有片段冲突时，返回 409 而不是笼统的 500。
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error.message === '精彩时刻不存在') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json({ error: error.message || '更新精彩片段失败' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = Number(searchParams.get('id'))

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: '缺少有效的片段 id' }, { status: 400 })
    }

    const result = await videoHighlights.delete(id)
    return NextResponse.json({ success: true, changes: result.changes })
  } catch (error: any) {
    console.error('删除精彩片段失败:', error)
    if (error.message === '精彩时刻不存在') {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json({ error: error.message || '删除精彩片段失败' }, { status: 500 })
  }
}
