'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Box, Typography, keyframes } from '@mui/material'
import { TouchApp as TouchAppIcon, ChevronRight as ChevronRightIcon } from '@mui/icons-material'

const breatheAnimation = keyframes`
  0%, 100% {
    transform: scale(1);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.75;
  }
`

interface CreatorTagProps {
  filePath: string
  onTagClick: () => void
  onCreatorIdentified?: (creator: any | null) => void
  position?: { top?: string; bottom?: string; left?: string; right?: string }
  visible?: boolean // 外部控制显示/隐藏
  refreshKey?: number // 用于强制刷新识别
}

export default function CreatorTag({ 
  filePath, 
  onTagClick, 
  onCreatorIdentified, 
  position,
  visible = true,
  refreshKey = 0
}: CreatorTagProps) {
  const [creatorName, setCreatorName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [calculatedPosition, setCalculatedPosition] = useState<{ top: string; left: string } | null>(null)
  
  const identifyingKeyRef = useRef<string | null>(null) // 改为存储 filePath + refreshKey 的组合
  const abortControllerRef = useRef<AbortController | null>(null)

  // 生成随机位置（更保守的策略，确保不会溢出和出现在黑边）
  const generateRandomPosition = () => {
    // 更保守的边距设置
    // 考虑到全屏模式下可能有较大的黑边（特别是纵向图片）
    const minLeftMargin = 20   // 左侧最小20%（避开黑边）
    const minTopMargin = 25    // 顶部最小25%（避开黑边+不太靠上）
    
    
    
    // 计算安全区域
    // 水平：20%-55% 范围（更保守，确保标签+边距不超过85%）
    const horizontalRange = 35  // 55% - 20% = 35%
    const randomLeft = minLeftMargin + Math.random() * horizontalRange
    
    // 垂直：25%-45% 范围，使用平方根函数让分布更集中在上方
    // 25%起始确保不会在黑边区域，45%结束确保在中上区域
    const verticalRange = 20  // 45% - 25% = 20%
    const randomTop = minTopMargin + Math.sqrt(Math.random()) * verticalRange
    
    return {
      left: `${randomLeft}%`,
      top: `${randomTop}%`
    }
  }

  useEffect(() => {
    const identifyKey = `${filePath}:${refreshKey}`
    
    // 如果正在识别相同的文件+key，跳过
    if (identifyingKeyRef.current === identifyKey) {
      return
    }
    
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    // 创建新的 AbortController
    const abortController = new AbortController()
    abortControllerRef.current = abortController
    identifyingKeyRef.current = identifyKey
    
    // 调用识别 API
    const identifyCreator = async () => {
      try {
        const response = await fetch('/api/creators/identify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath }),
          signal: abortController.signal
        })
        
        const data = await response.json()
        
        // 检查请求是否已被取消
        if (abortController.signal.aborted) {
          return
        }
        
        if (data.success && data.identified && data.creator) {
          setCreatorName(data.creator.primaryName)
          if (onCreatorIdentified) onCreatorIdentified(data.creator)
        } else {
          setCreatorName(null)
          if (onCreatorIdentified) onCreatorIdentified(null)
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error('[CreatorTag] 识别博主失败:', error)
          setCreatorName(null)
        }
      } finally {
        // 无论请求是否被取消，都要设置 loading 为 false
        setLoading(false)
        identifyingKeyRef.current = null
      }
    }
    
    identifyCreator()
    
    // 清理函数：取消请求
    return () => {
      if (abortController) {
        abortController.abort()
      }
    }
  }, [filePath, refreshKey, onCreatorIdentified])

  // 计算随机位置
  useEffect(() => {
    if (!position) {
      setTimeout(() => {
        const pos = generateRandomPosition()
        setCalculatedPosition(pos)
      }, 100)
    }
  }, [position, filePath])

  if (loading) {
    return null
  }

  if (!visible) {
    return null
  }

  // 优先级：手动指定位置 > 计算的随机位置 > 默认位置
  const finalPosition = position || calculatedPosition || { top: '15%', left: '15%' }

  return (
    <Box
      onClick={onTagClick}
      sx={{
        position: 'absolute',
        ...finalPosition,
        display: 'flex',
        alignItems: 'center',
        gap: 0.4,
        cursor: 'pointer',
        zIndex: 1000,
        userSelect: 'none',
        opacity: 0.6, // 降低整体透明度
        transition: 'opacity 0.3s ease',
        '&:hover': {
          opacity: 1, // 悬停时完全不透明
          '& .creator-tag-text': {
            backgroundColor: 'rgba(0, 0, 0, 0.85)'
          }
        }
      }}
    >
      {/* 呼吸动画的圆点 */}
      <Box
        sx={{
          position: 'relative',
          width: 12,
          height: 12,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* 外圈呼吸动画 */}
        <Box
          sx={{
            position: 'absolute',
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '1.5px solid rgba(255, 255, 255, 0.9)',
            animation: `${breatheAnimation} 2s ease-in-out infinite`
          }}
        />
        {/* 内圈实心圆点 */}
        <Box
          sx={{
            position: 'absolute',
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: '#fff',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)'
          }}
        />
      </Box>

      {/* 文字标签 */}
      <Box
        className="creator-tag-text"
        sx={{
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          color: '#fff',
          padding: '2px 8px',
          borderRadius: '14px',
          fontSize: '11px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          transition: 'background-color 0.2s ease',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
          lineHeight: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          maxWidth: '200px', // 限制最大宽度，防止过长溢出
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {/* 左侧手势图标 */}
        <TouchAppIcon sx={{ fontSize: '13px', fontWeight: 700 }} />
        
        {/* 文字内容 */}
        <Typography variant="body2" sx={{ fontSize: '11px', fontWeight: 700 }}>
          {creatorName || '告诉我TA是谁'}
        </Typography>
        
        {/* 右侧箭头 */}
        <ChevronRightIcon sx={{ fontSize: '14px', fontWeight: 700 }} />
      </Box>
    </Box>
  )
}
