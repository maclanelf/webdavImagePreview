/**
 * URL 构建工具
 * 根据不同的源类型（CloudDrive2、OpenList）构建正确的文件访问 URL
 */

export type SourceType = 'clouddrive2' | 'openlist'

/**
 * 对路径进行编码（仅编码路径部分，不编码斜杠）
 * OpenList 特殊处理：将文件名中的全角斜杠替换为竖线
 */
function encodePathSegments(filepath: string): string {
  // 将路径按斜杠分割，对每个部分进行处理，然后重新组合
  return filepath
    .split('/')
    .map(segment => {
      // OpenList 特殊处理：将全角斜杠 ／ 替换为竖线 |
      // 这是因为 OpenList 不允许文件名中包含斜杠
      const normalizedSegment = segment
        .replace(/／/g, '|')  // 全角斜杠 → 竖线
        .replace(/\//g, '|')  // 半角斜杠 → 竖线（以防万一）
      
      // 对处理后的段进行 URL 编码
      return encodeURIComponent(normalizedSegment)
    })
    .join('/')
}

/**
 * 规范化文件路径（用于 WebDAV 客户端）
 * OpenList 需要将文件名中的全角斜杠替换为竖线，但不进行 URL 编码
 * WebDAV 客户端库会自动进行 URL 编码
 * 
 * @param filepath 原始文件路径（如：/115open/115/xxx/file.jpeg）
 * @param sourceType 源类型
 * @returns 规范化后的文件路径（供 WebDAV 客户端使用）
 */
export function normalizeFilePath(filepath: string, sourceType: SourceType = 'clouddrive2'): string {
  switch (sourceType) {
    case 'clouddrive2':
      // CloudDrive2: 保持原样，不做任何处理
      // 路径: /115open/115/xxx/file.jpeg
      return filepath
      
    case 'openlist':
      // OpenList: 
      // 1. 去掉第一段虚拟路径（如 /115open）
      // 2. 将文件名中的全角斜杠替换为竖线
      // 3. 不进行 URL 编码（WebDAV 客户端库会自动编码）
      
      // 分割路径
      const segments = filepath.split('/').filter(Boolean)
      
      // 去掉第一段（虚拟挂载点，如 "115open"）
      // 原始: /115open/115/xxx/file.jpeg
      // 结果: /115/xxx/file.jpeg
      const realPathSegments = segments.slice(1)
      
      // 替换全角斜杠为竖线
      const normalizedSegments = realPathSegments.map(segment => 
        segment.replace(/／/g, '|')
      )
      
      // 重新组合路径（确保以 / 开头）
      return '/' + normalizedSegments.join('/')
      
    default:
      return filepath
  }
}

/**
 * 构建文件访问的完整 URL
 * @param baseUrl WebDAV 服务器基础 URL (例如: http://192.168.133.131:5244/dav)
 * @param filepath 文件路径 (例如: /115open/115/folder/file.jpg)
 * @param sourceType 源类型
 * @returns 完整的文件访问 URL
 */
export function buildFileUrl(
  baseUrl: string,
  filepath: string,
  sourceType: SourceType = 'clouddrive2'
): string {
  // 移除 baseUrl 末尾的斜杠
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  
  // 确保 filepath 以斜杠开头
  const normalizedFilepath = filepath.startsWith('/') ? filepath : '/' + filepath
  
  switch (sourceType) {
    case 'clouddrive2':
      // CloudDrive2: http://host:port/dav + filepath (不编码)
      // 例如: http://192.168.133.131:19798/dav/115open/115/folder/文件.jpg
      // CloudDrive2 保留文件名中的全角斜杠 ／
      return normalizedBaseUrl + normalizedFilepath
      
    case 'openlist':
      // OpenList: 
      // 1. 从 baseUrl 中移除 /dav 部分
      // 2. 去掉 filepath 的第一段虚拟路径（如 /115open）
      // 3. 对路径进行编码（保留路径分隔符斜杠，替换文件名中的斜杠为竖线）
      
      const urlWithoutDav = normalizedBaseUrl.replace(/\/dav$/, '')
      
      // 去掉第一段虚拟路径
      const segments = normalizedFilepath.split('/').filter(Boolean)
      const realPathSegments = segments.slice(1) // 去掉第一段（如 "115open"）
      const realPath = '/' + realPathSegments.join('/')
      
      // 对路径进行编码（保留路径分隔符斜杠，替换文件名中的斜杠为竖线）
      const encodedPath = encodePathSegments(realPath)
      return urlWithoutDav + encodedPath
      
    default:
      // 默认使用 CloudDrive2 方式
      return normalizedBaseUrl + normalizedFilepath
  }
}

/**
 * 从完整 URL 中提取基础 URL（不包含文件路径）
 * @param fullUrl 完整 URL
 * @param sourceType 源类型
 * @returns 基础 URL
 */
export function extractBaseUrl(fullUrl: string, sourceType: SourceType = 'clouddrive2'): string {
  try {
    const url = new URL(fullUrl)
    const protocol = url.protocol
    const host = url.host
    
    switch (sourceType) {
      case 'clouddrive2':
        // CloudDrive2 通常包含 /dav
        return `${protocol}//${host}/dav`
        
      case 'openlist':
        // OpenList 不包含 /dav
        return `${protocol}//${host}`
        
      default:
        return `${protocol}//${host}/dav`
    }
  } catch (error) {
    console.error('解析 URL 失败:', error)
    return fullUrl
  }
}

/**
 * 获取 WebDAV 客户端使用的 URL
 * 注意：webdav 库需要完整的基础路径（包括 /dav）
 * @param baseUrl 基础 URL
 * @param sourceType 源类型
 * @returns WebDAV 客户端 URL
 */
export function getWebDAVClientUrl(baseUrl: string, sourceType: SourceType = 'clouddrive2'): string {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  
  switch (sourceType) {
    case 'clouddrive2':
      // CloudDrive2: 直接使用 baseUrl (包含 /dav)
      return normalizedBaseUrl
      
    case 'openlist':
      // OpenList: 如果 baseUrl 不包含 /dav，需要添加
      // 因为 webdav 库需要完整的 WebDAV 端点
      if (!normalizedBaseUrl.endsWith('/dav')) {
        return normalizedBaseUrl + '/dav'
      }
      return normalizedBaseUrl
      
    default:
      return normalizedBaseUrl
  }
}

/**
 * 构建浏览器直接访问的 URL（用于 OpenList 获取直链）
 * 注意：浏览器访问不需要去掉虚拟路径前缀
 * 
 * @param baseUrl WebDAV 服务器基础 URL (例如: http://192.168.133.131:5244/dav)
 * @param filepath 原始文件路径（包含虚拟路径，如 /115open/...）
 * @param sourceType 源类型
 * @returns 浏览器可直接访问的 URL
 */
export function buildBrowserUrl(
  baseUrl: string,
  filepath: string,
  sourceType: SourceType = 'clouddrive2'
): string {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  const normalizedFilepath = filepath.startsWith('/') ? filepath : '/' + filepath
  
  switch (sourceType) {
    case 'clouddrive2':
      // CloudDrive2: 保持原样
      return normalizedBaseUrl + normalizedFilepath
      
    case 'openlist':
      // OpenList: 浏览器访问保留完整路径（包括虚拟路径如 /115open）
      // 移除 /dav，但保留虚拟路径
      const urlWithoutDav = normalizedBaseUrl.replace(/\/dav$/, '')
      
      // 对路径进行编码
      const encodedPath = normalizedFilepath
        .split('/')
        .map(segment => segment.replace(/／/g, '|'))
        .map(segment => encodeURIComponent(segment))
        .join('/')
      
      return urlWithoutDav + encodedPath
      
    default:
      return normalizedBaseUrl + normalizedFilepath
  }
}
