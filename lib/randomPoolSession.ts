const RANDOM_POOL_SESSION_STORAGE_KEY = 'random_pool_session_id'

function createRandomPoolSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `random-pool-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function getRandomPoolSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const existingSessionId = window.sessionStorage.getItem(RANDOM_POOL_SESSION_STORAGE_KEY)
  if (existingSessionId) {
    return existingSessionId
  }

  const nextSessionId = createRandomPoolSessionId()
  window.sessionStorage.setItem(RANDOM_POOL_SESSION_STORAGE_KEY, nextSessionId)
  return nextSessionId
}

export function renewRandomPoolSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const nextSessionId = createRandomPoolSessionId()
  window.sessionStorage.setItem(RANDOM_POOL_SESSION_STORAGE_KEY, nextSessionId)
  return nextSessionId
}
