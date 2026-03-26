'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AppBar,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import {
  ArrowBack as ArrowBackIcon,
  AutoAwesome as AutoAwesomeIcon,
  Insights as InsightsIcon,
  MovieCreation as MovieCreationIcon,
  PersonSearch as PersonSearchIcon,
  Sell as SellIcon,
  ShowChart as ShowChartIcon,
  TrackChanges as RadarIcon,
} from '@mui/icons-material'
import { useRouter } from 'next/navigation'

type WeekItem = { day: string; total: number; images: number; videos: number }
type WeekTrend = {
  key: string
  label: string
  start: string
  end: string
  isCurrent: boolean
  total: number
  items: WeekItem[]
}

type DashboardData = {
  generatedAt: string
  summary: {
    totalViewed: number
    imagesViewed: number
    videosViewed: number
    groupsViewed: number
    activeDays30: number
    avgRating: number
    ratedCount: number
    avgDailyViews30: number
  }
  weeklyTrend: WeekTrend[]
  currentWeekKey: string
  monthlyTrend: Array<{ month: string; total: number; images: number; videos: number }>
  mediaTypeShare: Array<{ label: string; value: number }>
  ratingDistribution: Array<{ rating: number; count: number }>
  topCreators: Array<{ creatorId: number | null; creatorName: string; count: number; avgRating: number }>
  favoriteCreators: Array<{ creatorId: number | null; creatorName: string; count: number; avgRating: number }>
  topEvaluations: Array<{ name: string; value: number }>
  topCategories: Array<{ name: string; value: number }>
  hourlyActivity: Array<{ hour: string; count: number }>
  radarMetrics: Array<{ label: string; score: number }>
  coverage: {
    creatorCoverage: number
    evaluationCoverage: number
    categoryCoverage: number
    highScoreShare: number
  }
  chartMeta: {
    maxWeeklyDayViews: number
    maxMonthlyViews: number
  }
  insights: string[]
}

const panelSx = {
  p: 2.5,
  borderRadius: 4,
  border: '1px solid rgba(15, 23, 42, 0.08)',
  background: 'rgba(255,255,255,0.88)',
  backdropFilter: 'blur(10px)',
  boxShadow: '0 18px 60px rgba(15, 23, 42, 0.08)',
} as const

const chartColors = ['#0f766e', '#f97316', '#2563eb', '#dc2626', '#7c3aed', '#0891b2']

function formatPercent(value: number, total: number) {
  if (!total) return '0%'
  return `${Math.round((value / total) * 100)}%`
}

function formatDayLabel(day: string) {
  return day.slice(5).replace('-', '/')
}

function formatMonthLabel(month: string) {
  return month.slice(5) + '月'
}

function formatRange(start: string, end: string) {
  return `${start.slice(5).replace('-', '/')} - ${end.slice(5).replace('-', '/')}`
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  }
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <Card sx={{ height: '100%', borderRadius: 4, background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)' }}>
      <CardContent sx={{ height: '100%', aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="h4" fontWeight={800} sx={{ mt: 1 }}>{value}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{helper}</Typography>
      </CardContent>
    </Card>
  )
}

function WeeklyBarChart({
  data,
  maxValue,
  color,
}: {
  data: Array<{ label: string; value: number; subLabel?: string }>
  maxValue: number
  color: string
}) {
  const computedMax = Math.max(maxValue, 1)

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`, gap: { xs: 1, md: 1.5 }, alignItems: 'end', minHeight: 260 }}>
      {data.map((item) => (
        <Box key={item.label} sx={{ textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary">{item.value}</Typography>
          <Box sx={{ mt: 0.75, height: 180, display: 'flex', alignItems: 'end', justifyContent: 'center' }}>
            <Box
              sx={{
                width: '100%',
                maxWidth: 34,
                minHeight: item.value === 0 ? 8 : undefined,
                height: `${Math.max((item.value / computedMax) * 100, item.value === 0 ? 4 : 8)}%`,
                borderRadius: 999,
                background: `linear-gradient(180deg, ${color} 0%, rgba(255,255,255,0.25) 100%)`,
                boxShadow: `0 10px 24px ${color}33`,
              }}
            />
          </Box>
          <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>{item.label}</Typography>
          {item.subLabel && <Typography variant="caption" color="text.secondary">{item.subLabel}</Typography>}
        </Box>
      ))}
    </Box>
  )
}

function LineTrendChart({
  data,
  height = 360,
}: {
  data: Array<{ label: string; value: number }>
  height?: number
}) {
  const width = 620
  const padding = { top: 34, right: 24, bottom: 64, left: 58 }
  const maxValue = Math.max(...data.map((item) => item.value), 1)
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  const points = data.map((item, index) => {
    const x = padding.left + (index / Math.max(data.length - 1, 1)) * innerWidth
    const y = padding.top + innerHeight - (item.value / maxValue) * innerHeight
    return { ...item, x, y }
  })

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const areaPath = `${path} L ${points[points.length - 1]?.x ?? padding.left} ${padding.top + innerHeight} L ${points[0]?.x ?? padding.left} ${padding.top + innerHeight} Z`
  const guideValues = [0, 0.25, 0.5, 0.75, 1]

  return (
    <Box sx={{ width: '100%' }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {guideValues.map((ratio) => {
          const y = padding.top + innerHeight - ratio * innerHeight
          const value = Math.round(maxValue * ratio)
          return (
            <g key={ratio}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(15,23,42,0.10)" strokeDasharray="4 6" />
              <text x={10} y={y + 6} fontSize="15" fontWeight="600" fill="#64748b">{value}</text>
            </g>
          )
        })}

        <path d={areaPath} fill="rgba(37, 99, 235, 0.12)" />
        <path d={path} fill="none" stroke="#2563eb" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="6" fill="#2563eb" />
            {point.value > 0 && (
              <text x={point.x} y={point.y - 16} textAnchor="middle" fontSize="15" fontWeight="700" fill="#0f172a">
                {point.value}
              </text>
            )}
            <text x={point.x} y={height - 20} textAnchor="middle" fontSize="16" fontWeight="700" fill="#334155">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </Box>
  )
}

function RankedBars({
  data,
  color,
}: {
  data: Array<{ label: string; value: number; extra?: string }>
  color: string
}) {
  const max = Math.max(...data.map((item) => item.value), 1)

  return (
    <Stack spacing={1.5}>
      {data.map((item) => (
        <Box key={item.label}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 0.5 }}>
            <Typography variant="body2" fontWeight={700} noWrap>{item.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {item.value}{item.extra ? ` · ${item.extra}` : ''}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={(item.value / max) * 100}
            sx={{
              height: 10,
              borderRadius: 999,
              backgroundColor: 'rgba(15,23,42,0.08)',
              '& .MuiLinearProgress-bar': {
                borderRadius: 999,
                background: `linear-gradient(90deg, ${color} 0%, ${color}bb 100%)`,
              },
            }}
          />
        </Box>
      ))}
    </Stack>
  )
}

function ScrollableRankedBars({
  data,
  color,
  height = 260,
}: {
  data: Array<{ label: string; value: number; extra?: string }>
  color: string
  height?: number
}) {
  return (
    <Box
      sx={{
        height,
        overflowY: 'auto',
        pr: 0.5,
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        '&::-webkit-scrollbar': {
          display: 'none',
        },
      }}
    >
      <RankedBars data={data} color={color} />
    </Box>
  )
}

function RadarChart({ data }: { data: Array<{ label: string; score: number }> }) {
  const size = 320
  const center = size / 2
  const radius = 112
  const angles = data.map((_, index) => (Math.PI * 2 * index) / data.length - Math.PI / 2)
  const rings = [0.25, 0.5, 0.75, 1]
  const polygonPoints = data.map((item, index) => {
    const point = polarToCartesian(center, center, radius * (item.score / 100), angles[index])
    return `${point.x},${point.y}`
  }).join(' ')

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {rings.map((ring) => (
          <polygon
            key={ring}
            points={angles.map((angle) => {
              const point = polarToCartesian(center, center, radius * ring, angle)
              return `${point.x},${point.y}`
            }).join(' ')}
            fill="none"
            stroke="rgba(15, 23, 42, 0.12)"
          />
        ))}
        {angles.map((angle, index) => {
          const axisPoint = polarToCartesian(center, center, radius, angle)
          const labelPoint = polarToCartesian(center, center, radius + 22, angle)
          return (
            <g key={data[index].label}>
              <line x1={center} y1={center} x2={axisPoint.x} y2={axisPoint.y} stroke="rgba(15, 23, 42, 0.14)" />
              <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#334155">
                {data[index].label}
              </text>
            </g>
          )
        })}
        <polygon points={polygonPoints} fill="rgba(37, 99, 235, 0.2)" stroke="#2563eb" strokeWidth="3" />
        {data.map((item, index) => {
          const point = polarToCartesian(center, center, radius * (item.score / 100), angles[index])
          return (
            <g key={item.label}>
              <circle cx={point.x} cy={point.y} r="5" fill="#2563eb" />
              <text x={point.x} y={point.y - 12} textAnchor="middle" fontSize="11" fill="#0f172a">
                {item.score}
              </text>
            </g>
          )
        })}
      </svg>
    </Box>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedWeekKey, setSelectedWeekKey] = useState('')

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch('/api/dashboard', { cache: 'no-store' })
        const json = await response.json()

        if (!response.ok) {
          throw new Error(json.error || '加载看板失败')
        }

        setData(json)
        setSelectedWeekKey(json.currentWeekKey)
      } catch (err: any) {
        setError(err.message || '加载看板失败')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const selectedWeek = useMemo(
    () => data?.weeklyTrend.find((week) => week.key === selectedWeekKey) ?? data?.weeklyTrend[0] ?? null,
    [data, selectedWeekKey]
  )

  const weeklyBars = useMemo(
    () => (selectedWeek?.items || []).map((item) => ({
      label: formatDayLabel(item.day),
      value: item.total,
      subLabel: `${item.images}/${item.videos}`,
    })),
    [selectedWeek]
  )

  const monthlyLineData = useMemo(
    () => (data?.monthlyTrend || []).map((item) => ({
      label: formatMonthLabel(item.month),
      value: item.total,
    })),
    [data]
  )

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at top left, rgba(14,165,233,0.18), transparent 32%), radial-gradient(circle at top right, rgba(249,115,22,0.14), transparent 28%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
      }}
    >
      <AppBar position="sticky" color="transparent" elevation={0} sx={{ backdropFilter: 'blur(14px)', borderBottom: '1px solid rgba(15,23,42,0.08)' }}>
        <Toolbar>
          <IconButton edge="start" onClick={() => router.push('/')} sx={{ mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" fontWeight={800}>观看偏好数据看板</Typography>
            <Typography variant="body2" color="text.secondary">基于已看文件、评分、标签和博主关联生成</Typography>
          </Box>
          {data && (
            <Chip color="primary" variant="outlined" label={`更新于 ${new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false })}`} />
          )}
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 4 }}>
        {loading && (
          <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
            <Stack spacing={2} alignItems="center">
              <CircularProgress />
              <Typography color="text.secondary">正在汇总数据库中的观看行为...</Typography>
            </Stack>
          </Box>
        )}

        {error && !loading && <Alert severity="error">{error}</Alert>}

        {!loading && data && (
          <Stack spacing={3.5}>
            <Box sx={{ ...panelSx, p: { xs: 2.5, md: 3.5 }, background: 'linear-gradient(135deg, rgba(15,118,110,0.95) 0%, rgba(37,99,235,0.92) 100%)', color: '#fff' }}>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', lg: 'center' }}>
                <Box>
                  <Typography variant="overline" sx={{ opacity: 0.9, letterSpacing: 1.4 }}>Dashboard Snapshot</Typography>
                  <Typography variant="h3" fontWeight={900} sx={{ mt: 0.5 }}>
                    {data.summary.totalViewed.toLocaleString()} 个文件已经形成你的观看画像
                  </Typography>
                  <Typography sx={{ mt: 1.5, opacity: 0.88 }}>
                    最近 30 天活跃 {data.summary.activeDays30} 天，平均评分 {data.summary.avgRating || '-'}，平均日浏览 {data.summary.avgDailyViews30} 个。
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip icon={<AutoAwesomeIcon />} label={`高分占比 ${data.coverage.highScoreShare}%`} sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#fff' }} />
                  <Chip icon={<PersonSearchIcon />} label={`博主覆盖 ${data.coverage.creatorCoverage}%`} sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#fff' }} />
                  <Chip icon={<SellIcon />} label={`标签覆盖 ${data.coverage.evaluationCoverage}%`} sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#fff' }} />
                </Stack>
              </Stack>
            </Box>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 6 }}>
                <MetricCard label="已看文件总数" value={data.summary.totalViewed.toLocaleString()} helper="来自 media_ratings 中已标记查看的文件" />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <MetricCard label="图片 / 视频" value={`${data.summary.imagesViewed} / ${data.summary.videosViewed}`} helper={`图片 ${formatPercent(data.summary.imagesViewed, data.summary.totalViewed)}，视频 ${formatPercent(data.summary.videosViewed, data.summary.totalViewed)}`} />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <MetricCard label="已看图组" value={data.summary.groupsViewed.toLocaleString()} helper="group_ratings 中已标记查看的图组数量" />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <MetricCard label="已评分文件" value={data.summary.ratedCount.toLocaleString()} helper={`平均分 ${data.summary.avgRating || 0} / 5`} />
              </Grid>
            </Grid>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, lg: 7 }}>
                <Box sx={panelSx}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" sx={{ mb: 2 }}>
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <InsightsIcon color="primary" />
                        <Typography variant="h6" fontWeight={800}>本月按周观看趋势</Typography>
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        选择本月任意一周，查看每天浏览量，底部显示 `图片/视频`
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {data.weeklyTrend.map((week) => (
                        <Chip
                          key={week.key}
                          label={`${week.label} · ${week.total}`}
                          color={selectedWeek?.key === week.key ? 'primary' : 'default'}
                          variant={selectedWeek?.key === week.key ? 'filled' : 'outlined'}
                          onClick={() => setSelectedWeekKey(week.key)}
                        />
                      ))}
                    </Stack>
                  </Stack>

                  {selectedWeek && (
                    <Box>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 2 }}>
                        {selectedWeek.label} · {formatRange(selectedWeek.start, selectedWeek.end)}
                      </Typography>
                      <WeeklyBarChart data={weeklyBars} maxValue={data.chartMeta.maxWeeklyDayViews} color="#0f766e" />
                    </Box>
                  )}
                </Box>
              </Grid>

            </Grid>

            <Box sx={panelSx}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <ShowChartIcon color="primary" />
                <Typography variant="h5" fontWeight={900}>近一年月度走向</Typography>
              </Stack>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 2.5 }}>
                横轴按月份展示过去 12 个月的已看文件量，非零月份会直接显示数值
              </Typography>
              <LineTrendChart data={monthlyLineData} />
            </Box>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, lg: 4 }}>
                <Box sx={panelSx}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <MovieCreationIcon color="primary" />
                    <Typography variant="h6" fontWeight={800}>评分分布</Typography>
                  </Stack>
                  <RankedBars data={data.ratingDistribution.map((item) => ({ label: `${item.rating} 星`, value: item.count }))} color="#f97316" />
                </Box>
              </Grid>
              <Grid size={{ xs: 12, lg: 4 }}>
                <Box sx={panelSx}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <PersonSearchIcon color="primary" />
                    <Typography variant="h6" fontWeight={800}>最常看的博主 Top 10</Typography>
                  </Stack>
                  <ScrollableRankedBars
                    data={data.topCreators.map((item) => ({
                      label: item.creatorName,
                      value: item.count,
                      extra: `均分 ${item.avgRating || 0}`,
                    }))}
                    color="#2563eb"
                  />
                </Box>
              </Grid>
              <Grid size={{ xs: 12, lg: 4 }}>
                <Box sx={panelSx}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <AutoAwesomeIcon color="primary" />
                    <Typography variant="h6" fontWeight={800}>最喜欢的博主 Top 10</Typography>
                  </Stack>
                  <ScrollableRankedBars
                    data={data.favoriteCreators.map((item) => ({
                      label: item.creatorName,
                      value: Number(item.avgRating || 0),
                      extra: `${item.count} 次 · ${item.avgRating || 0} 分`,
                    }))}
                    color="#dc2626"
                  />
                </Box>
              </Grid>
            </Grid>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, lg: 4 }}>
                <Box sx={panelSx}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <SellIcon color="primary" />
                    <Typography variant="h6" fontWeight={800}>高频标签</Typography>
                  </Stack>
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>评价标签</Typography>
                      <ScrollableRankedBars data={data.topEvaluations.map((item) => ({ label: item.name, value: item.value }))} color="#7c3aed" />
                    </Box>
                    <Box>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>分类标签</Typography>
                      <ScrollableRankedBars data={data.topCategories.map((item) => ({ label: item.name, value: item.value }))} color="#0891b2" />
                    </Box>
                  </Stack>
                </Box>
              </Grid>

              <Grid size={{ xs: 12, lg: 4 }}>
                <Box sx={panelSx}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <RadarIcon color="primary" />
                    <Typography variant="h6" fontWeight={800}>六维偏好分析</Typography>
                  </Stack>
                  <RadarChart data={data.radarMetrics} />
                </Box>
              </Grid>

              <Grid size={{ xs: 12, lg: 4 }}>
                <Box sx={panelSx}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <InsightsIcon color="primary" />
                    <Typography variant="h6" fontWeight={800}>时段与行为解读</Typography>
                  </Stack>
                  <Stack spacing={2}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1.5 }}>活跃时段</Typography>
                      <RankedBars
                        data={[...data.hourlyActivity]
                          .sort((left, right) => right.count - left.count)
                          .slice(0, 6)
                          .map((item) => ({ label: `${item.hour}:00`, value: item.count }))}
                        color="#0f766e"
                      />
                    </Paper>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1.5 }}>自动洞察</Typography>
                      <Stack spacing={1.5}>
                        {data.insights.map((item) => (
                          <Alert key={item} severity="info" icon={<AutoAwesomeIcon fontSize="inherit" />}>
                            {item}
                          </Alert>
                        ))}
                      </Stack>
                    </Paper>
                  </Stack>
                </Box>
              </Grid>
            </Grid>
          </Stack>
        )}
      </Container>
    </Box>
  )
}
