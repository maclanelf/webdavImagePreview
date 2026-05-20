import fs from 'fs'
import path from 'path'

export interface MysqlRuntimeConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  charset: string
  timezone: string
  connectionLimit: number
}

export type MysqlConfigSource = 'file' | 'env' | 'none'

export const FIXED_MYSQL_DATABASE = 'webdav_image_preview'
const DEFAULT_MYSQL_CONFIG_FILE = path.join('data', 'mysql-config.json')

function normalizeMysqlConfig(config: Partial<Record<keyof MysqlRuntimeConfig, unknown>> = {}): MysqlRuntimeConfig {
  return {
    host: String(config.host || '').trim(),
    port: Number(config.port || 3306),
    user: String(config.user || '').trim(),
    password: String(config.password || ''),
    database: FIXED_MYSQL_DATABASE,
    charset: String(config.charset || 'utf8mb4').trim() || 'utf8mb4',
    timezone: String(config.timezone || '+08:00').trim() || '+08:00',
    connectionLimit: Number(config.connectionLimit || 10),
  }
}

function isValidMysqlConfig(config: MysqlRuntimeConfig) {
  return Boolean(
    config.host
    && config.user
    && config.password
    && config.database
    && Number.isFinite(config.port)
    && config.port > 0,
  )
}

export function getMysqlConfigFilePath() {
  const configuredPath = process.env.MYSQL_CONFIG_FILE?.trim()
  if (!configuredPath) {
    return path.join(process.cwd(), DEFAULT_MYSQL_CONFIG_FILE)
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), configuredPath)
}

export function getMysqlConfigFromEnv(): MysqlRuntimeConfig | null {
  const config = normalizeMysqlConfig({
    host: process.env.MYSQL_HOST,
    port: process.env.MYSQL_PORT,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: process.env.MYSQL_CHARSET,
    timezone: process.env.MYSQL_TIMEZONE,
    connectionLimit: process.env.MYSQL_CONNECTION_LIMIT,
  })

  return isValidMysqlConfig(config) ? config : null
}

export function getMysqlConfigFromFile(): MysqlRuntimeConfig | null {
  const filePath = getMysqlConfigFilePath()
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const config = normalizeMysqlConfig(parsed)
    return isValidMysqlConfig(config) ? config : null
  } catch (error) {
    console.error('读取 MySQL 配置文件失败:', error)
    return null
  }
}

export function getMysqlConfigForDisplay(): {
  config: MysqlRuntimeConfig
  source: MysqlConfigSource
  filePath: string
} {
  const filePath = getMysqlConfigFilePath()
  const fileConfig = getMysqlConfigFromFile()
  if (fileConfig) {
    return { config: fileConfig, source: 'file', filePath }
  }

  const envConfig = getMysqlConfigFromEnv()
  if (envConfig) {
    return { config: envConfig, source: 'env', filePath }
  }

  return {
    config: normalizeMysqlConfig(),
    source: 'none',
    filePath,
  }
}

export function getRequiredMysqlConfig(): MysqlRuntimeConfig {
  const fileConfig = getMysqlConfigFromFile()
  if (fileConfig) {
    return fileConfig
  }

  const envConfig = getMysqlConfigFromEnv()
  if (envConfig) {
    return envConfig
  }

  throw new Error(`缺少 MySQL 配置，请先在 ${getMysqlConfigFilePath()} 中保存配置，或设置 MYSQL_* 环境变量`)
}

export function getMysqlConfigSignature(config: MysqlRuntimeConfig) {
  return JSON.stringify(config)
}

export function saveMysqlConfigToFile(input: Partial<Record<keyof MysqlRuntimeConfig, unknown>>) {
  const config = normalizeMysqlConfig(input)
  if (!isValidMysqlConfig(config)) {
    throw new Error('请提供完整的 MySQL 配置信息')
  }

  const filePath = getMysqlConfigFilePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

  return { config, filePath }
}
