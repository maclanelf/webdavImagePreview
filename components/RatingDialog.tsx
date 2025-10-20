'use client'

import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Rating,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Autocomplete,
  FormControlLabel,
  Switch,
  Divider,
  Alert,
  CircularProgress
} from '@mui/material'
import { Star, StarBorder } from '@mui/icons-material'

interface RatingData {
  rating?: number
  recommendationReason?: string
  customEvaluation?: string | string[]  // 支持多个评价
  category?: string | string[]  // 支持多个分类
  isViewed?: boolean
}

interface RatingDialogProps {
  open: boolean
  onClose: () => void
  onSave: (data: RatingData) => Promise<void>
  title: string
  subtitle?: string
  initialData?: RatingData
  type: 'media' | 'group'
}

export default function RatingDialog({
  open,
  onClose,
  onSave,
  title,
  subtitle,
  initialData,
  type
}: RatingDialogProps) {
  const [rating, setRating] = useState<number>(0)
  const [recommendationReason, setRecommendationReason] = useState('')
  const [customEvaluation, setCustomEvaluation] = useState<string[]>([])
  const [category, setCategory] = useState<string[]>([])
  const [isViewed, setIsViewed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // 可用的评价标签和分类
  const [availableEvaluations, setAvailableEvaluations] = useState<string[]>([])
  const [availableCategories, setAvailableCategories] = useState<string[]>([])

  // 加载可用的评价标签和分类
  useEffect(() => {
    if (open) {
      loadAvailableData()
    }
  }, [open])

  // 初始化数据
  useEffect(() => {
    if (initialData) {
      setRating(initialData.rating || 0)
      setRecommendationReason(initialData.recommendationReason || '')
      
      // 处理评价：可能是字符串或数组
      if (initialData.customEvaluation) {
        setCustomEvaluation(
          Array.isArray(initialData.customEvaluation) 
            ? initialData.customEvaluation 
            : [initialData.customEvaluation]
        )
      } else {
        setCustomEvaluation([])
      }
      
      // 处理分类：可能是字符串或数组
      if (initialData.category) {
        setCategory(
          Array.isArray(initialData.category) 
            ? initialData.category 
            : [initialData.category]
        )
      } else {
        setCategory([])
      }
      
      setIsViewed(initialData.isViewed || false)
    } else {
      setRating(0)
      setRecommendationReason('')
      setCustomEvaluation([])
      setCategory([])
      setIsViewed(false)
    }
    setError('')
  }, [initialData, open])

  const loadAvailableData = async () => {
    try {
      const [evaluationsRes, categoriesRes] = await Promise.all([
        fetch('/api/ratings/evaluations'),
        fetch('/api/ratings/categories')
      ])
      
      const evaluationsData = await evaluationsRes.json()
      const categoriesData = await categoriesRes.json()
      
      if (evaluationsData.evaluations) {
        setAvailableEvaluations(evaluationsData.evaluations.map((e: any) => e.label))
      }
      
      if (categoriesData.categories) {
        setAvailableCategories(categoriesData.categories.map((c: any) => c.name))
      }
    } catch (error) {
      console.error('加载可用数据失败:', error)
    }
  }

  const handleSave = async () => {
    setLoading(true)
    setError('')
    
    try {
      const data: RatingData = {
        rating: rating > 0 ? rating : undefined,
        recommendationReason: recommendationReason.trim() || undefined,
        customEvaluation: customEvaluation.length > 0 ? customEvaluation : undefined,
        category: category.length > 0 ? category : undefined,
        isViewed
      }
      
      await onSave(data)
      onClose()
    } catch (error: any) {
      setError(error.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAddEvaluation = async (newEvaluation: string) => {
    if (newEvaluation && !availableEvaluations.includes(newEvaluation)) {
      try {
        await fetch('/api/ratings/evaluations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: newEvaluation })
        })
        setAvailableEvaluations(prev => [...prev, newEvaluation])
      } catch (error) {
        console.error('添加评价标签失败:', error)
      }
    }
  }

  const handleAddCategory = async (newCategory: string) => {
    if (newCategory && !availableCategories.includes(newCategory)) {
      try {
        await fetch('/api/ratings/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newCategory })
        })
        setAvailableCategories(prev => [...prev, newCategory])
      } catch (error) {
        console.error('添加分类失败:', error)
      }
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box>
          <Typography variant="h6">{title}</Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          {/* 推荐指数 */}
          <Box>
            <Typography variant="subtitle1" gutterBottom>
              推荐指数
            </Typography>
            <Rating
              value={rating}
              onChange={(_, newValue) => setRating(newValue || 0)}
              size="large"
              icon={<Star fontSize="inherit" />}
              emptyIcon={<StarBorder fontSize="inherit" />}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {rating === 0 ? '未评分' : `${rating} 星`}
            </Typography>
          </Box>

          <Divider />

          {/* 推荐理由 */}
          <TextField
            label="推荐理由"
            multiline
            rows={4}
            value={recommendationReason}
            onChange={(e) => setRecommendationReason(e.target.value)}
            placeholder="为什么推荐这个内容？有什么特别之处？"
            fullWidth
            variant="outlined"
          />

          {/* 自定义评价 - 支持多选 */}
          <Autocomplete
            multiple
            freeSolo
            options={availableEvaluations}
            value={customEvaluation}
            onChange={(_, newValue) => {
              setCustomEvaluation(newValue as string[])
              // 添加新的评价到数据库
              newValue.forEach(val => {
                if (val && !availableEvaluations.includes(val)) {
                  handleAddEvaluation(val)
                }
              })
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="自定义评价（可多选）"
                placeholder="选择或输入多个评价，如：一般、还行等"
                variant="outlined"
              />
            )}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  variant="outlined"
                  label={option}
                  {...getTagProps({ index })}
                  key={option}
                />
              ))
            }
            renderOption={(props, option) => (
              <Box component="li" {...props}>
                <Chip
                  label={option}
                  size="small"
                  variant="outlined"
                  sx={{ mr: 1 }}
                />
                {option}
              </Box>
            )}
          />

          {/* 分类 - 支持多选 */}
          <Autocomplete
            multiple
            freeSolo
            options={availableCategories}
            value={category}
            onChange={(_, newValue) => {
              setCategory(newValue as string[])
              // 添加新的分类到数据库
              newValue.forEach(val => {
                if (val && !availableCategories.includes(val)) {
                  handleAddCategory(val)
                }
              })
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="分类（可多选）"
                placeholder="选择或输入多个分类，如：性感、动漫等"
                variant="outlined"
              />
            )}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  variant="outlined"
                  label={option}
                  {...getTagProps({ index })}
                  key={option}
                  color="secondary"
                />
              ))
            }
            renderOption={(props, option) => (
              <Box component="li" {...props}>
                <Chip
                  label={option}
                  size="small"
                  variant="outlined"
                  sx={{ mr: 1 }}
                />
                {option}
              </Box>
            )}
          />

          {/* 是否看过 */}
          <FormControlLabel
            control={
              <Switch
                checked={isViewed}
                onChange={(e) => setIsViewed(e.target.checked)}
                color="primary"
              />
            }
            label={
              <Box>
                <Typography variant="body1">
                  {type === 'media' ? '已看过此媒体' : '已看过此图组'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {type === 'media' 
                    ? '标记为已浏览过的图片或视频' 
                    : '标记为已浏览过的图组或视频组'
                  }
                </Typography>
              </Box>
            }
          />
        </Box>
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          取消
        </Button>
        <Button 
          onClick={handleSave} 
          variant="contained" 
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          {loading ? '保存中...' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
