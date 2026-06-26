'use client'

const DEFAULT_CLIENT_REQUEST_TIMEOUT_MS = 15_000

type FetchWithTimeoutInit = RequestInit & {
  timeoutMs?: number
  timeoutMessage?: string
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: FetchWithTimeoutInit = {}) {
  const {
    timeoutMs = DEFAULT_CLIENT_REQUEST_TIMEOUT_MS,
    timeoutMessage,
    signal,
    ...requestInit
  } = init

  const requestController = new AbortController()
  let timedOut = false

  const handleAbort = () => {
    requestController.abort()
  }

  if (signal?.aborted) {
    requestController.abort()
  } else if (signal) {
    signal.addEventListener('abort', handleAbort, { once: true })
  }

  const timeoutId = setTimeout(() => {
    timedOut = true
    requestController.abort()
  }, timeoutMs)

  try {
    return await fetch(input, {
      ...requestInit,
      signal: requestController.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutMessage || `请求超时（${Math.round(timeoutMs / 1000)}s）`)
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
    if (signal) {
      signal.removeEventListener('abort', handleAbort)
    }
  }
}

export { DEFAULT_CLIENT_REQUEST_TIMEOUT_MS }
