import db from './databaseCore'
import { ensureInitialized } from './databaseInitialization'

export const customEvaluations = {
  getAll: () => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM custom_evaluations ORDER BY usage_count DESC, label ASC')
    return stmt.all()
  },

  add: (label: string) => {
    ensureInitialized()
    const existing = db.prepare('SELECT * FROM custom_evaluations WHERE label = ?').get(label)

    if (existing) {
      const stmt = db.prepare('UPDATE custom_evaluations SET usage_count = usage_count + 1 WHERE label = ?')
      return stmt.run(label)
    }

    const stmt = db.prepare('INSERT INTO custom_evaluations (label) VALUES (?)')
    return stmt.run(label)
  },

  delete: (label: string) => {
    ensureInitialized()
    try {
      const stmt = db.prepare('DELETE FROM custom_evaluations WHERE label = ?')
      return stmt.run(label)
    } catch (error: any) {
      if (error.code === 'SQLITE_BUSY') {
        console.warn('数据库繁忙，等待后重试...')
        const stmt = db.prepare('DELETE FROM custom_evaluations WHERE label = ?')
        return stmt.run(label)
      }
      throw error
    }
  },
}

export const categories = {
  getAll: () => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM categories ORDER BY usage_count DESC, name ASC')
    return stmt.all()
  },

  add: (name: string) => {
    ensureInitialized()
    const existing = db.prepare('SELECT * FROM categories WHERE name = ?').get(name)

    if (existing) {
      const stmt = db.prepare('UPDATE categories SET usage_count = usage_count + 1 WHERE name = ?')
      return stmt.run(name)
    }

    const stmt = db.prepare('INSERT INTO categories (name) VALUES (?)')
    return stmt.run(name)
  },

  delete: (name: string) => {
    ensureInitialized()
    try {
      const stmt = db.prepare('DELETE FROM categories WHERE name = ?')
      return stmt.run(name)
    } catch (error: any) {
      if (error.code === 'SQLITE_BUSY') {
        console.warn('数据库繁忙，等待后重试...')
        const stmt = db.prepare('DELETE FROM categories WHERE name = ?')
        return stmt.run(name)
      }
      throw error
    }
  },
}

export const statistics = {
  getMediaStats: () => {
    ensureInitialized()
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as rated,
        COUNT(CASE WHEN is_viewed = 1 THEN 1 END) as viewed,
        AVG(rating) as avg_rating
      FROM media_ratings
    `)
    return stmt.get()
  },

  getGroupStats: () => {
    ensureInitialized()
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as rated,
        COUNT(CASE WHEN is_viewed = 1 THEN 1 END) as viewed,
        AVG(rating) as avg_rating
      FROM group_ratings
    `)
    return stmt.get()
  },

  getTopEvaluations: (limit: number = 10) => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM custom_evaluations ORDER BY usage_count DESC LIMIT ?')
    return stmt.all(limit)
  },

  getTopCategories: (limit: number = 10) => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM categories ORDER BY usage_count DESC LIMIT ?')
    return stmt.all(limit)
  },
}

export function addCustomEvaluationLabel(label: string) {
  return customEvaluations.add(label)
}

export function addCategoryLabel(name: string) {
  return categories.add(name)
}
