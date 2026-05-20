import { ensureMySqlInitialized, executeMySqlStatement, queryMySqlOne, queryMySqlRows } from './database'

export const customEvaluations = {
  getAll: async () => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM custom_evaluations ORDER BY usage_count DESC, label ASC')
  },

  add: async (label: string) => {
    await ensureMySqlInitialized()
    const existing = await queryMySqlOne('SELECT * FROM custom_evaluations WHERE label = ?', [label])

    if (existing) {
      return executeMySqlStatement('UPDATE custom_evaluations SET usage_count = usage_count + 1 WHERE label = ?', [label])
    }

    return executeMySqlStatement('INSERT INTO custom_evaluations (label) VALUES (?)', [label])
  },

  delete: async (label: string) => {
    await ensureMySqlInitialized()
    return executeMySqlStatement('DELETE FROM custom_evaluations WHERE label = ?', [label])
  },
}

export const categories = {
  getAll: async () => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM categories ORDER BY usage_count DESC, name ASC')
  },

  add: async (name: string) => {
    await ensureMySqlInitialized()
    const existing = await queryMySqlOne('SELECT * FROM categories WHERE name = ?', [name])

    if (existing) {
      return executeMySqlStatement('UPDATE categories SET usage_count = usage_count + 1 WHERE name = ?', [name])
    }

    return executeMySqlStatement('INSERT INTO categories (name) VALUES (?)', [name])
  },

  delete: async (name: string) => {
    await ensureMySqlInitialized()
    return executeMySqlStatement('DELETE FROM categories WHERE name = ?', [name])
  },
}

export const statistics = {
  getMediaStats: async () => {
    await ensureMySqlInitialized()
    return queryMySqlOne(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as rated,
        COUNT(CASE WHEN is_viewed = 1 THEN 1 END) as viewed,
        AVG(rating) as avg_rating
      FROM media_ratings
    `)
  },

  getGroupStats: async () => {
    await ensureMySqlInitialized()
    return queryMySqlOne(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as rated,
        COUNT(CASE WHEN is_viewed = 1 THEN 1 END) as viewed,
        AVG(rating) as avg_rating
      FROM group_ratings
    `)
  },

  getTopEvaluations: async (limit: number = 10) => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM custom_evaluations ORDER BY usage_count DESC LIMIT ?', [limit])
  },

  getTopCategories: async (limit: number = 10) => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM categories ORDER BY usage_count DESC LIMIT ?', [limit])
  },
}

export async function addCustomEvaluationLabel(label: string) {
  return customEvaluations.add(label)
}

export async function addCategoryLabel(name: string) {
  return categories.add(name)
}
