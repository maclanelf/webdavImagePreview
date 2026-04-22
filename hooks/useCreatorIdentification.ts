'use client'

import { useEffect, useState } from 'react'

interface CreatorIdentifyResult {
  creator: any | null
  creatorName: string | null
}

const resolvedCache = new Map<string, CreatorIdentifyResult>()
const pendingCache = new Map<string, Promise<CreatorIdentifyResult>>()

function buildCacheKey(filePath: string, refreshKey: number) {
  return `${refreshKey}:${filePath}`
}

async function requestCreatorIdentification(cacheKey: string, filePath: string) {
  const cached = resolvedCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const pending = pendingCache.get(cacheKey)
  if (pending) {
    return pending
  }

  const promise = fetch('/api/creators/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Identify request failed: ${response.status}`)
      }

      const data = await response.json()
      const result: CreatorIdentifyResult = data.success && data.identified && data.creator
        ? {
            creator: data.creator,
            creatorName: data.creator.primaryName,
          }
        : {
            creator: null,
            creatorName: null,
          }

      resolvedCache.set(cacheKey, result)
      return result
    })
    .finally(() => {
      pendingCache.delete(cacheKey)
    })

  pendingCache.set(cacheKey, promise)
  return promise
}

export function useCreatorIdentification(filePath: string, refreshKey: number = 0) {
  const [creatorName, setCreatorName] = useState<string | null>(null)
  const [identifiedCreator, setIdentifiedCreator] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!filePath) {
      setCreatorName(null)
      setIdentifiedCreator(null)
      setLoading(false)
      return
    }

    const cacheKey = buildCacheKey(filePath, refreshKey)
    const cached = resolvedCache.get(cacheKey)
    if (cached) {
      setCreatorName(cached.creatorName)
      setIdentifiedCreator(cached.creator)
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)

    requestCreatorIdentification(cacheKey, filePath)
      .then((result) => {
        if (!active) {
          return
        }

        setCreatorName(result.creatorName)
        setIdentifiedCreator(result.creator)
      })
      .catch((error) => {
        if (!active) {
          return
        }

        console.error('[useCreatorIdentification] 识别博主失败:', error)
        setCreatorName(null)
        setIdentifiedCreator(null)
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [filePath, refreshKey])

  return {
    creatorName,
    identifiedCreator,
    loading,
  }
}
