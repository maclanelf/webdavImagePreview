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
  Chip,
  Autocomplete,
  Alert,
  CircularProgress,
  Stack
} from '@mui/material'
import { Star, StarBorder } from '@mui/icons-material'
import { UNKNOWN_CREATOR_ID } from '@/lib/constants'

interface Creator {
  id: number
  primaryName: string
  otherNames?: string[]
  appearanceRating?: number
  bodyRating?: number
  bio?: string
}

interface CreatorDialogProps {
  open: boolean
  onClose: () => void
  filePath: string
  existingCreator?: Creator | null
  onSuccess?: () => void
  onMarkUnknown?: () => void
  container?: Element | null
}

export default function CreatorDialog({
  open,
  onClose,
  filePath,
  existingCreator,
  onSuccess,
  onMarkUnknown,
  container
}: CreatorDialogProps) {
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // 表单字段
  const [creatorId, setCreatorId] = useState<number | undefined>(undefined) // 选中已有博主时记录 id
  const [primaryName, setPrimaryName] = useState('')
  const [otherNames, setOtherNames] = useState<string[]>([])
  const [appearanceRating, setAppearanceRating] = useState<number>(0)
  const [bodyRating, setBodyRating] = useState<number>(0)
  const [bio, setBio] = useState('')
  
  // 搜索相关状态
  const [searchResults, setSearchResults] = useState<Creator[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchInputValue, setSearchInputValue] = useState('')
  // 标记是否刚刚从下拉选中，避免选中后再次触发搜索
  const justSelectedRef = React.useRef(false)

  // 初始化模式和数据
  useEffect(() => {
    if (open) {
      if (existingCreator) {
        setMode('view')
        setPrimaryName(existingCreator.primaryName)
        setOtherNames(existingCreator.otherNames || [])
        setAppearanceRating(existingCreator.appearanceRating || 0)
        setBodyRating(existingCreator.bodyRating || 0)
        setBio(existingCreator.bio || '')
      } else {
        setMode('create')
        resetForm()
      }
    }
  }, [open, existingCreator])

  const resetForm = () => {
    setCreatorId(undefined)
    setPrimaryName('')
    setOtherNames([])
    setAppearanceRating(0)
    setBodyRating(0)
    setBio('')
    setSearchInputValue('')
    setSearchResults([])
    setError('')
  }

  // 搜索博主（直接在 useEffect 中防抖）
  useEffect(() => {
    if (mode !== 'create' || !searchInputValue.trim()) {
      setSearchResults([])
      return
    }

    // 如果是刚刚选中触发的，跳过本次搜索
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const response = await fetch(`/api/creators/search?q=${encodeURIComponent(searchInputValue.trim())}`)
        const data = await response.json()
        if (data.success && data.data) {
          setSearchResults(data.data)
        } else {
          setSearchResults([])
        }
      } catch (error) {
        console.error('搜索博主失败:', error)
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [searchInputValue, mode])

  // 选中搜索结果后自动填充表单
  const handleSelectSearchResult = (creator: Creator | null) => {
    if (creator) {
      justSelectedRef.current = true  // 标记为选中，跳过下次搜索
      setCreatorId(creator.id)  // 记录已有博主的 id，保存时用于更新而非创建
      setPrimaryName(creator.primaryName)
      setOtherNames(creator.otherNames || [])
      setAppearanceRating(creator.appearanceRating || 0)
      setBodyRating(creator.bodyRating || 0)
      setBio(creator.bio || '')
      setSearchInputValue(creator.primaryName)
      setSearchResults([])
    }
  }

  const handleSave = async () => {
    if (!primaryName.trim()) {
      setError('请输入博主名称')
      return
    }

    setLoading(true)
    setError('')

    try {
      // 保存博主信息
      const response = await fetch('/api/creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: existingCreator?.id ?? creatorId,  // 优先用已有博主 id，其次用搜索选中的 id
          primaryName: primaryName.trim(),
          otherNames,
          appearanceRating: appearanceRating > 0 ? appearanceRating : undefined,
          bodyRating: bodyRating > 0 ? bodyRating : undefined,
          bio: bio.trim() || undefined
        })
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || '保存失败')
      }

      // 关联到当前文件
      await linkCreatorToFile(data.creator.id)

      onClose()
      if (onSuccess) {
        onSuccess()
      }
    } catch (error: any) {
      setError(error.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  // 标记"不认识"：将 creator_id 设为 UNKNOWN_CREATOR_ID，阻止路径匹配自动识别
  const markUnknown = async () => {
    setLoading(true)
    setError('')
    try {
      const isGroup = filePath.endsWith('/')
      let response: Response
      
      if (isGroup) {
        response = await fetch('/api/ratings/group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupPath: filePath, creatorId: UNKNOWN_CREATOR_ID })
        })
      } else {
        const fileName = filePath.split('/').pop() || ''
        const fileType = fileName.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i) ? 'image' : 'video'
        response = await fetch('/api/ratings/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, fileName, fileType, creatorId: UNKNOWN_CREATOR_ID })
        })
      }
      
      // 检查响应状态
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '标记失败')
      }
      
      const data = await response.json()
      if (!data.success) {
        throw new Error(data.error || '标记失败')
      }
      
      // 确保数据写入成功后再关闭对话框和触发回调
      onClose()
      if (onMarkUnknown) onMarkUnknown()
    } catch (err: any) {
      setError(err.message || '标记失败')
    } finally {
      setLoading(false)
    }
  }

  const linkCreatorToFile = async (creatorId: number) => {
    // 判断是单个文件还是图组
    const isGroup = filePath.endsWith('/')
    
    if (isGroup) {
      // 图组：只更新 creator_id，不传 isViewed 避免覆盖已有状态
      const response = await fetch('/api/ratings/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupPath: filePath,
          creatorId
        })
      })
      
      if (!response.ok) {
        throw new Error('关联图组失败')
      }
    } else {
      // 单个媒体：只更新 creator_id，不传 isViewed 避免覆盖已有状态
      const fileName = filePath.split('/').pop() || ''
      const fileType = fileName.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i) ? 'image' : 'video'
      
      const response = await fetch('/api/ratings/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          fileName,
          fileType,
          creatorId
        })
      })
      
      if (!response.ok) {
        throw new Error('关联媒体失败')
      }
    }
  }

  const renderViewMode = () => (
    <>
      <DialogContent>
        {/* 显示完整文件路径 */}
        <Box sx={{ mb: 2, p: 1, bgcolor: 'grey.100', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {filePath}
          </Typography>
        </Box>

        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              博主名称
            </Typography>
            <Typography variant="h6">{primaryName}</Typography>
          </Box>

          {otherNames.length > 0 && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                别名
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {otherNames.map((name, index) => (
                  <Chip key={index} label={name} size="small" variant="outlined" />
                ))}
              </Box>
            </Box>
          )}

          {appearanceRating > 0 && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                颜值评分
              </Typography>
              <Rating value={appearanceRating} readOnly size="small" />
            </Box>
          )}

          {bodyRating > 0 && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                身材评分
              </Typography>
              <Rating value={bodyRating} readOnly size="small" />
            </Box>
          )}

          {bio && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                简介
              </Typography>
              <Typography variant="body2">{bio}</Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button
          onClick={markUnknown}
          color="warning"
          disabled={loading}
        >
          不认识
        </Button>
        <Button onClick={() => setMode('edit')} variant="contained">
          编辑
        </Button>
      </DialogActions>
    </>
  )

  const renderEditMode = () => (
    <>
      <DialogContent>
        {/* 显示完整文件路径 */}
        <Box sx={{ mb: 2, p: 1, bgcolor: 'grey.100', borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {filePath}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={3}>
          {/* 主名称输入框 - 支持搜索 */}
          {mode === 'create' && !existingCreator ? (
            <Box sx={{ position: 'relative' }}>
              <TextField
                label="博主名称"
                required
                fullWidth
                value={searchInputValue}
                onChange={(e) => {
                  setSearchInputValue(e.target.value)
                  setPrimaryName(e.target.value)
                }}
                placeholder="输入博主名称搜索或创建新博主"
                InputProps={{
                  endAdornment: searchLoading ? <CircularProgress size={18} /> : null
                }}
                autoComplete="off"
              />
              {/* 手动渲染下拉列表 */}
              {searchResults.length > 0 && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 9999,
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    boxShadow: 3,
                    maxHeight: 300,
                    overflowY: 'auto',
                    mt: 0.5
                  }}
                >
                  {searchResults.map((creator) => (
                    <Box
                      key={creator.id}
                      onClick={() => handleSelectSearchResult(creator)}
                      sx={{
                        px: 2,
                        py: 1.5,
                        cursor: 'pointer',
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:last-child': { borderBottom: 'none' },
                        '&:hover': { bgcolor: 'action.hover' }
                      }}
                    >
                      <Typography variant="body1" fontWeight={500}>{creator.primaryName}</Typography>
                      {creator.otherNames && creator.otherNames.length > 0 && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          别名: {creator.otherNames.join(', ')}
                        </Typography>
                      )}
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        {(creator.appearanceRating ?? 0) > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            颜值: {creator.appearanceRating}⭐
                          </Typography>
                        )}
                        {(creator.bodyRating ?? 0) > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            身材: {creator.bodyRating}⭐
                          </Typography>
                        )}
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          ) : (
            <TextField
              label="博主名称"
              value={primaryName}
              onChange={(e) => setPrimaryName(e.target.value)}
              fullWidth
              required
              placeholder="输入博主的主要名称"
            />
          )}

          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={otherNames}
            onChange={(_, newValue) => {
              // 过滤掉空字符串,并去除首尾空格
              const filtered = newValue
                .map(v => typeof v === 'string' ? v.trim() : v)
                .filter(v => v !== '')
              setOtherNames(filtered)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="别名"
                placeholder="输入别名后按回车添加"
                inputProps={{
                  ...params.inputProps,
                  enterKeyHint: 'done'  // 移动端键盘显示"完成"而不是"下一步"
                }}
              />
            )}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => {
                const { key, ...tagProps } = getTagProps({ index })
                return (
                  <Chip
                    key={key}
                    variant="outlined"
                    label={option}
                    {...tagProps}
                  />
                )
              })
            }
          />

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              颜值评分
            </Typography>
            <Rating
              value={appearanceRating}
              onChange={(_, newValue) => setAppearanceRating(newValue || 0)}
              size="large"
              icon={<Star fontSize="inherit" />}
              emptyIcon={<StarBorder fontSize="inherit" />}
            />
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              身材评分
            </Typography>
            <Rating
              value={bodyRating}
              onChange={(_, newValue) => setBodyRating(newValue || 0)}
              size="large"
              icon={<Star fontSize="inherit" />}
              emptyIcon={<StarBorder fontSize="inherit" />}
            />
          </Box>

          <TextField
            label="简介"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            multiline
            rows={3}
            fullWidth
            placeholder="添加关于这位博主的描述"
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={() => existingCreator ? setMode('view') : onClose()} disabled={loading}>
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
    </>
  )

  const getTitle = () => {
    if (mode === 'view') return '博主信息'
    if (mode === 'edit') return '编辑博主'
    return '创建博主'
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      keepMounted
      transitionDuration={150}
      container={container || undefined}
      slotProps={{
        backdrop: {
          sx: { zIndex: 2099 }
        }
      }}
      PaperProps={{
        sx: { zIndex: 2100 }
      }}
      sx={{
        zIndex: 2100,
        '& .MuiDialog-container': {
          zIndex: 2100
        }
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">{getTitle()}</Typography>
        </Box>
      </DialogTitle>

      {mode === 'view' && renderViewMode()}
      {(mode === 'create' || mode === 'edit') && renderEditMode()}
    </Dialog>
  )
}
