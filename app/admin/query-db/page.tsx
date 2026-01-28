'use client'

import { useState } from 'react'
import { Box, TextField, Button, Typography, Paper, Alert } from '@mui/material'

export default function QueryDbPage() {
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dbInfo, setDbInfo] = useState<any>(null)

  // 预设查询
  const presetQueries = [
    {
      name: '测试查询（你的问题）',
      sql: `SELECT COUNT(*) as count FROM scan_files sf 
INNER JOIN media_ratings mr ON sf.filename = mr.file_path 
WHERE sf.cache_id IN (50,56,48,51,52,53,54,55,59) 
  AND sf.file_type = 'video' 
  AND sf.is_viewed = 1 
  AND sf.file_size >= 104857600 
  AND mr.rating IN (4,5) 
  AND (mr.category IS NULL OR mr.category = '')`
    },
    {
      name: '所有评分统计',
      sql: 'SELECT rating, COUNT(*) as count FROM media_ratings GROUP BY rating ORDER BY rating'
    },
    {
      name: '最近评分的文件',
      sql: 'SELECT file_name, rating, updated_at FROM media_ratings ORDER BY updated_at DESC LIMIT 20'
    },
    {
      name: 'scan_files 统计',
      sql: 'SELECT file_type, is_viewed, COUNT(*) as count FROM scan_files GROUP BY file_type, is_viewed'
    }
  ]

  const loadDbInfo = async () => {
    try {
      const response = await fetch('/api/admin/query-db')
      const data = await response.json()
      setDbInfo(data)
    } catch (err: any) {
      console.error('加载数据库信息失败:', err)
    }
  }

  const executeQuery = async () => {
    if (!sql.trim()) {
      setError('请输入 SQL 语句')
      return
    }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const response = await fetch('/api/admin/query-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
      })

      const data = await response.json()

      if (data.success) {
        setResult(data)
      } else {
        setError(data.error || '查询失败')
      }
    } catch (err: any) {
      setError(err.message || '网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom>
        数据库实时查询工具
      </Typography>

      {/* 数据库信息 */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          数据库状态
        </Typography>
        <Button variant="outlined" onClick={loadDbInfo} sx={{ mb: 2 }}>
          刷新状态
        </Button>
        {dbInfo && (
          <Box sx={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
            <div>路径: {dbInfo.dbPath}</div>
            <div>日志模式: {dbInfo.journalMode}</div>
            <div>大小: {dbInfo.dbSize}</div>
            <div>表统计:</div>
            <Box sx={{ pl: 2 }}>
              {Object.entries(dbInfo.tables || {}).map(([table, count]) => (
                <div key={table}>
                  {table}: {count as number} 条记录
                </div>
              ))}
            </Box>
          </Box>
        )}
      </Paper>

      {/* 预设查询 */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          预设查询
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {presetQueries.map((query, index) => (
            <Button
              key={index}
              variant="outlined"
              size="small"
              onClick={() => setSql(query.sql)}
            >
              {query.name}
            </Button>
          ))}
        </Box>
      </Paper>

      {/* SQL 输入 */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          SQL 查询
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={8}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="输入 SQL 语句..."
          sx={{ mb: 2, fontFamily: 'monospace' }}
        />
        <Button
          variant="contained"
          onClick={executeQuery}
          disabled={loading}
        >
          {loading ? '执行中...' : '执行查询'}
        </Button>
      </Paper>

      {/* 错误信息 */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* 查询结果 */}
      {result && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>
            查询结果
          </Typography>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              类型: {result.resultType} | 
              耗时: {result.duration}ms | 
              记录数: {result.rowCount}
            </Typography>
          </Box>
          <Box
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              backgroundColor: '#f5f5f5',
              p: 2,
              borderRadius: 1,
              overflow: 'auto',
              maxHeight: 600
            }}
          >
            <pre>{JSON.stringify(result.data, null, 2)}</pre>
          </Box>
        </Paper>
      )}
    </Box>
  )
}
