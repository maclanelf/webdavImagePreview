import { NextResponse } from 'next/server'

import { ensureMySqlInitialized, queryMySqlOne, queryMySqlRows } from '@/lib/database'

export const dynamic = 'force-dynamic'

const ACTIVE_WINDOW_DAYS = 30
const YEAR_MONTHS = 12

type CountRow = { count: number | null }
type DailyRow = { day: string; total: number; images: number; videos: number }
type MonthlyRow = { month: string; total: number; images: number; videos: number }
type RatingRow = { rating: number | null; count: number }
type CreatorRow = {
  creatorId: number | null
  creatorName: string | null
  count: number
  avgRating: number | null
}
type HourRow = { hour: string; count: number }
type JsonFieldRow = { custom_evaluation: string | null; category: string | null }
type DashboardResponse = Awaited<ReturnType<typeof buildDashboardResponse>>

let dashboardCache:
  | {
    expiresAt: number
    payload: DashboardResponse
  }
  | null = null

function parseJsonArray(value: string | null): string[] {
  if (!value) return []

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean)
    }
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }

  return []
}

function formatDay(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMonth(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function normalizeScore(value: number, max: number) {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)))
}

function topEntries(counter: Map<string, number>, limit: number) {
  return [...counter.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, value]) => ({ name, value }))
}

function buildRecentMonths(months: number) {
  const result: string[] = []
  const now = new Date()

  for (let index = months - 1; index >= 0; index -= 1) {
    const current = new Date(now.getFullYear(), now.getMonth() - index, 1)
    result.push(formatMonth(current))
  }

  return result
}

function startOfWeekMonday(date: Date) {
  const result = new Date(date)
  const day = result.getDay()
  const diff = day === 0 ? -6 : 1 - day
  result.setDate(result.getDate() + diff)
  result.setHours(0, 0, 0, 0)
  return result
}

function endOfWeekSunday(date: Date) {
  const result = startOfWeekMonday(date)
  result.setDate(result.getDate() + 6)
  result.setHours(23, 59, 59, 999)
  return result
}

function buildCurrentMonthWeeks() {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)
  const rangeStart = startOfWeekMonday(monthStart)
  const rangeEnd = endOfWeekSunday(monthEnd)
  const weeks: Array<{ key: string; label: string; start: string; end: string; days: string[]; isCurrent: boolean }> = []

  let cursor = new Date(rangeStart)
  let weekIndex = 1

  while (cursor <= rangeEnd) {
    const start = new Date(cursor)
    const end = new Date(cursor)
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)

    const days: string[] = []
    const dayCursor = new Date(start)
    while (dayCursor <= end) {
      days.push(formatDay(dayCursor))
      dayCursor.setDate(dayCursor.getDate() + 1)
    }

    const isCurrent = now >= start && now <= end
    weeks.push({
      key: `${formatMonth(start)}-w${weekIndex}`,
      label: `第 ${weekIndex} 周`,
      start: formatDay(start),
      end: formatDay(end),
      days,
      isCurrent,
    })

    cursor = new Date(end)
    cursor.setDate(cursor.getDate() + 1)
    weekIndex += 1
  }

  return weeks
}

export async function GET() {
  try {
    if (dashboardCache && dashboardCache.expiresAt > Date.now()) {
      return NextResponse.json(dashboardCache.payload)
    }

    const payload = await buildDashboardResponse()
    dashboardCache = {
      expiresAt: Date.now() + 60 * 1000,
      payload,
    }

    return NextResponse.json(payload)
  } catch (error: any) {
    console.error('dashboard analytics error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to load dashboard data' },
      { status: 500 }
    )
  }
}

async function buildDashboardResponse() {
  await ensureMySqlInitialized()

  const creatorLinkSubquery = `
    SELECT file_path, creator_id
    FROM scan_file_creators
    WHERE creator_id IS NOT NULL
      AND creator_id != -1
    GROUP BY file_path, creator_id
  `

  const calendarWeeks = buildCurrentMonthWeeks()
  const queryStart = calendarWeeks[0]?.start
  const queryEnd = calendarWeeks[calendarWeeks.length - 1]?.end

  const [
    totalViewedRow,
    imagesViewedRow,
    videosViewedRow,
    groupsViewedRow,
    ratedCountRow,
    avgRatingRow,
    activeDays30Row,
    recent30TotalRow,
    currentMonthDailyRows,
    monthlyRows,
    ratingDistributionRows,
    topCreatorsRows,
    favoriteCreatorsRows,
    hourlyActivityRows,
    jsonFieldRows,
    creatorLinkedCountRow,
    highScoreCountRow,
  ] = await Promise.all([
    queryMySqlOne<CountRow>(`
      SELECT COUNT(*) AS count
      FROM media_ratings
      WHERE is_viewed = 1
    `),
    queryMySqlOne<CountRow>(`
      SELECT COUNT(*) AS count
      FROM media_ratings
      WHERE is_viewed = 1 AND file_type = 'image'
    `),
    queryMySqlOne<CountRow>(`
      SELECT COUNT(*) AS count
      FROM media_ratings
      WHERE is_viewed = 1 AND file_type = 'video'
    `),
    queryMySqlOne<CountRow>(`
      SELECT COUNT(*) AS count
      FROM group_ratings
      WHERE is_viewed = 1
    `),
    queryMySqlOne<CountRow>(`
      SELECT COUNT(*) AS count
      FROM media_ratings
      WHERE is_viewed = 1 AND rating IS NOT NULL
    `),
    queryMySqlOne<CountRow>(`
      SELECT ROUND(AVG(rating), 2) AS count
      FROM media_ratings
      WHERE is_viewed = 1 AND rating IS NOT NULL
    `),
    queryMySqlOne<CountRow>(`
      SELECT COUNT(DISTINCT DATE(updated_at)) AS count
      FROM media_ratings
      WHERE is_viewed = 1
        AND updated_at >= DATE_SUB(NOW(), INTERVAL ${ACTIVE_WINDOW_DAYS - 1} DAY)
    `),
    queryMySqlOne<CountRow>(`
      SELECT COUNT(*) AS count
      FROM media_ratings
      WHERE is_viewed = 1
        AND updated_at >= DATE_SUB(NOW(), INTERVAL ${ACTIVE_WINDOW_DAYS - 1} DAY)
    `),
    queryMySqlRows<DailyRow[]>(`
      SELECT
        DATE_FORMAT(updated_at, '%Y-%m-%d') AS day,
        COUNT(*) AS total,
        SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) AS images,
        SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) AS videos
      FROM media_ratings
      WHERE is_viewed = 1
        AND updated_at >= ?
        AND updated_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY DATE_FORMAT(updated_at, '%Y-%m-%d')
      ORDER BY DATE_FORMAT(updated_at, '%Y-%m-%d') ASC
    `, [queryStart, queryEnd]),
    queryMySqlRows<MonthlyRow[]>(`
      SELECT
        DATE_FORMAT(updated_at, '%Y-%m') AS month,
        COUNT(*) AS total,
        SUM(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) AS images,
        SUM(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) AS videos
      FROM media_ratings
      WHERE is_viewed = 1
        AND updated_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL ${YEAR_MONTHS - 1} MONTH)
      GROUP BY DATE_FORMAT(updated_at, '%Y-%m')
      ORDER BY DATE_FORMAT(updated_at, '%Y-%m') ASC
    `),
    queryMySqlRows<RatingRow[]>(`
      SELECT rating, COUNT(*) AS count
      FROM media_ratings
      WHERE is_viewed = 1 AND rating IS NOT NULL
      GROUP BY rating
      ORDER BY rating ASC
    `),
    queryMySqlRows<CreatorRow[]>(`
      SELECT
        linked.creator_id AS creatorId,
        c.primary_name AS creatorName,
        COUNT(DISTINCT mr.file_path) AS count,
        ROUND(AVG(mr.rating), 2) AS avgRating
      FROM media_ratings mr
       INNER JOIN (${creatorLinkSubquery}) linked ON linked.file_path = mr.file_path
       LEFT JOIN creators c ON linked.creator_id = c.id
      WHERE mr.is_viewed = 1
      GROUP BY linked.creator_id, c.primary_name
      ORDER BY COUNT(DISTINCT mr.file_path) DESC, avgRating DESC
      LIMIT 10
    `),
    queryMySqlRows<CreatorRow[]>(`
      SELECT
        linked.creator_id AS creatorId,
        c.primary_name AS creatorName,
        COUNT(DISTINCT mr.file_path) AS count,
        ROUND(AVG(mr.rating), 2) AS avgRating
      FROM media_ratings mr
       INNER JOIN (${creatorLinkSubquery}) linked ON linked.file_path = mr.file_path
       LEFT JOIN creators c ON linked.creator_id = c.id
      WHERE mr.is_viewed = 1
        AND mr.rating IS NOT NULL
      GROUP BY linked.creator_id, c.primary_name
      HAVING COUNT(DISTINCT mr.file_path) >= 3
      ORDER BY avgRating DESC, COUNT(DISTINCT mr.file_path) DESC
      LIMIT 10
    `),
    queryMySqlRows<HourRow[]>(`
      SELECT
        DATE_FORMAT(updated_at, '%H') AS hour,
        COUNT(*) AS count
      FROM media_ratings
      WHERE is_viewed = 1
      GROUP BY DATE_FORMAT(updated_at, '%H')
      ORDER BY DATE_FORMAT(updated_at, '%H') ASC
    `),
    queryMySqlRows<JsonFieldRow[]>(`
      SELECT custom_evaluation, category
      FROM media_ratings
      WHERE is_viewed = 1
        AND (
          (custom_evaluation IS NOT NULL AND TRIM(custom_evaluation) != '')
          OR (category IS NOT NULL AND TRIM(category) != '')
        )
    `),
    queryMySqlOne<CountRow>(`
      SELECT COUNT(DISTINCT mr.file_path) AS count
      FROM media_ratings mr
      INNER JOIN (${creatorLinkSubquery}) linked ON linked.file_path = mr.file_path
      WHERE mr.is_viewed = 1
    `),
    queryMySqlOne<CountRow>(`
      SELECT COUNT(*) AS count
      FROM media_ratings
      WHERE is_viewed = 1
        AND rating >= 4
    `),
  ])

    const totalViewed = totalViewedRow?.count ?? 0
    const imagesViewed = imagesViewedRow?.count ?? 0
    const videosViewed = videosViewedRow?.count ?? 0
    const groupsViewed = groupsViewedRow?.count ?? 0
    const ratedCount = ratedCountRow?.count ?? 0
    const avgRating = Number(avgRatingRow?.count ?? 0)
    const activeDays30 = activeDays30Row?.count ?? 0
    const recent30Total = recent30TotalRow?.count ?? 0

    const currentMonthMap = new Map(currentMonthDailyRows.map((row) => [row.day, row]))
    const weeklyTrend = calendarWeeks
      .map((week) => {
        const items = week.days.map((day) => {
          const row = currentMonthMap.get(day)
          return {
            day,
            total: row?.total ?? 0,
            images: row?.images ?? 0,
            videos: row?.videos ?? 0,
          }
        })

        return {
          ...week,
          total: items.reduce((sum, item) => sum + item.total, 0),
          items,
        }
      })

    const currentWeekKey = weeklyTrend.find((week) => week.isCurrent)?.key ?? weeklyTrend[weeklyTrend.length - 1]?.key ?? ''

    const monthlyMap = new Map(monthlyRows.map((row) => [row.month, row]))
    const monthlyTrend = buildRecentMonths(YEAR_MONTHS).map((month) => {
      const row = monthlyMap.get(month)
      return {
        month,
        total: row?.total ?? 0,
        images: row?.images ?? 0,
        videos: row?.videos ?? 0,
      }
    })

    const ratingDistribution = ratingDistributionRows.map((row) => ({
      rating: row.rating ?? 0,
      count: row.count,
    }))

    const topCreators = topCreatorsRows.map((row) => ({
      creatorId: row.creatorId,
      creatorName: row.creatorName || `ID ${row.creatorId ?? '-'}`,
      count: row.count,
      avgRating: row.avgRating ?? 0,
    }))

    const favoriteCreators = favoriteCreatorsRows.map((row) => ({
      creatorId: row.creatorId,
      creatorName: row.creatorName || `ID ${row.creatorId ?? '-'}`,
      count: row.count,
      avgRating: row.avgRating ?? 0,
    }))

    const hourlyActivity = hourlyActivityRows.map((row) => ({
      hour: row.hour,
      count: row.count,
    }))

    const evaluationCounter = new Map<string, number>()
    const categoryCounter = new Map<string, number>()
    let evaluationTaggedCount = 0
    let categoryTaggedCount = 0

    jsonFieldRows.forEach((row) => {
      const evaluations = parseJsonArray(row.custom_evaluation)
      const categories = parseJsonArray(row.category)

      if (evaluations.length > 0) {
        evaluationTaggedCount += 1
        evaluations.forEach((item) => {
          evaluationCounter.set(item, (evaluationCounter.get(item) ?? 0) + 1)
        })
      }

      if (categories.length > 0) {
        categoryTaggedCount += 1
        categories.forEach((item) => {
          categoryCounter.set(item, (categoryCounter.get(item) ?? 0) + 1)
        })
      }
    })

    const creatorLinkedCount = creatorLinkedCountRow?.count ?? 0
    const highScoreCount = highScoreCountRow?.count ?? 0

    const maxWeeklyDayViews = weeklyTrend.reduce(
      (max, week) => Math.max(max, ...week.items.map((item) => item.total), 0),
      0
    )
    const maxMonthlyViews = monthlyTrend.reduce((max, item) => Math.max(max, item.total), 0)

    const imageShare = totalViewed > 0 ? imagesViewed / totalViewed : 0
    const videoShare = totalViewed > 0 ? videosViewed / totalViewed : 0
    const highScoreShare = ratedCount > 0 ? highScoreCount / ratedCount : 0
    const creatorCoverage = totalViewed > 0 ? creatorLinkedCount / totalViewed : 0
    const evaluationCoverage = totalViewed > 0 ? evaluationTaggedCount / totalViewed : 0
    const categoryCoverage = totalViewed > 0 ? categoryTaggedCount / totalViewed : 0
    const activeRatio30 = activeDays30 / ACTIVE_WINDOW_DAYS

    const radarMetrics = [
      { label: '图片偏好', score: normalizeScore(imageShare, 1) },
      { label: '视频偏好', score: normalizeScore(videoShare, 1) },
      { label: '高分倾向', score: normalizeScore(highScoreShare, 1) },
      { label: '标签细化', score: normalizeScore((evaluationCoverage + categoryCoverage) / 2, 1) },
      { label: '博主关注', score: normalizeScore(creatorCoverage, 1) },
      { label: '活跃持续', score: normalizeScore(activeRatio30, 1) },
    ]

    const currentWeek = weeklyTrend.find((week) => week.key === currentWeekKey)
    const topEvaluation = topEntries(evaluationCounter, 1)[0]
    const insights: string[] = []
    insights.push(`最近 30 天共查看 ${recent30Total} 个文件，活跃 ${activeDays30} 天，日均 ${Number((recent30Total / ACTIVE_WINDOW_DAYS).toFixed(1))} 个。`)
    if (currentWeek) {
      insights.push(`${currentWeek.label} 已查看 ${currentWeek.total} 个文件，单日峰值 ${Math.max(...currentWeek.items.map((item) => item.total), 0)} 个。`)
    }
    insights.push(`近 12 个月月度峰值为 ${maxMonthlyViews} 个文件，偏好更偏向${imageShare >= videoShare ? '图片' : '视频'}。`)
    if (topCreators.length > 0) {
      insights.push(`最常查看的博主是 ${topCreators[0].creatorName}，累计 ${topCreators[0].count} 个已看文件。`)
    }
    if (topEvaluation) {
      insights.push(`最常用评价标签是“${topEvaluation.name}”，出现 ${topEvaluation.value} 次。`)
    }

  return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalViewed,
        imagesViewed,
        videosViewed,
        groupsViewed,
        activeDays30,
        avgRating,
        ratedCount,
        avgDailyViews30: Number((recent30Total / ACTIVE_WINDOW_DAYS).toFixed(1)),
      },
      weeklyTrend,
      currentWeekKey,
      monthlyTrend,
      mediaTypeShare: [
        { label: '图片', value: imagesViewed },
        { label: '视频', value: videosViewed },
      ],
      ratingDistribution,
      topCreators,
      favoriteCreators,
      topEvaluations: topEntries(evaluationCounter, 10),
      topCategories: topEntries(categoryCounter, 12),
      hourlyActivity,
      radarMetrics,
      coverage: {
        creatorCoverage: Number((creatorCoverage * 100).toFixed(1)),
        evaluationCoverage: Number((evaluationCoverage * 100).toFixed(1)),
        categoryCoverage: Number((categoryCoverage * 100).toFixed(1)),
        highScoreShare: Number((highScoreShare * 100).toFixed(1)),
      },
      chartMeta: {
        maxWeeklyDayViews,
        maxMonthlyViews,
      },
      insights,
    }
}
