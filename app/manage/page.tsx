'use client'

import React, { useState, useEffect } from 'react'
import {
  Container,
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Grid,
  Chip,
  Alert,
  Snackbar,
  AppBar,
  Toolbar,
} from '@mui/material'
import {
  Delete as DeleteIcon,
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  Label as LabelIcon,
  Category as CategoryIcon,
} from '@mui/icons-material'
import { useRouter } from 'next/navigation'

interface Evaluation {
  id: number
  label: string
  usage_count: number
  created_at: string
}

interface Category {
  id: number
  name: string
  usage_count: number
  created_at: string
}

export default function ManagePage() {
  const router = useRouter()
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [newEvaluation, setNewEvaluation] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [loading, setLoading] = useState(false)
  const [snackbarOpen, setSnackbarOpen] = useState(false)
  const [snackbarMessage, setSnackbarMessage] = useState('')
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [evalRes, catRes] = await Promise.all([
        fetch('/api/ratings/evaluations'),
        fetch('/api/ratings/categories')
      ])

      const evalData = await evalRes.json()
      const catData = await catRes.json()

      setEvaluations(evalData.evaluations || [])
      setCategories(catData.categories || [])
    } catch (error) {
      console.error('加载数据失败:', error)
      showMessage('加载数据失败', 'error')
    }
  }

  const showMessage = (message: string, severity: 'success' | 'error') => {
    setSnackbarMessage(message)
    setSnackbarSeverity(severity)
    setSnackbarOpen(true)
  }

  const handleAddEvaluation = async () => {
    if (!newEvaluation.trim()) {
      showMessage('请输入评价标签', 'error')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/ratings/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newEvaluation.trim() })
      })

      if (response.ok) {
        setNewEvaluation('')
        await loadData()
        showMessage('添加评价标签成功', 'success')
      } else {
        const error = await response.json()
        showMessage(error.error || '添加失败', 'error')
      }
    } catch (error) {
      showMessage('添加评价标签失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteEvaluation = async (label: string) => {
    if (!confirm(`确定要删除评价标签"${label}"吗？`)) {
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`/api/ratings/evaluations?label=${encodeURIComponent(label)}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await loadData()
        showMessage('删除评价标签成功', 'success')
      } else {
        showMessage('删除失败', 'error')
      }
    } catch (error) {
      showMessage('删除评价标签失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleAddCategory = async () => {
    if (!newCategory.trim()) {
      showMessage('请输入分类名称', 'error')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/ratings/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategory.trim() })
      })

      if (response.ok) {
        setNewCategory('')
        await loadData()
        showMessage('添加分类成功', 'success')
      } else {
        const error = await response.json()
        showMessage(error.error || '添加失败', 'error')
      }
    } catch (error) {
      showMessage('添加分类失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteCategory = async (name: string) => {
    if (!confirm(`确定要删除分类"${name}"吗？`)) {
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`/api/ratings/categories?name=${encodeURIComponent(name)}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        await loadData()
        showMessage('删除分类成功', 'success')
      } else {
        showMessage('删除失败', 'error')
      }
    } catch (error) {
      showMessage('删除分类失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* 顶部导航栏 */}
      <AppBar position="static">
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            onClick={() => router.push('/')}
            sx={{ mr: 2 }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            评价与分类管理
          </Typography>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3 }}>
          {/* 评价标签管理 */}
          <Box sx={{ flex: 1 }}>
            <Paper sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <LabelIcon sx={{ mr: 1, color: 'primary.main' }} />
                <Typography variant="h6" fontWeight="bold">
                  评价标签管理
                </Typography>
              </Box>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                管理评分时使用的评价标签，如：丑死了、一般、还行、非常爽、爽死了等
              </Typography>

              {/* 添加新评价 */}
              <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="新评价标签"
                  placeholder="输入评价标签，如：一般、还行等"
                  value={newEvaluation}
                  onChange={(e) => setNewEvaluation(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddEvaluation()
                    }
                  }}
                  disabled={loading}
                />
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={handleAddEvaluation}
                  disabled={loading || !newEvaluation.trim()}
                >
                  添加
                </Button>
              </Box>

              <Divider sx={{ mb: 2 }} />

              {/* 评价列表 */}
              {evaluations.length === 0 ? (
                <Alert severity="info">
                  暂无评价标签，请添加常用的评价标签
                </Alert>
              ) : (
                <List>
                  {evaluations.map((evaluation) => (
                    <ListItem
                      key={evaluation.id}
                      sx={{
                        border: '1px solid #e0e0e0',
                        borderRadius: 1,
                        mb: 1,
                        backgroundColor: '#fff'
                      }}
                    >
                      <ListItemText
                        primary={evaluation.label}
                        secondary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                            <Chip
                              label={`使用 ${evaluation.usage_count} 次`}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                          </Box>
                        }
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          onClick={() => handleDeleteEvaluation(evaluation.label)}
                          disabled={loading}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              )}

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                共 {evaluations.length} 个评价标签
              </Typography>
            </Paper>
          </Box>

          {/* 分类管理 */}
          <Box sx={{ flex: 1 }}>
            <Paper sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <CategoryIcon sx={{ mr: 1, color: 'secondary.main' }} />
                <Typography variant="h6" fontWeight="bold">
                  分类管理
                </Typography>
              </Box>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                管理媒体文件的分类标签，如：大秀、风景等
              </Typography>

              {/* 添加新分类 */}
              <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="新分类"
                  placeholder="输入分类名称，如：大秀、风景等"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddCategory()
                    }
                  }}
                  disabled={loading}
                />
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={handleAddCategory}
                  disabled={loading || !newCategory.trim()}
                >
                  添加
                </Button>
              </Box>

              <Divider sx={{ mb: 2 }} />

              {/* 分类列表 */}
              {categories.length === 0 ? (
                <Alert severity="info">
                  暂无分类，请添加常用的分类标签
                </Alert>
              ) : (
                <List>
                  {categories.map((category) => (
                    <ListItem
                      key={category.id}
                      sx={{
                        border: '1px solid #e0e0e0',
                        borderRadius: 1,
                        mb: 1,
                        backgroundColor: '#fff'
                      }}
                    >
                      <ListItemText
                        primary={category.name}
                        secondary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                            <Chip
                              label={`使用 ${category.usage_count} 次`}
                              size="small"
                              color="secondary"
                              variant="outlined"
                            />
                          </Box>
                        }
                      />
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          onClick={() => handleDeleteCategory(category.name)}
                          disabled={loading}
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                  ))}
                </List>
              )}

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                共 {categories.length} 个分类
              </Typography>
            </Paper>
          </Box>
        </Box>

        {/* 使用说明 */}
        <Paper sx={{ p: 3, mt: 3 }}>
          <Typography variant="h6" fontWeight="bold" gutterBottom>
            使用说明
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            1. <strong>评价标签</strong>：用于快速评分时的评价词汇，如：丑死了（1星）、一般（2星）、还行（3星）、非常爽（4星）、爽死了（5星）
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            2. <strong>分类</strong>：用于对媒体内容进行分类管理，可以根据内容特征自定义分类
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            3. <strong>使用频率</strong>：显示每个标签或分类的使用次数，使用越多的越靠前
          </Typography>
          <Typography variant="body2" color="text.secondary">
            4. <strong>删除操作</strong>：删除标签或分类不会影响已有的评分数据，但新的评分将无法选择已删除的选项
          </Typography>
        </Paper>
      </Container>

      {/* 提示消息 */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbarOpen(false)}
          severity={snackbarSeverity}
          variant="filled"
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  )
}
