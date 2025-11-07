import { useState, useRef, useEffect } from 'react'

interface UseDraggableOptions {
  storageKey: string
  defaultPosition?: { x: number; y: number }
  onPositionChange?: (position: { x: number; y: number }) => void
}

interface UseDraggableReturn {
  position: { x: number; y: number } | null
  isDragging: boolean
  dragHandlers: {
    onMouseDown: (e: React.MouseEvent) => void
    onTouchStart: (e: React.TouchEvent) => void
  }
}

export function useDraggable(options: UseDraggableOptions): UseDraggableReturn {
  const { storageKey, defaultPosition, onPositionChange } = options
  
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  
  const dragStateRef = useRef<{
    isDragging: boolean
    startX: number
    startY: number
    elementX: number
    elementY: number
    lastPosition: { x: number; y: number } | null
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    elementX: 0,
    elementY: 0,
    lastPosition: null
  })

  // 从 localStorage 加载位置
  useEffect(() => {
    try {
      const savedPosition = localStorage.getItem(`draggable_${storageKey}_position`)
      if (savedPosition) {
        const parsed = JSON.parse(savedPosition)
        setPosition(parsed)
      } else if (defaultPosition) {
        setPosition(defaultPosition)
      }
    } catch (error) {
      console.error(`加载可拖动组件位置失败 (${storageKey}):`, error)
    }
  }, [storageKey, defaultPosition])

  // 保存位置到 localStorage
  const savePosition = (pos: { x: number; y: number }) => {
    try {
      localStorage.setItem(`draggable_${storageKey}_position`, JSON.stringify(pos))
    } catch (error) {
      console.error(`保存位置失败 (${storageKey}):`, error)
    }
  }

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    const isMouseEvent = e.type === 'mousedown'
    const isTouchEvent = e.type === 'touchstart'
    const element = e.currentTarget as HTMLElement
    
    let longPressTimer: NodeJS.Timeout | null = null
    let startX = 0
    let startY = 0
    let isLongPressActivated = false
    
    const preventDefault = (event: Event) => {
      event.preventDefault()
    }
    
    const handleStart = (clientX: number, clientY: number) => {
      isLongPressActivated = true
      
      // 防止默认行为（如文本选择、链接跳转等）
      if (isMouseEvent) {
        document.addEventListener('selectstart', preventDefault, { once: true })
      }
      
      const currentPosition = position
      
      // 如果没有保存的位置，计算默认位置
      let elementX = currentPosition?.x || 0
      let elementY = currentPosition?.y || 0
      
      if (!currentPosition && element) {
        // 计算当前元素的位置
        const rect = element.getBoundingClientRect()
        elementX = rect.left
        elementY = rect.top
      }
      
      dragStateRef.current = {
        isDragging: true,
        startX: clientX,
        startY: clientY,
        elementX,
        elementY,
        lastPosition: null
      }
      
      setIsDragging(true)
      
      // 添加拖动样式
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      
      // 直接在这里添加事件监听器
      const handleMove = (moveClientX: number, moveClientY: number) => {
        if (!dragStateRef.current.isDragging) return
        
        const { startX, startY, elementX, elementY } = dragStateRef.current
        const deltaX = moveClientX - startX
        const deltaY = moveClientY - startY
        
        const newPosition = {
          x: elementX + deltaX,
          y: elementY + deltaY
        }
        
        // 限制在视口内
        const maxX = window.innerWidth - 50
        const maxY = window.innerHeight - 50
        newPosition.x = Math.max(0, Math.min(maxX, newPosition.x))
        newPosition.y = Math.max(0, Math.min(maxY, newPosition.y))
        
        // 更新位置状态
        setPosition(newPosition)
        dragStateRef.current.lastPosition = newPosition
        
        // 调用回调
        if (onPositionChange) {
          onPositionChange(newPosition)
        }
      }
      
      const handleMouseMove = (e: MouseEvent) => {
        e.preventDefault()
        handleMove(e.clientX, e.clientY)
      }
      
      const handleTouchMove = (e: TouchEvent) => {
        e.preventDefault()
        if (e.touches.length > 0) {
          handleMove(e.touches[0].clientX, e.touches[0].clientY)
        }
      }
      
      const handleEnd = () => {
        if (dragStateRef.current.isDragging) {
          const { lastPosition } = dragStateRef.current
          
          // 保存位置
          if (lastPosition) {
            savePosition(lastPosition)
          }
          
          dragStateRef.current.isDragging = false
          dragStateRef.current.lastPosition = null
          setIsDragging(false)
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
          
          // 移除事件监听器
          document.removeEventListener('mousemove', handleMouseMove)
          document.removeEventListener('touchmove', handleTouchMove)
        }
      }
      
      // 添加事件监听器
      document.addEventListener('mousemove', handleMouseMove, { passive: false })
      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('mouseup', handleEnd, { once: true })
      document.addEventListener('touchend', handleEnd, { once: true })
      document.addEventListener('touchcancel', handleEnd, { once: true })
    }
    
    const cleanup = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }
    
    if (isMouseEvent) {
      const mouseEvent = e as React.MouseEvent
      if (mouseEvent.button !== 0) return // 只处理左键
      
      startX = mouseEvent.clientX
      startY = mouseEvent.clientY
      
      longPressTimer = setTimeout(() => {
        if (!isLongPressActivated) {
          handleStart(startX, startY)
        }
        cleanup()
      }, 300)
      
      const handleMouseUp = () => {
        cleanup()
        if (!isLongPressActivated) {
          document.removeEventListener('mouseup', handleMouseUp)
          document.removeEventListener('mousemove', handleMouseMove)
        }
      }
      
      const handleMouseMove = (moveEvent: MouseEvent) => {
        // 只有在长按激活前才检查移动距离
        if (!isLongPressActivated) {
          const moveDistance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY)
          if (moveDistance > 10) {
            // 移动距离超过10px，取消长按检测
            cleanup()
            document.removeEventListener('mouseup', handleMouseUp)
            document.removeEventListener('mousemove', handleMouseMove)
          }
        }
      }
      
      document.addEventListener('mouseup', handleMouseUp, { once: true })
      document.addEventListener('mousemove', handleMouseMove)
    } else if (isTouchEvent) {
      const touchEvent = e as React.TouchEvent
      const touch = touchEvent.touches[0]
      if (!touch) return
      
      startX = touch.clientX
      startY = touch.clientY
      
      longPressTimer = setTimeout(() => {
        if (!isLongPressActivated) {
          handleStart(startX, startY)
        }
        cleanup()
      }, 300)
      
      const handleTouchEnd = () => {
        cleanup()
        if (!isLongPressActivated) {
          document.removeEventListener('touchend', handleTouchEnd)
          document.removeEventListener('touchcancel', handleTouchEnd)
          document.removeEventListener('touchmove', handleTouchMove)
        }
      }
      
      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (!isLongPressActivated && moveEvent.touches.length > 0) {
          const moveTouch = moveEvent.touches[0]
          const moveDistance = Math.abs(moveTouch.clientX - startX) + Math.abs(moveTouch.clientY - startY)
          if (moveDistance > 10) {
            // 移动距离超过10px，取消长按检测
            cleanup()
            document.removeEventListener('touchend', handleTouchEnd)
            document.removeEventListener('touchcancel', handleTouchEnd)
            document.removeEventListener('touchmove', handleTouchMove)
          }
        }
      }
      
      document.addEventListener('touchend', handleTouchEnd, { once: true })
      document.addEventListener('touchcancel', handleTouchEnd, { once: true })
      document.addEventListener('touchmove', handleTouchMove)
    }
  }

  return {
    position,
    isDragging,
    dragHandlers: {
      onMouseDown: (e: React.MouseEvent) => {
        e.stopPropagation()
        handleDragStart(e)
      },
      onTouchStart: (e: React.TouchEvent) => {
        e.stopPropagation()
        handleDragStart(e)
      }
    }
  }
}

