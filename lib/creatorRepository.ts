import db from './databaseCore'
import { ensureInitialized } from './databaseInitialization'

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

function parseCreatorOtherNames(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      return filtered.length > 0 ? filtered : undefined
    }

    if (typeof parsed === 'string' && parsed.trim()) {
      return [parsed.trim()]
    }
  } catch {
    return [trimmed]
  }

  return undefined
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

function getCreatorAliasCache() {
  const now = Date.now()
  if (creatorAliasCache.data && (now - creatorAliasCache.lastUpdate) < creatorAliasCache.ttl) {
    console.log('✅ [缓存] 使用博主别名缓存')
    return creatorAliasCache.data
  }

  console.log('🔄 [缓存] 重新加载博主别名缓存')
  const stmt = db.prepare(`
    SELECT id, primary_name, other_names
    FROM creators
    ORDER BY usage_count DESC, id ASC
  `)
  const creators = stmt.all()

  creatorAliasCache.data = creators.map((c: any) => ({
    id: c.id,
    primaryName: c.primary_name,
    aliases: c.other_names ? JSON.parse(c.other_names) : [],
  }))
  creatorAliasCache.lastUpdate = now
  return creatorAliasCache.data
}

export const scanFileCreators = {
  get: (filePath: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM scan_file_creators WHERE file_path = ?')
      return stmt.get(filePath)
    } catch (error) {
      console.error('获取文件博主关联失败:', error)
      return null
    }
  },

  getAll: () => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM scan_file_creators ORDER BY updated_at DESC, id DESC')
      return stmt.all()
    } catch (error) {
      console.error('获取全部文件博主关联失败:', error)
      return []
    }
  },

  getTopCreatorByParentPath: (parentPath: string) => {
    try {
      ensureInitialized()
      const stmt = db.prepare(`
        SELECT creator_id AS creatorId, COUNT(*) AS fileCount
        FROM scan_file_creators
        WHERE parent_path = ?
          AND creator_id IS NOT NULL
        GROUP BY creator_id
        ORDER BY fileCount DESC, creator_id ASC
        LIMIT 1
      `)
      return stmt.get(parentPath) || null
    } catch (error) {
      console.error('获取目录主博主关联失败:', error)
      return null
    }
  },

  save: (data: { filePath: string; parentPath?: string; creatorId?: number | null }) => {
    try {
      ensureInitialized()
      const existing = scanFileCreators.get(data.filePath) as any
      const parentPath = data.parentPath ?? getParentPath(data.filePath)

      if (existing) {
        const stmt = db.prepare(`
          UPDATE scan_file_creators
          SET parent_path = ?,
              creator_id = ?,
              updated_at = datetime('now', 'localtime')
          WHERE file_path = ?
        `)
        return stmt.run(
          parentPath,
          data.creatorId !== undefined ? data.creatorId : existing.creator_id,
          data.filePath,
        )
      }

      const stmt = db.prepare(`
        INSERT INTO scan_file_creators (file_path, parent_path, creator_id)
        VALUES (?, ?, ?)
      `)
      return stmt.run(
        data.filePath,
        parentPath,
        data.creatorId !== undefined ? data.creatorId : null,
      )
    } catch (error) {
      console.error('保存文件博主关联失败:', error)
      throw error
    }
  },

  batchEnsure: (files: Array<{ filePath: string; parentPath: string }>) => {
    try {
      ensureInitialized()
      if (files.length === 0) {
        return { inserted: 0 }
      }

      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO scan_file_creators (file_path, parent_path, creator_id)
        VALUES (?, ?, NULL)
      `)

      const updateParentPathStmt = db.prepare(`
        UPDATE scan_file_creators
        SET parent_path = ?,
            updated_at = datetime('now', 'localtime')
        WHERE file_path = ?
          AND parent_path != ?
      `)

      const insertMany = db.transaction((batch: Array<{ filePath: string; parentPath: string }>) => {
        let inserted = 0
        let parentPathUpdated = 0

        for (const file of batch) {
          const insertResult = insertStmt.run(file.filePath, file.parentPath)
          inserted += insertResult.changes
          const updateResult = updateParentPathStmt.run(file.parentPath, file.filePath, file.parentPath)
          parentPathUpdated += updateResult.changes
        }

        return { inserted, parentPathUpdated }
      })

      return insertMany(files)
    } catch (error) {
      console.error('批量补齐文件博主关联失败:', error)
      throw error
    }
  },

  setByParentPath: (parentPath: string, creatorId: number | null) => {
    try {
      ensureInitialized()
      const files = db.prepare(`
        SELECT filename, parent_path
        FROM scan_files
        WHERE parent_path = ?
      `).all(parentPath) as Array<{ filename: string; parent_path: string }>

      const saveMany = db.transaction((rows: Array<{ filename: string; parent_path: string }>) => {
        for (const row of rows) {
          scanFileCreators.save({
            filePath: row.filename,
            parentPath: row.parent_path,
            creatorId,
          })
        }
      })

      saveMany(files)
      return { updated: files.length }
    } catch (error) {
      console.error('按目录设置文件博主关联失败:', error)
      throw error
    }
  },
}

export const creators = {
  getAll: () => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM creators ORDER BY usage_count DESC, primary_name ASC')
      const rows = stmt.all()
      return rows.map((row: any) => ({
        id: row.id,
        primaryName: row.primary_name,
        otherNames: row.other_names ? JSON.parse(row.other_names) : [],
        appearanceRating: row.appearance_rating,
        bodyRating: row.body_rating,
        bio: row.bio,
        avatarPath: normalizeAvatarPath(row.avatar_path),
        usageCount: row.usage_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
    } catch (error) {
      console.error('获取博主列表失败:', error)
      return []
    }
  },

  get: (id: number) => {
    try {
      ensureInitialized()
      const stmt = db.prepare('SELECT * FROM creators WHERE id = ?')
      const row: any = stmt.get(id)
      if (!row) return null
      return {
        id: row.id,
        primaryName: row.primary_name,
        otherNames: row.other_names ? JSON.parse(row.other_names) : [],
        appearanceRating: row.appearance_rating,
        bodyRating: row.body_rating,
        bio: row.bio,
        avatarPath: normalizeAvatarPath(row.avatar_path),
        usageCount: row.usage_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    } catch (error) {
      console.error('获取博主失败:', error)
      return null
    }
  },

  search: (keyword: string) => {
    try {
      ensureInitialized()
      const searchTerm = `%${keyword}%`
      const stmt = db.prepare(`
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
      `)
      const rows = stmt.all(searchTerm, searchTerm, keyword, `${keyword}%`)
      return rows.map((row: any) => ({
        id: row.id,
        primaryName: row.primary_name,
        otherNames: row.other_names ? JSON.parse(row.other_names) : [],
        appearanceRating: row.appearance_rating,
        bodyRating: row.body_rating,
        bio: row.bio,
        avatarPath: normalizeAvatarPath(row.avatar_path),
        usageCount: row.usage_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
    } catch (error) {
      console.error('搜索博主失败:', error)
      return []
    }
  },

  save: (data: {
    id?: number
    primaryName: string
    otherNames?: string[]
    appearanceRating?: number
    bodyRating?: number
    bio?: string
    avatarPath?: string
  }) => {
    try {
      ensureInitialized()
      let otherNames = data.otherNames ? [...data.otherNames] : []
      otherNames = Array.from(new Set(otherNames.map((name) => name.trim()).filter(Boolean)))

      if (!data.id && !otherNames.includes(data.primaryName)) {
        otherNames.push(data.primaryName)
      }

      const otherNamesStr = otherNames.length > 0 ? JSON.stringify(otherNames) : null
      let result: any
      let creatorId: number

      if (data.id) {
        const stmt = db.prepare(`
          UPDATE creators
          SET primary_name = ?, other_names = ?, appearance_rating = ?,
              body_rating = ?, bio = ?, avatar_path = ?,
              updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `)
        result = stmt.run(
          data.primaryName,
          otherNamesStr,
          data.appearanceRating || null,
          data.bodyRating || null,
          data.bio || null,
          data.avatarPath || null,
          data.id,
        )
        creatorId = data.id
      } else {
        const existingByName = db.prepare('SELECT id FROM creators WHERE primary_name = ?').get(data.primaryName) as { id: number } | undefined
        if (existingByName) {
          const stmt = db.prepare(`
            UPDATE creators
            SET other_names = ?, appearance_rating = ?,
                body_rating = ?, bio = ?, avatar_path = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
          `)
          result = stmt.run(
            otherNamesStr,
            data.appearanceRating || null,
            data.bodyRating || null,
            data.bio || null,
            data.avatarPath || null,
            existingByName.id,
          )
          ;(result as any).existingId = existingByName.id
          creatorId = existingByName.id
        } else {
          const stmt = db.prepare(`
            INSERT INTO creators
            (primary_name, other_names, appearance_rating, body_rating, bio, avatar_path)
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          result = stmt.run(
            data.primaryName,
            otherNamesStr,
            data.appearanceRating || null,
            data.bodyRating || null,
            data.bio || null,
            data.avatarPath || null,
          )
          creatorId = Number(result.lastInsertRowid)
        }
      }

      const aliasNamesToMerge = otherNames.filter((name) => name !== data.primaryName)
      if (aliasNamesToMerge.length > 0) {
        const placeholders = aliasNamesToMerge.map(() => '?').join(',')
        const aliasRows = db.prepare(`
          SELECT id
          FROM creators
          WHERE primary_name IN (${placeholders}) AND id != ?
        `).all(...aliasNamesToMerge, creatorId) as Array<{ id: number }>
        const sourceIds = Array.from(new Set(aliasRows.map((row) => row.id)))
        if (sourceIds.length > 0) {
          creators.merge(creatorId, sourceIds)
          ;(result as any).mergedSourceIds = sourceIds
        }
      }

      clearCreatorAliasCache()
      return result
    } catch (error) {
      console.error('保存博主失败:', error)
      throw error
    }
  },

  changePrimaryName: (id: number, newName: string, addOldToOthers: boolean = true) => {
    try {
      ensureInitialized()
      const creator = creators.get(id)
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

      const stmt = db.prepare(`
        UPDATE creators
        SET primary_name = ?, other_names = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `)
      const result = stmt.run(normalizedNewName, JSON.stringify(otherNames), id)
      clearCreatorAliasCache()
      return result
    } catch (error) {
      console.error('更换主名称失败:', error)
      throw error
    }
  },

  addOtherName: (id: number, name: string) => {
    try {
      ensureInitialized()
      const creator = creators.get(id)
      if (!creator) throw new Error('博主不存在')

      const otherNames = [...creator.otherNames]
      if (otherNames.includes(name) || creator.primaryName === name) {
        return { success: false, message: '名称已存在' }
      }

      otherNames.push(name)
      db.prepare(`
        UPDATE creators
        SET other_names = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(JSON.stringify(otherNames), id)

      clearCreatorAliasCache()
      return { success: true }
    } catch (error) {
      console.error('添加别名失败:', error)
      throw error
    }
  },

  removeOtherName: (id: number, name: string) => {
    try {
      ensureInitialized()
      const creator = creators.get(id)
      if (!creator) throw new Error('博主不存在')

      const otherNames = creator.otherNames.filter((n: string) => n !== name)
      const result = db.prepare(`
        UPDATE creators
        SET other_names = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(JSON.stringify(otherNames), id)

      clearCreatorAliasCache()
      return result
    } catch (error) {
      console.error('删除别名失败:', error)
      throw error
    }
  },

  merge: (targetId: number, sourceIds: number[]) => {
    try {
      ensureInitialized()
      const target = creators.get(targetId)
      if (!target) throw new Error('目标博主不存在')

      const normalizedSourceIds = Array.from(new Set(sourceIds.filter((sourceId) => Number.isInteger(sourceId) && sourceId !== targetId)))
      if (normalizedSourceIds.length === 0) {
        throw new Error('请至少选择一个待合并博主')
      }

      const mergeTransaction = db.transaction(() => {
        const allOtherNames = [...target.otherNames]
        for (const sourceId of normalizedSourceIds) {
          const source = creators.get(sourceId)
          if (!source) continue

          if (!allOtherNames.includes(source.primaryName)) {
            allOtherNames.push(source.primaryName)
          }
          source.otherNames.forEach((name: string) => {
            if (!allOtherNames.includes(name) && name !== target.primaryName) {
              allOtherNames.push(name)
            }
          })

          db.prepare(`
            UPDATE scan_file_creators
            SET creator_id = ?, updated_at = datetime('now', 'localtime')
            WHERE creator_id = ?
          `).run(targetId, sourceId)

          db.prepare('DELETE FROM creators WHERE id = ?').run(sourceId)
        }

        db.prepare(`
          UPDATE creators
          SET other_names = ?,
              usage_count = (
                SELECT COUNT(*) FROM scan_file_creators WHERE creator_id = ?
              ),
              updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(JSON.stringify(allOtherNames), targetId, targetId)
      })

      mergeTransaction()
      clearCreatorAliasCache()
      return { success: true }
    } catch (error) {
      console.error('合并博主失败:', error)
      throw error
    }
  },

  delete: (id: number) => {
    try {
      ensureInitialized()
      const deleteTransaction = db.transaction(() => {
        db.prepare(`
          UPDATE scan_file_creators
          SET creator_id = NULL, updated_at = datetime('now', 'localtime')
          WHERE creator_id = ?
        `).run(id)
        db.prepare('DELETE FROM creators WHERE id = ?').run(id)
      })

      deleteTransaction()
      clearCreatorAliasCache()
      return { success: true }
    } catch (error) {
      console.error('删除博主失败:', error)
      throw error
    }
  },

  getFiles: (id: number, options?: { type?: 'media' | 'group' }) => {
    try {
      ensureInitialized()
      const { type } = options || {}
      const results: any = { media: [], groups: [] }

      if (!type || type === 'media') {
        results.media = db.prepare(`
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
        `).all(id)
      }

      if (!type || type === 'group') {
        results.groups = db.prepare(`
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
        `).all(id, id)
      }

      return results
    } catch (error) {
      console.error('获取博主文件失败:', error)
      return { media: [], groups: [] }
    }
  },

  getStats: (id: number) => {
    try {
      ensureInitialized()
      const mediaStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as rated,
          AVG(rating) as avg_rating
        FROM scan_file_creators sfc
        LEFT JOIN media_ratings mr ON mr.file_path = sfc.file_path
        WHERE sfc.creator_id = ?
      `).get(id) as any

      const groupStats = db.prepare(`
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
      `).get(id) as any

      return {
        mediaFiles: mediaStats.total || 0,
        mediaRated: mediaStats.rated || 0,
        mediaAvgRating: mediaStats.avg_rating || 0,
        groupFiles: groupStats.total || 0,
        groupRated: groupStats.rated || 0,
        groupAvgRating: groupStats.avg_rating || 0,
        totalFiles: (mediaStats.total || 0) + (groupStats.total || 0),
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

  findCreatorByPath: (filePath: string) => {
    try {
      ensureInitialized()
      const pathParts = filePath.split('/')
      let matchPath = filePath

      if (pathParts.length > 4) {
        const startIndex = 3
        const endIndex = pathParts.length - 1
        matchPath = pathParts.slice(startIndex, endIndex).join('/')
        console.log(`🔍 [路径提取] 原始路径: ${filePath}`)
        console.log(`🔍 [路径提取] 匹配路径: ${matchPath}`)
      }

      const cachedCreators = getCreatorAliasCache()
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

  previewBatchLink: (namePattern: string) => {
    try {
      ensureInitialized()
      const mediaResult = db.prepare(`
        SELECT COUNT(*) as count
        FROM scan_files
        WHERE filename LIKE ? OR parent_path LIKE ?
      `).get(`%${namePattern}%`, `%${namePattern}%`) as { count: number }

      const groupResult = db.prepare(`
        SELECT COUNT(DISTINCT parent_path) as count
        FROM scan_files
        WHERE parent_path LIKE ?
      `).get(`%${namePattern}%`) as { count: number }

      const mediaSamples = db.prepare(`
        SELECT filename as file_path, basename as file_name, file_type
        FROM scan_files
        WHERE filename LIKE ? OR parent_path LIKE ?
        LIMIT 5
      `).all(`%${namePattern}%`, `%${namePattern}%`)

      const groupSamples = db.prepare(`
        SELECT DISTINCT parent_path as group_path, parent_path as group_name
        FROM scan_files
        WHERE parent_path LIKE ?
        LIMIT 5
      `).all(`%${namePattern}%`)

      return {
        mediaCount: mediaResult.count,
        groupCount: groupResult.count,
        totalCount: mediaResult.count + groupResult.count,
        mediaSamples,
        groupSamples,
      }
    } catch (error) {
      console.error('预览批量关联失败:', error)
      throw error
    }
  },

  batchLinkFilesByName: (creatorId: number, namePattern: string) => {
    try {
      ensureInitialized()
      const creator = creators.get(creatorId)
      if (!creator) throw new Error('博主不存在')

      const batchLinkTransaction = db.transaction(() => {
        const matchedFiles = db.prepare(`
          SELECT filename, parent_path
          FROM scan_files
          WHERE filename LIKE ? OR parent_path LIKE ?
        `).all(`%${namePattern}%`, `%${namePattern}%`) as Array<{ filename: string; parent_path: string }>

        matchedFiles.forEach((file) => {
          scanFileCreators.save({ filePath: file.filename, parentPath: file.parent_path, creatorId })
        })

        const distinctGroups = new Set(matchedFiles.map((file) => file.parent_path).filter(Boolean))
        db.prepare(`
          UPDATE creators
          SET usage_count = (
            SELECT COUNT(*) FROM scan_file_creators WHERE creator_id = ?
          ),
          updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(creatorId, creatorId)

        return {
          filesUpdated: matchedFiles.length,
          groupsAffected: distinctGroups.size,
          mediaUpdated: matchedFiles.length,
          groupUpdated: distinctGroups.size,
        }
      })

      return batchLinkTransaction()
    } catch (error) {
      console.error('批量关联文件失败:', error)
      throw error
    }
  },

  addOtherNameAndLinkFiles: (creatorId: number, newName: string, batchUpdate: boolean = false) => {
    try {
      ensureInitialized()
      const creator = creators.get(creatorId)
      if (!creator) {
        return { success: false, message: '博主不存在' }
      }

      const aliasExists = creator.otherNames.includes(newName) || creator.primaryName === newName
      if (!aliasExists) {
        const addResult = creators.addOtherName(creatorId, newName)
        if (!addResult.success) {
          return addResult
        }
      }

      if (batchUpdate) {
        const linkResult = creators.batchLinkFilesByName(creatorId, newName)
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
