'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
  Switch,
  FormControlLabel,
  Divider,
  Alert,
} from '@mui/material'
import {
  Schedule as ScheduleIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material'

interface ScheduledScanDialogProps {
  open: boolean
  onClose: () => void
  onSave: (data: any) => void
  initialData?: any
  config: any
}

const cronPresets = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每2小时', value: '0 */2 * * *' },
  { label: '每6小时', value: '0 */6 * * *' },
  { label: '每12小时', value: '0 */12 * * *' },
  { label: '每天凌晨2点', value: '0 2 * * *' },
  { label: '每天凌晨3点', value: '0 3 * * *' },
  { label: '每天凌晨4点', value: '0 4 * * *' },
  { label: '每周日凌晨2点', value: '0 2 * * 0' },
  { label: '每月1号凌晨2点', value: '0 2 1 * *' },
]

export default function ScheduledScanDialog({
  open,
  onClose,
  onSave,
  initialData,
  config
}: ScheduledScanDialogProps) {
  const [formData, setFormData] = useState({
    mediaPaths: [] as string[],
    scanSettings: {
      maxDepth: 10,
      maxFiles: 200000,
      timeout: 60000
    },
    cronExpression: '0 */2 * * *', // 默认每2小时
    isActive: true
  })
  const [nextRuns, setNextRuns] = useState<string[]>([])

  // 安全解析JSON的辅助函数
  const safeJsonParse = (jsonString: string | null | undefined, fallback: any = null) => {
    if (!jsonString) return fallback
    try {
      return JSON.parse(jsonString)
    } catch (error) {
      console.error('JSON解析失败:', error, jsonString)
      return fallback
    }
  }

  useEffect(() => {
    if (initialData) {
      setFormData({
        mediaPaths: safeJsonParse(initialData.media_paths, []),
        scanSettings: safeJsonParse(initialData.scan_settings, {
          maxDepth: 10,
          maxFiles: 200000,
          timeout: 60000
        }),
        cronExpression: initialData.cron_expression || '0 */2 * * *',
        isActive: initialData.is_active === 1
      })
      // 计算初始的cron表达式
      calculateNextRuns(initialData.cron_expression || '0 */2 * * *')
    } else {
      // 使用当前配置作为默认值
      setFormData({
        mediaPaths: config?.mediaPaths || [],
        scanSettings: config?.scanSettings || {
          maxDepth: 10,
          maxFiles: 200000,
          timeout: 60000
        },
        cronExpression: '0 */2 * * *',
        isActive: true
      })
      // 计算默认的cron表达式
      calculateNextRuns('0 */2 * * *')
    }
  }, [initialData, config, open])

  const handleChange = (field: string) => (event: any) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    
    // 如果修改的是cron表达式，重新计算下次运行时间
    if (field === 'cronExpression') {
      calculateNextRuns(value)
    }
  }

  // 计算下次运行时间
  const calculateNextRuns = (cronExpression: string) => {
    try {
      const parts = cronExpression.split(' ')
      if (parts.length !== 5) {
        setNextRuns([])
        return
      }
      
      const [minute, hour, day, month, weekday] = parts
      const now = new Date()
      const runs: string[] = []
      
      // 计算接下来5次执行时间
      for (let i = 0; i < 5; i++) {
        let nextRun = new Date(now)
        
        // 处理分钟
        if (minute !== '*') {
          if (minute.includes('/')) {
            // 处理 */15 格式
            const [, interval] = minute.split('/')
            const intervalNum = parseInt(interval) || 1
            const currentMinute = now.getMinutes()
            const nextMinute = Math.ceil((currentMinute + 1) / intervalNum) * intervalNum
            
            if (nextMinute >= 60) {
              nextRun.setHours(nextRun.getHours() + 1)
              nextRun.setMinutes(nextMinute % 60, 0, 0)
            } else {
              nextRun.setMinutes(nextMinute, 0, 0)
            }
          } else {
            // 处理具体分钟
            const targetMinute = parseInt(minute)
            if (!isNaN(targetMinute) && targetMinute >= 0 && targetMinute <= 59) {
              nextRun.setMinutes(targetMinute, 0, 0)
            } else {
              nextRun.setMinutes(0, 0, 0)
            }
          }
        } else {
          nextRun.setMinutes(0, 0, 0)
        }
        
        // 处理小时
        if (hour !== '*') {
          if (hour.includes('/')) {
            // 处理 */2 格式
            const [, interval] = hour.split('/')
            const intervalNum = parseInt(interval) || 1
            const currentHour = now.getHours()
            const nextHour = Math.ceil((currentHour + 1) / intervalNum) * intervalNum
            
            if (nextHour >= 24) {
              nextRun.setDate(nextRun.getDate() + 1)
              nextRun.setHours(nextHour % 24)
            } else {
              nextRun.setHours(nextHour)
            }
          } else {
            // 处理具体小时
            const targetHour = parseInt(hour)
            if (!isNaN(targetHour) && targetHour >= 0 && targetHour <= 23) {
              nextRun.setHours(targetHour)
            }
          }
        }
        
        // 如果时间已过，调整到下一个执行时间
        if (nextRun <= now) {
          if (hour === '*') {
            nextRun.setHours(nextRun.getHours() + 1)
          } else if (hour.includes('/')) {
            const [, interval] = hour.split('/')
            const intervalNum = parseInt(interval) || 1
            const currentHour = now.getHours()
            const nextHour = Math.ceil((currentHour + 1) / intervalNum) * intervalNum
            
            if (nextHour >= 24) {
              nextRun.setDate(nextRun.getDate() + 1)
              nextRun.setHours(nextHour % 24)
            } else {
              nextRun.setHours(nextHour)
            }
          } else {
            nextRun.setDate(nextRun.getDate() + 1)
          }
        }
        
        // 为下次计算更新now
        now.setTime(nextRun.getTime())
        
        // 格式化时间
        const timeStr = nextRun.toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
        
        runs.push(timeStr)
      }
      
      setNextRuns(runs)
    } catch (error) {
      console.error('计算下次运行时间失败:', error)
      setNextRuns([])
    }
  }

  const handleScanSettingsChange = (field: string) => (event: any) => {
    const value = parseInt(event.target.value) || 0
    setFormData(prev => ({
      ...prev,
      scanSettings: {
        ...prev.scanSettings,
        [field]: value
      }
    }))
  }

  const handleMediaPathsChange = (event: any) => {
    const value = event.target.value
    setFormData(prev => ({
      ...prev,
      mediaPaths: typeof value === 'string' ? value.split(',').map(p => p.trim()) : value
    }))
  }

  const handleSave = () => {
    if (formData.mediaPaths.length === 0) {
      alert('请至少选择一个媒体路径')
      return
    }

    onSave({
      webdavUrl: config?.url || '',
      webdavUsername: config?.username || '',
      webdavPassword: config?.password || '',
      mediaPaths: formData.mediaPaths,
      scanSettings: formData.scanSettings,
      cronExpression: formData.cronExpression,
      isActive: formData.isActive
    })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ScheduleIcon color="primary" />
          {initialData ? '编辑定时扫描任务' : '添加定时扫描任务'}
        </Box>
      </DialogTitle>
      
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            将使用系统配置页面中已设置的WebDAV连接信息
          </Typography>
        </Alert>
        
        <Stack spacing={3}>
          {/* 媒体路径 */}
          <Box>
            <Typography variant="h6" gutterBottom>
              媒体路径
            </Typography>
            <TextField
              label="媒体路径（用逗号分隔）"
              fullWidth
              multiline
              rows={3}
              value={formData.mediaPaths.join(', ')}
              onChange={handleMediaPathsChange}
              helperText="例如: /photos, /videos, /media"
              required
            />
          </Box>

          <Divider />

          {/* 扫描设置 */}
          <Box>
            <Typography variant="h6" gutterBottom>
              扫描设置
            </Typography>
            <Stack direction="row" spacing={2}>
              <TextField
                label="最大扫描深度"
                type="number"
                value={formData.scanSettings.maxDepth}
                onChange={handleScanSettingsChange('maxDepth')}
                inputProps={{ min: 1, max: 20 }}
                sx={{ flex: 1 }}
              />
              <TextField
                label="最大文件数量"
                type="number"
                value={formData.scanSettings.maxFiles}
                onChange={handleScanSettingsChange('maxFiles')}
                inputProps={{ min: 100, max: 500000 }}
                sx={{ flex: 1 }}
              />
              <TextField
                label="超时时间(秒)"
                type="number"
                value={Math.floor(formData.scanSettings.timeout / 1000)}
                onChange={(e) => handleScanSettingsChange('timeout')({
                  target: { value: (parseInt(e.target.value) || 60) * 1000 }
                })}
                inputProps={{ min: 10, max: 300 }}
                sx={{ flex: 1 }}
              />
            </Stack>
          </Box>

          <Divider />

          {/* 执行时间设置 */}
          <Box>
            <Typography variant="h6" gutterBottom>
              执行时间设置
            </Typography>
            <Stack spacing={2}>
              <FormControl fullWidth>
                <InputLabel>预设时间</InputLabel>
                <Select
                  value={formData.cronExpression}
                  onChange={handleChange('cronExpression')}
                  label="预设时间"
                >
                  {cronPresets.map((preset) => (
                    <MenuItem key={preset.value} value={preset.value}>
                      {preset.label} ({preset.value})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              
              <TextField
                label="自定义 Cron 表达式"
                fullWidth
                value={formData.cronExpression}
                onChange={handleChange('cronExpression')}
                helperText="格式: 分钟 小时 日 月 星期 (例如: 0 */2 * * * 表示每2小时)"
              />
              
              {/* 显示下次运行时间 */}
              {nextRuns.length > 0 && (
                <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    预计执行时间：
                  </Typography>
                  <Stack spacing={0.5}>
                    {nextRuns.map((time, index) => (
                      <Typography 
                        key={index} 
                        variant="body2" 
                        color={index === 0 ? 'primary.main' : 'text.secondary'}
                        sx={{ 
                          fontWeight: index === 0 ? 'bold' : 'normal',
                          fontFamily: 'monospace'
                        }}
                      >
                        {index + 1}. {time}
                        {index === 0 && ' (下次执行)'}
                      </Typography>
                    ))}
                  </Stack>
                </Box>
              )}
              
              <Alert severity="warning" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  <strong>注意：</strong>设置过于频繁的执行间隔（如每分钟）可能会：
                  <br/>• 消耗大量系统资源
                  <br/>• 对WebDAV服务器造成压力
                  <br/>• 影响应用性能
                  <br/>建议最小间隔不少于5分钟
                </Typography>
              </Alert>
            </Stack>
          </Box>

          <Divider />

          {/* 任务状态 */}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.isActive}
                  onChange={handleChange('isActive')}
                />
              }
              label="启用定时扫描任务"
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              任务将按照设定的cron表达式自动执行扫描
            </Typography>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button
          onClick={onClose}
          startIcon={<CancelIcon />}
        >
          取消
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          startIcon={<SaveIcon />}
        >
          {initialData ? '更新' : '创建'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
