'use client'

import { useState, useEffect } from 'react'
import { 
  Box, 
  Button, 
  TextField, 
  Typography, 
  Card, 
  CardContent,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  Rating,
  Stack,
  Paper
} from '@mui/material'

interface Creator {
  id: number
  primary_name: string
  otherNames: string[]
  appearance_rating: number | null
  body_rating: number | null
  bio: string | null
  usage_count: number
}

interface PreviewResult {
  mediaCount: number
  groupCount: number
  totalCount: number
  mediaSamples: any[]
  groupSamples: any[]
}

export default function CreatorTestPage() {
  const [creators, setCreators] = useState<Creator[]>([])
  const [selectedCreator, setSelectedCreator] = useState<Creator | null>(null)
  const [newCreatorName, setNewCreatorName] = useState('')
  const [newAliasName, setNewAliasName] = useState('')
  const [previewPattern, setPreviewPattern] = useState('')
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [dataStats, setDataStats] = useState<any>(null)

  // 加载博主列表
  const loadCreators = async () => {
    try {
      const res = await fetch('/api/creators')
      const data = await res.json()
      if (data.success) {
        setCreators(data.data)
      }
    } catch (error) {
      console.error('加载博主列表失败:', error)
    }
  }

  useEffect(() => {
    loadCreators()
    loadDataStats()
  }, [])

  // 加载数据统计
  const loadDataStats = async () => {
    try {
      const res = await fetch('/api/test-creator-data')
      const data = await res.json()
      if (data.success) {
        setDataStats(data.data)
      }
    } catch (error) {
      console.error('加载数据统计失败:', error)
    }
  }

  // 创建测试数据
  const handleCreateTestData = async () => {
    try {
      const res = await fetch('/api/test-creator-data', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: 'success', text: data.message })
        loadDataStats()
      } else {
        setMessage({ type: 'error', text: data.error })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  // 创建博主
  const handleCreateCreator = async () => {
    if (!newCreatorName.trim()) {
      setMessage({ type: 'error', text: '请输入博主名称' })
      return
    }

    try {
      const res = await fetch('/api/creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryName: newCreatorName,
          appearanceRating: 5,
          bodyRating: 4,
          bio: '测试博主'
        })
      })
      const data = await res.json()
      
      if (data.success) {
        setMessage({ type: 'success', text: '博主创建成功' })
        setNewCreatorName('')
        loadCreators()
      } else {
        setMessage({ type: 'error', text: data.error })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  // 预览批量关联
  const handlePreview = async () => {
    if (!previewPattern.trim()) {
      setMessage({ type: 'error', text: '请输入名称模式' })
      return
    }

    try {
      const res = await fetch('/api/creators/preview-batch-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namePattern: previewPattern })
      })
      const data = await res.json()
      
      if (data.success) {
        setPreviewResult(data.data)
        setShowPreviewDialog(true)
      } else {
        setMessage({ type: 'error', text: data.error })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  // 添加别名并批量关联
  const handleAddAliasWithBatchLink = async (batchUpdate: boolean) => {
    if (!selectedCreator) {
      setMessage({ type: 'error', text: '请先选择博主' })
      return
    }
    
    // 如果别名为空且不是批量更新模式，提示错误
    if (!newAliasName.trim() && !batchUpdate) {
      setMessage({ type: 'error', text: '请输入别名' })
      return
    }

    const aliasToUse = newAliasName.trim() || selectedCreator.primary_name
    console.log(`📝 [前端] 准备${batchUpdate ? '批量关联' : '添加别名'}: aliasName="${aliasToUse}", batchUpdate=${batchUpdate}`)

    try {
      const res = await fetch(`/api/creators/${selectedCreator.id}/alias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aliasName: aliasToUse,
          batchUpdate
        })
      })
      const data = await res.json()
      
      console.log(`📊 [前端] API 响应:`, data)
      
      if (data.success) {
        // 根据实际情况显示消息
        let msg = data.message || '操作成功'
        if (batchUpdate && data.data) {
          msg = data.message || `批量关联了 ${data.data.totalUpdated || 0} 条记录`
        }
        setMessage({ type: 'success', text: msg })
        setNewAliasName('')
        loadCreators()
        
        // 刷新选中的博主信息
        const updatedRes = await fetch(`/api/creators/${selectedCreator.id}`)
        const updatedData = await updatedRes.json()
        if (updatedData.success) {
          setSelectedCreator(updatedData.data)
        }
      } else {
        setMessage({ type: 'error', text: data.error })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <Box sx={{ p: 4, maxWidth: 1400, margin: '0 auto' }}>
      <Typography variant="h4" gutterBottom>
        博主管理测试页面
      </Typography>

      {message && (
        <Alert 
          severity={message.type} 
          onClose={() => setMessage(null)}
          sx={{ mb: 2 }}
        >
          {message.text}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {/* 数据统计卡片 */}
        {dataStats && (
          <Box sx={{ width: '100%', mb: 2 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  数据统计
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip label={`评分记录: ${dataStats.totalMediaRatings}`} />
                  <Chip label={`图组记录: ${dataStats.totalGroupRatings}`} />
                  <Chip label={`博主数: ${dataStats.totalCreators}`} />
                  <Chip 
                    label={`已关联评分: ${dataStats.mediaWithCreator}`} 
                    color={dataStats.mediaWithCreator > 0 ? 'success' : 'default'}
                  />
                  <Chip 
                    label={`已关联图组: ${dataStats.groupWithCreator}`}
                    color={dataStats.groupWithCreator > 0 ? 'success' : 'default'}
                  />
                  <Button 
                    variant="outlined" 
                    size="small"
                    onClick={handleCreateTestData}
                  >
                    创建测试数据
                  </Button>
                  <Button 
                    variant="outlined" 
                    size="small"
                    onClick={loadDataStats}
                  >
                    刷新统计
                  </Button>
                </Box>
                {dataStats.samplePaths && dataStats.samplePaths.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      示例路径（前3条）:
                    </Typography>
                    {dataStats.samplePaths.slice(0, 3).map((path: string, i: number) => (
                      <Typography key={i} variant="caption" display="block" sx={{ ml: 1 }}>
                        {path}
                      </Typography>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>
        )}

        {/* 左侧：创建博主和列表 */}
        <Box sx={{ flex: '1 1 300px', minWidth: 300 }}>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                创建博主
              </Typography>
              <TextField
                fullWidth
                label="博主名称"
                value={newCreatorName}
                onChange={(e) => setNewCreatorName(e.target.value)}
                sx={{ mb: 2 }}
              />
              <Button 
                variant="contained" 
                fullWidth
                onClick={handleCreateCreator}
              >
                创建
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                博主列表 ({creators.length})
              </Typography>
              <List sx={{ maxHeight: 400, overflow: 'auto' }}>
                {creators.map((creator) => (
                  <ListItem key={creator.id} disablePadding>
                    <ListItemButton
                      selected={selectedCreator?.id === creator.id}
                      onClick={() => setSelectedCreator(creator)}
                    >
                      <ListItemText
                        primary={creator.primary_name}
                        secondary={`使用次数: ${creator.usage_count} | 别名: ${creator.otherNames.length}`}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
                {creators.length === 0 && (
                  <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
                    暂无博主，请先创建
                  </Typography>
                )}
              </List>
            </CardContent>
          </Card>
        </Box>

        {/* 中间：博主详情 */}
        <Box sx={{ flex: '1 1 300px', minWidth: 300 }}>
          {selectedCreator ? (
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  博主详情
                </Typography>
                <Divider sx={{ my: 2 }} />
                
                <Typography variant="subtitle2" color="text.secondary">
                  主名称
                </Typography>
                <Typography variant="body1" gutterBottom>
                  {selectedCreator.primary_name}
                </Typography>

                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  颜值评分
                </Typography>
                <Rating value={selectedCreator.appearance_rating || 0} readOnly />

                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  身材评分
                </Typography>
                <Rating value={selectedCreator.body_rating || 0} readOnly />

                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  别名列表
                </Typography>
                <Box sx={{ mt: 1 }}>
                  {selectedCreator.otherNames.length > 0 ? (
                    selectedCreator.otherNames.map((name, index) => (
                      <Chip 
                        key={index} 
                        label={name} 
                        size="small" 
                        sx={{ mr: 1, mb: 1 }}
                      />
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      暂无别名
                    </Typography>
                  )}
                </Box>

                <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                  简介
                </Typography>
                <Typography variant="body2">
                  {selectedCreator.bio || '暂无简介'}
                </Typography>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <Typography variant="body1" color="text.secondary" align="center" sx={{ py: 4 }}>
                  请从左侧选择一个博主
                </Typography>
              </CardContent>
            </Card>
          )}
        </Box>

        {/* 右侧：批量关联功能 */}
        <Box sx={{ flex: '1 1 300px', minWidth: 300 }}>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                添加别名
              </Typography>
              <TextField
                fullWidth
                label="新别名"
                value={newAliasName}
                onChange={(e) => setNewAliasName(e.target.value)}
                disabled={!selectedCreator}
                sx={{ mb: 2 }}
                helperText={
                  newAliasName.trim() 
                    ? "例如：张三新作、Zhang San" 
                    : selectedCreator 
                      ? `留空则使用主名称"${selectedCreator.primary_name}"进行批量关联`
                      : "例如：张三新作、Zhang San"
                }
              />
              <Stack spacing={1}>
                <Button 
                  variant="outlined" 
                  fullWidth
                  onClick={() => handleAddAliasWithBatchLink(false)}
                  disabled={!selectedCreator || !newAliasName.trim()}
                >
                  仅添加别名
                </Button>
                <Button 
                  variant="contained" 
                  fullWidth
                  onClick={() => handleAddAliasWithBatchLink(true)}
                  disabled={!selectedCreator}
                  color="primary"
                >
                  {newAliasName.trim() 
                    ? '添加别名 + 批量关联历史记录' 
                    : selectedCreator 
                      ? `使用"${selectedCreator.primary_name}"批量关联`
                      : '添加别名 + 批量关联历史记录'
                  }
                </Button>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                预览批量关联
              </Typography>
              <TextField
                fullWidth
                label="名称模式"
                value={previewPattern}
                onChange={(e) => setPreviewPattern(e.target.value)}
                sx={{ mb: 2 }}
                helperText="输入要搜索的名称，例如：张三新作"
              />
              <Button 
                variant="outlined" 
                fullWidth
                onClick={handlePreview}
              >
                预览影响范围
              </Button>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* 预览对话框 */}
      <Dialog 
        open={showPreviewDialog} 
        onClose={() => setShowPreviewDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>批量关联预览</DialogTitle>
        <DialogContent>
          {previewResult && (
            <>
              <Alert severity="info" sx={{ mb: 2 }}>
                找到 <strong>{previewResult.totalCount}</strong> 条匹配记录
                （媒体文件: {previewResult.mediaCount}，图组: {previewResult.groupCount}）
              </Alert>

              {previewResult.mediaSamples.length > 0 && (
                <>
                  <Typography variant="subtitle1" gutterBottom>
                    媒体文件示例（前5条）
                  </Typography>
                  <List dense>
                    {previewResult.mediaSamples.map((sample: any, index: number) => (
                      <ListItem key={index}>
                        <ListItemText
                          primary={sample.file_name}
                          secondary={sample.file_path}
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}

              {previewResult.groupSamples.length > 0 && (
                <>
                  <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
                    图组示例（前5条）
                  </Typography>
                  <List dense>
                    {previewResult.groupSamples.map((sample: any, index: number) => (
                      <ListItem key={index}>
                        <ListItemText
                          primary={sample.group_name}
                          secondary={sample.group_path}
                        />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}

              {previewResult.totalCount === 0 && (
                <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
                  没有找到匹配的记录
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPreviewDialog(false)}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
