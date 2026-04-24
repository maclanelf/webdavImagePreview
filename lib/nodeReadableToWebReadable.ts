import { Readable } from 'stream'

function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk
  }

  if (typeof chunk === 'string') {
    return new TextEncoder().encode(chunk)
  }

  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk)
  }

  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }

  return new Uint8Array(Buffer.from(chunk as any))
}

/**
 * 将 Node.js Readable 流转换为 Web ReadableStream。
 *
 * 不使用 `Readable.toWeb()`，避免在流被多次 close/end/destroy 时触发
 * `ERR_INVALID_STATE: Controller is already closed`。
 */
export function nodeReadableToWebReadable(stream: Readable): ReadableStream<Uint8Array> {
  let cleanupListeners = () => {}
  let settled = false

  const settle = (callback?: () => void) => {
    if (settled) {
      return false
    }

    settled = true
    cleanupListeners()
    callback?.()
    return true
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const closeController = () => {
        if (!settle()) {
          return
        }

        try {
          controller.close()
        } catch {
          // controller 已关闭时静默忽略，避免重复 close 升级成未捕获异常
        }
      }

      const errorController = (error: unknown) => {
        const normalizedError = error instanceof Error
          ? error
          : new Error(String(error ?? '未知流错误'))

        if (!settle()) {
          return
        }

        try {
          controller.error(normalizedError)
        } catch {
          // controller 已关闭时静默忽略
        }
      }

      const onData = (chunk: unknown) => {
        if (settled) {
          return
        }

        try {
          controller.enqueue(toUint8Array(chunk))
        } catch {
          settle(() => {
            try {
              if (!stream.destroyed) {
                stream.destroy()
              }
            } catch {
              // ignore destroy failure
            }
          })
        }
      }

      const onEnd = () => {
        closeController()
      }

      const onClose = () => {
        closeController()
      }

      const onError = (error: unknown) => {
        errorController(error)
      }

      cleanupListeners = () => {
        stream.off('data', onData)
        stream.off('end', onEnd)
        stream.off('close', onClose)
        stream.off('error', onError)
      }

      stream.on('data', onData)
      stream.on('end', onEnd)
      stream.on('close', onClose)
      stream.on('error', onError)
    },

    cancel(reason) {
      if (!settle()) {
        return
      }

      try {
        if (!stream.destroyed) {
          stream.destroy(reason instanceof Error ? reason : undefined)
        }
      } catch {
        // ignore destroy failure
      }
    }
  })
}
