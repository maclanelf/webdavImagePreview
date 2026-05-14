import db, { ensureInitialized } from '@/lib/database'
import { UNKNOWN_CREATOR_ID } from '@/lib/constants'
import type { CreatorSummary } from '@/types'

export interface CreatorLookupResult {
  creator: CreatorSummary | null
  creatorResolved: boolean
}

function parseOtherNames(value: unknown): string[] | undefined {
  if (!value) return undefined

  if (Array.isArray(value)) {
    const filtered = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    return filtered.length > 0 ? filtered : undefined
  }

  if (typeof value !== 'string') {
    return undefined
  }

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      return filtered.length > 0 ? filtered : undefined
    }

    if (typeof parsed === 'string' && parsed.trim()) {
      return [parsed.trim()]
    }
  } catch {
    if (value.trim()) {
      return [value.trim()]
    }
  }

  return undefined
}

function buildCreatorSummary(row: any): CreatorSummary {
  return {
    id: row.linkedCreatorId,
    primaryName: row.primaryName,
    otherNames: parseOtherNames(row.otherNames),
    appearanceRating: row.appearanceRating ?? null,
    bodyRating: row.bodyRating ?? null,
    bio: row.bio ?? null,
    avatarPath: row.avatarPath ?? null,
  }
}

export function getCreatorLookupMap(filePaths: string[]): Map<string, CreatorLookupResult> {
  ensureInitialized()

  const uniqueFilePaths = Array.from(new Set(filePaths.filter(Boolean)))
  const lookupMap = new Map<string, CreatorLookupResult>()

  uniqueFilePaths.forEach((filePath) => {
    lookupMap.set(filePath, {
      creator: null,
      creatorResolved: false,
    })
  })

  if (uniqueFilePaths.length === 0) {
    return lookupMap
  }

  const placeholders = uniqueFilePaths.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT
      sfc.file_path AS filePath,
      sfc.creator_id AS creatorId,
      c.id AS linkedCreatorId,
      c.primary_name AS primaryName,
      c.other_names AS otherNames,
      c.appearance_rating AS appearanceRating,
      c.body_rating AS bodyRating,
      c.bio AS bio,
      c.avatar_path AS avatarPath
    FROM scan_file_creators sfc
    LEFT JOIN creators c ON c.id = sfc.creator_id
    WHERE sfc.file_path IN (${placeholders})
  `).all(...uniqueFilePaths) as Array<any>

  rows.forEach((row) => {
    if (!row?.filePath) {
      return
    }

    if (row.creatorId === UNKNOWN_CREATOR_ID) {
      lookupMap.set(row.filePath, {
        creator: null,
        creatorResolved: true,
      })
      return
    }

    if (typeof row.creatorId === 'number' && row.creatorId > 0 && typeof row.linkedCreatorId === 'number') {
      lookupMap.set(row.filePath, {
        creator: buildCreatorSummary(row),
        creatorResolved: true,
      })
      return
    }

    lookupMap.set(row.filePath, {
      creator: null,
      creatorResolved: false,
    })
  })

  return lookupMap
}
