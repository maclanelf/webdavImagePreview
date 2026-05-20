import {
  ensureMySqlInitialized,
  executeMySqlStatement,
  queryMySqlOne,
  queryMySqlRows,
  withMySqlTransaction,
} from './database'

function getParentPath(filename: string): string {
  const lastSlash = filename.lastIndexOf('/')
  return lastSlash > 0 ? filename.substring(0, lastSlash) : '/'
}

function normalizeAvatarPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || trimmed === '0' || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') {
    return null
  }

  return trimmed
}

function parseCreatorOtherNames(value: unknown): string[] {
  if (typeof value !== 'string') {
    return []
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }

    if (typeof parsed === 'string' && parsed.trim()) {
      return [parsed.trim()]
    }
  } catch {
    return [trimmed]
  }

  return []
}

function mapCreatorRow(row: any) {
  return {
    id: Number(row.id),
    primaryName: row.primary_name,
    otherNames: parseCreatorOtherNames(row.other_names),
    appearanceRating: row.appearance_rating,
    bodyRating: row.body_rating,
    bio: row.bio,
    avatarPath: normalizeAvatarPath(row.avatar_path),
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeResult(result: any) {
  return {
    ...result,
    insertId: result?.insertId ?? 0,
    changes: result?.affectedRows ?? 0,
  }
}

let creatorAliasCache: {
  data: Array<{ id: number; primaryName: string; aliases: string[] }> | null
  lastUpdate: number
  ttl: number
} = {
  data: null,
  lastUpdate: 0,
  ttl: 5 * 60 * 1000,
}

export function clearCreatorAliasCache() {
  creatorAliasCache.data = null
  creatorAliasCache.lastUpdate = 0
  console.log('🗑️ [缓存] 博主别名缓存已清除')
}

async function getCreatorAliasCache() {
  const now = Date.now()
  if (creatorAliasCache.data && (now - creatorAliasCache.lastUpdate) < creatorAliasCache.ttl) {
    console.log('✅ [缓存] 使用博主别名缓存')
    return creatorAliasCache.data
  }

  console.log('🔄 [缓存] 重新加载博主别名缓存')
  await ensureMySqlInitialized()
  const rows = await queryMySqlRows<any[]>(`
    SELECT id, primary_name, other_names
    FROM creators
    ORDER BY usage_count DESC, id ASC
  `)

  creatorAliasCache.data = rows.map((row: any) => ({
    id: Number(row.id),
    primaryName: row.primary_name,
    aliases: parseCreatorOtherNames(row.other_names),
  }))
  creatorAliasCache.lastUpdate = now
  return creatorAliasCache.data
}

async function refreshCreatorUsageCount(creatorId: number | null | undefined) {
  if (!Number.isInteger(creatorId)) {
    return
  }

  await executeMySqlStatement(
    `
      UPDATE creators
      SET usage_count = (
        SELECT COUNT(*)
        FROM scan_file_creators
        WHERE creator_id = ?
      )
      WHERE id = ?
    `,
    [creatorId, creatorId],
  )
}

export const scanFileCreators = {
  get: async (filePath: string) => {
    try {
      await ensureMySqlInitialized()
      return queryMySqlOne('SELECT * FROM scan_file_creators WHERE file_path = ?', [filePath])
    } catch (error) {
      console.error('获取文件博主关联失败:', error)
      return null
    }
  },

  getAll: async () => {
    try {
      await ensureMySqlInitialized()
      return queryMySqlRows('SELECT * FROM scan_file_creators ORDER BY updated_at DESC, id DESC')
    } catch (error) {
      console.error('获取全部文件博主关联失败:', error)
      return []
    }
  },

  getTopCreatorByParentPath: async (parentPath: string) => {
    try {
      await ensureMySqlInitialized()
      return queryMySqlOne(
        `
          SELECT creator_id AS creatorId, COUNT(*) AS fileCount
          FROM scan_file_creators
          WHERE parent_path = ?
            AND creator_id IS NOT NULL
          GROUP BY creator_id
          ORDER BY fileCount DESC, creator_id ASC
          LIMIT 1
        `,
        [parentPath],
      )
    } catch (error) {
      console.error('获取目录主博主关联失败:', error)
      return null
    }
  },

  save: async (data: { filePath: string; parentPath?: string; creatorId?: number | null }) => {
    try {
      await ensureMySqlInitialized()
      const existing = await scanFileCreators.get(data.filePath) as any
      const parentPath = data.parentPath ?? getParentPath(data.filePath)
      const creatorId = data.creatorId !== undefined ? data.creatorId : existing?.creator_id ?? null

      let result: any
      if (existing) {
        result = await executeMySqlStatement(
          `
            UPDATE scan_file_creators
            SET parent_path = ?, creator_id = ?
            WHERE file_path = ?
          `,
          [parentPath, creatorId, data.filePath],
        )
      } else {
        result = await executeMySqlStatement(
          `
            INSERT INTO scan_file_creators (file_path, parent_path, creator_id)
            VALUES (?, ?, ?)
          `,
          [data.filePath, parentPath, creatorId],
        )
      }

      if (existing?.creator_id && existing.creator_id !== creatorId) {
        await refreshCreatorUsageCount(Number(existing.creator_id))
      }
      if (creatorId !== null && creatorId !== undefined) {
        await refreshCreatorUsageCount(Number(creatorId))
      }

      return normalizeResult(result)
    } catch (error) {
      console.error('保存文件博主关联失败:', error)
      throw error
    }
  },

  batchEnsure: async (files: Array<{ filePath: string; parentPath: string }>) => {
    try {
      await ensureMySqlInitialized()
      if (files.length === 0) {
        return { inserted: 0, parentPathUpdated: 0 }
      }

      const insertPlaceholders = files.map(() => '(?, ?)').join(',')
      const insertValues: any[] = []
      files.forEach((file) => {
        insertValues.push(file.filePath, file.parentPath)
      })

      const insertResult = await executeMySqlStatement(
        `INSERT IGNORE INTO scan_file_creators (file_path, parent_path) VALUES ${insertPlaceholders}`,
        insertValues,
      )

      const updateSelectSql = files.map(() => 'SELECT ? AS file_path, ? AS parent_path').join(' UNION ALL ')
      const updateValues: any[] = []
      files.forEach((file) => {
        updateValues.push(file.filePath, file.parentPath)
      })

      const updateResult = await executeMySqlStatement(
        `
          UPDATE scan_file_creators sfc
          INNER JOIN (
            ${updateSelectSql}
          ) incoming ON incoming.file_path = sfc.file_path
          SET sfc.parent_path = incoming.parent_path
          WHERE sfc.parent_path <> incoming.parent_path
        `,
        updateValues,
      )

      return {
        inserted: insertResult.affectedRows ?? 0,
        parentPathUpdated: updateResult.affectedRows ?? 0,
      }
    } catch (error) {
      console.error('批量补齐文件博主关联失败:', error)
      throw error
    }
  },

  setByParentPath: async (parentPath: string, creatorId: number | null) => {
    try {
      await ensureMySqlInitialized()
      const files = await queryMySqlRows<Array<{ filename: string; parent_path: string }>>(
        `
          SELECT filename, parent_path
          FROM scan_files
          WHERE parent_path = ?
        `,
        [parentPath],
      )

      for (const row of files) {
        await scanFileCreators.save({
          filePath: row.filename,
          parentPath: row.parent_path,
          creatorId,
        })
      }

      return { updated: files.length }
    } catch (error) {
      console.error('按目录设置文件博主关联失败:', error)
      throw error
    }
  },
}

export const creators = {
  getAll: async () => {
    try {
      await ensureMySqlInitialized()
      const rows = await queryMySqlRows<any[]>('SELECT * FROM creators ORDER BY usage_count DESC, primary_name ASC')
      return rows.map(mapCreatorRow)
    } catch (error) {
      console.error('获取博主列表失败:', error)
      return []
    }
  },

  get: async (id: number) => {
    try {
      await ensureMySqlInitialized()
      const row = await queryMySqlOne<any>('SELECT * FROM creators WHERE id = ?', [id])
      return row ? mapCreatorRow(row) : null
    } catch (error) {
      console.error('获取博主失败:', error)
      return null
    }
  },

  search: async (keyword: string) => {
    try {
      await ensureMySqlInitialized()
      const searchTerm = `%${keyword}%`
      const rows = await queryMySqlRows<any[]>(
        `
          SELECT * FROM creators
          WHERE primary_name LIKE ? OR other_names LIKE ?
          ORDER BY
            CASE
              WHEN primary_name = ? THEN 0
              WHEN primary_name LIKE ? THEN 1
              ELSE 2
            END,
            usage_count DESC,
            primary_name ASC
          LIMIT 20
        `,
        [searchTerm, searchTerm, keyword, `${keyword}%`],
      )
      return rows.map(mapCreatorRow)
    } catch (error) {
      console.error('搜索博主失败:', error)
      return []
    }
  },

  save: async (data: {
    id?: number
    primaryName: string
    otherNames?: string[]
    appearanceRating?: number
    bodyRating?: number
    bio?: string
    avatarPath?: string
  }) => {
    try {
      await ensureMySqlInitialized()
      let otherNames = data.otherNames ? [...data.otherNames] : []
      otherNames = Array.from(new Set(otherNames.map((name) => name.trim()).filter(Boolean)))

      if (!data.id && !otherNames.includes(data.primaryName)) {
        otherNames.push(data.primaryName)
      }

      const otherNamesStr = otherNames.length > 0 ? JSON.stringify(otherNames) : null
      let result: any
      let creatorId: number

      if (data.id) {
        result = await executeMySqlStatement(
          `
            UPDATE creators
            SET primary_name = ?, other_names = ?, appearance_rating = ?,
                body_rating = ?, bio = ?, avatar_path = ?
            WHERE id = ?
          `,
          [
            data.primaryName,
            otherNamesStr,
            data.appearanceRating || null,
            data.bodyRating || null,
            data.bio || null,
            data.avatarPath || null,
            data.id,
          ],
        )
        creatorId = data.id
      } else {
        const existingByName = await queryMySqlOne<{ id: number }>('SELECT id FROM creators WHERE primary_name = ?', [data.primaryName])
        if (existingByName) {
          result = await executeMySqlStatement(
            `
              UPDATE creators
              SET other_names = ?, appearance_rating = ?,
                  body_rating = ?, bio = ?, avatar_path = ?
              WHERE id = ?
            `,
            [
              otherNamesStr,
              data.appearanceRating || null,
              data.bodyRating || null,
              data.bio || null,
              data.avatarPath || null,
              existingByName.id,
            ],
          )
          result = { ...result, existingId: existingByName.id }
          creatorId = existingByName.id
        } else {
          result = await executeMySqlStatement(
            `
              INSERT INTO creators
              (primary_name, other_names, appearance_rating, body_rating, bio, avatar_path)
              VALUES (?, ?, ?, ?, ?, ?)
            `,
            [
              data.primaryName,
              otherNamesStr,
              data.appearanceRating || null,
              data.bodyRating || null,
              data.bio || null,
              data.avatarPath || null,
            ],
          )
          creatorId = Number(result.insertId)
        }
      }

      const aliasNamesToMerge = otherNames.filter((name) => name !== data.primaryName)
      if (aliasNamesToMerge.length > 0) {
        const placeholders = aliasNamesToMerge.map(() => '?').join(',')
        const aliasRows = await queryMySqlRows<Array<{ id: number }>>(
          `
            SELECT id
            FROM creators
            WHERE primary_name IN (${placeholders}) AND id <> ?
          `,
          [...aliasNamesToMerge, creatorId],
        )
        const sourceIds = Array.from(new Set(aliasRows.map((row) => Number(row.id))))
        if (sourceIds.length > 0) {
          await creators.merge(creatorId, sourceIds)
          result = { ...result, mergedSourceIds: sourceIds }
        }
      }

      clearCreatorAliasCache()
      return normalizeResult(result)
    } catch (error) {
      console.error('保存博主失败:', error)
      throw error
    }
  },

  changePrimaryName: async (id: number, newName: string, addOldToOthers: boolean = true) => {
    try {
      await ensureMySqlInitialized()
      const creator = await creators.get(id)
      if (!creator) throw new Error('博主不存在')

      const normalizedNewName = newName.trim()
      if (!normalizedNewName) throw new Error('新主名称不能为空')

      const allowedNames = new Set([creator.primaryName, ...creator.otherNames])
      if (!allowedNames.has(normalizedNewName)) {
        throw new Error('新主名称必须是当前主名称或已有别名')
      }

      const otherNames = [...creator.otherNames]
      if (addOldToOthers && !otherNames.includes(creator.primaryName)) {
        otherNames.push(creator.primaryName)
      }

      const result = await executeMySqlStatement(
        'UPDATE creators SET primary_name = ?, other_names = ? WHERE id = ?',
        [normalizedNewName, JSON.stringify(otherNames), id],
      )
      clearCreatorAliasCache()
      return normalizeResult(result)
    } catch (error) {
      console.error('更换主名称失败:', error)
      throw error
    }
  },

  addOtherName: async (id: number, name: string) => {
    try {
      await ensureMySqlInitialized()
      const creator = await creators.get(id)
      if (!creator) throw new Error('博主不存在')

      const normalizedName = name.trim()
      const otherNames = [...creator.otherNames]
      if (otherNames.includes(normalizedName) || creator.primaryName === normalizedName) {
        return { success: false, message: '名称已存在' }
      }

      otherNames.push(normalizedName)
      await executeMySqlStatement(
        'UPDATE creators SET other_names = ? WHERE id = ?',
        [JSON.stringify(otherNames), id],
      )

      clearCreatorAliasCache()
      return { success: true }
    } catch (error) {
      console.error('添加别名失败:', error)
      throw error
    }
  },

  removeOtherName: async (id: number, name: string) => {
    try {
      await ensureMySqlInitialized()
      const creator = await creators.get(id)
      if (!creator) throw new Error('博主不存在')

      const otherNames = creator.otherNames.filter((item: string) => item !== name)
      const result = await executeMySqlStatement(
        'UPDATE creators SET other_names = ? WHERE id = ?',
        [JSON.stringify(otherNames), id],
      )

      clearCreatorAliasCache()
      return normalizeResult(result)
    } catch (error) {
      console.error('删除别名失败:', error)
      throw error
    }
  },

  merge: async (targetId: number, sourceIds: number[]) => {
    try {
      await ensureMySqlInitialized()
      const target = await creators.get(targetId)
      if (!target) throw new Error('目标博主不存在')

      const normalizedSourceIds = Array.from(new Set(sourceIds.filter((sourceId) => Number.isInteger(sourceId) && sourceId !== targetId)))
      if (normalizedSourceIds.length === 0) {
        throw new Error('请至少选择一个待合并博主')
      }

      await withMySqlTransaction(async (connection) => {
        const allOtherNames = [...target.otherNames]
        for (const sourceId of normalizedSourceIds) {
          const [sourceRows] = await connection.query('SELECT * FROM creators WHERE id = ?', [sourceId])
          const source = Array.isArray(sourceRows) ? (sourceRows[0] as any) : null
          if (!source) continue

          if (!allOtherNames.includes(source.primary_name)) {
            allOtherNames.push(source.primary_name)
          }
          parseCreatorOtherNames(source.other_names).forEach((name) => {
            if (!allOtherNames.includes(name) && name !== target.primaryName) {
              allOtherNames.push(name)
            }
          })

          await connection.execute('UPDATE scan_file_creators SET creator_id = ? WHERE creator_id = ?', [targetId, sourceId])
          await connection.execute('DELETE FROM creators WHERE id = ?', [sourceId])
        }

        await connection.execute(
          `
            UPDATE creators
            SET other_names = ?,
                usage_count = (
                  SELECT COUNT(*) FROM scan_file_creators WHERE creator_id = ?
                )
            WHERE id = ?
          `,
          [JSON.stringify(allOtherNames), targetId, targetId],
        )
      })

      clearCreatorAliasCache()
      return { success: true }
    } catch (error) {
      console.error('合并博主失败:', error)
      throw error
    }
  },

  delete: async (id: number) => {
    try {
      await ensureMySqlInitialized()
      await withMySqlTransaction(async (connection) => {
        await connection.execute('UPDATE scan_file_creators SET creator_id = NULL WHERE creator_id = ?', [id])
        await connection.execute('DELETE FROM creators WHERE id = ?', [id])
      })

      clearCreatorAliasCache()
      return { success: true }
    } catch (error) {
      console.error('删除博主失败:', error)
      throw error
    }
  },

  getFiles: async (id: number, options?: { type?: 'media' | 'group' }) => {
    try {
      await ensureMySqlInitialized()
      const { type } = options || {}
      const results: any = { media: [], groups: [] }

      if (!type || type === 'media') {
        results.media = await queryMySqlRows(
          `
            SELECT
              sfc.file_path,
              sfc.parent_path,
              sfc.creator_id,
              sfc.created_at AS linked_at,
              sfc.updated_at AS linked_updated_at,
              mr.*
            FROM scan_file_creators sfc
            LEFT JOIN media_ratings mr ON mr.file_path = sfc.file_path
            WHERE sfc.creator_id = ?
            ORDER BY COALESCE(mr.updated_at, sfc.updated_at) DESC
          `,
          [id],
        )
      }

      if (!type || type === 'group') {
        results.groups = await queryMySqlRows(
          `
            SELECT
              sfc.parent_path AS group_path,
              COALESCE(gr.group_name, sfc.parent_path) AS group_name,
              COUNT(*) AS file_count,
              gr.rating,
              gr.recommendation_reason,
              gr.custom_evaluation,
              gr.category,
              gr.is_viewed,
              gr.created_at,
              gr.updated_at,
              ? AS creator_id
            FROM scan_file_creators sfc
            LEFT JOIN group_ratings gr ON gr.group_path = sfc.parent_path
            WHERE sfc.creator_id = ?
              AND sfc.parent_path IS NOT NULL
            GROUP BY sfc.parent_path, gr.group_name, gr.rating, gr.recommendation_reason, gr.custom_evaluation, gr.category, gr.is_viewed, gr.created_at, gr.updated_at
            ORDER BY COALESCE(gr.updated_at, MAX(sfc.updated_at)) DESC
          `,
          [id, id],
        )
      }

      return results
    } catch (error) {
      console.error('获取博主文件失败:', error)
      return { media: [], groups: [] }
    }
  },

  getStats: async (id: number) => {
    try {
      await ensureMySqlInitialized()
      const mediaStats = await queryMySqlOne<any>(
        `
          SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as rated,
            AVG(rating) as avg_rating
          FROM scan_file_creators sfc
          LEFT JOIN media_ratings mr ON mr.file_path = sfc.file_path
          WHERE sfc.creator_id = ?
        `,
        [id],
      )

      const groupStats = await queryMySqlOne<any>(
        `
          SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN gr.rating IS NOT NULL THEN 1 END) as rated,
            AVG(gr.rating) as avg_rating
          FROM (
            SELECT DISTINCT sfc.parent_path
            FROM scan_file_creators sfc
            WHERE sfc.parent_path IS NOT NULL
              AND sfc.creator_id = ?
          ) creator_groups
          LEFT JOIN group_ratings gr ON gr.group_path = creator_groups.parent_path
        `,
        [id],
      )

      return {
        mediaFiles: mediaStats?.total || 0,
        mediaRated: mediaStats?.rated || 0,
        mediaAvgRating: mediaStats?.avg_rating || 0,
        groupFiles: groupStats?.total || 0,
        groupRated: groupStats?.rated || 0,
        groupAvgRating: groupStats?.avg_rating || 0,
        totalFiles: (mediaStats?.total || 0) + (groupStats?.total || 0),
      }
    } catch (error) {
      console.error('获取博主统计失败:', error)
      return {
        mediaFiles: 0,
        mediaRated: 0,
        mediaAvgRating: 0,
        groupFiles: 0,
        groupRated: 0,
        groupAvgRating: 0,
        totalFiles: 0,
      }
    }
  },

  findCreatorByPath: async (filePath: string) => {
    try {
      await ensureMySqlInitialized()
      const pathParts = filePath.split('/')
      let matchPath = filePath

      if (pathParts.length > 4) {
        const startIndex = 3
        const endIndex = pathParts.length - 1
        matchPath = pathParts.slice(startIndex, endIndex).join('/')
        console.log(`🔍 [路径提取] 原始路径: ${filePath}`)
        console.log(`🔍 [路径提取] 匹配路径: ${matchPath}`)
      }

      const cachedCreators = await getCreatorAliasCache()
      for (const creator of cachedCreators) {
        for (const alias of creator.aliases) {
          if (matchPath.includes(alias)) {
            console.log(`🎯 [智能关联] 路径匹配成功: "${matchPath}" 包含博主 "${creator.primaryName}" 的别名 "${alias}"`)
            return creators.get(creator.id)
          }
        }
      }

      return null
    } catch (error) {
      console.error('智能匹配博主失败:', error)
      return null
    }
  },

  previewBatchLink: async (namePattern: string) => {
    try {
      await ensureMySqlInitialized()
      const mediaResult = await queryMySqlOne<{ count: number }>(
        `
          SELECT COUNT(*) as count
          FROM scan_files
          WHERE filename LIKE ? OR parent_path LIKE ?
        `,
        [`%${namePattern}%`, `%${namePattern}%`],
      )

      const groupResult = await queryMySqlOne<{ count: number }>(
        `
          SELECT COUNT(DISTINCT parent_path) as count
          FROM scan_files
          WHERE parent_path LIKE ?
        `,
        [`%${namePattern}%`],
      )

      const mediaSamples = await queryMySqlRows(
        `
          SELECT filename as file_path, basename as file_name, file_type
          FROM scan_files
          WHERE filename LIKE ? OR parent_path LIKE ?
          LIMIT 5
        `,
        [`%${namePattern}%`, `%${namePattern}%`],
      )

      const groupSamples = await queryMySqlRows(
        `
          SELECT DISTINCT parent_path as group_path, parent_path as group_name
          FROM scan_files
          WHERE parent_path LIKE ?
          LIMIT 5
        `,
        [`%${namePattern}%`],
      )

      return {
        mediaCount: mediaResult?.count || 0,
        groupCount: groupResult?.count || 0,
        totalCount: (mediaResult?.count || 0) + (groupResult?.count || 0),
        mediaSamples,
        groupSamples,
      }
    } catch (error) {
      console.error('预览批量关联失败:', error)
      throw error
    }
  },

  batchLinkFilesByName: async (creatorId: number, namePattern: string) => {
    try {
      await ensureMySqlInitialized()
      const creator = await creators.get(creatorId)
      if (!creator) throw new Error('博主不存在')

      const matchedFiles = await queryMySqlRows<Array<{ filename: string; parent_path: string }>>(
        `
          SELECT filename, parent_path
          FROM scan_files
          WHERE filename LIKE ? OR parent_path LIKE ?
        `,
        [`%${namePattern}%`, `%${namePattern}%`],
      )

      for (const file of matchedFiles) {
        await scanFileCreators.save({ filePath: file.filename, parentPath: file.parent_path, creatorId })
      }

      await refreshCreatorUsageCount(creatorId)
      const distinctGroups = new Set(matchedFiles.map((file) => file.parent_path).filter(Boolean))

      return {
        filesUpdated: matchedFiles.length,
        groupsAffected: distinctGroups.size,
        mediaUpdated: matchedFiles.length,
        groupUpdated: distinctGroups.size,
      }
    } catch (error) {
      console.error('批量关联文件失败:', error)
      throw error
    }
  },

  addOtherNameAndLinkFiles: async (creatorId: number, newName: string, batchUpdate: boolean = false) => {
    try {
      await ensureMySqlInitialized()
      const creator = await creators.get(creatorId)
      if (!creator) {
        return { success: false, message: '博主不存在' }
      }

      const aliasExists = creator.otherNames.includes(newName) || creator.primaryName === newName
      if (!aliasExists) {
        const addResult = await creators.addOtherName(creatorId, newName)
        if (!addResult.success) {
          return addResult
        }
      }

      if (batchUpdate) {
        const linkResult = await creators.batchLinkFilesByName(creatorId, newName)
        return {
          success: true,
          message: aliasExists
            ? `别名已存在，关联了 ${linkResult.filesUpdated} 个文件，涉及 ${linkResult.groupsAffected} 个图组`
            : `别名添加成功，关联了 ${linkResult.filesUpdated} 个文件，涉及 ${linkResult.groupsAffected} 个图组`,
          ...linkResult,
        }
      }

      return {
        success: true,
        message: aliasExists ? '别名已存在' : '别名添加成功',
        filesUpdated: 0,
        groupsAffected: 0,
        mediaUpdated: 0,
        groupUpdated: 0,
      }
    } catch (error) {
      console.error('添加别名并批量关联失败:', error)
      throw error
    }
  },
}
