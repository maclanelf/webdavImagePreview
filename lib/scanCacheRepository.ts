import { ensureMySqlInitialized, executeMySqlStatement, queryMySqlOne, queryMySqlRows } from './database'

export const scanCache = {
  get: async (webdavUrl: string, webdavUsername: string, path: string) => {
    await ensureMySqlInitialized()
    return queryMySqlOne('SELECT * FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? AND path = ?', [webdavUrl, webdavUsername, path])
  },

  count: async () => {
    await ensureMySqlInitialized()
    const result = await queryMySqlOne<{ count: number }>('SELECT COUNT(*) as count FROM scan_cache')
    return result?.count || 0
  },

  getMultiple: async (webdavUrl: string, webdavUsername: string, paths: string[]) => {
    await ensureMySqlInitialized()
    if (paths.length === 0) return []

    const placeholders = paths.map(() => '?').join(',')
    const sql = `SELECT id, path FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? AND path IN (${placeholders})`
    return queryMySqlRows(sql, [webdavUrl, webdavUsername, ...paths])
  },

  getAll: async () => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM scan_cache ORDER BY last_scan DESC')
  },

  save: async (data: {
    webdavUrl: string
    webdavUsername: string
    path: string
    filesData: string
    totalFiles: number
    imageCount: number
    videoCount: number
    scanSettings: string
  }) => {
    await ensureMySqlInitialized()
    return executeMySqlStatement(
      `
        INSERT INTO scan_cache
        (webdav_url, webdav_username, path, files_data, total_files, image_count, video_count, scan_settings, last_scan)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          files_data = VALUES(files_data),
          total_files = VALUES(total_files),
          image_count = VALUES(image_count),
          video_count = VALUES(video_count),
          scan_settings = VALUES(scan_settings),
          last_scan = CURRENT_TIMESTAMP
      `,
      [
        data.webdavUrl,
        data.webdavUsername,
        data.path,
        data.filesData,
        data.totalFiles,
        data.imageCount,
        data.videoCount,
        data.scanSettings,
      ],
    )
  },

  delete: async (webdavUrl: string, webdavUsername: string, path: string) => {
    await ensureMySqlInitialized()
    return executeMySqlStatement('DELETE FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? AND path = ?', [webdavUrl, webdavUsername, path])
  },

  getByWebDAVConfig: async (webdavUrl: string, webdavUsername: string) => {
    await ensureMySqlInitialized()
    return queryMySqlRows('SELECT * FROM scan_cache WHERE webdav_url = ? AND webdav_username = ? ORDER BY last_scan DESC', [webdavUrl, webdavUsername])
  },
}
