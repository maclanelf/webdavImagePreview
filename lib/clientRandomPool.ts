'use client'

type RandomPoolMutationTask<T> = () => Promise<T>

let randomPoolMutationQueue: Promise<void> = Promise.resolve()

async function enqueueRandomPoolMutation<T>(task: RandomPoolMutationTask<T>): Promise<T> {
  const previousTask = randomPoolMutationQueue

  let releaseCurrentTask!: () => void
  randomPoolMutationQueue = new Promise<void>((resolve) => {
    releaseCurrentTask = resolve
  })

  await previousTask.catch(() => undefined)

  try {
    return await task()
  } finally {
    releaseCurrentTask()
  }
}

export async function clearRandomPoolSession(randomPoolSessionId: string | null | undefined) {
  const normalizedSessionId = typeof randomPoolSessionId === 'string'
    ? randomPoolSessionId.trim()
    : ''

  if (!normalizedSessionId) {
    return null
  }

  return enqueueRandomPoolMutation(async () => {
    const response = await fetch('/api/scan-files/random-pool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', randomPoolSessionId: normalizedSessionId }),
    })

    if (!response.ok) {
      throw new Error('清理服务端随机缓存池失败')
    }

    return response.json()
  })
}

export async function initializeRandomPoolSession(
  payload: Record<string, unknown>,
  randomPoolSessionId: string | null | undefined,
) {
  const normalizedSessionId = typeof randomPoolSessionId === 'string'
    ? randomPoolSessionId.trim()
    : ''

  if (!normalizedSessionId) {
    throw new Error('缺少 randomPoolSessionId')
  }

  return enqueueRandomPoolMutation(async () => {
    const response = await fetch('/api/scan-files/random-pool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        action: 'init',
        randomPoolSessionId: normalizedSessionId,
      }),
    })

    if (!response.ok) {
      throw new Error('初始化服务端随机缓存池失败')
    }

    return response.json()
  })
}

export { enqueueRandomPoolMutation }
