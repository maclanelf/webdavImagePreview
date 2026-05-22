'use client'

type RequestChannel = 'stream' | 'rating'

type PendingTask<T> = {
  channel: RequestChannel
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
  runner: () => Promise<T>
}

class ClientRequestScheduler {
  private readonly maxTotal = 5
  private readonly maxByChannel: Record<RequestChannel, number> = {
    stream: 4,
    rating: 1,
  }
  private readonly queues: Record<RequestChannel, Array<PendingTask<any>>> = {
    stream: [],
    rating: [],
  }
  private readonly activeByChannel: Record<RequestChannel, number> = {
    stream: 0,
    rating: 0,
  }
  private activeTotal = 0

  run<T>(channel: RequestChannel, runner: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queues[channel].push({ channel, runner, resolve, reject })
      this.drain()
    })
  }

  getStatus() {
    return {
      activeTotal: this.activeTotal,
      activeByChannel: { ...this.activeByChannel },
      queuedByChannel: {
        stream: this.queues.stream.length,
        rating: this.queues.rating.length,
      },
    }
  }

  private drain() {
    while (this.activeTotal < this.maxTotal) {
      const nextTask = this.pickNextTask()
      if (!nextTask) {
        return
      }

      this.startTask(nextTask)
    }
  }

  private pickNextTask() {
    const ratingTask = this.tryShiftTask('rating')
    if (ratingTask) {
      return ratingTask
    }

    return this.tryShiftTask('stream')
  }

  private tryShiftTask(channel: RequestChannel) {
    if (this.activeByChannel[channel] >= this.maxByChannel[channel]) {
      return null
    }

    return this.queues[channel].shift() ?? null
  }

  private startTask<T>(task: PendingTask<T>) {
    this.activeTotal += 1
    this.activeByChannel[task.channel] += 1

    task.runner()
      .then(task.resolve)
      .catch(task.reject)
      .finally(() => {
        this.activeTotal = Math.max(0, this.activeTotal - 1)
        this.activeByChannel[task.channel] = Math.max(0, this.activeByChannel[task.channel] - 1)
        this.drain()
      })
  }
}

declare global {
  var __clientRequestScheduler: ClientRequestScheduler | undefined
}

export const clientRequestScheduler = globalThis.__clientRequestScheduler || new ClientRequestScheduler()

if (typeof window !== 'undefined') {
  globalThis.__clientRequestScheduler = clientRequestScheduler
}

export function scheduleStreamRequest<T>(runner: () => Promise<T>) {
  return clientRequestScheduler.run('stream', runner)
}

export function scheduleRatingRequest<T>(runner: () => Promise<T>) {
  return clientRequestScheduler.run('rating', runner)
}
