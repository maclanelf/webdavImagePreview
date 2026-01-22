'use client'

import { useState, useEffect } from 'react'
import {
  Container,
  Box,
  Typography,
  Button,
  TextField,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  Chip,
  Stack,
} from '@mui/material'

interface RandomTestResult {
  filename: string
  basename: string
  id: number
  file_size: number
  count: number // 被随机到的次数
}

interface WebDAVConfig {
  url: string
  username: string
  password: string
  mediaPaths: string[]
}

export default function RandomTestPage() {
  const [config, setConfig] = useState<WebDAVConfig | null>(null)
  const [testCount, setTestCount] = useState(20)
  const [minFileSize, setMinFileSize] = useState(100 * 1024 * 1024) // 100MB
  const [loading, setLoading] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [results, setResults] = useState<Map<string, RandomTestResult>>(new Map())
  const [excludeIds, setExcludeIds] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [testMode, setTestMode] = useState<'none' | 'without' | 'with'>('none')

  // 自动从数据库加载配置
  useEffect(() => {
    loadConfigFromDatabase()
  }, [])

  const loadConfigFromDatabase = async () => {
    setLoadingConfig(true)
    try {
      // 从 webdav-config API 获取配置
      const response = await fetch('/api/webdav-config')
      if (response.ok) {
        const data = await response.json()
        if (data.configs && data.configs.length > 0) {
          // 优先使用默认配置，如果没有则使用第一个
          const defaultConfig = data.configs.find((c: any) => c.is_default === 1)
          const configToUse = defaultConfig || data.configs[0]
          
          setConfig({
            url: configToUse.url,
            username: configToUse.username,
            password: configToUse.password,
            mediaPaths: JSON.parse(configToUse.media_paths || '[]')
          })
          setError(null)
        } else {
          setError('数据库中没有找到 WebDAV 配置，请先在主页面配置')
        }
      } else {
        setError('无法从数据库加载配置')
      }
    } catch (err) {
      setError('加载配置失败: ' + (err as Error).message)
    } finally {
      setLoadingConfig(false)
    }
  }

  // 执行单次随机测试
  const runSingleTest = async (currentExcludeIds: number[] = []) => {
    if (!config) {
      setError('配置未加载')
      return null
    }

    try {
      const response = await fetch('/api/scan-files/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webdavUrl: config.url,
          webdavUsername: config.username,
          paths: config.mediaPaths,
          count: 1,
          fileType: 'video',
          minFileSize,
          excludeIds: currentExcludeIds.length > 0 ? currentExcludeIds : undefined,
        }),
      })

      if (!response.ok) {
        throw new Error('请求失败')
      }

      const data = await response.json()
      
      if (!data.files || data.files.length === 0) {
        return null
      }

      return data.files[0]
    } catch (err: any) {
      console.error('随机测试失败:', err)
      return null
    }
  }

  // 执行批量测试（无排除）
  const runBatchTest = async () => {
    setLoading(true)
    setError(null)
    setResults(new Map())
    setExcludeIds([])
    setTestMode('without')

    const newResults = new Map<string, RandomTestResult>()

    for (let i = 0; i < testCount; i++) {
      const file = await runSingleTest()
      
      if (file) {
        const key = file.filename
        const existing = newResults.get(key)
        
        if (existing) {
          existing.count++
        } else {
          newResults.set(key, {
            filename: file.filename,
            basename: file.basename,
            id: file.id,
            file_size: file.file_size,
            count: 1,
          })
        }
      }

      // 更新进度
      setResults(new Map(newResults))
    }

    setLoading(false)
  }

  // 执行带排除的测试
  const runTestWithExclusion = async () => {
    setLoading(true)
    setError(null)
    setResults(new Map())
    setTestMode('with')
    
    const newResults = new Map<string, RandomTestResult>()
    const currentExcludeIds: number[] = []

    for (let i = 0; i < testCount; i++) {
      const file = await runSingleTest(currentExcludeIds)
      
      if (file) {
        const key = file.filename
        const existing = newResults.get(key)
        
        if (existing) {
          existing.count++
        } else {
          newResults.set(key, {
            filename: file.filename,
            basename: file.basename,
            id: file.id,
            file_size: file.file_size,
            count: 1,
          })
        }

        // 将当前文件 ID 加入排除列表
        currentExcludeIds.push(file.id)
      }

      // 更新进度
      setResults(new Map(newResults))
      setExcludeIds([...currentExcludeIds])
    }

    setLoading(false)
  }

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }
    return `${(bytes / 1024).toFixed(2)} KB`
  }

  // 计算统计信息
  const totalFiles = results.size
  const totalTests = Array.from(results.values()).reduce((sum, r) => sum + r.count, 0)
  const duplicateCount = Array.from(results.values()).filter(r => r.count > 1).length
  const maxCount = Math.max(...Array.from(results.values()).map(r => r.count), 0)

  if (loadingConfig) {
    return (
      <Container maxWidth="xl" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>正在从数据库加载配置...</Typography>
      </Container>
    )
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        随机文件测试工具
      </Typography>
      
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          配置信息
        </Typography>
        
        {config ? (
          <Stack spacing={1}>
            <Typography variant="body2">
              <strong>WebDAV URL:</strong> {config.url}
            </Typography>
            <Typography variant="body2">
              <strong>用户名:</strong> {config.username}
            </Typography>
            <Typography variant="body2">
              <strong>媒体路径:</strong> {config.mediaPaths.join(', ')}
            </Typography>
          </Stack>
        ) : (
          <Alert severity="error">未找到配置，请先在主页面配置 WebDAV</Alert>
        )}
        
        <Button 
          variant="outlined" 
          onClick={loadConfigFromDatabase}
          sx={{ mt: 2 }}
        >
          重新加载配置
        </Button>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          测试参数
        </Typography>
        
        <Stack spacing={2}>
          <TextField
            label="测试次数"
            type="number"
            value={testCount}
            onChange={(e) => setTestCount(parseInt(e.target.value) || 20)}
            fullWidth
          />
          
          <TextField
            label="最小文件大小 (字节)"
            type="number"
            value={minFileSize}
            onChange={(e) => setMinFileSize(parseInt(e.target.value) || 0)}
            fullWidth
            helperText={`当前: ${formatFileSize(minFileSize)}`}
          />
        </Stack>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          测试操作
        </Typography>
        
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <Button
            variant="contained"
            onClick={runBatchTest}
            disabled={loading || !config}
          >
            {loading && testMode === 'without' ? <CircularProgress size={24} /> : '测试（无排除）'}
          </Button>
          
          <Button
            variant="contained"
            color="secondary"
            onClick={runTestWithExclusion}
            disabled={loading || !config}
          >
            {loading && testMode === 'with' ? <CircularProgress size={24} /> : '测试（带排除）'}
          </Button>
          
          <Button
            variant="outlined"
            onClick={() => {
              setResults(new Map())
              setExcludeIds([])
              setError(null)
              setTestMode('none')
            }}
          >
            清空结果
          </Button>
        </Stack>
        
        <Alert severity="info">
          <strong>无排除：</strong>每次随机都不排除任何文件，用于测试是否会重复<br />
          <strong>带排除：</strong>每次随机后将文件 ID 加入排除列表，模拟真实使用场景（不应该出现重复）
        </Alert>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Paper sx={{ p: 3, mb: 3, textAlign: 'center' }}>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>
            正在测试... ({totalTests}/{testCount})
          </Typography>
        </Paper>
      )}

      {results.size > 0 && (
        <>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              统计信息
            </Typography>
            
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Chip label={`总测试次数: ${totalTests}`} color="primary" />
              <Chip label={`不同文件数: ${totalFiles}`} color="info" />
              <Chip 
                label={`重复文件数: ${duplicateCount}`} 
                color={duplicateCount > 0 ? 'warning' : 'success'} 
              />
              <Chip 
                label={`最大重复次数: ${maxCount}`} 
                color={maxCount > 1 ? 'error' : 'success'} 
              />
            </Stack>
            
            {excludeIds.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                当前排除 ID 数量: {excludeIds.length}
              </Typography>
            )}
            
            {testMode === 'with' && duplicateCount === 0 && !loading && (
              <Alert severity="success" sx={{ mt: 2 }}>
                ✅ 测试通过！带排除模式下没有发现重复文件
              </Alert>
            )}
            
            {testMode === 'with' && duplicateCount > 0 && !loading && (
              <Alert severity="error" sx={{ mt: 2 }}>
                ❌ 测试失败！带排除模式下发现了 {duplicateCount} 个重复文件
              </Alert>
            )}
          </Paper>

          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>文件名</TableCell>
                  <TableCell>ID</TableCell>
                  <TableCell>文件大小</TableCell>
                  <TableCell>被随机到次数</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from(results.values())
                  .sort((a, b) => b.count - a.count)
                  .map((result) => (
                    <TableRow
                      key={result.filename}
                      sx={{
                        backgroundColor: result.count > 1 ? 'rgba(255, 152, 0, 0.1)' : 'inherit',
                      }}
                    >
                      <TableCell>{result.basename}</TableCell>
                      <TableCell>{result.id}</TableCell>
                      <TableCell>{formatFileSize(result.file_size)}</TableCell>
                      <TableCell>
                        <Chip
                          label={result.count}
                          color={result.count > 1 ? 'error' : 'success'}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Container>
  )
}
