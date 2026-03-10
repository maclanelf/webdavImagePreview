import { Box, Typography, Chip, Button, ToggleButtonGroup, ToggleButton, TextField } from '@mui/material'
import { FilterList as FilterListIcon, Star as StarIcon, Close as CloseIcon } from '@mui/icons-material'
import type { AdvancedFilters } from '@/types'

interface AdvancedFilterSectionProps {
  advancedFilters: AdvancedFilters
  onAdvancedFiltersChange: (filters: AdvancedFilters) => void
  availableEvaluations: string[]
  availableCategories: string[]
}

export default function AdvancedFilterSection({
  advancedFilters,
  onAdvancedFiltersChange,
  availableEvaluations,
  availableCategories,
}: AdvancedFilterSectionProps) {
  const hasActiveFilters =
    advancedFilters.ratings.length > 0 ||
    advancedFilters.evaluations.length > 0 ||
    advancedFilters.categories.length > 0 ||
    advancedFilters.ratingEmptyFilter !== undefined ||
    advancedFilters.evaluationEmptyFilter !== undefined ||
    advancedFilters.categoryEmptyFilter !== undefined ||
    advancedFilters.reasonFilter !== 'all'

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <FilterListIcon color="primary" />
        <Typography variant="subtitle1" fontWeight="medium">
          高级过滤
        </Typography>
      </Box>

      {/* 评分星星过滤 */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          评分星星
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5].map((rating) => (
            <Chip
              key={rating}
              label={`${rating}星`}
              icon={<StarIcon />}
              onClick={() => {
                onAdvancedFiltersChange({
                  ...advancedFilters,
                  ratings: advancedFilters.ratings.includes(rating)
                    ? advancedFilters.ratings.filter((r) => r !== rating)
                    : [...advancedFilters.ratings, rating],
                })
              }}
              color={advancedFilters.ratings.includes(rating) ? 'primary' : 'default'}
              variant={advancedFilters.ratings.includes(rating) ? 'filled' : 'outlined'}
              size="small"
            />
          ))}
          <Chip
            label="为空"
            onClick={() => {
              onAdvancedFiltersChange({
                ...advancedFilters,
                ratingEmptyFilter: advancedFilters.ratingEmptyFilter === true ? undefined : true,
              })
            }}
            color={advancedFilters.ratingEmptyFilter === true ? 'primary' : 'default'}
            variant={advancedFilters.ratingEmptyFilter === true ? 'filled' : 'outlined'}
            size="small"
          />
          <Chip
            label="不为空"
            onClick={() => {
              onAdvancedFiltersChange({
                ...advancedFilters,
                ratingEmptyFilter: advancedFilters.ratingEmptyFilter === false ? undefined : false,
              })
            }}
            color={advancedFilters.ratingEmptyFilter === false ? 'primary' : 'default'}
            variant={advancedFilters.ratingEmptyFilter === false ? 'filled' : 'outlined'}
            size="small"
          />
        </Box>
        {(advancedFilters.ratings.length > 0 || advancedFilters.ratingEmptyFilter !== undefined) && (
          <Button
            size="small"
            onClick={() =>
              onAdvancedFiltersChange({ ...advancedFilters, ratings: [], ratingEmptyFilter: undefined })
            }
            sx={{ mt: 0.5 }}
          >
            清除
          </Button>
        )}
      </Box>

      {/* 评价标签过滤 */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          评价标签
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {availableEvaluations.map((evaluation) => (
            <Chip
              key={evaluation}
              label={evaluation}
              onClick={() => {
                onAdvancedFiltersChange({
                  ...advancedFilters,
                  evaluations: advancedFilters.evaluations.includes(evaluation)
                    ? advancedFilters.evaluations.filter((e) => e !== evaluation)
                    : [...advancedFilters.evaluations, evaluation],
                })
              }}
              color={advancedFilters.evaluations.includes(evaluation) ? 'secondary' : 'default'}
              variant={advancedFilters.evaluations.includes(evaluation) ? 'filled' : 'outlined'}
              size="small"
            />
          ))}
          <Chip
            label="为空"
            onClick={() => {
              onAdvancedFiltersChange({
                ...advancedFilters,
                evaluationEmptyFilter: advancedFilters.evaluationEmptyFilter === true ? undefined : true,
              })
            }}
            color={advancedFilters.evaluationEmptyFilter === true ? 'secondary' : 'default'}
            variant={advancedFilters.evaluationEmptyFilter === true ? 'filled' : 'outlined'}
            size="small"
          />
          <Chip
            label="不为空"
            onClick={() => {
              onAdvancedFiltersChange({
                ...advancedFilters,
                evaluationEmptyFilter: advancedFilters.evaluationEmptyFilter === false ? undefined : false,
              })
            }}
            color={advancedFilters.evaluationEmptyFilter === false ? 'secondary' : 'default'}
            variant={advancedFilters.evaluationEmptyFilter === false ? 'filled' : 'outlined'}
            size="small"
          />
        </Box>
        {availableEvaluations.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            暂无评价标签
          </Typography>
        )}
        {(advancedFilters.evaluations.length > 0 || advancedFilters.evaluationEmptyFilter !== undefined) && (
          <Button
            size="small"
            onClick={() =>
              onAdvancedFiltersChange({ ...advancedFilters, evaluations: [], evaluationEmptyFilter: undefined })
            }
            sx={{ mt: 0.5 }}
          >
            清除
          </Button>
        )}
      </Box>

      {/* 分类标签过滤 */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          分类标签
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {availableCategories.map((category) => (
            <Chip
              key={category}
              label={category}
              onClick={() => {
                onAdvancedFiltersChange({
                  ...advancedFilters,
                  categories: advancedFilters.categories.includes(category)
                    ? advancedFilters.categories.filter((c) => c !== category)
                    : [...advancedFilters.categories, category],
                })
              }}
              color={advancedFilters.categories.includes(category) ? 'success' : 'default'}
              variant={advancedFilters.categories.includes(category) ? 'filled' : 'outlined'}
              size="small"
            />
          ))}
          <Chip
            label="为空"
            onClick={() => {
              onAdvancedFiltersChange({
                ...advancedFilters,
                categoryEmptyFilter: advancedFilters.categoryEmptyFilter === true ? undefined : true,
              })
            }}
            color={advancedFilters.categoryEmptyFilter === true ? 'success' : 'default'}
            variant={advancedFilters.categoryEmptyFilter === true ? 'filled' : 'outlined'}
            size="small"
          />
          <Chip
            label="不为空"
            onClick={() => {
              onAdvancedFiltersChange({
                ...advancedFilters,
                categoryEmptyFilter: advancedFilters.categoryEmptyFilter === false ? undefined : false,
              })
            }}
            color={advancedFilters.categoryEmptyFilter === false ? 'success' : 'default'}
            variant={advancedFilters.categoryEmptyFilter === false ? 'filled' : 'outlined'}
            size="small"
          />
        </Box>
        {availableCategories.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            暂无分类标签
          </Typography>
        )}
        {(advancedFilters.categories.length > 0 || advancedFilters.categoryEmptyFilter !== undefined) && (
          <Button
            size="small"
            onClick={() =>
              onAdvancedFiltersChange({ ...advancedFilters, categories: [], categoryEmptyFilter: undefined })
            }
            sx={{ mt: 0.5 }}
          >
            清除
          </Button>
        )}
      </Box>

      {/* 评价理由过滤 */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          评价理由
        </Typography>
        <ToggleButtonGroup
          value={advancedFilters.reasonFilter}
          exclusive
          onChange={(e, newValue) => {
            if (newValue) {
              onAdvancedFiltersChange({ ...advancedFilters, reasonFilter: newValue })
            }
          }}
          size="small"
          fullWidth
          sx={{ mb: 1 }}
        >
          <ToggleButton value="all">全部</ToggleButton>
          <ToggleButton value="empty">为空</ToggleButton>
          <ToggleButton value="nonempty">不为空</ToggleButton>
          <ToggleButton value="keyword">关键词</ToggleButton>
        </ToggleButtonGroup>
        {advancedFilters.reasonFilter === 'keyword' && (
          <TextField
            fullWidth
            size="small"
            placeholder="输入关键词"
            value={advancedFilters.reasonKeyword || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              onAdvancedFiltersChange({ ...advancedFilters, reasonKeyword: e.target.value })
            }}
          />
        )}
      </Box>

      {/* 清除所有过滤 */}
      {hasActiveFilters && (
        <Button
          variant="outlined"
          size="small"
          fullWidth
          onClick={() => {
            onAdvancedFiltersChange({
              ratings: [],
              evaluations: [],
              categories: [],
              reasonFilter: 'all',
              reasonKeyword: '',
              ratingEmptyFilter: undefined,
              evaluationEmptyFilter: undefined,
              categoryEmptyFilter: undefined,
            })
          }}
          startIcon={<CloseIcon />}
        >
          清除所有过滤
        </Button>
      )}
    </Box>
  )
}
