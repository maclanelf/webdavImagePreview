import db from './databaseCore'
import { ensureInitialized } from './databaseInitialization'

export const scanCache = {
  get: (webdavUrl: string, webdavUsername: string, path: string) => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? AND path = ?')
    return stmt.get(webdavUrl, webdavUsername, path)
  },

  count: () => {
    ensureInitialized()
    const result = db.prepare('SELECT COUNT(*) as count FROM scan_cache').get() as { count: number }
    return result.count
  },

  getMultiple: (webdavUrl: string, webdavUsername: string, paths: string[]) => {
    ensureInitialized()
    if (paths.length === 0) return []

    const placeholders = paths.map(() => '?').join(',')
    const sql = `SELECT id, path FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? AND path IN (${placeholders})`
    const stmt = db.prepare(sql)
    return stmt.all(webdavUrl, webdavUsername, ...paths)
  },

  getAll: () => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM scan_cache ORDER BY last_scan DESC')
    return stmt.all()
  },

  save: (data: {
    webdavUrl: string
    webdavUsername: string
    path: string
    filesData: string
    totalFiles: number
    imageCount: number
    videoCount: number
    scanSettings: string
  }) => {
    ensureInitialized()
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO scan_cache
      (webdav_url, webdav_username, path, files_data, total_files, image_count, video_count, scan_settings, last_scan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `)
    return stmt.run(
      data.webdavUrl,
      data.webdavUsername,
      data.path,
      data.filesData,
      data.totalFiles,
      data.imageCount,
      data.videoCount,
      data.scanSettings,
    )
  },

  delete: (webdavUrl: string, webdavUsername: string, path: string) => {
    ensureInitialized()
    const stmt = db.prepare('DELETE FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? AND path = ?')
    return stmt.run(webdavUrl, webdavUsername, path)
  },

  getByWebDAVConfig: (webdavUrl: string, webdavUsername: string) => {
    ensureInitialized()
    const stmt = db.prepare('SELECT * FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? ORDER BY last_scan DESC')
    return stmt.all(webdavUrl, webdavUsername)
  },
}
