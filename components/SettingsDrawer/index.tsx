import { Drawer, Box, Typography, IconButton, Divider } from '@mui/material'
import { Close as CloseIcon } from '@mui/icons-material'
import ViewModeSection from './ViewModeSection'
import RatingSection from './RatingSection'
import PreloadSection from './PreloadSection'
import ViewedFilterSection from './ViewedFilterSection'
import AdvancedFilterSection from './AdvancedFilterSection'
import MediaTypeSection from './MediaTypeSection'
import StatsSection from './StatsSection'
import DirectorySection from './DirectorySection'
import type { WebDAVConfig, MediaFilter, ViewMode, ViewedFilter, AdvancedFilters, MediaFile } from '@/types'

interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
  // 浏览模式相关
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  currentGroup: MediaFile[]
  currentGroupIndex: number
  currentFile: MediaFile | null
  // 评分相关
  onOpenRatingDialog: (type: 'media' | 'group') => void
  optimisticUpdateEnabled: boolean
  onOptimisticUpdateEnabledChange: (enabled: boolean) => void
  erudaEnabled: boolean
  onErudaEnabledChange: (enabled: boolean) => void
  preloadRandomness: number
  onPreloadRandomnessChange: (value: number) => void
  preloadStatus: { cacheSize: number; maxCacheSize: number } | null
  onClearCache: () => void
  onResetButtonPositions: () => void
  highlightContinuousPlayEnabled: boolean
  onHighlightContinuousPlayEnabledChange: (enabled: boolean) => void
  // 已看过筛选相关
  viewedFilter: ViewedFilter
  onViewedFilterChange: (filter: ViewedFilter) => void
  stats: { total: number; images: number; videos: number; viewed: number }
  localViewedCount: number
  onRestartViewedMode: () => void
  // 高级过滤相关
  advancedFilters: AdvancedFilters
  onAdvancedFiltersChange: (filters: AdvancedFilters) => void
  availableEvaluations: string[]
  availableCategories: string[]
  // 媒体类型筛选相关
  mediaFilter: MediaFilter
  onMediaFilterChange: (filter: MediaFilter) => void
  // 配置相关
  config: WebDAVConfig
  loading: boolean
  isSwitching?: boolean
  onNavigateToManage: () => void
}

export default function SettingsDrawer({
  open,
  onClose,
  viewMode,
  onViewModeChange,
  currentGroup,
  currentGroupIndex,
  currentFile,
  onOpenRatingDialog,
  optimisticUpdateEnabled,
  onOptimisticUpdateEnabledChange,
  erudaEnabled,
  onErudaEnabledChange,
  preloadRandomness,
  onPreloadRandomnessChange,
  preloadStatus,
  onClearCache,
  onResetButtonPositions,
  highlightContinuousPlayEnabled,
  onHighlightContinuousPlayEnabledChange,
  viewedFilter,
  onViewedFilterChange,
  stats,
  localViewedCount,
  onRestartViewedMode,
  advancedFilters,
  onAdvancedFiltersChange,
  availableEvaluations,
  availableCategories,
  mediaFilter,
  onMediaFilterChange,
  config,
  loading,
  isSwitching,
  onNavigateToManage,
}: SettingsDrawerProps) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{
        '& .MuiDrawer-paper': {
          width: 320,
          boxSizing: 'border-box',
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight="bold">
            筛选与统计
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {/* 浏览模式 */}
        <ViewModeSection
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          currentGroup={currentGroup}
          currentGroupIndex={currentGroupIndex}
          currentFile={currentFile}
        />

        <Divider sx={{ mb: 3 }} />

        {/* 评分功能 */}
        <RatingSection
          viewMode={viewMode}
          currentFile={currentFile}
          currentGroup={currentGroup}
          onOpenRatingDialog={onOpenRatingDialog}
        />

        <Divider sx={{ mb: 3 }} />

        {/* 预加载设置 */}
        <PreloadSection
          optimisticUpdateEnabled={optimisticUpdateEnabled}
          onOptimisticUpdateEnabledChange={onOptimisticUpdateEnabledChange}
          erudaEnabled={erudaEnabled}
          onErudaEnabledChange={onErudaEnabledChange}
          preloadRandomness={preloadRandomness}
          onPreloadRandomnessChange={onPreloadRandomnessChange}
          preloadStatus={preloadStatus}
          onClearCache={onClearCache}
          onResetButtonPositions={onResetButtonPositions}
          highlightContinuousPlayEnabled={highlightContinuousPlayEnabled}
          onHighlightContinuousPlayEnabledChange={onHighlightContinuousPlayEnabledChange}
        />

        <Divider sx={{ mb: 3 }} />

        {/* 已看过筛选 */}
        <ViewedFilterSection
          viewedFilter={viewedFilter}
          onViewedFilterChange={onViewedFilterChange}
          stats={stats}
          localViewedCount={localViewedCount}
          onRestartViewedMode={onRestartViewedMode}
        />

        <Divider sx={{ mb: 3 }} />

        {/* 高级过滤条件（仅已看过模式） */}
        {viewedFilter === 'viewed' && (
          <>
            <AdvancedFilterSection
              advancedFilters={advancedFilters}
              onAdvancedFiltersChange={onAdvancedFiltersChange}
              availableEvaluations={availableEvaluations}
              availableCategories={availableCategories}
            />
            <Divider sx={{ mb: 3 }} />
          </>
        )}

        {/* 媒体类型筛选 */}
        <MediaTypeSection
          mediaFilter={mediaFilter}
          onMediaFilterChange={onMediaFilterChange}
          stats={stats}
        />

        <Divider sx={{ mb: 3 }} />

        {/* 统计信息 */}
        <StatsSection stats={stats} />

        <Divider sx={{ mb: 3 }} />

        {/* 已挂载目录 */}
        <DirectorySection
          config={config}
          loading={loading}
          isSwitching={isSwitching}
          onNavigateToManage={onNavigateToManage}
        />
      </Box>
    </Drawer>
  )
}
