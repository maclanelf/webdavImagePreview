import { ensureMySqlInitialized } from './database'

export async function initDatabase() {
  await ensureMySqlInitialized(true)
}
