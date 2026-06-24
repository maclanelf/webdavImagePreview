'use client'

type RatingOptionsSnapshot = {
  evaluations: string[]
  categories: string[]
}

type RatingOptionsCache = {
  evaluations: string[] | null
  categories: string[] | null
  loadingPromise: Promise<RatingOptionsSnapshot> | null
}

const ratingOptionsCache: RatingOptionsCache = {
  evaluations: null,
  categories: null,
  loadingPromise: null,
}

function normalizeUnique(values?: string[]): string[] {
  if (!values?.length) {
    return []
  }

  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
}

function cloneSnapshot(snapshot: RatingOptionsSnapshot): RatingOptionsSnapshot {
  return {
    evaluations: [...snapshot.evaluations],
    categories: [...snapshot.categories],
  }
}

export function getCachedRatingOptions(): RatingOptionsSnapshot {
  return {
    evaluations: ratingOptionsCache.evaluations ? [...ratingOptionsCache.evaluations] : [],
    categories: ratingOptionsCache.categories ? [...ratingOptionsCache.categories] : [],
  }
}

export function hasCachedRatingOptions(): boolean {
  return Boolean(ratingOptionsCache.evaluations && ratingOptionsCache.categories)
}

export function updateCachedRatingOptions(data: { evaluations?: string[]; categories?: string[] }) {
  if (data.evaluations) {
    ratingOptionsCache.evaluations = normalizeUnique(data.evaluations)
  }

  if (data.categories) {
    ratingOptionsCache.categories = normalizeUnique(data.categories)
  }
}

export function addCachedEvaluation(label: string): string[] {
  const next = normalizeUnique([...(ratingOptionsCache.evaluations || []), label])
  ratingOptionsCache.evaluations = next
  return [...next]
}

export function addCachedCategory(name: string): string[] {
  const next = normalizeUnique([...(ratingOptionsCache.categories || []), name])
  ratingOptionsCache.categories = next
  return [...next]
}

export async function loadRatingOptions(force = false): Promise<RatingOptionsSnapshot> {
  if (!force && ratingOptionsCache.evaluations && ratingOptionsCache.categories) {
    return getCachedRatingOptions()
  }

  if (!force && ratingOptionsCache.loadingPromise) {
    return ratingOptionsCache.loadingPromise
  }

  ratingOptionsCache.loadingPromise = (async () => {
    const [evaluationsRes, categoriesRes] = await Promise.all([
      fetch('/api/ratings/evaluations'),
      fetch('/api/ratings/categories'),
    ])

    const cachedOptions = getCachedRatingOptions()
    const snapshot: RatingOptionsSnapshot = {
      evaluations: cachedOptions.evaluations,
      categories: cachedOptions.categories,
    }
    let hasSuccessfulResponse = false

    if (evaluationsRes.ok) {
      const evaluationsData = await evaluationsRes.json()
      snapshot.evaluations = normalizeUnique(evaluationsData.evaluations?.map((item: any) => item.label) || [])
      hasSuccessfulResponse = true
    }

    if (categoriesRes.ok) {
      const categoriesData = await categoriesRes.json()
      snapshot.categories = normalizeUnique(categoriesData.categories?.map((item: any) => item.name) || [])
      hasSuccessfulResponse = true
    }

    if (!hasSuccessfulResponse) {
      throw new Error('加载评分标签失败')
    }

    updateCachedRatingOptions(snapshot)
    return cloneSnapshot(snapshot)
  })()

  try {
    return await ratingOptionsCache.loadingPromise
  } finally {
    ratingOptionsCache.loadingPromise = null
  }
}
