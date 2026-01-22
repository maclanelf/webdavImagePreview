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
  Tabs,
  Tab,
  LinearProgress,
} from '@mui/material'

interface RandomTestResult {
  filename: string
  basename: string
  parent_path: string
  id: number
  file_size: number
  count: number // 被随机到的次数
}

interface PersonStats {
  parent_path: string
  count: number
  percentage: number
  files: string[]
}

interface WebDAVConfig {
  url: string
  username: string
  password: string
  mediaPaths: string[]
}

export default function RandomTestPage() {
  const [config, setConfig] = useState<WebDAVConfig | null>(null)
  const [testCount, setTestCount] = useState(100)
  const [minFileSize, setMinFileSize] = useState(100 * 1024 * 1024) // 100MB
  const [loading, setLoading] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [results, setResults] = useState<Map<string, RandomTestResult>>(new Map())
  const [excludeIds, setExcludeIds] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [testMode, setTestMode] = useState<'none' | 'without' | 'with'>('none')
  const [currentTab, setCurrentTab] = useState(0)
  const [progress, setProgress] = useState(0)

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
    setProgress(0)

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
            parent_path: file.parent_path,
            id: file.id,
            file_size: file.file_size,
            count: 1,
          })
        }
      }

      // 更新进度
      setProgress(((i + 1) / testCount) * 100)
      setResults(new Map(newResults))
    }

    setLoading(false)
    setProgress(100)
  }

  // 执行带排除的测试
  const runTestWithExclusion = async () => {
    setLoading(true)
    setError(null)
    setResults(new Map())
    setTestMode('with')
    setProgress(0)
    
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
            parent_path: file.parent_path,
            id: file.id,
            file_size: file.file_size,
            count: 1,
          })
        }

        // 将当前文件 ID 加入排除列表
        currentExcludeIds.push(file.id)
      }

      // 更新进度
      setProgress(((i + 1) / testCount) * 100)
      setResults(new Map(newResults))
      setExcludeIds([...currentExcludeIds])
    }

    setLoading(false)
    setProgress(100)
  }

  // 计算按人（父文件夹）统计的数据
  const calculatePersonStats = (): PersonStats[] => {
    const personMap = new Map<string, PersonStats>()
    const totalTests = Array.from(results.values()).reduce((sum, r) => sum + r.count, 0)

    results.forEach((result) => {
      const person = result.parent_path
      const existing = personMap.get(person)

      if (existing) {
        existing.count += result.count
        existing.files.push(result.basename)
      } else {
        personMap.set(person, {
          parent_path: person,
          count: result.count,
          percentage: 0,
          files: [result.basename],
        })
      }
    })

    // 计算百分比
    personMap.forEach((stats) => {
      stats.percentage = totalTests > 0 ? (stats.count / totalTests) * 100 : 0
    })

    return Array.from(personMap.values()).sort((a, b) => b.count - a.count)
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
  const personStats = calculatePersonStats()
  const totalPersons = personStats.length
  const maxPersonCount = Math.max(...personStats.map(p => p.count), 0)
  const maxPersonPercentage = Math.max(...personStats.map(p => p.percentage), 0)

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
            onChange={(e) => setTestCount(parseInt(e.target.value) || 100)}
            fullWidth
            helperText="建议100次以上以获得更准确的统计"
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
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography sx={{ mb: 2 }}>
            正在测试... ({Math.round(progress)}%)
          </Typography>
          <LinearProgress variant="determinate" value={progress} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            已完成: {totalTests}/{testCount}
          </Typography>
        </Paper>
      )}

      {results.size > 0 && (
        <>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              统计信息
            </Typography>
            
            <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mb: 2 }}>
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

            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Chip 
                label={`不同的人数: ${totalPersons}`} 
                color="secondary" 
              />
              <Chip 
                label={`最高出现次数: ${maxPersonCount}`} 
                color={maxPersonCount > totalTests * 0.3 ? 'error' : 'success'} 
              />
              <Chip 
                label={`最高出现概率: ${maxPersonPercentage.toFixed(2)}%`} 
                color={maxPersonPercentage > 30 ? 'error' : maxPersonPercentage > 15 ? 'warning' : 'success'} 
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

            {testMode === 'without' && !loading && maxPersonPercentage > 30 && (
              <Alert severity="error" sx={{ mt: 2 }}>
                ⚠️ 随机性问题！某个人出现概率超过 30%，说明随机算法存在偏向性
              </Alert>
            )}

            {testMode === 'without' && !loading && maxPersonPercentage <= 15 && (
              <Alert severity="success" sx={{ mt: 2 }}>
                ✅ 随机性良好！各个人出现概率较为均衡
              </Alert>
            )}
          </Paper>

          <Paper sx={{ mb: 3 }}>
            <Tabs value={currentTab} onChange={(e, v) => setCurrentTab(v)}>
              <Tab label="按人统计" />
              <Tab label="按文件统计" />
            </Tabs>

            {currentTab === 0 && (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>父文件夹（人）</TableCell>
                      <TableCell>出现次数</TableCell>
                      <TableCell>出现概率</TableCell>
                      <TableCell>文件数量</TableCell>
                      <TableCell>文件列表</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {personStats.map((person) => (
                      <TableRow
                        key={person.parent_path}
                        sx={{
                          backgroundColor: 
                            person.percentage > 30 ? 'rgba(244, 67, 54, 0.1)' :
                            person.percentage > 15 ? 'rgba(255, 152, 0, 0.1)' : 
                            'inherit',
                        }}
                      >
                        <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {person.parent_path}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={person.count}
                            color={
                              person.percentage > 30 ? 'error' :
                              person.percentage > 15 ? 'warning' : 
                              'success'
                            }
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 'bold',
                              color: 
                                person.percentage > 30 ? 'error.main' :
                                person.percentage > 15 ? 'warning.main' : 
                                'success.main',
                            }}
                          >
                            {person.percentage.toFixed(2)}%
                          </Typography>
                        </TableCell>
                        <TableCell>{person.files.length}</TableCell>
                        <TableCell sx={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <Typography variant="caption" component="div">
                            {person.files.slice(0, 3).join(', ')}
                            {person.files.length > 3 && ` ... (+${person.files.length - 3})`}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {currentTab === 1 && (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>文件名</TableCell>
                      <TableCell>父文件夹</TableCell>
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
                          <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {result.parent_path}
                          </TableCell>
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
            )}
          </Paper>
        </>
      )}
    </Container>
  )
}
