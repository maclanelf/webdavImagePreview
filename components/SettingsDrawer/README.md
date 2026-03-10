# SettingsDrawer 组件使用说明

## 概述

SettingsDrawer 是一个模块化的抽屉组件，用于管理应用的各种设置和筛选条件。它将原本 800+ 行的抽屉代码拆分成了 8 个独立的 Section 组件。

## 组件结构

```
components/SettingsDrawer/
├── index.tsx                    # 主抽屉容器
├── ViewModeSection.tsx          # 浏览模式选择（随机/图组/大视频）
├── RatingSection.tsx            # 评分管理和快捷键说明
├── PreloadSection.tsx           # 预加载设置
├── ViewedFilterSection.tsx      # 已看过筛选
├── AdvancedFilterSection.tsx    # 高级过滤（仅已看过模式）
├── MediaTypeSection.tsx         # 媒体类型筛选
├── StatsSection.tsx             # 统计信息展示
├── DirectorySection.tsx         # 已挂载目录
└── README.md                    # 本文件
```

## 在 app/page.tsx 中使用

### 1. 导入组件和类型

```typescript
import SettingsDrawer from '@/components/SettingsDrawer'
import type { WebDAVConfig, MediaFilter, ViewMode, ViewedFilter, AdvancedFilters, MediaFile } from '@/types'
```

### 2. 创建处理函数

在 app/page.tsx 中添加以下处理函数：

```typescript
// 浏览模式变化处理
const handleViewModeChange = (newMode: ViewMode) => {
  setViewMode(newMode)
  localStorage.setItem('view_mode', newMode)
  
  // 所有模式切换都先取消前一模式的预加载任务
  if (preloadEnabled) {
    console.log(`[模式切换] ${viewMode} → ${newMode}：取消预加载并清空缓存`)
    databasePreloadManager.cancelAllPreloads()
    databasePreloadManager.clearCache()
    databasePreloadManager.clearNextGroupCache()
    const cacheStatus = databasePreloadManager.getCacheStatus()
    setPreloadStatus(cacheStatus)
  }
  
  // 切换到图组模式时，清空当前组
  if (newMode === 'gallery') {
    setCurrentGroup([])
    setCurrentGroupIndex(0)
    setGalleryPreloadReady(false)
    setCachePreloadProgress(null)
  } else if (newMode === 'random') {
    setGalleryPreloadReady(true)
    setCachePreloadProgress(null)
  } else if (newMode === 'large-video') {
    setGalleryPreloadReady(true)
    setCachePreloadProgress(null)
  }
}

// 预加载设置变化处理
const handlePreloadEnabledChange = (enabled: boolean) => {
  setPreloadEnabled(enabled)
}

const handleOptimisticUpdateEnabledChange = (enabled: boolean) => {
  setOptimisticUpdateEnabled(enabled)
  localStorage.setItem('optimistic_update_enabled', enabled.toString())
}

const handleErudaEnabledChange = (enabled: boolean) => {
  setErudaEnabledState(enabled)
  setErudaEnabled(enabled)
  setSnackbarMessage(enabled ? 'Eruda 已启用，请刷新页面生效' : 'Eruda 已禁用，请刷新页面生效')
  setSnackbarSeverity('info')
  setSnackbarOpen(true)
}

const handlePreloadRandomnessChange = (value: number) => {
  setPreloadRandomness(value)
  localStorage.setItem('preload_randomness', value.toString())
}

const handleClearCache = () => {
  databasePreloadManager.clearCache()
  setPreloadStatus(databasePreloadManager.getCacheStatus())
  setSnackbarMessage('缓存已清理')
  setSnackbarSeverity('info')
  setSnackbarOpen(true)
}

const handleResetButtonPositions = () => {
  const storageKeys = [
    'fullscreen_rating',
    'fullscreen_shuffle',
    'fullscreen_rating_stream',
    'fullscreen_shuffle_stream',
    'normal_shuffle'
  ]
  
  storageKeys.forEach(key => {
    localStorage.removeItem(`draggable_${key}_position`)
  })
  
  setSnackbarMessage('按钮位置已复位，刷新页面生效')
  setSnackbarSeverity('success')
  setSnackbarOpen(true)
  
  setTimeout(() => {
    window.location.reload()
  }, 1000)
}

// 已看过筛选变化处理
const handleViewedFilterChange = (newFilter: ViewedFilter) => {
  setViewedFilter(newFilter)
  localStorage.setItem('viewed_filter', newFilter)
  
  if (newFilter === 'viewed') {
    databasePreloadManager.clearLocalViewedFiles()
  }
  
  if (currentFile) {
    const isViewed = currentRating?.isViewed || false
    if ((newFilter === 'viewed' && !isViewed) || (newFilter === 'unviewed' && isViewed)) {
      setCurrentFile(null)
      setMediaUrl(null)
    }
  }
}

const handleRestartViewedMode = () => {
  databasePreloadManager.clearLocalViewedFiles()
  setSnackbarMessage('已清除本地观看记录，可以重新观看')
  setSnackbarSeverity('success')
  setSnackbarOpen(true)
}

// 媒体类型筛选变化处理
const handleMediaFilterChange = (newFilter: MediaFilter) => {
  setMediaFilter(newFilter)
  localStorage.setItem('media_filter', newFilter)
  
  if (currentFile) {
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff|tif|svg|ico)$/i.test(currentFile.basename)
    const isVideo = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|3gp|ogv|ts|mts|m2ts)$/i.test(currentFile.basename)
    
    if ((newFilter === 'images' && !isImage) || (newFilter === 'videos' && !isVideo)) {
      setCurrentFile(null)
      setMediaUrl(null)
    }
  }
}
```

### 3. 替换原有的 Drawer 组件

将原来的 `<Drawer>...</Drawer>` 替换为：

```typescript
<SettingsDrawer
  open={drawerOpen}
  onClose={toggleDrawer(false)}
  // 浏览模式相关
  viewMode={viewMode}
  onViewModeChange={handleViewModeChange}
  currentGroup={currentGroup}
  currentGroupIndex={currentGroupIndex}
  currentFile={currentFile}
  // 评分相关
  onOpenRatingDialog={openRatingDialog}
  // 预加载相关
  preloadEnabled={preloadEnabled}
  onPreloadEnabledChange={handlePreloadEnabledChange}
  optimisticUpdateEnabled={optimisticUpdateEnabled}
  onOptimisticUpdateEnabledChange={handleOptimisticUpdateEnabledChange}
  erudaEnabled={erudaEnabled}
  onErudaEnabledChange={handleErudaEnabledChange}
  preloadRandomness={preloadRandomness}
  onPreloadRandomnessChange={handlePreloadRandomnessChange}
  preloadStatus={preloadStatus}
  onClearCache={handleClearCache}
  onResetButtonPositions={handleResetButtonPositions}
  // 已看过筛选相关
  viewedFilter={viewedFilter}
  onViewedFilterChange={handleViewedFilterChange}
  stats={stats}
  localViewedCount={databasePreloadManager.getLocalViewedCount()}
  onRestartViewedMode={handleRestartViewedMode}
  // 高级过滤相关
  advancedFilters={advancedFilters}
  onAdvancedFiltersChange={setAdvancedFilters}
  availableEvaluations={availableEvaluations}
  availableCategories={availableCategories}
  // 媒体类型筛选相关
  mediaFilter={mediaFilter}
  onMediaFilterChange={handleMediaFilterChange}
  // 配置相关
  config={config}
  loading={loading}
  isSwitching={isSwitching}
  onNavigateToManage={() => router.push('/manage')}
/>
```

## 优势

1. **模块化**：每个 Section 职责单一，易于维护
2. **可复用**：各个 Section 可以独立使用
3. **类型安全**：使用 TypeScript 类型定义，避免错误
4. **性能优化**：可以针对不变的 Section 使用 React.memo
5. **代码组织**：主文件从 5332 行减少到约 4500 行

## 注意事项

1. 确保 `types/index.ts` 文件已创建并导出所有必要的类型
2. 所有处理函数需要在主页面中定义
3. `toggleDrawer` 函数保持不变，仍然处理配置变化时的预加载逻辑
